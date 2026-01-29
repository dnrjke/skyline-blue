/**
 * Typography - 폰트 시스템
 *
 * arcana_ui_rules.md §3.1: 폰트 크기, 자간, Weight 관리
 * 1080px 기준 Pixel-Perfect 규격
 */

export const FONT = {
    // ============================================
    // Font Families
    // ============================================
    FAMILY: {
        TITLE: 'Georgia, serif',
        BODY: 'Arial, sans-serif',
        MONOSPACE: 'Consolas, monospace',
    },

    // ============================================
    // Font Sizes (1080px 기준)
    // ============================================
    SIZE: {
        /** Splash 메인 타이틀 */
        SPLASH_TITLE: 72,

        /** Splash 서브 타이틀 */
        SPLASH_SUBTITLE: 36,

        /** Touch-to-Start 타이틀 */
        START_TITLE: 80,

        /** Touch-to-Start 서브 타이틀 */
        START_SUBTITLE: 32,

        /** Touch-to-Start 안내문 */
        START_PROMPT: 40,

        /** 대화창 화자 이름 */
        DIALOGUE_SPEAKER: 28,

        /** 대화창 본문 */
        DIALOGUE_TEXT: 26,

        /** 캐릭터 라벨 (디버그) */
        CHARACTER_LABEL: 20,

        /** 시스템 버튼(AUTO/SKIP) */
        SYSTEM_BUTTON: 22,
    },

    // ============================================
    // Font Weights
    // ============================================
    WEIGHT: {
        NORMAL: 'normal',
        BOLD: 'bold',
    },

    // ============================================
    // Line Spacing
    // ============================================
    LINE_SPACING: {
        DIALOGUE: '8px',
    },
} as const;
