import * as GUI from '@babylonjs/gui';
import { COLORS, FONT, LAYOUT, Z_INDEX } from '../design';

export interface ArcanaLoadingOverlayConfig {
    title: string;
    subtitle?: string;
    tip?: string;
    /** Debug lines shown in small mono text (bottom area). */
    debugLines?: string[];
    progress01?: number;
}

/**
 * ArcanaLoadingOverlay
 * - Pure Babylon GUI
 * - Layer: Skip (1100) recommended (top-most transition)
 */
export class ArcanaLoadingOverlay {
    private root: GUI.Rectangle;
    private backdrop: GUI.Rectangle;
    private safeArea: GUI.Rectangle;

    private titleText: GUI.TextBlock;
    private subtitleText: GUI.TextBlock;
    private tipText: GUI.TextBlock;

    private barOuter: GUI.Rectangle;
    private barFill: GUI.Rectangle;

    private debugText: GUI.TextBlock;

    constructor(parentLayer: GUI.Rectangle) {
        this.root = new GUI.Rectangle('ArcanaLoadingRoot');
        this.root.width = '100%';
        this.root.height = '100%';
        this.root.thickness = 0;
        this.root.isHitTestVisible = false;
        this.root.zIndex = Z_INDEX.SKIP;
        this.root.isVisible = false;
        this.root.alpha = 0;

        this.backdrop = new GUI.Rectangle('ArcanaLoadingBackdrop');
        this.backdrop.width = '100%';
        this.backdrop.height = '100%';
        this.backdrop.thickness = 0;
        // Dark veil (avoid "투과" feel while loading)
        this.backdrop.background = 'rgba(0, 0, 0, 0.92)';
        this.backdrop.isHitTestVisible = false;
        this.root.addControl(this.backdrop);

        this.safeArea = new GUI.Rectangle('ArcanaLoadingSafeArea');
        this.safeArea.width = '100%';
        this.safeArea.height = '100%';
        this.safeArea.thickness = 0;
        this.safeArea.isHitTestVisible = false;
        this.safeArea.paddingTopInPixels = LAYOUT.SAFE_AREA.TOP;
        this.safeArea.paddingBottomInPixels = LAYOUT.SAFE_AREA.BOTTOM;
        this.safeArea.paddingLeftInPixels = LAYOUT.SAFE_AREA.LEFT;
        this.safeArea.paddingRightInPixels = LAYOUT.SAFE_AREA.RIGHT;
        this.root.addControl(this.safeArea);

        // Top title
        this.titleText = new GUI.TextBlock('ArcanaLoadingTitle');
        this.titleText.text = 'LOADING';
        this.titleText.fontFamily = FONT.FAMILY.TITLE;
        this.titleText.fontSizeInPixels = 46;
        this.titleText.color = COLORS.TEXT_WHITE;
        this.titleText.heightInPixels = 70;
        this.titleText.width = '100%';
        this.titleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.titleText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.titleText.isHitTestVisible = false;
        this.safeArea.addControl(this.titleText);

        this.subtitleText = new GUI.TextBlock('ArcanaLoadingSubtitle');
        this.subtitleText.text = '';
        this.subtitleText.fontFamily = FONT.FAMILY.BODY;
        this.subtitleText.fontSizeInPixels = 22;
        this.subtitleText.color = COLORS.TEXT_SUBTITLE;
        this.subtitleText.heightInPixels = 40;
        this.subtitleText.width = '100%';
        this.subtitleText.topInPixels = 62;
        this.subtitleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.subtitleText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.subtitleText.isHitTestVisible = false;
        this.safeArea.addControl(this.subtitleText);

        // Center tip
        this.tipText = new GUI.TextBlock('ArcanaLoadingTip');
        this.tipText.text = '';
        this.tipText.fontFamily = FONT.FAMILY.BODY;
        this.tipText.fontSizeInPixels = 28;
        this.tipText.color = COLORS.TEXT_MUTED;
        this.tipText.widthInPixels = 1000;
        this.tipText.heightInPixels = 240;
        this.tipText.textWrapping = true;
        this.tipText.lineSpacing = '10px';
        this.tipText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.tipText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.tipText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.tipText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.tipText.isHitTestVisible = false;
        this.safeArea.addControl(this.tipText);

        // Bottom progress bar
        this.barOuter = new GUI.Rectangle('ArcanaLoadingBarOuter');
        this.barOuter.width = '100%';
        this.barOuter.heightInPixels = 18;
        this.barOuter.thickness = 2;
        this.barOuter.cornerRadius = 10;
        this.barOuter.color = COLORS.HUD_NEON;
        this.barOuter.background = 'rgba(0,0,0,0.35)';
        this.barOuter.isHitTestVisible = false;
        this.barOuter.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.barOuter.topInPixels = -56;
        this.safeArea.addControl(this.barOuter);

        this.barFill = new GUI.Rectangle('ArcanaLoadingBarFill');
        this.barFill.width = '0%';
        this.barFill.height = '100%';
        this.barFill.thickness = 0;
        this.barFill.cornerRadius = 10;
        this.barFill.background = COLORS.HUD_NEON;
        this.barFill.isHitTestVisible = false;
        // Fill should grow from LEFT → RIGHT (not center-out)
        this.barFill.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.barFill.leftInPixels = 0;
        this.barOuter.addControl(this.barFill);

        // Debug lines (bottom)
        this.debugText = new GUI.TextBlock('ArcanaLoadingDebug');
        this.debugText.text = '';
        this.debugText.fontFamily = FONT.FAMILY.MONOSPACE;
        this.debugText.fontSizeInPixels = 18;
        this.debugText.color = 'rgba(255,255,255,0.72)';
        this.debugText.width = '100%';
        this.debugText.heightInPixels = 160;
        this.debugText.textWrapping = true;
        this.debugText.lineSpacing = '6px';
        this.debugText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.debugText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.debugText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.debugText.topInPixels = -76;
        this.debugText.isHitTestVisible = false;
        this.safeArea.addControl(this.debugText);

        parentLayer.addControl(this.root);
    }

    show(config: ArcanaLoadingOverlayConfig): void {
        this.root.isVisible = true;
        this.root.alpha = 1;
        this.apply(config);
    }

    hide(): void {
        this.root.isVisible = false;
        this.root.alpha = 0;
    }

    setAlpha(a: number): void {
        this.root.alpha = Math.max(0, Math.min(1, a));
    }

    apply(config: ArcanaLoadingOverlayConfig): void {
        this.titleText.text = config.title;
        this.subtitleText.text = config.subtitle ?? '';
        this.tipText.text = config.tip ?? '';
        this.debugText.text = (config.debugLines ?? []).join('\n');
        this.setProgress(config.progress01 ?? 0);
    }

    setProgress(progress01: number): void {
        const p = Math.max(0, Math.min(1, progress01));
        this.barFill.width = `${Math.round(p * 100)}%`;
    }

    dispose(): void {
        this.root.dispose();
    }
}

