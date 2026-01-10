/**
 * Debug Tools for Skyline Blue
 *
 * This directory contains debugging utilities that can be safely removed
 * in production builds. All exports are designed to be tree-shaken if unused.
 *
 * Usage:
 *   import { NavigationDebugger } from '../debug';
 *   const debugger = new NavigationDebugger(scene, guiTexture);
 *   debugger.show();
 *
 * To remove debug tools:
 *   1. Delete the entire src/debug/ directory
 *   2. Remove any imports from this module
 */

export { NavigationDebugger } from './NavigationDebugger';
export { DebugCameraManager, type DebugCameraView } from './DebugCameraManager';
export { RenderingPipelineTest, type RenderingTestResult } from './RenderingPipelineTest';
