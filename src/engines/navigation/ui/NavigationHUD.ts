import * as GUI from '@babylonjs/gui';
import { COLORS, FONT, LAYOUT, Z_INDEX } from '../../../shared/design';
import type { PathStoreState } from '../store/PathStore';

export interface NavigationHUDCallbacks {
    onClear?: () => void;
    onBack?: () => void;
    onConfirm?: () => void;
}

/**
 * NavigationHUD - top overlay displaying real-time totals (energy/score).
 * - Pure Babylon GUI
 * - Does not own input globally; buttons are self-contained (pointerBlocker=true)
 */
export class NavigationHUD {
    private parentLayer: GUI.Rectangle;
    private root: GUI.Rectangle;
    private watchdogPanel: GUI.Rectangle;
    private watchdogText: GUI.TextBlock;

    private vectorThrustButton: GUI.Rectangle;
    private vectorThrustTitle: GUI.TextBlock;
    private vectorThrustSub: GUI.TextBlock;

    private totalsLine: GUI.TextBlock;
    private warningLine: GUI.TextBlock;

    private callbacks: NavigationHUDCallbacks;

    constructor(parentLayer: GUI.Rectangle, callbacks: NavigationHUDCallbacks = {}) {
        this.parentLayer = parentLayer;
        this.callbacks = callbacks;

        this.root = new GUI.Rectangle('NavigationHUDRoot');
        this.root.width = '100%';
        this.root.height = '100%';
        this.root.thickness = 0;
        this.root.isHitTestVisible = false;
        // keep within system layer ordering; actual layer zIndex is managed by GUIManager
        this.root.zIndex = Z_INDEX.SYSTEM;

        // ========================================
        // Watchdog Panel (TOP-LEFT) - neon border + dark bg + glow
        // ========================================
        this.watchdogPanel = new GUI.Rectangle('WatchdogPanel');
        this.watchdogPanel.widthInPixels = 280;
        this.watchdogPanel.heightInPixels = 140;
        this.watchdogPanel.cornerRadius = 16;
        this.watchdogPanel.thickness = 2;
        this.watchdogPanel.color = COLORS.HUD_NEON;
        this.watchdogPanel.background = COLORS.HUD_BG;
        this.watchdogPanel.shadowColor = COLORS.HUD_NEON;
        this.watchdogPanel.shadowBlur = 14;
        this.watchdogPanel.shadowOffsetX = 0;
        this.watchdogPanel.shadowOffsetY = 0;
        this.watchdogPanel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.watchdogPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.watchdogPanel.leftInPixels = LAYOUT.SAFE_AREA.LEFT;
        this.watchdogPanel.topInPixels = LAYOUT.SAFE_AREA.TOP;
        this.watchdogPanel.isHitTestVisible = false;
        // Fix: 텍스트/컨텐츠가 패널 밖으로 렌더되는 현상 방지
        this.watchdogPanel.clipChildren = true;
        this.root.addControl(this.watchdogPanel);

        this.watchdogText = new GUI.TextBlock('WatchdogText');
        this.watchdogText.text = 'WATCHDOG\nEnergy: --/--\nScore: +--\nDijkstra: --';
        this.watchdogText.fontFamily = FONT.FAMILY.BODY;
        // Slightly smaller + tighter leading to prevent bottom overflow on some DPR/aspect combos
        this.watchdogText.fontSizeInPixels = 20;
        this.watchdogText.color = COLORS.HUD_CORE;
        this.watchdogText.lineSpacing = '4px';
        this.watchdogText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.watchdogText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.watchdogText.paddingLeftInPixels = 16;
        this.watchdogText.paddingTopInPixels = 14;
        this.watchdogText.paddingRightInPixels = 12;
        this.watchdogText.paddingBottomInPixels = 12;
        this.watchdogText.width = '100%';
        this.watchdogText.height = '100%';
        this.watchdogText.textWrapping = true;
        this.watchdogText.isHitTestVisible = false;
        this.watchdogPanel.addControl(this.watchdogText);

        // ========================================
        // Vector Thrust Button (TOP-RIGHT) - neon border + glow
        // ========================================
        this.vectorThrustButton = new GUI.Rectangle('VectorThrustButton');
        this.vectorThrustButton.widthInPixels = 420;
        this.vectorThrustButton.heightInPixels = 120;
        this.vectorThrustButton.cornerRadius = 18;
        this.vectorThrustButton.thickness = 3;
        this.vectorThrustButton.color = COLORS.HUD_NEON;
        this.vectorThrustButton.background = 'rgba(0,0,0,0.6)';
        this.vectorThrustButton.shadowColor = COLORS.HUD_NEON;
        this.vectorThrustButton.shadowBlur = 18;
        this.vectorThrustButton.shadowOffsetX = 0;
        this.vectorThrustButton.shadowOffsetY = 0;
        this.vectorThrustButton.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.vectorThrustButton.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.vectorThrustButton.leftInPixels = -LAYOUT.SAFE_AREA.RIGHT;
        this.vectorThrustButton.topInPixels = LAYOUT.SAFE_AREA.TOP;
        this.vectorThrustButton.isHitTestVisible = true;
        this.vectorThrustButton.isPointerBlocker = true;
        this.root.addControl(this.vectorThrustButton);

        this.vectorThrustTitle = new GUI.TextBlock('VectorThrustTitle');
        this.vectorThrustTitle.text = 'VECTOR THRUST';
        this.vectorThrustTitle.fontFamily = FONT.FAMILY.TITLE;
        this.vectorThrustTitle.fontSizeInPixels = 34;
        this.vectorThrustTitle.color = COLORS.HUD_CORE;
        this.vectorThrustTitle.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.vectorThrustTitle.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.vectorThrustTitle.topInPixels = -14;
        this.vectorThrustTitle.isHitTestVisible = false;
        this.vectorThrustButton.addControl(this.vectorThrustTitle);

        this.vectorThrustSub = new GUI.TextBlock('VectorThrustSub');
        this.vectorThrustSub.text = 'Arcana Vector';
        this.vectorThrustSub.fontFamily = FONT.FAMILY.BODY;
        this.vectorThrustSub.fontSizeInPixels = 20;
        this.vectorThrustSub.color = COLORS.HUD_NEON;
        this.vectorThrustSub.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.vectorThrustSub.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.vectorThrustSub.topInPixels = 26;
        this.vectorThrustSub.isHitTestVisible = false;
        this.vectorThrustButton.addControl(this.vectorThrustSub);

        // ========================================
        // Bottom line inside top area: totals + warning (minimal)
        // ========================================
        this.totalsLine = new GUI.TextBlock('NavigationTotalsLine');
        this.totalsLine.text = '';
        this.totalsLine.color = COLORS.TEXT_WHITE;
        this.totalsLine.fontFamily = FONT.FAMILY.BODY;
        this.totalsLine.fontSizeInPixels = 22;
        this.totalsLine.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.totalsLine.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.totalsLine.topInPixels = LAYOUT.SAFE_AREA.TOP + 150;
        this.totalsLine.isHitTestVisible = false;
        this.root.addControl(this.totalsLine);

        this.warningLine = new GUI.TextBlock('NavigationWarningLine');
        this.warningLine.text = '';
        this.warningLine.color = COLORS.HUD_WARNING;
        this.warningLine.fontFamily = FONT.FAMILY.BODY;
        this.warningLine.fontSizeInPixels = 22;
        this.warningLine.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.warningLine.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.warningLine.topInPixels = LAYOUT.SAFE_AREA.TOP + 178;
        this.warningLine.isHitTestVisible = false;
        this.root.addControl(this.warningLine);

        this.vectorThrustButton.onPointerClickObservable.add(() => {
            this.callbacks.onConfirm?.();
        });

        this.parentLayer.addControl(this.root);
        this.hide();
    }

    /**
     * Phase 2.5: stage transition 직후 잔상 제거용.
     * Watchdog 패널을 "로딩 상태"로 즉시 덮어쓴다.
     */
    setWatchdogStatus(statusLine: string): void {
        this.watchdogText.text = `WATCHDOG\n${statusLine}`;
    }

    show(): void {
        this.root.isVisible = true;
        this.root.alpha = 1;
    }

    hide(): void {
        this.root.isVisible = false;
        this.root.alpha = 0;
    }

    update(state: PathStoreState): void {
        const { totals, energyBudget, isOverBudget, dijkstraMinCost } = state;
        const minStr = dijkstraMinCost === null ? '-' : `${Math.round(dijkstraMinCost)}`;
        this.watchdogText.text =
            `WATCHDOG\nEnergy: ${totals.totalEnergy}/${energyBudget}\nScore: +${totals.totalScore}\nDijkstra: ${minStr}`;

        this.totalsLine.text =
            `Nodes ${totals.nodeCount}  |  Energy ${totals.totalEnergy}/${energyBudget}  |  Score +${totals.totalScore}  |  Dijkstra(min) ${minStr}`;

        if (isOverBudget) {
            this.warningLine.text = 'ENERGY OVER: 보유 에너지를 초과한 경로입니다.';
        } else {
            this.warningLine.text = '';
        }
    }

    dispose(): void {
        this.root.dispose();
    }
}

