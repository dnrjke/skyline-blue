import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import type { BackgroundLayer } from '../shared/ui/BackgroundLayer';
import type { BottomVignetteLayer } from '../shared/ui/BottomVignetteLayer';
import type { CharacterLayer } from '../shared/ui/CharacterLayer';
import { COLORS } from '../shared/design';
import type { NarrativeEngine } from '../engines/narrative';
import type { SplashScene } from '../ui/startScreens/splash/SplashScene';
import type { TouchToStartScene } from '../ui/startScreens/touchToStart/TouchToStartScene';
import { INTRO_STORY } from './data/stories';
import type { NavigationEngine } from '../engines/navigation';
import type { StageTransitionManager } from '../core/scene/StageTransitionManager';
import { NavigationDebugger } from '../debug/NavigationDebugger';

type FlowState = 'splash' | 'touchToStart' | 'narrative' | 'navigation' | 'complete';

export interface FlowControllerDeps {
    scene: BABYLON.Scene;
    guiTexture: GUI.AdvancedDynamicTexture;
    narrativeEngine: NarrativeEngine;
    navigationEngine: NavigationEngine;
    transitions: StageTransitionManager;
    splashScene: SplashScene;
    touchToStartScene: TouchToStartScene;
    backgroundLayer: BackgroundLayer;
    bottomVignetteLayer: BottomVignetteLayer;
    characterLayer: CharacterLayer;
}

/**
 * FlowController - keeps Main.ts small.
 * Owns phase transitions and input routing keys (HEBS).
 */
export class FlowController {
    private scene: BABYLON.Scene;
    private guiTexture: GUI.AdvancedDynamicTexture;
    private narrativeEngine: NarrativeEngine;
    private navigationEngine: NavigationEngine;
    private transitions: StageTransitionManager;

    private splashScene: SplashScene;
    private touchToStartScene: TouchToStartScene;

    private backgroundLayer: BackgroundLayer;
    private bottomVignetteLayer: BottomVignetteLayer;
    private characterLayer: CharacterLayer;

    private currentFlow: FlowState = 'splash';
    private inputCooldownTimer: number | null = null;
    private readonly INPUT_COOLDOWN_MS: number = 200;
    private navigationPointerObserver: BABYLON.Observer<BABYLON.PointerInfo> | null = null;

    // Debug tools (F9 toggle)
    private navigationDebugger: NavigationDebugger | null = null;
    private debugKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(deps: FlowControllerDeps) {
        this.scene = deps.scene;
        this.guiTexture = deps.guiTexture;
        this.narrativeEngine = deps.narrativeEngine;
        this.navigationEngine = deps.navigationEngine;
        this.transitions = deps.transitions;
        this.splashScene = deps.splashScene;
        this.touchToStartScene = deps.touchToStartScene;
        this.backgroundLayer = deps.backgroundLayer;
        this.bottomVignetteLayer = deps.bottomVignetteLayer;
        this.characterLayer = deps.characterLayer;
    }

    start(): void {
        this.startFlow('splash');
    }

    dispose(): void {
        if (this.inputCooldownTimer !== null) {
            clearTimeout(this.inputCooldownTimer);
            this.inputCooldownTimer = null;
        }
        if (this.navigationPointerObserver) {
            this.scene.onPointerObservable.remove(this.navigationPointerObserver);
            this.navigationPointerObserver = null;
        }
        this.cleanupDebugTools();
    }

    private cleanupDebugTools(): void {
        if (this.debugKeyHandler) {
            window.removeEventListener('keydown', this.debugKeyHandler);
            this.debugKeyHandler = null;
        }
        if (this.navigationDebugger) {
            this.navigationDebugger.dispose();
            this.navigationDebugger = null;
        }
    }

    private startFlow(flow: FlowState): void {
        const previousFlow = this.currentFlow;
        this.currentFlow = flow;
        console.log(`[System] Flow: ${previousFlow} → ${flow}`);

        // Navigation 전환은 로딩 오버레이(페이드아웃 포함) 종료 시점에 맞춰
        // 입력을 명시적으로 복구해야 한다.
        // 공통 200ms 쿨다운(자동 enable)은 "enabled=true 로그"를 오염시키므로 navigation에서는 건너뛴다.
        if (flow !== 'navigation') {
            this.applyInputCooldown();
        }

        switch (flow) {
            case 'splash':
                this.startSplash();
                break;
            case 'touchToStart':
                this.startTouchToStart();
                break;
            case 'narrative':
                this.startNarrative();
                break;
            case 'navigation':
                this.startNavigation();
                break;
            case 'complete':
                this.onFlowComplete();
                break;
        }
    }

    private applyInputCooldown(): void {
        if (this.inputCooldownTimer !== null) {
            clearTimeout(this.inputCooldownTimer);
            this.inputCooldownTimer = null;
        }
        this.narrativeEngine.setInputEnabled(false);
        this.inputCooldownTimer = window.setTimeout(() => {
            this.inputCooldownTimer = null;
            this.narrativeEngine.setInputEnabled(true);
        }, this.INPUT_COOLDOWN_MS);
    }

    private startSplash(): void {
        console.log('[System] Starting Splash...');
        this.backgroundLayer.show();
        this.backgroundLayer.setColor(COLORS.BG_SPLASH);
        this.bottomVignetteLayer.hide();

        this.narrativeEngine.pushInputHandler('splash', () => {
            // DIAGNOSTIC: Splash input received but intentionally ignored (phase1 policy)
            console.warn('[Input] Ignored by flow gate', {
                phase: this.currentFlow,
                expected: ['touchToStart', 'narrative'],
                actual: this.currentFlow,
                reason: 'SplashPhasePolicy',
                note: 'Splash advances only via timer (splashScene.onComplete), not user input',
            });
        });

        this.splashScene.start({
            onComplete: () => {
                console.log('[System] Splash complete');
                this.narrativeEngine.popInputHandler('splash');
                this.startFlow('touchToStart');
            },
        });
    }

    private startTouchToStart(): void {
        console.log('[System] Starting Touch-to-Start...');
        console.debug('[TouchToStart] Entered', {
            phase: this.currentFlow,
            inputEnabled: this.narrativeEngine.getState(),
        });
        this.backgroundLayer.show();
        this.backgroundLayer.setColor(COLORS.BG_TITLE);
        this.bottomVignetteLayer.hide();

        this.narrativeEngine.pushInputHandler('touchToStart', () => {
            // DIAGNOSTIC: Input received, triggering transition
            console.info('[Flow] Transition requested', {
                from: this.currentFlow,
                to: 'narrative',
                trigger: 'UserInput (touchToStart handler)',
            });
            this.touchToStartScene.triggerStart();
        });

        this.touchToStartScene.start({
            onStart: () => {
                console.log('[System] Touch detected - entering narrative');
                this.narrativeEngine.popInputHandler('touchToStart');
                this.startFlow('narrative');
            },
        });
    }

    private startNarrative(): void {
        console.log('[System] Starting Narrative Engine...');
        this.bottomVignetteLayer.show();
        this.narrativeEngine.startNarrative(INTRO_STORY);

        // Wrap callbacks: when narrative ends -> navigation
        this.narrativeEngine.setCallbacks({
            onSequenceEnd: () => {
                console.log('[System] Narrative sequence ended');
                this.startFlow('navigation');
            },
            onEvent: (eventName, payload) => this.handleNarrativeEvent(eventName, payload),
        });
    }

    private startNavigation(): void {
        console.log('[System] Starting Phase 2: Navigation...');
        this.bottomVignetteLayer.hide();
        this.characterLayer.hideAll();
        // Phase 2 Navigation은 3D TacticalHologram(scene.clearColor + grid)이 배경을 소유한다.
        // GUI BackgroundLayer는 3D 월드를 완전히 덮기 때문에 숨김 처리한다.
        this.backgroundLayer.hide();

        // CRITICAL:
        // Flow 전환 공통 쿨다운(200ms)이 Navigation 로딩 중에 입력을 조기 복구시키며,
        // 결과적으로 로딩 오버레이가 "InteractionLayer enabled=true" 이전에 끝나 보일 수 있다.
        // Navigation에서는 로딩 종료 시점에 명시적으로 입력을 복구한다.
        if (this.inputCooldownTimer !== null) {
            clearTimeout(this.inputCooldownTimer);
            this.inputCooldownTimer = null;
        }
        this.narrativeEngine.setInputEnabled(false);

        // Phase 2.5: Arcana Loading & Debugger
        void this.transitions
            .runStageTransition({ episode: 1, stage: 1 }, async ({ setProgress, log, dbg }) => {
                dbg.begin('Navigation Start');
                log('Starting Navigation...');
                setProgress(0.02);

                // IMPORTANT:
                // - Navigation의 준비(onReady)까지 기다린다.
                // - 입력(enable=true)은 "오버레이가 완전히 종료된 뒤"에만 수행한다.
                //   (enabled=true 로그가 실제 조작 가능 시점과 일치하도록 보장)
                dbg.begin('Stage Load');
                await new Promise<void>((resolve) => {
                    this.navigationEngine.start({
                        stage: { episode: 1, stage: 1 },
                        dbg,
                        onProgress: (p) => setProgress(p),
                        onLog: (line) => log(line),
                        onReady: () => {
                            dbg.end('Stage Load');
                            setProgress(1);
                            log('READY');
                            resolve();
                        },
                    });
                });

                dbg.end('Navigation Start');
            })
            .then(() => {
                // StageTransitionManager가 fadeOutAndHide까지 끝낸 뒤 resolve된다.
                // 따라서 이 시점의 enabled=true 로그는 "실제 렌더링/조작 가능 상태"와 정렬된다.
                this.narrativeEngine.setInputEnabled(true);
            })
            .catch((err) => {
                console.error('[System] Navigation transition failed', err);
                // 실패 시 입력은 계속 차단(깨진 상태로 입력 관통 방지)
            });

        // Navigation 모드에서는 카메라 컨트롤을 위해 PointerBlocker 비활성화
        // 노드 선택은 scene.onPointerObservable을 통해 직접 처리
        this.narrativeEngine.setPointerBlockerEnabled(false);

        // scene.onPointerObservable로 노드 선택 처리 (카메라 컨트롤과 공존)
        this.navigationPointerObserver = this.scene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
                // 노드 선택 처리
                this.navigationEngine.handleTap(this.scene.pointerX, this.scene.pointerY);
            }
        });

        // Debug tools: F9로 디버그 패널 토글
        this.setupDebugTools();
    }

    private setupDebugTools(): void {
        // NavigationDebugger 생성
        this.navigationDebugger = new NavigationDebugger(this.scene, this.guiTexture);

        // F9 키 핸들러 등록
        this.debugKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'F9') {
                e.preventDefault();
                this.navigationDebugger?.toggle();
                console.log('[Debug] Panel toggled via F9');
            }
        };
        window.addEventListener('keydown', this.debugKeyHandler);

        console.log('[Debug] Debug tools ready (Press F9 to toggle panel)');
    }

    private onFlowComplete(): void {
        console.log('[System] ========================================');
        console.log('[System] Flow Complete');
        console.log('[System] ========================================');
        this.backgroundLayer.setColor(COLORS.BG_SCENE_NIGHT);
        this.characterLayer.hideAll();
        this.bottomVignetteLayer.hide();
        this.navigationEngine.stop();

        // Navigation 모드 정리
        if (this.navigationPointerObserver) {
            this.scene.onPointerObservable.remove(this.navigationPointerObserver);
            this.navigationPointerObserver = null;
        }
        this.narrativeEngine.setPointerBlockerEnabled(true);

        // Debug tools 정리
        this.cleanupDebugTools();
    }

    // ============================================
    // Narrative Events (Phase 1)
    // ============================================
    private handleNarrativeEvent(eventName: string, payload?: unknown): void {
        console.log(`[Event] ${eventName}`, payload || '');
        // Phase 1 event handling is still owned here to keep Main thin.
        // (Existing switch moved from Main.ts)
        switch (eventName) {
            case 'CHANGE_BG': {
                const p = payload as { color?: string };
                if (p?.color) this.backgroundLayer.setColor(p.color);
                break;
            }
            case 'SHOW_CHARACTER': {
                const p = payload as { id: string; position: any; image?: string };
                if (p?.id && p?.position) this.characterLayer.showCharacter(p.id, p.position, p.image);
                break;
            }
            case 'HIDE_CHARACTER': {
                const p = payload as { id: string };
                if (p?.id) this.characterLayer.hideCharacter(p.id);
                break;
            }
            case 'FLOW_COMPLETE': {
                const p = payload as { next: string };
                if (p?.next === 'complete') this.startFlow('complete');
                break;
            }
            default:
                console.log(`[Event] Unhandled: ${eventName}`);
        }
    }
}

