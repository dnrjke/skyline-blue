/**
 * PathConstants - 중앙 경로 상수 (Phase 2.3)
 *
 * 규칙:
 * - 에셋 주소는 반드시 여기(또는 이를 래핑한 Assets.ts)를 거친다.
 * - Vite `base` 설정을 존중하기 위해 import.meta.env.BASE_URL을 prefix로 사용한다.
 */
function ensureTrailingSlash(p: string): string {
    return p.endsWith('/') ? p : `${p}/`;
}

function joinUrl(root: string, ...parts: string[]): string {
    const r = ensureTrailingSlash(root);
    const joined = parts
        .filter((x) => x.length > 0)
        .map((x) => x.replace(/^\/+/, '').replace(/\/+$/, ''))
        .join('/');
    return `${r}${joined}`;
}

const BASE_URL = ensureTrailingSlash(import.meta.env.BASE_URL || '/');

export const PATH = {
    /** Public assets root (served by Vite) */
    ASSETS_ROOT: joinUrl(BASE_URL, 'assets'),

    /** Tactical map JSON data */
    MAP_DATA_ROOT: joinUrl(BASE_URL, 'assets', 'maps', 'tactical'),

    /** 3D models (glb/gltf) */
    MODEL_BASE: joinUrl(BASE_URL, 'assets', 'models'),

    /** UI textures (png/webp) */
    UI_TEX_BASE: joinUrl(BASE_URL, 'assets', 'ui'),

    /** Character standing (png/webp) */
    CHARACTER_STANDING_BASE: joinUrl(BASE_URL, 'assets', 'characters', 'standing'),
} as const;

export const PathConstants = {
    BASE_URL,
    joinUrl,
} as const;

