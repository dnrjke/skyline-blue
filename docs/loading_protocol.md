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

## 디렉터리 구조

```
src/core/loading/
├── protocol/
│   ├── LoadingPhase.ts          # Phase enum
│   ├── LoadingResult.ts         # 결과 타입 + onAfterReady hook
│   └── SceneLoaderProtocol.ts   # 추상 인터페이스 + BaseSceneLoader
├── barrier/
│   └── RenderReadyBarrier.ts    # 첫 프레임 검증 (Camera validation + RETRY)
├── warmup/
│   └── MaterialWarmupHelper.ts  # Material 사전 컴파일 래퍼
└── index.ts

src/engines/navigation/loading/
├── NavigationDataLoader.ts      # 순수 데이터 fetch (FETCHING phase)
├── NavigationSceneLoader.ts     # Full loader 편의 래퍼
└── index.ts

src/engines/flight/loading/      # (미래 확장)
├── FlightDataLoader.ts          # Flight 전용 데이터 fetch
├── FlightSceneLoader.ts         # Flight 전용 full loader
└── index.ts
```

---

## 2-Stage Loading Architecture

### Stage 1: DataLoader (순수 데이터 fetch)

```typescript
// NavigationDataLoader - FETCHING phase만 담당
const dataLoader = new NavigationDataLoader(scene);
const result = await dataLoader.fetchAndApply(stage, graph);
// result.environment, result.timings 등 반환
```

### Stage 2: Scene 조율 (BUILDING, WARMING, BARRIER)

```typescript
// NavigationScene이 직접 primitives 조합
this.setPhase(LoadingPhase.BUILDING);
this.visualizer.build();
this.linkNetwork.build();

this.setPhase(LoadingPhase.WARMING);
await this.warmupHelper.warmupNavigationMaterials();

this.setPhase(LoadingPhase.BARRIER);
await this.barrier.waitForFirstFrame({ ... });

this.setPhase(LoadingPhase.READY);
```

---

## RenderReadyBarrier 검증 항목

```typescript
interface BarrierValidation {
  requiredMeshNames?: string[];      // 필수 메시 이름
  minActiveMeshCount?: number;       // 최소 active mesh 수 (기본: 1)
  maxRetryFrames?: number;           // 최대 재시도 프레임 수 (기본: 10)
  requireCameraRender?: boolean;     // 카메라 검증 (기본: true)
}
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
  // === FETCHING ===
  this.setPhase(LoadingPhase.FETCHING);
  const data = await this.dataLoader.fetchAndApply(stage);

  // === BUILDING ===
  this.setPhase(LoadingPhase.BUILDING);
  this.setupFlightCamera();
  this.attachCharacterModel(data.characterModel);
  this.setupSkybox(data.skybox);

  // === WARMING ===
  this.setPhase(LoadingPhase.WARMING);
  await this.warmupHelper.warmupFlightMaterials();
  // Trail, Afterimage 등 Flight 전용 Material

  // === BARRIER ===
  this.setPhase(LoadingPhase.BARRIER);
  await this.barrier.waitForFirstFrame({
    requiredMeshNames: ['__FlightCharacter__', '__FlightSkybox__'],
    minActiveMeshCount: 3,
  });

  // === READY ===
  this.setPhase(LoadingPhase.READY);
  // 입력 활성화, 비행 시작
}
```

### 3. Flight 전용 Material Warmup

```typescript
// MaterialWarmupHelper 확장
async warmupFlightMaterials(): Promise<void> {
  await this.warmup({
    materials: [
      (s) => createTrailMaterial(s),
      (s) => createAfterImageMaterial(s),
      (s) => createSkyboxMaterial(s),
    ],
    useUtilityLayer: true,
  });
}
```

---

## Navigation → Flight 전환

```typescript
// FlowController 또는 상위 관리자
async transitionToFlight(flightCurve: BABYLON.Curve3): Promise<void> {
  // 1. Navigation 종료
  this.navigationScene.stop();

  // 2. Flight 로딩 시작 (새 로딩 프로토콜)
  this.flightScene.start({
    curve: flightCurve,
    onPhaseChange: (phase) => this.overlay.setPhase(phase),
    onReady: () => {
      // Flight READY 후에만 입력 활성화
      this.flightScene.beginFlight();
    },
  });
}
```

---

## Babylon.js 8.x 규칙 정합성

| Babylon 8.x 규칙 | Loading Protocol 대응 |
|------------------|----------------------|
| Dynamic Mesh는 Pipeline에서 탈락 가능 | BARRIER에서 active mesh 검증 |
| Material not ready → 즉시 탈락 | WARMING에서 `forceCompilationAsync` |
| UtilityLayer 필수 (Effect용) | MaterialWarmupHelper가 UtilityScene 사용 |
| 첫 프레임 검증 필수 | `RenderReadyBarrier.waitForFirstFrame()` |

---

## 체크리스트

### 새 Scene 추가 시
- [ ] `{Scene}DataLoader` 생성 (FETCHING 담당)
- [ ] Scene 내 startAsync에서 Phase별 조율
- [ ] MaterialWarmupHelper에 Scene 전용 warmup 메서드 추가
- [ ] RenderReadyBarrier 검증 조건 정의 (requiredMeshNames 등)
- [ ] docs/loading_protocol.md 업데이트

### 로딩 이슈 디버깅 시
1. Phase 로그 확인: `[{Scene}] Phase: {PHASE}`
2. Barrier 로그 확인: `[RenderReadyBarrier] {SUCCESS|RETRY|FATAL}`
3. Active mesh 수 확인
4. Camera validation 결과 확인
