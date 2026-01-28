/**
 * Transition Lab Launcher
 *
 * Entry point for launching Transition Lab in isolation.
 *
 * USAGE:
 *   Add ?transition-lab to URL to launch Transition Lab instead of main game
 *   Example: http://localhost:3000/?transition-lab
 *
 * This provides a completely isolated environment for debugging
 * Host → Navigation scene transition issues, specifically:
 * - Chrome RAF throttling (104ms lock)
 * - Firefox incomplete transition (stuck in Host state)
 * - Frame drop + Black Hole combined issues
 */

import { TransitionLab, startTransitionLab } from './index';

/**
 * Check if Transition Lab should be launched
 */
export function shouldLaunchTransitionLab(): boolean {
    const params = new URLSearchParams(window.location.search);
    return params.has('transition-lab') || params.has('transitionlab');
}

/**
 * Launch Transition Lab
 */
export async function launchTransitionLab(canvas: HTMLCanvasElement): Promise<TransitionLab> {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║    TRANSITION LAB - Debug Mode           ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  Tests Host → Navigation transition      ║');
    console.log('║  in isolation to diagnose:               ║');
    console.log('║  - Chrome RAF throttling (104ms lock)    ║');
    console.log('║  - Firefox stuck transition              ║');
    console.log('║  - Frame drops + Black Hole issues       ║');
    console.log('║                                          ║');
    console.log('║  To return to normal game:               ║');
    console.log('║  Remove ?transition-lab from URL         ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Add visual indicator
    document.title = '🔄 Transition Lab - Skyline Blue';

    // Create and start Transition Lab
    const lab = await startTransitionLab(canvas);

    // Expose to console for debugging
    (window as unknown as { transitionLab: TransitionLab }).transitionLab = lab;
    console.log('[TransitionLab] Lab instance available as window.transitionLab');
    console.log('[TransitionLab] Commands:');
    console.log('  window.transitionLab.startTransition() - Start transition test');
    console.log('  window.transitionLab.reset() - Reset lab');
    console.log('  window.transitionLab.dispose() - Dispose lab');

    return lab;
}

/**
 * Integration helper - Check and launch if needed
 *
 * Call this at the start of your Main.ts before normal initialization.
 * If Transition Lab is requested, this will take over and return true.
 * Otherwise, returns false and you should continue normal initialization.
 */
export async function checkAndLaunchTransitionLab(canvas: HTMLCanvasElement): Promise<boolean> {
    if (!shouldLaunchTransitionLab()) {
        return false;
    }

    await launchTransitionLab(canvas);
    return true;
}
