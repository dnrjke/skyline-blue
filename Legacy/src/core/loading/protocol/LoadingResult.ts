/**
 * LoadingResult - 로딩 완료 후 반환되는 결과 객체.
 *
 * 핵심 원칙:
 * - phase가 READY여도 즉시 게임 로직을 실행하면 안 됨
 * - onAfterReady는 Barrier 통과 후 다음 프레임에서 실행됨
 * - 이를 통해 "READY ≠ 즉시 실행" 문제를 예방
 */

import { LoadingPhase } from './LoadingPhase';

/**
 * 로딩 결과
 */
export interface LoadingResult {
    /** 최종 도달한 Phase */
    phase: LoadingPhase;

    /** 로딩 소요 시간 (ms) */
    elapsedMs: number;

    /** 실패 시 에러 정보 */
    error?: Error;

    /** Phase별 소요 시간 (디버깅용) */
    phaseTimings?: PhaseTimingRecord;
}

/**
 * Phase별 소요 시간 기록
 */
export type PhaseTimingRecord = Partial<Record<LoadingPhase, number>>;

/**
 * 로딩 진행 콜백
 */
export interface LoadingCallbacks {
    /** Phase 변경 시 호출 */
    onPhaseChange?: (phase: LoadingPhase) => void;

    /** 진행률 변경 시 호출 (0~1) */
    onProgress?: (progress: number) => void;

    /** 로그 메시지 발생 시 호출 */
    onLog?: (message: string) => void;

    /**
     * Barrier 통과 후 다음 프레임에서 실행되는 Hook.
     * 카메라 워킹 시작, 입력 활성화, UI Fade-in 등에 사용.
     *
     * 이 Hook은 LoadingResult.phase === READY 확인 후
     * Scene의 onAfterRenderObservable에서 1회 실행됨.
     */
    onAfterReady?: () => void;
}

/**
 * 로딩 결과 생성 헬퍼
 */
export function createSuccessResult(
    elapsedMs: number,
    phaseTimings?: PhaseTimingRecord
): LoadingResult {
    return {
        phase: LoadingPhase.READY,
        elapsedMs,
        phaseTimings,
    };
}

export function createFailureResult(
    error: Error,
    elapsedMs: number,
    phaseTimings?: PhaseTimingRecord
): LoadingResult {
    return {
        phase: LoadingPhase.FAILED,
        elapsedMs,
        error,
        phaseTimings,
    };
}
