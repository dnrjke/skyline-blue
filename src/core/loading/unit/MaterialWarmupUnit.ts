/**
 * MaterialWarmupUnit - Material 사전 컴파일 LoadUnit.
 *
 * Babylon.js 8.x 필수 사항:
 * - material.isReady() === false인 메시는 첫 프레임에 active mesh에서 탈락
 * - 따라서 모든 씬에서 사용되는 Material은 사전 컴파일 필요
 *
 * 이 Unit은:
 * - UtilityLayerScene에서 더미 메시 생성
 * - material.forceCompilationAsync(dummy) 실행
 * - 완료 후 더미 메시와 warmup용 material dispose
 *
 * @see docs/babylon_rendering_rules.md
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress } from './LoadUnit';
import { LoadingPhase } from '../protocol/LoadingPhase';

/**
 * Material 팩토리 함수 타입
 */
export type MaterialFactory = (scene: BABYLON.Scene) => BABYLON.Material;

/**
 * MaterialWarmupUnit 설정
 */
export interface MaterialWarmupConfig {
    /** Unit ID (기본: 'MaterialWarmup') */
    id?: string;

    /** Material 팩토리 배열 */
    materials: MaterialFactory[];

    /** UtilityLayerScene 사용 여부 (기본: true) */
    useUtilityLayer?: boolean;

    /** READY 판정에 필수인지 (기본: true) */
    requiredForReady?: boolean;
}

/**
 * MaterialWarmupUnit
 */
export class MaterialWarmupUnit extends BaseLoadUnit {
    readonly id: string;
    readonly phase = LoadingPhase.WARMING;
    readonly requiredForReady: boolean;

    private config: MaterialWarmupConfig;
    private targetScene: BABYLON.Scene | null = null;

    constructor(config: MaterialWarmupConfig) {
        super();
        this.config = config;
        this.id = config.id ?? 'MaterialWarmup';
        this.requiredForReady = config.requiredForReady ?? true;
    }

    protected async doLoad(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        const { materials, useUtilityLayer = true } = this.config;

        if (materials.length === 0) {
            onProgress?.({ progress: 1, message: 'No materials to warmup' });
            return;
        }

        // 대상 Scene 결정 (UtilityLayer or Main)
        this.targetScene = useUtilityLayer
            ? BABYLON.UtilityLayerRenderer.DefaultUtilityLayer.utilityLayerScene
            : scene;

        // 더미 메시 생성
        const dummy = BABYLON.MeshBuilder.CreateSphere(
            '__MaterialWarmupDummy__',
            { diameter: 0.01 },
            this.targetScene
        );
        dummy.isVisible = false;

        try {
            for (let i = 0; i < materials.length; i++) {
                const factory = materials[i];
                const mat = factory(this.targetScene);

                dummy.material = mat;

                // forceCompilationAsync로 셰이더 컴파일
                await mat.forceCompilationAsync(dummy);

                // warmup용 material dispose (실제 사용할 material은 별도 생성)
                mat.dispose();

                onProgress?.({
                    progress: (i + 1) / materials.length,
                    message: `Compiled ${i + 1}/${materials.length}`,
                });
            }
        } finally {
            dummy.dispose();
        }
    }

    /**
     * Validation: Material warmup은 로딩 성공이면 검증 통과
     */
    validate(_scene: BABYLON.Scene): boolean {
        return true;
    }

    // ========================================
    // 편의 팩토리 메서드
    // ========================================

    /**
     * Emissive Material 생성 팩토리
     */
    static createEmissiveMaterialFactory(
        name: string,
        color: BABYLON.Color3
    ): MaterialFactory {
        return (scene) => {
            const mat = new BABYLON.StandardMaterial(name, scene);
            mat.disableLighting = true;
            mat.emissiveColor = color;
            mat.specularColor = BABYLON.Color3.Black();
            mat.backFaceCulling = false;
            return mat;
        };
    }

    /**
     * Navigation Scene용 기본 Material 세트
     */
    static createNavigationWarmupUnit(): MaterialWarmupUnit {
        return new MaterialWarmupUnit({
            id: 'NavigationMaterialWarmup',
            materials: [
                // Path effect (주황색)
                MaterialWarmupUnit.createEmissiveMaterialFactory(
                    '__NavPathWarmup__',
                    new BABYLON.Color3(1.0, 0.5, 0.0)
                ),
                // Invalid path (빨간색)
                MaterialWarmupUnit.createEmissiveMaterialFactory(
                    '__NavInvalidWarmup__',
                    new BABYLON.Color3(1.0, 0.22, 0.22)
                ),
                // Node selection (시안)
                MaterialWarmupUnit.createEmissiveMaterialFactory(
                    '__NavSelectWarmup__',
                    new BABYLON.Color3(0.3, 0.8, 1.0)
                ),
                // Link network (파란색)
                MaterialWarmupUnit.createEmissiveMaterialFactory(
                    '__NavLinkWarmup__',
                    new BABYLON.Color3(0.2, 0.4, 0.8)
                ),
            ],
            useUtilityLayer: true,
            requiredForReady: true,
        });
    }

    /**
     * Flight Scene용 기본 Material 세트 (미래 확장용)
     */
    static createFlightWarmupUnit(): MaterialWarmupUnit {
        return new MaterialWarmupUnit({
            id: 'FlightMaterialWarmup',
            materials: [
                // Trail effect (시안)
                MaterialWarmupUnit.createEmissiveMaterialFactory(
                    '__FlightTrailWarmup__',
                    new BABYLON.Color3(0.5, 0.8, 1.0)
                ),
                // Afterimage (흰색)
                MaterialWarmupUnit.createEmissiveMaterialFactory(
                    '__FlightAfterWarmup__',
                    new BABYLON.Color3(1.0, 1.0, 1.0)
                ),
                // Speed lines (노란색)
                MaterialWarmupUnit.createEmissiveMaterialFactory(
                    '__FlightSpeedWarmup__',
                    new BABYLON.Color3(1.0, 0.9, 0.3)
                ),
            ],
            useUtilityLayer: true,
            requiredForReady: true,
        });
    }
}
