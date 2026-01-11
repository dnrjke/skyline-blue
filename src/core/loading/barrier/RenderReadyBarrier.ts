/**
 * RenderReadyBarrier - 렌더 루프 시작 확인 시스템.
 *
 * [TacticalGrid Incident Prevention - Constitutional Amendment]
 *
 * BARRIER Phase의 역할 (ONLY):
 * - render loop has started (onAfterRender fired)
 * - camera is valid
 * - scene.render() executes
 *
 * BARRIER Phase가 하지 않는 것:
 * - activeMeshes count 검증 (NOT a visibility guarantee)
 * - actual visual readiness 검증 (→ VISUAL_READY phase에서 수행)
 * - mesh visibility 검증 (→ VISUAL_READY phase에서 수행)
 *
 * Progress: 85-90% (capped, never exceeds 90%)
 *
 * 이전 구현에서 activeMeshes count를 검증했던 것은
 * TacticalGrid incident의 원인이었다.
 * activeMeshes count는 visibility를 보장하지 않는다.
 */

import * as BABYLON from '@babylonjs/core';

/**
 * Barrier 검증 결과
 */
export enum BarrierResult {
    /** 검증 성공 - 렌더 루프 확인 */
    SUCCESS = 'SUCCESS',

    /** 재시도 필요 - 아직 렌더 루프 미확인 */
    RETRY = 'RETRY',

    /** 치명적 실패 - 복구 불가 */
    FATAL_FAILURE = 'FATAL_FAILURE',
}

/**
 * Barrier 증거 유형 (Evidence Type) - 레거시 지원용
 *
 * [DEPRECATED IN NEW ARCHITECTURE]
 * VISUAL_READY phase에서 visual verification을 수행하므로
 * BARRIER phase에서는 더 이상 mesh-level evidence를 검증하지 않음.
 */
export type BarrierEvidence = 'ACTIVE_MESH' | 'VISIBLE_MESH' | 'RENDER_READY' | 'CUSTOM';

/**
 * Barrier 요구사항 - 레거시 지원용
 */
export interface BarrierRequirement {
    id: string;
    evidence: BarrierEvidence;
    predicate?: (scene: BABYLON.Scene) => boolean;
}

/**
 * Barrier 검증 옵션
 */
export interface BarrierValidation {
    /** 최대 재시도 프레임 수 (기본값: 10) */
    maxRetryFrames?: number;

    /** 카메라 렌더 검증 활성화 (기본값: true) */
    requireCameraRender?: boolean;

    /** 재시도 간 대기 프레임 수 (기본값: 1) */
    retryFrameInterval?: number;

    // ===============================================
    // DEPRECATED - 레거시 옵션 (무시됨)
    // ===============================================
    /** @deprecated Use VISUAL_READY phase instead */
    requiredMeshNames?: string[];

    /** @deprecated activeMeshes count is NOT a visibility guarantee */
    minActiveMeshCount?: number;

    /** @deprecated Use VISUAL_READY phase instead */
    requirements?: BarrierRequirement[];
}

/**
 * 단일 프레임 검증 결과
 */
interface FrameValidationResult {
    result: BarrierResult;
    cameraValid: boolean;
    renderLoopActive: boolean;
    reason?: string;
}

/**
 * RenderReadyBarrier - 렌더 루프 시작 확인
 *
 * [Constitutional Contract]
 *
 * Barrier ONLY confirms:
 * - render loop has started
 * - camera is valid
 * - scene.render() executes
 *
 * Barrier does NOT confirm:
 * - activeMeshes count (NOT a visibility guarantee)
 * - actual visual readiness (→ VISUAL_READY phase)
 * - mesh visibility (→ VISUAL_READY phase)
 */
export class RenderReadyBarrier {
    private scene: BABYLON.Scene;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    /**
     * 첫 프레임 렌더 대기 및 검증
     *
     * BARRIER phase는 오직 렌더 루프 시작만 확인한다.
     * Visual readiness는 VISUAL_READY phase에서 검증한다.
     *
     * @param validation 검증 옵션
     * @returns 렌더 루프 확인 시 resolve
     */
    async waitForFirstFrame(validation: BarrierValidation = {}): Promise<void> {
        const {
            maxRetryFrames = 10,
            requireCameraRender = true,
            retryFrameInterval = 1,
        } = validation;

        // Deprecation warnings for legacy options
        if (validation.minActiveMeshCount !== undefined) {
            console.warn(
                '[RenderReadyBarrier] DEPRECATED: minActiveMeshCount is ignored. ' +
                'activeMeshes count is NOT a visibility guarantee. ' +
                'Use VISUAL_READY phase for visual verification.'
            );
        }

        if (validation.requiredMeshNames?.length || validation.requirements?.length) {
            console.warn(
                '[RenderReadyBarrier] DEPRECATED: requiredMeshNames/requirements are ignored. ' +
                'Use VISUAL_READY phase for mesh-level visual verification.'
            );
        }

        let retryCount = 0;
        let lastResult: FrameValidationResult | null = null;

        return new Promise((resolve, reject) => {
            const checkFrame = () => {
                const result = this.validateFrame({ requireCameraRender });
                lastResult = result;

                if (result.result === BarrierResult.SUCCESS) {
                    console.log('[RenderReadyBarrier] SUCCESS - Render loop confirmed', {
                        cameraValid: result.cameraValid,
                        retryCount,
                    });
                    resolve();
                    return;
                }

                if (result.result === BarrierResult.FATAL_FAILURE) {
                    console.error('[RenderReadyBarrier] FATAL_FAILURE', result.reason);
                    reject(new Error(`Barrier fatal failure: ${result.reason}`));
                    return;
                }

                // RETRY
                retryCount++;
                if (retryCount >= maxRetryFrames) {
                    console.error('[RenderReadyBarrier] Max retries exceeded', {
                        maxRetryFrames,
                        lastResult,
                    });
                    reject(
                        new Error(
                            `Barrier timeout after ${maxRetryFrames} frames. ` +
                            `Camera valid: ${lastResult?.cameraValid}, ` +
                            `Reason: ${lastResult?.reason}`
                        )
                    );
                    return;
                }

                console.log('[RenderReadyBarrier] RETRY', {
                    retryCount,
                    reason: result.reason,
                });

                this.scheduleRetry(checkFrame, retryFrameInterval);
            };

            // 첫 프레임 렌더 후 검증 시작
            // onAfterRenderObservable이 fire되면 render loop가 시작된 것
            this.scene.onAfterRenderObservable.addOnce(() => {
                checkFrame();
            });
        });
    }

    /**
     * 단일 프레임 검증
     *
     * [검증 항목]
     * 1. activeCamera 존재
     * 2. camera position 유효
     * 3. camera viewMatrix 유효
     *
     * [검증 제외]
     * - activeMeshes count
     * - mesh visibility
     * - any timing-based heuristics
     */
    private validateFrame(options: {
        requireCameraRender: boolean;
    }): FrameValidationResult {
        const { requireCameraRender } = options;

        // render loop가 실행 중인지는 onAfterRenderObservable로 이미 확인됨
        const renderLoopActive = true;

        // Camera validation
        if (requireCameraRender) {
            const cam = this.scene.activeCamera;
            if (!cam) {
                return {
                    result: BarrierResult.RETRY,
                    cameraValid: false,
                    renderLoopActive,
                    reason: 'No active camera',
                };
            }

            // Camera position 검증
            const pos = cam.position;
            if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
                return {
                    result: BarrierResult.RETRY,
                    cameraValid: false,
                    renderLoopActive,
                    reason: 'Camera position invalid',
                };
            }

            // ViewMatrix 검증
            try {
                const viewMatrix = cam.getViewMatrix();
                if (!viewMatrix || viewMatrix.m.some((v) => !isFinite(v))) {
                    return {
                        result: BarrierResult.RETRY,
                        cameraValid: false,
                        renderLoopActive,
                        reason: 'Camera view matrix invalid',
                    };
                }
            } catch {
                return {
                    result: BarrierResult.RETRY,
                    cameraValid: false,
                    renderLoopActive,
                    reason: 'Camera view matrix error',
                };
            }
        }

        // 모든 검증 통과
        return {
            result: BarrierResult.SUCCESS,
            cameraValid: true,
            renderLoopActive: true,
        };
    }

    /**
     * 프레임 간격을 두고 재시도 예약
     */
    private scheduleRetry(callback: () => void, frameInterval: number): void {
        if (frameInterval <= 1) {
            this.scene.onAfterRenderObservable.addOnce(callback);
        } else {
            let remaining = frameInterval;
            const countDown = () => {
                remaining--;
                if (remaining <= 0) {
                    callback();
                } else {
                    this.scene.onAfterRenderObservable.addOnce(countDown);
                }
            };
            this.scene.onAfterRenderObservable.addOnce(countDown);
        }
    }
}
