import * as BABYLON from '@babylonjs/core';

/**
 * MeshFactory - Babylon 8.x 호환 메시 생성 유틸리티
 *
 * 문제:
 * - Babylon 8.x에서 동적 메시가 Active Mesh 평가에서 탈락
 * - SubMesh 미생성, World Matrix 미갱신 등 다양한 원인
 *
 * 해결:
 * - 표준화된 메시 생성 함수 제공
 * - 필수 속성 자동 설정 (World Matrix, Bounding, SubMesh 등)
 *
 * @see docs/babylon_rendering_rules.md
 */
export interface MeshFactoryOptions {
    /** 메시 이름 */
    name: string;
    /** 렌더링 그룹 ID (기본값: 0) */
    renderingGroupId?: number;
    /** 레이어 마스크 (기본값: 0x0FFFFFFF) */
    layerMask?: number;
    /** 픽커블 여부 (기본값: false) */
    pickable?: boolean;
    /** Frustum Culling 비활성화 (기본값: true) */
    disableFrustumCheck?: boolean;
    /** Always Active Mesh 설정 (기본값: true) */
    alwaysActive?: boolean;
}

export class MeshFactory {
    /**
     * 메시에 Babylon 8.x 필수 속성 적용
     */
    static applyRequiredProperties(
        mesh: BABYLON.Mesh,
        options?: Partial<MeshFactoryOptions>
    ): void {
        mesh.layerMask = options?.layerMask ?? 0x0FFFFFFF;
        mesh.renderingGroupId = options?.renderingGroupId ?? 0;
        mesh.isPickable = options?.pickable ?? false;

        if (options?.alwaysActive !== false) {
            mesh.alwaysSelectAsActiveMesh = true;
        }

        if (options?.disableFrustumCheck !== false) {
            (mesh as any).doNotCheckFrustum = true;
        }

        // World Matrix 강제 갱신
        mesh.unfreezeWorldMatrix();
        mesh.computeWorldMatrix(true);
        mesh.refreshBoundingInfo(true);

        // SubMesh 강제 생성 (Babylon 8.x)
        if (!mesh.subMeshes || mesh.subMeshes.length === 0) {
            (mesh as any)._createGlobalSubMesh?.(true);
        }
    }

    /**
     * Cylinder 메시 생성 (경로 세그먼트용)
     */
    static createCylinder(
        scene: BABYLON.Scene,
        options: MeshFactoryOptions & {
            height: number;
            diameter: number;
            tessellation?: number;
        }
    ): BABYLON.Mesh {
        const mesh = BABYLON.MeshBuilder.CreateCylinder(
            options.name,
            {
                height: options.height,
                diameter: options.diameter,
                tessellation: options.tessellation ?? 16,
            },
            scene
        );

        MeshFactory.applyRequiredProperties(mesh, options);
        return mesh;
    }

    /**
     * Sphere 메시 생성 (마커/이미터용)
     */
    static createSphere(
        scene: BABYLON.Scene,
        options: MeshFactoryOptions & {
            diameter: number;
            segments?: number;
        }
    ): BABYLON.Mesh {
        const mesh = BABYLON.MeshBuilder.CreateSphere(
            options.name,
            {
                diameter: options.diameter,
                segments: options.segments ?? 16,
            },
            scene
        );

        MeshFactory.applyRequiredProperties(mesh, options);
        return mesh;
    }

    /**
     * Box 메시 생성
     */
    static createBox(
        scene: BABYLON.Scene,
        options: MeshFactoryOptions & {
            width?: number;
            height?: number;
            depth?: number;
            size?: number;
        }
    ): BABYLON.Mesh {
        const mesh = BABYLON.MeshBuilder.CreateBox(
            options.name,
            {
                width: options.width,
                height: options.height,
                depth: options.depth,
                size: options.size,
            },
            scene
        );

        MeshFactory.applyRequiredProperties(mesh, options);
        return mesh;
    }

    /**
     * 메시 디버그 정보 로그
     */
    static logMeshState(mesh: BABYLON.Mesh): void {
        const bb = mesh.getBoundingInfo().boundingBox;
        console.log(`[MeshFactory] ${mesh.name}:`, {
            isEnabled: mesh.isEnabled(),
            isVisible: mesh.isVisible,
            renderingGroupId: mesh.renderingGroupId,
            layerMask: '0x' + mesh.layerMask.toString(16),
            subMeshCount: mesh.subMeshes?.length ?? 0,
            position: `(${mesh.position.x.toFixed(2)}, ${mesh.position.y.toFixed(2)}, ${mesh.position.z.toFixed(2)})`,
            boundingMin: `(${bb.minimumWorld.x.toFixed(2)}, ${bb.minimumWorld.y.toFixed(2)}, ${bb.minimumWorld.z.toFixed(2)})`,
            boundingMax: `(${bb.maximumWorld.x.toFixed(2)}, ${bb.maximumWorld.y.toFixed(2)}, ${bb.maximumWorld.z.toFixed(2)})`,
        });
    }
}
