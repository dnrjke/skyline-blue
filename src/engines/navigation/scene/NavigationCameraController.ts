import * as BABYLON from '@babylonjs/core';
import type { TacticalHologram } from '../visualization/TacticalHologram';
import type { ScanLineEffect } from '../visualization/ScanLineEffect';

function clamp01(t: number): number {
    return Math.max(0, Math.min(1, t));
}

/**
 * NavigationCameraController - cinematic camera working for Phase 2.
 *
 * Requirements:
 * - Bezier curve interpolation for movement
 * - Transition In: low angle -> top-down scan (with scan line + hologram fade)
 * - Transition Out: top-down -> low backview dive + FOV pulse
 * - Input is blocked during transitions and returned after completion
 */
export class NavigationCameraController {
    private scene: BABYLON.Scene;
    private hologram: TacticalHologram;
    private scanLine: ScanLineEffect;

    private isTransitioning: boolean = false;

    constructor(scene: BABYLON.Scene, hologram: TacticalHologram, scanLine: ScanLineEffect) {
        this.scene = scene;
        this.hologram = hologram;
        this.scanLine = scanLine;
    }

    private getArcCam(): BABYLON.ArcRotateCamera | null {
        const cam = this.scene.activeCamera;
        return cam instanceof BABYLON.ArcRotateCamera ? cam : null;
    }

    getIsTransitioning(): boolean {
        return this.isTransitioning;
    }

    transitionIn(gridHalf: number, onDone?: () => void): void {
        const arc = this.getArcCam();
        if (!arc || this.isTransitioning) return;
        this.isTransitioning = true;
        this.detachInput();

        // start with invisible grid, fade in
        this.hologram.setVisibility(0);
        this.scanLine.startSweep({ half: gridHalf }, 900);

        // Seamless camera flow (alpha/beta/radius) with CubicEase
        const fps = 60;
        const durS = 1.1; // seconds
        const durMs = durS * 1000;
        const totalFrames = Math.round(durS * fps);

        const easing = new BABYLON.CubicEase();
        easing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);

        const alphaAnim = new BABYLON.Animation('NavCamAlphaIn', 'alpha', fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT);
        alphaAnim.setKeys([
            { frame: 0, value: arc.alpha },
            { frame: totalFrames, value: -Math.PI / 2 },
        ]);
        alphaAnim.setEasingFunction(easing);

        const betaAnim = new BABYLON.Animation('NavCamBetaIn', 'beta', fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT);
        betaAnim.setKeys([
            { frame: 0, value: arc.beta },
            { frame: totalFrames, value: 1.02 },
        ]);
        betaAnim.setEasingFunction(easing);

        const radiusAnim = new BABYLON.Animation('NavCamRadiusIn', 'radius', fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT);
        radiusAnim.setKeys([
            { frame: 0, value: arc.radius },
            { frame: totalFrames, value: 26 },
        ]);
        radiusAnim.setEasingFunction(easing);

        const targetAnim = new BABYLON.Animation('NavCamTargetIn', 'target', fps, BABYLON.Animation.ANIMATIONTYPE_VECTOR3);
        targetAnim.setKeys([
            { frame: 0, value: arc.target.clone() },
            { frame: totalFrames, value: new BABYLON.Vector3(0, 0.8, 0) },
        ]);
        targetAnim.setEasingFunction(easing);

        // Hologram fade-in is tied to animation progress (cheap observer)
        const startFrame = 0;
        const endFrame = totalFrames;
        const anim = this.scene.beginDirectAnimation(arc, [alphaAnim, betaAnim, radiusAnim, targetAnim], startFrame, endFrame, false, 1);

        const start = performance.now();
        const onTick = () => {
            if (!this.isTransitioning) return;
            const raw = clamp01((performance.now() - start) / Math.max(1, durMs));
            this.hologram.setVisibility(raw);
        };
        this.scene.onBeforeRenderObservable.add(onTick);

        anim.onAnimationEndObservable.addOnce(() => {
            this.scene.onBeforeRenderObservable.removeCallback(onTick);
            this.hologram.setVisibility(1);
            this.isTransitioning = false;
            this.attachInput();
            onDone?.();
        });
    }

    transitionOut(
        onMid: (progress01: number) => void,
        onDone?: () => void
    ): void {
        const arc = this.getArcCam();
        if (!arc || this.isTransitioning) return;
        this.isTransitioning = true;
        this.detachInput();

        const fps = 60;
        const durS = 0.95; // seconds
        const durMs = durS * 1000;
        const totalFrames = Math.round(durS * fps);

        const easing = new BABYLON.CubicEase();
        easing.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);

        // Dive: more aggressive beta + tighter radius (feels like "falling")
        const alphaAnim = new BABYLON.Animation('NavCamAlphaOut', 'alpha', fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT);
        alphaAnim.setKeys([
            { frame: 0, value: arc.alpha },
            { frame: totalFrames, value: -Math.PI / 2 + 0.18 },
        ]);
        alphaAnim.setEasingFunction(easing);

        const betaAnim = new BABYLON.Animation('NavCamBetaOut', 'beta', fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT);
        betaAnim.setKeys([
            { frame: 0, value: arc.beta },
            { frame: totalFrames, value: 0.62 },
        ]);
        betaAnim.setEasingFunction(easing);

        const radiusAnim = new BABYLON.Animation('NavCamRadiusOut', 'radius', fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT);
        radiusAnim.setKeys([
            { frame: 0, value: arc.radius },
            { frame: totalFrames, value: 14.5 },
        ]);
        radiusAnim.setEasingFunction(easing);

        const targetAnim = new BABYLON.Animation('NavCamTargetOut', 'target', fps, BABYLON.Animation.ANIMATIONTYPE_VECTOR3);
        targetAnim.setKeys([
            { frame: 0, value: arc.target.clone() },
            { frame: totalFrames, value: new BABYLON.Vector3(0, 1.0, 4) },
        ]);
        targetAnim.setEasingFunction(easing);

        // Diving FOV elastic pulse (camera "heartbeat" at launch)
        const baseFov = arc.fov;
        const fovAnim = new BABYLON.Animation('NavCamFovPulse', 'fov', fps, BABYLON.Animation.ANIMATIONTYPE_FLOAT);
        fovAnim.setKeys([
            { frame: 0, value: baseFov },
            { frame: Math.round(totalFrames * 0.35), value: baseFov * 1.28 },
            { frame: Math.round(totalFrames * 0.65), value: baseFov * 0.92 },
            { frame: totalFrames, value: baseFov },
        ]);
        const elastic = new BABYLON.ElasticEase(1.2, 3);
        elastic.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEOUT);
        fovAnim.setEasingFunction(elastic);

        const anim = this.scene.beginDirectAnimation(
            arc,
            [alphaAnim, betaAnim, radiusAnim, targetAnim, fovAnim],
            0,
            totalFrames,
            false,
            1
        );

        const start = performance.now();
        const onTick = () => {
            if (!this.isTransitioning) return;
            const raw = clamp01((performance.now() - start) / Math.max(1, durMs));
            onMid(raw);
        };
        this.scene.onBeforeRenderObservable.add(onTick);

        anim.onAnimationEndObservable.addOnce(() => {
            this.scene.onBeforeRenderObservable.removeCallback(onTick);
            arc.fov = baseFov;
            this.isTransitioning = false;
            this.attachInput();
            onDone?.();
        });
    }

    private detachInput(): void {
        const c: any = this.scene.activeCamera as any;
        if (typeof c.detachControl === 'function') {
            c.detachControl();
        }
    }

    private attachInput(): void {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        const c: any = this.scene.activeCamera as any;
        if (canvas && typeof c.attachControl === 'function') {
            c.attachControl(canvas, true);
        }
    }
}

