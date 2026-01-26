/**
 * PhysicalReadyCaptureProbe — Raw Physical State Flight Recorder
 *
 * PURPOSE:
 * Capture the EXACT FRAME where PHYSICAL_READY_CONFIRMED first becomes true,
 * along with the raw physical state of every frame before and after that moment.
 *
 * KEY DIFFERENCE FROM BlackHoleForensicProbe:
 * - ForensicProbe: anomaly classification, sustained confirmation, long-term timeline
 * - CaptureProbe: RAW VALUES at the first-true EDGE, frame-level pre/post history
 *
 * DESIGN:
 * - Ring buffer (≥30s at 60fps = 1800 frames pre-history)
 * - Every frame stores RAW physical values, never boolean summaries
 * - Multi-hook: independent RAF + Babylon observables + resize/visibility events
 * - Monotonic timestamps throughout
 * - On first-true detection: freeze pre-history, continue post-history, then dump
 *
 * WHAT "RAW-ONLY" MEANS:
 * We do NOT store "sizeConverged: true/false". We store:
 *   canvasBufferWidth, canvasBufferHeight, engineRenderWidth, engineRenderHeight, hwScale
 * The consumer can compute convergence. The recorder never reduces.
 *
 * EXPLICITLY NOT TRACKED:
 * - mesh.visibility / isEnabled / activeMeshes (logical layer)
 * - scene.isReady() / material.isReady() (logical layer)
 * - Any anomaly classification or severity
 */

import * as BABYLON from '@babylonjs/core';
import { ThrottleLockDetector } from '../../../core/loading/barrier/ThrottleLockDetector';

// ============================================================
// Constants
// ============================================================

/** Ring buffer capacity: 30 seconds at 60fps */
const RING_BUFFER_CAPACITY = 1800;

/** Post-trigger capture: continue recording for 5 seconds after first-true */
const POST_TRIGGER_FRAMES = 300;

/** PHYSICAL_READY conditions: max RAF dt for stable cadence */
const MAX_STABLE_RAF_DT_MS = 42; // ~24fps minimum acceptable

/** Consecutive stable frames required for confirmed first-true */
const CONFIRMED_STABLE_FRAMES = 8;

/** Hardware scaling must be same value for this many frames */
const HW_SCALE_STABLE_FRAMES = 3;

// ============================================================
// Types — Raw Physical State (no booleans, no reductions)
// ============================================================

/**
 * CaptureFrame — One frame's complete raw physical state.
 * Every field is a raw measurement. No derived booleans.
 */
export interface CaptureFrame {
    /** Monotonic frame index (probe-local) */
    index: number;

    /** Absolute timestamp (performance.now) */
    absTime: number;

    /** Time relative to probe start (ms) */
    relTime: number;

    // ---- RAF Timing (independent chain) ----

    /** Independent RAF dt: time since last RAF tick in OUR chain (ms) */
    independentRafDt: number;

    /** Independent RAF tick index (our own counter) */
    rafTick: number;

    // ---- Babylon Engine Timing ----

    /** engine.onBeginFrameObservable timestamp (abs) */
    beginFrameAt: number;

    /** engine.onEndFrameObservable timestamp (abs) */
    endFrameAt: number;

    /** scene.onBeforeRenderObservable timestamp (abs) */
    beforeRenderAt: number;

    /** scene.onAfterRenderObservable timestamp (abs) */
    afterRenderAt: number;

    /** Engine frame duration: endFrame - beginFrame (ms) */
    engineFrameDurationMs: number;

    /** Inter-frame gap: beginFrame(N) - endFrame(N-1) (ms) */
    interFrameGapMs: number;

    // ---- Canvas Physical Dimensions ----

    /** canvas.clientWidth (CSS pixels) */
    canvasCssWidth: number;

    /** canvas.clientHeight (CSS pixels) */
    canvasCssHeight: number;

    /** canvas.width (buffer pixels) */
    canvasBufferWidth: number;

    /** canvas.height (buffer pixels) */
    canvasBufferHeight: number;

    // ---- Engine Render Dimensions ----

    /** engine.getRenderWidth(false) — raw render target width */
    engineRenderWidth: number;

    /** engine.getRenderHeight(false) — raw render target height */
    engineRenderHeight: number;

    // ---- Scaling ----

    /** engine.getHardwareScalingLevel() */
    hardwareScalingLevel: number;

    /** window.devicePixelRatio */
    devicePixelRatio: number;

    // ---- Page/Document State ----

    /** document.visibilityState */
    visibilityState: DocumentVisibilityState;

    /** document.hasFocus() */
    documentHasFocus: boolean;

    // ---- Resize Event Proximity ----

    /** Time since last resize event of ANY kind (ms). -1 if none yet. */
    msSinceLastResize: number;

    /** Total resize events received so far */
    totalResizeEvents: number;
}

/**
 * CaptureResizeEvent — A resize event with before/after raw physical state.
 */
export interface CaptureResizeEvent {
    /** Absolute timestamp */
    absTime: number;
    /** Time relative to probe start (ms) */
    relTime: number;
    /** Frame index at time of event */
    frameAtEvent: number;
    /** Event source */
    source: 'ResizeObserver' | 'window.resize' | 'orientationchange';
    /** Raw state BEFORE resize */
    before: CapturePhysicalSnapshot;
    /** Raw state AFTER resize (captured at next RAF tick) */
    after: CapturePhysicalSnapshot | null;
}

/**
 * CapturePhysicalSnapshot — Minimal physical state at a point in time.
 */
export interface CapturePhysicalSnapshot {
    canvasBufferW: number;
    canvasBufferH: number;
    engineRenderW: number;
    engineRenderH: number;
    hwScale: number;
    dpr: number;
}

/**
 * FirstTrueEdge — The exact moment PHYSICAL_READY conditions first hold.
 */
export interface FirstTrueEdge {
    /** Frame index where first-true was detected */
    frameIndex: number;
    /** Absolute timestamp */
    absTime: number;
    /** Relative time from probe start (ms) */
    relTime: number;
    /** How many consecutive stable frames at detection */
    consecutiveStableFrames: number;
    /** The raw frame state at detection */
    triggerFrame: CaptureFrame;
    /** Which condition was the LAST to become true (the "unlocker") */
    lastConditionUnlocked: string;
    /** Per-condition raw values at the trigger frame */
    conditionValues: PhysicalReadyConditionValues;
}

/**
 * PhysicalReadyConditionValues — Raw values for each of the 8 conditions.
 * No booleans. The consumer evaluates pass/fail.
 */
export interface PhysicalReadyConditionValues {
    /** Condition 1: Canvas buffer dimensions */
    canvasBuffer: { width: number; height: number };
    /** Condition 2: Engine vs canvas buffer size match (direct comparison) */
    engineVsCanvas: {
        engineW: number; engineH: number;
        expectedW: number; expectedH: number; // canvas buffer dimensions
    };
    /** Condition 3: RAF cadence (dt in ms) */
    rafDt: number;
    /** Condition 4: Total resize events so far */
    resizeEventCount: number;
    /** Condition 5: Document visibility */
    visibilityState: DocumentVisibilityState;
    /** Condition 6: Hardware scaling level (raw, and previous N frames for stability) */
    hwScaling: { current: number; history: number[] };
    /** Condition 7: DPR value */
    dpr: number;
    /** Condition 8: Document focus */
    hasFocus: boolean;
}

/**
 * ConditionFlappingAnalysis — Per-condition analysis of stuck vs flapping
 * in the pre-history window.
 */
export interface ConditionFlappingAnalysis {
    conditionName: string;
    /** Number of frames where this condition was NOT met */
    failFrames: number;
    /** Whether the failures were continuous (stuck) or intermittent (flapping) */
    pattern: 'stuck' | 'flapping' | 'healthy';
    /** Longest continuous fail streak (frames) */
    longestFailStreak: number;
    /** Number of fail→pass transitions */
    transitionCount: number;
}

/**
 * CaptureReport — The final output of the probe.
 */
export interface CaptureReport {
    /** Probe start time (abs) */
    startAbsTime: number;
    /** Total probe duration (ms) */
    totalDurationMs: number;
    /** Total frames recorded */
    totalFrames: number;

    /** First-true edge (null = never achieved) */
    firstTrueEdge: FirstTrueEdge | null;

    /** Pre-history: frames BEFORE first-true (ring buffer dump) */
    preHistory: CaptureFrame[];
    /** Post-history: frames AFTER first-true */
    postHistory: CaptureFrame[];

    /** All resize events during probe lifetime */
    resizeEvents: CaptureResizeEvent[];

    /** Per-condition flapping analysis of the pre-history */
    conditionAnalysis: ConditionFlappingAnalysis[];

    /** Visibility/focus change events */
    visibilityChanges: { absTime: number; relTime: number; state: DocumentVisibilityState }[];
    focusChanges: { absTime: number; relTime: number; hasFocus: boolean }[];
}

export interface CaptureProbeConfig {
    /** Max probe duration (ms, default: 600000 = 10min) */
    maxDurationMs?: number;
    /** Console output (default: true) */
    consoleOutput?: boolean;
    /** Ring buffer capacity (frames, default: 1800 = 30s@60fps) */
    ringBufferCapacity?: number;
    /** Post-trigger capture frames (default: 300 = 5s@60fps) */
    postTriggerFrames?: number;
}

// ============================================================
// PhysicalReadyCaptureProbe
// ============================================================

export class PhysicalReadyCaptureProbe {
    private scene: BABYLON.Scene;
    private engine: BABYLON.AbstractEngine;
    private canvas: HTMLCanvasElement | null;
    private config: Required<CaptureProbeConfig>;

    // Lifecycle
    private active: boolean = false;
    private disposed: boolean = false;
    private startTime: number = 0;

    // Ring buffer for pre-history
    private ringBuffer: CaptureFrame[] = [];
    private ringWriteIndex: number = 0;
    private ringFull: boolean = false;

    // Frame tracking
    private frameIndex: number = 0;

    // Post-trigger state
    private firstTrueDetected: boolean = false;
    private postHistoryFrames: CaptureFrame[] = [];
    private postHistoryRemaining: number = 0;

    // First-true edge
    private firstTrueEdge: FirstTrueEdge | null = null;

    // Consecutive stable frames counter
    private consecutiveStable: number = 0;

    // Hardware scaling history (last N values for stability check)
    private hwScaleHistory: number[] = [];

    // Current frame timing slots (populated by observers)
    private currentBeginFrame: number = 0;
    private currentEndFrame: number = 0;
    private currentBeforeRender: number = 0;
    private currentAfterRender: number = 0;
    private prevEndFrame: number = 0;

    // Independent RAF chain
    private independentRafId: number = 0;
    private independentRafTick: number = 0;
    private lastIndependentRafTime: number = 0;
    private currentIndependentDt: number = 0;

    // Resize tracking
    private resizeEvents: CaptureResizeEvent[] = [];
    private lastResizeTime: number = -1;
    private totalResizeCount: number = 0;
    private resizeObserver: ResizeObserver | null = null;
    private windowResizeHandler: (() => void) | null = null;
    private orientationHandler: (() => void) | null = null;

    // Visibility/focus tracking
    private visibilityHandler: (() => void) | null = null;
    private focusHandler: (() => void) | null = null;
    private blurHandler: (() => void) | null = null;
    private visibilityChanges: CaptureReport['visibilityChanges'] = [];
    private focusChanges: CaptureReport['focusChanges'] = [];

    // Babylon observers
    private beginFrameObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.AbstractEngine>> = null;
    private endFrameObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.AbstractEngine>> = null;
    private beforeRenderObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private afterRenderObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Auto-stop
    private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

    // Previous condition pass state (for detecting "last unlocker")
    private prevConditionPass: boolean[] = new Array(8).fill(false);

    // Throttle-stable detection (shared with EngineAwakenedBarrier)
    private throttleDetector: ThrottleLockDetector = new ThrottleLockDetector(10, 5, [95, 115]);
    private isThrottleStable: boolean = false;

    constructor(scene: BABYLON.Scene, config: CaptureProbeConfig = {}) {
        this.scene = scene;
        this.engine = scene.getEngine();
        this.canvas = this.engine.getRenderingCanvas() as HTMLCanvasElement | null;
        this.config = {
            maxDurationMs: config.maxDurationMs ?? 600_000,
            consoleOutput: config.consoleOutput ?? true,
            ringBufferCapacity: config.ringBufferCapacity ?? RING_BUFFER_CAPACITY,
            postTriggerFrames: config.postTriggerFrames ?? POST_TRIGGER_FRAMES,
        };

        // Pre-allocate ring buffer
        this.ringBuffer = new Array(this.config.ringBufferCapacity);
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    start(): void {
        if (this.active || this.disposed) return;
        this.active = true;
        this.startTime = performance.now();
        this.frameIndex = 0;
        this.ringWriteIndex = 0;
        this.ringFull = false;
        this.firstTrueDetected = false;
        this.postHistoryFrames = [];
        this.postHistoryRemaining = 0;
        this.firstTrueEdge = null;
        this.consecutiveStable = 0;
        this.hwScaleHistory = [];
        this.prevEndFrame = this.startTime;
        this.resizeEvents = [];
        this.lastResizeTime = -1;
        this.totalResizeCount = 0;
        this.visibilityChanges = [];
        this.focusChanges = [];
        this.prevConditionPass = new Array(8).fill(false);
        this.throttleDetector.reset();
        this.isThrottleStable = false;

        // Independent RAF state
        this.independentRafTick = 0;
        this.lastIndependentRafTime = this.startTime;
        this.currentIndependentDt = 0;

        // Setup instrumentation
        this.setupBabylonObservers();
        this.setupIndependentRaf();
        this.setupResizeHooks();
        this.setupVisibilityHooks();

        // Auto-stop
        this.autoStopTimer = setTimeout(() => {
            if (this.active) {
                this.log('AUTO_STOP: maxDurationMs reached without PHYSICAL_READY');
                this.stop();
                this.printReport();
            }
        }, this.config.maxDurationMs);

        this.log(
            `START | canvas_css=${this.canvas?.clientWidth}x${this.canvas?.clientHeight} ` +
            `buf=${this.canvas?.width}x${this.canvas?.height} ` +
            `engine=${this.engine.getRenderWidth()}x${this.engine.getRenderHeight()} ` +
            `hwScale=${this.engine.getHardwareScalingLevel()} dpr=${window.devicePixelRatio}`
        );
    }

    stop(): void {
        if (!this.active) return;
        this.active = false;
        this.teardownAll();
    }

    isActive(): boolean {
        return this.active;
    }

    dispose(): void {
        this.stop();
        this.disposed = true;
        this.ringBuffer = [];
        this.postHistoryFrames = [];
        this.resizeEvents = [];
    }

    // ============================================================
    // Phase markers (from NavigationScene lifecycle)
    // ============================================================

    markPhase(name: string): void {
        if (!this.active) return;
        const now = performance.now();
        this.log(`PHASE: ${name} at frame=${this.frameIndex} relTime=${(now - this.startTime).toFixed(0)}ms`);
    }

    // ============================================================
    // Independent RAF Chain
    // ============================================================

    private setupIndependentRaf(): void {
        const tick = (now: number) => {
            if (!this.active) return;

            this.currentIndependentDt = now - this.lastIndependentRafTime;
            this.lastIndependentRafTime = now;
            this.independentRafTick++;

            // Feed throttle detector and update throttle-stable state
            this.throttleDetector.addInterval(this.currentIndependentDt);
            this.isThrottleStable = this.throttleDetector.isThrottleStable();

            this.independentRafId = requestAnimationFrame(tick);
        };
        this.independentRafId = requestAnimationFrame(tick);
    }

    // ============================================================
    // Babylon Observers
    // ============================================================

    private setupBabylonObservers(): void {
        // engine.onBeginFrameObservable
        this.beginFrameObs = this.engine.onBeginFrameObservable.add(() => {
            this.currentBeginFrame = performance.now();
        });

        // engine.onEndFrameObservable
        this.endFrameObs = this.engine.onEndFrameObservable.add(() => {
            this.currentEndFrame = performance.now();
        });

        // scene.onBeforeRenderObservable
        this.beforeRenderObs = this.scene.onBeforeRenderObservable.add(() => {
            this.currentBeforeRender = performance.now();
        });

        // scene.onAfterRenderObservable — this is where we commit the frame record
        this.afterRenderObs = this.scene.onAfterRenderObservable.add(() => {
            this.currentAfterRender = performance.now();
            this.commitFrame();
        });
    }

    // ============================================================
    // Resize Hooks
    // ============================================================

    private setupResizeHooks(): void {
        // ResizeObserver on canvas
        if (this.canvas) {
            this.resizeObserver = new ResizeObserver(() => {
                this.recordResizeEvent('ResizeObserver');
            });
            this.resizeObserver.observe(this.canvas);
        }

        // window resize
        this.windowResizeHandler = () => {
            this.recordResizeEvent('window.resize');
        };
        window.addEventListener('resize', this.windowResizeHandler);

        // orientation change
        this.orientationHandler = () => {
            this.recordResizeEvent('orientationchange');
        };
        window.addEventListener('orientationchange', this.orientationHandler);
    }

    private recordResizeEvent(source: CaptureResizeEvent['source']): void {
        if (!this.active) return;
        const now = performance.now();
        this.lastResizeTime = now;
        this.totalResizeCount++;

        const evt: CaptureResizeEvent = {
            absTime: now,
            relTime: now - this.startTime,
            frameAtEvent: this.frameIndex,
            source,
            before: this.captureSnapshot(),
            after: null, // Will be filled at next frame commit
        };
        this.resizeEvents.push(evt);
    }

    private captureSnapshot(): CapturePhysicalSnapshot {
        return {
            canvasBufferW: this.canvas?.width ?? 0,
            canvasBufferH: this.canvas?.height ?? 0,
            engineRenderW: this.engine.getRenderWidth(false),
            engineRenderH: this.engine.getRenderHeight(false),
            hwScale: this.engine.getHardwareScalingLevel(),
            dpr: window.devicePixelRatio,
        };
    }

    // ============================================================
    // Visibility/Focus Hooks
    // ============================================================

    private setupVisibilityHooks(): void {
        this.visibilityHandler = () => {
            if (!this.active) return;
            const now = performance.now();
            this.visibilityChanges.push({
                absTime: now,
                relTime: now - this.startTime,
                state: document.visibilityState,
            });
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);

        this.focusHandler = () => {
            if (!this.active) return;
            const now = performance.now();
            this.focusChanges.push({ absTime: now, relTime: now - this.startTime, hasFocus: true });
        };
        this.blurHandler = () => {
            if (!this.active) return;
            const now = performance.now();
            this.focusChanges.push({ absTime: now, relTime: now - this.startTime, hasFocus: false });
        };
        window.addEventListener('focus', this.focusHandler);
        window.addEventListener('blur', this.blurHandler);
    }

    // ============================================================
    // Frame Commit — Core recording logic
    // ============================================================

    private commitFrame(): void {
        if (!this.active) return;

        const now = performance.now();
        const frame: CaptureFrame = {
            index: this.frameIndex,
            absTime: now,
            relTime: now - this.startTime,

            // RAF timing
            independentRafDt: this.currentIndependentDt,
            rafTick: this.independentRafTick,

            // Babylon timing
            beginFrameAt: this.currentBeginFrame,
            endFrameAt: this.currentEndFrame,
            beforeRenderAt: this.currentBeforeRender,
            afterRenderAt: this.currentAfterRender,
            engineFrameDurationMs: this.currentEndFrame - this.currentBeginFrame,
            interFrameGapMs: this.currentBeginFrame - this.prevEndFrame,

            // Canvas dimensions
            canvasCssWidth: this.canvas?.clientWidth ?? 0,
            canvasCssHeight: this.canvas?.clientHeight ?? 0,
            canvasBufferWidth: this.canvas?.width ?? 0,
            canvasBufferHeight: this.canvas?.height ?? 0,

            // Engine dimensions
            engineRenderWidth: this.engine.getRenderWidth(false),
            engineRenderHeight: this.engine.getRenderHeight(false),

            // Scaling
            hardwareScalingLevel: this.engine.getHardwareScalingLevel(),
            devicePixelRatio: window.devicePixelRatio,

            // Page state
            visibilityState: document.visibilityState,
            documentHasFocus: document.hasFocus(),

            // Resize proximity
            msSinceLastResize: this.lastResizeTime < 0 ? -1 : (now - this.lastResizeTime),
            totalResizeEvents: this.totalResizeCount,
        };

        // Update hw scale history
        this.hwScaleHistory.push(frame.hardwareScalingLevel);
        if (this.hwScaleHistory.length > HW_SCALE_STABLE_FRAMES + 1) {
            this.hwScaleHistory.shift();
        }

        // Fill "after" snapshot for any pending resize events from this frame
        for (let i = this.resizeEvents.length - 1; i >= 0; i--) {
            const evt = this.resizeEvents[i];
            if (evt.after === null && evt.frameAtEvent < this.frameIndex) {
                evt.after = this.captureSnapshot();
                break; // Only fill the most recent pending one per frame
            }
        }

        // Store frame in appropriate buffer
        if (!this.firstTrueDetected) {
            // Pre-trigger: write to ring buffer
            this.ringBuffer[this.ringWriteIndex] = frame;
            this.ringWriteIndex = (this.ringWriteIndex + 1) % this.config.ringBufferCapacity;
            if (this.ringWriteIndex === 0 && this.frameIndex >= this.config.ringBufferCapacity) {
                this.ringFull = true;
            }

            // Evaluate PHYSICAL_READY conditions
            this.evaluateFirstTrue(frame);
        } else {
            // Post-trigger: append to linear array
            this.postHistoryFrames.push(frame);
            this.postHistoryRemaining--;

            if (this.postHistoryRemaining <= 0) {
                // Post-history complete — finalize
                this.log(`POST_HISTORY complete (${this.postHistoryFrames.length} frames captured)`);
                this.stop();
                this.printReport();
            }
        }

        // Update state for next frame
        this.prevEndFrame = this.currentEndFrame;
        this.frameIndex++;
    }

    // ============================================================
    // PHYSICAL_READY First-True Edge Detection
    // ============================================================

    private evaluateFirstTrue(frame: CaptureFrame): void {
        const conditions = this.evaluateConditionsRaw(frame);
        const allPass = conditions.every(c => c);

        if (allPass) {
            this.consecutiveStable++;
        } else {
            this.consecutiveStable = 0;
        }

        // Detect first-true edge: all conditions pass for CONFIRMED_STABLE_FRAMES
        if (this.consecutiveStable >= CONFIRMED_STABLE_FRAMES && !this.firstTrueDetected) {
            this.firstTrueDetected = true;
            this.postHistoryRemaining = this.config.postTriggerFrames;

            // Determine which condition was the "last unlocker"
            const conditionNames = [
                'canvasBuffer>0',
                'engineCanvasMatch',
                'rafCadenceStable',
                'resizeOccurred',
                'documentVisible',
                'hwScaleStable',
                'dprPositive',
                'documentFocused',
            ];
            let lastUnlocker = 'unknown';
            for (let i = 0; i < conditions.length; i++) {
                if (conditions[i] && !this.prevConditionPass[i]) {
                    lastUnlocker = conditionNames[i];
                }
            }
            // If no new condition flipped this exact frame, find the most recently unlocked
            if (lastUnlocker === 'unknown') {
                // Walk back through ring buffer to find when the last condition became true
                lastUnlocker = this.findLastUnlockerFromHistory(conditionNames);
            }

            this.firstTrueEdge = {
                frameIndex: frame.index,
                absTime: frame.absTime,
                relTime: frame.relTime,
                consecutiveStableFrames: this.consecutiveStable,
                triggerFrame: { ...frame },
                lastConditionUnlocked: lastUnlocker,
                conditionValues: this.extractConditionValues(frame),
            };

            this.log(
                `★ PHYSICAL_READY FIRST-TRUE at frame=${frame.index} ` +
                `relTime=${frame.relTime.toFixed(0)}ms ` +
                `stableFrames=${this.consecutiveStable} ` +
                `lastUnlocker=${lastUnlocker}`
            );
        }

        // Update previous condition state
        this.prevConditionPass = conditions;
    }

    /**
     * Evaluate each PHYSICAL_READY condition independently.
     * Returns array of 8 booleans (INTERNAL ONLY — not exposed in output).
     * The OUTPUT is always raw values, never these booleans.
     */
    private evaluateConditionsRaw(frame: CaptureFrame): boolean[] {
        return [
            // C1: Canvas buffer > 0 in both dimensions
            frame.canvasBufferWidth > 0 && frame.canvasBufferHeight > 0,

            // C2: Engine render matches canvas buffer directly
            frame.engineRenderWidth === frame.canvasBufferWidth &&
            frame.engineRenderHeight === frame.canvasBufferHeight,

            // C3: RAF cadence stable OR throttle-stable (browser throttling accepted)
            (frame.independentRafDt > 0 && frame.independentRafDt <= MAX_STABLE_RAF_DT_MS) || this.isThrottleStable,

            // C4: At least one resize event has occurred
            this.totalResizeCount > 0,

            // C5: Document visible
            frame.visibilityState === 'visible',

            // C6: Hardware scaling stable (same value for last N frames)
            this.isHwScaleStable(),

            // C7: DPR is positive (sanity)
            frame.devicePixelRatio > 0,

            // C8: Document has focus
            frame.documentHasFocus,
        ];
    }

    private isHwScaleStable(): boolean {
        if (this.hwScaleHistory.length < HW_SCALE_STABLE_FRAMES) return false;
        const recent = this.hwScaleHistory.slice(-HW_SCALE_STABLE_FRAMES);
        return recent.every(v => v === recent[0]);
    }

    private extractConditionValues(frame: CaptureFrame): PhysicalReadyConditionValues {
        return {
            canvasBuffer: {
                width: frame.canvasBufferWidth,
                height: frame.canvasBufferHeight,
            },
            engineVsCanvas: {
                engineW: frame.engineRenderWidth,
                engineH: frame.engineRenderHeight,
                expectedW: frame.canvasBufferWidth,
                expectedH: frame.canvasBufferHeight,
            },
            rafDt: frame.independentRafDt,
            resizeEventCount: this.totalResizeCount,
            visibilityState: frame.visibilityState,
            hwScaling: {
                current: frame.hardwareScalingLevel,
                history: [...this.hwScaleHistory],
            },
            dpr: frame.devicePixelRatio,
            hasFocus: frame.documentHasFocus,
        };
    }

    private findLastUnlockerFromHistory(conditionNames: string[]): string {
        // Walk back through ring buffer to find the condition that most recently went from fail→pass
        const preHistory = this.extractPreHistory();
        if (preHistory.length < 2) return conditionNames[0];

        // Check each condition: find the latest frame where it transitioned to pass
        let latestTransitionFrame = -1;
        let latestCondition = conditionNames[0];

        for (let ci = 0; ci < conditionNames.length; ci++) {
            for (let fi = preHistory.length - 1; fi > 0; fi--) {
                const currFrame = preHistory[fi];
                const prevFrame = preHistory[fi - 1];
                const currPass = this.evaluateConditionsRaw(currFrame)[ci];
                const prevPass = this.evaluateConditionsRaw(prevFrame)[ci];
                if (currPass && !prevPass && fi > latestTransitionFrame) {
                    latestTransitionFrame = fi;
                    latestCondition = conditionNames[ci];
                    break;
                }
            }
        }

        return latestCondition;
    }

    // ============================================================
    // Ring Buffer Extraction
    // ============================================================

    private extractPreHistory(): CaptureFrame[] {
        if (!this.ringFull) {
            // Buffer hasn't wrapped yet — return in order
            return this.ringBuffer.slice(0, this.ringWriteIndex).filter(Boolean);
        }
        // Buffer wrapped — read from writeIndex to end, then 0 to writeIndex
        const tail = this.ringBuffer.slice(this.ringWriteIndex).filter(Boolean);
        const head = this.ringBuffer.slice(0, this.ringWriteIndex).filter(Boolean);
        return [...tail, ...head];
    }

    // ============================================================
    // Condition Flapping Analysis
    // ============================================================

    private analyzeConditionFlapping(preHistory: CaptureFrame[]): ConditionFlappingAnalysis[] {
        const conditionNames = [
            'canvasBuffer>0',
            'engineCanvasMatch',
            'rafCadenceStable',
            'resizeOccurred',
            'documentVisible',
            'hwScaleStable',
            'dprPositive',
            'documentFocused',
        ];

        return conditionNames.map((name, ci) => {
            let failFrames = 0;
            let longestFailStreak = 0;
            let currentStreak = 0;
            let transitionCount = 0;
            let prevPass: boolean | null = null;

            for (const frame of preHistory) {
                const pass = this.evaluateConditionsRaw(frame)[ci];
                if (!pass) {
                    failFrames++;
                    currentStreak++;
                    longestFailStreak = Math.max(longestFailStreak, currentStreak);
                } else {
                    currentStreak = 0;
                }
                if (prevPass !== null && prevPass !== pass) {
                    transitionCount++;
                }
                prevPass = pass;
            }

            let pattern: ConditionFlappingAnalysis['pattern'] = 'healthy';
            if (failFrames === 0) {
                pattern = 'healthy';
            } else if (transitionCount <= 2) {
                pattern = 'stuck';
            } else {
                pattern = 'flapping';
            }

            return {
                conditionName: name,
                failFrames,
                pattern,
                longestFailStreak,
                transitionCount,
            };
        });
    }

    // ============================================================
    // Report Generation
    // ============================================================

    generateReport(): CaptureReport {
        const preHistory = this.extractPreHistory();
        const now = performance.now();

        return {
            startAbsTime: this.startTime,
            totalDurationMs: now - this.startTime,
            totalFrames: this.frameIndex,
            firstTrueEdge: this.firstTrueEdge,
            preHistory,
            postHistory: this.postHistoryFrames,
            resizeEvents: this.resizeEvents,
            conditionAnalysis: this.analyzeConditionFlapping(preHistory),
            visibilityChanges: this.visibilityChanges,
            focusChanges: this.focusChanges,
        };
    }

    printReport(): void {
        const report = this.generateReport();

        console.group('[PhysicalReadyCaptureProbe] REPORT');

        console.log(`Duration: ${report.totalDurationMs.toFixed(0)}ms | Frames: ${report.totalFrames}`);
        console.log(`Pre-history: ${report.preHistory.length} frames | Post-history: ${report.postHistory.length} frames`);
        console.log(`Resize events: ${report.resizeEvents.length} | Visibility changes: ${report.visibilityChanges.length}`);

        if (report.firstTrueEdge) {
            const edge = report.firstTrueEdge;
            console.group('★ FIRST-TRUE EDGE');
            console.log(`Frame: ${edge.frameIndex} | Time: ${edge.relTime.toFixed(0)}ms from probe start`);
            console.log(`Consecutive stable: ${edge.consecutiveStableFrames} frames`);
            console.log(`Last condition unlocked: ${edge.lastConditionUnlocked}`);
            console.log('Condition values at trigger:');
            console.table({
                'Canvas Buffer': `${edge.conditionValues.canvasBuffer.width}x${edge.conditionValues.canvasBuffer.height}`,
                'Engine Render': `${edge.conditionValues.engineVsCanvas.engineW}x${edge.conditionValues.engineVsCanvas.engineH}`,
                'Expected (buffer)': `${edge.conditionValues.engineVsCanvas.expectedW}x${edge.conditionValues.engineVsCanvas.expectedH}`,
                'RAF dt': `${edge.conditionValues.rafDt.toFixed(1)}ms`,
                'Resize events': edge.conditionValues.resizeEventCount,
                'Visibility': edge.conditionValues.visibilityState,
                'HW Scale': `${edge.conditionValues.hwScaling.current} (history: [${edge.conditionValues.hwScaling.history.join(', ')}])`,
                'DPR': edge.conditionValues.dpr,
                'Has Focus': edge.conditionValues.hasFocus,
            });
            console.groupEnd();

            // Pre-trigger: last 10 frames before trigger
            if (report.preHistory.length > 0) {
                console.group('PRE-TRIGGER (last 10 frames)');
                const last10 = report.preHistory.slice(-10);
                console.table(last10.map(f => ({
                    frame: f.index,
                    relTime: `${f.relTime.toFixed(0)}ms`,
                    rafDt: `${f.independentRafDt.toFixed(1)}ms`,
                    canvasBuf: `${f.canvasBufferWidth}x${f.canvasBufferHeight}`,
                    engineRender: `${f.engineRenderWidth}x${f.engineRenderHeight}`,
                    hwScale: f.hardwareScalingLevel,
                    dpr: f.devicePixelRatio,
                    visible: f.visibilityState,
                    focus: f.documentHasFocus,
                    msSinceResize: f.msSinceLastResize < 0 ? 'never' : `${f.msSinceLastResize.toFixed(0)}ms`,
                })));
                console.groupEnd();
            }

            // Post-trigger: first 10 frames after trigger
            if (report.postHistory.length > 0) {
                console.group('POST-TRIGGER (first 10 frames)');
                const first10 = report.postHistory.slice(0, 10);
                console.table(first10.map(f => ({
                    frame: f.index,
                    relTime: `${f.relTime.toFixed(0)}ms`,
                    rafDt: `${f.independentRafDt.toFixed(1)}ms`,
                    canvasBuf: `${f.canvasBufferWidth}x${f.canvasBufferHeight}`,
                    engineRender: `${f.engineRenderWidth}x${f.engineRenderHeight}`,
                    hwScale: f.hardwareScalingLevel,
                    dpr: f.devicePixelRatio,
                })));
                console.groupEnd();
            }
        } else {
            console.warn('PHYSICAL_READY was NEVER achieved during probe lifetime.');

            // Show last 10 frames for debugging
            if (report.preHistory.length > 0) {
                console.group('FINAL STATE (last 10 frames)');
                const last10 = report.preHistory.slice(-10);
                console.table(last10.map(f => ({
                    frame: f.index,
                    relTime: `${f.relTime.toFixed(0)}ms`,
                    rafDt: `${f.independentRafDt.toFixed(1)}ms`,
                    canvasBuf: `${f.canvasBufferWidth}x${f.canvasBufferHeight}`,
                    engineRender: `${f.engineRenderWidth}x${f.engineRenderHeight}`,
                    hwScale: f.hardwareScalingLevel,
                    dpr: f.devicePixelRatio,
                    visible: f.visibilityState,
                    focus: f.documentHasFocus,
                    resizes: f.totalResizeEvents,
                })));
                console.groupEnd();
            }
        }

        // Condition flapping analysis
        console.group('CONDITION ANALYSIS (pre-history)');
        console.table(report.conditionAnalysis.map(a => ({
            condition: a.conditionName,
            pattern: a.pattern,
            failFrames: a.failFrames,
            longestStreak: a.longestFailStreak,
            transitions: a.transitionCount,
        })));
        console.groupEnd();

        // Resize event timeline
        if (report.resizeEvents.length > 0) {
            console.group(`RESIZE EVENTS (${report.resizeEvents.length} total)`);
            console.table(report.resizeEvents.slice(0, 20).map(e => ({
                time: `${e.relTime.toFixed(0)}ms`,
                source: e.source,
                frame: e.frameAtEvent,
                before: `${e.before.canvasBufferW}x${e.before.canvasBufferH} eng=${e.before.engineRenderW}x${e.before.engineRenderH}`,
                after: e.after ? `${e.after.canvasBufferW}x${e.after.canvasBufferH} eng=${e.after.engineRenderW}x${e.after.engineRenderH}` : 'pending',
            })));
            console.groupEnd();
        }

        console.groupEnd();
    }

    // ============================================================
    // Teardown
    // ============================================================

    private teardownAll(): void {
        // Cancel independent RAF
        if (this.independentRafId) {
            cancelAnimationFrame(this.independentRafId);
            this.independentRafId = 0;
        }

        // Remove Babylon observers
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

        // Remove resize hooks
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.windowResizeHandler) {
            window.removeEventListener('resize', this.windowResizeHandler);
            this.windowResizeHandler = null;
        }
        if (this.orientationHandler) {
            window.removeEventListener('orientationchange', this.orientationHandler);
            this.orientationHandler = null;
        }

        // Remove visibility/focus hooks
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
        if (this.focusHandler) {
            window.removeEventListener('focus', this.focusHandler);
            this.focusHandler = null;
        }
        if (this.blurHandler) {
            window.removeEventListener('blur', this.blurHandler);
            this.blurHandler = null;
        }

        // Cancel auto-stop
        if (this.autoStopTimer) {
            clearTimeout(this.autoStopTimer);
            this.autoStopTimer = null;
        }
    }

    // ============================================================
    // Logging
    // ============================================================

    private log(msg: string): void {
        if (this.config.consoleOutput) {
            console.log(`[CaptureProbe] ${msg}`);
        }
    }
}
