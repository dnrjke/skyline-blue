/**
 * LoadingProtocol - LoadUnit 기반 로딩 오케스트레이션.
 *
 * 역할:
 * - Registry에 등록된 LoadUnit들을 Phase 순서대로 실행
 * - BARRIER phase에서 첫 프레임 렌더 검증 수행
 * - 모든 Required Unit이 VALIDATED 상태가 되어야 READY
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
 *   // 게임 시작
 * }
 * ```
 */

import * as BABYLON from '@babylonjs/core';
import { LoadUnit, LoadUnitStatus } from './LoadUnit';
import { LoadingRegistry } from './LoadingRegistry';
import { LoadingPhase } from '../protocol/LoadingPhase';
import { RenderReadyBarrier, BarrierValidation } from '../barrier/RenderReadyBarrier';

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

            // === BARRIER Phase (첫 프레임 렌더 검증) ===
            setPhase(LoadingPhase.BARRIER);
            const barrierStart = performance.now();
            await this.executeBarrierPhase(options);
            phaseTimes.set(LoadingPhase.BARRIER, performance.now() - barrierStart);

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
            options.onLog?.(`Loading: ${unit.id}...`);

            await unit.load(this.scene, (_unitProgress) => {
                // Unit별 진행률을 전체 진행률에 반영
                const overallProgress = this.registry.calculateProgress();
                options.onProgress?.(overallProgress);
            });

            options.onUnitStatusChange?.(unit, unit.status);

            if (unit.status === LoadUnitStatus.FAILED) {
                throw unit.error || new Error(`Unit ${unit.id} failed`);
            }
        }

        // Optional units는 병렬 실행 (실패해도 계속)
        if (optionalUnits.length > 0) {
            await Promise.allSettled(
                optionalUnits.map(async (unit) => {
                    try {
                        await unit.load(this.scene);
                        options.onUnitStatusChange?.(unit, unit.status);
                    } catch (err) {
                        console.warn(`[LoadingProtocol] Optional unit ${unit.id} failed:`, err);
                        unit.status = LoadUnitStatus.SKIPPED;
                    }
                })
            );
        }
    }

    /**
     * BARRIER phase 실행 - 첫 프레임 렌더 검증
     */
    private async executeBarrierPhase(options: ProtocolOptions): Promise<void> {
        options.onLog?.('[BARRIER] First frame render verification...');

        // 1. RenderReadyBarrier로 첫 프레임 대기
        const barrierValidation: BarrierValidation = {
            minActiveMeshCount: 1,
            maxRetryFrames: 15,
            requireCameraRender: true,
            ...options.barrierValidation,
        };

        await this.barrier.waitForFirstFrame(barrierValidation);

        // 2. 각 Required Unit의 validate() 호출
        const requiredUnits = this.registry.getRequiredUnits();
        const failedValidations: string[] = [];

        for (const unit of requiredUnits) {
            if (unit.status !== LoadUnitStatus.LOADED) continue;

            const isValid = unit.validate?.(this.scene) ?? true;

            if (isValid) {
                unit.status = LoadUnitStatus.VALIDATED;
                if ('markValidated' in unit && typeof unit.markValidated === 'function') {
                    (unit as any).markValidated();
                }
            } else {
                failedValidations.push(unit.id);
                options.onLog?.(`[BARRIER] Validation failed: ${unit.id}`);
            }
        }

        if (failedValidations.length > 0) {
            throw new Error(`Barrier validation failed for: ${failedValidations.join(', ')}`);
        }

        // 3. 모든 Required Unit이 VALIDATED 확인
        if (!this.registry.areAllRequiredValidated()) {
            const notValidated = requiredUnits
                .filter((u) => u.status !== LoadUnitStatus.VALIDATED && u.status !== LoadUnitStatus.SKIPPED)
                .map((u) => `${u.id}(${u.status})`);
            throw new Error(`Not all required units validated: ${notValidated.join(', ')}`);
        }

        options.onProgress?.(0.95);
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
