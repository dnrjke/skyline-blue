/**
 * EditorActionStack - Undo/Redo System for Arcana Vector Editor
 *
 * Manages reversible actions for node creation, deletion, and movement.
 * Follows Command Pattern with bidirectional execution.
 *
 * Key Rules:
 * - Redo is only valid after Undo
 * - New action commits clear the Redo stack
 * - Gizmo drag records ONE action at drag end (not during)
 */

import * as BABYLON from '@babylonjs/core';

/**
 * Base interface for all editor actions
 */
export interface EditorAction {
    /** Action type for debugging */
    readonly type: string;
    /** Execute the action (or re-execute for redo) */
    redo(): void;
    /** Reverse the action */
    undo(): void;
    /** Debug description */
    describe(): string;
}

/**
 * Callback interface for stack state changes
 */
export interface EditorActionStackCallbacks {
    /** Called when stack state changes */
    onStateChange?: (undoDepth: number, redoDepth: number) => void;
}

/**
 * EditorActionStack - manages undo/redo stacks
 */
export class EditorActionStack {
    private undoStack: EditorAction[] = [];
    private redoStack: EditorAction[] = [];
    private callbacks: EditorActionStackCallbacks = {};
    private maxStackSize: number = 50;

    constructor(maxStackSize: number = 50) {
        this.maxStackSize = maxStackSize;
    }

    /**
     * Set callbacks
     */
    setCallbacks(callbacks: EditorActionStackCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Execute and record a new action
     * CRITICAL: This clears the redo stack
     */
    execute(action: EditorAction): void {
        // Execute the action
        action.redo();

        // Push to undo stack
        this.undoStack.push(action);

        // Trim if over max size
        if (this.undoStack.length > this.maxStackSize) {
            this.undoStack.shift();
        }

        // CRITICAL: Clear redo stack on new action
        this.redoStack = [];

        console.log(`[EditorStack] Execute: ${action.describe()}`);
        this.notifyStateChange();
    }

    /**
     * Undo the last action
     * Returns true if an action was undone
     */
    undo(): boolean {
        if (this.undoStack.length === 0) {
            console.log('[EditorStack] Undo: stack empty');
            return false;
        }

        const action = this.undoStack.pop()!;
        action.undo();
        this.redoStack.push(action);

        console.log(`[EditorStack] Undo: ${action.describe()}`);
        this.notifyStateChange();
        return true;
    }

    /**
     * Redo the last undone action
     * Returns true if an action was redone
     */
    redo(): boolean {
        if (this.redoStack.length === 0) {
            console.log('[EditorStack] Redo: stack empty');
            return false;
        }

        const action = this.redoStack.pop()!;
        action.redo();
        this.undoStack.push(action);

        console.log(`[EditorStack] Redo: ${action.describe()}`);
        this.notifyStateChange();
        return true;
    }

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Get undo stack depth
     */
    getUndoDepth(): number {
        return this.undoStack.length;
    }

    /**
     * Get redo stack depth
     */
    getRedoDepth(): number {
        return this.redoStack.length;
    }

    /**
     * Clear all stacks
     */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        console.log('[EditorStack] Cleared');
        this.notifyStateChange();
    }

    private notifyStateChange(): void {
        this.callbacks.onStateChange?.(
            this.undoStack.length,
            this.redoStack.length
        );
    }
}

// ============================================
// Concrete Action Implementations
// ============================================

/**
 * Data needed to create/restore a node
 */
export interface NodeSnapshot {
    index: number;
    position: BABYLON.Vector3;
}

/**
 * Callbacks for node actions to interact with FateLinker
 */
export interface NodeActionCallbacks {
    createNode: (position: BABYLON.Vector3, atIndex?: number) => void;
    deleteNode: (index: number) => NodeSnapshot;
    moveNode: (index: number, position: BABYLON.Vector3) => void;
    getNodePosition: (index: number) => BABYLON.Vector3 | null;
}

/**
 * Action: Create a new node
 */
export class CreateNodeAction implements EditorAction {
    readonly type = 'CreateNode';
    private snapshot: NodeSnapshot;
    private callbacks: NodeActionCallbacks;

    constructor(position: BABYLON.Vector3, callbacks: NodeActionCallbacks) {
        this.snapshot = {
            index: -1, // Will be set after creation
            position: position.clone(),
        };
        this.callbacks = callbacks;
    }

    redo(): void {
        this.callbacks.createNode(this.snapshot.position);
        // Note: index tracking is handled by FateLinker
    }

    undo(): void {
        // Delete the last node (nodes are always appended)
        this.callbacks.deleteNode(this.snapshot.index);
    }

    setCreatedIndex(index: number): void {
        this.snapshot.index = index;
    }

    describe(): string {
        return `CreateNode at ${this.snapshot.position.toString()}`;
    }
}

/**
 * Action: Delete a node
 */
export class DeleteNodeAction implements EditorAction {
    readonly type = 'DeleteNode';
    private snapshot: NodeSnapshot | null = null;
    private targetIndex: number;
    private callbacks: NodeActionCallbacks;

    constructor(targetIndex: number, callbacks: NodeActionCallbacks) {
        this.targetIndex = targetIndex;
        this.callbacks = callbacks;
    }

    redo(): void {
        this.snapshot = this.callbacks.deleteNode(this.targetIndex);
    }

    undo(): void {
        if (this.snapshot) {
            this.callbacks.createNode(this.snapshot.position, this.snapshot.index);
        }
    }

    describe(): string {
        return `DeleteNode index=${this.targetIndex}`;
    }
}

/**
 * Action: Move a node (via Gizmo)
 * Recorded at drag END, not during
 */
export class MoveNodeAction implements EditorAction {
    readonly type = 'MoveNode';
    private nodeIndex: number;
    private fromPosition: BABYLON.Vector3;
    private toPosition: BABYLON.Vector3;
    private callbacks: NodeActionCallbacks;

    constructor(
        nodeIndex: number,
        fromPosition: BABYLON.Vector3,
        toPosition: BABYLON.Vector3,
        callbacks: NodeActionCallbacks
    ) {
        this.nodeIndex = nodeIndex;
        this.fromPosition = fromPosition.clone();
        this.toPosition = toPosition.clone();
        this.callbacks = callbacks;
    }

    redo(): void {
        this.callbacks.moveNode(this.nodeIndex, this.toPosition);
    }

    undo(): void {
        this.callbacks.moveNode(this.nodeIndex, this.fromPosition);
    }

    describe(): string {
        return `MoveNode index=${this.nodeIndex}`;
    }
}
