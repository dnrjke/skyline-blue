/**
 * TransitionMeter - RAF Measurement During Scene Transitions
 *
 * Measures requestAnimationFrame intervals specifically during
 * Host → Navigation scene transitions to detect:
 * - Chrome 104ms throttle lock
 * - Firefox rendering freeze
 * - Frame drops and recovery
 */

import * as BABYLON from '@babylonjs/core';

export interface TransitionMeterResult {
    /** Average RAF interval in ms */
    avgIntervalMs: number;

    /** Standard deviation in ms */
    stdDevMs: number;

    /** Minimum interval in ms */
    minIntervalMs: number;

    /** Maximum interval in ms */
    maxIntervalMs: number;

    /** Number of frames measured */
    frameCount: number;

    /** All intervals recorded */
    intervals: number[];

    /** Is RAF throttled? (avg > 50ms) */
    isThrottled: boolean;

    /** Is RAF locked to ~104ms pattern? */
    is104msLock: boolean;

    /** Frame drop count (intervals > 100ms) */
    frameDropCount: number;
}

/**
 * TransitionMeter - Measures RAF health during transitions
 */
export class TransitionMeter {
    private intervals: number[] = [];
    private lastTime: number = 0;
    private observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private rafHandle: number | null = null;

    /**
     * Start measuring RAF independently (no scene)
     */
    startIndependent(): void {
        this.intervals = [];
        this.lastTime = performance.now();

        const tick = () => {
            const now = performance.now();
            const dt = now - this.lastTime;
            this.lastTime = now;

            if (dt > 0) {
                this.intervals.push(dt);
            }

            this.rafHandle = requestAnimationFrame(tick);
        };

        this.rafHandle = requestAnimationFrame(tick);
    }

    /**
     * Start measuring RAF via scene observer
     */
    startWithScene(scene: BABYLON.Scene): void {
        this.intervals = [];
        this.lastTime = performance.now();

        this.observer = scene.onBeforeRenderObservable.add(() => {
            const now = performance.now();
            const dt = now - this.lastTime;
            this.lastTime = now;

            if (dt > 0) {
                this.intervals.push(dt);
            }
        });
    }

    /**
     * Stop measuring and return results
     */
    stop(scene?: BABYLON.Scene): TransitionMeterResult {
        // Stop RAF measurement
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }

        // Remove scene observer
        if (this.observer && scene) {
            scene.onBeforeRenderObservable.remove(this.observer);
            this.observer = null;
        }

        return this.analyze();
    }

    /**
     * Get current results without stopping
     */
    getResults(): TransitionMeterResult {
        return this.analyze();
    }

    /**
     * Clear recorded intervals
     */
    clear(): void {
        this.intervals = [];
        this.lastTime = performance.now();
    }

    /**
     * Analyze recorded intervals
     */
    private analyze(): TransitionMeterResult {
        if (this.intervals.length === 0) {
            return {
                avgIntervalMs: 0,
                stdDevMs: 0,
                minIntervalMs: 0,
                maxIntervalMs: 0,
                frameCount: 0,
                intervals: [],
                isThrottled: false,
                is104msLock: false,
                frameDropCount: 0,
            };
        }

        const sum = this.intervals.reduce((a, b) => a + b, 0);
        const avg = sum / this.intervals.length;

        const squaredDiffs = this.intervals.map((v) => Math.pow(v - avg, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / this.intervals.length;
        const stdDev = Math.sqrt(variance);

        const min = Math.min(...this.intervals);
        const max = Math.max(...this.intervals);

        // Check if throttled (avg > 50ms = < 20fps)
        const isThrottled = avg > 50;

        // Check if locked to ~104ms pattern (Chrome specific)
        // Look for intervals in 95-115ms range with low variation
        const in104Range = this.intervals.filter((v) => v >= 95 && v <= 115).length;
        const is104msLock = in104Range / this.intervals.length >= 0.7 && stdDev < 15;

        // Count frame drops (intervals > 100ms)
        const frameDropCount = this.intervals.filter((v) => v > 100).length;

        return {
            avgIntervalMs: avg,
            stdDevMs: stdDev,
            minIntervalMs: min,
            maxIntervalMs: max,
            frameCount: this.intervals.length,
            intervals: [...this.intervals],
            isThrottled,
            is104msLock,
            frameDropCount,
        };
    }

    /**
     * Measure RAF for a specific duration
     */
    async measureForDuration(
        scene: BABYLON.Scene | null,
        durationMs: number
    ): Promise<TransitionMeterResult> {
        if (scene) {
            this.startWithScene(scene);
        } else {
            this.startIndependent();
        }

        await new Promise((resolve) => setTimeout(resolve, durationMs));

        return this.stop(scene ?? undefined);
    }

    /**
     * Wait until RAF is stable (for pre-transition baseline)
     */
    async waitForStable(
        scene: BABYLON.Scene,
        targetIntervalMs: number = 25,
        requiredFrames: number = 10,
        timeoutMs: number = 3000
    ): Promise<{ success: boolean; finalAvgMs: number }> {
        const startTime = performance.now();
        let consecutiveGood = 0;
        const recentIntervals: number[] = [];
        let lastTime = performance.now();

        return new Promise((resolve) => {
            const observer = scene.onBeforeRenderObservable.add(() => {
                const now = performance.now();
                const dt = now - lastTime;
                lastTime = now;

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
                    resolve({ success: true, finalAvgMs: avg });
                }

                if (now - startTime > timeoutMs) {
                    scene.onBeforeRenderObservable.remove(observer);
                    const avg = recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length;
                    resolve({ success: false, finalAvgMs: avg });
                }
            });
        });
    }
}
