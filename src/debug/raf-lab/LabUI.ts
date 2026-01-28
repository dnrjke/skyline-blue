/**
 * LabUI - Visual interface for RAF Lab
 *
 * Provides:
 * - Current phase display
 * - Start/Reset buttons
 * - Real-time RAF meter
 * - Results display
 */

import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { PhaseResult } from './PhaseRunner';

export interface LabUIConfig {
    onStartPhases: () => void;
    onReset: () => void;
}

/**
 * LabUI - Visual feedback for RAF Lab
 */
export class LabUI {
    private scene: BABYLON.Scene;
    private config: LabUIConfig;
    private adt: GUI.AdvancedDynamicTexture | null = null;
    private container: GUI.Rectangle | null = null;

    // UI Elements
    private titleText: GUI.TextBlock | null = null;
    private phaseText: GUI.TextBlock | null = null;
    private rafMeterText: GUI.TextBlock | null = null;
    private resultText: GUI.TextBlock | null = null;
    private startButton: GUI.Button | null = null;
    private resetButton: GUI.Button | null = null;

    // Real-time RAF tracking
    private rafObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private lastFrameTime: number = 0;
    private recentIntervals: number[] = [];

    constructor(scene: BABYLON.Scene, config: LabUIConfig) {
        this.scene = scene;
        this.config = config;
    }

    /**
     * Initialize the UI
     */
    async initialize(): Promise<void> {
        // Create fullscreen UI
        this.adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI('raf-lab-ui', true, this.scene);

        // Create main container
        this.container = new GUI.Rectangle('main-container');
        this.container.width = '400px';
        this.container.height = '600px';
        this.container.cornerRadius = 10;
        this.container.color = '#00ff88';
        this.container.thickness = 2;
        this.container.background = 'rgba(0, 20, 30, 0.9)';
        this.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.left = '20px';
        this.container.top = '20px';
        this.adt.addControl(this.container);

        // Create stack panel for layout
        const stack = new GUI.StackPanel('stack');
        stack.width = '100%';
        stack.paddingTop = '10px';
        stack.paddingLeft = '10px';
        stack.paddingRight = '10px';
        this.container.addControl(stack);

        // Title
        this.titleText = new GUI.TextBlock('title');
        this.titleText.text = '🔬 RAF Lab';
        this.titleText.color = '#00ff88';
        this.titleText.fontSize = 24;
        this.titleText.height = '40px';
        this.titleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        stack.addControl(this.titleText);

        // Separator
        const sep1 = this.createSeparator();
        stack.addControl(sep1);

        // Phase display
        this.phaseText = new GUI.TextBlock('phase');
        this.phaseText.text = 'Phase: Ready';
        this.phaseText.color = 'white';
        this.phaseText.fontSize = 18;
        this.phaseText.height = '30px';
        this.phaseText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        stack.addControl(this.phaseText);

        // RAF meter
        this.rafMeterText = new GUI.TextBlock('raf-meter');
        this.rafMeterText.text = 'RAF: Measuring...';
        this.rafMeterText.color = '#00ff88';
        this.rafMeterText.fontSize = 16;
        this.rafMeterText.height = '25px';
        this.rafMeterText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        stack.addControl(this.rafMeterText);

        // Separator
        const sep2 = this.createSeparator();
        stack.addControl(sep2);

        // Buttons container
        const buttonRow = new GUI.StackPanel('button-row');
        buttonRow.isVertical = false;
        buttonRow.height = '50px';
        buttonRow.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        stack.addControl(buttonRow);

        // Start button
        this.startButton = GUI.Button.CreateSimpleButton('start', '▶ Start Test');
        this.startButton.width = '120px';
        this.startButton.height = '40px';
        this.startButton.color = 'white';
        this.startButton.background = '#0066cc';
        this.startButton.cornerRadius = 5;
        this.startButton.onPointerClickObservable.add(() => {
            this.config.onStartPhases();
        });
        buttonRow.addControl(this.startButton);

        // Spacer
        const spacer = new GUI.Rectangle('spacer');
        spacer.width = '10px';
        spacer.height = '1px';
        spacer.thickness = 0;
        buttonRow.addControl(spacer);

        // Reset button
        this.resetButton = GUI.Button.CreateSimpleButton('reset', '↻ Reset');
        this.resetButton.width = '100px';
        this.resetButton.height = '40px';
        this.resetButton.color = 'white';
        this.resetButton.background = '#666666';
        this.resetButton.cornerRadius = 5;
        this.resetButton.onPointerClickObservable.add(() => {
            this.config.onReset();
        });
        buttonRow.addControl(this.resetButton);

        // Separator
        const sep3 = this.createSeparator();
        stack.addControl(sep3);

        // Results display
        this.resultText = new GUI.TextBlock('results');
        this.resultText.text = 'Results will appear here after test completes.';
        this.resultText.color = '#aaaaaa';
        this.resultText.fontSize = 12;
        this.resultText.height = '350px';
        // TextWrapping.WordWrap = 1 (using numeric value to avoid const enum access issue with isolatedModules)
        this.resultText.textWrapping = 1;
        this.resultText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.resultText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        stack.addControl(this.resultText);

        // Start real-time RAF monitoring
        this.startRAFMonitor();
    }

    /**
     * Create separator line
     */
    private createSeparator(): GUI.Rectangle {
        const sep = new GUI.Rectangle('sep');
        sep.width = '100%';
        sep.height = '2px';
        sep.background = '#333333';
        sep.thickness = 0;
        sep.paddingTop = '5px';
        sep.paddingBottom = '5px';
        return sep;
    }

    /**
     * Start real-time RAF monitoring
     */
    private startRAFMonitor(): void {
        this.lastFrameTime = performance.now();

        this.rafObserver = this.scene.onBeforeRenderObservable.add(() => {
            const now = performance.now();
            const dt = now - this.lastFrameTime;
            this.lastFrameTime = now;

            this.recentIntervals.push(dt);
            if (this.recentIntervals.length > 20) {
                this.recentIntervals.shift();
            }

            // Update display every 10 frames
            if (this.recentIntervals.length % 10 === 0) {
                this.updateRAFMeter();
            }
        });
    }

    /**
     * Update RAF meter display
     */
    private updateRAFMeter(): void {
        if (!this.rafMeterText || this.recentIntervals.length === 0) return;

        const avg = this.recentIntervals.reduce((a, b) => a + b, 0) / this.recentIntervals.length;
        const fps = 1000 / avg;

        let color = '#00ff88'; // Green
        let status = '🟢';

        if (avg > 50) {
            color = '#ff4444'; // Red
            status = '🔴 THROTTLED';
        } else if (avg > 25) {
            color = '#ffaa00'; // Orange
            status = '🟡';
        }

        this.rafMeterText.text = `${status} RAF: ${avg.toFixed(1)}ms (${fps.toFixed(1)} fps)`;
        this.rafMeterText.color = color;
    }

    /**
     * Set current phase
     */
    setPhase(phaseName: string): void {
        if (this.phaseText) {
            this.phaseText.text = `Phase: ${phaseName}`;
        }
    }

    /**
     * Show results
     */
    showResults(results: PhaseResult[], diagnosis: string): void {
        if (!this.resultText) return;

        const lines: string[] = ['─── RESULTS ───', ''];

        for (const result of results) {
            const before = result.rafBefore.avgIntervalMs.toFixed(1);
            const after = result.rafAfter.avgIntervalMs.toFixed(1);
            const status = result.throttleDetected ? '🔴' : '🟢';
            lines.push(`${status} ${result.phaseName}`);
            lines.push(`   Before: ${before}ms → After: ${after}ms`);
            if (result.maxBlockingMs > 50) {
                lines.push(`   ⚠️ Max block: ${result.maxBlockingMs.toFixed(0)}ms`);
            }
            lines.push('');
        }

        lines.push('─── DIAGNOSIS ───', '');
        lines.push(diagnosis);

        this.resultText.text = lines.join('\n');
        this.resultText.color = 'white';
    }

    /**
     * Reset UI
     */
    reset(): void {
        if (this.phaseText) {
            this.phaseText.text = 'Phase: Ready';
        }
        if (this.resultText) {
            this.resultText.text = 'Results will appear here after test completes.';
            this.resultText.color = '#aaaaaa';
        }
    }

    /**
     * Dispose UI
     */
    dispose(): void {
        if (this.rafObserver) {
            this.scene.onBeforeRenderObservable.remove(this.rafObserver);
            this.rafObserver = null;
        }
        if (this.adt) {
            this.adt.dispose();
            this.adt = null;
        }
    }
}
