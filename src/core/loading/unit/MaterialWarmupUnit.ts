/**
 * MaterialWarmupUnit - Material 사전 컴파일 LoadUnit (Pure Generator Version)
 *
 * The Pure Generator Manifesto 준수:
 * - AsyncGenerator로 완전 전환
 * - while(ctx.isHealthy()) 패턴 적용
 * - 각 material 컴파일 후 yield
 * - 일정 간격으로 Recovery Frame 배치
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
import {
    BaseSlicedLoadUnit,
    type LoadUnitCost,
} from '../executor/SlicedLoadUnit';
import type { LoadExecutionContext } from '../executor/LoadExecutionContext';
import { LoadUnitProgress, LoadUnitStatus } from './LoadUnit';
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
 * MaterialWarmupUnit (Pure Generator Version)
 *
 * ⚠️ NORMAL 유닛 (material 수가 적음): 각 material 후 yield
 * 3개마다 Recovery Frame 배치
 */
export class MaterialWarmupUnit extends BaseSlicedLoadUnit {
    readonly id: string;
    readonly phase = LoadingPhase.WARMING;
    readonly requiredForReady: boolean;
    readonly estimateCost: LoadUnitCost = 'MEDIUM';

    private config: MaterialWarmupConfig;
    private targetScene: BABYLON.Scene | null = null;
    private dummy: BABYLON.Mesh | null = null;

    constructor(config: MaterialWarmupConfig) {
        super();
        this.config = config;
        this.id = config.id ?? 'MaterialWarmup';
        this.requiredForReady = config.requiredForReady ?? true;
    }

    /**
     * Time-Sliced 실행 (Pure Generator)
     */
    async *executeSteps(
        scene: BABYLON.Scene,
        ctx: LoadExecutionContext,
        onProgress?: (progress: LoadUnitProgress) => void
    ): AsyncGenerator<void, void, void> {
        const { materials, useUtilityLayer = true } = this.config;

        onProgress?.({ progress: 0, message: 'Preparing material warmup...' });
        yield; // 시작 지점

        if (materials.length === 0) {
            onProgress?.({ progress: 1, message: 'No materials to warmup' });
            return;
        }

        // 대상 Scene 결정 (UtilityLayer or Main)
        this.targetScene = useUtilityLayer
            ? BABYLON.UtilityLayerRenderer.DefaultUtilityLayer.utilityLayerScene
            : scene;

        yield; // Scene 결정 후

        // 더미 메시 생성
        this.dummy = BABYLON.MeshBuilder.CreateSphere(
            '__MaterialWarmupDummy__',
            { diameter: 0.01 },
            this.targetScene
        );
        this.dummy.isVisible = false;

        yield; // 더미 메시 생성 후

        const total = materials.length;
        let index = 0;
        let compiledInBatch = 0;

        console.log(`[MaterialWarmupUnit] Warming ${total} materials...`);

        try {
            // Pure Generator: while(ctx.isHealthy()) 패턴
            while (index < total) {
                // Budget 체크
                if (!ctx.isHealthy()) {
                    yield;
                }

                const factory = materials[index];
                const mat = factory(this.targetScene!);

                this.dummy!.material = mat;

                // Phase 2.7: Forensic profiling
                performance.mark(`mat-compile-${index}-start`);

                // forceCompilationAsync로 셰이더 컴파일
                await mat.forceCompilationAsync(this.dummy!);

                performance.mark(`mat-compile-${index}-end`);
                performance.measure(
                    `mat-compile-${index}`,
                    `mat-compile-${index}-start`,
                    `mat-compile-${index}-end`
                );
                const measure = performance.getEntriesByName(`mat-compile-${index}`, 'measure')[0] as PerformanceMeasure;
                const blockingFlag = measure.duration > 50 ? ' ⚠️ BLOCKING' : '';
                console.log(`[MaterialWarmupUnit] Compiled ${mat.name}: ${measure.duration.toFixed(1)}ms${blockingFlag}`);

                // warmup용 material dispose (실제 사용할 material은 별도 생성)
                mat.dispose();

                index++;
                compiledInBatch++;

                onProgress?.({
                    progress: index / total,
                    message: `Compiled ${index}/${total}`,
                });

                yield; // 각 material 컴파일 후 yield

                // ⚠️ CRITICAL: 3개마다 Recovery Frame
                if (compiledInBatch >= 3) {
                    console.log(`[MaterialWarmupUnit] Recovery after ${compiledInBatch} materials...`);
                    await ctx.requestRecoveryFrames(1);
                    compiledInBatch = 0;
                    yield;
                }
            }
        } finally {
            // 더미 메시 정리
            if (this.dummy && !this.dummy.isDisposed()) {
                this.dummy.dispose();
                this.dummy = null;
            }
        }

        onProgress?.({ progress: 1, message: 'Material warmup complete' });
        console.log(`[MaterialWarmupUnit] ✅ Complete: ${total} materials warmed`);
        yield; // 최종 yield
    }

    /**
     * Validation: Material warmup은 로딩 성공이면 검증 통과
     */
    validate(_scene: BABYLON.Scene): boolean {
        return true;
    }

    override dispose(): void {
        if (this.dummy && !this.dummy.isDisposed()) {
            this.dummy.dispose();
            this.dummy = null;
        }
        this.targetScene = null;
        this.status = LoadUnitStatus.PENDING;
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
