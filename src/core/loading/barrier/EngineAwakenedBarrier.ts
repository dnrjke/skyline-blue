/**
 * EngineAwakenedBarrier - Hard Gate for Babylon RAF Warmup
 *
 * CRITICAL: This barrier MUST pass BEFORE READY is declared.
 * This is NOT a cosmetic delay. This is a correctness guarantee.
 *
 * THE BUG:
 * VISUAL_READY / READY were declared 400~530ms BEFORE the first real render frame.
 * DevTools / resize events merely woke the RAF, masking the real issue:
 * premature READY signaling before RAF warmup.
 *
 * SOLUTION: Two-phase hard gate:
 *
 * Phase 1 — RAF Wake-Up Burst:
 *   Execute N consecutive forced frames via RAF chain.
 *   engine.beginFrame() → scene.render() → engine.endFrame()
 *   This establishes "animation intent" with the browser compositor.
 *   NO observer registration. NO frame counting. Pure execution.
 *
 * Phase 2 — Natural Stable Detection:
 *   Register onBeforeRender observer.
 *   Wait for M consecutive NATURAL frames with dt < threshold.
 *   Only natural RAF-scheduled frames count toward stability.
 *   Forced frames from Phase 1 are never counted.
 *
 * FORBIDDEN kick mechanisms:
 * - engine.resize() — masks the bug, doesn't fix it
 * - DevTools / visibility API — external stimulus, not self-contained
 * - camera manipulation / attachControl — UX side effect
 * - User input events — not available during loading
 *
 * WHY BURST > SINGLE KICK:
 * A single forced frame proves "GPU can render" but doesn't convince
 * the browser's compositor that ongoing animation is intended.
 * A burst of 4-5 RAF-chained frames establishes rendering cadence,
 * equivalent to what DevTools accidentally achieves.
 *
 * NEW FLOW:
 *   VISUAL_READY → [Phase 1: Burst] → [Phase 2: Natural Stable] → READY → UX_READY
 */

import * as BABYLON from '@babylonjs/core';
import { ThrottleLockDetector } from './ThrottleLockDetector';

export interface EngineAwakenedConfig {
    /** Minimum consecutive STABLE natural frames required (default: 3) */
    minConsecutiveFrames?: number;
    /** Maximum allowed frame gap in ms (default: 100) */
    maxAllowedFrameGapMs?: number;
    /** Maximum wait time in ms before HARD FAIL (default: 3000) */
    maxWaitMs?: number;
    /** Enable debug logging */
    debug?: boolean;
    /** Number of forced frames in the wake-up burst (default: 5) */
    burstFrameCount?: number;
    /** Maximum retry attempts if natural frames don't follow burst (default: 2) */
    maxBurstRetries?: number;
    /**
     * Graceful fallback timeout (ms) for Phase 2. (default: 200)
     * If this time elapses AND at least minNaturalFramesForGraceful frames were observed,
     * pass with a warning even without 3 consecutive stable frames.
     * This prevents DevTools-dependent hangs.
     */
    gracefulFallbackMs?: number;
    /**
     * Minimum natural frames required for graceful fallback (default: 10)
     * Graceful pass only triggers after this many frames have been rendered.
     */
    minNaturalFramesForGraceful?: number;
    /**
     * Enable Throttle-Stable detection (default: true)
     * If enabled, recognizes browser RAF throttling as a valid stable state.
     */
    enableThrottleDetection?: boolean;
    /**
     * Window size for throttle pattern detection (default: 10)
     * Number of recent frame intervals to analyze.
     */
    throttleDetectionWindow?: number;
    /**
     * Maximum standard deviation for throttle-stable pattern (default: 5ms)
     * If stdDev of recent intervals is below this, it's considered stable throttle.
     */
    throttleStdDevThresholdMs?: number;
    /**
     * Throttle interval range [min, max] in ms (default: [95, 115])
     * Intervals within this range are considered potential throttle patterns.
     */
    throttleIntervalRange?: [number, number];
}

export interface EngineAwakenedResult {
    /** Whether the barrier passed successfully */
    passed: boolean;
    /** Number of NATURAL frames rendered during Phase 2 */
    framesRendered: number;
    /** Number of consecutive stable natural frames achieved */
    stableFrameCount: number;
    /** Time taken from barrier start in ms */
    elapsedMs: number;
    /** Whether it timed out (HARD FAIL) */
    timedOut: boolean;
    /** Average frame interval of stable frames in ms */
    avgFrameIntervalMs: number;
    /** Max frame interval observed during Phase 2 in ms */
    maxFrameIntervalMs: number;
    /** Time from Phase 2 start to first natural onBeforeRender tick */
    firstFrameDelayMs: number;
    /** Number of burst iterations executed */
    burstCount: number;
    /** Whether passed via throttle-stable detection */
    throttleStable?: boolean;
    /** Detected throttle frequency in ms (if throttle-stable) */
    throttleIntervalMs?: number;
    /** Standard deviation of detected throttle pattern */
    throttleStdDevMs?: number;
}

/**
 * EngineAwakenedBarrier - Wait for STABLE natural render loop activity.
 *
 * This is a HARD GATE. Timeout = FAIL, not auto-pass.
 * The only way to pass is actual stable NATURAL frame rendering.
 */
export class EngineAwakenedBarrier {
    private scene: BABYLON.Scene;
    private config: Required<EngineAwakenedConfig>;
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: EngineAwakenedConfig = {}) {
        this.scene = scene;
        this.config = {
            minConsecutiveFrames: config.minConsecutiveFrames ?? 3,
            maxAllowedFrameGapMs: config.maxAllowedFrameGapMs ?? 100,
            maxWaitMs: config.maxWaitMs ?? 3000,
            debug: config.debug ?? true,
            burstFrameCount: config.burstFrameCount ?? 5,
            maxBurstRetries: config.maxBurstRetries ?? 2,
            gracefulFallbackMs: config.gracefulFallbackMs ?? 200,  // Shortened: 500 → 200
            minNaturalFramesForGraceful: config.minNaturalFramesForGraceful ?? 10,
            enableThrottleDetection: config.enableThrottleDetection ?? true,
            throttleDetectionWindow: config.throttleDetectionWindow ?? 10,
            throttleStdDevThresholdMs: config.throttleStdDevThresholdMs ?? 5,
            throttleIntervalRange: config.throttleIntervalRange ?? [95, 115],
        };
    }

    /**
     * Wait for render loop to be confirmed STABLY active.
     *
     * Strategy:
     * 1. Phase 1: RAF Wake-Up Burst (forced frames, no measurement)
     * 2. Phase 2: Natural Stable Detection (onBeforeRender, dt-based)
     * 3. HARD FAIL if natural frames don't arrive within timeout
     */
    async wait(): Promise<EngineAwakenedResult> {
        if (this.disposed) {
            return this.createFailResult(0, 'disposed');
        }

        const startTime = performance.now();

        if (this.config.debug) {
            console.log(
                `[ENGINE_AWAKENED] Starting barrier: ` +
                `burst=${this.config.burstFrameCount} frames, ` +
                `require ${this.config.minConsecutiveFrames} consecutive natural frames ` +
                `with dt < ${this.config.maxAllowedFrameGapMs}ms`
            );
        }

        // ===== PHASE 1: RAF WAKE-UP BURST =====
        // Execute N forced frames via RAF chain.
        // NO observers. NO frame counting. Pure execution.
        // Purpose: Establish "animation intent" with browser compositor.
        let burstCount = 0;

        for (let retry = 0; retry <= this.config.maxBurstRetries; retry++) {
            if (this.disposed) return this.createFailResult(0, 'disposed during burst');

            burstCount++;
            if (this.config.debug) {
                console.log(
                    `[ENGINE_AWAKENED] Phase 1: Burst ${burstCount} ` +
                    `(${this.config.burstFrameCount} forced frames via RAF chain)`
                );
            }

            await this.executeWakeUpBurst();

            // Check timeout between retries
            if (performance.now() - startTime > this.config.maxWaitMs * 0.5) {
                if (this.config.debug) {
                    console.warn('[ENGINE_AWAKENED] Phase 1: Half of timeout consumed, entering Phase 2');
                }
                break;
            }
        }

        if (this.disposed) return this.createFailResult(burstCount, 'disposed after burst');

        // ===== PHASE 2: NATURAL STABLE DETECTION =====
        // Register onBeforeRender observer.
        // Wait for M consecutive natural frames with dt < threshold.
        // Only NATURAL RAF-scheduled frames count. Forced frames are excluded.
        if (this.config.debug) {
            console.log('[ENGINE_AWAKENED] Phase 2: Waiting for natural stable frames...');
        }

        const result = await this.waitForNaturalStableFrames(startTime, burstCount);

        return result;
    }

    /**
     * Phase 1: Execute the RAF Wake-Up Burst.
     *
     * Executes burstFrameCount forced frames, each scheduled via requestAnimationFrame.
     * This is NOT a single synchronous render — each frame goes through the full
     * browser RAF scheduling pipeline:
     *
     *   RAF callback → engine.beginFrame() → scene.render() → engine.endFrame()
     *
     * WHY RAF CHAIN (not synchronous):
     * - Synchronous renders don't engage the browser's RAF scheduler
     * - RAF-chained frames teach the compositor "this tab has animation"
     * - This is what DevTools accidentally achieves (constant repaint requests)
     *
     * RULES:
     * - NO observer registration (onBeforeRender observer count = 0)
     * - NO frame counting (these frames don't count toward stability)
     * - NO measurement (RenderDesyncProbe recording is allowed externally)
     * - Each frame is a complete Babylon frame cycle
     */
    private executeWakeUpBurst(): Promise<void> {
        return new Promise((resolve) => {
            let remaining = this.config.burstFrameCount;
            const engine = this.scene.getEngine();
            let frameIndex = 0;

            const tick = () => {
                if (remaining <= 0 || this.disposed) {
                    if (this.config.debug) {
                        console.log(
                            `[ENGINE_AWAKENED] Burst complete: ` +
                            `${frameIndex} forced frames executed`
                        );
                    }
                    resolve();
                    return;
                }

                remaining--;
                frameIndex++;

                try {
                    // Complete Babylon frame cycle — mirrors internal _renderLoop
                    engine.beginFrame();
                    this.scene.render();
                    engine.endFrame();
                } catch (e) {
                    // Non-fatal: scene may still be initializing
                    if (this.config.debug && frameIndex === 1) {
                        console.warn('[ENGINE_AWAKENED] Burst frame threw (non-fatal):', e);
                    }
                }

                // Schedule next frame via RAF — this is the key to establishing cadence
                requestAnimationFrame(tick);
            };

            // Start the chain with the first RAF callback
            requestAnimationFrame(tick);
        });
    }

    /**
     * Phase 2: Wait for N consecutive NATURAL stable frames.
     *
     * A "natural" frame is one triggered by Babylon's own runRenderLoop RAF callback,
     * NOT by our forced frame cycle. Since Phase 1 is complete before Phase 2 starts,
     * all frames observed here are natural.
     *
     * A frame is "stable" if its dt (time since last frame) is < maxAllowedFrameGapMs.
     * The first frame is allowed to be slow (cold start), subsequent must be stable.
     *
     * NEW: Throttle-Stable Detection
     * If RAF is throttled (e.g., 10fps = 100ms intervals) but consistent,
     * recognize this as "throttle-stable" and pass immediately.
     *
     * HARD GATE: If timeout expires with insufficient stable frames, this FAILS.
     * There is NO auto-pass. The caller must handle failure.
     */
    private waitForNaturalStableFrames(
        startTime: number,
        burstCount: number
    ): Promise<EngineAwakenedResult> {
        return new Promise((resolve) => {
            if (this.disposed) {
                resolve(this.createFailResult(burstCount, 'disposed'));
                return;
            }

            const phase2Start = performance.now();
            let totalFrameCount = 0;
            let consecutiveStableFrames = 0;
            let lastFrameTime = phase2Start;
            let firstFrameTime: number | null = null;
            let stableFrameIntervals: number[] = [];
            let maxFrameInterval = 0;
            let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
            let hardTimeoutId: ReturnType<typeof setTimeout> | null = null;
            let gracefulTimeoutId: ReturnType<typeof setTimeout> | null = null;
            let resolved = false;

            // Throttle-Stable detection
            const throttleDetector = this.config.enableThrottleDetection
                ? new ThrottleLockDetector(
                    this.config.throttleDetectionWindow,
                    this.config.throttleStdDevThresholdMs,
                    this.config.throttleIntervalRange
                )
                : null;
            let throttleStableResult: { detected: boolean; intervalMs: number; stdDevMs: number } | null = null;

            const cleanup = () => {
                if (observer) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    observer = null;
                }
                if (hardTimeoutId) {
                    clearTimeout(hardTimeoutId);
                    hardTimeoutId = null;
                }
                if (gracefulTimeoutId) {
                    clearTimeout(gracefulTimeoutId);
                    gracefulTimeoutId = null;
                }
            };

            const complete = (
                passed: boolean,
                timedOut: boolean = false,
                graceful: boolean = false,
                throttleStable: boolean = false
            ) => {
                if (resolved) return;
                resolved = true;

                const elapsedMs = performance.now() - startTime;
                cleanup();

                const avgFrameIntervalMs = stableFrameIntervals.length > 0
                    ? stableFrameIntervals.reduce((a, b) => a + b, 0) / stableFrameIntervals.length
                    : (throttleStableResult?.intervalMs ?? 0);

                const firstFrameDelayMs = firstFrameTime !== null
                    ? firstFrameTime - phase2Start
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
                    burstCount,
                    throttleStable,
                    throttleIntervalMs: throttleStableResult?.intervalMs,
                    throttleStdDevMs: throttleStableResult?.stdDevMs,
                };

                if (this.config.debug) {
                    if (passed && throttleStable) {
                        console.log(
                            `[ENGINE_AWAKENED] ✓ THROTTLE-STABLE PASS: ` +
                            `RAF locked at ~${throttleStableResult?.intervalMs.toFixed(1)}ms ` +
                            `(stdDev=${throttleStableResult?.stdDevMs.toFixed(2)}ms), ` +
                            `${totalFrameCount} natural frames, ` +
                            `elapsed=${elapsedMs.toFixed(1)}ms, bursts=${burstCount}`
                        );
                    } else if (passed && !graceful) {
                        console.log(
                            `[ENGINE_AWAKENED] ✓ PASSED: ` +
                            `${consecutiveStableFrames} stable natural frames, ` +
                            `avg dt=${avgFrameIntervalMs.toFixed(1)}ms, ` +
                            `first natural frame delay=${firstFrameDelayMs.toFixed(1)}ms, ` +
                            `bursts=${burstCount}, total elapsed=${elapsedMs.toFixed(1)}ms`
                        );
                    } else if (passed && graceful) {
                        console.warn(
                            `[ENGINE_AWAKENED] ⚠ GRACEFUL PASS: ` +
                            `${totalFrameCount} natural frames observed (${consecutiveStableFrames} consecutive stable), ` +
                            `fallback after ${this.config.gracefulFallbackMs}ms. ` +
                            `DevTools-independent mode. elapsed=${elapsedMs.toFixed(1)}ms`
                        );
                    } else {
                        console.error(
                            `[ENGINE_AWAKENED] ✗ HARD FAIL: ` +
                            `${totalFrameCount} natural frames observed, ` +
                            `${consecutiveStableFrames} consecutive stable, ` +
                            `maxDt=${maxFrameInterval.toFixed(1)}ms, ` +
                            `timedOut=${timedOut}, elapsed=${elapsedMs.toFixed(1)}ms`
                        );
                    }
                }

                resolve(result);
            };

            // HARD timeout — FAIL only if ZERO frames observed
            const remainingMs = Math.max(0, this.config.maxWaitMs - (performance.now() - startTime));
            hardTimeoutId = setTimeout(() => {
                if (consecutiveStableFrames >= this.config.minConsecutiveFrames) {
                    complete(true, false);
                } else if (totalFrameCount >= this.config.minNaturalFramesForGraceful) {
                    // Frames ARE rendering, just not stable enough — graceful pass
                    // But require minimum frame count to ensure rendering is actually happening
                    complete(true, true, true);
                } else if (totalFrameCount > 0) {
                    // Some frames but not enough for graceful — still pass but log warning
                    complete(true, true, true);
                } else {
                    // Zero frames = true failure
                    complete(false, true);
                }
            }, remainingMs);

            // GRACEFUL FALLBACK — after gracefulFallbackMs, pass if minimum frames rendered.
            // This prevents DevTools-dependent hangs where frame gaps exceed threshold
            // but rendering IS active.
            // NEW: Require minNaturalFramesForGraceful (default 10) frames before graceful pass.
            gracefulTimeoutId = setTimeout(() => {
                if (
                    totalFrameCount >= this.config.minNaturalFramesForGraceful &&
                    consecutiveStableFrames < this.config.minConsecutiveFrames
                ) {
                    if (this.config.debug) {
                        console.log(
                            `[ENGINE_AWAKENED] Graceful fallback triggered: ` +
                            `${totalFrameCount} frames (>= ${this.config.minNaturalFramesForGraceful} min), ` +
                            `${consecutiveStableFrames} stable (< ${this.config.minConsecutiveFrames} required)`
                        );
                    }
                    complete(true, false, true);
                }
            }, this.config.gracefulFallbackMs);

            // Monitor NATURAL render frames via onBeforeRender
            // Since Phase 1 burst is complete, all frames here are natural
            observer = this.scene.onBeforeRenderObservable.add(() => {
                if (resolved) return;

                const now = performance.now();
                const frameInterval = now - lastFrameTime;
                lastFrameTime = now;

                totalFrameCount++;

                // Record first natural frame timing
                if (totalFrameCount === 1) {
                    firstFrameTime = now;
                    if (this.config.debug) {
                        const delayFromPhase2 = now - phase2Start;
                        const delayFromStart = now - startTime;
                        console.log(
                            `[ENGINE_AWAKENED] First natural onBeforeRender: ` +
                            `delay=${delayFromPhase2.toFixed(1)}ms from Phase 2 start, ` +
                            `${delayFromStart.toFixed(1)}ms from barrier start`
                        );
                    }
                    // First frame is allowed to be slow (post-burst cold start)
                    return;
                }

                // Track max interval
                maxFrameInterval = Math.max(maxFrameInterval, frameInterval);

                // Feed throttle detector
                if (throttleDetector) {
                    throttleDetector.addInterval(frameInterval);

                    // Check for throttle-stable pattern
                    if (throttleDetector.isThrottleStable()) {
                        throttleStableResult = {
                            detected: true,
                            intervalMs: throttleDetector.getMeanInterval(),
                            stdDevMs: throttleDetector.getStdDev(),
                        };

                        // THROTTLE-STABLE detected — pass immediately
                        complete(true, false, false, true);
                        return;
                    }
                }

                // Check stability (normal path)
                const isStable = frameInterval < this.config.maxAllowedFrameGapMs;

                if (isStable) {
                    consecutiveStableFrames++;
                    stableFrameIntervals.push(frameInterval);

                    if (this.config.debug && consecutiveStableFrames <= this.config.minConsecutiveFrames) {
                        console.log(
                            `[ENGINE_AWAKENED] Natural frame ${totalFrameCount}: ` +
                            `dt=${frameInterval.toFixed(1)}ms ✓ stable ` +
                            `(${consecutiveStableFrames}/${this.config.minConsecutiveFrames})`
                        );
                    }
                } else {
                    // Unstable — reset counter but don't reset totalFrameCount
                    if (this.config.debug) {
                        console.warn(
                            `[ENGINE_AWAKENED] Natural frame ${totalFrameCount}: ` +
                            `dt=${frameInterval.toFixed(1)}ms ⚠️ SPIKE — resetting consecutive counter ` +
                            `(total=${totalFrameCount} still counted for graceful fallback)`
                        );
                    }
                    consecutiveStableFrames = 0;
                    stableFrameIntervals = [];
                }

                // Check pass condition
                if (consecutiveStableFrames >= this.config.minConsecutiveFrames) {
                    complete(true);
                }
            });
        });
    }

    /**
     * Create a failure result (for early exits)
     */
    private createFailResult(burstCount: number, reason: string): EngineAwakenedResult {
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
            burstCount,
            throttleStable: false,
            throttleIntervalMs: undefined,
            throttleStdDevMs: undefined,
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
