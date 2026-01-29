/**
 * RenderingIntentKeeper - Active Engagement Strategy (🅰️+)
 *
 * PURPOSE:
 * Signal to Chromium that this is a real-time graphics application
 * requiring active GPU scheduling every frame.
 *
 * PROBLEM BACKGROUND:
 * Chromium may throttle RAF or suspend GPU processes for tabs that appear
 * "idle" — even if they're running Babylon.js render loops. This causes
 * the "blackhole" phenomenon where meshes exist but never render for minutes.
 *
 * SOLUTION:
 * Register a read-only observer on scene.onBeforeRenderObservable that
 * performs minimal but meaningful computation each frame. This signals
 * "animation intent" to the browser compositor without modifying scene state.
 *
 * RULES (STRICT):
 * - NO camera manipulation
 * - NO scene modification
 * - NO state changes
 * - READ-ONLY access only (e.g., activeMeshes.length, engine.getFps())
 *
 * LIFECYCLE:
 * 1. Call start() after ENGINE_AWAKENED passes
 * 2. Keeper runs continuously until dispose()
 * 3. Automatically stops if scene is disposed
 *
 * @see docs/blackhole_analysis.md
 */

import * as BABYLON from '@babylonjs/core';

export interface RenderingIntentKeeperConfig {
    /** Log intent signals (default: false, too verbose for production) */
    debug?: boolean;
    /** Sample interval for metrics logging (frames, default: 300 = ~5s at 60fps) */
    sampleInterval?: number;
}

export interface IntentMetrics {
    /** Current frame index since keeper started */
    frameIndex: number;
    /** Number of active meshes this frame */
    activeMeshCount: number;
    /** Current FPS from engine */
    engineFps: number;
    /** Time since keeper started (ms) */
    elapsedMs: number;
    /** Total vertices being rendered */
    totalVertices: number;
    /** Document visibility state */
    visibilityState: DocumentVisibilityState;
}

/**
 * RenderingIntentKeeper
 *
 * Maintains active GPU engagement by signaling "animation intent"
 * to the browser's compositor/scheduler.
 */
export class RenderingIntentKeeper {
    private scene: BABYLON.Scene;
    private engine: BABYLON.AbstractEngine;
    private config: Required<RenderingIntentKeeperConfig>;

    private observer: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private startTime: number = 0;
    private frameIndex: number = 0;
    private active: boolean = false;

    // Metrics for diagnostics
    private lastMetrics: IntentMetrics | null = null;
    private minFps: number = Infinity;
    private maxFps: number = 0;
    private totalActiveMeshes: number = 0;

    constructor(scene: BABYLON.Scene, config: RenderingIntentKeeperConfig = {}) {
        this.scene = scene;
        this.engine = scene.getEngine();
        this.config = {
            debug: config.debug ?? false,
            sampleInterval: config.sampleInterval ?? 300,
        };
    }

    /**
     * Start the intent keeper.
     * Should be called AFTER ENGINE_AWAKENED barrier passes.
     */
    start(): void {
        if (this.active) {
            console.warn('[RenderingIntentKeeper] Already active');
            return;
        }

        this.active = true;
        this.startTime = performance.now();
        this.frameIndex = 0;
        this.minFps = Infinity;
        this.maxFps = 0;
        this.totalActiveMeshes = 0;

        // Register read-only observer on onBeforeRenderObservable
        this.observer = this.scene.onBeforeRenderObservable.add(() => {
            if (!this.active) return;
            this.onBeforeRender();
        });

        if (this.config.debug) {
            console.log('[RenderingIntentKeeper] Started — signaling animation intent');
        }
    }

    /**
     * Stop the intent keeper.
     */
    stop(): void {
        if (!this.active) return;

        this.active = false;

        if (this.observer) {
            this.scene.onBeforeRenderObservable.remove(this.observer);
            this.observer = null;
        }

        if (this.config.debug) {
            const elapsed = performance.now() - this.startTime;
            console.log(
                `[RenderingIntentKeeper] Stopped — ` +
                `${this.frameIndex} frames, ${(elapsed / 1000).toFixed(1)}s, ` +
                `fps range: ${this.minFps.toFixed(0)}-${this.maxFps.toFixed(0)}`
            );
        }
    }

    /**
     * Dispose the keeper and clean up resources.
     */
    dispose(): void {
        this.stop();
        this.lastMetrics = null;
    }

    /**
     * Check if keeper is currently active.
     */
    isActive(): boolean {
        return this.active;
    }

    /**
     * Get current metrics (for debugging/diagnostics).
     */
    getMetrics(): IntentMetrics | null {
        return this.lastMetrics;
    }

    /**
     * Get summary statistics.
     */
    getSummary(): {
        frameCount: number;
        elapsedMs: number;
        avgActiveMeshes: number;
        fpsRange: [number, number];
    } {
        return {
            frameCount: this.frameIndex,
            elapsedMs: performance.now() - this.startTime,
            avgActiveMeshes: this.frameIndex > 0 ? this.totalActiveMeshes / this.frameIndex : 0,
            fpsRange: [this.minFps === Infinity ? 0 : this.minFps, this.maxFps],
        };
    }

    // ========================================
    // Private
    // ========================================

    /**
     * Called every frame before render.
     *
     * CRITICAL: This method MUST be read-only.
     * It should NOT modify any scene/camera/engine state.
     *
     * The purpose is to perform minimal computation that signals
     * to Chromium's compositor that this is an active animation.
     */
    private onBeforeRender(): void {
        this.frameIndex++;

        // Read-only metrics collection (signals "computation" to scheduler)
        const activeMeshCount = this.scene.getActiveMeshes().length;
        const engineFps = this.engine.getFps();
        const elapsedMs = performance.now() - this.startTime;

        // Additional read-only accesses to emphasize "active" state
        // These are intentionally read and stored (not just accessed)
        // to prevent dead code elimination by the JS engine
        const totalVertices = this.scene.getTotalVertices();
        const visibilityState = document.visibilityState;

        // Update running statistics
        this.totalActiveMeshes += activeMeshCount;
        if (engineFps > 0) {
            this.minFps = Math.min(this.minFps, engineFps);
            this.maxFps = Math.max(this.maxFps, engineFps);
        }

        // Store metrics
        this.lastMetrics = {
            frameIndex: this.frameIndex,
            activeMeshCount,
            engineFps,
            elapsedMs,
            totalVertices,
            visibilityState,
        };

        // Debug logging (sampled to avoid log spam)
        if (this.config.debug && this.frameIndex % this.config.sampleInterval === 0) {
            console.log(
                `[RenderingIntentKeeper] f=${this.frameIndex} ` +
                `active=${activeMeshCount} fps=${engineFps.toFixed(1)} ` +
                `vertices=${totalVertices} vis=${visibilityState}`
            );
        }
    }
}
