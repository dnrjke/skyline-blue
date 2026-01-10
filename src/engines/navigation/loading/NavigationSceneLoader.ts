/**
 * NavigationSceneLoader - Navigation Scene 전용 로더.
 *
 * BaseSceneLoader를 확장하여 Navigation/Tactical 파트의
 * 로딩 Phase를 정의한다.
 *
 * Phase 구성:
 * 1. FETCHING: Tactical map JSON + Environment GLB
 * 2. BUILDING: Graph 구축 + Mesh 생성 + Octree
 * 3. WARMING: Material 사전 컴파일
 * 4. BARRIER: 첫 프레임 렌더 검증
 */

import * as BABYLON from '@babylonjs/core';
import {
    BaseSceneLoader,
    PhaseWork,
    LoadingPhase,
    RenderReadyBarrier,
    MaterialWarmupHelper,
} from '../../../core/loading';
import { AssetResolver } from '../../../shared/assets/AssetResolver';
import { NavigationGraph } from '../graph/NavigationGraph';
import { TacticalMapLoader } from '../data/TacticalMapLoader';
import { TacticalEnvironmentLoader } from '../data/TacticalEnvironmentLoader';

/**
 * Navigation Stage 식별자
 */
export interface NavigationStageKey {
    episode: number;
    stage: number;
}

/**
 * Navigation 로딩 결과 데이터
 */
export interface NavigationLoadedData {
    /** 로드된 Graph 데이터 */
    graph: NavigationGraph;

    /** 로드된 환경 컨테이너 (없을 수 있음) */
    environment: BABYLON.AssetContainer | null;
}

/**
 * NavigationSceneLoader 설정
 */
export interface NavigationLoaderConfig {
    /** Graph 인스턴스 (외부에서 주입) */
    graph: NavigationGraph;

    /** 환경 로딩 비활성화 */
    skipEnvironment?: boolean;

    /** Barrier 검증 옵션 */
    barrierValidation?: {
        requiredMeshNames?: string[];
        minActiveMeshCount?: number;
        maxRetryFrames?: number;
    };
}

/**
 * NavigationSceneLoader
 */
export class NavigationSceneLoader extends BaseSceneLoader<NavigationStageKey> {
    private resolver: AssetResolver;
    private mapLoader: TacticalMapLoader;
    private envLoader: TacticalEnvironmentLoader;
    private warmupHelper: MaterialWarmupHelper;
    private barrier: RenderReadyBarrier;

    private config: NavigationLoaderConfig;
    private loadedEnvironment: BABYLON.AssetContainer | null = null;

    constructor(scene: BABYLON.Scene, config: NavigationLoaderConfig) {
        super(scene);
        this.config = config;
        this.resolver = new AssetResolver();
        this.mapLoader = new TacticalMapLoader();
        this.envLoader = new TacticalEnvironmentLoader();
        this.warmupHelper = new MaterialWarmupHelper(scene);
        this.barrier = new RenderReadyBarrier(scene);
    }

    /**
     * Phase 작업 정의
     */
    protected definePhaseWorks(stage: NavigationStageKey): PhaseWork[] {
        const works: PhaseWork[] = [];

        // === FETCHING Phase ===
        works.push({
            phase: LoadingPhase.FETCHING,
            name: 'Tactical Map JSON',
            weight: 1,
            execute: async () => {
                const url = this.resolver.tacticalMapJson(stage);
                const data = await this.mapLoader.loadJson(url);
                this.mapLoader.applyToGraph(this.config.graph, data);
            },
        });

        if (!this.config.skipEnvironment) {
            works.push({
                phase: LoadingPhase.FETCHING,
                name: 'Environment Model',
                weight: 3, // GLB는 더 무거움
                execute: async () => {
                    const url = this.resolver.tacticalEnvironmentModel(stage);
                    this.loadedEnvironment = await this.envLoader.tryLoadEnvironment(
                        url,
                        this.scene
                    );
                },
            });
        }

        // === BUILDING Phase ===
        works.push({
            phase: LoadingPhase.BUILDING,
            name: 'Selection Octree',
            weight: 0.5,
            execute: async () => {
                this.scene.createOrUpdateSelectionOctree();
            },
        });

        if (!this.config.skipEnvironment) {
            works.push({
                phase: LoadingPhase.BUILDING,
                name: 'Environment Attach',
                weight: 1,
                execute: async () => {
                    if (this.loadedEnvironment) {
                        this.loadedEnvironment.addAllToScene();

                        // Optimization: static environment
                        for (const m of this.loadedEnvironment.meshes) {
                            m.isPickable = false;
                            m.freezeWorldMatrix();
                            m.doNotSyncBoundingInfo = true;
                        }
                        for (const mat of this.loadedEnvironment.materials) {
                            (mat as any).freeze?.();
                        }

                        // Octree update after environment insertion
                        this.scene.createOrUpdateSelectionOctree();
                    }
                },
            });
        }

        // === WARMING Phase ===
        works.push({
            phase: LoadingPhase.WARMING,
            name: 'Material Warmup',
            weight: 1,
            execute: async () => {
                await this.warmupHelper.warmupNavigationMaterials();
            },
        });

        // === BARRIER Phase ===
        works.push({
            phase: LoadingPhase.BARRIER,
            name: 'First Frame Render',
            weight: 0.5,
            execute: async () => {
                await this.barrier.waitForFirstFrame({
                    requiredMeshNames: this.config.barrierValidation?.requiredMeshNames,
                    minActiveMeshCount: this.config.barrierValidation?.minActiveMeshCount ?? 1,
                    maxRetryFrames: this.config.barrierValidation?.maxRetryFrames ?? 10,
                    requireCameraRender: true,
                });
            },
        });

        return works;
    }

    /**
     * 로드된 환경 컨테이너 반환
     */
    getLoadedEnvironment(): BABYLON.AssetContainer | null {
        return this.loadedEnvironment;
    }

    /**
     * 리소스 정리
     */
    dispose(): void {
        if (this.loadedEnvironment) {
            try {
                this.loadedEnvironment.removeAllFromScene();
            } catch {
                // ignore
            }
            this.loadedEnvironment.dispose();
            this.loadedEnvironment = null;
        }
    }
}
