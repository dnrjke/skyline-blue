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

import type * as BABYLON from '@babylonjs/core';
import type { NavigationGraph } from './NavigationGraph';
import type { NavigationNode, PathTotals } from './types';
import { dijkstraShortestPath } from './dijkstra';

export interface PathStoreState {
    sequence: string[];
    totals: PathTotals;
    energyBudget: number;
    isOverBudget: boolean;
    /** Dijkstra minimal cost from first->last (for validity reference). */
    dijkstraMinCost: number | null;
}

/**
 * PathStore - stores selected node sequence for Phase 2.
 *
 * 책임:
 * - 노드 시퀀스 유지/수정
 * - 에너지/점수 합산
 * - 에너지 초과 여부 판정 (Dijkstra 포함)
 * - 다음 페이즈 전달용 "확정 데이터" 제공
 *
 * @deprecated Use FateLinker for Phase 3 manual path design.
 */
export class PathStore {
    private graph: NavigationGraph;
    private energyBudget: number;
    private sequence: string[] = [];

    constructor(graph: NavigationGraph, energyBudget: number) {
        this.graph = graph;
        this.energyBudget = energyBudget;
    }

    setEnergyBudget(budget: number): void {
        this.energyBudget = Math.max(0, budget);
    }

    getEnergyBudget(): number {
        return this.energyBudget;
    }

    clear(): void {
        this.sequence = [];
    }

    /**
     * Append node to sequence if it's connected to the previous node.
     * Returns false if invalid transition (no edge) or already visited.
     *
     * [Phase 2.5 Fix] 중복 방문 금지: 이미 방문한 노드는 재방문 불가
     */
    tryAppend(nodeId: string): boolean {
        // 이미 방문한 노드인지 확인 (중복 방문 금지)
        if (this.sequence.includes(nodeId)) {
            return false;
        }

        if (this.sequence.length === 0) {
            this.sequence = [nodeId];
            return true;
        }
        const last = this.sequence[this.sequence.length - 1];
        if (!this.graph.hasEdge(last, nodeId)) {
            return false;
        }
        this.sequence = [...this.sequence, nodeId];
        return true;
    }

    pop(): string | null {
        if (this.sequence.length === 0) return null;
        const last = this.sequence[this.sequence.length - 1];
        this.sequence = this.sequence.slice(0, -1);
        return last;
    }

    getSequence(): string[] {
        return [...this.sequence];
    }

    getNodes(): NavigationNode[] {
        return this.sequence
            .map((id) => this.graph.getNode(id))
            .filter((n): n is NavigationNode => !!n);
    }

    getTotals(): PathTotals {
        const nodes = this.getNodes();
        const totalEnergy = nodes.reduce((acc, n) => acc + n.energyCost, 0);
        const totalScore = nodes.reduce((acc, n) => acc + n.scoreGain, 0);
        return { nodeCount: nodes.length, totalEnergy, totalScore };
    }

    /**
     * Dijkstra-based minimal energy from first to last node (energy model: edgeCost + toNode.energyCost)
     * Used for validity reference and strategic feedback.
     */
    getDijkstraMinCost(): number | null {
        if (this.sequence.length < 2) return null;
        const start = this.sequence[0];
        const goal = this.sequence[this.sequence.length - 1];
        const res = dijkstraShortestPath(this.graph, start, goal, (fromId, toId) => {
            const edges = this.graph.getEdgesFrom(fromId);
            const edge = edges.find((e) => e.toId === toId);
            const edgeCost = edge?.energyCost || 0;
            const toNode = this.graph.getNode(toId);
            const nodeCost = toNode?.energyCost || 0;
            return edgeCost + nodeCost;
        });
        return res ? res.cost : null;
    }

    isOverBudget(): boolean {
        return this.getTotals().totalEnergy > this.energyBudget;
    }

    /**
     * Phase 2 handoff:
     * - TacticalView (x,y,z) must match InGameView exactly via CoordinateMapper.
     * - We return raw Vector3 array here; mapper is applied by the caller.
     */
    getPositions(scene: BABYLON.Scene): BABYLON.Vector3[] {
        // scene param is kept for future-proof signature (no-op now)
        void scene;
        return this.getNodes().map((n) => n.position.clone());
    }

    getState(): PathStoreState {
        const totals = this.getTotals();
        const dijkstraMinCost = this.getDijkstraMinCost();
        return {
            sequence: this.getSequence(),
            totals,
            energyBudget: this.energyBudget,
            isOverBudget: totals.totalEnergy > this.energyBudget,
            dijkstraMinCost,
        };
    }
}
