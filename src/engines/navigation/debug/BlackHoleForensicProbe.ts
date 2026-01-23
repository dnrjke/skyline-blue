/**
 * BlackHoleForensicProbe — Forensic-Grade Physical State Timeline Reconstruction
 *
 * PURPOSE:
 * Postmortem-level investigation of the "Resize Black Hole":
 * a 4-minute+ period where RAF dt is locked at ~100ms, engine renders to stale
 * framebuffer, and PHYSICAL_READY is never achieved despite logical readiness.
 *
 * WHAT THIS PROVES:
 * - Exact RAF scheduling cadence (browser-level, independent of Babylon)
 * - Engine _renderLoop entry/exit timing (Babylon internal)
 * - Resize event timeline (who called, when, what changed)
 * - Canvas CSS vs buffer vs engine size convergence timeline
 * - Anomaly classification with physical evidence
 * - False-positive readiness detection
 *
 * EXPLICITLY NOT TRACKED:
 * - mesh.visibility / isEnabled / activeMeshes
 * - scene.isReady() / material.isReady()
 * - Any logical loading state flags
 *
 * DESIGN CONSTRAINTS:
 * - Every frame gets a record (not sampled)
 * - Time-series is monotonic and reconstructable
 * - Survives minute-long stalls
 * - Independent RAF measurement (our own rAF chain, separate from Babylon)
 * - No single-point timestamps — everything is time-series
 *
 * KEY DEFINITION: PHYSICAL_READY
 * The first frame where ALL of the following hold simultaneously for
 * STABLE_FRAME_COUNT consecutive frames:
 *   1. RAF cadence stable (variance from expected < RAF_JITTER_TOLERANCE_MS)
 *   2. Canvas buffer > 0 in both dimensions
 *   3. Engine render dimensions match canvas buffer (accounting for hwScale)
 *   4. No active RAF frequency lock at degraded rate (>2x expected interval)
 *   5. At least one resize event has occurred since probe start
 */

import * as BABYLON from '@babylonjs/core';

// ============================================================
// Constants
// ============================================================

/** Frames required for PHYSICAL_READY stability confirmation */
const STABLE_FRAME_COUNT = 8;

/**
 * PHYSICAL_READY must sustain for this many milliseconds.
 * A momentary pass does NOT count — state must hold for this duration.
 */
const PHYSICAL_READY_SUSTAIN_MS = 500;

/** Expected RAF interval at 60fps */
const EXPECTED_RAF_INTERVAL_MS = 16.67;

/** Maximum RAF dt for "stable cadence" in PHYSICAL_READY check */
const PHYSICAL_READY_MAX_RAF_DT_MS = 42; // ~24fps minimum

/** Frequency lock detection: if N consecutive frames are within this range of each other */
const FREQUENCY_LOCK_TOLERANCE_MS = 5;
const FREQUENCY_LOCK_MIN_FRAMES = 10;

/** Maximum number of frame records to store (prevents OOM at long durations) */
const MAX_FRAME_RECORDS = 100_000;

/** Anomaly detection runs every N frames */
const ANOMALY_CHECK_INTERVAL = 30;

/** Resize starvation threshold: if mismatch persists this long without resize, critical */
const RESIZE_STARVATION_THRESHOLD_MS = 5000;

// ============================================================
// Types
// ============================================================

/**
 * Independent RAF Record — Each tick of OUR requestAnimationFrame chain.
 * This chain is COMPLETELY SEPARATE from Babylon's render loop.
 * If Babylon stops, this keeps ticking. If Babylon runs, this is NOT influenced.
 * This gives us ground truth for browser RAF scheduling behavior.
 */
export interface IndependentRafRecord {
    /** Monotonic tick index (our own counter) */
    tick: number;
    /** Absolute timestamp from performance.now() */
    absTime: number;
    /** Delta from previous tick (ms) */
    dt: number;
    /** Browser visibility state at this tick */
    visibilityState: DocumentVisibilityState;
}

/**
 * Resize Starvation State — Continuous state tracking (not event-based).
 * Records HOW LONG the system has been without resize, not just when resizes arrive.
 */
export interface ResizeStarvationState {
    /** Is currently starved (mismatch with no resize for threshold duration) */
    starved: boolean;
    /** When starvation began (relative to probe start, ms) */
    starvationEntryTime: number;
    /** Current starvation duration (ms, 0 if not starved) */
    currentDurationMs: number;
    /** Time since last resize callback of ANY kind (ms) */
    timeSinceLastResizeMs: number;
    /** Time since last EFFECTIVE resize (one that actually changed dimensions) */
    timeSinceLastEffectiveResizeMs: number;
    /** Total accumulated starvation time during probe lifetime (ms) */
    totalStarvationMs: number;
}

export interface ForensicFrameRecord {
    /** Monotonic frame index */
    index: number;
    /** Absolute time (performance.now) */
    absTime: number;
    /** Time relative to probe start (ms) */
    relTime: number;

    // RAF timing (from independent RAF chain)
    /** Independent RAF dt (our own requestAnimationFrame measurement) */
    independentRafDt: number;

    // Babylon engine observables timing (relative to frame start)
    /** engine.onBeginFrameObservable timestamp */
    beginFrameAt: number;
    /** engine.onEndFrameObservable timestamp */
    endFrameAt: number;
    /** scene.onBeforeRenderObservable timestamp */
    beforeRenderAt: number;
    /** scene.onAfterRenderObservable timestamp */
    afterRenderAt: number;

    /** Duration: endFrame - beginFrame (engine frame time) */
    engineFrameDuration: number;
    /** Duration: afterRender - beforeRender (scene render time) */
    sceneRenderDuration: number;
    /** Gap: beginFrame(N) - endFrame(N-1) (inter-frame dead time) */
    interFrameGap: number;

    // Physical state
    canvasCSSWidth: number;
    canvasCSSHeight: number;
    canvasBufferWidth: number;
    canvasBufferHeight: number;
    engineRenderWidth: number;
    engineRenderHeight: number;
    hardwareScalingLevel: number;
    devicePixelRatio: number;

    // Derived convergence flags
    /** canvas.width matches engine render (with hwScale) */
    sizeConverged: boolean;
    /** canvas CSS * DPR matches canvas buffer */
    dprConverged: boolean;

    // Page state
    visibilityState: DocumentVisibilityState;
}

export interface ForensicResizeEvent {
    /** Absolute timestamp */
    absTime: number;
    /** Time relative to probe start (ms) */
    relTime: number;
    /** Frame index at time of event */
    frameAtEvent: number;
    /** Event source */
    source: 'ResizeObserver' | 'window.resize' | 'engine.resize()' | 'orientationchange';
    /** Pre-resize state */
    before: {
        canvasBufferW: number;
        canvasBufferH: number;
        engineRenderW: number;
        engineRenderH: number;
        hwScale: number;
    };
    /** Post-resize state */
    after: {
        canvasBufferW: number;
        canvasBufferH: number;
        engineRenderW: number;
        engineRenderH: number;
        hwScale: number;
    };
    /** Whether engine dimensions actually changed */
    effectiveChange: boolean;
    /** Stack trace snippet (for engine.resize() calls) */
    callerHint: string;
}

export type ForensicAnomalyType =
    | 'RAF_FREQUENCY_LOCK'       // RAF dt locked at non-16ms value for extended period
    | 'RESIZE_STARVATION'        // Canvas/engine mismatch with no resize events arriving
    | 'CANVAS_ENGINE_MISMATCH'   // Persistent size mismatch (>N frames)
    | 'RENDER_LOOP_STALL'        // Gap between frames exceeds threshold
    | 'FALSE_READY'              // Logical ready while physical not ready
    | 'DPR_DESYNC'               // hwScale doesn't match 1/DPR for extended period
    | 'RAF_BACKGROUND_THROTTLE'  // RAF running at reduced frequency (background tab)
    | 'ENGINE_RESIZE_NOOP';      // engine.resize() called but nothing changed

export interface ForensicAnomaly {
    type: ForensicAnomalyType;
    /** First frame where anomaly was detected */
    startFrame: number;
    /** Last frame where anomaly was active (updated live) */
    endFrame: number;
    /** Absolute start time */
    startTime: number;
    /** Absolute end time */
    endTime: number;
    /** Duration in ms */
    durationMs: number;
    /** Severity classification */
    severity: 'critical' | 'warning' | 'info';
    /** Physical evidence string */
    evidence: string;
    /** Whether anomaly is still active (not yet closed) */
    active: boolean;
}

export interface ForensicPhaseMarker {
    /** Phase name */
    name: string;
    /** Whether this is a logical or physical phase */
    layer: 'logical' | 'physical';
    /** Time relative to probe start */
    relTime: number;
    /** Frame index at marker */
    frame: number;
    /** Optional metadata */
    meta?: Record<string, unknown>;
}

export interface PhysicalReadyDefinition {
    /** Frame index where PHYSICAL_READY was first SUSTAINED */
    frame: number;
    /** Time relative to probe start when sustain period BEGAN (ms) */
    relTime: number;
    /** Time when sustain period was CONFIRMED (relTime + sustainMs) */
    confirmedAt: number;
    /** How long the ready state was sustained before confirmation (ms) */
    sustainedMs: number;
    /** What made it ready (evidence) */
    evidence: string;
    /** How many stable frames preceded confirmation */
    stableCount: number;
    /** Trigger event (usually 'resize' or 'convergence') */
    trigger: string;
    /** Whether this was revoked later (momentary pass) */
    revoked: boolean;
}

export interface ForensicReport {
    /** Probe start absolute time */
    startAbsTime: number;
    /** Total probe duration (ms) */
    totalDurationMs: number;
    /** Total frames recorded */
    totalFrames: number;
    /** PHYSICAL_READY result (null = never achieved) */
    physicalReady: PhysicalReadyDefinition | null;
    /** All phase markers (logical + physical) */
    phases: ForensicPhaseMarker[];
    /** All detected anomalies */
    anomalies: ForensicAnomaly[];
    /** All resize events */
    resizeEvents: ForensicResizeEvent[];
    /** RAF cadence analysis */
    rafAnalysis: {
        /** Average RAF interval (ms) */
        avgInterval: number;
        /** Median RAF interval (ms) */
        medianInterval: number;
        /** Standard deviation of RAF interval */
        stdDev: number;
        /** Mode (most common interval, ±2ms buckets) */
        modeInterval: number;
        /** Distribution histogram */
        histogram: { bucket: string; count: number; pct: number }[];
        /** Whether frequency lock was detected */
        frequencyLockDetected: boolean;
        /** Locked frequency value (if detected) */
        lockedFrequencyMs: number | null;
        /** Duration of longest frequency lock */
        longestLockDurationMs: number;
    };
    /** Canvas/Engine convergence timeline (sampled) */
    convergenceTimeline: {
        relTime: number;
        frame: number;
        converged: boolean;
        canvasBuffer: string;
        engineRender: string;
        hwScale: number;
    }[];
    /**
     * Independent RAF chain records (sampled every 10 ticks for memory).
     * This is SEPARATE from Babylon's render loop — pure browser scheduling truth.
     */
    independentRafSamples: IndependentRafRecord[];
    /** Resize starvation state history (sampled every N frames) */
    starvationHistory: {
        relTime: number;
        frame: number;
        state: ResizeStarvationState;
    }[];
    /** "Why This Duration?" analysis — root cause narrative */
    whyThisDuration: string[];
    /** Diagnosis narrative */
    diagnosis: string[];
}

export interface ForensicProbeConfig {
    /** Max probe duration (ms, default: 600000 = 10min) */
    maxDurationMs?: number;
    /** Console output for events (default: true) */
    consoleOutput?: boolean;
    /** Convergence timeline sample interval (frames, default: 30) */
    convergenceSampleInterval?: number;
}

// ============================================================
// BlackHoleForensicProbe
// ============================================================

export class BlackHoleForensicProbe {
    private scene: BABYLON.Scene;
    private engine: BABYLON.AbstractEngine;
    private canvas: HTMLCanvasElement | null;
    private config: Required<ForensicProbeConfig>;

    // Lifecycle
    private active: boolean = false;
    private disposed: boolean = false;
    private startTime: number = 0;

    // Frame records (time-series)
    private frames: ForensicFrameRecord[] = [];
    private frameIndex: number = 0;

    // Current frame timing slots (populated by observers, committed at afterRender)
    private currentBeginFrame: number = 0;
    private currentEndFrame: number = 0;
    private currentBeforeRender: number = 0;
    private currentAfterRender: number = 0;
    private prevEndFrame: number = 0;

    // Independent RAF chain — COMPLETELY SEPARATE from Babylon's render loop.
    // If Babylon stops, this keeps ticking. If Babylon runs, this is unaffected.
    private independentRafId: number = 0;
    private independentRafTick: number = 0;
    private lastIndependentRafTime: number = 0;
    private currentIndependentDt: number = 0;
    private independentRafRecords: IndependentRafRecord[] = [];
    /** Sampled records for report (every 10 ticks to save memory) */
    private independentRafSamples: IndependentRafRecord[] = [];

    // Resize events
    private resizeEvents: ForensicResizeEvent[] = [];
    private resizeObserver: ResizeObserver | null = null;
    private windowResizeHandler: (() => void) | null = null;
    private orientationHandler: (() => void) | null = null;
    private originalEngineResize: (() => void) | null = null;
    private engineResizeCallCount: number = 0;

    // Resize Starvation State — continuous tracking
    private lastResizeTime: number = 0;
    private lastEffectiveResizeTime: number = 0;
    private starvationEntryTime: number = 0;
    private isStarved: boolean = false;
    private totalStarvationMs: number = 0;
    private starvationHistory: ForensicReport['starvationHistory'] = [];

    // Visibility
    private visibilityHandler: (() => void) | null = null;

    // Phase markers
    private phases: ForensicPhaseMarker[] = [];

    // Anomaly detection
    private anomalies: ForensicAnomaly[] = [];
    private activeAnomalies: Map<ForensicAnomalyType, ForensicAnomaly> = new Map();

    // PHYSICAL_READY tracking (sustained condition, not single-point)
    private physicalReady: PhysicalReadyDefinition | null = null;
    private consecutiveStableFrames: number = 0;
    private physicalReadySustainStart: number = 0; // When sustain period began
    private physicalReadyCandidate: boolean = false; // Currently meeting conditions
    private resizeOccurred: boolean = false;

    // Convergence timeline
    private convergenceTimeline: ForensicReport['convergenceTimeline'] = [];

    // Observers
    private beginFrameObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.AbstractEngine>> = null;
    private endFrameObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.AbstractEngine>> = null;
    private beforeRenderObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private afterRenderObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Auto-stop timer
    private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(scene: BABYLON.Scene, config: ForensicProbeConfig = {}) {
        this.scene = scene;
        this.engine = scene.getEngine();
        this.canvas = this.engine.getRenderingCanvas() as HTMLCanvasElement | null;
        this.config = {
            maxDurationMs: config.maxDurationMs ?? 600_000,
            consoleOutput: config.consoleOutput ?? true,
            convergenceSampleInterval: config.convergenceSampleInterval ?? 30,
        };
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    start(): void {
        if (this.active || this.disposed) return;
        this.active = true;
        this.startTime = performance.now();
        this.frameIndex = 0;
        this.frames = [];
        this.resizeEvents = [];
        this.phases = [];
        this.anomalies = [];
        this.activeAnomalies.clear();
        this.physicalReady = null;
        this.consecutiveStableFrames = 0;
        this.physicalReadySustainStart = 0;
        this.physicalReadyCandidate = false;
        this.resizeOccurred = false;
        this.convergenceTimeline = [];
        this.prevEndFrame = this.startTime;
        this.engineResizeCallCount = 0;

        // Independent RAF state
        this.independentRafTick = 0;
        this.lastIndependentRafTime = this.startTime;
        this.currentIndependentDt = 0;
        this.independentRafRecords = [];
        this.independentRafSamples = [];

        // Resize starvation state
        this.lastResizeTime = this.startTime;
        this.lastEffectiveResizeTime = this.startTime;
        this.starvationEntryTime = 0;
        this.isStarved = false;
        this.totalStarvationMs = 0;
        this.starvationHistory = [];

        // Setup all instrumentation
        this.setupBabylonObservers();
        this.setupIndependentRaf();
        this.setupResizeObserver();
        this.setupWindowResize();
        this.setupOrientationChange();
        this.setupVisibilityMonitor();
        this.interceptEngineResize();

        // Auto-stop
        this.autoStopTimer = setTimeout(() => {
            if (this.active) {
                this.log('AUTO_STOP: maxDurationMs reached');
                this.stop();
            }
        }, this.config.maxDurationMs);

        // Mark start phase
        this.markPhase('FORENSIC_PROBE_START', 'physical');

        this.log(
            `START canvas_css=${this.canvas?.clientWidth}x${this.canvas?.clientHeight} ` +
            `canvas_buf=${this.canvas?.width}x${this.canvas?.height} ` +
            `engine=${this.engine.getRenderWidth()}x${this.engine.getRenderHeight()} ` +
            `hwScale=${this.engine.getHardwareScalingLevel()} ` +
            `dpr=${window.devicePixelRatio} ` +
            `visibility=${document.visibilityState}`
        );
    }

    stop(): void {
        if (!this.active) return;
        this.active = false;

        // Mark stop
        this.markPhase('FORENSIC_PROBE_STOP', 'physical');

        // Finalize starvation state
        if (this.isStarved) {
            const now = performance.now();
            this.totalStarvationMs += (now - this.starvationEntryTime);
            this.isStarved = false;
        }

        // Close all active anomalies
        for (const [, anomaly] of this.activeAnomalies) {
            anomaly.active = false;
            anomaly.endFrame = this.frameIndex;
            anomaly.endTime = performance.now();
            anomaly.durationMs = anomaly.endTime - anomaly.startTime;
        }
        this.activeAnomalies.clear();

        // Teardown
        this.teardownBabylonObservers();
        this.teardownIndependentRaf();
        this.teardownResizeObserver();
        this.teardownWindowResize();
        this.teardownOrientationChange();
        this.teardownVisibilityMonitor();
        this.restoreEngineResize();

        if (this.autoStopTimer) {
            clearTimeout(this.autoStopTimer);
            this.autoStopTimer = null;
        }

        const elapsed = performance.now() - this.startTime;
        this.log(
            `STOP duration=${elapsed.toFixed(0)}ms frames=${this.frameIndex} ` +
            `anomalies=${this.anomalies.length} ` +
            `physicalReady=${this.physicalReady ? `frame ${this.physicalReady.frame}` : 'NEVER'}`
        );
    }

    dispose(): void {
        this.stop();
        this.disposed = true;
        this.frames = [];
        this.resizeEvents = [];
        this.independentRafRecords = [];
        this.independentRafSamples = [];
        this.starvationHistory = [];
    }

    isActive(): boolean {
        return this.active;
    }

    // ============================================================
    // Phase Markers
    // ============================================================

    markPhase(name: string, layer: 'logical' | 'physical', meta?: Record<string, unknown>): void {
        const relTime = performance.now() - this.startTime;
        this.phases.push({
            name,
            layer,
            relTime,
            frame: this.frameIndex,
            meta,
        });
        this.log(`PHASE [${layer}] "${name}" frame=${this.frameIndex}`);
    }

    // ============================================================
    // Babylon Observables — Frame Lifecycle Timing
    // ============================================================

    private setupBabylonObservers(): void {
        // engine.onBeginFrameObservable: start of engine frame
        this.beginFrameObs = this.engine.onBeginFrameObservable.add(() => {
            if (!this.active) return;
            this.currentBeginFrame = performance.now();
        });

        // engine.onEndFrameObservable: end of engine frame
        this.endFrameObs = this.engine.onEndFrameObservable.add(() => {
            if (!this.active) return;
            this.currentEndFrame = performance.now();
        });

        // scene.onBeforeRenderObservable: before scene render
        this.beforeRenderObs = this.scene.onBeforeRenderObservable.add(() => {
            if (!this.active) return;
            this.currentBeforeRender = performance.now();
        });

        // scene.onAfterRenderObservable: after scene render — COMMIT FRAME RECORD
        this.afterRenderObs = this.scene.onAfterRenderObservable.add(() => {
            if (!this.active) return;
            this.currentAfterRender = performance.now();
            this.commitFrameRecord();
        });
    }

    private teardownBabylonObservers(): void {
        if (this.beginFrameObs) {
            this.engine.onBeginFrameObservable.remove(this.beginFrameObs);
            this.beginFrameObs = null;
        }
        if (this.endFrameObs) {
            this.engine.onEndFrameObservable.remove(this.endFrameObs);
            this.endFrameObs = null;
        }
        if (this.beforeRenderObs) {
            this.scene.onBeforeRenderObservable.remove(this.beforeRenderObs);
            this.beforeRenderObs = null;
        }
        if (this.afterRenderObs) {
            this.scene.onAfterRenderObservable.remove(this.afterRenderObs);
            this.afterRenderObs = null;
        }
    }

    // ============================================================
    // Independent RAF Chain — Browser Cadence Measurement
    // ============================================================

    /**
     * Independent RAF chain — COMPLETELY SEPARATE from Babylon's render loop.
     *
     * Contract:
     * - If Babylon stops/freezes, this chain KEEPS TICKING
     * - If Babylon runs, this chain is NOT influenced or correlated
     * - Each tick records: frame number, absolute timestamp, dt, visibility state
     * - This gives ground truth for browser's RAF scheduling behavior
     */
    private setupIndependentRaf(): void {
        const tick = (now: number) => {
            if (!this.active) return;

            this.currentIndependentDt = now - this.lastIndependentRafTime;
            this.lastIndependentRafTime = now;
            this.independentRafTick++;

            // Record every tick (full timeline for forensic reconstruction)
            const record: IndependentRafRecord = {
                tick: this.independentRafTick,
                absTime: now,
                dt: this.currentIndependentDt,
                visibilityState: document.visibilityState,
            };

            // Store all records (capped at MAX_FRAME_RECORDS)
            if (this.independentRafRecords.length < MAX_FRAME_RECORDS) {
                this.independentRafRecords.push(record);
            }

            // Sample every 10 ticks for the report (saves memory for long runs)
            if (this.independentRafTick % 10 === 0) {
                this.independentRafSamples.push(record);
            }

            this.independentRafId = requestAnimationFrame(tick);
        };
        this.independentRafId = requestAnimationFrame(tick);
    }

    private teardownIndependentRaf(): void {
        if (this.independentRafId) {
            cancelAnimationFrame(this.independentRafId);
            this.independentRafId = 0;
        }
    }

    // ============================================================
    // Frame Record Commit (called at onAfterRender)
    // ============================================================

    private commitFrameRecord(): void {
        if (this.frameIndex >= MAX_FRAME_RECORDS) {
            // Ring buffer: overwrite oldest
            const idx = this.frameIndex % MAX_FRAME_RECORDS;
            this.frames[idx] = this.buildFrameRecord();
        } else {
            this.frames.push(this.buildFrameRecord());
        }

        // Update resize starvation state
        this.updateStarvationState();

        // Post-commit analysis
        this.checkPhysicalReady();
        if (this.frameIndex % ANOMALY_CHECK_INTERVAL === 0 && this.frameIndex > 0) {
            this.runAnomalyDetection();
        }

        // Convergence timeline sample
        if (this.frameIndex % this.config.convergenceSampleInterval === 0) {
            this.sampleConvergence();
            this.sampleStarvationState();
        }

        // Update for next frame
        this.prevEndFrame = this.currentEndFrame;
        this.frameIndex++;
    }

    /**
     * Resize Starvation State — CONTINUOUS tracking.
     * This answers: "How long has the system been WITHOUT a resize?"
     * Not event-based, but STATE DURATION-based.
     */
    private updateStarvationState(): void {
        const now = performance.now();
        const frame = this.frames[Math.min(this.frameIndex, MAX_FRAME_RECORDS - 1)];
        if (!frame) return;

        const timeSinceLastResize = now - this.lastResizeTime;
        const hasMismatch = !frame.sizeConverged && frame.canvasBufferWidth > 0;

        // Enter starvation: mismatch persists AND no resize for threshold duration
        if (hasMismatch && timeSinceLastResize > RESIZE_STARVATION_THRESHOLD_MS) {
            if (!this.isStarved) {
                this.isStarved = true;
                this.starvationEntryTime = now;
                this.log(
                    `STARVATION_ENTER: no resize for ${(timeSinceLastResize / 1000).toFixed(1)}s ` +
                    `while mismatched (canvas=${frame.canvasBufferWidth}x${frame.canvasBufferHeight} ` +
                    `engine=${frame.engineRenderWidth}x${frame.engineRenderHeight})`
                );
            }
        }

        // Exit starvation: convergence achieved OR resize just arrived
        if (this.isStarved && (frame.sizeConverged || timeSinceLastResize < 100)) {
            const starvationDuration = now - this.starvationEntryTime;
            this.totalStarvationMs += starvationDuration;
            this.isStarved = false;
            this.log(
                `STARVATION_EXIT: lasted ${(starvationDuration / 1000).toFixed(1)}s, ` +
                `resolved by ${frame.sizeConverged ? 'convergence' : 'resize event'}`
            );
        }

        // Continuous starvation accumulation (for active starvation)
        if (this.isStarved) {
            // Update total starvation for reporting
            // (will be finalized at stop())
        }
    }

    private sampleStarvationState(): void {
        const now = performance.now();
        const relTime = now - this.startTime;
        const timeSinceLastResize = now - this.lastResizeTime;
        const timeSinceEffective = now - this.lastEffectiveResizeTime;
        const currentDuration = this.isStarved ? (now - this.starvationEntryTime) : 0;

        this.starvationHistory.push({
            relTime,
            frame: this.frameIndex,
            state: {
                starved: this.isStarved,
                starvationEntryTime: this.isStarved ? (this.starvationEntryTime - this.startTime) : 0,
                currentDurationMs: currentDuration,
                timeSinceLastResizeMs: timeSinceLastResize,
                timeSinceLastEffectiveResizeMs: timeSinceEffective,
                totalStarvationMs: this.totalStarvationMs + currentDuration,
            },
        });
    }

    private buildFrameRecord(): ForensicFrameRecord {
        const now = this.currentAfterRender;
        const relTime = now - this.startTime;
        const canvasCSSWidth = this.canvas?.clientWidth ?? 0;
        const canvasCSSHeight = this.canvas?.clientHeight ?? 0;
        const canvasBufferWidth = this.canvas?.width ?? 0;
        const canvasBufferHeight = this.canvas?.height ?? 0;
        const engineRenderWidth = this.engine.getRenderWidth();
        const engineRenderHeight = this.engine.getRenderHeight();
        const hwScale = this.engine.getHardwareScalingLevel();
        const dpr = window.devicePixelRatio;

        // Size convergence check
        const expectedEngineW = Math.floor(canvasBufferWidth / hwScale) || 0;
        const expectedEngineH = Math.floor(canvasBufferHeight / hwScale) || 0;
        const sizeConverged = (
            canvasBufferWidth > 0 &&
            canvasBufferHeight > 0 &&
            engineRenderWidth === expectedEngineW &&
            engineRenderHeight === expectedEngineH
        );

        // DPR convergence
        const expectedBufferW = Math.round(canvasCSSWidth * dpr);
        const expectedBufferH = Math.round(canvasCSSHeight * dpr);
        const dprConverged = (
            canvasCSSWidth > 0 &&
            Math.abs(canvasBufferWidth - expectedBufferW) <= 2 &&
            Math.abs(canvasBufferHeight - expectedBufferH) <= 2
        );

        return {
            index: this.frameIndex,
            absTime: now,
            relTime,
            independentRafDt: this.currentIndependentDt,
            beginFrameAt: this.currentBeginFrame - this.startTime,
            endFrameAt: this.currentEndFrame - this.startTime,
            beforeRenderAt: this.currentBeforeRender - this.startTime,
            afterRenderAt: relTime,
            engineFrameDuration: this.currentEndFrame - this.currentBeginFrame,
            sceneRenderDuration: this.currentAfterRender - this.currentBeforeRender,
            interFrameGap: this.currentBeginFrame - this.prevEndFrame,
            canvasCSSWidth,
            canvasCSSHeight,
            canvasBufferWidth,
            canvasBufferHeight,
            engineRenderWidth,
            engineRenderHeight,
            hardwareScalingLevel: hwScale,
            devicePixelRatio: dpr,
            sizeConverged,
            dprConverged,
            visibilityState: document.visibilityState,
        };
    }

    // ============================================================
    // PHYSICAL_READY Detection
    // ============================================================

    /**
     * PHYSICAL_READY Detection — Sustained Condition Check
     *
     * PHYSICAL_READY is NOT a single-frame pass.
     * It requires ALL conditions to hold for STABLE_FRAME_COUNT frames
     * AND PHYSICAL_READY_SUSTAIN_MS milliseconds.
     *
     * A momentary pass followed by regression is REVOKED.
     * This prevents false-positives from "one good frame in a sea of bad ones."
     *
     * Conditions (ALL must hold simultaneously):
     *   1. Canvas buffer > 0 in both dimensions
     *   2. Engine/canvas size converged (accounting for hwScale)
     *   3. RAF cadence < PHYSICAL_READY_MAX_RAF_DT_MS (not throttled)
     *   4. At least one resize event has occurred
     *   5. No active critical anomalies (frequency lock, starvation)
     *   6. Resize starvation resolved (isStarved === false)
     *   7. Document visible (visibilityState === 'visible')
     *   8. Hardware scaling stable (same value for N frames)
     */
    private checkPhysicalReady(): void {
        if (this.physicalReady && !this.physicalReady.revoked) return; // Already confirmed

        const frame = this.frames[Math.min(this.frameIndex, MAX_FRAME_RECORDS - 1)];
        if (!frame) return;

        const conditionsMet = this.evaluatePhysicalReadyConditions(frame);

        if (!conditionsMet) {
            // Conditions failed — reset candidate
            if (this.physicalReadyCandidate) {
                this.log(`PHYSICAL_READY candidate REVOKED at frame=${this.frameIndex} (conditions lost)`);
            }
            this.consecutiveStableFrames = 0;
            this.physicalReadyCandidate = false;
            this.physicalReadySustainStart = 0;
            return;
        }

        // Conditions passed this frame
        this.consecutiveStableFrames++;

        if (!this.physicalReadyCandidate && this.consecutiveStableFrames >= STABLE_FRAME_COUNT) {
            // Frame count threshold met — start sustain timer
            this.physicalReadyCandidate = true;
            this.physicalReadySustainStart = performance.now();
            this.log(
                `PHYSICAL_READY candidate STARTED at frame=${this.frameIndex} ` +
                `(need ${PHYSICAL_READY_SUSTAIN_MS}ms sustained)`
            );
        }

        if (this.physicalReadyCandidate) {
            const sustainedMs = performance.now() - this.physicalReadySustainStart;
            if (sustainedMs >= PHYSICAL_READY_SUSTAIN_MS) {
                // CONFIRMED: conditions held for required duration
                const relTime = frame.relTime - sustainedMs; // When sustain began
                this.physicalReady = {
                    frame: this.frameIndex - this.consecutiveStableFrames + STABLE_FRAME_COUNT,
                    relTime,
                    confirmedAt: frame.relTime,
                    sustainedMs,
                    evidence: `converged=${frame.sizeConverged} dpr=${frame.dprConverged} ` +
                        `rafDt=${frame.independentRafDt.toFixed(1)}ms ` +
                        `canvas=${frame.canvasBufferWidth}x${frame.canvasBufferHeight} ` +
                        `engine=${frame.engineRenderWidth}x${frame.engineRenderHeight} ` +
                        `hwScale=${frame.hardwareScalingLevel} visibility=${frame.visibilityState}`,
                    stableCount: this.consecutiveStableFrames,
                    trigger: this.resizeEvents.filter(e => e.effectiveChange).length > 0
                        ? 'post-resize' : 'convergence',
                    revoked: false,
                };

                this.markPhase('PHYSICAL_READY', 'physical', {
                    frame: this.physicalReady.frame,
                    stableFrames: this.consecutiveStableFrames,
                    sustainedMs,
                });

                this.log(
                    `★ PHYSICAL_READY CONFIRMED at frame=${this.frameIndex} ` +
                    `relTime=${frame.relTime.toFixed(0)}ms ` +
                    `sustained=${sustainedMs.toFixed(0)}ms ` +
                    `stableFrames=${this.consecutiveStableFrames} ` +
                    `trigger=${this.physicalReady.trigger}`
                );
            }
        }
    }

    private evaluatePhysicalReadyConditions(frame: ForensicFrameRecord): boolean {
        // Condition 1: Canvas buffer > 0
        if (frame.canvasBufferWidth === 0 || frame.canvasBufferHeight === 0) return false;

        // Condition 2: Engine/canvas size converged
        if (!frame.sizeConverged) return false;

        // Condition 3: RAF cadence stable (not throttled)
        if (frame.independentRafDt > PHYSICAL_READY_MAX_RAF_DT_MS) return false;

        // Condition 4: At least one resize event has occurred
        if (!this.resizeOccurred) return false;

        // Condition 5: No active critical anomalies
        const hasCritical = Array.from(this.activeAnomalies.values())
            .some(a => a.severity === 'critical' && a.active);
        if (hasCritical) return false;

        // Condition 6: Resize starvation resolved
        if (this.isStarved) return false;

        // Condition 7: Document visible
        if (frame.visibilityState !== 'visible') return false;

        // Condition 8: Hardware scaling stable (check last 3 frames for consistency)
        if (this.frameIndex >= 3) {
            const prevIdx = Math.min(this.frameIndex - 1, MAX_FRAME_RECORDS - 1);
            const prevFrame = this.frames[prevIdx];
            if (prevFrame && prevFrame.hardwareScalingLevel !== frame.hardwareScalingLevel) return false;
        }

        return true;
    }

    // ============================================================
    // Anomaly Detection
    // ============================================================

    private runAnomalyDetection(): void {
        this.detectRafFrequencyLock();
        this.detectResizeStarvation();
        this.detectCanvasEngineMismatch();
        this.detectRenderLoopStall();
        this.detectBackgroundThrottle();
        this.detectDprDesync();
    }

    private detectRafFrequencyLock(): void {
        // Check last FREQUENCY_LOCK_MIN_FRAMES frames for dt consistency
        const startIdx = Math.max(0, this.frames.length - FREQUENCY_LOCK_MIN_FRAMES);
        const recentFrames = this.frames.slice(startIdx);
        if (recentFrames.length < FREQUENCY_LOCK_MIN_FRAMES) return;

        const dts = recentFrames.map(f => f.independentRafDt).filter(dt => dt > 0);
        if (dts.length < FREQUENCY_LOCK_MIN_FRAMES) return;

        const avgDt = dts.reduce((a, b) => a + b, 0) / dts.length;
        const maxDev = Math.max(...dts.map(d => Math.abs(d - avgDt)));

        // Locked if: all within tolerance AND not at expected 60fps
        const isLocked = maxDev < FREQUENCY_LOCK_TOLERANCE_MS && avgDt > EXPECTED_RAF_INTERVAL_MS * 1.5;

        if (isLocked) {
            const existing = this.activeAnomalies.get('RAF_FREQUENCY_LOCK');
            if (!existing) {
                this.openAnomaly('RAF_FREQUENCY_LOCK', 'critical',
                    `RAF locked at ${avgDt.toFixed(1)}ms (${(1000 / avgDt).toFixed(1)}fps), ` +
                    `deviation=${maxDev.toFixed(1)}ms, expected=${EXPECTED_RAF_INTERVAL_MS.toFixed(1)}ms`
                );
            } else {
                // Update evidence
                existing.endFrame = this.frameIndex;
                existing.endTime = performance.now();
                existing.durationMs = existing.endTime - existing.startTime;
                existing.evidence =
                    `RAF locked at ${avgDt.toFixed(1)}ms (${(1000 / avgDt).toFixed(1)}fps) ` +
                    `for ${existing.durationMs.toFixed(0)}ms`;
            }
        } else {
            this.closeAnomaly('RAF_FREQUENCY_LOCK');
        }
    }

    private detectResizeStarvation(): void {
        // If canvas/engine mismatch persists for >5s with no resize events
        const frame = this.frames[this.frames.length - 1];
        if (!frame || frame.sizeConverged) {
            this.closeAnomaly('RESIZE_STARVATION');
            return;
        }

        // How long has mismatch persisted?
        let mismatchStart = this.frames.length - 1;
        for (let i = this.frames.length - 2; i >= 0; i--) {
            if (this.frames[i].sizeConverged) break;
            mismatchStart = i;
        }

        const mismatchDuration = frame.relTime - this.frames[mismatchStart].relTime;
        if (mismatchDuration > 5000) {
            // Check if any resize events occurred during this period
            const resizesDuring = this.resizeEvents.filter(
                e => e.relTime >= this.frames[mismatchStart].relTime && e.relTime <= frame.relTime
            );

            if (resizesDuring.length === 0) {
                const existing = this.activeAnomalies.get('RESIZE_STARVATION');
                if (!existing) {
                    this.openAnomaly('RESIZE_STARVATION', 'critical',
                        `Canvas/engine mismatch for ${(mismatchDuration / 1000).toFixed(1)}s ` +
                        `with ZERO resize events. ` +
                        `canvas=${frame.canvasBufferWidth}x${frame.canvasBufferHeight} ` +
                        `engine=${frame.engineRenderWidth}x${frame.engineRenderHeight}`
                    );
                } else {
                    existing.endFrame = this.frameIndex;
                    existing.endTime = performance.now();
                    existing.durationMs = existing.endTime - existing.startTime;
                }
            }
        }
    }

    private detectCanvasEngineMismatch(): void {
        const frame = this.frames[this.frames.length - 1];
        if (!frame) return;

        if (!frame.sizeConverged && frame.canvasBufferWidth > 0) {
            const existing = this.activeAnomalies.get('CANVAS_ENGINE_MISMATCH');
            if (!existing) {
                this.openAnomaly('CANVAS_ENGINE_MISMATCH', 'warning',
                    `canvas=${frame.canvasBufferWidth}x${frame.canvasBufferHeight} ` +
                    `engine=${frame.engineRenderWidth}x${frame.engineRenderHeight} ` +
                    `hwScale=${frame.hardwareScalingLevel}`
                );
            } else {
                existing.endFrame = this.frameIndex;
                existing.endTime = performance.now();
                existing.durationMs = existing.endTime - existing.startTime;
            }
        } else {
            this.closeAnomaly('CANVAS_ENGINE_MISMATCH');
        }
    }

    private detectRenderLoopStall(): void {
        const frame = this.frames[this.frames.length - 1];
        if (!frame) return;

        if (frame.interFrameGap > 500) {
            this.openAnomaly('RENDER_LOOP_STALL', 'warning',
                `Inter-frame gap: ${frame.interFrameGap.toFixed(0)}ms at frame ${frame.index}`
            );
            // Stalls are instantaneous — close immediately after recording
            this.closeAnomaly('RENDER_LOOP_STALL');
        }
    }

    private detectBackgroundThrottle(): void {
        const frame = this.frames[this.frames.length - 1];
        if (!frame) return;

        // Background throttle: RAF at ~1000ms in background tabs
        if (frame.independentRafDt > 900 && frame.visibilityState === 'hidden') {
            const existing = this.activeAnomalies.get('RAF_BACKGROUND_THROTTLE');
            if (!existing) {
                this.openAnomaly('RAF_BACKGROUND_THROTTLE', 'info',
                    `RAF throttled to ${frame.independentRafDt.toFixed(0)}ms (tab hidden)`
                );
            } else {
                existing.endFrame = this.frameIndex;
                existing.endTime = performance.now();
                existing.durationMs = existing.endTime - existing.startTime;
            }
        } else if (frame.visibilityState === 'visible') {
            this.closeAnomaly('RAF_BACKGROUND_THROTTLE');
        }
    }

    private detectDprDesync(): void {
        const frame = this.frames[this.frames.length - 1];
        if (!frame) return;

        if (!frame.dprConverged && frame.canvasCSSWidth > 0) {
            const existing = this.activeAnomalies.get('DPR_DESYNC');
            if (!existing) {
                this.openAnomaly('DPR_DESYNC', 'warning',
                    `DPR desync: css=${frame.canvasCSSWidth}x${frame.canvasCSSHeight} ` +
                    `dpr=${frame.devicePixelRatio} ` +
                    `expected_buf=${Math.round(frame.canvasCSSWidth * frame.devicePixelRatio)}x` +
                    `${Math.round(frame.canvasCSSHeight * frame.devicePixelRatio)} ` +
                    `actual_buf=${frame.canvasBufferWidth}x${frame.canvasBufferHeight}`
                );
            } else {
                existing.endFrame = this.frameIndex;
                existing.endTime = performance.now();
                existing.durationMs = existing.endTime - existing.startTime;
            }
        } else {
            this.closeAnomaly('DPR_DESYNC');
        }
    }

    private openAnomaly(type: ForensicAnomalyType, severity: ForensicAnomaly['severity'], evidence: string): void {
        if (this.activeAnomalies.has(type)) return; // Already tracking

        const anomaly: ForensicAnomaly = {
            type,
            startFrame: this.frameIndex,
            endFrame: this.frameIndex,
            startTime: performance.now(),
            endTime: performance.now(),
            durationMs: 0,
            severity,
            evidence,
            active: true,
        };
        this.anomalies.push(anomaly);
        this.activeAnomalies.set(type, anomaly);
        this.log(`ANOMALY_OPEN [${severity}] ${type}: ${evidence}`);
    }

    private closeAnomaly(type: ForensicAnomalyType): void {
        const anomaly = this.activeAnomalies.get(type);
        if (!anomaly) return;

        anomaly.active = false;
        anomaly.endFrame = this.frameIndex;
        anomaly.endTime = performance.now();
        anomaly.durationMs = anomaly.endTime - anomaly.startTime;
        this.activeAnomalies.delete(type);

        if (anomaly.durationMs > 100) { // Only log significant closures
            this.log(`ANOMALY_CLOSE ${type}: lasted ${anomaly.durationMs.toFixed(0)}ms (${anomaly.startFrame}-${anomaly.endFrame})`);
        }
    }

    // ============================================================
    // Convergence Timeline Sampling
    // ============================================================

    private sampleConvergence(): void {
        const frame = this.frames[this.frames.length - 1];
        if (!frame) return;

        this.convergenceTimeline.push({
            relTime: frame.relTime,
            frame: frame.index,
            converged: frame.sizeConverged,
            canvasBuffer: `${frame.canvasBufferWidth}x${frame.canvasBufferHeight}`,
            engineRender: `${frame.engineRenderWidth}x${frame.engineRenderHeight}`,
            hwScale: frame.hardwareScalingLevel,
        });
    }

    // ============================================================
    // Resize Instrumentation
    // ============================================================

    private setupResizeObserver(): void {
        if (!this.canvas || typeof ResizeObserver === 'undefined') return;

        this.resizeObserver = new ResizeObserver((entries) => {
            if (!this.active) return;
            for (const entry of entries) {
                this.recordResizeEvent('ResizeObserver', entry.contentRect.width, entry.contentRect.height);
            }
        });
        this.resizeObserver.observe(this.canvas);
    }

    private teardownResizeObserver(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
    }

    private setupWindowResize(): void {
        this.windowResizeHandler = () => {
            if (!this.active) return;
            this.recordResizeEvent('window.resize');
        };
        window.addEventListener('resize', this.windowResizeHandler);
    }

    private teardownWindowResize(): void {
        if (this.windowResizeHandler) {
            window.removeEventListener('resize', this.windowResizeHandler);
            this.windowResizeHandler = null;
        }
    }

    private setupOrientationChange(): void {
        this.orientationHandler = () => {
            if (!this.active) return;
            this.recordResizeEvent('orientationchange');
        };
        window.addEventListener('orientationchange', this.orientationHandler);
    }

    private teardownOrientationChange(): void {
        if (this.orientationHandler) {
            window.removeEventListener('orientationchange', this.orientationHandler);
            this.orientationHandler = null;
        }
    }

    private interceptEngineResize(): void {
        const engine = this.engine as any;
        if (typeof engine.resize !== 'function') return;

        this.originalEngineResize = engine.resize.bind(engine);
        engine.resize = () => {
            if (!this.active) {
                this.originalEngineResize?.();
                return;
            }

            this.engineResizeCallCount++;
            const beforeW = this.engine.getRenderWidth();
            const beforeH = this.engine.getRenderHeight();
            const beforeHw = this.engine.getHardwareScalingLevel();

            this.originalEngineResize?.();

            const afterW = this.engine.getRenderWidth();
            const afterH = this.engine.getRenderHeight();
            const afterHw = this.engine.getHardwareScalingLevel();
            const changed = (beforeW !== afterW || beforeH !== afterH || beforeHw !== afterHw);

            const relTime = performance.now() - this.startTime;
            const event: ForensicResizeEvent = {
                absTime: performance.now(),
                relTime,
                frameAtEvent: this.frameIndex,
                source: 'engine.resize()',
                before: {
                    canvasBufferW: this.canvas?.width ?? 0,
                    canvasBufferH: this.canvas?.height ?? 0,
                    engineRenderW: beforeW,
                    engineRenderH: beforeH,
                    hwScale: beforeHw,
                },
                after: {
                    canvasBufferW: this.canvas?.width ?? 0,
                    canvasBufferH: this.canvas?.height ?? 0,
                    engineRenderW: afterW,
                    engineRenderH: afterH,
                    hwScale: afterHw,
                },
                effectiveChange: changed,
                callerHint: this.getCaller(),
            };
            this.resizeEvents.push(event);
            this.resizeOccurred = true;

            // Update starvation timers
            const now = performance.now();
            this.lastResizeTime = now;
            if (changed) {
                this.lastEffectiveResizeTime = now;
                this.log(
                    `ENGINE_RESIZE #${this.engineResizeCallCount} ` +
                    `${beforeW}x${beforeH}→${afterW}x${afterH} ` +
                    `hwScale=${beforeHw}→${afterHw} ` +
                    `caller="${event.callerHint}" ` +
                    `frame=${this.frameIndex}`
                );
            } else {
                // NOOP resize — track but warn less
                if (this.engineResizeCallCount <= 5 || this.engineResizeCallCount % 10 === 0) {
                    this.log(`ENGINE_RESIZE_NOOP #${this.engineResizeCallCount} frame=${this.frameIndex}`);
                }
            }
        };
    }

    private restoreEngineResize(): void {
        if (this.originalEngineResize) {
            (this.engine as any).resize = this.originalEngineResize;
            this.originalEngineResize = null;
        }
    }

    private recordResizeEvent(source: ForensicResizeEvent['source'], cssW?: number, cssH?: number): void {
        const now = performance.now();
        const relTime = now - this.startTime;
        const canvasBufW = this.canvas?.width ?? 0;
        const canvasBufH = this.canvas?.height ?? 0;
        const engineW = this.engine.getRenderWidth();
        const engineH = this.engine.getRenderHeight();
        const hwScale = this.engine.getHardwareScalingLevel();

        const event: ForensicResizeEvent = {
            absTime: now,
            relTime,
            frameAtEvent: this.frameIndex,
            source,
            before: {
                canvasBufferW: canvasBufW,
                canvasBufferH: canvasBufH,
                engineRenderW: engineW,
                engineRenderH: engineH,
                hwScale,
            },
            after: {
                canvasBufferW: canvasBufW,
                canvasBufferH: canvasBufH,
                engineRenderW: engineW,
                engineRenderH: engineH,
                hwScale,
            },
            effectiveChange: false,
            callerHint: source,
        };
        this.resizeEvents.push(event);
        this.resizeOccurred = true;

        // Update starvation timers
        const timeSinceLast = now - this.lastResizeTime;
        this.lastResizeTime = now;

        this.log(
            `RESIZE [${source}] ` +
            `canvas_buf=${canvasBufW}x${canvasBufH} ` +
            `engine=${engineW}x${engineH} ` +
            (cssW !== undefined ? `css=${cssW.toFixed(0)}x${cssH?.toFixed(0)} ` : '') +
            `gap=${(timeSinceLast / 1000).toFixed(1)}s ` +
            `frame=${this.frameIndex}`
        );
    }

    // ============================================================
    // Visibility Monitor
    // ============================================================

    private setupVisibilityMonitor(): void {
        this.visibilityHandler = () => {
            if (!this.active) return;
            const relTime = performance.now() - this.startTime;
            this.log(`VISIBILITY ${document.visibilityState} at ${relTime.toFixed(0)}ms frame=${this.frameIndex}`);
            this.markPhase(`visibility_${document.visibilityState}`, 'physical');
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    private teardownVisibilityMonitor(): void {
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
    }

    // ============================================================
    // Report Generation
    // ============================================================

    generateReport(): ForensicReport {
        const totalDuration = performance.now() - this.startTime;
        const rafAnalysis = this.computeRafAnalysis();
        const whyThisDuration = this.generateWhyThisDuration(rafAnalysis);
        const diagnosis = this.generateDiagnosis(rafAnalysis);

        return {
            startAbsTime: this.startTime,
            totalDurationMs: totalDuration,
            totalFrames: this.frameIndex,
            physicalReady: this.physicalReady,
            phases: [...this.phases],
            anomalies: [...this.anomalies],
            resizeEvents: [...this.resizeEvents],
            rafAnalysis,
            convergenceTimeline: [...this.convergenceTimeline],
            independentRafSamples: [...this.independentRafSamples],
            starvationHistory: [...this.starvationHistory],
            whyThisDuration,
            diagnosis,
        };
    }

    private computeRafAnalysis(): ForensicReport['rafAnalysis'] {
        const dts = this.frames.map(f => f.independentRafDt).filter(dt => dt > 0);
        if (dts.length === 0) {
            return {
                avgInterval: 0, medianInterval: 0, stdDev: 0, modeInterval: 0,
                histogram: [], frequencyLockDetected: false,
                lockedFrequencyMs: null, longestLockDurationMs: 0,
            };
        }

        const sorted = [...dts].sort((a, b) => a - b);
        const avg = dts.reduce((a, b) => a + b, 0) / dts.length;
        const median = sorted[Math.floor(sorted.length / 2)];
        const variance = dts.reduce((s, d) => s + (d - avg) ** 2, 0) / dts.length;
        const stdDev = Math.sqrt(variance);

        // Mode (2ms buckets)
        const bucketCounts = new Map<number, number>();
        for (const dt of dts) {
            const bucket = Math.round(dt / 2) * 2;
            bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
        }
        let modeInterval = 0;
        let modeCount = 0;
        for (const [bucket, count] of bucketCounts) {
            if (count > modeCount) {
                modeCount = count;
                modeInterval = bucket;
            }
        }

        // Histogram
        const histBuckets = [
            { label: '<10ms', min: 0, max: 10 },
            { label: '10-18ms', min: 10, max: 18 },
            { label: '18-50ms', min: 18, max: 50 },
            { label: '50-110ms', min: 50, max: 110 },
            { label: '110-500ms', min: 110, max: 500 },
            { label: '500ms-1s', min: 500, max: 1000 },
            { label: '1s-5s', min: 1000, max: 5000 },
            { label: '>5s', min: 5000, max: Infinity },
        ];
        const histogram = histBuckets.map(({ label, min, max }) => {
            const count = dts.filter(d => d >= min && d < max).length;
            return { bucket: label, count, pct: dts.length > 0 ? (count / dts.length * 100) : 0 };
        });

        // Frequency lock detection (longest consecutive run at same frequency)
        let longestLock = 0;
        let currentLock = 1;
        let lockFreq: number | null = null;
        for (let i = 1; i < dts.length; i++) {
            if (Math.abs(dts[i] - dts[i - 1]) < FREQUENCY_LOCK_TOLERANCE_MS) {
                currentLock++;
                if (currentLock > longestLock) {
                    longestLock = currentLock;
                    lockFreq = (dts.slice(i - currentLock + 1, i + 1).reduce((a, b) => a + b, 0)) / currentLock;
                }
            } else {
                currentLock = 1;
            }
        }

        const frequencyLockDetected = longestLock >= FREQUENCY_LOCK_MIN_FRAMES &&
            lockFreq !== null && lockFreq > EXPECTED_RAF_INTERVAL_MS * 1.5;
        const longestLockDurationMs = lockFreq !== null ? longestLock * lockFreq : 0;

        return {
            avgInterval: avg,
            medianInterval: median,
            stdDev,
            modeInterval,
            histogram,
            frequencyLockDetected,
            lockedFrequencyMs: frequencyLockDetected ? lockFreq : null,
            longestLockDurationMs,
        };
    }

    // ============================================================
    // "Why This Duration?" Analysis
    // ============================================================

    /**
     * Answers the critical question: "Why did the black hole last specifically N minutes?"
     *
     * This is NOT about "what was wrong" — it's about:
     * - What events were ABSENT during the dead period
     * - What signal appeared for the FIRST TIME at resolution
     * - Which browser lifecycle / compositor / visibility signals correlate
     * - Evidence-based cause candidates ranked by confidence
     */
    private generateWhyThisDuration(rafAnalysis: ForensicReport['rafAnalysis']): string[] {
        const lines: string[] = [];
        const totalDuration = performance.now() - this.startTime;

        lines.push('=== WHY THIS DURATION? ===');
        lines.push('');

        // Determine the "black hole" period
        const blackHoleStart = 0; // From probe start
        const blackHoleEnd = this.physicalReady?.relTime ?? totalDuration;
        const blackHoleDurationMs = blackHoleEnd - blackHoleStart;
        const blackHoleDurationSec = blackHoleDurationMs / 1000;

        lines.push(`[BLACK HOLE PERIOD] ${blackHoleDurationSec.toFixed(1)}s (${(blackHoleDurationMs / 60000).toFixed(1)} min)`);
        lines.push(`  Start: probe start (READY already declared but physically not stable)`);
        lines.push(`  End: ${this.physicalReady ? `PHYSICAL_READY at ${(this.physicalReady.relTime / 1000).toFixed(1)}s` : 'NEVER RESOLVED'}`);
        lines.push('');

        // --- Section A: What was ABSENT during the dead period ---
        lines.push('[A] WHAT WAS ABSENT DURING THE BLACK HOLE:');

        // Resize events during black hole
        const resizesDuringHole = this.resizeEvents.filter(
            e => e.relTime >= blackHoleStart && e.relTime < blackHoleEnd
        );
        const effectiveResizesDuring = resizesDuringHole.filter(e => e.effectiveChange);
        if (resizesDuringHole.length === 0) {
            lines.push('  - ZERO resize events (ResizeObserver, window.resize, engine.resize)');
            lines.push('    → Canvas NEVER signaled dimension change to the engine');
        } else if (effectiveResizesDuring.length === 0) {
            lines.push(`  - ${resizesDuringHole.length} resize events, but NONE were effective (no dimension change)`);
            lines.push('    → engine.resize() was called but produced identical output');
        } else {
            lines.push(`  - ${effectiveResizesDuring.length} effective resizes occurred during black hole`);
        }

        // Visibility changes during black hole
        const visibilityPhases = this.phases.filter(
            p => p.name.startsWith('visibility_') && p.relTime >= blackHoleStart && p.relTime < blackHoleEnd
        );
        if (visibilityPhases.length === 0) {
            lines.push('  - ZERO visibility state changes (tab stayed in same state)');
        } else {
            lines.push(`  - ${visibilityPhases.length} visibility changes:`);
            visibilityPhases.forEach(p => {
                lines.push(`    ${(p.relTime / 1000).toFixed(1)}s: ${p.name}`);
            });
        }

        // Independent RAF cadence during black hole: was it degraded?
        const rafDuringHole = this.independentRafRecords.filter(
            r => (r.absTime - this.startTime) >= blackHoleStart && (r.absTime - this.startTime) < blackHoleEnd
        );
        const degradedRaf = rafDuringHole.filter(r => r.dt > 50);
        if (degradedRaf.length > rafDuringHole.length * 0.8) {
            lines.push(`  - RAF cadence DEGRADED for ${((degradedRaf.length / rafDuringHole.length) * 100).toFixed(0)}% of black hole`);
            const avgDegradedDt = degradedRaf.reduce((s, r) => s + r.dt, 0) / degradedRaf.length;
            lines.push(`    → Average RAF dt: ${avgDegradedDt.toFixed(1)}ms (~${(1000 / avgDegradedDt).toFixed(1)}fps)`);
        }

        // Starvation persistence
        const starvationDuringHole = this.starvationHistory.filter(
            s => s.relTime >= blackHoleStart && s.relTime < blackHoleEnd && s.state.starved
        );
        if (starvationDuringHole.length > 0) {
            const maxStarvation = Math.max(...starvationDuringHole.map(s => s.state.currentDurationMs));
            lines.push(`  - Resize starvation persisted for up to ${(maxStarvation / 1000).toFixed(1)}s continuously`);
        }

        lines.push('');

        // --- Section B: What appeared FIRST at resolution ---
        lines.push('[B] WHAT APPEARED AT RESOLUTION:');

        if (this.physicalReady) {
            const resolutionWindow = 2000; // 2s window around resolution
            const resolutionStart = this.physicalReady.relTime - resolutionWindow;
            const resolutionEnd = this.physicalReady.relTime + 500;

            // First effective resize near resolution
            const resizesNearResolution = this.resizeEvents.filter(
                e => e.relTime >= resolutionStart && e.relTime <= resolutionEnd && e.effectiveChange
            );
            if (resizesNearResolution.length > 0) {
                const first = resizesNearResolution[0];
                const deltaToPR = this.physicalReady.relTime - first.relTime;
                lines.push(`  - FIRST effective resize at ${(first.relTime / 1000).toFixed(1)}s ` +
                    `(${deltaToPR.toFixed(0)}ms before PHYSICAL_READY)`);
                lines.push(`    Source: ${first.source}, engine: ${first.before.engineRenderW}x${first.before.engineRenderH} → ` +
                    `${first.after.engineRenderW}x${first.after.engineRenderH}`);
            }

            // Visibility change near resolution
            const visNearResolution = this.phases.filter(
                p => p.name.startsWith('visibility_') && p.relTime >= resolutionStart && p.relTime <= resolutionEnd
            );
            if (visNearResolution.length > 0) {
                visNearResolution.forEach(p => {
                    lines.push(`  - Visibility changed to "${p.name.replace('visibility_', '')}" ` +
                        `at ${(p.relTime / 1000).toFixed(1)}s`);
                });
            }

            // RAF cadence change near resolution
            const rafNearResolution = this.independentRafRecords.filter(
                r => {
                    const rRelTime = r.absTime - this.startTime;
                    return rRelTime >= resolutionStart && rRelTime <= resolutionEnd;
                }
            );
            if (rafNearResolution.length > 5) {
                const avgDt = rafNearResolution.reduce((s, r) => s + r.dt, 0) / rafNearResolution.length;
                const beforeResolution = this.independentRafRecords.filter(
                    r => {
                        const rRelTime = r.absTime - this.startTime;
                        return rRelTime >= resolutionStart - 5000 && rRelTime < resolutionStart;
                    }
                );
                const avgBefore = beforeResolution.length > 0
                    ? beforeResolution.reduce((s, r) => s + r.dt, 0) / beforeResolution.length : 0;

                if (avgBefore > 0 && avgDt < avgBefore * 0.7) {
                    lines.push(`  - RAF cadence improved: ${avgBefore.toFixed(0)}ms → ${avgDt.toFixed(0)}ms near resolution`);
                }
            }
        } else {
            lines.push('  - PHYSICAL_READY NEVER achieved — nothing resolved');
        }

        lines.push('');

        // --- Section C: Cause candidates ---
        lines.push('[C] CAUSE CANDIDATES (ranked by evidence strength):');

        const candidates: { cause: string; confidence: string; evidence: string }[] = [];

        // Candidate 1: Resize starvation
        if (resizesDuringHole.length === 0 || effectiveResizesDuring.length === 0) {
            candidates.push({
                cause: 'Resize starvation — canvas never signaled engine to update framebuffer',
                confidence: 'HIGH',
                evidence: `${resizesDuringHole.length} resize events during ${blackHoleDurationSec.toFixed(0)}s, ` +
                    `${effectiveResizesDuring.length} effective`,
            });
        }

        // Candidate 2: RAF throttling
        if (rafAnalysis.frequencyLockDetected && rafAnalysis.lockedFrequencyMs) {
            candidates.push({
                cause: `RAF frequency lock at ${rafAnalysis.lockedFrequencyMs.toFixed(0)}ms ` +
                    `(browser scheduling throttle)`,
                confidence: 'HIGH',
                evidence: `Lock duration: ${(rafAnalysis.longestLockDurationMs / 1000).toFixed(1)}s, ` +
                    `expected: ${EXPECTED_RAF_INTERVAL_MS.toFixed(0)}ms`,
            });
        }

        // Candidate 3: Background tab
        const hiddenRaf = rafDuringHole.filter(r => r.visibilityState === 'hidden');
        if (hiddenRaf.length > rafDuringHole.length * 0.5) {
            candidates.push({
                cause: 'Background tab throttling — page was hidden',
                confidence: 'MEDIUM',
                evidence: `${((hiddenRaf.length / rafDuringHole.length) * 100).toFixed(0)}% of RAF ticks during hidden state`,
            });
        }

        // Candidate 4: CSS/layout not triggering resize
        if (this.resizeEvents.length > 0 && this.resizeEvents[0].relTime > 60000) {
            candidates.push({
                cause: 'CSS layout completed but ResizeObserver never fired for canvas',
                confidence: 'MEDIUM',
                evidence: `First resize at ${(this.resizeEvents[0].relTime / 1000).toFixed(0)}s, ` +
                    `canvas may have been sized before observer attached`,
            });
        }

        // Candidate 5: engine.resize() never called
        if (this.engineResizeCallCount === 0) {
            candidates.push({
                cause: 'engine.resize() was never called — no code path triggered framebuffer update',
                confidence: 'HIGH',
                evidence: `0 engine.resize() calls during ${blackHoleDurationSec.toFixed(0)}s probe window`,
            });
        }

        if (candidates.length === 0) {
            lines.push('  No strong candidates identified — probe may need longer run time');
        } else {
            candidates.sort((a, b) => {
                const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                return (order[a.confidence as keyof typeof order] ?? 2) -
                    (order[b.confidence as keyof typeof order] ?? 2);
            });
            for (const c of candidates) {
                lines.push(`  [${c.confidence}] ${c.cause}`);
                lines.push(`    Evidence: ${c.evidence}`);
            }
        }

        lines.push('');
        lines.push('=== END WHY THIS DURATION ===');

        return lines;
    }

    // ============================================================
    // Diagnosis Narrative
    // ============================================================

    private generateDiagnosis(rafAnalysis: ForensicReport['rafAnalysis']): string[] {
        const lines: string[] = [];
        const totalDuration = performance.now() - this.startTime;

        lines.push('=== BLACK HOLE FORENSIC DIAGNOSIS ===');
        lines.push('');

        // 1. Physical Ready assessment
        if (this.physicalReady) {
            lines.push(`[PHYSICAL_READY] Achieved at frame ${this.physicalReady.frame} ` +
                `(${(this.physicalReady.relTime / 1000).toFixed(1)}s after probe start)`);
            lines.push(`  Trigger: ${this.physicalReady.trigger}`);
            lines.push(`  Evidence: ${this.physicalReady.evidence}`);
        } else {
            lines.push('[PHYSICAL_READY] NEVER ACHIEVED');
            lines.push(`  Probe ran for ${(totalDuration / 1000).toFixed(1)}s, ${this.frameIndex} frames`);
            lines.push('  This confirms the engine NEVER reached physically stable rendering.');
        }
        lines.push('');

        // 2. RAF cadence analysis
        lines.push('[RAF CADENCE]');
        lines.push(`  Average: ${rafAnalysis.avgInterval.toFixed(1)}ms (${(1000 / rafAnalysis.avgInterval).toFixed(1)}fps)`);
        lines.push(`  Median: ${rafAnalysis.medianInterval.toFixed(1)}ms`);
        lines.push(`  Mode: ${rafAnalysis.modeInterval.toFixed(0)}ms`);
        lines.push(`  Std Dev: ${rafAnalysis.stdDev.toFixed(1)}ms`);

        if (rafAnalysis.frequencyLockDetected) {
            lines.push(`  *** FREQUENCY LOCK DETECTED at ${rafAnalysis.lockedFrequencyMs!.toFixed(1)}ms ***`);
            lines.push(`  Lock duration: ${(rafAnalysis.longestLockDurationMs / 1000).toFixed(1)}s`);
            lines.push('  CONCLUSION: Browser is throttling RAF to a non-standard interval.');
            lines.push('  This is NOT a Babylon.js issue — it is browser scheduling behavior.');
        } else if (rafAnalysis.avgInterval > 50) {
            lines.push(`  *** RAF RUNNING BELOW 20fps (avg ${rafAnalysis.avgInterval.toFixed(0)}ms) ***`);
            lines.push('  Possible causes: background tab, power saving, GPU throttle');
        }
        lines.push('');

        // 3. Resize timeline
        lines.push('[RESIZE TIMELINE]');
        lines.push(`  Total resize events: ${this.resizeEvents.length}`);
        if (this.resizeEvents.length > 0) {
            const first = this.resizeEvents[0];
            const last = this.resizeEvents[this.resizeEvents.length - 1];
            lines.push(`  First: ${first.source} at ${(first.relTime / 1000).toFixed(1)}s`);
            lines.push(`  Last: ${last.source} at ${(last.relTime / 1000).toFixed(1)}s`);

            const effectiveResizes = this.resizeEvents.filter(e => e.effectiveChange);
            lines.push(`  Effective changes: ${effectiveResizes.length} / ${this.resizeEvents.length}`);

            if (first.relTime > 60000) {
                lines.push(`  *** RESIZE STARVATION: First resize after ${(first.relTime / 1000).toFixed(0)}s ***`);
                lines.push('  The engine rendered to a stale framebuffer for this entire period.');
            }
        } else {
            lines.push('  *** NO RESIZE EVENTS RECORDED ***');
            lines.push('  The canvas NEVER received a resize signal during the probe window.');
        }
        lines.push('');

        // 4. Anomaly summary
        lines.push('[ANOMALIES]');
        const criticals = this.anomalies.filter(a => a.severity === 'critical');
        const warnings = this.anomalies.filter(a => a.severity === 'warning');
        lines.push(`  Critical: ${criticals.length}, Warning: ${warnings.length}, Info: ${this.anomalies.length - criticals.length - warnings.length}`);

        for (const a of criticals) {
            lines.push(`  [CRITICAL] ${a.type}: ${a.evidence}`);
            lines.push(`    Duration: ${(a.durationMs / 1000).toFixed(1)}s (frames ${a.startFrame}-${a.endFrame})`);
        }
        for (const a of warnings.slice(0, 5)) {
            lines.push(`  [WARNING] ${a.type}: ${a.evidence}`);
        }
        lines.push('');

        // 5. Convergence narrative
        lines.push('[CONVERGENCE]');
        const nonConverged = this.convergenceTimeline.filter(c => !c.converged);
        const converged = this.convergenceTimeline.filter(c => c.converged);
        lines.push(`  Timeline samples: ${this.convergenceTimeline.length}`);
        lines.push(`  Converged: ${converged.length}, Not converged: ${nonConverged.length}`);
        if (nonConverged.length > 0 && converged.length > 0) {
            const firstConverge = converged[0];
            lines.push(`  First convergence at: ${(firstConverge.relTime / 1000).toFixed(1)}s (frame ${firstConverge.frame})`);
        }
        lines.push('');

        // 6. Root cause conclusion
        lines.push('[ROOT CAUSE ANALYSIS]');
        if (rafAnalysis.frequencyLockDetected && this.resizeEvents.length === 0) {
            lines.push('  DIAGNOSIS: Double failure mode.');
            lines.push('  1. RAF is throttled by browser (frequency lock)');
            lines.push('  2. No resize events arriving (canvas never signaled to engine)');
            lines.push('  RESULT: Engine renders at degraded framerate to wrong-size buffer indefinitely.');
        } else if (rafAnalysis.frequencyLockDetected) {
            lines.push('  DIAGNOSIS: RAF throttling is primary cause.');
            lines.push('  Browser scheduling is not providing 60fps animation frames.');
            lines.push('  Resize events arrive but engine processes them at degraded rate.');
        } else if (this.resizeEvents.length === 0 || (this.resizeEvents[0]?.relTime ?? 0) > 60000) {
            lines.push('  DIAGNOSIS: Resize starvation is primary cause.');
            lines.push('  Canvas/engine dimensions never converge because no resize signal arrives.');
            lines.push('  RAF may be running normally but rendering to incorrect framebuffer.');
        } else if (!this.physicalReady && this.frameIndex > 100) {
            lines.push('  DIAGNOSIS: Persistent desynchronization.');
            lines.push('  Resize events arrive but engine dimensions never stabilize.');
            lines.push('  Possible CSS/layout thrashing or recursive resize triggers.');
        } else {
            lines.push('  DIAGNOSIS: Normal operation (or probe duration too short for conclusion).');
        }
        lines.push('');
        lines.push('=== END DIAGNOSIS ===');

        return lines;
    }

    // ============================================================
    // Console Output
    // ============================================================

    /**
     * Print the full forensic report to console.
     */
    printReport(): void {
        const report = this.generateReport();

        console.group('[FORENSIC] Black Hole Forensic Report');

        console.log(`Duration: ${(report.totalDurationMs / 1000).toFixed(1)}s, Frames: ${report.totalFrames}`);
        console.log(`Physical Ready: ${report.physicalReady ? `YES (frame ${report.physicalReady.frame}, ${(report.physicalReady.relTime / 1000).toFixed(1)}s)` : 'NEVER'}`);

        console.group('RAF Analysis');
        console.log(`Avg: ${report.rafAnalysis.avgInterval.toFixed(1)}ms, Median: ${report.rafAnalysis.medianInterval.toFixed(1)}ms`);
        console.log(`Mode: ${report.rafAnalysis.modeInterval}ms, StdDev: ${report.rafAnalysis.stdDev.toFixed(1)}ms`);
        console.log(`Frequency Lock: ${report.rafAnalysis.frequencyLockDetected ? `YES at ${report.rafAnalysis.lockedFrequencyMs!.toFixed(1)}ms` : 'NO'}`);
        console.table(report.rafAnalysis.histogram.filter(h => h.count > 0));
        console.groupEnd();

        console.group('Resize Events');
        console.log(`Total: ${report.resizeEvents.length}`);
        if (report.resizeEvents.length > 0) {
            console.table(report.resizeEvents.slice(0, 20).map(e => ({
                source: e.source,
                time: `${(e.relTime / 1000).toFixed(1)}s`,
                frame: e.frameAtEvent,
                changed: e.effectiveChange,
                engineBefore: `${e.before.engineRenderW}x${e.before.engineRenderH}`,
                engineAfter: `${e.after.engineRenderW}x${e.after.engineRenderH}`,
            })));
        }
        console.groupEnd();

        console.group('Anomalies');
        for (const a of report.anomalies.filter(a => a.severity === 'critical')) {
            console.error(`[CRITICAL] ${a.type}: ${a.evidence} (${(a.durationMs / 1000).toFixed(1)}s)`);
        }
        for (const a of report.anomalies.filter(a => a.severity === 'warning')) {
            console.warn(`[WARNING] ${a.type}: ${a.evidence}`);
        }
        console.groupEnd();

        console.group('Phases');
        console.table(report.phases.map(p => ({
            name: p.name,
            layer: p.layer,
            time: `${(p.relTime / 1000).toFixed(1)}s`,
            frame: p.frame,
        })));
        console.groupEnd();

        console.group('Resize Starvation History');
        if (report.starvationHistory.length > 0) {
            const starvedSamples = report.starvationHistory.filter(s => s.state.starved);
            console.log(`Starved samples: ${starvedSamples.length} / ${report.starvationHistory.length}`);
            console.log(`Total starvation time: ${(report.starvationHistory[report.starvationHistory.length - 1]?.state.totalStarvationMs / 1000 || 0).toFixed(1)}s`);
            // Show first 10 starved entries
            if (starvedSamples.length > 0) {
                console.table(starvedSamples.slice(0, 10).map(s => ({
                    time: `${(s.relTime / 1000).toFixed(1)}s`,
                    frame: s.frame,
                    duration: `${(s.state.currentDurationMs / 1000).toFixed(1)}s`,
                    sinceLast: `${(s.state.timeSinceLastResizeMs / 1000).toFixed(1)}s`,
                    sinceEffective: `${(s.state.timeSinceLastEffectiveResizeMs / 1000).toFixed(1)}s`,
                })));
            }
        }
        console.groupEnd();

        console.group('Independent RAF (browser scheduling truth)');
        console.log(`Total ticks: ${this.independentRafTick}, Samples stored: ${report.independentRafSamples.length}`);
        // Show first/last/key moments
        if (report.independentRafSamples.length > 0) {
            const first5 = report.independentRafSamples.slice(0, 5);
            const last5 = report.independentRafSamples.slice(-5);
            console.log('First 5 samples:');
            console.table(first5.map(r => ({
                tick: r.tick,
                dt: `${r.dt.toFixed(1)}ms`,
                visibility: r.visibilityState,
            })));
            console.log('Last 5 samples:');
            console.table(last5.map(r => ({
                tick: r.tick,
                dt: `${r.dt.toFixed(1)}ms`,
                visibility: r.visibilityState,
            })));
        }
        console.groupEnd();

        console.group('Why This Duration?');
        for (const line of report.whyThisDuration) {
            if (line.includes('[HIGH]')) console.error(line);
            else if (line.includes('[MEDIUM]')) console.warn(line);
            else if (line.includes('ABSENT') || line.includes('ZERO') || line.includes('NEVER')) console.error(line);
            else console.log(line);
        }
        console.groupEnd();

        console.group('Diagnosis');
        for (const line of report.diagnosis) {
            if (line.includes('***')) console.error(line);
            else if (line.includes('CRITICAL') || line.includes('NEVER')) console.error(line);
            else if (line.includes('WARNING') || line.includes('DIAGNOSIS')) console.warn(line);
            else console.log(line);
        }
        console.groupEnd();

        console.groupEnd();
    }

    /**
     * Export full report as JSON.
     */
    exportJSON(): string {
        return JSON.stringify(this.generateReport(), null, 2);
    }

    /**
     * Export frame timeline as CSV for spreadsheet analysis.
     */
    exportTimelineCSV(): string {
        const headers = [
            'frame', 'relTime_ms', 'independentRafDt', 'engineFrameDuration',
            'sceneRenderDuration', 'interFrameGap',
            'canvasBufW', 'canvasBufH', 'engineW', 'engineH',
            'hwScale', 'dpr', 'sizeConverged', 'dprConverged', 'visibility',
        ];
        const rows = this.frames.map(f => [
            f.index, f.relTime.toFixed(1), f.independentRafDt.toFixed(1),
            f.engineFrameDuration.toFixed(2), f.sceneRenderDuration.toFixed(2),
            f.interFrameGap.toFixed(1),
            f.canvasBufferWidth, f.canvasBufferHeight,
            f.engineRenderWidth, f.engineRenderHeight,
            f.hardwareScalingLevel, f.devicePixelRatio,
            f.sizeConverged ? 1 : 0, f.dprConverged ? 1 : 0,
            f.visibilityState,
        ].join(','));

        return [headers.join(','), ...rows].join('\n');
    }

    // ============================================================
    // Utilities
    // ============================================================

    private getCaller(): string {
        try {
            const stack = new Error().stack ?? '';
            // Skip: Error, getCaller, resize interceptor, ...
            const lines = stack.split('\n').slice(4, 6);
            return lines.map(l => l.trim().replace(/^at\s+/, '').slice(0, 80)).join(' < ') || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    private log(msg: string): void {
        if (!this.config.consoleOutput) return;
        const relTime = performance.now() - this.startTime;
        console.log(`[FORENSIC] t=${(relTime / 1000).toFixed(2)}s f=${this.frameIndex} ${msg}`);
    }
}
