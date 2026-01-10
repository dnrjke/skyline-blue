/**
 * TouchToStartScene - 타이틀 + 터치 대기 화면
 *
 * 배치 원칙:
 * 1. heightInPixels로 박스 크기 확정
 * 2. textVerticalAlignment = CENTER (박스 내부 정렬)
 * 3. verticalAlignment + topInPixels로 박스 위치 제어
 *
 * 타이틀: TOP 앵커 + 양수 오프셋 (아래로)
 * Prompt: BOTTOM 앵커 + 음수 오프셋 (위로)
 *
 * 100% Babylon GUI - HTML/CSS 금지
 */

import * as GUI from '@babylonjs/gui';
import { LAYOUT, COLORS, FONT, ANIM } from '../../../shared/design';
import { StartAnimator } from './StartAnimator';

export interface TouchToStartCallbacks {
    onStart?: () => void;
}

export class TouchToStartScene {
    private container!: GUI.Rectangle;
    private background!: GUI.Rectangle;
    private safeArea!: GUI.Rectangle;
    private titleText!: GUI.TextBlock;
    private subtitleText!: GUI.TextBlock;
    private touchPrompt!: GUI.TextBlock;

    private animator: StartAnimator;
    private callbacks: TouchToStartCallbacks = {};
    private isActive: boolean = false;
    private isTransitioning: boolean = false;

    constructor(private parentLayer: GUI.Rectangle) {
        this.animator = new StartAnimator();
        this.createUI();
        console.log('[TouchToStartScene] Initialized');
    }

    private createUI(): void {
        // 전체 화면 컨테이너
        this.container = new GUI.Rectangle('TouchToStartContainer');
        this.container.width = '100%';
        this.container.height = '100%';
        this.container.thickness = 0;
        this.container.isVisible = false;
        this.container.alpha = 0;
        this.container.isHitTestVisible = false;

        // 배경
        this.background = new GUI.Rectangle('StartBg');
        this.background.width = '100%';
        this.background.height = '100%';
        this.background.thickness = 0;
        this.background.background = COLORS.BG_TITLE;
        this.background.isHitTestVisible = false;
        this.container.addControl(this.background);

        // ========================================
        // Safe Area Container (노치/하단바 대응)
        // - 배경은 전체 화면, 텍스트/UI는 Safe Area 내부에만 배치
        // ========================================
        this.safeArea = new GUI.Rectangle('StartSafeArea');
        this.safeArea.width = '100%';
        this.safeArea.height = '100%';
        this.safeArea.thickness = 0;
        this.safeArea.isHitTestVisible = false;
        this.safeArea.paddingTopInPixels = LAYOUT.SAFE_AREA.TOP;
        this.safeArea.paddingBottomInPixels = LAYOUT.SAFE_AREA.BOTTOM;
        this.safeArea.paddingLeftInPixels = LAYOUT.SAFE_AREA.LEFT;
        this.safeArea.paddingRightInPixels = LAYOUT.SAFE_AREA.RIGHT;
        this.container.addControl(this.safeArea);

        // ========================================
        // 메인 타이틀 - TOP 앵커, 아래로 300px
        // ========================================
        this.titleText = new GUI.TextBlock('StartTitle');
        this.titleText.text = 'SKYLINE BLUE';
        this.titleText.color = COLORS.TEXT_WHITE;
        this.titleText.fontSizeInPixels = FONT.SIZE.START_TITLE;
        this.titleText.fontFamily = FONT.FAMILY.TITLE;
        // 1. 박스 크기 확정
        this.titleText.widthInPixels = LAYOUT.TOUCH_TO_START.TITLE_WIDTH;
        this.titleText.heightInPixels = LAYOUT.TOUCH_TO_START.TITLE_HEIGHT;
        // 2. 박스 내부 텍스트 중앙 정렬
        this.titleText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.titleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // 3. 박스 위치 (TOP 앵커 + 양수 오프셋)
        this.titleText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.titleText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.titleText.topInPixels = LAYOUT.TOUCH_TO_START.TITLE_OFFSET;
        this.titleText.isHitTestVisible = false;
        this.safeArea.addControl(this.titleText);

        // ========================================
        // 서브 타이틀 - TOP 앵커, 아래로 420px
        // ========================================
        this.subtitleText = new GUI.TextBlock('StartSubtitle');
        this.subtitleText.text = '— Arcana Vector —';
        this.subtitleText.color = COLORS.TEXT_SUBTITLE;
        this.subtitleText.fontSizeInPixels = FONT.SIZE.START_SUBTITLE;
        this.subtitleText.fontFamily = FONT.FAMILY.TITLE;
        // 1. 박스 크기 확정
        this.subtitleText.widthInPixels = LAYOUT.TOUCH_TO_START.SUBTITLE_WIDTH;
        this.subtitleText.heightInPixels = LAYOUT.TOUCH_TO_START.SUBTITLE_HEIGHT;
        // 2. 박스 내부 텍스트 중앙 정렬
        this.subtitleText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.subtitleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // 3. 박스 위치 (TOP 앵커 + 양수 오프셋)
        this.subtitleText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.subtitleText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.subtitleText.topInPixels = LAYOUT.TOUCH_TO_START.SUBTITLE_OFFSET;
        this.subtitleText.isHitTestVisible = false;
        this.safeArea.addControl(this.subtitleText);

        // ========================================
        // Touch to Start - BOTTOM 앵커, 위로 200px
        // ========================================
        this.touchPrompt = new GUI.TextBlock('TouchPrompt');
        this.touchPrompt.text = 'Touch to Start';
        this.touchPrompt.color = COLORS.TEXT_HINT;
        this.touchPrompt.fontSizeInPixels = FONT.SIZE.START_PROMPT;
        this.touchPrompt.fontFamily = FONT.FAMILY.BODY;
        // 1. 박스 크기 확정
        this.touchPrompt.widthInPixels = LAYOUT.TOUCH_TO_START.PROMPT_WIDTH;
        this.touchPrompt.heightInPixels = LAYOUT.TOUCH_TO_START.PROMPT_HEIGHT;
        // 2. 박스 내부 텍스트 중앙 정렬
        this.touchPrompt.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.touchPrompt.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // 3. 박스 위치 (BOTTOM 앵커 + 음수 오프셋)
        this.touchPrompt.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.touchPrompt.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.touchPrompt.topInPixels = LAYOUT.TOUCH_TO_START.PROMPT_OFFSET;
        this.touchPrompt.isHitTestVisible = false;
        this.safeArea.addControl(this.touchPrompt);

        this.parentLayer.addControl(this.container);
    }

    start(callbacks: TouchToStartCallbacks = {}): void {
        if (this.isActive) {
            console.warn('[TouchToStartScene] Already active');
            return;
        }

        this.callbacks = callbacks;
        this.isActive = true;
        this.isTransitioning = false;

        console.log('[TouchToStartScene] Starting');

        this.animator.fadeIn(this.container, ANIM.TOUCH_TO_START.FADE_IN_DURATION, () => {
            this.animator.startBlink(this.touchPrompt);
            console.log('[TouchToStartScene] Ready for touch');
        });
    }

    /**
     * HEBS 준수:
     * - TouchToStartScene은 입력을 직접 수신하지 않는다.
     * - Main이 InteractionLayer(단일 입력 지점)에서 이 메서드를 호출한다.
     */
    triggerStart(): void {
        if (!this.isActive || this.isTransitioning) return;

        console.log('[TouchToStartScene] Touch detected');
        this.isTransitioning = true;

        this.animator.stopBlink();
        this.touchPrompt.alpha = 1;

        this.animator.fadeOut(this.container, ANIM.TOUCH_TO_START.FADE_OUT_DURATION, () => {
            this.isActive = false;
            this.isTransitioning = false;
            console.log('[TouchToStartScene] Transition complete');
            this.callbacks.onStart?.();
        });
    }

    getIsActive(): boolean {
        return this.isActive;
    }

    hide(): void {
        this.animator.cancel();
        this.container.isVisible = false;
        this.container.alpha = 0;
        this.isActive = false;
        this.isTransitioning = false;
    }

    dispose(): void {
        this.animator.dispose();
        this.container.dispose();
    }
}
