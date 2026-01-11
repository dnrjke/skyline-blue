/**
 * LoadUnit - 로딩의 최소 단위 인터페이스.
 *
 * 핵심 개념:
 * - 로딩의 최소 단위는 "에셋"이 아니라 "LoadUnit"
 * - 각 Unit은 자신의 Phase, 필수 여부, 검증 로직을 선언
 * - MaterialWarmup, RenderingPipeline도 LoadUnit으로 취급
 *
 * 모든 씬(Navigation, Flight 등)은 동일한 LoadUnit 인터페이스를 사용하며,
 * LoadingProtocol이 Unit들을 Phase 순서대로 실행하고 검증한다.
 */

import * as BABYLON from '@babylonjs/core';
import { LoadingPhase } from '../protocol/LoadingPhase';

/**
 * LoadUnit 상태
 */
export enum LoadUnitStatus {
    /** 대기 중 */
    PENDING = 'PENDING',
    /** 로딩 중 */
    LOADING = 'LOADING',
    /** 로딩 완료 (검증 전) */
    LOADED = 'LOADED',
    /** 검증 완료 */
    VALIDATED = 'VALIDATED',
    /** 실패 */
    FAILED = 'FAILED',
    /** 스킵됨 (optional unit) */
    SKIPPED = 'SKIPPED',
}

/**
 * LoadUnit 진행 콜백
 */
export interface LoadUnitProgress {
    /** 진행률 (0~1) */
    progress: number;
    /** 현재 작업 메시지 */
    message?: string;
}

/**
 * LoadUnit 인터페이스 - 로딩의 최소 단위
 */
export interface LoadUnit {
    /** 유닛 고유 ID */
    readonly id: string;

    /** 이 유닛이 속한 Phase */
    readonly phase: LoadingPhase;

    /** READY 판정에 필수인지 여부 */
    readonly requiredForReady: boolean;

    /** 현재 상태 */
    status: LoadUnitStatus;

    /**
     * 로딩 작업 수행
     * @param scene 대상 Scene
     * @param onProgress 진행률 콜백
     */
    load(scene: BABYLON.Scene, onProgress?: (progress: LoadUnitProgress) => void): Promise<void>;

    /**
     * 첫 프레임 이후 검증 (선택적)
     * - BARRIER phase에서 호출됨
     * - 실제 렌더링 결과를 검증
     *
     * @param scene 대상 Scene
     * @returns 검증 성공 여부
     */
    validate?(scene: BABYLON.Scene): boolean;

    /**
     * 리소스 정리
     */
    dispose?(): void;

    /**
     * 로딩 소요 시간 (ms)
     */
    elapsedMs?: number;

    /**
     * 실패 원인
     */
    error?: Error;
}

/**
 * LoadUnit 팩토리 함수 타입
 */
export type LoadUnitFactory<T extends LoadUnit = LoadUnit> = (scene: BABYLON.Scene) => T;

/**
 * BaseLoadUnit - LoadUnit 구현을 위한 추상 기본 클래스
 */
export abstract class BaseLoadUnit implements LoadUnit {
    abstract readonly id: string;
    abstract readonly phase: LoadingPhase;
    abstract readonly requiredForReady: boolean;

    status: LoadUnitStatus = LoadUnitStatus.PENDING;
    elapsedMs?: number;
    error?: Error;

    /**
     * 서브클래스에서 구현: 실제 로딩 작업
     */
    protected abstract doLoad(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void>;

    /**
     * LoadUnit.load() 구현 - 상태 관리 포함
     */
    async load(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        if (this.status !== LoadUnitStatus.PENDING) {
            console.warn(`[LoadUnit:${this.id}] Already loaded/loading, skipping`);
            return;
        }

        this.status = LoadUnitStatus.LOADING;
        const startTime = performance.now();

        try {
            await this.doLoad(scene, onProgress);
            this.elapsedMs = performance.now() - startTime;
            this.status = LoadUnitStatus.LOADED;
            console.log(`[LoadUnit:${this.id}] Loaded in ${Math.round(this.elapsedMs)}ms`);
        } catch (err) {
            this.elapsedMs = performance.now() - startTime;
            this.error = err instanceof Error ? err : new Error(String(err));
            this.status = LoadUnitStatus.FAILED;
            console.error(`[LoadUnit:${this.id}] Failed:`, this.error);
            throw this.error;
        }
    }

    /**
     * 기본 validate 구현 (항상 통과)
     * 서브클래스에서 오버라이드하여 실제 검증 로직 구현
     */
    validate(_scene: BABYLON.Scene): boolean {
        // 기본: 로딩 성공이면 검증도 통과
        return this.status === LoadUnitStatus.LOADED || this.status === LoadUnitStatus.VALIDATED;
    }

    /**
     * 검증 완료 마킹
     */
    markValidated(): void {
        if (this.status === LoadUnitStatus.LOADED) {
            this.status = LoadUnitStatus.VALIDATED;
        }
    }

    /**
     * 기본 dispose 구현 (no-op)
     */
    dispose(): void {
        // 서브클래스에서 오버라이드
    }

    /**
     * 상태 리셋 (재사용 시)
     */
    reset(): void {
        this.status = LoadUnitStatus.PENDING;
        this.elapsedMs = undefined;
        this.error = undefined;
    }
}
