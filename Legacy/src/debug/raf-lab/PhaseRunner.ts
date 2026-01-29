/**
 * PhaseRunner - Executes test phases for RAF Lab
 *
 * Each phase represents a step in the loading process:
 * 1. GLB Loading
 * 2. Material Warmup
 * 3. Stabilization
 * 4. Transfer
 */

import * as BABYLON from '@babylonjs/core';
import { RAFMeter, RAFMeterResult } from './RAFMeter';
import { TacticalHologram } from '../../engines/navigation/visualization/TacticalHologram';
import { createPulseRenderHost } from '../../core/gpu-pulse/PulseRenderHost';

export interface PhaseRunnerConfig {
    /** Enable debug logging */
    debug?: boolean;

    /** RAF meter instance */
    rafMeter: RAFMeter;
}

export interface PhaseResult {
    /** Phase name */
    phaseName: string;

    /** RAF measurement before phase */
    rafBefore: RAFMeterResult;

    /** RAF measurement after phase */
    rafAfter: RAFMeterResult;

    /** Whether throttle was detected during this phase */
    throttleDetected: boolean;

    /** When throttle was detected (ms from phase start) */
    throttleDetectedAtMs: number | null;

    /** Maximum blocking time during phase */
    maxBlockingMs: number;

    /** Total elapsed time for phase */
    elapsedMs: number;

    /** Any error that occurred */
    error: string | null;
}

/**
 * PhaseRunner - Executes individual test phases
 */
export class PhaseRunner {
    private scene: BABYLON.Scene;
    private config: Required<PhaseRunnerConfig>;
    private rafMeter: RAFMeter;

    constructor(
        _engine: BABYLON.Engine,
        scene: BABYLON.Scene,
        config: PhaseRunnerConfig
    ) {
        this.scene = scene;
        this.config = {
            debug: config.debug ?? true,
            rafMeter: config.rafMeter,
        };
        this.rafMeter = config.rafMeter;
    }

    /**
     * Run GLB load phase
     */
    async runGLBLoadPhase(modelPath: string): Promise<PhaseResult> {
        const phaseName = 'GLB Loading';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Model: ${modelPath}`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle during load
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Load the GLB
        try {
            const rootUrl = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
            const fileName = modelPath.substring(modelPath.lastIndexOf('/') + 1);

            this.log(`[${phaseName}] Loading from: ${rootUrl}${fileName}`);

            const result = await BABYLON.SceneLoader.ImportMeshAsync(
                '',
                rootUrl,
                fileName,
                this.scene
            );

            this.log(`[${phaseName}] Loaded ${result.meshes.length} meshes`);

            // Wait a few frames for things to settle
            await this.waitFrames(10);

        } catch (error) {
            this.log(`[${phaseName}] ERROR: ${error}`);
            stopMonitor();

            return {
                phaseName,
                rafBefore,
                rafAfter: await this.rafMeter.measure(this.scene, 20),
                throttleDetected,
                throttleDetectedAtMs,
                maxBlockingMs,
                elapsedMs: performance.now() - startTime,
                error: String(error),
            };
        }

        stopMonitor();

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs,
            elapsedMs: performance.now() - startTime,
            error: null,
        };
    }

    /**
     * Run material warmup phase
     */
    async runMaterialWarmupPhase(): Promise<PhaseResult> {
        const phaseName = 'Material Warmup';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle during warmup
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Compile all materials in the scene
        const materials = this.scene.materials;
        this.log(`[${phaseName}] Compiling ${materials.length} materials...`);

        for (let i = 0; i < materials.length; i++) {
            const mat = materials[i];

            // Force shader compilation by creating a temporary mesh
            const tempMesh = BABYLON.MeshBuilder.CreateBox(
                `warmup-${i}`,
                { size: 0.001 },
                this.scene
            );
            tempMesh.material = mat;
            tempMesh.isVisible = false;

            // Let it render for one frame
            await this.waitFrames(1);

            tempMesh.dispose();

            // Yield every 3 materials
            if (i % 3 === 0) {
                await this.waitFrames(1);
            }
        }

        stopMonitor();

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs,
            elapsedMs: performance.now() - startTime,
            error: null,
        };
    }

    /**
     * Run stabilization phase (simulates ENGINE_AWAKENED)
     */
    async runStabilizationPhase(): Promise<PhaseResult> {
        const phaseName = 'Stabilization';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Waiting for RAF to stabilize (10 stable frames < 25ms)...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = rafBefore.isThrottled;
        let throttleDetectedAtMs: number | null = throttleDetected ? 0 : null;

        // Try to wait for stable frames
        const stabilizeResult = await this.rafMeter.waitForStable(
            this.scene,
            25,  // target 25ms
            10,  // need 10 consecutive
            5000 // timeout 5s
        );

        this.log(
            `[${phaseName}] Stabilize result: ${stabilizeResult.success ? 'SUCCESS' : 'TIMEOUT'} ` +
            `(${stabilizeResult.framesChecked} frames, avg ${stabilizeResult.finalAvgMs.toFixed(1)}ms)`
        );

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        // Update throttle detection
        if (!throttleDetected && rafAfter.isThrottled) {
            throttleDetected = true;
            throttleDetectedAtMs = performance.now() - startTime;
        }

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs: Math.max(rafBefore.maxIntervalMs, rafAfter.maxIntervalMs),
            elapsedMs: performance.now() - startTime,
            error: stabilizeResult.success ? null : 'Stabilization timeout',
        };
    }

    /**
     * Run transfer phase (simulates PulseTransferGate)
     */
    async runTransferPhase(): Promise<PhaseResult> {
        const phaseName = 'Transfer';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Simulating pulse transfer gate conditions...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Check if transfer would be allowed
        const wouldTransfer = !rafBefore.isThrottled && rafBefore.avgIntervalMs < 25;
        this.log(
            `[${phaseName}] Would transfer: ${wouldTransfer ? 'YES' : 'NO'} ` +
            `(avg=${rafBefore.avgIntervalMs.toFixed(1)}ms, throttled=${rafBefore.isThrottled})`
        );

        // Wait some frames
        await this.waitFrames(30);

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected: rafBefore.isThrottled || rafAfter.isThrottled,
            throttleDetectedAtMs: rafBefore.isThrottled ? 0 : (rafAfter.isThrottled ? performance.now() - startTime : null),
            maxBlockingMs: Math.max(rafBefore.maxIntervalMs, rafAfter.maxIntervalMs),
            elapsedMs: performance.now() - startTime,
            error: null,
        };
    }

    /**
     * Run TacticalGrid creation phase
     * Tests the procedural LinesMesh creation that may trigger RAF throttle
     */
    async runTacticalGridPhase(): Promise<PhaseResult> {
        const phaseName = 'TacticalGrid Creation';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Creating 44x44 LinesMesh grid (CreateLineSystem)...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle during creation
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Create TacticalHologram (the real one)
        const hologram = new TacticalHologram(this.scene);

        // Mark before enable
        performance.mark('hologram-enable-start');

        // This is the potentially blocking call
        hologram.enable();

        // Mark after enable
        performance.mark('hologram-enable-end');
        performance.measure('hologram-enable', 'hologram-enable-start', 'hologram-enable-end');

        const enableMeasure = performance.getEntriesByName('hologram-enable')[0];
        const enableDuration = enableMeasure?.duration ?? 0;
        this.log(`[${phaseName}] hologram.enable() took ${enableDuration.toFixed(1)}ms`);

        if (enableDuration > 50) {
            this.log(`[${phaseName}] ⚠️ BLOCKING: enable() exceeded 50ms threshold`);
        }

        // Clean up performance marks
        performance.clearMarks('hologram-enable-start');
        performance.clearMarks('hologram-enable-end');
        performance.clearMeasures('hologram-enable');

        // Wait frames for things to settle
        await this.waitFrames(10);

        // Set visibility to 1 (simulating what NavigationScene does)
        hologram.setVisibility(1);
        this.log(`[${phaseName}] Set visibility to 1`);

        await this.waitFrames(10);

        stopMonitor();

        // Validate hologram state
        const isCreated = hologram.isCreated();
        const isRenderReady = hologram.isRenderReady();
        this.log(`[${phaseName}] isCreated: ${isCreated}, isRenderReady: ${isRenderReady}`);

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        // Store hologram for later phases
        (this as any)._testHologram = hologram;

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs: Math.max(maxBlockingMs, enableDuration),
            elapsedMs: performance.now() - startTime,
            error: isCreated ? null : 'TacticalGrid mesh not created',
        };
    }

    /**
     * Run Visual Ready verification phase
     * Tests the activeMeshes check that NavigationScene uses
     */
    async runVisualReadyPhase(): Promise<PhaseResult> {
        const phaseName = 'Visual Ready Check';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Simulating waitForNaturalVisualReady() logic...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = rafBefore.isThrottled;
        let throttleDetectedAtMs: number | null = throttleDetected ? 0 : null;

        const mesh = this.scene.getMeshByName('TacticalGrid');
        if (!mesh) {
            this.log(`[${phaseName}] ERROR: TacticalGrid mesh not found`);
            return {
                phaseName,
                rafBefore,
                rafAfter: rafBefore,
                throttleDetected,
                throttleDetectedAtMs,
                maxBlockingMs: 0,
                elapsedMs: performance.now() - startTime,
                error: 'TacticalGrid mesh not found - run TacticalGrid phase first',
            };
        }

        // Wait for mesh to appear in activeMeshes (similar to NavigationScene)
        const maxWaitMs = 3000;
        let naturalFrameCount = 0;
        let checkCount = 0;

        const result = await new Promise<{ success: boolean; method: string; frames: number }>((resolve) => {
            const timeoutId = setTimeout(() => {
                this.scene.onAfterRenderObservable.remove(observer);
                resolve({ success: false, method: 'timeout', frames: naturalFrameCount });
            }, maxWaitMs);

            const observer = this.scene.onAfterRenderObservable.add(() => {
                naturalFrameCount++;
                checkCount++;

                // Log every 30 frames
                if (checkCount % 30 === 0) {
                    const activeMeshes = this.scene.getActiveMeshes();
                    this.log(`[${phaseName}] Frame ${naturalFrameCount}: activeMeshes.length = ${activeMeshes.length}`);
                }

                // Check if mesh is in activeMeshes
                const activeMeshes = this.scene.getActiveMeshes();
                if (activeMeshes.length > 0 && activeMeshes.data.includes(mesh)) {
                    clearTimeout(timeoutId);
                    this.scene.onAfterRenderObservable.remove(observer);
                    resolve({ success: true, method: 'activeMeshes', frames: naturalFrameCount });
                    return;
                }

                // Fallback: check _renderId
                const renderId = (mesh as any)._renderId;
                if (renderId !== undefined && renderId === this.scene.getRenderId()) {
                    clearTimeout(timeoutId);
                    this.scene.onAfterRenderObservable.remove(observer);
                    resolve({ success: true, method: 'renderId', frames: naturalFrameCount });
                    return;
                }
            });
        });

        this.log(`[${phaseName}] Result: ${result.success ? '✓' : '✗'} via ${result.method} after ${result.frames} frames`);

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        // Update throttle detection
        if (!throttleDetected && rafAfter.isThrottled) {
            throttleDetected = true;
            throttleDetectedAtMs = performance.now() - startTime;
        }

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs: Math.max(rafBefore.maxIntervalMs, rafAfter.maxIntervalMs),
            elapsedMs: performance.now() - startTime,
            error: result.success ? null : `Visual ready timeout (${result.method})`,
        };
    }

    /**
     * Run combined load simulation (GLB + TacticalGrid + VisualReady)
     * This simulates what NavigationScene does during loading
     */
    async runFullLoadSimulation(modelPath: string): Promise<PhaseResult> {
        const phaseName = 'Full Load Simulation';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting full NavigationScene-like load...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Step 1: Create TacticalHologram
        this.log(`[${phaseName}] Step 1: Creating TacticalHologram...`);
        const hologram = new TacticalHologram(this.scene);
        hologram.enable();
        hologram.setVisibility(0); // Start invisible like NavigationScene
        await this.waitFrames(5);

        // Step 2: Load GLB
        this.log(`[${phaseName}] Step 2: Loading GLB model...`);
        try {
            const rootUrl = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
            const fileName = modelPath.substring(modelPath.lastIndexOf('/') + 1);
            await BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, fileName, this.scene);
        } catch (e) {
            this.log(`[${phaseName}] GLB load failed: ${e}`);
        }
        await this.waitFrames(5);

        // Step 3: Material warmup (compile shaders)
        this.log(`[${phaseName}] Step 3: Material warmup...`);
        const materials = this.scene.materials;
        for (let i = 0; i < materials.length; i++) {
            const mat = materials[i];
            const tempMesh = BABYLON.MeshBuilder.CreateBox(`warmup-${i}`, { size: 0.001 }, this.scene);
            tempMesh.material = mat;
            tempMesh.isVisible = false;
            await this.waitFrames(1);
            tempMesh.dispose();
            if (i % 5 === 0) {
                await this.waitFrames(1);
            }
        }

        // Step 4: Show TacticalGrid
        this.log(`[${phaseName}] Step 4: Showing TacticalGrid (visibility 1)...`);
        hologram.setVisibility(1);
        await this.waitFrames(10);

        // Step 5: Wait for visual ready
        this.log(`[${phaseName}] Step 5: Waiting for visual ready...`);
        const mesh = this.scene.getMeshByName('TacticalGrid');
        let visualReadySuccess = false;

        if (mesh) {
            const visualReadyResult = await new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => {
                    this.scene.onAfterRenderObservable.remove(obs);
                    resolve(false);
                }, 2000);

                const obs = this.scene.onAfterRenderObservable.add(() => {
                    const activeMeshes = this.scene.getActiveMeshes();
                    if (activeMeshes.data.includes(mesh)) {
                        clearTimeout(timeout);
                        this.scene.onAfterRenderObservable.remove(obs);
                        resolve(true);
                    }
                });
            });
            visualReadySuccess = visualReadyResult;
        }

        this.log(`[${phaseName}] Visual ready: ${visualReadySuccess ? '✓' : '✗'}`);

        stopMonitor();

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs,
            elapsedMs: performance.now() - startTime,
            error: visualReadySuccess ? null : 'Visual ready timeout',
        };
    }

    /**
     * Run Scene Transition phase
     * Tests creating a new scene (like Host → Navigation transition)
     */
    async runSceneTransitionPhase(): Promise<PhaseResult> {
        const phaseName = 'Scene Transition';
        const startTime = performance.now();
        const engine = this.scene.getEngine();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Simulating Host → Navigation scene switch...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Step 1: Store current scene reference
        const oldScene = this.scene;
        this.log(`[${phaseName}] Step 1: Current scene has ${oldScene.meshes.length} meshes`);

        // Step 2: Create new scene (like NavigationScene creation)
        this.log(`[${phaseName}] Step 2: Creating new scene...`);
        const newScene = new BABYLON.Scene(engine);

        // Step 3: Setup new scene basics (like NavigationScene.initializeScene)
        newScene.clearColor = new BABYLON.Color4(0.02, 0.05, 0.08, 1);
        const camera = new BABYLON.ArcRotateCamera(
            'navCamera',
            Math.PI / 4,
            Math.PI / 3,
            30,
            BABYLON.Vector3.Zero(),
            newScene
        );
        camera.attachControl(engine.getRenderingCanvas()!, true);

        // Add basic light
        new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), newScene);

        this.log(`[${phaseName}] Step 3: New scene created with camera`);

        // Step 4: Switch render loop to new scene
        this.log(`[${phaseName}] Step 4: Switching render loop...`);
        engine.stopRenderLoop();
        engine.runRenderLoop(() => {
            newScene.render();
        });

        // Wait for render loop to settle
        await this.waitFramesOnScene(newScene, 5);

        // Step 5: Dispose old scene (simulate cleanup)
        this.log(`[${phaseName}] Step 5: Disposing old scene...`);
        // Note: In real game, old scene is NOT disposed immediately
        // but we're testing if scene switch causes throttle

        // DON'T update this.scene - we need to restore to original for LabUI
        // this.scene = newScene;  // REMOVED - causes UI to disappear

        await this.waitFramesOnScene(newScene, 10);

        stopMonitor();

        // Measure RAF after (on new scene)
        const rafAfter = await this.rafMeter.measure(newScene, 20);

        // Step 6: RESTORE original scene for subsequent phases
        this.log(`[${phaseName}] Step 6: Restoring original scene for LabUI...`);
        engine.stopRenderLoop();
        newScene.dispose();
        engine.runRenderLoop(() => {
            oldScene.render();
        });

        // Wait for original scene to be back
        await this.waitFrames(5);
        this.log(`[${phaseName}] Original scene restored`);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs,
            elapsedMs: performance.now() - startTime,
            error: null,
        };
    }

    /**
     * Run GPU Pulse Host phase
     * Tests PulseRenderHost burst rendering (like Loading Host during loading)
     */
    async runGPUPulseHostPhase(): Promise<PhaseResult> {
        const phaseName = 'GPU Pulse Host';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Simulating PulseRenderHost burst rendering during loading...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Step 1: Create PulseRenderHost (exactly like real loading)
        this.log(`[${phaseName}] Step 1: Creating PulseRenderHost...`);
        const pulseHost = createPulseRenderHost(this.scene, true); // debug=true for visibility

        // Step 2: Activate pulse rendering
        this.log(`[${phaseName}] Step 2: Activating pulse host...`);
        pulseHost.activate();

        // Step 3: Simulate loading by calling renderPulseFrame repeatedly
        // This is what happens during actual loading
        this.log(`[${phaseName}] Step 3: Running pulse frames (simulating loading)...`);
        const pulseFrameCount = 60; // ~1 second of pulse rendering
        let pulseFramesRendered = 0;

        for (let i = 0; i < pulseFrameCount; i++) {
            pulseHost.renderPulseFrame();
            pulseFramesRendered++;

            // Wait one frame between pulse calls
            await this.waitFrames(1);

            // Log progress every 20 frames
            if (i > 0 && i % 20 === 0) {
                this.log(`[${phaseName}] Pulse frames: ${i}/${pulseFrameCount}`);
            }
        }

        this.log(`[${phaseName}] Rendered ${pulseFramesRendered} pulse frames`);

        // Step 4: Deactivate pulse host (like when loading completes)
        this.log(`[${phaseName}] Step 4: Deactivating pulse host...`);
        pulseHost.deactivate();

        await this.waitFrames(10);

        // Step 5: Dispose pulse host
        pulseHost.dispose();

        stopMonitor();

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs,
            elapsedMs: performance.now() - startTime,
            error: null,
        };
    }

    /**
     * Run Engine Resize phase
     * Tests engine.resize() call (like finalizeNavigationReady)
     */
    async runEngineResizePhase(): Promise<PhaseResult> {
        const phaseName = 'Engine Resize';
        const startTime = performance.now();
        const engine = this.scene.getEngine();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Simulating finalizeNavigationReady() resize sequence...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Log current state
        this.log(`[${phaseName}] Before resize: ${engine.getRenderWidth()}x${engine.getRenderHeight()}`);
        this.log(`[${phaseName}] Hardware scaling: ${engine.getHardwareScalingLevel()}`);

        // Step 1: Force engine resize (exactly like finalizeNavigationReady)
        this.log(`[${phaseName}] Step 1: Calling engine.resize()...`);
        performance.mark('engine-resize-start');
        engine.resize();
        performance.mark('engine-resize-end');
        performance.measure('engine-resize', 'engine-resize-start', 'engine-resize-end');

        const resizeMeasure = performance.getEntriesByName('engine-resize')[0];
        const resizeDuration = resizeMeasure?.duration ?? 0;
        this.log(`[${phaseName}] engine.resize() took ${resizeDuration.toFixed(1)}ms`);

        performance.clearMarks('engine-resize-start');
        performance.clearMarks('engine-resize-end');
        performance.clearMeasures('engine-resize');

        // Step 2: Force render (like finalizeNavigationReady)
        this.log(`[${phaseName}] Step 2: Forcing scene.render()...`);
        this.scene.render();

        await this.waitFrames(5);

        // Step 3: Try hardware scaling change (like RenderQualityManager)
        this.log(`[${phaseName}] Step 3: Testing hardware scaling change...`);
        const originalScaling = engine.getHardwareScalingLevel();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const targetScaling = 1 / dpr;

        performance.mark('scaling-change-start');
        engine.setHardwareScalingLevel(targetScaling);
        engine.resize();
        performance.mark('scaling-change-end');
        performance.measure('scaling-change', 'scaling-change-start', 'scaling-change-end');

        const scalingMeasure = performance.getEntriesByName('scaling-change')[0];
        const scalingDuration = scalingMeasure?.duration ?? 0;
        this.log(`[${phaseName}] Hardware scaling change took ${scalingDuration.toFixed(1)}ms`);

        performance.clearMarks('scaling-change-start');
        performance.clearMarks('scaling-change-end');
        performance.clearMeasures('scaling-change');

        // Restore original scaling
        engine.setHardwareScalingLevel(originalScaling);
        engine.resize();

        this.log(`[${phaseName}] After resize: ${engine.getRenderWidth()}x${engine.getRenderHeight()}`);

        await this.waitFrames(10);

        stopMonitor();

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs: Math.max(maxBlockingMs, resizeDuration, scalingDuration),
            elapsedMs: performance.now() - startTime,
            error: null,
        };
    }

    /**
     * Run Visibility Animation phase
     * Tests grid visibility 0→1 animation (like camera transition)
     */
    async runVisibilityAnimationPhase(): Promise<PhaseResult> {
        const phaseName = 'Visibility Animation';
        const startTime = performance.now();

        this.log(`[${phaseName}] Starting...`);
        this.log(`[${phaseName}] Simulating camera transition visibility animation (0→1 over 1.1s)...`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // Get or create TacticalGrid
        let hologram = (this as any)._testHologram as TacticalHologram | undefined;
        if (!hologram) {
            this.log(`[${phaseName}] Creating new TacticalHologram...`);
            hologram = new TacticalHologram(this.scene);
            hologram.enable();
            (this as any)._testHologram = hologram;
        }

        // Start with visibility 0
        hologram.setVisibility(0);
        this.log(`[${phaseName}] Grid visibility set to 0`);

        await this.waitFrames(5);

        // Animate visibility 0→1 over 1.1 seconds (like camera transition)
        const animationDuration = 1100; // ms
        const animationStart = performance.now();
        let frameCount = 0;

        await new Promise<void>((resolve) => {
            const observer = this.scene.onBeforeRenderObservable.add(() => {
                const elapsed = performance.now() - animationStart;
                const t = Math.min(1, elapsed / animationDuration);

                // Ease-out cubic (like typical camera transition)
                const eased = 1 - Math.pow(1 - t, 3);
                hologram!.setVisibility(eased);
                frameCount++;

                if (t >= 1) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    resolve();
                }
            });

            // Safety timeout
            setTimeout(() => {
                this.scene.onBeforeRenderObservable.remove(observer);
                resolve();
            }, animationDuration + 500);
        });

        this.log(`[${phaseName}] Animation complete: ${frameCount} frames over ${(performance.now() - animationStart).toFixed(0)}ms`);
        this.log(`[${phaseName}] Final visibility: ${hologram.isCreated() ? '✓ visible' : '✗ not created'}`);

        await this.waitFrames(10);

        stopMonitor();

        // Measure RAF after
        const rafAfter = await this.rafMeter.measure(this.scene, 20);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs,
            elapsedMs: performance.now() - startTime,
            error: null,
        };
    }

    /**
     * Run Black Hole Simulation phase
     *
     * This phase attempts to reproduce the exact conditions that cause
     * RAF throttle in the real game:
     *
     * 1. TWO SCENES COEXIST - Host scene stays alive while Nav scene loads
     * 2. COMPLEX GUI LAYERS - AdvancedDynamicTexture with multiple controls
     * 3. GPU PULSE HOST - Burst rendering during loading
     * 4. FULL LOADING SEQUENCE - GLB + TacticalGrid + Materials + Resize
     */
    async runBlackHoleSimulationPhase(modelPath: string): Promise<PhaseResult> {
        const phaseName = 'Black Hole Simulation';
        const startTime = performance.now();
        const engine = this.scene.getEngine();

        this.log(`[${phaseName}] ═══════════════════════════════════════`);
        this.log(`[${phaseName}] ATTEMPTING TO REPRODUCE BLACK HOLE`);
        this.log(`[${phaseName}] ═══════════════════════════════════════`);

        // Measure RAF before
        const rafBefore = await this.rafMeter.measure(this.scene, 20);

        // Track throttle
        let throttleDetected = false;
        let throttleDetectedAtMs: number | null = null;
        let maxBlockingMs = 0;

        const stopMonitor = this.rafMeter.measureContinuous(
            this.scene,
            (interval, stats) => {
                if (interval > maxBlockingMs) {
                    maxBlockingMs = interval;
                }
                if (stats.isThrottled && !throttleDetected) {
                    throttleDetected = true;
                    throttleDetectedAtMs = performance.now() - startTime;
                    this.log(`[${phaseName}] ⚠️ THROTTLE DETECTED at ${throttleDetectedAtMs.toFixed(0)}ms`);
                }
            },
            5
        );

        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Keep Host Scene alive (this.scene = "Host")
        // ═══════════════════════════════════════════════════════════════
        const hostScene = this.scene;
        this.log(`[${phaseName}] Step 1: Host scene has ${hostScene.meshes.length} meshes`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Create complex GUI on Host Scene (like ArcanaLoadingOverlay)
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 2: Creating AdvancedDynamicTexture + GUI layers...`);

        const GUI = await import('@babylonjs/gui');
        const guiTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('BlackHoleGUI', true, hostScene);

        // Create backdrop (like ArcanaLoadingOverlay)
        const backdrop = new GUI.Rectangle('backdrop');
        backdrop.width = '100%';
        backdrop.height = '100%';
        backdrop.thickness = 0;
        backdrop.background = 'rgba(0, 0, 0, 0.92)';
        backdrop.zIndex = 1100;
        guiTexture.addControl(backdrop);

        // Create multiple text blocks (simulate complex GUI)
        const titleText = new GUI.TextBlock('title');
        titleText.text = 'LOADING';
        titleText.color = 'white';
        titleText.fontSize = 46;
        titleText.top = '-200px';
        backdrop.addControl(titleText);

        const subtitleText = new GUI.TextBlock('subtitle');
        subtitleText.text = 'EP1 ST1';
        subtitleText.color = '#888888';
        subtitleText.fontSize = 22;
        subtitleText.top = '-140px';
        backdrop.addControl(subtitleText);

        // Progress bar
        const barOuter = new GUI.Rectangle('barOuter');
        barOuter.width = '300px';
        barOuter.height = '8px';
        barOuter.thickness = 1;
        barOuter.color = '#444444';
        barOuter.top = '100px';
        backdrop.addControl(barOuter);

        const barFill = new GUI.Rectangle('barFill');
        barFill.width = '0%';
        barFill.height = '100%';
        barFill.thickness = 0;
        barFill.background = '#00aaff';
        barFill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        barOuter.addControl(barFill);

        // Debug text area
        const debugText = new GUI.TextBlock('debug');
        debugText.text = '';
        debugText.color = '#666666';
        debugText.fontSize = 12;
        debugText.top = '200px';
        debugText.height = '200px';
        debugText.textWrapping = true;
        backdrop.addControl(debugText);

        await this.waitFrames(5);

        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Create Navigation Scene (SECOND SCENE - coexists with Host)
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 3: Creating Navigation Scene (TWO SCENES NOW EXIST)...`);

        const navScene = new BABYLON.Scene(engine);
        navScene.clearColor = new BABYLON.Color4(0.02, 0.05, 0.08, 1);

        // Navigation camera
        const navCamera = new BABYLON.ArcRotateCamera(
            'navCamera',
            Math.PI / 4,
            Math.PI / 3,
            30,
            BABYLON.Vector3.Zero(),
            navScene
        );

        // Light for nav scene
        new BABYLON.HemisphericLight('navLight', new BABYLON.Vector3(0, 1, 0), navScene);

        this.log(`[${phaseName}] TWO SCENES COEXIST: Host(${hostScene.meshes.length} meshes) + Nav(${navScene.meshes.length} meshes)`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Activate GPU Pulse Host on Host Scene
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 4: Activating GPU Pulse Host...`);
        const pulseHost = createPulseRenderHost(hostScene, false);
        pulseHost.activate();

        // Update progress
        barFill.width = '10%';
        debugText.text = 'GPU Pulse Host activated...';
        await this.waitFrames(3);

        // ═══════════════════════════════════════════════════════════════
        // STEP 5: Modify render loop to render BOTH scenes
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 5: Render loop now renders BOTH scenes...`);

        engine.stopRenderLoop();
        engine.runRenderLoop(() => {
            // Host scene renders first (with GUI)
            hostScene.render();
            pulseHost.renderPulseFrame();

            // Nav scene renders second (loading in background)
            navScene.render();
        });

        await this.waitFrames(5);

        // ═══════════════════════════════════════════════════════════════
        // STEP 6: Load GLB into Navigation Scene
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 6: Loading GLB into Navigation Scene...`);
        barFill.width = '20%';
        debugText.text = 'Loading character model...';

        try {
            const rootUrl = modelPath.substring(0, modelPath.lastIndexOf('/') + 1);
            const fileName = modelPath.substring(modelPath.lastIndexOf('/') + 1);
            await BABYLON.SceneLoader.ImportMeshAsync('', rootUrl, fileName, navScene);
            this.log(`[${phaseName}] GLB loaded: ${navScene.meshes.length} meshes`);
        } catch (e) {
            this.log(`[${phaseName}] GLB load failed: ${e}`);
        }

        barFill.width = '40%';
        await this.waitFrames(5);

        // ═══════════════════════════════════════════════════════════════
        // STEP 7: Create TacticalGrid in Navigation Scene
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 7: Creating TacticalGrid in Navigation Scene...`);
        barFill.width = '50%';
        debugText.text = 'Creating tactical grid...';

        const hologram = new TacticalHologram(navScene);
        hologram.enable();
        hologram.setVisibility(0); // Start invisible

        await this.waitFrames(5);

        // ═══════════════════════════════════════════════════════════════
        // STEP 8: Material Warmup on Navigation Scene
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 8: Material warmup on Navigation Scene...`);
        barFill.width = '60%';
        debugText.text = 'Compiling shaders...';

        const materials = navScene.materials;
        for (let i = 0; i < materials.length; i++) {
            const mat = materials[i];
            const tempMesh = BABYLON.MeshBuilder.CreateBox(`warmup-${i}`, { size: 0.001 }, navScene);
            tempMesh.material = mat;
            tempMesh.isVisible = false;
            await this.waitFramesOnScene(navScene, 1);
            tempMesh.dispose();
        }

        barFill.width = '70%';
        await this.waitFrames(5);

        // ═══════════════════════════════════════════════════════════════
        // STEP 9: Show TacticalGrid (visibility 0→1)
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 9: Animating TacticalGrid visibility 0→1...`);
        barFill.width = '80%';
        debugText.text = 'Activating tactical grid...';

        // Animate visibility
        const animDuration = 500; // ms
        const animStart = performance.now();
        await new Promise<void>((resolve) => {
            const obs = navScene.onBeforeRenderObservable.add(() => {
                const t = Math.min(1, (performance.now() - animStart) / animDuration);
                hologram.setVisibility(t);
                if (t >= 1) {
                    navScene.onBeforeRenderObservable.remove(obs);
                    resolve();
                }
            });
        });

        barFill.width = '85%';
        await this.waitFrames(5);

        // ═══════════════════════════════════════════════════════════════
        // STEP 10: Engine Resize (like finalizeNavigationReady)
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 10: Calling engine.resize()...`);
        barFill.width = '90%';
        debugText.text = 'Finalizing...';

        engine.resize();
        navScene.render();

        await this.waitFrames(5);

        // ═══════════════════════════════════════════════════════════════
        // STEP 11: Transfer - Stop Host, Switch to Nav only
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 11: Pulse Transfer - Switching to Navigation Scene only...`);
        barFill.width = '95%';
        debugText.text = 'Transferring control...';

        // Deactivate pulse host
        pulseHost.deactivate();

        // Fade out GUI
        let fadeAlpha = 1;
        await new Promise<void>((resolve) => {
            const fadeObs = hostScene.onBeforeRenderObservable.add(() => {
                fadeAlpha -= 0.05;
                backdrop.alpha = Math.max(0, fadeAlpha);
                if (fadeAlpha <= 0) {
                    hostScene.onBeforeRenderObservable.remove(fadeObs);
                    resolve();
                }
            });
        });

        barFill.width = '100%';

        // Switch render loop to Nav only
        engine.stopRenderLoop();
        engine.runRenderLoop(() => {
            navScene.render();
        });

        // Attach camera control
        navCamera.attachControl(engine.getRenderingCanvas()!, true);

        await this.waitFramesOnScene(navScene, 10);

        this.log(`[${phaseName}] Transfer complete - Navigation Scene active`);

        // ═══════════════════════════════════════════════════════════════
        // STEP 12: Cleanup and restore original scene
        // ═══════════════════════════════════════════════════════════════
        this.log(`[${phaseName}] Step 12: Cleanup and restore original scene...`);

        stopMonitor();

        // Measure RAF after (on nav scene)
        const rafAfter = await this.rafMeter.measure(navScene, 20);

        // Dispose nav scene and GUI
        guiTexture.dispose();
        navScene.dispose();
        pulseHost.dispose();

        // Restore original render loop
        engine.stopRenderLoop();
        engine.runRenderLoop(() => {
            hostScene.render();
        });

        await this.waitFrames(5);
        this.log(`[${phaseName}] Original scene restored`);

        this.log(`[${phaseName}] ═══════════════════════════════════════`);
        this.log(`[${phaseName}] BLACK HOLE SIMULATION COMPLETE`);
        this.log(`[${phaseName}] Throttle detected: ${throttleDetected ? 'YES' : 'NO'}`);
        this.log(`[${phaseName}] ═══════════════════════════════════════`);

        return {
            phaseName,
            rafBefore,
            rafAfter,
            throttleDetected,
            throttleDetectedAtMs,
            maxBlockingMs,
            elapsedMs: performance.now() - startTime,
            error: throttleDetected ? null : 'Black hole NOT reproduced - throttle not detected',
        };
    }

    /**
     * Wait for N frames on a specific scene
     */
    private waitFramesOnScene(scene: BABYLON.Scene, count: number): Promise<void> {
        return new Promise((resolve) => {
            let remaining = count;
            const observer = scene.onBeforeRenderObservable.add(() => {
                remaining--;
                if (remaining <= 0) {
                    scene.onBeforeRenderObservable.remove(observer);
                    resolve();
                }
            });
        });
    }

    /**
     * Wait for N frames
     */
    private waitFrames(count: number): Promise<void> {
        return new Promise((resolve) => {
            let remaining = count;
            const observer = this.scene.onBeforeRenderObservable.add(() => {
                remaining--;
                if (remaining <= 0) {
                    this.scene.onBeforeRenderObservable.remove(observer);
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
            console.log(`[PhaseRunner] ${message}`);
        }
    }
}
