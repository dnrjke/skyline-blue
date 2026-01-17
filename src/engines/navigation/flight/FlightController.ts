/**
 * FlightController - Phase 3 Path3D Based Flight
 *
 * Core Principles:
 * - Pure Path3D interpolation (NO Dijkstra)
 * - NO automatic path correction
 * - Character follows manually authored Fate Line
 *
 * ❌ ABSOLUTELY FORBIDDEN:
 * - Any pathfinding algorithm
 * - Any automatic route adjustment
 * - Any legacy system reference
 */

import * as BABYLON from '@babylonjs/core';

export interface FlightControllerConfig {
    /** Flight speed (units per second) */
    speed?: number;
    /** Smooth rotation (lerp factor per frame) */
    rotationSmoothing?: number;
    /** Camera follow offset */
    cameraOffset?: BABYLON.Vector3;
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
}

/**
 * FlightController - executes flight along Path3D
 *
 * Design Philosophy:
 * "Fate is chosen, not computed. The flight follows the chosen path exactly."
 */
export class FlightController {
    private scene: BABYLON.Scene;
    private config: Required<FlightControllerConfig>;

    // Flight state
    private character: BABYLON.AbstractMesh | null = null;
    private path3D: BABYLON.Path3D | null = null;
    private currentT: number = 0;
    private isFlying: boolean = false;
    private aborted: boolean = false;

    // Animation
    private flightObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private startTime: number = 0;
    private totalPathLength: number = 0;

    // Camera
    private chaseCamera: BABYLON.FollowCamera | null = null;
    private previousCamera: BABYLON.Camera | null = null;

    // Callbacks
    private callbacks: FlightControllerCallbacks = {};
    private resolvePromise: ((result: FlightResult) => void) | null = null;

    // Disposed flag
    private disposed: boolean = false;

    constructor(scene: BABYLON.Scene, config: FlightControllerConfig = {}) {
        this.scene = scene;
        this.config = {
            speed: config.speed ?? 5,
            rotationSmoothing: config.rotationSmoothing ?? 0.1,
            cameraOffset: config.cameraOffset ?? new BABYLON.Vector3(0, 2, -6),
        };
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

        // Calculate total path length for speed-based timing
        this.totalPathLength = this.calculatePathLength(path);

        // Position character at start
        const startPos = path.getPointAt(0);
        character.position.copyFrom(startPos);

        // Orient character along path
        const startTangent = path.getTangentAt(0);
        this.orientCharacter(startTangent);

        console.log(`[FlightController] Initialized with path length: ${this.totalPathLength.toFixed(2)}`);
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
            this.startTime = performance.now();

            // Setup chase camera
            this.setupChaseCamera();

            // Start flight animation
            this.flightObserver = this.scene.onBeforeRenderObservable.add(() => {
                this.updateFlight();
            });

            this.callbacks.onStart?.();
            console.log('[FlightController] Flight started');
        });
    }

    /**
     * Get current progress (0-1)
     */
    getProgress(): number {
        return this.currentT;
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
        this.restorePreviousCamera();

        if (this.chaseCamera) {
            this.chaseCamera.dispose();
            this.chaseCamera = null;
        }
    }

    private updateFlight(): void {
        if (!this.isFlying || !this.character || !this.path3D) return;

        const deltaTime = this.scene.getEngine().getDeltaTime() / 1000;

        // Calculate distance to move this frame
        const distanceThisFrame = this.config.speed * deltaTime;
        const tDelta = distanceThisFrame / this.totalPathLength;

        // Update progress
        this.currentT = Math.min(this.currentT + tDelta, 1);

        // Get position and tangent at current t
        const position = this.path3D.getPointAt(this.currentT);
        const tangent = this.path3D.getTangentAt(this.currentT);

        // Move character
        this.character.position.copyFrom(position);

        // Smooth rotation
        this.orientCharacter(tangent);

        // Notify progress
        this.callbacks.onProgress?.(this.currentT);

        // Check completion
        if (this.currentT >= 1) {
            this.completeFlight();
        }
    }

    private orientCharacter(tangent: BABYLON.Vector3): void {
        if (!this.character) return;

        // Calculate target rotation
        const forward = tangent.normalize();
        const targetRotation = BABYLON.Quaternion.FromLookDirectionLH(forward, BABYLON.Vector3.Up());

        // Get current rotation
        const currentRotation = this.character.rotationQuaternion
            ?? BABYLON.Quaternion.FromEulerAngles(
                this.character.rotation.x,
                this.character.rotation.y,
                this.character.rotation.z
            );

        // Smooth interpolation
        const smoothedRotation = BABYLON.Quaternion.Slerp(
            currentRotation,
            targetRotation,
            this.config.rotationSmoothing
        );

        this.character.rotationQuaternion = smoothedRotation;
    }

    private setupChaseCamera(): void {
        if (!this.character) return;

        // Store previous camera
        this.previousCamera = this.scene.activeCamera;

        // Create follow camera
        this.chaseCamera = new BABYLON.FollowCamera(
            'FlightChaseCamera',
            this.character.position.clone(),
            this.scene
        );

        this.chaseCamera.radius = this.config.cameraOffset.length();
        this.chaseCamera.heightOffset = this.config.cameraOffset.y;
        this.chaseCamera.rotationOffset = 180; // Behind character
        this.chaseCamera.cameraAcceleration = 0.1;
        this.chaseCamera.maxCameraSpeed = 20;
        this.chaseCamera.lockedTarget = this.character;

        // Activate chase camera
        this.scene.activeCamera = this.chaseCamera;

        console.log('[FlightController] Chase camera activated');
    }

    private restorePreviousCamera(): void {
        if (this.previousCamera && !this.previousCamera.isDisposed()) {
            this.scene.activeCamera = this.previousCamera;
        }
        this.previousCamera = null;

        if (this.chaseCamera) {
            this.chaseCamera.dispose();
            this.chaseCamera = null;
        }
    }

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

        // Restore camera
        this.restorePreviousCamera();

        // Notify callbacks
        this.callbacks.onComplete?.(result);
        this.resolvePromise?.(result);
        this.resolvePromise = null;
    }

    private calculatePathLength(path: BABYLON.Path3D): number {
        const points = path.getPoints();
        let length = 0;

        for (let i = 1; i < points.length; i++) {
            length += BABYLON.Vector3.Distance(points[i - 1], points[i]);
        }

        return length;
    }
}
