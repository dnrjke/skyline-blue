/**
 * RAF Lab - Isolated Debugging Tool for RAF/Black Hole Issues
 *
 * PURPOSE:
 * This is a standalone debugging environment to identify exactly which
 * loading phase triggers Chromium's RAF throttle and why it doesn't recover.
 *
 * DESIGN:
 * - Completely independent from the main game flow
 * - Tests each loading phase in isolation with precise RAF measurements
 * - Provides clear visual feedback on RAF health at each step
 * - Documents findings for future reference
 *
 * PHASES TO TEST:
 * 1. Baseline: Empty scene creation
 * 2. GLB Loading: Character model load
 * 3. Material Warmup: Shader compilation
 * 4. Barrier: ENGINE_AWAKENED wait
 * 5. Transfer: Pulse host → game scene
 *
 * LIFECYCLE:
 * This tool will be removed after the RAF issue is resolved and documented.
 *
 * @see docs/raf-lab-findings.md (to be created after resolution)
 */

import * as BABYLON from '@babylonjs/core';
import { RAFMeter, RAFMeterResult } from './RAFMeter';
import { PhaseRunner, PhaseResult } from './PhaseRunner';
import { LabUI } from './LabUI';

// Model path for testing (same as main app)
const TEST_MODEL_PATH = '/assets/characters/pilot.glb';

export interface RAFLabConfig {
    /** Canvas element to use */
    canvas: HTMLCanvasElement;

    /** Enable verbose logging */
    debug?: boolean;

    /** Auto-start phases on launch */
    autoStart?: boolean;
}

export interface RAFLabResult {
    /** All phase results */
    phases: PhaseResult[];

    /** Overall diagnosis */
    diagnosis: string;

    /** Identified throttle trigger phase (if any) */
    throttleTriggerPhase: string | null;

    /** Total elapsed time */
    totalElapsedMs: number;
}

/**
 * RAF Lab - Main Controller
 */
export class RAFLab {
    private config: Required<RAFLabConfig>;
    private engine: BABYLON.Engine | null = null;
    private scene: BABYLON.Scene | null = null;
    private rafMeter: RAFMeter;
    private phaseRunner: PhaseRunner | null = null;
    private labUI: LabUI | null = null;
    private results: PhaseResult[] = [];
    private startTime: number = 0;

    constructor(config: RAFLabConfig) {
        this.config = {
            canvas: config.canvas,
            debug: config.debug ?? true,
            autoStart: config.autoStart ?? false,
        };

        this.rafMeter = new RAFMeter({ debug: this.config.debug });
    }

    /**
     * Initialize the lab environment
     */
    async initialize(): Promise<void> {
        this.log('═══════════════════════════════════════');
        this.log('       RAF LAB - Debugging Tool');
        this.log('═══════════════════════════════════════');
        this.log('Purpose: Isolate RAF throttle trigger');
        this.log('');

        // Phase 0: Create engine (no scene yet)
        this.log('[Phase 0] Creating Babylon Engine...');
        this.engine = new BABYLON.Engine(this.config.canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true,
        });

        // Measure baseline RAF before any scene
        this.log('[Phase 0] Measuring baseline RAF (no scene)...');
        const baselineResult = await this.rafMeter.measureBaseline(50);
        this.logRAFResult('Baseline (no scene)', baselineResult);

        // Create empty scene
        this.log('[Phase 0] Creating empty scene...');
        this.scene = new BABYLON.Scene(this.engine);

        // Add basic camera (required for render loop)
        const camera = new BABYLON.ArcRotateCamera(
            'lab-camera',
            0, Math.PI / 3, 10,
            BABYLON.Vector3.Zero(),
            this.scene
        );
        camera.attachControl(this.config.canvas, true);

        // Add basic light
        new BABYLON.HemisphericLight(
            'lab-light',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );

        // Start render loop
        this.engine.runRenderLoop(() => {
            if (this.scene) {
                this.scene.render();
            }
        });

        // Measure RAF after empty scene render loop starts
        this.log('[Phase 0] Measuring RAF with empty scene render loop...');
        const emptySceneResult = await this.rafMeter.measure(this.scene, 50);
        this.logRAFResult('Empty scene (render loop)', emptySceneResult);

        // Create phase runner
        this.phaseRunner = new PhaseRunner(this.engine, this.scene, {
            debug: this.config.debug,
            rafMeter: this.rafMeter,
        });

        // Create UI
        this.labUI = new LabUI(this.scene, {
            onStartPhases: () => this.runAllPhases(),
            onReset: () => this.reset(),
        });
        await this.labUI.initialize();

        this.log('');
        this.log('[Ready] RAF Lab initialized. Click "Start Test" to begin.');

        if (this.config.autoStart) {
            await this.runAllPhases();
        }
    }

    /**
     * Run all test phases sequentially
     */
    async runAllPhases(): Promise<RAFLabResult> {
        if (!this.phaseRunner || !this.scene) {
            throw new Error('RAF Lab not initialized');
        }

        this.startTime = performance.now();
        this.results = [];

        this.log('');
        this.log('═══════════════════════════════════════');
        this.log('       STARTING PHASE TESTS');
        this.log('═══════════════════════════════════════');

        // Phase 1: GLB Loading
        this.labUI?.setPhase('GLB Loading');
        const glbResult = await this.phaseRunner.runGLBLoadPhase(
            TEST_MODEL_PATH
        );
        this.results.push(glbResult);
        this.logPhaseResult(glbResult);

        // Phase 2: Material Warmup
        this.labUI?.setPhase('Material Warmup');
        const warmupResult = await this.phaseRunner.runMaterialWarmupPhase();
        this.results.push(warmupResult);
        this.logPhaseResult(warmupResult);

        // Phase 3: TacticalGrid Creation (NEW - suspected throttle trigger)
        this.labUI?.setPhase('TacticalGrid Creation');
        const tacticalGridResult = await this.phaseRunner.runTacticalGridPhase();
        this.results.push(tacticalGridResult);
        this.logPhaseResult(tacticalGridResult);

        // Phase 4: Visual Ready Check (NavigationScene's activeMeshes check)
        this.labUI?.setPhase('Visual Ready Check');
        const visualReadyResult = await this.phaseRunner.runVisualReadyPhase();
        this.results.push(visualReadyResult);
        this.logPhaseResult(visualReadyResult);

        // Phase 5: Scene Transition (Host → Navigation scene switch)
        this.labUI?.setPhase('Scene Transition');
        const sceneTransitionResult = await this.phaseRunner.runSceneTransitionPhase();
        this.results.push(sceneTransitionResult);
        this.logPhaseResult(sceneTransitionResult);

        // Phase 6: Engine Resize (finalizeNavigationReady simulation)
        this.labUI?.setPhase('Engine Resize');
        const resizeResult = await this.phaseRunner.runEngineResizePhase();
        this.results.push(resizeResult);
        this.logPhaseResult(resizeResult);

        // Phase 7: Visibility Animation (camera transition 0→1)
        this.labUI?.setPhase('Visibility Animation');
        const visibilityResult = await this.phaseRunner.runVisibilityAnimationPhase();
        this.results.push(visibilityResult);
        this.logPhaseResult(visibilityResult);

        // Phase 8: Stabilization
        this.labUI?.setPhase('Stabilization');
        const stabilizeResult = await this.phaseRunner.runStabilizationPhase();
        this.results.push(stabilizeResult);
        this.logPhaseResult(stabilizeResult);

        // Phase 9: Transfer simulation
        this.labUI?.setPhase('Transfer');
        const transferResult = await this.phaseRunner.runTransferPhase();
        this.results.push(transferResult);
        this.logPhaseResult(transferResult);

        // Generate diagnosis
        const diagnosis = this.generateDiagnosis();
        const throttleTrigger = this.findThrottleTrigger();

        const totalElapsed = performance.now() - this.startTime;

        this.log('');
        this.log('═══════════════════════════════════════');
        this.log('       TEST COMPLETE');
        this.log('═══════════════════════════════════════');
        this.log(`Total time: ${totalElapsed.toFixed(0)}ms`);
        this.log(`Throttle trigger: ${throttleTrigger ?? 'None detected'}`);
        this.log('');
        this.log('DIAGNOSIS:');
        this.log(diagnosis);

        this.labUI?.setPhase('Complete');
        this.labUI?.showResults(this.results, diagnosis);

        return {
            phases: this.results,
            diagnosis,
            throttleTriggerPhase: throttleTrigger,
            totalElapsedMs: totalElapsed,
        };
    }

    /**
     * Reset the lab for another test run
     */
    async reset(): Promise<void> {
        this.results = [];

        if (this.scene) {
            // Remove all meshes except camera
            const meshes = this.scene.meshes.slice();
            for (const mesh of meshes) {
                mesh.dispose();
            }
        }

        this.labUI?.reset();
        this.log('[Reset] Lab reset for new test run');
    }

    /**
     * Dispose the lab
     */
    dispose(): void {
        this.labUI?.dispose();
        this.scene?.dispose();
        this.engine?.dispose();

        this.labUI = null;
        this.scene = null;
        this.engine = null;
    }

    /**
     * Find which phase triggered throttle
     */
    private findThrottleTrigger(): string | null {
        for (const result of this.results) {
            if (result.throttleDetected) {
                return result.phaseName;
            }
        }
        return null;
    }

    /**
     * Generate diagnosis based on results
     */
    private generateDiagnosis(): string {
        const lines: string[] = [];

        // Check for throttle
        const throttleTrigger = this.findThrottleTrigger();
        if (throttleTrigger) {
            lines.push(`❌ THROTTLE TRIGGERED in phase: ${throttleTrigger}`);

            // Find recovery
            let recovered = false;
            let recoveryPhase = '';
            for (const result of this.results) {
                if (result.rafAfter.avgIntervalMs < 25) {
                    recovered = true;
                    recoveryPhase = result.phaseName;
                    break;
                }
            }

            if (recovered) {
                lines.push(`✓ Recovered in phase: ${recoveryPhase}`);
            } else {
                lines.push(`❌ NEVER RECOVERED - This is the Black Hole`);
            }
        } else {
            lines.push('✓ No throttle detected in any phase');
        }

        // Summary stats
        lines.push('');
        lines.push('Phase Summary:');
        for (const result of this.results) {
            const before = result.rafBefore.avgIntervalMs.toFixed(1);
            const after = result.rafAfter.avgIntervalMs.toFixed(1);
            const blocked = result.maxBlockingMs.toFixed(1);
            const status = result.throttleDetected ? '🔴' : '🟢';
            lines.push(`  ${status} ${result.phaseName}: ${before}ms → ${after}ms (max block: ${blocked}ms)`);
        }

        return lines.join('\n');
    }

    /**
     * Log RAF measurement result
     */
    private logRAFResult(label: string, result: RAFMeterResult): void {
        const status = result.avgIntervalMs < 25 ? '🟢' : result.avgIntervalMs < 50 ? '🟡' : '🔴';
        this.log(
            `  ${status} ${label}: avg=${result.avgIntervalMs.toFixed(1)}ms, ` +
            `stdDev=${result.stdDevMs.toFixed(1)}ms, ` +
            `min=${result.minIntervalMs.toFixed(1)}ms, max=${result.maxIntervalMs.toFixed(1)}ms`
        );
    }

    /**
     * Log phase result
     */
    private logPhaseResult(result: PhaseResult): void {
        this.log('');
        this.log(`[${result.phaseName}] Complete in ${result.elapsedMs.toFixed(0)}ms`);
        this.logRAFResult('Before', result.rafBefore);
        this.logRAFResult('After', result.rafAfter);
        if (result.throttleDetected) {
            this.log(`  🔴 THROTTLE DETECTED at ${result.throttleDetectedAtMs?.toFixed(0)}ms`);
        }
        if (result.maxBlockingMs > 50) {
            this.log(`  ⚠️ Max blocking: ${result.maxBlockingMs.toFixed(1)}ms`);
        }
    }

    /**
     * Log message
     */
    private log(message: string): void {
        if (this.config.debug) {
            console.log(`[RAFLab] ${message}`);
        }
    }
}

/**
 * Entry point - Create and start RAF Lab
 */
export async function startRAFLab(canvas: HTMLCanvasElement): Promise<RAFLab> {
    const lab = new RAFLab({ canvas, debug: true, autoStart: false });
    await lab.initialize();
    return lab;
}
