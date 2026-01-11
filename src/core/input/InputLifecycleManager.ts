/**
 * InputLifecycleManager - Engine/Scene Input Lifecycle Controller
 *
 * INPUT LAW (Constitutional Rule):
 * - Input state must be validated before any interactive phase
 * - All input attachment state changes must go through this manager
 *
 * Purpose:
 * - Ensure engine input element is properly set before any input is expected
 * - Prevent input state loss during flow transitions
 * - Provide diagnostic logging for input state debugging
 *
 * Babylon.js Input Architecture:
 * - Engine.inputElement: The canvas element receiving input (set at Engine creation)
 * - Scene input manager: Processes pointer events for mesh picking
 * - GUI (AdvancedDynamicTexture): Has its own pointer handling attached to scene
 */

import * as BABYLON from '@babylonjs/core';

export class InputLifecycleManager {
    private static initialized = false;

    /**
     * Ensures engine and scene input is properly configured.
     * In Babylon.js 5+, input is automatically attached when Engine is created with a canvas.
     * This method validates the state and logs diagnostics.
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

        // Babylon.js 5+: Engine should automatically have inputElement set
        // If not, we need to force-set it via internal property
        if (!engine.inputElement) {
            console.warn('[InputLifecycle] Engine inputElement is undefined - forcing attachment');
            // Access internal property to set input element
            (engine as any)._inputElement = canvas;
        }

        // Ensure scene input manager is active
        // In Babylon 5+, scene.attachControl() was removed, but we can validate
        const inputManager = (scene as any)._inputManager;
        if (inputManager && typeof inputManager.attachControl === 'function') {
            inputManager.attachControl();
        }

        this.initialized = true;

        console.info('[InputLifecycle] Input validation complete', {
            canvas: canvas.id || 'unnamed',
            engineInputElement: engine.inputElement ? 'OK' : 'MISSING',
            inputElementMatch: engine.inputElement === canvas ? 'OK' : 'MISMATCH',
            sceneReady: scene.isReady(),
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
    } {
        const canvas = engine.getRenderingCanvas();
        return {
            hasInputElement: !!engine.inputElement,
            inputElementMatch: engine.inputElement === canvas,
            sceneReady: scene.isReady(),
            initialized: this.initialized,
        };
    }
}
