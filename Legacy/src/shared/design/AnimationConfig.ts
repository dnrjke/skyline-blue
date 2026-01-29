/**
 * AnimationConfig - 연출 시간, 이징, 루프 여부
 *
 * arcana_ui_rules.md §3.1: 모든 애니메이션 수치는 src/shared/design/에서 관리
 * Magic-Number Zero 원칙 준수
 */

export const ANIM = {
    // ============================================
    // Splash Screen
    // ============================================
    SPLASH: {
        FADE_IN_DURATION: 800,
        HOLD_DURATION: 1500,
        FADE_OUT_DURATION: 600,
    },

    // ============================================
    // Touch-to-Start Screen
    // ============================================
    TOUCH_TO_START: {
        FADE_IN_DURATION: 500,
        FADE_OUT_DURATION: 400,

        // 점멸 애니메이션
        BLINK_INTERVAL: 1200,
        BLINK_MIN_ALPHA: 0.3,
        BLINK_MAX_ALPHA: 0.9,
    },

    // ============================================
    // Dialogue Box
    // ============================================
    DIALOGUE: {
        FADE_IN_DURATION: 250,
        FADE_OUT_DURATION: 200,
        TYPING_SPEED: 30, // ms per character
    },

    // ============================================
    // General Transitions
    // ============================================
    TRANSITION: {
        DEFAULT_DURATION: 300,
        FAST_DURATION: 150,
        SLOW_DURATION: 500,
    },

    // ============================================
    // Story System Controls (Skip / Auto)
    // ============================================
    STORY_CONTROLS: {
        // Skip: hold-to-trigger (>= 1s)
        SKIP_HOLD_MS: 1000,
        // Release animation: ring drains back
        SKIP_RELEASE_RETURN_MS: 220,
        // Skip visual scale (slight pop)
        SKIP_SCALE_MAX: 1.08,

        // Auto: after typing completes (waiting state)
        AUTO_WAIT_DELAY_MS: 1200,

        // Fast-forward: short wait between lines
        FAST_FORWARD_WAIT_DELAY_MS: 150,
    },

    // ============================================
    // Tactical View (Hologram System) - Phase 2+
    // ============================================
    HOLOGRAM: {
        // Glow intensity for selected node halo / path
        GLOW_INTENSITY: 0.9,
        GLOW_BLUR_KERNEL: 24,

        // Arcana path draw feel
        PATH_DRAW_MS_PER_SEGMENT: 220,
        PATH_SPARK_BURST_MS: 220,

        // Particle (Cyan spark) along path
        PATH_PARTICLE_EMIT_RATE: 700,
        PATH_PARTICLE_MIN_SIZE: 0.06,
        PATH_PARTICLE_MAX_SIZE: 0.12,
        PATH_PARTICLE_MIN_LIFE: 0.18,
        PATH_PARTICLE_MAX_LIFE: 0.35,
        PATH_PARTICLE_MIN_SPEED: 18,
        PATH_PARTICLE_MAX_SPEED: 34,
    },

    // ============================================
    // Easing (참조용 이름)
    // ============================================
    EASING: {
        OUT_QUAD: 'easeOutQuad',
        IN_OUT_QUAD: 'easeInOutQuad',
        LINEAR: 'linear',
    },
} as const;
