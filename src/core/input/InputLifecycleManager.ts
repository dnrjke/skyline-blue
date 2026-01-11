/**
 * InputLifecycleManager - Engine/Scene Input Lifecycle Controller
 *
 * INPUT LAW (Constitutional Rule):
 * - Input state must be validated before any interactive phase
 * - Scene input MUST be attached AFTER first render (Babylon.js design pattern)
 * - All input attachment state changes must go through this manager
 *
 * ⚠ BABYLON RULE (Critical):
 * scene.attachControl() MUST be called AFTER the first render frame has occurred.
 * Calling it earlier will SILENTLY FAIL - no error is thrown, but input never works.
 * This is by design in Babylon.js.
 *
 * Babylon.js Input Architecture:
 * - Engine.inputElement: The canvas element receiving input
 * - Scene._inputManager: May exist but scene may not be "attached" for input
 * - scene.attachControl(true) must be called post-render for input to work
 */

import * as BABYLON from '@babylonjs/core';

export class InputLifecycleManager {
    private static sceneAttached = false;
    private static attachScheduled = false;

    /**
     * Ensures engine and scene input is properly configured.
     *
     * CRITICAL: Scene input is deferred to after first render via onAfterRenderObservable.
     * This is the official Babylon.js pattern - attachControl() before render is silently ignored.
     *
     * @param engine Babylon engine instance
     * @param scene Babylon scene instance
     */
    static ensureAttached(engine: BABYLON.AbstractEngine, scene: BABYLON.Scene): void {
        const canvas = engine.getRenderingCanvas();

        if (!canvas) {
            console.error('[InputLifecycle] FATAL: No rendering canvas found');
            return;
        }

        // 1. Engine input element
        if (!engine.inputElement) {
            console.warn('[InputLifecycle] Engine inputElement is undefined - forcing attachment');
            (engine as any)._inputElement = canvas;
        }

        // 2. Scene input attachment (MUST be deferred to AFTER first render)
        // ⚠ Babylon Rule: attachControl() before first render is SILENTLY IGNORED
        if (!this.sceneAttached && !this.attachScheduled) {
            this.attachScheduled = true;

            scene.onAfterRenderObservable.addOnce(() => {
                if (!scene.activeCamera) {
                    console.error('[InputLifecycle] No activeCamera, cannot attach input');
                    this.attachScheduled = false;
                    return;
                }

                // attachControl(true) - canvas is auto-inferred from engine
                scene.attachControl(true);
                this.sceneAttached = true;
                this.attachScheduled = false;

                console.info('[InputLifecycle] First frame rendered — input attached', {
                    activeCamera: scene.activeCamera.name,
                    sceneReady: scene.isReady(),
                });
            });

            console.info('[InputLifecycle] Input attach scheduled for post-render');
        }

        console.info('[InputLifecycle] ensureAttached called', {
            canvas: canvas.id || 'unnamed',
            engineInputElement: engine.inputElement ? 'OK' : 'MISSING',
            sceneAttached: this.sceneAttached,
            attachScheduled: this.attachScheduled,
        });
    }

    /**
     * Diagnostic: Check current input state without modifying.
     */
    static diagnose(engine: BABYLON.AbstractEngine, scene: BABYLON.Scene): {
        hasInputElement: boolean;
        inputElementMatch: boolean;
        sceneReady: boolean;
        sceneAttached: boolean;
        hasActiveCamera: boolean;
    } {
        const canvas = engine.getRenderingCanvas();
        return {
            hasInputElement: !!engine.inputElement,
            inputElementMatch: engine.inputElement === canvas,
            sceneReady: scene.isReady(),
            sceneAttached: this.sceneAttached,
            hasActiveCamera: !!scene.activeCamera,
        };
    }

    /**
     * Reset state (for testing or scene disposal)
     */
    static reset(): void {
        this.sceneAttached = false;
        this.attachScheduled = false;
    }
}
