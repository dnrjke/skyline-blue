/**
 * Emergency Pulse Recovery System
 *
 * Safety mechanism that reclaims pulse ownership when the game scene
 * stops rendering unexpectedly.
 *
 * Trigger Conditions:
 * - No frame rendered for configurable timeout (default: 500ms)
 * - Game Scene holds ownership but stops responding
 *
 * Recovery Process:
 * 1. Detect render stall (no frames for timeout period)
 * 2. Revoke ownership from Game Scene
 * 3. Transfer ownership back to Loading Host
 * 4. Loading Host resumes pulse rendering
 * 5. Optionally retry transfer to Game Scene
 */

import { PulseOwner, PulseHealthMetrics, EmergencyRecoveryConfig } from './types';
import { PulseTransferGate } from './PulseTransferGate';

const LOG_PREFIX = '[EmergencyRecovery]';

/**
 * Recovery state
 */
enum RecoveryState {
    /** Monitoring, no issue detected */
    MONITORING = 'monitoring',
    /** Stall detected, preparing recovery */
    STALL_DETECTED = 'stall_detected',
    /** Recovery in progress */
    RECOVERING = 'recovering',
    /** Recovery completed, back to monitoring */
    RECOVERED = 'recovered',
    /** Max retries exceeded, system degraded */
    DEGRADED = 'degraded',
}

/**
 * Extended configuration for recovery
 */
export interface EmergencyRecoverySystemConfig extends EmergencyRecoveryConfig {
    /** Transfer gate reference */
    transferGate: PulseTransferGate;
    /** Enable debug logging */
    debug?: boolean;
}

export class EmergencyPulseRecovery {
    private readonly config: EmergencyRecoverySystemConfig;
    private readonly transferGate: PulseTransferGate;

    // State
    private state: RecoveryState = RecoveryState.MONITORING;
    private recoveryAttempts: number = 0;

    // Frame tracking
    private lastFrameTimestamp: number = 0;
    private lastFrameOwner: PulseOwner = PulseOwner.NONE;
    private consecutiveFrames: number = 0;

    // Timeout management
    private checkIntervalId: ReturnType<typeof setInterval> | null = null;
    private readonly checkIntervalMs: number = 100; // Check every 100ms

    // Callbacks
    private onStallDetected?: (metrics: PulseHealthMetrics) => void;
    private onRecoveryTriggered?: (attempt: number) => void;
    private onRecoveryComplete?: (success: boolean) => void;

    constructor(config: EmergencyRecoverySystemConfig) {
        this.config = config;
        this.transferGate = config.transferGate;
    }

    // ============================================================
    // Public API
    // ============================================================

    /**
     * Start monitoring for render stalls
     */
    public startMonitoring(): void {
        if (this.checkIntervalId !== null) {
            return; // Already monitoring
        }

        this.state = RecoveryState.MONITORING;
        this.lastFrameTimestamp = performance.now();
        this.recoveryAttempts = 0;

        // Periodic check for stalls
        this.checkIntervalId = setInterval(() => {
            this.checkForStall();
        }, this.checkIntervalMs);

        this.log('Monitoring started');
    }

    /**
     * Stop monitoring
     */
    public stopMonitoring(): void {
        if (this.checkIntervalId !== null) {
            clearInterval(this.checkIntervalId);
            this.checkIntervalId = null;
        }

        this.state = RecoveryState.MONITORING;
        this.log('Monitoring stopped');
    }

    /**
     * Report that a frame was rendered
     * Called by the current pulse owner
     */
    public reportFrame(owner: PulseOwner): void {
        const now = performance.now();

        if (owner === this.lastFrameOwner) {
            this.consecutiveFrames++;
        } else {
            this.consecutiveFrames = 1;
            this.lastFrameOwner = owner;
        }

        this.lastFrameTimestamp = now;

        // If we were in recovery and frames are coming again, mark as recovered
        if (this.state === RecoveryState.RECOVERING) {
            this.state = RecoveryState.RECOVERED;
            this.log(`Recovery SUCCESS: frames resuming from ${owner}`);
            this.config.onRecoveryComplete?.(true);
            this.onRecoveryComplete?.(true);

            // Reset state after successful recovery
            setTimeout(() => {
                if (this.state === RecoveryState.RECOVERED) {
                    this.state = RecoveryState.MONITORING;
                }
            }, 1000);
        }
    }

    /**
     * Get current health metrics
     */
    public getHealthMetrics(): PulseHealthMetrics {
        const now = performance.now();
        const timeSinceLastFrame = this.lastFrameTimestamp > 0
            ? now - this.lastFrameTimestamp
            : 0;

        const currentOwner = this.transferGate.getCurrentOwner();

        return {
            owner: currentOwner,
            phase: this.state as unknown as import('./types').PulsePhase,
            timeSinceLastFrame,
            consecutiveDrawFrames: this.consecutiveFrames,
            isHealthy: timeSinceLastFrame < this.config.timeoutMs,
            lastFrameTimestamp: this.lastFrameTimestamp,
            frameCount: this.consecutiveFrames,
            drawCallsThisFrame: 1,
        };
    }

    /**
     * Set callbacks
     */
    public setCallbacks(callbacks: {
        onStallDetected?: (metrics: PulseHealthMetrics) => void;
        onRecoveryTriggered?: (attempt: number) => void;
        onRecoveryComplete?: (success: boolean) => void;
    }): void {
        this.onStallDetected = callbacks.onStallDetected;
        this.onRecoveryTriggered = callbacks.onRecoveryTriggered;
        this.onRecoveryComplete = callbacks.onRecoveryComplete;
    }

    /**
     * Get current recovery state
     */
    public getState(): RecoveryState {
        return this.state;
    }

    /**
     * Get recovery attempt count
     */
    public getAttemptCount(): number {
        return this.recoveryAttempts;
    }

    /**
     * Dispose the recovery system
     */
    public dispose(): void {
        this.stopMonitoring();
        this.log('Disposed');
    }

    // ============================================================
    // Private: Stall Detection
    // ============================================================

    private checkForStall(): void {
        // Only trigger recovery when Game Scene owns the pulse
        // Loading Host is designed to never stall
        const currentOwner = this.transferGate.getCurrentOwner();
        if (currentOwner !== PulseOwner.GAME_SCENE) {
            return;
        }

        const now = performance.now();
        const timeSinceLastFrame = now - this.lastFrameTimestamp;

        // Check if stalled
        if (timeSinceLastFrame >= this.config.timeoutMs) {
            if (this.state === RecoveryState.MONITORING) {
                this.onStallDetectedInternal(timeSinceLastFrame);
            }
        }
    }

    private onStallDetectedInternal(stallDuration: number): void {
        this.state = RecoveryState.STALL_DETECTED;

        const metrics = this.getHealthMetrics();
        this.log(`STALL DETECTED: no frame for ${stallDuration.toFixed(0)}ms`, 'warn');

        this.onStallDetected?.(metrics);

        // Check if we can attempt recovery
        if (this.recoveryAttempts >= this.config.maxRetries) {
            this.log(`Max retries (${this.config.maxRetries}) exceeded - entering DEGRADED state`, 'error');
            this.state = RecoveryState.DEGRADED;
            this.config.onRecoveryComplete?.(false);
            this.onRecoveryComplete?.(false);
            return;
        }

        // Trigger recovery
        this.triggerRecovery();
    }

    private triggerRecovery(): void {
        this.recoveryAttempts++;
        this.state = RecoveryState.RECOVERING;

        this.log(`RECOVERY TRIGGERED: attempt ${this.recoveryAttempts}/${this.config.maxRetries}`, 'warn');
        this.config.onRecoveryStart?.();
        this.onRecoveryTriggered?.(this.recoveryAttempts);

        // Force transfer back to Loading Host
        this.transferGate.forceTransfer(PulseOwner.LOADING_HOST);

        // Update frame timestamp to prevent immediate re-trigger
        this.lastFrameTimestamp = performance.now();
        this.lastFrameOwner = PulseOwner.LOADING_HOST;
    }

    // ============================================================
    // Private: Logging
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
    }
}

/**
 * Factory function for standard emergency recovery
 */
export function createEmergencyRecovery(
    transferGate: PulseTransferGate,
    options?: Partial<EmergencyRecoveryConfig>
): EmergencyPulseRecovery {
    return new EmergencyPulseRecovery({
        transferGate,
        timeoutMs: options?.timeoutMs ?? 500,
        maxRetries: options?.maxRetries ?? 3,
        onRecoveryStart: options?.onRecoveryStart,
        onRecoveryComplete: options?.onRecoveryComplete,
        debug: true,
    });
}
