/**
 * VisualReadyUnit - Visual Readiness Verification System.
 *
 * [TacticalGrid Incident Prevention - Constitutional Amendment]
 *
 * This unit explicitly validates that user-visible core visuals are
 * ACTUALLY VISIBLE before allowing scene transition.
 *
 * Constitutional Contract:
 *
 *   A LoadUnit must never validate "visibility by timing".
 *   READY means:
 *     The user cannot visually distinguish this state
 *     from a fully playable scene.
 *
 *   100% does not mean "done".
 *   It means "safe to transition".
 *
 * [VALIDATION MUST CHECK]
 * - mesh.isEnabled()
 * - mesh.isVisible
 * - mesh.visibility > 0
 * - boundingInfo exists
 * - mesh is part of scene.meshes
 *
 * [VALIDATION MUST NEVER CHECK]
 * - "rendered at least once"
 * - "after X ms"
 * - "activeMeshes length > 0"
 * - Any timing-based heuristic
 */

import * as BABYLON from '@babylonjs/core';
import { LoadUnit, LoadUnitStatus, LoadUnitProgress } from './LoadUnit';
import { LoadingPhase } from '../protocol/LoadingPhase';

/**
 * Visual requirement specification
 */
export interface VisualRequirement {
    /** Unique identifier for this requirement */
    id: string;

    /** Human-readable name for progress display */
    displayName: string;

    /**
     * Optional: Attach render observers to track actual rendering.
     * Called once when VisualReadyUnit starts loading.
     * Use this to set up onAfterRenderObservable hooks.
     */
    attach?: (scene: BABYLON.Scene) => void;

    /**
     * Optional: Detach render observers.
     * Called when VisualReadyUnit completes or fails.
     */
    detach?: (scene: BABYLON.Scene) => void;

    /**
     * Validation function that checks if this visual is ready.
     *
     * [VISUAL_READY Phase - Actual Render Check]
     * "Scene에 존재"가 아니라 "카메라에 렌더링됨"을 확인.
     *
     * MUST check:
     * - Has mesh been rendered in camera frustum at least once?
     *
     * MUST NOT check:
     * - activeMeshes inclusion (indirect indicator)
     * - timing-based conditions
     * - stability / consecutive frames (STABILIZING_100 responsibility)
     */
    validate: (scene: BABYLON.Scene) => VisualValidationResult;
}

/**
 * Visual validation result
 */
export interface VisualValidationResult {
    /** Is this visual ready? */
    ready: boolean;

    /** Reason if not ready (for debugging) */
    reason?: string;
}

/**
 * Standard mesh visibility check
 *
 * [검증 항목]
 * ✓ mesh 존재
 * ✓ mesh.isEnabled()
 * ✓ mesh.isVisible
 * ✓ mesh.visibility > 0
 * ✓ scene.meshes.includes(mesh)
 * ✓ boundingInfo exists
 *
 * [검증 제외]
 * ✗ activeMeshes
 * ✗ timing
 */
export function createMeshVisualRequirement(
    meshName: string,
    displayName?: string
): VisualRequirement {
    return {
        id: `mesh:${meshName}`,
        displayName: displayName ?? meshName,
        validate: (scene: BABYLON.Scene): VisualValidationResult => {
            const mesh = scene.getMeshByName(meshName);

            if (!mesh) {
                return { ready: false, reason: `Mesh '${meshName}' not found` };
            }

            if (mesh.isDisposed()) {
                return { ready: false, reason: `Mesh '${meshName}' is disposed` };
            }

            if (!scene.meshes.includes(mesh)) {
                return { ready: false, reason: `Mesh '${meshName}' not in scene.meshes` };
            }

            if (!mesh.isEnabled()) {
                return { ready: false, reason: `Mesh '${meshName}' is not enabled` };
            }

            if (!mesh.isVisible) {
                return { ready: false, reason: `Mesh '${meshName}' isVisible = false` };
            }

            if (mesh.visibility <= 0) {
                return { ready: false, reason: `Mesh '${meshName}' visibility = ${mesh.visibility}` };
            }

            // BoundingInfo check (for spatial presence)
            if (!mesh.getBoundingInfo()) {
                return { ready: false, reason: `Mesh '${meshName}' has no boundingInfo` };
            }

            return { ready: true };
        },
    };
}

/**
 * Custom predicate-based visual requirement
 */
export function createCustomVisualRequirement(
    id: string,
    displayName: string,
    predicate: (scene: BABYLON.Scene) => boolean,
    failReason?: string
): VisualRequirement {
    return {
        id,
        displayName,
        validate: (scene: BABYLON.Scene): VisualValidationResult => {
            const ready = predicate(scene);
            return {
                ready,
                reason: ready ? undefined : (failReason ?? 'Custom predicate failed'),
            };
        },
    };
}

/**
 * VisualReadyUnit configuration
 */
export interface VisualReadyUnitConfig {
    /** Visual requirements to validate */
    requirements: VisualRequirement[];

    /** Display name for progress UI */
    displayName?: string;

    /** Maximum validation attempts before failure */
    maxAttempts?: number;

    /** Delay between validation attempts (ms) */
    attemptDelayMs?: number;
}

/**
 * VisualReadyUnit - Validates all visual requirements are met.
 *
 * Phase: VISUAL_READY
 *
 * This unit is responsible for ensuring that all user-visible core visuals
 * are actually visible before allowing scene transition.
 */
export class VisualReadyUnit implements LoadUnit {
    readonly id: string;
    readonly phase: LoadingPhase = LoadingPhase.VISUAL_READY;
    readonly requiredForReady: boolean = true;

    status: LoadUnitStatus = LoadUnitStatus.PENDING;
    elapsedMs?: number;
    error?: Error;

    private config: VisualReadyUnitConfig;
    private validatedRequirements: Set<string> = new Set();
    private displayName: string;

    constructor(id: string = 'visual-ready', config: VisualReadyUnitConfig) {
        this.id = id;
        this.displayName = config.displayName ?? 'Verifying Visuals';
        this.config = {
            maxAttempts: 30,
            attemptDelayMs: 50,
            ...config,
        };
    }

    /**
     * Get display name for UI
     */
    getDisplayName(): string {
        return this.displayName;
    }

    /**
     * Execute visual validation for all requirements
     *
     * [VISUAL_READY Phase - Actual Render Detection]
     * "Scene에 존재"가 아니라 "카메라에 렌더링됨"을 확인.
     * attach()로 렌더 옵저버 등록 → validate()로 렌더 여부 확인 → detach()로 정리
     */
    async load(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        if (this.status === LoadUnitStatus.VALIDATED) {
            return;
        }

        this.status = LoadUnitStatus.LOADING;
        this.validatedRequirements.clear();
        const startTime = performance.now();

        const requirements = this.config.requirements;
        const maxAttempts = this.config.maxAttempts!;
        const attemptDelayMs = this.config.attemptDelayMs!;

        // [Step 1] Attach render observers for all requirements
        for (const req of requirements) {
            try {
                req.attach?.(scene);
            } catch (err) {
                console.warn(`[VisualReadyUnit] Failed to attach ${req.id}:`, err);
            }
        }

        let attempt = 0;

        try {
            while (attempt < maxAttempts) {
                attempt++;

                const pendingRequirements: VisualRequirement[] = [];
                let allReady = true;

                for (const req of requirements) {
                    if (this.validatedRequirements.has(req.id)) {
                        continue;
                    }

                    const result = req.validate(scene);

                    if (result.ready) {
                        this.validatedRequirements.add(req.id);
                        console.log(`[VisualReadyUnit] ✓ ${req.displayName} rendered`);
                    } else {
                        pendingRequirements.push(req);
                        allReady = false;

                        if (attempt === 1 || attempt % 10 === 0) {
                            console.log(`[VisualReadyUnit] ⏳ ${req.displayName}: ${result.reason}`);
                        }
                    }
                }

                const progress = this.validatedRequirements.size / requirements.length;
                onProgress?.({
                    progress,
                    message: allReady
                        ? 'All visuals rendered'
                        : `Waiting: ${pendingRequirements[0]?.displayName ?? 'visuals'}`,
                });

                if (allReady) {
                    // [Step 2] Detach observers on success
                    this.detachRequirements(scene, requirements);

                    this.status = LoadUnitStatus.VALIDATED;
                    this.elapsedMs = performance.now() - startTime;
                    console.log(
                        `[VisualReadyUnit] All ${requirements.length} requirements rendered ` +
                        `in ${attempt} attempts, ${Math.round(this.elapsedMs)}ms`
                    );
                    return;
                }

                await this.delay(attemptDelayMs);
            }

            // [Step 2] Detach observers on failure
            this.detachRequirements(scene, requirements);

            // Max attempts reached - EXPLICIT FAILURE
            const pendingNames = this.config.requirements
                .filter((r) => !this.validatedRequirements.has(r.id))
                .map((r) => r.displayName)
                .join(', ');

            this.status = LoadUnitStatus.FAILED;
            this.elapsedMs = performance.now() - startTime;
            this.error = new Error(
                `[VisualReadyUnit] VISUAL_READY FAILED: ${pendingNames} not rendered after ${maxAttempts} attempts`
            );
            throw this.error;
        } catch (err) {
            // Ensure cleanup on error
            this.detachRequirements(scene, requirements);

            this.elapsedMs = performance.now() - startTime;
            if (!(err instanceof Error && err === this.error)) {
                this.error = err instanceof Error ? err : new Error(String(err));
            }
            this.status = LoadUnitStatus.FAILED;
            throw this.error;
        }
    }

    /**
     * Detach render observers from all requirements
     */
    private detachRequirements(scene: BABYLON.Scene, requirements: VisualRequirement[]): void {
        for (const req of requirements) {
            try {
                req.detach?.(scene);
            } catch (err) {
                console.warn(`[VisualReadyUnit] Failed to detach ${req.id}:`, err);
            }
        }
    }

    /**
     * Validate that all requirements are still met
     */
    validate(scene: BABYLON.Scene): boolean {
        // Re-validate all requirements
        for (const req of this.config.requirements) {
            const result = req.validate(scene);
            if (!result.ready) {
                console.warn(`[VisualReadyUnit] Validation failed: ${req.displayName} - ${result.reason}`);
                return false;
            }
        }
        return true;
    }

    /**
     * Get validated requirement count
     */
    getValidatedCount(): number {
        return this.validatedRequirements.size;
    }

    /**
     * Get total requirement count
     */
    getTotalCount(): number {
        return this.config.requirements.length;
    }

    /**
     * Reset unit state
     */
    reset(): void {
        this.status = LoadUnitStatus.PENDING;
        this.elapsedMs = undefined;
        this.error = undefined;
        this.validatedRequirements.clear();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.validatedRequirements.clear();
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

/**
 * Factory for creating TacticalGrid visual requirement
 *
 * [VISUAL_READY Phase - Actual Render Detection]
 *
 * ❗ "Scene에 존재"가 아니라 "카메라에 렌더링됨"을 확인
 * ❗ Scene Explorer 기준 완전 배제
 * ❗ 안정성/완성도 검증은 STABILIZING_100에서 수행
 *
 * 검증 로직:
 * 1. attach(): onAfterRenderObservable로 렌더 감시 시작
 * 2. validate(): "한 번이라도 카메라 frustum 내에서 렌더되었는가?"
 * 3. detach(): 옵저버 정리
 *
 * 이 조건만 충족하면 PASS:
 * ✓ mesh가 카메라 frustum 내에서 최소 1회 렌더됨
 *
 * ❌ 다음은 VISUAL_READY에서 검사하지 않음 (STABILIZING_100 책임):
 * - 연속 프레임 안정성
 * - bounds 크기 안정성
 * - material warmup
 */
export function createTacticalGridVisualRequirement(): VisualRequirement {
    // Closure state for render tracking
    let seenInRender = false;
    let observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    return {
        id: 'visual:TacticalGrid',
        displayName: 'Tactical Grid',

        attach(scene: BABYLON.Scene): void {
            // Reset state
            seenInRender = false;

            // Watch for actual rendering
            observer = scene.onAfterRenderObservable.add(() => {
                if (seenInRender) return; // Already confirmed

                const mesh = scene.getMeshByName('TacticalGrid');
                if (!mesh || mesh.isDisposed()) return;

                const camera = scene.activeCamera;
                if (!camera) return;

                // Check if mesh is in renderable state
                if (!mesh.isEnabled() || !mesh.isVisible) return;

                // Check if mesh is in camera frustum
                const boundingInfo = mesh.getBoundingInfo();
                if (!boundingInfo) return;

                try {
                    // isInFrustum checks if bounding box intersects camera frustum
                    const frustumPlanes = scene.frustumPlanes;

                    if (frustumPlanes && frustumPlanes.length > 0 && boundingInfo.isInFrustum(frustumPlanes)) {
                        seenInRender = true;
                        console.log('[TacticalGridVisualRequirement] ✓ Rendered in camera frustum');
                    }
                } catch {
                    // Fallback: if frustum check fails, check if mesh was in activeMeshes
                    // This is a safety net, not the primary check
                    const activeMeshes = scene.getActiveMeshes();
                    if (activeMeshes.data.includes(mesh)) {
                        seenInRender = true;
                        console.log('[TacticalGridVisualRequirement] ✓ Found in activeMeshes (fallback)');
                    }
                }
            });

            console.log('[TacticalGridVisualRequirement] Attached render observer');
        },

        detach(scene: BABYLON.Scene): void {
            if (observer) {
                scene.onAfterRenderObservable.remove(observer);
                observer = null;
                console.log('[TacticalGridVisualRequirement] Detached render observer');
            }
        },

        validate(_scene: BABYLON.Scene): VisualValidationResult {
            if (!seenInRender) {
                return {
                    ready: false,
                    reason: 'TacticalGrid not yet rendered in camera frustum',
                };
            }

            // ✅ VISUAL_READY 통과 - "최소 1회 렌더됨"
            return { ready: true };
        },
    };
}
