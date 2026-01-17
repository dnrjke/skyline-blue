/**
 * TacticalDesignController - Phase 3 Tactical Design Integration
 *
 * Integrates:
 * - FateLinker (node management)
 * - GizmoController (node editing)
 * - WindTrail (path visualization)
 *
 * Replaces legacy NavigationGraph + PathStore system.
 *
 * Design Philosophy:
 * "Fate is chosen, not computed."
 */

import * as BABYLON from '@babylonjs/core';
import { FateLinker } from '../fate/FateLinker';
import { GizmoController } from '../fate/GizmoController';
import { WindTrail } from '../fate/WindTrail';
import type { FateNode } from '../fate/FateNode';

/**
 * Input modes for TacticalDesignController
 *
 * CRITICAL: These modes are MUTUALLY EXCLUSIVE
 * Only ONE type of input is processed per mode
 *
 * - camera: Camera movement ONLY. No node creation, no selection.
 * - place: Node placement ONLY. Tap creates node. Camera drag blocked.
 * - edit: Gizmo manipulation ONLY. Select existing nodes. Gizmo drag.
 */
export type TacticalInputMode = 'camera' | 'place' | 'edit';

export interface TacticalDesignConfig {
    /** Maximum nodes allowed */
    maxNodes?: number;
    /** Default height for new nodes */
    defaultNodeHeight?: number;
}

export interface TacticalDesignState {
    /** Current node count */
    nodeCount: number;
    /** Maximum nodes */
    maxNodes: number;
    /** Selected node index (-1 if none) */
    selectedIndex: number;
    /** Whether editing is locked (during flight) */
    isLocked: boolean;
    /** Can add more nodes */
    canAddNode: boolean;
    /** Can start flight (need at least 2 nodes) */
    canLaunch: boolean;
    /** Current input mode */
    inputMode: TacticalInputMode;
}

export interface TacticalDesignCallbacks {
    /** Called when state changes */
    onStateChange?: (state: TacticalDesignState) => void;
    /** Called when node is added */
    onNodeAdded?: (node: FateNode) => void;
    /** Called when node is removed */
    onNodeRemoved?: (index: number) => void;
    /** Called when node is selected */
    onNodeSelected?: (node: FateNode | null) => void;
    /** Called when path changes */
    onPathChanged?: (nodeCount: number) => void;
}

/**
 * TacticalDesignController - manages the tactical design phase
 *
 * NO Dijkstra, NO automatic path computation.
 * Pure manual node placement.
 */
export class TacticalDesignController {
    private scene: BABYLON.Scene;
    private config: Required<TacticalDesignConfig>;

    // Core systems
    private fateLinker: FateLinker;
    private gizmoController: GizmoController;
    private windTrail: WindTrail;

    // State
    private isLocked: boolean = false;
    private disposed: boolean = false;
    private inputMode: TacticalInputMode = 'place'; // Default: node placement mode

    // Pointer tracking for tap detection
    private pointerDownTime: number = 0;
    private pointerDownPosition: { x: number; y: number } | null = null;
    private readonly TAP_THRESHOLD_MS = 300;
    private readonly TAP_MOVE_THRESHOLD = 10; // pixels

    // Callbacks
    private callbacks: TacticalDesignCallbacks = {};

    // Camera reference (for gizmo input blocking)
    private camera: BABYLON.ArcRotateCamera | null = null;

    constructor(scene: BABYLON.Scene, config: TacticalDesignConfig = {}) {
        this.scene = scene;
        this.config = {
            maxNodes: config.maxNodes ?? 15,
            defaultNodeHeight: config.defaultNodeHeight ?? 1.0,
        };

        // Initialize core systems
        this.fateLinker = new FateLinker(scene, {
            maxNodes: this.config.maxNodes,
        });

        this.gizmoController = new GizmoController(scene);
        this.windTrail = new WindTrail(scene);

        // Wire up internal callbacks
        this.setupInternalCallbacks();
    }

    private setupInternalCallbacks(): void {
        // FateLinker -> WindTrail sync
        this.fateLinker.setCallbacks({
            onNodesChanged: (nodes) => {
                this.windTrail.updateFromNodes(nodes);
                this.callbacks.onPathChanged?.(nodes.length);
                this.notifyStateChange();
            },
            onSelectionChanged: (selectedIndex) => {
                const node = this.fateLinker.getNode(selectedIndex);

                // Update gizmo
                if (node) {
                    this.gizmoController.attachTo(node);
                } else {
                    this.gizmoController.detach();
                }

                this.callbacks.onNodeSelected?.(node);
                this.notifyStateChange();
            },
        });

        // Gizmo -> FateLinker sync
        this.gizmoController.setCallbacks({
            onDragStart: () => {
                // Block camera during drag
            },
            onDragEnd: () => {
                // Sync node position after drag
                const node = this.gizmoController.getAttachedNode();
                if (node) {
                    this.fateLinker.syncNodeFromAnchor(node.index);
                }
            },
            onPositionChange: (_node, _position) => {
                // Real-time path update during drag
                this.windTrail.updateFromNodes(this.fateLinker.getAllNodes());
            },
        });
    }

    /**
     * Set callbacks
     */
    setCallbacks(callbacks: TacticalDesignCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Set camera for gizmo input blocking
     */
    setCamera(camera: BABYLON.ArcRotateCamera): void {
        this.camera = camera;
        this.gizmoController.setCamera(camera);
    }

    /**
     * Add a node at world position
     */
    addNodeAtPosition(position: BABYLON.Vector3): FateNode | null {
        if (this.isLocked || this.disposed) return null;

        const node = this.fateLinker.addNode(position);
        if (node) {
            this.callbacks.onNodeAdded?.(node);
        }
        return node;
    }

    /**
     * Add a node at screen coordinates (via picking)
     */
    addNodeAtScreenPosition(
        pointerX: number,
        pointerY: number,
        groundY: number = 0
    ): FateNode | null {
        if (this.isLocked || this.disposed) return null;

        // Create picking ray
        const ray = this.scene.createPickingRay(
            pointerX,
            pointerY,
            BABYLON.Matrix.Identity(),
            this.camera ?? this.scene.activeCamera
        );

        // Find intersection with ground plane
        const groundPlane = BABYLON.Plane.FromPositionAndNormal(
            new BABYLON.Vector3(0, groundY, 0),
            BABYLON.Vector3.Up()
        );

        const distance = ray.intersectsPlane(groundPlane);
        if (distance === null || distance < 0) return null;

        const worldPos = ray.origin.add(ray.direction.scale(distance));
        worldPos.y = this.config.defaultNodeHeight;

        return this.addNodeAtPosition(worldPos);
    }

    /**
     * Handle pointer down (for tap detection)
     */
    handlePointerDown(pointerX: number, pointerY: number): void {
        this.pointerDownTime = performance.now();
        this.pointerDownPosition = { x: pointerX, y: pointerY };
    }

    /**
     * Handle pointer up (complete tap detection)
     * Returns true if this was a valid tap
     */
    handlePointerUp(pointerX: number, pointerY: number): boolean {
        if (!this.pointerDownPosition) return false;

        const elapsed = performance.now() - this.pointerDownTime;
        const dx = Math.abs(pointerX - this.pointerDownPosition.x);
        const dy = Math.abs(pointerY - this.pointerDownPosition.y);
        const moved = Math.sqrt(dx * dx + dy * dy);

        // Reset tracking
        this.pointerDownPosition = null;

        // Check if this was a tap (quick, minimal movement)
        if (elapsed > this.TAP_THRESHOLD_MS || moved > this.TAP_MOVE_THRESHOLD) {
            return false; // This was a drag, not a tap
        }

        // Process as tap
        this.handleTap(pointerX, pointerY);
        return true;
    }

    /**
     * Handle tap on scene
     *
     * Mode-specific behavior:
     * - camera: NO processing (camera handles input)
     * - place: Create new node at tap position (no selection)
     * - edit: Select existing node (no creation)
     */
    handleTap(pointerX: number, pointerY: number): void {
        if (this.isLocked || this.disposed) return;

        // Camera mode: no tap processing
        if (this.inputMode === 'camera') {
            console.log('[TacticalDesign] Camera mode - tap ignored');
            return;
        }

        // Don't process taps during gizmo drag
        if (this.gizmoController.isDragging()) {
            console.log('[TacticalDesign] Gizmo dragging - tap ignored');
            return;
        }

        // EDIT mode: only select existing nodes
        if (this.inputMode === 'edit') {
            // [DEBUG] Log pick attempt
            console.log(`[TacticalDesign] Edit mode - picking at (${pointerX}, ${pointerY})`);

            // Create picking ray from MAIN scene camera
            const camera = this.camera ?? this.scene.activeCamera;
            if (!camera) {
                console.warn('[TacticalDesign] No camera for picking');
                return;
            }

            const ray = this.scene.createPickingRay(
                pointerX,
                pointerY,
                BABYLON.Matrix.Identity(),
                camera
            );

            // [DEBUG] Log ray info
            console.log('[TacticalDesign] Pick ray:', ray.origin.toString(), ray.direction.toString());

            // Manual intersection test against all nodes
            const nodes = this.fateLinker.getAllNodes();
            let closestNode: FateNode | null = null;
            let closestDistance = Infinity;

            for (const node of nodes) {
                // Get world position of the node marker
                const markerWorldPos = node.anchor.position;
                const markerRadius = 0.25; // Half of diameter 0.5

                // Ray-sphere intersection
                const toMarker = markerWorldPos.subtract(ray.origin);
                const tca = BABYLON.Vector3.Dot(toMarker, ray.direction);

                if (tca < 0) continue; // Marker is behind ray origin

                const d2 = BABYLON.Vector3.Dot(toMarker, toMarker) - tca * tca;
                const r2 = markerRadius * markerRadius * 4; // Larger hit area for touch

                if (d2 > r2) continue; // Ray misses sphere

                const thc = Math.sqrt(r2 - d2);
                const t = tca - thc;

                if (t > 0 && t < closestDistance) {
                    closestDistance = t;
                    closestNode = node;
                }
            }

            // [DEBUG] Log result
            console.log(`[TacticalDesign] Pick result: ${closestNode ? `node ${closestNode.index}` : 'none'}`);

            if (closestNode) {
                this.fateLinker.selectNode(closestNode.index);
                console.log(`[TacticalDesign] Edit mode - selected node ${closestNode.index}`);
            } else {
                // Tap on empty space in edit mode: deselect
                this.fateLinker.deselectAll();
                console.log('[TacticalDesign] Edit mode - deselected all');
            }
            return;
        }

        // PLACE mode: only create new nodes
        if (this.inputMode === 'place') {
            if (this.fateLinker.canAddNode()) {
                this.addNodeAtScreenPosition(pointerX, pointerY);
                console.log('[TacticalDesign] Place mode - node added');
            } else {
                console.log('[TacticalDesign] Place mode - max nodes reached');
            }
            return;
        }
    }

    /**
     * Remove selected node
     */
    removeSelectedNode(): boolean {
        if (this.isLocked || this.disposed) return false;

        const selectedIndex = this.fateLinker.getSelectedIndex();
        if (selectedIndex < 0) return false;

        const removed = this.fateLinker.removeNode(selectedIndex);
        if (removed) {
            this.callbacks.onNodeRemoved?.(selectedIndex);
        }
        return removed;
    }

    /**
     * Remove last node
     */
    removeLastNode(): boolean {
        if (this.isLocked || this.disposed) return false;
        return this.fateLinker.removeLastNode();
    }

    /**
     * Clear all nodes
     */
    clearAllNodes(): void {
        if (this.isLocked || this.disposed) return;

        this.gizmoController.detach();
        this.fateLinker.clear();
    }

    /**
     * Deselect all nodes
     */
    deselectAll(): void {
        this.fateLinker.deselectAll();
    }

    /**
     * Get current state
     */
    getState(): TacticalDesignState {
        return {
            nodeCount: this.fateLinker.getNodeCount(),
            maxNodes: this.fateLinker.getMaxNodes(),
            selectedIndex: this.fateLinker.getSelectedIndex(),
            isLocked: this.isLocked,
            canAddNode: this.fateLinker.canAddNode() && !this.isLocked,
            canLaunch: this.fateLinker.getNodeCount() >= 2 && !this.isLocked,
            inputMode: this.inputMode,
        };
    }

    /**
     * Set input mode
     *
     * Mode transitions:
     * - camera: Deselect all nodes, detach gizmo
     * - place: Deselect all nodes, detach gizmo
     * - edit: Ready for node selection
     */
    setInputMode(mode: TacticalInputMode): void {
        if (this.inputMode === mode) return;

        const prevMode = this.inputMode;
        this.inputMode = mode;

        // Mode transition logic
        if (mode === 'camera' || mode === 'place') {
            // Camera/Place: detach gizmo, deselect
            this.gizmoController.detach();
            this.fateLinker.deselectAll();
        }

        this.notifyStateChange();
        console.log(`[TacticalDesign] Input mode: ${prevMode} → ${mode}`);
    }

    /**
     * Get current input mode
     */
    getInputMode(): TacticalInputMode {
        return this.inputMode;
    }

    /**
     * Cycle through input modes: camera → place → edit → camera
     */
    cycleInputMode(): TacticalInputMode {
        const order: TacticalInputMode[] = ['camera', 'place', 'edit'];
        const currentIndex = order.indexOf(this.inputMode);
        const nextIndex = (currentIndex + 1) % order.length;
        const newMode = order[nextIndex];
        this.setInputMode(newMode);
        return newMode;
    }

    /**
     * Toggle between camera and place modes (legacy compatibility)
     * @deprecated Use cycleInputMode() instead
     */
    toggleInputMode(): TacticalInputMode {
        const newMode = this.inputMode === 'camera' ? 'place' : 'camera';
        this.setInputMode(newMode);
        return newMode;
    }

    /**
     * Get all node positions
     */
    getNodePositions(): BABYLON.Vector3[] {
        return this.fateLinker.getPositions();
    }

    /**
     * Generate Path3D from current nodes
     */
    generatePath3D(): BABYLON.Path3D | null {
        return this.fateLinker.generatePath3D();
    }

    /**
     * Lock editing (for flight phase)
     */
    lock(): void {
        this.isLocked = true;
        this.gizmoController.detach();
        this.fateLinker.deselectAll();
        this.notifyStateChange();
    }

    /**
     * Unlock editing (return to design phase)
     */
    unlock(): void {
        this.isLocked = false;
        this.notifyStateChange();
    }

    /**
     * Get WindTrail for launch animation
     */
    getWindTrail(): WindTrail {
        return this.windTrail;
    }

    /**
     * Get FateLinker for direct access
     */
    getFateLinker(): FateLinker {
        return this.fateLinker;
    }

    /**
     * Check if gizmo is currently dragging
     */
    isGizmoDragging(): boolean {
        return this.gizmoController.isDragging();
    }

    private notifyStateChange(): void {
        this.callbacks.onStateChange?.(this.getState());
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.gizmoController.dispose();
        this.windTrail.dispose();
        this.fateLinker.dispose();
    }
}
