/**
 * Navigation Engine Module
 *
 * Phase 3 Architecture:
 * - Fate-Linker: Manual node design system (replaces legacy Dijkstra)
 * - Flight: Path3D-based execution
 * - Legacy: Isolated Dijkstra code (for AI/debug only)
 */

// Main Engine
export { NavigationEngine, type NavigationEngineConfig } from './NavigationEngine';

// Phase 3: Fate-Linker System
export {
    FateNode,
    FateLinker,
    GizmoController,
    WindTrail,
    type FateNodeData,
    type FateLinkerConfig,
    type FateLinkerCallbacks,
    type GizmoControllerCallbacks,
    type WindTrailMode,
    type WindTrailConfig,
} from './fate';

// Phase 3: Flight System
export {
    FlightController,
    type FlightControllerConfig,
    type FlightResult,
    type FlightControllerCallbacks,
} from './flight';

// Phase 3: Character Loading
export { CharacterLoadUnit, type CharacterLoadUnitConfig } from './loading';

// Legacy types (for backward compatibility - DO NOT use in new code)
// @deprecated Use FateNode for Phase 3
export type { NavigationNode, NavigationEdge, PathTotals } from './types';
// @deprecated Use FateLinker for Phase 3
export { NavigationGraph } from './graph/NavigationGraph';
