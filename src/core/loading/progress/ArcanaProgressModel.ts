/**
 * ArcanaProgressModel - Phase-based Progress Calculation System.
 *
 * [TacticalGrid Incident Prevention - Constitutional Amendment]
 *
 * Progress Mapping (Final Form):
 * - 0-10%:   Registration (all LoadUnits registered)
 * - 10-70%:  Validation (FETCHING + BUILDING)
 * - 70-85%:  WARMING (material compilation)
 * - 85-90%:  BARRIER (render loop confirmed, NOT visual readiness)
 * - 90-100%: VISUAL_READY (actual visual verification)
 * - 100% (held): STABILIZING_100 (visual stability hold)
 * - READY: transition allowed
 *
 * Key Constitutional Rules:
 * - 100% does NOT mean "done". It means "safe to transition".
 * - Progress MUST NOT reach 100% until VISUAL_READY is complete.
 * - STABILIZING_100 holds at 100% for stability guarantee.
 * - READY cannot occur before VISUAL_READY + STABILIZING_100 complete.
 *
 * A LoadUnit must never validate "visibility by timing".
 * READY means:
 *   The user cannot visually distinguish this state
 *   from a fully playable scene.
 */

import { LoadingPhase } from '../protocol/LoadingPhase';
import { LoadUnitStatus } from '../unit/LoadUnit';

/**
 * Progress phase boundaries
 */
export const PROGRESS_BOUNDS = {
    /** Registration complete */
    REGISTRATION_END: 0.10,

    /** Validation progress range (FETCHING + BUILDING) */
    VALIDATION_START: 0.10,
    VALIDATION_END: 0.70,

    /** WARMING phase range */
    WARMING_START: 0.70,
    WARMING_END: 0.85,

    /** BARRIER phase range (render loop confirmation, NOT visual readiness) */
    BARRIER_START: 0.85,
    BARRIER_END: 0.90,

    /** VISUAL_READY phase range (actual visual verification) */
    VISUAL_READY_START: 0.90,
    VISUAL_READY_END: 1.0,

    /** Stabilization (held at 100%) */
    STABILIZING: 1.0,

    /** Final launch value */
    LAUNCH: 1.0,
} as const;

/**
 * Compression phase settings (for BARRIER phase slow-down)
 */
export const COMPRESSION_SETTINGS = {
    /** Lerp factor per update (lower = slower) */
    LERP_FACTOR: 0.03,

    /** Minimum progress increment per update */
    MIN_INCREMENT: 0.001,

    /** Maximum progress per update */
    MAX_INCREMENT: 0.015,
} as const;

/**
 * Stabilization settings
 */
export const STABILIZATION_SETTINGS = {
    /** Minimum stabilization time (ms) */
    MIN_TIME_MS: 400,

    /** Minimum stable frames required */
    MIN_STABLE_FRAMES: 8,

    /** Maximum stabilization time (fail-safe) */
    MAX_TIME_MS: 1500,
} as const;

/**
 * Progress state snapshot
 */
export interface ProgressSnapshot {
    /** Raw progress value (0-1) */
    rawProgress: number;

    /** Display progress value (0-1), respects compression */
    displayProgress: number;

    /** Current loading phase */
    phase: LoadingPhase;

    /** Is barrier active */
    isBarrierActive: boolean;

    /** Is barrier resolved (render loop confirmed) */
    isBarrierResolved: boolean;

    /** Is visual ready phase active */
    isVisualReadyActive: boolean;

    /** Is visual ready complete */
    isVisualReadyComplete: boolean;

    /** Is stabilization active */
    isStabilizing: boolean;

    /** Is fully ready for transition */
    isTransitionReady: boolean;

    /** Current unit name for display (optional) */
    currentUnitName?: string;
}

/**
 * Progress event types
 */
export type ProgressEventType =
    | 'phase_change'
    | 'progress_update'
    | 'unit_start'
    | 'unit_complete'
    | 'barrier_enter'
    | 'barrier_resolve'
    | 'visual_ready_enter'
    | 'visual_ready_complete'
    | 'stabilizing_enter'
    | 'stabilizing_complete'
    | 'launch';

/**
 * Progress event payload
 */
export interface ProgressEvent {
    type: ProgressEventType;
    progress: number;
    phase: LoadingPhase;
    unitId?: string;
    unitName?: string;
}

/**
 * Progress event listener
 */
export type ProgressEventListener = (event: ProgressEvent) => void;

/**
 * Unit weight configuration
 */
export interface UnitWeightConfig {
    /** Unit ID */
    id: string;

    /** Whether unit is required for ready */
    required: boolean;

    /** Custom weight (default: 1) */
    weight?: number;
}

/**
 * ArcanaProgressModel
 *
 * Constitutional Contract:
 * - READY cannot occur before VISUAL_READY + STABILIZING_100 complete
 * - 100% does not mean "done", it means "safe to transition"
 * - No timing-based visibility validation
 */
export class ArcanaProgressModel {
    private currentPhase: LoadingPhase = LoadingPhase.PENDING;
    private rawProgress: number = 0;
    private displayProgress: number = 0;

    private unitWeights: Map<string, number> = new Map();
    private unitStatuses: Map<string, LoadUnitStatus> = new Map();
    private totalWeight: number = 0;
    private completedWeight: number = 0;

    // Phase state tracking
    private barrierActive: boolean = false;
    private barrierResolved: boolean = false;
    private visualReadyActive: boolean = false;
    private visualReadyComplete: boolean = false;
    private stabilizingActive: boolean = false;
    private stabilizingComplete: boolean = false;

    // Stabilization tracking
    private stabilizationStartTime: number = 0;
    private stableFrameCount: number = 0;

    private currentUnitName: string | undefined;
    private listeners: Set<ProgressEventListener> = new Set();

    /**
     * Register units and their weights for progress calculation
     */
    registerUnits(units: UnitWeightConfig[]): void {
        this.unitWeights.clear();
        this.unitStatuses.clear();
        this.totalWeight = 0;
        this.completedWeight = 0;

        for (const unit of units) {
            const weight = unit.weight ?? (unit.required ? 1 : 0.5);
            if (weight > 0) {
                this.unitWeights.set(unit.id, weight);
                this.unitStatuses.set(unit.id, LoadUnitStatus.PENDING);
                this.totalWeight += weight;
            }
        }

        // Registration complete: progress reaches 10%
        this.rawProgress = PROGRESS_BOUNDS.REGISTRATION_END;
        this.displayProgress = PROGRESS_BOUNDS.REGISTRATION_END;

        console.log(`[ArcanaProgressModel] Registered ${units.length} units, total weight: ${this.totalWeight}`);
    }

    /**
     * Update unit status and recalculate progress
     */
    updateUnitStatus(unitId: string, status: LoadUnitStatus, displayName?: string): void {
        const prevStatus = this.unitStatuses.get(unitId);
        if (!prevStatus) return;

        this.unitStatuses.set(unitId, status);

        // Track current unit for UI display
        if (status === LoadUnitStatus.LOADING) {
            this.currentUnitName = displayName;
            this.emit({ type: 'unit_start', unitId, unitName: displayName });
        }

        // Unit completed
        const weight = this.unitWeights.get(unitId) ?? 0;
        const wasComplete = this.isUnitComplete(prevStatus);
        const isComplete = this.isUnitComplete(status);

        if (!wasComplete && isComplete) {
            this.completedWeight += weight;
            this.emit({ type: 'unit_complete', unitId, unitName: displayName });
        } else if (wasComplete && !isComplete) {
            // Reset scenario
            this.completedWeight = Math.max(0, this.completedWeight - weight);
        }

        this.recalculateProgress();
    }

    /**
     * Check if unit status counts as complete
     */
    private isUnitComplete(status: LoadUnitStatus): boolean {
        return status === LoadUnitStatus.VALIDATED ||
               status === LoadUnitStatus.LOADED ||
               status === LoadUnitStatus.SKIPPED;
    }

    /**
     * Set current loading phase
     */
    setPhase(phase: LoadingPhase): void {
        if (this.currentPhase === phase) return;

        const prevPhase = this.currentPhase;
        this.currentPhase = phase;

        // Phase-specific state transitions
        switch (phase) {
            case LoadingPhase.BARRIER:
                if (!this.barrierActive) {
                    this.barrierActive = true;
                    this.emit({ type: 'barrier_enter' });
                }
                break;

            case LoadingPhase.VISUAL_READY:
                if (!this.visualReadyActive) {
                    this.barrierResolved = true;
                    this.visualReadyActive = true;
                    this.emit({ type: 'barrier_resolve' });
                    this.emit({ type: 'visual_ready_enter' });
                }
                break;

            case LoadingPhase.STABILIZING_100:
                if (!this.stabilizingActive) {
                    this.visualReadyComplete = true;
                    this.stabilizingActive = true;
                    this.stabilizationStartTime = performance.now();
                    this.stableFrameCount = 0;
                    this.displayProgress = PROGRESS_BOUNDS.STABILIZING;
                    this.emit({ type: 'visual_ready_complete' });
                    this.emit({ type: 'stabilizing_enter' });
                }
                break;

            case LoadingPhase.READY:
                if (!this.stabilizingComplete) {
                    this.stabilizingComplete = true;
                    this.emit({ type: 'stabilizing_complete' });
                    this.emit({ type: 'launch' });
                }
                break;
        }

        this.recalculateProgress();
        this.emit({ type: 'phase_change' });
        console.log(`[ArcanaProgressModel] Phase: ${prevPhase} -> ${phase}`);
    }

    /**
     * Mark visual ready as complete (called after visual verification)
     */
    completeVisualReady(): void {
        if (this.visualReadyComplete) return;

        this.visualReadyComplete = true;
        this.displayProgress = PROGRESS_BOUNDS.VISUAL_READY_END;
        this.emit({ type: 'visual_ready_complete' });

        console.log('[ArcanaProgressModel] Visual ready complete - entering stabilization');
    }

    /**
     * Tick stabilization frame counter
     * @returns true if stabilization is complete
     */
    tickStabilization(): boolean {
        if (!this.stabilizingActive || this.stabilizingComplete) {
            return this.stabilizingComplete;
        }

        this.stableFrameCount++;
        const elapsed = performance.now() - this.stabilizationStartTime;

        // Check completion conditions
        const timeOk = elapsed >= STABILIZATION_SETTINGS.MIN_TIME_MS;
        const framesOk = this.stableFrameCount >= STABILIZATION_SETTINGS.MIN_STABLE_FRAMES;
        const maxTimeReached = elapsed >= STABILIZATION_SETTINGS.MAX_TIME_MS;

        if ((timeOk && framesOk) || maxTimeReached) {
            this.stabilizingComplete = true;
            this.emit({ type: 'stabilizing_complete' });

            if (maxTimeReached && !(timeOk && framesOk)) {
                console.warn('[ArcanaProgressModel] Stabilization max time reached (fail-safe)');
            } else {
                console.log(`[ArcanaProgressModel] Stabilization complete: ${elapsed.toFixed(0)}ms, ${this.stableFrameCount} frames`);
            }

            return true;
        }

        return false;
    }

    /**
     * Check if ready to transition
     */
    isTransitionReady(): boolean {
        return this.stabilizingComplete;
    }

    /**
     * Recalculate progress based on unit completion and phase
     */
    private recalculateProgress(): void {
        // If stabilizing, hold at 100%
        if (this.stabilizingActive) {
            this.displayProgress = PROGRESS_BOUNDS.STABILIZING;
            return;
        }

        // If visual ready complete, show 100%
        if (this.visualReadyComplete) {
            this.displayProgress = PROGRESS_BOUNDS.VISUAL_READY_END;
            return;
        }

        if (this.totalWeight === 0) {
            this.rawProgress = PROGRESS_BOUNDS.VALIDATION_END;
        } else {
            // Calculate validation progress (10-70%)
            const validationRatio = this.completedWeight / this.totalWeight;
            const validationRange = PROGRESS_BOUNDS.VALIDATION_END - PROGRESS_BOUNDS.VALIDATION_START;
            this.rawProgress = PROGRESS_BOUNDS.VALIDATION_START + (validationRange * validationRatio);
        }

        // Phase-based progress caps
        switch (this.currentPhase) {
            case LoadingPhase.WARMING:
                // WARMING: 70-85%
                this.rawProgress = Math.max(this.rawProgress, PROGRESS_BOUNDS.WARMING_START);
                this.rawProgress = Math.min(this.rawProgress, PROGRESS_BOUNDS.WARMING_END);
                break;

            case LoadingPhase.BARRIER:
                // BARRIER: 85-90% (never exceed 90%)
                this.rawProgress = Math.max(this.rawProgress, PROGRESS_BOUNDS.BARRIER_START);
                this.rawProgress = Math.min(this.rawProgress, PROGRESS_BOUNDS.BARRIER_END);
                break;

            case LoadingPhase.VISUAL_READY:
                // VISUAL_READY: 90-100%
                this.rawProgress = Math.max(this.rawProgress, PROGRESS_BOUNDS.VISUAL_READY_START);
                // Allow progression towards 100% based on visual verification
                break;
        }

        this.updateDisplayProgress();
        this.emit({ type: 'progress_update' });
    }

    /**
     * Update display progress with compression logic
     */
    private updateDisplayProgress(): void {
        if (this.stabilizingActive) {
            this.displayProgress = PROGRESS_BOUNDS.STABILIZING;
            return;
        }

        if (this.visualReadyComplete) {
            this.displayProgress = PROGRESS_BOUNDS.VISUAL_READY_END;
            return;
        }

        // Barrier phase: slow compression towards 90%
        if (this.barrierActive && !this.barrierResolved) {
            const target = Math.min(this.rawProgress, PROGRESS_BOUNDS.BARRIER_END);
            const delta = target - this.displayProgress;
            const increment = Math.max(
                COMPRESSION_SETTINGS.MIN_INCREMENT,
                Math.min(delta * COMPRESSION_SETTINGS.LERP_FACTOR, COMPRESSION_SETTINGS.MAX_INCREMENT)
            );

            if (delta > 0) {
                this.displayProgress = Math.min(
                    this.displayProgress + increment,
                    PROGRESS_BOUNDS.BARRIER_END
                );
            }
        } else if (this.visualReadyActive && !this.visualReadyComplete) {
            // Visual ready phase: progress towards 100%
            const target = Math.min(this.rawProgress, PROGRESS_BOUNDS.VISUAL_READY_END);
            const delta = target - this.displayProgress;
            const increment = Math.max(
                COMPRESSION_SETTINGS.MIN_INCREMENT * 2,
                Math.min(delta * COMPRESSION_SETTINGS.LERP_FACTOR * 1.5, COMPRESSION_SETTINGS.MAX_INCREMENT * 1.5)
            );

            if (delta > 0) {
                this.displayProgress = Math.min(
                    this.displayProgress + increment,
                    PROGRESS_BOUNDS.VISUAL_READY_END
                );
            }
        } else {
            // Normal progress: direct mapping
            this.displayProgress = this.rawProgress;
        }
    }

    /**
     * Set visual ready progress (for visual verification units)
     * @param progress 0-1 ratio of visual verification completion
     */
    setVisualReadyProgress(progress: number): void {
        if (!this.visualReadyActive || this.visualReadyComplete) return;

        const range = PROGRESS_BOUNDS.VISUAL_READY_END - PROGRESS_BOUNDS.VISUAL_READY_START;
        this.rawProgress = PROGRESS_BOUNDS.VISUAL_READY_START + (range * Math.min(1, Math.max(0, progress)));
        this.updateDisplayProgress();
        this.emit({ type: 'progress_update' });
    }

    /**
     * Tick update for animation
     */
    tick(): void {
        if (this.stabilizingComplete) return;

        const prevDisplay = this.displayProgress;
        this.updateDisplayProgress();

        if (Math.abs(this.displayProgress - prevDisplay) > 0.0001) {
            this.emit({ type: 'progress_update' });
        }
    }

    /**
     * Get current progress snapshot
     */
    getSnapshot(): ProgressSnapshot {
        return {
            rawProgress: this.rawProgress,
            displayProgress: this.displayProgress,
            phase: this.currentPhase,
            isBarrierActive: this.barrierActive,
            isBarrierResolved: this.barrierResolved,
            isVisualReadyActive: this.visualReadyActive,
            isVisualReadyComplete: this.visualReadyComplete,
            isStabilizing: this.stabilizingActive,
            isTransitionReady: this.stabilizingComplete,
            currentUnitName: this.currentUnitName,
        };
    }

    /**
     * Get display progress (0-1)
     */
    getProgress(): number {
        return this.displayProgress;
    }

    /**
     * Is loading complete? (use isTransitionReady for transitions)
     */
    isComplete(): boolean {
        return this.stabilizingComplete;
    }

    /**
     * Subscribe to progress events
     */
    subscribe(listener: ProgressEventListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Emit progress event
     */
    private emit(event: Omit<ProgressEvent, 'progress' | 'phase'>): void {
        const fullEvent: ProgressEvent = {
            ...event,
            progress: this.displayProgress,
            phase: this.currentPhase,
        };

        for (const listener of this.listeners) {
            try {
                listener(fullEvent);
            } catch (e) {
                console.error('[ArcanaProgressModel] Listener error:', e);
            }
        }
    }

    /**
     * Reset model state
     */
    reset(): void {
        this.currentPhase = LoadingPhase.PENDING;
        this.rawProgress = 0;
        this.displayProgress = 0;
        this.completedWeight = 0;
        this.barrierActive = false;
        this.barrierResolved = false;
        this.visualReadyActive = false;
        this.visualReadyComplete = false;
        this.stabilizingActive = false;
        this.stabilizingComplete = false;
        this.stabilizationStartTime = 0;
        this.stableFrameCount = 0;
        this.currentUnitName = undefined;
        this.unitStatuses.clear();
    }

    /**
     * Dispose and clear listeners
     */
    dispose(): void {
        this.listeners.clear();
        this.reset();
    }
}
