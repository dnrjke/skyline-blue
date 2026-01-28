/**
 * AssetLoadStrategy - Streaming Loader Interface (Option D Fallback)
 *
 * [Phase 2.7 - Future Preparation]
 *
 * This interface is NOT used in the main execution path.
 * It's a structural preparation for future "large asset loading" scenarios.
 *
 * CURRENT STATE:
 * - All LoadUnits use loadSmallAsset() path
 * - loadLargeAsset() remains as empty implementation
 *
 * FUTURE USE CASE:
 * - If we need to load massive assets (100MB+ terrain, mega-meshes)
 * - Chunked loading with progress reporting
 * - Cooperative yielding during streaming
 *
 * @see docs/phase-2.7-raf-protection.md
 */

import * as BABYLON from '@babylonjs/core';

/**
 * Chunk of data from streaming load
 */
export interface StreamingChunk {
    /** Chunk index (0-based) */
    index: number;
    /** Total expected chunks */
    total: number;
    /** Bytes loaded so far */
    bytesLoaded: number;
    /** Total bytes expected */
    bytesTotal: number;
    /** Progress (0-1) */
    progress: number;
}

/**
 * Asset load strategy interface
 *
 * Two modes:
 * 1. loadSmallAsset: Standard Promise-based loading (current use)
 * 2. loadLargeAsset: AsyncGenerator-based streaming (future use)
 */
export interface AssetLoadStrategy {
    /**
     * Load a small asset (< 10MB) using standard approach
     *
     * This is the DEFAULT path used by all current LoadUnits.
     * Returns a Promise that resolves when loading is complete.
     *
     * @param url - Asset URL
     * @param scene - Target Babylon scene
     * @returns Promise resolving to loaded mesh container
     */
    loadSmallAsset(
        url: string,
        scene: BABYLON.Scene
    ): Promise<BABYLON.AssetContainer>;

    /**
     * Load a large asset (> 10MB) using streaming approach
     *
     * NOT CURRENTLY USED. Placeholder for future expansion.
     * Uses AsyncGenerator to yield progress chunks during loading.
     *
     * @param url - Asset URL
     * @param scene - Target Babylon scene
     * @yields StreamingChunk progress updates
     * @returns Final loaded mesh container
     */
    loadLargeAsset(
        url: string,
        scene: BABYLON.Scene
    ): AsyncGenerator<StreamingChunk, BABYLON.AssetContainer, void>;
}

/**
 * Default implementation using standard Babylon SceneLoader
 *
 * - loadSmallAsset: Uses SceneLoader.LoadAssetContainerAsync
 * - loadLargeAsset: Not implemented (throws)
 */
export class StandardAssetLoadStrategy implements AssetLoadStrategy {
    /**
     * Load small asset using standard Babylon approach
     */
    async loadSmallAsset(
        url: string,
        scene: BABYLON.Scene
    ): Promise<BABYLON.AssetContainer> {
        // Extract root URL and filename
        const lastSlash = url.lastIndexOf('/');
        const rootUrl = lastSlash >= 0 ? url.substring(0, lastSlash + 1) : '';
        const filename = lastSlash >= 0 ? url.substring(lastSlash + 1) : url;

        return BABYLON.SceneLoader.LoadAssetContainerAsync(
            rootUrl,
            filename,
            scene
        );
    }

    /**
     * Large asset loading - NOT IMPLEMENTED
     *
     * This is a placeholder for future streaming implementation.
     * Currently throws an error to indicate it's not ready.
     */
    async *loadLargeAsset(
        _url: string,
        _scene: BABYLON.Scene
    ): AsyncGenerator<StreamingChunk, BABYLON.AssetContainer, void> {
        throw new Error(
            '[AssetLoadStrategy] loadLargeAsset is not implemented. ' +
            'This is a placeholder for future streaming loader support. ' +
            'Use loadSmallAsset for current assets.'
        );
    }
}

/**
 * Get the default asset load strategy
 *
 * Currently returns StandardAssetLoadStrategy.
 * In the future, this could return a different strategy based on configuration.
 */
export function getDefaultAssetLoadStrategy(): AssetLoadStrategy {
    return new StandardAssetLoadStrategy();
}

/**
 * Asset size threshold for choosing strategy (10MB)
 */
export const LARGE_ASSET_THRESHOLD_BYTES = 10 * 1024 * 1024;

/**
 * Check if an asset URL should use large asset loading
 *
 * NOTE: Not currently used. Placeholder for future logic.
 *
 * @param url - Asset URL to check
 * @param sizeHint - Optional size hint in bytes
 * @returns true if asset should use streaming loader
 */
export function shouldUseLargeAssetStrategy(
    _url: string,
    sizeHint?: number
): boolean {
    // Currently always returns false - all assets use small asset path
    if (sizeHint !== undefined && sizeHint > LARGE_ASSET_THRESHOLD_BYTES) {
        // In the future, this would return true for large assets
        // For now, we always use small asset path
        console.warn(
            '[AssetLoadStrategy] Large asset detected but streaming not implemented. ' +
            'Falling back to standard loading.'
        );
        return false;
    }
    return false;
}
