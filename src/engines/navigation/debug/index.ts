/**
 * Navigation Debug Tools
 *
 * These are debugging utilities for diagnosing Navigation loading and rendering issues.
 * DO NOT use in production - these are for development and investigation only.
 */

export { RenderDesyncProbe, markVisualReadyTimestamp } from './RenderDesyncProbe';
export type { RenderDesyncTimings, CanvasEngineState } from './RenderDesyncProbe';

export { BlackHoleLogger } from './BlackHoleLogger';
export type { BlackHoleEntry, BlackHoleConfig, BlackHoleCategory, LogLevel } from './BlackHoleLogger';
