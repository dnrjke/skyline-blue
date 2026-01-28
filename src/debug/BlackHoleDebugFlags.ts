/**
 * BlackHoleDebugFlags
 *
 * URL parameter-based debug flags to selectively disable components
 * during loading to identify the RAF throttle trigger.
 *
 * Usage:
 *   ?blackhole-debug                    - Enable all debug logging
 *   ?blackhole-no-overlay               - Disable ArcanaLoadingOverlay
 *   ?blackhole-no-pulse                 - Disable GPUPulseSystem
 *   ?blackhole-no-quality               - Disable RenderQualityManager resize
 *   ?blackhole-no-gui                   - Disable complex GUI layers
 *   ?blackhole-no-warmup                - Disable material warmup
 *   ?blackhole-no-barrier               - Disable ENGINE_AWAKENED barrier
 *   ?blackhole-no-visualready           - Disable VISUAL_READY check
 *   ?blackhole-minimal                  - Disable all optional components
 *
 * Example: http://localhost:3000/?blackhole-no-overlay&blackhole-no-pulse
 */

export interface BlackHoleDebugConfig {
    /** Enable detailed debug logging */
    debug: boolean;

    /** Disable ArcanaLoadingOverlay */
    noOverlay: boolean;

    /** Disable GPUPulseSystem (no pulse host) */
    noPulse: boolean;

    /** Disable RenderQualityManager resize operations */
    noQuality: boolean;

    /** Disable complex GUI layers during loading */
    noGUI: boolean;

    /** Disable material warmup phase */
    noWarmup: boolean;

    /** Disable ENGINE_AWAKENED barrier (pass immediately) */
    noBarrier: boolean;

    /** Disable VISUAL_READY check (pass immediately) */
    noVisualReady: boolean;

    /** Minimal mode - disable all optional components */
    minimal: boolean;
}

let cachedConfig: BlackHoleDebugConfig | null = null;

/**
 * Parse URL parameters and return debug config
 */
export function getBlackHoleDebugConfig(): BlackHoleDebugConfig {
    if (cachedConfig) {
        return cachedConfig;
    }

    const params = new URLSearchParams(window.location.search);

    const minimal = params.has('blackhole-minimal');

    cachedConfig = {
        debug: params.has('blackhole-debug'),
        noOverlay: minimal || params.has('blackhole-no-overlay'),
        noPulse: minimal || params.has('blackhole-no-pulse'),
        noQuality: minimal || params.has('blackhole-no-quality'),
        noGUI: minimal || params.has('blackhole-no-gui'),
        noWarmup: minimal || params.has('blackhole-no-warmup'),
        noBarrier: minimal || params.has('blackhole-no-barrier'),
        noVisualReady: minimal || params.has('blackhole-no-visualready'),
        minimal,
    };

    // Log config if any flag is set
    const anyFlagSet = Object.values(cachedConfig).some(v => v);
    if (anyFlagSet) {
        console.log('');
        console.log('╔══════════════════════════════════════════╗');
        console.log('║     BLACK HOLE DEBUG MODE ACTIVE         ║');
        console.log('╠══════════════════════════════════════════╣');
        console.log('║  Disabled components:                    ║');
        if (cachedConfig.noOverlay) console.log('║    ✗ ArcanaLoadingOverlay                ║');
        if (cachedConfig.noPulse) console.log('║    ✗ GPUPulseSystem                      ║');
        if (cachedConfig.noQuality) console.log('║    ✗ RenderQualityManager                ║');
        if (cachedConfig.noGUI) console.log('║    ✗ Complex GUI layers                  ║');
        if (cachedConfig.noWarmup) console.log('║    ✗ Material warmup                     ║');
        if (cachedConfig.noBarrier) console.log('║    ✗ ENGINE_AWAKENED barrier             ║');
        if (cachedConfig.noVisualReady) console.log('║    ✗ VISUAL_READY check                  ║');
        console.log('╚══════════════════════════════════════════╝');
        console.log('');
    }

    return cachedConfig;
}

/**
 * Check if a specific component should be disabled
 */
export function isComponentDisabled(component: keyof Omit<BlackHoleDebugConfig, 'debug' | 'minimal'>): boolean {
    const config = getBlackHoleDebugConfig();
    return config[component];
}

/**
 * Log debug message if debug mode is enabled
 */
export function blackHoleDebugLog(message: string): void {
    const config = getBlackHoleDebugConfig();
    if (config.debug) {
        console.log(`[BlackHole] ${message}`);
    }
}

/**
 * Reset cached config (for testing)
 */
export function resetBlackHoleDebugConfig(): void {
    cachedConfig = null;
}
