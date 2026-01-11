/**
 * Skyline Blue: Arcana Vector - Main Entry Point
 *
 * 100% Babylon.js - No HTML/CSS UI
 *
 * Phase 1.1: Interactive Novel - 2nd Step
 *
 * 흐름: SplashScene → TouchToStartScene → NarrativeEngine (Intro)
 *
 * 핵심 원칙:
 * - Splash/TouchToStart 중에는 DialogueBox가 표시되지 않음
 * - 터치 시 NarrativeEngine 진입
 * - HEBS (계층형 이벤트 차단 시스템) 준수
 *
 * Phase 2.5 디버깅:
 * - DEV 모드에서 Babylon.js Inspector 활성화
 */

import * as BABYLON from '@babylonjs/core';

/** DEV 모드 플래그 */
const IS_DEV = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;
import { GUIManager } from '../shared/ui/GUIManager';
import { BackgroundLayer } from '../shared/ui/BackgroundLayer';
import { CharacterLayer } from '../shared/ui/CharacterLayer';
import { BottomVignetteLayer } from '../shared/ui/BottomVignetteLayer';
import { MobileDebugConsole } from '../shared/ui/MobileDebugConsole';
import { NarrativeEngine } from '../engines/narrative';
import { SplashScene } from '../ui/startScreens/splash/SplashScene';
import { TouchToStartScene } from '../ui/startScreens/touchToStart/TouchToStartScene';
import { NavigationEngine } from '../engines/navigation';
import { FlowController } from './FlowController';
import { RenderQualityManager } from '../core/rendering/RenderQualityManager';
import { ArcanaLoadingEngine } from '../shared/ui/ArcanaLoadingEngine';
import { StageTransitionManager } from '../core/scene/StageTransitionManager';
import { InputLifecycleManager } from '../core/input/InputLifecycleManager';

// ============================================
// Main Application
// ============================================

class Main {
    private canvas: HTMLCanvasElement;
    private engine: BABYLON.Engine;
    private scene: BABYLON.Scene;
    private renderQuality: RenderQualityManager;
    private loadingEngine: ArcanaLoadingEngine;
    private transitions: StageTransitionManager;

    // UI Systems
    private guiManager: GUIManager;
    private backgroundLayer: BackgroundLayer;
    private bottomVignetteLayer: BottomVignetteLayer;
    private characterLayer: CharacterLayer;
    private debugConsole: MobileDebugConsole;

    // Start Screens (Narrative Engine 외부)
    private splashScene: SplashScene;
    private touchToStartScene: TouchToStartScene;

    // Narrative Engine (대화 시스템)
    private narrativeEngine: NarrativeEngine;

    // Phase 2: Navigation Engine
    private navigationEngine: NavigationEngine;

    // Flow Controller (keeps Main thin)
    private flow: FlowController;

    constructor() {
        console.log('[System] ========================================');
        console.log('[System] Skyline Blue: Arcana Vector');
        console.log('[System] Phase 1.1 - Interactive Novel');
        console.log('[System] ========================================');

        // Get canvas (the ONLY HTML element we use)
        this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
        if (!this.canvas) {
            throw new Error('[System] Canvas element not found');
        }

        // Initialize Babylon.js Engine
        this.engine = new BABYLON.Engine(this.canvas, true, {
            // 기존 대비 "투과/잔상" 체감 차이를 막기 위해 기존 값으로 복귀
            preserveDrawingBuffer: true,
            stencil: true,
        });

        // Create scene
        this.scene = this.createScene();

        // Phase 2.3: Visual integrity + performance tuning (분리된 매니저)
        this.renderQuality = new RenderQualityManager(this.engine, this.scene, { minMsaaSamples: 4 });
        this.renderQuality.init(this.scene.activeCamera!, this.canvas);
        // Allow other systems (NavigationScene) to keep quality settings when swapping cameras.
        this.scene.metadata = {
            ...(this.scene.metadata as Record<string, unknown> | null),
            renderQuality: this.renderQuality,
        };

        // Initialize GUI system (HEBS layer hierarchy)
        this.guiManager = new GUIManager(this.scene);

        // Mobile Debug Console (top center toggle button for iPhone debugging)
        this.debugConsole = new MobileDebugConsole(this.guiManager.getSkipLayer());

        // Phase 2.5: shared loading engine lives in SkipLayer (transition UI)
        this.loadingEngine = new ArcanaLoadingEngine(this.guiManager.getSkipLayer(), { debugMode: true });
        this.transitions = new StageTransitionManager({ scene: this.scene, loading: this.loadingEngine });

        // Initialize display components (DisplayLayer에 배치)
        this.backgroundLayer = new BackgroundLayer(this.guiManager.getDisplayLayer());
        // NIKKE/StarRail: DialogueBox 바로 뒤(CharacterLayer 앞) 하단 비네트
        this.bottomVignetteLayer = new BottomVignetteLayer(this.guiManager.getDisplayLayer());
        this.characterLayer = new CharacterLayer(this.guiManager.getDisplayLayer());

        // Initialize Start Screens (SkipLayer에 배치 - 최상위)
        this.splashScene = new SplashScene(this.guiManager.getSkipLayer());
        this.touchToStartScene = new TouchToStartScene(this.guiManager.getSkipLayer());

        // Create Narrative Engine (나중에 활성화)
        this.narrativeEngine = new NarrativeEngine(
            this.guiManager.getInteractionLayer(),
            this.guiManager.getDisplayLayer(),
            this.guiManager.getSkipLayer()
        );

        // Phase 2 Navigation Engine (SystemLayer UI)
        this.navigationEngine = new NavigationEngine(this.scene, this.guiManager.getSystemLayer(), {
            energyBudget: 60,
        });

        // Resize/DPI handling is owned by RenderQualityManager (Phase 2.6)

        // INPUT LAW: Ensure engine input is attached before any flow starts
        InputLifecycleManager.ensureAttached(this.engine, this.scene);

        // Start render loop
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });

        // INPUT DIAGNOSTIC: Check attachControl state
        console.warn('[INPUT DIAG] Engine/Scene State', {
            engineInputElement: this.engine.inputElement,
            engineInputElementIsCanvas: this.engine.inputElement === this.canvas,
            sceneAttached: (this.scene as any)._inputManager?._isAttached,
            isReady: this.scene.isReady(),
        });

        // INPUT DIAGNOSTIC: Scene-level pointer test
        this.scene.onPointerDown = () => {
            console.log('[Scene] PointerDown received at scene level');
        };

        console.log('[System] Initialization complete');

        // ========================================
        // Phase 2.5: DEV 모드 Babylon.js Inspector
        // ========================================
        if (IS_DEV) {
            this.initInspector();
        }

        // Start game flow (delegated)
        this.flow = new FlowController({
            scene: this.scene,
            guiTexture: this.guiManager.getTexture(),
            narrativeEngine: this.narrativeEngine,
            navigationEngine: this.navigationEngine,
            splashScene: this.splashScene,
            touchToStartScene: this.touchToStartScene,
            backgroundLayer: this.backgroundLayer,
            bottomVignetteLayer: this.bottomVignetteLayer,
            characterLayer: this.characterLayer,
            transitions: this.transitions,
            debugConsole: this.debugConsole,
        });
        this.flow.start();
    }

    private createScene(): BABYLON.Scene {
        const scene = new BABYLON.Scene(this.engine);

        // Set background color (will be covered by BackgroundLayer)
        scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);

        // Create camera (required for scene)
        const camera = new BABYLON.FreeCamera(
            'MainCamera',
            new BABYLON.Vector3(0, 0, -10),
            scene
        );
        camera.setTarget(BABYLON.Vector3.Zero());

        // Create ambient light
        const light = new BABYLON.HemisphericLight(
            'AmbientLight',
            new BABYLON.Vector3(0, 1, 0),
            scene
        );
        light.intensity = 0.7;

        return scene;
    }

    /**
     * Phase 2.5: DEV 모드에서 Babylon.js Inspector 활성화
     * - 메시, 재질, 렌더링 상태를 실시간으로 확인 가능
     * - 항로 라인 가시성 문제 디버깅에 활용
     */
    private initInspector(): void {
        // @babylonjs/inspector는 별도 패키지로, 동적 임포트하여 프로덕션 번들 크기 절약
        import('@babylonjs/inspector')
            .then(() => {
                console.log('[System] DEV: Babylon.js Inspector loaded');
                // embedMode: false로 별도 창에서 열기 (embedMode: true는 캔버스 옆에 삽입)
                this.scene.debugLayer.show({
                    embedMode: false,
                    overlay: true,
                    handleResize: true,
                });
                console.log('[System] DEV: Inspector opened. Press F12 or use scene.debugLayer.hide() to close.');
            })
            .catch((err) => {
                console.warn('[System] DEV: Failed to load Babylon.js Inspector:', err);
                console.warn('[System] DEV: Run `npm install @babylonjs/inspector --save-dev` if not installed.');
            });
    }

    // ============================================
    // Cleanup
    // ============================================

    dispose(): void {
        this.flow.dispose();
        this.navigationEngine.dispose();
        this.narrativeEngine.dispose();
        this.touchToStartScene.dispose();
        this.splashScene.dispose();
        this.characterLayer.dispose();
        this.bottomVignetteLayer.dispose();
        this.backgroundLayer.dispose();
        this.debugConsole.dispose();
        this.guiManager.dispose();
        this.renderQuality.dispose();
        this.scene.dispose();
        this.engine.dispose();
    }
}

// Initialize on DOM ready
window.addEventListener('DOMContentLoaded', () => {
    new Main();
});
