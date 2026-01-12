/**
 * @deprecated LEGACY CODE - Phase 2
 *
 * Legacy type definitions for Phase 2 navigation system.
 * DO NOT import from production gameplay code.
 */

import type * as BABYLON from '@babylonjs/core';

/**
 * NavigationNode - node metadata in 3D space.
 * - energyCost: consumed when visiting this node (phase2 rule)
 * - scoreGain: gained when visiting this node (phase2 rule)
 *
 * @deprecated Use FateNode for Phase 3.
 */
export interface NavigationNode {
    id: string;
    position: BABYLON.Vector3;
    energyCost: number;
    scoreGain: number;
}

/**
 * @deprecated Use FateLine connections for Phase 3.
 */
export interface NavigationEdge {
    fromId: string;
    toId: string;
    /** Optional edge energy cost (defaults to 0). */
    energyCost?: number;
}

/**
 * @deprecated Phase 3 does not use energy/score totals.
 */
export interface PathTotals {
    nodeCount: number;
    totalEnergy: number;
    totalScore: number;
}

/**
 * @deprecated Phase 3 does not use Dijkstra.
 */
export interface DijkstraResult {
    path: string[];
    cost: number;
}
