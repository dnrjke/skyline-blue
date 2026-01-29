/**
 * RAFMeter - Precise RAF Interval Measurement
 *
 * Measures requestAnimationFrame intervals to detect throttling.
 * Provides statistical analysis of frame timing.
 */

import * as BABYLON from '@babylonjs/core';

export interface RAFMeterConfig {
    /** Enable debug logging */
    debug?: boolean;
}

export interface RAFMeterResult {
    /** Number of frames measured */
    frameCount: number;

    /** Average interval in ms */
    avgIntervalMs: number;

    /** Standard deviation in ms */
    stdDevMs: number;

    /** Minimum interval in ms */
    minIntervalMs: number;

    /** Maximum interval in ms */
    maxIntervalMs: number;

    /** All intervals recorded */
    intervals: number[];

    /** Is RAF throttled? (avg > 50ms) */
    isThrottled: boolean;

    /** Is RAF locked to ~104ms pattern? */
    isLocked: boolean;
}

/**
 * RAFMeter - Measures RAF timing
 */
export class RAFMeter {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_config: RAFMeterConfig = {}) {
        // Configuration available for future use (debug logging, etc.)
    }

    /**
     * Measure baseline RAF without scene (pure requestAnimationFrame)
     */
    async measureBaseline(frameCount: number = 30): Promise<RAFMeterResult> {
        const intervals: number[] = [];
        let lastTime = performance.now();

        return new Promise((resolve) => {
            let count = 0;

            const tick = () => {
                const now = performance.now();
                const dt = now - lastTime;
                lastTime = now;

                if (count > 0) {
                    intervals.push(dt);
                }

                count++;

                if (count > frameCount) {
                    resolve(this.analyzeIntervals(intervals));
                } else {
                    requestAnimationFrame(tick);
                }
            };

            requestAnimationFrame(tick);
        });
    }

    /**
     * Measure RAF with scene render loop
     */
    async measure(
        scene: BABYLON.Scene,
        frameCount: number = 30
    ): Promise<RAFMeterResult> {
        const intervals: number[] = [];
        let lastTime = performance.now();
        let count = 0;

        return new Promise((resolve) => {
            const observer = scene.onBeforeRenderObservable.add(() => {
                const now = performance.now();
                const dt = now - lastTime;
                lastTime = now;

                if (count > 0) {
                    intervals.push(dt);
                }

                count++;

                if (count > frameCount) {
                    scene.onBeforeRenderObservable.remove(observer);
                    resolve(this.analyzeIntervals(intervals));
                }
            });
        });
    }

    /**
     * Measure with callback for real-time monitoring
     */
    measureContinuous(
        scene: BABYLON.Scene,
        onFrame: (interval: number, stats: RAFMeterResult) => void,
        windowSize: number = 10
    ): () => void {
        const intervals: number[] = [];
        let lastTime = performance.now();

        const observer = scene.onBeforeRenderObservable.add(() => {
            const now = performance.now();
            const dt = now - lastTime;
            lastTime = now;

            intervals.push(dt);
            if (intervals.length > windowSize) {
                intervals.shift();
            }

            if (intervals.length >= windowSize) {
                onFrame(dt, this.analyzeIntervals(intervals));
            }
        });

        // Return stop function
        return () => {
            scene.onBeforeRenderObservable.remove(observer);
        };
    }

    /**
     * Analyze interval array and compute statistics
     */
    private analyzeIntervals(intervals: number[]): RAFMeterResult {
        if (intervals.length === 0) {
            return {
                frameCount: 0,
                avgIntervalMs: 0,
                stdDevMs: 0,
                minIntervalMs: 0,
                maxIntervalMs: 0,
                intervals: [],
                isThrottled: false,
                isLocked: false,
            };
        }

        const sum = intervals.reduce((a, b) => a + b, 0);
        const avg = sum / intervals.length;

        const squaredDiffs = intervals.map((v) => Math.pow(v - avg, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
        const stdDev = Math.sqrt(variance);

        const min = Math.min(...intervals);
        const max = Math.max(...intervals);

        // Check if throttled (avg > 50ms = < 20fps)
        const isThrottled = avg > 50;

        // Check if locked to ~104ms pattern (95-115ms range, low stdDev)
        const inLockRange = intervals.filter((v) => v >= 95 && v <= 115).length;
        const isLocked = inLockRange / intervals.length >= 0.75 && stdDev < 10;

        return {
            frameCount: intervals.length,
            avgIntervalMs: avg,
            stdDevMs: stdDev,
            minIntervalMs: min,
            maxIntervalMs: max,
            intervals: [...intervals],
            isThrottled,
            isLocked,
        };
    }

    /**
     * Wait for RAF to stabilize at target interval
     */
    async waitForStable(
        scene: BABYLON.Scene,
        targetIntervalMs: number = 25,
        requiredFrames: number = 10,
        timeoutMs: number = 5000
    ): Promise<{ success: boolean; finalAvgMs: number; framesChecked: number }> {
        const startTime = performance.now();
        let consecutiveGood = 0;
        let totalFrames = 0;
        let lastTime = performance.now();
        const recentIntervals: number[] = [];

        return new Promise((resolve) => {
            const observer = scene.onBeforeRenderObservable.add(() => {
                const now = performance.now();
                const dt = now - lastTime;
                lastTime = now;
                totalFrames++;

                recentIntervals.push(dt);
                if (recentIntervals.length > 10) {
                    recentIntervals.shift();
                }

                if (dt < targetIntervalMs) {
                    consecutiveGood++;
                } else {
                    consecutiveGood = 0;
                }

                if (consecutiveGood >= requiredFrames) {
                    scene.onBeforeRenderObservable.remove(observer);
                    const avg = recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length;
                    resolve({ success: true, finalAvgMs: avg, framesChecked: totalFrames });
                }

                if (now - startTime > timeoutMs) {
                    scene.onBeforeRenderObservable.remove(observer);
                    const avg = recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length;
                    resolve({ success: false, finalAvgMs: avg, framesChecked: totalFrames });
                }
            });
        });
    }
}
