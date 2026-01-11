/**
 * LoadingPhase - 로딩 상태를 명시적으로 모델링하는 Phase enum.
 *
 * Babylon.js 8.x의 렌더링 특성상:
 * - Asset load 완료 ≠ 렌더링 가능
 * - Material compile 완료 ≠ 렌더링 가능
 * - 오직 첫 프레임 렌더 검증 후에만 READY
 *
 * [TacticalGrid Incident Prevention - Constitutional Amendment]
 *
 * Phase 순서는 고정이며, 축소하면 안 된다:
 *
 *   PENDING → FETCHING → BUILDING → WARMING → BARRIER
 *          → VISUAL_READY → STABILIZING_100 → READY
 *
 * BARRIER: 렌더 루프 시작 확인 (NOT visual readiness)
 * VISUAL_READY: 모든 핵심 비주얼이 실제로 보이는지 검증
 * STABILIZING_100: 100%에서 시각적 안정성 확보 (pop-in 방지)
 *
 * 100% does not mean "done". It means "safe to transition".
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

    /**
     * 렌더 루프 시작 확인 (Render-Ready Barrier)
     *
     * [검증 항목]
     * - render loop started (onAfterRender fired)
     * - camera is valid
     * - scene.render() executes
     *
     * [검증 제외]
     * - activeMeshes count (NOT a visibility guarantee)
     * - actual visual readiness
     *
     * Progress: ~85-90%
     */
    BARRIER = 'BARRIER',

    /**
     * 핵심 비주얼 가시성 검증 (Visual Ready)
     *
     * [검증 항목]
     * - mesh.isEnabled()
     * - mesh.isVisible
     * - mesh.visibility > 0
     * - boundingInfo exists
     * - mesh is part of scene.meshes
     *
     * [검증 제외 - timing-based validation 금지]
     * - "rendered at least once"
     * - "after X ms"
     * - "activeMeshes length > 0"
     *
     * Progress: 90-100%
     */
    VISUAL_READY = 'VISUAL_READY',

    /**
     * 100% 안정화 구간 (Stabilization Hold)
     *
     * Progress는 100%로 고정되지만 씬 전환은 아직 차단됨.
     *
     * [목적]
     * - GPU/shader 파이프라인 안정화
     * - 첫 프레임 지터 제거
     * - pop-in 현상 방지
     *
     * [규칙]
     * - 최소: 300-500ms 또는 5-10 안정 프레임
     * - 최대: 1500ms fail-safe
     * - 안정화 중 required visuals가 유효해야 함
     */
    STABILIZING_100 = 'STABILIZING_100',

    /** 씬 전환 허용 - 완전 준비 완료 */
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
    LoadingPhase.VISUAL_READY,
    LoadingPhase.STABILIZING_100,
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

/**
 * Phase가 전환 차단 상태인지 확인
 * (STABILIZING_100도 전환 차단)
 */
export function isTransitionBlocked(phase: LoadingPhase): boolean {
    return phase !== LoadingPhase.READY && phase !== LoadingPhase.FAILED;
}
