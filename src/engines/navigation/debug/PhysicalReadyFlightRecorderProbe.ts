/**
 * PhysicalReadyFlightRecorderProbe — Frame-Level RAW State Time-Series Recorder
 *
 * PURPOSE:
 * Produce a JSON event timeline of every frame's physical state, centered on
 * the PHYSICAL_READY achievement moment. The output is self-contained: no
 * post-processing needed to identify the problem cause.
 *
 * KEY DIFFERENCE FROM OTHER PROBES:
 * - BlackHoleForensicProbe: Anomaly classification + sustained confirmation logic
 * - PhysicalReadyCaptureProbe: Ring-buffer pre/post dump with first-true edge detection
 * - THIS PROBE: Typed JSON event timeline for machine & human analysis
 *
 * OUTPUT FORMAT:
 * An array of typed events, each with frame index, timestamp, and raw values.
 * Event types:
 *   - PHYSICAL_PROBE: Per-frame complete physical state snapshot
 *   - RESIZE: Canvas/engine resize event with before/after
 *   - ANOMALY_OPEN: An anomaly condition begins (e.g., RAF_FREQUENCY_LOCK)
 *   - ANOMALY_CLOSE: An anomaly condition ends
 *   - STARVATION_ENTER: Resize starvation begins
 *   - STARVATION_EXIT: Resize starvation ends
 *   - PHYSICAL_READY: First moment all 8 conditions hold for 500ms
 *
 * DESIGN:
 * - Every RAF tick → one PHYSICAL_PROBE event (no sampling/skipping)
 * - State transitions (anomaly open/close, starvation enter/exit) → discrete events
 * - PHYSICAL_READY event marks the exact transition to confirmed state
 * - Timeline is exportable as JSON for offline analysis
 * - Min 1 second of data retained after PHYSICAL_READY achievement
 */

import * as BABYLON from '@babylonjs/core';

// ============================================================
// Constants
// ============================================================

/** Consecutive stable frames for PHYSICAL_READY pre-confirmation */
const STABLE_FRAME_COUNT = 8;

/** PHYSICAL_READY must sustain for this duration (ms) */
const PHYSICAL_READY_SUSTAIN_MS = 500;

/** Maximum RAF dt for stable cadence */
const MAX_STABLE_RAF_DT_MS = 42; // ~24fps minimum

/** RAF frequency lock detection: consecutive frames within tolerance */
const FREQ_LOCK_TOLERANCE_MS = 5;
const FREQ_LOCK_MIN_FRAMES = 10;

/** Resize starvation: mismatch persists without resize for this long */
const STARVATION_THRESHOLD_MS = 5000;

/** Post-PHYSICAL_READY recording duration (ms) */
const POST_READY_RECORD_MS = 1500;

/** Maximum events stored (prevents OOM) */
const MAX_EVENTS = 200_000;

// ============================================================
// Event Types
// ============================================================

export type FlightEventType =
    | 'PHYSICAL_PROBE'
    | 'RESIZE'
    | 'ANOMALY_OPEN'
    | 'ANOMALY_CLOSE'
    | 'STARVATION_ENTER'
    | 'STARVATION_EXIT'
    | 'PHYSICAL_READY';

export type AnomalyType = 'RAF_FREQUENCY_LOCK' | 'CANVAS_ENGINE_MISMATCH' | 'DPR_DESYNC';

/** RAF_SLOW threshold: frames slower than this are flagged */
const RAF_SLOW_THRESHOLD_MS = 50; // >50ms = notably slow

/**
 * PhysicalProbeEvent — Per-frame raw physical state.
 * Includes C1~C8 condition booleans for per-frame fail analysis.
 */
export interface PhysicalProbeEvent {
    type: 'PHYSICAL_PROBE';
    frame: number;
    t: number; // relative time in seconds (2 decimal precision)
    PHYSICAL_READY: boolean;
    /** Per-condition boolean results */
    C1: boolean; // Canvas buffer > 0
    C2: boolean; // Engine/canvas size converged
    C3: boolean; // RAF cadence stable
    C4: boolean; // At least one resize occurred
    C5: boolean; // Document visible
    C6: boolean; // hwScale stable
    C7: boolean; // DPR positive
    C8: boolean; // No active anomalies
    canvas: {
        css: string;      // e.g. "1618x1282"
        buffer: string;   // e.g. "2427x1923"
        engine: string;   // e.g. "2427x1923"
    };
    hwScale: number;
    dpr: number;
    visibility: DocumentVisibilityState;
    rafDt: number;        // ms, 2 decimal
    resizeGap: number;    // ms since last resize, -1 if none
    mismatch: boolean;    // canvas/engine size mismatch
    mismatchGapMs: number; // how long mismatch has persisted (ms), 0 if none
    anomalies: AnomalyType[];
    starvation: boolean;
    stableFrames: number; // consecutive stable frames so far
    rafSlow: boolean;     // true if rafDt > RAF_SLOW_THRESHOLD_MS
}

export interface FlightResizeEvent {
    type: 'RESIZE';
    frame: number;
    t: number;
    source: 'ResizeObserver' | 'window.resize' | 'orientationchange';
    before: { buffer: string; engine: string; hwScale: number; dpr: number };
    after: { buffer: string; engine: string; hwScale: number; dpr: number } | null;
}

export interface AnomalyOpenEvent {
    type: 'ANOMALY_OPEN';
    frame: number;
    t: number;
    anomaly: AnomalyType;
    evidence: string;
}

export interface AnomalyCloseEvent {
    type: 'ANOMALY_CLOSE';
    frame: number;
    t: number;
    anomaly: AnomalyType;
    durationMs: number;
}

export interface StarvationEnterEvent {
    type: 'STARVATION_ENTER';
    frame: number;
    t: number;
    mismatchDurationMs: number;
    canvas: string;
    engine: string;
    /** Mismatch reason: what exactly doesn't match */
    mismatchReason: string;
    /** Expected engine size (buffer / hwScale) */
    expectedEngine: string;
    hwScale: number;
    dpr: number;
}

export interface StarvationExitEvent {
    type: 'STARVATION_EXIT';
    frame: number;
    t: number;
    totalStarvationMs: number;
    resolvedBy: 'resize' | 'convergence';
}

export interface PhysicalReadyEvent {
    type: 'PHYSICAL_READY';
    frame: number;
    t: number;
    sustainedMs: number;
    stableFrames: number;
    conditionValues: {
        canvasBuffer: string;
        engineRender: string;
        hwScale: number;
        dpr: number;
        rafDt: number;
        visibility: DocumentVisibilityState;
        resizeCount: number;
        hasFocus: boolean;
    };
}

export type FlightEvent =
    | PhysicalProbeEvent
    | FlightResizeEvent
    | AnomalyOpenEvent
    | AnomalyCloseEvent
    | StarvationEnterEvent
    | StarvationExitEvent
    | PhysicalReadyEvent;

export interface FlightRecorderConfig {
    /** Max duration (ms, default: 600000) */
    maxDurationMs?: number;
    /** Console output (default: true) */
    consoleOutput?: boolean;
    /** Max events stored (default: 200000) */
    maxEvents?: number;
}

// ============================================================
// Diagnostic Summary Types
// ============================================================

export interface ConditionFailAnalysis {
    condition: string;
    failFrames: number;
    totalFrames: number;
    failPercent: number;
    longestFailStreak: number;
    firstFailFrame: number;
    lastFailFrame: number;
    failDurationMs: number;
}

export interface StarvationSummary {
    enterFrame: number;
    enterTime: number;
    exitFrame: number;
    exitTime: number;
    durationMs: number;
    mismatchReason: string;
    resolvedBy: string;
}

export interface ResizeContext {
    resizeFrame: number;
    resizeTime: number;
    source: string;
    before: { buffer: string; engine: string; hwScale: number; dpr: number };
    after: { buffer: string; engine: string; hwScale: number; dpr: number } | null;
    preFrames: { frame: number; rafDt: number; buffer: string; engine: string; hwScale: number; dpr: number; mismatch: boolean }[];
    postFrames: { frame: number; rafDt: number; buffer: string; engine: string; hwScale: number; dpr: number; mismatch: boolean }[];
    mismatchResolvedAtFrame: number;
}

export interface DiagnosticSummary {
    totalFrames: number;
    totalDurationMs: number;
    physicalReadyAchieved: boolean;
    physicalReadyFrame: number;
    physicalReadyTime: number;
    conditionFails: ConditionFailAnalysis[];
    starvationEvents: StarvationSummary[];
    rafSlowFrameCount: number;
    rafSlowStreaks: { startFrame: number; endFrame: number; maxDt: number; avgDt: number }[];
    resizeCount: number;
    resizeContexts: ResizeContext[];
    mismatchFrameCount: number;
    mismatchResolutions: { startFrame: number; endFrame: number; durationMs: number; resolvedByResize: boolean }[];
    anomalyOpens: { frame: number; t: number; anomaly: AnomalyType; evidence: string }[];
    anomalyCloses: { frame: number; t: number; anomaly: AnomalyType; durationMs: number }[];
}

// ============================================================
// PhysicalReadyFlightRecorderProbe
// ============================================================

export class PhysicalReadyFlightRecorderProbe {
    private scene: BABYLON.Scene;
    private engine: BABYLON.AbstractEngine;
    private canvas: HTMLCanvasElement | null;
    private config: Required<FlightRecorderConfig>;

    // Lifecycle
    private active: boolean = false;
    private disposed: boolean = false;
    private startTime: number = 0;

    // Event timeline (the core output)
    private timeline: FlightEvent[] = [];

    // Frame counter
    private frameIndex: number = 0;

    // Independent RAF
    private rafId: number = 0;
    private lastRafTime: number = 0;
    private currentRafDt: number = 0;
    private rafTick: number = 0;

    // Babylon observers
    private afterRenderObs: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Anomaly state machine
    private activeAnomalies: Map<AnomalyType, { openFrame: number; openTime: number; evidence: string }> = new Map();
    private recentRafDts: number[] = [];

    // Starvation state machine
    private isStarved: boolean = false;
    private mismatchStartTime: number = 0;
    private starvationEnterTime: number = 0;

    // Resize tracking
    private lastResizeTime: number = -1;
    private totalResizeCount: number = 0;
    private resizeObserver: ResizeObserver | null = null;
    private windowResizeHandler: (() => void) | null = null;
    private orientationHandler: (() => void) | null = null;
    private pendingResizeAfter: FlightResizeEvent | null = null;

    // Visibility/focus
    private visibilityHandler: (() => void) | null = null;

    // PHYSICAL_READY state
    private consecutiveStable: number = 0;
    private physicalReadySustainStart: number = 0;
    private physicalReadyConfirmed: boolean = false;
    private postReadyStopTime: number = 0;

    // Hardware scaling history
    private hwScaleHistory: number[] = [];

    // Auto-stop
    private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(scene: BABYLON.Scene, config: FlightRecorderConfig = {}) {
        this.scene = scene;
        this.engine = scene.getEngine();
        this.canvas = this.engine.getRenderingCanvas() as HTMLCanvasElement | null;
        this.config = {
            maxDurationMs: config.maxDurationMs ?? 600_000,
            consoleOutput: config.consoleOutput ?? true,
            maxEvents: config.maxEvents ?? MAX_EVENTS,
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
        this.timeline = [];
        this.consecutiveStable = 0;
        this.physicalReadySustainStart = 0;
        this.physicalReadyConfirmed = false;
        this.postReadyStopTime = 0;
        this.activeAnomalies.clear();
        this.recentRafDts = [];
        this.isStarved = false;
        this.mismatchStartTime = 0;
        this.starvationEnterTime = 0;
        this.lastResizeTime = -1;
        this.totalResizeCount = 0;
        this.pendingResizeAfter = null;
        this.hwScaleHistory = [];
        this.lastRafTime = this.startTime;
        this.currentRafDt = 0;
        this.rafTick = 0;

        this.setupIndependentRaf();
        this.setupBabylonObserver();
        this.setupResizeHooks();
        this.setupVisibilityHook();

        this.autoStopTimer = setTimeout(() => {
            if (this.active) {
                this.log('AUTO_STOP: maxDurationMs reached');
                this.stop();
            }
        }, this.config.maxDurationMs);

        this.log(`START | canvas=${this.canvas?.clientWidth}x${this.canvas?.clientHeight} ` +
            `buf=${this.canvas?.width}x${this.canvas?.height} ` +
            `engine=${this.engine.getRenderWidth()}x${this.engine.getRenderHeight()} ` +
            `hwScale=${this.engine.getHardwareScalingLevel()} dpr=${window.devicePixelRatio}`);
    }

    stop(): void {
        if (!this.active) return;
        this.active = false;
        this.teardownAll();
        this.log(`STOP | ${this.timeline.length} events, ${this.frameIndex} frames, ` +
            `${((performance.now() - this.startTime) / 1000).toFixed(1)}s`);
    }

    isActive(): boolean {
        return this.active;
    }

    dispose(): void {
        this.stop();
        this.disposed = true;
        this.timeline = [];
    }

    // ============================================================
    // Phase Markers
    // ============================================================

    markPhase(name: string): void {
        if (!this.active) return;
        this.log(`PHASE: ${name} at frame=${this.frameIndex} t=${this.relTimeSec()}s`);
    }

    // ============================================================
    // Independent RAF Chain
    // ============================================================

    private setupIndependentRaf(): void {
        const tick = (now: number) => {
            if (!this.active) return;
            this.currentRafDt = now - this.lastRafTime;
            this.lastRafTime = now;
            this.rafTick++;
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    // ============================================================
    // Babylon Observer (frame commit on afterRender)
    // ============================================================

    private setupBabylonObserver(): void {
        this.afterRenderObs = this.scene.onAfterRenderObservable.add(() => {
            this.commitFrame();
        });
    }

    // ============================================================
    // Resize Hooks
    // ============================================================

    private setupResizeHooks(): void {
        if (this.canvas) {
            this.resizeObserver = new ResizeObserver(() => {
                this.recordResize('ResizeObserver');
            });
            this.resizeObserver.observe(this.canvas);
        }

        this.windowResizeHandler = () => this.recordResize('window.resize');
        window.addEventListener('resize', this.windowResizeHandler);

        this.orientationHandler = () => this.recordResize('orientationchange');
        window.addEventListener('orientationchange', this.orientationHandler);
    }

    private recordResize(source: FlightResizeEvent['source']): void {
        if (!this.active) return;
        const now = performance.now();
        this.lastResizeTime = now;
        this.totalResizeCount++;

        const evt: FlightResizeEvent = {
            type: 'RESIZE',
            frame: this.frameIndex,
            t: this.toRelSec(now),
            source,
            before: {
                buffer: `${this.canvas?.width ?? 0}x${this.canvas?.height ?? 0}`,
                engine: `${this.engine.getRenderWidth(false)}x${this.engine.getRenderHeight(false)}`,
                hwScale: this.engine.getHardwareScalingLevel(),
                dpr: window.devicePixelRatio,
            },
            after: null,
        };
        this.pushEvent(evt);
        this.pendingResizeAfter = evt;
    }

    // ============================================================
    // Visibility Hook
    // ============================================================

    private setupVisibilityHook(): void {
        this.visibilityHandler = () => {
            // Visibility changes are captured in the next PHYSICAL_PROBE frame
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    // ============================================================
    // Frame Commit — Core per-frame recording
    // ============================================================

    private commitFrame(): void {
        if (!this.active) return;
        if (this.timeline.length >= this.config.maxEvents) {
            this.log('MAX_EVENTS reached, stopping');
            this.stop();
            return;
        }

        const now = performance.now();

        // Fill pending resize "after" snapshot
        if (this.pendingResizeAfter) {
            this.pendingResizeAfter.after = {
                buffer: `${this.canvas?.width ?? 0}x${this.canvas?.height ?? 0}`,
                engine: `${this.engine.getRenderWidth(false)}x${this.engine.getRenderHeight(false)}`,
                hwScale: this.engine.getHardwareScalingLevel(),
                dpr: window.devicePixelRatio,
            };
            this.pendingResizeAfter = null;
        }

        // Raw measurements
        const canvasCssW = this.canvas?.clientWidth ?? 0;
        const canvasCssH = this.canvas?.clientHeight ?? 0;
        const canvasBufW = this.canvas?.width ?? 0;
        const canvasBufH = this.canvas?.height ?? 0;
        const engineW = this.engine.getRenderWidth(false);
        const engineH = this.engine.getRenderHeight(false);
        const hwScale = this.engine.getHardwareScalingLevel();
        const dpr = window.devicePixelRatio;
        const visibility = document.visibilityState;
        const hasFocus = document.hasFocus();
        const rafDt = this.currentRafDt;

        // Update hw scale history
        this.hwScaleHistory.push(hwScale);
        if (this.hwScaleHistory.length > 10) this.hwScaleHistory.shift();

        // Track RAF dts for frequency lock detection
        this.recentRafDts.push(rafDt);
        if (this.recentRafDts.length > FREQ_LOCK_MIN_FRAMES + 5) {
            this.recentRafDts.shift();
        }

        // Resize gap (ms, -1 if no resize yet)
        const resizeGapMs = this.lastResizeTime < 0
            ? -1
            : round2(now - this.lastResizeTime);

        // Mismatch detection
        const isMismatched = !this.checkSizeConverged(canvasBufW, canvasBufH, engineW, engineH, hwScale);
        const mismatchGapMs = isMismatched && this.mismatchStartTime > 0
            ? round2(now - this.mismatchStartTime)
            : 0;

        // Run anomaly detection
        this.detectAnomalies(now, canvasBufW, canvasBufH, engineW, engineH, hwScale, dpr);

        // Run starvation detection
        this.detectStarvation(now, canvasBufW, canvasBufH, engineW, engineH, hwScale);

        // Evaluate PHYSICAL_READY (returns conditions + result)
        const { ready: physReady, conditions } = this.evaluatePhysicalReadyDetailed(
            now, canvasBufW, canvasBufH, engineW, engineH,
            hwScale, dpr, rafDt, visibility, hasFocus
        );

        // RAF slow flag
        const rafSlow = rafDt > RAF_SLOW_THRESHOLD_MS;

        // Emit PHYSICAL_PROBE event with full condition breakdown
        const activeAnomalies = Array.from(this.activeAnomalies.keys());
        const probeEvent: PhysicalProbeEvent = {
            type: 'PHYSICAL_PROBE',
            frame: this.frameIndex,
            t: this.toRelSec(now),
            PHYSICAL_READY: physReady,
            C1: conditions[0],
            C2: conditions[1],
            C3: conditions[2],
            C4: conditions[3],
            C5: conditions[4],
            C6: conditions[5],
            C7: conditions[6],
            C8: conditions[7],
            canvas: {
                css: `${canvasCssW}x${canvasCssH}`,
                buffer: `${canvasBufW}x${canvasBufH}`,
                engine: `${engineW}x${engineH}`,
            },
            hwScale: round3(hwScale),
            dpr: round3(dpr),
            visibility,
            rafDt: round2(rafDt),
            resizeGap: resizeGapMs,
            mismatch: isMismatched,
            mismatchGapMs,
            anomalies: activeAnomalies,
            starvation: this.isStarved,
            stableFrames: this.consecutiveStable,
            rafSlow,
        };
        this.pushEvent(probeEvent);

        // Post-PHYSICAL_READY stop check
        if (this.physicalReadyConfirmed && now >= this.postReadyStopTime) {
            this.log(`POST_READY recording complete (${POST_READY_RECORD_MS}ms after confirmation)`);
            this.stop();
        }

        this.frameIndex++;
    }

    // ============================================================
    // PHYSICAL_READY Evaluation (8 conditions + 500ms sustain)
    // ============================================================

    private evaluatePhysicalReadyDetailed(
        now: number,
        canvasBufW: number, canvasBufH: number,
        engineW: number, engineH: number,
        hwScale: number, dpr: number,
        rafDt: number,
        visibility: DocumentVisibilityState,
        hasFocus: boolean,
    ): { ready: boolean; conditions: boolean[] } {
        if (this.physicalReadyConfirmed) {
            return { ready: true, conditions: [true, true, true, true, true, true, true, true] };
        }

        // 8 conditions (all must be true simultaneously)
        const conditions: boolean[] = [
            // C1: Canvas buffer > 0
            canvasBufW > 0 && canvasBufH > 0,

            // C2: Engine/canvas size converged (accounting for hwScale)
            this.checkSizeConverged(canvasBufW, canvasBufH, engineW, engineH, hwScale),

            // C3: RAF cadence stable
            rafDt > 0 && rafDt <= MAX_STABLE_RAF_DT_MS,

            // C4: At least one resize event
            this.totalResizeCount > 0,

            // C5: Document visible
            visibility === 'visible',

            // C6: hwScale stable (same value for last 3 frames)
            this.isHwScaleStable(),

            // C7: DPR positive
            dpr > 0,

            // C8: No active critical anomalies
            this.activeAnomalies.size === 0,
        ];

        const allPass = conditions.every(c => c);

        if (allPass) {
            this.consecutiveStable++;

            // Start sustain timer on first stable frame
            if (this.consecutiveStable === STABLE_FRAME_COUNT) {
                this.physicalReadySustainStart = now;
            }

            // Check 500ms sustain
            if (this.consecutiveStable >= STABLE_FRAME_COUNT &&
                this.physicalReadySustainStart > 0 &&
                (now - this.physicalReadySustainStart) >= PHYSICAL_READY_SUSTAIN_MS) {

                this.physicalReadyConfirmed = true;
                this.postReadyStopTime = now + POST_READY_RECORD_MS;

                const readyEvt: PhysicalReadyEvent = {
                    type: 'PHYSICAL_READY',
                    frame: this.frameIndex,
                    t: this.toRelSec(now),
                    sustainedMs: round2(now - this.physicalReadySustainStart),
                    stableFrames: this.consecutiveStable,
                    conditionValues: {
                        canvasBuffer: `${canvasBufW}x${canvasBufH}`,
                        engineRender: `${engineW}x${engineH}`,
                        hwScale: round3(hwScale),
                        dpr: round3(dpr),
                        rafDt: round2(rafDt),
                        visibility,
                        resizeCount: this.totalResizeCount,
                        hasFocus,
                    },
                };
                this.pushEvent(readyEvt);

                this.log(
                    `★ PHYSICAL_READY CONFIRMED at frame=${this.frameIndex} ` +
                    `t=${this.toRelSec(now)}s sustained=${round2(now - this.physicalReadySustainStart)}ms ` +
                    `stableFrames=${this.consecutiveStable}`
                );

                return { ready: true, conditions };
            }
        } else {
            // Reset
            this.consecutiveStable = 0;
            this.physicalReadySustainStart = 0;
        }

        return { ready: false, conditions };
    }

    private checkSizeConverged(
        bufW: number, bufH: number,
        engW: number, engH: number,
        hwScale: number,
    ): boolean {
        if (hwScale <= 0) return false;
        const expectedW = Math.round(bufW / hwScale);
        const expectedH = Math.round(bufH / hwScale);
        return Math.abs(engW - expectedW) <= 1 && Math.abs(engH - expectedH) <= 1;
    }

    private isHwScaleStable(): boolean {
        if (this.hwScaleHistory.length < 3) return false;
        const last3 = this.hwScaleHistory.slice(-3);
        return last3.every(v => v === last3[0]);
    }

    // ============================================================
    // Anomaly Detection
    // ============================================================

    private detectAnomalies(
        now: number,
        canvasBufW: number, canvasBufH: number,
        engineW: number, engineH: number,
        hwScale: number, dpr: number,
    ): void {
        this.detectRafFrequencyLock(now);
        this.detectCanvasEngineMismatch(now, canvasBufW, canvasBufH, engineW, engineH, hwScale);
        this.detectDprDesync(now, hwScale, dpr);
    }

    private detectRafFrequencyLock(now: number): void {
        if (this.recentRafDts.length < FREQ_LOCK_MIN_FRAMES) return;

        const recent = this.recentRafDts.slice(-FREQ_LOCK_MIN_FRAMES);
        const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const maxDev = Math.max(...recent.map(d => Math.abs(d - avg)));

        // Locked if: all within tolerance AND degraded (>1.5x expected)
        const isLocked = maxDev < FREQ_LOCK_TOLERANCE_MS && avg > 16.67 * 1.5;

        if (isLocked && !this.activeAnomalies.has('RAF_FREQUENCY_LOCK')) {
            this.openAnomaly(now, 'RAF_FREQUENCY_LOCK',
                `locked at ${avg.toFixed(1)}ms (${(1000 / avg).toFixed(1)}fps), dev=${maxDev.toFixed(1)}ms`);
        } else if (!isLocked && this.activeAnomalies.has('RAF_FREQUENCY_LOCK')) {
            this.closeAnomaly(now, 'RAF_FREQUENCY_LOCK');
        }
    }

    private detectCanvasEngineMismatch(
        now: number,
        bufW: number, bufH: number,
        engW: number, engH: number,
        hwScale: number,
    ): void {
        const converged = this.checkSizeConverged(bufW, bufH, engW, engH, hwScale);
        if (!converged && !this.activeAnomalies.has('CANVAS_ENGINE_MISMATCH')) {
            const expectedW = Math.round(bufW / hwScale);
            const expectedH = Math.round(bufH / hwScale);
            this.openAnomaly(now, 'CANVAS_ENGINE_MISMATCH',
                `engine=${engW}x${engH} expected=${expectedW}x${expectedH} buf=${bufW}x${bufH} hwScale=${hwScale}`);
        } else if (converged && this.activeAnomalies.has('CANVAS_ENGINE_MISMATCH')) {
            this.closeAnomaly(now, 'CANVAS_ENGINE_MISMATCH');
        }
    }

    private detectDprDesync(now: number, hwScale: number, dpr: number): void {
        // DPR desync: hwScale should typically be 1/dpr or close
        // This is informational — detect when hwScale * dpr is far from 1.0
        const product = hwScale * dpr;
        const desynced = Math.abs(product - 1.0) > 0.3;

        if (desynced && !this.activeAnomalies.has('DPR_DESYNC')) {
            this.openAnomaly(now, 'DPR_DESYNC',
                `hwScale=${hwScale} * dpr=${dpr} = ${product.toFixed(3)} (expected ~1.0)`);
        } else if (!desynced && this.activeAnomalies.has('DPR_DESYNC')) {
            this.closeAnomaly(now, 'DPR_DESYNC');
        }
    }

    private openAnomaly(now: number, type: AnomalyType, evidence: string): void {
        this.activeAnomalies.set(type, {
            openFrame: this.frameIndex,
            openTime: now,
            evidence,
        });

        const evt: AnomalyOpenEvent = {
            type: 'ANOMALY_OPEN',
            frame: this.frameIndex,
            t: this.toRelSec(now),
            anomaly: type,
            evidence,
        };
        this.pushEvent(evt);
    }

    private closeAnomaly(now: number, type: AnomalyType): void {
        const info = this.activeAnomalies.get(type);
        if (!info) return;

        const evt: AnomalyCloseEvent = {
            type: 'ANOMALY_CLOSE',
            frame: this.frameIndex,
            t: this.toRelSec(now),
            anomaly: type,
            durationMs: round2(now - info.openTime),
        };
        this.pushEvent(evt);
        this.activeAnomalies.delete(type);
    }

    // ============================================================
    // Starvation Detection
    // ============================================================

    private detectStarvation(
        now: number,
        canvasBufW: number, canvasBufH: number,
        engineW: number, engineH: number,
        hwScale: number,
    ): void {
        const converged = this.checkSizeConverged(canvasBufW, canvasBufH, engineW, engineH, hwScale);

        if (!converged) {
            if (this.mismatchStartTime === 0) {
                this.mismatchStartTime = now;
            }
            const mismatchDuration = now - this.mismatchStartTime;

            // Enter starvation if mismatch persists without any resize
            if (!this.isStarved && mismatchDuration >= STARVATION_THRESHOLD_MS) {
                this.isStarved = true;
                this.starvationEnterTime = now;

                const expectedW = hwScale > 0 ? Math.round(canvasBufW / hwScale) : 0;
                const expectedH = hwScale > 0 ? Math.round(canvasBufH / hwScale) : 0;
                const diffW = Math.abs(engineW - expectedW);
                const diffH = Math.abs(engineH - expectedH);
                const reason = `engine(${engineW}x${engineH}) != expected(${expectedW}x${expectedH}) ` +
                    `diff=(${diffW},${diffH}) buf=${canvasBufW}x${canvasBufH} hwScale=${hwScale}`;

                const evt: StarvationEnterEvent = {
                    type: 'STARVATION_ENTER',
                    frame: this.frameIndex,
                    t: this.toRelSec(now),
                    mismatchDurationMs: round2(mismatchDuration),
                    canvas: `${canvasBufW}x${canvasBufH}`,
                    engine: `${engineW}x${engineH}`,
                    mismatchReason: reason,
                    expectedEngine: `${expectedW}x${expectedH}`,
                    hwScale,
                    dpr: window.devicePixelRatio,
                };
                this.pushEvent(evt);
            }
        } else {
            if (this.isStarved) {
                const evt: StarvationExitEvent = {
                    type: 'STARVATION_EXIT',
                    frame: this.frameIndex,
                    t: this.toRelSec(now),
                    totalStarvationMs: round2(now - this.starvationEnterTime),
                    resolvedBy: (this.lastResizeTime > this.starvationEnterTime) ? 'resize' : 'convergence',
                };
                this.pushEvent(evt);
                this.isStarved = false;
            }
            this.mismatchStartTime = 0;
        }
    }

    // ============================================================
    // Output: JSON Timeline Export
    // ============================================================

    getTimeline(): FlightEvent[] {
        return this.timeline;
    }

    getTimelineJSON(): string {
        return JSON.stringify(this.timeline, null, 2);
    }

    /**
     * Generate a diagnostic summary object for JSON export.
     */
    generateDiagnosticSummary(): DiagnosticSummary {
        const probeEvents = this.timeline.filter(e => e.type === 'PHYSICAL_PROBE') as PhysicalProbeEvent[];
        const resizeEvents = this.timeline.filter(e => e.type === 'RESIZE') as FlightResizeEvent[];
        const anomalyOpens = this.timeline.filter(e => e.type === 'ANOMALY_OPEN') as AnomalyOpenEvent[];
        const anomalyCloses = this.timeline.filter(e => e.type === 'ANOMALY_CLOSE') as AnomalyCloseEvent[];
        const starvEnters = this.timeline.filter(e => e.type === 'STARVATION_ENTER') as StarvationEnterEvent[];
        const starvExits = this.timeline.filter(e => e.type === 'STARVATION_EXIT') as StarvationExitEvent[];
        const readyEvt = this.timeline.find(e => e.type === 'PHYSICAL_READY') as PhysicalReadyEvent | undefined;

        // Per-condition fail analysis
        const conditionNames = ['C1:CanvasBuf>0', 'C2:SizeConverged', 'C3:RAFStable', 'C4:ResizeOccurred', 'C5:Visible', 'C6:HwScaleStable', 'C7:DPR>0', 'C8:NoAnomalies'];
        const conditionFails: ConditionFailAnalysis[] = conditionNames.map((name, i) => {
            const key = `C${i + 1}` as keyof PhysicalProbeEvent;
            let failFrames = 0;
            let longestStreak = 0;
            let currentStreak = 0;
            let firstFailFrame = -1;
            let lastFailFrame = -1;

            for (const e of probeEvents) {
                const val = e[key] as boolean;
                if (!val) {
                    failFrames++;
                    currentStreak++;
                    if (firstFailFrame < 0) firstFailFrame = e.frame;
                    lastFailFrame = e.frame;
                    longestStreak = Math.max(longestStreak, currentStreak);
                } else {
                    currentStreak = 0;
                }
            }

            const failDurationMs = probeEvents.length > 0 && failFrames > 0
                ? round2((probeEvents[lastFailFrame >= 0 ? Math.min(lastFailFrame, probeEvents.length - 1) : 0].t -
                    probeEvents[firstFailFrame >= 0 ? Math.min(firstFailFrame, probeEvents.length - 1) : 0].t) * 1000)
                : 0;

            return {
                condition: name,
                failFrames,
                totalFrames: probeEvents.length,
                failPercent: probeEvents.length > 0 ? round2(failFrames / probeEvents.length * 100) : 0,
                longestFailStreak: longestStreak,
                firstFailFrame,
                lastFailFrame,
                failDurationMs,
            };
        });

        // Starvation summary
        const starvationSummary: StarvationSummary[] = starvEnters.map((enter, i) => {
            const exit = starvExits[i];
            return {
                enterFrame: enter.frame,
                enterTime: enter.t,
                exitFrame: exit?.frame ?? -1,
                exitTime: exit?.t ?? -1,
                durationMs: exit ? round2(exit.totalStarvationMs) : -1,
                mismatchReason: enter.mismatchReason,
                resolvedBy: exit?.resolvedBy ?? 'unresolved',
            };
        });

        // RAF_SLOW analysis: frames with rafDt > threshold
        const rafSlowFrames = probeEvents.filter(e => e.rafSlow);
        const rafSlowStreaks: { startFrame: number; endFrame: number; maxDt: number; avgDt: number }[] = [];
        let streakStart = -1;
        let streakDts: number[] = [];
        for (let i = 0; i < probeEvents.length; i++) {
            if (probeEvents[i].rafSlow) {
                if (streakStart < 0) streakStart = probeEvents[i].frame;
                streakDts.push(probeEvents[i].rafDt);
            } else {
                if (streakStart >= 0 && streakDts.length >= 2) {
                    rafSlowStreaks.push({
                        startFrame: streakStart,
                        endFrame: probeEvents[i - 1].frame,
                        maxDt: round2(Math.max(...streakDts)),
                        avgDt: round2(streakDts.reduce((a, b) => a + b, 0) / streakDts.length),
                    });
                }
                streakStart = -1;
                streakDts = [];
            }
        }
        if (streakStart >= 0 && streakDts.length >= 2) {
            rafSlowStreaks.push({
                startFrame: streakStart,
                endFrame: probeEvents[probeEvents.length - 1].frame,
                maxDt: round2(Math.max(...streakDts)),
                avgDt: round2(streakDts.reduce((a, b) => a + b, 0) / streakDts.length),
            });
        }

        // Resize context: 10 frames before and after each resize
        const resizeContexts: ResizeContext[] = resizeEvents.map(rEvt => {
            const preFrames = probeEvents
                .filter(p => p.frame >= rEvt.frame - 10 && p.frame < rEvt.frame)
                .map(p => ({ frame: p.frame, rafDt: p.rafDt, buffer: p.canvas.buffer, engine: p.canvas.engine, hwScale: p.hwScale, dpr: p.dpr, mismatch: p.mismatch }));
            const postFrames = probeEvents
                .filter(p => p.frame >= rEvt.frame && p.frame < rEvt.frame + 10)
                .map(p => ({ frame: p.frame, rafDt: p.rafDt, buffer: p.canvas.buffer, engine: p.canvas.engine, hwScale: p.hwScale, dpr: p.dpr, mismatch: p.mismatch }));
            const mismatchResolvedFrame = postFrames.find(p => !p.mismatch)?.frame ?? -1;

            return {
                resizeFrame: rEvt.frame,
                resizeTime: rEvt.t,
                source: rEvt.source,
                before: rEvt.before,
                after: rEvt.after,
                preFrames,
                postFrames,
                mismatchResolvedAtFrame: mismatchResolvedFrame,
            };
        });

        // Mismatch resolution analysis
        const mismatchFrames = probeEvents.filter(p => p.mismatch);
        const mismatchResolutions: { startFrame: number; endFrame: number; durationMs: number; resolvedByResize: boolean }[] = [];
        let mmStart = -1;
        let mmStartTime = 0;
        for (let i = 0; i < probeEvents.length; i++) {
            const p = probeEvents[i];
            if (p.mismatch) {
                if (mmStart < 0) { mmStart = p.frame; mmStartTime = p.t; }
            } else {
                if (mmStart >= 0) {
                    const resolvedByResize = resizeEvents.some(r => r.frame >= mmStart && r.frame <= p.frame);
                    mismatchResolutions.push({
                        startFrame: mmStart,
                        endFrame: p.frame,
                        durationMs: round2((p.t - mmStartTime) * 1000),
                        resolvedByResize,
                    });
                    mmStart = -1;
                }
            }
        }

        return {
            totalFrames: probeEvents.length,
            totalDurationMs: probeEvents.length > 0
                ? round2((probeEvents[probeEvents.length - 1].t - probeEvents[0].t) * 1000)
                : 0,
            physicalReadyAchieved: !!readyEvt,
            physicalReadyFrame: readyEvt?.frame ?? -1,
            physicalReadyTime: readyEvt?.t ?? -1,
            conditionFails,
            starvationEvents: starvationSummary,
            rafSlowFrameCount: rafSlowFrames.length,
            rafSlowStreaks,
            resizeCount: resizeEvents.length,
            resizeContexts: resizeContexts.slice(0, 20), // limit to first 20
            mismatchFrameCount: mismatchFrames.length,
            mismatchResolutions,
            anomalyOpens: anomalyOpens.map(a => ({ frame: a.frame, t: a.t, anomaly: a.anomaly, evidence: a.evidence })),
            anomalyCloses: anomalyCloses.map(a => ({ frame: a.frame, t: a.t, anomaly: a.anomaly, durationMs: a.durationMs })),
        };
    }

    /**
     * Print comprehensive diagnostic summary to console.
     */
    printSummary(): void {
        const summary = this.generateDiagnosticSummary();
        const probeEvents = this.timeline.filter(e => e.type === 'PHYSICAL_PROBE') as PhysicalProbeEvent[];

        console.group('[FlightRecorderProbe] DIAGNOSTIC SUMMARY');
        console.log(`Total: ${summary.totalFrames} frames, ${summary.totalDurationMs}ms`);
        console.log(`PHYSICAL_READY: ${summary.physicalReadyAchieved ? `YES at frame=${summary.physicalReadyFrame} t=${summary.physicalReadyTime}s` : 'NEVER'}`);

        // ---- Per-condition fail analysis ----
        console.group('CONDITION FAIL ANALYSIS');
        console.table(summary.conditionFails.map(c => ({
            condition: c.condition,
            failFrames: c.failFrames,
            failPercent: `${c.failPercent}%`,
            longestStreak: c.longestFailStreak,
            firstFail: c.firstFailFrame,
            lastFail: c.lastFailFrame,
            failDuration: `${c.failDurationMs}ms`,
        })));
        console.groupEnd();

        // ---- RAF_SLOW correlation ----
        if (summary.rafSlowFrameCount > 0) {
            console.group(`RAF_SLOW Analysis (${summary.rafSlowFrameCount} frames > ${RAF_SLOW_THRESHOLD_MS}ms)`);
            if (summary.rafSlowStreaks.length > 0) {
                console.table(summary.rafSlowStreaks.slice(0, 15).map(s => ({
                    frames: `${s.startFrame}→${s.endFrame}`,
                    length: s.endFrame - s.startFrame + 1,
                    maxDt: `${s.maxDt}ms`,
                    avgDt: `${s.avgDt}ms`,
                })));
            }

            // Correlation: did RAF_SLOW prevent PHYSICAL_READY?
            if (!summary.physicalReadyAchieved) {
                const c3Fails = summary.conditionFails[2]; // C3: RAF stable
                console.log(`C3(RAF stable) failed ${c3Fails.failFrames} frames (${c3Fails.failPercent}%) — ` +
                    `longest streak: ${c3Fails.longestFailStreak} frames`);
                console.log('>>> RAF_SLOW is likely a PRIMARY blocker for PHYSICAL_READY');
            }
            console.groupEnd();
        }

        // ---- Starvation analysis ----
        if (summary.starvationEvents.length > 0) {
            console.group(`STARVATION Events (${summary.starvationEvents.length})`);
            console.table(summary.starvationEvents.map(s => ({
                enter: `frame=${s.enterFrame} t=${s.enterTime}s`,
                exit: s.exitFrame >= 0 ? `frame=${s.exitFrame} t=${s.exitTime}s` : 'UNRESOLVED',
                duration: s.durationMs >= 0 ? `${s.durationMs}ms` : 'ongoing',
                reason: s.mismatchReason,
                resolvedBy: s.resolvedBy,
            })));
            console.groupEnd();
        }

        // ---- Resize context (pre/post 10 frames) ----
        if (summary.resizeContexts.length > 0) {
            console.group(`RESIZE Context (${summary.resizeCount} events, showing pre/post 10 frames)`);
            for (const ctx of summary.resizeContexts.slice(0, 5)) {
                console.group(`Resize at frame=${ctx.resizeFrame} t=${ctx.resizeTime}s source=${ctx.source}`);
                console.log(`Before: ${ctx.before.buffer} eng=${ctx.before.engine} hw=${ctx.before.hwScale} dpr=${ctx.before.dpr}`);
                console.log(`After:  ${ctx.after ? `${ctx.after.buffer} eng=${ctx.after.engine} hw=${ctx.after.hwScale} dpr=${ctx.after.dpr}` : 'pending'}`);
                console.log(`Mismatch resolved at frame: ${ctx.mismatchResolvedAtFrame >= 0 ? ctx.mismatchResolvedAtFrame : 'NOT resolved in window'}`);
                if (ctx.preFrames.length > 0 || ctx.postFrames.length > 0) {
                    console.table([...ctx.preFrames, ...ctx.postFrames].map(f => ({
                        frame: f.frame,
                        rafDt: `${f.rafDt}ms`,
                        buffer: f.buffer,
                        engine: f.engine,
                        hwScale: f.hwScale,
                        mismatch: f.mismatch,
                        marker: f.frame === ctx.resizeFrame ? '<<< RESIZE' : '',
                    })));
                }
                console.groupEnd();
            }
            console.groupEnd();
        }

        // ---- Mismatch resolution ----
        if (summary.mismatchResolutions.length > 0) {
            console.group(`MISMATCH Resolution (${summary.mismatchResolutions.length} episodes, ${summary.mismatchFrameCount} total frames)`);
            console.table(summary.mismatchResolutions.slice(0, 10).map(m => ({
                frames: `${m.startFrame}→${m.endFrame}`,
                duration: `${m.durationMs}ms`,
                resolvedByResize: m.resolvedByResize,
            })));
            console.groupEnd();
        }

        // ---- Anomaly timeline ----
        if (summary.anomalyOpens.length > 0) {
            console.group(`ANOMALY Timeline (${summary.anomalyOpens.length} opens, ${summary.anomalyCloses.length} closes)`);
            const allAnomalyEvts = [
                ...summary.anomalyOpens.map(a => ({ ...a, evtType: 'OPEN' as const })),
                ...summary.anomalyCloses.map(a => ({ ...a, evtType: 'CLOSE' as const })),
            ].sort((a, b) => a.t - b.t);
            console.table(allAnomalyEvts.slice(0, 20).map(e => ({
                t: `${e.t}s`,
                type: e.evtType,
                anomaly: e.anomaly,
                detail: e.evtType === 'OPEN' ? (e as typeof summary.anomalyOpens[0] & { evtType: 'OPEN' }).evidence : `${(e as typeof summary.anomalyCloses[0] & { evtType: 'CLOSE' }).durationMs}ms`,
            })));
            console.groupEnd();
        }

        // ---- Final frames (for debugging never-achieved) ----
        if (!summary.physicalReadyAchieved && probeEvents.length > 0) {
            console.group('FINAL 10 FRAMES (PHYSICAL_READY never achieved)');
            console.table(probeEvents.slice(-10).map(e => ({
                frame: e.frame,
                t: `${e.t}s`,
                C1: e.C1, C2: e.C2, C3: e.C3, C4: e.C4,
                C5: e.C5, C6: e.C6, C7: e.C7, C8: e.C8,
                rafDt: `${e.rafDt}ms`,
                mismatch: e.mismatch,
                starvation: e.starvation,
                stable: e.stableFrames,
            })));
            console.groupEnd();
        }

        // Store for extraction
        (window as unknown as Record<string, unknown>).__flightRecorderTimeline = this.timeline;
        (window as unknown as Record<string, unknown>).__flightRecorderSummary = summary;
        console.log('Data stored: window.__flightRecorderTimeline (events), window.__flightRecorderSummary (analysis)');

        console.groupEnd();
    }

    // ============================================================
    // Helpers
    // ============================================================

    private pushEvent(evt: FlightEvent): void {
        if (this.timeline.length < this.config.maxEvents) {
            this.timeline.push(evt);
        }
    }

    private toRelSec(absTime: number): number {
        return round2((absTime - this.startTime) / 1000);
    }

    private relTimeSec(): string {
        return this.toRelSec(performance.now()).toFixed(2);
    }

    private log(msg: string): void {
        if (this.config.consoleOutput) {
            console.log(`[FlightRecorder] ${msg}`);
        }
    }

    // ============================================================
    // Teardown
    // ============================================================

    private teardownAll(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        if (this.afterRenderObs) {
            this.scene.onAfterRenderObservable.remove(this.afterRenderObs);
            this.afterRenderObs = null;
        }
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
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }
        if (this.autoStopTimer) {
            clearTimeout(this.autoStopTimer);
            this.autoStopTimer = null;
        }
    }
}

// ============================================================
// Utility
// ============================================================

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function round3(n: number): number {
    return Math.round(n * 1000) / 1000;
}
