/**
 * RAF Lab Launcher
 *
 * Entry point for launching RAF Lab in isolation.
 *
 * USAGE:
 *   Add ?raf-lab to URL to launch RAF Lab instead of main game
 *   Example: http://localhost:3000/?raf-lab
 *
 * This provides a completely isolated environment for debugging
 * RAF throttle issues without the complexity of the main game flow.
 */

import { RAFLab, startRAFLab } from './index';

/**
 * Check if RAF Lab should be launched
 */
export function shouldLaunchRAFLab(): boolean {
    const params = new URLSearchParams(window.location.search);
    return params.has('raf-lab') || params.has('raflab');
}

/**
 * Launch RAF Lab
 */
export async function launchRAFLab(canvas: HTMLCanvasElement): Promise<RAFLab> {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║         RAF LAB - Debug Mode             ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  This is an isolated debugging tool.     ║');
    console.log('║  Normal game flow is bypassed.           ║');
    console.log('║                                          ║');
    console.log('║  To return to normal game:               ║');
    console.log('║  Remove ?raf-lab from URL                ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Add visual indicator that we're in RAF Lab mode
    document.title = '🔬 RAF Lab - Skyline Blue';

    // Create and start RAF Lab
    const lab = await startRAFLab(canvas);

    // Expose to console for debugging
    (window as unknown as { rafLab: RAFLab }).rafLab = lab;
    console.log('[RAFLab] Lab instance available as window.rafLab');
    console.log('[RAFLab] Commands:');
    console.log('  window.rafLab.runAllPhases() - Run all test phases');
    console.log('  window.rafLab.reset() - Reset lab');
    console.log('  window.rafLab.dispose() - Dispose lab');

    return lab;
}

/**
 * Integration helper - Check and launch if needed
 *
 * Call this at the start of your Main.ts before normal initialization.
 * If RAF Lab is requested, this will take over and return true.
 * Otherwise, returns false and you should continue normal initialization.
 */
export async function checkAndLaunchRAFLab(canvas: HTMLCanvasElement): Promise<boolean> {
    if (!shouldLaunchRAFLab()) {
        return false;
    }

    await launchRAFLab(canvas);
    return true;
}
