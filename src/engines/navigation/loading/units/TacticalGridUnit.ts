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

        // Phase 2.7: Forensic profiling - measure hologram enable time
        performance.mark('hologram-enable-start');

        hologram.enable();

        performance.mark('hologram-enable-end');
        performance.measure('hologram-enable', 'hologram-enable-start', 'hologram-enable-end');
        const measure = performance.getEntriesByName('hologram-enable', 'measure')[0] as PerformanceMeasure;
        const blockingFlag = measure.duration > 50 ? ' ⚠️ BLOCKING' : '';
        console.log(`[TacticalGridUnit] Hologram enabled: ${measure.duration.toFixed(1)}ms${blockingFlag}`);

        hologram.setVisibility(initialVisibility);

        onProgress?.({ progress: 1, message: 'Tactical grid ready' });
    }

    validate(_scene: BABYLON.Scene): boolean {
        // Phase 검증 원칙: BUILDING phase는 "생성되었는가"만 확인
        // 렌더링 가시성(active meshes)은 BARRIER phase에서 수행됨
        return this.config.hologram.isCreated();
    }
}
