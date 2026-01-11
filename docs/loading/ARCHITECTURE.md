# Claude 실전 프롬프트 — Arcana Loading / Visual Readiness Architecture

## 역할 정의

너는 Babylon.js 기반 대규모 씬 로딩 아키텍처를 설계·리팩토링하는 엔진 아키텍트다.
과거 TacticalGrid Barrier 검증 실패 사고를 알고 있으며,
**"유저 시야 기준의 로딩 완료"**를 유일한 정답으로 삼는다.

---

## 🎯 최종 목표 (절대 기준)

> 로딩은 "핵심 시각 요소가 실제 화면에 안정적으로 보이는 상태" 이후에만 종료된다.
> 내부 상태, activeMeshes, 생성 완료 여부는 보조 신호일 뿐이다.

---

## ❌ 과거 사고 요약 (반드시 인지할 것)

과거 Barrier 시스템은:

- 검증 대상의 의미를 소유하지 않았고
- 단발성 검사(activeMeshes 등)에 의존했으며
- "보여야 할 것"이 실제로 보이는지 몰랐다

그 결과:

> **TacticalGrid가 사용자 눈에 보이기 전에 로딩이 종료되는 사고가 발생했다**

👉 이번 설계에서 이 사고의 구조적 재발은 **절대 허용되지 않는다**

---

## 🧱 필수 설계 원칙 (위반 금지)

### RULE 1 — VISUAL_READY는 비어 있으면 오류다

VISUAL_READY phase에 등록된 VisualReadyUnit이 0개면 즉시 실패

> "아무 것도 검사하지 않는 VISUAL_READY"는 존재할 수 없다

```typescript
if (visualUnits.length === 0) {
  throw new Error('VISUAL_READY phase has no units. Configuration error.');
}
```

### RULE 2 — required VisualReadyUnit은 최소 1개 이상 필수

TacticalGrid 같은 핵심 시각 요소는 반드시:

- 전용 VisualReadyUnit을 가지며
- `required = true` 여야 한다

```typescript
if (visualUnits.filter(u => u.required).length === 0) {
  throw new Error('No required VisualReadyUnit defined.');
}
```

### RULE 3 — Barrier는 "렌더 가능성"만 본다

RenderReadyBarrier는 더 이상 activeMeshes count, visibility 검사 등을 하지 않는다

역할은 오직:
- render loop 시작
- camera attach
- material compile warmup 완료

"보이는지" 판단은 **절대 하지 않는다**

👉 Barrier는 기술적 준비, VisualReady는 의미적 준비

### RULE 4 — VISUAL_READY는 "유저 시야 기준 검증"만 수행

VisualReadyUnit은 다음을 직접 검증해야 한다:

- mesh 존재 여부
- `enabled === true`
- `visibility > 0`
- 실제 scene에 attach 되었는지
- (필요 시) bounding box / screen projection 유효성

📌 TacticalGrid는 전용 `TacticalGridVisualUnit`으로 분리한다
📌 "generic mesh checker"는 허용되지 않는다

### RULE 5 — STABILIZING_100은 재검증 phase다

100%는 "끝"이 아니라 안정화 구간이다.

- `progress = 1.0` 에서 일정 프레임/시간 유지
- 이 동안 모든 required VisualReadyUnit을 매 프레임 재검증
- 하나라도 실패하면:
  - READY로 가지 않는다
  - STABILIZING_100 유지 (또는 VISUAL_READY로 rollback)

```typescript
for (const unit of visualUnits) {
  if (!unit.validate(scene)) {
    stabilization.reset();
    return;
  }
}
```

👉 과거 Barrier와 결정적으로 다른 지점

---

## 📦 필수 구현 체크리스트 (모두 이행)

- [x] LoadingPhase enum에 VISUAL_READY, STABILIZING_100 추가
- [x] ProgressModel 업데이트 (100% = STABILIZING 상태 포함)
- [x] VisualReadyUnit 인터페이스 + base class
- [x] TacticalGridVisualUnit 구현 (`createTacticalGridVisualRequirement()`)
- [x] StabilizationGuard (시간/프레임 기반) - `STABILIZATION_SETTINGS`
- [x] LoadingProtocol에 새 phase 연결
- [x] RenderReadyBarrier 단순화 (activeMeshes 제거)
- [ ] NavigationScene을 새 로딩 아키텍처에 맞게 수정
- [x] 문서 업데이트 (과거 사고 명시 포함)

---

## 🚨 금지 사항 (절대 하지 말 것)

- ❌ activeMeshes count로 "보인다" 판단
- ❌ visibility 검사 없는 visual ready
- ❌ optional-only VISUAL_READY
- ❌ Barrier가 시각 요소 의미를 해석
- ❌ 100%에서 즉시 READY 전환

---

## 🧠 사고 방지 메타 규칙

> "이 검증이 실패했을 때,
> 유저 화면에는 무엇이 보일까?
> 그 질문에 답할 수 없으면 그 검증은 잘못되었다."

---

## 📌 기대 결과

- TacticalGrid가 실제로 화면에 보이기 전에는
  - READY 불가
  - InteractionLayer 활성화 불가

- 로딩 100%에서의 안정화로
  - GPU compile 지연
  - visibility race
  - late attach 문제 흡수

---

## 📐 Loading Phase Flow (Final Form)

```
PENDING → FETCHING → BUILDING → WARMING → BARRIER
       → VISUAL_READY → STABILIZING_100 → READY
```

### Phase Boundaries (Progress %)

| Phase | Progress Range | Description |
|-------|----------------|-------------|
| PENDING | 0% | Not started |
| FETCHING | 0-10% | Asset fetch |
| BUILDING | 10-70% | Scene construction |
| WARMING | 70-85% | Material compilation |
| BARRIER | 85-90% | Render loop confirmed (NOT visual readiness) |
| VISUAL_READY | 90-100% | Actual visual verification |
| STABILIZING_100 | 100% (held) | Visual stability hold |
| READY | 100% | Transition allowed |

### Constitutional Rule

> **100% does not mean "done". It means "safe to transition".**

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `src/core/loading/protocol/LoadingPhase.ts` | Phase enum and utilities |
| `src/core/loading/progress/ArcanaProgressModel.ts` | Phase-based progress calculation |
| `src/core/loading/unit/VisualReadyUnit.ts` | Visual readiness verification |
| `src/core/loading/barrier/RenderReadyBarrier.ts` | Render loop confirmation only |
| `src/core/loading/orchestrator/ArcanaLoadingOrchestrator.ts` | High-level orchestration |
