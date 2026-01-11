/**
 * ArcanaProgressModel - Phase-based Progress Calculation System.
 *
 * Progress Mapping (Master Prompt Specification):
 * - Phase 1 (Registration): 0-10%   - All LoadUnits registered, instant
 * - Phase 2 (Validation):  10-70%  - Each LoadUnit advances progress
 * - Phase 3 (Arcana Barrier): 70-100%
 *   - Compression Phase (70-90%): Slow easing, never exceeds 90%
 *   - Launch Phase (90-100%): Instant snap on barrier resolve
 *
 * Key Rules:
 * - Progress bar must NEVER exceed 90% until barrier resolves
 * - Progress SNAPS to 100% only after first-frame validation
 * - Compression phase uses time-based slow lerp
 */

import { LoadingPhase } from '../protocol/LoadingPhase';
import { LoadUnitStatus } from '../unit/LoadUnit';

/**
 * Progress phase boundaries
 */
export const PROGRESS_BOUNDS = {
    /** Registration complete */
    REGISTRATION_END: 0.10,

    /** Validation progress range */
    VALIDATION_START: 0.10,
    VALIDATION_END: 0.70,

    /** Arcana Barrier range */
    BARRIER_START: 0.70,
    COMPRESSION_LIMIT: 0.90, // Never exceed during compression
    LAUNCH: 1.0,
} as const;

/**
 * Compression phase settings
 */
export const COMPRESSION_SETTINGS = {
    /** Lerp factor per update (lower = slower) */
    LERP_FACTOR: 0.02,

    /** Minimum progress increment per update */
    MIN_INCREMENT: 0.0005,

    /** Maximum progress per update */
    MAX_INCREMENT: 0.01,
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

    /** Is barrier active (compression phase) */
    isBarrierActive: boolean;

    /** Is barrier resolved (launch phase) */
    isBarrierResolved: boolean;

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
 */
export class ArcanaProgressModel {
    private currentPhase: LoadingPhase = LoadingPhase.PENDING;
    private rawProgress: number = 0;
    private displayProgress: number = 0;
    // Reserved for future compression target customization
    private _compressionTarget: number = PROGRESS_BOUNDS.COMPRESSION_LIMIT;

    private unitWeights: Map<string, number> = new Map();
    private unitStatuses: Map<string, LoadUnitStatus> = new Map();
    private totalWeight: number = 0;
    private completedWeight: number = 0;

    private barrierActive: boolean = false;
    private barrierResolved: boolean = false;

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

        // Barrier phase entry
        if (phase === LoadingPhase.BARRIER && !this.barrierActive) {
            this.barrierActive = true;
            this.emit({ type: 'barrier_enter' });
        }

        // Ready phase = barrier resolved
        if (phase === LoadingPhase.READY && !this.barrierResolved) {
            this.resolveBarrier();
        }

        this.emit({ type: 'phase_change' });
        console.log(`[ArcanaProgressModel] Phase: ${prevPhase} -> ${phase}`);
    }

    /**
     * Resolve barrier and snap to 100%
     */
    resolveBarrier(): void {
        if (this.barrierResolved) return;

        this.barrierResolved = true;
        this.rawProgress = PROGRESS_BOUNDS.LAUNCH;
        this.displayProgress = PROGRESS_BOUNDS.LAUNCH;

        this.emit({ type: 'barrier_resolve' });
        this.emit({ type: 'launch' });

        console.log('[ArcanaProgressModel] Barrier resolved - LAUNCH!');
    }

    /**
     * Recalculate progress based on unit completion
     */
    private recalculateProgress(): void {
        if (this.barrierResolved) {
            // Already at 100%
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

        // Apply barrier compression if active
        if (this.barrierActive) {
            // Raw progress can exceed 70% but display must not exceed 90%
            this.rawProgress = Math.max(this.rawProgress, PROGRESS_BOUNDS.BARRIER_START);
        }

        this.updateDisplayProgress();
        this.emit({ type: 'progress_update' });
    }

    /**
     * Update display progress with compression logic
     */
    private updateDisplayProgress(): void {
        if (this.barrierResolved) {
            this.displayProgress = PROGRESS_BOUNDS.LAUNCH;
            return;
        }

        if (this.barrierActive) {
            // Compression phase: slow lerp towards 90%, never exceed
            const target = Math.min(this.rawProgress, PROGRESS_BOUNDS.COMPRESSION_LIMIT);

            // Slow easing towards target
            const delta = target - this.displayProgress;
            const increment = Math.max(
                COMPRESSION_SETTINGS.MIN_INCREMENT,
                Math.min(delta * COMPRESSION_SETTINGS.LERP_FACTOR, COMPRESSION_SETTINGS.MAX_INCREMENT)
            );

            if (delta > 0) {
                this.displayProgress = Math.min(
                    this.displayProgress + increment,
                    PROGRESS_BOUNDS.COMPRESSION_LIMIT
                );
            }
        } else {
            // Normal progress: direct mapping
            this.displayProgress = this.rawProgress;
        }
    }

    /**
     * Tick update for compression phase animation
     * Call this every frame during barrier phase
     */
    tick(): void {
        if (!this.barrierActive || this.barrierResolved) return;

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
     * Is loading complete?
     */
    isComplete(): boolean {
        return this.barrierResolved;
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
        this.currentUnitName = undefined;
        this.unitStatuses.clear();
    }

    /**
     * Get compression target (for future customization)
     */
    getCompressionTarget(): number {
        return this._compressionTarget;
    }

    /**
     * Dispose and clear listeners
     */
    dispose(): void {
        this.listeners.clear();
        this.reset();
    }
}
