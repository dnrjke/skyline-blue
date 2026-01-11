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
     * Validation function that checks if this visual is ready.
     *
     * MUST check:
     * - mesh.isEnabled()
     * - mesh.isVisible
     * - mesh.visibility > 0
     * - boundingInfo exists (for mesh requirements)
     * - mesh is part of scene.meshes
     *
     * MUST NOT check:
     * - activeMeshes inclusion
     * - timing-based conditions
     * - "rendered at least once"
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

        let attempt = 0;

        try {
            while (attempt < maxAttempts) {
                attempt++;

                // Validate all requirements
                const pendingRequirements: VisualRequirement[] = [];
                let allReady = true;

                for (const req of requirements) {
                    if (this.validatedRequirements.has(req.id)) {
                        continue; // Already validated
                    }

                    const result = req.validate(scene);
                    if (result.ready) {
                        this.validatedRequirements.add(req.id);
                        console.log(`[VisualReadyUnit] ✓ ${req.displayName} ready`);
                    } else {
                        pendingRequirements.push(req);
                        allReady = false;

                        if (attempt === 1 || attempt % 10 === 0) {
                            console.log(`[VisualReadyUnit] ⏳ ${req.displayName}: ${result.reason}`);
                        }
                    }
                }

                // Report progress
                const progress = this.validatedRequirements.size / requirements.length;
                onProgress?.({
                    progress,
                    message: allReady
                        ? 'All visuals ready'
                        : `Verifying: ${pendingRequirements[0]?.displayName ?? 'visuals'}`,
                });

                if (allReady) {
                    this.status = LoadUnitStatus.VALIDATED;
                    this.elapsedMs = performance.now() - startTime;
                    console.log(`[VisualReadyUnit] All ${requirements.length} requirements validated in ${attempt} attempts, ${Math.round(this.elapsedMs)}ms`);
                    return;
                }

                // Wait before next attempt
                await this.delay(attemptDelayMs);
            }

            // Max attempts reached - report failure
            const pendingNames = this.config.requirements
                .filter((r) => !this.validatedRequirements.has(r.id))
                .map((r) => r.displayName)
                .join(', ');

            this.status = LoadUnitStatus.FAILED;
            this.elapsedMs = performance.now() - startTime;
            this.error = new Error(
                `[VisualReadyUnit] Failed after ${maxAttempts} attempts. ` +
                `Pending: ${pendingNames}`
            );
            throw this.error;
        } catch (err) {
            this.elapsedMs = performance.now() - startTime;
            if (!(err instanceof Error && err === this.error)) {
                this.error = err instanceof Error ? err : new Error(String(err));
            }
            this.status = LoadUnitStatus.FAILED;
            throw this.error;
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
 */
export function createTacticalGridVisualRequirement(): VisualRequirement {
    return {
        id: 'visual:TacticalGrid',
        displayName: 'Tactical Grid',
        validate: (scene: BABYLON.Scene): VisualValidationResult => {
            const mesh = scene.getMeshByName('TacticalGrid');

            if (!mesh) {
                return { ready: false, reason: 'TacticalGrid mesh not found' };
            }

            if (mesh.isDisposed()) {
                return { ready: false, reason: 'TacticalGrid is disposed' };
            }

            if (!scene.meshes.includes(mesh)) {
                return { ready: false, reason: 'TacticalGrid not in scene.meshes' };
            }

            // TacticalGrid uses isEnabled() for visibility control
            if (!mesh.isEnabled()) {
                return { ready: false, reason: 'TacticalGrid is not enabled' };
            }

            // isVisible must be true
            if (!mesh.isVisible) {
                return { ready: false, reason: 'TacticalGrid isVisible = false' };
            }

            // visibility must be > 0 (no longer allowing 0 for VISUAL_READY phase)
            if (mesh.visibility <= 0) {
                return { ready: false, reason: `TacticalGrid visibility = ${mesh.visibility}` };
            }

            // Geometry check
            if (mesh.getTotalVertices() <= 0) {
                return { ready: false, reason: 'TacticalGrid has no vertices' };
            }

            return { ready: true };
        },
    };
}
