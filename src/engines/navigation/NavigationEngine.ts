import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { NavigationScene } from './scene/NavigationScene';
import type { LoadingDebugger } from '../../shared/ui/LoadingDebugger';

export interface NavigationEngineConfig {
    energyBudget: number;
    /** Character model path for flight animation */
    characterModelPath?: string;
}

export interface NavigationStageKey {
    episode: number;
    stage: number;
}

export interface NavigationStartHooks {
    stage?: NavigationStageKey;
    /** 0..1 overall progress */
    onProgress?: (progress01: number) => void;
    /** short status/log lines for loading debugger */
    onLog?: (line: string) => void;
    /** Optional debugger timeline sink (shared with loading overlay). */
    dbg?: LoadingDebugger;
    /** called when stage is ready (graph + meshes built, before user input unlock) */
    onReady?: () => void;
}

/**
 * NavigationEngine - Phase 2 facade.
 *
 * 외부(App/Main)는 이 클래스를 통해서만 Phase 2를 제어한다.
 */
export class NavigationEngine {
    private navScene: NavigationScene;

    constructor(scene: BABYLON.Scene, systemLayer: GUI.Rectangle, config: NavigationEngineConfig) {
        this.navScene = new NavigationScene(scene, systemLayer, config);
    }

    start(hooks: NavigationStartHooks = {}): void {
        this.navScene.start(hooks);
    }

    stop(): void {
        this.navScene.stop();
    }

    isActive(): boolean {
        return this.navScene.isActive();
    }

    handleTap(pointerX: number, pointerY: number): void {
        this.navScene.handleTap(pointerX, pointerY);
    }

    confirmAndLaunch(): void {
        this.navScene.confirmAndLaunch();
    }

    getFlightCurve(): BABYLON.Curve3 | null {
        return this.navScene.getFlightCurve();
    }

    /**
     * Toggle animation debug panel visibility
     */
    toggleDebugPanel(): void {
        this.navScene.toggleDebugPanel();
    }

    /**
     * Show animation debug panel
     */
    showDebugPanel(): void {
        this.navScene.showDebugPanel();
    }

    dispose(): void {
        this.navScene.dispose();
    }
}

