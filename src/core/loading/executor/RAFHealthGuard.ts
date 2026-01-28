/**
 * RAFHealthGuard - 페이스메이커 (Pacemaker)
 *
 * Load 중 RAF 간격을 모니터링하고, 브라우저 스케줄링 강등을 감지/복구한다.
 *
 * 동작 원리:
 * 1. RAF 콜백에서 dt(프레임 간격)를 측정
 * 2. 단일 gap > 50ms 또는 평균 dt > 40ms 감지 시 → UNHEALTHY
 * 3. UNHEALTHY 시 LoadUnit 실행을 일시 중지 (pause)
 * 4. 브라우저가 정상 심박(dt < 20ms)을 찾을 때까지 대기
 * 5. 정상 복귀 시 LoadUnit 실행 재개 (resume)
 *
 * 목적:
 * - RAF_FREQUENCY_LOCK (9.6fps 고정) 재발 방지
 * - 브라우저에게 "나는 협조적이다" 시그널 유지
 * - 로딩 중에도 RAF cadence 유지
 */

import { LoadExecutionContext } from './LoadExecutionContext';
import { nextFrame } from '../FrameBudgetYield';

/**
 * 건강 상태
 */
export enum RAFHealthStatus {
    /** 정상: dt < 25ms (40+ fps) */
    HEALTHY = 'HEALTHY',
    /** 경고: 25ms <= dt < 50ms (20-40 fps) */
    WARNING = 'WARNING',
    /** 위험: dt >= 50ms (< 20 fps) - 일시 중지 트리거 */
    CRITICAL = 'CRITICAL',
    /** 회복 중: 정상 심박 대기 */
    RECOVERING = 'RECOVERING',
}

/**
 * 설정
 */
export interface RAFHealthGuardConfig {
    /** 단일 gap 임계치 (ms) - 초과 시 CRITICAL */
    criticalThresholdMs: number;
    /** 평균 dt 임계치 (ms) - 초과 시 WARNING */
    warningThresholdMs: number;
    /** 정상 판정 임계치 (ms) - 미만 시 HEALTHY */
    healthyThresholdMs: number;
    /** 평균 계산용 샘플 수 */
    sampleSize: number;
    /** 정상 복귀 판정용 연속 HEALTHY 프레임 수 */
    recoveryFrameCount: number;
    /** 디버그 로깅 */
    debug: boolean;
}

const DEFAULT_CONFIG: RAFHealthGuardConfig = {
    criticalThresholdMs: 50,    // > 50ms = CRITICAL
    warningThresholdMs: 40,     // > 40ms avg = WARNING
    healthyThresholdMs: 25,     // < 25ms = HEALTHY
    sampleSize: 5,              // 최근 5프레임 평균
    recoveryFrameCount: 3,      // 연속 3프레임 HEALTHY 시 복귀
    debug: true,                // 로딩 중이므로 로그 활성화
};

/**
 * RAFHealthGuard - 페이스메이커
 */
export class RAFHealthGuard {
    private config: RAFHealthGuardConfig;
    private status: RAFHealthStatus = RAFHealthStatus.HEALTHY;

    // 측정 데이터
    private lastFrameTime: number = 0;
    private dtSamples: number[] = [];
    private consecutiveHealthyFrames: number = 0;

    // 연결된 ExecutionContext
    private contexts: Set<LoadExecutionContext> = new Set();

    // RAF 핸들
    private rafHandle: number | null = null;
    private running: boolean = false;

    // 통계
    private criticalCount: number = 0;
    private warningCount: number = 0;
    private totalFrames: number = 0;

    constructor(config: Partial<RAFHealthGuardConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * ExecutionContext 연결
     *
     * 여러 LoadUnit이 동시에 실행될 수 있으므로 다중 컨텍스트 지원
     */
    public connect(ctx: LoadExecutionContext): void {
        this.contexts.add(ctx);
    }

    /**
     * ExecutionContext 연결 해제
     */
    public disconnect(ctx: LoadExecutionContext): void {
        this.contexts.delete(ctx);
    }

    /**
     * 모니터링 시작
     */
    public start(): void {
        if (this.running) return;

        this.running = true;
        this.lastFrameTime = performance.now();
        this.status = RAFHealthStatus.HEALTHY;
        this.dtSamples = [];
        this.consecutiveHealthyFrames = 0;

        if (this.config.debug) {
            console.log('[RAFHealthGuard] Started monitoring');
        }

        this.tick();
    }

    /**
     * 모니터링 중지
     */
    public stop(): void {
        this.running = false;
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }

        if (this.config.debug) {
            console.log('[RAFHealthGuard] Stopped monitoring');
            this.logStats();
        }
    }

    /**
     * 현재 상태
     */
    public getStatus(): RAFHealthStatus {
        return this.status;
    }

    /**
     * 건강한 상태인지 확인
     */
    public isHealthy(): boolean {
        return this.status === RAFHealthStatus.HEALTHY;
    }

    /**
     * 정상 심박 회복까지 대기
     *
     * CRITICAL 상태에서 호출 시 정상 복귀까지 블로킹
     */
    public async waitForRecovery(): Promise<void> {
        if (this.config.debug) {
            console.log('[RAFHealthGuard] Waiting for recovery...');
        }

        // 정상 복귀까지 루프 (status는 RAF tick에서 비동기적으로 변경됨)
        while (this.getStatus() !== RAFHealthStatus.HEALTHY && this.running) {
            await nextFrame();
        }

        if (this.config.debug) {
            console.log('[RAFHealthGuard] Recovery complete');
        }
    }

    // ========================================
    // Private
    // ========================================

    /**
     * RAF tick
     */
    private tick(): void {
        if (!this.running) return;

        this.rafHandle = requestAnimationFrame((now) => {
            this.measureAndEvaluate(now);
            this.tick();
        });
    }

    /**
     * 측정 및 평가
     */
    private measureAndEvaluate(now: number): void {
        const dt = now - this.lastFrameTime;
        this.lastFrameTime = now;
        this.totalFrames++;

        // 첫 프레임은 skip
        if (this.totalFrames === 1) return;

        // 샘플 기록
        this.dtSamples.push(dt);
        if (this.dtSamples.length > this.config.sampleSize) {
            this.dtSamples.shift();
        }

        // 평균 계산
        const avgDt = this.dtSamples.reduce((a, b) => a + b, 0) / this.dtSamples.length;

        // 상태 평가
        const prevStatus = this.status;

        if (dt >= this.config.criticalThresholdMs) {
            // 단일 gap이 임계치 초과 → CRITICAL
            this.status = RAFHealthStatus.CRITICAL;
            this.criticalCount++;
            this.consecutiveHealthyFrames = 0;

            if (this.config.debug) {
                console.warn(`[RAFHealthGuard] 🚨 CRITICAL: dt=${dt.toFixed(1)}ms (>${this.config.criticalThresholdMs}ms)`);
            }

            // 모든 연결된 컨텍스트 일시 중지
            this.pauseAllContexts(`RAF gap ${dt.toFixed(1)}ms exceeds ${this.config.criticalThresholdMs}ms`);

        } else if (avgDt >= this.config.warningThresholdMs) {
            // 평균이 경고 임계치 초과 → WARNING
            if (this.status !== RAFHealthStatus.CRITICAL) {
                this.status = RAFHealthStatus.WARNING;
                this.warningCount++;
            }
            this.consecutiveHealthyFrames = 0;

            if (this.config.debug && prevStatus !== RAFHealthStatus.WARNING) {
                console.warn(`[RAFHealthGuard] ⚠️ WARNING: avg dt=${avgDt.toFixed(1)}ms (>${this.config.warningThresholdMs}ms)`);
            }

        } else if (dt < this.config.healthyThresholdMs) {
            // 정상 범위
            this.consecutiveHealthyFrames++;

            if (this.status === RAFHealthStatus.CRITICAL || this.status === RAFHealthStatus.RECOVERING) {
                this.status = RAFHealthStatus.RECOVERING;

                if (this.consecutiveHealthyFrames >= this.config.recoveryFrameCount) {
                    // 연속 HEALTHY 프레임 달성 → 복귀
                    this.status = RAFHealthStatus.HEALTHY;

                    if (this.config.debug) {
                        console.log(`[RAFHealthGuard] ✅ RECOVERED: ${this.consecutiveHealthyFrames} consecutive healthy frames`);
                    }

                    // 모든 연결된 컨텍스트 재개
                    this.resumeAllContexts();
                }
            } else {
                this.status = RAFHealthStatus.HEALTHY;
            }
        }
    }

    /**
     * 모든 연결된 컨텍스트 일시 중지
     */
    private pauseAllContexts(reason: string): void {
        for (const ctx of this.contexts) {
            ctx.pause(reason);
        }
    }

    /**
     * 모든 연결된 컨텍스트 재개
     */
    private resumeAllContexts(): void {
        for (const ctx of this.contexts) {
            ctx.resume();
        }
    }

    /**
     * 통계 로그
     */
    public logStats(): void {
        const avgDt = this.dtSamples.length > 0
            ? this.dtSamples.reduce((a, b) => a + b, 0) / this.dtSamples.length
            : 0;

        console.log('[RAFHealthGuard] Stats:');
        console.log(`  - Total frames: ${this.totalFrames}`);
        console.log(`  - Critical events: ${this.criticalCount}`);
        console.log(`  - Warning events: ${this.warningCount}`);
        console.log(`  - Current avg dt: ${avgDt.toFixed(1)}ms`);
        console.log(`  - Current status: ${this.status}`);
    }

    /**
     * 리셋
     */
    public reset(): void {
        this.status = RAFHealthStatus.HEALTHY;
        this.dtSamples = [];
        this.consecutiveHealthyFrames = 0;
        this.criticalCount = 0;
        this.warningCount = 0;
        this.totalFrames = 0;
        this.contexts.clear();
    }
}

/**
 * 싱글턴 인스턴스 (전역 모니터링용)
 */
let globalGuard: RAFHealthGuard | null = null;

export function getGlobalRAFHealthGuard(): RAFHealthGuard {
    if (!globalGuard) {
        globalGuard = new RAFHealthGuard();
    }
    return globalGuard;
}

export function resetGlobalRAFHealthGuard(): void {
    if (globalGuard) {
        globalGuard.stop();
        globalGuard.reset();
    }
    globalGuard = null;
}
