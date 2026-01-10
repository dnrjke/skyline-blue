/**
 * NavigationSceneLoader - Navigation Scene 전용 Full Loader.
 *
 * 2-Stage Loading Architecture:
 * - 내부적으로 NavigationDataLoader를 사용하여 FETCHING 수행
 * - 복잡한 시각화 빌드가 필요한 경우 NavigationScene처럼
 *   DataLoader + primitives를 직접 사용하는 것이 더 적합
 *
 * 이 클래스는 간단한 사용 케이스를 위한 편의 래퍼.
 *
 * Phase 구성:
 * 1. FETCHING: NavigationDataLoader로 JSON/Environment fetch
 * 2. BUILDING: Octree 생성 + Environment attach
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
import { NavigationGraph } from '../graph/NavigationGraph';
import { NavigationDataLoader } from './NavigationDataLoader';

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
 * NavigationSceneLoader - 편의를 위한 Full Loader 래퍼
 *
 * NOTE: 복잡한 시각화 빌드(Visualizer, LinkNetwork 등)가 필요한 경우,
 * NavigationScene처럼 DataLoader + primitives를 직접 조합하는 것이 더 적합합니다.
 */
export class NavigationSceneLoader extends BaseSceneLoader<NavigationStageKey> {
    private dataLoader: NavigationDataLoader;
    private warmupHelper: MaterialWarmupHelper;
    private barrier: RenderReadyBarrier;

    private config: NavigationLoaderConfig;
    private loadedEnvironment: BABYLON.AssetContainer | null = null;

    constructor(scene: BABYLON.Scene, config: NavigationLoaderConfig) {
        super(scene);
        this.config = config;
        this.dataLoader = new NavigationDataLoader(scene);
        this.warmupHelper = new MaterialWarmupHelper(scene);
        this.barrier = new RenderReadyBarrier(scene);
    }

    /**
     * Phase 작업 정의
     */
    protected definePhaseWorks(stage: NavigationStageKey): PhaseWork[] {
        const works: PhaseWork[] = [];

        // === FETCHING Phase (delegated to NavigationDataLoader) ===
        works.push({
            phase: LoadingPhase.FETCHING,
            name: 'Data Fetch (via DataLoader)',
            weight: 4,
            execute: async () => {
                const result = await this.dataLoader.fetchAndApply(
                    stage,
                    this.config.graph,
                    undefined, // callbacks handled by BaseSceneLoader
                    { skipEnvironment: this.config.skipEnvironment }
                );
                this.loadedEnvironment = result.environment;
            },
        });

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
                        this.dataLoader.attachEnvironment(this.loadedEnvironment);
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
