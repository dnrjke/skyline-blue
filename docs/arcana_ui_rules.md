UI & Event Handling Rules (Arcana Vector Edition)
"퍼센트(%) 단위의 혼란을 버리고, 픽셀(px) 기반의 선언적 UI 구조로 전환하여 'Skyline Blue'의 정밀한 인터페이스를 완성하라." "입력은 단일 지점에서 소비되며, 시각 요소는 정밀한 Pixel-Perfect 규격에 따라 배치된다."

1. 계층형 이벤트 차단 시스템 (HEBS)
1.1 필수 설계 원칙
Single Source of Input: 모든 클릭/터치는 InteractionLayer(zIndex 100)에서만 수신한다.

Hit-Test Exclusion: 모든 시각적 UI 컴포넌트는 isHitTestVisible = false를 명시하여 클릭 관통을 보장한다.

Input Neutralization: 상위 레이어(Popup) 활성화 시 하위 레이어의 입력을 물리적으로 차단하며, 종료 시 상태를 복구한다.

Z_INDEX 관리: src/shared/design/ZIndex.ts에 단일 정의하며, 레이어 간 충돌 방지를 위해 100 단위 이상의 간격을 유지한다.

1.2 Animation Lock & Flow Control
Centralized Flag: isAnimating 상태는 UIManager 등 단일 책임자만 수정 가능하다.

Click Logic: isAnimating이 true일 때는 연출 스킵(skipTyping), false일 때는 다음 단계(advanceStep)를 수행한다.

Scene Router: 장면 전환(Splash -> Title -> Engine)은 Main.ts가 직접 하지 않고, EventRouter 또는 SceneFactory를 통해 정해진 시퀀스에 따라 수행한다.

2. Pixel-Perfect Adaptive UI (Standardization)
2.1 GUI 시스템 기초 설정 (The 1080p Standard)
Render Mode: AdvancedDynamicTexture.renderAtIdealSize = true를 강제 적용한다.

Ideal Resolution: idealWidth = 1080 (모바일 세로)을 고정 기준으로 삼는다.

Zero Percent Policy: 모든 수치는 1080px 기준의 **고정 픽셀(px)**만 사용한다. 엔진이 스케일링을 수행하므로 개발자는 디자인 가이드의 px 수치만 입력한다.

2.2 계층 구조 및 레이아웃
Root Container (Grid): ADT 직후 Grid를 사용하여 화면을 논리적 구역(Top/Center/Bottom)으로 분할한다.

StackPanel: 오직 가변 리스트 항목 용도로만 제한하며, height는 "auto"로 설정한다.

Safe Area: 노치 및 하단 바 대응을 위해 RootContainer에 디자인 시스템의 padding 값을 강제 적용한다.

3. Design System & Parameters (Magic-Number Zero)
3.1 디자인 요소 독립화 (Source of Truth)
모든 수치는 src/shared/design/에서 관리하며, DESIGN_SYSTEM 통합 객체를 통해 참조한다.

Layout.ts: 컴포넌트 좌표, 크기, 패딩 (예: LAYOUT.SPLASH.LOGO_WIDTH)

Colors.ts: 메인 테마 컬러, Alpha 값 (예: COLORS.PRIMARY_BLUE)

Typography.ts: 폰트 크기, 자간, Weight (예: FONT.SIZE.TITLE)

AnimationConfig.ts: 연출 시간(Duration), 이징(Easing), 루프 여부 (예: ANIM.FADE_DURATION)

Assets.ts: 모든 리소스 경로 (문자열 매직 넘버 방지)

3.2 화면별 정밀 규격 (1080px 기준)
Splash Screen: 로고 500px, 정중앙 배치. 애니메이션 수치는 AnimationConfig 참조.

Touch-to-Start: 타이틀 80px(Top 300px), 안내문 40px(Bottom 200px), 캐릭터 900px.

Dialogue Box: 높이 300px, 하단 여백 40px, 배경 Alpha 0.8, 내부 패딩 40px.

4. 컴포넌트 설계 및 로깅
4.1 모듈화 원칙 (Atomic Design)
하나의 파일은 하나의 UI 역할만 수행한다. (DialogueBox.ts, StartAnimator.ts 등)

No Direct DOM: window 등 브라우저 객체에 직접 접근하지 않고 Babylon Observable을 활용한다.

4.2 로깅 규격
Format: [Category] Action - Details (예: [Scenario] Animation End - SplashLogo)

Strictness: 렌더 루프 내부 로그 및 의미 없는 디버깅 문자열 사용을 금지한다.