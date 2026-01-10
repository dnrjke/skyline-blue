import * as BABYLON from '@babylonjs/core';
import type { NavigationGraph } from '../graph/NavigationGraph';
import { COLORS } from '../../../shared/design';

/**
 * NavigationLinkNetwork
 * - "연결 가능한 라인(엣지)" 네트워크를 얇은 라인으로 표시한다.
 * - Phase 2.5: 유저가 '이을 수 있는 라인 경로'를 즉시 볼 수 있어야 한다.
 *
 * 구현:
 * - LineSystem(저비용) + 약간의 y-오프셋(그리드와 z-fighting 방지)
 */
export class NavigationLinkNetwork {
    private scene: BABYLON.Scene;
    private graph: NavigationGraph;
    private segments: BABYLON.Mesh[] = [];
    private mat: BABYLON.StandardMaterial | null = null;

    constructor(scene: BABYLON.Scene, graph: NavigationGraph) {
        this.scene = scene;
        this.graph = graph;
    }

    build(): void {
        this.dispose();

        // NOTE:
        // LinesMesh(LineSystem)는 WebGL에서 "1px 고정" + 알파/깊이 조건에 따라
        // 실기기/PC뷰에서 체감상 '안 보이는' 케이스가 발생할 수 있다.
        // 따라서 Phase 2에서는 "얇은 튜브(실두께)"로 링크 네트워크를 표시한다.
        this.mat = new BABYLON.StandardMaterial('NavLinkNetworkMat', this.scene);
        this.mat.disableLighting = true;
        this.mat.emissiveColor = BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
        this.mat.alpha = 0.85;
        // Hologram overlay policy: links must be readable over grid/environment
        this.mat.disableDepthWrite = true;
        this.mat.depthFunction = BABYLON.Engine.ALWAYS;

        // Deduplicate undirected edges: store min/max key.
        const seen: Set<string> = new Set();
        const nodes = new Map(this.graph.getNodes().map((n) => [n.id, n]));

        for (const from of nodes.values()) {
            const edges = this.graph.getEdgesFrom(from.id);
            for (const e of edges) {
                const to = nodes.get(e.toId);
                if (!to) continue;
                const a = from.id < to.id ? from.id : to.id;
                const b = from.id < to.id ? to.id : from.id;
                const key = `${a}::${b}`;
                if (seen.has(key)) continue;
                seen.add(key);

                // Slightly above grid plane
                const p0 = from.position.add(new BABYLON.Vector3(0, 0.14, 0));
                const p1 = to.position.add(new BABYLON.Vector3(0, 0.14, 0));

                const tube = BABYLON.MeshBuilder.CreateTube(
                    `NavLink_${a}_${b}`,
                    { path: [p0, p1], radius: 0.045, tessellation: 14, updatable: false },
                    this.scene
                );
                tube.isPickable = false;
                tube.material = this.mat;
                tube.renderingGroupId = 1;
                this.segments.push(tube);
            }
        }
    }

    dispose(): void {
        for (const m of this.segments) m.dispose();
        this.segments = [];
        this.mat?.dispose();
        this.mat = null;
    }
}