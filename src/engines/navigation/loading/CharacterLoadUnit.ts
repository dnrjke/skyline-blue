/**
 * CharacterLoadUnit - Phase 3 Character Loading
 *
 * Responsibilities:
 * - Load character .glb model
 * - Register animations
 * - Set initial state
 *
 * Integrates with LoadingProtocol (BUILDING phase)
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, type LoadUnitProgress, LoadUnitStatus } from '../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../core/loading/protocol/LoadingPhase';

export interface CharacterLoadUnitConfig {
    /** Path to character .glb file */
    modelPath: string;
    /** Character name (for mesh naming) */
    characterName?: string;
    /** Initial position */
    initialPosition?: BABYLON.Vector3;
    /** Initial scale */
    initialScale?: number;
}

/**
 * CharacterLoadUnit - loads and manages flight character
 *
 * LoadUnit Constitution:
 * - Phase: BUILDING
 * - Required: true (character is essential for flight)
 */
export class CharacterLoadUnit extends BaseLoadUnit {
    readonly id = 'nav-character';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = true;

    // Configuration
    private config: Required<CharacterLoadUnitConfig>;

    // Loaded assets
    private rootMesh: BABYLON.AbstractMesh | null = null;
    private meshes: BABYLON.AbstractMesh[] = [];
    private animationGroups: Map<string, BABYLON.AnimationGroup> = new Map();
    private skeletons: BABYLON.Skeleton[] = [];

    constructor(config: CharacterLoadUnitConfig) {
        super();
        this.config = {
            modelPath: config.modelPath,
            characterName: config.characterName ?? 'FlightCharacter',
            initialPosition: config.initialPosition ?? BABYLON.Vector3.Zero(),
            initialScale: config.initialScale ?? 1,
        };
    }

    /**
     * Load character model and animations
     */
    protected async doLoad(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        onProgress?.({ progress: 0, message: 'Loading character model...' });

        try {
            // Load .glb file using SceneLoader
            const result = await BABYLON.SceneLoader.ImportMeshAsync(
                '', // Load all meshes
                '', // Base URL (empty, path includes full path)
                this.config.modelPath,
                scene,
                (event) => {
                    if (event.lengthComputable) {
                        const progress = event.loaded / event.total;
                        onProgress?.({ progress: progress * 0.8, message: `Loading: ${Math.round(progress * 100)}%` });
                    }
                }
            );

            this.meshes = result.meshes;
            this.skeletons = result.skeletons;

            // Find root mesh
            this.rootMesh = this.meshes.find(m => m.parent === null) ?? this.meshes[0] ?? null;

            if (!this.rootMesh) {
                throw new Error('No root mesh found in character model');
            }

            // Setup root mesh
            this.rootMesh.name = this.config.characterName;
            this.rootMesh.position.copyFrom(this.config.initialPosition);
            this.rootMesh.scaling.setAll(this.config.initialScale);

            // Ensure rotationQuaternion is initialized
            this.rootMesh.rotationQuaternion = BABYLON.Quaternion.Identity();

            onProgress?.({ progress: 0.9, message: 'Registering animations...' });

            // Register animation groups
            for (const animGroup of result.animationGroups) {
                const name = animGroup.name;
                this.animationGroups.set(name, animGroup);
                // Stop all animations initially
                animGroup.stop();
                console.log(`[CharacterLoadUnit] Registered animation: ${name}`);
            }

            // Apply metadata for picking
            for (const mesh of this.meshes) {
                mesh.metadata = {
                    ...mesh.metadata,
                    isFlightCharacter: true,
                    characterName: this.config.characterName,
                };
            }

            onProgress?.({ progress: 1, message: 'Character loaded' });
            console.log(`[CharacterLoadUnit] Loaded ${this.meshes.length} meshes, ${this.animationGroups.size} animations`);

        } catch (err) {
            console.error('[CharacterLoadUnit] Failed to load character:', err);
            throw err;
        }
    }

    /**
     * Validate character is properly loaded
     */
    override validate(_scene: BABYLON.Scene): boolean {
        if (!this.rootMesh || this.rootMesh.isDisposed()) {
            console.warn('[CharacterLoadUnit] Validation failed: rootMesh not available');
            return false;
        }
        return true;
    }

    /**
     * Get the root mesh (for FlightController)
     */
    getCharacter(): BABYLON.AbstractMesh | null {
        return this.rootMesh;
    }

    /**
     * Get all loaded meshes
     */
    getMeshes(): BABYLON.AbstractMesh[] {
        return this.meshes;
    }

    /**
     * Get animation by name
     */
    getAnimation(name: string): BABYLON.AnimationGroup | null {
        return this.animationGroups.get(name) ?? null;
    }

    /**
     * Get all animation names
     */
    getAnimationNames(): string[] {
        return Array.from(this.animationGroups.keys());
    }

    /**
     * Play animation by name
     */
    playAnimation(name: string, loop: boolean = true): boolean {
        const animGroup = this.animationGroups.get(name);
        if (!animGroup) {
            console.warn(`[CharacterLoadUnit] Animation not found: ${name}`);
            return false;
        }

        // Stop all other animations
        for (const [, group] of this.animationGroups) {
            if (group !== animGroup) {
                group.stop();
            }
        }

        animGroup.start(loop);
        return true;
    }

    /**
     * Stop all animations
     */
    stopAllAnimations(): void {
        for (const [, group] of this.animationGroups) {
            group.stop();
        }
    }

    /**
     * Set character visibility
     */
    setVisibility(visible: boolean): void {
        if (this.rootMesh) {
            this.rootMesh.setEnabled(visible);
        }
    }

    /**
     * Set character position
     */
    setPosition(position: BABYLON.Vector3): void {
        if (this.rootMesh) {
            this.rootMesh.position.copyFrom(position);
        }
    }

    /**
     * Dispose all loaded resources
     */
    override dispose(): void {
        // Stop all animations
        this.stopAllAnimations();

        // Dispose animation groups
        for (const [, group] of this.animationGroups) {
            group.dispose();
        }
        this.animationGroups.clear();

        // Dispose skeletons
        for (const skeleton of this.skeletons) {
            skeleton.dispose();
        }
        this.skeletons = [];

        // Dispose meshes
        for (const mesh of this.meshes) {
            mesh.dispose();
        }
        this.meshes = [];
        this.rootMesh = null;

        this.status = LoadUnitStatus.PENDING;
    }
}
