/**
 * SceneMaterialWarmupUnit - Comprehensive Scene Material Warm-up (Pure Generator Version)
 *
 * The Pure Generator Manifesto 준수:
 * - AsyncGenerator로 완전 전환
 * - forceCompilationAsync 후 Recovery Frame 배치
 * - 모든 루프는 while(ctx.isHealthy()) 패턴
 * - 절대 batch compile 금지 (material 단위 컴파일)
 *
 * PURPOSE:
 * Pre-compile ALL materials in the scene before first render.
 * This is part of the Active Engagement Strategy (🅰️+) to ensure
 * GPU shaders are compiled and the GPU scheduler treats this tab
 * as an active graphics application.
 *
 * @see docs/babylon_rendering_rules.md
 */

import * as BABYLON from '@babylonjs/core';
import {
    BaseSlicedLoadUnit,
    type LoadUnitCost,
} from '../executor/SlicedLoadUnit';
import type { LoadExecutionContext } from '../executor/LoadExecutionContext';
import { LoadUnitProgress, LoadUnitStatus } from './LoadUnit';
import { LoadingPhase } from '../protocol/LoadingPhase';

export interface SceneMaterialWarmupConfig {
    /** Unit ID (default: 'SceneMaterialWarmup') */
    id?: string;

    /** Required for READY (default: true) */
    requiredForReady?: boolean;

    /** Maximum materials to warm (default: 100, safety limit) */
    maxMaterials?: number;

    /** Exclude materials by name pattern (regex) */
    excludePattern?: RegExp;

    /** Enable verbose logging (default: false) */
    debug?: boolean;
}

interface WarmupTarget {
    material: BABYLON.Material;
    mesh: BABYLON.AbstractMesh;
    source: 'mesh' | 'scene' | 'effect';
}

/**
 * SceneMaterialWarmupUnit (Pure Generator Version)
 *
 * ⚠️ HEAVY 유닛: shader 컴파일은 GPU 블로킹이므로
 * 각 material 후 budget 체크 및 주기적 Recovery Frame 배치
 */
export class SceneMaterialWarmupUnit extends BaseSlicedLoadUnit {
    readonly id: string;
    readonly phase = LoadingPhase.WARMING;
    readonly requiredForReady: boolean;
    readonly estimateCost: LoadUnitCost = 'HEAVY';

    private config: Required<SceneMaterialWarmupConfig>;
    private warmedMaterials: Set<string> = new Set();
    private warmedCount: number = 0;
    private skippedCount: number = 0;
    private failedCount: number = 0;

    constructor(config: SceneMaterialWarmupConfig = {}) {
        super();
        this.config = {
            id: config.id ?? 'SceneMaterialWarmup',
            requiredForReady: config.requiredForReady ?? true,
            maxMaterials: config.maxMaterials ?? 100,
            excludePattern: config.excludePattern ?? /^__.*Warmup__$/,
            debug: config.debug ?? false,
        };
        this.id = this.config.id;
        this.requiredForReady = this.config.requiredForReady;
    }

    /**
     * Time-Sliced 실행 (Pure Generator)
     *
     * 구조:
     * 1. 타겟 수집 (빠름, 한 번에)
     * 2. Material 컴파일 (while ctx.isHealthy() 루프)
     *    - 각 material 후 yield
     *    - 5개마다 Recovery Frame
     */
    async *executeSteps(
        scene: BABYLON.Scene,
        ctx: LoadExecutionContext,
        onProgress?: (progress: LoadUnitProgress) => void
    ): AsyncGenerator<void, void, void> {
        this.warmedMaterials.clear();
        this.warmedCount = 0;
        this.skippedCount = 0;
        this.failedCount = 0;

        onProgress?.({ progress: 0, message: 'Collecting materials...' });
        yield; // 시작 지점

        // ========================================
        // Phase 1: 타겟 수집 (동기, 빠름)
        // ========================================
        console.log('[SceneMaterialWarmup] Phase 1: Collecting targets...');
        performance.mark('warmup-collect-start');

        const targets = this.collectWarmupTargets(scene);

        performance.mark('warmup-collect-end');
        performance.measure('warmup-collect', 'warmup-collect-start', 'warmup-collect-end');
        const collectMeasure = performance.getEntriesByName('warmup-collect', 'measure')[0] as PerformanceMeasure;
        const collectBlockingFlag = collectMeasure.duration > 50 ? ' ⚠️ BLOCKING' : '';
        console.log(`[SceneMaterialWarmup] Collected ${targets.length} targets: ${collectMeasure.duration.toFixed(1)}ms${collectBlockingFlag}`);

        yield; // 타겟 수집 완료

        if (targets.length === 0) {
            if (this.config.debug) {
                console.log('[SceneMaterialWarmup] No materials to warm up');
            }
            onProgress?.({ progress: 1, message: 'No materials found' });
            return;
        }

        const total = Math.min(targets.length, this.config.maxMaterials);

        if (this.config.debug) {
            console.log(`[SceneMaterialWarmup] Warming ${total} materials...`);
        }

        // ========================================
        // Phase 2: Material 컴파일 (while ctx.isHealthy() 루프)
        // ========================================
        console.log('[SceneMaterialWarmup] Phase 2: Compiling materials...');
        onProgress?.({ progress: 0.1, message: 'Compiling shaders...' });

        let index = 0;
        let compiledInBatch = 0;

        while (index < total) {
            // Budget 체크: 초과 시 루프 탈출 → yield → 다음 프레임에 재개
            if (!ctx.isHealthy()) {
                yield;
            }

            const target = targets[index];
            const success = await this.warmupMaterial(target);

            if (success) {
                this.warmedCount++;
            } else {
                this.failedCount++;
            }

            index++;
            compiledInBatch++;

            // Progress 업데이트
            const progress = 0.1 + (index / total) * 0.85;
            onProgress?.({
                progress,
                message: `Compiled ${index}/${total}: ${target.material.name}`,
            });

            yield; // 각 material 컴파일 후 yield

            // ⚠️ CRITICAL: 5개마다 Recovery Frame
            // GPU 업로드 직후 브라우저 안정화
            if (compiledInBatch >= 5) {
                console.log(`[SceneMaterialWarmup] Recovery after ${compiledInBatch} materials...`);
                await ctx.requestRecoveryFrames(1);
                compiledInBatch = 0;
                yield;
            }
        }

        // ========================================
        // 완료
        // ========================================
        onProgress?.({ progress: 1, message: 'Warmup complete' });
        console.log(
            `[SceneMaterialWarmup] ✅ Complete: ` +
            `warmed=${this.warmedCount}, skipped=${this.skippedCount}, failed=${this.failedCount}`
        );

        yield; // 최종 yield
    }

    validate(_scene: BABYLON.Scene): boolean {
        // Warm-up success means loading succeeded
        return true;
    }

    /**
     * Get warm-up statistics.
     */
    getStats(): { warmed: number; skipped: number; failed: number } {
        return {
            warmed: this.warmedCount,
            skipped: this.skippedCount,
            failed: this.failedCount,
        };
    }

    // ========================================
    // Private
    // ========================================

    /**
     * Collect all unique material-mesh pairs from the scene.
     */
    private collectWarmupTargets(scene: BABYLON.Scene): WarmupTarget[] {
        const targets: WarmupTarget[] = [];
        const seenMaterialIds = new Set<string>();

        // 1. Collect from meshes (most reliable - materials in their render context)
        for (const mesh of scene.meshes) {
            if (mesh.isDisposed()) continue;

            const material = mesh.material;
            if (!material) continue;

            const matId = material.uniqueId?.toString() ?? material.name;
            if (seenMaterialIds.has(matId)) continue;
            if (this.config.excludePattern.test(material.name)) {
                this.skippedCount++;
                continue;
            }

            seenMaterialIds.add(matId);
            targets.push({
                material,
                mesh: mesh as BABYLON.AbstractMesh,
                source: 'mesh',
            });
        }

        // 2. Collect from scene.materials (may include orphaned materials)
        for (const material of scene.materials) {

            const matId = material.uniqueId?.toString() ?? material.name;
            if (seenMaterialIds.has(matId)) continue;
            if (this.config.excludePattern.test(material.name)) {
                this.skippedCount++;
                continue;
            }

            // Find any mesh that could be used for compilation
            const anyMesh = scene.meshes.find(
                m => !m.isDisposed() && m.material === material
            );

            if (anyMesh) {
                seenMaterialIds.add(matId);
                targets.push({
                    material,
                    mesh: anyMesh as BABYLON.AbstractMesh,
                    source: 'scene',
                });
            }
        }

        // 3. Handle MultiMaterial (compound materials)
        for (const mesh of scene.meshes) {
            if (mesh.isDisposed()) continue;

            const material = mesh.material;
            if (!material) continue;
            if (!(material instanceof BABYLON.MultiMaterial)) continue;

            for (const subMat of material.subMaterials) {
                if (!subMat) continue;

                const matId = subMat.uniqueId?.toString() ?? subMat.name;
                if (seenMaterialIds.has(matId)) continue;
                if (this.config.excludePattern.test(subMat.name)) {
                    this.skippedCount++;
                    continue;
                }

                seenMaterialIds.add(matId);
                targets.push({
                    material: subMat,
                    mesh: mesh as BABYLON.AbstractMesh,
                    source: 'mesh',
                });
            }
        }

        return targets;
    }

    /**
     * Warm up a single material.
     */
    private async warmupMaterial(
        target: WarmupTarget
    ): Promise<boolean> {
        const { material, mesh } = target;

        try {
            // Check if material has forceCompilationAsync
            if (typeof material.forceCompilationAsync !== 'function') {
                // Some materials (like line materials) may not support this
                // Try isReady() fallback
                if (typeof material.isReady === 'function') {
                    material.isReady(mesh as BABYLON.Mesh, true);
                    if (this.config.debug) {
                        console.log(`[SceneMaterialWarmup] isReady fallback: ${material.name}`);
                    }
                }
                return true;
            }

            // Force async compilation
            await material.forceCompilationAsync(mesh as BABYLON.Mesh);

            if (this.config.debug) {
                console.log(`[SceneMaterialWarmup] Compiled: ${material.name}`);
            }

            this.warmedMaterials.add(material.name);
            return true;
        } catch (err) {
            // Material compilation can fail for various reasons
            // Log but don't fail the unit
            console.warn(
                `[SceneMaterialWarmup] Failed to compile ${material.name}:`,
                err instanceof Error ? err.message : err
            );
            return false;
        }
    }

    // ========================================
    // Factory Methods
    // ========================================

    /**
     * Create a unit for Navigation scene.
     * Focuses on grid materials, hologram effects, and character PBR.
     */
    static createForNavigation(): SceneMaterialWarmupUnit {
        return new SceneMaterialWarmupUnit({
            id: 'NavigationSceneMaterialWarmup',
            requiredForReady: true,
            debug: false,
        });
    }

    /**
     * Create a debug-enabled unit.
     */
    static createWithDebug(): SceneMaterialWarmupUnit {
        return new SceneMaterialWarmupUnit({
            id: 'SceneMaterialWarmup-Debug',
            requiredForReady: true,
            debug: true,
        });
    }

    override dispose(): void {
        this.warmedMaterials.clear();
        this.warmedCount = 0;
        this.skippedCount = 0;
        this.failedCount = 0;
        this.status = LoadUnitStatus.PENDING;
    }
}
