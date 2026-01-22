/**
 * EngineAwakenedBarrier - Verifies actual RAF/render loop is ticking
 *
 * Purpose:
 * READY declaration means "logical loading complete", but does NOT guarantee
 * that the render loop is actually running and producing frames.
 *
 * This barrier verifies that:
 * 1. RAF is scheduling frames
 * 2. scene.onBeforeRender is being called
 * 3. Multiple consecutive frames have rendered (not just one)
 *
 * Only after this barrier passes should loading UI be removed.
 *
 * Why this matters:
 * - Babylon engine may have render loop registered but not ticking
 * - Browser RAF may be throttled/delayed based on visibility
 * - DevTools open/close affects RAF timing
 * - First render frame may be significantly delayed after READY
 *
 * This is NOT about:
 * - Camera attachment (already handled elsewhere)
 * - Resize events (unreliable trigger)
 * - activeMeshes count (not a visibility guarantee)
 */

import * as BABYLON from '@babylonjs/core';

export interface EngineAwakenedConfig {
    /** Minimum consecutive frames required (default: 3) */
    minConsecutiveFrames?: number;
    /** Maximum wait time in ms before timeout (default: 3000) */
    maxWaitMs?: number;
    /** Enable debug logging */
    debug?: boolean;
}

export interface EngineAwakenedResult {
    /** Whether the barrier passed successfully */
    passed: boolean;
    /** Number of frames that rendered */
    framesRendered: number;
    /** Time taken in ms */
    elapsedMs: number;
    /** Whether it timed out */
    timedOut: boolean;
}

/**
 * EngineAwakenedBarrier - Wait for actual render loop activity
 *
 * Usage:
 * ```typescript
 * // After READY is declared
 * const barrier = new EngineAwakenedBarrier(scene);
 * const result = await barrier.wait();
 * if (result.passed) {
 *   // Safe to remove loading UI
 * }
 * ```
 */
export class EngineAwakenedBarrier {
    private scene: BABYLON.Scene;
    private config: Required<EngineAwakenedConfig>;
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: EngineAwakenedConfig = {}) {
        this.scene = scene;
        this.config = {
            minConsecutiveFrames: config.minConsecutiveFrames ?? 3,
            maxWaitMs: config.maxWaitMs ?? 3000,
            debug: config.debug ?? true,
        };
    }

    /**
     * Wait for render loop to be confirmed active
     * Returns a promise that resolves when barrier passes or times out
     */
    async wait(): Promise<EngineAwakenedResult> {
        return new Promise((resolve) => {
            if (this.disposed) {
                resolve({
                    passed: false,
                    framesRendered: 0,
                    elapsedMs: 0,
                    timedOut: false,
                });
                return;
            }

            const startTime = performance.now();
            let frameCount = 0;
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

                const result: EngineAwakenedResult = {
                    passed,
                    framesRendered: frameCount,
                    elapsedMs,
                    timedOut,
                };

                if (this.config.debug) {
                    if (passed) {
                        console.log(
                            `[ENGINE_AWAKENED] ✓ Barrier passed: ${frameCount} frames in ${elapsedMs.toFixed(1)}ms`
                        );
                    } else if (timedOut) {
                        console.warn(
                            `[ENGINE_AWAKENED] ⚠️ Barrier TIMEOUT: only ${frameCount} frames in ${elapsedMs.toFixed(1)}ms`
                        );
                    } else {
                        console.warn(
                            `[ENGINE_AWAKENED] ⚠️ Barrier failed: ${frameCount} frames`
                        );
                    }
                }

                resolve(result);
            };

            // Set timeout failsafe
            timeoutId = setTimeout(() => {
                complete(frameCount >= this.config.minConsecutiveFrames, true);
            }, this.config.maxWaitMs);

            // Monitor render frames
            if (this.config.debug) {
                console.log(
                    `[ENGINE_AWAKENED] Waiting for ${this.config.minConsecutiveFrames} consecutive frames...`
                );
            }

            observer = this.scene.onBeforeRenderObservable.add(() => {
                frameCount++;

                if (this.config.debug && frameCount <= 5) {
                    const elapsed = performance.now() - startTime;
                    console.log(
                        `[ENGINE_AWAKENED] Frame ${frameCount} at +${elapsed.toFixed(1)}ms`
                    );
                }

                // Check if we have enough consecutive frames
                if (frameCount >= this.config.minConsecutiveFrames) {
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
 * @returns Promise that resolves when engine is confirmed awake
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
