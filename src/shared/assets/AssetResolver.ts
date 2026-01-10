import { PATH, PathConstants } from '../config/PathConstants';

export interface StageKey {
    episode: number;
    stage: number;
}

function pad2(n: number): string {
    return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/**
 * AssetResolver - "Stage 1 맵 줘" 수준의 요청만 받아 경로를 조립한다.
 * 엔진/씬은 에셋의 디렉터리 구조를 몰라도 된다.
 */
export class AssetResolver {
    tacticalMapJson(stage: StageKey): string {
        const ep = `episode${pad2(stage.episode)}`;
        const st = `stage${pad2(stage.stage)}.json`;
        return PathConstants.joinUrl(PATH.MAP_DATA_ROOT, ep, st);
    }

    /**
     * Optional: stage-specific environment model (future).
     * 현재는 파일이 없을 수 있으므로, 호출하는 쪽에서 존재 여부 정책을 결정한다.
     */
    tacticalEnvironmentModel(stage: StageKey): string {
        const ep = `episode${pad2(stage.episode)}`;
        const st = `stage${pad2(stage.stage)}.glb`;
        return PathConstants.joinUrl(PATH.MODEL_BASE, 'tactical', ep, st);
    }

    uiTexture(name: string): string {
        return PathConstants.joinUrl(PATH.UI_TEX_BASE, name);
    }

    characterStanding(characterId: string, variant: string = 'default'): string {
        return PathConstants.joinUrl(PATH.CHARACTER_STANDING_BASE, characterId, `${variant}.png`);
    }
}

