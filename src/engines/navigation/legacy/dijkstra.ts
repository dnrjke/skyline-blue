/**
 * @deprecated LEGACY CODE - Phase 2
 *
 * This file has been moved to legacy/ as part of Phase 3 migration.
 * DO NOT import from production gameplay code.
 *
 * Allowed uses:
 * - AI Rival path computation
 * - Debug/analysis tools
 * - Test utilities
 */

import type { NavigationGraph } from './NavigationGraph';
import type { DijkstraResult } from './types';

/**
 * Dijkstra - validates / computes shortest paths by energy cost.
 * Implementation notes:
 * - Phase 2 focuses on correctness and clarity over micro-optimizations.
 *
 * @deprecated Use Fate-Linker for manual path design instead.
 */
export function dijkstraShortestPath(
    graph: NavigationGraph,
    startId: string,
    goalId: string,
    getEdgeCost: (fromId: string, toId: string) => number
): DijkstraResult | null {
    if (startId === goalId) return { path: [startId], cost: 0 };

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();

    for (const n of graph.getNodes()) {
        dist.set(n.id, Number.POSITIVE_INFINITY);
        prev.set(n.id, null);
    }
    if (!dist.has(startId) || !dist.has(goalId)) return null;

    dist.set(startId, 0);

    while (true) {
        // Pick unvisited node with smallest distance (O(V^2) baseline).
        let current: string | null = null;
        let best = Number.POSITIVE_INFINITY;
        for (const [id, d] of dist.entries()) {
            if (visited.has(id)) continue;
            if (d < best) {
                best = d;
                current = id;
            }
        }

        if (current === null) break; // unreachable
        if (current === goalId) break;

        visited.add(current);

        for (const e of graph.getEdgesFrom(current)) {
            if (visited.has(e.toId)) continue;
            const alt = (dist.get(current) || 0) + getEdgeCost(current, e.toId);
            if (alt < (dist.get(e.toId) || Number.POSITIVE_INFINITY)) {
                dist.set(e.toId, alt);
                prev.set(e.toId, current);
            }
        }
    }

    const goalDist = dist.get(goalId);
    if (goalDist === undefined || !Number.isFinite(goalDist)) return null;

    const path: string[] = [];
    let cur: string | null = goalId;
    while (cur) {
        path.push(cur);
        cur = prev.get(cur) || null;
    }
    path.reverse();

    if (path[0] !== startId) return null;
    return { path, cost: goalDist };
}
