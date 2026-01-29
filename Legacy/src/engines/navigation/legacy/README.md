# Navigation Legacy Code

> **Status**: DEPRECATED - Phase 2 Legacy
> **Isolation Date**: 2026-01-12

## Purpose

This directory contains the legacy Dijkstra/pathfinding code from Phase 2.
These files are **preserved for reference** and potential future use cases:

- AI Rival path computation
- Automatic path suggestion tools
- Debug/analysis utilities

## CRITICAL: Import Firewall

```typescript
// ❌ PROHIBITED - Production gameplay code
import { NavigationGraph } from '../legacy/NavigationGraph';
import { dijkstraShortestPath } from '../legacy/dijkstra';

// ✅ ALLOWED - Debug/Test only with explicit marker
// @ts-expect-error Legacy import for debug purposes only
import { NavigationGraph } from '../legacy/NavigationGraph';
```

## Files

| File | Original Location | Purpose |
|------|-------------------|---------|
| `dijkstra.ts` | `algorithms/dijkstra.ts` | Shortest path algorithm |
| `NavigationGraph.ts` | `graph/NavigationGraph.ts` | Node-edge graph structure |
| `PathStore.ts` | `store/PathStore.ts` | Path sequence + Dijkstra validation |
| `types.ts` | `types.ts` | Legacy type definitions |

## DO NOT

- Import from `fate/`, `flight/`, or any Phase 3+ code
- Reference in `NavigationScene.ts` after READY phase
- Use for gameplay path execution
- Modify without explicit approval

## Migration History

Phase 3 (Arcana Path-Master) replaces this entire system with:
- **Fate-Linker**: Manual node design (no auto-computation)
- **FlightController**: Path3D-based movement (no Dijkstra)

See `docs/path-master/ARCHITECTURE.md` for details.
