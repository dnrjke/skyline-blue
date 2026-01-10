import * as BABYLON from '@babylonjs/core';
import * as GUI from '@babylonjs/gui';
import { DebugCameraManager } from './DebugCameraManager';
import { RenderingPipelineTest } from './RenderingPipelineTest';

/**
 * NavigationDebugger - Debug overlay for Navigation scene
 *
 * Features:
 * - Camera view switching (perspective, ortho views)
 * - Camera control toggle
 * - Rendering pipeline tests
 * - Mesh visibility diagnostics
 * - Scene state logging
 *
 * Usage:
 *   const debugger = new NavigationDebugger(scene, guiTexture);
 *   debugger.show();
 *
 * Designed to be easily removable (entire src/debug/ directory can be deleted).
 */
export class NavigationDebugger {
    private scene: BABYLON.Scene;
    private guiTexture: GUI.AdvancedDynamicTexture;

    private root: GUI.Rectangle;
    private panel!: GUI.StackPanel;  // Assigned in createUI() called from constructor
    private cameraManager: DebugCameraManager;
    private renderTest: RenderingPipelineTest;

    private isVisible: boolean = false;
    private testMeshes: BABYLON.Mesh[] = [];

    constructor(scene: BABYLON.Scene, guiTexture: GUI.AdvancedDynamicTexture) {
        this.scene = scene;
        this.guiTexture = guiTexture;
        this.cameraManager = new DebugCameraManager(scene);
        this.renderTest = new RenderingPipelineTest(scene);

        this.root = this.createUI();
        this.guiTexture.addControl(this.root);
        this.hide();
    }

    show(): void {
        this.root.isVisible = true;
        this.isVisible = true;
    }

    hide(): void {
        this.root.isVisible = false;
        this.isVisible = false;
    }

    toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    dispose(): void {
        this.cleanupTestMeshes();
        this.cameraManager.dispose();
        this.root.dispose();
    }

    private createUI(): GUI.Rectangle {
        const root = new GUI.Rectangle('DebuggerRoot');
        root.widthInPixels = 220;
        root.adaptHeightToChildren = true;
        root.cornerRadius = 8;
        root.thickness = 2;
        root.color = '#00ff00';
        root.background = 'rgba(0, 20, 0, 0.85)';
        root.horizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        root.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        root.leftInPixels = 10;
        root.topInPixels = -10;
        root.paddingBottomInPixels = 10;
        root.isPointerBlocker = true;

        this.panel = new GUI.StackPanel('DebuggerPanel');
        this.panel.isVertical = true;
        this.panel.paddingTopInPixels = 10;
        this.panel.paddingLeftInPixels = 10;
        this.panel.paddingRightInPixels = 10;
        root.addControl(this.panel);

        // Title
        this.addLabel('DEBUG PANEL', '#00ff00', 16, true);
        this.addSpacer(8);

        // Camera section
        this.addLabel('--- CAMERA ---', '#888888', 12);
        this.addButton('Toggle Cam Control', () => {
            const enabled = !this.cameraManager.getCameraControlEnabled();
            this.cameraManager.setCameraControlEnabled(enabled);
        });
        this.addButton('Cycle View', () => {
            this.cameraManager.cycleNext();
        });
        this.addButton('View: Perspective', () => this.cameraManager.switchTo('perspective'));
        this.addButton('View: Top (Ortho)', () => this.cameraManager.switchTo('top'));
        this.addButton('View: Front (Ortho)', () => this.cameraManager.switchTo('front'));
        this.addButton('View: Right (Ortho)', () => this.cameraManager.switchTo('right'));
        this.addButton('View: Free', () => this.cameraManager.switchTo('free'));
        this.addButton('Restore Original', () => this.cameraManager.restore());

        this.addSpacer(12);

        // Rendering tests section
        this.addLabel('--- RENDERING ---', '#888888', 12);
        this.addButton('Log Scene State', () => this.renderTest.logSceneState());
        this.addButton('Test Path Segments', () => this.runPathSegmentTests());
        this.addButton('Refresh WorldMatrix', () => this.renderTest.forceRefreshPathSegments());
        this.addButton('Create Test Spheres', () => {
            this.cleanupTestMeshes();
            this.testMeshes = this.renderTest.createTestPrimitivesAtSegments();
        });
        this.addButton('Clear Test Meshes', () => this.cleanupTestMeshes());

        this.addSpacer(12);

        // Visibility tests
        this.addLabel('--- VISIBILITY ---', '#888888', 12);
        this.addButton('Show All Path Segs', () => this.setPathSegmentsVisible(true));
        this.addButton('Hide All Path Segs', () => this.setPathSegmentsVisible(false));
        this.addButton('Toggle Glow Layer', () => this.toggleGlowLayer());

        this.addSpacer(12);

        // Close button
        this.addButton('[ CLOSE ]', () => this.hide(), '#ff6666');

        return root;
    }

    private addLabel(text: string, color: string = '#ffffff', fontSize: number = 14, bold: boolean = false): void {
        const label = new GUI.TextBlock();
        label.text = text;
        label.color = color;
        label.fontSizeInPixels = fontSize;
        label.fontWeight = bold ? 'bold' : 'normal';
        label.heightInPixels = fontSize + 8;
        label.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.panel.addControl(label);
    }

    private addButton(text: string, onClick: () => void, color: string = '#00ff00'): void {
        const btn = GUI.Button.CreateSimpleButton('btn_' + text.replace(/\s/g, '_'), text);
        btn.widthInPixels = 190;
        btn.heightInPixels = 30;
        btn.color = color;
        btn.background = 'rgba(0, 40, 0, 0.8)';
        btn.cornerRadius = 4;
        btn.thickness = 1;
        btn.fontSizeInPixels = 12;
        btn.onPointerClickObservable.add(onClick);
        this.panel.addControl(btn);
    }

    private addSpacer(height: number): void {
        const spacer = new GUI.Rectangle();
        spacer.heightInPixels = height;
        spacer.thickness = 0;
        spacer.background = 'transparent';
        this.panel.addControl(spacer);
    }

    private runPathSegmentTests(): void {
        const results = this.renderTest.testMeshesByPattern('ArcanaActivePathSeg');
        console.log('=== PATH SEGMENT TEST RESULTS ===');
        for (const [name, tests] of results) {
            console.log(`\n${name}:`);
            for (const test of tests) {
                const status = test.passed ? '✓' : '✗';
                console.log(`  ${status} ${test.name}: ${test.details}`);
            }
        }
        console.log('=== END TESTS ===');
    }

    private setPathSegmentsVisible(visible: boolean): void {
        let count = 0;
        for (const mesh of this.scene.meshes) {
            if (mesh.name.startsWith('ArcanaActivePathSeg') || mesh.name.startsWith('DebugPathPoint')) {
                mesh.isVisible = visible;
                mesh.setEnabled(visible);
                count++;
            }
        }
        console.log(`[Debug] Set ${count} meshes visible=${visible}`);
    }

    private toggleGlowLayer(): void {
        const glowLayers = this.scene.effectLayers?.filter(l => l.getClassName() === 'GlowLayer') ?? [];
        for (const glow of glowLayers) {
            const gl = glow as BABYLON.GlowLayer;
            gl.isEnabled = !gl.isEnabled;
            console.log(`[Debug] GlowLayer ${gl.name}: isEnabled=${gl.isEnabled}`);
        }
    }

    private cleanupTestMeshes(): void {
        for (const mesh of this.testMeshes) {
            mesh.material?.dispose();
            mesh.dispose();
        }
        this.testMeshes = [];
        console.log('[Debug] Cleaned up test meshes');
    }
}
