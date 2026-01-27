/**
 * Pulse Transfer Gate
 *
 * Manages atomic pulse ownership transfer using Babylon.js Observable priority system.
 *
 * CRITICAL REQUIREMENT:
 * "Do NOT let host.stop() and scene.start() cross within a single RAF cycle.
 * Instead, use onBeforeRenderObservable's priority (mask/order) to ensure
 * rendering ownership transfers with ZERO blank frames."
 *
 * Implementation Strategy:
 * 1. Both Host and Receiver register observers on onBeforeRenderObservable
 * 2. Use observer priority to control execution order
 * 3. Transfer gate acts as arbiter - flips ownership flag atomically
 * 4. Within the SAME frame:
 *    - Higher priority observer (Gate) flips the flag
 *    - Host observer checks flag, renders if owner
 *    - Receiver observer checks flag, renders if owner
 *
 * This ensures exactly ONE entity renders each frame, with no gaps.
 */

import * as BABYLON from '@babylonjs/core';
import { PulseOwner, PulseTransferConditions, IGPUPulseHost, IGPUPulseReceiver } from './types';

const LOG_PREFIX = '[TransferGate]';

/**
 * Observer priority levels (lower = higher priority, executes first)
 */
const OBSERVER_PRIORITY = {
    /** Gate observer - executes first, controls ownership flag */
    GATE: -1000,
    /** Host observer - executes second, renders if owner */
    HOST: -500,
    /** Receiver observer - executes third, renders if owner */
    RECEIVER: -100,
};

/**
 * Transfer request state
 */
interface TransferRequest {
    targetOwner: PulseOwner;
    conditions: PulseTransferConditions;
    timestamp: number;
    frameNumber: number;
}

/**
 * Configuration for Pulse Transfer Gate
 */
export interface PulseTransferGateConfig {
    scene: BABYLON.Scene;
    debug?: boolean;
}

export class PulseTransferGate {
    private readonly scene: BABYLON.Scene;
    private readonly config: PulseTransferGateConfig;

    // Current ownership state - THE source of truth
    private currentOwner: PulseOwner = PulseOwner.NONE;

    // Registered participants
    private host: IGPUPulseHost | null = null;
    private receiver: IGPUPulseReceiver | null = null;

    // Observers (priority-ordered)
    private gateObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private hostObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private receiverObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Pending transfer request (processed on next frame)
    private pendingTransfer: TransferRequest | null = null;

    // Callbacks
    private onOwnershipChanged?: (from: PulseOwner, to: PulseOwner, frameNumber: number) => void;
    private onFrameRendered?: (owner: PulseOwner, drawCalls: number) => void;

    // Frame tracking
    private frameNumber: number = 0;

    constructor(config: PulseTransferGateConfig) {
        this.scene = config.scene;
        this.config = config;
    }

    // ============================================================
    // Public API
    // ============================================================

    /**
     * Initialize the gate with observers
     */
    public initialize(): void {
        this.setupObservers();
        this.log('Initialized with priority-ordered observers');
    }

    /**
     * Register the pulse host
     */
    public registerHost(host: IGPUPulseHost): void {
        this.host = host;
        this.log(`Host registered: ${host.id}`);
    }

    /**
     * Register the pulse receiver
     */
    public registerReceiver(receiver: IGPUPulseReceiver): void {
        this.receiver = receiver;
        this.log(`Receiver registered: ${receiver.id}`);
    }

    /**
     * Set the initial owner (called at pulse begin)
     */
    public setInitialOwner(owner: PulseOwner): void {
        const previousOwner = this.currentOwner;
        this.currentOwner = owner;
        this.log(`Initial owner set: ${owner}`);
        this.onOwnershipChanged?.(previousOwner, owner, this.frameNumber);
    }

    /**
     * Request ownership transfer to target
     * Transfer will happen on the next frame's onBeforeRender
     *
     * @returns true if request accepted, false if invalid
     */
    public requestTransfer(
        targetOwner: PulseOwner,
        conditions: PulseTransferConditions
    ): boolean {
        // Validate transfer request
        if (targetOwner === this.currentOwner) {
            this.log(`Transfer request ignored: already owned by ${targetOwner}`, 'warn');
            return false;
        }

        if (targetOwner === PulseOwner.GAME_SCENE && !this.receiver) {
            this.log('Transfer request rejected: no receiver registered', 'error');
            return false;
        }

        if (targetOwner === PulseOwner.LOADING_HOST && !this.host) {
            this.log('Transfer request rejected: no host registered', 'error');
            return false;
        }

        // Check transfer conditions
        const failedConditions = this.checkConditions(conditions);
        if (failedConditions.length > 0) {
            this.log(`Transfer request rejected: conditions failed: ${failedConditions.join(', ')}`, 'warn');
            return false;
        }

        // Queue the transfer (will execute on next frame start)
        this.pendingTransfer = {
            targetOwner,
            conditions,
            timestamp: performance.now(),
            frameNumber: this.frameNumber,
        };

        this.log(`Transfer queued: ${this.currentOwner} -> ${targetOwner} (will execute next frame)`);
        return true;
    }

    /**
     * Force immediate transfer (emergency recovery)
     */
    public forceTransfer(targetOwner: PulseOwner): void {
        const previousOwner = this.currentOwner;
        this.currentOwner = targetOwner;
        this.pendingTransfer = null;

        this.log(`FORCE TRANSFER: ${previousOwner} -> ${targetOwner}`, 'warn');
        this.onOwnershipChanged?.(previousOwner, targetOwner, this.frameNumber);
    }

    /**
     * Get current owner
     */
    public getCurrentOwner(): PulseOwner {
        return this.currentOwner;
    }

    /**
     * Set ownership change callback
     */
    public setOwnershipCallback(
        callback: (from: PulseOwner, to: PulseOwner, frameNumber: number) => void
    ): void {
        this.onOwnershipChanged = callback;
    }

    /**
     * Set frame rendered callback
     */
    public setFrameCallback(callback: (owner: PulseOwner, drawCalls: number) => void): void {
        this.onFrameRendered = callback;
    }

    /**
     * Dispose the gate
     */
    public dispose(): void {
        if (this.gateObserver) {
            this.scene.onBeforeRenderObservable.remove(this.gateObserver);
            this.gateObserver = null;
        }
        if (this.hostObserver) {
            this.scene.onBeforeRenderObservable.remove(this.hostObserver);
            this.hostObserver = null;
        }
        if (this.receiverObserver) {
            this.scene.onBeforeRenderObservable.remove(this.receiverObserver);
            this.receiverObserver = null;
        }

        this.host = null;
        this.receiver = null;
        this.pendingTransfer = null;

        this.log('Disposed');
    }

    // ============================================================
    // Private: Observer Setup
    // ============================================================

    private setupObservers(): void {
        // CRITICAL: Observer execution order within the same frame
        // 1. Gate observer (priority -1000) - processes transfer, flips ownership
        // 2. Host observer (priority -500) - renders if owner
        // 3. Receiver observer (priority -100) - renders if owner
        //
        // This ensures:
        // - Ownership decision happens FIRST
        // - Exactly ONE participant renders
        // - No blank frames

        // Gate observer - highest priority, processes transfers
        this.gateObserver = this.scene.onBeforeRenderObservable.add(
            () => this.onGateFrame(),
            OBSERVER_PRIORITY.GATE
        );

        // Host observer - renders if it owns the pulse
        this.hostObserver = this.scene.onBeforeRenderObservable.add(
            () => this.onHostFrame(),
            OBSERVER_PRIORITY.HOST
        );

        // Receiver observer - renders if it owns the pulse
        this.receiverObserver = this.scene.onBeforeRenderObservable.add(
            () => this.onReceiverFrame(),
            OBSERVER_PRIORITY.RECEIVER
        );
    }

    /**
     * Gate frame handler - EXECUTES FIRST
     * Processes any pending transfer atomically
     */
    private onGateFrame(): void {
        this.frameNumber++;

        // Process pending transfer if any
        if (this.pendingTransfer) {
            const transfer = this.pendingTransfer;
            this.pendingTransfer = null;

            const previousOwner = this.currentOwner;

            // === ATOMIC OWNERSHIP FLIP ===
            this.currentOwner = transfer.targetOwner;

            // Notify participants WITHIN THE SAME FRAME
            if (transfer.targetOwner === PulseOwner.GAME_SCENE && this.receiver) {
                this.receiver.onPulseReceived();
            }

            this.log(`Transfer EXECUTED at frame ${this.frameNumber}: ${previousOwner} -> ${transfer.targetOwner}`);
            this.onOwnershipChanged?.(previousOwner, transfer.targetOwner, this.frameNumber);
        }
    }

    /**
     * Host frame handler - EXECUTES SECOND
     * Renders only if host owns the pulse
     */
    private onHostFrame(): void {
        if (this.currentOwner !== PulseOwner.LOADING_HOST) {
            return;
        }

        if (!this.host || !this.host.isActive) {
            return;
        }

        // Host renders its pulse frame
        this.host.renderPulseFrame();
        this.onFrameRendered?.(PulseOwner.LOADING_HOST, 1);
    }

    /**
     * Receiver frame handler - EXECUTES THIRD
     * Notifies receiver if it owns the pulse
     * (Actual rendering is done by the scene's normal render pipeline)
     */
    private onReceiverFrame(): void {
        if (this.currentOwner !== PulseOwner.GAME_SCENE) {
            return;
        }

        if (!this.receiver) {
            return;
        }

        // Receiver reports its frame
        // The actual rendering is handled by Babylon.js scene render
        this.receiver.reportFrameRendered();
        this.onFrameRendered?.(PulseOwner.GAME_SCENE, 1);
    }

    // ============================================================
    // Private: Condition Checking
    // ============================================================

    private checkConditions(conditions: PulseTransferConditions): (keyof PulseTransferConditions)[] {
        const failed: (keyof PulseTransferConditions)[] = [];

        if (!conditions.transformMatrixValid) failed.push('transformMatrixValid');
        if (!conditions.cameraProjectionReady) failed.push('cameraProjectionReady');
        if (!conditions.canDrawOneFrame) failed.push('canDrawOneFrame');
        if (!conditions.hasRenderableMesh) failed.push('hasRenderableMesh');
        if (!conditions.rafHealthy) failed.push('rafHealthy');
        if (!conditions.rafStable) failed.push('rafStable');

        return failed;
    }

    // ============================================================
    // Private: Logging
    // ============================================================

    private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        const entry = `${LOG_PREFIX} f=${this.frameNumber} ${message}`;

        if (this.config.debug || level !== 'info') {
            if (level === 'error') {
                console.error(entry);
            } else if (level === 'warn') {
                console.warn(entry);
            } else {
                console.log(entry);
            }
        }
    }
}
