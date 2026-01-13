/**
 * FateLinker - Phase 3 Manual Node Design System
 *
 * Core principles:
 * - Manual add/remove ONLY (no auto-computation)
 * - Fixed maximum node count (10-20)
 * - Sequential indexing (0 → N)
 * - Auto re-index on deletion
 *
 * ❌ NO Dijkstra
 * ❌ NO automatic path correction
 * ❌ NO graph-based pathfinding
 */

import * as BABYLON from '@babylonjs/core';
import { FateNode } from './FateNode';

export interface FateLinkerConfig {
    /** Maximum allowed nodes (default: 15) */
    maxNodes?: number;
    /** Marker size (default: 0.5) */
    markerSize?: number;
    /** External UtilityLayerRenderer (optional, will create own if not provided) */
    utilityLayer?: BABYLON.UtilityLayerRenderer;
}

export interface FateLinkerCallbacks {
    /** Called when node list changes */
    onNodesChanged?: (nodes: ReadonlyArray<FateNode>) => void;
    /** Called when selection changes */
    onSelectionChanged?: (selectedIndex: number) => void;
}

/**
 * FateLinker - manages the player-authored Fate Line
 *
 * Design Philosophy:
 * "Fate is chosen, not computed."
 */
export class FateLinker {
    private nodes: FateNode[] = [];
    private readonly MAX_NODES: number;
    private selectedIndex: number = -1;

    // [Babylon 8.x] UtilityLayerScene for bypassing rendering pipeline
    // See docs/babylon_rendering_rules.md Section 1
    private utilityLayer: BABYLON.UtilityLayerRenderer;
    private utilityScene: BABYLON.Scene;
    private ownsUtilityLayer: boolean = false;

    // Materials (shared across all nodes, created in utilityScene)
    private normalMaterial: BABYLON.StandardMaterial;
    private selectedMaterial: BABYLON.StandardMaterial;

    // Callbacks
    private callbacks: FateLinkerCallbacks = {};

    // Disposed flag
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: FateLinkerConfig = {}) {
        this.MAX_NODES = config.maxNodes ?? 15;

        // [Babylon 8.x] Create or use provided UtilityLayerRenderer
        // UtilityLayerScene bypasses rendering pipeline's active mesh evaluation
        if (config.utilityLayer) {
            this.utilityLayer = config.utilityLayer;
            this.ownsUtilityLayer = false;
        } else {
            this.utilityLayer = new BABYLON.UtilityLayerRenderer(scene);
            this.utilityLayer.utilityLayerScene.autoClearDepthAndStencil = false;
            this.ownsUtilityLayer = true;
        }
        this.utilityScene = this.utilityLayer.utilityLayerScene;

        // Create shared materials IN THE UTILITY SCENE
        this.normalMaterial = new BABYLON.StandardMaterial('FateNode_Normal', this.utilityScene);
        this.normalMaterial.emissiveColor = new BABYLON.Color3(0.3, 0.6, 1.0); // Soft blue
        this.normalMaterial.disableLighting = true;
        this.normalMaterial.alpha = 0.9;

        this.selectedMaterial = new BABYLON.StandardMaterial('FateNode_Selected', this.utilityScene);
        this.selectedMaterial.emissiveColor = new BABYLON.Color3(1.0, 0.8, 0.2); // Golden
        this.selectedMaterial.disableLighting = true;
        this.selectedMaterial.alpha = 1.0;

        // [Babylon 8.x] Material warmup - precompile shaders
        // See docs/babylon_rendering_rules.md Section 2
        this.warmupMaterials();

        console.log('[FateLinker] Initialized with UtilityLayerScene bypass');
    }

    /**
     * Warmup materials by forcing shader compilation
     * Prevents first-frame rendering failures in Babylon 8.x
     */
    private warmupMaterials(): void {
        const dummy = BABYLON.MeshBuilder.CreateSphere(
            '__FateNode_Warmup__',
            { diameter: 0.01 },
            this.utilityScene
        );
        dummy.isVisible = false;

        // Warmup normal material
        dummy.material = this.normalMaterial;
        this.normalMaterial.forceCompilationAsync(dummy).then(() => {
            // Warmup selected material
            dummy.material = this.selectedMaterial;
            return this.selectedMaterial.forceCompilationAsync(dummy);
        }).then(() => {
            dummy.dispose();
            console.log('[FateLinker] Materials precompiled in UtilityScene');
        }).catch((err) => {
            console.warn('[FateLinker] Material warmup failed:', err);
            dummy.dispose();
        });
    }

    /**
     * Set callbacks for state changes
     */
    setCallbacks(callbacks: FateLinkerCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Add a new node at the given position
     * Returns the created node, or null if max nodes reached
     */
    addNode(position: BABYLON.Vector3): FateNode | null {
        if (this.disposed) return null;
        if (this.nodes.length >= this.MAX_NODES) {
            console.warn(`[FateLinker] Max nodes (${this.MAX_NODES}) reached`);
            return null;
        }

        const index = this.nodes.length;
        // Create node in UtilityScene to bypass rendering pipeline
        const node = new FateNode(
            this.utilityScene,
            index,
            position,
            this.normalMaterial,
            this.selectedMaterial
        );

        this.nodes.push(node);
        this.notifyNodesChanged();

        console.log(`[FateLinker] Added node ${index} at`, position.toString());
        return node;
    }

    /**
     * Remove node at index
     * Auto re-indexes subsequent nodes
     */
    removeNode(index: number): boolean {
        if (this.disposed) return false;
        if (index < 0 || index >= this.nodes.length) return false;

        const node = this.nodes[index];
        node.dispose();
        this.nodes.splice(index, 1);

        // Re-index subsequent nodes
        for (let i = index; i < this.nodes.length; i++) {
            this.nodes[i].setIndex(i);
        }

        // Adjust selection if needed
        if (this.selectedIndex === index) {
            this.selectedIndex = -1;
            this.notifySelectionChanged();
        } else if (this.selectedIndex > index) {
            this.selectedIndex--;
            this.notifySelectionChanged();
        }

        this.notifyNodesChanged();
        console.log(`[FateLinker] Removed node ${index}, reindexed ${this.nodes.length} nodes`);
        return true;
    }

    /**
     * Remove the last node (convenience method)
     */
    removeLastNode(): boolean {
        if (this.nodes.length === 0) return false;
        return this.removeNode(this.nodes.length - 1);
    }

    /**
     * Select a node by index (-1 to deselect all)
     */
    selectNode(index: number): void {
        if (this.disposed) return;

        // Deselect current
        if (this.selectedIndex >= 0 && this.selectedIndex < this.nodes.length) {
            this.nodes[this.selectedIndex].setSelected(false);
        }

        // Select new
        this.selectedIndex = index;
        if (index >= 0 && index < this.nodes.length) {
            this.nodes[index].setSelected(true);
        }

        this.notifySelectionChanged();
    }

    /**
     * Deselect all nodes
     */
    deselectAll(): void {
        this.selectNode(-1);
    }

    /**
     * Get selected node index (-1 if none)
     */
    getSelectedIndex(): number {
        return this.selectedIndex;
    }

    /**
     * Get selected node (or null)
     */
    getSelectedNode(): FateNode | null {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.nodes.length) {
            return null;
        }
        return this.nodes[this.selectedIndex];
    }

    /**
     * Move node to new position
     */
    moveNode(index: number, newPosition: BABYLON.Vector3): void {
        if (this.disposed) return;
        if (index < 0 || index >= this.nodes.length) return;

        this.nodes[index].setPosition(newPosition);
        this.notifyNodesChanged();
    }

    /**
     * Sync node position from its anchor (after Gizmo manipulation)
     */
    syncNodeFromAnchor(index: number): void {
        if (index < 0 || index >= this.nodes.length) return;

        this.nodes[index].syncFromAnchor();
        this.notifyNodesChanged();
    }

    /**
     * Get node by index
     */
    getNode(index: number): FateNode | null {
        if (index < 0 || index >= this.nodes.length) return null;
        return this.nodes[index];
    }

    /**
     * Get all nodes (read-only)
     */
    getAllNodes(): ReadonlyArray<FateNode> {
        return this.nodes;
    }

    /**
     * Get node count
     */
    getNodeCount(): number {
        return this.nodes.length;
    }

    /**
     * Get max node limit
     */
    getMaxNodes(): number {
        return this.MAX_NODES;
    }

    /**
     * Check if can add more nodes
     */
    canAddNode(): boolean {
        return this.nodes.length < this.MAX_NODES;
    }

    /**
     * Get all node positions (for WindTrail)
     */
    getPositions(): BABYLON.Vector3[] {
        return this.nodes.map(n => n.position.clone());
    }

    /**
     * Generate Path3D from current nodes
     * Returns null if less than 2 nodes
     */
    generatePath3D(): BABYLON.Path3D | null {
        if (this.nodes.length < 2) return null;

        const points = this.nodes.map(n => n.position.clone());

        // Create smooth Catmull-Rom spline
        const curve = BABYLON.Curve3.CreateCatmullRomSpline(points, 20, false);
        return new BABYLON.Path3D(curve.getPoints());
    }

    /**
     * Find node by picked mesh
     */
    findNodeByMesh(mesh: BABYLON.AbstractMesh | null): FateNode | null {
        if (!mesh) return null;
        const metadata = mesh.metadata as { fateNodeIndex?: number } | undefined;
        if (metadata?.fateNodeIndex === undefined) return null;
        return this.getNode(metadata.fateNodeIndex);
    }

    /**
     * Clear all nodes
     */
    clear(): void {
        for (const node of this.nodes) {
            node.dispose();
        }
        this.nodes = [];
        this.selectedIndex = -1;
        this.notifySelectionChanged();
        this.notifyNodesChanged();
    }

    /**
     * Get the utility scene (for picking)
     */
    getUtilityScene(): BABYLON.Scene {
        return this.utilityScene;
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.clear();
        this.normalMaterial.dispose();
        this.selectedMaterial.dispose();

        // Only dispose utility layer if we own it
        if (this.ownsUtilityLayer) {
            this.utilityLayer.dispose();
        }
    }

    private notifyNodesChanged(): void {
        this.callbacks.onNodesChanged?.(this.nodes);
    }

    private notifySelectionChanged(): void {
        this.callbacks.onSelectionChanged?.(this.selectedIndex);
    }
}
