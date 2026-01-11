/**
 * LinkNetworkUnit - 링크 네트워크 시각화 LoadUnit.
 *
 * BUILDING phase에서:
 * - NavigationLinkNetwork.build() 호출
 * - 노드 간 연결선 메시 생성
 */

import * as BABYLON from '@babylonjs/core';
import { BaseLoadUnit, LoadUnitProgress } from '../../../../core/loading/unit/LoadUnit';
import { LoadingPhase } from '../../../../core/loading';
import { NavigationLinkNetwork } from '../../visualization/NavigationLinkNetwork';

export interface LinkNetworkUnitConfig {
    /** NavigationLinkNetwork 인스턴스 */
    linkNetwork: NavigationLinkNetwork;
}

export class LinkNetworkUnit extends BaseLoadUnit {
    readonly id = 'LinkNetwork';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = true;

    private config: LinkNetworkUnitConfig;

    constructor(config: LinkNetworkUnitConfig) {
        super();
        this.config = config;
    }

    protected async doLoad(
        _scene: BABYLON.Scene,
        onProgress?: (progress: LoadUnitProgress) => void
    ): Promise<void> {
        onProgress?.({ progress: 0, message: 'Building link network...' });

        this.config.linkNetwork.build();

        onProgress?.({ progress: 1, message: 'Link network ready' });
    }

    // LinkNetwork 검증은 GraphVisualizer와 함께 처리되므로 별도 검증 불필요
    validate(_scene: BABYLON.Scene): boolean {
        return true;
    }
}
