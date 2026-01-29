/**
 * Pulse Render Host
 *
 * The Loading Host that maintains GPU heartbeat during loading phase.
 * Renders a full-screen quad to ensure continuous draw calls.
 *
 * Key Concept:
 * "A 1x1 invisible dummy mesh or a full-screen transparent quad
 * is the most reliable signal to the browser that this app is
 * continuously changing pixels."
 *
 * Implementation:
 * - Full-screen quad with slight alpha animation
 * - Ensures at least 1 draw call per frame
 * - resize-responsive
 * - Completely independent of game scene state
 */

import * as BABYLON from '@babylonjs/core';
import { IGPUPulseHost } from './types';

const LOG_PREFIX = '[PulseHost]';

/**
 * Configuration for Pulse Render Host
 */
export interface PulseRenderHostConfig {
    /** Babylon.js scene */
    scene: BABYLON.Scene;
    /** Enable debug logging */
    debug?: boolean;
    /** Base color for the pulse quad (default: black) */
    baseColor?: BABYLON.Color3;
    /** Whether to show visual feedback (tiny pulse animation) */
    showVisualPulse?: boolean;
}

export class PulseRenderHost implements IGPUPulseHost {
    public readonly id = 'loading-pulse-host';

    private readonly scene: BABYLON.Scene;
    private readonly config: PulseRenderHostConfig;

    private _isActive: boolean = false;

    // Rendering components
    private pulseQuad: BABYLON.Mesh | null = null;
    private pulseMaterial: BABYLON.StandardMaterial | null = null;
    private pulseCamera: BABYLON.FreeCamera | null = null;

    // Animation state
    private pulseTime: number = 0;
    private frameCount: number = 0;

    // Callback for reporting frames
    private onFrameRendered?: (drawCalls: number) => void;

    constructor(config: PulseRenderHostConfig) {
        this.scene = config.scene;
        this.config = config;
    }

    public get isActive(): boolean {
        return this._isActive;
    }

    /**
     * Set callback for frame reporting
     */
    public setFrameCallback(callback: (drawCalls: number) => void): void {
        this.onFrameRendered = callback;
    }

    /**
     * Activate the pulse host - start rendering heartbeat
     */
    public activate(): boolean {
        if (this._isActive) {
            this.log('Already active');
            return true;
        }

        try {
            this.createPulseComponents();
            this._isActive = true;
            this.pulseTime = 0;
            this.frameCount = 0;

            this.log('Activated - pulse rendering started');
            return true;
        } catch (error) {
            this.log(`Activation FAILED: ${error}`, 'error');
            return false;
        }
    }

    /**
     * Deactivate the pulse host - stop rendering heartbeat
     */
    public deactivate(): void {
        if (!this._isActive) {
            return;
        }

        this._isActive = false;
        this.hidePulseComponents();

        this.log(`Deactivated after ${this.frameCount} pulse frames`);
    }

    /**
     * Render one frame of pulse content
     * CRITICAL: Must include at least one draw call
     */
    public renderPulseFrame(): void {
        if (!this._isActive || !this.pulseQuad || !this.pulseMaterial) {
            return;
        }

        this.frameCount++;
        this.pulseTime += 0.016; // Assume ~60fps base timing

        // Update material to force GPU work
        this.updatePulseMaterial();

        // Report frame rendered
        this.onFrameRendered?.(1);
    }

    /**
     * Check if host can provide pulse
     */
    public canProvidePulse(): boolean {
        return !this.scene.isDisposed;
    }

    /**
     * Dispose all resources
     */
    public dispose(): void {
        this.deactivate();
        this.disposePulseComponents();
        this.log('Disposed');
    }

    // ============================================================
    // Private: Component Management
    // ============================================================

    private createPulseComponents(): void {
        // Create dedicated camera for pulse rendering
        // This ensures pulse renders regardless of main camera state
        this.pulseCamera = new BABYLON.FreeCamera(
            '__pulse_camera__',
            new BABYLON.Vector3(0, 0, -1),
            this.scene
        );
        this.pulseCamera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
        this.pulseCamera.orthoLeft = -1;
        this.pulseCamera.orthoRight = 1;
        this.pulseCamera.orthoTop = 1;
        this.pulseCamera.orthoBottom = -1;
        this.pulseCamera.minZ = 0.1;
        this.pulseCamera.maxZ = 10;

        // Create full-screen quad
        this.pulseQuad = BABYLON.MeshBuilder.CreatePlane(
            '__pulse_quad__',
            { size: 2 },
            this.scene
        );
        this.pulseQuad.position.z = 0;

        // Configure quad for pulse rendering
        this.pulseQuad.isPickable = false;
        this.pulseQuad.alwaysSelectAsActiveMesh = true;

        // Create material with animation capability
        this.pulseMaterial = new BABYLON.StandardMaterial(
            '__pulse_material__',
            this.scene
        );

        const baseColor = this.config.baseColor ?? new BABYLON.Color3(0, 0, 0);
        this.pulseMaterial.diffuseColor = baseColor;
        this.pulseMaterial.emissiveColor = baseColor;
        this.pulseMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

        // Start nearly transparent (but not fully - ensures draw call)
        this.pulseMaterial.alpha = 0.01;
        this.pulseMaterial.backFaceCulling = false;
        this.pulseMaterial.disableLighting = true;

        // Ensure material forces render
        this.pulseMaterial.needAlphaBlending = () => true;
        this.pulseMaterial.needAlphaTesting = () => false;

        this.pulseQuad.material = this.pulseMaterial;

        // Set render layer to ensure it renders
        // Using very high render group to render on top
        this.pulseQuad.renderingGroupId = 3;

        // Make visible
        this.pulseQuad.isVisible = true;

        this.log('Pulse components created');
    }

    private hidePulseComponents(): void {
        if (this.pulseQuad) {
            this.pulseQuad.isVisible = false;
        }
    }

    private disposePulseComponents(): void {
        if (this.pulseQuad) {
            this.pulseQuad.dispose();
            this.pulseQuad = null;
        }

        if (this.pulseMaterial) {
            this.pulseMaterial.dispose();
            this.pulseMaterial = null;
        }

        if (this.pulseCamera) {
            this.pulseCamera.dispose();
            this.pulseCamera = null;
        }
    }

    /**
     * Update pulse material to force GPU work
     * This is the "heartbeat" that tells the browser we're active
     */
    private updatePulseMaterial(): void {
        if (!this.pulseMaterial) return;

        // Subtle alpha oscillation - changes pixel values without being visible
        // Range: 0.001 to 0.02 (nearly invisible but technically changing)
        const baseAlpha = 0.01;
        const oscillation = Math.sin(this.pulseTime * 4) * 0.009;
        this.pulseMaterial.alpha = baseAlpha + oscillation;

        // Also slightly vary emissive to force shader recomputation path
        // This ensures the GPU actually processes the change
        if (this.config.showVisualPulse) {
            // Visual debug mode - show a visible pulse
            const pulseIntensity = (Math.sin(this.pulseTime * 2) + 1) * 0.1;
            this.pulseMaterial.emissiveColor = new BABYLON.Color3(
                pulseIntensity * 0.2,
                pulseIntensity * 0.5,
                pulseIntensity
            );
            this.pulseMaterial.alpha = 0.3 + pulseIntensity * 0.2;
        } else {
            // Invisible mode - minimal changes but still forces GPU work
            const microVariation = Math.sin(this.pulseTime * 10) * 0.001;
            this.pulseMaterial.emissiveColor.r = microVariation;
        }

        // Force material to be marked as needing update
        this.pulseMaterial.markAsDirty(BABYLON.Material.MiscDirtyFlag);
    }

    // ============================================================
    // Private: Logging
    // ============================================================

    private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        if (!this.config.debug && level === 'info') return;

        const entry = `${LOG_PREFIX} ${message}`;
        if (level === 'error') {
            console.error(entry);
        } else if (level === 'warn') {
            console.warn(entry);
        } else {
            console.log(entry);
        }
    }
}

/**
 * Factory function to create a standard Pulse Render Host
 */
export function createPulseRenderHost(scene: BABYLON.Scene, debug: boolean = false): PulseRenderHost {
    return new PulseRenderHost({
        scene,
        debug,
        baseColor: new BABYLON.Color3(0, 0, 0),
        showVisualPulse: debug, // Show visual pulse only in debug mode
    });
}
