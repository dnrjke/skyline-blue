/**
 * Z_INDEX — Babylon GUI Global Layer Contract
 *
 * HEBS §1.1: Z_INDEX는 src/shared/design/에 단일 정의
 * 레이어 간 충돌 방지를 위해 100 단위 이상의 간격 유지
 *
 * 역할:
 *   Babylon GUI 전체에서 사용되는 레이어 순서 계약 상수
 *   모든 엔진(Narrative, Navigation 등) 및 앱 UI가 이 상수를 참조
 *
 * 소유 범위:
 *   - 특정 엔진에 종속되지 않음
 *   - shared/design에 위치하여 엔진 간 공유 인프라로 사용
 */

export const Z_INDEX = {
    /** 입력 수신 레이어 (가장 낮음, 클릭/터치 캡처) */
    INTERACTION: 100,

    /** 시각 요소 레이어 (대화창, 캐릭터 스탠딩) */
    DISPLAY: 500,

    /** 이펙트 오버레이 레이어 */
    EFFECT: 800,

    /** 시스템 UI 레이어 (팝업, 설정) */
    SYSTEM: 1000,

    /** 스킵/페이드 레이어 (가장 높음) */
    SKIP: 1100,
} as const;

export type ZIndexValue = (typeof Z_INDEX)[keyof typeof Z_INDEX];
