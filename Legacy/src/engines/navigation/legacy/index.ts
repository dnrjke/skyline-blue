/**
 * @deprecated LEGACY CODE - Phase 2
 *
 * Legacy navigation system exports.
 * These are preserved for AI Rival, debug, and analysis tools ONLY.
 *
 * ❌ DO NOT import in:
 * - Fate-Linker system
 * - Flight system
 * - Scenario progression
 * - Any Phase 3+ gameplay code
 */

export { NavigationGraph } from './NavigationGraph';
export { PathStore, type PathStoreState } from './PathStore';
export { dijkstraShortestPath } from './dijkstra';
export type {
    NavigationNode,
    NavigationEdge,
    PathTotals,
    DijkstraResult,
} from './types';
