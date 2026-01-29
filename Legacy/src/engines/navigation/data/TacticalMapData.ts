export interface TacticalMapGridData {
    size: number;
    step: number;
}

export interface TacticalMapNodeData {
    id: string;
    position: [number, number, number];
    energyCost: number;
    scoreGain: number;
}

export interface TacticalMapEdgeData {
    fromId: string;
    toId: string;
    energyCost?: number;
}

export interface TacticalMapDataV1 {
    version: 1;
    episode: number;
    stage: number;
    grid?: TacticalMapGridData;
    nodes: TacticalMapNodeData[];
    edges: TacticalMapEdgeData[];
}