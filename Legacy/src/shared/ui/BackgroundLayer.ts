/**
 * BackgroundLayer - 배경 표시 컴포넌트
 *
 * 적응형 UI 원칙:
 * - 배경만 화면 전체를 채움 (STRETCH_FILL)
 * - UI 요소는 고정 크기
 *
 * DisplayLayer 내부 최하단에 위치 (zIndex = 0)
 * HEBS 준수: isHitTestVisible = false (입력 관통)
 */

import * as GUI from '@babylonjs/gui';
import { COLORS, LAYOUT } from '../design';

export class BackgroundLayer {
    private container: GUI.Rectangle;
    private colorPanel: GUI.Rectangle;
    private imagePanel: GUI.Image | null = null;

    constructor(parentLayer: GUI.Rectangle) {
        // 배경 컨테이너 - 화면 전체
        this.container = new GUI.Rectangle('BackgroundLayer');
        this.container.width = '100%';
        this.container.height = '100%';
        this.container.thickness = 0;
        this.container.zIndex = LAYOUT.DISPLAY_ORDER.BACKGROUND_Z;
        this.container.isHitTestVisible = false;

        // 단색 배경 패널
        this.colorPanel = new GUI.Rectangle('BgColorPanel');
        this.colorPanel.width = '100%';
        this.colorPanel.height = '100%';
        this.colorPanel.thickness = 0;
        this.colorPanel.background = COLORS.BG_DEFAULT;
        this.colorPanel.isHitTestVisible = false;
        this.container.addControl(this.colorPanel);

        parentLayer.addControl(this.container);
        console.log('[BackgroundLayer] Initialized');
    }

    /**
     * 단색 배경 설정
     */
    setColor(color: string): void {
        this.colorPanel.background = color;
        this.colorPanel.isVisible = true;
        if (this.imagePanel) {
            this.imagePanel.isVisible = false;
        }
        console.log(`[BackgroundLayer] Color set: ${color}`);
    }

    /**
     * 이미지 배경 설정
     * STRETCH_FILL로 화면 전체 채움
     */
    setImage(url: string): void {
        if (!this.imagePanel) {
            this.imagePanel = new GUI.Image('BgImage', url);
            this.imagePanel.width = '100%';
            this.imagePanel.height = '100%';
            // 배경만 화면 전체 확장 (STRETCH_FILL)
            this.imagePanel.stretch = GUI.Image.STRETCH_FILL;
            this.imagePanel.isHitTestVisible = false;
            this.container.addControl(this.imagePanel);
        } else {
            this.imagePanel.source = url;
        }

        this.colorPanel.isVisible = false;
        this.imagePanel.isVisible = true;
        console.log(`[BackgroundLayer] Image set: ${url}`);
    }

    getColor(): string {
        return this.colorPanel.background || COLORS.BG_DEFAULT;
    }

    show(): void {
        this.container.isVisible = true;
    }

    hide(): void {
        this.container.isVisible = false;
    }

    dispose(): void {
        this.container.dispose();
    }
}
