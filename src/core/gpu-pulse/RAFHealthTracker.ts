/**
 * RAF (requestAnimationFrame) Health Tracker
 *
 * Monitors frame timing to detect Chromium GPU throttling.
 *
 * Key Detection:
 * - Normal RAF: ~16.7ms intervals (60fps)
 * - Throttled RAF: ~104ms intervals (9.6fps) - this is the "blackhole"
 *
 * Purpose:
 * - Block pulse transfer until RAF is healthy
 * - Detect throttling recurrence after transfer
 * - Provide metrics for debug overlay
 */

const LOG_PREFIX = '[RAFHealth]';

/**
 * Frame timing thresholds (ms)
 */
export const RAF_THRESHOLDS = {
    /** Normal frame time for 60fps */
    NORMAL_60FPS: 16.7,
    /** Maximum acceptable frame time (30fps equivalent) */
    HEALTHY_MAX: 50,
    /** Throttled frame time threshold */
    THROTTLED_MIN: 80,
    /** Severe throttling threshold */
    SEVERE_THROTTLED: 100,
    /** Consecutive healthy frames needed for "stable" status */
    STABILITY_FRAMES: 10,
    /** Sample window size for averaging */
    SAMPLE_WINDOW: 20,
} as const;

/**
 * RAF health status
 */
export enum RAFHealthStatus {
    /** Unknown - not enough samples */
    UNKNOWN = 'unknown',
    /** Healthy - normal frame times */
    HEALTHY = 'healthy',
    /** Warning - occasional slow frames */
    WARNING = 'warning',
    /** Throttled - consistent slow frames */
    THROTTLED = 'throttled',
    /** Severe - RAF locked at ~104ms */
    SEVERE_THROTTLED = 'severe_throttled',
}

/**
 * Health metrics snapshot
 */
export interface RAFHealthMetrics {
    /** Current status */
    status: RAFHealthStatus;
    /** Last frame interval (ms) */
    lastFrameInterval: number;
    /** Average frame interval over sample window (ms) */
    averageFrameInterval: number;
    /** Consecutive healthy frames count */
    consecutiveHealthyFrames: number;
    /** Whether RAF is considered stable for transfer */
    isStableForTransfer: boolean;
    /** Current estimated FPS */
    estimatedFPS: number;
    /** Total frames tracked */
    totalFrames: number;
    /** Throttle detection count */
    throttleDetectionCount: number;
}

/**
 * Callback types
 */
export interface RAFHealthCallbacks {
    /** Called when throttling is detected */
    onThrottleDetected?: (metrics: RAFHealthMetrics) => void;
    /** Called when RAF recovers from throttling */
    onThrottleRecovered?: (metrics: RAFHealthMetrics) => void;
    /** Called when RAF becomes stable */
    onStabilized?: (metrics: RAFHealthMetrics) => void;
}

export class RAFHealthTracker {
    // Frame timing samples
    private frameSamples: number[] = [];
    private lastFrameTimestamp: number = 0;
    private totalFrames: number = 0;

    // Health state
    private consecutiveHealthyFrames: number = 0;
    private currentStatus: RAFHealthStatus = RAFHealthStatus.UNKNOWN;
    private wasThrottled: boolean = false;
    private throttleDetectionCount: number = 0;

    // Callbacks
    private callbacks: RAFHealthCallbacks = {};

    // Debug
    private debug: boolean = false;

    constructor(debug: boolean = false) {
        this.debug = debug;
    }

    /**
     * Record a frame and update health metrics
     * Call this every frame from the render loop
     */
    public recordFrame(): void {
        const now = performance.now();

        if (this.lastFrameTimestamp > 0) {
            const interval = now - this.lastFrameTimestamp;
            this.processFrameInterval(interval);
        }

        this.lastFrameTimestamp = now;
        this.totalFrames++;
    }

    /**
     * Get current health metrics
     */
    public getMetrics(): RAFHealthMetrics {
        const avgInterval = this.getAverageInterval();
        const lastInterval = this.frameSamples.length > 0
            ? this.frameSamples[this.frameSamples.length - 1]
            : 0;

        return {
            status: this.currentStatus,
            lastFrameInterval: lastInterval,
            averageFrameInterval: avgInterval,
            consecutiveHealthyFrames: this.consecutiveHealthyFrames,
            isStableForTransfer: this.isStableForTransfer(),
            estimatedFPS: avgInterval > 0 ? Math.round(1000 / avgInterval) : 0,
            totalFrames: this.totalFrames,
            throttleDetectionCount: this.throttleDetectionCount,
        };
    }

    /**
     * Check if RAF is healthy enough for pulse transfer
     */
    public isHealthyForTransfer(): boolean {
        // Need enough samples
        if (this.frameSamples.length < 5) {
            return false;
        }

        // Check recent average
        const avgInterval = this.getAverageInterval();
        return avgInterval < RAF_THRESHOLDS.HEALTHY_MAX;
    }

    /**
     * Check if RAF is stable (consistent healthy frames)
     */
    public isStableForTransfer(): boolean {
        return this.isHealthyForTransfer() &&
               this.consecutiveHealthyFrames >= RAF_THRESHOLDS.STABILITY_FRAMES;
    }

    /**
     * Check if currently throttled
     */
    public isThrottled(): boolean {
        return this.currentStatus === RAFHealthStatus.THROTTLED ||
               this.currentStatus === RAFHealthStatus.SEVERE_THROTTLED;
    }

    /**
     * Set callbacks
     */
    public setCallbacks(callbacks: RAFHealthCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Reset tracker state
     */
    public reset(): void {
        this.frameSamples = [];
        this.lastFrameTimestamp = 0;
        this.consecutiveHealthyFrames = 0;
        this.currentStatus = RAFHealthStatus.UNKNOWN;
        this.wasThrottled = false;
        this.log('Reset');
    }

    // ============================================================
    // Private: Frame Processing
    // ============================================================

    private processFrameInterval(interval: number): void {
        // Add to sample window
        this.frameSamples.push(interval);
        if (this.frameSamples.length > RAF_THRESHOLDS.SAMPLE_WINDOW) {
            this.frameSamples.shift();
        }

        // Classify this frame
        const isHealthy = interval < RAF_THRESHOLDS.HEALTHY_MAX;
        const isSevere = interval >= RAF_THRESHOLDS.SEVERE_THROTTLED;

        // Update consecutive healthy count
        if (isHealthy) {
            this.consecutiveHealthyFrames++;
        } else {
            this.consecutiveHealthyFrames = 0;
        }

        // Determine overall status
        const previousStatus = this.currentStatus;
        this.currentStatus = this.calculateStatus();

        // Detect state transitions
        if (this.currentStatus === RAFHealthStatus.THROTTLED ||
            this.currentStatus === RAFHealthStatus.SEVERE_THROTTLED) {

            if (!this.wasThrottled) {
                // Just started throttling
                this.wasThrottled = true;
                this.throttleDetectionCount++;
                this.log(`THROTTLE DETECTED: interval=${interval.toFixed(1)}ms`, 'warn');
                this.callbacks.onThrottleDetected?.(this.getMetrics());
            }
        } else if (this.wasThrottled && this.currentStatus === RAFHealthStatus.HEALTHY) {
            // Recovered from throttling
            this.wasThrottled = false;
            this.log(`THROTTLE RECOVERED: now healthy`);
            this.callbacks.onThrottleRecovered?.(this.getMetrics());
        }

        // Check for stability achievement
        if (previousStatus !== RAFHealthStatus.HEALTHY &&
            this.currentStatus === RAFHealthStatus.HEALTHY &&
            this.consecutiveHealthyFrames === RAF_THRESHOLDS.STABILITY_FRAMES) {
            this.log(`STABILIZED: ${this.consecutiveHealthyFrames} consecutive healthy frames`);
            this.callbacks.onStabilized?.(this.getMetrics());
        }

        // Debug logging for severe throttling
        if (isSevere && this.debug) {
            this.log(`SEVERE: ${interval.toFixed(1)}ms (frame #${this.totalFrames})`, 'warn');
        }
    }

    private calculateStatus(): RAFHealthStatus {
        if (this.frameSamples.length < 5) {
            return RAFHealthStatus.UNKNOWN;
        }

        const avgInterval = this.getAverageInterval();
        const recentAvg = this.getRecentAverage(5);

        // Check for severe throttling (locked at ~104ms)
        if (recentAvg >= RAF_THRESHOLDS.SEVERE_THROTTLED) {
            return RAFHealthStatus.SEVERE_THROTTLED;
        }

        // Check for throttling
        if (recentAvg >= RAF_THRESHOLDS.THROTTLED_MIN) {
            return RAFHealthStatus.THROTTLED;
        }

        // Check for warning (occasional slow frames)
        if (avgInterval >= RAF_THRESHOLDS.HEALTHY_MAX) {
            return RAFHealthStatus.WARNING;
        }

        return RAFHealthStatus.HEALTHY;
    }

    private getAverageInterval(): number {
        if (this.frameSamples.length === 0) return 0;
        const sum = this.frameSamples.reduce((a, b) => a + b, 0);
        return sum / this.frameSamples.length;
    }

    private getRecentAverage(count: number): number {
        if (this.frameSamples.length === 0) return 0;
        const recent = this.frameSamples.slice(-count);
        const sum = recent.reduce((a, b) => a + b, 0);
        return sum / recent.length;
    }

    // ============================================================
    // Private: Logging
    // ============================================================

    private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        if (!this.debug && level === 'info') return;

        const entry = `${LOG_PREFIX} ${message}`;
        if (level === 'error') {
            console.error(entry);
        } else if (level === 'warn') {
            console.warn(entry);
        } else {
            console.log(entry);
        }
    }
}

/**
 * Factory function
 */
export function createRAFHealthTracker(debug: boolean = false): RAFHealthTracker {
    return new RAFHealthTracker(debug);
}
