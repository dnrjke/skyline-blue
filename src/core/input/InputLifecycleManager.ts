/**
 * InputLifecycleManager - Engine/Scene Input Lifecycle Controller
 *
 * INPUT LAW (Constitutional Rule):
 * - Input state must be validated before any interactive phase
 * - Scene input MUST be attached AFTER first render (Babylon.js design pattern)
 * - All input attachment state changes must go through this manager
 *
 * Purpose:
 * - Ensure engine input element is properly set before any input is expected
 * - Defer scene.attachControl() to after first render (critical for input manager)
 * - Provide diagnostic logging for input state debugging
 *
 * Babylon.js Input Architecture:
 * - Engine.inputElement: The canvas element receiving input
 * - Scene._inputManager: Created AFTER first render, when activeMeshes/camera are ready
 * - GUI (AdvancedDynamicTexture): Has its own pointer handling attached to scene
 */

import * as BABYLON from '@babylonjs/core';

export class InputLifecycleManager {
    private static initialized = false;
    private static sceneAttachPending = false;

    /**
     * Ensures engine and scene input is properly configured.
     *
     * CRITICAL: Scene input is deferred to after first render via onAfterRenderObservable.
     * This is the official Babylon.js pattern - input manager is only ready post-render.
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

        // 1. Engine input attachment
        if (!engine.inputElement) {
            console.warn('[InputLifecycle] Engine inputElement is undefined - forcing attachment');
            (engine as any)._inputElement = canvas;
        }

        // 2. Scene input attachment (MUST be deferred to after first render)
        // Gate conditions: activeCamera + _inputManager must exist
        const inputManager = (scene as any)._inputManager;
        if (!inputManager && !this.sceneAttachPending) {
            this.sceneAttachPending = true;
            scene.onAfterRenderObservable.addOnce(() => {
                if (!scene.activeCamera) {
                    console.error('[InputLifecycle] No activeCamera, cannot attach input');
                    this.sceneAttachPending = false;
                    return;
                }

                // attachControl(true) - canvas is auto-inferred from engine
                scene.attachControl(true);
                this.sceneAttachPending = false;
                console.info('[InputLifecycle] Scene attached to input (camera ready)');
            });
            console.info('[InputLifecycle] Scene attach scheduled for post-render');
        }

        this.initialized = true;

        console.info('[InputLifecycle] Input validation complete', {
            canvas: canvas.id || 'unnamed',
            engineInputElement: engine.inputElement ? 'OK' : 'MISSING',
            inputElementMatch: engine.inputElement === canvas ? 'OK' : 'MISMATCH',
            sceneReady: scene.isReady(),
            inputManagerExists: !!inputManager,
        });
    }

    /**
     * Diagnostic: Check current input state without modifying.
     */
    static diagnose(engine: BABYLON.AbstractEngine, scene: BABYLON.Scene): {
        hasInputElement: boolean;
        inputElementMatch: boolean;
        sceneReady: boolean;
        initialized: boolean;
        hasInputManager: boolean;
    } {
        const canvas = engine.getRenderingCanvas();
        return {
            hasInputElement: !!engine.inputElement,
            inputElementMatch: engine.inputElement === canvas,
            sceneReady: scene.isReady(),
            initialized: this.initialized,
            hasInputManager: !!(scene as any)._inputManager,
        };
    }
}
