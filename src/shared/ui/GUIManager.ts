/**
 * GUIManager - Babylon GUI Layer Manager
 *
 * Manages AdvancedDynamicTexture and layer hierarchy.
 * All UI is rendered within Canvas - NO HTML/CSS.
 *
 * 적응형 UI 원칙:
 * - idealWidth만 설정 (가로 기준 스케일링)
 * - idealHeight 미설정 → 세로는 실제 화면 높이 사용
 * - UI 요소는 고정 픽셀 크기, 앵커로 위치 결정
 * - 화면이 가로로 늘어나도 UI 높이는 그대로
 *
 * HEBS (Hierarchical Event Blocking System) 준수:
 * - InteractionLayer: 유일한 입력 수신 지점
 * - 모든 상위 레이어: isHitTestVisible = false (시각 전용)
 * - 팝업 활성화 시: InteractionLayer.isEnabled = false
 *
 * Layer Hierarchy (zIndex 순서):
 * - INTERACTION (100): 입력 전담
 * - DISPLAY (500): 배경, 캐릭터, 대화창
 * - EFFECT (800): 연출 이펙트
 * - SYSTEM (1000): 팝업, 선택지
 * - SKIP (1100): 시스템 버튼 (Skip, Settings)
 */

import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { Z_INDEX, LAYOUT } from '../design';
import { getBlackHoleDebugConfig, blackHoleDebugLog } from '../../debug/BlackHoleDebugFlags';

export class GUIManager {
    private texture: GUI.AdvancedDynamicTexture;
    private rootScaler: GUI.Rectangle; // Phase 2.6: Root Scaling Container
    private initialScaleApplied: boolean = false;
    private simpleGuiMode: boolean = false;

    // Layer containers (HEBS 계층 구조)
    private interactionLayer: GUI.Rectangle;
    private displayLayer: GUI.Rectangle;
    private effectLayer: GUI.Rectangle;
    private systemLayer: GUI.Rectangle;
    private skipLayer: GUI.Rectangle;

    constructor(scene: BABYLON.Scene) {
        const debugConfig = getBlackHoleDebugConfig();
        this.simpleGuiMode = debugConfig.simpleGui;

        this.texture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('MainUI', true, scene);

        // ========================================
        // Simple GUI Mode (Black Hole Debug)
        // ========================================
        if (this.simpleGuiMode) {
            blackHoleDebugLog('⚠️ GUIManager SIMPLE MODE - adaptive scaling DISABLED');

            // Use default renderAtIdealSize (true) for simplicity
            this.texture.renderAtIdealSize = true;
            this.texture.idealWidth = LAYOUT.IDEAL_WIDTH;

            // Create simple root container (no scaling)
            this.rootScaler = new GUI.Rectangle('RootScaler');
            this.rootScaler.thickness = 0;
            this.rootScaler.width = '100%';
            this.rootScaler.height = '100%';
            this.rootScaler.alpha = 1; // Immediately visible
            this.texture.addControl(this.rootScaler);

            console.log('[GUIManager] SIMPLE MODE: No adaptive scaling, no resize observers');
        } else {
            // ========================================
            // Phase 2.6: Native Resolution UI (Crisp Text)
            // ========================================
            // 기존 'renderAtIdealSize = true'는 고해상도(DPI 3)에서도
            // 텍스처를 저해상도(Logical Size)로 생성하여 흐릿함을 유발함.
            // 따라서 이를 비활성화하고, Root Container의 Scale을 수동으로 조절하여
            // "물리 픽셀 1:1 텍스처 + 논리적 좌표계 유지"를 달성한다.
            this.texture.renderAtIdealSize = false;

            console.log('[GUIManager] Initialized with Native Resolution UI');
            console.log('[GUIManager] renderAtIdealSize=', this.texture.renderAtIdealSize);

            // Phase 2.6: Create Root Scaler
            // This container scales the entire UI to match logical 1080p design,
            // while the underlying texture remains at native resolution.
            this.rootScaler = new GUI.Rectangle('RootScaler');
            this.rootScaler.thickness = 0;
            this.rootScaler.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.rootScaler.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
            // Prevent "wrong-first-frame" flash: keep hidden until a valid scale is applied
            this.rootScaler.alpha = 0;
            this.texture.addControl(this.rootScaler);
        }

        // Create layers in zIndex order (INTERACTION first as per arcana_ui_rules.md)
        // HEBS §1.3: InteractionLayer는 ADT 내에서 가장 먼저 생성되어야 한다
        this.interactionLayer = this.createLayer('InteractionLayer', Z_INDEX.INTERACTION);
        this.displayLayer = this.createLayer('DisplayLayer', Z_INDEX.DISPLAY);
        this.effectLayer = this.createLayer('EffectLayer', Z_INDEX.EFFECT);
        this.systemLayer = this.createLayer('SystemLayer', Z_INDEX.SYSTEM);
        this.skipLayer = this.createLayer('SkipLayer', Z_INDEX.SKIP);

        // HEBS §1.1: 모든 상위 레이어는 클릭 관통 (isHitTestVisible = false)
        // InteractionLayer만 입력을 소비함
        this.displayLayer.isHitTestVisible = false;
        this.effectLayer.isHitTestVisible = false;
        this.systemLayer.isHitTestVisible = false;
        // SkipLayer는 "시스템 버튼" 전용 레이어로 사용 가능:
        // - 기본은 클릭 관통(컨트롤이 없을 때)
        // - Skip/Auto 등 컨트롤이 추가되면 해당 컨트롤이 isPointerBlocker=true로 입력을 소비
        this.skipLayer.isHitTestVisible = true;
        // 핵심: SkipLayer는 전체 화면 컨테이너이므로, 컨테이너 자체가 피킹되면
        // InteractionLayer의 clickArea까지 이벤트가 내려가지 않을 수 있다.
        // Babylon GUI 규칙에 따라 "자식에게만 피킹 위임"하여 버튼 영역만 히트 테스트 되게 한다.
        this.skipLayer.delegatePickingToChildren = true;

        // Apply scale policy ONLY in normal mode
        if (!this.simpleGuiMode) {
            // Apply scale policy AFTER RootScaler/layers are created.
            // Also re-apply on engine resize. (RenderQualityManager may resize asynchronously via ResizeObserver.)
            const engine = scene.getEngine();
            engine.onResizeObservable.add(() => {
                this.applyAdaptiveScaling(engine);
            });
            this.applyAdaptiveScaling(engine);

            // Late-bind scaling to ensure initial viewport/layout has settled
            scene.executeWhenReady(() => {
                this.applyAdaptiveScaling(engine);
            });
        }

        console.log('[GUIManager] HEBS layer hierarchy created');
    }

    private createLayer(name: string, zIndex: number): GUI.Rectangle {
        const layer = new GUI.Rectangle(name);
        layer.width = '100%';
        layer.height = '100%';
        layer.thickness = 0;
        layer.zIndex = zIndex;
        layer.isPointerBlocker = false;
        // Phase 2.6: Add to RootScaler instead of direct Texture
        this.rootScaler.addControl(layer);
        return layer;
    }

    getInteractionLayer(): GUI.Rectangle {
        return this.interactionLayer;
    }

    getDisplayLayer(): GUI.Rectangle {
        return this.displayLayer;
    }

    getSystemLayer(): GUI.Rectangle {
        return this.systemLayer;
    }

    getEffectLayer(): GUI.Rectangle {
        return this.effectLayer;
    }

    getSkipLayer(): GUI.Rectangle {
        return this.skipLayer;
    }

    getTexture(): GUI.AdvancedDynamicTexture {
        return this.texture;
    }

    /**
     * HEBS §1.1: 팝업 활성화 시 InteractionLayer 비활성화
     * 하위 입력을 물리적으로 차단하여 팝업만 입력 수신
     */
    disableInteraction(): void {
        this.interactionLayer.isEnabled = false;
        console.log('[GUIManager] HEBS: Interaction disabled (popup active)');
    }

    /**
     * HEBS §1.1: 팝업 종료 시 InteractionLayer 재활성화
     */
    enableInteraction(): void {
        this.interactionLayer.isEnabled = true;
        console.log('[GUIManager] HEBS: Interaction enabled');
    }

    dispose(): void {
        this.texture.dispose();
    }

    /**
     * Phase 2.6: Manual Scaling Logic (Root Container Scale)
     * renderAtIdealSize=false 상태에서 논리적 해상도(1080p)를 유지하기 위해
     * ADT의 RootContainer 스케일을 직접 계산하여 주입한다.
     */
    private applyAdaptiveScaling(engine: BABYLON.AbstractEngine): void {
        const renderW = engine.getRenderWidth();
        const renderH = engine.getRenderHeight();
        // Guard: engine can report 0x0 very early (layout not finalized yet)
        if (renderW < 2 || renderH < 2) {
            return;
        }
        const aspect = renderW / Math.max(renderH, 1);

        // 1. Determine Scale Factor based on orientation
        let scale = 1.0;
        let mode = '';

        const isWideLandscape = aspect >= 1.35;
        const isSquareish = aspect >= 0.75 && aspect < 1.35;

        if (!isWideLandscape && !isSquareish) {
            // Portrait (Mobile): 폭 1080px 기준
            scale = renderW / LAYOUT.IDEAL_WIDTH; // renderW / 1080
            mode = 'portrait';
        } else if (isWideLandscape) {
            // Wide Landscape (PC): 높이 1080px 기준
            scale = renderH / 1080;
            mode = 'landscape';
        } else {
            // Tablet/Square: 높이 1440px 기준 (약간 축소)
            scale = renderH / 1440;
            mode = 'squareish';
        }

        // 2. Apply to Root Scaler
        // Instead of scaling the ADT root, we scale our custom container.
        // CRITICAL: We must inverse-scale the size so that 100% inside the scaler covers the full screen.
        // Example: Scale 0.5 -> Scaler must be 200% size to cover screen.
        if (this.rootScaler) {
            this.rootScaler.scaleX = scale;
            this.rootScaler.scaleY = scale;
            this.rootScaler.widthInPixels = renderW / scale;
            this.rootScaler.heightInPixels = renderH / scale;
            if (!this.initialScaleApplied) {
                // Reveal only after we have a valid scaler size AND
                // engine hardware scaling is aligned with DPR (prevents wrong-first-frame flash).
                const dpr = Math.max(1, window.devicePixelRatio || 1);
                const expectedHardwareScale = 1 / dpr;
                const actualHardwareScale = engine.getHardwareScalingLevel();
                if (Math.abs(actualHardwareScale - expectedHardwareScale) <= 0.0005) {
                    this.rootScaler.alpha = 1;
                    this.initialScaleApplied = true;
                    console.log(
                        '[GUIManager] InitialScale locked',
                        `Render=${renderW}x${renderH}`,
                        `Scale=${scale.toFixed(4)}`,
                        `HWScale=${actualHardwareScale.toFixed(6)}`,
                        `DPR=${dpr}`
                    );
                }
            }
        }

        console.log(
            `[GUIManager] ScalePolicy: ${mode}`,
            `Render=${renderW}x${renderH}`,
            `Scale=${scale.toFixed(4)}`,
            `ScalerSize=${Math.round(renderW/scale)}x${Math.round(renderH/scale)}`,
            `Aspect=${aspect.toFixed(3)}`
        );
    }
}
