/**
 * RAFHealthGuard - 페이스메이커 (Pacemaker) + ThrottleLockDetector
 *
 * Phase 2.7: RAF Protection Enhancement
 *
 * 핵심 역할:
 * 1. RAF 간격 모니터링 및 상태 판정
 * 2. **ThrottleLockDetector**: Chromium RAF 고정 패턴 감지 (95-115ms, 저분산)
 * 3. ENGINE_AWAKENED 후 500ms 이내 악화 시 자동 대응
 *
 * 동작 원리:
 * 1. RAF 콜백에서 dt(프레임 간격)를 측정
 * 2. 단일 gap > 50ms → CRITICAL
 * 3. 패턴 분석: 최근 N 프레임이 95-115ms 범위 + 표준편차 < 10ms → LOCKED
 * 4. LOCKED 상태 = 브라우저가 RAF를 ~9.6fps로 고정함 = 최악의 상황
 * 5. LOCKED 감지 시 모든 로딩 중단, 자연 회복 대기
 *
 * 목적:
 * - RAF_FREQUENCY_LOCK (9.6fps 고정) 재발 방지
 * - 브라우저에게 "나는 협조적이다" 시그널 유지
 * - 로딩 중에도 RAF cadence 유지
 * - **패턴 기반 조기 감지로 블랙홀 진입 전 차단**
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
    /** 저하됨 (WARNING의 별칭): 25ms <= dt < 50ms - EngineAwakenedBarrier 호환용 */
    DEGRADED = 'DEGRADED',
    /** 위험: dt >= 50ms (< 20 fps) - 일시 중지 트리거 */
    CRITICAL = 'CRITICAL',
    /** 회복 중: 정상 심박 대기 */
    RECOVERING = 'RECOVERING',
    /** 🚨 고정됨: 브라우저가 RAF를 ~104ms로 고정 (9.6fps) */
    LOCKED = 'LOCKED',
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

    // ========================================
    // Phase 2.7: ThrottleLockDetector 설정
    // ========================================

    /** LOCKED 패턴 감지용 샘플 수 (더 많은 샘플로 패턴 확인) */
    lockDetectionSampleSize: number;
    /** LOCKED 패턴 하한 (ms) - 95ms 이상 */
    lockPatternMinMs: number;
    /** LOCKED 패턴 상한 (ms) - 115ms 이하 */
    lockPatternMaxMs: number;
    /** LOCKED 판정용 최대 표준편차 (ms) - 패턴이 균일해야 함 */
    lockPatternMaxStdDev: number;
    /** LOCKED 패턴 필요 비율 (0-1) - 샘플 중 몇 %가 범위 내여야 하는지 */
    lockPatternRatio: number;

    /** ENGINE_AWAKENED 후 모니터링 기간 (ms) */
    postAwakeningMonitorMs: number;
}

const DEFAULT_CONFIG: RAFHealthGuardConfig = {
    criticalThresholdMs: 50,    // > 50ms = CRITICAL
    warningThresholdMs: 40,     // > 40ms avg = WARNING
    healthyThresholdMs: 25,     // < 25ms = HEALTHY
    sampleSize: 5,              // 최근 5프레임 평균
    recoveryFrameCount: 3,      // 연속 3프레임 HEALTHY 시 복귀
    debug: true,                // 로딩 중이므로 로그 활성화

    // ThrottleLockDetector 설정
    lockDetectionSampleSize: 8,  // 최근 8프레임으로 패턴 분석
    lockPatternMinMs: 95,        // 95ms 이상
    lockPatternMaxMs: 115,       // 115ms 이하 (Chromium 104ms 고정 패턴)
    lockPatternMaxStdDev: 10,    // 표준편차 10ms 이하 = 균일한 패턴
    lockPatternRatio: 0.75,      // 8프레임 중 6프레임(75%)이 범위 내

    postAwakeningMonitorMs: 500, // ENGINE_AWAKENED 후 500ms 모니터링
};

/**
 * 이벤트 콜백
 */
export interface RAFHealthGuardCallbacks {
    /** LOCKED 상태 진입 시 호출 */
    onLocked?: (avgDt: number, stdDev: number) => void;
    /** LOCKED에서 복구 시 호출 */
    onUnlocked?: () => void;
    /** ENGINE_AWAKENED 후 악화 감지 시 호출 */
    onPostAwakeningDegradation?: (status: RAFHealthStatus) => void;
}

/**
 * RAFHealthGuard - 페이스메이커 + ThrottleLockDetector
 */
export class RAFHealthGuard {
    private config: RAFHealthGuardConfig;
    private status: RAFHealthStatus = RAFHealthStatus.HEALTHY;

    // 측정 데이터
    private lastFrameTime: number = 0;
    private dtSamples: number[] = [];
    private consecutiveHealthyFrames: number = 0;

    // Phase 2.7: LOCKED 패턴 감지용 확장 샘플
    private lockDetectionSamples: number[] = [];
    private wasLocked: boolean = false;

    // Phase 2.7: ENGINE_AWAKENED 후 모니터링
    private awakeningTimestamp: number | null = null;
    private postAwakeningDegradationDetected: boolean = false;

    // 연결된 ExecutionContext
    private contexts: Set<LoadExecutionContext> = new Set();

    // 콜백
    private callbacks: RAFHealthGuardCallbacks = {};

    // RAF 핸들
    private rafHandle: number | null = null;
    private running: boolean = false;

    // 통계
    private criticalCount: number = 0;
    private warningCount: number = 0;
    private lockedCount: number = 0;
    private totalFrames: number = 0;

    constructor(config: Partial<RAFHealthGuardConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 콜백 설정
     */
    public setCallbacks(callbacks: RAFHealthGuardCallbacks): void {
        this.callbacks = callbacks;
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
        this.lockDetectionSamples = [];
        this.consecutiveHealthyFrames = 0;
        this.wasLocked = false;
        this.awakeningTimestamp = null;
        this.postAwakeningDegradationDetected = false;

        if (this.config.debug) {
            console.log('[RAFHealthGuard] Started monitoring');
        }

        this.tick();
    }

    /**
     * ENGINE_AWAKENED 완료 알림
     *
     * 이 메서드 호출 후 postAwakeningMonitorMs 동안 RAF 악화를 감시한다.
     * 악화 감지 시 onPostAwakeningDegradation 콜백 호출.
     */
    public notifyEngineAwakened(): void {
        this.awakeningTimestamp = performance.now();
        this.postAwakeningDegradationDetected = false;

        if (this.config.debug) {
            console.log('[RAFHealthGuard] ENGINE_AWAKENED notified, monitoring for 500ms...');
        }
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

        // 샘플 기록 (평균용)
        this.dtSamples.push(dt);
        if (this.dtSamples.length > this.config.sampleSize) {
            this.dtSamples.shift();
        }

        // Phase 2.7: LOCKED 패턴 감지용 확장 샘플
        this.lockDetectionSamples.push(dt);
        if (this.lockDetectionSamples.length > this.config.lockDetectionSampleSize) {
            this.lockDetectionSamples.shift();
        }

        // 평균 계산
        const avgDt = this.dtSamples.reduce((a, b) => a + b, 0) / this.dtSamples.length;

        // 상태 평가
        const prevStatus = this.status;

        // ========================================
        // Phase 2.7: LOCKED 패턴 감지 (최우선 체크)
        // ========================================
        const lockResult = this.detectLockPattern();
        if (lockResult.isLocked) {
            if (this.status !== RAFHealthStatus.LOCKED) {
                this.status = RAFHealthStatus.LOCKED;
                this.lockedCount++;
                this.consecutiveHealthyFrames = 0;
                this.wasLocked = true;

                console.error(
                    `[RAFHealthGuard] 🕳️ LOCKED DETECTED! ` +
                    `avgDt=${lockResult.avgDt.toFixed(1)}ms, stdDev=${lockResult.stdDev.toFixed(1)}ms`
                );
                console.error(
                    `[RAFHealthGuard] Pattern: ${this.lockDetectionSamples.map(d => d.toFixed(0)).join(', ')}ms`
                );

                // 모든 로딩 완전 중단
                this.pauseAllContexts(
                    `RAF LOCKED at ~${lockResult.avgDt.toFixed(0)}ms (stdDev=${lockResult.stdDev.toFixed(1)}ms)`
                );

                // 콜백 호출
                this.callbacks.onLocked?.(lockResult.avgDt, lockResult.stdDev);
            }

            // Phase 2.7: Post-awakening 체크
            this.checkPostAwakeningDegradation(now, RAFHealthStatus.LOCKED);
            return; // LOCKED 상태에서는 다른 평가 불필요
        }

        // ========================================
        // LOCKED 상태에서 벗어났는지 체크
        // ========================================
        if (this.status === RAFHealthStatus.LOCKED) {
            // LOCKED 상태에서 정상 프레임 감지
            if (dt < this.config.healthyThresholdMs) {
                this.consecutiveHealthyFrames++;

                if (this.consecutiveHealthyFrames >= this.config.recoveryFrameCount * 2) {
                    // LOCKED에서 복구: 더 많은 연속 프레임 필요 (6프레임)
                    this.status = RAFHealthStatus.HEALTHY;

                    if (this.config.debug) {
                        console.log(`[RAFHealthGuard] 🔓 UNLOCKED: ${this.consecutiveHealthyFrames} consecutive healthy frames`);
                    }

                    this.resumeAllContexts();
                    this.callbacks.onUnlocked?.();
                }
            } else {
                this.consecutiveHealthyFrames = 0;
            }
            return;
        }

        // ========================================
        // 기존 상태 평가 로직
        // ========================================
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

            // Phase 2.7: Post-awakening 체크
            this.checkPostAwakeningDegradation(now, RAFHealthStatus.CRITICAL);

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

            // Phase 2.7: Post-awakening 체크
            this.checkPostAwakeningDegradation(now, RAFHealthStatus.WARNING);

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
     * Phase 2.7: LOCKED 패턴 감지 (ThrottleLockDetector)
     *
     * Chromium은 RAF를 ~104ms (9.6fps)로 고정하는 경우가 있다.
     * 이 패턴의 특징:
     * - 모든 프레임이 95-115ms 범위
     * - 표준편차가 매우 낮음 (균일한 패턴)
     */
    private detectLockPattern(): { isLocked: boolean; avgDt: number; stdDev: number } {
        const samples = this.lockDetectionSamples;

        // 샘플이 충분하지 않으면 감지 불가
        if (samples.length < this.config.lockDetectionSampleSize) {
            return { isLocked: false, avgDt: 0, stdDev: 0 };
        }

        // 범위 내 샘플 비율 계산
        const inRangeCount = samples.filter(
            dt => dt >= this.config.lockPatternMinMs && dt <= this.config.lockPatternMaxMs
        ).length;
        const inRangeRatio = inRangeCount / samples.length;

        // 비율이 낮으면 LOCKED 아님
        if (inRangeRatio < this.config.lockPatternRatio) {
            return { isLocked: false, avgDt: 0, stdDev: 0 };
        }

        // 평균 계산
        const avgDt = samples.reduce((a, b) => a + b, 0) / samples.length;

        // 표준편차 계산
        const squaredDiffs = samples.map(dt => Math.pow(dt - avgDt, 2));
        const variance = squaredDiffs.reduce((a, b) => a + b, 0) / samples.length;
        const stdDev = Math.sqrt(variance);

        // 표준편차가 낮으면 LOCKED (균일한 고정 패턴)
        const isLocked = stdDev <= this.config.lockPatternMaxStdDev;

        return { isLocked, avgDt, stdDev };
    }

    /**
     * Phase 2.7: ENGINE_AWAKENED 후 악화 감지
     */
    private checkPostAwakeningDegradation(now: number, status: RAFHealthStatus): void {
        if (this.awakeningTimestamp === null) return;
        if (this.postAwakeningDegradationDetected) return;

        const elapsed = now - this.awakeningTimestamp;

        // 모니터링 기간 종료
        if (elapsed > this.config.postAwakeningMonitorMs) {
            this.awakeningTimestamp = null;
            if (this.config.debug) {
                console.log('[RAFHealthGuard] Post-awakening monitoring complete (no degradation)');
            }
            return;
        }

        // 악화 감지
        if (status === RAFHealthStatus.CRITICAL || status === RAFHealthStatus.LOCKED) {
            this.postAwakeningDegradationDetected = true;
            console.error(
                `[RAFHealthGuard] ⚠️ POST-AWAKENING DEGRADATION detected at +${elapsed.toFixed(0)}ms! ` +
                `Status: ${status}`
            );
            this.callbacks.onPostAwakeningDegradation?.(status);
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
     * LOCKED 상태였는지 확인
     */
    public wasEverLocked(): boolean {
        return this.wasLocked;
    }

    /**
     * 통계 로그
     */
    public logStats(): void {
        const avgDt = this.dtSamples.length > 0
            ? this.dtSamples.reduce((a, b) => a + b, 0) / this.dtSamples.length
            : 0;

        const lockResult = this.detectLockPattern();

        console.log('[RAFHealthGuard] Stats:');
        console.log(`  - Total frames: ${this.totalFrames}`);
        console.log(`  - Critical events: ${this.criticalCount}`);
        console.log(`  - Warning events: ${this.warningCount}`);
        console.log(`  - LOCKED events: ${this.lockedCount} ${this.lockedCount > 0 ? '🕳️' : ''}`);
        console.log(`  - Current avg dt: ${avgDt.toFixed(1)}ms`);
        console.log(`  - Current stdDev: ${lockResult.stdDev.toFixed(1)}ms`);
        console.log(`  - Current status: ${this.status}`);
        console.log(`  - Was ever locked: ${this.wasLocked}`);
    }

    /**
     * 리셋
     */
    public reset(): void {
        this.status = RAFHealthStatus.HEALTHY;
        this.dtSamples = [];
        this.lockDetectionSamples = [];
        this.consecutiveHealthyFrames = 0;
        this.criticalCount = 0;
        this.warningCount = 0;
        this.lockedCount = 0;
        this.totalFrames = 0;
        this.wasLocked = false;
        this.awakeningTimestamp = null;
        this.postAwakeningDegradationDetected = false;
        this.contexts.clear();
        this.callbacks = {};
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
