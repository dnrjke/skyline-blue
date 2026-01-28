/**
 * ThrottleBreaker - Active Throttle Recovery Mechanism
 *
 * [Phase 2.7 - Throttle Recovery]
 *
 * PROBLEM:
 * When Chromium detects heavy main thread work (like GLB parsing), it throttles
 * RAF to ~104ms (9.6fps). This throttle PERSISTS even after the work is done.
 * Passive observation alone cannot break this pattern.
 *
 * DISCOVERY:
 * Chromium resets its throttling decision when certain events occur:
 * - Visibility change (hidden → visible)
 * - Window resize with actual dimension change
 * - Canvas dimension change
 *
 * SOLUTION:
 * When THROTTLE-STABLE is detected (not recovered naturally), we actively
 * trigger an engine resize cycle to force Chromium to reconsider its
 * throttling decision.
 *
 * TECHNIQUE:
 * 1. Slightly change hardware scaling level (0.667 → 0.668)
 * 2. Call engine.resize() to apply the change
 * 3. Wait for a few frames
 * 4. Restore original hardware scaling
 * 5. Wait for RAF cadence to normalize
 *
 * This is a "nudge" to the browser - we're not doing heavy work, just
 * signaling that something changed and it should re-evaluate.
 */

import * as BABYLON from '@babylonjs/core';

/**
 * Throttle breaker configuration
 */
export interface ThrottleBreakerConfig {
    /** Hardware scaling delta for resize trigger (default: 0.001) */
    scalingDelta: number;

    /** Frames to wait after resize (default: 5) */
    settleFrames: number;

    /** Maximum attempts before giving up (default: 3) */
    maxAttempts: number;

    /** Target frame interval in ms (default: 25ms = 40fps minimum) */
    targetIntervalMs: number;

    /** Enable debug logging */
    debug: boolean;
}

const DEFAULT_CONFIG: ThrottleBreakerConfig = {
    scalingDelta: 0.001,
    settleFrames: 5,
    targetIntervalMs: 25,
    maxAttempts: 3,
    debug: true,
};

/**
 * Throttle breaker result
 */
export interface ThrottleBreakerResult {
    /** Whether throttle was successfully broken */
    success: boolean;

    /** Number of attempts made */
    attempts: number;

    /** Final average frame interval */
    finalIntervalMs: number;

    /** Time elapsed in ms */
    elapsedMs: number;

    /** Method used to break throttle */
    method: 'resize' | 'visibility' | 'none';
}

/**
 * ThrottleBreaker - Active throttle recovery
 */
export class ThrottleBreaker {
    private engine: BABYLON.Engine;
    private scene: BABYLON.Scene;
    private config: ThrottleBreakerConfig;
    private originalScaling: number = 1;

    constructor(
        engine: BABYLON.Engine,
        scene: BABYLON.Scene,
        config: Partial<ThrottleBreakerConfig> = {}
    ) {
        this.engine = engine;
        this.scene = scene;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Attempt to break the RAF throttle
     *
     * Call this when THROTTLE-STABLE is detected and natural recovery
     * is not happening.
     */
    async breakThrottle(): Promise<ThrottleBreakerResult> {
        const startTime = performance.now();
        let attempts = 0;

        if (this.config.debug) {
            console.log('[ThrottleBreaker] Starting throttle break attempt...');
        }

        // Store original scaling
        this.originalScaling = this.engine.getHardwareScalingLevel();

        // Try resize method first
        while (attempts < this.config.maxAttempts) {
            attempts++;

            if (this.config.debug) {
                console.log(`[ThrottleBreaker] Attempt ${attempts}/${this.config.maxAttempts}`);
            }

            // Apply scaling nudge
            const success = await this.tryResizeNudge();

            if (success) {
                const elapsed = performance.now() - startTime;
                const avgInterval = await this.measureCurrentInterval();

                if (this.config.debug) {
                    console.log(
                        `[ThrottleBreaker] ✓ SUCCESS after ${attempts} attempts, ` +
                        `${elapsed.toFixed(0)}ms, final interval: ${avgInterval.toFixed(1)}ms`
                    );
                }

                return {
                    success: true,
                    attempts,
                    finalIntervalMs: avgInterval,
                    elapsedMs: elapsed,
                    method: 'resize',
                };
            }

            // Brief pause between attempts
            await this.waitFrames(3);
        }

        // Failed after all attempts
        const elapsed = performance.now() - startTime;
        const avgInterval = await this.measureCurrentInterval();

        if (this.config.debug) {
            console.warn(
                `[ThrottleBreaker] ✗ FAILED after ${attempts} attempts, ` +
                `final interval: ${avgInterval.toFixed(1)}ms`
            );
        }

        return {
            success: false,
            attempts,
            finalIntervalMs: avgInterval,
            elapsedMs: elapsed,
            method: 'none',
        };
    }

    /**
     * Try resize nudge technique
     */
    private async tryResizeNudge(): Promise<boolean> {
        // Step 1: Apply slight scaling change
        const newScaling = this.originalScaling + this.config.scalingDelta;

        if (this.config.debug) {
            console.log(
                `[ThrottleBreaker] Nudging scaling: ${this.originalScaling.toFixed(4)} → ${newScaling.toFixed(4)}`
            );
        }

        this.engine.setHardwareScalingLevel(newScaling);
        this.engine.resize();

        // Step 2: Wait for browser to process
        await this.waitFrames(2);

        // Step 3: Restore original scaling
        this.engine.setHardwareScalingLevel(this.originalScaling);
        this.engine.resize();

        // Step 4: Wait for RAF to settle
        await this.waitFrames(this.config.settleFrames);

        // Step 5: Check if throttle is broken
        const avgInterval = await this.measureCurrentInterval();
        const success = avgInterval < this.config.targetIntervalMs;

        if (this.config.debug) {
            console.log(
                `[ThrottleBreaker] Post-nudge interval: ${avgInterval.toFixed(1)}ms ` +
                `(target < ${this.config.targetIntervalMs}ms) → ${success ? '✓' : '✗'}`
            );
        }

        return success;
    }

    /**
     * Measure current RAF interval (average of 5 frames)
     */
    private async measureCurrentInterval(): Promise<number> {
        const samples: number[] = [];
        let lastTime = performance.now();
        const sampleCount = 5;

        return new Promise((resolve) => {
            let count = 0;
            const observer = this.scene.onBeforeRenderObservable.add(() => {
                const now = performance.now();
                const dt = now - lastTime;
                lastTime = now;

                if (count > 0) {
                    // Skip first frame (cold start)
                    samples.push(dt);
                }

                count++;

                if (samples.length >= sampleCount) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
                    resolve(avg);
                }
            });
        });
    }

    /**
     * Wait for N frames
     */
    private waitFrames(count: number): Promise<void> {
        return new Promise((resolve) => {
            let remaining = count;
            const observer = this.scene.onBeforeRenderObservable.add(() => {
                remaining--;
                if (remaining <= 0) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    resolve();
                }
            });
        });
    }

    /**
     * Dispose and cleanup
     */
    dispose(): void {
        // Ensure original scaling is restored
        if (this.engine.getHardwareScalingLevel() !== this.originalScaling) {
            this.engine.setHardwareScalingLevel(this.originalScaling);
            this.engine.resize();
        }
    }
}

/**
 * Create a throttle breaker instance
 */
export function createThrottleBreaker(
    engine: BABYLON.Engine,
    scene: BABYLON.Scene,
    config?: Partial<ThrottleBreakerConfig>
): ThrottleBreaker {
    return new ThrottleBreaker(engine, scene, config);
}
