import * as BABYLON from '@babylonjs/core';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

export class TacticalEnvironmentLoader {
    /**
     * Smart loading policy:
     * - 필수(홀로그램/노드/GUI)는 즉시 표시
     * - 환경(지형/장식)은 AssetContainer로 백그라운드 로드 후 addAllToScene
     */
    async tryLoadEnvironment(
        url: string,
        scene: BABYLON.Scene,
        onProgress?: (progress01: number, raw?: BABYLON.ISceneLoaderProgressEvent) => void
    ): Promise<BABYLON.AssetContainer | null> {
        // Optional file: if missing or not a valid GLB, silently skip.
        // NOTE: Vite dev server can return HTML (index.html) for unknown routes; glTF loader then throws "Unexpected magic".
        // We preflight the first 4 bytes to ensure it's actually a GLB ("glTF" magic).
        const ok = await this.isLikelyGlb(url);
        if (!ok) return null;

        try {
            const { rootUrl, filename } = this.splitUrl(url);
            const container = await SceneLoader.LoadAssetContainerAsync(rootUrl, filename, scene, (evt) => {
                if (!onProgress) return;
                const total = (evt as any).total ?? 0;
                const loaded = (evt as any).loaded ?? 0;
                const p = total > 0 ? loaded / total : 0;
                onProgress(Math.max(0, Math.min(1, p)), evt);
            });
            return container;
        } catch (err) {
            console.warn('[TacticalEnvironmentLoader] Environment load skipped/failed', url, err);
            return null;
        }
    }

    private async isLikelyGlb(url: string): Promise<boolean> {
        try {
            const res = await fetch(url, {
                method: 'GET',
                headers: { Range: 'bytes=0-3' },
                cache: 'no-store',
            });
            if (!res.ok) return false;
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 4) return false;
            const dv = new DataView(buf);
            // "glTF" (0x67 0x6C 0x54 0x46) == 0x46546C67 in little-endian uint32
            const magic = dv.getUint32(0, true);
            return magic === 0x46546c67;
        } catch {
            return false;
        }
    }

    private splitUrl(url: string): { rootUrl: string; filename: string } {
        const idx = url.lastIndexOf('/');
        if (idx < 0) return { rootUrl: '', filename: url };
        return { rootUrl: url.slice(0, idx + 1), filename: url.slice(idx + 1) };
    }
}

