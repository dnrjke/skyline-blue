/**
 * RenderReadyBarrier - 첫 프레임 렌더 검증 시스템.
 *
 * Babylon.js 8.x에서 "로딩 완료"를 판단하는 유일하게 안전한 방법:
 * - Asset load 완료 ✗
 * - Material warmup 완료 ✗
 * - Scene 초기화 완료 ✗
 * - 첫 프레임 렌더 성공 ✓
 *
 * 이 Barrier는 onAfterRenderObservable을 사용하여
 * 실제로 렌더링이 성공했는지 검증한다.
 */

import * as BABYLON from '@babylonjs/core';

/**
 * Barrier 검증 결과
 */
export enum BarrierResult {
    /** 검증 성공 - 렌더링 가능 */
    SUCCESS = 'SUCCESS',

    /** 재시도 필요 - 아직 준비 안 됨 */
    RETRY = 'RETRY',

    /** 치명적 실패 - 복구 불가 */
    FATAL_FAILURE = 'FATAL_FAILURE',
}

/**
 * Barrier 검증 옵션
 */
export interface BarrierValidation {
    /** 필수 메시 이름 (이 메시들이 active mesh에 포함되어야 함) */
    requiredMeshNames?: string[];

    /** 최소 active mesh 수 (기본값: 1) */
    minActiveMeshCount?: number;

    /** 최대 재시도 프레임 수 (기본값: 10) */
    maxRetryFrames?: number;

    /** 카메라 렌더 검증 활성화 (기본값: true) */
    requireCameraRender?: boolean;

    /** 재시도 간 대기 프레임 수 (기본값: 1) */
    retryFrameInterval?: number;
}

/**
 * 단일 프레임 검증 결과
 */
interface FrameValidationResult {
    result: BarrierResult;
    activeMeshCount: number;
    missingMeshes: string[];
    cameraValid: boolean;
    reason?: string;
}

/**
 * RenderReadyBarrier - 첫 프레임 렌더 검증
 */
export class RenderReadyBarrier {
    private scene: BABYLON.Scene;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    /**
     * 첫 프레임 렌더 대기 및 검증
     *
     * @param validation 검증 옵션
     * @returns 검증 성공 시 resolve, 실패 시 reject
     */
    async waitForFirstFrame(validation: BarrierValidation = {}): Promise<void> {
        const {
            requiredMeshNames = [],
            minActiveMeshCount = 1,
            maxRetryFrames = 10,
            requireCameraRender = true,
            retryFrameInterval = 1,
        } = validation;

        let retryCount = 0;
        let lastResult: FrameValidationResult | null = null;

        return new Promise((resolve, reject) => {
            const checkFrame = () => {
                // 프레임 검증 수행
                const result = this.validateFrame({
                    requiredMeshNames,
                    minActiveMeshCount,
                    requireCameraRender,
                });

                lastResult = result;

                if (result.result === BarrierResult.SUCCESS) {
                    console.log('[RenderReadyBarrier] SUCCESS', {
                        activeMeshCount: result.activeMeshCount,
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
                                `Active meshes: ${lastResult.activeMeshCount}, ` +
                                `Missing: [${lastResult.missingMeshes.join(', ')}], ` +
                                `Camera valid: ${lastResult.cameraValid}`
                        )
                    );
                    return;
                }

                // 다음 프레임에서 재시도
                console.log('[RenderReadyBarrier] RETRY', {
                    retryCount,
                    activeMeshCount: result.activeMeshCount,
                    reason: result.reason,
                });

                this.scheduleRetry(checkFrame, retryFrameInterval);
            };

            // 첫 프레임 렌더 후 검증 시작
            this.scene.onAfterRenderObservable.addOnce(() => {
                checkFrame();
            });
        });
    }

    /**
     * 단일 프레임 검증
     */
    private validateFrame(options: {
        requiredMeshNames: string[];
        minActiveMeshCount: number;
        requireCameraRender: boolean;
    }): FrameValidationResult {
        const { requiredMeshNames, minActiveMeshCount, requireCameraRender } = options;

        // 1. Camera validation
        let cameraValid = true;
        if (requireCameraRender) {
            const cam = this.scene.activeCamera;
            if (!cam) {
                return {
                    result: BarrierResult.RETRY,
                    activeMeshCount: 0,
                    missingMeshes: [],
                    cameraValid: false,
                    reason: 'No active camera',
                };
            }

            // Camera position 검증
            const pos = cam.position;
            if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) {
                return {
                    result: BarrierResult.RETRY,
                    activeMeshCount: 0,
                    missingMeshes: [],
                    cameraValid: false,
                    reason: 'Camera position invalid',
                };
            }

            // ViewMatrix 검증
            try {
                const viewMatrix = cam.getViewMatrix();
                if (!viewMatrix || viewMatrix.m.some((v) => !isFinite(v))) {
                    cameraValid = false;
                }
            } catch {
                cameraValid = false;
            }

            if (!cameraValid) {
                return {
                    result: BarrierResult.RETRY,
                    activeMeshCount: 0,
                    missingMeshes: [],
                    cameraValid: false,
                    reason: 'Camera view matrix invalid',
                };
            }
        }

        // 2. Active mesh count 검증
        const activeMeshes = this.scene.getActiveMeshes();
        const activeMeshCount = activeMeshes.length;

        if (activeMeshCount < minActiveMeshCount) {
            return {
                result: BarrierResult.RETRY,
                activeMeshCount,
                missingMeshes: [],
                cameraValid,
                reason: `Active mesh count ${activeMeshCount} < ${minActiveMeshCount}`,
            };
        }

        // 3. Required mesh 검증
        const activeMeshNames = new Set<string>();
        for (let i = 0; i < activeMeshes.length; i++) {
            const mesh = activeMeshes.data[i];
            if (mesh?.name) {
                activeMeshNames.add(mesh.name);
            }
        }

        const missingMeshes = requiredMeshNames.filter((name) => !activeMeshNames.has(name));

        if (missingMeshes.length > 0) {
            return {
                result: BarrierResult.RETRY,
                activeMeshCount,
                missingMeshes,
                cameraValid,
                reason: `Missing required meshes: ${missingMeshes.join(', ')}`,
            };
        }

        // 모든 검증 통과
        return {
            result: BarrierResult.SUCCESS,
            activeMeshCount,
            missingMeshes: [],
            cameraValid,
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
