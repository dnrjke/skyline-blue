/**
 * FlightController - Flight Integrity & Orientation System
 *
 * Core Principles:
 * - Deterministic completion: START at any point yields identical results
 * - Visual integrity: Character-Path-Camera alignment never breaks
 * - Pure Path3D interpolation (NO Dijkstra/Legacy)
 *
 * Invariants:
 * - START is completely deterministic
 * - Flight completes exactly once: Node[0] → Node[N]
 * - Path, Character, Camera share the same directional frame
 * - Legacy systems are NEVER called
 *
 * ❌ ABSOLUTELY FORBIDDEN:
 * - Legacy Path/Dijkstra calls
 * - Lerp initialization at START (breaks determinism)
 * - activeMeshes-based validation
 * - Implicit forward axis handling
 * - Path progression without completion logic
 */

import * as BABYLON from '@babylonjs/core';
import { AceCombatChaseCamera } from './AceCombatChaseCamera';

// ========== CONSTANTS ==========

/** Completion epsilon to prevent floating-point errors */
const COMPLETION_EPSILON = 0.001;

/** Minimum nodes required for flight */
const MIN_NODES_REQUIRED = 2;

// ========== INTERFACES ==========

export interface FlightControllerConfig {
    /** Base flight speed (units per second) */
    baseSpeed?: number;
    /** Max flight speed (units per second) */
    maxSpeed?: number;
    /** Acceleration rate */
    acceleration?: number;
    /** Character rotation smoothing (lerp factor per frame) */
    rotationSmoothing?: number;
    /** Character banking intensity (multiplier) */
    bankingIntensity?: number;
    /** Max character bank angle in radians */
    maxBankAngle?: number;
    /** Bank smoothing factor */
    bankSmoothing?: number;
    /** Bank recovery speed when returning to straight flight */
    bankRecoverySpeed?: number;
    /** Look-ahead factor for smooth heading on curves */
    lookAheadFactor?: number;
    /** Camera follow distance */
    cameraFollowDistance?: number;
    /** Camera height offset */
    cameraHeight?: number;
    /** Camera damping factor */
    cameraDamping?: number;
}

export interface FlightResult {
    /** Whether flight completed successfully */
    completed: boolean;
    /** Total flight time in milliseconds */
    totalTimeMs: number;
    /** Final position */
    finalPosition: BABYLON.Vector3;
    /** Whether flight was aborted */
    aborted: boolean;
}

export interface FlightControllerCallbacks {
    /** Called each frame with progress (0-1) */
    onProgress?: (progress: number) => void;
    /** Called when flight starts */
    onStart?: () => void;
    /** Called when flight completes */
    onComplete?: (result: FlightResult) => void;
    /** Called with current speed */
    onSpeedChange?: (speed: number) => void;
}

/**
 * Tangent sample for curvature-based banking
 */
interface TangentSample {
    tangent: BABYLON.Vector3;
    t: number;
}

/**
 * FlightController - Deterministic, Visual-First Flight System
 *
 * Design Philosophy:
 * "Flight quality is measured by visual consistency, not technical metrics."
 */
export class FlightController {
    private scene: BABYLON.Scene;
    private config: Required<FlightControllerConfig>;

    // Flight state
    private character: BABYLON.AbstractMesh | null = null;
    private path3D: BABYLON.Path3D | null = null;
    private currentT: number = 0;
    private currentSpeed: number = 0;
    private isFlying: boolean = false;
    private aborted: boolean = false;

    // Banking state
    private currentBankAngle: number = 0;
    private tangentSamples: TangentSample[] = [];
    private readonly TANGENT_SAMPLE_COUNT = 5;

    // Animation
    private flightObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private startTime: number = 0;
    private totalPathLength: number = 0;

    // Camera
    private chaseCamera: AceCombatChaseCamera | null = null;

    // Callbacks
    private callbacks: FlightControllerCallbacks = {};
    private resolvePromise: ((result: FlightResult) => void) | null = null;

    // Disposed flag
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: FlightControllerConfig = {}) {
        this.scene = scene;
        this.config = {
            baseSpeed: config.baseSpeed ?? 5,
            maxSpeed: config.maxSpeed ?? 12,
            acceleration: config.acceleration ?? 2,
            rotationSmoothing: config.rotationSmoothing ?? 0.08,
            bankingIntensity: config.bankingIntensity ?? 1.5,
            maxBankAngle: config.maxBankAngle ?? 0.5,
            bankSmoothing: config.bankSmoothing ?? 0.05,
            bankRecoverySpeed: config.bankRecoverySpeed ?? 0.03,
            lookAheadFactor: config.lookAheadFactor ?? 0.15,
            cameraFollowDistance: config.cameraFollowDistance ?? 6,
            cameraHeight: config.cameraHeight ?? 2.5,
            cameraDamping: config.cameraDamping ?? 0.06,
        };

        // Create chase camera
        this.chaseCamera = new AceCombatChaseCamera(scene, {
            offset: new BABYLON.Vector3(0, this.config.cameraHeight, -this.config.cameraFollowDistance),
            lookAheadDistance: 4,
            baseFov: 0.8,
            maxFov: 1.15,
            fovLerpSpeed: 0.04,
            rollDamping: 0.025,
            maxCameraRoll: 0.25,
            positionSmoothing: this.config.cameraDamping,
            maxYAxisDeviation: 0.26,
        });
    }

    /**
     * Set callbacks
     */
    setCallbacks(callbacks: FlightControllerCallbacks): void {
        this.callbacks = callbacks;
    }

    /**
     * Initialize flight with character and path
     *
     * DETERMINISTIC INITIALIZATION:
     * - Validates node count (minimum 2)
     * - Snaps character to Node[0]
     * - Forces rotation to Node[0] → Node[1] direction
     * - NO lerp, NO interpolation at init
     */
    initialize(character: BABYLON.AbstractMesh, path: BABYLON.Path3D): void {
        if (this.disposed) return;

        // ===== NODE VALIDATION (1-1) =====
        const points = path.getPoints();
        if (points.length < MIN_NODES_REQUIRED) {
            throw new Error(`Flight requires at least ${MIN_NODES_REQUIRED} nodes, got ${points.length}`);
        }

        this.character = character;
        this.path3D = path;
        this.currentT = 0;
        this.currentSpeed = this.config.baseSpeed;
        this.currentBankAngle = 0;
        this.tangentSamples = [];

        // Calculate total path length
        this.totalPathLength = this.calculatePathLength(path);

        // ===== CHARACTER RESET - SNAP (1-2) =====
        const startPos = points[0];
        const nextPos = points[1];

        // SNAP position (no interpolation)
        character.position.copyFrom(startPos);

        // ===== FORWARD AXIS & ROTATION (1-3) =====
        // Calculate initial direction: Node[0] → Node[1]
        const initialDirection = nextPos.subtract(startPos).normalize();

        // Ensure rotationQuaternion is initialized
        if (!character.rotationQuaternion) {
            character.rotationQuaternion = BABYLON.Quaternion.Identity();
        }

        // SNAP rotation (no interpolation) - using explicit forward axis
        character.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(
            initialDirection,
            BABYLON.Vector3.Up()
        );

        // Set camera speed range
        this.chaseCamera?.setSpeedRange(this.config.baseSpeed, this.config.maxSpeed);

        console.log(`[FlightController] Initialized: path=${this.totalPathLength.toFixed(2)}, nodes=${points.length}`);
    }

    /**
     * Start flight execution
     *
     * DETERMINISTIC START:
     * - Camera snaps to initial position (no lerp)
     * - All state is reset before flight loop begins
     */
    startFlight(): Promise<FlightResult> {
        return new Promise((resolve) => {
            if (this.disposed || !this.character || !this.path3D) {
                resolve({
                    completed: false,
                    totalTimeMs: 0,
                    finalPosition: BABYLON.Vector3.Zero(),
                    aborted: true,
                });
                return;
            }

            this.resolvePromise = resolve;
            this.isFlying = true;
            this.aborted = false;
            this.currentT = 0;
            this.currentSpeed = this.config.baseSpeed;
            this.currentBankAngle = 0;
            this.tangentSamples = [];
            this.startTime = performance.now();

            // ===== CAMERA INITIALIZATION - SNAP (1-4) =====
            if (this.chaseCamera && this.character) {
                const followNode = this.character as unknown as BABYLON.TransformNode;
                this.chaseCamera.activate(followNode, this.path3D);

                // Force initial camera snap (no damping for first frame)
                this.chaseCamera.forceSnapToTarget();
            }

            // Start flight animation loop
            this.flightObserver = this.scene.onBeforeRenderObservable.add(() => {
                this.updateFlight();
            });

            this.callbacks.onStart?.();
            console.log('[FlightController] Flight started (Deterministic Mode)');
        });
    }

    /**
     * Get current progress (0-1)
     */
    getProgress(): number {
        return this.currentT;
    }

    /**
     * Get current speed
     */
    getCurrentSpeed(): number {
        return this.currentSpeed;
    }

    /**
     * Check if currently flying
     */
    isFlightActive(): boolean {
        return this.isFlying;
    }

    /**
     * Abort flight
     */
    abort(): void {
        if (!this.isFlying) return;
        this.aborted = true;
        this.completeFlight();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        this.abort();

        if (this.chaseCamera) {
            this.chaseCamera.dispose();
            this.chaseCamera = null;
        }
    }

    /**
     * Main flight update loop
     */
    private updateFlight(): void {
        if (!this.isFlying || !this.character || !this.path3D) return;

        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;

        // Update speed (gradual acceleration)
        this.updateSpeed(deltaTime);

        // Calculate distance to move this frame
        const distanceThisFrame = this.currentSpeed * deltaTime;
        const tDelta = distanceThisFrame / this.totalPathLength;

        // Update progress
        this.currentT = Math.min(this.currentT + tDelta, 1);

        // ===== PATH FOLLOWING (2-1, 2-2) =====
        const position = this.path3D.getPointAt(this.currentT);
        const tangent = this.path3D.getTangentAt(this.currentT).normalize();

        // Move character
        this.character.position.copyFrom(position);

        // ===== BANKING CALCULATION (4) =====
        const curvature = this.calculateCurvature(tangent);
        const targetBank = this.calculateTargetBank(curvature);

        // ===== FORWARD ALIGNMENT WITH LOOK-AHEAD (2-2, 2-3) =====
        this.updateCharacterOrientation(tangent, targetBank, deltaTime);

        // Notify progress
        this.callbacks.onProgress?.(this.currentT);

        // ===== COMPLETION CHECK (5-1) =====
        if (this.currentT >= 1.0 - COMPLETION_EPSILON) {
            this.completeFlight();
        }
    }

    /**
     * Update speed with acceleration
     */
    private updateSpeed(deltaTime: number): void {
        const targetSpeed = this.config.maxSpeed;
        this.currentSpeed = BABYLON.Scalar.Lerp(
            this.currentSpeed,
            targetSpeed,
            this.config.acceleration * deltaTime
        );
        this.callbacks.onSpeedChange?.(this.currentSpeed);
    }

    /**
     * Calculate curvature from tangent samples
     */
    private calculateCurvature(currentTangent: BABYLON.Vector3): number {
        this.tangentSamples.push({
            tangent: currentTangent.clone(),
            t: this.currentT,
        });

        while (this.tangentSamples.length > this.TANGENT_SAMPLE_COUNT) {
            this.tangentSamples.shift();
        }

        if (this.tangentSamples.length < 2) return 0;

        let totalCurvature = 0;
        let sampleCount = 0;

        for (let i = 1; i < this.tangentSamples.length; i++) {
            const prev = this.tangentSamples[i - 1].tangent;
            const curr = this.tangentSamples[i].tangent;
            const cross = BABYLON.Vector3.Cross(prev, curr);
            totalCurvature += cross.y;
            sampleCount++;
        }

        return sampleCount > 0 ? totalCurvature / sampleCount : 0;
    }

    /**
     * Calculate target bank angle with recovery logic
     * On straight sections, gradually returns to zero
     */
    private calculateTargetBank(curvature: number): number {
        // Scale curvature to banking angle
        const rawBank = curvature * this.config.bankingIntensity * 10;

        // Clamp to max bank angle
        const clampedBank = Math.max(
            -this.config.maxBankAngle,
            Math.min(this.config.maxBankAngle, rawBank)
        );

        // ===== BANKING RECOVERY (4) =====
        // If curvature is low (straight section), recover towards zero
        const curvatureThreshold = 0.01;
        if (Math.abs(curvature) < curvatureThreshold) {
            // Gradual recovery to zero - NO instant snap
            return BABYLON.Scalar.Lerp(this.currentBankAngle, 0, this.config.bankRecoverySpeed);
        }

        return clampedBank;
    }

    /**
     * Update character orientation with look-ahead and banking
     */
    private updateCharacterOrientation(
        tangent: BABYLON.Vector3,
        targetBank: number,
        deltaTime: number
    ): void {
        if (!this.character || !this.path3D) return;

        // ===== LOOK-AHEAD FOR SMOOTH HEADING (2-3) =====
        // On curves, predict heading direction slightly ahead
        const lookAheadT = Math.min(this.currentT + 0.02, 1.0);
        const lookAheadTangent = this.path3D.getTangentAt(lookAheadT).normalize();

        // Blend current tangent with look-ahead for smooth transitions
        const blendedTangent = BABYLON.Vector3.Lerp(
            tangent,
            lookAheadTangent,
            this.config.lookAheadFactor
        ).normalize();

        // Calculate base rotation from blended tangent
        const baseRotation = BABYLON.Quaternion.FromLookDirectionLH(
            blendedTangent,
            BABYLON.Vector3.Up()
        );

        // ===== SMOOTH BANKING TRANSITION =====
        // Smooth banking - never instant snap
        this.currentBankAngle = BABYLON.Scalar.Lerp(
            this.currentBankAngle,
            targetBank,
            this.config.bankSmoothing + deltaTime * 2
        );

        // Apply banking (roll around forward axis)
        const bankRotation = BABYLON.Quaternion.RotationAxis(blendedTangent, this.currentBankAngle);
        const finalRotation = baseRotation.multiply(bankRotation);

        // ===== SMOOTH ROTATION INTERPOLATION =====
        const currentRotation = this.character.rotationQuaternion ?? BABYLON.Quaternion.Identity();
        const smoothedRotation = BABYLON.Quaternion.Slerp(
            currentRotation,
            finalRotation,
            this.config.rotationSmoothing + deltaTime * 2
        );

        this.character.rotationQuaternion = smoothedRotation;
    }

    /**
     * Complete flight and cleanup
     *
     * COMPLETION SEQUENCE (5-2):
     * 1. Deactivate FlightController
     * 2. Lock character/camera final state
     * 3. Emit MissionResult event
     * 4. Enable return to Design Phase
     */
    private completeFlight(): void {
        // Stop animation loop
        if (this.flightObserver) {
            this.scene.onBeforeRenderObservable.remove(this.flightObserver);
            this.flightObserver = null;
        }

        this.isFlying = false;

        const totalTimeMs = performance.now() - this.startTime;
        const finalPosition = this.character?.position.clone() ?? BABYLON.Vector3.Zero();

        const result: FlightResult = {
            completed: !this.aborted && this.currentT >= 1.0 - COMPLETION_EPSILON,
            totalTimeMs,
            finalPosition,
            aborted: this.aborted,
        };

        console.log(`[FlightController] Flight ${result.completed ? 'COMPLETED' : 'ABORTED'} in ${Math.round(totalTimeMs)}ms (t=${this.currentT.toFixed(4)})`);

        // Deactivate chase camera
        this.chaseCamera?.deactivate();

        // Reset banking state
        this.currentBankAngle = 0;
        this.tangentSamples = [];

        // Notify callbacks
        this.callbacks.onComplete?.(result);
        this.resolvePromise?.(result);
        this.resolvePromise = null;
    }

    /**
     * Calculate total path length
     */
    private calculatePathLength(path: BABYLON.Path3D): number {
        const points = path.getPoints();
        let length = 0;

        for (let i = 1; i < points.length; i++) {
            length += BABYLON.Vector3.Distance(points[i - 1], points[i]);
        }

        return length;
    }
}
