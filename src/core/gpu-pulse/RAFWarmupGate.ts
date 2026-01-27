/**
 * RAF Warm-up Gate
 *
 * Ensures GPU Pulse is stable BEFORE any heavy loading work begins.
 *
 * Problem:
 * - Heavy initialization causes 191ms+ main thread blocking
 * - This happens during the first 10 frames
 * - Chromium classifies the app as "idle" and throttles RAF to ~104ms
 *
 * Solution:
 * - Block all loading work until RAF proves stable
 * - Require N consecutive healthy frames (≤20ms each)
 * - Only then open the gate for loading to begin
 *
 * Usage:
 * ```typescript
 * const gate = new RAFWarmupGate(scene, { requiredStableFrames: 15 });
 * await gate.waitForStable();
 * // Now safe to start heavy loading work
 * ```
 */

import * as BABYLON from '@babylonjs/core';

/**
 * Gate state
 */
export enum WarmupGateState {
    /** Gate not started */
    IDLE = 'idle',
    /** Warming up - waiting for stable frames */
    WARMING_UP = 'warming_up',
    /** Gate open - safe to proceed */
    OPEN = 'open',
    /** Gate closed due to timeout or error */
    FAILED = 'failed',
}

/**
 * Configuration for RAF Warm-up Gate
 */
export interface RAFWarmupGateConfig {
    /** Number of consecutive stable frames required (default: 15) */
    requiredStableFrames?: number;
    /** Maximum frame interval to consider "healthy" in ms (default: 25) */
    healthyThresholdMs?: number;
    /** Maximum time to wait for stabilization in ms (default: 3000) */
    timeoutMs?: number;
    /** Enable debug logging */
    debug?: boolean;
}

/**
 * Warm-up result
 */
export interface WarmupResult {
    /** Whether warm-up succeeded */
    success: boolean;
    /** Final gate state */
    state: WarmupGateState;
    /** Total frames observed */
    totalFrames: number;
    /** Consecutive stable frames achieved */
    stableFramesAchieved: number;
    /** Time taken to stabilize in ms */
    warmupDurationMs: number;
    /** Average frame interval during warm-up */
    avgFrameIntervalMs: number;
    /** Frame intervals observed */
    frameIntervals: number[];
}

export class RAFWarmupGate {
    private readonly scene: BABYLON.Scene;
    private readonly config: Required<RAFWarmupGateConfig>;

    // State
    private state: WarmupGateState = WarmupGateState.IDLE;
    private observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Tracking
    private startTime: number = 0;
    private lastFrameTime: number = 0;
    private frameIntervals: number[] = [];
    private consecutiveStableFrames: number = 0;
    private totalFrames: number = 0;

    // Promise resolution
    private resolveWarmup: ((result: WarmupResult) => void) | null = null;
    private timeoutId: number | null = null;

    constructor(scene: BABYLON.Scene, config: RAFWarmupGateConfig = {}) {
        this.scene = scene;
        this.config = {
            requiredStableFrames: config.requiredStableFrames ?? 15,
            healthyThresholdMs: config.healthyThresholdMs ?? 25,
            timeoutMs: config.timeoutMs ?? 3000,
            debug: config.debug ?? false,
        };
    }

    /**
     * Get current gate state
     */
    public getState(): WarmupGateState {
        return this.state;
    }

    /**
     * Check if gate is open (safe to proceed with loading)
     */
    public isOpen(): boolean {
        return this.state === WarmupGateState.OPEN;
    }

    /**
     * Wait for RAF to stabilize.
     * Returns a Promise that resolves when the gate opens.
     */
    public waitForStable(): Promise<WarmupResult> {
        if (this.state === WarmupGateState.OPEN) {
            // Already open
            return Promise.resolve(this.buildResult(true));
        }

        if (this.state === WarmupGateState.WARMING_UP) {
            // Already warming up - return existing promise
            return new Promise((resolve) => {
                const existingResolve = this.resolveWarmup;
                this.resolveWarmup = (result) => {
                    existingResolve?.(result);
                    resolve(result);
                };
            });
        }

        return new Promise((resolve) => {
            this.resolveWarmup = resolve;
            this.startWarmup();
        });
    }

    /**
     * Force open the gate (bypass warm-up)
     */
    public forceOpen(): void {
        this.cleanup();
        this.state = WarmupGateState.OPEN;
        this.resolveWarmup?.(this.buildResult(true));
        this.resolveWarmup = null;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.cleanup();
        this.state = WarmupGateState.IDLE;
    }

    // ============================================================
    // Private: Warm-up Logic
    // ============================================================

    private startWarmup(): void {
        this.state = WarmupGateState.WARMING_UP;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.frameIntervals = [];
        this.consecutiveStableFrames = 0;
        this.totalFrames = 0;

        if (this.config.debug) {
            console.log(`[WarmupGate] Starting warm-up (need ${this.config.requiredStableFrames} stable frames ≤${this.config.healthyThresholdMs}ms)`);
        }

        // Set timeout
        this.timeoutId = window.setTimeout(() => {
            this.onTimeout();
        }, this.config.timeoutMs);

        // Start monitoring frames
        this.observer = this.scene.onBeforeRenderObservable.add(() => {
            this.onFrame();
        }, -950); // High priority, after pulse system
    }

    private onFrame(): void {
        const now = performance.now();
        this.totalFrames++;

        if (this.totalFrames > 1) {
            const interval = now - this.lastFrameTime;
            this.frameIntervals.push(interval);

            const isHealthy = interval <= this.config.healthyThresholdMs;

            if (isHealthy) {
                this.consecutiveStableFrames++;

                if (this.config.debug && this.consecutiveStableFrames <= this.config.requiredStableFrames) {
                    console.log(`[WarmupGate] Frame ${this.totalFrames}: ${interval.toFixed(1)}ms ✓ (${this.consecutiveStableFrames}/${this.config.requiredStableFrames})`);
                }

                // Check if we've reached the required stable frames
                if (this.consecutiveStableFrames >= this.config.requiredStableFrames) {
                    this.onStabilized();
                }
            } else {
                // Reset counter on unhealthy frame
                if (this.config.debug) {
                    console.log(`[WarmupGate] Frame ${this.totalFrames}: ${interval.toFixed(1)}ms ✗ (reset, was ${this.consecutiveStableFrames})`);
                }
                this.consecutiveStableFrames = 0;
            }
        }

        this.lastFrameTime = now;
    }

    private onStabilized(): void {
        this.cleanup();
        this.state = WarmupGateState.OPEN;

        const result = this.buildResult(true);

        if (this.config.debug) {
            console.log(`[WarmupGate] ✅ GATE OPEN after ${result.warmupDurationMs.toFixed(1)}ms (${result.totalFrames} frames, avg ${result.avgFrameIntervalMs.toFixed(1)}ms)`);
        }

        this.resolveWarmup?.(result);
        this.resolveWarmup = null;
    }

    private onTimeout(): void {
        this.cleanup();
        this.state = WarmupGateState.FAILED;

        const result = this.buildResult(false);

        // Even on timeout, we should proceed (loading must happen eventually)
        // But log a warning
        console.warn(`[WarmupGate] ⚠️ TIMEOUT after ${this.config.timeoutMs}ms (only ${this.consecutiveStableFrames}/${this.config.requiredStableFrames} stable frames)`);

        // Force open anyway - we can't wait forever
        this.state = WarmupGateState.OPEN;
        this.resolveWarmup?.(result);
        this.resolveWarmup = null;
    }

    private cleanup(): void {
        if (this.observer) {
            this.scene.onBeforeRenderObservable.remove(this.observer);
            this.observer = null;
        }

        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    private buildResult(success: boolean): WarmupResult {
        const duration = performance.now() - this.startTime;
        const avgInterval = this.frameIntervals.length > 0
            ? this.frameIntervals.reduce((a, b) => a + b, 0) / this.frameIntervals.length
            : 0;

        return {
            success,
            state: this.state,
            totalFrames: this.totalFrames,
            stableFramesAchieved: this.consecutiveStableFrames,
            warmupDurationMs: duration,
            avgFrameIntervalMs: avgInterval,
            frameIntervals: [...this.frameIntervals],
        };
    }
}

/**
 * Factory function
 */
export function createRAFWarmupGate(
    scene: BABYLON.Scene,
    config?: RAFWarmupGateConfig
): RAFWarmupGate {
    return new RAFWarmupGate(scene, config);
}
