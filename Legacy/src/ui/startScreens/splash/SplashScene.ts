/**
 * SplashScene - 전체 화면 스플래시 로고
 *
 * 배치 원칙:
 * 1. heightInPixels로 박스 크기 확정
 * 2. textVerticalAlignment = CENTER (박스 내부 정렬)
 * 3. verticalAlignment + topInPixels로 박스 위치 제어
 *
 * 100% Babylon GUI - HTML/CSS 금지
 */

import * as GUI from '@babylonjs/gui';
import { LAYOUT, COLORS, FONT } from '../../../shared/design';
import { SplashAnimator } from './SplashAnimator';

export interface SplashSceneCallbacks {
    onComplete?: () => void;
    onSkip?: () => void;
}

export class SplashScene {
    private container!: GUI.Rectangle;
    private background!: GUI.Rectangle;
    private titleText!: GUI.TextBlock;
    private subtitleText!: GUI.TextBlock;

    private animator: SplashAnimator;
    private callbacks: SplashSceneCallbacks = {};
    private isActive: boolean = false;

    constructor(private parentLayer: GUI.Rectangle) {
        this.animator = new SplashAnimator();
        this.createUI();
        console.log('[SplashScene] Initialized');
    }

    private createUI(): void {
        // 전체 화면 컨테이너
        this.container = new GUI.Rectangle('SplashContainer');
        this.container.width = '100%';
        this.container.height = '100%';
        this.container.thickness = 0;
        this.container.isVisible = false;
        this.container.alpha = 0;
        this.container.isHitTestVisible = false;

        // 배경
        this.background = new GUI.Rectangle('SplashBg');
        this.background.width = '100%';
        this.background.height = '100%';
        this.background.thickness = 0;
        this.background.background = COLORS.BG_SPLASH;
        this.background.isHitTestVisible = false;
        this.container.addControl(this.background);

        // ========================================
        // 메인 타이틀 - CENTER 앵커, 위로 30px
        // ========================================
        this.titleText = new GUI.TextBlock('SplashTitle');
        this.titleText.text = 'SKYLINE BLUE';
        this.titleText.color = COLORS.TEXT_WHITE;
        this.titleText.fontSizeInPixels = FONT.SIZE.SPLASH_TITLE;
        this.titleText.fontFamily = FONT.FAMILY.TITLE;
        // 1. 박스 크기 확정
        this.titleText.widthInPixels = LAYOUT.SPLASH.TITLE_WIDTH;
        this.titleText.heightInPixels = LAYOUT.SPLASH.TITLE_HEIGHT;
        // 2. 박스 내부 텍스트 중앙 정렬
        this.titleText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.titleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // 3. 박스 위치 (CENTER 앵커 + 오프셋)
        this.titleText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.titleText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.titleText.topInPixels = LAYOUT.SPLASH.TITLE_OFFSET;
        this.titleText.isHitTestVisible = false;
        this.container.addControl(this.titleText);

        // ========================================
        // 서브 타이틀 - CENTER 앵커, 아래로 50px
        // ========================================
        this.subtitleText = new GUI.TextBlock('SplashSubtitle');
        this.subtitleText.text = 'Arcana Vector';
        this.subtitleText.color = COLORS.TEXT_MUTED;
        this.subtitleText.fontSizeInPixels = FONT.SIZE.SPLASH_SUBTITLE;
        this.subtitleText.fontFamily = FONT.FAMILY.TITLE;
        // 1. 박스 크기 확정
        this.subtitleText.widthInPixels = LAYOUT.SPLASH.SUBTITLE_WIDTH;
        this.subtitleText.heightInPixels = LAYOUT.SPLASH.SUBTITLE_HEIGHT;
        // 2. 박스 내부 텍스트 중앙 정렬
        this.subtitleText.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.subtitleText.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // 3. 박스 위치 (CENTER 앵커 + 오프셋)
        this.subtitleText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.subtitleText.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.subtitleText.topInPixels = LAYOUT.SPLASH.SUBTITLE_OFFSET;
        this.subtitleText.isHitTestVisible = false;
        this.container.addControl(this.subtitleText);

        this.parentLayer.addControl(this.container);
    }

    start(callbacks: SplashSceneCallbacks = {}): void {
        if (this.isActive) {
            console.warn('[SplashScene] Already active');
            return;
        }

        this.callbacks = callbacks;
        this.isActive = true;

        console.log('[SplashScene] Starting splash sequence');

        this.animator.runSequence(this.container, {
            onSequenceComplete: () => {
                this.isActive = false;
                console.log('[SplashScene] Sequence complete');
                this.callbacks.onComplete?.();
            },
        });
    }

    skip(): void {
        if (!this.isActive) return;

        console.log('[SplashScene] Skipping');
        this.animator.skip(this.container, () => {
            this.isActive = false;
            this.callbacks.onSkip?.();
            this.callbacks.onComplete?.();
        });
    }

    getIsActive(): boolean {
        return this.isActive;
    }

    hide(): void {
        this.container.isVisible = false;
        this.container.alpha = 0;
        this.isActive = false;
    }

    dispose(): void {
        this.animator.dispose();
        this.container.dispose();
    }
}
