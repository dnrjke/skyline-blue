/**
 * SlicedLoadUnit - Pure Generator 기반 LoadUnit 인터페이스
 *
 * The Pure Generator Manifesto:
 * - Hybrid는 없다. 모든 유닛은 예외 없이 AsyncGenerator로 전환한다.
 * - 단일 async 함수로 모든 작업을 끝내는 유닛은 금지된다.
 * - 모든 루프는 while(ctx.isHealthy()) 패턴으로 통일한다.
 *
 * 검증 지표:
 * - Max Main Thread Blocking > 50ms = 설계 실패
 * - 단일 프레임에서 16ms 이상 점유 불가
 */

import * as BABYLON from '@babylonjs/core';
import { LoadingPhase } from '../protocol/LoadingPhase';
import { LoadUnitStatus, LoadUnitProgress } from '../unit/LoadUnit';
import type { LoadExecutionContext } from './LoadExecutionContext';

/**
 * LoadUnit 비용 추정치
 * - LIGHT: < 10ms 예상 (간단한 설정, 작은 에셋)
 * - MEDIUM: 10-50ms 예상 (중간 크기 에셋, 단순 warmup)
 * - HEAVY: > 50ms 예상 (GLB 모델, 다수 material 컴파일)
 */
export type LoadUnitCost = 'LIGHT' | 'MEDIUM' | 'HEAVY';

/**
 * SlicedLoadUnit - Time-Sliced 로딩을 위한 인터페이스
 *
 * 모든 LoadUnit은 이 인터페이스를 구현해야 한다.
 * executeSteps()가 핵심이며, 각 yield point에서 Executor가 budget을 체크한다.
 */
export interface SlicedLoadUnit {
    /** 유닛 고유 ID */
    readonly id: string;

    /** 이 유닛이 속한 Phase */
    readonly phase: LoadingPhase;

    /** READY 판정에 필수인지 여부 */
    readonly requiredForReady: boolean;

    /** 비용 추정치 (선택적, 자동 감지 지원) */
    readonly estimateCost?: LoadUnitCost;

    /** 현재 상태 */
    status: LoadUnitStatus;

    /**
     * Time-Sliced 실행의 핵심 메서드.
     *
     * 규칙:
     * 1. 모든 반복문은 while(ctx.isHealthy()) 패턴 사용
     * 2. 각 논리적 작업 단위 후 yield
     * 3. SceneLoader 같은 블로킹 작업 후 ctx.requestRecoveryFrames() 호출
     *
     * @param scene Babylon.js Scene
     * @param ctx LoadExecutionContext (budget 관리)
     * @param onProgress 진행률 콜백
     */
    executeSteps(
        scene: BABYLON.Scene,
        ctx: LoadExecutionContext,
        onProgress?: (progress: LoadUnitProgress) => void
    ): AsyncGenerator<void, void, void>;

    /**
     * 첫 프레임 이후 검증 (선택적)
     */
    validate?(scene: BABYLON.Scene): boolean;

    /**
     * 리소스 정리
     */
    dispose?(): void;

    /** 로딩 소요 시간 (ms) */
    elapsedMs?: number;

    /** 실패 원인 */
    error?: Error;
}

/**
 * BaseSlicedLoadUnit - SlicedLoadUnit 구현을 위한 추상 기본 클래스
 */
export abstract class BaseSlicedLoadUnit implements SlicedLoadUnit {
    abstract readonly id: string;
    abstract readonly phase: LoadingPhase;
    abstract readonly requiredForReady: boolean;
    readonly estimateCost?: LoadUnitCost;

    status: LoadUnitStatus = LoadUnitStatus.PENDING;
    elapsedMs?: number;
    error?: Error;

    /**
     * 서브클래스에서 구현: 실제 로딩 작업 (Generator)
     */
    abstract executeSteps(
        scene: BABYLON.Scene,
        ctx: LoadExecutionContext,
        onProgress?: (progress: LoadUnitProgress) => void
    ): AsyncGenerator<void, void, void>;

    /**
     * 기본 validate 구현
     */
    validate(_scene: BABYLON.Scene): boolean {
        return this.status === LoadUnitStatus.LOADED || this.status === LoadUnitStatus.VALIDATED;
    }

    /**
     * 검증 완료 마킹
     */
    markValidated(): void {
        if (this.status === LoadUnitStatus.LOADED) {
            this.status = LoadUnitStatus.VALIDATED;
        }
    }

    /**
     * 기본 dispose 구현 (no-op)
     */
    dispose(): void {
        // 서브클래스에서 오버라이드
    }

    /**
     * 상태 리셋
     */
    reset(): void {
        this.status = LoadUnitStatus.PENDING;
        this.elapsedMs = undefined;
        this.error = undefined;
    }
}

/**
 * SlicedLoadUnit 타입 가드
 */
export function isSlicedLoadUnit(unit: unknown): unit is SlicedLoadUnit {
    return (
        typeof unit === 'object' &&
        unit !== null &&
        'executeSteps' in unit &&
        typeof (unit as SlicedLoadUnit).executeSteps === 'function'
    );
}
