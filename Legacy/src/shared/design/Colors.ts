/**
 * Colors - 메인 테마 컬러 시스템
 *
 * arcana_ui_rules.md §3.1: 모든 색상은 src/shared/design/에서 관리
 * Magic-Number Zero 원칙 준수
 */

export const COLORS = {
    // ============================================
    // Primary Theme
    // ============================================
    PRIMARY_BLUE: '#0a1628',
    PRIMARY_DARK: '#0a0a1a',
    PRIMARY_BLACK: '#000000',

    // ============================================
    // Text Colors
    // ============================================
    TEXT_WHITE: '#FFFFFF',
    TEXT_GOLD: '#FFD700',
    TEXT_MUTED: 'rgba(255, 255, 255, 0.7)',
    TEXT_HINT: 'rgba(255, 255, 255, 0.6)',
    TEXT_SUBTITLE: 'rgba(200, 220, 255, 0.8)',

    // ============================================
    // UI Elements
    // ============================================
    DIALOGUE_BG: 'rgba(0, 0, 0, 0.8)',
    DIALOGUE_BORDER: 'rgba(255, 255, 255, 0.3)',
    CHARACTER_PLACEHOLDER: 'rgba(100, 100, 150, 0.4)',
    CHARACTER_BORDER: 'rgba(255, 255, 255, 0.3)',

    // Bottom vignette base
    VIGNETTE_BLACK: '#000000',

    // ============================================
    // Backgrounds
    // ============================================
    BG_DEFAULT: '#000000',
    BG_SPLASH: '#000000',
    BG_TITLE: '#0a1628',
    BG_SCENE_BEACH: '#87CEEB',
    BG_SCENE_CLUBROOM: '#2F4F4F',
    BG_SCENE_NIGHT: '#0a0a1a',

    // ============================================
    // Interactive (HEBS Alpha 0.01 Rule)
    // ============================================
    TOUCH_AREA: 'black',
    TOUCH_AREA_ALPHA: 0.01,

    // ============================================
    // System Controls (Skip / Auto)
    // ============================================
    SYSTEM_BTN_BG: 'rgba(0, 0, 0, 0.35)',
    SYSTEM_BTN_BG_ACTIVE: 'rgba(40, 160, 255, 0.55)',
    SYSTEM_BTN_BORDER: 'rgba(255, 255, 255, 0.35)',
    SYSTEM_BTN_TEXT_MUTED: 'rgba(255, 255, 255, 0.8)',
    SYSTEM_ACCENT: '#33C3FF',

    // ============================================
    // Tactical View (Hologram System) - Phase 2+
    // ============================================
    HUD_NEON: '#00E5FF', // Cyan
    HUD_CORE: '#FFFFFF', // White
    HUD_BG: 'rgba(0, 0, 0, 0.85)',
    HUD_GRID: 'rgba(0, 229, 255, 0.2)',
    HUD_GRID_ACCENT: 'rgba(0, 229, 255, 0.5)',
    HUD_WARNING: 'rgba(255, 80, 80, 0.95)',
} as const;
