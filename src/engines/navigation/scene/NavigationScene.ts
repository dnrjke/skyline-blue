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
    SceneMaterialWarmupUnit,
    RenderReadyBarrierUnit,
    BarrierRequirement,
    waitForEngineAwakened,
    RenderingIntentKeeper,
    type LoadUnit,
} from '../../../core/loading';
import {
    EnvironmentUnit,
    TacticalGridUnit,
    OctreeUnit,
} from '../loading/units';

// Phase 3: Character Loading
import { CharacterLoadUnit, type FlightAnimationRole } from '../loading/CharacterLoadUnit';

// Debug: Render Desync Investigation
import { RenderDesyncProbe, markVisualReadyTimestamp, validateAcceptanceCriteria } from '../debug/RenderDesyncProbe';
import { BlackHoleLogger } from '../debug/BlackHoleLogger';
import { EnginePhysicalStateProbe } from '../debug/EnginePhysicalStateProbe';
import { BlackHoleForensicProbe } from '../debug/BlackHoleForensicProbe';
import { PhysicalReadyCaptureProbe } from '../debug/PhysicalReadyCaptureProbe';
import { PhysicalReadyFlightRecorderProbe } from '../debug/PhysicalReadyFlightRecorderProbe';

// Phase 2.6: GPU Pulse Host System
import {
    GPUPulseSystem,
    type IGPUPulseReceiver,
    type PulseTransferConditions,
} from '../../../core/gpu-pulse';

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
    private debugPanel: AnimationDebugPanel | null = null;
    private characterVisible: boolean = false;

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

    // Debug: Render Desync Probe
    private renderDesyncProbe: RenderDesyncProbe | null = null;

    // Debug: BlackHole Logger (ultra-precision READY→normalization gap tracker)
    private blackHoleLogger: BlackHoleLogger | null = null;

    // Debug: Physical State Probe (Resize Black Hole dissection)
    private physicalStateProbe: EnginePhysicalStateProbe | null = null;

    // Debug: Forensic Probe (postmortem-level physical state timeline)
    private forensicProbe: BlackHoleForensicProbe | null = null;

    // Debug: Capture Probe (raw physical state flight recorder for first-true edge)
    private captureProbe: PhysicalReadyCaptureProbe | null = null;

    // Debug: Flight Recorder (JSON event timeline for frame-level analysis)
    private flightRecorder: PhysicalReadyFlightRecorderProbe | null = null;

    // Active Engagement Strategy (🅰️+): Rendering Intent Keeper
    private intentKeeper: RenderingIntentKeeper | null = null;

    // Phase 2.6: GPU Pulse Host System
    private gpuPulseSystem: GPUPulseSystem | null = null;
    private systemLayer: GUI.Rectangle;

    private currentStage = { episode: 1, stage: 1 } as const;
    private startHooks: NavigationStartHooks | null = null;
    private config: NavigationSceneConfig;

    constructor(scene: BABYLON.Scene, systemLayer: GUI.Rectangle, config: NavigationSceneConfig = {}) {
        this.scene = scene;
        this.config = config;
        this.systemLayer = systemLayer;

        // Phase 3: Initialize Fate-Linker based systems
        this.tacticalDesign = new TacticalDesignController(scene, {
            maxNodes: config.maxNodes ?? 15,
        });

        this.flightController = new FlightController(scene, {
            baseSpeed: 6,
            maxSpeed: 14,
            acceleration: 1.5,
            bankingIntensity: 1.8,
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
            onUndo: () => this.handleUndo(),
            onRedo: () => this.handleRedo(),
            onConfirm: () => this.confirmAndLaunch(),
            onSetMode: (mode) => this.setInputMode(mode),
            onToggleDebug: () => this.toggleDebugPanel(),
        });

        // Create Animation Debug Panel
        this.debugPanel = new AnimationDebugPanel(systemLayer, {
            onPlayRole: (role) => this.debugPlayRole(role),
            onToggleVisibility: () => this.debugToggleCharacter(),
            onAdjustCamera: (preset) => this.debugSetCameraPreset(preset),
            onStopAnimation: () => this.debugStopAnimation(),
        });

        // Debug: Create Render Desync Probe
        this.renderDesyncProbe = new RenderDesyncProbe(scene);

        // Debug: Create BlackHole Logger (enabled for READY→normalization tracking)
        this.blackHoleLogger = new BlackHoleLogger(scene, {
            enabled: true,
            stallThresholdMs: 100,
            meshSampleInterval: 5,
            autoStopMs: 300_000,
            consoleStalls: true,
        });

        // Debug: Create Physical State Probe (canvas/engine size dissection)
        this.physicalStateProbe = new EnginePhysicalStateProbe(scene, {
            maxDurationMs: 600_000,   // 10min max
            snapshotInterval: 10,     // Every 10 frames
            consoleOutput: true,
        });

        // Debug: Forensic Probe (postmortem-level timeline reconstruction)
        this.forensicProbe = new BlackHoleForensicProbe(scene, {
            maxDurationMs: 600_000,
            consoleOutput: true,
            convergenceSampleInterval: 30,
        });

        // Debug: Capture Probe (raw physical state flight recorder)
        this.captureProbe = new PhysicalReadyCaptureProbe(scene, {
            maxDurationMs: 600_000,
            consoleOutput: true,
            ringBufferCapacity: 1800,    // 30s @ 60fps
            postTriggerFrames: 300,      // 5s @ 60fps
        });

        // Debug: Flight Recorder (JSON event timeline for problem root-cause)
        this.flightRecorder = new PhysicalReadyFlightRecorderProbe(scene, {
            maxDurationMs: 600_000,
            consoleOutput: true,
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

        // NOTE: attachControl is deliberately NOT called here.
        // Camera controls are enabled only AFTER ENGINE_AWAKENED barrier passes.
        // This prevents user input during loading phase.

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

            // === Phase 2.6: Initialize GPU Pulse System ===
            // GPU Pulse Host must be active BEFORE any loading begins.
            // This ensures continuous GPU heartbeat throughout the loading phase.
            this.gpuPulseSystem?.dispose();

            // Get GUI texture from system layer for debug overlay
            const guiTexture = this.systemLayer._host as GUI.AdvancedDynamicTexture | undefined;

            this.gpuPulseSystem = GPUPulseSystem.create(
                this.scene.getEngine() as BABYLON.Engine,
                this.scene,
                {
                    debug: true,
                    debugOverlay: !!guiTexture,
                    guiTexture: guiTexture,
                    recoveryTimeoutMs: 500,
                    maxRecoveryRetries: 3,
                }
            );

            // Register NavigationScene as pulse receiver
            this.gpuPulseSystem.registerGameScene(this.createPulseReceiver());

            // Begin GPU Pulse - Loading Host now owns the pulse
            this.gpuPulseSystem.beginPulse('navigation-loading');

            // ===== RAF WARM-UP GATE =====
            // CRITICAL: Wait for RAF to stabilize BEFORE any heavy work.
            // This prevents the 191ms main thread blocking from causing
            // Chromium to classify the app as "idle" and throttle RAF.
            hooks?.onLog?.('[WARMUP] Waiting for RAF stabilization...');
            const warmupResult = await this.gpuPulseSystem.waitForWarmup();
            if (warmupResult.success) {
                hooks?.onLog?.(`[WARMUP] Gate OPEN (${warmupResult.stableFramesAchieved} stable frames, ${warmupResult.avgFrameIntervalMs.toFixed(1)}ms avg)`);
            } else {
                hooks?.onLog?.(`[WARMUP] Timeout (proceeding anyway)`);
            }

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
                    // NOTE: markVisualReadyTimestamp() is NOT called here.
                    // VISUAL_READY is now verified AFTER ENGINE_AWAKENED barrier
                    // (post-burst, natural RAF frame with TacticalGrid in frustum).
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
                // 1. Navigation-specific emissive materials (path effects, nodes)
                MaterialWarmupUnit.createNavigationWarmupUnit(),
                // 2. Scene-wide material warmup (🅰️+ Active Engagement Strategy)
                //    Warms ALL materials from loaded meshes including TacticalGrid and character
                SceneMaterialWarmupUnit.createForNavigation(),

                // BARRIER phase
                RenderReadyBarrierUnit.createForNavigation({
                    requirements: [
                        {
                            id: this.hologram.getGridMeshName(),
                            evidence: 'RENDER_READY',
                        } as BarrierRequirement,
                    ],
                }),

                // NOTE: VisualReadyUnit is deliberately NOT registered here.
                // VISUAL_READY verification is performed AFTER ENGINE_AWAKENED barrier,
                // ensuring TacticalGrid is confirmed in a NATURAL RAF frame (not forced burst).
            ];

            // Add character unit if configured
            if (this.characterLoadUnit) {
                units.splice(1, 0, this.characterLoadUnit);
            }

            // [Option C] Units are passed directly to execute() - no external registerUnits()
            dbg?.begin('LOADING');

            const result = await this.orchestrator.execute({
                units, // Pass units here, not via registerUnits()
                onLog: hooks?.onLog,
                onReady: () => {
                    // VISUAL_READY/STABILIZING complete — orchestrator logical load done.
                    // ⚠️ This is NOT our READY. ENGINE_AWAKENED barrier comes next.
                    console.log('[ORCHESTRATOR_DONE] Logical loading complete, entering ENGINE_AWAKENED gate...');
                    hooks?.onLog?.('[ORCHESTRATOR_DONE] Assets loaded, verifying render loop...');

                    // ===== DEBUG: Start Render Desync Probe =====
                    this.renderDesyncProbe?.startProbe();

                    // ⚠️ FORBIDDEN before ENGINE_AWAKENED:
                    // - camera transition
                    // - camera.attachControl
                    // - navigation update loop
                    // - input unlock
                },
                onError: (err) => {
                    console.error('[NavigationScene] Loading failed', err);
                },
            });

            if (result.phase === LoadingPhase.FAILED) {
                throw result.error ?? new Error('Loading failed');
            }

            // ===== ENGINE_AWAKENED_BARRIER (HARD GATE) =====
            // PREREQUISITE for READY — must pass before any UX action.
            // Flow: VISUAL_READY → [Phase 1: Burst] → [Phase 2: Natural Stable] → READY → UX_READY
            //
            // Phase 1: RAF Wake-Up Burst (forced frames, no measurement)
            // Phase 2: Natural Stable Detection (onBeforeRender, dt-based)
            //
            // ⚠️ This is a HARD GATE. If it fails, READY is NEVER declared.
            if (result.phase === LoadingPhase.READY) {
                // Start BlackHole Logger at the point where rendering should be stable
                this.blackHoleLogger?.start();
                this.blackHoleLogger?.trackMesh('TacticalGrid');
                this.blackHoleLogger?.markPhase('ENGINE_AWAKENED_START');
                this.blackHoleLogger?.snapshotGPUState('PRE_BARRIER');

                // Start Forensic Probe: captures full physical timeline from here
                this.forensicProbe?.start();
                this.forensicProbe?.markPhase('ENGINE_AWAKENED_START', 'logical');

                // Start Capture Probe: raw physical state flight recorder
                this.captureProbe?.start();
                this.captureProbe?.markPhase('ENGINE_AWAKENED_START');

                // Start Flight Recorder: JSON event timeline from here
                this.flightRecorder?.start();
                this.flightRecorder?.markPhase('ENGINE_AWAKENED_START');

                console.log('[ENGINE_AWAKENED] Starting two-phase barrier...');
                hooks?.onLog?.('[ENGINE_AWAKENED] Phase 1: RAF burst, Phase 2: stable detection...');

                const awakenedResult = await waitForEngineAwakened(this.scene, {
                    minConsecutiveFrames: 3,
                    maxAllowedFrameGapMs: 100,  // Relaxed for DevTools-independent operation
                    maxWaitMs: 3000,
                    burstFrameCount: 5,
                    maxBurstRetries: 2,
                    gracefulFallbackMs: 500,    // Pass if ANY frames within 500ms (DevTools-independent)
                    debug: true,
                });

                if (!awakenedResult.passed) {
                    // HARD FAIL — engine never achieved stable natural rendering
                    console.error(
                        '[ENGINE_AWAKENED] ✗ HARD GATE FAILED. READY will NOT be declared.',
                        `naturalFrames=${awakenedResult.framesRendered}, ` +
                        `stable=${awakenedResult.stableFrameCount}, ` +
                        `firstNaturalFrameDelay=${awakenedResult.firstFrameDelayMs.toFixed(1)}ms, ` +
                        `bursts=${awakenedResult.burstCount}, ` +
                        `timedOut=${awakenedResult.timedOut}`
                    );
                    hooks?.onLog?.('[ENGINE_AWAKENED] ✗ HARD FAIL — natural render loop unstable');
                    throw new Error(
                        `ENGINE_AWAKENED barrier failed: ${awakenedResult.framesRendered} natural frames, ` +
                        `${awakenedResult.stableFrameCount} stable (need 3), ` +
                        `bursts=${awakenedResult.burstCount}`
                    );
                }

                // ===== ACCEPTANCE CRITERIA VALIDATION =====
                // First natural frame delay check
                if (awakenedResult.firstFrameDelayMs > 50) {
                    console.warn(
                        `[ENGINE_AWAKENED] ⚠️ First natural frame delay ` +
                        `${awakenedResult.firstFrameDelayMs.toFixed(1)}ms > 50ms threshold ` +
                        `(bursts=${awakenedResult.burstCount}).`
                    );
                    hooks?.onLog?.(
                        `[ENGINE_AWAKENED] ⚠️ First natural frame delay: ${Math.round(awakenedResult.firstFrameDelayMs)}ms`
                    );
                }

                this.blackHoleLogger?.markPhase('ENGINE_AWAKENED_PASSED', {
                    stableFrames: awakenedResult.stableFrameCount,
                    burstCount: awakenedResult.burstCount,
                    firstFrameDelay: awakenedResult.firstFrameDelayMs,
                });
                this.blackHoleLogger?.snapshotGPUState('POST_BARRIER');
                this.forensicProbe?.markPhase('ENGINE_AWAKENED_PASSED', 'logical', {
                    stableFrames: awakenedResult.stableFrameCount,
                    firstFrameDelay: awakenedResult.firstFrameDelayMs,
                });
                this.captureProbe?.markPhase('ENGINE_AWAKENED_PASSED');
                this.flightRecorder?.markPhase('ENGINE_AWAKENED_PASSED');

                // ===== ACTIVE ENGAGEMENT: Start Rendering Intent Keeper (🅰️+) =====
                // Signal to Chromium that this is an active real-time graphics app.
                // The keeper registers a read-only onBeforeRender observer that performs
                // minimal computation each frame, persuading the browser scheduler to
                // maintain active GPU scheduling.
                this.intentKeeper = new RenderingIntentKeeper(this.scene, { debug: false });
                this.intentKeeper.start();

                // ===== GPU PULSE TRANSFER (Phase 2.6) =====
                // Transfer pulse ownership from Loading Host to Game Scene.
                // This is the atomic handoff - no blank frames allowed.
                // Transfer will be blocked if RAF is throttled - retry until healthy.
                if (this.gpuPulseSystem) {
                    this.attemptPulseTransferWithRetry();
                }

                // ===== CAMERA TRANSITION (starts grid visibility animation) =====
                // The camera transition controls hologram visibility (0→1 over 1.1s).
                // It MUST start BEFORE VISUAL_READY check so the grid becomes renderable.
                // Without this, the grid has visibility=0 and never appears in activeMeshes.
                console.log('[TRANSITION] Starting camera transition (grid fade-in)...');
                hooks?.onLog?.('[TRANSITION] Camera + grid visibility animation starting...');
                this.blackHoleLogger?.markTransition('CAMERA_GRID', 'start');

                const transitionDone = new Promise<void>((resolveTransition) => {
                    this.cameraController.transitionIn(LAYOUT.HOLOGRAM.GRID_SIZE / 2, () => {
                        console.log('[TRANSITION] Camera transition complete');
                        resolveTransition();
                    });
                });

                // ===== VISUAL_READY v2 (Post-Burst Natural Frame Verification) =====
                // Wait for TacticalGrid to be confirmed in a NATURAL onBeforeRender→onAfterRender cycle.
                // The camera transition above has started animating visibility from 0→1,
                // so the grid will appear in activeMeshes once visibility > 0.
                console.log('[VISUAL_READY v2] Waiting for TacticalGrid in natural frame...');
                hooks?.onLog?.('[VISUAL_READY v2] Verifying TacticalGrid in natural RAF frame...');

                await this.waitForNaturalVisualReady();

                this.blackHoleLogger?.markPhase('VISUAL_READY_CONFIRMED');
                this.blackHoleLogger?.snapshotGPUState('POST_VISUAL_READY');
                this.forensicProbe?.markPhase('VISUAL_READY_CONFIRMED', 'logical');
                this.captureProbe?.markPhase('VISUAL_READY_CONFIRMED');
                this.flightRecorder?.markPhase('VISUAL_READY_CONFIRMED');

                // ===== READY =====
                // Engine is confirmed awake. Natural frames are stable.
                // VISUAL_READY confirmed: TacticalGrid rendered in natural frame (visibility > 0).
                // At this point: RAF is running, grid confirmed in activeMeshes.

                // Mark READY timestamp for probe validation
                this.renderDesyncProbe?.markReadyDeclared();
                this.blackHoleLogger?.markPhase('READY_DECLARED');
                this.forensicProbe?.markPhase('READY_DECLARED', 'logical');
                this.captureProbe?.markPhase('READY_DECLARED');
                this.flightRecorder?.markPhase('READY_DECLARED');

                // Start Physical State Probe: tracks canvas/engine/hwScale/resize
                // from READY until PHYSICAL_READY_FRAME or timeout
                this.physicalStateProbe?.start();

                console.log(
                    `[READY] Engine confirmed awake: ` +
                    `${awakenedResult.stableFrameCount} stable natural frames, ` +
                    `avg dt=${awakenedResult.avgFrameIntervalMs.toFixed(1)}ms, ` +
                    `first natural frame delay=${awakenedResult.firstFrameDelayMs.toFixed(1)}ms, ` +
                    `bursts=${awakenedResult.burstCount}`
                );
                hooks?.onLog?.('[READY] TacticalGrid rendered — waiting for transition...');

                // Validate RenderDesyncProbe acceptance criteria (BLOCKING)
                // If probe FAILS → READY is revoked, treated as loading failure
                if (this.renderDesyncProbe) {
                    const probeResult = validateAcceptanceCriteria(this.renderDesyncProbe);
                    if (!probeResult.passed) {
                        console.error(
                            '[READY] ✗ RenderDesyncProbe acceptance FAILED:',
                            probeResult.details.join('; ')
                        );
                        hooks?.onLog?.('[READY] ✗ Probe acceptance FAILED — aborting READY');
                        throw new Error(
                            `RenderDesyncProbe acceptance failed: ${probeResult.details.join('; ')}`
                        );
                    }
                    console.log('[READY] ✓ RenderDesyncProbe acceptance PASSED');
                }

                // Wait for camera transition to complete (grid fully visible)
                // This ensures the grid is at visibility=1 before user interaction
                await transitionDone;
                this.blackHoleLogger?.markTransition('CAMERA_GRID', 'complete');
                this.blackHoleLogger?.snapshotGPUState('POST_TRANSITION');
                console.log('[READY] Camera transition and grid visibility complete');

                // ===== UX_READY (1 frame after transition) =====
                // Wait exactly 1 frame before unlocking input.
                // This ensures the fully-visible grid is committed to screen.
                await this.waitOneFrame();

                console.log('[UX_READY] Input unlock + controls attach');
                hooks?.onLog?.('[UX_READY] Input unlocked');
                this.blackHoleLogger?.markPhase('UX_READY');
                this.blackHoleLogger?.markInput('InteractionLayer', true);
                this.forensicProbe?.markPhase('UX_READY', 'logical');

                // Now safe: attach camera controls, unlock input, finalize
                this.inputLocked = false;
                this.finalizeNavigationReady();

                // BlackHole Logger: normalization complete, stop tracking
                this.blackHoleLogger?.snapshotGPUState('POST_UX_READY');
                this.blackHoleLogger?.markPhase('NORMALIZATION_COMPLETE');
                this.blackHoleLogger?.stop();

                // Physical State Probe: print analysis at normalization
                // (probe continues running for extended monitoring — auto-stops at maxDurationMs)
                if (this.physicalStateProbe?.isActive()) {
                    this.physicalStateProbe.printAnalysis();
                }

                // Forensic Probe: mark normalization and print initial report
                // (probe keeps running to capture the full physical timeline)
                this.forensicProbe?.markPhase('NORMALIZATION_COMPLETE', 'logical');
                if (this.forensicProbe?.isActive()) {
                    this.forensicProbe.printReport();
                }

                // Capture Probe: mark normalization
                // (probe continues to run until first-true + post-history, or timeout)
                this.captureProbe?.markPhase('NORMALIZATION_COMPLETE');

                // Flight Recorder: mark normalization and print summary
                // (recorder continues until PHYSICAL_READY + post-record, or timeout)
                this.flightRecorder?.markPhase('NORMALIZATION_COMPLETE');
                if (this.flightRecorder?.isActive()) {
                    this.flightRecorder.printSummary();
                }

                // Log summary to console for easy access
                if (this.blackHoleLogger?.isActive() === false) {
                    const stallSummary = this.blackHoleLogger.getStallSummary();
                    if (stallSummary.count > 0) {
                        console.warn(
                            `[BlackHole] Summary: ${stallSummary.count} stalls detected, ` +
                            `maxGap=${stallSummary.maxGapMs.toFixed(0)}ms`
                        );
                    }
                }

                hooks?.onProgress?.(1);
                hooks?.onReady?.();
            }

            dbg?.end('LOADING');

            const totalMs = performance.now() - startTime;
            hooks?.onLog?.(`[COMPLETE] Total loading time: ${Math.round(totalMs)}ms`);

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

    /**
     * POST_READY Camera Restoration Protocol
     *
     * This method MUST be called after READY phase completes.
     * It ensures camera controls are properly restored after loading transition.
     *
     * Why this is critical:
     * - TacticalDesign may disable camera controls during design phase
     * - Engine resize may not trigger camera projection update
     * - Camera attach/detach lifecycle can cause "invisible but rendered" illusion
     *
     * @see src/agents/navigation-loading/AGENT.md
     */
    private finalizeNavigationReady(): void {
        const engine = this.scene.getEngine();
        const canvas = engine.getRenderingCanvas();
        const camera = this.navigationCamera;

        // 1. Force engine resize to update projection matrix
        engine.resize();

        // 2. Ensure camera controls are attached
        if (camera && canvas && !camera.isDisposed()) {
            // Re-attach controls (safe to call even if already attached)
            camera.attachControl(canvas, true);
        }

        // 3. Enable camera controller if it was disabled
        if (this.cameraController) {
            // CameraController may have enable/disable methods
            // This ensures it's in active state
            (this.cameraController as any).enable?.();
        }

        // 4. Force a render to apply changes
        this.scene.render();

        // 5. Log camera state for debugging
        console.info('[POST_READY] Camera controls restored', {
            cameraAttached: !!(camera?.inputs as any)?.attached,
            cameraPosition: camera?.position?.toString() ?? 'null',
            cameraTarget: camera?.target?.toString() ?? 'null',
            cameraRadius: camera?.radius ?? 0,
            engineWidth: engine.getRenderWidth(),
            engineHeight: engine.getRenderHeight(),
        });
    }

    /**
     * VISUAL_READY v2: Post-burst natural-frame TacticalGrid verification.
     *
     * Definition:
     *   VISUAL_READY = "자연 RAF 루프에 의해 onBeforeRender → onAfterRender 사이클이
     *   실제로 실행되었고, 그 프레임에서 TacticalGrid가 카메라 frustum 내에서 렌더됨"
     *
     * This MUST be called AFTER ENGINE_AWAKENED barrier passes (natural frames are stable).
     * It confirms TacticalGrid is visible in a NATURAL frame, then marks VISUAL_READY.
     *
     * @throws Error if TacticalGrid is not rendered within timeout
     */
    private waitForNaturalVisualReady(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const maxWaitMs = 3000;
            const gracefulFallbackMs = 500;
            const startTime = performance.now();
            let beforeRenderSeen = false;
            let naturalFrameCount = 0;
            let beforeRenderObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
            let afterRenderObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
            let hardTimeoutId: ReturnType<typeof setTimeout> | null = null;
            let gracefulTimeoutId: ReturnType<typeof setTimeout> | null = null;
            let resolved = false;

            const cleanup = () => {
                if (beforeRenderObserver) {
                    this.scene.onBeforeRenderObservable.remove(beforeRenderObserver);
                    beforeRenderObserver = null;
                }
                if (afterRenderObserver) {
                    this.scene.onAfterRenderObservable.remove(afterRenderObserver);
                    afterRenderObserver = null;
                }
                if (hardTimeoutId !== null) {
                    clearTimeout(hardTimeoutId);
                    hardTimeoutId = null;
                }
                if (gracefulTimeoutId !== null) {
                    clearTimeout(gracefulTimeoutId);
                    gracefulTimeoutId = null;
                }
            };

            const succeed = (method: string) => {
                if (resolved) return;
                resolved = true;
                const elapsed = performance.now() - startTime;
                cleanup();

                // Mark VISUAL_READY: static (logging) + instance (acceptance criteria)
                // Instance mark MUST happen before resolve() to prevent race condition
                // where validateAcceptanceCriteria reads null from getTimings().
                markVisualReadyTimestamp();
                this.renderDesyncProbe?.markVisualReady();

                console.log(
                    `[VISUAL_READY v2] ✓ TacticalGrid rendered in natural RAF frame ` +
                    `(${elapsed.toFixed(1)}ms after ENGINE_AWAKENED, method=${method}, ` +
                    `naturalFrames=${naturalFrameCount})`
                );
                resolve();
            };

            // Hard timeout: fail only if zero natural frames observed
            hardTimeoutId = setTimeout(() => {
                if (resolved) return;
                if (naturalFrameCount > 0) {
                    // Frames ARE rendering — graceful pass
                    console.warn(
                        `[VISUAL_READY v2] ⚠ Graceful pass: ${naturalFrameCount} natural frames ` +
                        `rendered but TacticalGrid not confirmed in activeMeshes. ` +
                        `Treating as ready (DevTools-independent mode).`
                    );
                    succeed('hardTimeout-graceful');
                } else {
                    resolved = true;
                    cleanup();
                    reject(new Error(
                        `[VISUAL_READY v2] FAILED: No natural frames rendered ` +
                        `within ${maxWaitMs}ms after ENGINE_AWAKENED`
                    ));
                }
            }, maxWaitMs);

            // Graceful fallback: if TacticalGrid exists, is VISIBLE (visibility > 0), and frames are rendering
            gracefulTimeoutId = setTimeout(() => {
                if (resolved) return;
                if (naturalFrameCount >= 3) {
                    const mesh = this.scene.getMeshByName('TacticalGrid');
                    if (mesh && !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible && mesh.visibility > 0) {
                        console.warn(
                            `[VISUAL_READY v2] ⚠ Graceful fallback: TacticalGrid visible ` +
                            `(visibility=${mesh.visibility.toFixed(2)}), ` +
                            `${naturalFrameCount} natural frames rendered. ` +
                            `activeMeshes check bypassed (DevTools-independent mode).`
                        );
                        succeed('gracefulFallback');
                    }
                }
            }, gracefulFallbackMs);

            // Phase 1: Detect natural onBeforeRender
            beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
                if (resolved) return;
                beforeRenderSeen = true;
            });

            // Phase 2: After render, verify TacticalGrid was actually rendered
            afterRenderObserver = this.scene.onAfterRenderObservable.add(() => {
                if (resolved) return;
                if (!beforeRenderSeen) return; // Not a complete cycle yet

                naturalFrameCount++;

                const mesh = this.scene.getMeshByName('TacticalGrid');
                if (!mesh || mesh.isDisposed()) {
                    beforeRenderSeen = false;
                    return;
                }
                // Must be enabled, visible (boolean), AND have visibility > 0 (alpha).
                // Babylon skips meshes with visibility=0 from activeMeshes evaluation.
                if (!mesh.isEnabled() || !mesh.isVisible || mesh.visibility <= 0) {
                    beforeRenderSeen = false;
                    return;
                }

                // Primary check: activeMeshes (populated by scene.render() during evaluate)
                // This is DevTools-independent — it's set during every natural render cycle.
                const activeMeshes = this.scene.getActiveMeshes();
                if (activeMeshes.length > 0 && activeMeshes.data.includes(mesh)) {
                    succeed('activeMeshes');
                    return;
                }

                // Fallback: if activeMeshes is empty (scene may use freezeActiveMeshes),
                // check if the mesh has been processed via _renderId
                const renderId = (mesh as any)._renderId;
                if (renderId !== undefined && renderId === this.scene.getRenderId()) {
                    succeed('renderId');
                    return;
                }

                // Reset for next frame attempt
                beforeRenderSeen = false;
            });
        });
    }

    /**
     * Wait exactly 1 render frame.
     * Used for UX_READY delay: ensures READY-frame is committed to screen
     * before unlocking input.
     */
    private waitOneFrame(): Promise<void> {
        return new Promise((resolve) => {
            const observer = this.scene.onAfterRenderObservable.addOnce(() => {
                resolve();
            });
            // Fallback if scene stops rendering
            setTimeout(() => {
                if (observer) {
                    this.scene.onAfterRenderObservable.remove(observer);
                }
                resolve();
            }, 100);
        });
    }

    /**
     * Create IGPUPulseReceiver implementation for this scene.
     * The receiver is responsible for reporting frames once pulse ownership transfers.
     */
    private createPulseReceiver(): IGPUPulseReceiver {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const self = this;
        let frameReportObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;

        return {
            id: 'NavigationScene',

            canAcceptPulse(): PulseTransferConditions {
                return {
                    transformMatrixValid: self.scene.meshes.some(m => !m.isDisposed()),
                    cameraProjectionReady: !!self.navigationCamera && !self.navigationCamera.isDisposed(),
                    canDrawOneFrame: self.active,
                    hasRenderableMesh: self.scene.meshes.filter(m => m.isVisible && !m.isDisposed()).length > 0,
                    // RAF health is checked by GPUPulseSystem, not by receiver
                    rafHealthy: true,
                    rafStable: true,
                };
            },

            onPulseReceived(): void {
                // Start reporting frames to maintain pulse health
                if (!frameReportObserver) {
                    frameReportObserver = self.scene.onAfterRenderObservable.add(() => {
                        // Report frame rendered - this keeps the pulse healthy
                        // and prevents emergency recovery from triggering
                    });
                }
            },

            onPulseRevoked(): void {
                // Stop reporting frames
                if (frameReportObserver) {
                    self.scene.onAfterRenderObservable.remove(frameReportObserver);
                    frameReportObserver = null;
                }
            },

            reportFrameRendered(): void {
                // Called by PulseTransferGate's receiver observer
                // The actual frame report is handled by the gate's wiring
            },
        };
    }

    /**
     * Attempt pulse transfer with retry if RAF is not healthy.
     * The transfer will be blocked if RAF is throttled.
     */
    private attemptPulseTransferWithRetry(
        maxAttempts: number = 10,
        retryIntervalMs: number = 500
    ): void {
        if (!this.gpuPulseSystem) return;

        let attempts = 0;
        const tryTransfer = () => {
            attempts++;

            // Build transfer conditions
            const transferConditions: PulseTransferConditions = {
                transformMatrixValid: true,
                cameraProjectionReady: !!this.navigationCamera && !this.navigationCamera.isDisposed(),
                canDrawOneFrame: true,
                hasRenderableMesh: this.scene.meshes.length > 0,
                // RAF health will be checked internally by GPUPulseSystem
                rafHealthy: false, // Will be overridden by system
                rafStable: false,  // Will be overridden by system
            };

            const transferred = this.gpuPulseSystem?.transferToGame(transferConditions);

            if (transferred) {
                return; // Success
            }

            // Check if we should retry
            if (attempts < maxAttempts && this.active && !this.scene.isDisposed) {
                setTimeout(tryTransfer, retryIntervalMs);
            }
        };

        // Start first attempt
        tryTransfer();
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

        // Debug: Dispose probe and logger
        this.renderDesyncProbe?.dispose();
        this.blackHoleLogger?.dispose();
        this.physicalStateProbe?.dispose();
        this.forensicProbe?.dispose();
        this.captureProbe?.dispose();
        this.flightRecorder?.dispose();

        // Active Engagement: Dispose intent keeper
        this.intentKeeper?.dispose();
        this.intentKeeper = null;

        // GPU Pulse System: End pulse and dispose
        this.gpuPulseSystem?.endPulse();
        this.gpuPulseSystem?.dispose();
        this.gpuPulseSystem = null;

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
     * Handle undo via action stack
     */
    private handleUndo(): void {
        if (this.isFlying) return;
        this.tacticalDesign.undo();
    }

    /**
     * Handle redo via action stack
     */
    private handleRedo(): void {
        if (this.isFlying) return;
        this.tacticalDesign.redo();
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
            // Position character at start of path
            const startPosition = path3D.getPoints()[0];
            this.characterLoadUnit?.setPosition(startPosition);
            this.characterLoadUnit?.setVisibility(true);

            // Initialize flight (FlightController handles camera via AceCombatChaseCamera)
            this.flightController.initialize(character, path3D);

            // Play flight animation using semantic role
            this.characterLoadUnit?.playRole('flight', true);

            // Start Ace Combat style flight
            // NOTE: Camera is automatically managed by FlightController's AceCombatChaseCamera
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

        // Hide character and stop animations
        this.characterLoadUnit?.setVisibility(false);
        this.characterLoadUnit?.stopAllAnimations();

        // Unlock tactical editing
        this.tacticalDesign.unlock();

        // Reset wind trail mode
        this.tacticalDesign.getWindTrail().setMode('design');

        // Reset camera to tactical view
        this.resetToTacticalCamera();

        // Restore camera controls (Flight may have detached them)
        this.restoreTacticalCameraControls();

        console.log('[NavigationScene] Returned to design phase');
    }

    /**
     * Restore tactical camera controls after flight
     * Similar to finalizeNavigationReady but specifically for post-flight
     */
    private restoreTacticalCameraControls(): void {
        const engine = this.scene.getEngine();
        const canvas = engine.getRenderingCanvas();
        const camera = this.navigationCamera;

        if (!camera || camera.isDisposed() || !canvas) return;

        // Ensure this camera is active
        this.scene.activeCamera = camera;

        // Re-attach controls
        camera.attachControl(canvas, true);

        // Force resize
        engine.resize();

        console.info('[POST_FLIGHT] Tactical camera controls restored');
    }

    /**
     * Reset camera to tactical design view
     */
    private resetToTacticalCamera(): void {
        if (!this.navigationCamera) return;

        this.navigationCamera.target = new BABYLON.Vector3(0, 0.8, 0);
        this.navigationCamera.radius = 26;
        this.navigationCamera.beta = 1.02;
        this.navigationCamera.alpha = -Math.PI / 2;
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

    // ========== DEBUG METHODS ==========

    /**
     * Toggle debug panel visibility
     */
    toggleDebugPanel(): void {
        this.debugPanel?.toggle();
    }

    /**
     * Show debug panel
     */
    showDebugPanel(): void {
        this.debugPanel?.show();
    }

    /**
     * Debug: Play animation role
     */
    private debugPlayRole(role: FlightAnimationRole): void {
        if (!this.characterLoadUnit) {
            console.warn('[Debug] No character loaded');
            return;
        }

        // Make sure character is visible
        if (!this.characterVisible) {
            this.debugToggleCharacter();
        }

        this.characterLoadUnit.playRole(role, true);
        console.log(`[Debug] Playing role: ${role}`);
    }

    /**
     * Debug: Toggle character visibility
     */
    private debugToggleCharacter(): void {
        if (!this.characterLoadUnit) {
            console.warn('[Debug] No character loaded');
            return;
        }

        this.characterVisible = !this.characterVisible;
        this.characterLoadUnit.setVisibility(this.characterVisible);

        // Position character at origin if showing for first time
        if (this.characterVisible) {
            const character = this.characterLoadUnit.getCharacter();
            if (character) {
                character.position = new BABYLON.Vector3(0, 1, 0);
            }
        }

        console.log(`[Debug] Character visibility: ${this.characterVisible}`);
    }

    /**
     * Debug: Set camera preset for 2.5D view testing
     */
    private debugSetCameraPreset(preset: 'top' | 'side' | 'front' | '2.5d'): void {
        if (!this.navigationCamera) return;

        switch (preset) {
            case 'top':
                this.navigationCamera.alpha = -Math.PI / 2;
                this.navigationCamera.beta = 0.1; // Almost vertical
                this.navigationCamera.radius = 20;
                break;
            case 'side':
                this.navigationCamera.alpha = 0;
                this.navigationCamera.beta = Math.PI / 2;
                this.navigationCamera.radius = 15;
                break;
            case 'front':
                this.navigationCamera.alpha = -Math.PI / 2;
                this.navigationCamera.beta = Math.PI / 2;
                this.navigationCamera.radius = 15;
                break;
            case '2.5d':
                // Optimal 2.5D view for this character
                this.navigationCamera.alpha = -Math.PI / 2 - 0.3;
                this.navigationCamera.beta = 1.1;
                this.navigationCamera.radius = 12;
                break;
        }

        // Focus on character position
        if (this.characterVisible && this.characterLoadUnit) {
            const char = this.characterLoadUnit.getCharacter();
            if (char) {
                this.navigationCamera.target = char.position.clone();
            }
        }

        console.log(`[Debug] Camera preset: ${preset}`);
    }

    /**
     * Debug: Stop all animations
     */
    private debugStopAnimation(): void {
        this.characterLoadUnit?.stopAllAnimations();
        console.log('[Debug] Stopped all animations');
    }

    dispose(): void {
        this.stop();
        this.tacticalDesign.dispose();
        this.flightController.dispose();
        this.hud?.dispose();
        this.debugPanel?.dispose();
    }
}

/**
 * TacticalHUD - Phase 3 UI for tactical design
 *
 * Touch-friendly design:
 * - Large mode buttons (48px height, 100px width)
 * - Clear visual separation between modes
 * - Undo/Redo with stack depth display
 */
class TacticalHUD {
    private container: GUI.Rectangle;
    private nodeCountText: GUI.TextBlock;
    private statusText: GUI.TextBlock;
    private debugText: GUI.TextBlock;

    // Mode buttons (3 separate for clarity)
    private cameraModeBtn: GUI.Button;
    private placeModeBtn: GUI.Button;
    private editModeBtn: GUI.Button;

    // Action buttons
    private clearButton: GUI.Button;
    private undoButton: GUI.Button;
    private redoButton: GUI.Button;
    private confirmButton: GUI.Button;

    constructor(
        parent: GUI.Rectangle,
        callbacks: {
            onClear: () => void;
            onUndo: () => void;
            onRedo: () => void;
            onConfirm: () => void;
            onSetMode: (mode: TacticalInputMode) => void;
            onToggleDebug: () => void;
        }
    ) {
        // Main container
        this.container = new GUI.Rectangle('TacticalHUD');
        this.container.width = '340px';
        this.container.height = '260px'; // Increased for debug button
        this.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.top = '20px';
        this.container.left = '-20px';
        this.container.background = 'rgba(0, 0, 0, 0.8)';
        this.container.cornerRadius = 12;
        this.container.thickness = 2;
        this.container.color = 'rgba(100, 150, 255, 0.6)';
        this.container.isVisible = false;
        parent.addControl(this.container);

        // === MODE BUTTONS (Top row) ===
        const modePanel = new GUI.StackPanel('modePanel');
        modePanel.isVertical = false;
        modePanel.height = '52px';
        modePanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        modePanel.top = '8px';
        modePanel.spacing = 6;
        this.container.addControl(modePanel);

        // Camera mode button
        this.cameraModeBtn = this.createModeButton('CAM', 'rgba(120, 80, 200, 0.9)');
        this.cameraModeBtn.onPointerClickObservable.add(() => callbacks.onSetMode('camera'));
        modePanel.addControl(this.cameraModeBtn);

        // Place mode button
        this.placeModeBtn = this.createModeButton('NODE', 'rgba(80, 180, 80, 0.9)');
        this.placeModeBtn.onPointerClickObservable.add(() => callbacks.onSetMode('place'));
        modePanel.addControl(this.placeModeBtn);

        // Edit mode button
        this.editModeBtn = this.createModeButton('EDIT', 'rgba(200, 150, 50, 0.9)');
        this.editModeBtn.onPointerClickObservable.add(() => callbacks.onSetMode('edit'));
        modePanel.addControl(this.editModeBtn);

        // === STATUS AREA ===
        this.nodeCountText = new GUI.TextBlock('nodeCount', 'Nodes: 0 / 15');
        this.nodeCountText.height = '24px';
        this.nodeCountText.top = '65px';
        this.nodeCountText.color = 'white';
        this.nodeCountText.fontSize = 14;
        this.nodeCountText.fontWeight = 'bold';
        this.nodeCountText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.addControl(this.nodeCountText);

        this.statusText = new GUI.TextBlock('status', 'Tap to add nodes');
        this.statusText.height = '22px';
        this.statusText.top = '88px';
        this.statusText.color = 'rgba(150, 200, 255, 0.9)';
        this.statusText.fontSize = 12;
        this.statusText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.addControl(this.statusText);

        // Debug text (undo/redo stack depth)
        this.debugText = new GUI.TextBlock('debug', 'Undo: 0 | Redo: 0');
        this.debugText.height = '18px';
        this.debugText.top = '108px';
        this.debugText.color = 'rgba(150, 150, 150, 0.7)';
        this.debugText.fontSize = 10;
        this.debugText.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.addControl(this.debugText);

        // === UNDO/REDO BUTTONS ===
        const undoRedoPanel = new GUI.StackPanel('undoRedoPanel');
        undoRedoPanel.isVertical = false;
        undoRedoPanel.height = '44px';
        undoRedoPanel.top = '128px';
        undoRedoPanel.spacing = 8;
        undoRedoPanel.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.addControl(undoRedoPanel);

        this.undoButton = this.createActionButton('UNDO', 'rgba(100, 100, 150, 0.9)', 80);
        this.undoButton.onPointerClickObservable.add(() => callbacks.onUndo());
        undoRedoPanel.addControl(this.undoButton);

        this.redoButton = this.createActionButton('REDO', 'rgba(100, 100, 150, 0.9)', 80);
        this.redoButton.onPointerClickObservable.add(() => callbacks.onRedo());
        undoRedoPanel.addControl(this.redoButton);

        this.clearButton = this.createActionButton('CLEAR', 'rgba(180, 60, 60, 0.9)', 80);
        this.clearButton.onPointerClickObservable.add(() => callbacks.onClear());
        undoRedoPanel.addControl(this.clearButton);

        // === LAUNCH BUTTON ===
        this.confirmButton = this.createActionButton('START', 'rgba(50, 150, 50, 0.9)', 140);
        this.confirmButton.height = '48px';
        this.confirmButton.fontSize = 16;
        this.confirmButton.fontWeight = 'bold';
        this.confirmButton.top = '175px';
        this.confirmButton.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.confirmButton.onPointerClickObservable.add(() => callbacks.onConfirm());
        this.container.addControl(this.confirmButton);

        // === DEBUG TOGGLE BUTTON ===
        const debugButton = this.createActionButton('🔧 DEBUG', 'rgba(255, 150, 50, 0.8)', 80);
        debugButton.height = '32px';
        debugButton.fontSize = 11;
        debugButton.top = '228px';
        debugButton.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        debugButton.onPointerClickObservable.add(() => callbacks.onToggleDebug());
        this.container.addControl(debugButton);
    }

    private createModeButton(text: string, bgColor: string): GUI.Button {
        const btn = GUI.Button.CreateSimpleButton(`mode_${text}`, text);
        btn.width = '100px';
        btn.height = '48px';
        btn.color = 'white';
        btn.background = bgColor;
        btn.cornerRadius = 8;
        btn.fontSize = 14;
        btn.fontWeight = 'bold';
        btn.thickness = 2;
        return btn;
    }

    private createActionButton(text: string, bgColor: string, width: number): GUI.Button {
        const btn = GUI.Button.CreateSimpleButton(`action_${text}`, text);
        btn.width = `${width}px`;
        btn.height = '40px';
        btn.color = 'white';
        btn.background = bgColor;
        btn.cornerRadius = 6;
        btn.fontSize = 12;
        btn.fontWeight = 'bold';
        return btn;
    }

    show(): void {
        this.container.isVisible = true;
    }

    hide(): void {
        this.container.isVisible = false;
    }

    updateState(state: TacticalDesignState): void {
        this.nodeCountText.text = `Nodes: ${state.nodeCount} / ${state.maxNodes}`;
        this.debugText.text = `Undo: ${state.undoDepth} | Redo: ${state.redoDepth}`;

        // Update mode button highlighting
        this.updateModeButtonStyles(state.inputMode, state.isLocked);

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
                    this.statusText.text = 'Camera mode (drag to rotate/pan)';
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
                        ? `Editing node ${state.selectedIndex} (drag gizmo)`
                        : 'Tap a node to select';
                    this.statusText.color = 'rgba(255, 220, 100, 0.9)';
                    break;
            }
        }

        // Update action button states
        this.clearButton.isEnabled = state.nodeCount > 0 && !state.isLocked;
        this.undoButton.isEnabled = state.canUndo;
        this.redoButton.isEnabled = state.canRedo;
        this.confirmButton.isEnabled = state.canLaunch;

        // Visual feedback for disabled buttons
        this.clearButton.alpha = this.clearButton.isEnabled ? 1 : 0.4;
        this.undoButton.alpha = this.undoButton.isEnabled ? 1 : 0.4;
        this.redoButton.alpha = this.redoButton.isEnabled ? 1 : 0.4;
        this.confirmButton.alpha = this.confirmButton.isEnabled ? 1 : 0.4;
    }

    private updateModeButtonStyles(activeMode: TacticalInputMode, isLocked: boolean): void {
        const activeColor = {
            camera: 'rgba(120, 80, 200, 1.0)',
            place: 'rgba(80, 180, 80, 1.0)',
            edit: 'rgba(200, 150, 50, 1.0)',
        };
        const inactiveColor = {
            camera: 'rgba(60, 40, 100, 0.6)',
            place: 'rgba(40, 90, 40, 0.6)',
            edit: 'rgba(100, 75, 25, 0.6)',
        };

        // Camera button
        this.cameraModeBtn.background = activeMode === 'camera' ? activeColor.camera : inactiveColor.camera;
        this.cameraModeBtn.color = activeMode === 'camera' ? 'white' : 'rgba(200, 200, 200, 0.8)';
        this.cameraModeBtn.thickness = activeMode === 'camera' ? 3 : 1;

        // Place button
        this.placeModeBtn.background = activeMode === 'place' ? activeColor.place : inactiveColor.place;
        this.placeModeBtn.color = activeMode === 'place' ? 'white' : 'rgba(200, 200, 200, 0.8)';
        this.placeModeBtn.thickness = activeMode === 'place' ? 3 : 1;

        // Edit button
        this.editModeBtn.background = activeMode === 'edit' ? activeColor.edit : inactiveColor.edit;
        this.editModeBtn.color = activeMode === 'edit' ? 'white' : 'rgba(200, 200, 200, 0.8)';
        this.editModeBtn.thickness = activeMode === 'edit' ? 3 : 1;

        // Disable all if locked
        this.cameraModeBtn.isEnabled = !isLocked;
        this.placeModeBtn.isEnabled = !isLocked;
        this.editModeBtn.isEnabled = !isLocked;
        this.cameraModeBtn.alpha = isLocked ? 0.5 : 1;
        this.placeModeBtn.alpha = isLocked ? 0.5 : 1;
        this.editModeBtn.alpha = isLocked ? 0.5 : 1;
    }

    dispose(): void {
        this.container.dispose();
    }
}

/**
 * AnimationDebugPanel - Debug UI for testing character animations
 *
 * Features:
 * - Show/hide character for testing
 * - Buttons for each animation role (flight, boost, rollLeft, rollHold)
 * - Camera position controls for 2.5D view testing
 */
class AnimationDebugPanel {
    private container: GUI.Rectangle;
    private visible: boolean = false;

    constructor(
        parent: GUI.Rectangle,
        callbacks: {
            onPlayRole: (role: FlightAnimationRole) => void;
            onToggleVisibility: () => void;
            onAdjustCamera: (preset: 'top' | 'side' | 'front' | '2.5d') => void;
            onStopAnimation: () => void;
        }
    ) {

        // Left-side debug panel
        this.container = new GUI.Rectangle('AnimDebugPanel');
        this.container.width = '180px';
        this.container.height = '320px';
        this.container.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.container.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.top = '20px';
        this.container.left = '20px';
        this.container.background = 'rgba(0, 0, 0, 0.85)';
        this.container.cornerRadius = 10;
        this.container.thickness = 2;
        this.container.color = 'rgba(255, 200, 100, 0.7)';
        this.container.isVisible = false;
        parent.addControl(this.container);

        // Title
        const title = new GUI.TextBlock('title', '🎬 Animation Debug');
        title.height = '28px';
        title.top = '8px';
        title.color = 'rgba(255, 200, 100, 1)';
        title.fontSize = 14;
        title.fontWeight = 'bold';
        title.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.container.addControl(title);

        // Content panel
        const content = new GUI.StackPanel('content');
        content.top = '40px';
        content.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP;
        content.spacing = 6;
        this.container.addControl(content);

        // Toggle visibility button
        const toggleBtn = this.createButton('👁 Toggle Character', 'rgba(80, 80, 120, 0.9)');
        toggleBtn.onPointerClickObservable.add(() => callbacks.onToggleVisibility());
        content.addControl(toggleBtn);

        // Animation role buttons
        const flightBtn = this.createButton('✈ Flight', 'rgba(60, 120, 180, 0.9)');
        flightBtn.onPointerClickObservable.add(() => callbacks.onPlayRole('flight'));
        content.addControl(flightBtn);

        const boostBtn = this.createButton('🚀 Boost', 'rgba(180, 120, 60, 0.9)');
        boostBtn.onPointerClickObservable.add(() => callbacks.onPlayRole('boost'));
        content.addControl(boostBtn);

        const rollLeftBtn = this.createButton('↩ Roll Left', 'rgba(120, 180, 60, 0.9)');
        rollLeftBtn.onPointerClickObservable.add(() => callbacks.onPlayRole('rollLeft'));
        content.addControl(rollLeftBtn);

        const rollHoldBtn = this.createButton('⟳ Roll Hold', 'rgba(60, 180, 120, 0.9)');
        rollHoldBtn.onPointerClickObservable.add(() => callbacks.onPlayRole('rollHold'));
        content.addControl(rollHoldBtn);

        const stopBtn = this.createButton('⏹ Stop', 'rgba(180, 60, 60, 0.9)');
        stopBtn.onPointerClickObservable.add(() => callbacks.onStopAnimation());
        content.addControl(stopBtn);

        // Camera presets section
        const camLabel = new GUI.TextBlock('camLabel', '📷 Camera Preset');
        camLabel.height = '24px';
        camLabel.color = 'rgba(200, 200, 200, 0.8)';
        camLabel.fontSize = 11;
        content.addControl(camLabel);

        const camPanel = new GUI.StackPanel('camPanel');
        camPanel.isVertical = false;
        camPanel.height = '36px';
        camPanel.spacing = 4;
        content.addControl(camPanel);

        const topBtn = this.createSmallButton('Top');
        topBtn.onPointerClickObservable.add(() => callbacks.onAdjustCamera('top'));
        camPanel.addControl(topBtn);

        const sideBtn = this.createSmallButton('Side');
        sideBtn.onPointerClickObservable.add(() => callbacks.onAdjustCamera('side'));
        camPanel.addControl(sideBtn);

        const frontBtn = this.createSmallButton('Front');
        frontBtn.onPointerClickObservable.add(() => callbacks.onAdjustCamera('front'));
        camPanel.addControl(frontBtn);

        const twoFiveBtn = this.createSmallButton('2.5D');
        twoFiveBtn.onPointerClickObservable.add(() => callbacks.onAdjustCamera('2.5d'));
        camPanel.addControl(twoFiveBtn);
    }

    private createButton(text: string, bgColor: string): GUI.Button {
        const btn = GUI.Button.CreateSimpleButton(`btn_${text}`, text);
        btn.width = '160px';
        btn.height = '36px';
        btn.color = 'white';
        btn.background = bgColor;
        btn.cornerRadius = 6;
        btn.fontSize = 12;
        btn.fontWeight = 'bold';
        return btn;
    }

    private createSmallButton(text: string): GUI.Button {
        const btn = GUI.Button.CreateSimpleButton(`cam_${text}`, text);
        btn.width = '38px';
        btn.height = '32px';
        btn.color = 'white';
        btn.background = 'rgba(100, 100, 100, 0.8)';
        btn.cornerRadius = 4;
        btn.fontSize = 10;
        return btn;
    }

    toggle(): void {
        this.visible = !this.visible;
        this.container.isVisible = this.visible;
    }

    show(): void {
        this.visible = true;
        this.container.isVisible = true;
    }

    hide(): void {
        this.visible = false;
        this.container.isVisible = false;
    }

    isVisible(): boolean {
        return this.visible;
    }

    dispose(): void {
        this.container.dispose();
    }
}
