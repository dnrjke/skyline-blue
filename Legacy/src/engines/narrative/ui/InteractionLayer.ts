/**
 * InteractionLayer - Single Source of Input
 *
 * All clicks/touches are received here only.
 * See: docs/arcana_ui_rules.md §1.1
 *
 * Part of Narrative Engine - internal module
 */

import * as GUI from '@babylonjs/gui';

export type InteractionCallback = () => void;

export class InteractionLayer {
    private container: GUI.Rectangle;
    private clickArea: GUI.Rectangle;
    private isEnabled: boolean = true;

    /**
     * 입력 핸들러 스택 (top-most wins)
     * - HEBS: 입력은 InteractionLayer 단일 지점에서만 소비
     * - Flow(시작화면/시나리오/팝업 등)에 따라 최상단 핸들러만 실행
     */
    private handlers: Map<string, InteractionCallback> = new Map();
    private handlerStack: string[] = [];

    constructor(parentLayer: GUI.Rectangle) {
        this.container = parentLayer;

        // Create invisible click receiver
        // Alpha 0.01 rule + background color for reliable hit detection
        this.clickArea = new GUI.Rectangle('ClickArea');
        this.clickArea.width = '100%';
        this.clickArea.height = '100%';
        this.clickArea.thickness = 0;
        this.clickArea.background = 'black';
        this.clickArea.alpha = 0.01;
        this.clickArea.isPointerBlocker = true;
        this.clickArea.isHitTestVisible = true;

        // Diagnostic: Pointer enter test
        this.clickArea.onPointerEnterObservable.add(() => {
            console.log('[Input] Pointer ENTER detected');
        });

        // Use onPointerDownObservable for touch detection
        this.clickArea.onPointerDownObservable.add(() => {
            console.log('[Input] PointerDown received');
            console.log('[Input] HandlerStack (top last)=', this.handlerStack.join(' > ') || '(empty)');

            if (!this.isEnabled) {
                console.log('[Input] Ignored (InteractionLayer disabled)');
                return;
            }

            const handler = this.getTopHandler();
            if (!handler) {
                console.log('[Input] Ignored (no handler registered)');
                return;
            }
            handler();
        });

        this.container.addControl(this.clickArea);

        // Diagnostic log after adding to GUI
        console.log('[InteractionLayer] Initialized');
        console.log(
            '[InteractionLayer] clickArea added:',
            'parentZIndex=', this.container.zIndex,
            'hitTest=', this.clickArea.isHitTestVisible,
            'pointerBlocker=', this.clickArea.isPointerBlocker,
            'alpha=', this.clickArea.alpha
        );
    }

    setOnClick(callback: InteractionCallback): void {
        // Backward-compat alias: treat as "narrative" base handler
        this.pushHandler('narrative', callback);
    }

    /**
     * Push or replace a handler and move it to top.
     */
    pushHandler(key: string, callback: InteractionCallback): void {
        this.handlers.set(key, callback);
        this.handlerStack = this.handlerStack.filter((k) => k !== key);
        this.handlerStack.push(key);
        console.log(`[Input] Handler pushed: ${key} (depth=${this.handlerStack.length})`);
    }

    /**
     * Remove a handler (if exists).
     */
    popHandler(key: string): void {
        if (!this.handlers.has(key)) return;
        this.handlers.delete(key);
        this.handlerStack = this.handlerStack.filter((k) => k !== key);
        console.log(`[Input] Handler popped: ${key} (depth=${this.handlerStack.length})`);
    }

    private getTopHandler(): InteractionCallback | null {
        for (let i = this.handlerStack.length - 1; i >= 0; i--) {
            const key = this.handlerStack[i];
            const cb = this.handlers.get(key);
            if (cb) return cb;
        }
        return null;
    }

    setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        this.clickArea.isEnabled = enabled;
        console.log(`[Input] InteractionLayer enabled = ${enabled}`);
    }

    getEnabled(): boolean {
        return this.isEnabled;
    }

    /**
     * Set whether the click area blocks pointer events from reaching 3D scene.
     * When false, camera controls and mesh picking work normally.
     * Default is true (blocks events).
     */
    setPointerBlockerEnabled(enabled: boolean): void {
        this.clickArea.isPointerBlocker = enabled;
        this.clickArea.isHitTestVisible = enabled;
        console.log(`[Input] PointerBlocker = ${enabled}`);
    }

    dispose(): void {
        this.clickArea.dispose();
    }
}
