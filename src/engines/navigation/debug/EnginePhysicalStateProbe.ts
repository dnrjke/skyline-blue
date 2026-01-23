/**
 * EnginePhysicalStateProbe — Babylon "Resize Black Hole" Dissection System
 *
 * PURPOSE:
 * Track the physical state gap between logical READY and actual canvas/framebuffer
 * normalization. This probe operates at the PHYSICAL layer only:
 * - Canvas DOM dimensions (CSS vs buffer)
 * - Engine render target dimensions
 * - Hardware scaling application state
 * - ResizeObserver / window resize event timing
 * - RAF scheduling dt distribution
 * - Post-process pipeline execution
 * - Framebuffer clear/submission state
 *
 * EXPLICITLY NOT TRACKED (already proven passing):
 * - scene.isReady()
 * - mesh.visibility / isEnabled
 * - material.isReady
 * - activeMeshes count
 * - "render loop is running" assertions
 * - VisualReady / EngineAwakened state
 *
 * KEY CONCEPT: PHYSICAL_READY_FRAME
 * The first frame where ALL of the following hold:
 *   1. canvas.width > 0 AND canvas.height > 0
 *   2. engine.getRenderWidth() === canvas.width (accounting for hardware scaling)
 *   3. hardware scaling level is applied and stable
 *   4. At least one post-process has executed (if pipeline exists)
 *
 * This probe runs from READY declaration until PHYSICAL_READY_FRAME or timeout (10min).
 */

import * as BABYLON from '@babylonjs/core';

// ============================================================
// Types
// ============================================================

export interface PhysicalFrameSnapshot {
    /** Relative time from probe start (ms) */
    dt: number;
    /** Frame index since probe start */
    frame: number;

    // Canvas DOM physical state
    canvasCSSWidth: number;
    canvasCSSHeight: number;
    canvasBufferWidth: number;
    canvasBufferHeight: number;

    // Engine render target state
    engineRenderWidth: number;
    engineRenderHeight: number;
    hardwareScalingLevel: number;

    // Derived checks
    cssBufferMatch: boolean;     // CSS * DPR ≈ buffer?
    engineBufferMatch: boolean;  // engine render === buffer (scaled)?

    // RAF timing
    rafDt: number;  // ms since last onBeforeRender

    // Visibility
    documentVisibility: string;

    // Post-process state
    postProcessActive: boolean;
    postProcessCount: number;
}

export interface ResizeEvent {
    dt: number;
    source: 'ResizeObserver' | 'window.resize' | 'engine.resize_call';
    canvasWidth: number;
    canvasHeight: number;
    engineWidth: number;
    engineHeight: number;
}

export interface PhysicalReadyFrame {
    /** Frame index where physical ready was achieved */
    frame: number;
    /** Time from probe start (ms) */
    dt: number;
    /** What triggered normalization */
    trigger: string;
    /** Snapshot at this frame */
    snapshot: PhysicalFrameSnapshot;
}

export interface PhysicalProbeReport {
    /** Probe start timestamp (performance.now) */
    startTime: number;
    /** Total duration tracked (ms) */
    durationMs: number;
    /** Total frames observed */
    totalFrames: number;
    /** PHYSICAL_READY_FRAME (null if never achieved) */
    physicalReadyFrame: PhysicalReadyFrame | null;
    /** All resize events observed */
    resizeEvents: ResizeEvent[];
    /** Frame snapshots (sampled, not every frame) */
    snapshots: PhysicalFrameSnapshot[];
    /** RAF dt distribution */
    rafDtHistogram: { bucket: string; count: number }[];
    /** Summary statistics */
    stats: {
        avgRafDt: number;
        maxRafDt: number;
        framesAbove100ms: number;
        framesAbove500ms: number;
        framesAbove1000ms: number;
        firstResizeAt: number | null;
        physicalReadyAt: number | null;
        engineSizeZeroFrames: number;
        canvasSizeZeroFrames: number;
        sizeMismatchFrames: number;
    };
}

export interface PhysicalProbeConfig {
    /** Max recording time (ms, default: 600000 = 10min) */
    maxDurationMs?: number;
    /** Snapshot every N frames (default: 10) */
    snapshotInterval?: number;
    /** Console output for significant events (default: true) */
    consoleOutput?: boolean;
}

// ============================================================
// EnginePhysicalStateProbe
// ============================================================

export class EnginePhysicalStateProbe {
    private scene: BABYLON.Scene;
    private engine: BABYLON.AbstractEngine;
    private canvas: HTMLCanvasElement | null;
    private config: Required<PhysicalProbeConfig>;

    // State
    private active: boolean = false;
    private disposed: boolean = false;
    private startTime: number = 0;
    private frameCount: number = 0;
    private lastFrameTime: number = 0;

    // Physical Ready detection
    private physicalReadyFrame: PhysicalReadyFrame | null = null;
    private prevEngineWidth: number = 0;
    private prevEngineHeight: number = 0;
    private prevCanvasWidth: number = 0;
    private prevCanvasHeight: number = 0;
    private prevHardwareScaling: number = 0;

    // Resize events
    private resizeEvents: ResizeEvent[] = [];
    private resizeObserver: ResizeObserver | null = null;
    private windowResizeListener: (() => void) | null = null;
    private visibilityListener: (() => void) | null = null;

    // Engine.resize() interception
    private originalResize: (() => void) | null = null;
    private resizeCallCount: number = 0;

    // Snapshots & metrics
    private snapshots: PhysicalFrameSnapshot[] = [];
    private rafDts: number[] = [];
    private engineSizeZeroFrames: number = 0;
    private canvasSizeZeroFrames: number = 0;
    private sizeMismatchFrames: number = 0;

    // Observer
    private frameObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    constructor(scene: BABYLON.Scene, config: PhysicalProbeConfig = {}) {
        this.scene = scene;
        this.engine = scene.getEngine();
        this.canvas = this.engine.getRenderingCanvas() as HTMLCanvasElement | null;
        this.config = {
            maxDurationMs: config.maxDurationMs ?? 600_000,
            snapshotInterval: config.snapshotInterval ?? 10,
            consoleOutput: config.consoleOutput ?? true,
        };
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    /**
     * Start the physical state probe. Call at READY declaration.
     */
    start(): void {
        if (this.active || this.disposed) return;
        this.active = true;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;
        this.frameCount = 0;
        this.physicalReadyFrame = null;
        this.resizeEvents = [];
        this.snapshots = [];
        this.rafDts = [];
        this.resizeCallCount = 0;
        this.engineSizeZeroFrames = 0;
        this.canvasSizeZeroFrames = 0;
        this.sizeMismatchFrames = 0;

        // Capture initial state
        this.prevEngineWidth = this.engine.getRenderWidth();
        this.prevEngineHeight = this.engine.getRenderHeight();
        this.prevCanvasWidth = this.canvas?.width ?? 0;
        this.prevCanvasHeight = this.canvas?.height ?? 0;
        this.prevHardwareScaling = this.engine.getHardwareScalingLevel();

        // Setup monitors
        this.setupFrameObserver();
        this.setupResizeObserver();
        this.setupWindowResize();
        this.setupVisibilityMonitor();
        this.interceptEngineResize();

        // Log initial state
        const initial = this.captureSnapshot(0);
        this.logLine(
            `PROBE_START canvas=${initial.canvasBufferWidth}x${initial.canvasBufferHeight} ` +
            `css=${initial.canvasCSSWidth}x${initial.canvasCSSHeight} ` +
            `engine=${initial.engineRenderWidth}x${initial.engineRenderHeight} ` +
            `hwScale=${initial.hardwareScalingLevel} ` +
            `visibility=${initial.documentVisibility} ` +
            `postProcess=${initial.postProcessCount}`
        );

        // Auto-stop timer
        setTimeout(() => {
            if (this.active) {
                this.logLine('MAX_DURATION reached — stopping probe');
                this.stop();
            }
        }, this.config.maxDurationMs);
    }

    /**
     * Stop the probe and produce final report.
     */
    stop(): void {
        if (!this.active) return;
        this.active = false;

        this.teardownFrameObserver();
        this.teardownResizeObserver();
        this.teardownWindowResize();
        this.teardownVisibilityMonitor();
        this.restoreEngineResize();

        const duration = performance.now() - this.startTime;
        this.logLine(
            `PROBE_STOP duration=${duration.toFixed(0)}ms frames=${this.frameCount} ` +
            `resizes=${this.resizeEvents.length} ` +
            `physicalReady=${this.physicalReadyFrame ? `frame ${this.physicalReadyFrame.frame} (${this.physicalReadyFrame.dt.toFixed(0)}ms)` : 'NEVER'}`
        );
    }

    dispose(): void {
        this.stop();
        this.disposed = true;
    }

    isActive(): boolean {
        return this.active;
    }

    // ============================================================
    // Frame Observer — Core Physical State Tracking
    // ============================================================

    private setupFrameObserver(): void {
        this.frameObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (!this.active) return;

            const now = performance.now();
            const dt = now - this.startTime;
            const rafDt = now - this.lastFrameTime;
            this.lastFrameTime = now;
            this.frameCount++;
            this.rafDts.push(rafDt);

            // --- Physical State Capture ---
            const engineW = this.engine.getRenderWidth();
            const engineH = this.engine.getRenderHeight();
            const canvasW = this.canvas?.width ?? 0;
            const canvasH = this.canvas?.height ?? 0;
            const hwScale = this.engine.getHardwareScalingLevel();

            // Track anomalies
            if (engineW === 0 || engineH === 0) this.engineSizeZeroFrames++;
            if (canvasW === 0 || canvasH === 0) this.canvasSizeZeroFrames++;

            // Engine render size should equal canvas buffer / hwScale
            const expectedEngineW = Math.floor(canvasW / hwScale) || 0;
            const expectedEngineH = Math.floor(canvasH / hwScale) || 0;
            const engineBufferMatch = (engineW === expectedEngineW && engineH === expectedEngineH);
            if (!engineBufferMatch && canvasW > 0) this.sizeMismatchFrames++;

            // --- Detect state CHANGES (log on change only) ---
            const engineChanged = (engineW !== this.prevEngineWidth || engineH !== this.prevEngineHeight);
            const canvasChanged = (canvasW !== this.prevCanvasWidth || canvasH !== this.prevCanvasHeight);
            const scalingChanged = (hwScale !== this.prevHardwareScaling);

            if (engineChanged) {
                this.logLine(
                    `ENGINE_SIZE_CHANGE from=${this.prevEngineWidth}x${this.prevEngineHeight} ` +
                    `to=${engineW}x${engineH} frame=${this.frameCount} raf_dt=${rafDt.toFixed(0)}ms`
                );
                this.prevEngineWidth = engineW;
                this.prevEngineHeight = engineH;
            }

            if (canvasChanged) {
                this.logLine(
                    `CANVAS_BUFFER_CHANGE from=${this.prevCanvasWidth}x${this.prevCanvasHeight} ` +
                    `to=${canvasW}x${canvasH} frame=${this.frameCount} raf_dt=${rafDt.toFixed(0)}ms`
                );
                this.prevCanvasWidth = canvasW;
                this.prevCanvasHeight = canvasH;
            }

            if (scalingChanged) {
                this.logLine(
                    `HW_SCALING_CHANGE from=${this.prevHardwareScaling} to=${hwScale} ` +
                    `frame=${this.frameCount}`
                );
                this.prevHardwareScaling = hwScale;
            }

            // --- RAF dt anomalies ---
            if (rafDt > 1000 && this.frameCount > 1) {
                this.logLine(
                    `RAF_STALL dt=${rafDt.toFixed(0)}ms frame=${this.frameCount} ` +
                    `visibility=${document.visibilityState}`
                );
            } else if (rafDt > 100 && this.frameCount > 1 && this.frameCount <= 300) {
                // Only log sub-1s stalls for first 300 frames to avoid spam
                this.logLine(
                    `RAF_SLOW dt=${rafDt.toFixed(0)}ms frame=${this.frameCount}`
                );
            }

            // --- Periodic snapshot ---
            if (this.frameCount % this.config.snapshotInterval === 0 || this.frameCount <= 5) {
                const snapshot = this.captureSnapshot(rafDt);
                this.snapshots.push(snapshot);
            }

            // --- PHYSICAL_READY_FRAME Detection ---
            if (!this.physicalReadyFrame) {
                const ready = this.checkPhysicalReady(engineW, engineH, canvasW, canvasH, hwScale, engineBufferMatch);
                if (ready) {
                    const snapshot = this.captureSnapshot(rafDt);
                    this.physicalReadyFrame = {
                        frame: this.frameCount,
                        dt,
                        trigger: ready,
                        snapshot,
                    };
                    this.logLine(
                        `★ PHYSICAL_READY_FRAME at frame=${this.frameCount} dt=${dt.toFixed(0)}ms ` +
                        `trigger="${ready}" ` +
                        `canvas=${canvasW}x${canvasH} engine=${engineW}x${engineH} ` +
                        `hwScale=${hwScale}`
                    );
                    // Don't stop — continue monitoring for stability confirmation
                }
            }
        });
    }

    private teardownFrameObserver(): void {
        if (this.frameObserver) {
            this.scene.onBeforeRenderObservable.remove(this.frameObserver);
            this.frameObserver = null;
        }
    }

    // ============================================================
    // PHYSICAL_READY_FRAME Detection
    // ============================================================

    private checkPhysicalReady(
        engineW: number,
        engineH: number,
        canvasW: number,
        canvasH: number,
        hwScale: number,
        engineBufferMatch: boolean
    ): string | null {
        // Condition 1: Canvas size ≠ 0
        if (canvasW === 0 || canvasH === 0) return null;

        // Condition 2: Engine render size == canvas buffer size (accounting for scaling)
        if (!engineBufferMatch) return null;

        // Condition 3: Hardware scaling applied and non-zero
        if (hwScale <= 0) return null;

        // Condition 4: Post-process has executed at least once (if pipeline exists)
        const camera = this.scene.activeCamera;
        if (camera) {
            const ppManager = (camera as any)._postProcesses as BABYLON.PostProcess[] | undefined;
            if (ppManager && ppManager.length > 0) {
                // Check if any post-process has been applied (has a non-null _textures entry)
                const anyExecuted = ppManager.some((pp: any) => pp && pp._textures?.data?.length > 0);
                if (!anyExecuted) return null;
            }
        }

        // All conditions met
        return `canvas=${canvasW}x${canvasH},engine=${engineW}x${engineH},hwScale=${hwScale}`;
    }

    // ============================================================
    // ResizeObserver — Canvas DOM Resize Detection
    // ============================================================

    private setupResizeObserver(): void {
        if (!this.canvas || typeof ResizeObserver === 'undefined') return;

        this.resizeObserver = new ResizeObserver((entries) => {
            if (!this.active) return;

            for (const entry of entries) {
                const dt = performance.now() - this.startTime;
                const rect = entry.contentRect;
                const engineW = this.engine.getRenderWidth();
                const engineH = this.engine.getRenderHeight();

                const event: ResizeEvent = {
                    dt,
                    source: 'ResizeObserver',
                    canvasWidth: rect.width,
                    canvasHeight: rect.height,
                    engineWidth: engineW,
                    engineHeight: engineH,
                };
                this.resizeEvents.push(event);

                this.logLine(
                    `RESIZE_OBSERVER dt=${dt.toFixed(0)}ms ` +
                    `contentRect=${rect.width.toFixed(0)}x${rect.height.toFixed(0)} ` +
                    `engine=${engineW}x${engineH} frame=${this.frameCount}`
                );
            }
        });

        this.resizeObserver.observe(this.canvas);
    }

    private teardownResizeObserver(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    // ============================================================
    // Window Resize Event
    // ============================================================

    private setupWindowResize(): void {
        this.windowResizeListener = () => {
            if (!this.active) return;

            const dt = performance.now() - this.startTime;
            const engineW = this.engine.getRenderWidth();
            const engineH = this.engine.getRenderHeight();
            const canvasW = this.canvas?.width ?? 0;
            const canvasH = this.canvas?.height ?? 0;

            const event: ResizeEvent = {
                dt,
                source: 'window.resize',
                canvasWidth: canvasW,
                canvasHeight: canvasH,
                engineWidth: engineW,
                engineHeight: engineH,
            };
            this.resizeEvents.push(event);

            this.logLine(
                `WINDOW_RESIZE dt=${dt.toFixed(0)}ms ` +
                `canvas=${canvasW}x${canvasH} engine=${engineW}x${engineH} ` +
                `frame=${this.frameCount}`
            );
        };

        window.addEventListener('resize', this.windowResizeListener);
    }

    private teardownWindowResize(): void {
        if (this.windowResizeListener) {
            window.removeEventListener('resize', this.windowResizeListener);
            this.windowResizeListener = null;
        }
    }

    // ============================================================
    // Visibility Monitor
    // ============================================================

    private setupVisibilityMonitor(): void {
        this.visibilityListener = () => {
            if (!this.active) return;

            const dt = performance.now() - this.startTime;
            this.logLine(
                `VISIBILITY_CHANGE dt=${dt.toFixed(0)}ms ` +
                `state=${document.visibilityState} frame=${this.frameCount}`
            );
        };

        document.addEventListener('visibilitychange', this.visibilityListener);
    }

    private teardownVisibilityMonitor(): void {
        if (this.visibilityListener) {
            document.removeEventListener('visibilitychange', this.visibilityListener);
            this.visibilityListener = null;
        }
    }

    // ============================================================
    // Engine.resize() Interception
    // ============================================================

    private interceptEngineResize(): void {
        const engine = this.engine as any;
        this.originalResize = engine.resize?.bind(engine) ?? null;

        if (typeof engine.resize === 'function') {
            engine.resize = () => {
                this.resizeCallCount++;
                const dt = performance.now() - this.startTime;
                const beforeW = this.engine.getRenderWidth();
                const beforeH = this.engine.getRenderHeight();

                // Call original
                this.originalResize?.();

                const afterW = this.engine.getRenderWidth();
                const afterH = this.engine.getRenderHeight();
                const changed = (beforeW !== afterW || beforeH !== afterH);

                const event: ResizeEvent = {
                    dt,
                    source: 'engine.resize_call',
                    canvasWidth: this.canvas?.width ?? 0,
                    canvasHeight: this.canvas?.height ?? 0,
                    engineWidth: afterW,
                    engineHeight: afterH,
                };
                this.resizeEvents.push(event);

                this.logLine(
                    `ENGINE_RESIZE_CALL #${this.resizeCallCount} dt=${dt.toFixed(0)}ms ` +
                    `before=${beforeW}x${beforeH} after=${afterW}x${afterH} ` +
                    `changed=${changed} frame=${this.frameCount}`
                );
            };
        }
    }

    private restoreEngineResize(): void {
        if (this.originalResize) {
            (this.engine as any).resize = this.originalResize;
            this.originalResize = null;
        }
    }

    // ============================================================
    // Snapshot Capture
    // ============================================================

    private captureSnapshot(rafDt: number): PhysicalFrameSnapshot {
        const dt = performance.now() - this.startTime;
        const canvasCSSWidth = this.canvas?.clientWidth ?? 0;
        const canvasCSSHeight = this.canvas?.clientHeight ?? 0;
        const canvasBufferWidth = this.canvas?.width ?? 0;
        const canvasBufferHeight = this.canvas?.height ?? 0;
        const engineRenderWidth = this.engine.getRenderWidth();
        const engineRenderHeight = this.engine.getRenderHeight();
        const hardwareScalingLevel = this.engine.getHardwareScalingLevel();
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

        // CSS * DPR ≈ buffer?
        const expectedBufferW = Math.round(canvasCSSWidth * dpr);
        const expectedBufferH = Math.round(canvasCSSHeight * dpr);
        const cssBufferMatch = (
            Math.abs(canvasBufferWidth - expectedBufferW) <= 1 &&
            Math.abs(canvasBufferHeight - expectedBufferH) <= 1
        );

        // Engine render === buffer / hwScale?
        const expectedEngineW = Math.floor(canvasBufferWidth / hardwareScalingLevel) || 0;
        const expectedEngineH = Math.floor(canvasBufferHeight / hardwareScalingLevel) || 0;
        const engineBufferMatch = (engineRenderWidth === expectedEngineW && engineRenderHeight === expectedEngineH);

        // Post-process state
        const camera = this.scene.activeCamera;
        let postProcessActive = false;
        let postProcessCount = 0;
        if (camera) {
            const pps = (camera as any)._postProcesses as BABYLON.PostProcess[] | undefined;
            if (pps) {
                postProcessCount = pps.filter((pp: any) => pp != null).length;
                postProcessActive = postProcessCount > 0;
            }
        }

        return {
            dt,
            frame: this.frameCount,
            canvasCSSWidth,
            canvasCSSHeight,
            canvasBufferWidth,
            canvasBufferHeight,
            engineRenderWidth,
            engineRenderHeight,
            hardwareScalingLevel,
            cssBufferMatch,
            engineBufferMatch,
            rafDt,
            documentVisibility: document.visibilityState,
            postProcessActive,
            postProcessCount,
        };
    }

    // ============================================================
    // Report Generation
    // ============================================================

    /**
     * Generate the full probe report.
     */
    getReport(): PhysicalProbeReport {
        const duration = performance.now() - this.startTime;

        // RAF dt histogram
        const buckets = new Map<string, number>();
        for (const dt of this.rafDts) {
            let bucket: string;
            if (dt < 20) bucket = '<20ms';
            else if (dt < 50) bucket = '20-50ms';
            else if (dt < 100) bucket = '50-100ms';
            else if (dt < 500) bucket = '100-500ms';
            else if (dt < 1000) bucket = '500ms-1s';
            else if (dt < 5000) bucket = '1s-5s';
            else bucket = '>5s';
            buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
        }
        const rafDtHistogram = Array.from(buckets.entries())
            .map(([bucket, count]) => ({ bucket, count }));

        // Stats
        const avgRafDt = this.rafDts.length > 0
            ? this.rafDts.reduce((a, b) => a + b, 0) / this.rafDts.length
            : 0;
        const maxRafDt = this.rafDts.length > 0
            ? Math.max(...this.rafDts)
            : 0;

        return {
            startTime: this.startTime,
            durationMs: duration,
            totalFrames: this.frameCount,
            physicalReadyFrame: this.physicalReadyFrame,
            resizeEvents: this.resizeEvents,
            snapshots: this.snapshots,
            rafDtHistogram,
            stats: {
                avgRafDt,
                maxRafDt,
                framesAbove100ms: this.rafDts.filter(d => d > 100).length,
                framesAbove500ms: this.rafDts.filter(d => d > 500).length,
                framesAbove1000ms: this.rafDts.filter(d => d > 1000).length,
                firstResizeAt: this.resizeEvents.length > 0 ? this.resizeEvents[0].dt : null,
                physicalReadyAt: this.physicalReadyFrame?.dt ?? null,
                engineSizeZeroFrames: this.engineSizeZeroFrames,
                canvasSizeZeroFrames: this.canvasSizeZeroFrames,
                sizeMismatchFrames: this.sizeMismatchFrames,
            },
        };
    }

    /**
     * Export report as JSON string.
     */
    exportJSON(): string {
        return JSON.stringify(this.getReport(), null, 2);
    }

    /**
     * Print a concise analysis to console.
     */
    printAnalysis(): void {
        const report = this.getReport();
        const s = report.stats;

        console.log('[PHYSICAL_PROBE] ========== ANALYSIS ==========');
        console.log(`[PHYSICAL_PROBE] Duration: ${report.durationMs.toFixed(0)}ms, Frames: ${report.totalFrames}`);
        console.log(`[PHYSICAL_PROBE] RAF dt: avg=${s.avgRafDt.toFixed(1)}ms, max=${s.maxRafDt.toFixed(0)}ms`);
        console.log(`[PHYSICAL_PROBE] Stalls: >100ms=${s.framesAbove100ms}, >500ms=${s.framesAbove500ms}, >1s=${s.framesAbove1000ms}`);
        console.log(`[PHYSICAL_PROBE] Size anomalies: engineZero=${s.engineSizeZeroFrames}, canvasZero=${s.canvasSizeZeroFrames}, mismatch=${s.sizeMismatchFrames}`);
        console.log(`[PHYSICAL_PROBE] First resize at: ${s.firstResizeAt !== null ? s.firstResizeAt.toFixed(0) + 'ms' : 'NEVER'}`);
        console.log(`[PHYSICAL_PROBE] PHYSICAL_READY_FRAME: ${s.physicalReadyAt !== null ? s.physicalReadyAt.toFixed(0) + 'ms' : 'NEVER ACHIEVED'}`);
        console.log('[PHYSICAL_PROBE] Resize events:', report.resizeEvents.length);
        report.resizeEvents.forEach((e, i) => {
            console.log(`[PHYSICAL_PROBE]   #${i}: source=${e.source} dt=${e.dt.toFixed(0)}ms canvas=${e.canvasWidth}x${e.canvasHeight} engine=${e.engineWidth}x${e.engineHeight}`);
        });
        console.log('[PHYSICAL_PROBE] RAF dt histogram:');
        report.rafDtHistogram.forEach(h => {
            console.log(`[PHYSICAL_PROBE]   ${h.bucket}: ${h.count} frames`);
        });

        // Diagnostic conclusion
        console.log('[PHYSICAL_PROBE] ========== DIAGNOSIS ==========');
        if (s.physicalReadyAt === null) {
            console.error('[PHYSICAL_PROBE] Engine NEVER reached physical ready state!');
            if (s.canvasSizeZeroFrames > 0) {
                console.error('[PHYSICAL_PROBE] → Canvas buffer was 0x0 for', s.canvasSizeZeroFrames, 'frames');
            }
            if (s.sizeMismatchFrames > report.totalFrames * 0.9) {
                console.error('[PHYSICAL_PROBE] → Engine/canvas size mismatch persisted (>90% frames)');
            }
        } else if (s.physicalReadyAt > 5000) {
            console.warn(`[PHYSICAL_PROBE] Physical ready delayed by ${(s.physicalReadyAt / 1000).toFixed(1)}s`);
            if (s.firstResizeAt !== null && Math.abs(s.firstResizeAt - s.physicalReadyAt) < 100) {
                console.warn('[PHYSICAL_PROBE] → PHYSICAL_READY coincided with first resize event');
                console.warn('[PHYSICAL_PROBE] → DIAGNOSIS: Engine was rendering to stale framebuffer until resize');
            }
        }

        if (s.framesAbove1000ms > 0) {
            console.warn(`[PHYSICAL_PROBE] → ${s.framesAbove1000ms} frames had >1s RAF gaps (possible background throttling)`);
        }

        console.log('[PHYSICAL_PROBE] =============================================');
    }

    // ============================================================
    // Internal Logging
    // ============================================================

    private logLine(msg: string): void {
        if (!this.config.consoleOutput) return;
        const dt = performance.now() - this.startTime;
        console.log(`[PHYSICAL_PROBE] t=${dt.toFixed(0)}ms ${msg}`);
    }
}
