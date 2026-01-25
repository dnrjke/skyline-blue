/**
 * ThrottleLockDetector - Detects browser RAF throttling patterns.
 *
 * When a browser throttles RAF to a fixed cadence (e.g., 10fps = 100ms),
 * frames arrive at consistent intervals that exceed normal "stable" thresholds
 * but are NOT indicative of rendering instability.
 *
 * Pattern recognition:
 * - Intervals fall within throttle range (e.g., 95-115ms)
 * - Low variance (stdDev < threshold)
 * - Consistent cadence over multiple frames
 *
 * If detected, the barrier can recognize this as "throttle-stable" and pass.
 *
 * SHARED MODULE: Used by both EngineAwakenedBarrier and PhysicalReadyFlightRecorderProbe
 */
export class ThrottleLockDetector {
    private intervals: number[] = [];
    private windowSize: number;
    private stdDevThreshold: number;
    private intervalRange: [number, number];

    constructor(
        windowSize: number = 10,
        stdDevThreshold: number = 5,
        intervalRange: [number, number] = [95, 115]
    ) {
        this.windowSize = windowSize;
        this.stdDevThreshold = stdDevThreshold;
        this.intervalRange = intervalRange;
    }

    /**
     * Add a frame interval to the detection window.
     */
    addInterval(intervalMs: number): void {
        this.intervals.push(intervalMs);
        if (this.intervals.length > this.windowSize) {
            this.intervals.shift();
        }
    }

    /**
     * Check if current pattern indicates throttle-stable state.
     *
     * Criteria:
     * 1. Window is full (enough samples)
     * 2. All intervals within throttle range
     * 3. Standard deviation below threshold
     */
    isThrottleStable(): boolean {
        if (this.intervals.length < this.windowSize) {
            return false;
        }

        // Check if all intervals are within throttle range
        const [minRange, maxRange] = this.intervalRange;
        const allInRange = this.intervals.every(
            (dt) => dt >= minRange && dt <= maxRange
        );
        if (!allInRange) {
            return false;
        }

        // Check standard deviation
        const stdDev = this.calculateStdDev();
        return stdDev <= this.stdDevThreshold;
    }

    /**
     * Get the mean interval (throttle frequency).
     */
    getMeanInterval(): number {
        if (this.intervals.length === 0) return 0;
        return this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    }

    /**
     * Get the standard deviation of intervals.
     */
    getStdDev(): number {
        return this.calculateStdDev();
    }

    /**
     * Get sample count
     */
    getSampleCount(): number {
        return this.intervals.length;
    }

    private calculateStdDev(): number {
        if (this.intervals.length < 2) return 0;
        const mean = this.getMeanInterval();
        const squaredDiffs = this.intervals.map((v) => Math.pow(v - mean, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / this.intervals.length;
        return Math.sqrt(variance);
    }

    /**
     * Reset the detector.
     */
    reset(): void {
        this.intervals = [];
    }
}
