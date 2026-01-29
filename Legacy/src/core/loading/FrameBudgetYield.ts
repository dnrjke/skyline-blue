/**
 * Frame Budget Yielding Utilities
 *
 * Phase 2.7: Surgical Yielding
 *
 * Problem:
 * - 188ms blocking during loading causes RAF throttling
 * - Single synchronous operations block main thread too long
 *
 * Solution:
 * - Break up long operations into frame-budget chunks
 * - Yield to browser between chunks to maintain RAF continuity
 * - Target: No single operation > 4ms, total blocking < 50ms
 */

/**
 * Default frame budget in milliseconds.
 * 4ms allows for ~16ms frame time with overhead.
 */
export const DEFAULT_FRAME_BUDGET_MS = 4;

/**
 * Wait for the next animation frame.
 * This yields control to the browser, allowing RAF to run.
 */
export function nextFrame(): Promise<number> {
    return new Promise((resolve) => {
        requestAnimationFrame(resolve);
    });
}

/**
 * Wait for next frame using setTimeout(0).
 * Faster than RAF but less precise.
 */
export function yieldMicrotask(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Frame budget tracker for yielding during long operations.
 */
export class FrameBudget {
    private startTime: number = 0;
    private readonly budgetMs: number;
    private yieldCount: number = 0;
    private totalWorkTime: number = 0;

    constructor(budgetMs: number = DEFAULT_FRAME_BUDGET_MS) {
        this.budgetMs = budgetMs;
    }

    /**
     * Start or reset the budget timer.
     */
    public start(): void {
        this.startTime = performance.now();
    }

    /**
     * Check if budget is exceeded.
     */
    public isOverBudget(): boolean {
        return performance.now() - this.startTime >= this.budgetMs;
    }

    /**
     * Get elapsed time since start.
     */
    public getElapsed(): number {
        return performance.now() - this.startTime;
    }

    /**
     * Yield if over budget, then restart timer.
     * Returns true if yielded, false if still within budget.
     */
    public async yieldIfNeeded(): Promise<boolean> {
        if (this.isOverBudget()) {
            this.totalWorkTime += this.getElapsed();
            this.yieldCount++;
            await nextFrame();
            this.start();
            return true;
        }
        return false;
    }

    /**
     * Force yield and restart timer.
     */
    public async forceYield(): Promise<void> {
        this.totalWorkTime += this.getElapsed();
        this.yieldCount++;
        await nextFrame();
        this.start();
    }

    /**
     * Get statistics about yielding.
     */
    public getStats(): { yieldCount: number; totalWorkTime: number } {
        return {
            yieldCount: this.yieldCount,
            totalWorkTime: this.totalWorkTime + this.getElapsed(),
        };
    }
}

/**
 * Process an array in chunks with frame budget yielding.
 *
 * @param items - Array to process
 * @param processor - Function to process each item
 * @param budgetMs - Frame budget in milliseconds
 * @returns Promise that resolves when all items are processed
 */
export async function processWithYield<T>(
    items: T[],
    processor: (item: T, index: number) => void,
    budgetMs: number = DEFAULT_FRAME_BUDGET_MS
): Promise<{ yieldCount: number; totalTime: number }> {
    const budget = new FrameBudget(budgetMs);
    const startTime = performance.now();

    budget.start();

    for (let i = 0; i < items.length; i++) {
        processor(items[i], i);
        await budget.yieldIfNeeded();
    }

    const stats = budget.getStats();
    return {
        yieldCount: stats.yieldCount,
        totalTime: performance.now() - startTime,
    };
}

/**
 * Execute a batch of operations with yielding between batches.
 *
 * @param totalCount - Total number of operations
 * @param batchSize - Operations per batch before yielding
 * @param operation - Function to execute for each index
 */
export async function batchWithYield(
    totalCount: number,
    batchSize: number,
    operation: (index: number) => void
): Promise<{ batches: number; totalTime: number }> {
    const startTime = performance.now();
    let batches = 0;

    for (let i = 0; i < totalCount; i++) {
        operation(i);

        // Yield after each batch
        if ((i + 1) % batchSize === 0 && i < totalCount - 1) {
            batches++;
            await nextFrame();
        }
    }

    return {
        batches,
        totalTime: performance.now() - startTime,
    };
}

/**
 * LoadUnit profiler for tracking execution phases.
 */
export class LoadUnitProfiler {
    private readonly unitId: string;
    private readonly phases: Map<string, { start: number; end: number; duration: number }> = new Map();
    private currentPhase: string | null = null;
    private phaseStart: number = 0;
    private unitStart: number = 0;
    private warnings: string[] = [];

    /** Threshold for warning (ms) */
    private static readonly PHASE_WARNING_THRESHOLD = 50;
    private static readonly UNIT_WARNING_THRESHOLD = 100;

    constructor(unitId: string) {
        this.unitId = unitId;
    }

    /**
     * Start profiling the unit.
     */
    public start(): void {
        this.unitStart = performance.now();
        this.phases.clear();
        this.warnings = [];
    }

    /**
     * Begin a named phase.
     */
    public beginPhase(phaseName: string): void {
        // End previous phase if any
        if (this.currentPhase) {
            this.endPhase();
        }

        this.currentPhase = phaseName;
        this.phaseStart = performance.now();
        performance.mark(`${this.unitId}:${phaseName}:start`);
    }

    /**
     * End the current phase.
     */
    public endPhase(): void {
        if (!this.currentPhase) return;

        const endTime = performance.now();
        const duration = endTime - this.phaseStart;

        performance.mark(`${this.unitId}:${this.currentPhase}:end`);

        this.phases.set(this.currentPhase, {
            start: this.phaseStart,
            end: endTime,
            duration,
        });

        // Check for warning
        if (duration >= LoadUnitProfiler.PHASE_WARNING_THRESHOLD) {
            this.warnings.push(`⚠️ Phase "${this.currentPhase}" took ${duration.toFixed(1)}ms (>${LoadUnitProfiler.PHASE_WARNING_THRESHOLD}ms)`);
        }

        this.currentPhase = null;
    }

    /**
     * Complete profiling and return report.
     */
    public complete(): LoadUnitProfileReport {
        // End any ongoing phase
        if (this.currentPhase) {
            this.endPhase();
        }

        const totalDuration = performance.now() - this.unitStart;

        // Check unit-level warning
        if (totalDuration >= LoadUnitProfiler.UNIT_WARNING_THRESHOLD) {
            this.warnings.unshift(`🚨 Unit "${this.unitId}" took ${totalDuration.toFixed(1)}ms (>${LoadUnitProfiler.UNIT_WARNING_THRESHOLD}ms)`);
        }

        return {
            unitId: this.unitId,
            totalDuration,
            phases: Object.fromEntries(this.phases),
            warnings: this.warnings,
            isBlocking: totalDuration >= LoadUnitProfiler.UNIT_WARNING_THRESHOLD,
        };
    }
}

/**
 * Profile report for a LoadUnit.
 */
export interface LoadUnitProfileReport {
    unitId: string;
    totalDuration: number;
    phases: Record<string, { start: number; end: number; duration: number }>;
    warnings: string[];
    isBlocking: boolean;
}

/**
 * Aggregate profiler that collects reports from all units.
 */
export class LoadingProfileAggregator {
    private reports: LoadUnitProfileReport[] = [];
    private startTime: number = 0;

    public start(): void {
        this.startTime = performance.now();
        this.reports = [];
    }

    public addReport(report: LoadUnitProfileReport): void {
        this.reports.push(report);

        // Log warnings immediately
        if (report.warnings.length > 0) {
            console.warn(`[LoadingProfile] ${report.unitId}:`);
            report.warnings.forEach((w) => console.warn(`  ${w}`));
        }
    }

    public getSummary(): LoadingProfileSummary {
        const totalDuration = performance.now() - this.startTime;
        const blockingUnits = this.reports.filter((r) => r.isBlocking);

        return {
            totalDuration,
            unitCount: this.reports.length,
            blockingUnitCount: blockingUnits.length,
            blockingUnits: blockingUnits.map((r) => ({
                unitId: r.unitId,
                duration: r.totalDuration,
            })),
            reports: this.reports,
        };
    }

    public printSummary(): void {
        const summary = this.getSummary();

        console.log(`[LoadingProfile] ========================================`);
        console.log(`[LoadingProfile] LOADING PROFILE SUMMARY`);
        console.log(`[LoadingProfile] ========================================`);
        console.log(`[LoadingProfile] Total Duration: ${summary.totalDuration.toFixed(1)}ms`);
        console.log(`[LoadingProfile] Units: ${summary.unitCount}`);
        console.log(`[LoadingProfile] Blocking Units: ${summary.blockingUnitCount}`);

        if (summary.blockingUnits.length > 0) {
            console.log(`[LoadingProfile] ----------------------------------------`);
            console.log(`[LoadingProfile] 🚨 BLOCKING UNITS:`);
            summary.blockingUnits.forEach((u) => {
                console.log(`[LoadingProfile]   - ${u.unitId}: ${u.duration.toFixed(1)}ms`);
            });
        }

        console.log(`[LoadingProfile] ========================================`);
    }
}

export interface LoadingProfileSummary {
    totalDuration: number;
    unitCount: number;
    blockingUnitCount: number;
    blockingUnits: Array<{ unitId: string; duration: number }>;
    reports: LoadUnitProfileReport[];
}
