/**
 * Pulse Debug Overlay
 *
 * Visual debugging tool for GPU Pulse system.
 * Shows real-time pulse ownership, timing, and recovery status.
 *
 * Display Information:
 * - Current owner (HOST / GAME)
 * - Last draw delta (ms)
 * - Recovery armed status
 * - Frame count
 * - Pulse health indicator
 *
 * NOTE: Only enable in development builds
 */

import * as GUI from '@babylonjs/gui';
import { PulseOwner } from './types';
import { PulseTransferGate } from './PulseTransferGate';
import { EmergencyPulseRecovery } from './EmergencyPulseRecovery';

const LOG_PREFIX = '[PulseDebug]';

/**
 * Configuration for debug overlay
 */
export interface PulseDebugOverlayConfig {
    /** GUI texture to render on */
    guiTexture: GUI.AdvancedDynamicTexture;
    /** Transfer gate reference */
    transferGate: PulseTransferGate;
    /** Emergency recovery reference */
    emergencyRecovery: EmergencyPulseRecovery;
    /** Update interval in ms (default: 100) */
    updateIntervalMs?: number;
    /** Position from top-right corner */
    offsetX?: number;
    offsetY?: number;
}

export class PulseDebugOverlay {
    private readonly config: PulseDebugOverlayConfig;
    private readonly transferGate: PulseTransferGate;
    private readonly emergencyRecovery: EmergencyPulseRecovery;

    // GUI components
    private container: GUI.Rectangle | null = null;
    private ownerText: GUI.TextBlock | null = null;
    private deltaText: GUI.TextBlock | null = null;
    private recoveryText: GUI.TextBlock | null = null;
    private frameText: GUI.TextBlock | null = null;
    private healthIndicator: GUI.Rectangle | null = null;

    // State
    private isVisible: boolean = false;
    private updateIntervalId: ReturnType<typeof setInterval> | null = null;
    private frameCount: number = 0;

    constructor(config: PulseDebugOverlayConfig) {
        this.config = config;
        this.transferGate = config.transferGate;
        this.emergencyRecovery = config.emergencyRecovery;
    }

    // ============================================================
    // Public API
    // ============================================================

    /**
     * Show the debug overlay
     */
    public show(): void {
        if (this.isVisible) return;

        this.createOverlay();
        this.startUpdating();
        this.isVisible = true;

        console.log(`${LOG_PREFIX} Overlay shown`);
    }

    /**
     * Hide the debug overlay
     */
    public hide(): void {
        if (!this.isVisible) return;

        this.stopUpdating();
        this.destroyOverlay();
        this.isVisible = false;

        console.log(`${LOG_PREFIX} Overlay hidden`);
    }

    /**
     * Toggle visibility
     */
    public toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Report frame rendered (for accurate delta calculation)
     */
    public reportFrame(): void {
        this.frameCount++;
    }

    /**
     * Dispose overlay
     */
    public dispose(): void {
        this.hide();
        console.log(`${LOG_PREFIX} Disposed`);
    }

    // ============================================================
    // Private: Overlay Creation
    // ============================================================

    private createOverlay(): void {
        const gui = this.config.guiTexture;
        const offsetX = this.config.offsetX ?? 10;
        const offsetY = this.config.offsetY ?? 10;

        // Container
        this.container = new GUI.Rectangle('pulse_debug_container');
        this.container.width = '180px';
        this.container.height = '120px';
        this.container.cornerRadius = 4;
        this.container.color = 'rgba(255, 255, 255, 0.3)';
        this.container.background = 'rgba(0, 0, 0, 0.7)';
        this.container.thickness = 1;
        this.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.top = `${offsetY}px`;
        this.container.left = `-${offsetX}px`;
        this.container.zIndex = 9999;

        // Stack panel for content
        const stack = new GUI.StackPanel('pulse_debug_stack');
        stack.isVertical = true;
        stack.paddingTop = '8px';
        stack.paddingLeft = '8px';
        stack.paddingRight = '8px';
        this.container.addControl(stack);

        // Title
        const title = this.createText('GPU PULSE', 12, 'rgba(100, 200, 255, 1)');
        title.fontWeight = 'bold';
        stack.addControl(title);

        // Health indicator (colored bar)
        const healthRow = new GUI.Rectangle('health_row');
        healthRow.width = '100%';
        healthRow.height = '6px';
        healthRow.thickness = 0;
        healthRow.background = 'rgba(50, 50, 50, 0.5)';
        healthRow.paddingTop = '4px';
        healthRow.paddingBottom = '4px';
        stack.addControl(healthRow);

        this.healthIndicator = new GUI.Rectangle('health_indicator');
        this.healthIndicator.width = '100%';
        this.healthIndicator.height = '100%';
        this.healthIndicator.thickness = 0;
        this.healthIndicator.background = 'rgba(0, 255, 0, 0.8)';
        this.healthIndicator.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthRow.addControl(this.healthIndicator);

        // Owner text
        this.ownerText = this.createText('Owner: ---', 10);
        stack.addControl(this.ownerText);

        // Delta text
        this.deltaText = this.createText('Delta: ---ms', 10);
        stack.addControl(this.deltaText);

        // Recovery text
        this.recoveryText = this.createText('Recovery: ---', 10);
        stack.addControl(this.recoveryText);

        // Frame text
        this.frameText = this.createText('Frames: 0', 10);
        stack.addControl(this.frameText);

        gui.addControl(this.container);
    }

    private createText(text: string, fontSize: number, color: string = 'white'): GUI.TextBlock {
        const textBlock = new GUI.TextBlock();
        textBlock.text = text;
        textBlock.fontSize = fontSize;
        textBlock.color = color;
        textBlock.height = '16px';
        textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        textBlock.fontFamily = 'monospace';
        return textBlock;
    }

    private destroyOverlay(): void {
        if (this.container) {
            this.config.guiTexture.removeControl(this.container);
            this.container.dispose();
            this.container = null;
        }

        this.ownerText = null;
        this.deltaText = null;
        this.recoveryText = null;
        this.frameText = null;
        this.healthIndicator = null;
    }

    // ============================================================
    // Private: Update Loop
    // ============================================================

    private startUpdating(): void {
        const intervalMs = this.config.updateIntervalMs ?? 100;

        this.updateIntervalId = setInterval(() => {
            this.updateDisplay();
        }, intervalMs);

        // Initial update
        this.updateDisplay();
    }

    private stopUpdating(): void {
        if (this.updateIntervalId !== null) {
            clearInterval(this.updateIntervalId);
            this.updateIntervalId = null;
        }
    }

    private updateDisplay(): void {
        const metrics = this.emergencyRecovery.getHealthMetrics();
        const owner = this.transferGate.getCurrentOwner();
        const recoveryState = this.emergencyRecovery.getState();
        const recoveryAttempts = this.emergencyRecovery.getAttemptCount();

        // Update owner
        if (this.ownerText) {
            const ownerLabel = this.getOwnerLabel(owner);
            const ownerColor = this.getOwnerColor(owner);
            this.ownerText.text = `Owner: ${ownerLabel}`;
            this.ownerText.color = ownerColor;
        }

        // Update delta
        if (this.deltaText) {
            const delta = metrics.timeSinceLastFrame;
            const deltaColor = this.getDeltaColor(delta);
            this.deltaText.text = `Delta: ${delta.toFixed(0)}ms`;
            this.deltaText.color = deltaColor;
        }

        // Update recovery status
        if (this.recoveryText) {
            const recoveryLabel = this.getRecoveryLabel(recoveryState, recoveryAttempts);
            const recoveryColor = this.getRecoveryColor(recoveryState);
            this.recoveryText.text = `Recovery: ${recoveryLabel}`;
            this.recoveryText.color = recoveryColor;
        }

        // Update frame count
        if (this.frameText) {
            this.frameText.text = `Frames: ${this.frameCount}`;
        }

        // Update health indicator
        if (this.healthIndicator) {
            const healthPercent = Math.min(1, Math.max(0, 1 - (metrics.timeSinceLastFrame / 500)));
            this.healthIndicator.width = `${healthPercent * 100}%`;
            this.healthIndicator.background = metrics.isHealthy
                ? 'rgba(0, 255, 0, 0.8)'
                : 'rgba(255, 0, 0, 0.8)';
        }
    }

    // ============================================================
    // Private: Display Helpers
    // ============================================================

    private getOwnerLabel(owner: PulseOwner): string {
        switch (owner) {
            case PulseOwner.LOADING_HOST:
                return 'HOST';
            case PulseOwner.GAME_SCENE:
                return 'GAME';
            case PulseOwner.NONE:
                return 'NONE!';
            default:
                return '???';
        }
    }

    private getOwnerColor(owner: PulseOwner): string {
        switch (owner) {
            case PulseOwner.LOADING_HOST:
                return 'rgba(255, 200, 100, 1)'; // Orange
            case PulseOwner.GAME_SCENE:
                return 'rgba(100, 255, 100, 1)'; // Green
            case PulseOwner.NONE:
                return 'rgba(255, 50, 50, 1)'; // Red
            default:
                return 'white';
        }
    }

    private getDeltaColor(deltaMs: number): string {
        if (deltaMs < 50) {
            return 'rgba(100, 255, 100, 1)'; // Green - healthy
        } else if (deltaMs < 200) {
            return 'rgba(255, 255, 100, 1)'; // Yellow - warning
        } else if (deltaMs < 500) {
            return 'rgba(255, 150, 50, 1)'; // Orange - danger
        } else {
            return 'rgba(255, 50, 50, 1)'; // Red - critical
        }
    }

    private getRecoveryLabel(state: string, attempts: number): string {
        switch (state) {
            case 'monitoring':
                return 'OK';
            case 'stall_detected':
                return 'STALL!';
            case 'recovering':
                return `ACTIVE #${attempts}`;
            case 'recovered':
                return 'DONE';
            case 'degraded':
                return 'FAILED';
            default:
                return state;
        }
    }

    private getRecoveryColor(state: string): string {
        switch (state) {
            case 'monitoring':
                return 'rgba(100, 255, 100, 1)';
            case 'stall_detected':
            case 'recovering':
                return 'rgba(255, 150, 50, 1)';
            case 'recovered':
                return 'rgba(100, 200, 255, 1)';
            case 'degraded':
                return 'rgba(255, 50, 50, 1)';
            default:
                return 'white';
        }
    }
}

/**
 * Factory function for creating debug overlay
 */
export function createPulseDebugOverlay(
    guiTexture: GUI.AdvancedDynamicTexture,
    transferGate: PulseTransferGate,
    emergencyRecovery: EmergencyPulseRecovery
): PulseDebugOverlay {
    return new PulseDebugOverlay({
        guiTexture,
        transferGate,
        emergencyRecovery,
        updateIntervalMs: 100,
        offsetX: 10,
        offsetY: 60, // Below other debug elements
    });
}
