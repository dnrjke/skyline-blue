import * as BABYLON from '@babylonjs/core';

/**
 * UtilitySceneManager - Babylon 8.x Rendering Pipeline 우회를 위한 UtilityLayer 관리
 *
 * 문제:
 * - GlowLayer/RenderingPipeline이 Active Mesh Evaluation을 독점
 * - 동적 생성 메시가 렌더링에서 제외됨
 *
 * 해결:
 * - UtilityLayerScene을 사용하여 독립적인 렌더 패스 확보
 * - Effect/Overlay 메시를 main scene에서 분리
 *
 * @see docs/babylon_rendering_rules.md
 */
export class UtilitySceneManager {
    private static instance: UtilitySceneManager | null = null;
    private utilityLayer: BABYLON.UtilityLayerRenderer;
    private _utilityScene: BABYLON.Scene;

    private constructor() {
        this.utilityLayer = BABYLON.UtilityLayerRenderer.DefaultUtilityLayer;
        this._utilityScene = this.utilityLayer.utilityLayerScene;
    }

    /**
     * 싱글톤 인스턴스 획득
     */
    static getInstance(): UtilitySceneManager {
        if (!UtilitySceneManager.instance) {
            UtilitySceneManager.instance = new UtilitySceneManager();
        }
        return UtilitySceneManager.instance;
    }

    /**
     * UtilityLayerScene 반환
     * - 이 Scene에 생성된 메시는 main scene의 Rendering Pipeline 영향을 받지 않음
     */
    get utilityScene(): BABYLON.Scene {
        return this._utilityScene;
    }

    /**
     * UtilityLayerRenderer 반환
     */
    get layer(): BABYLON.UtilityLayerRenderer {
        return this.utilityLayer;
    }

    /**
     * UtilityScene에 메시 생성
     * - 필수 속성 자동 설정 (layerMask, renderingGroupId 등)
     */
    createMesh<T extends BABYLON.Mesh>(
        creator: (scene: BABYLON.Scene) => T,
        options?: {
            layerMask?: number;
            renderingGroupId?: number;
            pickable?: boolean;
        }
    ): T {
        const mesh = creator(this._utilityScene);

        mesh.layerMask = options?.layerMask ?? 0x0FFFFFFF;
        mesh.renderingGroupId = options?.renderingGroupId ?? 0;
        mesh.isPickable = options?.pickable ?? false;

        // Babylon 8.x 렌더링 보장
        mesh.alwaysSelectAsActiveMesh = true;
        (mesh as any).doNotCheckFrustum = true;

        mesh.computeWorldMatrix(true);
        mesh.refreshBoundingInfo(true);

        return mesh;
    }

    /**
     * UtilityScene에 Material 생성
     */
    createMaterial<T extends BABYLON.Material>(
        creator: (scene: BABYLON.Scene) => T
    ): T {
        return creator(this._utilityScene);
    }

    /**
     * UtilityScene 통계 로그
     */
    logStats(): void {
        console.log('[UtilitySceneManager] Stats:', {
            meshCount: this._utilityScene.meshes.length,
            materialCount: this._utilityScene.materials.length,
            particleSystemCount: this._utilityScene.particleSystems.length,
        });
    }
}
