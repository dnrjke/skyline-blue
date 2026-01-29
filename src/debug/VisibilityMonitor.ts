/**
 * VisibilityMonitor - Tab Visibility State Investigation Tool
 *
 * Black Hole 이슈의 핵심 가설:
 * - 탭이 "hidden" 상태가 되면 Chrome이 RAF를 ~104ms로 throttle
 * - 탭이 "visible"로 돌아오면 Black Hole이 해제됨
 * - 문제: 사용자가 탭을 전환하지 않았는데 hidden으로 변경되는 경우가 있음
 *
 * 이 모니터는 visibility 상태 변화와 가능한 원인들을 추적합니다.
 *
 * Usage:
 *   import { VisibilityMonitor } from '../debug/VisibilityMonitor';
 *   VisibilityMonitor.install();
 */

export interface VisibilityEvent {
    timestamp: number;
    state: DocumentVisibilityState;
    previousState: DocumentVisibilityState | null;
    rafDelta: number | null;
    documentHasFocus: boolean;
    activeElement: string;
    possibleCause: string;
    stackTrace?: string;
}

class VisibilityMonitorImpl {
    private events: VisibilityEvent[] = [];
    private installed: boolean = false;
    private previousState: DocumentVisibilityState | null = null;
    private lastRAFTime: number = 0;
    private rafDeltas: number[] = [];
    private rafHandle: number | null = null;

    // Track potential causes
    private lastFocusTime: number = 0;
    private lastBlurTime: number = 0;
    private lastPointerDownTime: number = 0;
    private lastKeyDownTime: number = 0;

    // NEW: Track non-visibility throttle causes
    private longTaskObserver: PerformanceObserver | null = null;
    private longTaskCount: number = 0;
    private lastLongTaskTime: number = 0;
    private webglContext: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    private throttleStartTime: number | null = null;
    private throttleFrameCount: number = 0;

    install(): void {
        if (this.installed) {
            console.warn('[VisibilityMonitor] Already installed');
            return;
        }

        this.installed = true;
        this.previousState = document.visibilityState;

        console.log('');
        console.log('╔══════════════════════════════════════════╗');
        console.log('║     VISIBILITY MONITOR INSTALLED         ║');
        console.log('╠══════════════════════════════════════════╣');
        console.log(`║  Initial state: ${document.visibilityState.padEnd(24)}║`);
        console.log(`║  Document has focus: ${document.hasFocus().toString().padEnd(18)}║`);
        console.log('╚══════════════════════════════════════════╝');
        console.log('');

        // Core visibility change listener
        document.addEventListener('visibilitychange', this.handleVisibilityChange);

        // Track potential cause events
        window.addEventListener('focus', this.handleWindowFocus);
        window.addEventListener('blur', this.handleWindowBlur);
        document.addEventListener('focus', this.handleDocumentFocus, true);
        document.addEventListener('blur', this.handleDocumentBlur, true);
        document.addEventListener('pointerdown', this.handlePointerDown);
        document.addEventListener('keydown', this.handleKeyDown);

        // Page lifecycle events (Chrome-specific)
        if ('onfreeze' in document) {
            document.addEventListener('freeze', this.handleFreeze);
            document.addEventListener('resume', this.handleResume);
        }

        // NEW: Long Task monitoring (detect main thread blocking)
        this.startLongTaskMonitoring();

        // NEW: WebGL context monitoring
        this.startWebGLMonitoring();

        // Start RAF monitoring
        this.startRAFMonitoring();

        // Log initial state with context
        this.logEvent({
            timestamp: performance.now(),
            state: document.visibilityState,
            previousState: null,
            rafDelta: null,
            documentHasFocus: document.hasFocus(),
            activeElement: this.getActiveElementInfo(),
            possibleCause: 'INITIAL_STATE',
        });
    }

    uninstall(): void {
        if (!this.installed) return;

        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('focus', this.handleWindowFocus);
        window.removeEventListener('blur', this.handleWindowBlur);
        document.removeEventListener('focus', this.handleDocumentFocus, true);
        document.removeEventListener('blur', this.handleDocumentBlur, true);
        document.removeEventListener('pointerdown', this.handlePointerDown);
        document.removeEventListener('keydown', this.handleKeyDown);

        if ('onfreeze' in document) {
            document.removeEventListener('freeze', this.handleFreeze);
            document.removeEventListener('resume', this.handleResume);
        }

        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }

        // Clean up Long Task observer
        if (this.longTaskObserver) {
            this.longTaskObserver.disconnect();
            this.longTaskObserver = null;
        }

        this.installed = false;
        console.log('[VisibilityMonitor] Uninstalled');
    }

    private handleVisibilityChange = (): void => {
        const now = performance.now();
        const newState = document.visibilityState;
        const avgRAF = this.getAverageRAFDelta();

        // Determine possible cause
        const possibleCause = this.determinePossibleCause(now);

        // Capture stack trace for debugging (shows what triggered this)
        let stackTrace: string | undefined;
        try {
            throw new Error('VisibilityChange stack trace');
        } catch (e) {
            stackTrace = (e as Error).stack;
        }

        const event: VisibilityEvent = {
            timestamp: now,
            state: newState,
            previousState: this.previousState,
            rafDelta: avgRAF,
            documentHasFocus: document.hasFocus(),
            activeElement: this.getActiveElementInfo(),
            possibleCause,
            stackTrace,
        };

        this.logEvent(event);
        this.events.push(event);

        // CRITICAL LOG for Black Hole investigation
        if (this.previousState === 'visible' && newState === 'hidden') {
            console.log('');
            console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
            console.log('[VisibilityMonitor] ⚠️ TAB BECAME HIDDEN!');
            console.log(`  Possible cause: ${possibleCause}`);
            console.log(`  RAF delta at change: ${avgRAF?.toFixed(1) ?? 'N/A'}ms`);
            console.log(`  Document has focus: ${document.hasFocus()}`);
            console.log(`  Time since last blur: ${(now - this.lastBlurTime).toFixed(0)}ms`);
            console.log('🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴🔴');
            if (stackTrace) {
                console.log('Stack trace:');
                console.log(stackTrace);
            }
            console.log('');
        } else if (this.previousState === 'hidden' && newState === 'visible') {
            console.log('');
            console.log('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢');
            console.log('[VisibilityMonitor] ✓ TAB BECAME VISIBLE!');
            console.log(`  RAF delta at change: ${avgRAF?.toFixed(1) ?? 'N/A'}ms`);
            console.log(`  Document has focus: ${document.hasFocus()}`);
            console.log(`  Time since last focus: ${(now - this.lastFocusTime).toFixed(0)}ms`);
            console.log('🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢🟢');
            console.log('');
        }

        this.previousState = newState;
    };

    private handleWindowFocus = (): void => {
        this.lastFocusTime = performance.now();
        console.log(`[VisibilityMonitor] window.focus at ${this.lastFocusTime.toFixed(0)}ms, visibility=${document.visibilityState}`);
    };

    private handleWindowBlur = (): void => {
        this.lastBlurTime = performance.now();
        console.log(`[VisibilityMonitor] window.blur at ${this.lastBlurTime.toFixed(0)}ms, visibility=${document.visibilityState}`);
    };

    private handleDocumentFocus = (e: FocusEvent): void => {
        const target = e.target as EventTarget | null;
        // Only log if target is an element (not document or window)
        if (target && target !== document && target !== window && 'tagName' in target) {
            const el = target as HTMLElement;
            console.log(`[VisibilityMonitor] document.focus on: ${el.tagName}#${el.id || 'unknown'}`);
        }
    };

    private handleDocumentBlur = (e: FocusEvent): void => {
        const target = e.target as EventTarget | null;
        // Only log if target is an element (not document or window)
        if (target && target !== document && target !== window && 'tagName' in target) {
            const el = target as HTMLElement;
            console.log(`[VisibilityMonitor] document.blur from: ${el.tagName}#${el.id || 'unknown'}`);
        }
    };

    private handlePointerDown = (): void => {
        this.lastPointerDownTime = performance.now();
    };

    private handleKeyDown = (): void => {
        this.lastKeyDownTime = performance.now();
    };

    private handleFreeze = (): void => {
        console.log('[VisibilityMonitor] 🧊 PAGE FREEZE EVENT');
    };

    private handleResume = (): void => {
        console.log('[VisibilityMonitor] 🔥 PAGE RESUME EVENT');
    };

    /**
     * NEW: Monitor Long Tasks (>50ms main thread blocking)
     * This is a key indicator of what might trigger Chrome's RAF throttling
     */
    private startLongTaskMonitoring(): void {
        if (!('PerformanceObserver' in window)) {
            console.log('[VisibilityMonitor] PerformanceObserver not available');
            return;
        }

        try {
            this.longTaskObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.longTaskCount++;
                    this.lastLongTaskTime = performance.now();
                    const duration = entry.duration;

                    // Log all long tasks with RAF context
                    const avgRAF = this.getAverageRAFDelta();
                    const visibility = document.visibilityState;

                    if (duration > 100) {
                        console.log('');
                        console.log('🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠');
                        console.log(`[VisibilityMonitor] 🚨 LONG TASK #${this.longTaskCount}: ${duration.toFixed(1)}ms`);
                        console.log(`  Visibility: ${visibility}`);
                        console.log(`  RAF avg: ${avgRAF?.toFixed(1) ?? 'N/A'}ms`);
                        console.log(`  Entry name: ${entry.name}`);
                        console.log(`  Entry type: ${entry.entryType}`);
                        console.log('🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠🟠');
                        console.log('');
                    } else {
                        console.log(
                            `[VisibilityMonitor] Long task #${this.longTaskCount}: ${duration.toFixed(1)}ms`,
                            `| visibility=${visibility}`,
                            `| RAF=${avgRAF?.toFixed(1) ?? 'N/A'}ms`
                        );
                    }
                }
            });

            this.longTaskObserver.observe({ entryTypes: ['longtask'] });
            console.log('[VisibilityMonitor] Long Task observer started');
        } catch (e) {
            console.warn('[VisibilityMonitor] Failed to start Long Task observer:', e);
        }
    }

    /**
     * NEW: Monitor WebGL context events
     * Context loss/restore can cause rendering issues
     */
    private startWebGLMonitoring(): void {
        const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
        if (!canvas) {
            console.log('[VisibilityMonitor] Canvas not found for WebGL monitoring');
            return;
        }

        // Try to get WebGL context
        this.webglContext = canvas.getContext('webgl2') || canvas.getContext('webgl');

        canvas.addEventListener('webglcontextlost', (e) => {
            console.log('');
            console.log('💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀');
            console.log('[VisibilityMonitor] ⚠️ WEBGL CONTEXT LOST!');
            console.log(`  Visibility: ${document.visibilityState}`);
            console.log(`  RAF avg: ${this.getAverageRAFDelta()?.toFixed(1) ?? 'N/A'}ms`);
            console.log(`  Event: ${JSON.stringify(e)}`);
            console.log('💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀💀');
            console.log('');
        });

        canvas.addEventListener('webglcontextrestored', () => {
            console.log('');
            console.log('✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨');
            console.log('[VisibilityMonitor] ✓ WEBGL CONTEXT RESTORED!');
            console.log(`  Visibility: ${document.visibilityState}`);
            console.log(`  RAF avg: ${this.getAverageRAFDelta()?.toFixed(1) ?? 'N/A'}ms`);
            console.log('✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨');
            console.log('');
        });

        console.log('[VisibilityMonitor] WebGL context monitoring started');
    }

    /**
     * NEW: Detect 104ms throttle pattern and log correlation
     */
    private checkForThrottlePattern(delta: number): void {
        const is104msPattern = delta >= 100 && delta <= 110;

        if (is104msPattern) {
            if (this.throttleStartTime === null) {
                this.throttleStartTime = performance.now();
                this.throttleFrameCount = 1;
                console.log('');
                console.log('⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️');
                console.log('[VisibilityMonitor] 🔒 104ms THROTTLE PATTERN STARTED');
                console.log(`  Visibility: ${document.visibilityState}`);
                console.log(`  Document has focus: ${document.hasFocus()}`);
                console.log(`  Long tasks in last 1s: ${this.getRecentLongTaskCount()}`);
                console.log('⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️⏱️');
                console.log('');
            } else {
                this.throttleFrameCount++;
            }
        } else if (this.throttleStartTime !== null && delta < 50) {
            // Throttle ended
            const duration = performance.now() - this.throttleStartTime;
            console.log('');
            console.log('🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓');
            console.log('[VisibilityMonitor] ✓ 104ms THROTTLE PATTERN ENDED');
            console.log(`  Duration: ${duration.toFixed(0)}ms`);
            console.log(`  Throttled frames: ${this.throttleFrameCount}`);
            console.log(`  Visibility: ${document.visibilityState}`);
            console.log(`  Document has focus: ${document.hasFocus()}`);
            console.log('🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓🔓');
            console.log('');

            this.throttleStartTime = null;
            this.throttleFrameCount = 0;
        }
    }

    private getRecentLongTaskCount(): number {
        const now = performance.now();
        // Count long tasks in last 1 second
        return this.lastLongTaskTime > 0 && (now - this.lastLongTaskTime) < 1000
            ? this.longTaskCount
            : 0;
    }

    private determinePossibleCause(now: number): string {
        const causes: string[] = [];

        // Check recent events
        if (now - this.lastBlurTime < 100) {
            causes.push('WINDOW_BLUR');
        }
        if (now - this.lastFocusTime < 100) {
            causes.push('WINDOW_FOCUS');
        }
        if (!document.hasFocus()) {
            causes.push('NO_FOCUS');
        }

        // Check for DevTools (causes visibility changes in some cases)
        const isDevToolsOpen = this.detectDevTools();
        if (isDevToolsOpen) {
            causes.push('DEVTOOLS_POSSIBLE');
        }

        // Check if canvas is offscreen (shouldn't happen but check anyway)
        const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
                causes.push('CANVAS_ZERO_SIZE');
            }
            if (rect.bottom < 0 || rect.top > window.innerHeight) {
                causes.push('CANVAS_OFFSCREEN');
            }
        }

        // Check for iframe (embedded scenarios)
        if (window.self !== window.top) {
            causes.push('IN_IFRAME');
        }

        // Check for Picture-in-Picture
        if (document.pictureInPictureElement) {
            causes.push('PIP_ACTIVE');
        }

        // Check RAF health
        const avgRAF = this.getAverageRAFDelta();
        if (avgRAF && avgRAF > 50) {
            causes.push(`RAF_SLOW_${Math.round(avgRAF)}ms`);
        }

        // NEW: Check for recent long tasks
        if (this.lastLongTaskTime > 0 && (now - this.lastLongTaskTime) < 500) {
            causes.push(`LONG_TASK_RECENT`);
        }

        // NEW: Check if in 104ms throttle pattern
        if (this.throttleStartTime !== null) {
            causes.push(`104MS_THROTTLE_ACTIVE`);
        }

        // NEW: Check for recent user interaction
        if (now - this.lastPointerDownTime < 500) {
            causes.push('RECENT_POINTER');
        }
        if (now - this.lastKeyDownTime < 500) {
            causes.push('RECENT_KEY');
        }

        // NEW: Check WebGL context state
        if (this.webglContext && this.webglContext.isContextLost()) {
            causes.push('WEBGL_CONTEXT_LOST');
        }

        return causes.length > 0 ? causes.join('+') : 'UNKNOWN';
    }

    private detectDevTools(): boolean {
        // DevTools detection heuristics (not 100% reliable)
        const threshold = 160;
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;
        return widthThreshold || heightThreshold;
    }

    private startRAFMonitoring(): void {
        const measureRAF = (timestamp: number): void => {
            if (this.lastRAFTime > 0) {
                const delta = timestamp - this.lastRAFTime;
                this.rafDeltas.push(delta);
                if (this.rafDeltas.length > 30) {
                    this.rafDeltas.shift();
                }

                // NEW: Check for 104ms throttle pattern
                this.checkForThrottlePattern(delta);

                // Log significant RAF changes (only if not in a known throttle pattern)
                if (delta > 100 && this.throttleStartTime === null) {
                    console.log(`[VisibilityMonitor] ⚠️ RAF spike: ${delta.toFixed(1)}ms, visibility=${document.visibilityState}`);
                }
            }
            this.lastRAFTime = timestamp;
            this.rafHandle = requestAnimationFrame(measureRAF);
        };

        this.rafHandle = requestAnimationFrame(measureRAF);
    }

    private getAverageRAFDelta(): number | null {
        if (this.rafDeltas.length === 0) return null;
        return this.rafDeltas.reduce((a, b) => a + b, 0) / this.rafDeltas.length;
    }

    private getActiveElementInfo(): string {
        const el = document.activeElement;
        if (!el) return 'null';
        if (el === document.body) return 'body';
        return `${el.tagName}#${el.id || 'unknown'}`;
    }

    private logEvent(event: VisibilityEvent): void {
        const stateChange = event.previousState
            ? `${event.previousState} → ${event.state}`
            : event.state;

        console.log(
            `[VisibilityMonitor] ${stateChange}`,
            `| RAF=${event.rafDelta?.toFixed(1) ?? 'N/A'}ms`,
            `| focus=${event.documentHasFocus}`,
            `| cause=${event.possibleCause}`
        );
    }

    /**
     * Get all recorded events
     */
    getEvents(): VisibilityEvent[] {
        return [...this.events];
    }

    /**
     * Print summary report
     */
    printReport(): void {
        console.log('');
        console.log('═══════════════════════════════════════════');
        console.log('     VISIBILITY MONITOR REPORT');
        console.log('═══════════════════════════════════════════');
        console.log(`Total events: ${this.events.length}`);
        console.log('');

        const hiddenEvents = this.events.filter(e => e.state === 'hidden' && e.previousState === 'visible');
        const visibleEvents = this.events.filter(e => e.state === 'visible' && e.previousState === 'hidden');

        console.log(`Hidden transitions: ${hiddenEvents.length}`);
        hiddenEvents.forEach((e, i) => {
            console.log(`  ${i + 1}. at ${e.timestamp.toFixed(0)}ms - cause: ${e.possibleCause}`);
        });

        console.log('');
        console.log(`Visible transitions: ${visibleEvents.length}`);
        visibleEvents.forEach((e, i) => {
            console.log(`  ${i + 1}. at ${e.timestamp.toFixed(0)}ms - cause: ${e.possibleCause}`);
        });

        console.log('═══════════════════════════════════════════');
        console.log('');
    }
}

// Singleton instance
export const VisibilityMonitor = new VisibilityMonitorImpl();

// Auto-install if URL parameter is present
if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.has('visibility-monitor') || params.has('blackhole-debug') || params.has('blackhole-timeline')) {
        // Delay slightly to ensure DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                VisibilityMonitor.install();
            });
        } else {
            VisibilityMonitor.install();
        }
    }
}
