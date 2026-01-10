import * as BABYLON from '@babylonjs/core';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';

export interface RenderQualityManagerOptions {
    /** Minimum MSAA samples to target when supported */
    minMsaaSamples?: number;
    /** Enable periodic DPR watchdog (devtools viewport switch can skip resize). */
    enableDpiWatchdog?: boolean;
    /** Watchdog interval ms. */
    watchdogIntervalMs?: number;
}

/**
 * RenderQualityManager (Core Infrastructure) - Phase 2.6
 *
 * 책임:
 * - DPR 동기화 + 실시간 보정 (회전/리사이즈/DevTools 모드 전환 시 뭉개짐 방지)
 * - engine.resize() 재할당 타이밍을 DPR 갱신 직후로 강제
 * - MSAA 유지 (네온 라인 선명도)
 * - Anisotropic Filtering 최대로 유지 (원경 그리드/텍스처 선명도)
 *
 * 원칙:
 * - 색감을 바꾸는 후처리는 기본적으로 OFF (MSAA 목적만 유지)
 */
export class RenderQualityManager {
    private engine: BABYLON.Engine;
    private scene: BABYLON.Scene;
    private pipeline: DefaultRenderingPipeline | null = null;
    private readonly minMsaaSamples: number;
    private readonly enableDpiWatchdog: boolean;
    private readonly watchdogIntervalMs: number;

    private textureObserver: BABYLON.Observer<BABYLON.BaseTexture> | null = null;
    private canvas: HTMLCanvasElement | null = null;

    private lastDpr: number = 0;
    private lastCssW: number = 0;
    private lastCssH: number = 0;

    private windowResizeHandler: (() => void) | null = null;
    private orientationHandler: (() => void) | null = null;
    private vvResizeHandler: (() => void) | null = null;
    private watchdogTimer: number | null = null;
    private resizeObserver: ResizeObserver | null = null; // Phase 2.6: Layout Latency Fix

    constructor(engine: BABYLON.Engine, scene: BABYLON.Scene, options: RenderQualityManagerOptions = {}) {
        this.engine = engine;
        this.scene = scene;
        this.minMsaaSamples = Math.max(1, options.minMsaaSamples ?? 4);
        this.enableDpiWatchdog = options.enableDpiWatchdog ?? true;
        this.watchdogIntervalMs = Math.max(100, options.watchdogIntervalMs ?? 250);
    }

    /**
     * Call once after Engine/Scene creation.
     * Also installs dynamic DPI scaling hooks.
     */
    init(primaryCamera: BABYLON.Camera, canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        this.syncCanvasStyle(canvas);
        this.enableMsaaPipeline(primaryCamera);
        this.enableMaxAnisotropy();
        this.ensureMsaaSamples();
        this.applyAnisotropyAll();
        
        // Apply initial resolution
        this.updateResolution();
        
        this.installResizeHooks();
    }

    /**
     * Manual trigger (optional). Most cases are handled by internal listeners.
     */
    onResize(): void {
        this.updateResolution();
    }

    addCamera(camera: BABYLON.Camera): void {
        this.pipeline?.addCamera(camera);
    }

    removeCamera(camera: BABYLON.Camera): void {
        this.pipeline?.removeCamera(camera);
    }

    dispose(): void {
        this.uninstallResizeHooks();
        if (this.textureObserver) {
            this.scene.onNewTextureAddedObservable.remove(this.textureObserver);
            this.textureObserver = null;
        }
        this.pipeline?.dispose();
        this.pipeline = null;
    }

    // ============================================
    // Phase 2.6: Dynamic DPI Scaling (anti-blur)
    // ============================================

    /**
     * [API] Force update resolution based on current DPI.
     * Called by internal hooks or external layout managers.
     */
    public updateResolution(): void {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        
        // 1. Hardware Scaling Level (Physical Pixel 1:1)
        // High DPI (Retina) requires scaling < 1 (e.g. 0.5)
        const scaling = 1 / dpr;
        this.engine.setHardwareScalingLevel(scaling);
        
        // 2. Resize Engine (Buffer Re-allocation)
        this.engine.resize();
        
        // 3. Pipeline & AA Persistence Guard
        this.ensureMsaaSamples();
        this.applyAnisotropyAll();
        
        // 4. GUI Resolution Guard (Crucial for crisp text)
        const rw = this.engine.getRenderWidth();
        const rh = this.engine.getRenderHeight();
        this.syncGuiResolution(rw, rh);
        
        console.log(`[RenderQuality] DPI updated to ${dpr}. Rendering scale adjusted to ${scaling.toFixed(4)}.`);
        
        // Update state for watchdog
        this.lastDpr = dpr;
        if (this.canvas) {
            const rect = this.canvas.getBoundingClientRect();
            this.lastCssW = rect.width;
            this.lastCssH = rect.height;
        }

        // 4. Temporary Validation via AfterRender
        this.installOneShotValidation();
    }

    private installResizeHooks(): void {
        if (!this.canvas) return;

        // 1. ResizeObserver: Detect exact moment when CSS layout is finalized
        // This solves the issue where engine initializes before canvas has non-zero size.
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Only trigger if layout is valid (non-zero)
                if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
                    // Check if update is actually needed to avoid loops
                    if (this.hasDpiOrCssChanged()) {
                        this.updateResolution();
                    }
                }
            }
        });
        this.resizeObserver.observe(this.canvas);

        // 2. Fallback window listeners
        if (!this.windowResizeHandler) {
            this.windowResizeHandler = () => this.updateResolution();
            window.addEventListener('resize', this.windowResizeHandler);
        }

        this.orientationHandler = () => {
            // Slight delay for orientation to settle
            setTimeout(() => this.updateResolution(), 100);
        };
        window.addEventListener('orientationchange', this.orientationHandler);

        if (window.visualViewport) {
            this.vvResizeHandler = () => this.updateResolution();
            window.visualViewport.addEventListener('resize', this.vvResizeHandler);
        }

        if (this.enableDpiWatchdog) {
            this.watchdogTimer = window.setInterval(() => {
                if (!this.canvas || document.visibilityState !== 'visible') return;
                if (this.hasDpiOrCssChanged()) {
                    this.updateResolution();
                }
            }, this.watchdogIntervalMs);
        }
    }

    private installOneShotValidation(): void {
        // Validate for next 60 frames (approx 1 sec)
        let frameCount = 0;
        const observer = this.scene.onAfterRenderObservable.add(() => {
            frameCount++;
            const currentScale = this.engine.getHardwareScalingLevel();
            const expectedScale = 1 / (window.devicePixelRatio || 1);
            
            // Allow small float error
            if (Math.abs(currentScale - expectedScale) > 0.0001) {
                console.warn(`[RenderQuality] Scale Mismatch! Expected: ${expectedScale}, Actual: ${currentScale}`);
                // Force correct again
                this.engine.setHardwareScalingLevel(expectedScale);
            }
            
            if (frameCount >= 60) {
                this.scene.onAfterRenderObservable.remove(observer);
            }
        });
    }

    private uninstallResizeHooks(): void {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.windowResizeHandler) {
            window.removeEventListener('resize', this.windowResizeHandler);
            this.windowResizeHandler = null;
        }
        if (this.orientationHandler) {
            window.removeEventListener('orientationchange', this.orientationHandler);
            this.orientationHandler = null;
        }
        if (this.vvResizeHandler && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this.vvResizeHandler);
            this.vvResizeHandler = null;
        }
        if (this.watchdogTimer !== null) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    private hasDpiOrCssChanged(): boolean {
        const canvas = this.canvas;
        if (!canvas) return false;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        if (Math.abs(dpr - this.lastDpr) > 0.001) return true;

        const rect = canvas.getBoundingClientRect();
        if (Math.abs(rect.width - this.lastCssW) > 0.5) return true;
        if (Math.abs(rect.height - this.lastCssH) > 0.5) return true;
        return false;
    }

    private syncCanvasStyle(canvas: HTMLCanvasElement): void {
        // Keep CSS size stable even when backbuffer DPI changes.
        // (Canvas rendering size is handled by engine.resize + hardwareScalingLevel)
        if (canvas.style.width !== '100%') canvas.style.width = '100%';
        if (canvas.style.height !== '100dvh') canvas.style.height = '100dvh';
        if (canvas.style.display !== 'block') canvas.style.display = 'block';
        if (canvas.style.touchAction !== 'none') canvas.style.touchAction = 'none';
    }

    private enableMsaaPipeline(primaryCamera: BABYLON.Camera): void {
        // hdr=false: tone mapping / background feel change 방지
        const pipeline = new DefaultRenderingPipeline('DefaultPipeline', false, this.scene, [primaryCamera]);

        // Visual-altering post effects: OFF
        (pipeline as any).bloomEnabled = false;
        (pipeline as any).fxaaEnabled = false;
        (pipeline as any).chromaticAberrationEnabled = false;
        (pipeline as any).grainEnabled = false;
        (pipeline as any).sharpenEnabled = false;
        (pipeline as any).depthOfFieldEnabled = false;
        (pipeline as any).imageProcessingEnabled = false;

        const caps = this.engine.getCaps();
        const max = typeof caps.maxMSAASamples === 'number' ? caps.maxMSAASamples : 1;
        pipeline.samples = Math.min(max, Math.max(1, this.minMsaaSamples));

        this.pipeline = pipeline;
    }

    private enableMaxAnisotropy(): void {
        const caps = this.engine.getCaps();
        const maxAniso = typeof caps.maxAnisotropy === 'number' ? caps.maxAnisotropy : 0;
        const level = Math.max(0, maxAniso);

        const apply = (tex: BABYLON.BaseTexture) => {
            if ('anisotropicFilteringLevel' in tex) {
                (tex as any).anisotropicFilteringLevel = level;
            }
        };

        for (const tex of this.scene.textures) apply(tex);
        this.textureObserver = this.scene.onNewTextureAddedObservable.add((tex) => apply(tex));
    }

    private ensureMsaaSamples(): void {
        if (!this.pipeline) return;
        const caps = this.engine.getCaps();
        const max = typeof caps.maxMSAASamples === 'number' ? caps.maxMSAASamples : 1;
        const desired = Math.min(max, Math.max(1, this.minMsaaSamples));
        if (this.pipeline.samples !== desired) {
            this.pipeline.samples = desired;
            console.log('[RenderQuality] MSAA samples=', desired);
        }

        // Pipeline re-attachment safety: make sure activeCamera is included.
        const cam = this.scene.activeCamera;
        if (cam) this.pipeline.addCamera(cam);
    }

    /**
     * Phase 2.6 Fix: Force Sync GUI Texture Resolution
     * AdvancedDynamicTexture usually handles resizing automatically via renderAtIdealSize.
     * We just log discrepancies here for debugging, without forcing scaleTo, 
     * because manual scaling conflicts with ADT's internal adaptive logic (causing font size jumps).
     */
    private syncGuiResolution(width: number, height: number): void {
        const adts = this.scene.textures.filter(t => t.getClassName() === 'AdvancedDynamicTexture') as any[];
        
        for (const adt of adts) {
            const size = adt.getSize();
            // Just log status, DO NOT interfere with ADT's internal scaling
            console.log(
                `[RenderQuality] GUI Check: ${adt.name || 'ADT'}`,
                `Size: ${size.width}x${size.height}`,
                `Render: ${width}x${height}`,
                `Match: ${Math.abs(size.width - width) < 2 && Math.abs(size.height - height) < 2}`
            );
        }
    }

    private applyAnisotropyAll(): void {
        const caps = this.engine.getCaps();
        const maxAniso = typeof caps.maxAnisotropy === 'number' ? caps.maxAnisotropy : 0;
        const level = Math.max(0, maxAniso);
        for (const tex of this.scene.textures) {
            if ('anisotropicFilteringLevel' in tex) {
                (tex as any).anisotropicFilteringLevel = level;
            }
        }
    }
}