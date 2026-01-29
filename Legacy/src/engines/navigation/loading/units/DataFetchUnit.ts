/**
 * DataFetchUnit - Tactical Map JSON 데이터 fetch LoadUnit.
 *
 * FETCHING phase에서:
 * - Tactical map JSON 다운로드
 * - NavigationGraph에 데이터 적용
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress } from '../../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../../core/loading';
import { NavigationGraph } from '../../graph/NavigationGraph';
import { TacticalMapLoader } from '../../data/TacticalMapLoader';
import { AssetResolver } from '../../../../shared/assets/AssetResolver';

export interface DataFetchUnitConfig {
    /** 대상 Graph */
    graph: NavigationGraph;
    /** Stage 정보 */
    stage: { episode: number; stage: number };
}

export class DataFetchUnit extends BaseLoadUnit {
    readonly id = 'NavigationDataFetch';
    readonly phase = LoadingPhase.FETCHING;
    readonly requiredForReady = true;

    private config: DataFetchUnitConfig;
    private resolver: AssetResolver;
    private mapLoader: TacticalMapLoader;

    constructor(config: DataFetchUnitConfig) {
        super();
        this.config = config;
        this.resolver = new AssetResolver();
        this.mapLoader = new TacticalMapLoader();
    }

    protected async doLoad(
        _scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        onProgress?.({ progress: 0, message: 'Fetching tactical map...' });

        const url = this.resolver.tacticalMapJson(this.config.stage);
        const data = await this.mapLoader.loadJson(url);

        onProgress?.({ progress: 0.8, message: 'Applying to graph...' });

        this.mapLoader.applyToGraph(this.config.graph, data);

        onProgress?.({ progress: 1, message: 'Data fetch complete' });
    }

    validate(_scene: BABYLON.Scene): boolean {
        // Graph에 노드가 있으면 검증 통과
        return this.config.graph.getNodes().length > 0;
    }
}
