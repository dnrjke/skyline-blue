/**
 * CharacterLayer - 캐릭터 스탠딩 레이어 컴포넌트
 *
 * 배치 원칙:
 * 1. heightInPixels로 박스 크기 확정
 * 2. textVerticalAlignment = CENTER (박스 내부 정렬)
 * 3. verticalAlignment + topInPixels로 박스 위치 제어
 *
 * BOTTOM 앵커 + 음수 오프셋 (위로)
 *
 * DisplayLayer 내부에서 배경 위, 대화창 아래에 위치.
 * HEBS 준수: isHitTestVisible = false (입력 관통)
 */

import * as GUI from '@babylonjs/gui';
import { LAYOUT, COLORS, FONT } from '../design';

export type CharacterPosition = 'left' | 'center' | 'right';

interface CharacterSlot {
    id: string;
    position: CharacterPosition;
    container: GUI.Rectangle;
    /** 향후 Live2D 교체를 위한 시각 루트 */
    visualRoot: GUI.Rectangle;
    image: GUI.Image | null;
    placeholder: GUI.Rectangle;
    nameLabel: GUI.TextBlock;
}

export class CharacterLayer {
    private container: GUI.Rectangle;
    private slots: Map<string, CharacterSlot> = new Map();

    private readonly positionConfig: Record<CharacterPosition, {
        leftInPixels: number;
    }> = {
        left: {
            leftInPixels: LAYOUT.CHARACTER.LEFT_OFFSET,
        },
        center: {
            leftInPixels: 0,
        },
        right: {
            leftInPixels: LAYOUT.CHARACTER.RIGHT_OFFSET,
        },
    };

    constructor(parentLayer: GUI.Rectangle) {
        this.container = new GUI.Rectangle('CharacterLayer');
        this.container.width = '100%';
        this.container.height = '100%';
        this.container.thickness = 0;
        // DisplayLayer internal order: Background < Character < Dialogue
        this.container.zIndex = LAYOUT.DISPLAY_ORDER.CHARACTER_Z;
        this.container.isHitTestVisible = false;

        parentLayer.addControl(this.container);
        console.log('[CharacterLayer] Initialized');
    }

    /**
     * NIKKE-style character placement:
     * - Anchor: BOTTOM_CENTER
     * - DialogueBox가 하반신을 가릴 수 있도록 화면 하단에 부착
     */
    showCharacter(id: string, position: CharacterPosition, imageUrl?: string): void {
        if (this.slots.has(id)) {
            this.updatePosition(id, position);
            if (imageUrl) {
                this.setCharacterImage(id, imageUrl);
            }
            return;
        }

        const slot = this.createCharacterSlot(id, position, imageUrl);
        this.slots.set(id, slot);

        console.log(`[CharacterLayer] Show character: ${id} at ${position}`);
    }

    hideCharacter(id: string): void {
        const slot = this.slots.get(id);
        if (slot) {
            slot.container.dispose();
            this.slots.delete(id);
            console.log(`[CharacterLayer] Hide character: ${id}`);
        }
    }

    hideAll(): void {
        this.slots.forEach((slot) => {
            slot.container.dispose();
        });
        this.slots.clear();
        console.log('[CharacterLayer] All characters hidden');
    }

    private updatePosition(id: string, position: CharacterPosition): void {
        const slot = this.slots.get(id);
        if (!slot) return;

        const config = this.positionConfig[position];
        // NIKKE: slot는 항상 CENTER 정렬 + 좌우 오프셋만 조정
        slot.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        slot.container.leftInPixels = config.leftInPixels;
        slot.position = position;

        console.log(`[CharacterLayer] Update position: ${id} to ${position}`);
    }

    private createCharacterSlot(id: string, position: CharacterPosition, imageUrl?: string): CharacterSlot {
        const config = this.positionConfig[position];

        // ========================================
        // 캐릭터 컨테이너 (NIKKE) - BOTTOM_CENTER 앵커
        // ========================================
        const container = new GUI.Rectangle(`Character_${id}`);
        // 1. 박스 크기 확정
        container.widthInPixels = LAYOUT.CHARACTER.WIDTH;
        container.heightInPixels = LAYOUT.CHARACTER.HEIGHT;
        container.thickness = 0;
        container.isHitTestVisible = false;
        // 3. 박스 위치 (BOTTOM_CENTER 앵커)
        container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        container.topInPixels = LAYOUT.CHARACTER.OFFSET;
        container.leftInPixels = config.leftInPixels;

        // ========================================
        // Visual Root (향후 Live2D로 교체 가능)
        // - 현재는 Image(스태틱) 또는 Placeholder를 내부에 배치
        // - Anchor: BOTTOM_CENTER (컨테이너 하단에 붙음)
        // ========================================
        const visualRoot = new GUI.Rectangle(`CharacterVisualRoot_${id}`);
        visualRoot.width = '100%';
        visualRoot.height = '100%';
        visualRoot.thickness = 0;
        visualRoot.isHitTestVisible = false;
        visualRoot.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        visualRoot.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        container.addControl(visualRoot);

        // 플레이스홀더 (실루엣)
        const placeholder = new GUI.Rectangle(`Placeholder_${id}`);
        placeholder.width = '100%';
        placeholder.height = '100%';
        placeholder.thickness = 2;
        placeholder.color = COLORS.CHARACTER_BORDER;
        placeholder.background = COLORS.CHARACTER_PLACEHOLDER;
        placeholder.cornerRadius = 8;
        placeholder.isHitTestVisible = false;
        visualRoot.addControl(placeholder);

        // 스태틱 이미지 (옵션) - NIKKE 스타일: 하단 중앙 기준으로 고정
        let image: GUI.Image | null = null;
        if (imageUrl) {
            image = new GUI.Image(`CharacterImage_${id}`, imageUrl);
            image.width = '100%';
            image.height = '100%';
            image.stretch = GUI.Image.STRETCH_UNIFORM;
            image.isHitTestVisible = false;
            image.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
            image.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            visualRoot.addControl(image);
            placeholder.isVisible = false;
        }

        // ========================================
        // 캐릭터 ID 라벨 - BOTTOM 앵커, 위로 10px
        // ========================================
        const nameLabel = new GUI.TextBlock(`Label_${id}`);
        nameLabel.text = id.replace('_', ' ');
        nameLabel.color = COLORS.TEXT_WHITE;
        nameLabel.fontSizeInPixels = FONT.SIZE.CHARACTER_LABEL;
        nameLabel.isHitTestVisible = false;
        // 1. 박스 크기 확정
        nameLabel.widthInPixels = LAYOUT.CHARACTER.LABEL_WIDTH;
        nameLabel.heightInPixels = LAYOUT.CHARACTER.LABEL_HEIGHT;
        // 2. 박스 내부 텍스트 중앙 정렬
        nameLabel.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        nameLabel.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // 3. 박스 위치 (BOTTOM 앵커 + 음수 오프셋)
        nameLabel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        nameLabel.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        nameLabel.topInPixels = LAYOUT.CHARACTER.LABEL_OFFSET;
        container.addControl(nameLabel);

        this.container.addControl(container);

        return {
            id,
            position,
            container,
            visualRoot,
            image,
            placeholder,
            nameLabel,
        };
    }

    setCharacterImage(id: string, imageUrl: string): void {
        const slot = this.slots.get(id);
        if (!slot) return;

        if (!slot.image) {
            const image = new GUI.Image(`CharacterImage_${id}`, imageUrl);
            image.width = '100%';
            image.height = '100%';
            image.stretch = GUI.Image.STRETCH_UNIFORM;
            image.isHitTestVisible = false;
            image.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
            image.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            slot.visualRoot.addControl(image);
            slot.image = image;
        } else {
            slot.image.source = imageUrl;
        }

        slot.placeholder.isVisible = false;
        console.log(`[CharacterLayer] Image set: ${id} -> ${imageUrl}`);
    }

    dispose(): void {
        this.hideAll();
        this.container.dispose();
    }
}
