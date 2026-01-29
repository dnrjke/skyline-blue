import * as BABYLON from '@babylonjs/core';
import type { NavigationGraph } from '../graph/NavigationGraph';
import type { NavigationNode } from '../types';
import { ANIM, COLORS, LAYOUT } from '../../../shared/design';

export interface NavigationVisualizerOptions {
    wireframe?: boolean;
}

export class NavigationVisualizer {
    private scene: BABYLON.Scene;
    private graph: NavigationGraph;

    private nodesById: Map<string, { core: BABYLON.Mesh; ring: BABYLON.Mesh; haloLight: BABYLON.PointLight }> = new Map();

    private coreMat: BABYLON.StandardMaterial;
    private ringMat: BABYLON.StandardMaterial;
    private invalidRingMat: BABYLON.StandardMaterial;

    private glow: BABYLON.GlowLayer | null = null;
    private selected: Set<string> = new Set();

    private options: Required<NavigationVisualizerOptions>;

    constructor(scene: BABYLON.Scene, graph: NavigationGraph, options: NavigationVisualizerOptions = {}) {
        this.scene = scene;
        this.graph = graph;
        this.options = {
            wireframe: options.wireframe ?? true,
        };

        // Materials (Hologram tokens)
        this.coreMat = new BABYLON.StandardMaterial('NavNodeCoreMat', this.scene);
        this.coreMat.disableLighting = true;
        this.coreMat.emissiveColor = BABYLON.Color3.FromHexString(COLORS.HUD_CORE);
        this.coreMat.alpha = 1;
        this.coreMat.wireframe = false;

        this.ringMat = new BABYLON.StandardMaterial('NavNodeRingMat', this.scene);
        this.ringMat.disableLighting = true;
        this.ringMat.emissiveColor = BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
        this.ringMat.alpha = 0.6;
        this.ringMat.wireframe = this.options.wireframe;

        this.invalidRingMat = new BABYLON.StandardMaterial('NavNodeRingInvalidMat', this.scene);
        this.invalidRingMat.disableLighting = true;
        this.invalidRingMat.emissiveColor = new BABYLON.Color3(1, 0.25, 0.25);
        this.invalidRingMat.alpha = 0.7;
        this.invalidRingMat.wireframe = this.options.wireframe;
    }

    build(): void {
        // Glow layer (for halo + path feeling). We will only allow selected meshes to glow.
        this.glow = this.scene.getGlowLayerByName('NavGlow') || new BABYLON.GlowLayer('NavGlow', this.scene, {
            mainTextureRatio: 0.6,
        });
        this.glow.intensity = ANIM.HOLOGRAM.GLOW_INTENSITY;
        this.glow.blurKernelSize = ANIM.HOLOGRAM.GLOW_BLUR_KERNEL;
        this.glow.customEmissiveColorSelector = (mesh, _sub, _mat, result) => {
            const allow = !!(mesh.metadata as any)?.navGlow;
            if (!allow) {
                result.set(0, 0, 0, 0);
                return;
            }
            // Cyan glow for normal, red glow for invalid
            const invalid = !!(mesh.metadata as any)?.navInvalidGlow;
            if (invalid) {
                result.set(1, 0.22, 0.22, 1);
                return;
            }
            const c = BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
            result.set(c.r, c.g, c.b, 1);
        };

        for (const node of this.graph.getNodes()) {
            this.createNodeMesh(node);
        }

        // Phase 2.3: static materials - freeze for GPU optimization.
        this.coreMat.freeze();
        this.ringMat.freeze();
        this.invalidRingMat.freeze();
    }

    private createNodeMesh(node: NavigationNode): void {
        // Core sphere (white)
        const core = BABYLON.MeshBuilder.CreateSphere(
            `NavNodeCore_${node.id}`,
            { diameter: LAYOUT.HOLOGRAM.NODE_CORE_DIAMETER, segments: 16 },
            this.scene
        );
        core.position.copyFrom(node.position);
        core.material = this.coreMat;
        core.isPickable = true;
        core.metadata = { navNodeId: node.id };

        // Ring (cyan) - torus laying flat
        const ring = BABYLON.MeshBuilder.CreateTorus(
            `NavNodeRing_${node.id}`,
            {
                diameter: LAYOUT.HOLOGRAM.NODE_RING_DIAMETER,
                thickness: LAYOUT.HOLOGRAM.NODE_RING_THICKNESS,
                tessellation: 32,
            },
            this.scene
        );
        ring.position.copyFrom(node.position);
        ring.rotation.x = Math.PI / 2;
        ring.material = this.ringMat;
        ring.isPickable = false;
        ring.metadata = { navNodeId: node.id };

        // Halo light (selected only)
        const halo = new BABYLON.PointLight(`NavNodeHalo_${node.id}`, node.position.clone(), this.scene);
        halo.diffuse = BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
        halo.intensity = 0;
        halo.range = 6;

        this.nodesById.set(node.id, { core, ring, haloLight: halo });
    }

    setSelection(sequence: string[], isOverBudget: boolean): void {
        this.selected = new Set(sequence);

        for (const [id, node] of this.nodesById.entries()) {
            const isSelected = this.selected.has(id);

            node.ring.material = isOverBudget && isSelected ? this.invalidRingMat : this.ringMat;

            // ring thickness feel: scale up when selected
            const targetScale = isSelected ? 1.12 : 1.0;
            node.ring.scaling.set(targetScale, targetScale, targetScale);

            // Halo + glow only when selected
            node.haloLight.intensity = isSelected ? 2.0 : 0;
            (node.ring.metadata as any).navGlow = isSelected;
            (node.core.metadata as any).navGlow = isSelected;
            (node.ring.metadata as any).navInvalidGlow = isSelected && isOverBudget;
            (node.core.metadata as any).navInvalidGlow = isSelected && isOverBudget;
        }
    }

    getNodeIdFromMesh(mesh: BABYLON.AbstractMesh | null | undefined): string | null {
        if (!mesh) return null;
        const id = (mesh.metadata as any)?.navNodeId;
        return typeof id === 'string' ? id : null;
    }

    dispose(): void {
        for (const { core, ring, haloLight } of this.nodesById.values()) {
            haloLight.dispose();
            ring.dispose();
            core.dispose();
        }
        this.nodesById.clear();
        this.coreMat.dispose();
        this.ringMat.dispose();
        this.invalidRingMat.dispose();
        // Keep glow layer for scene lifetime; don't dispose here (may be shared).
    }
}

