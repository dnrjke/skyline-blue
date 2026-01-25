/**
 * LoadingProtocol - LoadUnit 기반 로딩 오케스트레이션.
 *
 * [TacticalGrid Incident Prevention - Constitutional Amendment]
 *
 * Phase Flow (Final Form):
 *   FETCHING → BUILDING → WARMING → BARRIER
 *           → VISUAL_READY → STABILIZING_100 → READY → [POST_READY]
 *
 * Key Rules:
 * - BARRIER → READY 직접 전이 금지 (Constitutional)
 * - VISUAL_READY에서 실제 시각 요소 검증 (frustum-based)
 * - STABILIZING_100에서 안정화 홀드 (300ms/30frames)
 * - POST_READY: READY 후 +1 render frame 대기 후 input unlock
 *
 * VisualRequirement Lifecycle:
 * - attach(): 검증 시작 시 observer 등록
 * - validate(): 매 폴링마다 호출 (ready: true/false)
 * - detach(): VISUAL_READY 완료 후 observer 정리
 *
 * Frustum-based Detection:
 * - Scene Explorer 등록 ≠ 카메라 시야 내 렌더링
 * - boundingInfo.isInFrustum(frustumPlanes) 사용
 * - onAfterRenderObservable 내에서만 검증
 *
 * 사용법:
 * ```typescript
 * const registry = new LoadingRegistry();
 * registry.registerAll([...units]);
 *
 * const protocol = new LoadingProtocol(scene, registry);
 * const result = await protocol.execute({
 *   onPhaseChange: (phase) => console.log(phase),
 *   onProgress: (p) => updateProgressBar(p),
 * });
 *
 * if (result.phase === LoadingPhase.READY) {
 *   // POST_READY: 1 render frame 후 input 활성화
 * }
 * ```
 */

import * as BABYLON from '@babylonjs/core';
import { LoadUnit, LoadUnitStatus } from './LoadUnit';
import { LoadingRegistry } from './LoadingRegistry';
import { LoadingPhase } from '../protocol/LoadingPhase';
import { RenderReadyBarrier, BarrierValidation } from '../barrier/RenderReadyBarrier';
import { STABILIZATION_SETTINGS } from '../progress/ArcanaProgressModel';

/**
 * Protocol 실행 옵션
 */
export interface ProtocolOptions {
    /** Phase 변경 콜백 */
    onPhaseChange?: (phase: LoadingPhase) => void;

    /** 진행률 콜백 (0~1) */
    onProgress?: (progress: number) => void;

    /** 로그 콜백 */
    onLog?: (message: string) => void;

    /** Unit 상태 변경 콜백 */
    onUnitStatusChange?: (unit: LoadUnit, newStatus: LoadUnitStatus) => void;

    /**
     * Unit 시작 콜백 (forensic logging 용)
     * Called before each unit starts loading.
     * @param unitId - Unit identifier
     * @param displayName - Human-readable display name
     * @param phase - Loading phase
     */
    onUnitStart?: (unitId: string, displayName: string, phase: LoadingPhase) => void;

    /**
     * Unit 완료 콜백 (forensic logging 용)
     * Called after each unit completes (success or failure).
     * @param unitId - Unit identifier
     * @param success - Whether the unit succeeded
     * @param elapsedMs - Time taken in ms
     */
    onUnitEnd?: (unitId: string, success: boolean, elapsedMs: number) => void;

    /** Barrier 검증 옵션 (BARRIER phase) */
    barrierValidation?: BarrierValidation;

    /** READY 이후 다음 프레임에서 실행되는 Hook */
    onAfterReady?: () => void;
}

/**
 * Protocol 실행 결과
 */
export interface ProtocolResult {
    /** 최종 Phase */
    phase: LoadingPhase;

    /** 총 소요 시간 (ms) */
    elapsedMs: number;

    /** Phase별 소요 시간 */
    phaseTimes: Map<LoadingPhase, number>;

    /** 실패한 Unit (있는 경우) */
    failedUnits: LoadUnit[];

    /** 첫 에러 */
    error?: Error;
}

/**
 * LoadingProtocol
 */
export class LoadingProtocol {
    private scene: BABYLON.Scene;
    private registry: LoadingRegistry;
    private barrier: RenderReadyBarrier;

    private currentPhase: LoadingPhase = LoadingPhase.PENDING;
    private cancelled: boolean = false;

    constructor(scene: BABYLON.Scene, registry: LoadingRegistry) {
        this.scene = scene;
        this.registry = registry;
        this.barrier = new RenderReadyBarrier(scene);
    }

    /**
     * 현재 Phase 조회
     */
    getCurrentPhase(): LoadingPhase {
        return this.currentPhase;
    }

    /**
     * 로딩 취소
     */
    cancel(): void {
        this.cancelled = true;
    }

    /**
     * Protocol 실행
     */
    async execute(options: ProtocolOptions = {}): Promise<ProtocolResult> {
        const startTime = performance.now();
        const phaseTimes = new Map<LoadingPhase, number>();
        this.cancelled = false;

        const setPhase = (phase: LoadingPhase) => {
            this.currentPhase = phase;
            options.onPhaseChange?.(phase);
            options.onLog?.(`--- Phase: ${phase} ---`);
        };

        try {
            // === FETCHING Phase ===
            const fetchingUnits = this.registry.getUnitsByPhase(LoadingPhase.FETCHING);
            if (fetchingUnits.length > 0) {
                setPhase(LoadingPhase.FETCHING);
                const phaseStart = performance.now();
                await this.executeUnits(fetchingUnits, options);
                phaseTimes.set(LoadingPhase.FETCHING, performance.now() - phaseStart);
            }

            this.checkCancelled();

            // === BUILDING Phase ===
            const buildingUnits = this.registry.getUnitsByPhase(LoadingPhase.BUILDING);
            if (buildingUnits.length > 0) {
                setPhase(LoadingPhase.BUILDING);
                const phaseStart = performance.now();
                await this.executeUnits(buildingUnits, options);
                phaseTimes.set(LoadingPhase.BUILDING, performance.now() - phaseStart);
            }

            this.checkCancelled();

            // === WARMING Phase ===
            const warmingUnits = this.registry.getUnitsByPhase(LoadingPhase.WARMING);
            if (warmingUnits.length > 0) {
                setPhase(LoadingPhase.WARMING);
                const phaseStart = performance.now();
                await this.executeUnits(warmingUnits, options);
                phaseTimes.set(LoadingPhase.WARMING, performance.now() - phaseStart);
            }

            this.checkCancelled();

            // === BARRIER Phase (렌더 루프 확인만 - 시각 검증은 VISUAL_READY에서) ===
            setPhase(LoadingPhase.BARRIER);
            const barrierStart = performance.now();
            await this.executeBarrierPhase(options);
            phaseTimes.set(LoadingPhase.BARRIER, performance.now() - barrierStart);

            this.checkCancelled();

            // === VISUAL_READY Phase (실제 시각 요소 검증) ===
            // [Constitutional Amendment] BARRIER → READY 직접 전이 금지
            setPhase(LoadingPhase.VISUAL_READY);
            const visualReadyStart = performance.now();
            await this.executeVisualReadyPhase(options);
            phaseTimes.set(LoadingPhase.VISUAL_READY, performance.now() - visualReadyStart);

            this.checkCancelled();

            // === STABILIZING_100 Phase (안정화 홀드) ===
            setPhase(LoadingPhase.STABILIZING_100);
            const stabilizingStart = performance.now();
            await this.executeStabilizationPhase(options);
            phaseTimes.set(LoadingPhase.STABILIZING_100, performance.now() - stabilizingStart);

            // === READY ===
            setPhase(LoadingPhase.READY);
            const totalMs = performance.now() - startTime;
            options.onLog?.(`[READY] Loading complete: ${Math.round(totalMs)}ms`);
            options.onProgress?.(1);

            // onAfterReady는 다음 프레임에서 실행
            if (options.onAfterReady) {
                this.scene.onAfterRenderObservable.addOnce(() => {
                    options.onAfterReady?.();
                });
            }

            return {
                phase: LoadingPhase.READY,
                elapsedMs: totalMs,
                phaseTimes,
                failedUnits: [],
            };
        } catch (err) {
            setPhase(LoadingPhase.FAILED);
            const error = err instanceof Error ? err : new Error(String(err));
            options.onLog?.(`[FAILED] ${error.message}`);

            return {
                phase: LoadingPhase.FAILED,
                elapsedMs: performance.now() - startTime,
                phaseTimes,
                failedUnits: this.registry.getUnitsByStatus(LoadUnitStatus.FAILED),
                error,
            };
        }
    }

    /**
     * Unit 배열 실행
     */
    private async executeUnits(units: LoadUnit[], options: ProtocolOptions): Promise<void> {
        const requiredUnits = units.filter((u) => u.requiredForReady);
        const optionalUnits = units.filter((u) => !u.requiredForReady);

        // Required units는 순차 실행 (하나라도 실패하면 중단)
        for (const unit of requiredUnits) {
            this.checkCancelled();

            const displayName = 'getDisplayName' in unit
                ? (unit as { getDisplayName(): string }).getDisplayName()
                : unit.id;
            const unitStartTime = performance.now();

            // Notify unit start (for forensic logging)
            options.onUnitStart?.(unit.id, displayName, unit.phase);
            options.onLog?.(`Loading: ${displayName}...`);

            await unit.load(this.scene, (_unitProgress) => {
                // Unit별 진행률을 전체 진행률에 반영
                const overallProgress = this.registry.calculateProgress();
                options.onProgress?.(overallProgress);
            });

            const elapsedMs = performance.now() - unitStartTime;
            const success = unit.status !== LoadUnitStatus.FAILED;

            // Notify unit end (for forensic logging)
            options.onUnitEnd?.(unit.id, success, elapsedMs);
            options.onUnitStatusChange?.(unit, unit.status);

            if (unit.status === LoadUnitStatus.FAILED) {
                throw unit.error || new Error(`Unit ${unit.id} failed`);
            }
        }

        // Optional units는 병렬 실행 (실패해도 계속)
        if (optionalUnits.length > 0) {
            await Promise.allSettled(
                optionalUnits.map(async (unit) => {
                    const displayName = 'getDisplayName' in unit
                        ? (unit as { getDisplayName(): string }).getDisplayName()
                        : unit.id;
                    const unitStartTime = performance.now();

                    options.onUnitStart?.(unit.id, displayName, unit.phase);

                    try {
                        await unit.load(this.scene);
                        const elapsedMs = performance.now() - unitStartTime;
                        options.onUnitEnd?.(unit.id, true, elapsedMs);
                        options.onUnitStatusChange?.(unit, unit.status);
                    } catch (err) {
                        console.warn(`[LoadingProtocol] Optional unit ${unit.id} failed:`, err);
                        unit.status = LoadUnitStatus.SKIPPED;
                        const elapsedMs = performance.now() - unitStartTime;
                        options.onUnitEnd?.(unit.id, false, elapsedMs);
                    }
                })
            );
        }
    }

    /**
     * BARRIER phase 실행 - 첫 프레임 렌더 검증
     *
     * Barrier LoadUnit은 requiredForReady이지만,
     * "사전 validate 대상"이 아니라 "Barrier Phase에서 실행 후 자동 validate"된다.
     */
    private async executeBarrierPhase(options: ProtocolOptions): Promise<void> {
        options.onLog?.('[BARRIER] First frame render verification...');

        // 1. Barrier 이전 phase의 required units만 검증 (BARRIER phase 제외)
        const nonBarrierRequired = this.registry
            .getRequiredUnits()
            .filter((u) => u.phase !== LoadingPhase.BARRIER);

        for (const unit of nonBarrierRequired) {
            if (unit.status !== LoadUnitStatus.LOADED) continue;

            const isValid = unit.validate?.(this.scene) ?? true;

            if (isValid) {
                unit.status = LoadUnitStatus.VALIDATED;
            } else {
                throw new Error(`Pre-barrier validation failed: ${unit.id}`);
            }
        }

        // 2. BARRIER phase units 실행 (RenderReadyBarrierUnit 등)
        const barrierUnits = this.registry.getUnitsByPhase(LoadingPhase.BARRIER);

        if (barrierUnits.length > 0) {
            // Execute barrier units
            for (const unit of barrierUnits) {
                this.checkCancelled();
                options.onLog?.(`[BARRIER] Executing: ${unit.id}...`);

                await unit.load(this.scene, (_unitProgress) => {
                    const overallProgress = this.registry.calculateProgress();
                    options.onProgress?.(overallProgress);
                });

                options.onUnitStatusChange?.(unit, unit.status);

                if (unit.status === LoadUnitStatus.FAILED) {
                    throw unit.error || new Error(`Barrier unit ${unit.id} failed`);
                }

                // Barrier unit은 load() 성공 자체가 validate 의미
                if (unit.status === LoadUnitStatus.LOADED) {
                    const isValid = unit.validate?.(this.scene) ?? true;
                    if (isValid) {
                        unit.status = LoadUnitStatus.VALIDATED;
                    }
                }
            }
        } else {
            // Fallback: 등록된 Barrier unit이 없으면 기존 방식 사용
            const barrierValidation: BarrierValidation = {
                minActiveMeshCount: 1,
                maxRetryFrames: 15,
                requireCameraRender: true,
                ...options.barrierValidation,
            };

            await this.barrier.waitForFirstFrame(barrierValidation);
        }

        // 3. 최종 검증 - BARRIER 이전 phase의 Required Unit이 VALIDATED인지 확인
        // [NOTE] VISUAL_READY, STABILIZING_100 유닛은 아직 실행 전이므로 제외
        const preVisualPhases = [
            LoadingPhase.FETCHING,
            LoadingPhase.BUILDING,
            LoadingPhase.WARMING,
            LoadingPhase.BARRIER,
        ];

        const preVisualRequired = this.registry
            .getRequiredUnits()
            .filter((u) => preVisualPhases.includes(u.phase));

        const notValidated = preVisualRequired
            .filter((u) => u.status !== LoadUnitStatus.VALIDATED && u.status !== LoadUnitStatus.SKIPPED)
            .map((u) => `${u.id}(${u.status})`);

        if (notValidated.length > 0) {
            throw new Error(`Not all pre-visual required units validated: ${notValidated.join(', ')}`);
        }

        options.onProgress?.(0.90);
    }

    /**
     * VISUAL_READY phase 실행 - 실제 시각 요소 검증
     *
     * [TacticalGrid Incident Prevention]
     * BARRIER 이후 실제로 화면에 보이는지 검증하는 phase.
     * VisualReadyUnit들이 등록되어 있어야 함.
     *
     * RULE: VISUAL_READY에 등록된 유닛이 0개면 경고 (에러는 아님 - 호환성)
     */
    private async executeVisualReadyPhase(options: ProtocolOptions): Promise<void> {
        options.onLog?.('[VISUAL_READY] Visual verification phase...');

        const visualReadyUnits = this.registry.getUnitsByPhase(LoadingPhase.VISUAL_READY);

        if (visualReadyUnits.length === 0) {
            // 경고만 출력 (완전한 에러는 기존 코드 호환성 때문에 피함)
            console.warn(
                '[LoadingProtocol] WARNING: No VisualReadyUnits registered. ' +
                'This may cause TacticalGrid-class incidents. ' +
                'Register VisualReadyUnit with visual requirements.'
            );
            options.onLog?.('[VISUAL_READY] No visual units registered (WARNING)');
            return;
        }

        // Required visual units 검증
        const requiredVisualUnits = visualReadyUnits.filter((u) => u.requiredForReady);

        if (requiredVisualUnits.length === 0) {
            console.warn(
                '[LoadingProtocol] WARNING: No REQUIRED VisualReadyUnits. ' +
                'Core visual elements should be required for validation.'
            );
        }

        // Visual units 실행 (순차)
        for (const unit of visualReadyUnits) {
            this.checkCancelled();
            options.onLog?.(`[VISUAL_READY] Verifying: ${unit.id}...`);

            await unit.load(this.scene, (_unitProgress) => {
                const overallProgress = this.registry.calculateProgress();
                options.onProgress?.(Math.min(0.95, overallProgress));
            });

            options.onUnitStatusChange?.(unit, unit.status);

            if (unit.requiredForReady && unit.status === LoadUnitStatus.FAILED) {
                throw unit.error || new Error(`Visual verification failed: ${unit.id}`);
            }

            // Visual unit validate
            if (unit.status === LoadUnitStatus.LOADED) {
                const isValid = unit.validate?.(this.scene) ?? true;
                if (isValid) {
                    unit.status = LoadUnitStatus.VALIDATED;
                    options.onLog?.(`[VISUAL_READY] ✓ ${unit.id} validated`);
                } else if (unit.requiredForReady) {
                    throw new Error(`Visual validation failed: ${unit.id}`);
                }
            }
        }

        options.onProgress?.(0.98);
        options.onLog?.('[VISUAL_READY] Visual verification complete');
    }

    /**
     * STABILIZING_100 phase 실행 - 안정화 홀드
     *
     * [TacticalGrid Incident Prevention]
     * 100%에서 안정화 대기. 목적:
     * - 첫 프레임 떨림 제거
     * - GPU spike 흡수
     * - 시각 요소가 '보인 채로 유지되는지' 확인
     *
     * MIN_TIME_MS OR MIN_STABLE_FRAMES 중 하나라도 충족 전엔 READY 불가
     */
    private async executeStabilizationPhase(options: ProtocolOptions): Promise<void> {
        options.onLog?.('[STABILIZING_100] Stability hold phase...');

        const startTime = performance.now();
        let frameCount = 0;

        const { MIN_TIME_MS, MIN_STABLE_FRAMES, MAX_TIME_MS } = STABILIZATION_SETTINGS;

        return new Promise<void>((resolve, reject) => {
            const checkStability = () => {
                try {
                    this.checkCancelled();

                    frameCount++;
                    const elapsed = performance.now() - startTime;

                    // 완료 조건 체크
                    const timeOk = elapsed >= MIN_TIME_MS;
                    const framesOk = frameCount >= MIN_STABLE_FRAMES;
                    const maxTimeReached = elapsed >= MAX_TIME_MS;

                    if ((timeOk && framesOk) || maxTimeReached) {
                        if (maxTimeReached && !(timeOk && framesOk)) {
                            console.warn(
                                `[LoadingProtocol] Stabilization max time reached (fail-safe): ` +
                                `${elapsed.toFixed(0)}ms, ${frameCount} frames`
                            );
                        } else {
                            options.onLog?.(
                                `[STABILIZING_100] Complete: ${elapsed.toFixed(0)}ms, ${frameCount} frames`
                            );
                        }

                        options.onProgress?.(1.0);
                        resolve();
                        return;
                    }

                    // 다음 프레임에서 재검사
                    this.scene.onAfterRenderObservable.addOnce(checkStability);
                } catch (err) {
                    reject(err);
                }
            };

            // 첫 프레임부터 시작
            this.scene.onAfterRenderObservable.addOnce(checkStability);
        });
    }

    /**
     * 취소 확인
     */
    private checkCancelled(): void {
        if (this.cancelled) {
            throw new Error('Loading cancelled');
        }
    }
}
