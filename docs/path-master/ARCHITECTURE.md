# Arcana Path-Master — Tactical Design Architecture

> **Version**: Phase 3.0 (Initial)
> **Status**: Active Development
> **Last Updated**: 2026-01-12

---

## 0. Constitutional Principles (최우선 원칙)

### 0.1 Zero Legacy Tolerance

```
❌ READY 이후 또는 시나리오 실행 이후, Legacy 시스템과 절대 연결되지 않는다.
❌ 기존 Dijkstra / 자동 경로 / node-link 기반 로직은 실행 경로에 관여하지 않는다.
```

### 0.2 Design Philosophy

> 이 프로젝트의 중심은 **수동 노드 설계(Fate Line)**이며, 자동 경로 계산은 존재하지 않는다.

- 코치는 "계산자"가 아니라 **전술 설계자**
- Fate Line은 계산 결과가 아니라 **의사 결정의 흔적**
- 자동화 제거 → 사용자 의도 극대화

---

## 1. Legacy Migration Strategy

### 1.1 Target Files for Isolation

기존 Navigation 엔진 내 자동 경로 관련 파일들:

```
src/engines/navigation/
├── graph/                    → Legacy 후보
│   ├── NavigationGraph.ts    → Legacy/
│   └── DijkstraPathfinder.ts → Legacy/ (있는 경우)
├── pathfinding/              → Legacy 전체
└── store/
    └── PathStore.ts          → 검토 필요 (수동 경로 저장에 재활용 가능)
```

### 1.2 Migration Target Directory

```
src/engines/navigation/legacy/
├── index.ts                  # Legacy 전체 export (debug 전용)
├── NavigationGraph.ts        # 기존 그래프 구조
├── PathfindingUtils.ts       # Dijkstra 등 자동 경로 유틸
└── README.md                 # Legacy 격리 사유 문서화
```

### 1.3 Import Firewall Rules

```typescript
// ❌ PROHIBITED - Production code
import { NavigationGraph } from '../legacy/NavigationGraph';

// ✅ ALLOWED - Debug/Test only
// @ts-expect-error Legacy import for debug purposes
import { NavigationGraph } from '../legacy/NavigationGraph';
```

---

## 2. Fate-Linker System Architecture

### 2.1 Core Data Structure

```typescript
// src/engines/navigation/fate/FateNode.ts

export interface FateNode {
    /** 0-based index, always sequential */
    index: number;

    /** World position */
    position: BABYLON.Vector3;

    /** Babylon TransformNode as anchor */
    anchor: BABYLON.TransformNode;

    /** Visual marker mesh */
    marker: BABYLON.Mesh;

    /** Selection state */
    selected: boolean;

    /** Creation timestamp (for ordering verification) */
    createdAt: number;
}

export interface FateLine {
    /** Ordered array of nodes (index 0 = start, N = end) */
    nodes: FateNode[];

    /** Maximum allowed nodes (10-20) */
    maxNodes: number;

    /** Visual spline path */
    windTrail: WindTrail | null;
}
```

### 2.2 Node Management Rules

| Rule | Description |
|------|-------------|
| Manual Only | 노드는 수동으로만 추가/삭제 |
| Max Limit | 최대 10~20개 (상수로 제한) |
| Sequential Index | 항상 0 → N 순서 유지 |
| Auto Re-index | 중간 삭제 시 뒤 노드들 index 자동 감소 |
| No Mid-Insert | 중간 삽입 미구현 (미래 확장 예약) |

### 2.3 FateLinker Class Interface

```typescript
// src/engines/navigation/fate/FateLinker.ts

export class FateLinker {
    private nodes: FateNode[] = [];
    private readonly MAX_NODES = 15;
    private selectedIndex: number = -1;

    // Node Operations
    addNode(position: Vector3): FateNode | null;
    removeNode(index: number): boolean;
    selectNode(index: number): void;
    deselectAll(): void;

    // Position Operations
    moveNode(index: number, newPosition: Vector3): void;

    // Query Operations
    getNode(index: number): FateNode | null;
    getAllNodes(): ReadonlyArray<FateNode>;
    getNodeCount(): number;

    // Path Generation
    generatePath3D(): BABYLON.Path3D | null;

    // Lifecycle
    dispose(): void;
}
```

---

## 3. Gizmo Management System

### 3.1 Single Gizmo Rule

```
동시에 활성화된 Gizmo는 단 하나만 존재해야 한다.
```

### 3.2 GizmoController Interface

```typescript
// src/engines/navigation/fate/GizmoController.ts

export class GizmoController {
    private gizmo: BABYLON.PositionGizmo | null = null;
    private attachedNode: FateNode | null = null;

    /** Attach gizmo to node (auto-detach previous) */
    attachTo(node: FateNode): void;

    /** Detach current gizmo */
    detach(): void;

    /** Force dispose (for Launch entry) */
    dispose(): void;

    /** Check if currently dragging */
    isDragging(): boolean;
}
```

### 3.3 Input Priority

```
Gizmo Dragging > Camera Input

Gizmo 활성 중에는:
- ArcRotateCamera.attachControl() detach
- pointer events consume
- camera orbit/pan 비활성화
```

---

## 4. Visual Path (Wind Trail)

### 4.1 Trail Modes

| Mode | Visual Style | Use Case |
|------|--------------|----------|
| Design | 얇고 희미한 흰색 | 설계 단계 |
| Launch | 고속 Vector Sync 연출 | 비행 시작 |
| Flight | 캐릭터 추적 Trail | 비행 중 |

### 4.2 WindTrail Interface

```typescript
// src/engines/navigation/fate/WindTrail.ts

export class WindTrail {
    private tube: BABYLON.Mesh | null = null;
    private path3D: BABYLON.Path3D | null = null;

    /** Update path from FateLinker nodes */
    updateFromNodes(nodes: ReadonlyArray<FateNode>): void;

    /** Set visual mode */
    setMode(mode: 'design' | 'launch' | 'flight'): void;

    /** Get current Path3D for flight */
    getPath3D(): BABYLON.Path3D | null;

    /** Animate launch sequence (high-speed draw) */
    playLaunchAnimation(): Promise<void>;

    dispose(): void;
}
```

### 4.3 Material Separation

```typescript
// Design mode
const designMaterial = new BABYLON.StandardMaterial('windTrail_design', scene);
designMaterial.emissiveColor = new BABYLON.Color3(1, 1, 1);
designMaterial.alpha = 0.3;

// Launch mode
const launchMaterial = new BABYLON.StandardMaterial('windTrail_launch', scene);
launchMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.8, 1);
launchMaterial.alpha = 0.9;
```

---

## 5. Camera System

### 5.1 Camera Modes

| Mode | Description | Input |
|------|-------------|-------|
| Orbit (Rotate) | 중심 기준 회전 | Drag |
| Pan | 평행 이동 | Two-finger / Shift+Drag |
| Focus | 선택 노드로 스냅 | Button |

### 5.2 Camera Control Panel UI

```typescript
// Required UI Elements (Babylon GUI)
- [Rotate] Button (default active)
- [Pan] Button
- [Focus] Button (disabled when no selection)
```

### 5.3 Mode Transition

```
Tactical View (ArcRotateCamera)
    ↓ [START] button
Third-Person Chase View (FollowCamera / Custom)
```

---

## 6. Flight Controller

### 6.1 FlightController Interface

```typescript
// src/engines/navigation/flight/FlightController.ts

export class FlightController {
    private character: BABYLON.AbstractMesh | null = null;
    private path3D: BABYLON.Path3D | null = null;
    private currentT: number = 0;

    /** Initialize with character and path */
    initialize(character: BABYLON.AbstractMesh, path: BABYLON.Path3D): void;

    /** Start flight (returns when completed) */
    startFlight(): Promise<FlightResult>;

    /** Get current progress (0-1) */
    getProgress(): number;

    /** Abort flight */
    abort(): void;
}

export interface FlightResult {
    completed: boolean;
    totalTimeMs: number;
    finalPosition: BABYLON.Vector3;
}
```

### 6.2 Path3D Based Movement

```typescript
// NO Dijkstra, NO automatic path correction
// Pure Path3D interpolation only

const position = this.path3D.getPointAt(t);
const tangent = this.path3D.getTangentAt(t);

character.position = position;
character.lookAt(position.add(tangent));
```

---

## 7. LoadUnit Integration

### 7.1 CharacterLoadUnit

```typescript
// src/engines/navigation/loading/CharacterLoadUnit.ts

export class CharacterLoadUnit extends BaseLoadUnit {
    readonly id = 'nav-character';
    readonly phase = LoadingPhase.BUILDING;
    readonly requiredForReady = true;

    private character: BABYLON.AbstractMesh | null = null;
    private animationGroups: Map<string, BABYLON.AnimationGroup> = new Map();

    async doLoad(scene: BABYLON.Scene): Promise<void> {
        // 1. Load character .glb
        // 2. Register animations
        // 3. Set initial state
    }

    getCharacter(): BABYLON.AbstractMesh | null;
    getAnimation(name: string): BABYLON.AnimationGroup | null;
    getAnimationNames(): string[];
}
```

### 7.2 Loading Phase Flow

```
FETCHING → BUILDING (CharacterLoadUnit) → WARMING
         → BARRIER → VISUAL_READY → STABILIZING_100 → READY
                                                         ↓
                                                    [POST_READY]
                                                         ↓
                                              Tactical Design Phase
```

---

## 8. Debug UI Module

### 8.1 Animation Debug Panel

```typescript
// DebugUI requirements
- List all loaded animations as buttons
- Click button → Play animation immediately
- Show current animation name
- Stop button
```

### 8.2 Node Debug Panel

```typescript
// Node inspection
- Show all node positions
- Show selected node index
- Show total node count
- Highlight path validity
```

---

## 9. Launch Sequence

### 9.1 Sequence Steps

```
[START] Button Click
    ↓
1. Lock all node editing
2. Detach/Dispose all Gizmos
3. Generate final Path3D
    ↓
4. Wind Trail high-speed draw animation (Node 0 → N)
    ↓
5. Camera transition: Tactical → Chase
    ↓
6. Character spawn at Node 0
7. Fly animation start
    ↓
8. Path3D movement begin
    ↓
9. Reach Node N → Mission Complete
    ↓
10. Mission Result Event
    ↓
11. Return to Tactical Design Phase
```

### 9.2 Launch Lock State

```typescript
interface LaunchState {
    isLaunching: boolean;
    editingLocked: boolean;
    gizmoDisposed: boolean;
    cameraMode: 'tactical' | 'chase';
}
```

---

## 10. Forbidden Patterns (위반 시 실패)

| Pattern | Reason |
|---------|--------|
| ❌ Legacy import after READY | 자동 경로 오염 |
| ❌ Dijkstra/A* in flight path | 수동 설계 원칙 위반 |
| ❌ Multiple Gizmo attach | 입력 충돌 |
| ❌ Auto path correction | 사용자 의도 왜곡 |
| ❌ activeMeshes count validation | 간접 지표 사용 |
| ❌ Warning-only passage | 조용한 실패 |

---

## 11. File Structure (Target)

```
src/engines/navigation/
├── legacy/                        # Isolated legacy code
│   ├── index.ts
│   ├── NavigationGraph.ts
│   └── README.md
│
├── fate/                          # Fate-Linker system
│   ├── index.ts
│   ├── FateLinker.ts
│   ├── FateNode.ts
│   ├── GizmoController.ts
│   └── WindTrail.ts
│
├── flight/                        # Flight execution
│   ├── index.ts
│   └── FlightController.ts
│
├── loading/                       # LoadUnit integration
│   ├── index.ts
│   └── CharacterLoadUnit.ts
│
├── ui/                            # Navigation UI
│   ├── CameraControlPanel.ts
│   └── DebugPanel.ts
│
└── scene/
    └── NavigationScene.ts         # Updated for Phase 3
```

---

## 12. Implementation Checklist

- [ ] Legacy Migration
  - [ ] Create `legacy/` directory
  - [ ] Move Dijkstra/pathfinding code
  - [ ] Add import firewall comments
  - [ ] Document legacy code purpose

- [ ] Fate-Linker Core
  - [ ] FateNode interface
  - [ ] FateLinker class
  - [ ] Node add/remove/select
  - [ ] Index re-calculation on delete

- [ ] Gizmo System
  - [ ] GizmoController class
  - [ ] Single gizmo enforcement
  - [ ] Camera input blocking during drag

- [ ] Wind Trail
  - [ ] WindTrail class
  - [ ] Design mode material
  - [ ] Launch mode material
  - [ ] Path3D generation

- [ ] Camera System
  - [ ] Mode switching UI
  - [ ] Focus to selected node
  - [ ] Tactical → Chase transition

- [ ] Flight Controller
  - [ ] Path3D based movement
  - [ ] Character animation sync
  - [ ] Mission completion detection

- [ ] LoadUnit Integration
  - [ ] CharacterLoadUnit
  - [ ] Animation registry
  - [ ] Debug UI for animations

---

*This document is part of Phase 3: Arcana Path-Master. See CLAUDE.md for project constitution.*
