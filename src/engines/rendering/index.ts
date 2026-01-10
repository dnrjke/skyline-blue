/**
 * Rendering Engine - Babylon 8.x 렌더링 유틸리티
 *
 * Babylon 8.x에서 동적 메시가 올바르게 렌더링되기 위한 핵심 유틸리티:
 * - UtilitySceneManager: Rendering Pipeline 우회
 * - MaterialWarmup: Material 사전 컴파일
 * - MeshFactory: 표준화된 메시 생성
 *
 * @see docs/babylon_rendering_rules.md
 */

export { UtilitySceneManager } from './UtilitySceneManager';
export { MaterialWarmup, type MaterialWarmupOptions } from './MaterialWarmup';
export { MeshFactory, type MeshFactoryOptions } from './MeshFactory';
