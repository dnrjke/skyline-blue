/**
 * Transition Lab - Isolated Debugging Tool for Scene Transition Issues
 *
 * PURPOSE:
 * This is a standalone debugging environment to diagnose RAF throttling
 * and frame drops during Host → Navigation scene transitions.
 *
 * DESIGN:
 * - Completely independent from the main game flow
 * - Tests each transition phase in isolation with precise RAF measurements
 * - Provides clear visual feedback on RAF health at each step
 * - Identifies exactly where Chrome's 104ms throttle triggers
 * - Detects Firefox's incomplete transition issues
 *
 * PHASES TO TEST:
 * 1. HOST_IDLE: Baseline RAF in Host scene
 * 2. SCENE_CREATE: New scene creation and render loop switch
 * 3. GLB_LOAD: Character model loading
 * 4. GUI_SETUP: GUI layer creation (AdvancedDynamicTexture)
 * 5. RENDER_LOOP_ACTIVE: Final stabilization and recovery check
 *
 * LIFECYCLE:
 * This tool will be used during development to diagnose and fix
 * transition issues. Once resolved, it can remain as a regression test.
 *
 * @see docs/transition-lab-findings.md (to be created after resolution)
 */

import * as BABYLON from '@babylonjs/core';
import { TransitionExecutor, TransitionPhase, type PhaseResult } from './TransitionPhases';
import { LabUI } from './LabUI';

// Model path for testing (same as main app)
const TEST_MODEL_PATH = '/assets/characters/pilot.glb';

export interface TransitionLabConfig {
    /** Canvas element to use */
    canvas: HTMLCanvasElement;

    /** Enable verbose logging */
    debug?: boolean;

    /** Auto-start transition on launch */
    autoStart?: boolean;
}

export interface TransitionLabResult {
    /** All phase results */
    phases: PhaseResult[];

    /** Overall diagnosis */
    diagnosis: string;

    /** Phase where throttle was first detected (if any) */
    throttleTriggerPhase: TransitionPhase | null;

    /** Total elapsed time */
    totalElapsedMs: number;

    /** Did transition complete successfully? */
    completed: boolean;
}

/**
 * TransitionLab - Main Controller
 */
export class TransitionLab {
    private config: Required<TransitionLabConfig>;
    private engine: BABYLON.Engine | null = null;
    private hostScene: BABYLON.Scene | null = null;
    private executor: TransitionExecutor | null = null;
    private labUI: LabUI | null = null;
    private results: PhaseResult[] = [];
    private startTime: number = 0;
    private isRunning: boolean = false;

    constructor(config: TransitionLabConfig) {
        this.config = {
            canvas: config.canvas,
            debug: config.debug ?? true,
            autoStart: config.autoStart ?? false,
        };
    }

    /**
     * Initialize the lab environment
     */
    async initialize(): Promise<void> {
        this.log('═══════════════════════════════════════');
        this.log('    TRANSITION LAB - Debugging Tool');
        this.log('═══════════════════════════════════════');
        this.log('Purpose: Diagnose Host → Nav transition');
        this.log('');

        // Create engine
        this.log('[Phase 0] Creating Babylon Engine...');
        this.engine = new BABYLON.Engine(this.config.canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true,
        });

        // Create Host scene (simulates the starting state)
        this.log('[Phase 0] Creating Host scene...');
        this.hostScene = new BABYLON.Scene(this.engine);
        this.hostScene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);

        // Add basic camera (required for render loop)
        const camera = new BABYLON.ArcRotateCamera(
            'host-camera',
            0,
            Math.PI / 3,
            15,
            BABYLON.Vector3.Zero(),
            this.hostScene
        );
        camera.attachControl(this.config.canvas, true);

        // Add basic light
        new BABYLON.HemisphericLight(
            'host-light',
            new BABYLON.Vector3(0, 1, 0),
            this.hostScene
        );

        // Add a simple visual element to Host scene
        const sphere = BABYLON.MeshBuilder.CreateSphere(
            'host-sphere',
            { diameter: 2 },
            this.hostScene
        );
        const mat = new BABYLON.StandardMaterial('host-mat', this.hostScene);
        mat.diffuseColor = new BABYLON.Color3(0.3, 0.6, 1.0);
        sphere.material = mat;

        // Start render loop
        this.engine.runRenderLoop(() => {
            if (this.hostScene) {
                this.hostScene.render();
            }
        });

        this.log('[Phase 0] Host scene render loop started');

        // Wait for RAF to stabilize
        await this.waitFrames(30);

        // Create executor
        this.executor = new TransitionExecutor(this.engine, this.hostScene);

        // Create UI
        this.labUI = new LabUI(this.hostScene, {
            onStartTransition: () => this.startTransition(),
            onReset: () => this.reset(),
        });
        await this.labUI.initialize();

        this.log('');
        this.log('[Ready] Transition Lab initialized. Click "START TRANSITION" to begin.');

        if (this.config.autoStart) {
            await this.startTransition();
        }
    }

    /**
     * Start the transition test
     */
    async startTransition(): Promise<TransitionLabResult> {
        if (this.isRunning) {
            this.log('[Warning] Transition already running');
            return this.generateResult(false);
        }

        if (!this.executor || !this.hostScene) {
            throw new Error('Transition Lab not initialized');
        }

        this.isRunning = true;
        this.startTime = performance.now();
        this.results = [];

        this.labUI?.setStartEnabled(false);
        this.labUI?.updateStatus('Running transition test...');

        this.log('');
        this.log('═══════════════════════════════════════');
        this.log('    STARTING TRANSITION TEST');
        this.log('═══════════════════════════════════════');

        try {
            // Phase 1: HOST_IDLE (baseline)
            this.labUI?.setPhase(TransitionPhase.HOST_IDLE);
            const hostIdleResult = await this.executor.executeHostIdle();
            this.results.push(hostIdleResult);
            this.logPhaseResult(hostIdleResult);

            // Phase 2: SCENE_CREATE
            this.labUI?.setPhase(TransitionPhase.SCENE_CREATE);
            const sceneCreateResult = await this.executor.executeSceneCreate();
            this.results.push(sceneCreateResult);
            this.logPhaseResult(sceneCreateResult);

            // Update UI to use new scene
            const navScene = this.executor.getNavigationScene();
            if (navScene) {
                this.labUI?.dispose();
                this.labUI = new LabUI(navScene, {
                    onStartTransition: () => this.startTransition(),
                    onReset: () => this.reset(),
                });
                await this.labUI.initialize();
                this.labUI.setStartEnabled(false);
            }

            // Phase 3: GLB_LOAD
            this.labUI?.setPhase(TransitionPhase.GLB_LOAD);
            const glbLoadResult = await this.executor.executeGLBLoad(TEST_MODEL_PATH);
            this.results.push(glbLoadResult);
            this.logPhaseResult(glbLoadResult);

            // Phase 4: GUI_SETUP
            this.labUI?.setPhase(TransitionPhase.GUI_SETUP);
            const guiSetupResult = await this.executor.executeGUISetup();
            this.results.push(guiSetupResult);
            this.logPhaseResult(guiSetupResult);

            // Phase 5: RENDER_LOOP_ACTIVE (final stabilization)
            this.labUI?.setPhase(TransitionPhase.RENDER_LOOP_ACTIVE);
            const renderLoopResult = await this.executor.executeRenderLoopActive();
            this.results.push(renderLoopResult);
            this.logPhaseResult(renderLoopResult);

            // Generate diagnosis
            const diagnosis = this.generateDiagnosis();
            const throttleTrigger = this.findThrottleTrigger();

            const totalElapsed = performance.now() - this.startTime;

            this.log('');
            this.log('═══════════════════════════════════════');
            this.log('    TRANSITION TEST COMPLETE');
            this.log('═══════════════════════════════════════');
            this.log(`Total time: ${totalElapsed.toFixed(0)}ms`);
            this.log(`Throttle trigger: ${throttleTrigger ?? 'None detected'}`);
            this.log('');
            this.log('DIAGNOSIS:');
            this.log(diagnosis);

            this.labUI?.setPhase(TransitionPhase.TRANSITION_COMPLETE);
            this.labUI?.showResults(this.results, diagnosis);

            this.isRunning = false;
            this.labUI?.setStartEnabled(true);

            return {
                phases: this.results,
                diagnosis,
                throttleTriggerPhase: throttleTrigger,
                totalElapsedMs: totalElapsed,
                completed: true,
            };
        } catch (err) {
            this.log(`[Error] Transition test failed: ${err instanceof Error ? err.message : String(err)}`);
            this.isRunning = false;
            this.labUI?.setStartEnabled(true);
            this.labUI?.updateStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);

            return this.generateResult(false);
        }
    }

    /**
     * Reset the lab for another test run
     */
    async reset(): Promise<void> {
        if (this.isRunning) {
            this.log('[Warning] Cannot reset while transition is running');
            return;
        }

        this.log('[Reset] Resetting lab...');
        this.results = [];

        // Dispose executor and recreate
        this.executor?.dispose();
        if (this.engine && this.hostScene) {
            this.executor = new TransitionExecutor(this.engine, this.hostScene);
        }

        // Reset UI
        this.labUI?.reset();

        this.log('[Reset] Lab reset for new test run');
    }

    /**
     * Dispose the lab
     */
    dispose(): void {
        this.executor?.dispose();
        this.labUI?.dispose();
        this.hostScene?.dispose();
        this.engine?.dispose();

        this.executor = null;
        this.labUI = null;
        this.hostScene = null;
        this.engine = null;
    }

    /**
     * Find which phase triggered throttle
     */
    private findThrottleTrigger(): TransitionPhase | null {
        for (const result of this.results) {
            if (result.throttleDetected || result.is104msLock) {
                return result.phase;
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
            let recoveryPhase: TransitionPhase | null = null;
            for (const result of this.results) {
                if (
                    result.rafAfter.avgIntervalMs < 25 &&
                    !result.is104msLock &&
                    this.results.indexOf(result) > this.results.findIndex((r) => r.phase === throttleTrigger)
                ) {
                    recovered = true;
                    recoveryPhase = result.phase;
                    break;
                }
            }

            if (recovered && recoveryPhase) {
                lines.push(`✓ Recovered in phase: ${recoveryPhase}`);
            } else {
                lines.push('❌ NEVER RECOVERED - This is the Black Hole');
            }
        } else {
            lines.push('✓ No throttle detected in any phase');
        }

        // Check for 104ms lock specifically
        const lockPhase = this.results.find((r) => r.is104msLock);
        if (lockPhase) {
            lines.push('');
            lines.push(`⚠️ 104ms LOCK detected in: ${lockPhase.phase}`);
            lines.push('   This is Chrome-specific RAF throttling');
            lines.push('   Likely caused by extended main thread blocking');
        }

        // Check for frame drops
        const totalDrops = this.results.reduce((sum, r) => sum + r.frameDrops, 0);
        if (totalDrops > 0) {
            lines.push('');
            lines.push(`⚠️ Total frame drops: ${totalDrops}`);
        }

        // Phase summary
        lines.push('');
        lines.push('Phase Summary:');
        for (const result of this.results) {
            const before = result.rafBefore.avgIntervalMs.toFixed(1);
            const after = result.rafAfter.avgIntervalMs.toFixed(1);
            const status = result.throttleDetected ? '🔴' : result.is104msLock ? '⚠️' : '🟢';
            const lockFlag = result.is104msLock ? ' [104ms LOCK]' : '';
            lines.push(`  ${status} ${result.phase}: ${before}ms → ${after}ms${lockFlag}`);
        }

        return lines.join('\n');
    }

    /**
     * Generate result object
     */
    private generateResult(completed: boolean): TransitionLabResult {
        return {
            phases: this.results,
            diagnosis: this.generateDiagnosis(),
            throttleTriggerPhase: this.findThrottleTrigger(),
            totalElapsedMs: performance.now() - this.startTime,
            completed,
        };
    }

    /**
     * Log phase result
     */
    private logPhaseResult(result: PhaseResult): void {
        this.log('');
        this.log(`[${result.phase}] Complete in ${result.durationMs.toFixed(0)}ms`);
        this.log(`  Before: ${result.rafBefore.avgIntervalMs.toFixed(1)}ms avg`);
        this.log(`  After:  ${result.rafAfter.avgIntervalMs.toFixed(1)}ms avg`);

        if (result.throttleDetected) {
            this.log('  🔴 THROTTLE DETECTED');
        }

        if (result.is104msLock) {
            this.log('  ⚠️ 104ms LOCK DETECTED');
        }

        if (result.frameDrops > 0) {
            this.log(`  ⚠️ ${result.frameDrops} frame drops`);
        }

        if (result.notes.length > 0) {
            result.notes.forEach((note) => {
                this.log(`  • ${note}`);
            });
        }
    }

    /**
     * Wait for a specific number of frames
     */
    private async waitFrames(count: number): Promise<void> {
        if (!this.hostScene) return;

        return new Promise((resolve) => {
            let frameCount = 0;
            const observer = this.hostScene!.onAfterRenderObservable.add(() => {
                frameCount++;
                if (frameCount >= count) {
                    this.hostScene!.onAfterRenderObservable.remove(observer);
                    resolve();
                }
            });
        });
    }

    /**
     * Log message
     */
    private log(message: string): void {
        if (this.config.debug) {
            console.log(`[TransitionLab] ${message}`);
        }
    }
}

/**
 * Entry point - Create and start Transition Lab
 */
export async function startTransitionLab(canvas: HTMLCanvasElement): Promise<TransitionLab> {
    const lab = new TransitionLab({ canvas, debug: true, autoStart: false });
    await lab.initialize();
    return lab;
}
