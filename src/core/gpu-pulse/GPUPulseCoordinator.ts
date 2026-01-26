/**
 * GPU Pulse Coordinator
 *
 * Central controller for GPU Pulse lifecycle management.
 * Ensures continuous GPU rendering heartbeat across scene transitions.
 *
 * Key Responsibilities:
 * 1. Maintain pulse ownership state
 * 2. Coordinate atomic pulse transfers
 * 3. Monitor pulse health
 * 4. Trigger emergency recovery when needed
 */

import * as BABYLON from '@babylonjs/core';
import {
    PulseOwner,
    PulsePhase,
    PulseTransferConditions,
    PulseTransferResult,
    PulseHealthMetrics,
    GPUPulseCoordinatorConfig,
    GPUPulseEvents,
    PulseDebugEntry,
    PulseStateTransition,
    IGPUPulseHost,
    IGPUPulseReceiver,
} from './types';

const LOG_PREFIX = '[GPUPulse]';

export class GPUPulseCoordinator {
    // ============================================================
    // Core State
    // ============================================================
    private readonly scene: BABYLON.Scene;
    private readonly config: GPUPulseCoordinatorConfig;

    private currentOwner: PulseOwner = PulseOwner.NONE;
    private currentPhase: PulsePhase = PulsePhase.DORMANT;

    private pulseHost: IGPUPulseHost | null = null;
    private pulseReceiver: IGPUPulseReceiver | null = null;

    // ============================================================
    // Health Monitoring
    // ============================================================
    private lastFrameTimestamp: number = 0;
    private frameCount: number = 0;
    private consecutiveDrawFrames: number = 0;
    private drawCallsThisFrame: number = 0;

    // Emergency recovery
    private recoveryTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private recoveryAttempts: number = 0;

    // ============================================================
    // Observers
    // ============================================================
    private beforeRenderObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private afterRenderObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // ============================================================
    // Debug & Logging
    // ============================================================
    private readonly debugLog: PulseDebugEntry[] = [];
    private readonly stateTransitions: PulseStateTransition[] = [];
    private pulseBeginTimestamp: number = 0;
    private pulseContext: string = '';

    // ============================================================
    // Event Callbacks
    // ============================================================
    private eventCallbacks: Partial<GPUPulseEvents> = {};

    constructor(config: GPUPulseCoordinatorConfig) {
        this.scene = config.scene;
        this.config = config;

        this.setupObservers();
        this.log('Coordinator initialized');
    }

    // ============================================================
    // Public API
    // ============================================================

    /**
     * Begin GPU Pulse with Loading Host
     * @param context Descriptive context for debugging (e.g., "navigation-loading")
     */
    public beginPulse(context: string): void {
        if (this.currentPhase !== PulsePhase.DORMANT && this.currentPhase !== PulsePhase.PULSE_END) {
            this.log(`WARNING: beginPulse called in phase ${this.currentPhase}`, 'warn');
            return;
        }

        this.pulseContext = context;
        this.pulseBeginTimestamp = performance.now();
        this.frameCount = 0;
        this.consecutiveDrawFrames = 0;
        this.recoveryAttempts = 0;

        this.transitionTo(PulsePhase.PULSE_BEGIN, PulseOwner.LOADING_HOST, 'beginPulse');

        if (this.pulseHost) {
            this.pulseHost.activate();
        }

        this.startHealthMonitoring();

        this.log(`Pulse BEGIN: context="${context}"`);
        this.emitEvent('onPulseBegin', context);
    }

    /**
     * Register the Pulse Host (Loading Host)
     */
    public registerHost(host: IGPUPulseHost): void {
        this.pulseHost = host;
        this.log(`Host registered: ${host.id}`);
    }

    /**
     * Register the Pulse Receiver (Game Scene)
     */
    public registerReceiver(receiver: IGPUPulseReceiver): void {
        this.pulseReceiver = receiver;
        this.log(`Receiver registered: ${receiver.id}`);
    }

    /**
     * Attempt to transfer pulse ownership to Game Scene
     * This is the critical atomic operation
     */
    public transferPulse(_target: string): PulseTransferResult {
        const frameNumber = this.frameCount;
        const timestamp = performance.now();

        // Validate state
        if (this.currentOwner !== PulseOwner.LOADING_HOST) {
            this.log(`Transfer REJECTED: current owner is ${this.currentOwner}, not LOADING_HOST`, 'warn');
            return {
                success: false,
                previousOwner: this.currentOwner,
                newOwner: this.currentOwner,
                timestamp,
                frameNumber,
                failedConditions: [],
            };
        }

        if (!this.pulseReceiver) {
            this.log('Transfer REJECTED: no receiver registered', 'error');
            return {
                success: false,
                previousOwner: this.currentOwner,
                newOwner: this.currentOwner,
                timestamp,
                frameNumber,
            };
        }

        // Check transfer conditions
        const conditions = this.pulseReceiver.canAcceptPulse();
        const failedConditions = this.getFailedConditions(conditions);

        if (failedConditions.length > 0) {
            this.log(`Transfer REJECTED: conditions not met: ${failedConditions.join(', ')}`, 'warn');
            return {
                success: false,
                previousOwner: this.currentOwner,
                newOwner: this.currentOwner,
                timestamp,
                frameNumber,
                failedConditions,
            };
        }

        // === ATOMIC TRANSFER BEGINS ===
        this.transitionTo(PulsePhase.TRANSFERRING, this.currentOwner, 'transferPulse:begin');

        const previousOwner = this.currentOwner;

        // 1. Notify receiver of incoming ownership
        this.pulseReceiver.onPulseReceived();

        // 2. Update ownership state (atomic)
        this.currentOwner = PulseOwner.GAME_SCENE;

        // 3. Deactivate host (it's now safe)
        if (this.pulseHost) {
            this.pulseHost.deactivate();
        }

        // 4. Complete transition
        this.transitionTo(PulsePhase.GAME_ACTIVE, PulseOwner.GAME_SCENE, 'transferPulse:complete');

        // === ATOMIC TRANSFER ENDS ===

        const result: PulseTransferResult = {
            success: true,
            previousOwner,
            newOwner: PulseOwner.GAME_SCENE,
            timestamp,
            frameNumber,
        };

        this.log(`Transfer SUCCESS: ${previousOwner} -> GAME_SCENE at frame ${frameNumber}`);
        this.emitEvent('onPulseTransfer', result);

        return result;
    }

    /**
     * End the pulse (scene disposal)
     */
    public endPulse(): void {
        this.stopHealthMonitoring();

        if (this.pulseHost) {
            this.pulseHost.deactivate();
        }

        this.transitionTo(PulsePhase.PULSE_END, PulseOwner.NONE, 'endPulse');

        const duration = performance.now() - this.pulseBeginTimestamp;
        this.log(`Pulse END: context="${this.pulseContext}", duration=${duration.toFixed(0)}ms, frames=${this.frameCount}`);
        this.emitEvent('onPulseEnd');
    }

    /**
     * Report that a frame was successfully rendered (called by owner)
     */
    public reportFrameRendered(drawCalls: number = 1): void {
        this.lastFrameTimestamp = performance.now();
        this.frameCount++;
        this.drawCallsThisFrame = drawCalls;

        if (drawCalls > 0) {
            this.consecutiveDrawFrames++;
        } else {
            this.consecutiveDrawFrames = 0;
        }

        // Reset recovery timeout on successful frame
        this.resetRecoveryTimeout();
    }

    /**
     * Get current health metrics
     */
    public getHealthMetrics(): PulseHealthMetrics {
        const now = performance.now();
        const timeSinceLastFrame = this.lastFrameTimestamp > 0
            ? now - this.lastFrameTimestamp
            : 0;

        return {
            owner: this.currentOwner,
            phase: this.currentPhase,
            timeSinceLastFrame,
            consecutiveDrawFrames: this.consecutiveDrawFrames,
            isHealthy: this.isHealthy(),
            lastFrameTimestamp: this.lastFrameTimestamp,
            frameCount: this.frameCount,
            drawCallsThisFrame: this.drawCallsThisFrame,
        };
    }

    /**
     * Check if pulse is healthy
     */
    public isHealthy(): boolean {
        if (this.currentOwner === PulseOwner.NONE) {
            return false;
        }

        const timeSinceLastFrame = performance.now() - this.lastFrameTimestamp;
        const timeoutMs = this.config.emergencyRecovery.timeoutMs;

        return timeSinceLastFrame < timeoutMs;
    }

    /**
     * Get current owner
     */
    public getCurrentOwner(): PulseOwner {
        return this.currentOwner;
    }

    /**
     * Get current phase
     */
    public getCurrentPhase(): PulsePhase {
        return this.currentPhase;
    }

    /**
     * Register event callback
     */
    public on<K extends keyof GPUPulseEvents>(event: K, callback: GPUPulseEvents[K]): void {
        this.eventCallbacks[event] = callback;
    }

    /**
     * Get debug log
     */
    public getDebugLog(): readonly PulseDebugEntry[] {
        return this.debugLog;
    }

    /**
     * Get state transitions
     */
    public getStateTransitions(): readonly PulseStateTransition[] {
        return this.stateTransitions;
    }

    /**
     * Dispose coordinator
     */
    public dispose(): void {
        this.stopHealthMonitoring();

        if (this.beforeRenderObserver) {
            this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
            this.beforeRenderObserver = null;
        }

        if (this.afterRenderObserver) {
            this.scene.onAfterRenderObservable.remove(this.afterRenderObserver);
            this.afterRenderObserver = null;
        }

        if (this.pulseHost) {
            this.pulseHost.dispose();
            this.pulseHost = null;
        }

        this.pulseReceiver = null;

        this.log('Coordinator disposed');
    }

    // ============================================================
    // Private: Observers
    // ============================================================

    private setupObservers(): void {
        // Track frame rendering at the earliest point
        this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
            this.onBeforeRender();
        });

        this.afterRenderObserver = this.scene.onAfterRenderObservable.add(() => {
            this.onAfterRender();
        });
    }

    private onBeforeRender(): void {
        // If Loading Host owns pulse, ensure it renders
        if (this.currentOwner === PulseOwner.LOADING_HOST && this.pulseHost?.isActive) {
            this.pulseHost.renderPulseFrame();
        }
    }

    private onAfterRender(): void {
        // Instrumentation point for draw call counting
        // Draw call count is tracked by the Pulse owner (Host or Receiver)
        // This observer is kept for future instrumentation if needed
    }

    // ============================================================
    // Private: Health Monitoring
    // ============================================================

    private startHealthMonitoring(): void {
        this.resetRecoveryTimeout();
    }

    private stopHealthMonitoring(): void {
        if (this.recoveryTimeoutId !== null) {
            clearTimeout(this.recoveryTimeoutId);
            this.recoveryTimeoutId = null;
        }
    }

    private resetRecoveryTimeout(): void {
        if (this.recoveryTimeoutId !== null) {
            clearTimeout(this.recoveryTimeoutId);
        }

        const timeoutMs = this.config.emergencyRecovery.timeoutMs;
        this.recoveryTimeoutId = setTimeout(() => {
            this.onRecoveryTimeout();
        }, timeoutMs);
    }

    private onRecoveryTimeout(): void {
        const metrics = this.getHealthMetrics();

        // Only trigger recovery if we're in GAME_ACTIVE and receiver stopped responding
        if (this.currentPhase !== PulsePhase.GAME_ACTIVE) {
            // Not in game phase, reset timeout
            this.resetRecoveryTimeout();
            return;
        }

        this.log(`EMERGENCY: No frame render for ${metrics.timeSinceLastFrame.toFixed(0)}ms`, 'error');

        if (this.recoveryAttempts >= this.config.emergencyRecovery.maxRetries) {
            this.log(`EMERGENCY: Max retries (${this.config.emergencyRecovery.maxRetries}) exceeded`, 'error');
            return;
        }

        this.triggerEmergencyRecovery('timeout');
    }

    private triggerEmergencyRecovery(reason: string): void {
        this.recoveryAttempts++;

        this.transitionTo(PulsePhase.EMERGENCY_RECOVERY, this.currentOwner, `emergency:${reason}`);

        this.log(`EMERGENCY RECOVERY #${this.recoveryAttempts}: ${reason}`);
        this.config.emergencyRecovery.onRecoveryStart?.();
        this.emitEvent('onEmergencyRecovery', reason);

        // Revoke pulse from receiver
        if (this.pulseReceiver) {
            this.pulseReceiver.onPulseRevoked();
        }

        // Transfer back to Loading Host
        this.currentOwner = PulseOwner.LOADING_HOST;

        if (this.pulseHost && this.pulseHost.canProvidePulse()) {
            this.pulseHost.activate();
            this.transitionTo(PulsePhase.LOADING_ACTIVE, PulseOwner.LOADING_HOST, 'emergency:recovered');
            this.log('EMERGENCY RECOVERY: Pulse returned to Loading Host');
            this.config.emergencyRecovery.onRecoveryComplete?.(true);
        } else {
            this.log('EMERGENCY RECOVERY: Loading Host cannot provide pulse!', 'error');
            this.config.emergencyRecovery.onRecoveryComplete?.(false);
        }

        this.resetRecoveryTimeout();
    }

    // ============================================================
    // Private: State Management
    // ============================================================

    private transitionTo(phase: PulsePhase, owner: PulseOwner, reason: string): void {
        const transition: PulseStateTransition = {
            fromPhase: this.currentPhase,
            toPhase: phase,
            fromOwner: this.currentOwner,
            toOwner: owner,
            timestamp: performance.now(),
            frameNumber: this.frameCount,
            reason,
        };

        this.stateTransitions.push(transition);

        this.currentPhase = phase;
        this.currentOwner = owner;

        this.addDebugEntry('STATE_TRANSITION', {
            from: `${transition.fromPhase}/${transition.fromOwner}`,
            to: `${phase}/${owner}`,
            reason,
        });

        if (this.config.debug) {
            console.log(`${LOG_PREFIX} Phase: ${transition.fromPhase} -> ${phase}, Owner: ${transition.fromOwner} -> ${owner} (${reason})`);
        }
    }

    private getFailedConditions(conditions: PulseTransferConditions): (keyof PulseTransferConditions)[] {
        const failed: (keyof PulseTransferConditions)[] = [];

        if (!conditions.transformMatrixValid) failed.push('transformMatrixValid');
        if (!conditions.cameraProjectionReady) failed.push('cameraProjectionReady');
        if (!conditions.canDrawOneFrame) failed.push('canDrawOneFrame');
        if (!conditions.hasRenderableMesh) failed.push('hasRenderableMesh');

        return failed;
    }

    // ============================================================
    // Private: Debug & Logging
    // ============================================================

    private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        const entry = `${LOG_PREFIX} ${message}`;

        if (this.config.debug || level !== 'info') {
            if (level === 'error') {
                console.error(entry);
            } else if (level === 'warn') {
                console.warn(entry);
            } else {
                console.log(entry);
            }
        }

        this.addDebugEntry(message);
    }

    private addDebugEntry(event: string, details?: Record<string, unknown>): void {
        this.debugLog.push({
            timestamp: performance.now(),
            frameNumber: this.frameCount,
            phase: this.currentPhase,
            owner: this.currentOwner,
            event,
            details,
        });

        // Keep log bounded
        if (this.debugLog.length > 1000) {
            this.debugLog.shift();
        }
    }

    private emitEvent<K extends keyof GPUPulseEvents>(
        event: K,
        ...args: Parameters<GPUPulseEvents[K]>
    ): void {
        const callback = this.eventCallbacks[event];
        if (callback) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (callback as (...args: any[]) => void)(...args);
        }
    }
}
