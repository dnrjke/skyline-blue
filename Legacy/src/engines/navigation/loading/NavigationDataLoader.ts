/**
 * NavigationDataLoader - Navigation Scene 데이터 전용 Fetcher.
 *
 * 책임 범위 (FETCHING phase만):
 * - Tactical Map JSON fetch + Graph 적용
 * - Environment GLB fetch (선택적)
 *
 * 책임 범위 외:
 * - Mesh 빌드 (NavigationScene이 담당)
 * - Material warmup (NavigationScene이 조율)
 * - Barrier 검증 (NavigationScene이 조율)
 *
 * 이 분리를 통해:
 * - DataLoader는 순수 데이터 fetch에 집중
 * - NavigationScene이 전체 로딩 흐름을 조율
 * - 각 책임이 명확히 분리됨
 */

import * as BABYLON from '@babylonjs/core';
import { AssetResolver } from '../../../shared/assets/AssetResolver';
import { NavigationGraph } from '../graph/NavigationGraph';
import { TacticalMapLoader } from '../data/TacticalMapLoader';
import { TacticalEnvironmentLoader } from '../data/TacticalEnvironmentLoader';

/**
 * Stage 식별자
 */
export interface StageKey {
    episode: number;
    stage: number;
}

/**
 * 데이터 로딩 결과
 */
export interface NavigationDataResult {
    /** Graph가 정상적으로 로드되었는지 */
    graphLoaded: boolean;

    /** 환경 컨테이너 (없을 수 있음) */
    environment: BABYLON.AssetContainer | null;

    /** 로딩 소요 시간 (ms) */
    timings: {
        jsonFetch: number;
        graphApply: number;
        environmentFetch: number;
    };
}

/**
 * 로딩 진행 콜백
 */
export interface DataLoaderCallbacks {
    onLog?: (message: string) => void;
    onProgress?: (progress: number) => void;
}

/**
 * NavigationDataLoader
 */
export class NavigationDataLoader {
    private scene: BABYLON.Scene;
    private resolver: AssetResolver;
    private mapLoader: TacticalMapLoader;
    private envLoader: TacticalEnvironmentLoader;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
        this.resolver = new AssetResolver();
        this.mapLoader = new TacticalMapLoader();
        this.envLoader = new TacticalEnvironmentLoader();
    }

    /**
     * 데이터 fetch 및 Graph 적용
     *
     * @param stage Stage 식별자
     * @param graph 대상 Graph (외부에서 주입)
     * @param callbacks 진행 콜백
     * @param options 옵션
     */
    async fetchAndApply(
        stage: StageKey,
        graph: NavigationGraph,
        callbacks?: DataLoaderCallbacks,
        options?: { skipEnvironment?: boolean }
    ): Promise<NavigationDataResult> {
        const timings = {
            jsonFetch: 0,
            graphApply: 0,
            environmentFetch: 0,
        };

        // === JSON Fetch ===
        callbacks?.onLog?.('[FETCHING] Tactical Map JSON...');
        callbacks?.onProgress?.(0.05);

        const jsonStart = performance.now();
        const url = this.resolver.tacticalMapJson(stage);
        const data = await this.mapLoader.loadJson(url);
        timings.jsonFetch = performance.now() - jsonStart;
        callbacks?.onLog?.(`[FETCHING] JSON Fetch: ${Math.round(timings.jsonFetch)}ms`);

        // === Graph Apply ===
        callbacks?.onProgress?.(0.15);
        const applyStart = performance.now();
        this.mapLoader.applyToGraph(graph, data);
        timings.graphApply = performance.now() - applyStart;
        callbacks?.onLog?.(`[FETCHING] Graph Apply: ${Math.round(timings.graphApply)}ms`);
        callbacks?.onProgress?.(0.25);

        // === Environment Fetch (Optional) ===
        let environment: BABYLON.AssetContainer | null = null;

        if (!options?.skipEnvironment) {
            callbacks?.onLog?.('[FETCHING] Environment Model...');
            const envStart = performance.now();
            const envUrl = this.resolver.tacticalEnvironmentModel(stage);

            environment = await this.envLoader.tryLoadEnvironment(
                envUrl,
                this.scene,
                (p01) => {
                    // 0.25 ~ 0.70 구간을 환경 로딩에 할당
                    callbacks?.onProgress?.(0.25 + 0.45 * p01);
                }
            );

            timings.environmentFetch = performance.now() - envStart;

            if (environment) {
                callbacks?.onLog?.(
                    `[FETCHING] Environment: ${Math.round(timings.environmentFetch)}ms`
                );
            } else {
                callbacks?.onLog?.(
                    `[FETCHING] Environment: skipped (${Math.round(timings.environmentFetch)}ms)`
                );
            }
        }

        callbacks?.onProgress?.(0.70);

        return {
            graphLoaded: true,
            environment,
            timings,
        };
    }

    /**
     * Environment를 Scene에 attach하고 최적화 적용
     */
    attachEnvironment(container: BABYLON.AssetContainer): void {
        container.addAllToScene();

        // Optimization: static environment meshes/materials are frozen
        for (const m of container.meshes) {
            m.isPickable = false;
            m.freezeWorldMatrix();
            m.doNotSyncBoundingInfo = true;
        }
        for (const mat of container.materials) {
            (mat as any).freeze?.();
        }
    }
}
