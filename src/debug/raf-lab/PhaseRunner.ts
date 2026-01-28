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
