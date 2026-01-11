/**
 * OctreeUnit - Selection Octree 생성 LoadUnit.
 *
 * BUILDING phase에서:
 * - scene.createOrUpdateSelectionOctree() 호출
 * - 피킹 성능 최적화
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress } from '../../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../../core/loading';

export class OctreeUnit extends BaseLoadUnit {
    readonly id = 'SelectionOctree';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = false; // 성능 최적화용, 필수 아님

    protected async doLoad(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        onProgress?.({ progress: 0, message: 'Building selection octree...' });

        scene.createOrUpdateSelectionOctree();

        onProgress?.({ progress: 1, message: 'Octree ready' });
    }
}
