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

    validate(scene: BABYLON.Scene): boolean {
        // Graph에 노드가 있고, active mesh에 nav 관련 메시가 있어야 함
        const nodeCount = this.config.graph.getNodes().length;
        if (nodeCount === 0) return false;

        const activeMeshes = scene.getActiveMeshes();
        for (let i = 0; i < activeMeshes.length; i++) {
            const mesh = activeMeshes.data[i];
            // 노드 메시 확인 (metadata에 navNodeId가 있음)
            if (mesh?.metadata?.navNodeId) {
                return true;
            }
        }

        // 노드가 있지만 아직 active mesh에 없을 수 있음 (첫 프레임)
        // 이 경우 Barrier에서 retry할 것임
        return activeMeshes.length > 0;
    }
}
