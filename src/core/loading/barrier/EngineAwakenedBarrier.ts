/**
 * EngineAwakenedBarrier - Hard Gate for Babylon RAF Warmup
 *
 * ⚠️ CRITICAL: This barrier MUST pass BEFORE READY is declared.
 * This is NOT a cosmetic delay. This is a correctness guarantee.
 *
 * THE BUG:
 * VISUAL_READY / READY were declared 400~530ms BEFORE the first real render frame.
 * DevTools / resize events merely woke the RAF, masking the real issue:
 * premature READY signaling before RAF warmup.
 *
 * SOLUTION:
 * ENGINE_AWAKENED_BARRIER is a HARD GATE that:
 * 1. Actively kicks RAF awake via forced frame cycle
 *    (engine.beginFrame + scene.render + engine.endFrame + RAF chain)
 * 2. Waits for actual onBeforeRender ticks (proves RAF is alive)
 * 3. Requires N consecutive stable frames (proves RAF is stable)
 * 4. HARD FAILS if no frames arrive (never auto-passes on timeout)
 *
 * FORBIDDEN kick mechanisms:
 * - engine.resize() — masks the bug, doesn't fix it
 * - DevTools / visibility API — external stimulus, not self-contained
 * - camera manipulation / attachControl — UX side effect
 * - User input events — not available during loading
 *
 * NEW FLOW (required):
 *   VISUAL_READY → ENGINE_AWAKENED → READY → UX_READY
 *
 * Acceptance Criteria (RenderDesyncProbe-based):
 * - firstBeforeRenderAt exists
 * - (firstBeforeRenderAt - barrierStartAt) <= 50ms
 * - At least minConsecutiveFrames stable frames rendered
 * - No frame gap > maxAllowedFrameGapMs after first stable frame
 */

import * as BABYLON from '@babylonjs/core';

export interface EngineAwakenedConfig {
    /** Minimum consecutive STABLE frames required (default: 3) */
    minConsecutiveFrames?: number;
    /** Maximum allowed frame gap in ms (default: 50) */
    maxAllowedFrameGapMs?: number;
    /** Maximum wait time in ms before HARD FAIL (default: 3000) */
    maxWaitMs?: number;
    /** Enable debug logging */
    debug?: boolean;
    /** Number of RAF kick attempts before giving up (default: 3) */
    maxKickAttempts?: number;
    /** Interval between kick attempts in ms (default: 100) */
    kickIntervalMs?: number;
}

export interface EngineAwakenedResult {
    /** Whether the barrier passed successfully */
    passed: boolean;
    /** Number of total frames rendered during barrier */
    framesRendered: number;
    /** Number of consecutive stable frames achieved */
    stableFrameCount: number;
    /** Time taken from barrier start in ms */
    elapsedMs: number;
    /** Whether it timed out (HARD FAIL) */
    timedOut: boolean;
    /** Average frame interval of stable frames in ms */
    avgFrameIntervalMs: number;
    /** Max frame interval observed in ms */
    maxFrameIntervalMs: number;
    /** Time from barrier start to first onBeforeRender tick */
    firstFrameDelayMs: number;
    /** Number of RAF kicks required to wake engine */
    kicksRequired: number;
}

/**
 * EngineAwakenedBarrier - Wait for STABLE render loop activity
 *
 * This is a HARD GATE. Timeout = FAIL, not auto-pass.
 * The only way to pass is actual stable frame rendering.
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
            maxKickAttempts: config.maxKickAttempts ?? 3,
            kickIntervalMs: config.kickIntervalMs ?? 100,
        };
    }

    /**
     * Wait for render loop to be confirmed STABLY active.
     *
     * Strategy:
     * 1. Kick RAF awake (forced frame cycle + RAF chain)
     * 2. Wait for first onBeforeRender (proves RAF is alive)
     * 3. Count consecutive stable frames (proves RAF is stable)
     * 4. HARD FAIL if no frames arrive within timeout
     */
    async wait(): Promise<EngineAwakenedResult> {
        if (this.disposed) {
            return this.createFailResult(0, 'disposed');
        }

        const startTime = performance.now();

        if (this.config.debug) {
            console.log(
                `[ENGINE_AWAKENED] Starting barrier: require ${this.config.minConsecutiveFrames} ` +
                `consecutive frames with dt < ${this.config.maxAllowedFrameGapMs}ms`
            );
        }

        // Phase 1: Kick RAF awake
        const kicksRequired = await this.kickRAFAwake(startTime);

        if (this.disposed) return this.createFailResult(0, 'disposed during kick');

        // Phase 2: Wait for stable frames
        const result = await this.waitForStableFrames(startTime, kicksRequired);

        return result;
    }

    /**
     * Phase 1: Actively kick the RAF/render loop awake.
     *
     * WHY THIS EXISTS:
     * Babylon's runRenderLoop registers a RAF callback, but the browser may
     * not actually schedule it (initial load, heavy GC, background tab).
     * Result: render loop is "registered" but RAF never fires.
     * DevTools opening accidentally wakes RAF — masking the real bug.
     *
     * STRATEGY (no resize, no DevTools, no visibility API):
     * 1. Check if render loop is already ticking naturally
     * 2. If not, force a complete frame cycle:
     *    engine.beginFrame() → scene.render() → engine.endFrame()
     *    This mirrors exactly what Babylon's internal _renderLoop does.
     * 3. Chain RAF callbacks with forced frames to prime the RAF scheduler
     * 4. Verify natural render loop ticks follow
     *
     * FORBIDDEN: engine.resize(), camera manipulation, visibility API,
     *            DevTools, user input events
     *
     * Returns: number of kicks required (0 if already awake)
     */
    private async kickRAFAwake(startTime: number): Promise<number> {
        const engine = this.scene.getEngine();
        let kickCount = 0;
        let rafAlive = false;

        for (let attempt = 0; attempt < this.config.maxKickAttempts; attempt++) {
            if (this.disposed) break;

            // Check if RAF is already alive (natural render loop frames arriving)
            const framesBefore = await this.countFramesInWindow(16);
            if (framesBefore > 0) {
                if (this.config.debug) {
                    console.log(`[ENGINE_AWAKENED] RAF already alive (detected ${framesBefore} natural frames)`);
                }
                rafAlive = true;
                break;
            }

            // Kick attempt
            kickCount++;
            if (this.config.debug) {
                console.log(`[ENGINE_AWAKENED] RAF kick attempt ${kickCount}/${this.config.maxKickAttempts}`);
            }

            // === KICK STRATEGY: Forced Frame Cycle ===
            // This mirrors Babylon's internal _renderLoop behavior:
            //   engine.beginFrame() → scene.render() → engine.endFrame()
            // Forcing this cycle primes the GPU pipeline and triggers observers,
            // which can re-engage the RAF scheduler.

            try {
                // Step 1: Force a complete Babylon frame cycle (synchronous)
                // beginFrame() prepares GPU timing, endFrame() presents the frame
                engine.beginFrame();
                this.scene.render();
                engine.endFrame();

                if (this.config.debug) {
                    console.log(`[ENGINE_AWAKENED] Kick ${kickCount}: forced frame cycle complete`);
                }
            } catch (e) {
                // scene may not be fully ready — this is non-fatal
                if (this.config.debug) {
                    console.warn(`[ENGINE_AWAKENED] Kick ${kickCount}: forced frame threw:`, e);
                }
            }

            // Step 2: Chain direct RAF callbacks with forced renders
            // This re-enters the browser RAF scheduler, proving it's alive.
            // Each RAF tick forces another frame, building momentum.
            await this.rafChainWithRender(2);

            // Step 3: Wait and check if natural render loop frames follow
            // After our forced kicks, the engine's registered render loop
            // should now be getting RAF callbacks naturally.
            const framesAfter = await this.countFramesInWindow(this.config.kickIntervalMs);
            if (framesAfter > 0) {
                if (this.config.debug) {
                    console.log(
                        `[ENGINE_AWAKENED] RAF woke up after kick ${kickCount}: ` +
                        `${framesAfter} frames in ${this.config.kickIntervalMs}ms window`
                    );
                }
                rafAlive = true;
                break;
            }

            // Check timeout
            if (performance.now() - startTime > this.config.maxWaitMs) {
                break;
            }
        }

        if (!rafAlive && this.config.debug) {
            console.warn(`[ENGINE_AWAKENED] ⚠️ RAF NOT responding after ${kickCount} kicks`);
        }

        return kickCount;
    }

    /**
     * Chain N requestAnimationFrame callbacks, each forcing a frame render.
     *
     * Purpose: Prime the browser's RAF scheduler by executing actual work
     * inside RAF callbacks. This teaches the browser that this tab needs
     * rendering priority, re-engaging the render loop.
     *
     * Each RAF tick does: engine.beginFrame() → scene.render() → engine.endFrame()
     * This is the minimum complete frame Babylon needs.
     */
    private rafChainWithRender(count: number): Promise<void> {
        return new Promise((resolve) => {
            let remaining = count;
            const engine = this.scene.getEngine();

            const tick = () => {
                if (remaining <= 0 || this.disposed) {
                    resolve();
                    return;
                }

                remaining--;

                try {
                    engine.beginFrame();
                    this.scene.render();
                    engine.endFrame();
                } catch {
                    // Non-fatal: scene may still be initializing
                }

                requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
        });
    }

    /**
     * Count how many onBeforeRender frames occur in a time window.
     * Used to detect if the render loop is already active.
     */
    private countFramesInWindow(windowMs: number): Promise<number> {
        return new Promise((resolve) => {
            let count = 0;
            const observer = this.scene.onBeforeRenderObservable.add(() => {
                count++;
            });

            setTimeout(() => {
                this.scene.onBeforeRenderObservable.remove(observer);
                resolve(count);
            }, windowMs);
        });
    }

    /**
     * Phase 2: Wait for N consecutive stable frames.
     *
     * A frame is "stable" if its dt (time since last frame) is < maxAllowedFrameGapMs.
     * The first frame is allowed to be slow (cold start), but subsequent frames must be stable.
     *
     * HARD GATE: If timeout expires with insufficient stable frames, this FAILS.
     * There is NO auto-pass. The caller must handle failure.
     */
    private waitForStableFrames(
        startTime: number,
        kicksRequired: number
    ): Promise<EngineAwakenedResult> {
        return new Promise((resolve) => {
            if (this.disposed) {
                resolve(this.createFailResult(kicksRequired, 'disposed'));
                return;
            }

            let totalFrameCount = 0;
            let consecutiveStableFrames = 0;
            let lastFrameTime = performance.now();
            let firstFrameTime: number | null = null;
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

                const firstFrameDelayMs = firstFrameTime !== null
                    ? firstFrameTime - startTime
                    : -1;

                const result: EngineAwakenedResult = {
                    passed,
                    framesRendered: totalFrameCount,
                    stableFrameCount: consecutiveStableFrames,
                    elapsedMs,
                    timedOut,
                    avgFrameIntervalMs,
                    maxFrameIntervalMs: maxFrameInterval,
                    firstFrameDelayMs,
                    kicksRequired,
                };

                if (this.config.debug) {
                    if (passed) {
                        console.log(
                            `[ENGINE_AWAKENED] ✓ PASSED: ${consecutiveStableFrames} stable frames, ` +
                            `avg dt=${avgFrameIntervalMs.toFixed(1)}ms, ` +
                            `first frame delay=${firstFrameDelayMs.toFixed(1)}ms, ` +
                            `kicks=${kicksRequired}, elapsed=${elapsedMs.toFixed(1)}ms`
                        );
                    } else {
                        console.error(
                            `[ENGINE_AWAKENED] ✗ HARD FAIL: ${totalFrameCount} total frames, ` +
                            `${consecutiveStableFrames} stable, ` +
                            `maxDt=${maxFrameInterval.toFixed(1)}ms, ` +
                            `timedOut=${timedOut}, elapsed=${elapsedMs.toFixed(1)}ms`
                        );
                    }
                }

                resolve(result);
            };

            // HARD timeout — this is a FAIL, not auto-pass
            const remainingMs = Math.max(0, this.config.maxWaitMs - (performance.now() - startTime));
            timeoutId = setTimeout(() => {
                // HARD GATE: timeout = FAIL
                // Only pass if we actually achieved the required stable frame count
                if (consecutiveStableFrames >= this.config.minConsecutiveFrames) {
                    complete(true, false);
                } else {
                    complete(false, true);
                }
            }, remainingMs);

            // Monitor render frames via onBeforeRender
            observer = this.scene.onBeforeRenderObservable.add(() => {
                const now = performance.now();
                const frameInterval = now - lastFrameTime;
                lastFrameTime = now;

                totalFrameCount++;

                // Record first frame timing
                if (totalFrameCount === 1) {
                    firstFrameTime = now;
                    if (this.config.debug) {
                        const delayFromStart = now - startTime;
                        console.log(
                            `[ENGINE_AWAKENED] First onBeforeRender tick: ` +
                            `delay=${delayFromStart.toFixed(1)}ms from barrier start`
                        );
                    }
                    // First frame is allowed to be slow (cold start)
                    // Don't count it toward stability, just record it
                    return;
                }

                // Track max interval
                maxFrameInterval = Math.max(maxFrameInterval, frameInterval);

                // Check if this frame interval is stable
                const isStable = frameInterval < this.config.maxAllowedFrameGapMs;

                if (isStable) {
                    consecutiveStableFrames++;
                    stableFrameIntervals.push(frameInterval);

                    if (this.config.debug && consecutiveStableFrames <= this.config.minConsecutiveFrames) {
                        console.log(
                            `[ENGINE_AWAKENED] Frame ${totalFrameCount}: ` +
                            `dt=${frameInterval.toFixed(1)}ms ✓ stable ` +
                            `(${consecutiveStableFrames}/${this.config.minConsecutiveFrames})`
                        );
                    }
                } else {
                    // Unstable frame — reset consecutive counter
                    if (this.config.debug) {
                        console.warn(
                            `[ENGINE_AWAKENED] Frame ${totalFrameCount}: ` +
                            `dt=${frameInterval.toFixed(1)}ms ⚠️ SPIKE — resetting counter`
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
     * Create a failure result (for early exits)
     */
    private createFailResult(kicksRequired: number, reason: string): EngineAwakenedResult {
        if (this.config.debug) {
            console.error(`[ENGINE_AWAKENED] ✗ FAIL: ${reason}`);
        }
        return {
            passed: false,
            framesRendered: 0,
            stableFrameCount: 0,
            elapsedMs: 0,
            timedOut: false,
            avgFrameIntervalMs: 0,
            maxFrameIntervalMs: 0,
            firstFrameDelayMs: -1,
            kicksRequired,
        };
    }

    dispose(): void {
        this.disposed = true;
    }
}

/**
 * Utility function for simple usage.
 *
 * IMPORTANT: This is a HARD GATE. If result.passed === false,
 * the caller MUST NOT proceed to READY state.
 *
 * @param scene - Babylon scene
 * @param options - Configuration options
 * @returns Promise that resolves when engine is confirmed STABLY awake (or FAILS)
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
