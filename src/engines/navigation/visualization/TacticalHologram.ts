import * as BABYLON from '@babylonjs/core';
import { COLORS, LAYOUT } from '../../../shared/design';

export interface TacticalHologramOptions {
    gridSize?: number;
    gridStep?: number;
    gridColor?: BABYLON.Color3;
    gridAlpha?: number;
    backgroundColor?: BABYLON.Color4;
    /** R in alpha falloff: alpha = max(0, 1 - d/R) */
    visibleRadius?: number;
}

/**
 * TacticalHologram - hologram-style scene dressing (grid + low complexity).
 *
 * 목표:
 * - 실사 렌더링이 아닌, 와이어프레임/그리드 기반의 "전술 홀로그램 뷰"
 * - 배경 복잡도 최소화, 노드 가시성 극대화
 */
export class TacticalHologram {
    private scene: BABYLON.Scene;
    private gridLines: BABYLON.LinesMesh | null = null;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    enable(options: TacticalHologramOptions = {}): void {
        const gridSize = options.gridSize ?? LAYOUT.HOLOGRAM.GRID_SIZE;
        const gridStep = options.gridStep ?? LAYOUT.HOLOGRAM.GRID_STEP;
        const gridColor = options.gridColor ?? BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
        const gridAlpha = options.gridAlpha ?? 0.2;
        const backgroundColor = options.backgroundColor ?? new BABYLON.Color4(0.02, 0.05, 0.08, 1);
        const visibleRadius = options.visibleRadius ?? LAYOUT.HOLOGRAM.GRID_RADIUS;

        this.scene.clearColor = backgroundColor;

        if (this.gridLines) {
            this.gridLines.dispose();
            this.gridLines = null;
        }

        const half = gridSize / 2;
        const lines: BABYLON.Vector3[][] = [];
        const colors: BABYLON.Color4[][] = [];

        // X-parallel lines
        for (let z = -half; z <= half; z += gridStep) {
            const p0 = new BABYLON.Vector3(-half, 0, z);
            const p1 = new BABYLON.Vector3(half, 0, z);
            lines.push([p0, p1]);
            colors.push([
                this.colorWithFalloff(p0, gridColor, gridAlpha, visibleRadius, Math.abs(z) < 0.001),
                this.colorWithFalloff(p1, gridColor, gridAlpha, visibleRadius, Math.abs(z) < 0.001),
            ]);
        }
        // Z-parallel lines
        for (let x = -half; x <= half; x += gridStep) {
            const p0 = new BABYLON.Vector3(x, 0, -half);
            const p1 = new BABYLON.Vector3(x, 0, half);
            lines.push([p0, p1]);
            colors.push([
                this.colorWithFalloff(p0, gridColor, gridAlpha, visibleRadius, Math.abs(x) < 0.001),
                this.colorWithFalloff(p1, gridColor, gridAlpha, visibleRadius, Math.abs(x) < 0.001),
            ]);
        }

        this.gridLines = BABYLON.MeshBuilder.CreateLineSystem(
            'TacticalGrid',
            { lines, colors, updatable: false },
            this.scene
        );
        this.gridLines.isPickable = false;
        // Phase 2.3: grid is fully static.
        this.gridLines.freezeWorldMatrix();
        this.gridLines.doNotSyncBoundingInfo = true;
        // Material is created internally; keep it lightweight.
        // Vertex alpha is enabled by default for LinesMesh when colors are provided.
    }

    setVisibility(v: number): void {
        if (!this.gridLines) return;
        this.gridLines.visibility = Math.max(0, Math.min(1, v));
    }

    dispose(): void {
        this.gridLines?.dispose();
        this.gridLines = null;
    }

    private colorWithFalloff(
        p: BABYLON.Vector3,
        color: BABYLON.Color3,
        baseAlpha: number,
        radius: number,
        isAxis: boolean
    ): BABYLON.Color4 {
        const d = Math.sqrt(p.x * p.x + p.z * p.z);
        const falloff = Math.max(0, 1 - d / Math.max(radius, 0.001));
        const axisBoost = isAxis ? 2.2 : 1.0;
        const a = Math.min(1, baseAlpha * falloff * axisBoost);
        return new BABYLON.Color4(color.r, color.g, color.b, a);
    }
}

