import * as BABYLON from '@babylonjs/core';

/**
 * MaterialWarmup - Babylon 8.x Material 사전 컴파일 유틸리티
 *
 * 문제:
 * - Babylon 8.x에서 material.isReady() === false면 렌더링 즉시 탈락
 * - 첫 프레임에 메시가 안 보이는 현상 발생
 *
 * 해결:
 * - 더미 메시로 Material을 미리 컴파일
 * - 비동기 처리로 메인 스레드 블로킹 방지
 *
 * @see docs/babylon_rendering_rules.md
 */
export interface MaterialWarmupOptions {
    /** Material 생성 함수 배열 */
    materials: Array<(scene: BABYLON.Scene) => BABYLON.Material>;
    /** 완료 콜백 */
    onComplete?: () => void;
    /** 실패 콜백 */
    onError?: (error: Error) => void;
}

export class MaterialWarmup {
    private scene: BABYLON.Scene;
    private isComplete: boolean = false;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    /**
     * Material 배열을 순차적으로 워밍업
     */
    async warmupAsync(options: MaterialWarmupOptions): Promise<void> {
        const { materials, onComplete, onError } = options;

        // 더미 메시 생성
        const dummy = BABYLON.MeshBuilder.CreateSphere(
            '__MaterialWarmupDummy__',
            { diameter: 0.01 },
            this.scene
        );
        dummy.isVisible = false;

        try {
            for (const createMaterial of materials) {
                const mat = createMaterial(this.scene);
                dummy.material = mat;
                await mat.forceCompilationAsync(dummy);
                mat.dispose();
            }

            dummy.dispose();
            this.isComplete = true;
            console.log(`[MaterialWarmup] ${materials.length} materials precompiled`);
            onComplete?.();
        } catch (err) {
            dummy.dispose();
            console.warn('[MaterialWarmup] Warmup failed:', err);
            this.isComplete = true; // 실패해도 진행
            onError?.(err as Error);
        }
    }

    /**
     * 워밍업 완료 여부
     */
    get completed(): boolean {
        return this.isComplete;
    }

    /**
     * 일반적인 StandardMaterial 설정으로 워밍업
     * - Emissive + DisableLighting 조합 (Effect용)
     */
    static createEmissiveMaterial(
        scene: BABYLON.Scene,
        name: string,
        color: BABYLON.Color3
    ): BABYLON.StandardMaterial {
        const mat = new BABYLON.StandardMaterial(name, scene);
        mat.disableLighting = true;
        mat.emissiveColor = color;
        mat.specularColor = BABYLON.Color3.Black();
        mat.backFaceCulling = false;
        return mat;
    }

    /**
     * 일반적인 Effect Material 세트 워밍업
     * - Path (주황색)
     * - Invalid Path (빨간색)
     * - Debug (마젠타)
     */
    static async warmupEffectMaterials(scene: BABYLON.Scene): Promise<void> {
        const warmup = new MaterialWarmup(scene);

        await warmup.warmupAsync({
            materials: [
                (s) => MaterialWarmup.createEmissiveMaterial(s, '__PathWarmup__', new BABYLON.Color3(1.0, 0.5, 0.0)),
                (s) => MaterialWarmup.createEmissiveMaterial(s, '__InvalidWarmup__', new BABYLON.Color3(1.0, 0.22, 0.22)),
                (s) => MaterialWarmup.createEmissiveMaterial(s, '__DebugWarmup__', new BABYLON.Color3(1.0, 0.0, 1.0)),
            ],
        });
    }
}
