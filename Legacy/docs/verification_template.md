# Verification Template (Babylon.js Edition)

> Claude 자가 검증 체크리스트

매 작업 완료 후 이 문서의 질문들에 대해 자가 점검을 실시한다.

---

## 1. Babylon GUI 계층 검증

### 1.1 zIndex 구조 확인
- [ ] `World` (Scene) 위에 `DisplayLayer` (zIndex 500)가 있는가?
- [ ] `SystemLayer` (zIndex 1000)가 `DisplayLayer`를 덮는가?
- [ ] `SkipButton` (zIndex 1100)이 최상단에서 항상 입력을 받을 수 있는가?

### 1.2 입력 차단 (Pointer Blocking)
- [ ] 시각적 연출용 UI(대화창 등)는 `isPointerBlocker = false`로 설정되었는가? (클릭 관통)
- [ ] 팝업이나 모달 창은 `isPointerBlocker = true`로 배경 클릭을 막았는가?
- [ ] `SystemLayer` 활성화 시 하위 레이어의 버튼이 눌리지 않는지 확인했는가?

---

## 2. 모바일/디바이스 호환성

### 2.1 뷰포트 및 리사이징
- [ ] `engine.resize()`가 윈도우 리사이즈 이벤트에 연결되어 있는가?
- [ ] 노치(Safe Area)를 고려하여 GUI 컨트롤에 `padding`이나 `margin`을 적용했는가?
- [ ] HTML/CSS 오버레이가 **단 하나도 없는가**? (Canvas Only)

### 2.2 터치 반응
- [ ] `scene.onPointerObservable`을 통해 입력이 처리되는가?
- [ ] 작은 버튼의 터치 영역을 충분히 확보했는가? (40px 이상 권장)

---

## 3. 핵심 장면 검증 (CORE SCENE)

**"흡혈귀 에이스의 진심 비행"에 영향을 주는 변경인가?**

- [ ] 이 요소가 '흡혈귀의 진심 비행'을 더 멋지게 만드는가?
- [ ] Babylon.js의 파티클이나 쉐이더가 연출을 보조하는가?
- [ ] YES → 구현
- [ ] NO → 보류 또는 삭제

---

## 4. 코드 품질 (Pure Babylon)

- [ ] `document.getElementById` 등 DOM 접근 코드가 없는가?
- [ ] UI 제어를 위해 `AdvancedDynamicTexture`를 사용했는가?
- [ ] 텍스처 메모리 해제(`dispose`)가 적절히 이루어지는가?

---

## 5. 자율성 및 의사결정 검증 (Halt & Report)

- [ ] 모호한 설계 지점에서 독단적으로 판단하지 않고 코치에게 질문했는가?
- [ ] 현재 Phase(단계)를 벗어난 오버엔지니어링을 하지 않았는가?
- [ ] 반복되는 패턴 발견 시 '엔지니어링/프레임워크화' 제안을 수행했는가?
- [ ] 판단이 필요한 경우 [Halt Report] 양식에 맞춰 옵션을 보고했는가?

---

## 6. 계층형 이벤트 차단 시스템 검증 (HEBS)

- [ ] 연출(타이핑, 페이드) 중 클릭 시 `advanceStep`이 아닌 `skipTyping`이 실행되는가?
- [ ] 팝업/선택지 활성 시 하위 레이어의 `isEnabled = false` 처리가 되었는가?
- [ ] 터치 감지 레이어(InteractionLayer)의 `alpha`가 0.01로 설정되었는가?
- [ ] 모든 시각적 요소(DialogueBox 등)의 `isHitTestVisible = false`를 확인했는가?

---

## [검증 보고 양식]

> **주의: 단순 Y/N은 반려 사유가 된다. 각 항목에 대해 구현된 로직이나 파일명을 근거로 제시하라.**

모든 작업을 마친 후, 아래 양식을 복사하여 보고하라:

[Verification Status]
- **작업 브랜치:** (예: `dev/reboot-phase1` - `main` 브랜치 격리 준수 확인)
- **참조 문서:** `CLAUDE.md`, `docs/arcana_ui_rules.md`
- **HEBS(계층형 차단) 구현 근거:**
    - [ ] 시각 요소(DialogueBox 등) `isHitTestVisible = false` 적용 여부: (예: `UIConfigs.ts`에서 일괄 적용됨)
    - [ ] `InteractionLayer`의 Alpha 0.01 설정 및 클릭 관통 확인: (근거 요약)
- **Animation Lock(연출 중 입력제어) 검증:**
    - [ ] 타이핑/연출 중 클릭 시 `advanceStep` 차단 및 `skipTyping` 호출 로직 파일: (파일명 및 함수명)
- **중단 및 보고(Halt & Report) 이력:**
    - [ ] 독단적 판단 대신 코치에게 질문한 사항: (없으면 '없음', 있으면 '질문 내용 요약')
- **엔진화/모듈화 제안:**
    - [ ] 이번 작업 중 공통 모듈로 분리 가능한 코드 후보: (예: `FadeEffectManager` 등)
- **MVP 단계 준수:** [Phase X] (현재 단계에 집중했음을 명시)
- **특이사항:** (가이드라인 예외 처리나 코치 승인 하에 진행된 구조적 변경)
