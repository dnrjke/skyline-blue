/**
 * Narrative Engine - Public API (Facade)
 *
 * 이 파일은 Narrative Engine의 유일한 진입점입니다.
 * 외부 코드는 이 파일에서 export된 API만 사용해야 합니다.
 *
 * ========================================
 * 사용 규칙 (Usage Rules)
 * ========================================
 *
 * [허용]
 * - import { NarrativeEngine, ScenarioSequence } from './engines/narrative';
 * - engine.startNarrative(sequence);
 * - engine.isPlaying();
 *
 * [금지]
 * - import { ScenarioManager } from './engines/narrative/scenario/ScenarioManager';
 * - import { DialogueBox } from './engines/narrative/ui/DialogueBox';
 * - 내부 모듈 직접 import
 *
 * ========================================
 */

import * as GUI from '@babylonjs/gui';
import { DialogueBox } from './ui/DialogueBox';
import { InteractionLayer } from './ui/InteractionLayer';
import { ScenarioManager } from './scenario/ScenarioManager';
import { StoryControls } from './ui/StoryControls';

// Re-export types needed by external code
export type {
    ScenarioSequence,
    ScenarioStep,
    NarrationStep,
    DialogueStep,
    AutoStep,
    EventStep,
    NarrativeCallbacks,
    UIState,
} from './types';

// Z_INDEX는 shared/design/ZIndex.ts로 이동됨
// Narrative Engine 사용자는 shared/design에서 직접 import할 것
export { Z_INDEX } from '../../shared/design';

/**
 * NarrativeEngine - Narrative System Facade
 *
 * 외부에서 Narrative 시스템을 제어하는 유일한 인터페이스입니다.
 * 내부 구성요소(DialogueBox, InteractionLayer, ScenarioManager)를 캡슐화합니다.
 */
export class NarrativeEngine {
    private dialogueBox: DialogueBox;
    private interactionLayer: InteractionLayer;
    private scenarioManager: ScenarioManager;
    private storyControls: StoryControls | null = null;

    private userCallbacks: import('./types').NarrativeCallbacks = {};

    /**
     * NarrativeEngine 생성
     *
     * @param interactionLayer - 입력을 받을 GUI 레이어 (Z_INDEX.INTERACTION)
     * @param displayLayer - 대화창을 표시할 GUI 레이어 (Z_INDEX.DISPLAY)
     * @param skipLayer - 스킵/시스템 버튼을 표시할 GUI 레이어 (Z_INDEX.SKIP)
     */
    constructor(interactionLayer: GUI.Rectangle, displayLayer: GUI.Rectangle, skipLayer?: GUI.Rectangle) {
        // Create internal components
        this.interactionLayer = new InteractionLayer(interactionLayer);
        this.dialogueBox = new DialogueBox(displayLayer);

        // Create scenario manager with internal components
        this.scenarioManager = new ScenarioManager(this.dialogueBox, this.interactionLayer);

        if (skipLayer) {
            this.storyControls = new StoryControls(skipLayer, {
                onToggleAuto: (enabled) => this.scenarioManager.setAutoEnabled(enabled),
                onHoldSkipTriggered: () => this.scenarioManager.enterFastForward(),
                getAutoEnabled: () => this.scenarioManager.isAutoEnabled(),
            });
        }

        console.log('[NarrativeEngine] Initialized');
    }

    /**
     * 시나리오 시퀀스를 시작합니다.
     *
     * @param sequence - 재생할 시나리오 시퀀스
     */
    startNarrative(sequence: import('./types').ScenarioSequence): void {
        console.log(`[NarrativeEngine] Starting narrative: ${sequence.name}`);
        this.storyControls?.show();
        this.scenarioManager.startSequence(sequence);
    }

    /**
     * 현재 시나리오가 재생 중인지 확인합니다.
     *
     * @returns 재생 중이면 true
     */
    isPlaying(): boolean {
        return this.scenarioManager.isPlaying();
    }

    /**
     * 콜백을 설정합니다.
     *
     * @param callbacks - 이벤트 콜백 객체
     */
    setCallbacks(callbacks: import('./types').NarrativeCallbacks): void {
        // Merge user callbacks locally, then install wrapped callbacks so internal hooks always run.
        this.userCallbacks = { ...this.userCallbacks, ...callbacks };
        this.scenarioManager.setCallbacks({
            onSequenceEnd: () => {
                this.storyControls?.hide();
                this.userCallbacks.onSequenceEnd?.();
            },
            onEvent: (eventName, payload) => {
                this.userCallbacks.onEvent?.(eventName, payload);
            },
        });
    }

    /**
     * HEBS 입력 라우팅:
     * 외부(App/Main)에서 흐름(스플래시/터치/팝업)에 따라
     * 최상단 입력 핸들러를 일시적으로 올렸다가(pop) 내릴 수 있다.
     *
     * - key는 충돌 방지를 위해 고유 문자열 사용 권장 (예: 'touchToStart')
     */
    pushInputHandler(key: string, handler: () => void): void {
        this.interactionLayer.pushHandler(key, handler);
    }

    popInputHandler(key: string): void {
        this.interactionLayer.popHandler(key);
    }

    /**
     * 입력을 물리적으로 차단/허용한다.
     * - Phase 1.1 안전장치: Flow 전환 찰나의 "입력 관통" 방지용
     */
    setInputEnabled(enabled: boolean): void {
        this.interactionLayer.setEnabled(enabled);
    }

    /**
     * 현재 UI 상태를 반환합니다. (디버그용)
     *
     * @returns 현재 UI 상태 ('idle' | 'typing' | 'waiting' | 'auto')
     */
    getState(): import('./types').UIState {
        return this.scenarioManager.getState();
    }

    /**
     * 리소스를 해제합니다.
     */
    dispose(): void {
        console.log('[NarrativeEngine] Disposing');
        this.scenarioManager.dispose();
        this.storyControls?.dispose();
        this.dialogueBox.dispose();
        this.interactionLayer.dispose();
    }
}
