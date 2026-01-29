/**
 * LoadUnitExecutor - Time-Sliced 자동 분산 실행기
 *
 * The Pure Generator Manifesto의 핵심 실행 엔진:
 * - 모든 LoadUnit은 직접 실행되지 않는다
 * - 반드시 이 Executor를 통해서만 실행된다
 * - 단일 실행 구간이 4ms를 초과하면 자동 yield
 * - LoadUnit 작성자는 yield를 직접 호출할 수 없다 (시스템이 강제)
 *
 * 실행 흐름:
 * 1. Executor.run(unit) 호출
 * 2. RAFHealthGuard 연결
 * 3. unit.executeSteps() Generator 시작
 * 4. 각 yield point에서 budget 체크
 * 5. budget 초과 또는 CRITICAL 상태 시 nextFrame() 대기
 * 6. 완료 시 통계 기록
 */

import * as BABYLON from '@babylonjs/core';
import type { SlicedLoadUnit } from './SlicedLoadUnit';
import {
    LoadExecutionContext,
    DEFAULT_FRAME_BUDGET_MS,
} from './LoadExecutionContext';
import { RAFHealthGuard, getGlobalRAFHealthGuard, RAFHealthStatus } from './RAFHealthGuard';
import { LoadUnitStatus, LoadUnitProgress } from '../unit/LoadUnit';
import { nextFrame } from '../FrameBudgetYield';

/**
 * 실행 결과
 */
export interface ExecutionResult {
    /** 성공 여부 */
    success: boolean;
    /** 총 소요 시간 (ms) */
    totalTime: number;
    /** yield 횟수 */
    yieldCount: number;
    /** 최대 blocking 시간 (ms) */
    maxBlockingTime: number;
    /** Recovery Frame 횟수 */
    recoveryFrameCount: number;
    /** 설계 실패 여부 (maxBlockingTime > 50ms) */
    designFailure: boolean;
    /** 오류 (실패 시) */
    error?: Error;
}

/**
 * Executor 설정
 */
export interface ExecutorConfig {
    /** 기본 프레임 예산 (ms) */
    defaultBudgetMs: number;
    /** HEAVY 유닛용 공격적 예산 (ms) */
    aggressiveBudgetMs: number;
    /** 자동 HEAVY 감지 임계치 (이전 실행 기록 기준, ms) */
    autoHeavyThresholdMs: number;
    /** 설계 실패 임계치 (ms) */
    designFailureThresholdMs: number;
    /** RAFHealthGuard 사용 여부 */
    useHealthGuard: boolean;
    /** 디버그 로깅 */
    debug: boolean;
}

const DEFAULT_CONFIG: ExecutorConfig = {
    defaultBudgetMs: DEFAULT_FRAME_BUDGET_MS,
    aggressiveBudgetMs: 2,
    autoHeavyThresholdMs: 16,
    designFailureThresholdMs: 50,
    useHealthGuard: true,
    debug: true,
};

/**
 * 이전 실행 기록 (HEAVY 자동 감지용)
 */
const executionHistory: Map<string, number> = new Map();

/**
 * LoadUnitExecutor - Time-Sliced 자동 분산 실행기
 */
export class LoadUnitExecutor {
    private config: ExecutorConfig;
    private healthGuard: RAFHealthGuard;

    constructor(config: Partial<ExecutorConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.healthGuard = getGlobalRAFHealthGuard();
    }

    /**
     * SlicedLoadUnit 실행
     *
     * @param unit 실행할 LoadUnit
     * @param scene Babylon.js Scene
     * @param onProgress 진행률 콜백
     */
    public async run(
        unit: SlicedLoadUnit,
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<ExecutionResult> {
        const startTime = performance.now();

        // 이미 로딩 중이면 skip
        if (unit.status !== LoadUnitStatus.PENDING) {
            console.warn(`[LoadUnitExecutor] ${unit.id} already loaded/loading, skipping`);
            return this.createSkippedResult();
        }

        // HEAVY 여부 판단
        const isHeavy = this.isHeavyUnit(unit);
        const budgetMs = isHeavy ? this.config.aggressiveBudgetMs : this.config.defaultBudgetMs;

        if (this.config.debug) {
            const costLabel = isHeavy ? '🔴 HEAVY' : '🟢 NORMAL';
            console.log(`[LoadUnitExecutor] Starting ${unit.id} (${costLabel}, budget=${budgetMs}ms)`);
        }

        // ExecutionContext 생성
        const ctx = new LoadExecutionContext(budgetMs);

        // RAFHealthGuard 연결
        if (this.config.useHealthGuard) {
            this.healthGuard.connect(ctx);
        }

        // 상태 업데이트
        unit.status = LoadUnitStatus.LOADING;

        try {
            // Generator 실행
            await this.executeGenerator(unit, scene, ctx, onProgress);

            // 성공
            unit.status = LoadUnitStatus.LOADED;
            const result = this.createResult(ctx, startTime, true);

            // 이전 실행 기록 저장 (HEAVY 자동 감지용)
            executionHistory.set(unit.id, result.totalTime);

            if (this.config.debug) {
                ctx.logStats(unit.id);

                if (result.designFailure) {
                    console.error(`[LoadUnitExecutor] ❌ DESIGN FAILURE: ${unit.id} blocked for ${result.maxBlockingTime.toFixed(1)}ms`);
                }
            }

            unit.elapsedMs = result.totalTime;
            return result;

        } catch (err) {
            // 실패
            unit.status = LoadUnitStatus.FAILED;
            unit.error = err instanceof Error ? err : new Error(String(err));
            console.error(`[LoadUnitExecutor] ${unit.id} failed:`, unit.error);

            return this.createResult(ctx, startTime, false, unit.error);

        } finally {
            // RAFHealthGuard 연결 해제
            if (this.config.useHealthGuard) {
                this.healthGuard.disconnect(ctx);
            }
        }
    }

    /**
     * 여러 LoadUnit 순차 실행
     */
    public async runSequential(
        units: SlicedLoadUnit[],
        scene: BABYLON.Scene,
        onUnitStart?: (unit: SlicedLoadUnit) => void,
        onUnitEnd?: (unit: SlicedLoadUnit, result: ExecutionResult) => void
    ): Promise<ExecutionResult[]> {
        const results: ExecutionResult[] = [];

        for (const unit of units) {
            onUnitStart?.(unit);
            const result = await this.run(unit, scene);
            results.push(result);
            onUnitEnd?.(unit, result);

            // 필수 유닛 실패 시 중단
            if (!result.success && unit.requiredForReady) {
                console.error(`[LoadUnitExecutor] Required unit ${unit.id} failed, aborting`);
                break;
            }
        }

        return results;
    }

    // ========================================
    // Private
    // ========================================

    /**
     * Generator 실행 (핵심 로직)
     */
    private async executeGenerator(
        unit: SlicedLoadUnit,
        scene: BABYLON.Scene,
        ctx: LoadExecutionContext,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        ctx.startFrame();

        const generator = unit.executeSteps(scene, ctx, onProgress);

        for await (const _ of generator) {
            // yield point 도달

            // 1. RAFHealthGuard 상태 체크
            if (this.config.useHealthGuard && this.healthGuard.getStatus() === RAFHealthStatus.CRITICAL) {
                // CRITICAL: 정상 복귀까지 대기
                if (this.config.debug) {
                    console.warn(`[LoadUnitExecutor] ${unit.id} paused - waiting for RAF recovery`);
                }
                await this.healthGuard.waitForRecovery();
                ctx.startFrame(); // 새 프레임 시작
            }

            // 2. Budget 체크
            if (ctx.isOverBudget()) {
                // budget 초과: 강제 yield
                ctx.recordYield(true);
                await nextFrame();
                ctx.startFrame();
            } else {
                // budget 내: 기록만
                ctx.recordYield(false);
            }

            // 3. Pause 상태 체크 (RAFHealthGuard가 pause 호출했을 수 있음)
            while (ctx.isPaused()) {
                await nextFrame();
            }
        }

        // 최종 yield 기록
        ctx.recordYield(false);
    }

    /**
     * HEAVY 유닛 여부 판단
     */
    private isHeavyUnit(unit: SlicedLoadUnit): boolean {
        // 1. 명시적 선언
        if (unit.estimateCost === 'HEAVY') {
            return true;
        }

        // 2. 이전 실행 기록
        const prevTime = executionHistory.get(unit.id);
        if (prevTime !== undefined && prevTime > this.config.autoHeavyThresholdMs) {
            return true;
        }

        return false;
    }

    /**
     * 실행 결과 생성
     */
    private createResult(
        ctx: LoadExecutionContext,
        startTime: number,
        success: boolean,
        error?: Error
    ): ExecutionResult {
        const stats = ctx.getStats();
        const totalTime = performance.now() - startTime;

        return {
            success,
            totalTime,
            yieldCount: stats.yieldCount,
            maxBlockingTime: stats.maxBlockingTime,
            recoveryFrameCount: stats.recoveryFrameCount,
            designFailure: stats.maxBlockingTime > this.config.designFailureThresholdMs,
            error,
        };
    }

    /**
     * Skip 결과 생성
     */
    private createSkippedResult(): ExecutionResult {
        return {
            success: true,
            totalTime: 0,
            yieldCount: 0,
            maxBlockingTime: 0,
            recoveryFrameCount: 0,
            designFailure: false,
        };
    }

    /**
     * RAFHealthGuard 시작 (로딩 시작 전 호출)
     */
    public startHealthGuard(): void {
        if (this.config.useHealthGuard) {
            this.healthGuard.start();
        }
    }

    /**
     * RAFHealthGuard 중지 (로딩 완료 후 호출)
     */
    public stopHealthGuard(): void {
        if (this.config.useHealthGuard) {
            this.healthGuard.stop();
        }
    }

    /**
     * 실행 기록 초기화
     */
    public static clearHistory(): void {
        executionHistory.clear();
    }
}

/**
 * 기본 Executor 인스턴스 생성
 */
export function createLoadUnitExecutor(config?: Partial<ExecutorConfig>): LoadUnitExecutor {
    return new LoadUnitExecutor(config);
}
