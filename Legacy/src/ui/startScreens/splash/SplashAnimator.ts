/**
 * SplashAnimator - 스플래시 화면 전용 애니메이션
 *
 * AnimationGroup 표준: requestAnimationFrame 기반 연출
 * - Fade-In → Hold → Fade-Out 시퀀스 관리
 *
 * arcana_ui_rules.md §3.1: 애니메이션 수치는 AnimationConfig 참조
 */

import * as GUI from '@babylonjs/gui';
import { ANIM } from '../../../shared/design';

export interface SplashAnimationCallbacks {
    onFadeInComplete?: () => void;
    onHoldComplete?: () => void;
    onFadeOutComplete?: () => void;
    onSequenceComplete?: () => void;
}

export class SplashAnimator {
    private animationId: number | null = null;
    private isRunning: boolean = false;

    constructor() {
        console.log('[SplashAnimator] Initialized');
    }

    /**
     * 전체 스플래시 시퀀스 실행
     * Fade-In → Hold → Fade-Out
     */
    runSequence(
        container: GUI.Container,
        callbacks: SplashAnimationCallbacks = {}
    ): void {
        if (this.isRunning) {
            console.warn('[SplashAnimator] Sequence already running');
            return;
        }

        this.isRunning = true;

        console.log('[SplashAnimator] Starting sequence');

        // Phase 1: Fade-In
        this.fadeIn(container, ANIM.SPLASH.FADE_IN_DURATION, () => {
            callbacks.onFadeInComplete?.();
            console.log('[SplashAnimator] Fade-In complete');

            // Phase 2: Hold
            setTimeout(() => {
                callbacks.onHoldComplete?.();
                console.log('[SplashAnimator] Hold complete');

                // Phase 3: Fade-Out
                this.fadeOut(container, ANIM.SPLASH.FADE_OUT_DURATION, () => {
                    callbacks.onFadeOutComplete?.();
                    this.isRunning = false;
                    console.log('[SplashAnimator] Sequence complete');
                    callbacks.onSequenceComplete?.();
                });
            }, ANIM.SPLASH.HOLD_DURATION);
        });
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

    skip(container: GUI.Container, onComplete?: () => void): void {
        this.cancel();
        container.alpha = 0;
        container.isVisible = false;
        this.isRunning = false;
        console.log('[SplashAnimator] Skipped');
        onComplete?.();
    }

    cancel(): void {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
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

    getIsRunning(): boolean {
        return this.isRunning;
    }

    dispose(): void {
        this.cancel();
    }
}
