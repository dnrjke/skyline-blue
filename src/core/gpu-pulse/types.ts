/**
 * GPU Pulse Host System - Type Definitions
 *
 * Phase 2.6: GPU Pulse Hosting & Seamless Scene Docking
 *
 * Core Concept:
 * - Loading screen is NOT just UI, it's a GPU Pulse Host
 * - GPU Pulse Host maintains continuous rendering heartbeat
 * - Game Scene must NOT know or depend on this structure
 */

import * as BABYLON from '@babylonjs/core';

// ============================================================
// Pulse Ownership States
// ============================================================

/**
 * GPU Pulse Owner - Who currently holds rendering responsibility
 */
export enum PulseOwner {
    /** No active pulse (dangerous state - should trigger recovery) */
    NONE = 'none',
    /** Loading Host owns the pulse - maintains heartbeat during loading */
    LOADING_HOST = 'loading_host',
    /** Game Scene owns the pulse - normal gameplay rendering */
    GAME_SCENE = 'game_scene',
}

/**
 * Pulse Lifecycle Phases
 */
export enum PulsePhase {
    /** System not initialized */
    DORMANT = 'dormant',
    /** Pulse started, Loading Host active */
    PULSE_BEGIN = 'pulse_begin',
    /** Loading in progress, Host maintaining heartbeat */
    LOADING_ACTIVE = 'loading_active',
    /** Game Scene ready, transfer imminent */
    TRANSFER_READY = 'transfer_ready',
    /** Ownership transferring (atomic operation) */
    TRANSFERRING = 'transferring',
    /** Game Scene owns pulse, normal operation */
    GAME_ACTIVE = 'game_active',
    /** Emergency: pulse lost, recovery in progress */
    EMERGENCY_RECOVERY = 'emergency_recovery',
    /** Pulse ended (scene disposed) */
    PULSE_END = 'pulse_end',
}

// ============================================================
// Transfer Conditions
// ============================================================

/**
 * Minimum conditions for Pulse Transfer to Game Scene
 * All must be true for transfer to proceed
 */
export interface PulseTransferConditions {
    /** Transform matrices are valid and computed */
    transformMatrixValid: boolean;
    /** Camera projection matrix is ready */
    cameraProjectionReady: boolean;
    /** At least one frame can be drawn */
    canDrawOneFrame: boolean;
    /** Scene has at least one renderable mesh */
    hasRenderableMesh: boolean;
}

/**
 * Result of transfer attempt
 */
export interface PulseTransferResult {
    success: boolean;
    previousOwner: PulseOwner;
    newOwner: PulseOwner;
    timestamp: number;
    frameNumber: number;
    /** If failed, which conditions were not met */
    failedConditions?: (keyof PulseTransferConditions)[];
}

// ============================================================
// Health & Monitoring
// ============================================================

/**
 * Pulse health metrics for monitoring
 */
export interface PulseHealthMetrics {
    /** Current owner */
    owner: PulseOwner;
    /** Current phase */
    phase: PulsePhase;
    /** Time since last successful frame render (ms) */
    timeSinceLastFrame: number;
    /** Consecutive frames with actual draw calls */
    consecutiveDrawFrames: number;
    /** Whether pulse is considered healthy */
    isHealthy: boolean;
    /** Last frame timestamp */
    lastFrameTimestamp: number;
    /** Frame count since pulse begin */
    frameCount: number;
    /** Draw call count this frame */
    drawCallsThisFrame: number;
}

/**
 * Configuration for emergency recovery
 */
export interface EmergencyRecoveryConfig {
    /** Timeout before triggering recovery (ms) */
    timeoutMs: number;
    /** Maximum recovery attempts before giving up */
    maxRetries: number;
    /** Callback when recovery triggers */
    onRecoveryStart?: () => void;
    /** Callback when recovery completes */
    onRecoveryComplete?: (success: boolean) => void;
}

// ============================================================
// Pulse Host Interface
// ============================================================

/**
 * GPU Pulse Host Interface
 * Implemented by Loading Host and potentially other pulse providers
 */
export interface IGPUPulseHost {
    /** Unique identifier for this host */
    readonly id: string;

    /** Whether this host is currently active */
    readonly isActive: boolean;

    /**
     * Start providing pulse (begin rendering heartbeat)
     * @returns true if successfully started
     */
    activate(): boolean;

    /**
     * Stop providing pulse (prepare for disposal)
     * Only call after ownership has been transferred
     */
    deactivate(): void;

    /**
     * Render one frame of pulse content
     * Must include at least one draw call
     */
    renderPulseFrame(): void;

    /**
     * Check if this host can provide healthy pulse
     */
    canProvidePulse(): boolean;

    /**
     * Dispose all resources
     */
    dispose(): void;
}

/**
 * GPU Pulse Receiver Interface
 * Implemented by Game Scene to receive pulse ownership
 */
export interface IGPUPulseReceiver {
    /** Unique identifier for this receiver */
    readonly id: string;

    /**
     * Check if receiver is ready to accept pulse ownership
     */
    canAcceptPulse(): PulseTransferConditions;

    /**
     * Called when pulse ownership is transferred to this receiver
     */
    onPulseReceived(): void;

    /**
     * Called when pulse ownership is revoked (emergency recovery)
     */
    onPulseRevoked(): void;

    /**
     * Report that a frame was successfully rendered
     * Must be called every frame to maintain pulse health
     */
    reportFrameRendered(): void;
}

// ============================================================
// Coordinator Configuration
// ============================================================

/**
 * Configuration for GPU Pulse Coordinator
 */
export interface GPUPulseCoordinatorConfig {
    /** Babylon.js engine instance */
    engine: BABYLON.Engine;
    /** Babylon.js scene instance */
    scene: BABYLON.Scene;
    /** Emergency recovery configuration */
    emergencyRecovery: EmergencyRecoveryConfig;
    /** Enable debug logging */
    debug?: boolean;
    /** Enable debug overlay */
    debugOverlay?: boolean;
}

// ============================================================
// Events
// ============================================================

/**
 * Events emitted by GPU Pulse Coordinator
 */
export interface GPUPulseEvents {
    /** Pulse has begun */
    onPulseBegin: (context: string) => void;
    /** Ownership has transferred */
    onPulseTransfer: (result: PulseTransferResult) => void;
    /** Pulse has ended */
    onPulseEnd: () => void;
    /** Emergency recovery triggered */
    onEmergencyRecovery: (reason: string) => void;
    /** Health status changed */
    onHealthChange: (metrics: PulseHealthMetrics) => void;
}

// ============================================================
// Debug Types
// ============================================================

/**
 * Debug log entry for forensics
 */
export interface PulseDebugEntry {
    timestamp: number;
    frameNumber: number;
    phase: PulsePhase;
    owner: PulseOwner;
    event: string;
    details?: Record<string, unknown>;
}

/**
 * State transition record
 */
export interface PulseStateTransition {
    fromPhase: PulsePhase;
    toPhase: PulsePhase;
    fromOwner: PulseOwner;
    toOwner: PulseOwner;
    timestamp: number;
    frameNumber: number;
    reason: string;
}
