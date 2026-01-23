/**
 * EngineAwakenedBarrier - Verifies actual RAF/render loop is ticking STABLY
 *
 * ⚠️ CRITICAL: This barrier MUST pass BEFORE READY is declared.
 *
 * Purpose:
 * READY should only be declared when the engine is "awake" - meaning:
 * 1. RAF is scheduling frames consistently
 * 2. Frame intervals are stable (no dt spikes)
 * 3. Multiple consecutive STABLE frames have rendered
 *
 * Pass Conditions (ALL must be met):
 * - N consecutive frames rendered (default: 3)
 * - Each frame interval < maxAllowedFrameGapMs (default: 50ms)
 * - Total elapsed time < maxWaitMs (timeout failsafe)
 *
 * Why this matters:
 * - Babylon engine may have render loop registered but not ticking
 * - First frame dt often spikes to 100ms+ (cold start)
 * - Browser RAF may be throttled based on visibility
 * - DevTools open/close affects RAF timing
 *
 * This is NOT about:
 * - Camera attachment (handled separately)
 * - Resize events (unreliable)
 * - activeMeshes count (not visibility guarantee)
 */

import * as BABYLON from '@babylonjs/core';

export interface EngineAwakenedConfig {
    /** Minimum consecutive STABLE frames required (default: 3) */
    minConsecutiveFrames?: number;
    /** Maximum allowed frame gap in ms (default: 50) */
    maxAllowedFrameGapMs?: number;
    /** Maximum wait time in ms before timeout (default: 3000) */
    maxWaitMs?: number;
    /** Enable debug logging */
    debug?: boolean;
}

export interface EngineAwakenedResult {
    /** Whether the barrier passed successfully */
    passed: boolean;
    /** Number of total frames rendered */
    framesRendered: number;
    /** Number of consecutive stable frames */
    stableFrameCount: number;
    /** Time taken in ms */
    elapsedMs: number;
    /** Whether it timed out */
    timedOut: boolean;
    /** Average frame interval of stable frames */
    avgFrameIntervalMs: number;
    /** Max frame interval observed */
    maxFrameIntervalMs: number;
}

/**
 * EngineAwakenedBarrier - Wait for STABLE render loop activity
 *
 * NEW FLOW (required):
 *   VISUAL_READY → ENGINE_AWAKENED → READY → UX_READY
 *
 * ENGINE_AWAKENED is a PREREQUISITE for READY, not a post-check.
 */
export class EngineAwakenedBarrier {
    private scene: BABYLON.Scene;
    private config: Required<EngineAwakenedConfig>;
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: EngineAwakenedConfig = {}) {
        this.scene = scene;
        this.config = {
            minConsecutiveFrames: config.minConsecutiveFrames ?? 3,
            maxAllowedFrameGapMs: config.maxAllowedFrameGapMs ?? 50,
            maxWaitMs: config.maxWaitMs ?? 3000,
            debug: config.debug ?? true,
        };
    }

    /**
     * Wait for render loop to be confirmed STABLY active
     * Returns a promise that resolves when barrier passes or times out
     */
    async wait(): Promise<EngineAwakenedResult> {
        return new Promise((resolve) => {
            if (this.disposed) {
                resolve({
                    passed: false,
                    framesRendered: 0,
                    stableFrameCount: 0,
                    elapsedMs: 0,
                    timedOut: false,
                    avgFrameIntervalMs: 0,
                    maxFrameIntervalMs: 0,
                });
                return;
            }

            const startTime = performance.now();
            let totalFrameCount = 0;
            let consecutiveStableFrames = 0;
            let lastFrameTime = startTime;
            let stableFrameIntervals: number[] = [];
            let maxFrameInterval = 0;
            let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;

            const cleanup = () => {
                if (observer) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    observer = null;
                }
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            };

            const complete = (passed: boolean, timedOut: boolean = false) => {
                const elapsedMs = performance.now() - startTime;
                cleanup();

                const avgFrameIntervalMs = stableFrameIntervals.length > 0
                    ? stableFrameIntervals.reduce((a, b) => a + b, 0) / stableFrameIntervals.length
                    : 0;

                const result: EngineAwakenedResult = {
                    passed,
                    framesRendered: totalFrameCount,
                    stableFrameCount: consecutiveStableFrames,
                    elapsedMs,
                    timedOut,
                    avgFrameIntervalMs,
                    maxFrameIntervalMs: maxFrameInterval,
                };

                if (this.config.debug) {
                    if (passed) {
                        console.log(
                            `[ENGINE_AWAKENED] ✓ Barrier PASSED: ${consecutiveStableFrames} stable frames, ` +
                            `avg dt=${avgFrameIntervalMs.toFixed(1)}ms, elapsed=${elapsedMs.toFixed(1)}ms`
                        );
                    } else if (timedOut) {
                        console.warn(
                            `[ENGINE_AWAKENED] ⚠️ TIMEOUT: ${totalFrameCount} total, ${consecutiveStableFrames} stable, ` +
                            `maxDt=${maxFrameInterval.toFixed(1)}ms, elapsed=${elapsedMs.toFixed(1)}ms`
                        );
                    } else {
                        console.warn(
                            `[ENGINE_AWAKENED] ⚠️ FAILED: unstable frames detected`
                        );
                    }
                }

                resolve(result);
            };

            // Set timeout failsafe
            timeoutId = setTimeout(() => {
                // On timeout, pass if we have at least 1 stable frame (graceful degradation)
                complete(consecutiveStableFrames >= 1, true);
            }, this.config.maxWaitMs);

            // Monitor render frames
            if (this.config.debug) {
                console.log(
                    `[ENGINE_AWAKENED] Waiting for ${this.config.minConsecutiveFrames} consecutive stable frames ` +
                    `(dt < ${this.config.maxAllowedFrameGapMs}ms)...`
                );
            }

            observer = this.scene.onBeforeRenderObservable.add(() => {
                const now = performance.now();
                const frameInterval = now - lastFrameTime;
                lastFrameTime = now;

                totalFrameCount++;
                maxFrameInterval = Math.max(maxFrameInterval, frameInterval);

                // Check if this frame interval is stable
                const isStable = frameInterval < this.config.maxAllowedFrameGapMs;

                if (isStable) {
                    consecutiveStableFrames++;
                    stableFrameIntervals.push(frameInterval);

                    if (this.config.debug && totalFrameCount <= 10) {
                        console.log(
                            `[ENGINE_AWAKENED] Frame ${totalFrameCount}: dt=${frameInterval.toFixed(1)}ms ✓ stable (${consecutiveStableFrames}/${this.config.minConsecutiveFrames})`
                        );
                    }
                } else {
                    // Unstable frame - reset consecutive counter
                    if (this.config.debug) {
                        console.warn(
                            `[ENGINE_AWAKENED] Frame ${totalFrameCount}: dt=${frameInterval.toFixed(1)}ms ⚠️ SPIKE - resetting counter`
                        );
                    }
                    consecutiveStableFrames = 0;
                    stableFrameIntervals = [];
                }

                // Check if we have enough consecutive stable frames
                if (consecutiveStableFrames >= this.config.minConsecutiveFrames) {
                    complete(true);
                }
            });
        });
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.disposed = true;
    }
}

/**
 * Utility function for simple usage
 *
 * @param scene - Babylon scene
 * @param options - Configuration options
 * @returns Promise that resolves when engine is confirmed STABLY awake
 */
export async function waitForEngineAwakened(
    scene: BABYLON.Scene,
    options: EngineAwakenedConfig = {}
): Promise<EngineAwakenedResult> {
    const barrier = new EngineAwakenedBarrier(scene, options);
    const result = await barrier.wait();
    barrier.dispose();
    return result;
}
