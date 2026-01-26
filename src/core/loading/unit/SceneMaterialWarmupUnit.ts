/**
 * SceneMaterialWarmupUnit - Comprehensive Scene Material Warm-up
 *
 * PURPOSE:
 * Pre-compile ALL materials in the scene before first render.
 * This is part of the Active Engagement Strategy (🅰️+) to ensure
 * GPU shaders are compiled and the GPU scheduler treats this tab
 * as an active graphics application.
 *
 * WHAT IT WARMS:
 * 1. All materials in scene.materials
 * 2. Materials attached to meshes (including internal LinesMesh materials)
 * 3. Materials from loaded GLB/GLTF models (PBR materials)
 * 4. Custom effect materials (e.g., hologram effects)
 *
 * HOW IT WORKS:
 * - Iterates through all meshes and collects unique materials
 * - For each material: await material.forceCompilationAsync(mesh)
 * - Uses task fragmentation (setTimeout) to prevent RAF throttling
 * - Does NOT dispose materials (they're used in scene)
 *
 * IMPORTANT:
 * - This must run AFTER meshes are loaded (BUILDING phase complete)
 * - Uses the actual meshes as compilation targets (not dummy spheres)
 * - LinesMesh materials require special handling
 *
 * @see docs/babylon_rendering_rules.md
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress } from './LoadUnit';
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
 * SceneMaterialWarmupUnit
 *
 * Warms up all materials in the scene by forcing async shader compilation.
 */
export class SceneMaterialWarmupUnit extends BaseLoadUnit {
    readonly id: string;
    readonly phase = LoadingPhase.WARMING;
    readonly requiredForReady: boolean;

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

    protected async doLoad(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        this.warmedMaterials.clear();
        this.warmedCount = 0;
        this.skippedCount = 0;
        this.failedCount = 0;

        // Collect all unique material-mesh pairs
        const targets = this.collectWarmupTargets(scene);

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

        for (let i = 0; i < total; i++) {
            const target = targets[i];
            const success = await this.warmupMaterial(target);

            if (success) {
                this.warmedCount++;
            } else {
                this.failedCount++;
            }

            onProgress?.({
                progress: (i + 1) / total,
                message: `Compiled ${i + 1}/${total}: ${target.material.name}`,
            });

            // Task fragmentation: yield to browser between shader compilations
            // This prevents main thread congestion that triggers RAF throttling
            await new Promise<void>((r) => setTimeout(r, 0));
        }

        if (this.config.debug) {
            console.log(
                `[SceneMaterialWarmup] Complete: ` +
                `warmed=${this.warmedCount}, skipped=${this.skippedCount}, failed=${this.failedCount}`
            );
        }
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
}
