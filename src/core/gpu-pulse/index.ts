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
export { RAFHealthTracker, createRAFHealthTracker, RAFHealthStatus, RAF_THRESHOLDS, type RAFHealthMetrics, type RAFHealthCallbacks } from './RAFHealthTracker';

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
import { RAFHealthTracker, createRAFHealthTracker, RAFHealthStatus } from './RAFHealthTracker';

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
    /** Consecutive stable frames required before deactivating Host safety net (default: 30) */
    safetyNetStabilityFrames?: number;
    /** Maximum time to keep Host active as safety net after transfer (ms, default: 5000) */
    safetyNetTimeoutMs?: number;
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
    private readonly rafHealthTracker: RAFHealthTracker;
    private debugOverlay: PulseDebugOverlay | null = null;

    // Receiver (set when game scene registers)
    private receiver: IGPUPulseReceiver | null = null;

    // State
    private isStarted: boolean = false;
    private disposed: boolean = false;

    // Safety net state - keeps Host active after transfer until Game proves stable
    private safetyNetActive: boolean = false;
    private safetyNetStartTime: number = 0;
    private safetyNetStableFrames: number = 0;
    private readonly safetyNetStabilityFrames: number;
    private readonly safetyNetTimeoutMs: number;

    private constructor(
        _engine: BABYLON.Engine,
        scene: BABYLON.Scene,
        config: GPUPulseSystemConfig = {}
    ) {
        // Safety net configuration
        this.safetyNetStabilityFrames = config.safetyNetStabilityFrames ?? 30;
        this.safetyNetTimeoutMs = config.safetyNetTimeoutMs ?? 5000;

        // Create transfer gate (the arbiter)
        this.transferGate = new PulseTransferGate({
            scene,
            debug: config.debug,
        });

        // Create render host (loading pulse provider)
        this.renderHost = createPulseRenderHost(scene, config.debug);

        // Create RAF health tracker (silent - no callbacks that log)
        this.rafHealthTracker = createRAFHealthTracker(false);
        this.rafHealthTracker.setCallbacks({
            onThrottleDetected: () => {
                // If Game Scene owns pulse and RAF throttles, trigger recovery
                if (this.transferGate.getCurrentOwner() === PulseOwner.GAME_SCENE) {
                    this.activateSafetyNet();
                }
            },
            onStabilized: () => {
                // Check if we can deactivate safety net
                this.checkSafetyNetDeactivation();
            },
        });

        // Create emergency recovery
        this.emergencyRecovery = createEmergencyRecovery(this.transferGate, {
            timeoutMs: config.recoveryTimeoutMs ?? 500,
            maxRetries: config.maxRecoveryRetries ?? 3,
            onRecoveryStart: () => {
                // Re-activate host on recovery
                this.renderHost.activate();
                this.safetyNetActive = true;
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
    public beginPulse(_context: string): void {
        if (this.isStarted) {
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
    }

    /**
     * Register game scene as pulse receiver
     * The game scene must implement IGPUPulseReceiver
     */
    public registerGameScene(receiver: IGPUPulseReceiver): void {
        this.receiver = receiver;
        this.transferGate.registerReceiver(receiver);
    }

    /**
     * Attempt to transfer pulse ownership to game scene
     * Returns true if transfer successful
     *
     * IMPORTANT: This now checks RAF health and keeps Host active as safety net
     */
    public transferToGame(conditions: PulseTransferConditions): boolean {
        if (!this.receiver) {
            return false;
        }

        // Augment conditions with RAF health status
        const rafMetrics = this.rafHealthTracker.getMetrics();
        const augmentedConditions: PulseTransferConditions = {
            ...conditions,
            rafHealthy: this.rafHealthTracker.isHealthyForTransfer(),
            rafStable: this.rafHealthTracker.isStableForTransfer(),
        };

        // Block transfer if RAF is throttled
        if (rafMetrics.status === RAFHealthStatus.THROTTLED ||
            rafMetrics.status === RAFHealthStatus.SEVERE_THROTTLED) {
            return false;
        }

        const success = this.transferGate.requestTransfer(
            PulseOwner.GAME_SCENE,
            augmentedConditions
        );

        if (success) {
            // CRITICAL CHANGE: Activate safety net instead of deactivating Host
            // Host stays active as backup until Game Scene proves stable
            this.activateSafetyNet();
        }

        return success;
    }

    /**
     * Activate the safety net - keeps Host active after transfer
     */
    private activateSafetyNet(): void {
        this.safetyNetActive = true;
        this.safetyNetStartTime = performance.now();
        this.safetyNetStableFrames = 0;
        // Host stays active - do NOT deactivate
    }

    /**
     * Check if safety net can be deactivated
     * Called when RAF stabilizes
     */
    private checkSafetyNetDeactivation(): void {
        if (!this.safetyNetActive) return;

        const currentOwner = this.transferGate.getCurrentOwner();
        if (currentOwner !== PulseOwner.GAME_SCENE) {
            // Not in Game Scene mode, keep safety net
            return;
        }

        const rafMetrics = this.rafHealthTracker.getMetrics();

        // Check if Game Scene has maintained stability
        if (rafMetrics.consecutiveHealthyFrames >= this.safetyNetStabilityFrames) {
            this.deactivateSafetyNet();
            return;
        }

        // Check timeout
        const elapsed = performance.now() - this.safetyNetStartTime;
        if (elapsed >= this.safetyNetTimeoutMs) {
            this.deactivateSafetyNet();
        }
    }

    /**
     * Deactivate safety net and Host
     */
    private deactivateSafetyNet(): void {
        this.safetyNetActive = false;
        if (this.transferGate.getCurrentOwner() === PulseOwner.GAME_SCENE) {
            this.renderHost.deactivate();
        }
    }

    /**
     * Force transfer back to loading host (manual recovery)
     */
    public reclaimToHost(): void {
        this.transferGate.forceTransfer(PulseOwner.LOADING_HOST);
        this.renderHost.activate();
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
     * Check if RAF is healthy for transfer
     */
    public isRAFHealthy(): boolean {
        return this.rafHealthTracker.isHealthyForTransfer();
    }

    /**
     * Check if RAF is stable (consistent healthy frames)
     */
    public isRAFStable(): boolean {
        return this.rafHealthTracker.isStableForTransfer();
    }

    /**
     * Get RAF health metrics
     */
    public getRAFMetrics() {
        return this.rafHealthTracker.getMetrics();
    }

    /**
     * Check if safety net is currently active
     */
    public isSafetyNetActive(): boolean {
        return this.safetyNetActive;
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
    }

    // ============================================================
    // Private: Component Wiring
    // ============================================================

    private wireComponents(): void {
        // Connect render host frame callback to recovery monitoring
        this.renderHost.setFrameCallback((_drawCalls) => {
            this.emergencyRecovery.reportFrame(PulseOwner.LOADING_HOST);
            this.debugOverlay?.reportFrame();
            // Track RAF health on every Host frame
            this.rafHealthTracker.recordFrame();
        });

        // Connect transfer gate frame callback to recovery monitoring
        this.transferGate.setFrameCallback((owner, _drawCalls) => {
            this.emergencyRecovery.reportFrame(owner);
            this.debugOverlay?.reportFrame();
            // Track RAF health on every Gate frame
            this.rafHealthTracker.recordFrame();

            // Track safety net stability when Game Scene owns pulse
            if (this.safetyNetActive && owner === PulseOwner.GAME_SCENE) {
                const rafMetrics = this.rafHealthTracker.getMetrics();
                if (rafMetrics.lastFrameInterval < 50) {
                    this.safetyNetStableFrames++;
                    // Check for deactivation every frame during safety net
                    if (this.safetyNetStableFrames >= this.safetyNetStabilityFrames) {
                        this.checkSafetyNetDeactivation();
                    }
                } else {
                    // Reset stability count on slow frame
                    this.safetyNetStableFrames = 0;
                }
            }
        });

        // Connect ownership change callback
        this.transferGate.setOwnershipCallback((from, to, _frameNumber) => {
            // Reset RAF tracker on ownership change
            if (from !== to) {
                this.rafHealthTracker.reset();
            }
        });
    }
}
