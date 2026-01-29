/**
 * TransitionPhases - Define and Execute Transition Phases
 *
 * Simulates the Host → Navigation transition sequence to identify
 * exactly where RAF throttling or frame drops occur.
 */

import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { TransitionMeter, type TransitionMeterResult } from './TransitionMeter';

/**
 * Transition phases that mirror the real app flow
 */
export enum TransitionPhase {
    HOST_IDLE = 'HOST_IDLE',                     // Before transition (Host scene)
    TRANSITION_START = 'TRANSITION_START',       // Button clicked
    SCENE_CREATE = 'SCENE_CREATE',               // New scene created
    GLB_LOAD = 'GLB_LOAD',                       // Character GLB loading
    GUI_SETUP = 'GUI_SETUP',                     // GUI layers created
    RENDER_LOOP_ACTIVE = 'RENDER_LOOP_ACTIVE',   // New render loop running
    TRANSITION_COMPLETE = 'TRANSITION_COMPLETE', // Fully transitioned
}

export interface PhaseResult {
    phase: TransitionPhase;
    durationMs: number;
    rafBefore: TransitionMeterResult;
    rafAfter: TransitionMeterResult;
    throttleDetected: boolean;
    is104msLock: boolean;
    frameDrops: number;
    notes: string[];
}

/**
 * TransitionExecutor - Executes transition phases and measures RAF
 */
export class TransitionExecutor {
    private engine: BABYLON.Engine;
    private hostScene: BABYLON.Scene;
    private navScene: BABYLON.Scene | null = null;
    private meter: TransitionMeter;

    constructor(engine: BABYLON.Engine, hostScene: BABYLON.Scene) {
        this.engine = engine;
        this.hostScene = hostScene;
        this.meter = new TransitionMeter();
    }

    /**
     * Execute HOST_IDLE → TRANSITION_START phase
     */
    async executeHostIdle(): Promise<PhaseResult> {
        const startTime = performance.now();
        const notes: string[] = [];

        console.log('[TransitionPhases] HOST_IDLE: Measuring baseline RAF...');

        // Measure baseline RAF in Host scene
        this.meter.startWithScene(this.hostScene);
        await this.waitFrames(30); // 30 frames baseline
        const rafBefore = this.meter.stop(this.hostScene);

        notes.push(`Host scene baseline: ${rafBefore.avgIntervalMs.toFixed(1)}ms avg`);

        // Measure after (same as before in this phase)
        const rafAfter = rafBefore;

        const durationMs = performance.now() - startTime;

        return {
            phase: TransitionPhase.HOST_IDLE,
            durationMs,
            rafBefore,
            rafAfter,
            throttleDetected: rafAfter.isThrottled,
            is104msLock: rafAfter.is104msLock,
            frameDrops: rafAfter.frameDropCount,
            notes,
        };
    }

    /**
     * Execute SCENE_CREATE phase
     */
    async executeSceneCreate(): Promise<PhaseResult> {
        const startTime = performance.now();
        const notes: string[] = [];

        console.log('[TransitionPhases] SCENE_CREATE: Creating new scene...');

        // Measure RAF before
        this.meter.startWithScene(this.hostScene);
        await this.waitFrames(10);
        const rafBefore = this.meter.stop(this.hostScene);

        // Create new scene (like NavigationScene)
        this.navScene = new BABYLON.Scene(this.engine);
        this.navScene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.15, 1);

        // Add basic camera
        const camera = new BABYLON.ArcRotateCamera(
            'NavCam',
            -Math.PI / 2,
            1.1,
            28,
            BABYLON.Vector3.Zero(),
            this.navScene
        );
        camera.attachControl(this.engine.getRenderingCanvas()!, true);

        // Add basic light
        new BABYLON.HemisphericLight(
            'NavLight',
            new BABYLON.Vector3(0, 1, 0),
            this.navScene
        );

        notes.push('Navigation scene created');

        // Switch to new scene
        this.engine.stopRenderLoop();
        this.engine.runRenderLoop(() => {
            if (this.navScene) {
                this.navScene.render();
            }
        });

        // Wait for render loop to stabilize
        await this.waitFrames(10);

        // Measure RAF after
        this.meter.startWithScene(this.navScene);
        await this.waitFrames(20);
        const rafAfter = this.meter.stop(this.navScene);

        const durationMs = performance.now() - startTime;

        notes.push(`RAF after scene switch: ${rafAfter.avgIntervalMs.toFixed(1)}ms`);

        return {
            phase: TransitionPhase.SCENE_CREATE,
            durationMs,
            rafBefore,
            rafAfter,
            throttleDetected: rafAfter.isThrottled && !rafBefore.isThrottled,
            is104msLock: rafAfter.is104msLock,
            frameDrops: rafAfter.frameDropCount,
            notes,
        };
    }

    /**
     * Execute GLB_LOAD phase
     */
    async executeGLBLoad(modelPath: string): Promise<PhaseResult> {
        if (!this.navScene) {
            throw new Error('Navigation scene not created');
        }

        const startTime = performance.now();
        const notes: string[] = [];

        console.log('[TransitionPhases] GLB_LOAD: Loading character model...');

        // Measure RAF before
        this.meter.startWithScene(this.navScene);
        await this.waitFrames(10);
        const rafBefore = this.meter.stop(this.navScene);

        // Load GLB (simulates CharacterLoadUnit)
        const loadStartTime = performance.now();
        const result = await BABYLON.SceneLoader.ImportMeshAsync(
            '',
            '',
            modelPath,
            this.navScene
        );

        const loadDuration = performance.now() - loadStartTime;
        notes.push(`GLB loaded in ${loadDuration.toFixed(1)}ms`);
        notes.push(`Meshes loaded: ${result.meshes.length}`);

        // Wait for render loop to process
        await this.waitFrames(20);

        // Measure RAF after
        this.meter.startWithScene(this.navScene);
        await this.waitFrames(30);
        const rafAfter = this.meter.stop(this.navScene);

        const durationMs = performance.now() - startTime;

        notes.push(`RAF after GLB load: ${rafAfter.avgIntervalMs.toFixed(1)}ms`);

        return {
            phase: TransitionPhase.GLB_LOAD,
            durationMs,
            rafBefore,
            rafAfter,
            throttleDetected: rafAfter.isThrottled && !rafBefore.isThrottled,
            is104msLock: rafAfter.is104msLock,
            frameDrops: rafAfter.frameDropCount,
            notes,
        };
    }

    /**
     * Execute GUI_SETUP phase
     */
    async executeGUISetup(): Promise<PhaseResult> {
        if (!this.navScene) {
            throw new Error('Navigation scene not created');
        }

        const startTime = performance.now();
        const notes: string[] = [];

        console.log('[TransitionPhases] GUI_SETUP: Creating GUI layers...');

        // Measure RAF before
        this.meter.startWithScene(this.navScene);
        await this.waitFrames(10);
        const rafBefore = this.meter.stop(this.navScene);

        // Create GUI layers (simulates GUIManager setup)
        const adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI(
            'TransitionLabUI',
            true,
            this.navScene
        );

        // Create test UI elements (simulates SystemLayer)
        const container = new GUI.Rectangle('TestContainer');
        container.width = '200px';
        container.height = '100px';
        container.cornerRadius = 10;
        container.color = '#00ff88';
        container.thickness = 2;
        container.background = 'rgba(0, 20, 30, 0.8)';
        container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.top = '20px';
        container.left = '-20px';
        adt.addControl(container);

        const text = new GUI.TextBlock('StatusText', 'Transition Lab Active');
        text.color = 'white';
        text.fontSize = 14;
        container.addControl(text);

        notes.push('GUI layers created');

        // Wait for render loop to process
        await this.waitFrames(20);

        // Measure RAF after
        this.meter.startWithScene(this.navScene);
        await this.waitFrames(30);
        const rafAfter = this.meter.stop(this.navScene);

        const durationMs = performance.now() - startTime;

        notes.push(`RAF after GUI setup: ${rafAfter.avgIntervalMs.toFixed(1)}ms`);

        return {
            phase: TransitionPhase.GUI_SETUP,
            durationMs,
            rafBefore,
            rafAfter,
            throttleDetected: rafAfter.isThrottled && !rafBefore.isThrottled,
            is104msLock: rafAfter.is104msLock,
            frameDrops: rafAfter.frameDropCount,
            notes,
        };
    }

    /**
     * Execute RENDER_LOOP_ACTIVE phase (final stabilization)
     */
    async executeRenderLoopActive(): Promise<PhaseResult> {
        if (!this.navScene) {
            throw new Error('Navigation scene not created');
        }

        const startTime = performance.now();
        const notes: string[] = [];

        console.log('[TransitionPhases] RENDER_LOOP_ACTIVE: Final stabilization...');

        // Measure RAF over longer period to detect recovery
        this.meter.startWithScene(this.navScene);
        await this.waitFrames(60); // 60 frames (1 second @ 60fps)
        const rafResult = this.meter.stop(this.navScene);

        const durationMs = performance.now() - startTime;

        notes.push(`Final RAF after ${rafResult.frameCount} frames: ${rafResult.avgIntervalMs.toFixed(1)}ms`);

        if (rafResult.is104msLock) {
            notes.push('⚠️ 104ms lock detected - Chrome throttle active');
        }

        if (rafResult.frameDropCount > 0) {
            notes.push(`⚠️ ${rafResult.frameDropCount} frame drops detected`);
        }

        return {
            phase: TransitionPhase.RENDER_LOOP_ACTIVE,
            durationMs,
            rafBefore: rafResult,
            rafAfter: rafResult,
            throttleDetected: rafResult.isThrottled,
            is104msLock: rafResult.is104msLock,
            frameDrops: rafResult.frameDropCount,
            notes,
        };
    }

    /**
     * Get the navigation scene (for external access)
     */
    getNavigationScene(): BABYLON.Scene | null {
        return this.navScene;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.navScene) {
            this.navScene.dispose();
            this.navScene = null;
        }
    }

    /**
     * Wait for a specific number of frames
     */
    private async waitFrames(count: number): Promise<void> {
        const scene = this.navScene ?? this.hostScene;
        return new Promise((resolve) => {
            let frameCount = 0;
            const observer = scene.onAfterRenderObservable.add(() => {
                frameCount++;
                if (frameCount >= count) {
                    scene.onAfterRenderObservable.remove(observer);
                    resolve();
                }
            });
        });
    }
}
