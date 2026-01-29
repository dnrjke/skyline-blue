/**
 * SceneLoaderProtocol - Scene별 로더가 구현해야 하는 인터페이스.
 *
 * Navigation / Flight 등 각 Scene은:
 * - 동일한 프로토콜을 따르되
 * - 다른 Phase 구성을 가질 수 있음
 *
 * 이 프로토콜은 "엔진 기준 로딩"을 강제한다.
 */

import * as BABYLON from '@babylonjs/core';
import { LoadingPhase } from './LoadingPhase';
import { LoadingResult, LoadingCallbacks } from './LoadingResult';

/**
 * Scene 로더 프로토콜
 */
export interface SceneLoaderProtocol<TStageKey = unknown> {
    /**
     * 로딩 수행
     * @param stage Stage 식별자 (Navigation: {episode, stage}, Flight: 다를 수 있음)
     * @param callbacks 진행 콜백
     * @returns 로딩 결과 (READY 또는 FAILED)
     */
    load(stage: TStageKey, callbacks?: LoadingCallbacks): Promise<LoadingResult>;

    /**
     * 현재 Phase 조회
     */
    getCurrentPhase(): LoadingPhase;

    /**
     * 로딩 취소 (가능한 경우)
     */
    cancel?(): void;

    /**
     * 리소스 정리
     */
    dispose(): void;
}

/**
 * Phase 작업 정의
 */
export interface PhaseWork {
    /** 이 작업이 속한 Phase */
    phase: LoadingPhase;

    /** 작업 이름 (디버깅용) */
    name: string;

    /**
     * 작업 수행
     * @returns 진행률 (0~1) 또는 void
     */
    execute: () => Promise<number | void>;

    /**
     * 이 작업이 전체 진행률에서 차지하는 비중 (0~1)
     * 기본값: 균등 분배
     */
    weight?: number;
}

/**
 * Base Scene Loader - 공통 로직을 제공하는 추상 클래스
 */
export abstract class BaseSceneLoader<TStageKey = unknown>
    implements SceneLoaderProtocol<TStageKey>
{
    protected scene: BABYLON.Scene;
    protected currentPhase: LoadingPhase = LoadingPhase.PENDING;
    protected cancelled: boolean = false;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    getCurrentPhase(): LoadingPhase {
        return this.currentPhase;
    }

    cancel(): void {
        this.cancelled = true;
    }

    /**
     * 서브클래스에서 구현: Phase 작업 목록 반환
     */
    protected abstract definePhaseWorks(stage: TStageKey): PhaseWork[];

    /**
     * 로딩 수행 (Template Method)
     */
    async load(stage: TStageKey, callbacks?: LoadingCallbacks): Promise<LoadingResult> {
        const startTime = performance.now();
        const phaseTimings: Partial<Record<LoadingPhase, number>> = {};
        this.cancelled = false;

        const works = this.definePhaseWorks(stage);
        const totalWeight = works.reduce((sum, w) => sum + (w.weight ?? 1), 0);
        let accumulatedWeight = 0;

        try {
            for (const work of works) {
                if (this.cancelled) {
                    throw new Error('Loading cancelled');
                }

                // Phase 전환
                if (this.currentPhase !== work.phase) {
                    this.currentPhase = work.phase;
                    callbacks?.onPhaseChange?.(work.phase);
                }

                const phaseStart = performance.now();
                callbacks?.onLog?.(`[${work.phase}] ${work.name}...`);

                // 작업 수행
                await work.execute();

                // 타이밍 기록
                const elapsed = performance.now() - phaseStart;
                phaseTimings[work.phase] = (phaseTimings[work.phase] ?? 0) + elapsed;
                callbacks?.onLog?.(`[${work.phase}] ${work.name}: ${Math.round(elapsed)}ms`);

                // 진행률 업데이트
                accumulatedWeight += work.weight ?? 1;
                callbacks?.onProgress?.(accumulatedWeight / totalWeight);
            }

            // READY 도달
            this.currentPhase = LoadingPhase.READY;
            callbacks?.onPhaseChange?.(LoadingPhase.READY);

            // onAfterReady는 다음 프레임에서 실행
            if (callbacks?.onAfterReady) {
                const obs = this.scene.onAfterRenderObservable.addOnce(() => {
                    callbacks.onAfterReady?.();
                });
                // 안전장치: Scene dispose 시 observer 정리
                this.scene.onDisposeObservable.addOnce(() => {
                    this.scene.onAfterRenderObservable.remove(obs);
                });
            }

            return {
                phase: LoadingPhase.READY,
                elapsedMs: performance.now() - startTime,
                phaseTimings,
            };
        } catch (error) {
            this.currentPhase = LoadingPhase.FAILED;
            callbacks?.onPhaseChange?.(LoadingPhase.FAILED);

            return {
                phase: LoadingPhase.FAILED,
                elapsedMs: performance.now() - startTime,
                error: error instanceof Error ? error : new Error(String(error)),
                phaseTimings,
            };
        }
    }

    abstract dispose(): void;
}
