import * as BABYLON from '@babylonjs/core';
import { COLORS } from '../../../shared/design';

/**
 * ScanLineEffect - "digital scan line" sweeping the tactical area during transition-in.
 * Cheap: a thin emissive plane that moves across the grid.
 */
export class ScanLineEffect {
    private scene: BABYLON.Scene;
    private mesh: BABYLON.Mesh | null = null;
    private mat: BABYLON.StandardMaterial | null = null;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    startSweep(bounds: { half: number }, durationMs: number, onDone?: () => void): void {
        this.dispose();

        const half = bounds.half;

        this.mesh = BABYLON.MeshBuilder.CreatePlane(
            'NavScanLine',
            { width: half * 2.2, height: 0.65, sideOrientation: BABYLON.Mesh.DOUBLESIDE },
            this.scene
        );
        this.mesh.rotation.x = Math.PI / 2;
        this.mesh.position.set(0, 0.02, -half);
        this.mesh.isPickable = false;

        this.mat = new BABYLON.StandardMaterial('NavScanLineMat', this.scene);
        this.mat.disableLighting = true;
        this.mat.emissiveColor = BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
        this.mat.alpha = 0.65;
        this.mesh.material = this.mat;
        // Phase 2.3: material is static; freeze for lower GPU cost.
        this.mat.freeze();

        const start = performance.now();
        const tick = () => {
            if (!this.mesh) return;
            const t = Math.min(1, (performance.now() - start) / Math.max(1, durationMs));
            // ease in-out
            const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            this.mesh.position.z = -half + (half * 2) * k;
            // Note: frozen materials can't change; use mesh visibility instead.
            this.mesh.visibility = Math.max(0, 1 - 0.35 * t);

            if (t < 1) {
                this.scene.onBeforeRenderObservable.addOnce(tick);
            } else {
                this.dispose();
                onDone?.();
            }
        };
        this.scene.onBeforeRenderObservable.addOnce(tick);
    }

    dispose(): void {
        this.mesh?.dispose();
        this.mesh = null;
        this.mat?.dispose();
        this.mat = null;
    }
}

