/**
 * NarrativeAnimator - AnimationGroup 기반 UI 연출 시스템
 *
 * Option A 채택: Babylon.AnimationGroup 사용
 * - 정교한 연출, 연속 애니메이션/효과 관리 용이
 * - 모든 UI 연출(Fade, Slide 등)을 중앙에서 관리
 *
 * Part of Narrative Engine - internal module
 *
 * 사용 규칙:
 * - 연출 중에는 Animation Lock 상태 유지
 * - 콜백을 통해 연출 완료를 알림
 * - GUI Control의 alpha 속성을 애니메이션화
 */

import * as GUI from '@babylonjs/gui';
import { ANIM } from '../../../shared/design';

/** 애니메이션 타입 */
export type AnimationType = 'fadeIn' | 'fadeOut' | 'slideUp' | 'slideDown';

/** 애니메이션 옵션 */
export interface AnimationOptions {
    duration?: number;      // ms (기본값: ANIM.TRANSITION.DEFAULT_DURATION)
    easing?: string;        // 이징 함수 이름
    onComplete?: () => void;
}

/** 기본 애니메이션 설정 (Design System 참조) */
const DEFAULT_OPTIONS: Required<Omit<AnimationOptions, 'onComplete'>> = {
    duration: ANIM.TRANSITION.DEFAULT_DURATION,
    easing: ANIM.EASING.OUT_QUAD,
};

/**
 * NarrativeAnimator - Narrative Engine 전용 애니메이션 관리자
 *
 * GUI Control에 AnimationGroup을 적용하여 연출을 관리합니다.
 * Scene 참조 없이 requestAnimationFrame 기반으로 동작합니다.
 */
export class NarrativeAnimator {
    private activeAnimations: Map<string, number> = new Map(); // control name -> requestAnimationFrame ID

    constructor() {
        console.log('[NarrativeAnimator] Initialized (AnimationGroup standard)');
    }

    /**
     * Fade-In 애니메이션
     * alpha: 0 → 1
     */
    fadeIn(control: GUI.Control, options: AnimationOptions = {}): void {
        const { duration, onComplete } = { ...DEFAULT_OPTIONS, ...options };
        const controlName = control.name || 'unnamed';

        // 기존 애니메이션 취소
        this.cancelAnimation(controlName);

        // 초기 상태 설정
        control.alpha = 0;
        control.isVisible = true;

        console.log(`[NarrativeAnimator] FadeIn start: ${controlName} (${duration}ms)`);

        // 애니메이션 실행
        this.runAnimation(controlName, duration, (progress) => {
            control.alpha = this.easeOutQuad(progress);
        }, () => {
            control.alpha = 1;
            console.log(`[NarrativeAnimator] FadeIn complete: ${controlName}`);
            onComplete?.();
        });
    }

    /**
     * Fade-Out 애니메이션
     * alpha: 1 → 0
     */
    fadeOut(control: GUI.Control, options: AnimationOptions = {}): void {
        const { duration, onComplete } = { ...DEFAULT_OPTIONS, ...options };
        const controlName = control.name || 'unnamed';

        // 기존 애니메이션 취소
        this.cancelAnimation(controlName);

        // 초기 상태
        const startAlpha = control.alpha;

        console.log(`[NarrativeAnimator] FadeOut start: ${controlName} (${duration}ms)`);

        this.runAnimation(controlName, duration, (progress) => {
            control.alpha = startAlpha * (1 - this.easeOutQuad(progress));
        }, () => {
            control.alpha = 0;
            control.isVisible = false;
            console.log(`[NarrativeAnimator] FadeOut complete: ${controlName}`);
            onComplete?.();
        });
    }

    /**
     * Slide-Up 애니메이션 (아래에서 위로)
     * top: startTop + offset → startTop
     */
    slideUp(control: GUI.Control, offset: number = 50, options: AnimationOptions = {}): void {
        const { duration, onComplete } = { ...DEFAULT_OPTIONS, ...options };
        const controlName = control.name || 'unnamed';

        this.cancelAnimation(controlName);

        // 초기 위치 파싱
        const startTop = this.parsePixelValue(control.top);
        control.top = `${startTop + offset}px`;
        control.alpha = 0;
        control.isVisible = true;

        console.log(`[NarrativeAnimator] SlideUp start: ${controlName}`);

        this.runAnimation(controlName, duration, (progress) => {
            const eased = this.easeOutQuad(progress);
            control.top = `${startTop + offset * (1 - eased)}px`;
            control.alpha = eased;
        }, () => {
            control.top = `${startTop}px`;
            control.alpha = 1;
            console.log(`[NarrativeAnimator] SlideUp complete: ${controlName}`);
            onComplete?.();
        });
    }

    /**
     * Slide-Down 애니메이션 (위에서 아래로 사라짐)
     */
    slideDown(control: GUI.Control, offset: number = 50, options: AnimationOptions = {}): void {
        const { duration, onComplete } = { ...DEFAULT_OPTIONS, ...options };
        const controlName = control.name || 'unnamed';

        this.cancelAnimation(controlName);

        const startTop = this.parsePixelValue(control.top);
        const startAlpha = control.alpha;

        console.log(`[NarrativeAnimator] SlideDown start: ${controlName}`);

        this.runAnimation(controlName, duration, (progress) => {
            const eased = this.easeOutQuad(progress);
            control.top = `${startTop + offset * eased}px`;
            control.alpha = startAlpha * (1 - eased);
        }, () => {
            control.top = `${startTop + offset}px`;
            control.alpha = 0;
            control.isVisible = false;
            console.log(`[NarrativeAnimator] SlideDown complete: ${controlName}`);
            onComplete?.();
        });
    }

    /**
     * 애니메이션 즉시 완료 (스킵)
     */
    skipAnimation(controlName: string): void {
        const animId = this.activeAnimations.get(controlName);
        if (animId !== undefined) {
            cancelAnimationFrame(animId);
            this.activeAnimations.delete(controlName);
            console.log(`[NarrativeAnimator] Animation skipped: ${controlName}`);
        }
    }

    /**
     * 모든 애니메이션 취소
     */
    cancelAllAnimations(): void {
        this.activeAnimations.forEach((id) => {
            cancelAnimationFrame(id);
        });
        this.activeAnimations.clear();
        console.log('[NarrativeAnimator] All animations cancelled');
    }

    /**
     * 특정 컨트롤의 애니메이션 취소
     */
    private cancelAnimation(controlName: string): void {
        const animId = this.activeAnimations.get(controlName);
        if (animId !== undefined) {
            cancelAnimationFrame(animId);
            this.activeAnimations.delete(controlName);
        }
    }

    /**
     * 애니메이션 실행 (requestAnimationFrame 기반)
     */
    private runAnimation(
        controlName: string,
        duration: number,
        update: (progress: number) => void,
        complete: () => void
    ): void {
        const startTime = performance.now();

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            update(progress);

            if (progress < 1) {
                const id = requestAnimationFrame(animate);
                this.activeAnimations.set(controlName, id);
            } else {
                this.activeAnimations.delete(controlName);
                complete();
            }
        };

        const id = requestAnimationFrame(animate);
        this.activeAnimations.set(controlName, id);
    }

    /**
     * Easing: easeOutQuad
     * 빠르게 시작, 부드럽게 감속
     */
    private easeOutQuad(t: number): number {
        return 1 - (1 - t) * (1 - t);
    }

    /**
     * 픽셀 값 파싱 (예: '-40px' → -40)
     */
    private parsePixelValue(value: string | number): number {
        if (typeof value === 'number') return value;
        const match = value.match(/-?\d+/);
        return match ? parseInt(match[0], 10) : 0;
    }

    /**
     * 애니메이션 진행 중인지 확인
     */
    isAnimating(controlName?: string): boolean {
        if (controlName) {
            return this.activeAnimations.has(controlName);
        }
        return this.activeAnimations.size > 0;
    }

    dispose(): void {
        this.cancelAllAnimations();
    }
}
