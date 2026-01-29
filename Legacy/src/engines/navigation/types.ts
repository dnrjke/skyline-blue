import type * as BABYLON from '@babylonjs/core';

/**
 * NavigationNode - node metadata in 3D space.
 * - energyCost: consumed when visiting this node (phase2 rule)
 * - scoreGain: gained when visiting this node (phase2 rule)
 */
export interface NavigationNode {
    id: string;
    position: BABYLON.Vector3;
    energyCost: number;
    scoreGain: number;
}

export interface NavigationEdge {
    fromId: string;
    toId: string;
    /** Optional edge energy cost (defaults to 0). */
    energyCost?: number;
}

export interface PathTotals {
    nodeCount: number;
    totalEnergy: number;
    totalScore: number;
}

export interface DijkstraResult {
    path: string[];
    cost: number;
}

