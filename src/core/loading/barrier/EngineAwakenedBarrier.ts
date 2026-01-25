/**
 * EngineAwakenedBarrier - Render Loop Confirmation Gate
 *
 * PURPOSE: Confirm the Babylon render loop is actively running BEFORE READY.
 *
 * PROBLEM SOLVED:
 * VISUAL_READY / READY were declared before the first real render frame.
 * This barrier ensures natural RAF-driven rendering is confirmed active.
 *
 * STRATEGY (v2 — Consistency-Based):
 *
 * Phase 1 — RAF Wake-Up Burst:
 *   Execute N forced frames via RAF chain to establish "animation intent".
 *   Minimal: 3 frames, 1 attempt. No retries (wastes time in throttled env).
 *
 * Phase 2 — Dual-Strategy Stability Detection:
 *   A) Fast Path: 3 consecutive frames with dt < maxAllowedFrameGapMs (60fps environments)
 *   B) Consistency Path: 5 frames with consistent cadence (±variance threshold).
 *      This handles Chrome's RAF throttle (~102ms) as "stable but slow".
 *   C) Frame-Count Force Pass: After maxNaturalFrames, always pass.
 *      Guarantees bounded wait time regardless of browser scheduling.
 *
 * WHY CONSISTENCY > ABSOLUTE THRESHOLD:
 * Chrome throttles RAF to ~10fps (102ms) when DevTools is closed / energy saver active.
 * 102ms frames ARE stable rendering — just at reduced rate. The old barrier required
 * dt < 100ms, creating a deadlock (102ms > 100ms threshold, NEVER passes).
 * Consistency detection: if all recent frames have similar intervals (low variance),
 * the render loop is confirmed active regardless of absolute rate.
 *
 * TIMEOUT STRATEGY:
 * setTimeout is ALSO throttled by Chrome in the same conditions as RAF.
 * Therefore we use FRAME-COUNT-BASED limits (immune to timer throttling)
 * as the primary timeout mechanism. setTimeout is only a safety net.
 */

import * as BABYLON from '@babylonjs/core';

export interface EngineAwakenedConfig {
    /** Minimum consecutive FAST frames required for fast-path pass (default: 3) */
    minConsecutiveFrames?: number;
    /** Maximum allowed frame gap for fast-path in ms (default: 100) */
    maxAllowedFrameGapMs?: number;
    /** Maximum wait time in ms — safety-net only (default: 5000) */
    maxWaitMs?: number;
    /** Enable debug logging */
    debug?: boolean;
    /** Number of forced frames in the wake-up burst (default: 3) */
    burstFrameCount?: number;
    /**
     * Consistency window size: number of consecutive intervals to check (default: 5).
     * If these intervals have low variance, render loop is confirmed stable.
     */
    consistencyWindow?: number;
    /**
     * Maximum coefficient of variation (stddev/mean) for consistency pass (default: 0.15).
     * Lower = stricter. 0.15 means intervals must be within ~15% of each other.
     */
    maxCoefficientOfVariation?: number;
    /**
     * Frame-count force pass: after this many natural frames, always pass (default: 15).
     * At 102ms/frame (throttled), this = ~1.5s. At 16ms/frame (normal), this = ~0.25s.
     * This is the PRIMARY timeout mechanism (immune to timer throttling).
     */
    maxNaturalFrames?: number;
}

export interface EngineAwakenedResult {
    /** Whether the barrier passed successfully */
    passed: boolean;
    /** Number of NATURAL frames rendered during Phase 2 */
    framesRendered: number;
    /** Number of consecutive stable natural frames achieved (fast-path) */
    stableFrameCount: number;
    /** Time taken from barrier start in ms */
    elapsedMs: number;
    /** Whether it timed out (HARD FAIL — zero natural frames) */
    timedOut: boolean;
    /** Average frame interval of ALL observed intervals in ms */
    avgFrameIntervalMs: number;
    /** Max frame interval observed during Phase 2 in ms */
    maxFrameIntervalMs: number;
    /** Time from Phase 2 start to first natural onBeforeRender tick */
    firstFrameDelayMs: number;
    /** Number of burst iterations executed */
    burstCount: number;
    /** Which strategy resolved the barrier */
    passStrategy: 'fast' | 'consistency' | 'frame-count' | 'timeout' | 'none';
    /** Whether browser RAF throttling was detected */
    throttleDetected: boolean;
    /** Detected cadence interval in ms (0 if not enough data) */
    detectedCadenceMs: number;
}

/**
 * EngineAwakenedBarrier v2 — Consistency-based render loop confirmation.
 *
 * Guarantees:
 * - In normal 60fps: passes in ~50ms (3 fast frames)
 * - In throttled 10fps: passes in ~1.5s (15 frames at 102ms)
 * - In any environment: never exceeds 5s (safety-net setTimeout)
 * - HARD FAIL only if ZERO natural frames arrive within timeout
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
            maxWaitMs: config.maxWaitMs ?? 5000,
            debug: config.debug ?? true,
            burstFrameCount: config.burstFrameCount ?? 3,
            consistencyWindow: config.consistencyWindow ?? 5,
            maxCoefficientOfVariation: config.maxCoefficientOfVariation ?? 0.15,
            maxNaturalFrames: config.maxNaturalFrames ?? 15,
        };
    }

    async wait(): Promise<EngineAwakenedResult> {
        if (this.disposed) {
            return this.createResult(false, 0, 'none', 'disposed');
        }

        const startTime = performance.now();

        if (this.config.debug) {
            console.log(
                `[ENGINE_AWAKENED] Starting barrier: ` +
                `burst=${this.config.burstFrameCount}, ` +
                `fast-path=${this.config.minConsecutiveFrames} frames < ${this.config.maxAllowedFrameGapMs}ms, ` +
                `consistency=${this.config.consistencyWindow} frames (CV < ${this.config.maxCoefficientOfVariation}), ` +
                `force-pass=${this.config.maxNaturalFrames} frames`
            );
        }

        // ===== PHASE 1: MINIMAL RAF WAKE-UP BURST =====
        if (this.config.debug) {
            console.log(`[ENGINE_AWAKENED] Phase 1: Burst (${this.config.burstFrameCount} forced frames)`);
        }

        await this.executeWakeUpBurst();

        if (this.disposed) return this.createResult(false, 1, 'none', 'disposed after burst');

        // ===== PHASE 2: DUAL-STRATEGY STABILITY DETECTION =====
        if (this.config.debug) {
            console.log('[ENGINE_AWAKENED] Phase 2: Stability detection (fast/consistency/frame-count)...');
        }

        return this.waitForStability(startTime);
    }

    /**
     * Phase 1: Minimal burst — 3 forced frames via RAF chain.
     * Purpose: Signal to browser compositor that this tab has animation intent.
     */
    private executeWakeUpBurst(): Promise<void> {
        return new Promise((resolve) => {
            let remaining = this.config.burstFrameCount;
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
                } catch (_e) {
                    // Non-fatal during initialization
                }
                requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
        });
    }

    /**
     * Phase 2: Dual-strategy stability detection.
     *
     * Three concurrent exit conditions (first to trigger wins):
     * A) Fast Path: minConsecutiveFrames with dt < maxAllowedFrameGapMs
     * B) Consistency: consistencyWindow frames with low coefficient of variation
     * C) Frame-Count: maxNaturalFrames reached (unconditional pass)
     *
     * Safety-net: setTimeout at maxWaitMs (for truly broken environments)
     */
    private waitForStability(startTime: number): Promise<EngineAwakenedResult> {
        return new Promise((resolve) => {
            if (this.disposed) {
                resolve(this.createResult(false, 1, 'none', 'disposed'));
                return;
            }

            const phase2Start = performance.now();
            let totalFrameCount = 0;
            let consecutiveFastFrames = 0;
            let lastFrameTime = phase2Start;
            let firstFrameTime: number | null = null;
            let allIntervals: number[] = [];
            let maxFrameInterval = 0;
            let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
            let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null;
            let resolved = false;

            const cleanup = () => {
                if (observer) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    observer = null;
                }
                if (safetyTimeoutId) {
                    clearTimeout(safetyTimeoutId);
                    safetyTimeoutId = null;
                }
            };

            const complete = (
                passed: boolean,
                strategy: EngineAwakenedResult['passStrategy'],
                timedOut: boolean = false
            ) => {
                if (resolved) return;
                resolved = true;
                cleanup();

                const elapsedMs = performance.now() - startTime;
                const avgInterval = allIntervals.length > 0
                    ? allIntervals.reduce((a, b) => a + b, 0) / allIntervals.length
                    : 0;
                const firstFrameDelayMs = firstFrameTime !== null
                    ? firstFrameTime - phase2Start
                    : -1;
                const throttleDetected = avgInterval > 80;
                const detectedCadenceMs = avgInterval;

                const result: EngineAwakenedResult = {
                    passed,
                    framesRendered: totalFrameCount,
                    stableFrameCount: consecutiveFastFrames,
                    elapsedMs,
                    timedOut,
                    avgFrameIntervalMs: avgInterval,
                    maxFrameIntervalMs: maxFrameInterval,
                    firstFrameDelayMs,
                    burstCount: 1,
                    passStrategy: strategy,
                    throttleDetected,
                    detectedCadenceMs,
                };

                if (this.config.debug) {
                    if (passed) {
                        const strategyLabel = strategy === 'fast' ? '✓ FAST'
                            : strategy === 'consistency' ? '✓ CONSISTENT'
                            : strategy === 'frame-count' ? '⚠ FRAME-COUNT'
                            : '⚠ TIMEOUT';
                        console.log(
                            `[ENGINE_AWAKENED] ${strategyLabel} PASS: ` +
                            `${totalFrameCount} frames, avg dt=${avgInterval.toFixed(1)}ms, ` +
                            `elapsed=${elapsedMs.toFixed(0)}ms` +
                            (throttleDetected ? ` [THROTTLED ~${Math.round(detectedCadenceMs)}ms]` : '')
                        );
                    } else {
                        console.error(
                            `[ENGINE_AWAKENED] ✗ FAIL: ${totalFrameCount} natural frames, ` +
                            `timedOut=${timedOut}, elapsed=${elapsedMs.toFixed(0)}ms`
                        );
                    }
                }

                resolve(result);
            };

            // Safety-net timeout: FAIL only if ZERO frames (truly broken renderer)
            safetyTimeoutId = setTimeout(() => {
                if (totalFrameCount > 0) {
                    complete(true, 'timeout');
                } else {
                    complete(false, 'none', true);
                }
            }, this.config.maxWaitMs);

            // Monitor NATURAL render frames
            observer = this.scene.onBeforeRenderObservable.add(() => {
                if (resolved) return;

                const now = performance.now();
                const frameInterval = now - lastFrameTime;
                lastFrameTime = now;
                totalFrameCount++;

                // First frame: record timing, skip stability check
                if (totalFrameCount === 1) {
                    firstFrameTime = now;
                    if (this.config.debug) {
                        console.log(
                            `[ENGINE_AWAKENED] First natural frame: ` +
                            `delay=${(now - phase2Start).toFixed(1)}ms from Phase 2 start`
                        );
                    }
                    return;
                }

                // Record interval
                allIntervals.push(frameInterval);
                maxFrameInterval = Math.max(maxFrameInterval, frameInterval);

                // === STRATEGY A: Fast Path ===
                if (frameInterval < this.config.maxAllowedFrameGapMs) {
                    consecutiveFastFrames++;
                    if (consecutiveFastFrames >= this.config.minConsecutiveFrames) {
                        complete(true, 'fast');
                        return;
                    }
                } else {
                    consecutiveFastFrames = 0;
                }

                // === STRATEGY B: Consistency Path ===
                if (allIntervals.length >= this.config.consistencyWindow) {
                    const window = allIntervals.slice(-this.config.consistencyWindow);
                    const cv = this.coefficientOfVariation(window);
                    if (cv < this.config.maxCoefficientOfVariation) {
                        complete(true, 'consistency');
                        return;
                    }
                }

                // === STRATEGY C: Frame-Count Force Pass ===
                // totalFrameCount includes the first frame (which has no interval),
                // so we check allIntervals.length (= totalFrameCount - 1)
                if (allIntervals.length >= this.config.maxNaturalFrames) {
                    complete(true, 'frame-count');
                    return;
                }

                // Debug: log every few frames in throttled environment
                if (this.config.debug && totalFrameCount <= 5) {
                    console.log(
                        `[ENGINE_AWAKENED] Frame ${totalFrameCount}: ` +
                        `dt=${frameInterval.toFixed(1)}ms` +
                        (frameInterval < this.config.maxAllowedFrameGapMs
                            ? ` ✓ (${consecutiveFastFrames}/${this.config.minConsecutiveFrames})`
                            : ` [throttled]`)
                    );
                }
            });
        });
    }

    /**
     * Calculate coefficient of variation (stddev / mean) for an array of values.
     * Returns 0 for empty/single-element arrays.
     * Lower CV = more consistent intervals.
     */
    private coefficientOfVariation(values: number[]): number {
        if (values.length < 2) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        if (mean === 0) return 0;
        const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
        return Math.sqrt(variance) / mean;
    }

    private createResult(
        passed: boolean,
        burstCount: number,
        strategy: EngineAwakenedResult['passStrategy'],
        _reason?: string
    ): EngineAwakenedResult {
        return {
            passed,
            framesRendered: 0,
            stableFrameCount: 0,
            elapsedMs: 0,
            timedOut: false,
            avgFrameIntervalMs: 0,
            maxFrameIntervalMs: 0,
            firstFrameDelayMs: -1,
            burstCount,
            passStrategy: strategy,
            throttleDetected: false,
            detectedCadenceMs: 0,
        };
    }

    dispose(): void {
        this.disposed = true;
    }
}

/**
 * Utility function for simple usage.
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
