/**
 * Intro Story - Phase 1.1
 *
 * 해변 오프닝 + 부실 전경 시퀀스.
 * 사키 스타일: 일상물처럼 시작하되, 캐릭터의 내면과 결의가 드러나는 연출.
 *
 * 캐릭터 별명 규칙:
 * - 실제 이름 대신 특성 기반 별명 사용
 * - '창백한 소녀' = 흡혈귀 에이스 (창백한 피부, 밤의 비행)
 * - '햇살 부장' = 에어스포츠부 부장 (밝고 활기찬 성격)
 */

import { ScenarioSequence } from '../../../engines/narrative';

export const INTRO_STORY: ScenarioSequence = {
    id: 'intro',
    name: 'INTRO_SEQUENCE',
    steps: [
        // ========== SCENE 1: 해변 오프닝 ==========
        {
            type: 'event',
            event: 'CHANGE_BG',
            payload: { color: '#87CEEB' }, // 하늘색 (해변)
        },
        {
            type: 'narration',
            text: '(파도 소리가 들린다.)',
        },
        {
            type: 'narration',
            text: '(8월의 해변.\n뜨거운 햇살이 모래사장을 달군다.)',
        },
        {
            type: 'narration',
            text: '(하지만 그녀에게 이 계절은\n조금 다른 의미를 가진다.)',
        },

        // 창백한 소녀 등장
        {
            type: 'event',
            event: 'SHOW_CHARACTER',
            payload: { id: 'pale_girl', position: 'center' },
        },
        {
            type: 'dialogue',
            speaker: '창백한 소녀',
            text: '…….',
        },
        {
            type: 'narration',
            text: '(양산 아래, 창백한 소녀가 서 있다.\n햇빛을 피하듯, 그러나 하늘을 올려다보며.)',
        },
        {
            type: 'dialogue',
            speaker: '창백한 소녀',
            text: '오늘도… 비행하기엔 너무 밝아.',
        },
        {
            type: 'narration',
            text: '(그녀의 진심은 밤하늘에서만 펼쳐진다.\n낮의 비행은 언제나 엉성하고, 어딘가 빈틈이 있다.)',
        },

        // ========== SCENE 2: 부실 전경 ==========
        {
            type: 'event',
            event: 'HIDE_CHARACTER',
            payload: { id: 'pale_girl' },
        },
        {
            type: 'event',
            event: 'CHANGE_BG',
            payload: { color: '#2F4F4F' }, // 어두운 실내
        },
        {
            type: 'narration',
            text: '— 에어스포츠부 부실 —',
        },
        {
            type: 'narration',
            text: '(낡은 격납고를 개조한 부실.\n글라이더 부품과 정비 도구가 어지럽게 널려 있다.)',
        },

        // 햇살 부장 등장
        {
            type: 'event',
            event: 'SHOW_CHARACTER',
            payload: { id: 'sunny_captain', position: 'right' },
        },
        {
            type: 'dialogue',
            speaker: '햇살 부장',
            text: '자, 신입부원 여러분!\n오늘부터 에어스포츠부의 일원이야!',
        },
        {
            type: 'narration',
            text: '(활기찬 목소리가 부실에 울려 퍼진다.\n이 부장의 에너지는 대체 어디서 나오는 걸까.)',
        },
        {
            type: 'dialogue',
            speaker: '햇살 부장',
            text: '먼저 말해둘게.\n우리 부는 "직접 조종"을 안 해.',
        },
        {
            type: 'narration',
            text: '(신입부원들 사이에 웅성거림이 퍼진다.)',
        },
        {
            type: 'dialogue',
            speaker: '햇살 부장',
            text: '우리가 하는 건 "설계"야.\n바람을 읽고, 항로를 짜고, 논리를 만드는 거지.',
        },
        {
            type: 'dialogue',
            speaker: '햇살 부장',
            text: '그리고 그 논리대로 글라이더가 날아가는 걸…\n우린 그냥 "감상"해.',
        },

        // 창백한 소녀 등장 (부실 안)
        {
            type: 'event',
            event: 'SHOW_CHARACTER',
            payload: { id: 'pale_girl', position: 'left' },
        },
        {
            type: 'narration',
            text: '(부실 구석, 창백한 소녀가 조용히 서 있다.\n그녀의 시선은 창밖 하늘을 향해 있다.)',
        },
        {
            type: 'dialogue',
            speaker: '햇살 부장',
            text: '아, 그리고 저기 있는 애가 우리 부의 에이스야.\n…낮엔 좀 어수룩하지만.',
        },
        {
            type: 'dialogue',
            speaker: '창백한 소녀',
            text: '……밤이 되면, 달라져.',
        },
        {
            type: 'narration',
            text: '(작게 중얼거린 말.\n하지만 그 눈빛에는 확신이 있었다.)',
        },

        // ========== SCENE 3: 예고 ==========
        {
            type: 'event',
            event: 'HIDE_CHARACTER',
            payload: { id: 'sunny_captain' },
        },
        {
            type: 'event',
            event: 'HIDE_CHARACTER',
            payload: { id: 'pale_girl' },
        },
        {
            type: 'event',
            event: 'CHANGE_BG',
            payload: { color: '#0a0a1a' }, // 밤하늘
        },
        {
            type: 'narration',
            text: '(그리고 그날 밤—)',
        },
        {
            type: 'narration',
            text: '(스킵 성향의 플레이어조차\n끝까지 보게 만드는 비행이 시작된다.)',
        },
        {
            type: 'narration',
            text: '— To be continued —',
        },

        // 인트로 완료 이벤트 → Phase 1.1 완료
        {
            type: 'event',
            event: 'FLOW_COMPLETE',
            payload: { next: 'complete' },
        },
    ],
};
