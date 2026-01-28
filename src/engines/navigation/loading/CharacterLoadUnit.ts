/**
 * CharacterLoadUnit - Phase 3 Character Loading (Pure Generator Version)
 *
 * The Pure Generator Manifesto 준수:
 * - AsyncGenerator로 완전 전환
 * - SceneLoader.ImportMeshAsync 후 Recovery Frame 2개 배치
 * - 모든 루프는 while(ctx.isHealthy()) 패턴
 * - 각 논리적 작업 단위 후 yield
 *
 * Responsibilities:
 * - Load character .glb model
 * - Register animations
 * - Set initial state
 *
 * LoadUnit Constitution:
 * - Phase: BUILDING
 * - Required: true (character is essential for flight)
 * - EstimateCost: HEAVY (GLB 로딩 + 다수 애니메이션)
 */

import * as BABYLON from '@babylonjs/core';
import {
    BaseSlicedLoadUnit,
    type LoadUnitCost,
} from '../../../core/loading/executor/SlicedLoadUnit';
import type { LoadExecutionContext } from '../../../core/loading/executor/LoadExecutionContext';
import { LoadUnitProgress, LoadUnitStatus } from '../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../core/loading/protocol/LoadingPhase';

/**
 * Semantic animation roles for flight character
 */
export type FlightAnimationRole = 'flight' | 'boost' | 'rollLeft' | 'rollHold';

/**
 * Animation mapping: role -> actual animation name in GLB
 */
export interface AnimationMapping {
    /** Default flight animation */
    flight: string;
    /** Boost/acceleration animation */
    boost: string;
    /** Roll left action */
    rollLeft: string;
    /** Roll hold state */
    rollHold: string;
}

/**
 * Default animation mapping for pilot.glb
 * - Index 0: Anim_Idle_base = 기본비행
 * - Index 1: Anim_Idle_Windy = 가속모션
 * - Index 2: Anim_Lrow.002 = 롤링 상태 유지
 * - Index 3: Anim_Lrow.1 = 왼쪽 롤링
 */
const DEFAULT_ANIMATION_MAPPING: AnimationMapping = {
    flight: 'Anim_Idle_base',
    boost: 'Anim_Idle_Windy',
    rollLeft: 'Anim_Lrow.1',
    rollHold: 'Anim_Lrow.002',
};

export interface CharacterLoadUnitConfig {
    /** Path to character .glb file */
    modelPath: string;
    /** Character name (for mesh naming) */
    characterName?: string;
    /** Initial position */
    initialPosition?: BABYLON.Vector3;
    /** Initial scale */
    initialScale?: number;
    /** Custom animation mapping (optional) */
    animationMapping?: Partial<AnimationMapping>;
}

/**
 * CharacterLoadUnit - loads and manages flight character
 *
 * ⚠️ HEAVY 유닛: GLB 로딩은 Babylon 순수 블로킹이므로
 * Recovery Frame을 배치하여 브라우저 스케줄러를 안심시킨다.
 */
export class CharacterLoadUnit extends BaseSlicedLoadUnit {
    readonly id = 'nav-character';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = true;
    readonly estimateCost: LoadUnitCost = 'HEAVY';

    // Configuration
    private config: {
        modelPath: string;
        characterName: string;
        initialPosition: BABYLON.Vector3;
        initialScale: number;
    };

    // Animation mapping
    private animationMapping: AnimationMapping;

    // Loaded assets
    private rootMesh: BABYLON.AbstractMesh | null = null;
    private meshes: BABYLON.AbstractMesh[] = [];
    private animationGroups: Map<string, BABYLON.AnimationGroup> = new Map();
    private skeletons: BABYLON.Skeleton[] = [];

    // Current animation state
    private currentRole: FlightAnimationRole | null = null;

    constructor(config: CharacterLoadUnitConfig) {
        super();
        this.config = {
            modelPath: config.modelPath,
            characterName: config.characterName ?? 'FlightCharacter',
            initialPosition: config.initialPosition ?? BABYLON.Vector3.Zero(),
            initialScale: config.initialScale ?? 1,
        };
        this.animationMapping = {
            ...DEFAULT_ANIMATION_MAPPING,
            ...config.animationMapping,
        };
    }

    /**
     * Time-Sliced 실행 (Pure Generator)
     *
     * 구조:
     * 1. GLB 로딩 (Babylon 블로킹) → Recovery Frame 2개
     * 2. 애니메이션 등록 (while ctx.isHealthy() 루프)
     * 3. 메타데이터 적용 (while ctx.isHealthy() 루프)
     */
    async *executeSteps(
        scene: BABYLON.Scene,
        ctx: LoadExecutionContext,
        onProgress?: (progress: LoadUnitProgress) => void
    ): AsyncGenerator<void, void, void> {
        onProgress?.({ progress: 0, message: 'Loading character model...' });
        yield; // 시작 지점

        // ========================================
        // Phase 1: GLB 로딩 (Babylon 순수 블로킹)
        // ========================================
        console.log('[CharacterLoadUnit] Phase 1: Loading GLB...');

        let result: BABYLON.ISceneLoaderAsyncResult;
        try {
            result = await BABYLON.SceneLoader.ImportMeshAsync(
                '', // Load all meshes
                '', // Base URL
                this.config.modelPath,
                scene,
                (event) => {
                    if (event.lengthComputable) {
                        const progress = event.loaded / event.total;
                        onProgress?.({ progress: progress * 0.6, message: `Loading: ${Math.round(progress * 100)}%` });
                    }
                }
            );
        } catch (err) {
            console.error('[CharacterLoadUnit] Failed to load GLB:', err);
            throw err;
        }

        yield; // GLB 로딩 완료 지점

        // ⚠️ CRITICAL: Recovery Frame 배치
        // SceneLoader.ImportMeshAsync는 Babylon 순수 블로킹이므로
        // 브라우저의 가변 주사율 스케줄러를 안심시킨다
        console.log('[CharacterLoadUnit] Requesting recovery frames after GLB load...');
        await ctx.requestRecoveryFrames(2);

        yield; // Recovery 완료 지점

        // ========================================
        // Phase 2: 기본 설정
        // ========================================
        console.log('[CharacterLoadUnit] Phase 2: Setting up meshes...');
        onProgress?.({ progress: 0.65, message: 'Setting up character...' });

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
        this.rootMesh.rotationQuaternion = BABYLON.Quaternion.Identity();

        yield; // 기본 설정 완료

        // ========================================
        // Phase 3: 애니메이션 등록 (while ctx.isHealthy() 루프)
        // ========================================
        console.log('[CharacterLoadUnit] Phase 3: Registering animations...');
        onProgress?.({ progress: 0.75, message: 'Registering animations...' });

        const animGroups = result.animationGroups;
        let animIndex = 0;

        while (animIndex < animGroups.length) {
            // Budget 체크: 초과 시 루프 탈출 → yield → 다음 프레임에 재개
            if (!ctx.isHealthy()) {
                yield;
            }

            const animGroup = animGroups[animIndex];
            const name = animGroup.name;
            this.animationGroups.set(name, animGroup);
            animGroup.stop();
            console.log(`[CharacterLoadUnit] Registered animation: ${name}`);

            animIndex++;
            yield; // 각 애니메이션 등록 후 yield
        }

        // ========================================
        // Phase 4: 메타데이터 적용 (while ctx.isHealthy() 루프)
        // ========================================
        console.log('[CharacterLoadUnit] Phase 4: Applying metadata...');
        onProgress?.({ progress: 0.9, message: 'Applying metadata...' });

        let meshIndex = 0;

        while (meshIndex < this.meshes.length) {
            // Budget 체크
            if (!ctx.isHealthy()) {
                yield;
            }

            const mesh = this.meshes[meshIndex];
            mesh.metadata = {
                ...mesh.metadata,
                isFlightCharacter: true,
                characterName: this.config.characterName,
            };

            meshIndex++;

            // 5개마다 yield (메타데이터 적용은 가벼우므로 배치 처리)
            if (meshIndex % 5 === 0) {
                yield;
            }
        }

        // ========================================
        // 완료
        // ========================================
        onProgress?.({ progress: 1, message: 'Character loaded' });
        console.log(`[CharacterLoadUnit] ✅ Loaded ${this.meshes.length} meshes, ${this.animationGroups.size} animations`);

        yield; // 최종 yield
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
     * Play animation by semantic role
     */
    playRole(role: FlightAnimationRole, loop: boolean = true): boolean {
        const animName = this.animationMapping[role];
        if (!animName) {
            console.warn(`[CharacterLoadUnit] No mapping for role: ${role}`);
            return false;
        }

        const success = this.playAnimation(animName, loop);
        if (success) {
            this.currentRole = role;
            console.log(`[CharacterLoadUnit] Playing role: ${role} (${animName})`);
        }
        return success;
    }

    /**
     * Get current animation role
     */
    getCurrentRole(): FlightAnimationRole | null {
        return this.currentRole;
    }

    /**
     * Get animation mapping
     */
    getAnimationMapping(): AnimationMapping {
        return { ...this.animationMapping };
    }

    /**
     * Stop all animations
     */
    stopAllAnimations(): void {
        for (const [, group] of this.animationGroups) {
            group.stop();
        }
        this.currentRole = null;
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
