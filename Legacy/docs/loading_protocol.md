# Arcana Loading Protocol

> Babylon.js 8.x 렌더링 특성을 반영한 "엔진 기준 로딩" 프로토콜

## 핵심 원칙

**"로딩 완료 = 렌더링 가능"**

- Asset load 완료 ≠ 렌더링 가능
- Material compile 완료 ≠ 렌더링 가능
- **오직 첫 프레임 렌더 검증 후에만 READY**

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Loading Protocol                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐   │
│  │ AssetResolver│───▶│ DataLoader   │───▶│ RenderReadyBarrier   │   │
│  │ (경로만 제공) │    │ (데이터 fetch)│    │ (첫 프레임 검증)      │   │
│  └──────────────┘    └──────────────┘    └──────────────────────┘   │
│                             │                       │                │
│                             ▼                       ▼                │
│                    ┌──────────────┐    ┌──────────────────────┐     │
│                    │MaterialWarmup│    │ onAfterRender        │     │
│                    │(forceCompile)│    │ (1-shot validation)  │     │
│                    └──────────────┘    └──────────────────────┘     │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     Loading Phases                             │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐   │  │
│  │  │PENDING │─▶│FETCHING│─▶│BUILDING│─▶│WARMING │─▶│BARRIER │   │  │
│  │  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘   │  │
│  │                                              │        │        │  │
│  │                                              ▼        ▼        │  │
│  │                                         ┌────────┐ ┌──────┐    │  │
│  │                                         │ READY  │ │FAILED│    │  │
│  │                                         └────────┘ └──────┘    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 정의

| Phase | 설명 | 주요 작업 |
|-------|------|----------|
| `PENDING` | 로딩 시작 전 | - |
| `FETCHING` | Asset fetch | JSON, GLB, Texture 다운로드 |
| `BUILDING` | 구조 구축 | Mesh/Graph 빌드, Octree 생성 |
| `WARMING` | Material 준비 | `forceCompilationAsync` 실행 |
| `BARRIER` | 렌더 검증 | 첫 프레임 렌더 대기 및 검증 |
| `READY` | 완료 | 게임 진입 가능 |
| `FAILED` | 실패 | 복구 불가 오류 |

---

## Arcana Evidence Model (Constitutional Redesign)

> Phase 2.5에서 확립된 Barrier 검증의 헌법적 원칙

### NON-NEGOTIABLE PRINCIPLES

```
1. TacticalGrid는 가장 시각적으로 지배적인 자산이다.
   → Barrier 표준을 정의하는 것은 TacticalGrid이지, 그 반대가 아니다.

2. visibility = 0은 의도적 설계 선택이다 (fade-in 애니메이션).
   → Zero visibility는 실패가 아니다.

3. Barrier는 "렌더링 준비 완료"를 검증해야지, "현재 렌더링 중"을 검증하면 안 된다.
   → Construction readiness ≠ Presentation state

4. Barrier 실패는 "진짜 논리적 불가능"을 의미해야 한다.
   → "엔진이 아직 따라오지 못함"이 아님
```

### Evidence Types

| Evidence Type | 설명 | 검증 항목 | 사용 사례 |
|---------------|------|----------|----------|
| `ACTIVE_MESH` | activeMeshes 포함 | Babylon frustum culling | 일반 Mesh |
| `VISIBLE_MESH` | 가시성 검증 (레거시) | visibility > 0 필수 | 즉시 보여야 하는 메시 |
| `RENDER_READY` | 생성 완료 검증 | **visibility 무시** | TacticalGrid 등 fade-in 메시 |
| `CUSTOM` | 커스텀 predicate | 도메인 로직 | 특수 조건 |

### RENDER_READY vs VISIBLE_MESH

```
┌────────────────────────────────────────────────────────────────────┐
│                     RENDER_READY (권장)                             │
├────────────────────────────────────────────────────────────────────┤
│ 질문: "이 메시가 visibility > 0이 되면 렌더링될 수 있는가?"          │
│                                                                     │
│ [검증 O]                    │ [검증 X]                              │
│ ✓ mesh 존재                 │ ✗ visibility                          │
│ ✓ dispose 안 됨             │ ✗ isVisible                           │
│ ✓ scene에 등록됨            │ ✗ alpha / material opacity            │
│ ✓ geometry 있음 (vertices)  │ ✗ activeMeshes 포함 여부              │
│                             │ ✗ isEnabled (presentation choice)     │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                     VISIBLE_MESH (레거시)                           │
├────────────────────────────────────────────────────────────────────┤
│ 질문: "이 메시가 현재 보이는가?"                                     │
│                                                                     │
│ [검증 O]                                                            │
│ ✓ mesh 존재, dispose 안 됨, scene 등록                              │
│ ✓ visibility > 0 (필수)                                             │
│ ✓ isEnabled = true                                                  │
│ ✓ layerMask 카메라 일치                                             │
└────────────────────────────────────────────────────────────────────┘
```

### TacticalGrid가 RENDER_READY를 사용하는 이유

```typescript
// TacticalGrid 로딩 흐름
hologram.enable();           // mesh 생성
hologram.setVisibility(0);   // 의도적으로 0 (fade-in 대기)
// ... BARRIER 검증 ...
// ... 진입 후 fade-in 시작 ...
hologram.setVisibility(1);   // 사용자에게 보임

// VISIBLE_MESH를 사용하면?
// → visibility = 0이므로 "Visibility is 0" 에러로 실패
// → 이것은 CATEGORY ERROR: 의도적 상태를 실패로 판정

// RENDER_READY를 사용하면?
// → visibility 무시, 생성 완료만 확인
// → "visibility > 0이 되는 순간 렌더링된다" 증명
// → 올바른 Barrier 통과
```

---

## RenderReadyBarrier 검증 항목

```typescript
interface BarrierValidation {
  // 레거시: ACTIVE_MESH 증거로 변환됨
  requiredMeshNames?: string[];

  // 새로운 증거 기반 검증 (권장)
  requirements?: BarrierRequirement[];

  minActiveMeshCount?: number;       // 최소 active mesh 수 (기본: 1)
  maxRetryFrames?: number;           // 최대 재시도 프레임 수 (기본: 10)
  requireCameraRender?: boolean;     // 카메라 검증 (기본: true)
}

interface BarrierRequirement {
  id: string;                        // 식별자 (보통 메시 이름)
  evidence: BarrierEvidence;         // 증거 유형
  predicate?: (scene: Scene) => boolean;  // 커스텀 검증
}

type BarrierEvidence = 'ACTIVE_MESH' | 'VISIBLE_MESH' | 'RENDER_READY' | 'CUSTOM';
```

### Camera Validation
- `activeCamera` 존재 여부
- `position`이 유효한 Vector3인지
- `getViewMatrix()` 결과가 유효한지

### Barrier Result
```typescript
enum BarrierResult {
  SUCCESS,       // 검증 성공
  RETRY,         // 재시도 필요 (아직 준비 안 됨)
  FATAL_FAILURE, // 치명적 실패 (복구 불가)
}
```

---

## 디렉터리 구조

```
src/core/loading/
├── protocol/
│   ├── LoadingPhase.ts          # Phase enum
│   ├── LoadingResult.ts         # 결과 타입 + onAfterReady hook
│   └── SceneLoaderProtocol.ts   # 추상 인터페이스 + BaseSceneLoader
├── barrier/
│   └── RenderReadyBarrier.ts    # 첫 프레임 검증 (Evidence Model)
├── warmup/
│   └── MaterialWarmupHelper.ts  # Material 사전 컴파일 래퍼
├── unit/
│   ├── LoadUnit.ts              # LoadUnit 인터페이스
│   ├── LoadingRegistry.ts       # LoadUnit 등록/관리
│   ├── LoadingProtocol.ts       # Phase별 LoadUnit 실행
│   ├── MaterialWarmupUnit.ts    # Material warmup as LoadUnit
│   └── RenderReadyBarrierUnit.ts # Barrier as LoadUnit
├── progress/
│   ├── ArcanaProgressModel.ts   # Phase 기반 진행률
│   └── LoadingStateEmitter.ts   # 반응형 상태 이벤트
├── orchestrator/
│   └── ArcanaLoadingOrchestrator.ts  # 통합 오케스트레이터
└── index.ts

src/engines/navigation/loading/
├── units/
│   ├── DataFetchUnit.ts         # FETCHING: 데이터 로드
│   ├── EnvironmentUnit.ts       # FETCHING: 환경 로드
│   ├── TacticalGridUnit.ts      # BUILDING: 그리드 생성
│   ├── GraphVisualizerUnit.ts   # BUILDING: 그래프 시각화
│   ├── LinkNetworkUnit.ts       # BUILDING: 링크 네트워크
│   └── OctreeUnit.ts            # BUILDING: 공간 분할
├── NavigationDataLoader.ts      # 레거시 데이터 fetch
└── index.ts
```

---

## LoadUnit 아키텍처

### Phase별 validate() 원칙

```
┌────────────────────────────────────────────────────────────────────┐
│                    validate() 책임 분리                             │
├────────────────────────────────────────────────────────────────────┤
│ FETCHING / BUILDING / WARMING:                                      │
│   validate() = "생성되었는가?"                                       │
│   ✓ 객체 존재                                                       │
│   ✓ dispose 안 됨                                                   │
│   ✓ scene에 등록됨                                                  │
│   ✗ 렌더링 가시성 (NO!)                                             │
│                                                                     │
│ BARRIER:                                                            │
│   validate() = "렌더링 준비 완료인가?"                               │
│   → RenderReadyBarrier가 Evidence 기반으로 검증                     │
│   → visibility = 0 허용 (RENDER_READY)                              │
└────────────────────────────────────────────────────────────────────┘
```

### 예시: TacticalGridUnit

```typescript
// TacticalGridUnit.ts
class TacticalGridUnit extends BaseLoadUnit {
  readonly phase = LoadingPhase.BUILDING;

  async load(scene: Scene): Promise<void> {
    this.config.hologram.enable();
    this.config.hologram.setVisibility(0);  // 의도적 0
  }

  validate(_scene: Scene): boolean {
    // "생성되었는가?"만 확인 - visibility 무시
    return this.config.hologram.isCreated();
  }
}

// NavigationScene.ts - Barrier 설정
RenderReadyBarrierUnit.createForNavigation({
  requirements: [{
    id: 'TacticalGrid',
    evidence: 'RENDER_READY',  // visibility 무시
  }],
})
```

---

## NavigationScene 로딩 흐름

```typescript
private async startAsync(): Promise<void> {
  // === LoadUnit 등록 ===
  this.orchestrator.registerAll([
    // FETCHING
    new DataFetchUnit({ ... }),
    new EnvironmentUnit({ ... }),

    // BUILDING
    new TacticalGridUnit({ hologram: this.hologram }),
    new GraphVisualizerUnit({ ... }),
    new LinkNetworkUnit({ ... }),
    new OctreeUnit(),

    // WARMING
    MaterialWarmupUnit.createNavigationWarmupUnit(),

    // BARRIER
    RenderReadyBarrierUnit.createForNavigation({
      requirements: [{
        id: 'TacticalGrid',
        evidence: 'RENDER_READY',  // visibility = 0 허용
      }],
    }),
  ]);

  // === 실행 ===
  await this.orchestrator.execute({
    onReady: () => {
      this.cameraController.transitionIn(...);
      this.inputLocked = false;
    },
  });
}
```

---

## FlightScene 확장 가이드

### 1. FlightDataLoader 생성

```typescript
// src/engines/flight/loading/FlightDataLoader.ts
export class FlightDataLoader {
  async fetchAndApply(
    stage: FlightStageKey,
    callbacks?: DataLoaderCallbacks
  ): Promise<FlightDataResult> {
    // 1. Flight path 데이터 fetch
    // 2. Character model fetch
    // 3. Skybox/HDR 환경 fetch
    return { ... };
  }
}
```

### 2. FlightScene 로딩 흐름

```typescript
// src/engines/flight/scene/FlightScene.ts
private async startAsync(): Promise<void> {
  this.orchestrator.registerAll([
    // FETCHING
    new FlightDataFetchUnit({ ... }),

    // BUILDING
    new CharacterModelUnit({ ... }),
    new SkyboxUnit({ ... }),

    // WARMING
    MaterialWarmupUnit.createFlightWarmupUnit(),

    // BARRIER
    RenderReadyBarrierUnit.createForFlight({
      requirements: [
        { id: '__FlightCharacter__', evidence: 'RENDER_READY' },
        { id: '__FlightSkybox__', evidence: 'ACTIVE_MESH' },
      ],
    }),
  ]);

  await this.orchestrator.execute({ ... });
}
```

---

## Babylon.js 8.x 규칙 정합성

| Babylon 8.x 규칙 | Loading Protocol 대응 |
|------------------|----------------------|
| Dynamic Mesh는 Pipeline에서 탈락 가능 | BARRIER에서 Evidence 기반 검증 |
| Material not ready → 즉시 탈락 | WARMING에서 `forceCompilationAsync` |
| UtilityLayer 필수 (Effect용) | MaterialWarmupHelper가 UtilityScene 사용 |
| 첫 프레임 검증 필수 | `RenderReadyBarrier.waitForFirstFrame()` |
| LinesMesh는 activeMeshes 제외 | `RENDER_READY` evidence 사용 |

---

## 체크리스트

### 새 Scene 추가 시
- [ ] LoadUnit들 생성 (Phase별)
- [ ] MaterialWarmupUnit 설정
- [ ] RenderReadyBarrierUnit 설정 (적절한 evidence 선택)
- [ ] ArcanaLoadingOrchestrator로 조율
- [ ] docs/loading_protocol.md 업데이트

### Barrier Evidence 선택 가이드
- [ ] 일반 Mesh → `ACTIVE_MESH`
- [ ] 즉시 보여야 하는 LinesMesh → `VISIBLE_MESH`
- [ ] fade-in 애니메이션 있는 Mesh → `RENDER_READY`
- [ ] 특수 조건 → `CUSTOM` with predicate

### 로딩 이슈 디버깅 시
1. Phase 로그 확인: `[{Scene}] Phase: {PHASE}`
2. Barrier 로그 확인: `[RenderReadyBarrier] {SUCCESS|RETRY|FATAL}`
3. Evidence 타입 확인: `RENDER_READY` vs `VISIBLE_MESH`
4. **visibility = 0 실패 시**: `VISIBLE_MESH` → `RENDER_READY`로 변경

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-01-11 | Arcana Evidence Model 도입 (Constitutional Redesign) |
| | - `RENDER_READY` evidence type 추가 |
| | - visibility = 0 허용 (intentional fade-in) |
| | - TacticalGrid barrier 수정 |
