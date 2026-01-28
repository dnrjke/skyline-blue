/**
 * Core Loading Module
 *
 * Babylon.js 8.x의 렌더링 특성을 반영한 로딩 프로토콜.
 * "엔진 기준 로딩"을 강제하여 false-ready 상태를 방지한다.
 *
 * [TacticalGrid Incident Prevention - Constitutional Amendment]
 *
 * Loading Phases (Final Form):
 *   PENDING → FETCHING → BUILDING → WARMING → BARRIER
 *          → VISUAL_READY → STABILIZING_100 → READY
 *
 * Key Rules:
 * - 100% does NOT mean "done". It means "safe to transition".
 * - BARRIER only confirms render loop, NOT visual readiness.
 * - VISUAL_READY verifies actual user-visible visuals.
 * - STABILIZING_100 holds at 100% for stability guarantee.
 *
 * @see docs/loading_protocol.md
 */

// ========================================
// LoadUnit Architecture (신규 권장)
// ========================================

// LoadUnit
export { LoadUnitStatus, BaseLoadUnit } from './unit/LoadUnit';
export type { LoadUnit, LoadUnitProgress, LoadUnitFactory } from './unit/LoadUnit';

// Registry
export { LoadingRegistry } from './unit/LoadingRegistry';
export type { RegistryCallbacks, RegistrySnapshot, AnyLoadUnit } from './unit/LoadingRegistry';

// Protocol
export { LoadingProtocol } from './unit/LoadingProtocol';
export type { ProtocolOptions, ProtocolResult } from './unit/LoadingProtocol';

// Standard Units
export { MaterialWarmupUnit } from './unit/MaterialWarmupUnit';
export type { MaterialWarmupConfig, MaterialFactory as UnitMaterialFactory } from './unit/MaterialWarmupUnit';

// Scene-wide Material Warmup (Active Engagement Strategy)
export { SceneMaterialWarmupUnit } from './unit/SceneMaterialWarmupUnit';
export type { SceneMaterialWarmupConfig } from './unit/SceneMaterialWarmupUnit';

// Barrier Unit
export { RenderReadyBarrierUnit } from './unit/RenderReadyBarrierUnit';
export type { BarrierUnitConfig } from './unit/RenderReadyBarrierUnit';

// Visual Ready Unit (TacticalGrid Incident Prevention)
export {
    VisualReadyUnit,
    createMeshVisualRequirement,
    createCustomVisualRequirement,
    createTacticalGridVisualRequirement,
} from './unit/VisualReadyUnit';
export type {
    VisualRequirement,
    VisualValidationResult,
    VisualReadyUnitConfig,
} from './unit/VisualReadyUnit';

// ========================================
// Protocol (공통)
// ========================================
export {
    LoadingPhase,
    PHASE_ORDER,
    isTerminalPhase,
    isLoadingPhase,
    isTransitionBlocked,
} from './protocol/LoadingPhase';
export type { LoadingResult, LoadingCallbacks, PhaseTimingRecord } from './protocol/LoadingResult';
export { createSuccessResult, createFailureResult } from './protocol/LoadingResult';

// ========================================
// Barrier (공통)
// ========================================
export { RenderReadyBarrier, BarrierResult } from './barrier/RenderReadyBarrier';
export type { BarrierValidation, BarrierEvidence, BarrierRequirement } from './barrier/RenderReadyBarrier';

// Engine Awakened Barrier (POST_READY verification)
export { EngineAwakenedBarrier, waitForEngineAwakened } from './barrier/EngineAwakenedBarrier';
export type { EngineAwakenedConfig, EngineAwakenedResult } from './barrier/EngineAwakenedBarrier';

// ========================================
// Legacy: BaseSceneLoader (호환성 유지)
// ========================================
export type { SceneLoaderProtocol, PhaseWork } from './protocol/SceneLoaderProtocol';
export { BaseSceneLoader } from './protocol/SceneLoaderProtocol';

// ========================================
// Progress Model (Arcana)
// ========================================
export {
    ArcanaProgressModel,
    PROGRESS_BOUNDS,
    COMPRESSION_SETTINGS,
    STABILIZATION_SETTINGS,
    // Constitutional Phase Transition Guards
    getMandatoryNextPhase,
    isPhaseTransitionAllowed,
} from './progress/ArcanaProgressModel';
export type {
    ProgressSnapshot,
    ProgressEvent,
    ProgressEventType,
    ProgressEventListener,
    UnitWeightConfig,
} from './progress/ArcanaProgressModel';

export {
    LoadingStateEmitter,
    getGlobalLoadingEmitter,
    disposeGlobalLoadingEmitter,
} from './progress/LoadingStateEmitter';
export type { LoadingState, LoadingEvents } from './progress/LoadingStateEmitter';

// ========================================
// Orchestrator (High-level)
// ========================================
export { ArcanaLoadingOrchestrator } from './orchestrator/ArcanaLoadingOrchestrator';
export type { OrchestratorConfig, OrchestratorCallbacks } from './orchestrator/ArcanaLoadingOrchestrator';

// ========================================
// Active Engagement Strategy (🅰️+)
// ========================================
export { RenderingIntentKeeper } from './engagement/RenderingIntentKeeper';
export type { RenderingIntentKeeperConfig, IntentMetrics } from './engagement/RenderingIntentKeeper';

// ========================================
// Pure Generator Manifesto (Time-Sliced Execution)
// ========================================

// SlicedLoadUnit Interface
export {
    BaseSlicedLoadUnit,
    isSlicedLoadUnit,
} from './executor/SlicedLoadUnit';
export type {
    SlicedLoadUnit,
    LoadUnitCost,
} from './executor/SlicedLoadUnit';

// Execution Context (4ms Rule)
export {
    LoadExecutionContext,
    DEFAULT_FRAME_BUDGET_MS,
    AGGRESSIVE_FRAME_BUDGET_MS,
    DEFAULT_RECOVERY_FRAMES,
    createAggressiveContext,
} from './executor/LoadExecutionContext';
export type { ExecutionContextStats } from './executor/LoadExecutionContext';

// RAF Health Guard (Pacemaker)
export {
    RAFHealthGuard,
    RAFHealthStatus,
    getGlobalRAFHealthGuard,
    resetGlobalRAFHealthGuard,
} from './executor/RAFHealthGuard';
export type { RAFHealthGuardConfig } from './executor/RAFHealthGuard';

// Load Unit Executor
export {
    LoadUnitExecutor,
    createLoadUnitExecutor,
} from './executor/LoadUnitExecutor';
export type {
    ExecutionResult,
    ExecutorConfig,
} from './executor/LoadUnitExecutor';

// Frame Budget Yield Utilities
export {
    nextFrame,
    yieldMicrotask,
    FrameBudget,
    processWithYield,
    batchWithYield,
    LoadUnitProfiler,
    LoadingProfileAggregator,
} from './FrameBudgetYield';
export type {
    LoadUnitProfileReport,
    LoadingProfileSummary,
} from './FrameBudgetYield';

// ========================================
// Legacy: MaterialWarmupHelper (호환성)
// ========================================
export { MaterialWarmupHelper } from './warmup/MaterialWarmupHelper';
export type { MaterialFactory, WarmupConfig } from './warmup/MaterialWarmupHelper';

// ========================================
// Asset Load Strategy (Phase 2.7 Option D Fallback)
// ========================================
export {
    StandardAssetLoadStrategy,
    getDefaultAssetLoadStrategy,
    LARGE_ASSET_THRESHOLD_BYTES,
    shouldUseLargeAssetStrategy,
} from './strategy/AssetLoadStrategy';
export type {
    AssetLoadStrategy,
    StreamingChunk,
} from './strategy/AssetLoadStrategy';
