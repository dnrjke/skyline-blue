/**
 * ScenarioManager - Babylon GUI Based Scenario System
 *
 * Manages scenario playback using Babylon GUI components.
 * NO HTML DOM manipulation.
 *
 * Animation Lock (HEBS §1.2):
 * - isAnimating = true: click triggers skipTyping()
 * - isAnimating = false: click triggers advanceStep()
 *
 * Part of Narrative Engine - internal module
 */

import {
    ScenarioSequence,
    UIState,
    NarrativeCallbacks,
    NarrationStep,
    DialogueStep,
    AutoStep,
    EventStep,
} from '../types';
import { DialogueBox } from '../ui/DialogueBox';
import { InteractionLayer } from '../ui/InteractionLayer';
import { ANIM } from '../../../shared/design';

export class ScenarioManager {
    private dialogueBox: DialogueBox;
    private interactionLayer: InteractionLayer;

    private currentSequence: ScenarioSequence | null = null;
    private currentIndex: number = 0;
    private uiState: UIState = 'idle';

    private callbacks: NarrativeCallbacks = {};
    private autoTimer: number | null = null;

    // Auto toggle (system) - progresses only from uiState === 'waiting'
    private autoEnabled: boolean = false;
    private autoWaitDelayMs: number = ANIM.STORY_CONTROLS.AUTO_WAIT_DELAY_MS;
    private waitingAutoTimer: number | null = null;

    // Fast-forward (system, triggered by hold-to-skip)
    private fastForwardEnabled: boolean = false;
    private fastForwardWaitDelayMs: number = ANIM.STORY_CONTROLS.FAST_FORWARD_WAIT_DELAY_MS;

    constructor(dialogueBox: DialogueBox, interactionLayer: InteractionLayer) {
        this.dialogueBox = dialogueBox;
        this.interactionLayer = interactionLayer;

        // Set up interaction handling with Animation Lock logic
        // Base handler: narrative input (can be temporarily overridden by start screens/popup)
        this.interactionLayer.pushHandler('narrative', () => this.handleInput());

        // NOTE: Typing complete callback is registered per-step in handleTextStep
        // NOT here in constructor

        console.log('[ScenarioManager] Initialized');
    }

    /**
     * Set UI state with logging (guards against meaningless transitions)
     */
    private setState(state: UIState): void {
        if (this.uiState === state) {
            return; // No-op for same state
        }
        // Leaving waiting cancels pending auto advance
        if (this.uiState === 'waiting' && state !== 'waiting') {
            this.cancelWaitingAutoAdvance();
        }
        const oldState = this.uiState;
        this.uiState = state;
        console.log(`[Scenario] State changed: ${oldState} → ${state}`);
    }

    setCallbacks(callbacks: NarrativeCallbacks): void {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    // ============================================
    // System Controls API (Skip / Auto)
    // ============================================

    setAutoEnabled(enabled: boolean): void {
        this.autoEnabled = enabled;
        console.log(`[Scenario] Auto toggle = ${enabled}`);

        // If we are already waiting, apply immediately
        if (enabled && this.uiState === 'waiting') {
            this.scheduleWaitingAutoAdvance(this.autoWaitDelayMs);
        } else if (!enabled) {
            this.cancelWaitingAutoAdvance();
        }
    }

    isAutoEnabled(): boolean {
        return this.autoEnabled;
    }

    enterFastForward(): void {
        if (this.fastForwardEnabled) return;
        this.fastForwardEnabled = true;
        console.log('[Scenario] Fast-forward enabled (hold skip triggered)');

        // If currently in an auto-step wait, cancel and move on immediately.
        if (this.uiState === 'auto') {
            this.cancelAutoProgress();
            this.advanceStep();
            return;
        }

        // If currently typing, skip immediately (after callbacks are wired)
        if (this.uiState === 'typing') {
            window.setTimeout(() => {
                if (this.uiState === 'typing') {
                    this.dialogueBox.skipTyping();
                }
            }, 0);
        }

        // If waiting, start fast advance immediately
        if (this.uiState === 'waiting') {
            this.scheduleWaitingAutoAdvance(this.fastForwardWaitDelayMs);
        }
    }

    /**
     * Start a scenario sequence
     */
    startSequence(sequence: ScenarioSequence): void {
        this.currentSequence = sequence;
        this.currentIndex = 0;
        this.uiState = 'idle'; // Direct set, not setState (initial)
        this.cancelAutoProgress();
        this.cancelWaitingAutoAdvance();
        this.fastForwardEnabled = false;

        console.log(`[Scenario] Starting sequence: ${sequence.name}`);
        this.playCurrentStep();
    }

    /**
     * Handle input based on current state (Animation Lock)
     */
    private handleInput(): void {
        console.log(`[Scenario] Input received, state = ${this.uiState}`);

        switch (this.uiState) {
            case 'typing':
                console.log('[Scenario] State = typing → skipTyping()');
                this.dialogueBox.skipTyping();
                break;

            case 'waiting':
                console.log('[Scenario] State = waiting → advanceStep()');
                this.cancelWaitingAutoAdvance();
                this.advanceStep();
                break;

            case 'auto':
                console.log('[Scenario] State = auto → skip auto, advanceStep()');
                this.cancelAutoProgress();
                this.advanceStep();
                break;

            case 'idle':
                console.log('[Scenario] Ignored (state = idle)');
                break;

            default:
                console.log(`[Scenario] Ignored (unknown state: ${this.uiState})`);
        }
    }

    /**
     * Play the current step
     */
    private playCurrentStep(): void {
        if (!this.currentSequence) return;

        const step = this.currentSequence.steps[this.currentIndex];
        if (!step) {
            this.endSequence();
            return;
        }

        console.log(`[Scenario] Playing step ${this.currentIndex}: ${step.type}`);

        switch (step.type) {
            case 'narration':
            case 'dialogue':
                this.handleTextStep(step);
                break;

            case 'auto':
                this.handleAutoStep(step);
                break;

            case 'event':
                this.handleEventStep(step);
                break;

            default:
                this.advanceStep();
        }
    }

    /**
     * Handle narration/dialogue step
     */
    private handleTextStep(step: NarrationStep | DialogueStep): void {
        this.setState('typing');

        // showText FIRST (it clears previous callback)
        const speaker = step.type === 'dialogue' ? step.speaker : undefined;
        this.dialogueBox.showText(step.text, speaker);

        // THEN register per-step callback (will be single-fired by DialogueBox)
        this.dialogueBox.setOnTypingComplete(() => {
            if (this.uiState === 'typing') {
                this.setState('waiting');
                console.log('[Scenario] Typing complete → waiting');
                this.onEnterWaiting();
            }
        });

        // Fast-forward: immediately complete typing to enter waiting
        if (this.fastForwardEnabled) {
            window.setTimeout(() => {
                if (this.uiState === 'typing') {
                    this.dialogueBox.skipTyping();
                }
            }, 0);
        }
    }

    /**
     * Handle auto-progress step
     */
    private handleAutoStep(step: AutoStep): void {
        this.setState('auto');

        // Auto step: typing complete does NOT trigger state change
        this.dialogueBox.setOnTypingComplete(null);

        if (step.text) {
            this.dialogueBox.showText(step.text, step.speaker);
        }

        const duration = this.fastForwardEnabled ? this.fastForwardWaitDelayMs : step.duration || 2000;
        console.log(`[Scenario] Auto-progress scheduled: ${duration}ms`);
        this.autoTimer = window.setTimeout(() => {
            this.autoTimer = null;
            console.log('[Scenario] Auto-progress triggered');
            this.advanceStep();
        }, duration);
    }

    /**
     * Handle event step
     */
    private handleEventStep(step: EventStep): void {
        console.log(`[Scenario] Event dispatched: ${step.event}`, step.payload || '');
        this.callbacks.onEvent?.(step.event, step.payload);
        // Events auto-advance immediately
        this.advanceStep();
    }

    /**
     * Cancel auto-progress timer
     */
    private cancelAutoProgress(): void {
        if (this.autoTimer !== null) {
            clearTimeout(this.autoTimer);
            this.autoTimer = null;
            console.log('[Scenario] Auto-progress cancelled');
        }
    }

    private onEnterWaiting(): void {
        // Fast-forward has priority over auto toggle.
        if (this.fastForwardEnabled) {
            this.scheduleWaitingAutoAdvance(this.fastForwardWaitDelayMs);
            return;
        }
        if (this.autoEnabled) {
            this.scheduleWaitingAutoAdvance(this.autoWaitDelayMs);
        }
    }

    private scheduleWaitingAutoAdvance(delayMs: number): void {
        this.cancelWaitingAutoAdvance();
        if (this.uiState !== 'waiting') return;

        this.waitingAutoTimer = window.setTimeout(() => {
            this.waitingAutoTimer = null;
            if (this.uiState !== 'waiting') return;
            console.log('[Scenario] Waiting auto-advance triggered');
            this.advanceStep();
        }, delayMs);
        console.log(`[Scenario] Waiting auto-advance scheduled: ${delayMs}ms`);
    }

    private cancelWaitingAutoAdvance(): void {
        if (this.waitingAutoTimer !== null) {
            clearTimeout(this.waitingAutoTimer);
            this.waitingAutoTimer = null;
            console.log('[Scenario] Waiting auto-advance cancelled');
        }
    }

    /**
     * Advance to next step
     */
    private advanceStep(): void {
        if (!this.currentSequence) return;

        this.currentIndex++;
        console.log(`[Scenario] Advancing to step ${this.currentIndex}`);

        if (this.currentIndex >= this.currentSequence.steps.length) {
            this.endSequence();
        } else {
            this.playCurrentStep();
        }
    }

    /**
     * End the current sequence
     */
    private endSequence(): void {
        console.log(`[Scenario] Sequence ended: ${this.currentSequence?.name}`);

        this.setState('idle');
        this.cancelAutoProgress();
        this.cancelWaitingAutoAdvance();
        this.fastForwardEnabled = false;
        this.dialogueBox.hide();
        this.currentSequence = null;
        this.currentIndex = 0;

        this.callbacks.onSequenceEnd?.();
    }

    /**
     * Get current UI state
     */
    getState(): UIState {
        return this.uiState;
    }

    /**
     * Check if sequence is playing
     */
    isPlaying(): boolean {
        return this.currentSequence !== null;
    }

    dispose(): void {
        this.cancelAutoProgress();
        this.cancelWaitingAutoAdvance();
        this.currentSequence = null;
    }
}
