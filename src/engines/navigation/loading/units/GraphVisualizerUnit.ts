/**
 * GraphVisualizerUnit - 노드 시각화 LoadUnit.
 *
 * BUILDING phase에서:
 * - NavigationVisualizer.build() 호출
 * - 노드 메시 생성
 *
 * Graph 노드가 시각화되지 않으면 READY가 아님.
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress } from '../../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../../core/loading';
import { NavigationVisualizer } from '../../visualization/NavigationVisualizer';
import { NavigationGraph } from '../../graph/NavigationGraph';

export interface GraphVisualizerUnitConfig {
    /** NavigationVisualizer 인스턴스 */
    visualizer: NavigationVisualizer;
    /** NavigationGraph 인스턴스 (검증용) */
    graph: NavigationGraph;
}

export class GraphVisualizerUnit extends BaseLoadUnit {
    readonly id = 'GraphVisualizer';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = true;

    private config: GraphVisualizerUnitConfig;

    constructor(config: GraphVisualizerUnitConfig) {
        super();
        this.config = config;
    }

    protected async doLoad(
        _scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        onProgress?.({ progress: 0, message: 'Building graph visualizer...' });

        this.config.visualizer.build();

        onProgress?.({ progress: 1, message: 'Graph visualizer ready' });
    }

    validate(_scene: BABYLON.Scene): boolean {
        // Graph에 노드가 있으면 build()가 성공한 것으로 간주
        // Note: 렌더링 가시성 확인은 BARRIER phase에서 수행됨
        const nodeCount = this.config.graph.getNodes().length;
        return nodeCount > 0;
    }
}
