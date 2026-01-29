import * as BABYLON from '@babylonjs/core';

export type DebugCameraView = 'perspective' | 'top' | 'front' | 'right' | 'free';

interface DebugCameraConfig {
    name: string;
    type: 'arc' | 'free' | 'ortho';
    position: BABYLON.Vector3;
    target: BABYLON.Vector3;
    orthoSize?: number;
}

const CAMERA_CONFIGS: Record<DebugCameraView, DebugCameraConfig> = {
    perspective: {
        name: 'DebugCam_Perspective',
        type: 'arc',
        position: new BABYLON.Vector3(0, 15, -30),
        target: new BABYLON.Vector3(0, 0, 0),
    },
    top: {
        name: 'DebugCam_Top',
        type: 'ortho',
        position: new BABYLON.Vector3(0, 50, 0.001),
        target: new BABYLON.Vector3(0, 0, 0),
        orthoSize: 20,
    },
    front: {
        name: 'DebugCam_Front',
        type: 'ortho',
        position: new BABYLON.Vector3(0, 5, -50),
        target: new BABYLON.Vector3(0, 5, 0),
        orthoSize: 15,
    },
    right: {
        name: 'DebugCam_Right',
        type: 'ortho',
        position: new BABYLON.Vector3(50, 5, 0),
        target: new BABYLON.Vector3(0, 5, 0),
        orthoSize: 15,
    },
    free: {
        name: 'DebugCam_Free',
        type: 'free',
        position: new BABYLON.Vector3(10, 10, -20),
        target: new BABYLON.Vector3(0, 0, 0),
    },
};

/**
 * DebugCameraManager - Multiple camera views for debugging
 *
 * Provides Blender-like ortho views (Top, Front, Right) and free perspective camera.
 * Cameras are created on-demand and can be switched via switchTo().
 */
export class DebugCameraManager {
    private scene: BABYLON.Scene;
    private cameras: Map<DebugCameraView, BABYLON.Camera> = new Map();
    private currentView: DebugCameraView = 'perspective';
    private previousCamera: BABYLON.Camera | null = null;
    private cameraControlEnabled: boolean = true;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    /**
     * Switch to a specific debug camera view
     */
    switchTo(view: DebugCameraView): BABYLON.Camera {
        // Store previous camera on first switch
        if (!this.previousCamera && this.scene.activeCamera) {
            this.previousCamera = this.scene.activeCamera;
        }

        let camera = this.cameras.get(view);
        if (!camera) {
            camera = this.createCamera(view);
            this.cameras.set(view, camera);
        }

        // Detach current camera controls
        this.scene.activeCamera?.detachControl();

        // Activate new camera
        this.scene.activeCamera = camera;
        this.currentView = view;

        if (this.cameraControlEnabled) {
            this.attachControl(camera);
        }

        console.log(`[DebugCamera] Switched to: ${view}`);
        return camera;
    }

    /**
     * Restore original camera
     */
    restore(): void {
        if (this.previousCamera && !this.previousCamera.isDisposed()) {
            this.scene.activeCamera?.detachControl();
            this.scene.activeCamera = this.previousCamera;
            if (this.cameraControlEnabled) {
                this.attachControl(this.previousCamera);
            }
            console.log('[DebugCamera] Restored original camera');
        }
    }

    /**
     * Toggle camera controls on/off
     */
    setCameraControlEnabled(enabled: boolean): void {
        this.cameraControlEnabled = enabled;
        const cam = this.scene.activeCamera;
        if (!cam) return;

        if (enabled) {
            this.attachControl(cam);
        } else {
            cam.detachControl();
        }
        console.log(`[DebugCamera] Camera control: ${enabled ? 'ON' : 'OFF'}`);
    }

    getCameraControlEnabled(): boolean {
        return this.cameraControlEnabled;
    }

    getCurrentView(): DebugCameraView {
        return this.currentView;
    }

    /**
     * Cycle through views: perspective -> top -> front -> right -> free -> perspective
     */
    cycleNext(): DebugCameraView {
        const views: DebugCameraView[] = ['perspective', 'top', 'front', 'right', 'free'];
        const idx = views.indexOf(this.currentView);
        const next = views[(idx + 1) % views.length];
        this.switchTo(next);
        return next;
    }

    dispose(): void {
        for (const cam of this.cameras.values()) {
            cam.dispose();
        }
        this.cameras.clear();
        this.previousCamera = null;
    }

    private createCamera(view: DebugCameraView): BABYLON.Camera {
        const config = CAMERA_CONFIGS[view];
        let camera: BABYLON.Camera;

        if (config.type === 'ortho') {
            // Orthographic camera
            const orthoCam = new BABYLON.FreeCamera(config.name, config.position.clone(), this.scene);
            orthoCam.setTarget(config.target.clone());
            orthoCam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

            const aspect = this.scene.getEngine().getAspectRatio(orthoCam);
            const size = config.orthoSize ?? 15;
            orthoCam.orthoLeft = -size * aspect;
            orthoCam.orthoRight = size * aspect;
            orthoCam.orthoTop = size;
            orthoCam.orthoBottom = -size;

            camera = orthoCam;
        } else if (config.type === 'arc') {
            // ArcRotate for perspective
            const dist = config.position.length();
            const arcCam = new BABYLON.ArcRotateCamera(
                config.name,
                -Math.PI / 2,
                Math.PI / 3,
                dist,
                config.target.clone(),
                this.scene
            );
            arcCam.lowerRadiusLimit = 5;
            arcCam.upperRadiusLimit = 100;
            arcCam.wheelPrecision = 20;
            camera = arcCam;
        } else {
            // Free camera
            const freeCam = new BABYLON.FreeCamera(config.name, config.position.clone(), this.scene);
            freeCam.setTarget(config.target.clone());
            freeCam.speed = 2;
            freeCam.keysUp = [87]; // W
            freeCam.keysDown = [83]; // S
            freeCam.keysLeft = [65]; // A
            freeCam.keysRight = [68]; // D
            camera = freeCam;
        }

        // Don't auto-attach - we handle this manually
        return camera;
    }

    private attachControl(camera: BABYLON.Camera): void {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (canvas) {
            camera.attachControl(canvas, true);
        }
    }
}
