/**
 * BlackHoleLogger — Ultra-Precision Diagnostic Logger
 *
 * Purpose: Track the ~4 minute "black hole" gap between READY declaration
 * and actual screen normalization (TacticalGrid visible, InteractionLayer enabled).
 *
 * Features:
 * - 1ms-precision timestamps (performance.now based)
 * - Frame gap detection (stall alerts at configurable threshold)
 * - Mesh state monitoring (visibility, activeMeshes inclusion)
 * - Async task tracking (promise lifecycle)
 * - Phase transition markers
 * - JSON/CSV export with timeline visualization structure
 *
 * Usage:
 *   const logger = new BlackHoleLogger(scene, { enabled: true });
 *   logger.markPhase('ENGINE_AWAKENED');
 *   logger.startFrameMonitor();
 *   logger.trackMesh('TacticalGrid');
 *   // ... after normalization ...
 *   console.log(logger.exportJSON());
 *   logger.dispose();
 *
 * Overhead: Minimal when disabled. When enabled, adds one onBeforeRender
 * observer and periodic mesh state checks (every N frames).
 */

import * as BABYLON from '@babylonjs/core';

// ============================================================
// Types
// ============================================================

export type LogLevel = 'trace' | 'info' | 'warn' | 'stall' | 'error';

export interface BlackHoleEntry {
    /** Absolute timestamp (performance.now) */
    t: number;
    /** Relative time from logger start (ms) */
    dt: number;
    /** Log level */
    level: LogLevel;
    /** Event category */
    category: BlackHoleCategory;
    /** Event name */
    event: string;
    /** Optional unit/source identifier */
    unit?: string;
    /** Structured payload */
    data?: Record<string, unknown>;
}

export type BlackHoleCategory =
    | 'phase'      // Phase transitions (READY, UX_READY, etc.)
    | 'frame'      // RAF frame events
    | 'stall'      // No-render stall detected
    | 'mesh'       // Mesh state changes
    | 'async'      // Promise/setTimeout tracking
    | 'gpu'        // Shader/texture state
    | 'transition' // Camera/visibility transitions
    | 'input'      // InteractionLayer/input state
    | 'custom';    // User-defined events

export interface BlackHoleConfig {
    /** Enable/disable the logger (default: false) */
    enabled?: boolean;
    /** Frame gap threshold for stall alert (ms, default: 100) */
    stallThresholdMs?: number;
    /** How often to sample mesh state (every N frames, default: 5) */
    meshSampleInterval?: number;
    /** Maximum entries before circular buffer wraps (default: 50000) */
    maxEntries?: number;
    /** Auto-stop after this duration (ms, default: 300000 = 5min) */
    autoStopMs?: number;
    /** Console output for stalls (default: true) */
    consoleStalls?: boolean;
}

interface TrackedMesh {
    name: string;
    lastVisibility: number;
    lastEnabled: boolean;
    lastInActiveMeshes: boolean;
    lastRenderId: number;
}

interface TrackedAsync {
    id: string;
    unit: string;
    startTime: number;
    resolved: boolean;
}

/**
 * Current loading context — set by orchestrator to identify culprit during stalls.
 */
interface LoadingUnitContext {
    /** Unit ID (e.g., 'nav-character', 'MaterialWarmup') */
    unitId: string;
    /** Display name */
    displayName: string;
    /** Progress (0-1) */
    progress: number;
    /** Phase (e.g., 'BUILDING', 'WARMING') */
    phase: string;
    /** Start time */
    startTime: number;
}

// ============================================================
// BlackHoleLogger
// ============================================================

export class BlackHoleLogger {
    private scene: BABYLON.Scene;
    private config: Required<BlackHoleConfig>;
    private entries: BlackHoleEntry[] = [];
    private startTime: number = 0;
    private active: boolean = false;
    private disposed: boolean = false;

    // Frame monitoring
    private frameObserver: BABYLON.Nullable<BABYLON.Observer<BABYLON.Scene>> = null;
    private lastFrameTime: number = 0;
    private frameCount: number = 0;
    private totalStalls: number = 0;
    private maxGapMs: number = 0;
    private lastActiveMeshCount: number = -1;

    // Mesh tracking
    private trackedMeshes: Map<string, TrackedMesh> = new Map();

    // Async tracking
    private asyncTasks: Map<string, TrackedAsync> = new Map();
    private asyncIdCounter: number = 0;

    // Auto-stop
    private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

    // Current loading unit context (for forensic stall identification)
    private loadingContext: LoadingUnitContext | null = null;

    constructor(scene: BABYLON.Scene, config: BlackHoleConfig = {}) {
        this.scene = scene;
        this.config = {
            enabled: config.enabled ?? false,
            stallThresholdMs: config.stallThresholdMs ?? 100,
            meshSampleInterval: config.meshSampleInterval ?? 5,
            maxEntries: config.maxEntries ?? 50000,
            autoStopMs: config.autoStopMs ?? 300_000,
            consoleStalls: config.consoleStalls ?? true,
        };
    }

    // ============================================================
    // Lifecycle
    // ============================================================

    /**
     * Start recording. Call this at READY declaration.
     */
    start(): void {
        if (!this.config.enabled || this.active || this.disposed) return;

        this.active = true;
        this.startTime = performance.now();
        this.frameCount = 0;
        this.totalStalls = 0;
        this.maxGapMs = 0;
        this.lastFrameTime = this.startTime;
        this.entries = [];

        this.emit('info', 'phase', 'LOGGER_START', undefined, {
            stallThreshold: this.config.stallThresholdMs,
            meshSampleInterval: this.config.meshSampleInterval,
            autoStopMs: this.config.autoStopMs,
        });

        this.startFrameMonitor();

        // Auto-stop safety valve
        this.autoStopTimer = setTimeout(() => {
            if (this.active) {
                this.emit('warn', 'phase', 'AUTO_STOP', undefined, {
                    reason: `Exceeded ${this.config.autoStopMs}ms`,
                    entries: this.entries.length,
                    totalStalls: this.totalStalls,
                });
                this.stop();
            }
        }, this.config.autoStopMs);

        console.log(`[BlackHole] Logger started (threshold=${this.config.stallThresholdMs}ms)`);
    }

    /**
     * Stop recording and finalize.
     */
    stop(): void {
        if (!this.active) return;
        this.active = false;

        this.stopFrameMonitor();

        if (this.autoStopTimer !== null) {
            clearTimeout(this.autoStopTimer);
            this.autoStopTimer = null;
        }

        const elapsed = performance.now() - this.startTime;
        this.emit('info', 'phase', 'LOGGER_STOP', undefined, {
            totalEntries: this.entries.length,
            totalFrames: this.frameCount,
            totalStalls: this.totalStalls,
            maxGapMs: this.maxGapMs,
            elapsedMs: elapsed,
        });

        console.log(
            `[BlackHole] Logger stopped: ${this.entries.length} entries, ` +
            `${this.totalStalls} stalls, maxGap=${this.maxGapMs.toFixed(1)}ms, ` +
            `elapsed=${elapsed.toFixed(0)}ms`
        );
    }

    dispose(): void {
        this.stop();
        this.disposed = true;
        this.trackedMeshes.clear();
        this.asyncTasks.clear();
        this.loadingContext = null;
        this.entries = [];
    }

    isActive(): boolean {
        return this.active;
    }

    // ============================================================
    // Phase Markers
    // ============================================================

    /**
     * Mark a named phase transition point.
     */
    markPhase(name: string, data?: Record<string, unknown>): void {
        this.emit('info', 'phase', name, undefined, data);
    }

    /**
     * Mark a stall detection point with context.
     */
    markStall(reason: string, data?: Record<string, unknown>): void {
        this.emit('stall', 'stall', reason, undefined, data);
    }

    // ============================================================
    // Loading Unit Context (Forensic Identification)
    // ============================================================

    /**
     * Set the current loading unit context.
     * Call this from orchestrator when a unit starts loading.
     * This info is included in stall logs to identify the "culprit".
     */
    setLoadingContext(
        unitId: string,
        displayName: string,
        phase: string,
        progress: number = 0
    ): void {
        this.loadingContext = {
            unitId,
            displayName,
            phase,
            progress,
            startTime: performance.now(),
        };

        this.emit('info', 'async', 'LOADING_UNIT_START', unitId, {
            displayName,
            phase,
        });
    }

    /**
     * Update the progress of current loading unit.
     */
    updateLoadingProgress(progress: number): void {
        if (this.loadingContext) {
            this.loadingContext.progress = progress;
        }
    }

    /**
     * Clear the current loading unit context.
     * Call this when a unit finishes loading.
     */
    clearLoadingContext(): void {
        if (this.loadingContext) {
            const elapsed = performance.now() - this.loadingContext.startTime;
            this.emit('info', 'async', 'LOADING_UNIT_END', this.loadingContext.unitId, {
                displayName: this.loadingContext.displayName,
                phase: this.loadingContext.phase,
                elapsedMs: Math.round(elapsed),
            });
            this.loadingContext = null;
        }
    }

    /**
     * Get current loading context (for external inspection).
     */
    getLoadingContext(): LoadingUnitContext | null {
        return this.loadingContext ? { ...this.loadingContext } : null;
    }

    // ============================================================
    // Frame Monitoring
    // ============================================================

    private startFrameMonitor(): void {
        if (this.frameObserver) return;

        this.lastFrameTime = performance.now();

        this.frameObserver = this.scene.onBeforeRenderObservable.add(() => {
            if (!this.active) return;

            const now = performance.now();
            const gap = now - this.lastFrameTime;
            this.lastFrameTime = now;
            this.frameCount++;

            // Track max gap
            if (gap > this.maxGapMs) {
                this.maxGapMs = gap;
            }

            // Stall detection
            if (gap > this.config.stallThresholdMs) {
                this.totalStalls++;

                // Include loading context in stall data for forensic identification
                const stallData: Record<string, unknown> = {
                    gapMs: Math.round(gap),
                    frame: this.frameCount,
                    stallCount: this.totalStalls,
                };

                // Identify the "culprit" — which unit was loading during the stall
                if (this.loadingContext) {
                    stallData.loadingUnit = this.loadingContext.unitId;
                    stallData.loadingUnitDisplay = this.loadingContext.displayName;
                    stallData.loadingPhase = this.loadingContext.phase;
                    stallData.loadingProgress = Math.round(this.loadingContext.progress * 100);
                    stallData.loadingElapsedMs = Math.round(
                        performance.now() - this.loadingContext.startTime
                    );
                }

                this.emit('stall', 'stall', 'FRAME_GAP', this.loadingContext?.unitId, stallData);

                if (this.config.consoleStalls) {
                    const unitInfo = this.loadingContext
                        ? ` [CULPRIT: ${this.loadingContext.displayName} @ ${Math.round(this.loadingContext.progress * 100)}%]`
                        : '';
                    console.warn(
                        `[BlackHole] STALL #${this.totalStalls}: ` +
                        `${gap.toFixed(0)}ms gap at frame ${this.frameCount}${unitInfo}`
                    );
                }
            }

            // Periodic mesh state sampling
            if (this.frameCount % this.config.meshSampleInterval === 0) {
                this.sampleMeshStates();
            }

            // Track activeMeshes count changes
            const activeMeshCount = this.scene.getActiveMeshes().length;
            if (activeMeshCount !== this.lastActiveMeshCount) {
                this.emit('trace', 'frame', 'ACTIVE_MESHES_CHANGED', undefined, {
                    from: this.lastActiveMeshCount,
                    to: activeMeshCount,
                    frame: this.frameCount,
                });
                this.lastActiveMeshCount = activeMeshCount;
            }

            // Every 60 frames (≈1s at 60fps), log a heartbeat
            if (this.frameCount % 60 === 0) {
                this.emit('trace', 'frame', 'HEARTBEAT', undefined, {
                    frame: this.frameCount,
                    elapsedMs: Math.round(now - this.startTime),
                    stalls: this.totalStalls,
                    activeMeshes: activeMeshCount,
                });
            }
        });
    }

    private stopFrameMonitor(): void {
        if (this.frameObserver) {
            this.scene.onBeforeRenderObservable.remove(this.frameObserver);
            this.frameObserver = null;
        }
    }

    // ============================================================
    // Mesh Tracking
    // ============================================================

    /**
     * Start tracking a named mesh for visibility/render state changes.
     */
    trackMesh(meshName: string): void {
        if (!this.config.enabled) return;

        this.trackedMeshes.set(meshName, {
            name: meshName,
            lastVisibility: -1,
            lastEnabled: false,
            lastInActiveMeshes: false,
            lastRenderId: -1,
        });

        this.emit('info', 'mesh', 'TRACK_START', meshName);
    }

    private sampleMeshStates(): void {
        const activeMeshes = this.scene.getActiveMeshes();
        const renderId = this.scene.getRenderId();

        for (const [name, tracked] of this.trackedMeshes) {
            const mesh = this.scene.getMeshByName(name);
            if (!mesh || mesh.isDisposed()) {
                if (tracked.lastVisibility !== -999) {
                    this.emit('warn', 'mesh', 'MESH_GONE', name, { wasVisible: tracked.lastVisibility });
                    tracked.lastVisibility = -999;
                }
                continue;
            }

            const visibility = mesh.visibility;
            const enabled = mesh.isEnabled() && mesh.isVisible;
            const inActiveMeshes = activeMeshes.length > 0 && activeMeshes.data.includes(mesh);
            const meshRenderId = (mesh as any)._renderId ?? -1;

            // Detect visibility changes
            if (Math.abs(visibility - tracked.lastVisibility) > 0.01) {
                this.emit('info', 'mesh', 'VISIBILITY_CHANGE', name, {
                    from: tracked.lastVisibility.toFixed(3),
                    to: visibility.toFixed(3),
                    frame: this.frameCount,
                });
                tracked.lastVisibility = visibility;
            }

            // Detect enabled state changes
            if (enabled !== tracked.lastEnabled) {
                this.emit('info', 'mesh', 'ENABLED_CHANGE', name, {
                    from: tracked.lastEnabled,
                    to: enabled,
                    frame: this.frameCount,
                });
                tracked.lastEnabled = enabled;
            }

            // Detect activeMeshes inclusion changes
            if (inActiveMeshes !== tracked.lastInActiveMeshes) {
                this.emit(inActiveMeshes ? 'info' : 'warn', 'mesh', 'ACTIVE_MESHES_STATE', name, {
                    inActiveMeshes,
                    visibility: visibility.toFixed(3),
                    enabled,
                    frame: this.frameCount,
                });
                tracked.lastInActiveMeshes = inActiveMeshes;
            }

            // Detect render ID progression
            if (meshRenderId !== tracked.lastRenderId && meshRenderId === renderId) {
                if (tracked.lastRenderId === -1) {
                    this.emit('info', 'mesh', 'FIRST_RENDER', name, {
                        renderId: meshRenderId,
                        frame: this.frameCount,
                    });
                }
                tracked.lastRenderId = meshRenderId;
            }
        }
    }

    // ============================================================
    // Async Task Tracking
    // ============================================================

    /**
     * Track a promise lifecycle (start → resolve/reject).
     * Returns a task ID for reference.
     */
    trackAsync<T>(unit: string, promise: Promise<T>): string {
        if (!this.config.enabled || !this.active) return '';

        const id = `async_${++this.asyncIdCounter}`;
        const startTime = performance.now();

        this.asyncTasks.set(id, { id, unit, startTime, resolved: false });
        this.emit('info', 'async', 'TASK_START', unit, { taskId: id });

        promise
            .then(() => {
                const duration = performance.now() - startTime;
                const task = this.asyncTasks.get(id);
                if (task) task.resolved = true;
                this.emit('info', 'async', 'TASK_RESOLVE', unit, {
                    taskId: id,
                    durationMs: Math.round(duration),
                });
            })
            .catch((err) => {
                const duration = performance.now() - startTime;
                this.emit('error', 'async', 'TASK_REJECT', unit, {
                    taskId: id,
                    durationMs: Math.round(duration),
                    error: err instanceof Error ? err.message : String(err),
                });
            });

        return id;
    }

    /**
     * Track a setTimeout/setInterval for execution delay.
     */
    trackTimeout(label: string, expectedMs: number): void {
        if (!this.config.enabled || !this.active) return;

        const scheduled = performance.now();
        this.emit('trace', 'async', 'TIMEOUT_SCHEDULED', label, { expectedMs });

        setTimeout(() => {
            const actual = performance.now() - scheduled;
            const drift = actual - expectedMs;
            const level: LogLevel = drift > 50 ? 'warn' : 'trace';
            this.emit(level, 'async', 'TIMEOUT_FIRED', label, {
                expectedMs,
                actualMs: Math.round(actual),
                driftMs: Math.round(drift),
            });
        }, expectedMs);
    }

    // ============================================================
    // GPU / Shader State
    // ============================================================

    /**
     * Snapshot current engine/GPU state.
     */
    snapshotGPUState(label: string = 'GPU_STATE'): void {
        if (!this.active) return;

        const engine = this.scene.getEngine();
        this.emit('info', 'gpu', label, undefined, {
            fps: Math.round(engine.getFps()),
            deltaTime: engine.getDeltaTime().toFixed(1),
            gpuFrameTimeCounter: (engine as any)._gpuFrameTimeCounter?.current ?? null,
            drawCalls: (engine as any)._drawCalls?.current ?? null,
            activeMeshes: this.scene.getActiveMeshes().length,
            activeParticles: this.scene.getActiveParticles(),
            totalMeshes: this.scene.meshes.length,
            totalMaterials: this.scene.materials.length,
            totalTextures: this.scene.textures.length,
            frame: this.frameCount,
        });
    }

    // ============================================================
    // Transition / Input State
    // ============================================================

    /**
     * Mark camera/visibility transition events.
     */
    markTransition(name: string, state: 'start' | 'progress' | 'complete', data?: Record<string, unknown>): void {
        this.emit('info', 'transition', `${name}_${state.toUpperCase()}`, undefined, data);
    }

    /**
     * Mark input state changes (InteractionLayer, inputLocked, etc.)
     */
    markInput(name: string, enabled: boolean, data?: Record<string, unknown>): void {
        this.emit('info', 'input', name, undefined, { enabled, ...data });
    }

    // ============================================================
    // Custom Events
    // ============================================================

    /**
     * Log a custom event.
     */
    custom(event: string, unit?: string, data?: Record<string, unknown>): void {
        this.emit('info', 'custom', event, unit, data);
    }

    // ============================================================
    // Export
    // ============================================================

    /**
     * Export all entries as formatted JSON string.
     */
    exportJSON(): string {
        const report = {
            meta: {
                startTime: this.startTime,
                endTime: performance.now(),
                totalEntries: this.entries.length,
                totalFrames: this.frameCount,
                totalStalls: this.totalStalls,
                maxGapMs: this.maxGapMs,
                config: this.config,
            },
            timeline: this.entries,
        };
        return JSON.stringify(report, null, 2);
    }

    /**
     * Export as CSV string.
     */
    exportCSV(): string {
        const headers = ['dt_ms', 'level', 'category', 'event', 'unit', 'data'];
        const rows = this.entries.map(e => [
            e.dt.toFixed(1),
            e.level,
            e.category,
            e.event,
            e.unit ?? '',
            e.data ? JSON.stringify(e.data).replace(/,/g, ';') : '',
        ].join(','));
        return [headers.join(','), ...rows].join('\n');
    }

    /**
     * Get entries filtered by category and/or level.
     */
    getEntries(filter?: { category?: BlackHoleCategory; level?: LogLevel }): BlackHoleEntry[] {
        if (!filter) return [...this.entries];
        return this.entries.filter(e =>
            (!filter.category || e.category === filter.category) &&
            (!filter.level || e.level === filter.level)
        );
    }

    /**
     * Get stall summary: list of all stalls with timing context.
     */
    getStallSummary(): { count: number; maxGapMs: number; stalls: BlackHoleEntry[] } {
        return {
            count: this.totalStalls,
            maxGapMs: this.maxGapMs,
            stalls: this.entries.filter(e => e.category === 'stall'),
        };
    }

    /**
     * Get timeline data for visualization (phase markers + stalls).
     * Returns a simplified structure suitable for timeline charts.
     */
    getTimelineData(): { phases: { t: number; name: string }[]; stalls: { t: number; gapMs: number }[] } {
        const phases: { t: number; name: string }[] = [];
        const stalls: { t: number; gapMs: number }[] = [];

        for (const entry of this.entries) {
            if (entry.category === 'phase') {
                phases.push({ t: entry.dt, name: entry.event });
            }
            if (entry.category === 'stall' && entry.data?.gapMs) {
                stalls.push({ t: entry.dt, gapMs: entry.data.gapMs as number });
            }
        }

        return { phases, stalls };
    }

    // ============================================================
    // Internal
    // ============================================================

    private emit(
        level: LogLevel,
        category: BlackHoleCategory,
        event: string,
        unit?: string,
        data?: Record<string, unknown>
    ): void {
        if (!this.config.enabled) return;

        const now = performance.now();
        const entry: BlackHoleEntry = {
            t: now,
            dt: now - this.startTime,
            level,
            category,
            event,
            unit,
            data,
        };

        // Circular buffer
        if (this.entries.length >= this.config.maxEntries) {
            this.entries.shift();
        }
        this.entries.push(entry);
    }
}
