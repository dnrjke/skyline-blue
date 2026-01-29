import * as BABYLON from '@babylonjs/core';

export interface RenderingTestResult {
    name: string;
    passed: boolean;
    details: string;
}

/**
 * RenderingPipelineTest - Diagnostic tests for rendering issues
 *
 * Tests various rendering conditions that could cause meshes to be invisible:
 * - Material compilation
 * - World matrix updates
 * - Camera frustum
 * - Layer masks
 * - Rendering groups
 * - Glow layer effects
 */
export class RenderingPipelineTest {
    private scene: BABYLON.Scene;

    constructor(scene: BABYLON.Scene) {
        this.scene = scene;
    }

    /**
     * Run all diagnostic tests on a specific mesh
     */
    testMesh(mesh: BABYLON.AbstractMesh): RenderingTestResult[] {
        const results: RenderingTestResult[] = [];

        // 1. Basic visibility
        results.push(this.testVisibility(mesh));

        // 2. Material
        results.push(this.testMaterial(mesh));

        // 3. World Matrix
        results.push(this.testWorldMatrix(mesh));

        // 4. Bounding Box
        results.push(this.testBoundingBox(mesh));

        // 5. Camera Frustum
        results.push(this.testFrustum(mesh));

        // 6. Layer Mask
        results.push(this.testLayerMask(mesh));

        // 7. Rendering Group
        results.push(this.testRenderingGroup(mesh));

        // 8. Parent chain
        results.push(this.testParentChain(mesh));

        return results;
    }

    /**
     * Run tests on all meshes matching a name pattern
     */
    testMeshesByPattern(pattern: string): Map<string, RenderingTestResult[]> {
        const results = new Map<string, RenderingTestResult[]>();
        const regex = new RegExp(pattern, 'i');

        for (const mesh of this.scene.meshes) {
            if (regex.test(mesh.name)) {
                results.set(mesh.name, this.testMesh(mesh));
            }
        }

        return results;
    }

    /**
     * Create a test mesh to verify basic rendering works
     */
    createTestPrimitive(position: BABYLON.Vector3, color: BABYLON.Color3): BABYLON.Mesh {
        const testMesh = BABYLON.MeshBuilder.CreateSphere(
            'DebugTestSphere_' + Date.now(),
            { diameter: 1 },
            this.scene
        );
        testMesh.position = position;

        const mat = new BABYLON.StandardMaterial('DebugTestMat_' + Date.now(), this.scene);
        mat.emissiveColor = color;
        mat.disableLighting = true;
        testMesh.material = mat;

        testMesh.computeWorldMatrix(true);

        console.log(`[RenderingTest] Created test sphere at (${position.x}, ${position.y}, ${position.z})`);
        return testMesh;
    }

    /**
     * Create multiple test primitives at path segment positions
     */
    createTestPrimitivesAtSegments(): BABYLON.Mesh[] {
        const meshes: BABYLON.Mesh[] = [];
        const segments = this.scene.meshes.filter(m => m.name.startsWith('ArcanaActivePathSeg'));

        for (const seg of segments) {
            const testMesh = this.createTestPrimitive(
                seg.position.clone().add(new BABYLON.Vector3(0, 1, 0)), // 1 unit above
                new BABYLON.Color3(1, 1, 0) // Yellow
            );
            meshes.push(testMesh);
        }

        console.log(`[RenderingTest] Created ${meshes.length} test primitives above path segments`);
        return meshes;
    }

    /**
     * Log comprehensive scene state
     */
    logSceneState(): void {
        console.log('=== SCENE STATE DIAGNOSTIC ===');
        console.log(`Active Camera: ${this.scene.activeCamera?.name ?? 'NONE'}`);
        console.log(`Total Meshes: ${this.scene.meshes.length}`);
        console.log(`Total Materials: ${this.scene.materials.length}`);
        console.log(`Rendering Groups Used: ${this.getUsedRenderingGroups().join(', ')}`);

        // Active meshes check (what Babylon actually renders this frame)
        const activeMeshes = this.scene.getActiveMeshes();
        console.log(`Active Meshes Count: ${activeMeshes.length}`);

        // Path segments
        const pathSegs = this.scene.meshes.filter(m => m.name.startsWith('ArcanaActivePathSeg'));
        const activePathSegs = pathSegs.filter(m => activeMeshes.data.includes(m));
        console.log(`Path Segments: ${pathSegs.length} total, ${activePathSegs.length} in active meshes`);

        // Debug markers
        const debugMarkers = this.scene.meshes.filter(m => m.name.startsWith('DebugPathPoint'));
        const activeDebugMarkers = debugMarkers.filter(m => activeMeshes.data.includes(m));
        console.log(`Debug Markers: ${debugMarkers.length} total, ${activeDebugMarkers.length} in active meshes`);

        // Glow layers
        const glowLayers = this.scene.effectLayers?.filter(l => l.getClassName() === 'GlowLayer') ?? [];
        console.log(`Glow Layers: ${glowLayers.length}`);

        // Camera details
        if (this.scene.activeCamera) {
            const cam = this.scene.activeCamera;
            console.log(`Camera Position: (${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)})`);
            console.log(`Camera Layer Mask: ${cam.layerMask}`);
        }

        // Check for frozen active meshes
        console.log(`Scene freezeActiveMeshes: ${(this.scene as any)._activeMeshesFrozen ?? false}`);

        console.log('=== END DIAGNOSTIC ===');
    }

    /**
     * Force refresh all path segment world matrices
     */
    forceRefreshPathSegments(): number {
        let count = 0;
        for (const mesh of this.scene.meshes) {
            if (mesh.name.startsWith('ArcanaActivePathSeg') || mesh.name.startsWith('DebugPathPoint')) {
                mesh.computeWorldMatrix(true);
                if (mesh instanceof BABYLON.Mesh) {
                    mesh.refreshBoundingInfo();
                }
                count++;
            }
        }
        console.log(`[RenderingTest] Refreshed ${count} meshes`);
        return count;
    }

    // === Individual Tests ===

    private testVisibility(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        const isEnabled = mesh.isEnabled();
        const isVisible = mesh.isVisible;
        const visibility = mesh.visibility;
        const passed = isEnabled && isVisible && visibility > 0;

        return {
            name: 'Visibility',
            passed,
            details: `enabled=${isEnabled}, isVisible=${isVisible}, visibility=${visibility}`,
        };
    }

    private testMaterial(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        const mat = mesh.material;
        if (!mat) {
            return { name: 'Material', passed: false, details: 'No material assigned' };
        }

        const stdMat = mat as BABYLON.StandardMaterial;
        const alpha = stdMat.alpha ?? 1;
        const hasEmissive = stdMat.emissiveColor && !stdMat.emissiveColor.equals(BABYLON.Color3.Black());

        return {
            name: 'Material',
            passed: alpha > 0 && !!mat,
            details: `alpha=${alpha}, hasEmissive=${hasEmissive}, disableLighting=${stdMat.disableLighting ?? 'N/A'}`,
        };
    }

    private testWorldMatrix(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        const wm = mesh.getWorldMatrix();
        const translation = wm.getTranslation();
        const isIdentity = wm.isIdentity();
        const hasNaN = isNaN(translation.x) || isNaN(translation.y) || isNaN(translation.z);

        return {
            name: 'WorldMatrix',
            passed: !hasNaN,
            details: `translation=(${translation.x.toFixed(2)}, ${translation.y.toFixed(2)}, ${translation.z.toFixed(2)}), isIdentity=${isIdentity}, hasNaN=${hasNaN}`,
        };
    }

    private testBoundingBox(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        const bb = mesh.getBoundingInfo().boundingBox;
        const center = bb.centerWorld;
        const size = bb.maximumWorld.subtract(bb.minimumWorld);
        const hasVolume = size.x > 0 && size.y > 0 && size.z > 0;

        return {
            name: 'BoundingBox',
            passed: hasVolume,
            details: `center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)}), size=(${size.x.toFixed(2)}, ${size.y.toFixed(2)}, ${size.z.toFixed(2)})`,
        };
    }

    private testFrustum(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        const cam = this.scene.activeCamera;
        if (!cam) {
            return { name: 'Frustum', passed: false, details: 'No active camera' };
        }

        // Check if mesh is in camera frustum
        const planes = BABYLON.Frustum.GetPlanes(cam.getTransformationMatrix());
        const isInFrustum = mesh.isInFrustum(planes);

        // Check alwaysSelectAsActiveMesh
        const alwaysActive = mesh.alwaysSelectAsActiveMesh;

        return {
            name: 'Frustum',
            passed: isInFrustum || alwaysActive,
            details: `inFrustum=${isInFrustum}, alwaysActive=${alwaysActive}`,
        };
    }

    private testLayerMask(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        const meshMask = mesh.layerMask;
        const camMask = this.scene.activeCamera?.layerMask ?? 0x0FFFFFFF;
        const matches = (meshMask & camMask) !== 0;

        return {
            name: 'LayerMask',
            passed: matches,
            details: `meshMask=0x${meshMask.toString(16)}, camMask=0x${camMask.toString(16)}, matches=${matches}`,
        };
    }

    private testRenderingGroup(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        const groupId = mesh.renderingGroupId;
        const usedGroups = this.getUsedRenderingGroups();

        return {
            name: 'RenderingGroup',
            passed: true, // Just informational
            details: `groupId=${groupId}, usedGroups=[${usedGroups.join(', ')}]`,
        };
    }

    private testParentChain(mesh: BABYLON.AbstractMesh): RenderingTestResult {
        let parent = mesh.parent;
        const chain: string[] = [];
        let allEnabled = true;

        while (parent) {
            chain.push(parent.name);
            if (parent instanceof BABYLON.AbstractMesh && !parent.isEnabled()) {
                allEnabled = false;
            }
            parent = parent.parent;
        }

        return {
            name: 'ParentChain',
            passed: allEnabled,
            details: chain.length > 0 ? `chain=[${chain.join(' -> ')}], allEnabled=${allEnabled}` : 'No parent',
        };
    }

    private getUsedRenderingGroups(): number[] {
        const groups = new Set<number>();
        for (const mesh of this.scene.meshes) {
            groups.add(mesh.renderingGroupId);
        }
        return Array.from(groups).sort((a, b) => a - b);
    }
}
