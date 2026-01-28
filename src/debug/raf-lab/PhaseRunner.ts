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
