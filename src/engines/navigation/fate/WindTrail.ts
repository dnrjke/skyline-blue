/**
 * WindTrail - Phase 3 Visual Path Rendering
 *
 * Modes:
 * - design: Faint white trail (editing phase)
 * - launch: High-speed vector sync animation
 * - flight: Character tracking trail
 *
 * Uses Path3D for smooth spline interpolation
 */

import * as BABYLON from '@babylonjs/core';
import type { FateNode } from './FateNode';

export type WindTrailMode = 'design' | 'launch' | 'flight';

export interface WindTrailConfig {
    /** Trail tube radius (default: 0.08) */
    tubeRadius?: number;
    /** Trail tessellation (default: 16) */
    tessellation?: number;
    /** Spline subdivision (default: 20) */
    splineSubdivision?: number;
}

/**
 * WindTrail - renders the visual path connecting FateNodes
 */
export class WindTrail {
    private scene: BABYLON.Scene;
    private config: Required<WindTrailConfig>;

    // Visual elements
    private tube: BABYLON.Mesh | null = null;
    private path3D: BABYLON.Path3D | null = null;

    // Materials for different modes
    private designMaterial: BABYLON.StandardMaterial;
    private launchMaterial: BABYLON.StandardMaterial;
    private flightMaterial: BABYLON.StandardMaterial;

    // Current mode
    private currentMode: WindTrailMode = 'design';

    // Animation state
    private animationObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private launchProgress: number = 0;

    // Disposed flag
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: WindTrailConfig = {}) {
        this.scene = scene;
        this.config = {
            tubeRadius: config.tubeRadius ?? 0.08,
            tessellation: config.tessellation ?? 16,
            splineSubdivision: config.splineSubdivision ?? 20,
        };

        // Create materials
        this.designMaterial = this.createDesignMaterial();
        this.launchMaterial = this.createLaunchMaterial();
        this.flightMaterial = this.createFlightMaterial();
    }

    private createDesignMaterial(): BABYLON.StandardMaterial {
        const mat = new BABYLON.StandardMaterial('WindTrail_Design', this.scene);
        mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
        mat.disableLighting = true;
        mat.alpha = 0.3;
        mat.backFaceCulling = false;
        return mat;
    }

    private createLaunchMaterial(): BABYLON.StandardMaterial {
        const mat = new BABYLON.StandardMaterial('WindTrail_Launch', this.scene);
        mat.emissiveColor = new BABYLON.Color3(0.5, 0.8, 1.0);
        mat.disableLighting = true;
        mat.alpha = 0.9;
        mat.backFaceCulling = false;
        return mat;
    }

    private createFlightMaterial(): BABYLON.StandardMaterial {
        const mat = new BABYLON.StandardMaterial('WindTrail_Flight', this.scene);
        mat.emissiveColor = new BABYLON.Color3(0.2, 0.6, 1.0);
        mat.disableLighting = true;
        mat.alpha = 0.6;
        mat.backFaceCulling = false;
        return mat;
    }

    /**
     * Update trail from FateNode array
     */
    updateFromNodes(nodes: ReadonlyArray<FateNode>): void {
        if (this.disposed) return;

        // Need at least 2 nodes for a path
        if (nodes.length < 2) {
            this.clearTube();
            this.path3D = null;
            return;
        }

        const positions = nodes.map(n => n.position.clone());
        this.updateFromPositions(positions);
    }

    /**
     * Update trail from position array
     */
    updateFromPositions(positions: BABYLON.Vector3[]): void {
        if (this.disposed) return;

        if (positions.length < 2) {
            this.clearTube();
            this.path3D = null;
            return;
        }

        // Create smooth Catmull-Rom spline
        const curve = BABYLON.Curve3.CreateCatmullRomSpline(
            positions,
            this.config.splineSubdivision,
            false
        );

        const curvePoints = curve.getPoints();
        this.path3D = new BABYLON.Path3D(curvePoints);

        // Rebuild tube
        this.rebuildTube(curvePoints);
    }

    private rebuildTube(points: BABYLON.Vector3[]): void {
        this.clearTube();

        if (points.length < 2) return;

        // Create tube mesh
        this.tube = BABYLON.MeshBuilder.CreateTube(
            'WindTrail_Tube',
            {
                path: points,
                radius: this.config.tubeRadius,
                tessellation: this.config.tessellation,
                cap: BABYLON.Mesh.CAP_ALL,
                updatable: true,
            },
            this.scene
        );

        // Apply current mode material
        this.tube.material = this.getMaterialForMode(this.currentMode);

        // Ensure visibility
        this.tube.isPickable = false;
        this.tube.layerMask = 0x0FFFFFFF;
    }

    private clearTube(): void {
        if (this.tube) {
            this.tube.dispose();
            this.tube = null;
        }
    }

    /**
     * Set visual mode
     */
    setMode(mode: WindTrailMode): void {
        this.currentMode = mode;

        if (this.tube) {
            this.tube.material = this.getMaterialForMode(mode);
        }
    }

    private getMaterialForMode(mode: WindTrailMode): BABYLON.StandardMaterial {
        switch (mode) {
            case 'launch':
                return this.launchMaterial;
            case 'flight':
                return this.flightMaterial;
            case 'design':
            default:
                return this.designMaterial;
        }
    }

    /**
     * Get current Path3D (for flight controller)
     */
    getPath3D(): BABYLON.Path3D | null {
        return this.path3D;
    }

    /**
     * Play launch animation (high-speed draw from Node 0 to N)
     * Returns promise that resolves when animation completes
     */
    playLaunchAnimation(durationMs: number = 1000): Promise<void> {
        return new Promise((resolve) => {
            if (this.disposed || !this.path3D) {
                resolve();
                return;
            }

            // Switch to launch mode
            this.setMode('launch');

            // Store original path points
            const fullPoints = this.path3D.getPoints();
            if (fullPoints.length < 2) {
                resolve();
                return;
            }

            this.launchProgress = 0;
            const startTime = performance.now();

            // Clear current tube and animate rebuild
            this.clearTube();

            // Animation loop
            this.animationObserver = this.scene.onBeforeRenderObservable.add(() => {
                const elapsed = performance.now() - startTime;
                this.launchProgress = Math.min(elapsed / durationMs, 1);

                // Calculate how many points to show
                const pointCount = Math.floor(this.launchProgress * fullPoints.length);
                const visiblePoints = fullPoints.slice(0, Math.max(2, pointCount + 1));

                // Rebuild tube with visible points
                if (visiblePoints.length >= 2) {
                    this.clearTube();
                    this.tube = BABYLON.MeshBuilder.CreateTube(
                        'WindTrail_Tube',
                        {
                            path: visiblePoints,
                            radius: this.config.tubeRadius * (1 + 0.3 * (1 - this.launchProgress)),
                            tessellation: this.config.tessellation,
                            cap: BABYLON.Mesh.CAP_ALL,
                            updatable: true,
                        },
                        this.scene
                    );
                    this.tube.material = this.launchMaterial;
                    this.tube.isPickable = false;
                }

                // Animation complete
                if (this.launchProgress >= 1) {
                    if (this.animationObserver) {
                        this.scene.onBeforeRenderObservable.remove(this.animationObserver);
                        this.animationObserver = null;
                    }

                    // Rebuild final tube
                    this.rebuildTube(fullPoints);
                    resolve();
                }
            });
        });
    }

    /**
     * Stop any running animation
     */
    stopAnimation(): void {
        if (this.animationObserver) {
            this.scene.onBeforeRenderObservable.remove(this.animationObserver);
            this.animationObserver = null;
        }
    }

    /**
     * Set visibility
     */
    setVisibility(visible: boolean): void {
        if (this.tube) {
            this.tube.setEnabled(visible);
        }
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.stopAnimation();
        this.clearTube();

        this.designMaterial.dispose();
        this.launchMaterial.dispose();
        this.flightMaterial.dispose();
    }
}
