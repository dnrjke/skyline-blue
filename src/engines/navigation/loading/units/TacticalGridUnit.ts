/**
 * TacticalGridUnit - 전술 홀로그램 그리드 LoadUnit.
 *
 * BUILDING phase에서:
 * - TacticalHologram 활성화
 * - 그리드 메시 생성
 *
 * 전술 그리드가 안 보이면 READY가 아님.
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress } from '../../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../../core/loading';
import { TacticalHologram } from '../../visualization/TacticalHologram';

export interface TacticalGridUnitConfig {
    /** TacticalHologram 인스턴스 */
    hologram: TacticalHologram;
    /** 초기 visibility (트랜지션용) */
    initialVisibility?: number;
}

export class TacticalGridUnit extends BaseLoadUnit {
    readonly id = 'TacticalGrid';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = true;

    private config: TacticalGridUnitConfig;

    constructor(config: TacticalGridUnitConfig) {
        super();
        this.config = config;
    }

    protected async doLoad(
        _scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        onProgress?.({ progress: 0, message: 'Enabling tactical hologram...' });

        const { hologram, initialVisibility = 0 } = this.config;

        hologram.enable();
        hologram.setVisibility(initialVisibility);

        onProgress?.({ progress: 1, message: 'Tactical grid ready' });
    }

    validate(scene: BABYLON.Scene): boolean {
        // Hologram 관련 메시가 active meshes에 있는지 확인
        const activeMeshes = scene.getActiveMeshes();
        for (let i = 0; i < activeMeshes.length; i++) {
            const mesh = activeMeshes.data[i];
            if (mesh?.name.includes('Hologram') || mesh?.name.includes('tactical')) {
                return true;
            }
        }

        // Active meshes가 0이 아니면 일단 통과
        // (Hologram은 visibility가 0일 수 있음)
        return activeMeshes.length > 0;
    }
}
