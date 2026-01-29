/**
 * StoryControls - Skip / Auto system buttons (Layer 3: SKIP)
 *
 * Spec:
 * - Skip (right-top): long press to fill circular gauge (Ellipse.arc 0..1).
 *   Hold >= 1s triggers fast-forward mode.
 * - Auto (left-top): toggle on/off. When enabled, ScenarioManager auto-advances
 *   from uiState==='waiting' after delay.
 *
 * Input priority:
 * - These controls sit above InteractionLayer (zIndex=1100).
 * - isPointerBlocker=true to prevent underlying InteractionLayer tap.
 */
import * as GUI from '@babylonjs/gui';
import { ANIM, COLORS, FONT, LAYOUT } from '../../../shared/design';

export interface StoryControlsCallbacks {
    onToggleAuto: (enabled: boolean) => void;
    onHoldSkipTriggered: () => void;
    getAutoEnabled: () => boolean;
}

export class StoryControls {
    private parentLayer: GUI.Rectangle;
    private callbacks: StoryControlsCallbacks;

    private autoButton: GUI.Rectangle;
    private autoLabel: GUI.TextBlock;
    private autoIcon: GUI.TextBlock;

    private skipButton: GUI.Ellipse;
    private skipRingBase: GUI.Ellipse;
    private skipRingFill: GUI.Ellipse;
    private skipLabel: GUI.TextBlock;

    private isVisible: boolean = false;

    // Skip hold state
    private holding: boolean = false;
    private holdStartAt: number = 0;
    private holdTimer: number | null = null;
    private releaseTimer: number | null = null;
    private holdTriggered: boolean = false;
    private progress: number = 0;

    constructor(parentLayer: GUI.Rectangle, callbacks: StoryControlsCallbacks) {
        this.parentLayer = parentLayer;
        this.callbacks = callbacks;

        // =========================
        // Auto (Left Top)
        // =========================
        this.autoButton = new GUI.Rectangle('AutoButton');
        this.autoButton.widthInPixels = LAYOUT.STORY_CONTROLS.AUTO_WIDTH;
        this.autoButton.heightInPixels = LAYOUT.STORY_CONTROLS.AUTO_HEIGHT;
        this.autoButton.cornerRadius = LAYOUT.STORY_CONTROLS.AUTO_CORNER_RADIUS;
        this.autoButton.thickness = 2;
        this.autoButton.color = COLORS.SYSTEM_BTN_BORDER;
        this.autoButton.background = COLORS.SYSTEM_BTN_BG;
        // Move to TOP_RIGHT, adjacent to Skip (Skip is right-most)
        this.autoButton.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.autoButton.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        // Right aligned: negative leftInPixels moves it left from the right edge.
        // Place it to the LEFT of Skip with a small gap so they feel like one group.
        this.autoButton.leftInPixels = -(
            LAYOUT.SAFE_AREA.RIGHT +
            LAYOUT.STORY_CONTROLS.SKIP_SIZE +
            LAYOUT.STORY_CONTROLS.GAP
        );
        this.autoButton.topInPixels = LAYOUT.SAFE_AREA.TOP + LAYOUT.STORY_CONTROLS.TOP_OFFSET;
        this.autoButton.isHitTestVisible = true;
        this.autoButton.isPointerBlocker = true;

        // icon (play triangle)
        this.autoIcon = new GUI.TextBlock('AutoIcon');
        this.autoIcon.text = '▶';
        this.autoIcon.fontFamily = FONT.FAMILY.BODY;
        this.autoIcon.fontSizeInPixels = FONT.SIZE.SYSTEM_BUTTON;
        this.autoIcon.color = COLORS.SYSTEM_BTN_TEXT_MUTED;
        this.autoIcon.widthInPixels = 32;
        this.autoIcon.heightInPixels = LAYOUT.STORY_CONTROLS.AUTO_HEIGHT;
        this.autoIcon.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.autoIcon.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.autoIcon.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.autoIcon.leftInPixels = 14;
        this.autoIcon.isHitTestVisible = false;
        this.autoButton.addControl(this.autoIcon);

        this.autoLabel = new GUI.TextBlock('AutoLabel');
        this.autoLabel.text = 'AUTO';
        this.autoLabel.fontFamily = FONT.FAMILY.BODY;
        this.autoLabel.fontSizeInPixels = FONT.SIZE.SYSTEM_BUTTON;
        this.autoLabel.fontWeight = FONT.WEIGHT.BOLD;
        this.autoLabel.color = COLORS.SYSTEM_BTN_TEXT_MUTED;
        this.autoLabel.widthInPixels = LAYOUT.STORY_CONTROLS.AUTO_WIDTH;
        this.autoLabel.heightInPixels = LAYOUT.STORY_CONTROLS.AUTO_HEIGHT;
        this.autoLabel.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.autoLabel.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.autoLabel.isHitTestVisible = false;
        this.autoButton.addControl(this.autoLabel);

        this.autoButton.onPointerClickObservable.add(() => {
            // Toggle
            const next = !this.callbacks.getAutoEnabled();
            this.callbacks.onToggleAuto(next);
            this.syncVisualState();
        });

        // =========================
        // Skip (Right Top, Long Press)
        // =========================
        this.skipButton = new GUI.Ellipse('SkipButton');
        this.skipButton.widthInPixels = LAYOUT.STORY_CONTROLS.SKIP_SIZE;
        this.skipButton.heightInPixels = LAYOUT.STORY_CONTROLS.SKIP_SIZE;
        this.skipButton.thickness = 0;
        this.skipButton.background = COLORS.SYSTEM_BTN_BG;
        this.skipButton.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.skipButton.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.skipButton.leftInPixels = -LAYOUT.SAFE_AREA.RIGHT;
        this.skipButton.topInPixels = LAYOUT.SAFE_AREA.TOP + LAYOUT.STORY_CONTROLS.TOP_OFFSET;
        this.skipButton.isHitTestVisible = true;
        this.skipButton.isPointerBlocker = true;
        this.skipButton.transformCenterX = 0.5;
        this.skipButton.transformCenterY = 0.5;

        // base ring
        this.skipRingBase = new GUI.Ellipse('SkipRingBase');
        this.skipRingBase.width = '100%';
        this.skipRingBase.height = '100%';
        this.skipRingBase.thickness = LAYOUT.STORY_CONTROLS.SKIP_RING_THICKNESS;
        this.skipRingBase.color = COLORS.SYSTEM_BTN_BORDER;
        this.skipRingBase.background = '';
        this.skipRingBase.arc = 1;
        this.skipRingBase.isHitTestVisible = false;
        this.skipButton.addControl(this.skipRingBase);

        // fill ring (progress)
        this.skipRingFill = new GUI.Ellipse('SkipRingFill');
        this.skipRingFill.width = '100%';
        this.skipRingFill.height = '100%';
        this.skipRingFill.thickness = LAYOUT.STORY_CONTROLS.SKIP_RING_THICKNESS;
        this.skipRingFill.color = COLORS.SYSTEM_ACCENT;
        this.skipRingFill.background = '';
        this.skipRingFill.arc = 0;
        this.skipRingFill.rotation = -Math.PI / 2; // start at top
        this.skipRingFill.isHitTestVisible = false;
        this.skipButton.addControl(this.skipRingFill);

        this.skipLabel = new GUI.TextBlock('SkipLabel');
        this.skipLabel.text = 'SKIP';
        this.skipLabel.fontFamily = FONT.FAMILY.BODY;
        this.skipLabel.fontSizeInPixels = 20;
        this.skipLabel.fontWeight = FONT.WEIGHT.BOLD;
        this.skipLabel.color = COLORS.TEXT_WHITE;
        this.skipLabel.width = '100%';
        this.skipLabel.height = '100%';
        this.skipLabel.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.skipLabel.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.skipLabel.isHitTestVisible = false;
        this.skipButton.addControl(this.skipLabel);

        this.skipButton.onPointerDownObservable.add(() => this.startHold());
        this.skipButton.onPointerUpObservable.add(() => this.endHold());
        this.skipButton.onPointerOutObservable.add(() => this.endHold());

        // Add to layer
        this.parentLayer.addControl(this.autoButton);
        this.parentLayer.addControl(this.skipButton);

        this.setVisible(false);
        this.syncVisualState();
    }

    show(): void {
        this.setVisible(true);
        this.syncVisualState();
    }

    hide(): void {
        this.setVisible(false);
        this.resetSkipVisual();
    }

    dispose(): void {
        this.clearTimers();
        this.autoButton.dispose();
        this.skipButton.dispose();
    }

    private setVisible(visible: boolean): void {
        this.isVisible = visible;
        this.autoButton.isVisible = visible;
        this.skipButton.isVisible = visible;
    }

    private syncVisualState(): void {
        const active = this.callbacks.getAutoEnabled();
        if (active) {
            this.autoButton.background = COLORS.SYSTEM_BTN_BG_ACTIVE;
            this.autoButton.color = COLORS.SYSTEM_ACCENT;
            this.autoLabel.color = COLORS.TEXT_WHITE;
            this.autoIcon.color = COLORS.TEXT_WHITE;
        } else {
            this.autoButton.background = COLORS.SYSTEM_BTN_BG;
            this.autoButton.color = COLORS.SYSTEM_BTN_BORDER;
            this.autoLabel.color = COLORS.SYSTEM_BTN_TEXT_MUTED;
            this.autoIcon.color = COLORS.SYSTEM_BTN_TEXT_MUTED;
        }
    }

    private startHold(): void {
        if (!this.isVisible) return;
        if (this.holding) return;

        // Cancel release animation if any
        if (this.releaseTimer !== null) {
            clearInterval(this.releaseTimer);
            this.releaseTimer = null;
        }

        this.holding = true;
        this.holdTriggered = false;
        this.holdStartAt = performance.now();
        this.progress = 0;
        this.applySkipVisual(0);

        const holdMs = ANIM.STORY_CONTROLS.SKIP_HOLD_MS;
        this.holdTimer = window.setInterval(() => {
            if (!this.holding) return;
            const elapsed = performance.now() - this.holdStartAt;
            const p = Math.max(0, Math.min(1, elapsed / holdMs));
            this.progress = p;
            this.applySkipVisual(p);

            if (p >= 1 && !this.holdTriggered) {
                this.holdTriggered = true;
                this.callbacks.onHoldSkipTriggered();
            }
        }, 16);
    }

    private endHold(): void {
        if (!this.holding) return;
        this.holding = false;

        if (this.holdTimer !== null) {
            clearInterval(this.holdTimer);
            this.holdTimer = null;
        }

        const start = this.progress;
        const duration = ANIM.STORY_CONTROLS.SKIP_RELEASE_RETURN_MS;
        const startedAt = performance.now();

        this.releaseTimer = window.setInterval(() => {
            const t = (performance.now() - startedAt) / Math.max(duration, 1);
            const k = Math.max(0, Math.min(1, t));
            const next = start * (1 - k);
            this.progress = next;
            this.applySkipVisual(next);

            if (k >= 1) {
                if (this.releaseTimer !== null) {
                    clearInterval(this.releaseTimer);
                    this.releaseTimer = null;
                }
                this.resetSkipVisual();
            }
        }, 16);
    }

    private applySkipVisual(progress01: number): void {
        this.skipRingFill.arc = progress01;

        // subtle pop while charging
        const maxScale = ANIM.STORY_CONTROLS.SKIP_SCALE_MAX;
        const s = 1 + (maxScale - 1) * progress01;
        this.skipButton.scaleX = s;
        this.skipButton.scaleY = s;

        // label hint
        this.skipLabel.text = this.holdTriggered ? 'FAST' : 'SKIP';
    }

    private resetSkipVisual(): void {
        this.progress = 0;
        this.skipRingFill.arc = 0;
        this.skipButton.scaleX = 1;
        this.skipButton.scaleY = 1;
        this.skipLabel.text = 'SKIP';
        this.holdTriggered = false;
    }

    private clearTimers(): void {
        if (this.holdTimer !== null) {
            clearInterval(this.holdTimer);
            this.holdTimer = null;
        }
        if (this.releaseTimer !== null) {
            clearInterval(this.releaseTimer);
            this.releaseTimer = null;
        }
    }
}

