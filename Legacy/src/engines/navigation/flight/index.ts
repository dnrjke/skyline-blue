/**
 * Flight System - Phase 3 Ace Combat Style Execution
 *
 * This system executes flight along player-authored Fate Lines.
 * Features:
 * - Ace Combat-style chase camera
 * - Banking based on path curvature
 * - Speed-driven FOV
 * - 2.5D visual protection
 *
 * NO automatic path computation or correction.
 */

export {
    FlightController,
    type FlightControllerConfig,
    type FlightResult,
    type FlightControllerCallbacks,
} from './FlightController';

export {
    AceCombatChaseCamera,
    type AceCombatCameraConfig,
} from './AceCombatChaseCamera';
