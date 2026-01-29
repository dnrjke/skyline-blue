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

// RAF Lab - Isolated debugging tool for RAF throttle issues
// Usage: Add ?raf-lab to URL
import { checkAndLaunchRAFLab } from '../debug/raf-lab/launcher';
// Transition Lab - Scene transition debugging tool
// Usage: Add ?transition-lab to URL
import { checkAndLaunchTransitionLab } from '../debug/transition-lab/launcher';
// Black Hole Debug Flags - Component isolation testing
import { getBlackHoleDebugConfig, blackHoleDebugLog } from '../debug/BlackHoleDebugFlags';
import { GUIManager } from '../shared/ui/GUIManager';
import { BackgroundLayer } from '../shared/ui/BackgroundLayer';
import { CharacterLayer } from '../shared/ui/CharacterLayer';
import { BottomVignetteLayer } from '../shared/ui/BottomVignetteLayer';
import { NarrativeEngine } from '../engines/narrative';
import { SplashScene } from '../ui/startScreens/splash/SplashScene';
import { TouchToStartScene } from '../ui/startScreens/touchToStart/TouchToStartScene';
import { NavigationEngine } from '../engines/navigation';
import { FlowController } from './FlowController';
import { RenderQualityManager } from '../core/rendering/RenderQualityManager';
import { ArcanaLoadingEngine } from '../shared/ui/ArcanaLoadingEngine';
import { StageTransitionManager } from '../core/scene/StageTransitionManager';

// ============================================
// Main Application
// ============================================

// ============================================
// RAF Timeline Measurement (Black Hole Debug)
// ============================================
class RAFTimeline {
    private enabled: boolean;
    private markers: Array<{ name: string; time: number; rafDelta: number }> = [];
    private lastRAF: number = 0;
    private rafDeltas: number[] = [];
    private frameObserver: (() => void) | null = null;

    constructor(enabled: boolean) {
        this.enabled = enabled;
        if (enabled) {
            console.log('');
            console.log('╔══════════════════════════════════════════╗');
            console.log('║     RAF TIMELINE MEASUREMENT ACTIVE      ║');
            console.log('╠══════════════════════════════════════════╣');
            console.log('║  Tracking RAF intervals at each step     ║');
            console.log('╚══════════════════════════════════════════╝');
            console.log('');
        }
    }

    startTracking(scene: BABYLON.Scene): void {
        if (!this.enabled) return;
        this.lastRAF = performance.now();
        this.frameObserver = () => {
            const now = performance.now();
            const delta = now - this.lastRAF;
            this.rafDeltas.push(delta);
            // Keep only last 30 deltas
            if (this.rafDeltas.length > 30) this.rafDeltas.shift();
            this.lastRAF = now;
        };
        scene.onAfterRenderObservable.add(this.frameObserver);
    }

    mark(name: string): void {
        if (!this.enabled) return;
        const avgDelta = this.rafDeltas.length > 0
            ? this.rafDeltas.reduce((a, b) => a + b, 0) / this.rafDeltas.length
            : 0;
        this.markers.push({ name, time: performance.now(), rafDelta: avgDelta });

        const status = avgDelta > 50 ? '🔴' : avgDelta > 25 ? '🟡' : '🟢';
        console.log(`[RAFTimeline] ${status} ${name}: RAF avg=${avgDelta.toFixed(1)}ms`);
    }

    report(): void {
        if (!this.enabled) return;
        console.log('');
        console.log('═══════════════════════════════════════════');
        console.log('         RAF TIMELINE REPORT');
        console.log('═══════════════════════════════════════════');
        for (const marker of this.markers) {
            const status = marker.rafDelta > 50 ? '🔴 THROTTLE' : marker.rafDelta > 25 ? '🟡 SLOW' : '🟢 OK';
            console.log(`  ${marker.name.padEnd(30)} ${marker.rafDelta.toFixed(1).padStart(6)}ms  ${status}`);
        }
        console.log('═══════════════════════════════════════════');

        // Find first throttle point
        const throttlePoint = this.markers.find(m => m.rafDelta > 50);
        if (throttlePoint) {
            console.log(`⚠️ FIRST THROTTLE at: ${throttlePoint.name}`);
        }
        console.log('');
    }
}

class Main {
    private canvas: HTMLCanvasElement;
    private engine: BABYLON.Engine;
    private scene: BABYLON.Scene;
    private renderQuality: RenderQualityManager | null = null;
    private loadingEngine: ArcanaLoadingEngine | null = null;
    private transitions: StageTransitionManager | null = null;

    // UI Systems
    private guiManager: GUIManager | null = null;
    private backgroundLayer: BackgroundLayer | null = null;
    private bottomVignetteLayer: BottomVignetteLayer | null = null;
    private characterLayer: CharacterLayer | null = null;

    // Start Screens (Narrative Engine 외부)
    private splashScene: SplashScene | null = null;
    private touchToStartScene: TouchToStartScene | null = null;

    // Narrative Engine (대화 시스템)
    private narrativeEngine: NarrativeEngine | null = null;

    // Phase 2: Navigation Engine
    private navigationEngine: NavigationEngine | null = null;

    // Flow Controller (keeps Main thin)
    private flow: FlowController | null = null;

    // RAF Timeline (debug)
    private timeline: RAFTimeline;

    constructor() {
        console.log('[System] ========================================');
        console.log('[System] Skyline Blue: Arcana Vector');
        console.log('[System] Phase 1.1 - Interactive Novel');
        console.log('[System] ========================================');

        const debugConfig = getBlackHoleDebugConfig();
        this.timeline = new RAFTimeline(debugConfig.timeline);

        // Get canvas (the ONLY HTML element we use)
        this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
        if (!this.canvas) {
            throw new Error('[System] Canvas element not found');
        }

        this.timeline.mark('1. Canvas acquired');

        // Initialize Babylon.js Engine
        this.engine = new BABYLON.Engine(this.canvas, true, {
            // 기존 대비 "투과/잔상" 체감 차이를 막기 위해 기존 값으로 복귀
            preserveDrawingBuffer: true,
            stencil: true,
        });

        this.timeline.mark('2. Engine created');

        // Create scene
        this.scene = this.createScene();

        this.timeline.mark('3. Scene created');

        // Start render loop EARLY so timeline can measure
        this.engine.runRenderLoop(() => {
            this.scene.render();
        });
        this.timeline.startTracking(this.scene);

        this.timeline.mark('4. RenderLoop started');

        // Phase 2.3: Visual integrity + performance tuning (분리된 매니저)
        if (debugConfig.noQuality) {
            blackHoleDebugLog('⚠️ RenderQualityManager DISABLED by debug flag');
            this.renderQuality = null;
        } else {
            this.renderQuality = new RenderQualityManager(this.engine, this.scene, { minMsaaSamples: 4 });
            this.renderQuality.init(this.scene.activeCamera!, this.canvas);
            // Allow other systems (NavigationScene) to keep quality settings when swapping cameras.
            this.scene.metadata = {
                ...(this.scene.metadata as Record<string, unknown> | null),
                renderQuality: this.renderQuality,
            };
        }

        this.timeline.mark('5. RenderQualityManager');

        // ========================================
        // NO ADT MODE (Black Hole Debug)
        // ========================================
        if (debugConfig.noADT) {
            blackHoleDebugLog('⚠️ GUIManager SKIPPED - NO ADT (diagnostic mode, game will not work)');
            console.log('[System] NO ADT MODE: Skipping all GUI initialization');
            this.timeline.mark('6. GUIManager SKIPPED (noADT)');
            this.timeline.report();
            return; // Early exit - game won't work but we can diagnose
        }

        // Initialize GUI system (HEBS layer hierarchy)
        this.guiManager = new GUIManager(this.scene);

        this.timeline.mark('6. GUIManager created');

        // Phase 2.5: shared loading engine lives in SkipLayer (transition UI)
        this.loadingEngine = new ArcanaLoadingEngine(this.guiManager.getSkipLayer(), { debugMode: true });
        this.transitions = new StageTransitionManager({ scene: this.scene, loading: this.loadingEngine });

        this.timeline.mark('7. LoadingEngine/Transitions');

        // Initialize display components (DisplayLayer에 배치)
        this.backgroundLayer = new BackgroundLayer(this.guiManager.getDisplayLayer());
        // NIKKE/StarRail: DialogueBox 바로 뒤(CharacterLayer 앞) 하단 비네트
        this.bottomVignetteLayer = new BottomVignetteLayer(this.guiManager.getDisplayLayer());
        this.characterLayer = new CharacterLayer(this.guiManager.getDisplayLayer());

        this.timeline.mark('8. Display layers');

        // Initialize Start Screens (SkipLayer에 배치 - 최상위)
        this.splashScene = new SplashScene(this.guiManager.getSkipLayer());
        this.touchToStartScene = new TouchToStartScene(this.guiManager.getSkipLayer());

        this.timeline.mark('9. Start screens');

        // Create Narrative Engine (나중에 활성화)
        this.narrativeEngine = new NarrativeEngine(
            this.guiManager.getInteractionLayer(),
            this.guiManager.getDisplayLayer(),
            this.guiManager.getSkipLayer()
        );

        this.timeline.mark('10. NarrativeEngine');

        // Phase 3 Navigation Engine (SystemLayer UI)
        this.navigationEngine = new NavigationEngine(this.scene, this.guiManager.getSystemLayer(), {
            energyBudget: 60,
            characterModelPath: '/assets/characters/pilot.glb',
        });

        this.timeline.mark('11. NavigationEngine');

        // Resize/DPI handling is owned by RenderQualityManager (Phase 2.6)

        console.log('[System] Initialization complete');

        this.timeline.mark('12. Init complete');

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
        });
        this.flow.start();

        this.timeline.mark('13. FlowController started');
        this.timeline.report();
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
        this.flow?.dispose();
        this.navigationEngine?.dispose();
        this.narrativeEngine?.dispose();
        this.touchToStartScene?.dispose();
        this.splashScene?.dispose();
        this.characterLayer?.dispose();
        this.bottomVignetteLayer?.dispose();
        this.backgroundLayer?.dispose();
        this.guiManager?.dispose();
        this.renderQuality?.dispose();
        this.scene.dispose();
        this.engine.dispose();
    }
}

// Initialize on DOM ready
window.addEventListener('DOMContentLoaded', async () => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;

    // Check for debug lab modes first (they bypass normal game flow)

    // RAF Lab mode
    if (canvas && await checkAndLaunchRAFLab(canvas)) {
        console.log('[System] RAF Lab mode active - Normal game flow bypassed');
        return;
    }

    // Transition Lab mode
    if (canvas && await checkAndLaunchTransitionLab(canvas)) {
        console.log('[System] Transition Lab mode active - Normal game flow bypassed');
        return;
    }

    // Normal game initialization
    new Main();
});
