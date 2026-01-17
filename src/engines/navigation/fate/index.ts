/**
 * Fate-Linker System - Phase 3 Manual Node Design
 *
 * Core Philosophy:
 * "Arcana Vectors are discovered. Fate is chosen."
 *
 * This system replaces the legacy Dijkstra-based pathfinding with
 * a fully manual, player-authored path design system.
 *
 * ❌ NO automatic route computation
 * ❌ NO Dijkstra / A* / graph search
 * ❌ NO legacy system references
 */

export { FateNode, type FateNodeData } from './FateNode';
export {
    FateLinker,
    type FateLinkerConfig,
    type FateLinkerCallbacks,
} from './FateLinker';
export {
    GizmoController,
    type GizmoControllerCallbacks,
} from './GizmoController';
export {
    WindTrail,
    type WindTrailMode,
    type WindTrailConfig,
} from './WindTrail';
