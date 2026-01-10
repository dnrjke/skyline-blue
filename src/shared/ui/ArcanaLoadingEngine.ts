import * as GUI from '@babylonjs/gui';
import { ArcanaLoadingOverlay } from './ArcanaLoadingOverlay';
import type { ArcanaLoadingOverlayConfig } from './ArcanaLoadingOverlay';
import type { LoadingDebugger } from './LoadingDebugger';

const DEFAULT_TIPS: string[] = [
    'TIP: 노드를 선택하면 “선택 경로”가 즉시 갱신된다.',
    'TIP: 에너지는 노드/엣지 비용의 합으로 소모된다.',
    'TIP: Dijkstra(min)은 “가능한 최소 에너지”의 힌트다.',
    'WORLD: 하늘을 설계하는 건 조작이 아니라 결단이다.',
];

export interface ArcanaLoadingEngineConfig {
    /** show debugger text lines at bottom */
    debugMode?: boolean;
}

/**
 * ArcanaLoadingEngine (shared/ui)
 * - 특정 엔진에 종속되지 않는 로딩 UI + 상태 업데이트 API
 * - 실제 “무엇을 로드할지”는 core/scene(StageTransitionManager)가 소유
 */
export class ArcanaLoadingEngine {
    private overlay: ArcanaLoadingOverlay;
    private debugMode: boolean;
    private tip: string = DEFAULT_TIPS[0];

    private logs: string[] = [];
    private progress01: number = 0;
    private title: string = 'LOADING';
    private subtitle: string = '';

    constructor(parentLayer: GUI.Rectangle, config: ArcanaLoadingEngineConfig = {}) {
        this.overlay = new ArcanaLoadingOverlay(parentLayer);
        this.debugMode = config.debugMode ?? true;
        this.pickRandomTip();
    }

    show(title: string, subtitle: string): void {
        this.title = title;
        this.subtitle = subtitle;
        this.logs = [];
        this.progress01 = 0;
        this.pickRandomTip();
        this.overlay.show(this.getConfig());
    }

    setProgress(progress01: number): void {
        this.progress01 = Math.max(0, Math.min(1, progress01));
        this.overlay.apply(this.getConfig());
    }

    log(line: string): void {
        // keep small ring buffer
        this.logs = [...this.logs.slice(-6), line];
        this.overlay.apply(this.getConfig());
    }

    attachDebugger(debuggerRef: LoadingDebugger | null): void {
        if (!debuggerRef) return;
        if (!this.debugMode) return;
        const lines = debuggerRef.getSummaryLines();
        for (const l of lines) this.log(l);
    }

    /**
     * Seamless close: 0.5s fade-out then hide
     */
    fadeOutAndHide(onDone?: () => void): void {
        const durMs = 500;
        const start = performance.now();
        const tick = () => {
            const t = Math.min(1, (performance.now() - start) / durMs);
            const a = 1 - t;
            this.overlay.setAlpha(a);
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                this.overlay.hide();
                this.overlay.setAlpha(1);
                onDone?.();
            }
        };
        requestAnimationFrame(tick);
    }

    hide(): void {
        this.overlay.hide();
    }

    dispose(): void {
        this.overlay.dispose();
    }

    private pickRandomTip(): void {
        const idx = Math.floor(Math.random() * DEFAULT_TIPS.length);
        this.tip = DEFAULT_TIPS[idx] ?? DEFAULT_TIPS[0];
    }

    private getConfig(): ArcanaLoadingOverlayConfig {
        const debugLines = this.debugMode ? this.logs : [];
        return {
            title: this.title,
            subtitle: this.subtitle,
            tip: this.tip,
            progress01: this.progress01,
            debugLines,
        };
    }
}

