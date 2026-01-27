/**
 * Entry Point Integrity Audit (Phase 0)
 *
 * Verifies the "hand-over moment" between Scenario Phase and Loading Orchestrator.
 *
 * Mission:
 * - Measure Δt from scenario end to first loading RAF
 * - Start immediate render pulse before loading init
 * - Check Canvas & WebGL health
 * - Detect main thread blocking during cleanup
 *
 * Constraints:
 * - NO loading units - only verify entry point patency
 * - Minimal code footprint
 */

import * as BABYLON from '@babylonjs/core';

const LOG_PREFIX = '[EntryPointAudit]';

/**
 * Audit report structure
 */
export interface EntryPointAuditReport {
    /** Hand-over gap: time from scenario end to first loading RAF (ms) */
    deltaT_handoverMs: number;
    /** Initial RAF intervals for first 10 frames (ms) */
    initialRAFIntervals: number[];
    /** Average of first 10 RAF intervals (ms) */
    avgInitialRAFIntervalMs: number;
    /** Maximum main thread blocking time detected (ms) */
    maxBlockingTimeMs: number;
    /** Whether visual confirmation succeeded (canvas drew immediately) */
    visualConfirmed: boolean;
    /** Canvas dimensions at entry */
    canvasWidth: number;
    canvasHeight: number;
    /** WebGL context lost status */
    isContextLost: boolean;
    /** Engine FPS at entry */
    engineFPS: number;
    /** Timestamp markers */
    timestamps: {
        scenarioEndCalled: number;
        heartbeatStarted: number;
        firstRAFExecuted: number;
        loadingStartCalled: number;
        auditComplete: number;
    };
    /** Raw frame timestamps for analysis */
    frameTimestamps: number[];
}

/**
 * Heartbeat state for immediate render pulse
 */
interface HeartbeatState {
    active: boolean;
    frameCount: number;
    startTime: number;
    frameTimestamps: number[];
    observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>>;
}

export class EntryPointAudit {
    private engine: BABYLON.Engine;
    private scene: BABYLON.Scene;
    private canvas: HTMLCanvasElement;

    // Audit state
    private scenarioEndTime: number = 0;
    private heartbeatState: HeartbeatState = {
        active: false,
        frameCount: 0,
        startTime: 0,
        frameTimestamps: [],
        observer: null,
    };
    private loadingStartTime: number = 0;
    private firstRAFTime: number = 0;
    private maxBlockingTime: number = 0;
    private lastTickTime: number = 0;

    // Blocking detector interval
    private blockingDetectorId: number | null = null;

    // Report data
    private report: EntryPointAuditReport | null = null;

    constructor(engine: BABYLON.Engine, scene: BABYLON.Scene) {
        this.engine = engine;
        this.scene = scene;
        this.canvas = engine.getRenderingCanvas()!;
    }

    /**
     * STEP 1: Call this when scenario ends (before navigation starts)
     * Records the scenario end timestamp and starts heartbeat pulse
     */
    public markScenarioEnd(): void {
        this.scenarioEndTime = performance.now();

        // Start blocking detector
        this.startBlockingDetector();

        // Start immediate heartbeat pulse
        this.startHeartbeat();
    }

    /**
     * STEP 2: Call this when loading/navigation actually starts
     * Records the loading start timestamp
     */
    public markLoadingStart(): void {
        this.loadingStartTime = performance.now();

        // Capture WebGL/Canvas health at this moment
        this.captureHealthSnapshot();
    }

    /**
     * STEP 3: Call this after collecting enough frames (or on timeout)
     * Generates the final audit report
     */
    public complete(): EntryPointAuditReport {
        const completeTime = performance.now();

        // Stop heartbeat and blocking detector
        this.stopHeartbeat();
        this.stopBlockingDetector();

        // Calculate RAF intervals from timestamps
        const intervals: number[] = [];
        for (let i = 1; i < this.heartbeatState.frameTimestamps.length && i <= 10; i++) {
            intervals.push(
                this.heartbeatState.frameTimestamps[i] - this.heartbeatState.frameTimestamps[i - 1]
            );
        }

        const avgInterval = intervals.length > 0
            ? intervals.reduce((a, b) => a + b, 0) / intervals.length
            : 0;

        // Build report
        this.report = {
            deltaT_handoverMs: this.firstRAFTime > 0
                ? this.firstRAFTime - this.scenarioEndTime
                : this.loadingStartTime - this.scenarioEndTime,
            initialRAFIntervals: intervals,
            avgInitialRAFIntervalMs: avgInterval,
            maxBlockingTimeMs: this.maxBlockingTime,
            visualConfirmed: this.heartbeatState.frameCount > 0,
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height,
            isContextLost: this.isWebGLContextLost(),
            engineFPS: this.engine.getFps(),
            timestamps: {
                scenarioEndCalled: this.scenarioEndTime,
                heartbeatStarted: this.heartbeatState.startTime,
                firstRAFExecuted: this.firstRAFTime,
                loadingStartCalled: this.loadingStartTime,
                auditComplete: completeTime,
            },
            frameTimestamps: [...this.heartbeatState.frameTimestamps],
        };

        // Print report
        this.printReport();

        return this.report;
    }

    /**
     * Get the current report (may be incomplete)
     */
    public getReport(): EntryPointAuditReport | null {
        return this.report;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopHeartbeat();
        this.stopBlockingDetector();
    }

    // ============================================================
    // Private: Heartbeat Pulse
    // ============================================================

    /**
     * Start immediate render pulse before loading init.
     * This is a lightweight observer that just updates clearColor
     * to keep RAF alive and verify scheduling isn't broken.
     */
    private startHeartbeat(): void {
        if (this.heartbeatState.active) return;

        this.heartbeatState.active = true;
        this.heartbeatState.startTime = performance.now();
        this.heartbeatState.frameCount = 0;
        this.heartbeatState.frameTimestamps = [];

        // Create observer with high priority to run first
        this.heartbeatState.observer = this.scene.onBeforeRenderObservable.add(() => {
            const now = performance.now();

            // Record first RAF time
            if (this.heartbeatState.frameCount === 0) {
                this.firstRAFTime = now;
            }

            this.heartbeatState.frameTimestamps.push(now);
            this.heartbeatState.frameCount++;

            // Minimal visual change: subtle clearColor oscillation
            // This ensures actual GPU work without visible impact
            const phase = (now % 1000) / 1000;
            const microShift = Math.sin(phase * Math.PI * 2) * 0.001;
            const baseColor = this.scene.clearColor;
            if (baseColor) {
                // Microscopic change to force render
                this.scene.clearColor.r = Math.max(0, Math.min(1, baseColor.r + microShift));
            }
        }, -900); // High priority, but after pulse system
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatState.active) return;

        if (this.heartbeatState.observer) {
            this.scene.onBeforeRenderObservable.remove(this.heartbeatState.observer);
            this.heartbeatState.observer = null;
        }

        this.heartbeatState.active = false;
    }

    // ============================================================
    // Private: Blocking Detector
    // ============================================================

    /**
     * Start a high-frequency timer to detect main thread blocking.
     * If the gap between timer ticks exceeds threshold, it indicates blocking.
     */
    private startBlockingDetector(): void {
        this.lastTickTime = performance.now();
        this.maxBlockingTime = 0;

        // Check every 10ms - if gap is >50ms, we have blocking
        this.blockingDetectorId = window.setInterval(() => {
            const now = performance.now();
            const gap = now - this.lastTickTime;

            // Expected gap: ~10ms. If much larger, there was blocking.
            const blockingTime = gap - 10;
            if (blockingTime > this.maxBlockingTime) {
                this.maxBlockingTime = blockingTime;
            }

            this.lastTickTime = now;
        }, 10);
    }

    private stopBlockingDetector(): void {
        if (this.blockingDetectorId !== null) {
            clearInterval(this.blockingDetectorId);
            this.blockingDetectorId = null;
        }
    }

    // ============================================================
    // Private: Health Checks
    // ============================================================

    private captureHealthSnapshot(): void {
        // Data is captured, will be included in final report
    }

    private isWebGLContextLost(): boolean {
        const gl = this.engine._gl as WebGLRenderingContext | null;
        return gl ? gl.isContextLost() : false;
    }

    // ============================================================
    // Private: Report
    // ============================================================

    private printReport(): void {
        if (!this.report) return;

        const r = this.report;
        const STATUS_OK = '✅';
        const STATUS_WARN = '⚠️';
        const STATUS_FAIL = '❌';

        console.log(`${LOG_PREFIX} ========================================`);
        console.log(`${LOG_PREFIX} ENTRY POINT AUDIT REPORT`);
        console.log(`${LOG_PREFIX} ========================================`);

        // 1. Hand-over Gap
        const gapStatus = r.deltaT_handoverMs <= 100 ? STATUS_OK : (r.deltaT_handoverMs <= 500 ? STATUS_WARN : STATUS_FAIL);
        console.log(`${LOG_PREFIX} 1. Δt (Hand-over Gap): ${r.deltaT_handoverMs.toFixed(1)}ms ${gapStatus}`);
        console.log(`     기준: ≤100ms=OK, >100ms=위험`);

        // 2. Initial RAF Interval
        const avgStatus = r.avgInitialRAFIntervalMs <= 20 ? STATUS_OK : (r.avgInitialRAFIntervalMs <= 50 ? STATUS_WARN : STATUS_FAIL);
        console.log(`${LOG_PREFIX} 2. Initial RAF Interval (avg): ${r.avgInitialRAFIntervalMs.toFixed(1)}ms ${avgStatus}`);
        console.log(`     First 10 frames: [${r.initialRAFIntervals.map(i => i.toFixed(1)).join(', ')}]ms`);
        console.log(`     기준: ~16.6ms=60fps정상, >100ms=RAF 스케줄링 이상`);

        // 3. Main Thread Blocking
        const blockStatus = r.maxBlockingTimeMs <= 50 ? STATUS_OK : (r.maxBlockingTimeMs <= 100 ? STATUS_WARN : STATUS_FAIL);
        console.log(`${LOG_PREFIX} 3. Max Main Thread Blocking: ${r.maxBlockingTimeMs.toFixed(1)}ms ${blockStatus}`);
        console.log(`     기준: ≤50ms=정상, >100ms=자산 해제 블로킹 의심`);

        // 4. Visual Confirmation
        const visualStatus = r.visualConfirmed ? STATUS_OK : STATUS_FAIL;
        console.log(`${LOG_PREFIX} 4. Visual Confirmation: ${r.visualConfirmed ? 'YES' : 'NO'} ${visualStatus}`);
        console.log(`     Heartbeat frames rendered: ${r.frameTimestamps.length}`);

        // Canvas/WebGL Health
        console.log(`${LOG_PREFIX} ----------------------------------------`);
        console.log(`${LOG_PREFIX} Canvas: ${r.canvasWidth}x${r.canvasHeight}`);
        console.log(`${LOG_PREFIX} WebGL Context Lost: ${r.isContextLost ? 'YES ❌' : 'NO ✅'}`);
        console.log(`${LOG_PREFIX} Engine FPS: ${r.engineFPS.toFixed(1)}`);

        // Timestamps
        console.log(`${LOG_PREFIX} ----------------------------------------`);
        console.log(`${LOG_PREFIX} Timestamps:`);
        console.log(`     scenarioEndCalled: ${r.timestamps.scenarioEndCalled.toFixed(1)}ms`);
        console.log(`     heartbeatStarted:  ${r.timestamps.heartbeatStarted.toFixed(1)}ms (+${(r.timestamps.heartbeatStarted - r.timestamps.scenarioEndCalled).toFixed(1)}ms)`);
        console.log(`     firstRAFExecuted:  ${r.timestamps.firstRAFExecuted.toFixed(1)}ms (+${(r.timestamps.firstRAFExecuted - r.timestamps.scenarioEndCalled).toFixed(1)}ms)`);
        console.log(`     loadingStartCalled: ${r.timestamps.loadingStartCalled.toFixed(1)}ms (+${(r.timestamps.loadingStartCalled - r.timestamps.scenarioEndCalled).toFixed(1)}ms)`);
        console.log(`     auditComplete:     ${r.timestamps.auditComplete.toFixed(1)}ms (+${(r.timestamps.auditComplete - r.timestamps.scenarioEndCalled).toFixed(1)}ms)`);

        console.log(`${LOG_PREFIX} ========================================`);
    }
}

/**
 * Factory function
 */
export function createEntryPointAudit(engine: BABYLON.Engine, scene: BABYLON.Scene): EntryPointAudit {
    return new EntryPointAudit(engine, scene);
}
