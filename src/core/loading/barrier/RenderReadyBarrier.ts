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
 *
 * Arcana Evidence Model (Phase 2.5):
 * - Core visual = "렌더 파이프라인 진입 + 사용자에게 보일 수 있는 상태"
 * - activeMeshes는 증거 중 하나일 뿐, 유일 조건이 아님
 * - LinesMesh 등 frustum culling 제외 메시도 core visual일 수 있음
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
 * Barrier 증거 유형 (Evidence Type)
 *
 * - ACTIVE_MESH: Babylon activeMeshes에 포함 (frustum culled meshes)
 * - VISIBLE_MESH: 커스텀 가시성 검증 (LinesMesh 등 non-frustum-culled)
 * - CUSTOM: 완전 커스텀 predicate
 */
export type BarrierEvidence = 'ACTIVE_MESH' | 'VISIBLE_MESH' | 'CUSTOM';

/**
 * Barrier 요구사항 (개별 메시/요소 검증 조건)
 */
export interface BarrierRequirement {
    /** 식별자 (보통 메시 이름) */
    id: string;

    /** 증거 유형 */
    evidence: BarrierEvidence;

    /**
     * 커스텀 검증 함수 (VISIBLE_MESH, CUSTOM에서 사용)
     * - VISIBLE_MESH: 기본 가시성 체크에 추가 조건 가능
     * - CUSTOM: 완전히 커스텀 로직
     */
    predicate?: (scene: BABYLON.Scene) => boolean;
}

/**
 * Barrier 검증 옵션
 */
export interface BarrierValidation {
    /** 필수 메시 이름 (이 메시들이 active mesh에 포함되어야 함) - 레거시 지원 */
    requiredMeshNames?: string[];

    /** 필수 요구사항 (새로운 증거 기반 검증) */
    requirements?: BarrierRequirement[];

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
 * 실패한 요구사항 정보
 */
interface FailedRequirement {
    id: string;
    evidence: BarrierEvidence;
    reason: string;
}

/**
 * 단일 프레임 검증 결과
 */
interface FrameValidationResult {
    result: BarrierResult;
    activeMeshCount: number;
    missingMeshes: string[];
    failedRequirements: FailedRequirement[];
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
            requirements = [],
            minActiveMeshCount = 1,
            maxRetryFrames = 10,
            requireCameraRender = true,
            retryFrameInterval = 1,
        } = validation;

        // 레거시 requiredMeshNames를 requirements로 변환 (ACTIVE_MESH로)
        const allRequirements: BarrierRequirement[] = [
            ...requirements,
            ...requiredMeshNames.map((name) => ({
                id: name,
                evidence: 'ACTIVE_MESH' as BarrierEvidence,
            })),
        ];

        let retryCount = 0;
        let lastResult: FrameValidationResult | null = null;

        return new Promise((resolve, reject) => {
            const checkFrame = () => {
                // 프레임 검증 수행
                const result = this.validateFrame({
                    requirements: allRequirements,
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
                    const failedInfo = lastResult.failedRequirements
                        .map((f) => `${f.id}(${f.evidence}): ${f.reason}`)
                        .join(', ');
                    console.error('[RenderReadyBarrier] Max retries exceeded', {
                        maxRetryFrames,
                        lastResult,
                    });
                    reject(
                        new Error(
                            `Barrier timeout after ${maxRetryFrames} frames. ` +
                                `Active meshes: ${lastResult.activeMeshCount}, ` +
                                `Failed: [${failedInfo || lastResult.missingMeshes.join(', ')}], ` +
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
        requirements: BarrierRequirement[];
        minActiveMeshCount: number;
        requireCameraRender: boolean;
    }): FrameValidationResult {
        const { requirements, minActiveMeshCount, requireCameraRender } = options;

        // 1. Camera validation
        let cameraValid = true;
        if (requireCameraRender) {
            const cam = this.scene.activeCamera;
            if (!cam) {
                return {
                    result: BarrierResult.RETRY,
                    activeMeshCount: 0,
                    missingMeshes: [],
                    failedRequirements: [],
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
                    failedRequirements: [],
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
                    failedRequirements: [],
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
                failedRequirements: [],
                cameraValid,
                reason: `Active mesh count ${activeMeshCount} < ${minActiveMeshCount}`,
            };
        }

        // 3. Build active mesh name set for ACTIVE_MESH evidence
        const activeMeshNames = new Set<string>();
        for (let i = 0; i < activeMeshes.length; i++) {
            const mesh = activeMeshes.data[i];
            if (mesh?.name) {
                activeMeshNames.add(mesh.name);
            }
        }

        // 4. Requirements 검증 (evidence 유형별)
        const failedRequirements: FailedRequirement[] = [];
        const missingMeshes: string[] = [];

        for (const req of requirements) {
            const passed = this.checkRequirement(req, activeMeshNames);
            if (!passed.success) {
                failedRequirements.push({
                    id: req.id,
                    evidence: req.evidence,
                    reason: passed.reason,
                });
                // 레거시 호환을 위해 ACTIVE_MESH 실패는 missingMeshes에도 추가
                if (req.evidence === 'ACTIVE_MESH') {
                    missingMeshes.push(req.id);
                }
            }
        }

        if (failedRequirements.length > 0) {
            const reasons = failedRequirements.map((f) => `${f.id}(${f.evidence})`).join(', ');
            return {
                result: BarrierResult.RETRY,
                activeMeshCount,
                missingMeshes,
                failedRequirements,
                cameraValid,
                reason: `Failed requirements: ${reasons}`,
            };
        }

        // 모든 검증 통과
        return {
            result: BarrierResult.SUCCESS,
            activeMeshCount,
            missingMeshes: [],
            failedRequirements: [],
            cameraValid,
        };
    }

    /**
     * 개별 requirement 검증
     */
    private checkRequirement(
        req: BarrierRequirement,
        activeMeshNames: Set<string>
    ): { success: boolean; reason: string } {
        switch (req.evidence) {
            case 'ACTIVE_MESH':
                // 전통적 activeMeshes 검사
                if (activeMeshNames.has(req.id)) {
                    return { success: true, reason: '' };
                }
                return { success: false, reason: 'Not in active meshes' };

            case 'VISIBLE_MESH':
                // LinesMesh 등 non-frustum-culled 메시 검증
                return this.checkVisibleMesh(req);

            case 'CUSTOM':
                // 완전 커스텀 predicate
                if (req.predicate) {
                    const result = req.predicate(this.scene);
                    return {
                        success: result,
                        reason: result ? '' : 'Custom predicate failed',
                    };
                }
                return { success: false, reason: 'No predicate provided' };

            default:
                return { success: false, reason: `Unknown evidence type: ${req.evidence}` };
        }
    }

    /**
     * VISIBLE_MESH 증거 검증
     *
     * TacticalGrid 같은 LinesMesh는 activeMeshes에 안 들어가지만
     * 다음 조건을 만족하면 "보인다"로 간주:
     * - mesh 존재
     * - dispose 안 됨
     * - enabled = true
     * - visibility > 0
     * - layerMask가 카메라와 일치
     * - getTotalVertices() > 0 (실제 geometry 있음)
     */
    private checkVisibleMesh(req: BarrierRequirement): { success: boolean; reason: string } {
        const mesh = this.scene.getMeshByName(req.id);

        if (!mesh) {
            return { success: false, reason: 'Mesh not found' };
        }

        if (mesh.isDisposed()) {
            return { success: false, reason: 'Mesh disposed' };
        }

        if (!mesh.isEnabled()) {
            return { success: false, reason: 'Mesh not enabled' };
        }

        if (mesh.visibility <= 0) {
            return { success: false, reason: `Visibility is ${mesh.visibility}` };
        }

        if (mesh.getTotalVertices() <= 0) {
            return { success: false, reason: 'No vertices' };
        }

        // 카메라 layerMask 검증
        const cam = this.scene.activeCamera;
        if (cam && (cam.layerMask & mesh.layerMask) === 0) {
            return { success: false, reason: 'LayerMask mismatch with camera' };
        }

        // 커스텀 predicate가 있으면 추가 검증
        if (req.predicate && !req.predicate(this.scene)) {
            return { success: false, reason: 'Custom predicate failed' };
        }

        return { success: true, reason: '' };
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
