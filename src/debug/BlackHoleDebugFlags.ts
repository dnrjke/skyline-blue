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
 *   ?blackhole-simple-gui               - Disable GUIManager adaptive scaling (rootScaler, resize, executeWhenReady)
 *   ?blackhole-minimal-layers           - GUIManager creates only 1 layer instead of 5
 *   ?blackhole-no-adt                   - Skip GUIManager entirely (no ADT, diagnostic only)
 *   ?blackhole-timeline                 - Enable RAF timeline measurement in Main.ts
 *   ?blackhole-minimal                  - Disable: pulse, barrier, visualready
 *   ?blackhole-nuclear                  - Disable ALL optional components (wide net)
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

    /** Disable GUIManager adaptive scaling (rootScaler, resize, executeWhenReady) */
    simpleGui: boolean;

    /** GUIManager creates only 1 layer instead of 5 */
    minimalLayers: boolean;

    /** Skip GUIManager entirely (no ADT, diagnostic only - game won't work) */
    noADT: boolean;

    /** Enable RAF timeline measurement in Main.ts */
    timeline: boolean;

    /** Minimal mode - disable: pulse, barrier, visualready */
    minimal: boolean;

    /** Nuclear mode - disable ALL optional components */
    nuclear: boolean;
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
    const nuclear = params.has('blackhole-nuclear');

    cachedConfig = {
        debug: params.has('blackhole-debug'),
        // Nuclear disables everything; minimal disables pulse/barrier/visualready only
        noOverlay: nuclear || params.has('blackhole-no-overlay'),
        noPulse: nuclear || minimal || params.has('blackhole-no-pulse'),
        noQuality: nuclear || params.has('blackhole-no-quality'),
        noGUI: nuclear || params.has('blackhole-no-gui'),
        noWarmup: nuclear || params.has('blackhole-no-warmup'),
        noBarrier: nuclear || minimal || params.has('blackhole-no-barrier'),
        noVisualReady: nuclear || minimal || params.has('blackhole-no-visualready'),
        simpleGui: nuclear || params.has('blackhole-simple-gui'),
        minimalLayers: nuclear || params.has('blackhole-minimal-layers'),
        noADT: params.has('blackhole-no-adt'), // NOT included in nuclear (breaks game)
        timeline: params.has('blackhole-timeline'),
        minimal,
        nuclear,
    };

    // Log config if any flag is set
    const anyFlagSet = Object.values(cachedConfig).some(v => v);
    if (anyFlagSet) {
        console.log('');
        console.log('╔══════════════════════════════════════════╗');
        if (cachedConfig.nuclear) {
            console.log('║  ☢️  BLACK HOLE NUCLEAR MODE ACTIVE  ☢️   ║');
        } else {
            console.log('║     BLACK HOLE DEBUG MODE ACTIVE         ║');
        }
        console.log('╠══════════════════════════════════════════╣');
        console.log('║  Disabled components:                    ║');
        if (cachedConfig.noOverlay) console.log('║    ✗ ArcanaLoadingOverlay                ║');
        if (cachedConfig.noPulse) console.log('║    ✗ GPUPulseSystem                      ║');
        if (cachedConfig.noQuality) console.log('║    ✗ RenderQualityManager                ║');
        if (cachedConfig.noGUI) console.log('║    ✗ Complex GUI layers                  ║');
        if (cachedConfig.noWarmup) console.log('║    ✗ Material warmup                     ║');
        if (cachedConfig.noBarrier) console.log('║    ✗ ENGINE_AWAKENED barrier             ║');
        if (cachedConfig.noVisualReady) console.log('║    ✗ VISUAL_READY check                  ║');
        if (cachedConfig.simpleGui) console.log('║    ✗ GUIManager adaptive scaling         ║');
        if (cachedConfig.minimalLayers) console.log('║    ✗ GUI layers (1 instead of 5)         ║');
        if (cachedConfig.noADT) console.log('║    ✗ AdvancedDynamicTexture (NO GUI!)    ║');
        if (cachedConfig.timeline) console.log('║    ✓ RAF timeline measurement            ║');
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
