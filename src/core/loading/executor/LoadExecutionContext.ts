/**
 * LoadExecutionContext - 4ms Rule 기반 실행 컨텍스트
 *
 * The Pure Generator Manifesto의 핵심:
 * - 모든 루프 내부에는 performance.now() 기반 4ms 예산 체크
 * - while(ctx.isHealthy()) 패턴으로 모든 반복문 통일
 * - SceneLoader 블로킹 후 Recovery Frame 2개 이상 배치
 *
 * 사용 예시:
 * ```typescript
 * async *executeSteps(scene, ctx) {
 *     // 블로킹 작업
 *     await BABYLON.SceneLoader.ImportMeshAsync(...);
 *     yield; // yield point
 *     await ctx.requestRecoveryFrames(2); // Recovery Frame
 *
 *     // 반복 작업
 *     let i = 0;
 *     while (i < items.length && ctx.isHealthy()) {
 *         processItem(items[i]);
 *         i++;
 *         yield; // 각 아이템 후 yield
 *     }
 *     // budget 초과 시 여기서 자동 중단, 다음 프레임에 재개
 * }
 * ```
 */

import { nextFrame } from '../FrameBudgetYield';

/**
 * 기본 프레임 예산 (ms)
 * 4ms는 16ms 프레임 중 ~25%를 로딩에 할당
 */
export const DEFAULT_FRAME_BUDGET_MS = 4;

/**
 * HEAVY 유닛용 공격적 예산 (ms)
 * 더 자주 yield하여 브라우저 스케줄러 안정화
 */
export const AGGRESSIVE_FRAME_BUDGET_MS = 2;

/**
 * Recovery Frame 기본 개수
 * SceneLoader 같은 순수 블로킹 후 브라우저 안정화용
 */
export const DEFAULT_RECOVERY_FRAMES = 2;

/**
 * 실행 컨텍스트 통계
 */
export interface ExecutionContextStats {
    /** 총 yield 횟수 */
    yieldCount: number;
    /** 총 작업 시간 (ms) */
    totalWorkTime: number;
    /** Recovery Frame 횟수 */
    recoveryFrameCount: number;
    /** budget 초과로 인한 강제 yield 횟수 */
    forcedYieldCount: number;
    /** 최대 단일 구간 blocking 시간 (ms) */
    maxBlockingTime: number;
}

/**
 * LoadExecutionContext - Time-Sliced 실행을 위한 컨텍스트
 *
 * LoadUnitExecutor가 생성하여 각 LoadUnit에 전달한다.
 * LoadUnit은 이 컨텍스트를 통해 budget 상태를 확인하고,
 * Recovery Frame을 요청한다.
 */
export class LoadExecutionContext {
    private frameStartTime: number = 0;
    private readonly budgetMs: number;

    // 통계
    private yieldCount: number = 0;
    private totalWorkTime: number = 0;
    private recoveryFrameCount: number = 0;
    private forcedYieldCount: number = 0;
    private maxBlockingTime: number = 0;

    // 상태
    private paused: boolean = false;
    private pauseReason: string | null = null;

    constructor(budgetMs: number = DEFAULT_FRAME_BUDGET_MS) {
        this.budgetMs = budgetMs;
    }

    /**
     * 새 프레임 시작 시 호출 (Executor가 호출)
     */
    public startFrame(): void {
        this.frameStartTime = performance.now();
    }

    /**
     * 현재 프레임 내 경과 시간 (ms)
     */
    public getElapsed(): number {
        return performance.now() - this.frameStartTime;
    }

    /**
     * budget 초과 여부
     */
    public isOverBudget(): boolean {
        return this.getElapsed() >= this.budgetMs;
    }

    /**
     * 건강한 상태인지 확인 (The 4ms Rule)
     *
     * while(ctx.isHealthy()) 패턴의 핵심.
     * - budget 초과 시 false
     * - paused 상태 시 false
     *
     * false 반환 시 루프 탈출 → yield → Executor가 다음 프레임 대기
     */
    public isHealthy(): boolean {
        if (this.paused) {
            return false;
        }
        return !this.isOverBudget();
    }

    /**
     * yield 후 호출 (Executor가 호출)
     *
     * 통계 기록 및 다음 프레임 준비
     */
    public recordYield(forced: boolean = false): void {
        const elapsed = this.getElapsed();

        // 최대 blocking 시간 기록
        if (elapsed > this.maxBlockingTime) {
            this.maxBlockingTime = elapsed;
        }

        this.totalWorkTime += elapsed;
        this.yieldCount++;

        if (forced) {
            this.forcedYieldCount++;
        }
    }

    /**
     * Recovery Frame 요청
     *
     * SceneLoader.ImportMeshAsync 같은 "바빌론 순수 블로킹" 직후 호출.
     * 브라우저의 가변 주사율 스케줄러를 안심시킨다.
     *
     * @param count Recovery Frame 개수 (기본 2)
     */
    public async requestRecoveryFrames(count: number = DEFAULT_RECOVERY_FRAMES): Promise<void> {
        console.log(`[LoadExecutionContext] Requesting ${count} recovery frames...`);

        for (let i = 0; i < count; i++) {
            await nextFrame();
            this.recoveryFrameCount++;
        }

        // Recovery 후 새 프레임 시작
        this.startFrame();
        console.log(`[LoadExecutionContext] Recovery frames complete`);
    }

    /**
     * 일시 중지 (RAFHealthGuard가 호출)
     */
    public pause(reason: string): void {
        this.paused = true;
        this.pauseReason = reason;
        console.warn(`[LoadExecutionContext] PAUSED: ${reason}`);
    }

    /**
     * 재개 (RAFHealthGuard가 호출)
     */
    public resume(): void {
        if (this.paused) {
            console.log(`[LoadExecutionContext] RESUMED (was: ${this.pauseReason})`);
            this.paused = false;
            this.pauseReason = null;
            this.startFrame();
        }
    }

    /**
     * 일시 중지 상태 확인
     */
    public isPaused(): boolean {
        return this.paused;
    }

    /**
     * 통계 반환
     */
    public getStats(): ExecutionContextStats {
        return {
            yieldCount: this.yieldCount,
            totalWorkTime: this.totalWorkTime,
            recoveryFrameCount: this.recoveryFrameCount,
            forcedYieldCount: this.forcedYieldCount,
            maxBlockingTime: this.maxBlockingTime,
        };
    }

    /**
     * 통계 로그 출력
     */
    public logStats(unitId: string): void {
        const stats = this.getStats();
        const blockingFlag = stats.maxBlockingTime > 50 ? ' ⚠️ DESIGN FAILURE' : '';

        console.log(`[LoadExecutionContext] ${unitId} stats:`);
        console.log(`  - Yield count: ${stats.yieldCount}`);
        console.log(`  - Total work time: ${stats.totalWorkTime.toFixed(1)}ms`);
        console.log(`  - Recovery frames: ${stats.recoveryFrameCount}`);
        console.log(`  - Forced yields: ${stats.forcedYieldCount}`);
        console.log(`  - Max blocking: ${stats.maxBlockingTime.toFixed(1)}ms${blockingFlag}`);
    }

    /**
     * 리셋
     */
    public reset(): void {
        this.frameStartTime = 0;
        this.yieldCount = 0;
        this.totalWorkTime = 0;
        this.recoveryFrameCount = 0;
        this.forcedYieldCount = 0;
        this.maxBlockingTime = 0;
        this.paused = false;
        this.pauseReason = null;
    }
}

/**
 * 공격적 yielding용 컨텍스트 생성
 * HEAVY LoadUnit에 사용
 */
export function createAggressiveContext(): LoadExecutionContext {
    return new LoadExecutionContext(AGGRESSIVE_FRAME_BUDGET_MS);
}
