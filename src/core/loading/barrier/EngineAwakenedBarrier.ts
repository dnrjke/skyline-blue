/**
 * EngineAwakenedBarrier - Progressive Stabilization for Babylon RAF
 *
 * [Phase 2.7 - Option B: Progressive Burst]
 *
 * DESIGN PHILOSOPHY:
 * - Babylon is not the enemy. The 100-150ms internal blocking is a "one-time cost".
 * - Our job is to NOT re-trigger the throttle after loading completes.
 * - Chromium detects PATTERNS, not single spikes. Burst rendering = danger signal.
 *
 * PREVIOUS PROBLEM:
 * The old "Wake-Up Burst" (5 frames × 3 retries) created a pattern of forced
 * rendering that Chromium interpreted as a heavy tab, triggering RAF_FREQUENCY_LOCK.
 *
 * NEW STRATEGY: Progressive Stabilization
 * 1. NO forced frames. Zero. None.
 * 2. Passive observation of natural RAF only.
 * 3. Wait for genuinely stable frames (dt < 25ms).
 * 4. If RAF is slow, just wait - don't try to "wake" it.
 * 5. Trust the browser scheduler to recover naturally.
 *
 * KEY INSIGHT:
 * A single forced frame proves "GPU can render" but a burst convinces
 * Chromium that this tab is computation-heavy. We want the opposite:
 * appear as a light, well-behaved animation tab.
 *
 * FLOW:
 *   LOADING_COMPLETE → [Progressive Stabilization] → READY → UX_READY
 *
 * @see docs/phase-2.7-raf-protection.md
 */

import * as BABYLON from '@babylonjs/core';
import { RAFHealthStatus, getGlobalRAFHealthGuard } from '../executor/RAFHealthGuard';
import { ThrottleBreaker, createThrottleBreaker } from './ThrottleBreaker';

// Re-export for backward compatibility
export { RAFHealthStatus };

/**
 * Progressive stabilization configuration.
 */
export interface ProgressiveStabilizationConfig {
    /** Minimum consecutive stable frames required (default: 10) */
    minStableFrames?: number;

    /** Maximum allowed frame delta for "stable" classification (default: 25ms) */
    stableThresholdMs?: number;

    /** Maximum allowed frame delta before considering frame as "spike" (default: 50ms) */
    spikeThresholdMs?: number;

    /** Maximum wait time before graceful pass (default: 5000ms) */
    maxWaitMs?: number;

    /** Minimum frames for graceful fallback (default: 30) */
    minFramesForGraceful?: number;

    /** Enable debug logging */
    debug?: boolean;

    /** Throttle detection window size (default: 10) */
    throttleDetectionWindow?: number;

    /** Throttle interval range [min, max] in ms (default: [95, 115]) */
    throttleIntervalRange?: [number, number];

    /** Maximum stdDev for throttle-stable detection (default: 5ms) */
    throttleStdDevThreshold?: number;

    /** Enable active throttle breaking (default: true) */
    enableThrottleBreaker?: boolean;

    /** Maximum throttle breaker attempts (default: 3) */
    throttleBreakerMaxAttempts?: number;
}

/**
 * Stabilization result.
 */
export interface ProgressiveStabilizationResult {
    /** Whether stabilization passed */
    passed: boolean;

    /** Total frames observed */
    framesObserved: number;

    /** Consecutive stable frames achieved */
    stableFrameCount: number;

    /** Time elapsed in ms */
    elapsedMs: number;

    /** Average frame delta of stable frames */
    avgDeltaMs: number;

    /** Maximum frame delta observed */
    maxDeltaMs: number;

    /** Final RAF health status */
    healthStatus: RAFHealthStatus;

    /** Whether passed via graceful fallback */
    graceful: boolean;

    /** Whether throttle-stable pattern was detected */
    throttleStable: boolean;

    /** Detected throttle interval (if throttle-stable) */
    throttleIntervalMs?: number;
}

/**
 * ThrottleLockDetector - Detects browser RAF throttling patterns.
 *
 * When a browser throttles RAF to a fixed cadence (e.g., 10fps = 100ms),
 * frames arrive at consistent intervals. This is NOT instability -
 * it's browser scheduling behavior we must recognize and accept.
 */
class ThrottleLockDetector {
    private intervals: number[] = [];
    private readonly windowSize: number;
    private readonly stdDevThreshold: number;
    private readonly intervalRange: [number, number];

    constructor(
        windowSize: number = 10,
        stdDevThreshold: number = 5,
        intervalRange: [number, number] = [95, 115]
    ) {
        this.windowSize = windowSize;
        this.stdDevThreshold = stdDevThreshold;
        this.intervalRange = intervalRange;
    }

    addInterval(intervalMs: number): void {
        this.intervals.push(intervalMs);
        if (this.intervals.length > this.windowSize) {
            this.intervals.shift();
        }
    }

    isThrottleStable(): boolean {
        if (this.intervals.length < this.windowSize) {
            return false;
        }

        const [minRange, maxRange] = this.intervalRange;
        const allInRange = this.intervals.every(
            (dt) => dt >= minRange && dt <= maxRange
        );
        if (!allInRange) {
            return false;
        }

        return this.getStdDev() <= this.stdDevThreshold;
    }

    getMeanInterval(): number {
        if (this.intervals.length === 0) return 0;
        return this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    }

    getStdDev(): number {
        if (this.intervals.length < 2) return 0;
        const mean = this.getMeanInterval();
        const squaredDiffs = this.intervals.map((v) => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / this.intervals.length;
        return Math.sqrt(variance);
    }

    reset(): void {
        this.intervals = [];
    }
}

/**
 * EngineAwakenedBarrier - Progressive Stabilization Implementation
 *
 * NO BURST RENDERING. Passive observation only.
 * When throttle is detected, uses ThrottleBreaker to actively recover.
 */
export class EngineAwakenedBarrier {
    private scene: BABYLON.Scene;
    private engine: BABYLON.Engine;
    private config: Required<ProgressiveStabilizationConfig> & {
        enableThrottleBreaker: boolean;
        throttleBreakerMaxAttempts: number;
    };
    private disposed: boolean = false;
    private throttleBreaker: ThrottleBreaker | null = null;

    constructor(scene: BABYLON.Scene, config: ProgressiveStabilizationConfig = {}) {
        this.scene = scene;
        this.engine = scene.getEngine() as BABYLON.Engine;
        this.config = {
            minStableFrames: config.minStableFrames ?? 10,
            stableThresholdMs: config.stableThresholdMs ?? 25,
            spikeThresholdMs: config.spikeThresholdMs ?? 50,
            maxWaitMs: config.maxWaitMs ?? 5000,
            minFramesForGraceful: config.minFramesForGraceful ?? 30,
            debug: config.debug ?? true,
            throttleDetectionWindow: config.throttleDetectionWindow ?? 10,
            throttleIntervalRange: config.throttleIntervalRange ?? [95, 115],
            throttleStdDevThreshold: config.throttleStdDevThreshold ?? 5,
            enableThrottleBreaker: config.enableThrottleBreaker ?? true,
            throttleBreakerMaxAttempts: config.throttleBreakerMaxAttempts ?? 3,
        };
    }

    /**
     * Wait for RAF to stabilize naturally.
     *
     * NO forced frames. NO burst rendering. Just passive observation.
     * Trust the browser scheduler to settle after loading completes.
     */
    async wait(): Promise<ProgressiveStabilizationResult> {
        if (this.disposed) {
            return this.createFailResult('disposed');
        }

        const startTime = performance.now();

        if (this.config.debug) {
            console.log(
                `[ENGINE_AWAKENED] Starting progressive stabilization: ` +
                `require ${this.config.minStableFrames} consecutive frames ` +
                `with dt < ${this.config.stableThresholdMs}ms`
            );
        }

        return this.waitForNaturalStability(startTime);
    }

    /**
     * Passive observation of natural RAF frames.
     *
     * RULES:
     * - NO forced rendering (engine.beginFrame/endFrame)
     * - NO scene.render() calls
     * - Only observe via onBeforeRenderObservable
     * - Count stable frames (dt < stableThresholdMs)
     * - If spike detected (dt >= spikeThresholdMs), reset counter
     * - Pass when minStableFrames consecutive stable frames achieved
     */
    private waitForNaturalStability(startTime: number): Promise<ProgressiveStabilizationResult> {
        return new Promise((resolve) => {
            if (this.disposed) {
                resolve(this.createFailResult('disposed'));
                return;
            }

            let totalFrameCount = 0;
            let consecutiveStableFrames = 0;
            let lastFrameTime = performance.now();
            let stableDeltas: number[] = [];
            let maxDelta = 0;
            let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            let resolved = false;
            let currentHealth = RAFHealthStatus.HEALTHY;

            // Throttle detection
            const throttleDetector = new ThrottleLockDetector(
                this.config.throttleDetectionWindow,
                this.config.throttleStdDevThreshold,
                this.config.throttleIntervalRange
            );
            let throttleResult: { intervalMs: number; stdDevMs: number } | null = null;

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

            const complete = (
                passed: boolean,
                graceful: boolean = false,
                throttleStable: boolean = false
            ) => {
                if (resolved) return;
                resolved = true;
                cleanup();

                const elapsedMs = performance.now() - startTime;
                const avgDeltaMs = stableDeltas.length > 0
                    ? stableDeltas.reduce((a, b) => a + b, 0) / stableDeltas.length
                    : (throttleResult?.intervalMs ?? 0);

                const result: ProgressiveStabilizationResult = {
                    passed,
                    framesObserved: totalFrameCount,
                    stableFrameCount: consecutiveStableFrames,
                    elapsedMs,
                    avgDeltaMs,
                    maxDeltaMs: maxDelta,
                    healthStatus: currentHealth,
                    graceful,
                    throttleStable,
                    throttleIntervalMs: throttleResult?.intervalMs,
                };

                this.logResult(result);
                resolve(result);
            };

            // Timeout handler - graceful pass if enough frames observed
            timeoutId = setTimeout(() => {
                if (totalFrameCount >= this.config.minFramesForGraceful) {
                    // Enough frames observed - pass gracefully
                    console.warn(
                        `[ENGINE_AWAKENED] Graceful pass: ${totalFrameCount} frames ` +
                        `(${consecutiveStableFrames} stable) observed within timeout`
                    );
                    complete(true, true, false);
                } else if (totalFrameCount > 0) {
                    // Some frames but not enough - still pass with warning
                    console.warn(
                        `[ENGINE_AWAKENED] Minimal pass: only ${totalFrameCount} frames ` +
                        `observed (< ${this.config.minFramesForGraceful} ideal)`
                    );
                    complete(true, true, false);
                } else {
                    // Zero frames - actual failure
                    console.error('[ENGINE_AWAKENED] FAIL: Zero frames observed within timeout');
                    complete(false, false, false);
                }
            }, this.config.maxWaitMs);

            // Passive observation - NO forced rendering
            observer = this.scene.onBeforeRenderObservable.add(() => {
                if (resolved) return;

                const now = performance.now();
                const delta = now - lastFrameTime;
                lastFrameTime = now;
                totalFrameCount++;

                // Update max delta
                maxDelta = Math.max(maxDelta, delta);

                // Update health status
                currentHealth = this.classifyHealth(delta);

                // Feed throttle detector
                throttleDetector.addInterval(delta);

                // Check for throttle-stable pattern
                if (throttleDetector.isThrottleStable()) {
                    throttleResult = {
                        intervalMs: throttleDetector.getMeanInterval(),
                        stdDevMs: throttleDetector.getStdDev(),
                    };
                    currentHealth = RAFHealthStatus.LOCKED;

                    if (this.config.debug) {
                        console.warn(
                            `[ENGINE_AWAKENED] ⚠️ Throttle-stable detected: ` +
                            `~${throttleResult.intervalMs.toFixed(1)}ms interval ` +
                            `(stdDev=${throttleResult.stdDevMs.toFixed(2)}ms) - attempting recovery...`
                        );
                    }

                    // Phase 2.7: Try to break the throttle instead of accepting it
                    if (this.config.enableThrottleBreaker) {
                        // Temporarily stop observer while we break throttle
                        if (observer) {
                            this.scene.onBeforeRenderObservable.remove(observer);
                            observer = null;
                        }

                        // Create throttle breaker and attempt recovery
                        this.throttleBreaker = createThrottleBreaker(
                            this.engine,
                            this.scene,
                            {
                                maxAttempts: this.config.throttleBreakerMaxAttempts,
                                targetIntervalMs: this.config.stableThresholdMs,
                                debug: this.config.debug,
                            }
                        );

                        this.throttleBreaker.breakThrottle().then((breakResult) => {
                            if (resolved) return;

                            if (breakResult.success) {
                                if (this.config.debug) {
                                    console.log(
                                        `[ENGINE_AWAKENED] ✓ Throttle broken! ` +
                                        `Final interval: ${breakResult.finalIntervalMs.toFixed(1)}ms`
                                    );
                                }
                                // Throttle broken - now wait for stable frames
                                this.waitForPostBreakStability(startTime, throttleResult).then(resolve);
                            } else {
                                // Failed to break throttle - pass with warning
                                console.warn(
                                    `[ENGINE_AWAKENED] ⚠️ Could not break throttle after ` +
                                    `${breakResult.attempts} attempts. Proceeding with throttled state.`
                                );
                                complete(true, false, true);
                            }
                        });
                        return;
                    }

                    // Throttle breaker disabled - pass immediately (legacy behavior)
                    complete(true, false, true);
                    return;
                }

                // Skip first frame (cold start)
                if (totalFrameCount === 1) {
                    if (this.config.debug) {
                        console.log(
                            `[ENGINE_AWAKENED] First natural frame: dt=${delta.toFixed(1)}ms (skipped)`
                        );
                    }
                    return;
                }

                // Classify frame
                if (delta < this.config.stableThresholdMs) {
                    // Stable frame
                    consecutiveStableFrames++;
                    stableDeltas.push(delta);

                    if (this.config.debug && consecutiveStableFrames <= this.config.minStableFrames) {
                        console.log(
                            `[ENGINE_AWAKENED] Frame ${totalFrameCount}: ` +
                            `dt=${delta.toFixed(1)}ms ✓ STABLE ` +
                            `(${consecutiveStableFrames}/${this.config.minStableFrames})`
                        );
                    }
                } else if (delta >= this.config.spikeThresholdMs) {
                    // Spike - reset counter
                    if (this.config.debug) {
                        console.warn(
                            `[ENGINE_AWAKENED] Frame ${totalFrameCount}: ` +
                            `dt=${delta.toFixed(1)}ms ⚠️ SPIKE - resetting counter`
                        );
                    }
                    consecutiveStableFrames = 0;
                    stableDeltas = [];
                } else {
                    // Degraded but not spike - count but don't log excessively
                    consecutiveStableFrames++;
                    stableDeltas.push(delta);
                }

                // Check pass condition
                if (consecutiveStableFrames >= this.config.minStableFrames) {
                    complete(true, false, false);
                }
            });
        });
    }

    /**
     * Classify RAF health based on delta.
     */
    private classifyHealth(deltaMs: number): RAFHealthStatus {
        if (deltaMs < this.config.stableThresholdMs) {
            return RAFHealthStatus.HEALTHY;
        } else if (deltaMs < this.config.spikeThresholdMs) {
            return RAFHealthStatus.DEGRADED;
        } else {
            return RAFHealthStatus.CRITICAL;
        }
    }

    /**
     * Wait for stable frames after throttle is broken.
     *
     * This is called after ThrottleBreaker successfully breaks the throttle.
     * We need to verify that RAF is now running at normal cadence.
     */
    private waitForPostBreakStability(
        originalStartTime: number,
        throttleResult: { intervalMs: number; stdDevMs: number } | null
    ): Promise<ProgressiveStabilizationResult> {
        return new Promise((resolve) => {
            if (this.disposed) {
                resolve(this.createFailResult('disposed'));
                return;
            }

            let frameCount = 0;
            let consecutiveStableFrames = 0;
            let lastFrameTime = performance.now();
            const stableDeltas: number[] = [];
            let maxDelta = 0;
            let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
            let resolved = false;
            const requiredFrames = this.config.minStableFrames;

            if (this.config.debug) {
                console.log(
                    `[ENGINE_AWAKENED] Post-break stability check: ` +
                    `waiting for ${requiredFrames} stable frames...`
                );
            }

            const complete = (success: boolean) => {
                if (resolved) return;
                resolved = true;

                if (observer) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    observer = null;
                }

                const elapsedMs = performance.now() - originalStartTime;
                const avgDelta = stableDeltas.length > 0
                    ? stableDeltas.reduce((a, b) => a + b, 0) / stableDeltas.length
                    : (throttleResult?.intervalMs ?? 0);

                const result: ProgressiveStabilizationResult = {
                    passed: success,
                    framesObserved: frameCount,
                    stableFrameCount: consecutiveStableFrames,
                    elapsedMs,
                    avgDeltaMs: avgDelta,
                    maxDeltaMs: maxDelta,
                    healthStatus: success ? RAFHealthStatus.HEALTHY : RAFHealthStatus.LOCKED,
                    graceful: false,
                    throttleStable: !success,
                    throttleIntervalMs: success ? undefined : throttleResult?.intervalMs,
                };

                this.logResult(result);
                resolve(result);
            };

            // Timeout - if we can't get stable frames in 2 seconds, give up
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    if (this.config.debug) {
                        console.warn(
                            `[ENGINE_AWAKENED] Post-break stability timeout. ` +
                            `Got ${consecutiveStableFrames}/${requiredFrames} stable frames.`
                        );
                    }
                    complete(consecutiveStableFrames >= requiredFrames / 2);
                }
            }, 2000);

            observer = this.scene.onBeforeRenderObservable.add(() => {
                if (resolved) return;

                const now = performance.now();
                const delta = now - lastFrameTime;
                lastFrameTime = now;
                frameCount++;

                // Skip first frame
                if (frameCount === 1) return;

                maxDelta = Math.max(maxDelta, delta);

                if (delta < this.config.stableThresholdMs) {
                    consecutiveStableFrames++;
                    stableDeltas.push(delta);

                    if (this.config.debug) {
                        console.log(
                            `[ENGINE_AWAKENED] Post-break frame ${frameCount}: ` +
                            `dt=${delta.toFixed(1)}ms ✓ (${consecutiveStableFrames}/${requiredFrames})`
                        );
                    }

                    if (consecutiveStableFrames >= requiredFrames) {
                        clearTimeout(timeoutId);
                        complete(true);
                    }
                } else if (delta >= this.config.spikeThresholdMs) {
                    // Still seeing spikes - throttle break may have failed
                    if (this.config.debug) {
                        console.warn(
                            `[ENGINE_AWAKENED] Post-break spike: ` +
                            `dt=${delta.toFixed(1)}ms - resetting counter`
                        );
                    }
                    consecutiveStableFrames = 0;
                }
            });
        });
    }

    /**
     * Log stabilization result.
     */
    private logResult(result: ProgressiveStabilizationResult): void {
        if (!this.config.debug) return;

        const statusIcon = result.passed ? '✓' : '✗';
        const passType = result.throttleStable
            ? 'THROTTLE-STABLE'
            : result.graceful
                ? 'GRACEFUL'
                : 'STABLE';

        if (result.passed) {
            console.log(
                `[ENGINE_AWAKENED] ${statusIcon} ${passType} PASS: ` +
                `${result.framesObserved} frames, ` +
                `${result.stableFrameCount} consecutive stable, ` +
                `avg dt=${result.avgDeltaMs.toFixed(1)}ms, ` +
                `max dt=${result.maxDeltaMs.toFixed(1)}ms, ` +
                `elapsed=${result.elapsedMs.toFixed(1)}ms, ` +
                `health=${result.healthStatus}` +
                (result.throttleStable ? ` (throttle @ ${result.throttleIntervalMs?.toFixed(1)}ms)` : '')
            );
        } else {
            console.error(
                `[ENGINE_AWAKENED] ${statusIcon} FAIL: ` +
                `${result.framesObserved} frames, ` +
                `${result.stableFrameCount} consecutive stable, ` +
                `elapsed=${result.elapsedMs.toFixed(1)}ms, ` +
                `health=${result.healthStatus}`
            );
        }
    }

    /**
     * Create a failure result.
     */
    private createFailResult(reason: string): ProgressiveStabilizationResult {
        if (this.config.debug) {
            console.error(`[ENGINE_AWAKENED] Early fail: ${reason}`);
        }
        return {
            passed: false,
            framesObserved: 0,
            stableFrameCount: 0,
            elapsedMs: 0,
            avgDeltaMs: 0,
            maxDeltaMs: 0,
            healthStatus: RAFHealthStatus.CRITICAL,
            graceful: false,
            throttleStable: false,
        };
    }

    dispose(): void {
        this.disposed = true;
        if (this.throttleBreaker) {
            this.throttleBreaker.dispose();
            this.throttleBreaker = null;
        }
    }
}

// ============================================================
// Legacy-compatible exports for existing code
// ============================================================

/**
 * Legacy config interface for backward compatibility.
 */
export interface EngineAwakenedConfig {
    minConsecutiveFrames?: number;
    maxAllowedFrameGapMs?: number;
    maxWaitMs?: number;
    debug?: boolean;
    burstFrameCount?: number;
    maxBurstRetries?: number;
    gracefulFallbackMs?: number;
    minNaturalFramesForGraceful?: number;
    enableThrottleDetection?: boolean;
    throttleDetectionWindow?: number;
    throttleStdDevThresholdMs?: number;
    throttleIntervalRange?: [number, number];
}

/**
 * Legacy result interface for backward compatibility.
 */
export interface EngineAwakenedResult {
    passed: boolean;
    framesRendered: number;
    stableFrameCount: number;
    elapsedMs: number;
    timedOut: boolean;
    avgFrameIntervalMs: number;
    maxFrameIntervalMs: number;
    firstFrameDelayMs: number;
    burstCount: number;
    throttleStable?: boolean;
    throttleIntervalMs?: number;
    throttleStdDevMs?: number;
}

/**
 * Utility function for simple usage.
 *
 * [Phase 2.7] Now uses Progressive Stabilization instead of Burst.
 * NO forced rendering. Passive observation only.
 *
 * @param scene - Babylon scene
 * @param options - Configuration options (legacy format supported)
 * @returns Promise that resolves when RAF is stable
 */
export async function waitForEngineAwakened(
    scene: BABYLON.Scene,
    options: EngineAwakenedConfig = {}
): Promise<EngineAwakenedResult> {
    // Convert legacy config to new format
    const newConfig: ProgressiveStabilizationConfig = {
        minStableFrames: options.minConsecutiveFrames ?? 10,
        stableThresholdMs: 25, // NEW: Lower threshold for genuine stability
        spikeThresholdMs: options.maxAllowedFrameGapMs ?? 50,
        maxWaitMs: options.maxWaitMs ?? 5000,
        minFramesForGraceful: options.minNaturalFramesForGraceful ?? 30,
        debug: options.debug ?? true,
        throttleDetectionWindow: options.throttleDetectionWindow ?? 10,
        throttleIntervalRange: options.throttleIntervalRange ?? [95, 115],
        throttleStdDevThreshold: options.throttleStdDevThresholdMs ?? 5,
    };

    // Log deprecation if burst settings were provided
    if (options.burstFrameCount || options.maxBurstRetries) {
        console.warn(
            '[ENGINE_AWAKENED] ⚠️ burstFrameCount/maxBurstRetries are DEPRECATED. ' +
            'Phase 2.7 uses Progressive Stabilization (no forced frames).'
        );
    }

    const barrier = new EngineAwakenedBarrier(scene, newConfig);
    const result = await barrier.wait();
    barrier.dispose();

    // Phase 2.7: Notify RAFHealthGuard that ENGINE_AWAKENED is complete
    // This starts the 500ms post-awakening monitoring period
    const globalGuard = getGlobalRAFHealthGuard();
    globalGuard.notifyEngineAwakened();

    // Convert new result to legacy format
    return {
        passed: result.passed,
        framesRendered: result.framesObserved,
        stableFrameCount: result.stableFrameCount,
        elapsedMs: result.elapsedMs,
        timedOut: !result.passed && !result.graceful,
        avgFrameIntervalMs: result.avgDeltaMs,
        maxFrameIntervalMs: result.maxDeltaMs,
        firstFrameDelayMs: 0, // No longer tracked (no burst)
        burstCount: 0, // No burst in new implementation
        throttleStable: result.throttleStable,
        throttleIntervalMs: result.throttleIntervalMs,
        throttleStdDevMs: undefined,
    };
}
