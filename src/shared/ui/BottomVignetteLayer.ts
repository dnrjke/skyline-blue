import * as GUI from "@babylonjs/gui";
import { COLORS, LAYOUT } from "../design";

export class BottomVignetteLayer {
    private container: GUI.Rectangle;
    private image: GUI.Image;
    constructor(parentLayer: GUI.Rectangle) {
        this.container = new GUI.Rectangle("BottomVignetteLayer");
        this.container.width = "100%";
        // 비네트는 Safe Area 영역까지 덮어야 "하단 여백"이 보이지 않는다.
        this.container.heightInPixels = LAYOUT.VIGNETTE.HEIGHT + LAYOUT.SAFE_AREA.BOTTOM;
        this.container.thickness = 0;
        this.container.isHitTestVisible = false;
        this.container.zIndex = LAYOUT.DISPLAY_ORDER.VIGNETTE_Z;
        this.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        // BOTTOM 앵커에서는 topInPixels=0이 "최하단에 밀착"이다.
        // (여기서 SafeArea를 빼면 오히려 위로 떠서 하단 여백이 보임)
        this.container.topInPixels = LAYOUT.VIGNETTE.OFFSET;

        const url = this.createVerticalGradientDataUrl(8, 256);
        this.image = new GUI.Image("BottomVignetteImage", url);
        this.image.width = "100%";
        this.image.height = "100%";
        this.image.stretch = GUI.Image.STRETCH_FILL;
        this.image.isHitTestVisible = false;
        this.image.alpha = 1;
        this.container.addControl(this.image);
        parentLayer.addControl(this.container);
        console.log("[BottomVignetteLayer] Initialized");
    }

    show(): void { this.container.isVisible = true; }
    hide(): void { this.container.isVisible = false; }
    dispose(): void { this.container.dispose(); }

    private createVerticalGradientDataUrl(width: number, height: number): string {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return this.solidColorDataUrl(width, height, COLORS.VIGNETTE_BLACK);
        const g = ctx.createLinearGradient(0, 0, 0, height);
        g.addColorStop(0.0, "rgba(0,0,0,0.0)");
        g.addColorStop(0.55, "rgba(0,0,0,0.35)");
        g.addColorStop(1.0, "rgba(0,0,0,0.85)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, width, height);
        return canvas.toDataURL("image/png");
    }

    private solidColorDataUrl(width: number, height: number, color: string): string {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, width, height);
        }
        return canvas.toDataURL("image/png");
    }
}

