# Babylon.js Rendering Rules (Skyline Blue)

> Babylon 8.x 환경에서 동적 메시가 올바르게 렌더링되기 위한 필수 규칙

---

## 1. Rendering Pipeline 우회 (UtilityLayerRenderer)

### 1.1 문제 상황
Babylon 8.x에서 GlowLayer, DefaultRenderingPipeline 등이 **Active Mesh Evaluation을 독점**하여,
동적으로 생성된 메시가 렌더링에서 제외될 수 있다.

**증상:**
- `scene.meshes`에는 존재
- `scene.getActiveMeshes()`에는 미포함 (0개)
- 화면에 표시되지 않음
- 에러 로그 없음 (조용히 탈락)

### 1.2 해결책: UtilityLayerScene 사용

```typescript
// Effect/Overlay/UI용 메시는 UtilityLayerScene에 생성
const utilLayer = BABYLON.UtilityLayerRenderer.DefaultUtilityLayer;
const utilityScene = utilLayer.utilityLayerScene;

// 메시 생성 시 utilityScene 사용
const mesh = BABYLON.MeshBuilder.CreateCylinder('path', opts, utilityScene);
const material = new BABYLON.StandardMaterial('mat', utilityScene);
```

### 1.3 적용 대상
- ActivePathEffect (경로 시각화)
- Debug Markers
- Particle Effects (선택적)
- 기타 오버레이 효과

---

## 2. Material 워밍업 (Precompilation)

### 2.1 문제 상황
Babylon 8.x에서 `material.isReady() === false`인 메시는 **렌더링에서 즉시 탈락**한다.
이전 버전과 달리 다음 프레임까지 대기하지 않는다.

**증상:**
- 첫 프레임에 메시가 안 보임
- 콘솔에 "material NOT ready! Force compiling..." 경고

### 2.2 해결책: 더미 메시로 사전 컴파일

```typescript
private warmupMaterials(): void {
    const pathMat = new BABYLON.StandardMaterial('__Warmup__', this.utilityScene);
    pathMat.disableLighting = true;
    pathMat.emissiveColor = new BABYLON.Color3(1.0, 0.5, 0.0);

    const dummy = BABYLON.MeshBuilder.CreateSphere('__WarmupMesh__', { diameter: 0.01 }, this.utilityScene);
    dummy.isVisible = false;
    dummy.material = pathMat;

    pathMat.forceCompilationAsync(dummy).then(() => {
        dummy.dispose();
        pathMat.dispose();
        console.log('Materials precompiled');
    });
}
```

### 2.3 타이밍
- **생성자**에서 워밍업 시작
- 비동기 컴파일 (`forceCompilationAsync`)
- 실제 메시 생성 전에 완료되도록 설계

---

## 3. 메시 생성 타이밍 (Observer 선택)

### 3.1 Observer 우선순위

| Observable | 타이밍 | 용도 |
|------------|--------|------|
| `onBeforeActiveMeshesEvaluationObservable` | Active Mesh 평가 직전 | **동적 메시 생성 (권장)** |
| `onBeforeRenderObservable` | Active Mesh 평가 이후 | 상태 업데이트만 |
| `onAfterRenderObservable` | 렌더 완료 후 | 진단/로깅용 |

### 3.2 Dirty Flag 패턴

```typescript
private pendingPath: PathData | null = null;

// 외부 API: pending 상태로 저장만
setPath(points: Vector3[]): void {
    this.pendingPath = { points };
}

// Observer에서 실제 생성
this.scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    if (this.pendingPath) {
        this.buildMeshes(this.pendingPath);
        this.pendingPath = null;
    }
});
```

---

## 4. 메시 속성 체크리스트

동적 메시 생성 시 반드시 확인:

```typescript
mesh.isPickable = false;                    // 픽킹 불필요시
mesh.layerMask = 0x0FFFFFFF;               // 모든 레이어 허용
mesh.renderingGroupId = 0;                  // 기본 그룹 (또는 명시적 지정)
mesh.alwaysSelectAsActiveMesh = true;       // Active Mesh 강제 포함 (선택)
(mesh as any).doNotCheckFrustum = true;     // Frustum Culling 비활성화 (선택)

mesh.computeWorldMatrix(true);              // World Matrix 강제 갱신
mesh.refreshBoundingInfo(true);             // Bounding Info 갱신
```

---

## 5. SubMesh 강제 생성 (Babylon 8.x)

### 5.1 문제 상황
일부 MeshBuilder 함수가 SubMesh를 자동 생성하지 않아 렌더링에서 탈락.

### 5.2 해결책

```typescript
if (!mesh.subMeshes || mesh.subMeshes.length === 0) {
    (mesh as any)._createGlobalSubMesh?.(true);
}
```

---

## 6. 디버깅 체크리스트

문제 발생 시 확인 순서:

1. **UtilityScene 사용 여부**: Effect 메시가 main scene에 있으면 Pipeline에 의해 제외될 수 있음
2. **Material Ready**: `material.isReady(mesh)` 확인
3. **SubMesh 존재**: `mesh.subMeshes?.length > 0` 확인
4. **Observer 타이밍**: `onBeforeActiveMeshesEvaluationObservable` 사용 확인
5. **Scene Components**: `scene._sceneComponents.map(c => c.name)` 출력하여 Pipeline 확인

---

## 7. 구조 요약

```
Main Scene (Rendering Pipeline 관리)
├─ World / Characters / Environment
├─ GlowLayer / PostProcess
└─ Active Meshes: 고정 세트

UtilityLayerScene (독립 렌더)
├─ ActivePathEffect
│   ├─ Path Segments
│   ├─ Debug Markers
│   └─ Particles
└─ 기타 Effect/Overlay
```

---

## 변경 이력

- 2026-01-10: 초기 작성 (Babylon 8.x 대응)
