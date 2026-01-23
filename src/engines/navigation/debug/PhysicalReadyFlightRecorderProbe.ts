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

/**
 * PhysicalProbeEvent — Per-frame raw physical state.
 * Matches the required output format exactly.
 */
export interface PhysicalProbeEvent {
    type: 'PHYSICAL_PROBE';
    frame: number;
    t: number; // relative time in seconds (2 decimal precision)
    PHYSICAL_READY: boolean;
    canvas: {
        css: string;      // e.g. "1618x1282"
        buffer: string;   // e.g. "2427x1923"
        engine: string;   // e.g. "2427x1923"
    };
    hwScale: number;
    dpr: number;
    visibility: DocumentVisibilityState;
    rafDt: number;        // ms, 2 decimal
    resizeGap: number;    // seconds since last resize, 0 if none
    anomalies: AnomalyType[];
    starvation: boolean;
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

        // Resize gap
        const resizeGap = this.lastResizeTime < 0
            ? 0
            : (now - this.lastResizeTime) / 1000;

        // Run anomaly detection
        this.detectAnomalies(now, canvasBufW, canvasBufH, engineW, engineH, hwScale, dpr);

        // Run starvation detection
        this.detectStarvation(now, canvasBufW, canvasBufH, engineW, engineH, hwScale);

        // Evaluate PHYSICAL_READY
        const physReady = this.evaluatePhysicalReady(
            now, canvasBufW, canvasBufH, engineW, engineH,
            hwScale, dpr, rafDt, visibility, hasFocus
        );

        // Emit PHYSICAL_PROBE event
        const activeAnomalies = Array.from(this.activeAnomalies.keys());
        const probeEvent: PhysicalProbeEvent = {
            type: 'PHYSICAL_PROBE',
            frame: this.frameIndex,
            t: this.toRelSec(now),
            PHYSICAL_READY: physReady,
            canvas: {
                css: `${canvasCssW}x${canvasCssH}`,
                buffer: `${canvasBufW}x${canvasBufH}`,
                engine: `${engineW}x${engineH}`,
            },
            hwScale: round3(hwScale),
            dpr: round3(dpr),
            visibility,
            rafDt: round2(rafDt),
            resizeGap: round2(resizeGap),
            anomalies: activeAnomalies,
            starvation: this.isStarved,
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

    private evaluatePhysicalReady(
        now: number,
        canvasBufW: number, canvasBufH: number,
        engineW: number, engineH: number,
        hwScale: number, dpr: number,
        rafDt: number,
        visibility: DocumentVisibilityState,
        hasFocus: boolean,
    ): boolean {
        if (this.physicalReadyConfirmed) return true;

        // 8 conditions (all must be true simultaneously)
        const conditions = [
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

                return true;
            }
        } else {
            // Reset
            this.consecutiveStable = 0;
            this.physicalReadySustainStart = 0;
        }

        return false;
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

                const evt: StarvationEnterEvent = {
                    type: 'STARVATION_ENTER',
                    frame: this.frameIndex,
                    t: this.toRelSec(now),
                    mismatchDurationMs: round2(mismatchDuration),
                    canvas: `${canvasBufW}x${canvasBufH}`,
                    engine: `${engineW}x${engineH}`,
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
     * Print a summary to console. For the full timeline, use getTimeline() or getTimelineJSON().
     */
    printSummary(): void {
        const probeEvents = this.timeline.filter(e => e.type === 'PHYSICAL_PROBE') as PhysicalProbeEvent[];
        const resizeEvents = this.timeline.filter(e => e.type === 'RESIZE') as FlightResizeEvent[];
        const anomalyOpens = this.timeline.filter(e => e.type === 'ANOMALY_OPEN') as AnomalyOpenEvent[];
        const anomalyCloses = this.timeline.filter(e => e.type === 'ANOMALY_CLOSE') as AnomalyCloseEvent[];
        const starvEnters = this.timeline.filter(e => e.type === 'STARVATION_ENTER') as StarvationEnterEvent[];
        const starvExits = this.timeline.filter(e => e.type === 'STARVATION_EXIT') as StarvationExitEvent[];
        const readyEvt = this.timeline.find(e => e.type === 'PHYSICAL_READY') as PhysicalReadyEvent | undefined;

        console.group('[FlightRecorderProbe] SUMMARY');
        console.log(`Total events: ${this.timeline.length} | Frames: ${this.frameIndex}`);
        console.log(`Duration: ${((performance.now() - this.startTime) / 1000).toFixed(1)}s`);
        console.log(`Resize events: ${resizeEvents.length} | Anomaly opens: ${anomalyOpens.length}`);
        console.log(`Starvation entries: ${starvEnters.length}`);

        if (readyEvt) {
            console.group('★ PHYSICAL_READY');
            console.log(`Achieved at frame=${readyEvt.frame} t=${readyEvt.t}s`);
            console.log(`Sustained: ${readyEvt.sustainedMs}ms | Stable frames: ${readyEvt.stableFrames}`);
            console.log('Values:', readyEvt.conditionValues);
            console.groupEnd();
        } else {
            console.warn('PHYSICAL_READY was NEVER achieved.');

            // Show last 5 probe events for context
            const last5 = probeEvents.slice(-5);
            if (last5.length > 0) {
                console.group('Last 5 frames:');
                console.table(last5.map(e => ({
                    frame: e.frame,
                    t: `${e.t}s`,
                    ready: e.PHYSICAL_READY,
                    canvas: e.canvas.buffer,
                    engine: e.canvas.engine,
                    hwScale: e.hwScale,
                    rafDt: `${e.rafDt}ms`,
                    anomalies: e.anomalies.join(',') || 'none',
                    starvation: e.starvation,
                })));
                console.groupEnd();
            }
        }

        // Anomaly timeline
        if (anomalyOpens.length > 0) {
            console.group(`Anomaly Timeline (${anomalyOpens.length} opens, ${anomalyCloses.length} closes)`);
            const anomalyEvents = [...anomalyOpens, ...anomalyCloses].sort((a, b) => a.t - b.t);
            console.table(anomalyEvents.slice(0, 20).map(e => ({
                t: `${e.t}s`,
                type: e.type,
                anomaly: e.anomaly,
                detail: e.type === 'ANOMALY_OPEN'
                    ? (e as AnomalyOpenEvent).evidence
                    : `duration=${(e as AnomalyCloseEvent).durationMs}ms`,
            })));
            console.groupEnd();
        }

        // Starvation timeline
        if (starvEnters.length > 0) {
            console.group(`Starvation Timeline (${starvEnters.length} entries)`);
            const starvEvents = [...starvEnters, ...starvExits].sort((a, b) => a.t - b.t);
            console.table(starvEvents.map(e => ({
                t: `${e.t}s`,
                type: e.type,
                detail: e.type === 'STARVATION_ENTER'
                    ? `mismatch=${(e as StarvationEnterEvent).mismatchDurationMs}ms canvas=${(e as StarvationEnterEvent).canvas} engine=${(e as StarvationEnterEvent).engine}`
                    : `total=${(e as StarvationExitEvent).totalStarvationMs}ms resolvedBy=${(e as StarvationExitEvent).resolvedBy}`,
            })));
            console.groupEnd();
        }

        // Make timeline available on window for extraction
        (window as unknown as Record<string, unknown>).__flightRecorderTimeline = this.timeline;
        console.log('💾 Timeline stored at window.__flightRecorderTimeline (use JSON.stringify for export)');

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
