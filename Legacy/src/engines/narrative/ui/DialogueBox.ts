/**
 * DialogueBox - Babylon GUI Text Display
 *
 * 배치 원칙:
 * 1. heightInPixels로 박스 크기 확정
 * 2. textVerticalAlignment = CENTER (박스 내부 정렬)
 * 3. verticalAlignment + topInPixels로 박스 위치 제어
 *
 * BOTTOM 앵커 + 음수 오프셋 (위로)
 *
 * Visual-only component. isHitTestVisible = false.
 * Part of Narrative Engine - internal module
 */

import * as GUI from '@babylonjs/gui';
import { LAYOUT, COLORS, FONT, ANIM } from '../../../shared/design';
import { NarrativeAnimator } from './NarrativeAnimator';

export class DialogueBox {
    private container: GUI.Rectangle;
    private nameTag: GUI.TextBlock;
    private textBlock: GUI.TextBlock;
    private backgroundPanel: GUI.Rectangle;

    private animator: NarrativeAnimator;
    private isShowing: boolean = false;

    // Typing state
    private fullText: string = '';
    private displayedLength: number = 0;
    private typingInterval: number | null = null;
    private isTyping: boolean = false;

    private onTypingComplete: (() => void) | null = null;

    constructor(parentLayer: GUI.Rectangle) {
        this.animator = new NarrativeAnimator();

        // ========================================
        // Main container - BOTTOM 앵커, 위로 40px
        // ========================================
        this.container = new GUI.Rectangle('DialogueBox');
        this.container.widthInPixels = LAYOUT.DIALOGUE.WIDTH;
        this.container.heightInPixels = LAYOUT.DIALOGUE.HEIGHT;
        this.container.thickness = 0;
        this.container.isHitTestVisible = false;  // HEBS compliance
        // DisplayLayer internal order: Background < Character < Dialogue
        this.container.zIndex = LAYOUT.DISPLAY_ORDER.DIALOGUE_Z;
        // 박스 위치 (BOTTOM 앵커 + 음수 오프셋)
        this.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // Safe Area 반영: 하단바/노치 영역을 침범하지 않음
        this.container.topInPixels = LAYOUT.DIALOGUE.OFFSET - LAYOUT.SAFE_AREA.BOTTOM;

        // Background panel
        this.backgroundPanel = new GUI.Rectangle('DialogueBg');
        this.backgroundPanel.width = '100%';
        this.backgroundPanel.height = '100%';
        this.backgroundPanel.background = COLORS.DIALOGUE_BG;
        this.backgroundPanel.cornerRadius = LAYOUT.DIALOGUE.CORNER_RADIUS;
        this.backgroundPanel.thickness = LAYOUT.DIALOGUE.BORDER_THICKNESS;
        this.backgroundPanel.color = COLORS.DIALOGUE_BORDER;
        this.backgroundPanel.isHitTestVisible = false;
        this.container.addControl(this.backgroundPanel);

        // ========================================
        // Speaker name tag - TOP-LEFT, 아래로 25px
        // ========================================
        this.nameTag = new GUI.TextBlock('NameTag');
        this.nameTag.text = '';
        this.nameTag.color = COLORS.TEXT_GOLD;
        this.nameTag.fontSizeInPixels = FONT.SIZE.DIALOGUE_SPEAKER;
        this.nameTag.fontWeight = FONT.WEIGHT.BOLD;
        this.nameTag.fontFamily = FONT.FAMILY.BODY;
        this.nameTag.isHitTestVisible = false;
        // 1. 박스 크기 확정
        this.nameTag.widthInPixels = LAYOUT.DIALOGUE.SPEAKER_WIDTH;
        this.nameTag.heightInPixels = LAYOUT.DIALOGUE.SPEAKER_HEIGHT;
        // 2. 박스 내부 텍스트 정렬 (좌측 정렬, 수직 중앙)
        this.nameTag.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.nameTag.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        // 3. 박스 위치 (TOP 앵커 + 양수 오프셋)
        this.nameTag.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.nameTag.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.nameTag.topInPixels = LAYOUT.DIALOGUE.SPEAKER_OFFSET;
        this.nameTag.leftInPixels = LAYOUT.DIALOGUE.PADDING;
        this.container.addControl(this.nameTag);

        // ========================================
        // Dialogue text - TOP-LEFT, 아래로 75px
        // ========================================
        this.textBlock = new GUI.TextBlock('DialogueText');
        this.textBlock.text = '';
        this.textBlock.color = COLORS.TEXT_WHITE;
        this.textBlock.fontSizeInPixels = FONT.SIZE.DIALOGUE_TEXT;
        this.textBlock.fontFamily = FONT.FAMILY.BODY;
        this.textBlock.textWrapping = true;
        this.textBlock.isHitTestVisible = false;
        this.textBlock.lineSpacing = FONT.LINE_SPACING.DIALOGUE;
        // 1. 박스 크기 확정
        this.textBlock.widthInPixels = LAYOUT.DIALOGUE.TEXT_WIDTH;
        this.textBlock.heightInPixels = LAYOUT.DIALOGUE.TEXT_HEIGHT;
        // 2. 박스 내부 텍스트 정렬 (좌측 상단, 멀티라인)
        this.textBlock.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.textBlock.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        // 3. 박스 위치 (TOP 앵커 + 양수 오프셋)
        this.textBlock.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.textBlock.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.textBlock.topInPixels = LAYOUT.DIALOGUE.TEXT_OFFSET;
        this.textBlock.leftInPixels = LAYOUT.DIALOGUE.PADDING;
        this.container.addControl(this.textBlock);

        parentLayer.addControl(this.container);
        this.hide();

        console.log('[DialogueBox] Initialized');
    }

    showText(text: string, speaker?: string): void {
        this.onTypingComplete = null;
        this.fullText = text;
        this.displayedLength = 0;
        this.textBlock.text = '';

        if (speaker) {
            this.nameTag.text = speaker;
            this.nameTag.isVisible = true;
        } else {
            this.nameTag.text = '';
            this.nameTag.isVisible = false;
        }

        if (this.isShowing) {
            this.startTyping();
            return;
        }

        this.showWithAnimation(() => {
            this.startTyping();
        });
    }

    private startTyping(): void {
        if (this.typingInterval !== null) {
            clearInterval(this.typingInterval);
            this.typingInterval = null;
        }

        this.isTyping = true;
        this.displayedLength = 0;

        this.typingInterval = window.setInterval(() => {
            if (this.displayedLength < this.fullText.length) {
                this.displayedLength++;
                this.textBlock.text = this.fullText.substring(0, this.displayedLength);
            } else {
                this.completeTyping();
            }
        }, ANIM.DIALOGUE.TYPING_SPEED);
    }

    private completeTyping(): void {
        if (!this.isTyping) {
            return;
        }

        if (this.typingInterval !== null) {
            clearInterval(this.typingInterval);
            this.typingInterval = null;
        }

        this.isTyping = false;
        this.textBlock.text = this.fullText;

        if (this.onTypingComplete) {
            const callback = this.onTypingComplete;
            this.onTypingComplete = null;
            callback();
        }
    }

    skipTyping(): void {
        if (!this.isTyping) return;
        console.log('[DialogueBox] Typing skipped');
        this.completeTyping();
    }

    getIsTyping(): boolean {
        return this.isTyping;
    }

    setOnTypingComplete(callback: (() => void) | null): void {
        this.onTypingComplete = callback;
    }

    show(): void {
        this.container.alpha = 1;
        this.container.isVisible = true;
        this.isShowing = true;
    }

    showWithAnimation(onComplete?: () => void): void {
        this.isShowing = true;
        this.animator.fadeIn(this.container, {
            duration: ANIM.DIALOGUE.FADE_IN_DURATION,
            onComplete: () => {
                console.log('[DialogueBox] Fade-In complete');
                onComplete?.();
            },
        });
    }

    hide(): void {
        this.stopTyping();
        this.container.isVisible = false;
        this.container.alpha = 0;
        this.isShowing = false;
    }

    hideWithAnimation(onComplete?: () => void): void {
        this.stopTyping();
        this.animator.fadeOut(this.container, {
            duration: ANIM.DIALOGUE.FADE_OUT_DURATION,
            onComplete: () => {
                this.isShowing = false;
                console.log('[DialogueBox] Fade-Out complete');
                onComplete?.();
            },
        });
    }

    private stopTyping(): void {
        if (this.typingInterval !== null) {
            clearInterval(this.typingInterval);
            this.typingInterval = null;
        }
        this.isTyping = false;
    }

    getIsShowing(): boolean {
        return this.isShowing;
    }

    getIsAnimating(): boolean {
        return this.animator.isAnimating(this.container.name || 'DialogueBox');
    }

    clear(): void {
        this.textBlock.text = '';
        this.nameTag.text = '';
        this.fullText = '';
        this.displayedLength = 0;
    }

    dispose(): void {
        this.hide();
        this.animator.dispose();
        this.container.dispose();
    }
}
