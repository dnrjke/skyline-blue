import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { NavigationGraph } from '../graph/NavigationGraph';
import { PathStore } from '../store/PathStore';
import { CoordinateMapper } from '../mapping/CoordinateMapper';
import { TacticalHologram } from '../visualization/TacticalHologram';
import { NavigationVisualizer } from '../visualization/NavigationVisualizer';
import { NavigationHUD } from '../ui/NavigationHUD';
import { ActivePathEffect } from '../visualization/ActivePathEffect';
import { ScanLineEffect } from '../visualization/ScanLineEffect';
import { NavigationCameraController } from './NavigationCameraController';
import { LAYOUT } from '../../../shared/design';
import { NavigationLinkNetwork } from '../visualization/NavigationLinkNetwork';
import type { NavigationStartHooks } from '../NavigationEngine';

// LoadUnit-based Loading Architecture
import {
    LoadingPhase,
    ArcanaLoadingOrchestrator,
    MaterialWarmupUnit,
    RenderReadyBarrierUnit,
    BarrierRequirement,
    // VISUAL_READY Phase (TacticalGrid Incident Prevention)
    VisualReadyUnit,
    createTacticalGridVisualRequirement,
} from '../../../core/loading';
import {
    DataFetchUnit,
    EnvironmentUnit,
    TacticalGridUnit,
    GraphVisualizerUnit,
    LinkNetworkUnit,
    OctreeUnit,
} from '../loading/units';

export interface NavigationSceneConfig {
    energyBudget: number;
}

/**
 * NavigationScene - Phase 2 tactical planning scene.
 *
 * Input model (HEBS-friendly):
 * - Main에서 InteractionLayer의 핸들러가 호출될 때, pointerX/Y를 전달해 handleTap()을 호출한다.
 * - NavigationScene 내부는 scene.pick()로 mesh를 판정한다.
 */
export class NavigationScene {
    private scene: BABYLON.Scene;
    private systemLayer: GUI.Rectangle;

    private graph: NavigationGraph;
    private pathStore: PathStore;
    private mapper: CoordinateMapper;

    private hologram: TacticalHologram;
    private visualizer: NavigationVisualizer;
    private linkNetwork: NavigationLinkNetwork;
    private hud: NavigationHUD;
    private activePath: ActivePathEffect;
    private scanLine: ScanLineEffect;
    private cameraController: NavigationCameraController;

    private active: boolean = false;
    private inputLocked: boolean = false;
    private launched: boolean = false;

    // LoadUnit-based Loading Architecture
    private orchestrator: ArcanaLoadingOrchestrator | null = null;
    private environmentUnit: EnvironmentUnit | null = null;
    private currentPhase: LoadingPhase = LoadingPhase.PENDING;

    // Camera swap (Main's camera <-> Navigation camera)
    private previousCamera: BABYLON.Camera | null = null;
    private navigationCamera: BABYLON.ArcRotateCamera | null = null;

    private currentStage = { episode: 1, stage: 1 } as const;
    private startHooks: NavigationStartHooks | null = null;

    constructor(scene: BABYLON.Scene, systemLayer: GUI.Rectangle, config: NavigationSceneConfig) {
        this.scene = scene;
        this.systemLayer = systemLayer;

        this.graph = new NavigationGraph();
        this.pathStore = new PathStore(this.graph, config.energyBudget);
        this.mapper = new CoordinateMapper();

        this.hologram = new TacticalHologram(this.scene);
        this.visualizer = new NavigationVisualizer(this.scene, this.graph);
        this.linkNetwork = new NavigationLinkNetwork(this.scene, this.graph);
        this.hud = new NavigationHUD(this.systemLayer, {
            onClear: () => {
                this.pathStore.clear();
                this.syncUI();
            },
            onConfirm: () => this.confirmAndLaunch(),
        });
        this.activePath = new ActivePathEffect(this.scene);
        this.scanLine = new ScanLineEffect(this.scene);
        this.cameraController = new NavigationCameraController(this.scene, this.hologram, this.scanLine);
    }

    private ensureNavigationCamera(): void {
        if (this.navigationCamera && !this.navigationCamera.isDisposed()) return;

        this.previousCamera = this.scene.activeCamera ?? null;

        // Tactical planning: ArcRotate gives stable alpha/beta/radius cinematic motion.
        const cam = new BABYLON.ArcRotateCamera(
            'NavArcCam',
            -Math.PI / 2,
            1.1,
            28,
            new BABYLON.Vector3(0, 0.8, 0),
            this.scene
        );
        cam.lowerRadiusLimit = 10;
        cam.upperRadiusLimit = 70;
        cam.wheelPrecision = 80;
        cam.panningSensibility = 0; // no manual panning in Phase 2.3

        // [FIX] Ensure camera doesn't filter out any layer masks
        // includeOnlyWithLayerMask = 0 means "no filter" (allow all)
        cam.layerMask = 0x0FFFFFFF;
        (cam as any).includeOnlyWithLayerMask = 0;
        console.log('[NavCamera] layerMask=0x' + cam.layerMask.toString(16) +
            ', includeOnly=0x' + ((cam as any).includeOnlyWithLayerMask ?? 0).toString(16));

        cam.attachControl(this.scene.getEngine().getRenderingCanvas(), true);

        this.scene.activeCamera = cam;
        this.navigationCamera = cam;

        // [DEBUG] Camera render path diagnostics
        console.log('[NavCamera] Render path diagnostics:', {
            mode: cam.mode === BABYLON.Camera.PERSPECTIVE_CAMERA ? 'PERSPECTIVE' :
                  cam.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA ? 'ORTHOGRAPHIC' : `UNKNOWN(${cam.mode})`,
            outputRenderTarget: (cam as any).outputRenderTarget ?? 'none',
            rigMode: (cam as any).rigMode ?? 'none',
            cameraRigMode: (cam as any).cameraRigMode ?? 'none',
            isRigCamera: (cam as any).isRigCamera ?? false,
            customRenderTargets: cam.customRenderTargets?.length ?? 0,
        });

        // [DEBUG] Compare with existing active meshes
        const activeMeshes = this.scene.getActiveMeshes();
        if (activeMeshes.length > 0) {
            const sampleMesh = activeMeshes.data[0];
            console.log('[NavCamera] Sample active mesh for comparison:', {
                name: sampleMesh?.name,
                renderingGroupId: sampleMesh?.renderingGroupId,
                layerMask: sampleMesh ? '0x' + sampleMesh.layerMask.toString(16) : 'N/A',
                parent: sampleMesh?.parent?.name ?? 'none',
            });
        }

        // Keep render quality (MSAA etc.) applied when camera swaps.
        const rq = (this.scene.metadata as any)?.renderQuality as { addCamera?: (c: BABYLON.Camera) => void } | undefined;
        rq?.addCamera?.(cam);
    }

    private restorePreviousCamera(): void {
        const prev = this.previousCamera;
        this.previousCamera = null;

        if (this.navigationCamera) {
            const rq = (this.scene.metadata as any)?.renderQuality as { removeCamera?: (c: BABYLON.Camera) => void } | undefined;
            rq?.removeCamera?.(this.navigationCamera);
            this.navigationCamera.detachControl();
            this.navigationCamera.dispose();
            this.navigationCamera = null;
        }

        if (prev && !prev.isDisposed()) {
            this.scene.activeCamera = prev;
        }
    }

    start(hooks: NavigationStartHooks = {}): void {
        if (this.active) return;
        this.active = true;
        this.launched = false;
        this.startHooks = hooks;

        if (hooks.stage) {
            // store stage selection for loader usage
            (this.currentStage as any) = { episode: hooks.stage.episode, stage: hooks.stage.stage };
        }

        // Essential visuals first: camera + hologram + HUD are immediate.
        this.ensureNavigationCamera();

        // Hologram look (grid is faded in by camera transition)
        this.hologram.enable();
        this.hologram.setVisibility(0);

        this.hud.show();
        // Phase 2.5: Watchdog reset immediately to avoid stale text (잔상)
        this.hud.setWatchdogStatus('SCANNING...');
        this.syncUI();

        this.inputLocked = true;
        // Data + assets are loaded asynchronously (Phase 2.3).
        void this.startAsync();

        console.log('[NavigationScene] Started');
    }

    /**
     * LoadUnit-based 비동기 시작.
     *
     * ArcanaLoadingOrchestrator를 사용하여 모든 LoadUnit을 실행:
     * 1. FETCHING: DataFetchUnit (JSON/Graph)
     * 2. BUILDING: TacticalGridUnit, GraphVisualizerUnit, LinkNetworkUnit, OctreeUnit
     * 3. WARMING: MaterialWarmupUnit
     * 4. BARRIER: RenderReadyBarrierUnit (첫 프레임 렌더 검증)
     * 5. READY: 입력 활성화, 카메라 트랜지션 시작
     */
    private async startAsync(): Promise<void> {
        const hooks = this.startHooks;
        const dbg = hooks?.dbg;
        const startTime = performance.now();

        try {
            // === Reset previous run state ===
            this.graph.clear();
            this.pathStore.clear();
            this.visualizer.dispose();
            this.visualizer = new NavigationVisualizer(this.scene, this.graph);
            this.activePath.dispose();
            this.activePath = new ActivePathEffect(this.scene);
            this.linkNetwork.dispose();
            this.linkNetwork = new NavigationLinkNetwork(this.scene, this.graph);
            this.disposeEnvironment();
            this.orchestrator?.dispose();

            // === Create LoadUnit-based Orchestrator ===
            this.orchestrator = new ArcanaLoadingOrchestrator(this.scene, {
                enableCompressionAnimation: true,
                barrierValidation: {
                    minActiveMeshCount: 1,
                    maxRetryFrames: 15,
                },
            });

            // Subscribe to loading state for progress/UI updates
            this.orchestrator.subscribe({
                onStateChange: (state) => {
                    this.currentPhase = state.phase;
                    hooks?.onProgress?.(state.progress);
                },
                onUnitStart: (unitId, displayName) => {
                    hooks?.onLog?.(`Loading: ${displayName ?? unitId}...`);
                },
                onBarrierEnter: () => {
                    dbg?.begin('BARRIER');
                    hooks?.onLog?.('[BARRIER] First frame render verification...');
                },
                onBarrierResolve: () => {
                    dbg?.end('BARRIER');
                },
                onLaunch: () => {
                    hooks?.onLog?.('[LAUNCH] Loading complete!');
                },
            });

            // === Create and Register all LoadUnits ===
            // Store EnvironmentUnit reference for disposal
            this.environmentUnit = new EnvironmentUnit({
                stage: this.currentStage,
            });

            this.orchestrator.registerUnits([
                // FETCHING phase
                new DataFetchUnit({
                    graph: this.graph,
                    stage: this.currentStage,
                }),
                this.environmentUnit,

                // BUILDING phase
                new TacticalGridUnit({
                    hologram: this.hologram,
                    initialVisibility: 0,
                }),
                new GraphVisualizerUnit({
                    visualizer: this.visualizer,
                    graph: this.graph,
                }),
                new LinkNetworkUnit({
                    linkNetwork: this.linkNetwork,
                }),
                new OctreeUnit(),

                // WARMING phase
                MaterialWarmupUnit.createNavigationWarmupUnit(),

                // BARRIER phase - 렌더 루프 확인만 (시각 검증은 VISUAL_READY에서)
                RenderReadyBarrierUnit.createForNavigation({
                    requirements: [
                        {
                            id: this.hologram.getGridMeshName(),
                            evidence: 'RENDER_READY',
                        } as BarrierRequirement,
                    ],
                }),

                // VISUAL_READY phase - TacticalGrid "보이기 시작" 검증
                // [VISUAL_READY는 "보이기 시작했는지"만 검증]
                // ✓ mesh 존재
                // ✓ mesh.isEnabled() === true
                // ✓ mesh.isVisible === true
                // ❌ 안정성/완성도는 STABILIZING_100에서 검증
                new VisualReadyUnit('nav-visual-ready', {
                    displayName: 'TacticalGrid Visual Verification',
                    requirements: [
                        createTacticalGridVisualRequirement(),
                    ],
                }),
            ]);

            // Attach environment after FETCHING phase (before BUILDING)
            // This is handled by the EnvironmentUnit itself via attachToScene()

            // === Execute all LoadUnits via Orchestrator ===
            dbg?.begin('LOADING');

            const result = await this.orchestrator.execute({
                onLog: hooks?.onLog,
                onReady: () => {
                    // Camera transition starts AFTER render-ready barrier passes
                    this.cameraController.transitionIn(LAYOUT.HOLOGRAM.GRID_SIZE / 2, () => {
                        this.inputLocked = false;
                        hooks?.onProgress?.(1);
                        hooks?.onReady?.();
                    });
                },
                onError: (err) => {
                    console.error('[NavigationScene] Loading failed', err);
                },
            });

            dbg?.end('LOADING');

            // Sync UI after all units complete
            this.syncUI();

            const totalMs = performance.now() - startTime;
            hooks?.onLog?.(`[READY] Total loading time: ${Math.round(totalMs)}ms`);

            if (result.phase === LoadingPhase.FAILED) {
                throw result.error ?? new Error('Loading failed');
            }

        } catch (err) {
            this.setPhase(LoadingPhase.FAILED, hooks);
            console.error('[NavigationScene] Loading failed', err);
            hooks?.onLog?.(`[FAILED] ${err instanceof Error ? err.message : String(err)}`);
            this.inputLocked = false;
        }
    }

    /**
     * Phase 전환 및 로깅
     */
    private setPhase(phase: LoadingPhase, hooks?: NavigationStartHooks | null): void {
        this.currentPhase = phase;
        console.log(`[NavigationScene] Phase: ${phase}`);
        hooks?.onLog?.(`--- Phase: ${phase} ---`);
    }

    /**
     * Environment 정리
     */
    private disposeEnvironment(): void {
        if (this.environmentUnit) {
            this.environmentUnit.dispose();
            this.environmentUnit = null;
        }
    }

    stop(): void {
        if (!this.active) return;
        this.active = false;
        this.inputLocked = false;
        this.currentPhase = LoadingPhase.PENDING;
        this.orchestrator?.cancel();
        this.orchestrator?.dispose();
        this.orchestrator = null;
        this.hud.hide();
        this.activePath.dispose();
        this.linkNetwork.dispose();
        this.visualizer.dispose();
        this.scanLine.dispose();
        this.hologram.dispose();
        this.disposeEnvironment();
        this.pathStore.clear();
        this.graph.clear();
        this.restorePreviousCamera();
        console.log('[NavigationScene] Stopped');
    }

    isActive(): boolean {
        return this.active;
    }

    /**
     * 현재 로딩 Phase 조회
     */
    getCurrentPhase(): LoadingPhase {
        return this.currentPhase;
    }

    /**
     * Handle a tap coming from InteractionLayer (HEBS).
     */
    handleTap(pointerX: number, pointerY: number): void {
        if (!this.active) return;
        if (this.inputLocked) return;
        if (this.launched) return;

        const pick = this.scene.pick(pointerX, pointerY, (m) => !!(m?.metadata as any)?.navNodeId);
        const nodeId = this.visualizer.getNodeIdFromMesh(pick?.pickedMesh);
        if (!nodeId) return;

        const ok = this.pathStore.tryAppend(nodeId);
        if (!ok) {
            console.log('[NavigationScene] Invalid transition (no edge).', nodeId);
            // 전략적 피드백은 HUD warning에 추가 가능 (Phase 2.1)
            return;
        }

        // Arcana: spark burst at selection point
        const node = this.graph.getNode(nodeId);
        if (node) {
            this.activePath.burstAt(node.position);
        }

        this.syncUI();
    }

    private syncUI(): void {
        const state = this.pathStore.getState();
        this.hud.update(state);
        this.visualizer.setSelection(state.sequence, state.isOverBudget);

        // Update active path effect
        const points = this.pathStore.getPositions(this.scene);
        this.activePath.setPath(points, { isInvalid: state.isOverBudget });
    }

    confirmAndLaunch(): void {
        if (!this.active) return;
        if (this.inputLocked) return;
        if (this.launched) return;

        const curve = this.getFlightCurve();
        if (!curve) {
            console.log('[NavigationScene] Confirm ignored: need at least 2 nodes.');
            return;
        }

        this.launched = true;
        this.inputLocked = true;

        // Transition Out: dive with FOV pulse. Launch timing is synced near end.
        let launchedOnce = false;
        this.cameraController.transitionOut((progress01) => {
            // At ~85%, trigger a visible "launch" preview (spark burst at curve start).
            if (!launchedOnce && progress01 >= 0.85) {
                launchedOnce = true;
                const start = curve.getPoints()[0];
                if (start) this.activePath.burstAt(start);
            }
        }, () => {
            this.inputLocked = false;
            console.log('[NavigationScene] Launch transition complete');
        });
    }

    /**
     * Phase 2 handoff: confirmed sequence as Curve3 in InGame coordinates.
     */
    getFlightCurve(): BABYLON.Curve3 | null {
        const tacticalPoints = this.pathStore.getPositions(this.scene);
        if (tacticalPoints.length < 2) return null;
        const inGamePoints = tacticalPoints.map((p) => this.mapper.tacticalToInGame(p));
        // Catmull-Rom spline for smooth flight path
        return BABYLON.Curve3.CreateCatmullRomSpline(inGamePoints, 24, false);
    }

    dispose(): void {
        this.stop();
        this.hud.dispose();
    }
}

