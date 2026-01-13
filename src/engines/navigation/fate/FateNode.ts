/**
 * FateNode - Phase 3 Manual Node Design
 *
 * Represents a single point in a player-authored Fate Line.
 * Unlike NavigationNode (legacy), FateNode:
 * - Has no energy/score values
 * - Is purely positional
 * - Includes visual anchor and marker
 */

import * as BABYLON from '@babylonjs/core';

/**
 * FateNode data structure
 *
 * Index Rules:
 * - 0-based, always sequential
 * - Deleting a middle node shifts subsequent indices down
 * - No mid-insertion (future extension)
 */
export interface FateNodeData {
    /** 0-based index, always sequential */
    index: number;

    /** World position (editable via Gizmo) */
    position: BABYLON.Vector3;

    /** Creation timestamp for ordering verification */
    createdAt: number;
}

/**
 * FateNode - runtime representation with Babylon objects
 */
export class FateNode {
    readonly data: FateNodeData;

    /** Babylon TransformNode as anchor for gizmo attachment */
    readonly anchor: BABYLON.TransformNode;

    /** Visual marker mesh (sphere) */
    readonly marker: BABYLON.Mesh;

    /** Selection state */
    private _selected: boolean = false;

    /** Material references for selection visual */
    private normalMaterial: BABYLON.StandardMaterial;
    private selectedMaterial: BABYLON.StandardMaterial;

    constructor(
        scene: BABYLON.Scene,
        index: number,
        position: BABYLON.Vector3,
        normalMat: BABYLON.StandardMaterial,
        selectedMat: BABYLON.StandardMaterial
    ) {
        this.data = {
            index,
            position: position.clone(),
            createdAt: Date.now(),
        };

        this.normalMaterial = normalMat;
        this.selectedMaterial = selectedMat;

        // Create anchor TransformNode
        this.anchor = new BABYLON.TransformNode(`FateNode_Anchor_${index}`, scene);
        this.anchor.position = position.clone();

        // Create visual marker
        this.marker = BABYLON.MeshBuilder.CreateSphere(
            `FateNode_Marker_${index}`,
            { diameter: 0.5 },
            scene
        );
        this.marker.parent = this.anchor;
        this.marker.position = BABYLON.Vector3.Zero();
        this.marker.material = this.normalMaterial;

        // [Babylon 8.x Rendering Fix] Ensure mesh is included in active meshes
        // See docs/babylon_rendering_rules.md
        this.marker.layerMask = 0x0FFFFFFF;           // All layers
        this.marker.alwaysSelectAsActiveMesh = true;  // Force active mesh inclusion
        this.marker.renderingGroupId = 0;             // Default rendering group
        this.marker.computeWorldMatrix(true);         // Force world matrix update
        this.marker.refreshBoundingInfo(true);        // Force bounding info update

        // Metadata for picking
        this.marker.metadata = { fateNodeIndex: index };
        this.marker.isPickable = true;
    }

    get index(): number {
        return this.data.index;
    }

    get position(): BABYLON.Vector3 {
        return this.data.position;
    }

    get selected(): boolean {
        return this._selected;
    }

    /**
     * Update index (used when re-indexing after deletion)
     */
    setIndex(newIndex: number): void {
        this.data.index = newIndex;
        this.anchor.name = `FateNode_Anchor_${newIndex}`;
        this.marker.name = `FateNode_Marker_${newIndex}`;
        this.marker.metadata = { fateNodeIndex: newIndex };
    }

    /**
     * Update position (called during Gizmo drag)
     */
    setPosition(newPos: BABYLON.Vector3): void {
        this.data.position.copyFrom(newPos);
        this.anchor.position.copyFrom(newPos);
    }

    /**
     * Sync position from anchor (after Gizmo manipulation)
     */
    syncFromAnchor(): void {
        this.data.position.copyFrom(this.anchor.position);
    }

    /**
     * Set selection state
     */
    setSelected(selected: boolean): void {
        this._selected = selected;
        this.marker.material = selected ? this.selectedMaterial : this.normalMaterial;

        // Visual feedback: scale up when selected
        const scale = selected ? 1.3 : 1.0;
        this.marker.scaling.setAll(scale);
    }

    /**
     * Dispose Babylon objects
     */
    dispose(): void {
        this.marker.dispose();
        this.anchor.dispose();
    }
}
