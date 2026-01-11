/**
 * LoadingStateEmitter - Observable Loading State for Reactive UI/Visuals.
 *
 * Key Principle (Master Prompt):
 * - LoadUnit is logic-only (NO UI, NO particles, NO transitions)
 * - Visuals are REACTIVE - they observe loading state
 * - UI/particles/transitions must NEVER control loading logic
 *
 * This emitter provides:
 * - Centralized loading state broadcasting
 * - Type-safe event subscription
 * - Progress bar "detach" signal for transition system
 */

import { LoadingPhase } from '../protocol/LoadingPhase';
import { LoadUnitStatus } from '../unit/LoadUnit';

/**
 * Loading state snapshot for UI consumption
 */
export interface LoadingState {
    /** Current phase */
    phase: LoadingPhase;

    /** Display progress (0-1) */
    progress: number;

    /** Current unit display name */
    currentUnit?: string;

    /** Is barrier active (compression phase) */
    isCompressing: boolean;

    /** Is loading complete */
    isComplete: boolean;

    /** Is loading failed */
    isFailed: boolean;
}

/**
 * Events emitted by LoadingStateEmitter
 */
export interface LoadingEvents {
    /**
     * Called on every state change (debounced for UI performance)
     */
    onStateChange: (state: LoadingState) => void;

    /**
     * Called when a unit starts loading
     */
    onUnitStart: (unitId: string, displayName?: string) => void;

    /**
     * Called when a unit completes (loaded or validated)
     */
    onUnitComplete: (unitId: string, status: LoadUnitStatus) => void;

    /**
     * Called when entering barrier phase (compression starts)
     */
    onBarrierEnter: () => void;

    /**
     * Called when barrier resolves (100% snap)
     */
    onBarrierResolve: () => void;

    /**
     * Called when LAUNCH event fires
     * UI should detach progress bar for transition system
     */
    onLaunch: () => void;

    /**
     * Called when loading fails
     */
    onFailed: (error: Error) => void;
}

type EventKey = keyof LoadingEvents;
type EventCallback<K extends EventKey> = LoadingEvents[K];

/**
 * LoadingStateEmitter
 */
export class LoadingStateEmitter {
    private state: LoadingState = {
        phase: LoadingPhase.PENDING,
        progress: 0,
        isCompressing: false,
        isComplete: false,
        isFailed: false,
    };

    private listeners: Map<EventKey, Set<EventCallback<any>>> = new Map();
    private stateChangeThrottleMs: number = 16; // ~60fps
    private lastStateChangeTime: number = 0;
    private pendingStateChange: boolean = false;

    constructor(options?: { stateChangeThrottleMs?: number }) {
        this.stateChangeThrottleMs = options?.stateChangeThrottleMs ?? 16;
    }

    /**
     * Subscribe to a specific event
     */
    on<K extends EventKey>(event: K, callback: EventCallback<K>): () => void {
        let callbacks = this.listeners.get(event);
        if (!callbacks) {
            callbacks = new Set();
            this.listeners.set(event, callbacks);
        }
        callbacks.add(callback);

        return () => {
            callbacks?.delete(callback);
        };
    }

    /**
     * Subscribe to all events with a single handler object
     */
    subscribe(handlers: Partial<LoadingEvents>): () => void {
        const unsubscribes: (() => void)[] = [];

        for (const [event, handler] of Object.entries(handlers)) {
            if (handler) {
                unsubscribes.push(this.on(event as EventKey, handler as any));
            }
        }

        return () => {
            for (const unsub of unsubscribes) {
                unsub();
            }
        };
    }

    /**
     * Update loading state (triggers onStateChange if changed)
     */
    setState(update: Partial<LoadingState>): void {
        let changed = false;

        for (const key of Object.keys(update) as (keyof LoadingState)[]) {
            if (this.state[key] !== update[key]) {
                (this.state as any)[key] = update[key];
                changed = true;
            }
        }

        if (changed) {
            this.scheduleStateChange();
        }
    }

    /**
     * Get current state snapshot
     */
    getState(): Readonly<LoadingState> {
        return { ...this.state };
    }

    /**
     * Emit unit start event
     */
    emitUnitStart(unitId: string, displayName?: string): void {
        this.state.currentUnit = displayName ?? unitId;
        this.emit('onUnitStart', unitId, displayName);
        this.scheduleStateChange();
    }

    /**
     * Emit unit complete event
     */
    emitUnitComplete(unitId: string, status: LoadUnitStatus): void {
        this.emit('onUnitComplete', unitId, status);
    }

    /**
     * Emit barrier enter event
     */
    emitBarrierEnter(): void {
        this.state.isCompressing = true;
        this.emit('onBarrierEnter');
        this.scheduleStateChange();
    }

    /**
     * Emit barrier resolve event
     */
    emitBarrierResolve(): void {
        this.state.isCompressing = false;
        this.state.progress = 1;
        this.emit('onBarrierResolve');
        this.flushStateChange(); // Immediate state update
    }

    /**
     * Emit launch event
     */
    emitLaunch(): void {
        this.state.isComplete = true;
        this.emit('onLaunch');
        this.flushStateChange();
    }

    /**
     * Emit failed event
     */
    emitFailed(error: Error): void {
        this.state.isFailed = true;
        this.state.phase = LoadingPhase.FAILED;
        this.emit('onFailed', error);
        this.flushStateChange();
    }

    /**
     * Throttled state change emission
     */
    private scheduleStateChange(): void {
        if (this.pendingStateChange) return;

        const now = performance.now();
        const elapsed = now - this.lastStateChangeTime;

        if (elapsed >= this.stateChangeThrottleMs) {
            this.flushStateChange();
        } else {
            this.pendingStateChange = true;
            setTimeout(() => {
                this.pendingStateChange = false;
                this.flushStateChange();
            }, this.stateChangeThrottleMs - elapsed);
        }
    }

    /**
     * Immediate state change emission
     */
    private flushStateChange(): void {
        this.lastStateChangeTime = performance.now();
        this.emit('onStateChange', { ...this.state });
    }

    /**
     * Emit event to all listeners
     */
    private emit<K extends EventKey>(event: K, ...args: Parameters<EventCallback<K>>): void {
        const callbacks = this.listeners.get(event);
        if (!callbacks) return;

        for (const callback of callbacks) {
            try {
                (callback as Function)(...args);
            } catch (e) {
                console.error(`[LoadingStateEmitter] Error in ${event} listener:`, e);
            }
        }
    }

    /**
     * Reset state
     */
    reset(): void {
        this.state = {
            phase: LoadingPhase.PENDING,
            progress: 0,
            isCompressing: false,
            isComplete: false,
            isFailed: false,
        };
        this.pendingStateChange = false;
    }

    /**
     * Dispose and clear listeners
     */
    dispose(): void {
        this.listeners.clear();
        this.reset();
    }
}

/**
 * Singleton instance for global loading state
 * (Optional - scenes can create their own instances)
 */
let globalEmitter: LoadingStateEmitter | null = null;

export function getGlobalLoadingEmitter(): LoadingStateEmitter {
    if (!globalEmitter) {
        globalEmitter = new LoadingStateEmitter();
    }
    return globalEmitter;
}

export function disposeGlobalLoadingEmitter(): void {
    globalEmitter?.dispose();
    globalEmitter = null;
}
