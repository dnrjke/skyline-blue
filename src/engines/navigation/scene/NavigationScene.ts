/**
 * NavigationScene - Phase 3 Tactical Design Scene
 *
 * MIGRATION COMPLETE: Legacy Dijkstra/PathStore removed.
 * Now uses Fate-Linker system for manual path design.
 *
 * Design Philosophy:
 * "Fate is chosen, not computed."
 */

import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { TacticalHologram } from '../visualization/TacticalHologram';
import { ScanLineEffect } from '../visualization/ScanLineEffect';
import { NavigationCameraController } from './NavigationCameraController';
import { LAYOUT } from '../../../shared/design';
import type { NavigationStartHooks } from '../NavigationEngine';

// Phase 3: Fate-Linker System
import { TacticalDesignController, type TacticalDesignState, type TacticalInputMode } from '../tactical';
import { FlightController, type FlightResult } from '../flight';
import { CoordinateMapper } from '../mapping/CoordinateMapper';

// LoadUnit-based Loading Architecture
import {
    LoadingPhase,
    ArcanaLoadingOrchestrator,
    MaterialWarmupUnit,
    RenderReadyBarrierUnit,
    BarrierRequirement,
    VisualReadyUnit,
    createTacticalGridVisualRequirement,
    type LoadUnit,
} from '../../../core/loading';
import {
    EnvironmentUnit,
    TacticalGridUnit,
    OctreeUnit,
} from '../loading/units';

// Phase 3: Character Loading
import { CharacterLoadUnit } from '../loading/CharacterLoadUnit';

export interface NavigationSceneConfig {
    /** @deprecated Energy budget is no longer used in Phase 3 */
    energyBudget?: number;
    /** Maximum nodes for Fate-Linker */
    maxNodes?: number;
    /** Character model path */
    characterModelPath?: string;
}

/**
 * NavigationScene - Phase 3 tactical planning scene.
 *
 * Key Changes from Phase 2:
 * - NO NavigationGraph (legacy)
 * - NO PathStore (legacy)
 * - NO Dijkstra-based validation
 * - Uses FateLinker for manual node design
 * - Uses FlightController for path execution
 */
export class NavigationScene {
    private scene: BABYLON.Scene;

    // Phase 3: Core systems
    private tacticalDesign: TacticalDesignController;
    private flightController: FlightController;
    private mapper: CoordinateMapper;
    private characterLoadUnit: CharacterLoadUnit | null = null;

    // Visualization
    private hologram: TacticalHologram;
    private scanLine: ScanLineEffect;
    private cameraController: NavigationCameraController;

    // UI
    private hud: TacticalHUD | null = null;

    // State
    private active: boolean = false;
    private inputLocked: boolean = false;
    private isFlying: boolean = false;

    // LoadUnit-based Loading Architecture
    private orchestrator: ArcanaLoadingOrchestrator | null = null;
    private environmentUnit: EnvironmentUnit | null = null;
    private currentPhase: LoadingPhase = LoadingPhase.PENDING;

    // Camera
    private previousCamera: BABYLON.Camera | null = null;
    private navigationCamera: BABYLON.ArcRotateCamera | null = null;

    private currentStage = { episode: 1, stage: 1 } as const;
    private startHooks: NavigationStartHooks | null = null;
    private config: NavigationSceneConfig;

    constructor(scene: BABYLON.Scene, systemLayer: GUI.Rectangle, config: NavigationSceneConfig = {}) {
        this.scene = scene;
        this.config = config;

        // Phase 3: Initialize Fate-Linker based systems
        this.tacticalDesign = new TacticalDesignController(scene, {
            maxNodes: config.maxNodes ?? 15,
        });

        this.flightController = new FlightController(scene, {
            speed: 8,
        });

        this.mapper = new CoordinateMapper();

        // Visualization
        this.hologram = new TacticalHologram(this.scene);
        this.scanLine = new ScanLineEffect(this.scene);
        this.cameraController = new NavigationCameraController(this.scene, this.hologram, this.scanLine);

        // Setup tactical design callbacks
        this.setupTacticalCallbacks();

        // Create HUD
        this.hud = new TacticalHUD(systemLayer, {
            onClear: () => this.clearPath(),
            onUndo: () => this.undoLastNode(),
            onConfirm: () => this.confirmAndLaunch(),
            onModeToggle: () => this.toggleInputMode(),
        });
    }

    private setupTacticalCallbacks(): void {
        this.tacticalDesign.setCallbacks({
            onStateChange: (state) => {
                this.hud?.updateState(state);
            },
            onNodeAdded: (node) => {
                console.log(`[NavigationScene] Node ${node.index} added at`, node.position.toString());
            },
            onNodeRemoved: (index) => {
                console.log(`[NavigationScene] Node ${index} removed`);
            },
            onPathChanged: (nodeCount) => {
                console.log(`[NavigationScene] Path changed: ${nodeCount} nodes`);
            },
        });
    }

    private ensureNavigationCamera(): void {
        if (this.navigationCamera && !this.navigationCamera.isDisposed()) return;

        this.previousCamera = this.scene.activeCamera ?? null;

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
        cam.panningSensibility = 200; // Enable panning for Phase 3

        cam.layerMask = 0x0FFFFFFF;
        (cam as any).includeOnlyWithLayerMask = 0;

        cam.attachControl(this.scene.getEngine().getRenderingCanvas(), true);

        this.scene.activeCamera = cam;
        this.navigationCamera = cam;

        // Connect camera to tactical design controller
        this.tacticalDesign.setCamera(cam);

        // Keep render quality
        const rq = (this.scene.metadata as any)?.renderQuality as { addCamera?: (c: BABYLON.Camera) => void } | undefined;
        rq?.addCamera?.(cam);

        console.log('[NavigationScene] Camera initialized');
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
        this.isFlying = false;
        this.startHooks = hooks;

        if (hooks.stage) {
            (this.currentStage as any) = { episode: hooks.stage.episode, stage: hooks.stage.stage };
        }

        this.ensureNavigationCamera();

        this.hologram.enable();
        this.hologram.setVisibility(0);

        this.hud?.show();
        this.hud?.updateState(this.tacticalDesign.getState());

        this.inputLocked = true;
        void this.startAsync();

        console.log('[NavigationScene] Started (Phase 3)');
    }

    private async startAsync(): Promise<void> {
        const hooks = this.startHooks;
        const dbg = hooks?.dbg;
        const startTime = performance.now();

        try {
            // Reset state
            this.tacticalDesign.clearAllNodes();
            this.disposeEnvironment();
            this.orchestrator?.dispose();

            // Create orchestrator
            this.orchestrator = new ArcanaLoadingOrchestrator(this.scene, {
                enableCompressionAnimation: true,
                barrierValidation: {
                    minActiveMeshCount: 1,
                    maxRetryFrames: 15,
                },
            });

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
                },
                onBarrierResolve: () => {
                    dbg?.end('BARRIER');
                },
                onLaunch: () => {
                    hooks?.onLog?.('[LAUNCH] Loading complete!');
                },
            });

            // Create LoadUnits
            this.environmentUnit = new EnvironmentUnit({
                stage: this.currentStage,
            });

            // Phase 3: Character LoadUnit
            if (this.config.characterModelPath) {
                this.characterLoadUnit = new CharacterLoadUnit({
                    modelPath: this.config.characterModelPath,
                    characterName: 'FlightCharacter',
                    initialScale: 1,
                });
            }

            const units: LoadUnit[] = [
                // FETCHING phase
                this.environmentUnit,

                // BUILDING phase
                new TacticalGridUnit({
                    hologram: this.hologram,
                    initialVisibility: 0,
                }),
                new OctreeUnit(),

                // WARMING phase
                MaterialWarmupUnit.createNavigationWarmupUnit(),

                // BARRIER phase
                RenderReadyBarrierUnit.createForNavigation({
                    requirements: [
                        {
                            id: this.hologram.getGridMeshName(),
                            evidence: 'RENDER_READY',
                        } as BarrierRequirement,
                    ],
                }),

                // VISUAL_READY phase
                new VisualReadyUnit('nav-visual-ready', {
                    displayName: 'TacticalGrid Visual Verification',
                    requirements: [
                        createTacticalGridVisualRequirement(),
                    ],
                }),
            ];

            // Add character unit if configured
            if (this.characterLoadUnit) {
                units.splice(1, 0, this.characterLoadUnit);
            }

            this.orchestrator.registerUnits(units);

            dbg?.begin('LOADING');

            const result = await this.orchestrator.execute({
                onLog: hooks?.onLog,
                onReady: () => {
                    console.log('[READY] Loading complete, starting camera transition');
                    hooks?.onLog?.('[READY] reached');

                    this.cameraController.transitionIn(LAYOUT.HOLOGRAM.GRID_SIZE / 2, () => {
                        this.scene.onAfterRenderObservable.addOnce(() => {
                            this.inputLocked = false;
                            console.log('[POST_READY] Input unlocked');
                            hooks?.onLog?.('[POST_READY] input unlocked');
                            hooks?.onProgress?.(1);
                            hooks?.onReady?.();
                        });
                    });
                },
                onError: (err) => {
                    console.error('[NavigationScene] Loading failed', err);
                },
            });

            dbg?.end('LOADING');

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

    private setPhase(phase: LoadingPhase, hooks?: NavigationStartHooks | null): void {
        this.currentPhase = phase;
        console.log(`[NavigationScene] Phase: ${phase}`);
        hooks?.onLog?.(`--- Phase: ${phase} ---`);
    }

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
        this.isFlying = false;
        this.currentPhase = LoadingPhase.PENDING;

        this.orchestrator?.cancel();
        this.orchestrator?.dispose();
        this.orchestrator = null;

        this.hud?.hide();
        this.tacticalDesign.clearAllNodes();
        this.scanLine.dispose();
        this.hologram.dispose();
        this.disposeEnvironment();

        if (this.characterLoadUnit) {
            this.characterLoadUnit.dispose();
            this.characterLoadUnit = null;
        }

        this.restorePreviousCamera();
        console.log('[NavigationScene] Stopped');
    }

    isActive(): boolean {
        return this.active;
    }

    getCurrentPhase(): LoadingPhase {
        return this.currentPhase;
    }

    /**
     * Handle pointer down from InteractionLayer
     * Phase 3: Start tap detection
     */
    handlePointerDown(pointerX: number, pointerY: number): void {
        if (!this.active) return;
        if (this.inputLocked) return;
        if (this.isFlying) return;

        this.tacticalDesign.handlePointerDown(pointerX, pointerY);
    }

    /**
     * Handle pointer up from InteractionLayer
     * Phase 3: Complete tap detection
     */
    handlePointerUp(pointerX: number, pointerY: number): void {
        if (!this.active) return;
        if (this.inputLocked) return;
        if (this.isFlying) return;

        this.tacticalDesign.handlePointerUp(pointerX, pointerY);
    }

    /**
     * Handle tap from InteractionLayer (legacy, kept for compatibility)
     * Phase 3: Delegates to TacticalDesignController
     */
    handleTap(pointerX: number, pointerY: number): void {
        if (!this.active) return;
        if (this.inputLocked) return;
        if (this.isFlying) return;

        this.tacticalDesign.handleTap(pointerX, pointerY);
    }

    /**
     * Set input mode (camera or design)
     */
    setInputMode(mode: TacticalInputMode): void {
        this.tacticalDesign.setInputMode(mode);
    }

    /**
     * Get current input mode
     */
    getInputMode(): TacticalInputMode {
        return this.tacticalDesign.getInputMode();
    }

    /**
     * Cycle through input modes: camera → place → edit → camera
     */
    cycleInputMode(): TacticalInputMode {
        return this.tacticalDesign.cycleInputMode();
    }

    /**
     * Toggle input mode (legacy - use cycleInputMode)
     */
    toggleInputMode(): TacticalInputMode {
        return this.tacticalDesign.cycleInputMode();
    }

    /**
     * Clear all nodes
     */
    private clearPath(): void {
        if (this.isFlying) return;
        this.tacticalDesign.clearAllNodes();
    }

    /**
     * Undo last node
     */
    private undoLastNode(): void {
        if (this.isFlying) return;
        this.tacticalDesign.removeLastNode();
    }

    /**
     * Confirm path and launch flight
     */
    async confirmAndLaunch(): Promise<void> {
        if (!this.active) return;
        if (this.inputLocked) return;
        if (this.isFlying) return;

        const state = this.tacticalDesign.getState();
        if (!state.canLaunch) {
            console.log('[NavigationScene] Cannot launch: need at least 2 nodes');
            return;
        }

        this.isFlying = true;
        this.inputLocked = true;

        // Lock tactical editing
        this.tacticalDesign.lock();

        // Get wind trail for launch animation
        const windTrail = this.tacticalDesign.getWindTrail();

        // Play launch animation
        await windTrail.playLaunchAnimation(1000);

        // Generate flight path
        const path3D = this.tacticalDesign.generatePath3D();
        if (!path3D) {
            console.error('[NavigationScene] Failed to generate Path3D');
            this.returnToDesign();
            return;
        }

        // Get character if loaded
        const character = this.characterLoadUnit?.getCharacter();
        if (!character) {
            console.log('[NavigationScene] No character loaded, simulating flight...');
            // Simulate flight without character
            await this.simulateFlight(path3D);
        } else {
            // Initialize and start flight
            this.flightController.initialize(character, path3D);

            // Play fly animation
            this.characterLoadUnit?.playAnimation('Fly', true);

            const result = await this.flightController.startFlight();
            this.onFlightComplete(result);
        }
    }

    private async simulateFlight(path3D: BABYLON.Path3D): Promise<void> {
        // Simple camera fly-through for testing
        const points = path3D.getPoints();
        const duration = 3000; // 3 seconds
        const startTime = performance.now();

        return new Promise((resolve) => {
            const observer = this.scene.onBeforeRenderObservable.add(() => {
                const elapsed = performance.now() - startTime;
                const t = Math.min(elapsed / duration, 1);

                const pointIndex = Math.floor(t * (points.length - 1));
                const position = points[pointIndex] ?? points[points.length - 1];

                if (this.navigationCamera) {
                    this.navigationCamera.target = position;
                }

                if (t >= 1) {
                    this.scene.onBeforeRenderObservable.remove(observer);
                    this.onFlightComplete({
                        completed: true,
                        totalTimeMs: duration,
                        finalPosition: points[points.length - 1],
                        aborted: false,
                    });
                    resolve();
                }
            });
        });
    }

    private onFlightComplete(result: FlightResult): void {
        console.log(`[NavigationScene] Flight ${result.completed ? 'completed' : 'aborted'} in ${Math.round(result.totalTimeMs)}ms`);

        // Return to design phase
        this.returnToDesign();

        // Notify hooks
        this.startHooks?.onLog?.(`Flight ${result.completed ? 'completed' : 'aborted'}`);
    }

    private returnToDesign(): void {
        this.isFlying = false;
        this.inputLocked = false;

        // Unlock tactical editing
        this.tacticalDesign.unlock();

        // Reset wind trail mode
        this.tacticalDesign.getWindTrail().setMode('design');

        console.log('[NavigationScene] Returned to design phase');
    }

    /**
     * Get flight path for external use
     */
    getFlightCurve(): BABYLON.Curve3 | null {
        const positions = this.tacticalDesign.getNodePositions();
        if (positions.length < 2) return null;

        const inGamePoints = positions.map((p) => this.mapper.tacticalToInGame(p));
        return BABYLON.Curve3.CreateCatmullRomSpline(inGamePoints, 24, false);
    }

    dispose(): void {
        this.stop();
        this.tacticalDesign.dispose();
        this.flightController.dispose();
        this.hud?.dispose();
    }
}

/**
 * TacticalHUD - Phase 3 UI for tactical design
 */
class TacticalHUD {
    private container: GUI.Rectangle;
    private nodeCountText: GUI.TextBlock;
    private statusText: GUI.TextBlock;
    private modeButton: GUI.Button;
    private clearButton: GUI.Button;
    private undoButton: GUI.Button;
    private confirmButton: GUI.Button;

    constructor(
        parent: GUI.Rectangle,
        callbacks: {
            onClear: () => void;
            onUndo: () => void;
            onConfirm: () => void;
            onModeToggle: () => void;
        }
    ) {
        // Container
        this.container = new GUI.Rectangle('TacticalHUD');
        this.container.width = '300px';
        this.container.height = '150px';
        this.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.top = '20px';
        this.container.left = '-20px';
        this.container.background = 'rgba(0, 0, 0, 0.7)';
        this.container.cornerRadius = 10;
        this.container.thickness = 1;
        this.container.color = 'rgba(100, 150, 255, 0.5)';
        this.container.isVisible = false;
        parent.addControl(this.container);

        // Node count
        this.nodeCountText = new GUI.TextBlock('nodeCount', 'Nodes: 0 / 15');
        this.nodeCountText.height = '30px';
        this.nodeCountText.top = '-40px';
        this.nodeCountText.color = 'white';
        this.nodeCountText.fontSize = 16;
        this.container.addControl(this.nodeCountText);

        // Status
        this.statusText = new GUI.TextBlock('status', 'Tap to add nodes');
        this.statusText.height = '25px';
        this.statusText.top = '-10px';
        this.statusText.color = 'rgba(150, 200, 255, 0.9)';
        this.statusText.fontSize = 12;
        this.container.addControl(this.statusText);

        // Mode button (separate from main buttons, positioned at top-left of container)
        this.modeButton = GUI.Button.CreateSimpleButton('mode', 'Design');
        this.modeButton.width = '80px';
        this.modeButton.height = '28px';
        this.modeButton.color = 'white';
        this.modeButton.background = 'rgba(80, 120, 200, 0.9)';
        this.modeButton.cornerRadius = 5;
        this.modeButton.fontSize = 12;
        this.modeButton.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.modeButton.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.modeButton.top = '-55px';
        this.modeButton.left = '10px';
        this.modeButton.onPointerClickObservable.add(() => callbacks.onModeToggle());
        this.container.addControl(this.modeButton);

        // Button container
        const buttonPanel = new GUI.StackPanel('buttons');
        buttonPanel.isVertical = false;
        buttonPanel.height = '40px';
        buttonPanel.top = '40px';
        buttonPanel.spacing = 10;
        this.container.addControl(buttonPanel);

        // Clear button
        this.clearButton = GUI.Button.CreateSimpleButton('clear', 'Clear');
        this.clearButton.width = '70px';
        this.clearButton.height = '35px';
        this.clearButton.color = 'white';
        this.clearButton.background = 'rgba(200, 50, 50, 0.8)';
        this.clearButton.cornerRadius = 5;
        this.clearButton.onPointerClickObservable.add(() => callbacks.onClear());
        buttonPanel.addControl(this.clearButton);

        // Undo button
        this.undoButton = GUI.Button.CreateSimpleButton('undo', 'Undo');
        this.undoButton.width = '70px';
        this.undoButton.height = '35px';
        this.undoButton.color = 'white';
        this.undoButton.background = 'rgba(100, 100, 100, 0.8)';
        this.undoButton.cornerRadius = 5;
        this.undoButton.onPointerClickObservable.add(() => callbacks.onUndo());
        buttonPanel.addControl(this.undoButton);

        // Confirm/Launch button
        this.confirmButton = GUI.Button.CreateSimpleButton('confirm', 'START');
        this.confirmButton.width = '90px';
        this.confirmButton.height = '35px';
        this.confirmButton.color = 'white';
        this.confirmButton.background = 'rgba(50, 150, 50, 0.8)';
        this.confirmButton.cornerRadius = 5;
        this.confirmButton.onPointerClickObservable.add(() => callbacks.onConfirm());
        buttonPanel.addControl(this.confirmButton);
    }

    show(): void {
        this.container.isVisible = true;
    }

    hide(): void {
        this.container.isVisible = false;
    }

    updateState(state: TacticalDesignState): void {
        this.nodeCountText.text = `Nodes: ${state.nodeCount} / ${state.maxNodes}`;

        // Update mode button with 3-state display
        const modeTextBlock = this.modeButton.textBlock;
        if (modeTextBlock) {
            switch (state.inputMode) {
                case 'camera':
                    modeTextBlock.text = 'Camera';
                    break;
                case 'place':
                    modeTextBlock.text = 'Place';
                    break;
                case 'edit':
                    modeTextBlock.text = 'Edit';
                    break;
            }
        }

        // Mode-specific colors
        switch (state.inputMode) {
            case 'camera':
                this.modeButton.background = 'rgba(120, 80, 200, 0.9)';  // Purple
                break;
            case 'place':
                this.modeButton.background = 'rgba(80, 180, 80, 0.9)';   // Green
                break;
            case 'edit':
                this.modeButton.background = 'rgba(200, 150, 50, 0.9)';  // Gold
                break;
        }

        // Update status text based on mode
        if (state.isLocked) {
            this.statusText.text = 'Flight in progress...';
            this.statusText.color = 'rgba(255, 200, 100, 0.9)';
        } else if (state.canLaunch) {
            this.statusText.text = 'Ready to launch!';
            this.statusText.color = 'rgba(100, 255, 100, 0.9)';
        } else {
            switch (state.inputMode) {
                case 'camera':
                    this.statusText.text = 'Camera mode (drag to rotate)';
                    this.statusText.color = 'rgba(200, 150, 255, 0.9)';
                    break;
                case 'place':
                    this.statusText.text = state.nodeCount === 0
                        ? 'Tap to add nodes'
                        : `Add ${Math.max(0, 2 - state.nodeCount)} more nodes`;
                    this.statusText.color = 'rgba(150, 255, 150, 0.9)';
                    break;
                case 'edit':
                    this.statusText.text = state.selectedIndex >= 0
                        ? `Editing node ${state.selectedIndex}`
                        : 'Tap a node to edit';
                    this.statusText.color = 'rgba(255, 220, 100, 0.9)';
                    break;
            }
        }

        // Update button states
        this.clearButton.isEnabled = state.nodeCount > 0 && !state.isLocked;
        this.undoButton.isEnabled = state.nodeCount > 0 && !state.isLocked;
        this.confirmButton.isEnabled = state.canLaunch;
        this.modeButton.isEnabled = !state.isLocked;

        // Visual feedback for disabled buttons
        this.clearButton.alpha = this.clearButton.isEnabled ? 1 : 0.5;
        this.undoButton.alpha = this.undoButton.isEnabled ? 1 : 0.5;
        this.confirmButton.alpha = this.confirmButton.isEnabled ? 1 : 0.5;
        this.modeButton.alpha = this.modeButton.isEnabled ? 1 : 0.5;
    }

    dispose(): void {
        this.container.dispose();
    }
}
