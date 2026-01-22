/**
 * AceCombatChaseCamera - Ace Combat Style Chase Camera
 *
 * Core Features:
 * - UniversalCamera following character TransformNode
 * - Banking based on Path3D curvature (smoothed tangent delta)
 * - Speed-driven FOV (radians)
 * - 2.5D visual protection (±15° Y-axis constraint)
 *
 * CAMERA ALIGNMENT RULES (Requirement 8):
 * - Camera tracks character's FORWARD + ORIENTATION (not just position)
 * - Camera position = character.position - forward * distance + up * height
 * - Camera setTarget = character.position (look at character)
 * - At START, camera SNAPS to aligned position (no lerp)
 *
 * ❌ FORBIDDEN:
 * - ArcRotateCamera during flight
 * - Direct mesh parenting with full rotation inheritance
 * - Banking based on input direction
 * - Any Legacy pathfinding logic
 */

import * as BABYLON from '@babylonjs/core';

export interface AceCombatCameraConfig {
    /** Camera offset from character (default: Vector3(0, 2, -5)) */
    offset: BABYLON.Vector3;
    /** Look-ahead distance along path (default: 3) */
    lookAheadDistance: number;
    /** Base FOV in radians (default: 0.8) */
    baseFov: number;
    /** Max FOV in radians at max speed (default: 1.2) */
    maxFov: number;
    /** FOV lerp speed (default: 0.05) */
    fovLerpSpeed: number;
    /** Camera roll damping factor (default: 0.03) */
    rollDamping: number;
    /** Max camera roll in radians (default: 0.3 ~ 17°) */
    maxCameraRoll: number;
    /** Position smoothing factor (default: 0.08) */
    positionSmoothing: number;
    /** 2.5D Y-axis constraint in radians (default: 0.26 ~ 15°) */
    maxYAxisDeviation: number;
}

const DEFAULT_CONFIG: AceCombatCameraConfig = {
    offset: new BABYLON.Vector3(0, 2, -5),
    lookAheadDistance: 3,
    baseFov: 0.8,
    maxFov: 1.2,
    fovLerpSpeed: 0.05,
    rollDamping: 0.03,
    maxCameraRoll: 0.3, // ~17°
    positionSmoothing: 0.08,
    maxYAxisDeviation: 0.26, // ~15°
};

/**
 * Curvature sample for banking calculation
 */
interface CurvatureSample {
    tangent: BABYLON.Vector3;
    timestamp: number;
}

/**
 * AceCombatChaseCamera - High-speed immersive chase camera
 */
export class AceCombatChaseCamera {
    private scene: BABYLON.Scene;
    private config: AceCombatCameraConfig;

    // Camera
    private camera: BABYLON.UniversalCamera;
    private previousCamera: BABYLON.Camera | null = null;

    // Target tracking
    private targetNode: BABYLON.TransformNode | null = null;

    // State
    private currentRoll: number = 0;
    private currentFov: number;
    private targetPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero();
    private targetLookAt: BABYLON.Vector3 = BABYLON.Vector3.Zero();

    // Curvature tracking for smooth banking
    private curvatureSamples: CurvatureSample[] = [];
    private readonly MAX_SAMPLES = 5;

    // Speed tracking for FOV
    private lastPosition: BABYLON.Vector3 = BABYLON.Vector3.Zero();
    private currentSpeed: number = 0;
    private baseSpeed: number = 5;
    private maxSpeed: number = 15;

    // Animation observer
    private updateObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

    // Disposed flag
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: Partial<AceCombatCameraConfig> = {}) {
        this.scene = scene;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.currentFov = this.config.baseFov;

        // Create UniversalCamera (NOT ArcRotateCamera)
        this.camera = new BABYLON.UniversalCamera(
            'AceCombatChaseCamera',
            BABYLON.Vector3.Zero(),
            scene
        );

        // Disable all user inputs during flight
        this.camera.inputs.clear();

        // Set initial FOV
        this.camera.fov = this.currentFov;

        console.log('[AceCombatChaseCamera] Created');
    }

    /**
     * Activate the chase camera
     * @param target The TransformNode to follow
     * @param _path Reserved for future path-based look-ahead (currently unused)
     */
    activate(target: BABYLON.TransformNode, _path: BABYLON.Path3D): void {
        if (this.disposed) return;

        this.targetNode = target;

        // Store previous camera
        this.previousCamera = this.scene.activeCamera;

        // Initialize tracking state
        this.lastPosition = target.position.clone();
        this.curvatureSamples = [];
        this.currentRoll = 0;
        this.currentFov = this.config.baseFov;

        // Initialize camera position
        this.updateCameraImmediate();

        // Activate this camera
        this.scene.activeCamera = this.camera;

        // Start update loop
        this.updateObserver = this.scene.onBeforeRenderObservable.add(() => {
            this.update();
        });

        console.log('[AceCombatChaseCamera] Activated');
    }

    /**
     * Deactivate and restore previous camera
     */
    deactivate(): void {
        // Stop update loop
        if (this.updateObserver) {
            this.scene.onBeforeRenderObservable.remove(this.updateObserver);
            this.updateObserver = null;
        }

        // Smoothly reset FOV and roll
        this.currentFov = this.config.baseFov;
        this.currentRoll = 0;
        this.camera.fov = this.currentFov;

        // Restore previous camera
        if (this.previousCamera && !this.previousCamera.isDisposed()) {
            this.scene.activeCamera = this.previousCamera;
        }
        this.previousCamera = null;
        this.targetNode = null;

        console.log('[AceCombatChaseCamera] Deactivated');
    }

    /**
     * Set speed range for FOV calculation
     */
    setSpeedRange(baseSpeed: number, maxSpeed: number): void {
        this.baseSpeed = baseSpeed;
        this.maxSpeed = maxSpeed;
    }

    /**
     * Get the underlying camera
     */
    getCamera(): BABYLON.UniversalCamera {
        return this.camera;
    }

    /**
     * Force camera to snap to target position immediately (no damping)
     * Used for deterministic initialization at START (Requirement 8)
     *
     * This ensures:
     * - Camera position is aligned with character's forward direction
     * - No lerp/damping on first frame
     * - Curvature samples reset (no stale banking)
     * - Roll reset to zero
     */
    forceSnapToTarget(): void {
        // Reset all state that could cause initial jitter
        this.curvatureSamples = [];
        this.currentRoll = 0;
        this.currentFov = this.config.baseFov;

        if (this.targetNode) {
            this.lastPosition = this.targetNode.position.clone();
        }

        this.updateCameraImmediate();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.deactivate();
        this.camera.dispose();

        console.log('[AceCombatChaseCamera] Disposed');
    }

    /**
     * Main update loop
     */
    private update(): void {
        if (!this.targetNode || this.disposed) return;

        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;

        // Calculate current speed
        this.calculateSpeed(deltaTime);

        // Update curvature samples for banking
        this.updateCurvatureSamples();

        // Calculate banking from curvature
        const banking = this.calculateBanking();

        // Update camera roll (dampened)
        this.updateCameraRoll(banking, deltaTime);

        // Update FOV based on speed
        this.updateFov(deltaTime);

        // Calculate camera position and look-at
        this.calculateCameraTransform();

        // Apply camera transform with smoothing
        this.applyCameraTransform(deltaTime);
    }

    /**
     * Immediate camera update (no smoothing)
     */
    private updateCameraImmediate(): void {
        if (!this.targetNode) return;

        this.calculateCameraTransform();
        this.camera.position.copyFrom(this.targetPosition);
        this.camera.setTarget(this.targetLookAt);
        this.camera.fov = this.currentFov;
    }

    /**
     * Calculate current speed from position delta
     */
    private calculateSpeed(deltaTime: number): void {
        if (!this.targetNode || deltaTime <= 0) return;

        const currentPos = this.targetNode.position;
        const distance = BABYLON.Vector3.Distance(this.lastPosition, currentPos);
        this.currentSpeed = distance / deltaTime;
        this.lastPosition.copyFrom(currentPos);
    }

    /**
     * Update curvature samples for smooth banking
     */
    private updateCurvatureSamples(): void {
        if (!this.targetNode) return;

        // Get current tangent from character forward direction
        const forward = this.targetNode.forward.clone();

        this.curvatureSamples.push({
            tangent: forward,
            timestamp: performance.now(),
        });

        // Keep only recent samples
        while (this.curvatureSamples.length > this.MAX_SAMPLES) {
            this.curvatureSamples.shift();
        }
    }

    /**
     * Calculate banking from smoothed curvature
     */
    private calculateBanking(): number {
        if (this.curvatureSamples.length < 2) return 0;

        // Calculate average tangent change (curvature)
        let totalCurvature = 0;

        for (let i = 1; i < this.curvatureSamples.length; i++) {
            const prev = this.curvatureSamples[i - 1].tangent;
            const curr = this.curvatureSamples[i].tangent;

            // Cross product Y component indicates turn direction
            const cross = BABYLON.Vector3.Cross(prev, curr);
            totalCurvature += cross.y;
        }

        const avgCurvature = totalCurvature / (this.curvatureSamples.length - 1);

        // Scale curvature to banking angle
        // Positive curvature = left turn = positive roll (bank left)
        // Negative curvature = right turn = negative roll (bank right)
        const bankingScale = 2.0; // Adjust for feel
        return -avgCurvature * bankingScale;
    }

    /**
     * Update camera roll with damping
     */
    private updateCameraRoll(targetBanking: number, _deltaTime: number): void {
        // Clamp target banking
        const clampedTarget = Math.max(
            -this.config.maxCameraRoll,
            Math.min(this.config.maxCameraRoll, targetBanking)
        );

        // Smooth interpolation
        this.currentRoll = BABYLON.Scalar.Lerp(
            this.currentRoll,
            clampedTarget,
            this.config.rollDamping
        );
    }

    /**
     * Update FOV based on speed
     */
    private updateFov(_deltaTime: number): void {
        // Calculate target FOV based on speed
        const speedRatio = Math.max(0, Math.min(1,
            (this.currentSpeed - this.baseSpeed) / (this.maxSpeed - this.baseSpeed)
        ));

        const targetFov = BABYLON.Scalar.Lerp(
            this.config.baseFov,
            this.config.maxFov,
            speedRatio
        );

        // Smooth FOV transition
        this.currentFov = BABYLON.Scalar.Lerp(
            this.currentFov,
            targetFov,
            this.config.fovLerpSpeed
        );

        this.camera.fov = this.currentFov;
    }

    /**
     * Calculate camera position and look-at point
     *
     * CAMERA ALIGNMENT (Requirement 8):
     * - Uses character's FORWARD direction (from rotationQuaternion)
     * - Position = character - forward * distance + up * height
     * - LookAt = character position
     *
     * Enforces 2.5D visual protection (±15° Y-axis constraint)
     */
    private calculateCameraTransform(): void {
        if (!this.targetNode) return;

        const targetPos = this.targetNode.position;

        // Get character forward direction (from rotationQuaternion, NOT lookAt)
        // This respects the MODEL_NEEDS_FLIP correction applied in FlightController
        let charForward = this.targetNode.forward.clone();

        // ===== 2.5D VISUAL PROTECTION =====
        // Constrain camera-to-character angle to ±15° on Y axis
        // This ensures we never see the "flat" side of the 2.5D model

        // Project forward to XZ plane and normalize
        const xzForward = new BABYLON.Vector3(charForward.x, 0, charForward.z).normalize();

        // Calculate Y-axis deviation
        const deviation = Math.atan2(charForward.y, Math.sqrt(charForward.x ** 2 + charForward.z ** 2));
        const clampedDeviation = Math.max(
            -this.config.maxYAxisDeviation,
            Math.min(this.config.maxYAxisDeviation, deviation)
        );

        // Reconstruct constrained forward
        const constrainedForward = new BABYLON.Vector3(
            xzForward.x * Math.cos(clampedDeviation),
            Math.sin(clampedDeviation),
            xzForward.z * Math.cos(clampedDeviation)
        ).normalize();

        // Calculate camera offset in world space
        // Offset is applied relative to character's constrained forward direction
        const right = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), constrainedForward).normalize();
        const up = BABYLON.Vector3.Cross(constrainedForward, right).normalize();

        // Build offset position
        this.targetPosition = targetPos
            .add(constrainedForward.scale(this.config.offset.z))
            .add(up.scale(this.config.offset.y))
            .add(right.scale(this.config.offset.x));

        // Look-ahead point (slightly ahead of character along path)
        this.targetLookAt = targetPos.add(constrainedForward.scale(this.config.lookAheadDistance));
    }

    /**
     * Apply camera transform with smoothing and roll
     */
    private applyCameraTransform(_deltaTime: number): void {
        // Smooth position
        this.camera.position = BABYLON.Vector3.Lerp(
            this.camera.position,
            this.targetPosition,
            this.config.positionSmoothing
        );

        // Set look-at target
        this.camera.setTarget(this.targetLookAt);

        // Apply roll
        // For UniversalCamera, we need to apply roll via rotation
        const currentRotation = this.camera.rotation.clone();
        currentRotation.z = this.currentRoll;
        this.camera.rotation = currentRotation;
    }
}
