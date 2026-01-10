import * as BABYLON from '@babylonjs/core';
import type { NavigationGraph } from '../graph/NavigationGraph';
import type { TacticalMapDataV1 } from './TacticalMapData';

function isV1(data: unknown): data is TacticalMapDataV1 {
    const d = data as Partial<TacticalMapDataV1> | null;
    return !!d && d.version === 1 && Array.isArray(d.nodes) && Array.isArray(d.edges);
}

export class TacticalMapLoader {
    async loadJson(url: string): Promise<TacticalMapDataV1> {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`[TacticalMapLoader] Failed to fetch: ${url} (${res.status})`);
        }
        const data = (await res.json()) as unknown;
        if (!isV1(data)) {
            throw new Error(`[TacticalMapLoader] Invalid map format: ${url}`);
        }
        return data;
    }

    applyToGraph(graph: NavigationGraph, data: TacticalMapDataV1): void {
        // NOTE: graph clearing is handled by the caller (stage start).
        for (const n of data.nodes) {
            graph.addNode({
                id: n.id,
                position: new BABYLON.Vector3(n.position[0], n.position[1], n.position[2]),
                energyCost: n.energyCost,
                scoreGain: n.scoreGain,
            });
        }
        for (const e of data.edges) {
            // Undirected by convention for tactical planning
            graph.addUndirectedEdge(e.fromId, e.toId, e.energyCost ?? 0);
        }
    }
}

