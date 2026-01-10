import * as BABYLON from '@babylonjs/core';
import { ANIM, COLORS, LAYOUT } from '../../../shared/design';

export interface ActivePathEffectOptions {
    /** Over budget -> red path */
    isInvalid: boolean;
}

/** DEV 모드 플래그: import.meta.env.DEV가 없는 환경에서도 안전하게 처리 */
const IS_DEV = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV === true;

/**
 * ActivePathEffect - "Arcana Vector" path visualization.
 *
 * 목표:
 * - 선택 경로는 일반 링크보다 3배 두껍게 (tube)
 * - emissive + GlowLayer로 '스카이라인' 느낌
 * - 경로 방향으로 빠른 시안 spark 파티클 흐름
 *
 * Phase 2.5 디버깅:
 * - DEV 모드에서 경로 포인트에 마젠타 디버그 마커 표시
 * - 콘솔에 경로 정보 로그 출력
 */
export class ActivePathEffect {
    private scene: BABYLON.Scene;
    private segments: BABYLON.Mesh[] = [];
    private segMat: BABYLON.StandardMaterial | null = null;
    private emitter: BABYLON.Mesh | null = null;
    private particles: BABYLON.ParticleSystem | null = null;

    private pathPoints: BABYLON.Vector3[] = [];
    private t: number = 0;
    private drawToken: number = 0;

    /** DEV 모드: 디버그 마커 */
    private debugMarkers: BABYLON.Mesh[] = [];
    private debugMat: BABYLON.StandardMaterial | null = null;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    setPath(points: BABYLON.Vector3[], options: ActivePathEffectOptions): void {
        this.disposeMeshes();

        // ========================================
        // [DEBUG] Phase 2.5 디버그 로그
        // ========================================
        console.log('[ActivePathEffect] setPath called:', {
            pointCount: points.length,
            points: points.map((p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`),
            isInvalid: options.isInvalid,
        });

        // Lift path above LinkNetwork (0.14) to ensure visibility
        // Phase 2.5 Fix: 기존 0.10 → 0.20 (LinkNetwork보다 높게)
        const yOffset = 0.20;
        this.pathPoints = points.map((p) => p.add(new BABYLON.Vector3(0, yOffset, 0)));
        this.t = 0;
        this.drawToken++;

        if (this.pathPoints.length < 2) {
            console.log('[ActivePathEffect] Not enough points to draw path (need >= 2)');
            return;
        }

        // Shared material for all segments
        // Phase 2.5 Fix: Tube 대신 Cylinder 사용 (Tube는 2점 path에서 불안정)
        // [TEST] 테스트용: 명확히 구분되는 주황색 + 와이어프레임
        this.segMat = new BABYLON.StandardMaterial('ArcanaActivePathSegMat', this.scene);
        // [FIX] disableLighting 필수: 씬 조명 없이도 emissive 색상이 온전히 표시되어야 함
        this.segMat.disableLighting = true;
        // [TEST] 테스트용 색상: 밝은 주황색 (NavNodeRing cyan과 완전히 다름)
        const pathColor = options.isInvalid
            ? new BABYLON.Color3(1, 0.22, 0.22)
            : new BABYLON.Color3(1.0, 0.5, 0.0); // Orange instead of cyan
        this.segMat.emissiveColor = pathColor;
        this.segMat.specularColor = BABYLON.Color3.Black();
        this.segMat.alpha = 1.0;
        this.segMat.backFaceCulling = false;
        // [TEST] 와이어프레임 모드로 구분 용이하게
        this.segMat.wireframe = true;

        // Build segments using Cylinder (more reliable than Tube for 2-point paths)
        // [TEST] 두께 증가: 기존 값의 5배로 테스트
        const baseDiameter = (options.isInvalid ? LAYOUT.HOLOGRAM.PATH_RADIUS : LAYOUT.HOLOGRAM.PATH_RADIUS_SELECTED) * 2;
        const diameter = baseDiameter * 5; // 테스트용 5배 두께
        console.log(`[ActivePathEffect] [TEST] Using diameter=${diameter.toFixed(3)} (base=${baseDiameter.toFixed(3)} x5)`);
        for (let i = 0; i < this.pathPoints.length - 1; i++) {
            const p0 = this.pathPoints[i];
            const p1 = this.pathPoints[i + 1];
            
            // 두 점 사이의 거리와 방향 계산
            const direction = p1.subtract(p0);
            const height = direction.length();
            const midPoint = p0.add(direction.scale(0.5));
            
            // Cylinder 생성 (기본적으로 Y축 정렬)
            const seg = BABYLON.MeshBuilder.CreateCylinder(
                `ArcanaActivePathSeg_${i}`,
                { height, diameter, tessellation: 16 },
                this.scene
            );
            
            // 위치 설정 (중간점)
            seg.position.copyFrom(midPoint);
            
            // 방향 설정 (Y축에서 direction으로 회전)
            if (height > 0.001) {
                const yAxis = BABYLON.Vector3.Up();
                const dirNorm = direction.normalize();
                const axis = BABYLON.Vector3.Cross(yAxis, dirNorm);
                // Math.acos의 입력을 -1~1로 클램프 (부동소수점 오차 방지)
                const dot = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(yAxis, dirNorm)));
                const angle = Math.acos(dot);
                if (axis.length() > 0.001) {
                    seg.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
                }
            }

            // [FIX] 순서 중요: 먼저 속성 설정
            seg.isPickable = false;
            seg.material = this.segMat!;
            seg.renderingGroupId = 0;
            seg.metadata = { navGlow: true, navInvalidGlow: options.isInvalid };

            // [FIX] Active mesh 선정을 위한 설정 (frustum culling 무시)
            seg.alwaysSelectAsActiveMesh = true;

            // [FIX] freeze 해제 (혹시 상속된 경우 대비)
            seg.unfreezeWorldMatrix();

            // [FIX] World Matrix 및 Bounding Info 강제 갱신
            seg.computeWorldMatrix(true);
            seg.refreshBoundingInfo(true); // force=true 로 강제 갱신

            this.segments.push(seg);

            console.log(`[ActivePathEffect] Created ${seg.name}: alwaysSelect=${seg.alwaysSelectAsActiveMesh}, frozen=${seg.isWorldMatrixFrozen}`);
        }

        // [FIX] 렌더 루프 타이밍: 다음 프레임에서 한 번 더 강제 갱신
        // (geometry 변경이 render loop 외부에서 발생한 경우 대비)
        this.scene.onBeforeRenderObservable.addOnce(() => {
            for (const seg of this.segments) {
                seg.computeWorldMatrix(true);
                seg.refreshBoundingInfo(true);
            }
            console.log(`[ActivePathEffect] Deferred refresh complete for ${this.segments.length} segments`);
        });

        // ========================================
        // [DEBUG] 세그먼트 생성 결과 로그 (문자열로 직접 출력)
        // ========================================
        console.log(`[ActivePathEffect] Segments created: ${this.segments.length}`);
        for (const seg of this.segments) {
            const mat = seg.material as BABYLON.StandardMaterial | null;
            const bb = seg.getBoundingInfo().boundingBox;
            const info = [
                `enabled=${seg.isEnabled()}`,
                `isVisible=${seg.isVisible}`,
                `visibility=${seg.visibility}`,
                `pos=(${seg.position.x.toFixed(2)},${seg.position.y.toFixed(2)},${seg.position.z.toFixed(2)})`,
                `bb=[${bb.minimumWorld.x.toFixed(1)},${bb.minimumWorld.y.toFixed(1)},${bb.minimumWorld.z.toFixed(1)}]~[${bb.maximumWorld.x.toFixed(1)},${bb.maximumWorld.y.toFixed(1)},${bb.maximumWorld.z.toFixed(1)}]`,
                `verts=${seg.getTotalVertices()}`,
                `alpha=${mat?.alpha ?? 'N/A'}`,
                `emissive=rgb(${mat?.emissiveColor.r.toFixed(2) ?? '?'},${mat?.emissiveColor.g.toFixed(2) ?? '?'},${mat?.emissiveColor.b.toFixed(2) ?? '?'})`,
            ].join(' | ');
            console.log(`  - ${seg.name}: ${info}`);
        }

        // ========================================
        // [DEBUG] DEV 모드: 시각적 디버그 마커 (마젠타 구체)
        // ========================================
        if (IS_DEV) {
            this.createDebugMarkers();
        }

        // Optional: small sequential spark feel (doesn't gate visibility)
        const token = this.drawToken;
        const msPer = ANIM.HOLOGRAM.PATH_DRAW_MS_PER_SEGMENT;
        for (let i = 0; i < this.pathPoints.length - 1; i++) {
            const p1 = this.pathPoints[i + 1];
            window.setTimeout(() => {
                if (this.drawToken !== token) return;
                this.burstAt(p1);
            }, i * msPer);
        }

        // Emitter for particle flow
        this.emitter = BABYLON.MeshBuilder.CreateSphere('ArcanaPathEmitter', { diameter: 0.01 }, this.scene);
        this.emitter.isVisible = false;
        this.emitter.isPickable = false;
        this.emitter.alwaysSelectAsActiveMesh = true;
        this.emitter.position.copyFrom(this.pathPoints[0]);

        this.particles = new BABYLON.ParticleSystem('ArcanaPathSparks', 2000, this.scene);
        this.particles.particleTexture = new BABYLON.Texture(this.makeSparkTextureDataUrl(), this.scene, true, false);
        this.particles.emitter = this.emitter;
        this.particles.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
        const neon = BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
        this.particles.color1 = options.isInvalid
            ? new BABYLON.Color4(1, 0.25, 0.25, 1)
            : new BABYLON.Color4(neon.r, neon.g, neon.b, 1);
        this.particles.color2 = this.particles.color1;
        this.particles.minSize = ANIM.HOLOGRAM.PATH_PARTICLE_MIN_SIZE;
        this.particles.maxSize = ANIM.HOLOGRAM.PATH_PARTICLE_MAX_SIZE;
        this.particles.minLifeTime = ANIM.HOLOGRAM.PATH_PARTICLE_MIN_LIFE;
        this.particles.maxLifeTime = ANIM.HOLOGRAM.PATH_PARTICLE_MAX_LIFE;
        this.particles.emitRate = ANIM.HOLOGRAM.PATH_PARTICLE_EMIT_RATE;
        this.particles.minEmitPower = ANIM.HOLOGRAM.PATH_PARTICLE_MIN_SPEED;
        this.particles.maxEmitPower = ANIM.HOLOGRAM.PATH_PARTICLE_MAX_SPEED;
        this.particles.direction1 = new BABYLON.Vector3(-0.2, 0.2, -0.2);
        this.particles.direction2 = new BABYLON.Vector3(0.2, 0.6, 0.2);
        this.particles.gravity = BABYLON.Vector3.Zero();
        this.particles.updateSpeed = 0.014;
        this.particles.start();

        // Animate emitter along polyline for "flow"
        this.scene.onBeforeRenderObservable.add(this.tick);
    }

    burstAt(position: BABYLON.Vector3): void {
        // A short burst: create a temporary particle system (cheap, short-lived)
        const ps = new BABYLON.ParticleSystem('ArcanaBurst', 500, this.scene);
        ps.particleTexture = new BABYLON.Texture(this.makeSparkTextureDataUrl(), this.scene, true, false);
        ps.emitter = position.clone();
        ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_ADD;
        const neon = BABYLON.Color3.FromHexString(COLORS.HUD_NEON);
        ps.color1 = new BABYLON.Color4(neon.r, neon.g, neon.b, 1);
        ps.color2 = ps.color1;
        ps.minSize = 0.08;
        ps.maxSize = 0.18;
        ps.minLifeTime = 0.16;
        ps.maxLifeTime = 0.32;
        ps.emitRate = 0;
        ps.manualEmitCount = 120;
        ps.minEmitPower = 8;
        ps.maxEmitPower = 18;
        ps.direction1 = new BABYLON.Vector3(-1, 0.2, -1);
        ps.direction2 = new BABYLON.Vector3(1, 1.2, 1);
        ps.gravity = BABYLON.Vector3.Zero();
        ps.updateSpeed = 0.02;
        ps.start();

        window.setTimeout(() => {
            ps.stop();
            ps.dispose();
        }, ANIM.HOLOGRAM.PATH_SPARK_BURST_MS);
    }

    private tick = () => {
        if (!this.emitter || this.pathPoints.length < 2) return;

        // Move along polyline at constant-ish speed (t wraps)
        const dt = this.scene.getEngine().getDeltaTime() / 1000;
        this.t += dt * 0.65; // flow speed
        const u = this.t % 1;

        // Map u to segment
        const segCount = this.pathPoints.length - 1;
        const segU = u * segCount;
        const idx = Math.min(segCount - 1, Math.max(0, Math.floor(segU)));
        const local = segU - idx;
        const p0 = this.pathPoints[idx];
        const p1 = this.pathPoints[idx + 1];
        BABYLON.Vector3.LerpToRef(p0, p1, local, this.emitter.position);
    };

    private makeSparkTextureDataUrl(): string {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0.0, 'rgba(0,229,255,1)');
        g.addColorStop(0.25, 'rgba(0,229,255,0.85)');
        g.addColorStop(0.6, 'rgba(0,229,255,0.15)');
        g.addColorStop(1.0, 'rgba(0,229,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        return canvas.toDataURL('image/png');
    }

    /**
     * DEV 모드: 경로 포인트에 마젠타 디버그 마커 생성
     */
    private createDebugMarkers(): void {
        this.disposeDebugMarkers();

        this.debugMat = new BABYLON.StandardMaterial('DebugPathMarkerMat', this.scene);
        this.debugMat.emissiveColor = new BABYLON.Color3(1, 0, 1); // 마젠타
        this.debugMat.disableLighting = true;
        // 불투명으로 설정
        this.debugMat.alpha = 1.0;

        for (let i = 0; i < this.pathPoints.length; i++) {
            const marker = BABYLON.MeshBuilder.CreateSphere(
                `DebugPathPoint_${i}`,
                { diameter: 0.5 },
                this.scene
            );
            marker.position.copyFrom(this.pathPoints[i]);
            marker.material = this.debugMat;
            marker.isPickable = false;
            marker.renderingGroupId = 0;

            // [FIX] Active mesh 및 bounding 강제 갱신
            marker.alwaysSelectAsActiveMesh = true;
            marker.unfreezeWorldMatrix();
            marker.computeWorldMatrix(true);
            marker.refreshBoundingInfo(true);

            this.debugMarkers.push(marker);
        }

        // [FIX] 렌더 루프 타이밍: 다음 프레임에서 한 번 더 강제 갱신
        this.scene.onBeforeRenderObservable.addOnce(() => {
            for (const marker of this.debugMarkers) {
                marker.computeWorldMatrix(true);
                marker.refreshBoundingInfo(true);
            }
            console.log(`[ActivePathEffect] DEV: Deferred refresh for ${this.debugMarkers.length} markers`);
        });

        console.log(`[ActivePathEffect] DEV: Created ${this.debugMarkers.length} debug markers`);
    }

    private disposeDebugMarkers(): void {
        for (const m of this.debugMarkers) m.dispose();
        this.debugMarkers = [];
        if (this.debugMat) {
            this.debugMat.dispose();
            this.debugMat = null;
        }
    }

    private disposeMeshes(): void {
        if (this.particles) {
            this.particles.stop();
            this.particles.dispose();
            this.particles = null;
        }
        if (this.emitter) {
            this.emitter.dispose();
            this.emitter = null;
        }
        for (const s of this.segments) s.dispose();
        this.segments = [];
        if (this.segMat) {
            this.segMat.dispose();
            this.segMat = null;
        }
        // DEV 모드: 디버그 마커 정리
        this.disposeDebugMarkers();
        this.scene.onBeforeRenderObservable.removeCallback(this.tick);
    }

    dispose(): void {
        this.disposeMeshes();
    }
}

