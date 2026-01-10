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
 * [CRITICAL FIX] Render Loop 타이밍:
 * - Mesh 생성/갱신은 반드시 onBeforeRenderObservable 안에서 수행
 * - pointer event callback에서 직접 mesh 생성 시 Active Mesh 선정에서 탈락
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

    /** [FIX] Dirty flag 패턴: render loop 내에서 mesh 생성 */
    private pendingPath: { points: BABYLON.Vector3[]; options: ActivePathEffectOptions } | null = null;
    private renderObserver: BABYLON.Observer<BABYLON.Scene> | null = null;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
        this.setupRenderLoopHandler();
    }

    /**
     * [FIX] Render loop 핸들러 등록
     * - mesh 생성/갱신은 onBeforeActiveMeshesEvaluationObservable에서 수행
     * - onBeforeRenderObservable은 너무 늦음 (active mesh 평가 이후)
     */
    private setupRenderLoopHandler(): void {
        console.log('[ActivePathEffect] Setting up render loop handler (onBeforeActiveMeshesEvaluation)');
        this.renderObserver = this.scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
            if (this.pendingPath) {
                const { points, options } = this.pendingPath;
                this.pendingPath = null;
                console.log('[ActivePathEffect] Processing pending path BEFORE active mesh evaluation:', points.length, 'points');
                this.buildPathMeshes(points, options);
            }
        });
        console.log('[ActivePathEffect] Render observer registered:', !!this.renderObserver);
    }

    /**
     * setPath - 외부에서 호출하는 API
     * [FIX] 직접 mesh를 생성하지 않고, pending 상태로 저장
     */
    setPath(points: BABYLON.Vector3[], options: ActivePathEffectOptions): void {
        // 기존 mesh 정리 (즉시 수행 가능)
        this.disposeMeshes();

        console.log('[ActivePathEffect] setPath called (deferred):', {
            pointCount: points.length,
            points: points.map((p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`),
            isInvalid: options.isInvalid,
        });

        if (points.length < 2) {
            console.log('[ActivePathEffect] Not enough points to draw path (need >= 2)');
            return;
        }

        // [FIX] Pending 상태로 저장 → 다음 render loop에서 처리
        this.pendingPath = {
            points: points.map(p => p.clone()),
            options: { ...options }
        };
    }

    /**
     * [FIX] 실제 mesh 생성 로직 - render loop 안에서만 호출됨
     */
    private buildPathMeshes(points: BABYLON.Vector3[], options: ActivePathEffectOptions): void {
        // Lift path above LinkNetwork (0.14) to ensure visibility
        const yOffset = 0.20;
        this.pathPoints = points.map((p) => p.add(new BABYLON.Vector3(0, yOffset, 0)));
        this.t = 0;
        this.drawToken++;

        // Shared material for all segments
        // [TEST] 테스트용: 명확히 구분되는 주황색 + 와이어프레임
        this.segMat = new BABYLON.StandardMaterial('ArcanaActivePathSegMat', this.scene);
        this.segMat.disableLighting = true;
        const pathColor = options.isInvalid
            ? new BABYLON.Color3(1, 0.22, 0.22)
            : new BABYLON.Color3(1.0, 0.5, 0.0); // Orange instead of cyan
        this.segMat.emissiveColor = pathColor;
        this.segMat.specularColor = BABYLON.Color3.Black();
        this.segMat.alpha = 1.0;
        this.segMat.backFaceCulling = false;
        this.segMat.wireframe = true; // [TEST]

        // Build segments using Cylinder
        const baseDiameter = (options.isInvalid ? LAYOUT.HOLOGRAM.PATH_RADIUS : LAYOUT.HOLOGRAM.PATH_RADIUS_SELECTED) * 2;
        const diameter = baseDiameter * 5; // [TEST] 5배 두께
        console.log(`[ActivePathEffect] Building segments: diameter=${diameter.toFixed(3)}`);

        for (let i = 0; i < this.pathPoints.length - 1; i++) {
            const p0 = this.pathPoints[i];
            const p1 = this.pathPoints[i + 1];

            const direction = p1.subtract(p0);
            const height = direction.length();
            const midPoint = p0.add(direction.scale(0.5));

            const seg = BABYLON.MeshBuilder.CreateCylinder(
                `ArcanaActivePathSeg_${i}`,
                { height, diameter, tessellation: 16 },
                this.scene
            );

            seg.position.copyFrom(midPoint);

            // 방향 설정
            if (height > 0.001) {
                const yAxis = BABYLON.Vector3.Up();
                const dirNorm = direction.normalize();
                const axis = BABYLON.Vector3.Cross(yAxis, dirNorm);
                const dot = Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(yAxis, dirNorm)));
                const angle = Math.acos(dot);
                if (axis.length() > 0.001) {
                    seg.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis.normalize(), angle);
                }
            }

            // 속성 설정
            seg.isPickable = false;
            seg.material = this.segMat!;
            seg.layerMask = 0x0FFFFFFF; // [FIX] 모든 레이어 허용
            seg.renderingGroupId = 0; // [TEST] 기본 그룹으로 변경 (1에서 0으로)
            seg.metadata = { navGlow: true, navInvalidGlow: options.isInvalid };

            // [FIX] Active mesh 선정 설정
            seg.alwaysSelectAsActiveMesh = true;
            seg.doNotSyncBoundingInfo = false;
            (seg as any).doNotCheckFrustum = true; // [FIX] Frustum culling 완전 비활성화

            // [FIX] World matrix 및 bounding 갱신 (강제)
            seg.unfreezeWorldMatrix();
            seg.computeWorldMatrix(true);
            seg.refreshBoundingInfo(true);

            // [FIX] Babylon 8.x: SubMesh 강제 생성 (없으면 렌더 탈락)
            if (!seg.subMeshes || seg.subMeshes.length === 0) {
                console.warn(`[ActivePathEffect] ${seg.name} has NO subMeshes! Force creating...`);
                (seg as any)._createGlobalSubMesh?.(true);
            }

            // [FIX] Babylon 8.x: Material 강제 컴파일
            if (this.segMat && !this.segMat.isReady(seg)) {
                console.warn(`[ActivePathEffect] ${seg.name} material NOT ready! Force compiling...`);
                this.segMat.forceCompilation(seg);
            }

            // [DEBUG] Babylon 8.x Renderability Check
            console.log(`[ActivePathEffect] ${seg.name} renderability:`, {
                subMeshCount: seg.subMeshes?.length ?? 0,
                materialReady: this.segMat?.isReady(seg) ?? false,
                materialName: this.segMat?.name ?? 'none',
            });

            // [DEBUG] Verify sync state
            const wm = seg.getWorldMatrix();
            const bb = seg.getBoundingInfo().boundingBox;

            // [FIX] 강제 Scene 등록 확인 및 재등록
            if (!this.scene.meshes.includes(seg)) {
                console.warn(`[ActivePathEffect] ${seg.name} NOT in scene.meshes! Force adding...`);
                this.scene.addMesh(seg);
            }

            // [DEBUG] _isActive 체크 (Scene ownership 확인)
            const cam = this.scene.activeCamera;
            const isActiveResult = cam ? (seg as any)._isActive?.(cam) : 'no camera';

            console.log(`[ActivePathEffect] ${seg.name} ownership:`, {
                inSceneMeshes: this.scene.meshes.includes(seg),
                _scene: (seg as any)._scene === this.scene,
                _isActive: isActiveResult,
                freezeWorldMatrix: (seg as any)._isWorldMatrixFrozen,
                doNotSyncBoundingInfo: seg.doNotSyncBoundingInfo,
                worldMatrixValid: !wm.isIdentity(),
                boundingMin: `(${bb.minimumWorld.x.toFixed(2)}, ${bb.minimumWorld.y.toFixed(2)}, ${bb.minimumWorld.z.toFixed(2)})`,
                boundingMax: `(${bb.maximumWorld.x.toFixed(2)}, ${bb.maximumWorld.y.toFixed(2)}, ${bb.maximumWorld.z.toFixed(2)})`
            });

            this.segments.push(seg);
            console.log(`[ActivePathEffect] Created ${seg.name}:`, {
                renderingGroupId: seg.renderingGroupId,
                layerMask: '0x' + seg.layerMask.toString(16),
                isEnabled: seg.isEnabled(),
                isVisible: seg.isVisible,
                alwaysSelectAsActiveMesh: seg.alwaysSelectAsActiveMesh,
                position: `(${seg.position.x.toFixed(2)}, ${seg.position.y.toFixed(2)}, ${seg.position.z.toFixed(2)})`
            });
        }

        console.log(`[ActivePathEffect] Segments built: ${this.segments.length}`);

        // [FIX] Babylon 권장: render loop 생성 mesh는 다음 프레임에서 한 번 더 sync
        this.scene.onAfterRenderObservable.addOnce(() => {
            for (const seg of this.segments) {
                seg.computeWorldMatrix(true);
                seg.refreshBoundingInfo(true);
            }
            console.log(`[ActivePathEffect] Deferred sync completed for ${this.segments.length} segments`);

            // Check active meshes after deferred sync
            const activeMeshes = this.scene.getActiveMeshes();
            const inActive = this.segments.filter(s =>
                activeMeshes.data.some((m: BABYLON.AbstractMesh) => m === s)
            ).length;
            console.log(`[ActivePathEffect] After deferred sync: ${inActive}/${this.segments.length} in active meshes`);
        });

        // DEV 모드: 디버그 마커
        if (IS_DEV) {
            this.createDebugMarkers();
        }

        // Spark effects
        this.setupParticles(options);
    }

    private setupParticles(options: ActivePathEffectOptions): void {
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

        // Animate emitter along polyline
        this.scene.onBeforeRenderObservable.add(this.tick);
    }

    burstAt(position: BABYLON.Vector3): void {
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

        const dt = this.scene.getEngine().getDeltaTime() / 1000;
        this.t += dt * 0.65;
        const u = this.t % 1;

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

    private createDebugMarkers(): void {
        this.disposeDebugMarkers();

        this.debugMat = new BABYLON.StandardMaterial('DebugPathMarkerMat', this.scene);
        this.debugMat.emissiveColor = new BABYLON.Color3(1, 0, 1); // 마젠타
        this.debugMat.disableLighting = true;
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
            marker.layerMask = 0x0FFFFFFF; // [FIX] 모든 레이어 허용
            marker.renderingGroupId = 0; // [TEST] 기본 그룹 (1에서 0으로)

            marker.alwaysSelectAsActiveMesh = true;
            (marker as any).doNotCheckFrustum = true; // [FIX] Frustum culling 비활성화
            marker.unfreezeWorldMatrix();
            marker.computeWorldMatrix(true);
            marker.refreshBoundingInfo(true);

            // [FIX] Babylon 8.x: SubMesh 강제 생성
            if (!marker.subMeshes || marker.subMeshes.length === 0) {
                console.warn(`[ActivePathEffect] ${marker.name} has NO subMeshes! Force creating...`);
                (marker as any)._createGlobalSubMesh?.(true);
            }

            // [FIX] Babylon 8.x: Material 강제 컴파일
            if (this.debugMat && !this.debugMat.isReady(marker)) {
                this.debugMat.forceCompilation(marker);
            }

            console.log(`[ActivePathEffect] ${marker.name} renderability:`, {
                subMeshCount: marker.subMeshes?.length ?? 0,
                materialReady: this.debugMat?.isReady(marker) ?? false,
            });

            this.debugMarkers.push(marker);
        }

        console.log(`[ActivePathEffect] DEV: Created ${this.debugMarkers.length} debug markers (group 0)`);
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
        if (this.pendingPath) {
            console.log('[ActivePathEffect] disposeMeshes clearing pendingPath');
        }
        this.pendingPath = null;

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
        this.disposeDebugMarkers();
        this.scene.onBeforeRenderObservable.removeCallback(this.tick);
    }

    dispose(): void {
        console.log('[ActivePathEffect] dispose() called - removing render observer');
        if (this.renderObserver) {
            this.scene.onBeforeActiveMeshesEvaluationObservable.remove(this.renderObserver);
            this.renderObserver = null;
        }
        this.disposeMeshes();
    }
}
