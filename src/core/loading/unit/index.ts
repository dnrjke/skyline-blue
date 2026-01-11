/**
 * LoadUnit Module - 범용 로딩 시스템의 핵심 컴포넌트
 *
 * LoadUnit 기반 아키텍처:
 * - LoadUnit: 로딩의 최소 단위 (에셋이 아닌 논리적 단위)
 * - LoadingRegistry: Unit 등록 및 관리
 * - LoadingProtocol: Unit들을 Phase 순서대로 실행
 * - MaterialWarmupUnit: Material 사전 컴파일 표준 구현
 *
 * 사용 예:
 * ```typescript
 * const registry = new LoadingRegistry();
 * registry.registerAll([
 *   new TacticalGridUnit(),
 *   new GraphVisualizerUnit(graph),
 *   MaterialWarmupUnit.createNavigationWarmupUnit(),
 * ]);
 *
 * const protocol = new LoadingProtocol(scene, registry);
 * const result = await protocol.execute({ ... });
 * ```
 */

// LoadUnit
export { LoadUnitStatus, BaseLoadUnit } from './LoadUnit';
export type { LoadUnit, LoadUnitProgress, LoadUnitFactory } from './LoadUnit';

// Registry
export { LoadingRegistry } from './LoadingRegistry';
export type { RegistryCallbacks, RegistrySnapshot } from './LoadingRegistry';

// Protocol
export { LoadingProtocol } from './LoadingProtocol';
export type { ProtocolOptions, ProtocolResult } from './LoadingProtocol';

// Standard Units
export { MaterialWarmupUnit } from './MaterialWarmupUnit';
export type { MaterialWarmupConfig, MaterialFactory } from './MaterialWarmupUnit';

// Barrier Unit
export { RenderReadyBarrierUnit } from './RenderReadyBarrierUnit';
export type { BarrierUnitConfig } from './RenderReadyBarrierUnit';

// Re-export LoadingPhase from protocol module
export { LoadingPhase, PHASE_ORDER, isTerminalPhase, isLoadingPhase } from '../protocol/LoadingPhase';
