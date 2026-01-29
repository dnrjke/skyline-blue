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

        // Phase 2.7: Forensic profiling - measure octree creation time
        const meshCount = scene.meshes.length;
        performance.mark('octree-start');

        scene.createOrUpdateSelectionOctree();

        performance.mark('octree-end');
        performance.measure('octree-creation', 'octree-start', 'octree-end');
        const measure = performance.getEntriesByName('octree-creation', 'measure')[0] as PerformanceMeasure;
        const blockingFlag = measure.duration > 50 ? ' ⚠️ BLOCKING' : '';
        console.log(`[OctreeUnit] Octree created: ${measure.duration.toFixed(1)}ms for ${meshCount} meshes${blockingFlag}`);

        onProgress?.({ progress: 1, message: 'Octree ready' });
    }
}
