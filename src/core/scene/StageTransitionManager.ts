import type * as BABYLON from '@babylonjs/core';
import type { ArcanaLoadingEngine } from '../../shared/ui/ArcanaLoadingEngine';
import { LoadingDebugger } from '../../shared/ui/LoadingDebugger';

export interface StageKey {
    episode: number;
    stage: number;
}

export interface StageTransitionManagerDeps {
    scene: BABYLON.Scene;
    loading: ArcanaLoadingEngine;
}

/**
 * StageTransitionManager (core/scene)
 * - 엔진 전환 시: 로딩 화면 표시, 디버그 타이밍 기록, 단계별 로그 업데이트
 * - 실제 로딩 작업(JSON/GLB/Octree 등)은 "task" 콜백으로 주입받는다.
 */
export class StageTransitionManager {
    private loading: ArcanaLoadingEngine;
    private debuggerRef: LoadingDebugger = new LoadingDebugger();

    constructor(deps: StageTransitionManagerDeps) {
        this.loading = deps.loading;
    }

    getDebugger(): LoadingDebugger {
        return this.debuggerRef;
    }

    /**
     * Runs a staged loading flow with UI + timings.
     */
    async runStageTransition(
        stage: StageKey,
        task: (ctx: {
            setProgress: (p01: number) => void;
            log: (line: string) => void;
            dbg: LoadingDebugger;
        }) => Promise<void>
    ): Promise<void> {
        this.debuggerRef.reset();
        const title = `EP${stage.episode} ST${stage.stage}`;
        const subtitle = 'Arcana Loading & Debugger';
        this.loading.show('LOADING', title + ' — ' + subtitle);
        this.loading.setProgress(0);
        this.loading.log('INITIALIZING...');

        const ctx = {
            setProgress: (p01: number) => this.loading.setProgress(p01),
            log: (line: string) => this.loading.log(line),
            dbg: this.debuggerRef,
        } as const;

        try {
            await task(ctx);
            // flush debugger summary into log
            this.loading.attachDebugger(this.debuggerRef);
            // Let user perceive completion, then fade out.
            await new Promise<void>((resolve) => {
                this.loading.fadeOutAndHide(resolve);
            });
        } catch (err) {
            console.error('[StageTransition] Failed', err);
            this.loading.log('FAILED. See console.');
            this.loading.attachDebugger(this.debuggerRef);
            // Keep overlay visible on error.
            throw err;
        }
    }
}

