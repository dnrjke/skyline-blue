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
     * Register LoadUnits for execution
     */
    registerUnits(units: LoadUnit[]): void {
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
    private getUnitWeight(unit: LoadUnit): number {
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
     * Execute all registered LoadUnits
     */
    async execute(callbacks: OrchestratorCallbacks = {}): Promise<ProtocolResult> {
        if (this.isExecuting) {
            throw new Error('[ArcanaLoadingOrchestrator] Already executing');
        }

        this.isExecuting = true;
        this.progressModel.reset();
        this.emitter.reset();

        // Re-register units in progress model
        const units = this.registry.getAllUnits();
        const weightConfigs: UnitWeightConfig[] = units.map((u) => ({
            id: u.id,
            required: u.requiredForReady,
            weight: this.getUnitWeight(u),
        }));
        this.progressModel.registerUnits(weightConfigs);

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
                barrierValidation: this.config.barrierValidation,
                onAfterReady: () => {
                    callbacks.onReady?.();
                },
            });

            // Ensure barrier is resolved on success
            if (result.phase === LoadingPhase.READY) {
                this.progressModel.resolveBarrier();
            }

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
     */
    private startCompressionAnimation(): void {
        if (!this.config.enableCompressionAnimation) return;
        if (this.compressionTimerId !== null) return;

        const tickMs = this.config.compressionTickMs ?? 16;

        const tick = () => {
            if (!this.progressModel.getSnapshot().isBarrierActive) {
                this.stopCompressionAnimation();
                return;
            }

            this.progressModel.tick();
            this.compressionTimerId = window.setTimeout(tick, tickMs);
        };

        this.compressionTimerId = window.setTimeout(tick, tickMs);
    }

    /**
     * Stop compression phase animation
     */
    private stopCompressionAnimation(): void {
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
     * Reset orchestrator state
     */
    reset(): void {
        this.cancel();
        this.registry.clear();
        this.progressModel.reset();
        this.emitter.reset();
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
