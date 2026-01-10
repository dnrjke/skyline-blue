/**
 * Core Loading Module
 *
 * Babylon.js 8.x의 렌더링 특성을 반영한 로딩 프로토콜.
 * "엔진 기준 로딩"을 강제하여 false-ready 상태를 방지한다.
 *
 * @see docs/babylon_rendering_rules.md
 */

// Protocol
export { LoadingPhase, PHASE_ORDER, isTerminalPhase, isLoadingPhase } from './protocol/LoadingPhase';
export type { LoadingResult, LoadingCallbacks, PhaseTimingRecord } from './protocol/LoadingResult';
export { createSuccessResult, createFailureResult } from './protocol/LoadingResult';
export type { SceneLoaderProtocol, PhaseWork } from './protocol/SceneLoaderProtocol';
export { BaseSceneLoader } from './protocol/SceneLoaderProtocol';

// Barrier
export { RenderReadyBarrier, BarrierResult } from './barrier/RenderReadyBarrier';
export type { BarrierValidation } from './barrier/RenderReadyBarrier';

// Warmup
export { MaterialWarmupHelper } from './warmup/MaterialWarmupHelper';
export type { MaterialFactory, WarmupConfig } from './warmup/MaterialWarmupHelper';
