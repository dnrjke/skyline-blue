/**
 * LoadingPhase - 로딩 상태를 명시적으로 모델링하는 Phase enum.
 *
 * Babylon.js 8.x의 렌더링 특성상:
 * - Asset load 완료 ≠ 렌더링 가능
 * - Material compile 완료 ≠ 렌더링 가능
 * - 오직 첫 프레임 렌더 검증 후에만 READY
 *
 * Phase 순서는 고정이며, 축소하면 안 된다.
 */
export enum LoadingPhase {
    /** 로딩 시작 전 */
    PENDING = 'PENDING',

    /** Asset fetch 중 (JSON, GLB, Texture 다운로드) */
    FETCHING = 'FETCHING',

    /** Mesh/Graph/Scene 구조 구축 중 */
    BUILDING = 'BUILDING',

    /** Material forceCompilation + UtilityLayer warmup */
    WARMING = 'WARMING',

    /** 첫 프레임 렌더 대기 (Render-Ready Barrier) */
    BARRIER = 'BARRIER',

    /** 렌더링 가능 확인 완료 */
    READY = 'READY',

    /** 로딩 실패 (복구 불가) */
    FAILED = 'FAILED',
}

/**
 * Phase 진행 순서 (정상 흐름)
 */
export const PHASE_ORDER: readonly LoadingPhase[] = [
    LoadingPhase.PENDING,
    LoadingPhase.FETCHING,
    LoadingPhase.BUILDING,
    LoadingPhase.WARMING,
    LoadingPhase.BARRIER,
    LoadingPhase.READY,
] as const;

/**
 * Phase가 완료 상태인지 확인
 */
export function isTerminalPhase(phase: LoadingPhase): boolean {
    return phase === LoadingPhase.READY || phase === LoadingPhase.FAILED;
}

/**
 * Phase가 진행 중 상태인지 확인
 */
export function isLoadingPhase(phase: LoadingPhase): boolean {
    return !isTerminalPhase(phase) && phase !== LoadingPhase.PENDING;
}
