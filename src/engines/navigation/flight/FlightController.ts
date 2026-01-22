/**
 * FlightController - Phase 3 Ace Combat Style Flight System
 *
 * Core Principles:
 * - Pure Path3D interpolation (NO Dijkstra)
 * - Ace Combat-like chase camera experience
 * - Banking based on path curvature
 * - Speed-driven FOV for immersion
 * - 2.5D visual protection (±15° Y-axis constraint)
 *
 * ❌ ABSOLUTELY FORBIDDEN:
 * - Any pathfinding algorithm
 * - Any automatic route adjustment
 * - ArcRotateCamera during flight
 * - Banking based on input direction
 * - Any Legacy system reference
 */

import * as BABYLON from '@babylonjs/core';
import { AceCombatChaseCamera } from './AceCombatChaseCamera';

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
 * Curvature sample for banking calculation
 */
interface TangentSample {
    tangent: BABYLON.Vector3;
    t: number;
}

/**
 * FlightController - Ace Combat style flight execution
 *
 * Design Philosophy:
 * "Fate is chosen, not computed. The flight follows the chosen path with style."
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
            maxBankAngle: config.maxBankAngle ?? 0.5, // ~29°
            bankSmoothing: config.bankSmoothing ?? 0.05,
        };

        // Create chase camera
        this.chaseCamera = new AceCombatChaseCamera(scene, {
            offset: new BABYLON.Vector3(0, 2.5, -6),
            lookAheadDistance: 4,
            baseFov: 0.8,
            maxFov: 1.15,
            fovLerpSpeed: 0.04,
            rollDamping: 0.025,
            maxCameraRoll: 0.25,
            positionSmoothing: 0.06,
            maxYAxisDeviation: 0.26, // ~15°
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
     */
    initialize(character: BABYLON.AbstractMesh, path: BABYLON.Path3D): void {
        if (this.disposed) return;

        this.character = character;
        this.path3D = path;
        this.currentT = 0;
        this.currentSpeed = this.config.baseSpeed;
        this.currentBankAngle = 0;
        this.tangentSamples = [];

        // Calculate total path length for speed-based timing
        this.totalPathLength = this.calculatePathLength(path);

        // Position character at start
        const startPos = path.getPointAt(0);
        character.position.copyFrom(startPos);

        // Ensure rotationQuaternion is initialized
        if (!character.rotationQuaternion) {
            character.rotationQuaternion = BABYLON.Quaternion.Identity();
        }

        // Orient character along path
        const startTangent = path.getTangentAt(0);
        this.orientCharacterImmediate(startTangent);

        // Set camera speed range
        this.chaseCamera?.setSpeedRange(this.config.baseSpeed, this.config.maxSpeed);

        console.log(`[FlightController] Initialized: path length = ${this.totalPathLength.toFixed(2)}, base speed = ${this.config.baseSpeed}`);
    }

    /**
     * Start flight execution
     * Returns promise that resolves when flight completes or aborts
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
            this.startTime = performance.now();

            // Activate chase camera
            if (this.chaseCamera && this.character) {
                // Create a TransformNode for camera to follow
                const followNode = this.character as unknown as BABYLON.TransformNode;
                this.chaseCamera.activate(followNode, this.path3D);
            }

            // Start flight animation
            this.flightObserver = this.scene.onBeforeRenderObservable.add(() => {
                this.updateFlight();
            });

            this.callbacks.onStart?.();
            console.log('[FlightController] Flight started (Ace Combat mode)');
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

        // Get position and tangent at current t
        const position = this.path3D.getPointAt(this.currentT);
        const tangent = this.path3D.getTangentAt(this.currentT);

        // Move character
        this.character.position.copyFrom(position);

        // Calculate banking from path curvature
        const banking = this.calculateBanking(tangent);

        // Orient character with banking
        this.orientCharacterWithBanking(tangent, banking, deltaTime);

        // Notify progress
        this.callbacks.onProgress?.(this.currentT);

        // Check completion
        if (this.currentT >= 1) {
            this.completeFlight();
        }
    }

    /**
     * Update speed with acceleration
     */
    private updateSpeed(deltaTime: number): void {
        // Accelerate towards max speed
        const targetSpeed = this.config.maxSpeed;
        this.currentSpeed = BABYLON.Scalar.Lerp(
            this.currentSpeed,
            targetSpeed,
            this.config.acceleration * deltaTime
        );

        this.callbacks.onSpeedChange?.(this.currentSpeed);
    }

    /**
     * Calculate banking based on path curvature
     * Uses smoothed tangent delta over multiple samples
     */
    private calculateBanking(currentTangent: BABYLON.Vector3): number {
        // Add current sample
        this.tangentSamples.push({
            tangent: currentTangent.clone(),
            t: this.currentT,
        });

        // Keep only recent samples
        while (this.tangentSamples.length > this.TANGENT_SAMPLE_COUNT) {
            this.tangentSamples.shift();
        }

        if (this.tangentSamples.length < 2) return 0;

        // Calculate average curvature from tangent changes
        let totalCurvature = 0;
        let sampleCount = 0;

        for (let i = 1; i < this.tangentSamples.length; i++) {
            const prev = this.tangentSamples[i - 1].tangent;
            const curr = this.tangentSamples[i].tangent;

            // Cross product Y component indicates turn direction
            // Positive Y = turning left, Negative Y = turning right
            const cross = BABYLON.Vector3.Cross(prev, curr);
            totalCurvature += cross.y;
            sampleCount++;
        }

        if (sampleCount === 0) return 0;

        const avgCurvature = totalCurvature / sampleCount;

        // Scale curvature to banking angle
        // Left turn (positive curvature) = bank left (positive angle)
        // Right turn (negative curvature) = bank right (negative angle)
        return avgCurvature * this.config.bankingIntensity * 10;
    }

    /**
     * Orient character with banking applied
     */
    private orientCharacterWithBanking(
        tangent: BABYLON.Vector3,
        targetBanking: number,
        deltaTime: number
    ): void {
        if (!this.character) return;

        // Clamp target banking
        const clampedBanking = Math.max(
            -this.config.maxBankAngle,
            Math.min(this.config.maxBankAngle, targetBanking)
        );

        // Smooth banking transition
        this.currentBankAngle = BABYLON.Scalar.Lerp(
            this.currentBankAngle,
            clampedBanking,
            this.config.bankSmoothing + deltaTime * 2
        );

        // Calculate base rotation from tangent
        const forward = tangent.normalize();
        const baseRotation = BABYLON.Quaternion.FromLookDirectionLH(forward, BABYLON.Vector3.Up());

        // Apply banking (roll around forward axis)
        const bankRotation = BABYLON.Quaternion.RotationAxis(forward, this.currentBankAngle);
        const finalRotation = baseRotation.multiply(bankRotation);

        // Get current rotation
        const currentRotation = this.character.rotationQuaternion ?? BABYLON.Quaternion.Identity();

        // Smooth interpolation
        const smoothedRotation = BABYLON.Quaternion.Slerp(
            currentRotation,
            finalRotation,
            this.config.rotationSmoothing + deltaTime * 2
        );

        this.character.rotationQuaternion = smoothedRotation;
    }

    /**
     * Immediate character orientation (no smoothing)
     */
    private orientCharacterImmediate(tangent: BABYLON.Vector3): void {
        if (!this.character) return;

        const forward = tangent.normalize();
        this.character.rotationQuaternion = BABYLON.Quaternion.FromLookDirectionLH(
            forward,
            BABYLON.Vector3.Up()
        );
    }

    /**
     * Complete flight and cleanup
     */
    private completeFlight(): void {
        // Stop animation
        if (this.flightObserver) {
            this.scene.onBeforeRenderObservable.remove(this.flightObserver);
            this.flightObserver = null;
        }

        this.isFlying = false;

        const totalTimeMs = performance.now() - this.startTime;
        const finalPosition = this.character?.position.clone() ?? BABYLON.Vector3.Zero();

        const result: FlightResult = {
            completed: !this.aborted && this.currentT >= 1,
            totalTimeMs,
            finalPosition,
            aborted: this.aborted,
        };

        console.log(`[FlightController] Flight ${result.completed ? 'completed' : 'aborted'} in ${Math.round(totalTimeMs)}ms`);

        // Deactivate chase camera
        this.chaseCamera?.deactivate();

        // Reset banking
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
