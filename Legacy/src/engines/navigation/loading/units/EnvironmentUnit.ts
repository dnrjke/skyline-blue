/**
 * EnvironmentUnit - 환경 모델 로딩 LoadUnit.
 *
 * FETCHING phase에서:
 * - Environment GLB 다운로드 (optional)
 *
 * BUILDING phase에서 attach 가능.
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress, LoadUnitStatus } from '../../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../../core/loading';
import { TacticalEnvironmentLoader } from '../../data/TacticalEnvironmentLoader';
import { AssetResolver } from '../../../../shared/assets/AssetResolver';

export interface EnvironmentUnitConfig {
    /** Stage 정보 */
    stage: { episode: number; stage: number };
    /** 환경 로딩 비활성화 */
    skip?: boolean;
}

export class EnvironmentUnit extends BaseLoadUnit {
    readonly id = 'NavigationEnvironment';
    readonly phase = LoadingPhase.FETCHING;
    readonly requiredForReady = false; // 환경은 optional

    private config: EnvironmentUnitConfig;
    private resolver: AssetResolver;
    private envLoader: TacticalEnvironmentLoader;
    private container: BABYLON.AssetContainer | null = null;

    constructor(config: EnvironmentUnitConfig) {
        super();
        this.config = config;
        this.resolver = new AssetResolver();
        this.envLoader = new TacticalEnvironmentLoader();
    }

    protected async doLoad(
        scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        if (this.config.skip) {
            this.status = LoadUnitStatus.SKIPPED;
            onProgress?.({ progress: 1, message: 'Environment skipped' });
            return;
        }

        onProgress?.({ progress: 0, message: 'Loading environment...' });

        const url = this.resolver.tacticalEnvironmentModel(this.config.stage);
        this.container = await this.envLoader.tryLoadEnvironment(url, scene, (p01) => {
            onProgress?.({ progress: p01, message: `Loading environment: ${Math.round(p01 * 100)}%` });
        });

        if (!this.container) {
            // Environment가 없어도 로딩 성공으로 처리 (optional)
            this.status = LoadUnitStatus.SKIPPED;
            onProgress?.({ progress: 1, message: 'Environment not found (skipped)' });
            return;
        }

        onProgress?.({ progress: 1, message: 'Environment loaded' });
    }

    /**
     * Environment를 Scene에 attach
     * BUILDING phase에서 호출
     */
    attachToScene(): void {
        if (!this.container) return;

        this.container.addAllToScene();

        // Optimization: static environment
        for (const m of this.container.meshes) {
            m.isPickable = false;
            m.freezeWorldMatrix();
            m.doNotSyncBoundingInfo = true;
        }
        for (const mat of this.container.materials) {
            (mat as any).freeze?.();
        }

        console.log(`[EnvironmentUnit] Attached ${this.container.meshes.length} meshes`);
    }

    /**
     * 로드된 컨테이너 반환
     */
    getContainer(): BABYLON.AssetContainer | null {
        return this.container;
    }

    dispose(): void {
        if (this.container) {
            try {
                this.container.removeAllFromScene();
            } catch {
                // ignore
            }
            this.container.dispose();
            this.container = null;
        }
    }
}
