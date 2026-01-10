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
import { AssetResolver } from '../../../shared/assets/AssetResolver';
import { TacticalMapLoader } from '../data/TacticalMapLoader';
import { TacticalEnvironmentLoader } from '../data/TacticalEnvironmentLoader';
import { NavigationLinkNetwork } from '../visualization/NavigationLinkNetwork';
import type { NavigationStartHooks } from '../NavigationEngine';

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

    // Phase 2.3: data-driven stage loading
    private resolver: AssetResolver = new AssetResolver();
    private mapLoader: TacticalMapLoader = new TacticalMapLoader();
    private envLoader: TacticalEnvironmentLoader = new TacticalEnvironmentLoader();
    private environment: BABYLON.AssetContainer | null = null;

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
        cam.attachControl(this.scene.getEngine().getRenderingCanvas(), true);

        this.scene.activeCamera = cam;
        this.navigationCamera = cam;

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

    private async startAsync(): Promise<void> {
        try {
            const hooks = this.startHooks;
            const dbg = hooks?.dbg;
            hooks?.onLog?.('JSON Fetch...');
            hooks?.onProgress?.(0.05);

            // Reset previous run state
            this.graph.clear();
            this.pathStore.clear();
            this.visualizer.dispose();
            this.visualizer = new NavigationVisualizer(this.scene, this.graph);
            this.activePath.dispose();
            this.linkNetwork.dispose();
            this.linkNetwork = new NavigationLinkNetwork(this.scene, this.graph);

            const url = this.resolver.tacticalMapJson(this.currentStage);
            dbg?.begin('JSON Fetch');
            const data = await this.mapLoader.loadJson(url);
            const jsonMs = dbg ? dbg.end('JSON Fetch') : 0;
            hooks?.onLog?.(`JSON Fetch: ${Math.round(jsonMs)}ms`);

            dbg?.begin('Graph Apply');
            this.mapLoader.applyToGraph(this.graph, data);
            const applyMs = dbg ? dbg.end('Graph Apply') : 0;
            hooks?.onLog?.(`Graph Apply: ${Math.round(applyMs)}ms`);
            hooks?.onProgress?.(0.25);
            hooks?.onLog?.('Graph + Mesh build...');

            // Build meshes after data is ready
            dbg?.begin('Mesh Build');
            this.visualizer.build();
            // Phase 2.5: show available edges immediately
            this.linkNetwork.build();
            const meshMs = dbg ? dbg.end('Mesh Build') : 0;
            hooks?.onLog?.(`Mesh Build: ${Math.round(meshMs)}ms`);
            this.syncUI();

            // Phase 2.3: Selection octree improves picking performance on large maps.
            // (Even if current content is small, keep the tuning in place.)
            dbg?.begin('Octree Build');
            this.scene.createOrUpdateSelectionOctree();
            const octMs = dbg ? dbg.end('Octree Build') : 0;
            hooks?.onLog?.(`Octree Build: ${Math.round(octMs)}ms`);
            hooks?.onProgress?.(0.35);
            hooks?.onLog?.('Environment Load...');

            // Smart loading: environment is optional and loaded via AssetContainer in background.
            let transitionDone = false;
            const maybeReady = () => {
                // IMPORTANT: environment is optional and MUST NOT gate readiness.
                // READY should unlock the planning scene as soon as core graph/meshes are ready + camera transition finished.
                if (transitionDone) {
                    hooks?.onProgress?.(1);
                    hooks?.onReady?.();
                }
            };
            void this.loadEnvironmentAsync();

            // Transition In: alpha/beta/radius easing handled by controller
            this.cameraController.transitionIn(LAYOUT.HOLOGRAM.GRID_SIZE / 2, () => {
                this.inputLocked = false;
                transitionDone = true;
                maybeReady();
            });
        } catch (err) {
            console.error('[NavigationScene] Stage load failed', err);
            this.inputLocked = false;
        }
    }

    private async loadEnvironmentAsync(): Promise<void> {
        // Dispose previous env if any
        if (this.environment) {
            try {
                this.environment.removeAllFromScene();
            } catch {
                // ignore
            }
            this.environment.dispose();
            this.environment = null;
        }

        const hooks = this.startHooks;
        const dbg = hooks?.dbg;
        const url = this.resolver.tacticalEnvironmentModel(this.currentStage);
        dbg?.begin('Environment Load');
        const container = await this.envLoader.tryLoadEnvironment(url, this.scene, (p01) => {
            // 0.35..0.9 reserved for env load
            hooks?.onProgress?.(0.35 + 0.55 * p01);
        });
        const envMs = dbg ? dbg.end('Environment Load') : 0;
        if (!container) {
            hooks?.onLog?.(`Environment Load: skipped (${Math.round(envMs)}ms)`);
            // still advance progress close to done
            hooks?.onProgress?.(0.95);
            return;
        }
        hooks?.onLog?.(`Environment Load: ${Math.round(envMs)}ms`);

        // Render as soon as it arrives.
        dbg?.begin('Environment Attach');
        container.addAllToScene();

        // Optimization: static environment meshes/materials are frozen.
        for (const m of container.meshes) {
            m.isPickable = false;
            m.freezeWorldMatrix();
            m.doNotSyncBoundingInfo = true;
        }
        for (const mat of container.materials) {
            // Some materials may already be frozen; safe to call.
            (mat as any).freeze?.();
        }

        // Update octree after environment insertion.
        dbg?.begin('Octree Update');
        this.scene.createOrUpdateSelectionOctree();
        const octMs = dbg ? dbg.end('Octree Update') : 0;
        const attachMs = dbg ? dbg.end('Environment Attach') : 0;
        hooks?.onProgress?.(0.95);
        hooks?.onLog?.(`Environment Attach: ${Math.round(attachMs)}ms`);
        hooks?.onLog?.(`Octree Update: ${Math.round(octMs)}ms`);
        this.environment = container;
    }

    stop(): void {
        if (!this.active) return;
        this.active = false;
        this.inputLocked = false;
        this.hud.hide();
        this.activePath.dispose();
        this.linkNetwork.dispose();
        this.visualizer.dispose();
        this.scanLine.dispose();
        this.hologram.dispose();
        if (this.environment) {
            this.environment.removeAllFromScene();
            this.environment.dispose();
            this.environment = null;
        }
        this.pathStore.clear();
        this.graph.clear();
        this.restorePreviousCamera();
        console.log('[NavigationScene] Stopped');
    }

    isActive(): boolean {
        return this.active;
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

