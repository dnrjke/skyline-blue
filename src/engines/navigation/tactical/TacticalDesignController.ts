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
import {
    EditorActionStack,
    CreateNodeAction,
    DeleteNodeAction,
    MoveNodeAction,
    type NodeActionCallbacks,
} from './EditorActionStack';

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
    /** Undo stack depth */
    undoDepth: number;
    /** Redo stack depth */
    redoDepth: number;
    /** Can undo */
    canUndo: boolean;
    /** Can redo */
    canRedo: boolean;
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
    private actionStack: EditorActionStack;

    // State
    private isLocked: boolean = false;
    private disposed: boolean = false;
    private inputMode: TacticalInputMode = 'place'; // Default: node placement mode

    // Pointer tracking for tap detection
    private pointerDownTime: number = 0;
    private pointerDownPosition: { x: number; y: number } | null = null;
    private readonly TAP_THRESHOLD_MS = 300;
    private readonly TAP_MOVE_THRESHOLD = 10; // pixels

    // Gizmo drag tracking (for move action recording)
    private gizmoDragStartPosition: BABYLON.Vector3 | null = null;
    private gizmoDragNodeIndex: number = -1;

    // Callbacks
    private callbacks: TacticalDesignCallbacks = {};

    // Camera reference (for gizmo input blocking)
    private camera: BABYLON.ArcRotateCamera | null = null;

    // Node action callbacks for EditorActionStack
    private nodeActionCallbacks: NodeActionCallbacks;

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

        // Initialize Undo/Redo action stack
        this.actionStack = new EditorActionStack();
        this.actionStack.setCallbacks({
            onStateChange: () => this.notifyStateChange(),
        });

        // Setup node action callbacks for EditorActionStack
        this.nodeActionCallbacks = {
            createNode: (position, atIndex) => {
                if (atIndex !== undefined) {
                    this.fateLinker.insertNodeAt(position, atIndex);
                } else {
                    this.fateLinker.addNode(position);
                }
            },
            deleteNode: (index) => {
                const snapshot = this.fateLinker.removeNodeWithSnapshot(index);
                return snapshot ?? { index: -1, position: BABYLON.Vector3.Zero() };
            },
            moveNode: (index, position) => {
                this.fateLinker.moveNode(index, position);
            },
            getNodePosition: (index) => {
                const node = this.fateLinker.getNode(index);
                return node ? node.position.clone() : null;
            },
        };

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

        // Gizmo -> FateLinker sync + Action recording
        this.gizmoController.setCallbacks({
            onDragStart: () => {
                // Record start position for move action
                const node = this.gizmoController.getAttachedNode();
                if (node) {
                    this.gizmoDragStartPosition = node.position.clone();
                    this.gizmoDragNodeIndex = node.index;
                    console.log(`[TacticalDesign] Gizmo drag start: node ${node.index}`);
                }
            },
            onDragEnd: () => {
                // Sync node position after drag
                const node = this.gizmoController.getAttachedNode();
                if (node) {
                    this.fateLinker.syncNodeFromAnchor(node.index);

                    // Record move action (only if position actually changed)
                    if (this.gizmoDragStartPosition && this.gizmoDragNodeIndex >= 0) {
                        const endPos = node.position;
                        const moved = !this.gizmoDragStartPosition.equals(endPos);

                        if (moved) {
                            const moveAction = new MoveNodeAction(
                                this.gizmoDragNodeIndex,
                                this.gizmoDragStartPosition,
                                endPos.clone(),
                                this.nodeActionCallbacks
                            );
                            // Don't execute - just record (position already changed)
                            this.actionStack['undoStack'].push(moveAction);
                            this.actionStack['redoStack'] = [];
                            console.log(`[TacticalDesign] Recorded move action: node ${node.index}`);
                            this.notifyStateChange();
                        }
                    }
                }

                // Reset drag tracking
                this.gizmoDragStartPosition = null;
                this.gizmoDragNodeIndex = -1;
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
     * Set camera for gizmo input blocking and mode-based control
     */
    setCamera(camera: BABYLON.ArcRotateCamera): void {
        this.camera = camera;
        this.gizmoController.setCamera(camera);

        // Initialize camera controls based on current mode
        this.updateCameraControls(this.inputMode);
    }

    /**
     * Add a node at world position (via action stack for undo support)
     */
    addNodeAtPosition(position: BABYLON.Vector3): FateNode | null {
        if (this.isLocked || this.disposed) return null;

        // Create and execute action (records for undo)
        const action = new CreateNodeAction(position, this.nodeActionCallbacks);
        action.setCreatedIndex(this.fateLinker.getNodeCount()); // Will be this index
        this.actionStack.execute(action);

        // Get the created node
        const node = this.fateLinker.getNode(this.fateLinker.getNodeCount() - 1);
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

            // Manual intersection test against all nodes using hitProxy radius
            const nodes = this.fateLinker.getAllNodes();
            let closestNode: FateNode | null = null;
            let closestDistance = Infinity;

            // HitProxy radius: 0.5 * 3.0 / 2 = 0.75 (FateNode.HIT_PROXY_SCALE = 3.0)
            const hitProxyRadius = 0.75;

            for (const node of nodes) {
                // Get world position of the node anchor
                const nodeWorldPos = node.anchor.position;

                // Ray-sphere intersection using hitProxy radius
                const toNode = nodeWorldPos.subtract(ray.origin);
                const tca = BABYLON.Vector3.Dot(toNode, ray.direction);

                if (tca < 0) continue; // Node is behind ray origin

                const d2 = BABYLON.Vector3.Dot(toNode, toNode) - tca * tca;
                const r2 = hitProxyRadius * hitProxyRadius;

                if (d2 > r2) continue; // Ray misses hitProxy sphere

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
     * Remove selected node (via action stack for undo support)
     */
    removeSelectedNode(): boolean {
        if (this.isLocked || this.disposed) return false;

        const selectedIndex = this.fateLinker.getSelectedIndex();
        if (selectedIndex < 0) return false;

        // Create and execute delete action
        const action = new DeleteNodeAction(selectedIndex, this.nodeActionCallbacks);
        this.actionStack.execute(action);

        this.gizmoController.detach();
        this.callbacks.onNodeRemoved?.(selectedIndex);
        return true;
    }

    /**
     * Remove last node (via action stack for undo support)
     */
    removeLastNode(): boolean {
        if (this.isLocked || this.disposed) return false;
        if (this.fateLinker.getNodeCount() === 0) return false;

        const lastIndex = this.fateLinker.getNodeCount() - 1;
        const action = new DeleteNodeAction(lastIndex, this.nodeActionCallbacks);
        this.actionStack.execute(action);

        this.callbacks.onNodeRemoved?.(lastIndex);
        return true;
    }

    /**
     * Clear all nodes (also clears action stack)
     */
    clearAllNodes(): void {
        if (this.isLocked || this.disposed) return;

        this.gizmoController.detach();
        this.fateLinker.clear();
        this.actionStack.clear();
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
        const inEditableMode = this.inputMode !== 'camera';
        return {
            nodeCount: this.fateLinker.getNodeCount(),
            maxNodes: this.fateLinker.getMaxNodes(),
            selectedIndex: this.fateLinker.getSelectedIndex(),
            isLocked: this.isLocked,
            canAddNode: this.fateLinker.canAddNode() && !this.isLocked,
            canLaunch: this.fateLinker.getNodeCount() >= 2 && !this.isLocked,
            inputMode: this.inputMode,
            undoDepth: this.actionStack.getUndoDepth(),
            redoDepth: this.actionStack.getRedoDepth(),
            canUndo: this.actionStack.canUndo() && inEditableMode && !this.isLocked,
            canRedo: this.actionStack.canRedo() && inEditableMode && !this.isLocked,
        };
    }

    /**
     * Undo last action
     * Only available in Node/Edit modes
     */
    undo(): boolean {
        if (this.isLocked || this.inputMode === 'camera') {
            console.log('[TacticalDesign] Undo blocked: camera mode or locked');
            return false;
        }
        return this.actionStack.undo();
    }

    /**
     * Redo last undone action
     * Only available in Node/Edit modes
     */
    redo(): boolean {
        if (this.isLocked || this.inputMode === 'camera') {
            console.log('[TacticalDesign] Redo blocked: camera mode or locked');
            return false;
        }
        return this.actionStack.redo();
    }

    /**
     * Set input mode
     *
     * Mode transitions:
     * - camera: Enable camera controls, detach gizmo, disable node picking
     * - place: Disable camera controls, detach gizmo, disable node picking
     * - edit: Disable camera controls, enable node picking for selection
     */
    setInputMode(mode: TacticalInputMode): void {
        if (this.inputMode === mode) return;

        const prevMode = this.inputMode;
        this.inputMode = mode;

        // Camera control based on mode
        this.updateCameraControls(mode);

        // Mode transition logic
        if (mode === 'camera') {
            // Camera: detach gizmo, deselect, no node interaction
            this.gizmoController.detach();
            this.fateLinker.deselectAll();
            this.fateLinker.setAllNodesPickable(false);
        } else if (mode === 'place') {
            // Place: detach gizmo, deselect, no node interaction
            this.gizmoController.detach();
            this.fateLinker.deselectAll();
            this.fateLinker.setAllNodesPickable(false);
        } else if (mode === 'edit') {
            // Edit: enable picking for node selection
            this.fateLinker.setAllNodesPickable(true);
        }

        this.notifyStateChange();
        console.log(`[TacticalDesign] Input mode: ${prevMode} → ${mode}`);
    }

    /**
     * Update camera controls based on mode
     * Camera controls only active in camera mode
     */
    private updateCameraControls(mode: TacticalInputMode): void {
        if (!this.camera) return;

        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (!canvas) return;

        if (mode === 'camera') {
            // Enable camera controls for orbit + pan
            this.camera.attachControl(canvas, true);
            console.log('[TacticalDesign] Camera controls enabled (orbit + pan)');
        } else {
            // Disable camera controls in place/edit modes
            this.camera.detachControl();
            console.log('[TacticalDesign] Camera controls disabled');
        }
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
