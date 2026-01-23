/**
 * RenderDesyncProbe - Critical Rendering Desync Investigation
 *
 * Purpose: Diagnose the gap between READY declaration and actual first render frame.
 *
 * Key Hypotheses:
 * 1. First actual render frame is delayed after READY
 * 2. engine.runRenderLoop is registered but tick doesn't happen
 * 3. canvas size / buffer size / DPR is 0 or stale at initial frame
 * 4. Browser reflow/resize event is needed to "awaken" rendering
 *
 * This module is FOR DEBUGGING ONLY. Do not use in production.
 */

import * as BABYLON from '@babylonjs/core';

export interface RenderDesyncTimings {
    readyDeclaredAt: number;
    firstBeforeRenderAt: number | null;
    firstAfterRenderAt: number | null;
    firstRenderLoopTickAt: number | null;
    visualReadyPassedAt: number | null;
    resizeEventAt: number | null;
}

export interface CanvasEngineState {
    cssWidth: number;
    cssHeight: number;
    bufferWidth: number;
    bufferHeight: number;
    engineRenderWidth: number;
    engineRenderHeight: number;
    devicePixelRatio: number;
    hardwareScalingLevel: number;
    isCanvasReady: boolean;
}

/**
 * RenderDesyncProbe - Diagnostic tool for READY vs actual render timing
 */
export class RenderDesyncProbe {
    private scene: BABYLON.Scene;
    private engine: BABYLON.AbstractEngine;
    private timings: RenderDesyncTimings;
    private frameCount: number = 0;
    private renderLoopObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private resizeListener: (() => void) | null = null;
    private disposed: boolean = false;

    // Static timestamp for VISUAL_READY (set externally)
    static visualReadyTimestamp: number | null = null;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
        this.engine = scene.getEngine();
        this.timings = {
            readyDeclaredAt: 0,
            firstBeforeRenderAt: null,
            firstAfterRenderAt: null,
            firstRenderLoopTickAt: null,
            visualReadyPassedAt: null,
            resizeEventAt: null,
        };
    }

    /**
     * Start probing at READY declaration
     */
    startProbe(): void {
        if (this.disposed) return;

        this.timings.readyDeclaredAt = performance.now();
        this.timings.visualReadyPassedAt = RenderDesyncProbe.visualReadyTimestamp;
        this.frameCount = 0;

        console.log('[PROBE] ========== RENDER DESYNC PROBE STARTED ==========');
        console.log('[PROBE] READY declared at:', this.timings.readyDeclaredAt.toFixed(2), 'ms');

        if (this.timings.visualReadyPassedAt) {
            const gap = this.timings.readyDeclaredAt - this.timings.visualReadyPassedAt;
            console.log('[PROBE] VISUAL_READY passed at:', this.timings.visualReadyPassedAt.toFixed(2), 'ms');
            console.log('[PROBE] Gap (READY - VISUAL_READY):', gap.toFixed(2), 'ms');
        }

        // 1. Dump immediate canvas/engine state
        this.dumpCanvasState('AT_READY');

        // 2. Monitor first render frame
        this.monitorFirstFrame();

        // 3. Monitor resize events
        this.monitorResizeEvents();

        // 4. Schedule delayed state dumps
        this.scheduleDelayedDumps();
    }

    /**
     * Dump canvas and engine state
     */
    private dumpCanvasState(label: string): CanvasEngineState {
        const canvas = this.engine.getRenderingCanvas();

        const state: CanvasEngineState = {
            cssWidth: canvas?.clientWidth ?? 0,
            cssHeight: canvas?.clientHeight ?? 0,
            bufferWidth: canvas?.width ?? 0,
            bufferHeight: canvas?.height ?? 0,
            engineRenderWidth: this.engine.getRenderWidth(),
            engineRenderHeight: this.engine.getRenderHeight(),
            devicePixelRatio: window.devicePixelRatio,
            hardwareScalingLevel: this.engine.getHardwareScalingLevel(),
            isCanvasReady: !!(canvas && canvas.width > 0 && canvas.height > 0),
        };

        console.log(`[PROBE] Canvas State (${label}):`, {
            css: `${state.cssWidth}x${state.cssHeight}`,
            buffer: `${state.bufferWidth}x${state.bufferHeight}`,
            engine: `${state.engineRenderWidth}x${state.engineRenderHeight}`,
            dpr: state.devicePixelRatio,
            hwScaling: state.hardwareScalingLevel,
            ready: state.isCanvasReady,
        });

        // Check for critical issues
        if (state.bufferWidth === 0 || state.bufferHeight === 0) {
            console.error('[PROBE] ⚠️ CRITICAL: Canvas buffer size is ZERO!');
        }
        if (state.engineRenderWidth === 0 || state.engineRenderHeight === 0) {
            console.error('[PROBE] ⚠️ CRITICAL: Engine render size is ZERO!');
        }
        if (state.cssWidth !== state.bufferWidth / state.devicePixelRatio) {
            console.warn('[PROBE] ⚠️ CSS size and buffer size mismatch (DPR issue?)');
        }

        return state;
    }

    /**
     * Monitor first render frame timing
     */
    private monitorFirstFrame(): void {
        // Before render
        this.scene.onBeforeRenderObservable.addOnce(() => {
            this.timings.firstBeforeRenderAt = performance.now();
            const gap = this.timings.firstBeforeRenderAt - this.timings.readyDeclaredAt;
            console.log('[PROBE] First onBeforeRender at:', this.timings.firstBeforeRenderAt.toFixed(2), 'ms');
            console.log('[PROBE] Gap (FirstBeforeRender - READY):', gap.toFixed(2), 'ms');

            if (gap > 100) {
                console.warn('[PROBE] ⚠️ First render frame delayed by', gap.toFixed(0), 'ms after READY!');
            }
        });

        // After render
        this.scene.onAfterRenderObservable.addOnce(() => {
            this.timings.firstAfterRenderAt = performance.now();
            const gap = this.timings.firstAfterRenderAt - this.timings.readyDeclaredAt;
            console.log('[PROBE] First onAfterRender at:', this.timings.firstAfterRenderAt.toFixed(2), 'ms');
            console.log('[PROBE] Gap (FirstAfterRender - READY):', gap.toFixed(2), 'ms');

            // Dump state after first frame
            this.dumpCanvasState('AFTER_FIRST_FRAME');
        });

        // Render loop tick counter
        this.renderLoopObserver = this.scene.onBeforeRenderObservable.add(() => {
            this.frameCount++;

            if (this.frameCount === 1) {
                this.timings.firstRenderLoopTickAt = performance.now();
                console.log('[PROBE] First render loop tick at:', this.timings.firstRenderLoopTickAt.toFixed(2), 'ms');
            }

            // Log first 5 frames
            if (this.frameCount <= 5) {
                console.log(`[PROBE] Frame ${this.frameCount} rendered at:`, performance.now().toFixed(2), 'ms');
            }

            // Stop monitoring after 10 frames
            if (this.frameCount >= 10 && this.renderLoopObserver) {
                this.scene.onBeforeRenderObservable.remove(this.renderLoopObserver);
                this.renderLoopObserver = null;
                this.printFinalReport();
            }
        });
    }

    /**
     * Monitor resize events
     */
    private monitorResizeEvents(): void {
        this.resizeListener = () => {
            const now = performance.now();
            if (!this.timings.resizeEventAt) {
                this.timings.resizeEventAt = now;
                const gap = now - this.timings.readyDeclaredAt;
                console.log('[PROBE] First resize event at:', now.toFixed(2), 'ms');
                console.log('[PROBE] Gap (Resize - READY):', gap.toFixed(2), 'ms');
                this.dumpCanvasState('AFTER_RESIZE');
            }
        };

        window.addEventListener('resize', this.resizeListener);

        // Also log if DevTools might be opening (visibility change)
        document.addEventListener('visibilitychange', () => {
            console.log('[PROBE] Visibility changed to:', document.visibilityState);
        });
    }

    /**
     * Schedule delayed state dumps
     */
    private scheduleDelayedDumps(): void {
        // Dump at 100ms
        setTimeout(() => {
            if (!this.disposed) {
                console.log('[PROBE] --- 100ms after READY ---');
                this.dumpCanvasState('AT_100MS');
                console.log('[PROBE] Frames rendered so far:', this.frameCount);
            }
        }, 100);

        // Dump at 500ms
        setTimeout(() => {
            if (!this.disposed) {
                console.log('[PROBE] --- 500ms after READY ---');
                this.dumpCanvasState('AT_500MS');
                console.log('[PROBE] Frames rendered so far:', this.frameCount);
            }
        }, 500);

        // Dump at 1000ms
        setTimeout(() => {
            if (!this.disposed) {
                console.log('[PROBE] --- 1000ms after READY ---');
                this.dumpCanvasState('AT_1000MS');
                console.log('[PROBE] Frames rendered so far:', this.frameCount);

                if (this.frameCount === 0) {
                    console.error('[PROBE] ⚠️⚠️⚠️ CRITICAL: NO FRAMES RENDERED AFTER 1 SECOND!');
                    console.error('[PROBE] This confirms render loop is NOT ticking.');
                }
            }
        }, 1000);
    }

    /**
     * Print final diagnostic report
     */
    private printFinalReport(): void {
        console.log('[PROBE] ========== RENDER DESYNC PROBE REPORT ==========');
        console.log('[PROBE] Timings:', this.timings);

        const analysis: string[] = [];

        // Analyze timing gaps
        if (this.timings.firstBeforeRenderAt && this.timings.readyDeclaredAt) {
            const gap = this.timings.firstBeforeRenderAt - this.timings.readyDeclaredAt;
            if (gap > 100) {
                analysis.push(`⚠️ First frame delayed ${gap.toFixed(0)}ms after READY - render loop may be stalled`);
            } else if (gap > 16) {
                analysis.push(`First frame gap of ${gap.toFixed(0)}ms (1+ frame delay) - minor`);
            } else {
                analysis.push(`✓ First frame timing normal (${gap.toFixed(1)}ms gap)`);
            }
        } else {
            analysis.push('⚠️ First frame timing could not be measured');
        }

        // Analyze VISUAL_READY timing
        if (this.timings.visualReadyPassedAt && this.timings.firstBeforeRenderAt) {
            if (this.timings.visualReadyPassedAt > this.timings.firstBeforeRenderAt) {
                analysis.push('✓ VISUAL_READY correctly fired after first render');
            } else {
                const earlyBy = this.timings.firstBeforeRenderAt - this.timings.visualReadyPassedAt;
                analysis.push(`⚠️ VISUAL_READY fired ${earlyBy.toFixed(0)}ms BEFORE first render - timing issue!`);
            }
        }

        // Analyze resize dependency
        if (this.timings.resizeEventAt && this.timings.firstBeforeRenderAt) {
            if (this.timings.resizeEventAt < this.timings.firstBeforeRenderAt) {
                analysis.push('⚠️ Resize event preceded first frame - rendering may depend on resize');
            }
        }

        console.log('[PROBE] Analysis:');
        analysis.forEach(line => console.log('[PROBE]  -', line));
        console.log('[PROBE] =====================================================');
    }

    /**
     * Force trigger a resize to test if it "wakes up" rendering
     */
    forceResizeTest(): void {
        console.log('[PROBE] Forcing engine.resize() as test...');
        const beforeFrames = this.frameCount;
        this.engine.resize();

        setTimeout(() => {
            const afterFrames = this.frameCount;
            console.log('[PROBE] After forced resize: frames', beforeFrames, '->', afterFrames);
            if (afterFrames > beforeFrames) {
                console.log('[PROBE] ✓ Resize triggered rendering!');
            } else {
                console.log('[PROBE] Resize did NOT trigger additional frames');
            }
        }, 100);
    }

    /**
     * Mark the actual READY declaration timestamp.
     * Call this when READY is officially declared (after ENGINE_AWAKENED).
     */
    markReadyDeclared(): void {
        this.timings.readyDeclaredAt = performance.now();
        console.log('[PROBE] READY declared at:', this.timings.readyDeclaredAt.toFixed(2), 'ms (post-ENGINE_AWAKENED)');
    }

    /**
     * Get current timings for acceptance criteria validation
     */
    getTimings(): Readonly<RenderDesyncTimings> {
        return { ...this.timings };
    }

    /**
     * Dispose probe
     */
    dispose(): void {
        this.disposed = true;

        if (this.renderLoopObserver) {
            this.scene.onBeforeRenderObservable.remove(this.renderLoopObserver);
            this.renderLoopObserver = null;
        }

        if (this.resizeListener) {
            window.removeEventListener('resize', this.resizeListener);
            this.resizeListener = null;
        }
    }
}

/**
 * Acceptance criteria result from validateAcceptanceCriteria()
 */
export interface AcceptanceCriteriaResult {
    passed: boolean;
    criteria: {
        firstBeforeRenderExists: boolean;
        firstRenderLoopTickExists: boolean;
        firstFrameWithin16msOfReady: boolean;
        noDelayedFirstFrame: boolean;
        visualReadyWithin100msOfRender: boolean;
    };
    details: string[];
}

/**
 * Validate RenderDesyncProbe acceptance criteria.
 * Call this AFTER READY is declared to verify correctness.
 *
 * Acceptance rules (all must pass):
 * 1. firstBeforeRenderAt exists
 * 2. firstRenderLoopTickAt exists
 * 3. (firstBeforeRenderAt - readyDeclaredAt) <= 16ms
 * 4. No "first frame delayed > 50ms after READY" warning
 * 5. (firstRenderLoopTickAt - visualReadyPassedAt) <= 100ms
 */
export function validateAcceptanceCriteria(
    probe: RenderDesyncProbe
): AcceptanceCriteriaResult {
    const timings = probe.getTimings();
    const details: string[] = [];

    // Rule 1: firstBeforeRenderAt exists
    const r1 = timings.firstBeforeRenderAt !== null;
    if (!r1) details.push('✗ firstBeforeRenderAt is NULL — no render frame detected');

    // Rule 2: firstRenderLoopTickAt exists
    const r2 = timings.firstRenderLoopTickAt !== null;
    if (!r2) details.push('✗ firstRenderLoopTickAt is NULL — render loop never ticked');

    // Rule 3: first frame within 16ms of READY declaration
    let r3 = false;
    if (timings.firstBeforeRenderAt !== null && timings.readyDeclaredAt > 0) {
        const gap = timings.firstBeforeRenderAt - timings.readyDeclaredAt;
        r3 = gap <= 16;
        if (!r3) {
            details.push(`✗ First frame ${gap.toFixed(1)}ms after READY (limit: 16ms)`);
        }
    }

    // Rule 4: No first frame delayed > 50ms
    let r4 = false;
    if (timings.firstBeforeRenderAt !== null && timings.readyDeclaredAt > 0) {
        const gap = timings.firstBeforeRenderAt - timings.readyDeclaredAt;
        r4 = gap <= 50;
        if (!r4) {
            details.push(`✗ First frame delayed ${gap.toFixed(1)}ms after READY (limit: 50ms)`);
        }
    }

    // Rule 5: VISUAL_READY within 100ms of first render
    let r5 = false;
    if (timings.visualReadyPassedAt !== null && timings.firstRenderLoopTickAt !== null) {
        const gap = timings.firstRenderLoopTickAt - timings.visualReadyPassedAt;
        r5 = gap <= 100;
        if (!r5) {
            details.push(`✗ First render ${gap.toFixed(1)}ms after VISUAL_READY (limit: 100ms)`);
        }
    } else if (timings.visualReadyPassedAt === null) {
        details.push('✗ VISUAL_READY timestamp missing');
    }

    const passed = r1 && r2 && r3 && r4 && r5;

    if (passed) {
        details.push('✓ All acceptance criteria passed');
    }

    const result: AcceptanceCriteriaResult = {
        passed,
        criteria: {
            firstBeforeRenderExists: r1,
            firstRenderLoopTickExists: r2,
            firstFrameWithin16msOfReady: r3,
            noDelayedFirstFrame: r4,
            visualReadyWithin100msOfRender: r5,
        },
        details,
    };

    console.log('[PROBE] ========== ACCEPTANCE CRITERIA ==========');
    console.log('[PROBE] Result:', passed ? '✓ PASSED' : '✗ FAILED');
    details.forEach(d => console.log('[PROBE]  ', d));
    console.log('[PROBE] ===========================================');

    return result;
}

/**
 * Utility to mark VISUAL_READY timestamp
 */
export function markVisualReadyTimestamp(): void {
    RenderDesyncProbe.visualReadyTimestamp = performance.now();
    console.log('[PROBE] VISUAL_READY marked at:', RenderDesyncProbe.visualReadyTimestamp.toFixed(2), 'ms');
}
