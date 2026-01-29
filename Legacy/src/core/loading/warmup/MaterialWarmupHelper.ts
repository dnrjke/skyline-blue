/**
 * MaterialWarmupHelper - 로딩 프로토콜용 Material Warmup 래퍼.
 *
 * 기존 src/engines/rendering/MaterialWarmup.ts를 로딩 프로토콜 컨텍스트에서
 * 사용하기 위한 헬퍼. 직접 구현하지 않고 기존 모듈에 위임한다.
 *
 * 주요 역할:
 * - Scene별 Material 정의를 받아 warmup 수행
 * - UtilityLayerScene 사용 옵션 제공
 * - 로딩 Phase와의 통합
 */

import * as BABYLON from '@babylonjs/core';
import { MaterialWarmup } from '../../../engines/rendering/MaterialWarmup';

/**
 * Material 팩토리 타입
 */
export type MaterialFactory = (scene: BABYLON.Scene) => BABYLON.Material;

/**
 * Warmup 설정
 */
export interface WarmupConfig {
    /** Material 팩토리 배열 */
    materials: MaterialFactory[];

    /**
     * UtilityLayerScene 사용 여부.
     * true면 Effect/Overlay 용도의 메시에 적합.
     */
    useUtilityLayer?: boolean;
}

/**
 * MaterialWarmupHelper - 로딩 프로토콜용 래퍼
 */
export class MaterialWarmupHelper {
    private mainScene: BABYLON.Scene;

    constructor(mainScene: BABYLON.Scene) {
        this.mainScene = mainScene;
    }

    /**
     * Material warmup 수행
     *
     * @param config Warmup 설정
     * @returns Promise (완료 시 resolve)
     */
    async warmup(config: WarmupConfig): Promise<void> {
        const { materials, useUtilityLayer = false } = config;

        if (materials.length === 0) {
            console.log('[MaterialWarmupHelper] No materials to warmup');
            return;
        }

        // 대상 Scene 결정
        const targetScene = useUtilityLayer
            ? BABYLON.UtilityLayerRenderer.DefaultUtilityLayer.utilityLayerScene
            : this.mainScene;

        const warmup = new MaterialWarmup(targetScene);

        await warmup.warmupAsync({
            materials,
            onComplete: () => {
                console.log(
                    `[MaterialWarmupHelper] Warmup complete (${materials.length} materials, ` +
                        `utility=${useUtilityLayer})`
                );
            },
            onError: (err) => {
                console.warn('[MaterialWarmupHelper] Warmup error:', err);
            },
        });
    }

    /**
     * 편의 메서드: Navigation Scene용 기본 Material warmup
     */
    async warmupNavigationMaterials(): Promise<void> {
        await this.warmup({
            materials: [
                // Path effect (UtilityLayer)
                (s) =>
                    MaterialWarmup.createEmissiveMaterial(
                        s,
                        '__NavPathWarmup__',
                        new BABYLON.Color3(1.0, 0.5, 0.0)
                    ),
                // Invalid path
                (s) =>
                    MaterialWarmup.createEmissiveMaterial(
                        s,
                        '__NavInvalidWarmup__',
                        new BABYLON.Color3(1.0, 0.22, 0.22)
                    ),
                // Node selection
                (s) =>
                    MaterialWarmup.createEmissiveMaterial(
                        s,
                        '__NavSelectWarmup__',
                        new BABYLON.Color3(0.3, 0.8, 1.0)
                    ),
            ],
            useUtilityLayer: true,
        });
    }

    /**
     * 편의 메서드: Flight Scene용 기본 Material warmup
     * (미래 확장용)
     */
    async warmupFlightMaterials(): Promise<void> {
        await this.warmup({
            materials: [
                // Trail effect
                (s) =>
                    MaterialWarmup.createEmissiveMaterial(
                        s,
                        '__FlightTrailWarmup__',
                        new BABYLON.Color3(0.5, 0.8, 1.0)
                    ),
                // Afterimage
                (s) =>
                    MaterialWarmup.createEmissiveMaterial(
                        s,
                        '__FlightAfterWarmup__',
                        new BABYLON.Color3(1.0, 1.0, 1.0)
                    ),
            ],
            useUtilityLayer: true,
        });
    }
}
