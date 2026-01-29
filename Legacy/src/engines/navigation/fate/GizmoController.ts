/**
 * GizmoController - Phase 3 Single Gizmo Management
 *
 * Core Rules:
 * - Only ONE gizmo active at any time
 * - Auto-detach previous when attaching new
 * - Camera input blocked during drag
 * - Force dispose on Launch entry
 */

import * as BABYLON from '@babylonjs/core';
import type { FateNode } from './FateNode';

export interface GizmoControllerCallbacks {
    /** Called when gizmo starts dragging */
    onDragStart?: () => void;
    /** Called when gizmo stops dragging */
    onDragEnd?: () => void;
    /** Called when node position changes during drag */
    onPositionChange?: (node: FateNode, position: BABYLON.Vector3) => void;
}

/**
 * GizmoController - manages single Position Gizmo for FateNode editing
 *
 * Input Priority:
 * Gizmo Dragging > Camera Input
 */
export class GizmoController {
    private scene: BABYLON.Scene;
    private utilityLayer: BABYLON.UtilityLayerRenderer;
    private gizmo: BABYLON.PositionGizmo | null = null;
    private attachedNode: FateNode | null = null;
    private _isDragging: boolean = false;

    // Camera control state (for input blocking)
    private camera: BABYLON.ArcRotateCamera | null = null;
    private cameraInputsEnabled: boolean = true;

    // Callbacks
    private callbacks: GizmoControllerCallbacks = {};

    // Disposed flag
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;

        // Create utility layer for gizmo rendering
        this.utilityLayer = new BABYLON.UtilityLayerRenderer(scene);
        this.utilityLayer.utilityLayerScene.autoClearDepthAndStencil = false;
    }

    /**
     * Set callbacks
     */
    setCallbacks(callbacks: GizmoControllerCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Set the camera to manage (for input blocking)
     */
    setCamera(camera: BABYLON.ArcRotateCamera): void {
        this.camera = camera;
    }

    /**
     * Attach gizmo to a FateNode
     * Auto-detaches from previous node
     */
    attachTo(node: FateNode): void {
        if (this.disposed) return;

        // Detach from previous
        if (this.attachedNode !== node) {
            this.detach();
        }

        // Create gizmo if needed
        if (!this.gizmo) {
            this.gizmo = new BABYLON.PositionGizmo(this.utilityLayer);
            this.gizmo.scaleRatio = 1.2;
            this.gizmo.updateGizmoRotationToMatchAttachedMesh = false;

            // Setup drag observers
            this.setupDragObservers();
        }

        // Attach to node's anchor
        this.gizmo.attachedNode = node.anchor;
        this.attachedNode = node;

        console.log(`[GizmoController] Attached to node ${node.index}`);
    }

    /**
     * Detach gizmo from current node
     */
    detach(): void {
        if (this.gizmo) {
            this.gizmo.attachedNode = null;
        }

        // Sync position from anchor before detaching
        if (this.attachedNode) {
            this.attachedNode.syncFromAnchor();
        }

        this.attachedNode = null;

        // Restore camera input if was blocked
        this.restoreCameraInput();
    }

    /**
     * Force dispose gizmo (for Launch entry)
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.detach();

        if (this.gizmo) {
            this.gizmo.dispose();
            this.gizmo = null;
        }

        this.utilityLayer.dispose();
    }

    /**
     * Check if currently dragging
     */
    isDragging(): boolean {
        return this._isDragging;
    }

    /**
     * Get currently attached node
     */
    getAttachedNode(): FateNode | null {
        return this.attachedNode;
    }

    /**
     * Check if gizmo is currently attached
     */
    isAttached(): boolean {
        return this.attachedNode !== null;
    }

    private setupDragObservers(): void {
        if (!this.gizmo) return;

        // Each axis gizmo has its own drag observable
        const axes = [this.gizmo.xGizmo, this.gizmo.yGizmo, this.gizmo.zGizmo];

        for (const axis of axes) {
            axis.dragBehavior.onDragStartObservable.add(() => {
                this.onDragStart();
            });

            axis.dragBehavior.onDragObservable.add(() => {
                this.onDrag();
            });

            axis.dragBehavior.onDragEndObservable.add(() => {
                this.onDragEnd();
            });
        }
    }

    private onDragStart(): void {
        this._isDragging = true;
        this.blockCameraInput();
        this.callbacks.onDragStart?.();
        console.log('[GizmoController] Drag started');
    }

    private onDrag(): void {
        if (this.attachedNode) {
            // Sync node position from anchor during drag
            this.attachedNode.syncFromAnchor();
            this.callbacks.onPositionChange?.(
                this.attachedNode,
                this.attachedNode.position
            );
        }
    }

    private onDragEnd(): void {
        this._isDragging = false;
        this.restoreCameraInput();

        if (this.attachedNode) {
            this.attachedNode.syncFromAnchor();
            console.log(
                `[GizmoController] Drag ended, node ${this.attachedNode.index} at`,
                this.attachedNode.position.toString()
            );
        }

        this.callbacks.onDragEnd?.();
    }

    private blockCameraInput(): void {
        if (!this.camera || !this.cameraInputsEnabled) return;

        this.camera.detachControl();
        this.cameraInputsEnabled = false;
        console.log('[GizmoController] Camera input blocked');
    }

    private restoreCameraInput(): void {
        if (!this.camera || this.cameraInputsEnabled) return;

        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (canvas) {
            this.camera.attachControl(canvas, true);
        }
        this.cameraInputsEnabled = true;
        console.log('[GizmoController] Camera input restored');
    }
}
