/**
 * Navigation Loading Module
 *
 * 2-Stage Loading Architecture:
 * - NavigationDataLoader: 순수 데이터 fetch (FETCHING phase)
 * - NavigationScene: 전체 로딩 흐름 조율 (BUILDING, WARMING, BARRIER)
 *
 * NavigationSceneLoader는 편의를 위해 유지되나,
 * 복잡한 조율이 필요한 경우 DataLoader + primitives 직접 사용 권장.
 */

// Lightweight data fetcher
export { NavigationDataLoader } from './NavigationDataLoader';
export type { StageKey, NavigationDataResult, DataLoaderCallbacks } from './NavigationDataLoader';

// Full scene loader (for simpler use cases)
export { NavigationSceneLoader } from './NavigationSceneLoader';
export type { NavigationStageKey, NavigationLoadedData, NavigationLoaderConfig } from './NavigationSceneLoader';
