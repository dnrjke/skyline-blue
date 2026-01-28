/**
 * LabUI - Visual Interface for Transition Lab
 *
 * Provides:
 * - Current phase display
 * - START TRANSITION button
 * - Real-time RAF meter
 * - Browser detection
 * - Results summary
 */

import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { TransitionPhase, type PhaseResult } from './TransitionPhases';

export interface LabUIConfig {
    onStartTransition: () => void;
    onReset: () => void;
}

/**
 * LabUI - Visual feedback for Transition Lab
 */
export class LabUI {
    private scene: BABYLON.Scene;
    private config: LabUIConfig;
    private adt: GUI.AdvancedDynamicTexture | null = null;
    private container: GUI.Rectangle | null = null;

    // UI Elements
    private titleText: GUI.TextBlock | null = null;
    private browserText: GUI.TextBlock | null = null;
    private phaseText: GUI.TextBlock | null = null;
    private rafMeterText: GUI.TextBlock | null = null;
    private resultText: GUI.TextBlock | null = null;
    private startButton: GUI.Button | null = null;
    private resetButton: GUI.Button | null = null;
    private detectionText: GUI.TextBlock | null = null;

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
        this.adt = GUI.AdvancedDynamicTexture.CreateFullscreenUI(
            'transition-lab-ui',
            true,
            this.scene
        );

        // Create main container
        this.container = new GUI.Rectangle('main-container');
        this.container.width = '450px';
        this.container.height = '700px';
        this.container.cornerRadius = 10;
        this.container.color = '#ff8800';
        this.container.thickness = 2;
        this.container.background = 'rgba(20, 20, 30, 0.95)';
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
        this.titleText.text = '🔄 Transition Lab';
        this.titleText.color = '#ff8800';
        this.titleText.fontSize = 24;
        this.titleText.height = '40px';
        this.titleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        stack.addControl(this.titleText);

        // Browser detection
        this.browserText = new GUI.TextBlock('browser');
        this.browserText.text = this.detectBrowser();
        this.browserText.color = '#aaaaaa';
        this.browserText.fontSize = 12;
        this.browserText.height = '20px';
        this.browserText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        stack.addControl(this.browserText);

        // Separator
        const sep1 = this.createSeparator();
        stack.addControl(sep1);

        // Phase display
        this.phaseText = new GUI.TextBlock('phase');
        this.phaseText.text = 'Phase: Idle (waiting to start)';
        this.phaseText.color = 'white';
        this.phaseText.fontSize = 16;
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

        // Detection display (104ms lock, frame drops)
        this.detectionText = new GUI.TextBlock('detection');
        this.detectionText.text = '';
        this.detectionText.color = '#ff4444';
        this.detectionText.fontSize = 14;
        this.detectionText.height = '25px';
        this.detectionText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        stack.addControl(this.detectionText);

        // Separator
        const sep2 = this.createSeparator();
        stack.addControl(sep2);

        // Buttons container
        const buttonRow = new GUI.StackPanel('button-row');
        buttonRow.isVertical = false;
        buttonRow.height = '50px';
        buttonRow.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        stack.addControl(buttonRow);

        // Start transition button
        this.startButton = GUI.Button.CreateSimpleButton('start', '▶ START TRANSITION');
        this.startButton.width = '200px';
        this.startButton.height = '45px';
        this.startButton.color = 'white';
        this.startButton.background = '#0066cc';
        this.startButton.cornerRadius = 5;
        this.startButton.fontSize = 16;
        this.startButton.fontWeight = 'bold';
        this.startButton.onPointerClickObservable.add(() => {
            this.config.onStartTransition();
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
        this.resetButton.height = '45px';
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
        this.resultText.text = 'Click START TRANSITION to begin test.\n\nThis will simulate:\n• Host scene (baseline)\n• Scene switch\n• Character GLB load\n• GUI layer creation\n• Final stabilization';
        this.resultText.color = '#aaaaaa';
        this.resultText.fontSize = 12;
        this.resultText.height = '450px';
        // TextWrapping.WordWrap = 1
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
     * Detect browser
     */
    private detectBrowser(): string {
        const ua = navigator.userAgent;

        if (ua.includes('Chrome') && !ua.includes('Edg')) {
            return '🌐 Browser: Chrome (may show 104ms throttle)';
        } else if (ua.includes('Firefox')) {
            return '🌐 Browser: Firefox (may show incomplete transition)';
        } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
            return '🌐 Browser: Safari';
        } else if (ua.includes('Edg')) {
            return '🌐 Browser: Edge';
        }

        return '🌐 Browser: Unknown';
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

        // Check for 104ms lock
        const in104Range = this.recentIntervals.filter((v) => v >= 95 && v <= 115).length;
        if (in104Range / this.recentIntervals.length >= 0.7 && this.detectionText) {
            this.detectionText.text = '⚠️ 104ms lock detected!';
            this.detectionText.color = '#ff4444';
        } else if (this.detectionText) {
            this.detectionText.text = '';
        }
    }

    /**
     * Set current phase
     */
    setPhase(phase: TransitionPhase): void {
        if (this.phaseText) {
            const phaseNames = {
                [TransitionPhase.HOST_IDLE]: 'Host Scene (Baseline)',
                [TransitionPhase.TRANSITION_START]: 'Transition Starting',
                [TransitionPhase.SCENE_CREATE]: 'Creating Navigation Scene',
                [TransitionPhase.GLB_LOAD]: 'Loading Character GLB',
                [TransitionPhase.GUI_SETUP]: 'Setting up GUI Layers',
                [TransitionPhase.RENDER_LOOP_ACTIVE]: 'Render Loop Active',
                [TransitionPhase.TRANSITION_COMPLETE]: 'Transition Complete',
            };
            this.phaseText.text = `Phase: ${phaseNames[phase] ?? phase}`;
        }
    }

    /**
     * Show results
     */
    showResults(results: PhaseResult[], diagnosis: string): void {
        if (!this.resultText) return;

        const lines: string[] = ['═══ TRANSITION TEST RESULTS ═══', ''];

        for (const result of results) {
            const before = result.rafBefore.avgIntervalMs.toFixed(1);
            const after = result.rafAfter.avgIntervalMs.toFixed(1);
            const status = result.throttleDetected
                ? '🔴'
                : result.is104msLock
                    ? '⚠️'
                    : '🟢';

            lines.push(`${status} ${result.phase}`);
            lines.push(`   Time: ${result.durationMs.toFixed(0)}ms`);
            lines.push(`   RAF: ${before}ms → ${after}ms`);

            if (result.is104msLock) {
                lines.push('   ⚠️ 104ms lock detected!');
            }

            if (result.frameDrops > 0) {
                lines.push(`   ⚠️ ${result.frameDrops} frame drops`);
            }

            if (result.notes.length > 0) {
                result.notes.forEach((note) => {
                    lines.push(`   • ${note}`);
                });
            }

            lines.push('');
        }

        lines.push('═══ DIAGNOSIS ═══', '');
        lines.push(diagnosis);

        this.resultText.text = lines.join('\n');
        this.resultText.color = 'white';
    }

    /**
     * Update status message
     */
    updateStatus(message: string): void {
        if (this.resultText) {
            this.resultText.text = message;
            this.resultText.color = '#aaaaaa';
        }
    }

    /**
     * Enable/disable start button
     */
    setStartEnabled(enabled: boolean): void {
        if (this.startButton) {
            this.startButton.isEnabled = enabled;
            this.startButton.alpha = enabled ? 1 : 0.5;
        }
    }

    /**
     * Reset UI
     */
    reset(): void {
        if (this.phaseText) {
            this.phaseText.text = 'Phase: Idle (waiting to start)';
        }
        if (this.resultText) {
            this.resultText.text = 'Click START TRANSITION to begin test.';
            this.resultText.color = '#aaaaaa';
        }
        if (this.detectionText) {
            this.detectionText.text = '';
        }
        this.setStartEnabled(true);
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
