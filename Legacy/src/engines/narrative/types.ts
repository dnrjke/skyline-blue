/**
 * Skyline Blue: Arcana Vector - Narrative Engine Type Definitions
 *
 * 100% Babylon.js Edition
 * 이 파일은 Narrative Engine 전용 타입만 정의합니다.
 */

// ============================================
// Scenario Step Types
// ============================================

/**
 * 시나리오의 각 단계(Step)를 정의하는 타입 유니온입니다.
 * 각 타입은 고유한 입력 처리 및 자동 진행 규칙을 가집니다.
 */
export type ScenarioStep =
    | NarrationStep
    | DialogueStep
    | AutoStep
    | EventStep;

/**
 * [narration]
 * - 의미: 화자 없이 화면 전체 또는 대화창에 출력되는 서술 텍스트입니다.
 * - 입력 규칙: 타이핑 중 클릭 시 skipTyping, 완료 후 클릭 시 다음 step으로 진행합니다.
 * - 자동 진행: 없음 (사용자 입력 필수).
 * - 주의사항: speaker 필드를 무시하며, 주로 배경 설명이나 심리 묘사에 사용합니다.
 */
export interface NarrationStep {
    type: 'narration';
    text: string;
}

/**
 * [dialogue]
 * - 의미: 특정 화자가 존재하는 대사 텍스트입니다.
 * - 입력 규칙: narration과 동일하게 타이핑 중 스킵, 완료 후 대기 기능을 가집니다.
 * - 자동 진행: 없음 (사용자 입력 필수).
 * - 주의사항: speaker 필드 사용이 권장되며, 대화창의 이름표(NameTag)와 연동됩니다.
 */
export interface DialogueStep {
    type: 'dialogue';
    speaker: string;
    text: string;
}

/**
 * [auto]
 * - 의미: 유저의 입력 없이 설정된 시간(duration) 동안 유지되는 연출 단계입니다.
 * - 입력 규칙: 클릭 시 대기 시간을 취소하고 즉시 다음 step으로 강제 진행합니다.
 * - 자동 진행: duration(ms) 완료 후 자동으로 다음 step을 호출합니다.
 * - 주의사항: 선택지가 포함되거나 긴 텍스트가 필요한 단계에는 사용을 비권장합니다.
 */
export interface AutoStep {
    type: 'auto';
    text?: string;
    speaker?: string;
    duration: number;
}

/**
 * [event]
 * - 의미: UI 제어, 시스템 플래그 변경 등 내부 로직 실행을 위한 트리거 단계입니다.
 * - 입력 규칙: 유저 입력을 처리하지 않습니다.
 * - 자동 진행: 로직 실행 직후 즉시 다음 step으로 진행합니다.
 * - 주의사항: 시각적인 텍스트 출력을 지원하지 않으며 시스템 제어 전용입니다.
 */
export interface EventStep {
    type: 'event';
    event: string;
    payload?: unknown;
}

// ============================================
// Scenario Sequence
// ============================================

export interface ScenarioSequence {
    id: string;
    name: string;
    steps: ScenarioStep[];
}

// ============================================
// UI State Types
// ============================================

export type UIState = 'idle' | 'typing' | 'waiting' | 'auto';

// ============================================
// Callback Types
// ============================================

export interface NarrativeCallbacks {
    onSequenceEnd?: () => void;
    /** 이벤트 콜백 (eventName + payload) */
    onEvent?: (eventName: string, payload?: unknown) => void;
}
