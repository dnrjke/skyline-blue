/**
 * GPU Pulse Host System
 *
 * Phase 2.6: GPU Pulse Hosting & Seamless Scene Docking
 *
 * Core Principle:
 * "GPU Pulse is ALWAYS owned by someone. There is no 'no pulse' state."
 *
 * This module provides a reusable loading standard that ensures:
 * - Zero GPU idle frames during scene transitions
 * - Atomic pulse ownership transfer
 * - Emergency recovery from render stalls
 *
 * Usage:
 * ```typescript
 * import { GPUPulseSystem } from '@/core/gpu-pulse';
 *
 * // Create the system
 * const pulse = GPUPulseSystem.create(engine, scene, { debug: true });
 *
 * // Begin pulse (loading starts)
 * pulse.beginPulse('navigation-loading');
 *
 * // ... load assets ...
 *
 * // Transfer to game scene when ready
 * const success = pulse.transferToGame({
 *   transformMatrixValid: true,
 *   cameraProjectionReady: true,
 *   canDrawOneFrame: true,
 *   hasRenderableMesh: true,
 * });
 *
 * // End pulse (scene disposal)
 * pulse.endPulse();
 * ```
 */

// Types
export {
    PulseOwner,
    PulsePhase,
    type PulseTransferConditions,
    type PulseTransferResult,
    type PulseHealthMetrics,
    type EmergencyRecoveryConfig,
    type IGPUPulseHost,
    type IGPUPulseReceiver,
    type GPUPulseCoordinatorConfig,
    type GPUPulseEvents,
    type PulseDebugEntry,
    type PulseStateTransition,
} from './types';

// Core components
export { GPUPulseCoordinator } from './GPUPulseCoordinator';
export { PulseRenderHost, createPulseRenderHost, type PulseRenderHostConfig } from './PulseRenderHost';
export { PulseTransferGate, type PulseTransferGateConfig } from './PulseTransferGate';
export { EmergencyPulseRecovery, createEmergencyRecovery, type EmergencyRecoverySystemConfig } from './EmergencyPulseRecovery';
export { PulseDebugOverlay, createPulseDebugOverlay, type PulseDebugOverlayConfig } from './PulseDebugOverlay';

// ============================================================
// Convenience Factory: GPUPulseSystem
// ============================================================

import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { PulseOwner, PulseTransferConditions, IGPUPulseReceiver } from './types';
import { PulseRenderHost, createPulseRenderHost } from './PulseRenderHost';
import { PulseTransferGate } from './PulseTransferGate';
import { EmergencyPulseRecovery, createEmergencyRecovery } from './EmergencyPulseRecovery';
import { PulseDebugOverlay, createPulseDebugOverlay } from './PulseDebugOverlay';

/**
 * Configuration for GPUPulseSystem
 */
export interface GPUPulseSystemConfig {
    /** Enable debug mode */
    debug?: boolean;
    /** Enable debug overlay (requires GUI texture) */
    debugOverlay?: boolean;
    /** GUI texture for debug overlay */
    guiTexture?: GUI.AdvancedDynamicTexture;
    /** Emergency recovery timeout in ms (default: 500) */
    recoveryTimeoutMs?: number;
    /** Max recovery retries (default: 3) */
    maxRecoveryRetries?: number;
}

/**
 * GPUPulseSystem - Unified API for GPU Pulse management
 *
 * This is the recommended way to use the GPU Pulse system.
 * It handles component wiring, lifecycle management, and provides
 * a simple interface for common operations.
 */
export class GPUPulseSystem {
    // Core components
    private readonly transferGate: PulseTransferGate;
    private readonly renderHost: PulseRenderHost;
    private readonly emergencyRecovery: EmergencyPulseRecovery;
    private debugOverlay: PulseDebugOverlay | null = null;

    // Receiver (set when game scene registers)
    private receiver: IGPUPulseReceiver | null = null;

    // State
    private isStarted: boolean = false;
    private disposed: boolean = false;

    private constructor(
        _engine: BABYLON.Engine,
        scene: BABYLON.Scene,
        config: GPUPulseSystemConfig = {}
    ) {
        // Create transfer gate (the arbiter)
        this.transferGate = new PulseTransferGate({
            scene,
            debug: config.debug,
        });

        // Create render host (loading pulse provider)
        this.renderHost = createPulseRenderHost(scene, config.debug);

        // Create emergency recovery
        this.emergencyRecovery = createEmergencyRecovery(this.transferGate, {
            timeoutMs: config.recoveryTimeoutMs ?? 500,
            maxRetries: config.maxRecoveryRetries ?? 3,
            onRecoveryStart: () => {
                // Re-activate host on recovery
                this.renderHost.activate();
            },
        });

        // Wire components
        this.wireComponents();

        // Initialize transfer gate observers
        this.transferGate.initialize();

        // Create debug overlay if requested
        if (config.debugOverlay && config.guiTexture) {
            this.debugOverlay = createPulseDebugOverlay(
                config.guiTexture,
                this.transferGate,
                this.emergencyRecovery
            );
        }

        console.log('[GPUPulseSystem] Created');
    }

    /**
     * Factory method to create GPUPulseSystem
     */
    public static create(
        engine: BABYLON.Engine,
        scene: BABYLON.Scene,
        config: GPUPulseSystemConfig = {}
    ): GPUPulseSystem {
        return new GPUPulseSystem(engine, scene, config);
    }

    // ============================================================
    // Public API
    // ============================================================

    /**
     * Begin GPU Pulse with Loading Host
     * Call this at the start of loading phase
     */
    public beginPulse(context: string): void {
        if (this.isStarted) {
            console.warn('[GPUPulseSystem] beginPulse called but already started');
            return;
        }

        // Register host with transfer gate
        this.transferGate.registerHost(this.renderHost);

        // Activate render host
        this.renderHost.activate();

        // Set initial owner to Loading Host
        this.transferGate.setInitialOwner(PulseOwner.LOADING_HOST);

        // Start emergency recovery monitoring
        this.emergencyRecovery.startMonitoring();

        // Show debug overlay if configured
        if (this.debugOverlay) {
            this.debugOverlay.show();
        }

        this.isStarted = true;

        console.log(`[GPUPulseSystem] Pulse BEGIN: ${context}`);
    }

    /**
     * Register game scene as pulse receiver
     * The game scene must implement IGPUPulseReceiver
     */
    public registerGameScene(receiver: IGPUPulseReceiver): void {
        this.receiver = receiver;
        this.transferGate.registerReceiver(receiver);

        console.log(`[GPUPulseSystem] Game scene registered: ${receiver.id}`);
    }

    /**
     * Attempt to transfer pulse ownership to game scene
     * Returns true if transfer successful
     */
    public transferToGame(conditions: PulseTransferConditions): boolean {
        if (!this.receiver) {
            console.error('[GPUPulseSystem] Cannot transfer: no game scene registered');
            return false;
        }

        const success = this.transferGate.requestTransfer(
            PulseOwner.GAME_SCENE,
            conditions
        );

        if (success) {
            // Deactivate render host after transfer
            // Note: This happens on the next frame due to transfer gate's atomic design
            setTimeout(() => {
                if (this.transferGate.getCurrentOwner() === PulseOwner.GAME_SCENE) {
                    this.renderHost.deactivate();
                }
            }, 100);
        }

        return success;
    }

    /**
     * Force transfer back to loading host (manual recovery)
     */
    public reclaimToHost(): void {
        this.transferGate.forceTransfer(PulseOwner.LOADING_HOST);
        this.renderHost.activate();

        console.log('[GPUPulseSystem] Pulse RECLAIMED to Loading Host');
    }

    /**
     * End the pulse (scene disposal)
     */
    public endPulse(): void {
        if (!this.isStarted) {
            return;
        }

        this.emergencyRecovery.stopMonitoring();
        this.renderHost.deactivate();

        if (this.debugOverlay) {
            this.debugOverlay.hide();
        }

        this.isStarted = false;

        console.log('[GPUPulseSystem] Pulse END');
    }

    /**
     * Get current pulse owner
     */
    public getCurrentOwner(): PulseOwner {
        return this.transferGate.getCurrentOwner();
    }

    /**
     * Check if pulse is healthy
     */
    public isHealthy(): boolean {
        return this.emergencyRecovery.getHealthMetrics().isHealthy;
    }

    /**
     * Get debug overlay (for external control)
     */
    public getDebugOverlay(): PulseDebugOverlay | null {
        return this.debugOverlay;
    }

    /**
     * Dispose the system
     */
    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.endPulse();

        this.debugOverlay?.dispose();
        this.emergencyRecovery.dispose();
        this.transferGate.dispose();
        this.renderHost.dispose();

        this.disposed = true;

        console.log('[GPUPulseSystem] Disposed');
    }

    // ============================================================
    // Private: Component Wiring
    // ============================================================

    private wireComponents(): void {
        // Connect render host frame callback to recovery monitoring
        this.renderHost.setFrameCallback((_drawCalls) => {
            this.emergencyRecovery.reportFrame(PulseOwner.LOADING_HOST);
            this.debugOverlay?.reportFrame();
        });

        // Connect transfer gate frame callback to recovery monitoring
        this.transferGate.setFrameCallback((owner, _drawCalls) => {
            this.emergencyRecovery.reportFrame(owner);
            this.debugOverlay?.reportFrame();
        });

        // Connect ownership change callback
        this.transferGate.setOwnershipCallback((from, to, frameNumber) => {
            console.log(`[GPUPulseSystem] Ownership: ${from} -> ${to} at frame ${frameNumber}`);
        });
    }
}
