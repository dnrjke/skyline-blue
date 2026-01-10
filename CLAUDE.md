"너는 이제부터 '신중한 전술가' 모드로 동작한다. 지시된 Phase의 기능을 구현하다가 설계상의 선택이 필요한 지점(Branching Point)을 만나면, 임의로 구현을 완료하지 마라. 그 지점에서 작업을 일시 중단하고, 나에게 가능한 옵션들을 보고한 뒤 나의 결정을 기다려라."

# Skyline Blue: Arcana Vector — Development Constitution

> 이 게임은 플레이하는 게임이 아니라, 내가 만든 '논리'가 날아가는 걸 구경하는 게임이다.

Skyline Blue는 '잘 만드는 게임'이 아니라 '설계하고 감상하는 게임'을 만든다.

---

## [Strict Protocol: Self-Verification Loop]

> 이 섹션은 모든 개발 작업에 영구적으로 적용되는 자율 검증 프로토콜이다.

### 검증 루프 (The Loop)
1. 지시 → 코치님의 요청 수신
2. 참조 → `CLAUDE.md` + `docs/arcana_ui_rules.md` (계층형 이벤트 차단) 확인
3. 수행 → 100% Babylon.js & GUI 규칙에 맞춰 코딩
4. 검증 → `docs/verification_template.md`로 자가 점검 실시
5. 보고 → 작업 완료 시 아래 양식으로 준수 여부 보고

### 보고 지침 (Reporting)
모든 작업 완료 후 `docs/verification_template.md` 내 [검증 보고 양식]을 복사하여 결과를 보고하라.

1. 근거 중심: 단순 Y/N이 아닌 로직, 파일명, 함수명 등 구체적 근거를 제시할 것.
2. 브랜치 명시: 작업 브랜치가 `main`이 아님을 `git branch` 결과로 증명할 것.
3. 중단점 보고: [Halt & Report]가 발생했다면 판단 근거와 선택지를 명시할 것.

### 필수 참조 문서
| 문서 | 용도 |
|------|------|
| `CLAUDE.md` | 프로젝트 헌법 (최상위 원칙) |
| `src/app/Main.ts` | 엔진 초기화 및 씬 관리 |
| `src/shared/ui/GUIManager.ts` | Babylon GUI 레이어 관리자 |
| `src/engines/narrative/` | Narrative Engine (대화/시나리오) |

---

## 0. Technical Dogma (100% Babylon.js)

> 이 프로젝트에 HTML/CSS UI는 존재하지 않는다.

모든 시각적 요소는 Babylon.js Canvas 내부에서 처리된다.
`<div>`, `<span>`, CSS `z-index` 사용을 엄격히 금지한다.

### 기술 스택
- Engine: Babylon.js (Rendering & Physics)
- UI System: Babylon GUI (`AdvancedDynamicTexture` Only)
- Language: TypeScript (Strict Mode)
- Viewport: 100dvh (Canvas Resizing via Engine)

---

## ★ CORE SCENE: 흡혈귀 에이스의 진심 비행

> 이 조항은 Skyline Blue 전체 개발의 최우선 기준이다.
> 아래 장면이 실패하면, 다른 모든 시스템은 성공해도 무의미하다.

### 프로토타입 성공 조건 (단 하나)
"흡혈귀 에이스의 진심 비행" 장면이 스킵 성향의 플레이어조차 끝까지 보게 만든다.

### 연출 필수 규칙
#### 조작 완전 금지
- UI (`AdvancedDynamicTexture`) 숨김 처리
- 안내 텍스트 최소화
- 30초 이상 손에서 기기를 놓게 만드는 장면이어야 한다.

#### 속도와 화려함에 대한 원칙
- 빠를 필요 없다. 화려할 필요도 없다.
- 방향 전환이 "결단"처럼 보일 것.
- 궤적이 망설이지 않는다.
- 낮(엉성함)과 밤(진심)의 격차가 셰이더와 궤적만으로 느껴져야 한다.

### 개발 판단 질문 (의무)
❓ 이 요소가 '흡혈귀의 진심 비행'을 더 멋지게 만드는가?
- YES → 구현 (Babylon.js 파티클/셰이더 활용)
- NO → 보류 또는 삭제

---

## 1. 게임 컨셉 (Core Concept)

"설계하고 감상하는 활공 스포츠"

- 플레이어 역할: 코치 (Coach).
- 핵심: 직접 조작보다 비행 조건, 키워드, 행동 논리를 설계하고 결과를 감상한다.
- 자동화: 자동화는 치트가 아니라 클리어 조건이다.

---

## 2. 레이어 아키텍처 (Babylon GUI Layering)

Skyline Blue는 Babylon GUI의 `zIndex` 속성을 이용해 3단 레이어를 구축한다.
HTML이 아니므로 `AdvancedDynamicTexture` 내의 Control 순서가 생명이다.

### Layer 0 — World (Scene)
- zIndex: 0
- 실제 3D 게임 월드 (Mesh, Particle, Trail)
- 카메라와 물리 엔진이 존재하는 공간

### Layer 1 — Display (GUI)
- zIndex: 500
- 연출 전용 GUI 컨테이너
- 컷신, 천사상 일러스트(`Image`), 시나리오 텍스트(`TextBlock`)
- 기본적으로 `isPointerBlocker = false` (클릭 관통)

### Layer 2 — System (GUI)
- zIndex: 1000
- 설정, 디버그, 메뉴 UI
- 팝업(`Rectangle`) 활성화 시 하위 레이어 입력 차단 (`isPointerBlocker = true`)

### Layer 3 — Transition/Skip
- zIndex: 1100
- 홀드-투-스킵 버튼, 페이드 인/아웃 오버레이

---

## 3. Adaptive Layout Policy (Babylon GUI)

반응형 웹(CSS)이 아닌 Babylon 엔진 기반 적응형(Adaptive) 로직을 사용한다.

### 디바이스 분류 로직
`engine.getRenderWidth()` / `engine.getRenderHeight()` 비율로 판단.

- Mobile (Portrait 9:16):
  - UI 컨트롤을 중앙 및 하단(엄지 영역)에 집중.
  - `Control.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM`

- Tablet (Landscape/Square):
  - 좌우 여백(빈 공간)에 캐릭터 스탠딩이나 시스템 메뉴 배치.
  - 3D 뷰포트는 중앙 유지.

Canvas는 항상 꽉 차게 렌더링되지만, 주요 UI는 Safe Area 내부에 그려져야 한다.

---

## 4. 시나리오 시스템 원칙

시나리오는 데이터 기반(sequence)으로 구성한다.

### ScenarioManager (GUI 기반)
- HTML DOM 조작이 아닌, GUI `TextBlock`과 `Image` 속성 변경으로 작동.
- Skip: 화면 터치 시 `animationGroups` 속도를 가속하거나 즉시 종료.

### 튜토리얼 시퀀스
- 시퀀스 A: 해변 오프닝 (갈매기 소리 + 독백)
- 시퀀스 B: 부실 전경 및 입부 희망자 등장
- 시퀀스 C: 흡혈귀 소녀의 엉성한 비행 (항로 설계 튜토리얼)

---

## 5. 오디오 아키텍처 (Web Audio API + Babylon)

Babylon.js의 `Sound` 클래스 또는 Web Audio API를 래핑하여 사용한다.

### 필수 규칙
1. Resume Context: `scene.onPointerDown` 이벤트 발생 시 `AudioContext.resume()` 필수 호출.
2. Channel Separation: BGM, SFX, Voice 채널 볼륨 독립 제어.
3. Instance: BGM은 루프 재생, 효과음은 풀링(Pooling) 또는 일회성 재생.

---

## 6. 구현 태도 (AI 행동 지침)

- Pure Babylon: "HTML로 하면 편한데"라는 생각 금지. 텍스트 한 줄도 GUI로 그린다.
- Visual First: 코드의 우아함보다 화면에 출력되는 연출의 임팩트가 우선이다.
- MVP First: 현재 단계에서 보이지 않는 기능(상점, 가차, 계정)은 코드조차 짜지 않는다.
- Replaceability: 모든 시스템은 언제든 갈아엎을 수 있도록 모듈화한다.

---

## 7. 성공 기준 (Prototype Success Condition)

- 3D Canvas가 모바일 화면에 꽉 차고 (Notch 대응),
- 터치 시 Babylon GUI가 즉각 반응하며,
- "흡혈귀의 비행"을 멍하니 쳐다보게 된다면 성공이다.

---

## 8. Design & Artistic Tone

"청춘, 비행, 그리고 격정적 드라마"

### Narrative & Emotion
- 사키(Saki) 시리즈:
  - 일상물처럼 보이다가 승부 순간에 폭발하는 과장된 연출.
  - 캐릭터의 감정선이 이능력 배틀물 수준으로 격정적으로 묘사됨.
  - 컷인 하나가 "정보"가 아니라 "기세"를 담아야 함.

### Visual Identity
- 에어스포츠부 (1부 정체성): 청량한 하늘, 땀방울, 격납고의 기계적 디테일.
- 블루 아카이브 (Blue Archive):
  - 청량함(Blue & White), 깔끔한 헤일로/UI 디자인.
  - 밝고 투명한 청춘물의 색감.
- 붕괴: 스타레일 (3부/페나코니):
  - 세련된 3D 홀로그램 UI, 몽환적인 우주/하늘 표현.
  - 메뉴 화면 등에서의 고급스러운 트랜지션.
- Wii Sports Resort (우후 아일랜드):
  - 오픈월드 비행의 자유로움과 평화로움.
  - "탐험하고 싶어지는" 지형 디자인.

---

## 9. MVP Development Roadmap (Sequential)

> 경고: 이전 단계가 완벽히 검증되기 전까지 절대 다음 단계로 넘어가지 않는다.

### Phase 1: Interactive Novel
- 목표: DialogueBox + InteractionLayer + Animation Lock 최소 구조 구현.
- 제한: 선택지/팝업은 구현하지 않으며, 단일 선형 시나리오만 다룬다.

### Phase 1.1: Interactive Novel - 2nd step (Current Goal)
- 목표: 스플래시 -> 타이틀 -> 인트로 시나리오(해변/부실) -> 대화 진행.
- 구현: Babylon GUI 기반 대화창, 캐릭터 스탠딩, 연출 스킵, 로그 출력.
- 검증: 모바일 터치 시 "씹히지 않고" 대화가 매끄럽게 흐르는가?

### Phase 1.5: Narrative Engine Refactor (Next Goal)

[목표]
기존 대화/시나리오 로직을 Narrative Engine으로 명확히 분리한다.
엔진 단위로 복사·재사용 가능한 구조를 만든다.

[범위]
DialogueBox, InteractionLayer, ScenarioManager 및 시나리오 데이터
Babylon GUI 기반, HTML DOM 사용 금지 유지

[지침]
Narrative Engine은 입력을 직접 소유하지 않는다.
외부(World/App)로부터 “진행 트리거”만 전달받는다.
상태 전이는 엔진 내부에서만 관리한다.
모바일 터치 환경에서 입력 누락(씹힘)이 없어야 한다.

[완료 기준]
Narrative Engine 디렉터리를 단독으로 복사해도 컴파일 가능
Main(App)에서 엔진을 생성·연결하는 구조가 명확할 것
기존 Phase 1 기능(타이핑, 스킵, 진행)이 동일하게 동작할 것

### Phase 2: Path Planning Logic
- 목표: '항로 설정 게임' 기능 구현.
- 구현: 3D 노드 배치, 노드 간 연결(클릭), 다익스트라 경로 계산 및 시각화.
- 검증: 선택한 노드 순서대로 데이터가 저장되고 다음 페이즈로 전달되는가?

### Phase 2.3: Smart Refactoring & Architecture
[총 의도] 하드코딩된 경로와 파일 참조를 완전히 제거하고, 모든 리소스를 디렉터리 변수 및 에셋 맵을 통해 관리한다. 이는 향후 맵 확장, 에셋 교체, 유지보수 효율성을 극대화하기 위함이다.

### Phase 2.5: 환경 정비 및 로딩/디버깅 통합 엔진 구축 (Current)
[총 의도]
- 프로젝트의 기술 부채(특히 인코딩/낡은 문서)를 청산한다.
- 거대 맵 로딩의 불쾌함(잔상/지루함)을 해소한다.
- 로딩 성능을 “가시화”하는 Arcana Loading & Debugger 시스템을 구축한다.

[핵심 구성요소]
- Core 렌더 품질 인프라: `src/core/rendering/RenderQualityManager.ts`
- Shared 로딩 UI: `src/shared/ui/ArcanaLoadingEngine.ts`, `src/shared/ui/ArcanaLoadingOverlay.ts`
- 로딩 디버거: `src/shared/ui/LoadingDebugger.ts`
- 전환 매니저(core/scene): `src/core/scene/StageTransitionManager.ts`

[완료 기준]
- 엔진 전환 시 로딩 오버레이가 뜨고, 단계별(ms) 로그가 출력된다.
- 로딩 완료 후 0.5초 페이드아웃 후에만 오버레이가 사라진다.

### Phase 3: Path Planning UI Polish
- 목표: '항로 설정' 파트의 시각적 완성도 향상.
- 구현: 노드 아이콘 디자인, 연결 선의 이펙트(Neon Line), 에너지 소모량 표시 UI.
- 검증: UI가 3D 월드와 이질감 없이 어우러지는가? (스타레일 스타일)

### Phase 4: Flight Test
- 목표: 설정된 항로를 따라 비행하는 시퀀스 구현.
- 구현: 카메라 무빙, 캐릭터 이동, '진심 비행' 연출 테스트.
- 검증: 끊김 없이 연출이 재생되고 결과창까지 이어지는가?

---

## 10. Git & Branch Strategy (Strict)

- Main Branch Protection: `main` 브랜치는 배포 전용이며, AI는 이 브랜치를 읽거나 직접 수정할 수 없다.
- Work Branch: 모든 개발은 `feature/*` 또는 `dev/*` 브랜치에서 수행한다.
- No Direct Push: AI는 원격(Remote)의 `main` 브랜치로 직접 푸시할 수 없으며, 로컬 커밋까지만 수행하거나 지시된 브랜치로만 푸시한다.
- Origin Check: 작업 시작 전 `git branch --show-current`를 실행하여 작업 브랜치를 로그에 남긴다.

---

## 11. 모듈화 및 파일 설계 원칙 (Separation of Concerns)

- **기능별 파일 분리 우선:** 새로운 기능을 구현할 때는 반드시 **독립된 신규 파일 생성 및 모듈화**를 원칙으로 한다. 거대 단일 파일(God File) 생성을 지양한다.
- **분리 기준:** - UI 컴포넌트(버튼, 창, 텍스트), 효과 로직(타이핑, 페이드), 데이터 처리 등 역할이 명확히 구분될 경우 즉시 분리한다.
    - 특정 로직이 독립적인 책임(Responsibility)을 갖거나 50라인 이상의 독자적 영역을 차지할 경우 물리적 파일로 분리한다.
- **확장성 및 폐기 용이성:** - 기능 수정 시 타 기능에 영향이 없도록 파일 간 결합도를 최소화한다.
    - 기능을 폐기할 때 해당 파일 삭제와 상위 참조 제거만으로 시스템 정리가 가능하도록 설계한다.
- **자율 구현 범위:** 위 원칙에 따른 파일 생성 및 내부 메서드 분리는 `Halt & Report` 대상이 아닌 '자율적 국소 구현'으로 간주하여 속도감 있게 진행한다.

---

## 12. 프로젝트 계층 구조 (Core / Shared / Engines / App)

AI가 “엉뚱한 폴더에 파일 생성”을 하지 않도록, 아래 계약을 최우선으로 준수한다.

- **core/**: 시스템 인프라 계층 (렌더 품질, 씬 전환, 공용 매니저)
  - 예: `src/core/rendering/RenderQualityManager.ts`, `src/core/scene/StageTransitionManager.ts`
- **shared/**: 자원/유틸/공용 UI 계층 (엔진에 종속되지 않음)
  - 예: `src/shared/config/PathConstants.ts`, `src/shared/assets/AssetResolver.ts`, `src/shared/ui/ArcanaLoadingEngine.ts`
- **engines/**: 게임 기능 구현 계층 (Narrative, Navigation 등)
  - 예: `src/engines/navigation/*`, `src/engines/narrative/*`
- **app/**: 앱 조립/라우팅 계층 (Main/FlowController 등)
  - 예: `src/app/Main.ts`, `src/app/FlowController.ts`
- **ui/**: 시작화면 등 “앱-레벨 화면” (엔진 외부)
  - 예: `src/ui/startScreens/*`

---

## 13. 인코딩 규칙 (UTF-16 차단 / UTF-8 무BOM 강제)

### 절대 규칙
- **모든 새 파일은 반드시 UTF-8 (BOM 없음)으로 생성/저장**해야 한다.
- UTF-16(또는 NUL 바이트 포함) 파일은 TypeScript 컴파일에서 “바이너리 파일”로 오인되어 즉시 빌드가 깨진다.

### 위반 사례 (실제 발생)
- 증상: `error TS1490: File appears to be binary.` / `error TS1127: Invalid character.`
- 원인: Windows 환경에서 새 파일이 UTF-16로 저장되어 NUL 바이트(00)가 섞임.

### 자동 차단
- `npm run build`는 `prebuild`에서 인코딩 검사를 수행한다:
  - 스크립트: `scripts/check-encoding.mjs`
  - 검사 대상: `src/`, `public/`, `docs/`, `scripts/`
  - 정책: UTF-16/NUL/UTF-8 BOM 발견 시 빌드 실패

---

## [Strict Protocol: Halt & Report]

> 에이전트는 독단적인 판단으로 설계를 확장할 수 없다.

### 작업 중단 및 보고 기준 (Critical Decision Points)
다음 상황이 발생하면 즉시 작업을 중단하고 코치에게 질문하라:
1. 모호한 설계: 지시된 로직이 기존 `arcana_ui_rules.md`와 충돌할 가능성이 보일 때.
2. 범위 초과: 현재 Phase(단계)의 목표를 벗어나 "미래에 필요할 것 같은" 기능을 구현하고 싶을 때.
3. 기술적 갈림길: 성능(Performance)과 가독성(Readability) 사이에서 큰 트레이드오프가 발생할 때.
4. 엔진화 제안: 반복되는 패턴을 발견하여 공통 모듈(Engine)로 추출하고자 할 때 (구현 전 제안부터 할 것).

### [Halt Scope Limitation] (필수 준수)
다음 조건에 해당하지 않는 한, 작업을 중단(Halt)하지 않고 자율적으로 진행한다:
- 공용 API 형태가 외부 시스템(다른 모듈)에 노출되는 구조적 변경.
- 기존 문서(CLAUDE.md / arcana_ui_rules.md)의 핵심 원칙과 직접 충돌하는 경우.
- 파일 간 참조 구조가 역전(Circular Dependency)되는 경우.

※ 국소적 구현 판단(Local Implementation Decision): 단일 파일 내부 메서드 분리, 구체적인 GUI 컴포넌트 구성 순서, 애니메이션 구현 방식 등은 중단 없이 자율적으로 수행한다.

"작업을 중단할 때는 현재까지의 진행 상황과 판단이 필요한 옵션들을 정리하여 보고하라."

체크포인트 보고 양식

[Halt Report]
- 현재 진행 단계: Phase 1 (Interactive Novel)
- 중단 원인: 대화창 애니메이션 구현 방식의 선택 필요
- 옵션 A: Babylon AnimationGroup 사용 (정교하지만 코드가 길어짐)
- 옵션 B: GUI Control Property 직접 변경 (간결하지만 확장성이 낮음)
- 코치님의 결정이 필요합니다. 이후의 '대화 넘기기' 기능 구현은 보류 중입니다.

---

"모든 시스템은 교체 가능성을 전제로 '원자적 모듈(Atomic Module)' 구조를 채택한다. 기능 단위로 파일을 세분화하여 결합도를 낮추고 참조 투명성을 확보하며, 현재의 완성도보다 향후 확장성과 폐기 용이성을 최우선한다. 특히 시스템이 안정화되는 시점에 맞춰, 재사용성을 극대화할 수 있는 '프레임워크/엔진화' 설계를 선제적으로 제안한다."
