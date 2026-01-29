# Narrative Engine

> Skyline Blue: Arcana Vector - 독립 재사용 가능 대화 시스템

## 개요

Narrative Engine은 Babylon.js 기반의 대화 시스템입니다.
이 엔진은 다음 책임을 집니다:

- 나레이션 / 대사 시퀀스 관리
- 타이핑 연출 및 스킵 로직
- Animation Lock (typing / waiting 상태 전이)
- InteractionLayer를 통한 단일 입력 소비
- 로그 기반 상태 추적

## 디렉터리 구조

```
src/engines/narrative/
├── scenario/
│   └── ScenarioManager.ts    # 시나리오 재생 관리
├── ui/
│   ├── DialogueBox.ts        # 대화창 UI (타이핑 애니메이션)
│   └── InteractionLayer.ts   # 입력 수신 레이어
├── types.ts                  # Narrative 전용 타입 정의
├── index.ts                  # Facade (유일한 외부 진입점)
└── README.md                 # 본 문서

# 참고: Z_INDEX 상수는 `src/shared/design/ZIndex.ts`에 위치
# (Narrative Engine 전용이 아닌 전역 GUI 레이어 계약)
```

## 사용법

### 1. 엔진 생성

```typescript
import { NarrativeEngine, ScenarioSequence } from './engines/narrative';

// GUI 레이어를 제공하여 엔진 생성
const narrativeEngine = new NarrativeEngine(
    guiManager.getInteractionLayer(),  // 입력 레이어
    guiManager.getDisplayLayer()       // 표시 레이어
);
```

### 2. 콜백 설정

```typescript
narrativeEngine.setCallbacks({
    onSequenceEnd: () => {
        console.log('시퀀스 종료');
    },
    onEvent: (eventName) => {
        console.log(`이벤트 발생: ${eventName}`);
    },
});
```

### 3. 시나리오 시작

```typescript
const mySequence: ScenarioSequence = {
    id: 'intro',
    name: 'Introduction',
    steps: [
        { type: 'narration', text: '어느 여름날...' },
        { type: 'dialogue', speaker: '소녀', text: '안녕하세요!' },
        { type: 'auto', text: '...', duration: 1500 },
        { type: 'event', event: 'INTRO_END' },
    ],
};

narrativeEngine.startNarrative(mySequence);
```

### 4. 상태 확인

```typescript
if (narrativeEngine.isPlaying()) {
    console.log('현재 재생 중');
}
```

## 사용 규칙

### 허용

```typescript
// Facade를 통한 import
import { NarrativeEngine, ScenarioSequence } from './engines/narrative';

// 공개 API 사용
narrativeEngine.startNarrative(sequence);
narrativeEngine.isPlaying();
narrativeEngine.setCallbacks(callbacks);
```

### 금지

```typescript
// 내부 모듈 직접 import - 절대 금지!
import { ScenarioManager } from './engines/narrative/scenario/ScenarioManager';
import { DialogueBox } from './engines/narrative/ui/DialogueBox';
```

## Step 타입

| 타입 | 입력 처리 | 자동 진행 | 설명 |
|------|----------|----------|------|
| `narration` | 타이핑 중: skip / 완료 후: advance | 없음 | 화자 없는 서술 |
| `dialogue` | 타이핑 중: skip / 완료 후: advance | 없음 | 화자 있는 대사 |
| `auto` | 클릭 시 skip | duration 후 | 자동 진행 연출 |
| `event` | 무시 | 즉시 | 시스템 이벤트 |

## Animation Lock

클릭 시 동작은 현재 상태에 따라 결정됩니다:

```
상태: typing  → 클릭 시 skipTyping()
상태: waiting → 클릭 시 advanceStep()
상태: auto    → 클릭 시 cancel + advanceStep()
상태: idle    → 무시
```

## 모듈 분리 원칙

이 엔진은 게임 로직이나 씬 구성과 완전히 분리되어 있습니다.
`src/engines/narrative/` 디렉터리를 그대로 복사하면 다른 프로젝트에서도 사용 가능합니다.

외부 의존성:
- `@babylonjs/core` (BABYLON 엔진)
- `@babylonjs/gui` (GUI 시스템)

엔진 내부 구성요소는 외부에서 접근 불가하며,
오직 `NarrativeEngine` 클래스를 통해서만 제어할 수 있습니다.
