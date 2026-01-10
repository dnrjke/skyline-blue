/**
 * StartAnimator - Touch-to-Start 화면 전용 애니메이션
 *
 * AnimationGroup 표준: requestAnimationFrame 기반
 * - Fade-In/Out
 * - Touch to Start 텍스트 점멸 (Blink)
 *
 * arcana_ui_rules.md §3.1: 애니메이션 수치는 AnimationConfig 참조
 */

import * as GUI from '@babylonjs/gui';
import { ANIM } from '../../../shared/design';

export class StartAnimator {
    private animationId: number | null = null;
    private blinkAnimationId: number | null = null;

    constructor() {
        console.log('[StartAnimator] Initialized');
    }

    fadeIn(
        container: GUI.Container,
        duration: number,
        onComplete?: () => void
    ): void {
        container.alpha = 0;
        container.isVisible = true;

        this.animate(duration, (progress) => {
            container.alpha = this.easeOutQuad(progress);
        }, () => {
            container.alpha = 1;
            onComplete?.();
        });
    }

    fadeOut(
        container: GUI.Container,
        duration: number,
        onComplete?: () => void
    ): void {
        const startAlpha = container.alpha;

        this.animate(duration, (progress) => {
            container.alpha = startAlpha * (1 - this.easeOutQuad(progress));
        }, () => {
            container.alpha = 0;
            container.isVisible = false;
            onComplete?.();
        });
    }

    startBlink(textBlock: GUI.TextBlock): void {
        if (this.blinkAnimationId !== null) return;

        const startTime = performance.now();

        const blink = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const t = (Math.sin((elapsed / ANIM.TOUCH_TO_START.BLINK_INTERVAL) * Math.PI * 2) + 1) / 2;
            textBlock.alpha = ANIM.TOUCH_TO_START.BLINK_MIN_ALPHA +
                (ANIM.TOUCH_TO_START.BLINK_MAX_ALPHA - ANIM.TOUCH_TO_START.BLINK_MIN_ALPHA) * t;

            this.blinkAnimationId = requestAnimationFrame(blink);
        };

        this.blinkAnimationId = requestAnimationFrame(blink);
        console.log('[StartAnimator] Blink started');
    }

    stopBlink(): void {
        if (this.blinkAnimationId !== null) {
            cancelAnimationFrame(this.blinkAnimationId);
            this.blinkAnimationId = null;
            console.log('[StartAnimator] Blink stopped');
        }
    }

    cancel(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        this.stopBlink();
    }

    private animate(
        duration: number,
        update: (progress: number) => void,
        complete: () => void
    ): void {
        const startTime = performance.now();

        const tick = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            update(progress);

            if (progress < 1) {
                this.animationId = requestAnimationFrame(tick);
            } else {
                this.animationId = null;
                complete();
            }
        };

        this.animationId = requestAnimationFrame(tick);
    }

    private easeOutQuad(t: number): number {
        return 1 - (1 - t) * (1 - t);
    }

    dispose(): void {
        this.cancel();
    }
}
