/**
 * Progress module - Phase-based progress calculation and state emission.
 */

export {
    ArcanaProgressModel,
    PROGRESS_BOUNDS,
    COMPRESSION_SETTINGS,
    type ProgressSnapshot,
    type ProgressEvent,
    type ProgressEventType,
    type ProgressEventListener,
    type UnitWeightConfig,
} from './ArcanaProgressModel';

export {
    LoadingStateEmitter,
    getGlobalLoadingEmitter,
    disposeGlobalLoadingEmitter,
    type LoadingState,
    type LoadingEvents,
} from './LoadingStateEmitter';
