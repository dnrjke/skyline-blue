/**
 * Executor Module - Time-Sliced LoadUnit Execution
 *
 * The Pure Generator Manifesto:
 * - 모든 LoadUnit은 AsyncGenerator로 전환
 * - 4ms Rule 강제 (performance.now() 기반)
 * - SceneLoader 블로킹 후 Recovery Frame 2+ 배치
 * - Max Main Thread Blocking > 50ms = 설계 실패
 */

// Core Interfaces
export {
    BaseSlicedLoadUnit,
    isSlicedLoadUnit,
} from './SlicedLoadUnit';
export type {
    SlicedLoadUnit,
    LoadUnitCost,
} from './SlicedLoadUnit';

// Execution Context
export {
    LoadExecutionContext,
    DEFAULT_FRAME_BUDGET_MS,
    AGGRESSIVE_FRAME_BUDGET_MS,
    DEFAULT_RECOVERY_FRAMES,
    createAggressiveContext,
} from './LoadExecutionContext';
export type { ExecutionContextStats } from './LoadExecutionContext';

// RAF Health Guard (Pacemaker)
export {
    RAFHealthGuard,
    RAFHealthStatus,
    getGlobalRAFHealthGuard,
    resetGlobalRAFHealthGuard,
} from './RAFHealthGuard';
export type { RAFHealthGuardConfig } from './RAFHealthGuard';

// Executor
export {
    LoadUnitExecutor,
    createLoadUnitExecutor,
} from './LoadUnitExecutor';
export type {
    ExecutionResult,
    ExecutorConfig,
} from './LoadUnitExecutor';
