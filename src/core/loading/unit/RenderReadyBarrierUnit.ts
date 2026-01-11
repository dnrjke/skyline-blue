/**
 * RenderReadyBarrierUnit - First Frame Render Validation as a LoadUnit.
 *
 * This unit wraps RenderReadyBarrier to integrate with the LoadUnit architecture.
 *
 * Key Responsibilities:
 * - Wait for onAfterRenderObservable
 * - Validate: active mesh count > 0, required meshes present, camera valid
 * - Resolve only once (one-shot)
 * - BARRIER phase (70-100% in progress model)
 *
 * From Master Prompt:
 * "Loading completes only after first successful frame rendered (RenderReadyBarrier)"
 */

import * as BABYLON from '@babylonjs/core';
import { LoadUnit, LoadUnitStatus, LoadUnitProgress } from './LoadUnit';
import { LoadingPhase } from '../protocol/LoadingPhase';
import {
    RenderReadyBarrier,
    BarrierValidation,
    BarrierRequirement,
} from '../barrier/RenderReadyBarrier';

/**
 * RenderReadyBarrierUnit configuration
 */
export interface BarrierUnitConfig {
    /** Required mesh names (must be in active meshes) - 레거시 지원 */
    requiredMeshNames?: string[];

    /**
     * 필수 요구사항 (새로운 증거 기반 검증)
     *
     * 각 요구사항은 evidence 유형에 따라 다르게 검증됨:
     * - ACTIVE_MESH: Babylon activeMeshes에 포함
     * - VISIBLE_MESH: 커스텀 가시성 검증 (LinesMesh 등)
     * - CUSTOM: 완전 커스텀 predicate
     */
    requirements?: BarrierRequirement[];

    /** Minimum active mesh count (default: 1) */
    minActiveMeshCount?: number;

    /** Maximum retry frames (default: 15) */
    maxRetryFrames?: number;

    /** Require camera validation (default: true) */
    requireCameraRender?: boolean;

    /** Display name for UI */
    displayName?: string;
}

/**
 * RenderReadyBarrierUnit
 */
export class RenderReadyBarrierUnit implements LoadUnit {
    readonly id: string;
    readonly phase: LoadingPhase = LoadingPhase.BARRIER;
    readonly requiredForReady: boolean = true; // Always required

    status: LoadUnitStatus = LoadUnitStatus.PENDING;
    elapsedMs?: number;

    private barrier: RenderReadyBarrier | null = null;
    private config: BarrierUnitConfig;
    private displayName: string;
    private startTime: number = 0;

    constructor(id: string = 'render-ready-barrier', config: BarrierUnitConfig = {}) {
        this.id = id;
        this.config = config;
        this.displayName = config.displayName ?? 'Verifying Render Ready';
    }

    /**
     * Get display name for UI
     */
    getDisplayName(): string {
        return this.displayName;
    }

    /**
     * Execute first frame render validation
     */
    async load(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        if (this.status === LoadUnitStatus.VALIDATED) {
            // Already validated
            return;
        }

        this.startTime = performance.now();
        this.status = LoadUnitStatus.LOADING;
        this.barrier = new RenderReadyBarrier(scene);

        onProgress?.({
            progress: 0,
            message: 'Waiting for first frame render...',
        });

        const validation: BarrierValidation = {
            requiredMeshNames: this.config.requiredMeshNames,
            requirements: this.config.requirements,
            minActiveMeshCount: this.config.minActiveMeshCount ?? 1,
            maxRetryFrames: this.config.maxRetryFrames ?? 15,
            requireCameraRender: this.config.requireCameraRender ?? true,
        };

        try {
            await this.barrier.waitForFirstFrame(validation);

            this.status = LoadUnitStatus.VALIDATED;
            this.elapsedMs = performance.now() - this.startTime;

            onProgress?.({
                progress: 1,
                message: 'First frame rendered successfully',
            });

            console.log(`[RenderReadyBarrierUnit] Validated in ${Math.round(this.elapsedMs)}ms`);

        } catch (error) {
            this.status = LoadUnitStatus.FAILED;
            this.elapsedMs = performance.now() - this.startTime;
            throw error;
        }
    }

    /**
     * Validate that barrier passed (always true if VALIDATED status)
     */
    validate(_scene: BABYLON.Scene): boolean {
        return this.status === LoadUnitStatus.VALIDATED;
    }

    /**
     * Reset unit for reloading
     */
    reset(): void {
        this.status = LoadUnitStatus.PENDING;
        this.elapsedMs = undefined;
        this.barrier = null;
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this.barrier = null;
    }

    /**
     * Create a barrier unit for NavigationScene
     */
    static createForNavigation(config?: Partial<BarrierUnitConfig>): RenderReadyBarrierUnit {
        return new RenderReadyBarrierUnit('navigation-barrier', {
            displayName: 'Initializing Tactical View',
            minActiveMeshCount: 1,
            maxRetryFrames: 20,
            requireCameraRender: true,
            ...config,
        });
    }

    /**
     * Create a barrier unit for FlightScene
     */
    static createForFlight(config?: Partial<BarrierUnitConfig>): RenderReadyBarrierUnit {
        return new RenderReadyBarrierUnit('flight-barrier', {
            displayName: 'Preparing Flight View',
            minActiveMeshCount: 1,
            maxRetryFrames: 30, // Flight may need more frames
            requireCameraRender: true,
            ...config,
        });
    }
}
