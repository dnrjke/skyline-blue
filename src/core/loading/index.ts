/**
 * Core Loading Module
 *
 * Babylon.js 8.x의 렌더링 특성을 반영한 로딩 프로토콜.
 * "엔진 기준 로딩"을 강제하여 false-ready 상태를 방지한다.
 *
 * ## 아키텍처
 *
 * ### 1. LoadUnit 기반 (권장)
 * ```typescript
 * const registry = new LoadingRegistry();
 * registry.registerAll([...units]);
 * const protocol = new LoadingProtocol(scene, registry);
 * await protocol.execute({ ... });
 * ```
 *
 * ### 2. Legacy: BaseSceneLoader 기반
 * 기존 코드와의 호환성을 위해 유지됨.
 *
 * @see docs/loading_protocol.md
 * @see docs/babylon_rendering_rules.md
 */

// ========================================
// LoadUnit Architecture (신규 권장)
// ========================================

// LoadUnit
export { LoadUnitStatus, BaseLoadUnit } from './unit/LoadUnit';
export type { LoadUnit, LoadUnitProgress, LoadUnitFactory } from './unit/LoadUnit';

// Registry
export { LoadingRegistry } from './unit/LoadingRegistry';
export type { RegistryCallbacks, RegistrySnapshot } from './unit/LoadingRegistry';

// Protocol
export { LoadingProtocol } from './unit/LoadingProtocol';
export type { ProtocolOptions, ProtocolResult } from './unit/LoadingProtocol';

// Standard Units
export { MaterialWarmupUnit } from './unit/MaterialWarmupUnit';
export type { MaterialWarmupConfig, MaterialFactory as UnitMaterialFactory } from './unit/MaterialWarmupUnit';

// ========================================
// Protocol (공통)
// ========================================
export { LoadingPhase, PHASE_ORDER, isTerminalPhase, isLoadingPhase } from './protocol/LoadingPhase';
export type { LoadingResult, LoadingCallbacks, PhaseTimingRecord } from './protocol/LoadingResult';
export { createSuccessResult, createFailureResult } from './protocol/LoadingResult';

// ========================================
// Barrier (공통)
// ========================================
export { RenderReadyBarrier, BarrierResult } from './barrier/RenderReadyBarrier';
export type { BarrierValidation } from './barrier/RenderReadyBarrier';

// ========================================
// Legacy: BaseSceneLoader (호환성 유지)
// ========================================
export type { SceneLoaderProtocol, PhaseWork } from './protocol/SceneLoaderProtocol';
export { BaseSceneLoader } from './protocol/SceneLoaderProtocol';

// Legacy: MaterialWarmupHelper
export { MaterialWarmupHelper } from './warmup/MaterialWarmupHelper';
export type { MaterialFactory, WarmupConfig } from './warmup/MaterialWarmupHelper';
