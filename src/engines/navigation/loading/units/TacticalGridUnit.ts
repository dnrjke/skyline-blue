/**
 * TacticalGridUnit - 전술 홀로그램 그리드 LoadUnit (Pure Generator Version)
 *
 * The Pure Generator Manifesto 준수:
 * - AsyncGenerator로 완전 전환
 * - while(ctx.isHealthy()) 패턴 적용
 *
 * BUILDING phase에서:
 * - TacticalHologram 활성화
 * - 그리드 메시 생성
 *
 * 전술 그리드가 안 보이면 READY가 아님.
 */

import * as BABYLON from '@babylonjs/core';
import {
    BaseSlicedLoadUnit,
    type LoadUnitCost,
} from '../../../../core/loading/executor/SlicedLoadUnit';
import type { LoadExecutionContext } from '../../../../core/loading/executor/LoadExecutionContext';
import { LoadUnitProgress } from '../../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../../core/loading';
import { TacticalHologram } from '../../visualization/TacticalHologram';

export interface TacticalGridUnitConfig {
    /** TacticalHologram 인스턴스 */
    hologram: TacticalHologram;
    /** 초기 visibility (트랜지션용) */
    initialVisibility?: number;
}

/**
 * TacticalGridUnit (Pure Generator Version)
 *
 * LIGHT 유닛: hologram.enable()은 빠른 작업이지만
 * Pure Generator Manifesto에 따라 AsyncGenerator로 전환
 */
export class TacticalGridUnit extends BaseSlicedLoadUnit {
    readonly id = 'TacticalGrid';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = true;
    readonly estimateCost: LoadUnitCost = 'LIGHT';

    private config: TacticalGridUnitConfig;

    constructor(config: TacticalGridUnitConfig) {
        super();
        this.config = config;
    }

    /**
     * Time-Sliced 실행 (Pure Generator)
     */
    async *executeSteps(
        _scene: BABYLON.Scene,
        _ctx: LoadExecutionContext,
        onProgress?: (progress: LoadUnitProgress) => void
    ): AsyncGenerator<void, void, void> {
        onProgress?.({ progress: 0, message: 'Enabling tactical hologram...' });
        yield; // 시작 지점

        const { hologram, initialVisibility = 0 } = this.config;

        // Phase 2.7: Forensic profiling - measure hologram enable time
        performance.mark('hologram-enable-start');

        hologram.enable();

        performance.mark('hologram-enable-end');
        performance.measure('hologram-enable', 'hologram-enable-start', 'hologram-enable-end');
        const measure = performance.getEntriesByName('hologram-enable', 'measure')[0] as PerformanceMeasure;
        const blockingFlag = measure.duration > 50 ? ' ⚠️ BLOCKING' : '';
        console.log(`[TacticalGridUnit] Hologram enabled: ${measure.duration.toFixed(1)}ms${blockingFlag}`);

        yield; // hologram.enable() 후 yield

        hologram.setVisibility(initialVisibility);

        onProgress?.({ progress: 1, message: 'Tactical grid ready' });
        yield; // 최종 yield
    }

    validate(_scene: BABYLON.Scene): boolean {
        // Phase 검증 원칙: BUILDING phase는 "생성되었는가"만 확인
        // 렌더링 가시성(active meshes)은 BARRIER phase에서 수행됨
        return this.config.hologram.isCreated();
    }
}
