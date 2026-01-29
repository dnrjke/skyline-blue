/**
 * ArcanaLoadingOrchestrator - High-level Loading Orchestration.
 *
 * Combines:
 * - LoadingRegistry (unit management)
 * - LoadingProtocol (unit execution)
 * - ArcanaProgressModel (phase-based progress)
 * - LoadingStateEmitter (reactive events for UI/visuals)
 *
 * Key Responsibilities:
 * - Execute all LoadUnits via LoadingProtocol
 * - Track progress with Arcana 3-phase model (10/70/Barrier)
 * - Emit events for reactive UI components
 * - Handle compression phase animation during barrier
 * - Emit LAUNCH event when barrier resolves
 *
 * From Master Prompt:
 * "The Arcana Barrier visuals must NOT live inside LoadUnit, LoadingProtocol, or RenderReadyBarrier.
 *  They must be: Observers, Subscribers, Reactive only."
 */

import * as BABYLON from '@babylonjs/core';
import { LoadUnit, LoadUnitStatus } from '../unit/LoadUnit';
import { LoadingRegistry } from '../unit/LoadingRegistry';
import { LoadingProtocol, ProtocolResult } from '../unit/LoadingProtocol';
import { LoadingPhase } from '../protocol/LoadingPhase';
import { ArcanaProgressModel, UnitWeightConfig } from '../progress/ArcanaProgressModel';
import { LoadingStateEmitter, LoadingState, LoadingEvents } from '../progress/LoadingStateEmitter';
import { BarrierValidation } from '../barrier/RenderReadyBarrier';
import type { SlicedLoadUnit } from '../executor/SlicedLoadUnit';

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
    /** Barrier validation options */
    barrierValidation?: BarrierValidation;

    /** Enable compression phase animation updates */
    enableCompressionAnimation?: boolean;

    /** Compression tick interval in ms (default: 16 = ~60fps) */
    compressionTickMs?: number;
}

/**
 * Orchestrator execution callbacks
 */
export interface OrchestratorCallbacks {
    /** Log callback */
    onLog?: (message: string) => void;

    /** Called when ready (after LAUNCH) */
    onReady?: () => void;

    /** Called on error */
    onError?: (error: Error) => void;

    /**
     * Called when a LoadUnit starts loading (for forensic logging).
     * Use this to identify which unit is consuming CPU when stalls occur.
     */
    onUnitStart?: (unitId: string, displayName: string, phase: LoadingPhase) => void;

    /**
     * Called when a LoadUnit completes loading (for forensic logging).
     */
    onUnitEnd?: (unitId: string, success: boolean, elapsedMs: number) => void;
}

/**
 * Orchestrator execute options
 */
export interface OrchestratorExecuteOptions extends OrchestratorCallbacks {
    /**
     * LoadUnits to execute.
     * This is the ONLY way to register units - external registerUnits() is deprecated.
     * Supports both legacy LoadUnit and new SlicedLoadUnit (Pure Generator Manifesto).
     */
    units: (LoadUnit | SlicedLoadUnit)[];
}

/**
 * ArcanaLoadingOrchestrator
 */
export class ArcanaLoadingOrchestrator {
    private scene: BABYLON.Scene;
    private registry: LoadingRegistry;
    private protocol: LoadingProtocol;
    private progressModel: ArcanaProgressModel;
    private emitter: LoadingStateEmitter;

    private config: OrchestratorConfig;
    private compressionTimerId: number | null = null;
    private isExecuting: boolean = false;

    /**
     * [Animation Lifecycle Guard]
     * When true, any residual tick() callback must exit immediately.
     * This prevents race conditions where a tick fires between
     * barrier_resolve and stopCompressionAnimation() clearTimeout.
     */
    private compressionAnimationStopped: boolean = true;

    constructor(scene: BABYLON.Scene, config: OrchestratorConfig = {}) {
        this.scene = scene;
        this.config = config;

        this.registry = new LoadingRegistry();
        this.protocol = new LoadingProtocol(scene, this.registry);
        this.progressModel = new ArcanaProgressModel();
        this.emitter = new LoadingStateEmitter();

        // Wire progress model events to emitter
        this.progressModel.subscribe((event) => {
            switch (event.type) {
                case 'unit_start':
                    this.emitter.emitUnitStart(event.unitId!, event.unitName);
                    break;
                case 'unit_complete':
                    this.emitter.emitUnitComplete(event.unitId!, LoadUnitStatus.VALIDATED);
                    break;
                case 'barrier_enter':
                    this.emitter.emitBarrierEnter();
                    this.startCompressionAnimation();
                    break;
                case 'barrier_resolve':
                    this.emitter.emitBarrierResolve();
                    this.stopCompressionAnimation();
                    break;
                case 'launch':
                    this.emitter.emitLaunch();
                    break;
                case 'progress_update':
                    this.emitter.setState({ progress: event.progress });
                    break;
                case 'phase_change':
                    this.emitter.setState({ phase: event.phase });
                    break;
            }
        });
    }

    /**
     * Get the associated Scene
     */
    getScene(): BABYLON.Scene {
        return this.scene;
    }

    /**
     * Get the LoadingRegistry for unit registration
     */
    getRegistry(): LoadingRegistry {
        return this.registry;
    }

    /**
     * Get the LoadingStateEmitter for UI subscriptions
     */
    getEmitter(): LoadingStateEmitter {
        return this.emitter;
    }

    /**
     * Get current loading state
     */
    getState(): Readonly<LoadingState> {
        return this.emitter.getState();
    }

    /**
     * Subscribe to loading events
     */
    subscribe(handlers: Partial<LoadingEvents>): () => void {
        return this.emitter.subscribe(handlers);
    }

    /**
     * @deprecated Use execute({ units: [...] }) instead.
     * External registration is no longer supported to prevent double-registration bugs.
     *
     * This method is kept for backward compatibility but will be removed in future versions.
     */
    registerUnits(_units: LoadUnit[]): void {
        console.warn(
            '[ArcanaLoadingOrchestrator] DEPRECATED: registerUnits() called externally. ' +
            'Use execute({ units: [...] }) instead. External registration will be ignored.'
        );
        // Intentionally do nothing - units should be passed to execute() directly
    }

    /**
     * Internal method to register units.
     * Called only from execute() to ensure single registration point.
     */
    private internalRegisterUnits(units: (LoadUnit | SlicedLoadUnit)[]): void {
        this.registry.registerAll(units);

        // Build weight config for progress model
        const weightConfigs: UnitWeightConfig[] = units.map((u) => ({
            id: u.id,
            required: u.requiredForReady,
            weight: this.getUnitWeight(u),
        }));

        this.progressModel.registerUnits(weightConfigs);
    }

    /**
     * Calculate unit weight based on phase
     */
    private getUnitWeight(unit: LoadUnit | SlicedLoadUnit): number {
        // Heavier phases get more weight
        switch (unit.phase) {
            case LoadingPhase.FETCHING:
                return unit.requiredForReady ? 2 : 1;
            case LoadingPhase.BUILDING:
                return unit.requiredForReady ? 1.5 : 0.5;
            case LoadingPhase.WARMING:
                return 1;
            case LoadingPhase.BARRIER:
                return 0.5; // Barrier is special, handled separately
            default:
                return 1;
        }
    }

    /**
     * Execute LoadUnits.
     *
     * [Option C Integration] Units MUST be passed via options.units.
     * This is the ONLY registration point - no external registerUnits() allowed.
     *
     * @param options - Execution options including units and callbacks
     */
    async execute(options: OrchestratorExecuteOptions): Promise<ProtocolResult> {
        if (this.isExecuting) {
            throw new Error('[ArcanaLoadingOrchestrator] Already executing');
        }

        const { units, ...callbacks } = options;

        if (!units || units.length === 0) {
            throw new Error(
                '[ArcanaLoadingOrchestrator] No units provided. ' +
                'Pass units via execute({ units: [...] })'
            );
        }

        this.isExecuting = true;

        // [Anti-Regression] Reset and register in proper sequence
        // progressModel.reset() locks progress, registerUnits() unlocks it
        this.progressModel.reset();
        this.emitter.reset();
        this.registry.clear(); // Clean previous registration

        // Single registration point - no duplicates
        this.internalRegisterUnits(units);

        try {
            const result = await this.protocol.execute({
                onPhaseChange: (phase) => {
                    this.progressModel.setPhase(phase);
                    callbacks.onLog?.(`--- Phase: ${phase} ---`);
                },
                onProgress: (_progress) => {
                    // Progress is now handled by ArcanaProgressModel
                    // This callback is mostly ignored
                },
                onLog: callbacks.onLog,
                onUnitStatusChange: (unit, status) => {
                    const displayName = 'getDisplayName' in unit
                        ? (unit as any).getDisplayName()
                        : unit.id;
                    this.progressModel.updateUnitStatus(unit.id, status, displayName);
                },
                // Forensic logging: pipe unit lifecycle events to caller
                onUnitStart: callbacks.onUnitStart,
                onUnitEnd: callbacks.onUnitEnd,
                barrierValidation: this.config.barrierValidation,
                onAfterReady: () => {
                    callbacks.onReady?.();
                },
            });

            // Phase transitions now handled automatically by setPhase()
            // No need for explicit barrier resolution - READY phase triggers launch

            this.isExecuting = false;
            return result;

        } catch (error) {
            this.isExecuting = false;
            const err = error instanceof Error ? error : new Error(String(error));
            this.emitter.emitFailed(err);
            callbacks.onError?.(err);
            throw error;
        }
    }

    /**
     * Start compression phase animation (time-based slow easing)
     *
     * [Animation Lifecycle]
     * - Sets compressionAnimationStopped = false to allow tick execution
     * - tick() checks this flag first to prevent race conditions
     */
    private startCompressionAnimation(): void {
        if (!this.config.enableCompressionAnimation) return;
        if (this.compressionTimerId !== null) return;

        const tickMs = this.config.compressionTickMs ?? 16;

        // [Lifecycle] Mark animation as active
        this.compressionAnimationStopped = false;

        const tick = () => {
            // [Lifecycle Guard] Exit immediately if animation was stopped.
            // This prevents race conditions where tick fires between
            // barrier_resolve emit and clearTimeout execution.
            if (this.compressionAnimationStopped) {
                return;
            }

            // Secondary check: barrier phase exit
            if (!this.progressModel.getSnapshot().isBarrierActive) {
                this.stopCompressionAnimation();
                return;
            }

            this.progressModel.tick();

            // Only schedule next tick if animation is still active
            if (!this.compressionAnimationStopped) {
                this.compressionTimerId = window.setTimeout(tick, tickMs);
            }
        };

        this.compressionTimerId = window.setTimeout(tick, tickMs);
    }

    /**
     * Stop compression phase animation
     *
     * [Animation Lifecycle]
     * - IMMEDIATELY sets compressionAnimationStopped = true (before clearTimeout)
     * - This ensures any in-flight tick() callback exits at the guard check
     * - Then clears the timer to prevent future scheduling
     */
    private stopCompressionAnimation(): void {
        // [Lifecycle] Mark animation as stopped FIRST.
        // Any tick() callback that fires after this point will exit immediately.
        this.compressionAnimationStopped = true;

        if (this.compressionTimerId !== null) {
            clearTimeout(this.compressionTimerId);
            this.compressionTimerId = null;
        }
    }

    /**
     * Cancel loading
     */
    cancel(): void {
        this.protocol.cancel();
        this.stopCompressionAnimation();
        this.isExecuting = false;
    }

    /**
     * Reset orchestrator state.
     * Clears all registered units and resets progress.
     */
    reset(): void {
        this.cancel();
        this.registry.clear();
        this.progressModel.reset();
        this.emitter.reset();
        console.log('[ArcanaLoadingOrchestrator] Reset complete');
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.reset();
        this.progressModel.dispose();
        this.emitter.dispose();
    }
}
