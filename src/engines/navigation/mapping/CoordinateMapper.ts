import type * as BABYLON from '@babylonjs/core';

/**
 * CoordinateMapper - guarantees 1:1 coordinate sync between TacticalView and InGameView.
 *
 * Phase 2 baseline policy:
 * - Identity mapping (no scale/offset)
 * - Encapsulated as a class to prevent future ad-hoc conversions.
 */
export class CoordinateMapper {
    tacticalToInGame(v: BABYLON.Vector3): BABYLON.Vector3 {
        return v.clone();
    }

    inGameToTactical(v: BABYLON.Vector3): BABYLON.Vector3 {
        return v.clone();
    }
}

