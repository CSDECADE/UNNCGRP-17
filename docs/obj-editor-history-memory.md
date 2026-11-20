# Stage 5C — Undo/Redo History Memory Investigation and Optimization

Baseline: `c33a0ec`, branch `feature/obj-editor`. Optimized results use the uncommitted Stage 5C working tree. Production changes are limited to `src/core/mesh-edit.ts` and `src/BackgroundSettings.tsx`. History remains 60 entries, with the existing project representation, transactions, topology cache, renderer and persistence format.

## A. Memory allocation analysis

### Necessary storage versus redundant duplication

The history stores immutable project references, not serialized project copies or Three.js objects. Sixty completed operations retain up to **61 project states**: 60 past entries plus the present. Undo/Redo moves those references between arrays. A new edit clears the redo branch; the capacity cap evicts old snapshots. Opening/replacing a project and deleting a model are also undoable, so neither immediately releases historical geometry.

A mesh translation creates a resource wrapper and a new vertex-reference array; only selected logical vertex objects/positions are new. Unchanged vertices, triangle arrays, UV arrays and unaffected submeshes are shared. The reference large 100-edge group changes 200 vertices. Across 61 retained states the census finds 61 vertex arrays and 34,801 vertex objects, versus 22,801 initial vertices; triangle and UV arrays each remain a single shared array.

Before Stage 5C, any partially translated triangle with authored normals caused its **entire submesh normal array** to be copied before writing transported normals. The large fixture has 135,000 corners / 405,000 normal numbers. Sixty new complete arrays account for approximately **185.4 MiB** of additional backing storage; vertex arrays/objects account for most of the remaining approximately 11.9 MiB. This explains the approximately 197 MiB observation without inferring an unbounded leak.

The important distinction is whether the values actually change. In the planar-grid X-translation control, the normal transport produces identical numbers, yet the baseline still retains 61 complete normal arrays. Its first-edit value comparison reports zero changed normal components. In the Z-deformation control, 7,125 components change in the first edit. Distinct snapshots in that second case need distinct values under the current flat-array representation.

A controlled Node heap snapshot confirms the retaining path:

`global.__objHistorySnapshot → past/present/future → objResources → meshes → normals → elements`

The before snapshot contains 61 normal arrays / 61 distinct backing stores with **197,848,488 bytes** of backing-store self-size. After optimization, the same normal-preserving workload contains one array/store with **3,447,528 bytes**. This is a census of backing stores reachable along an explicit investigation root, not a whole-process dominator or exclusive-retained-size calculation.

### Confirmed additional renderer retainer

The development Electron investigation also found geometry retained **after the live history no longer contained it**. A renderer heap snapshot found 42 old resource objects reachable through:

`Blink form/document state → checkbox React Fiber → BackgroundSettings effect cleanup → component closure e → editor closure history → past → objResources`

The long-lived unmount cleanup captured the component's shared lexical scope. Other functions in that scope use the editor context, so the cleanup indirectly kept an old context/history alive. This is an unnecessary extension of lifetime, separate from legitimate storage in the current 60-entry history. It was reproduced in development Electron; production incidence was not separately quantified.

The Stage 5B cache is not the owner of this path. Its WeakMap values contain derived IDs/indices and do not point back to resources or geometry arrays. Controlled-GC probes collect discarded redo resources, evicted snapshots and deleted/replaced resource families once actual owners release them. Shared instances legitimately retain their original resource until the last instance and relevant history states are gone.

Runtime render geometry is also separate: project snapshots contain logical arrays, while `ImportedMesh` owns and disposes the current expanded BufferGeometry. Repeated Undo/Redo keeps renderer geometry counts stable. Shared GLTF caches intentionally survive; zero GPU objects is not a valid disposal threshold.

## B. Implementation summary

1. **Copy normals only on an actual value change.** In `translateMeshElement()`, the normal calculation and validation still run. Each transported corner vector is compared component-by-component with `Object.is`; the existing full immutable copy happens immediately before the first changed write. Unchanged normal arrays and mesh objects can therefore remain shared. No epsilon, quantization, normal removal or altered shading policy is introduced. Signed-zero behavior and every calculated value match the baseline.
2. **Isolate the background cleanup's ownership.** A small module-level factory creates the unmount callback with only the stable request-counter ref. It increments the same counter at the same lifecycle point, preserving pending-image cancellation behavior, without retaining a component editor/history context.

All geometry limits, degenerate-triangle checks, authored-normal validation, per-corner seams, copy-on-write isolation, commit-time serialization and capacity checks remain. The topology cache still inherits only across known topology-preserving edits. No delta history, compression, custom allocator, new dependency, state system, file-format change or new modeling feature was added. The editor state module and numerical inspector are unchanged in the final implementation.

## C. Memory benchmarks

### Method

Machine: Apple M3 Pro, arm64 macOS, 18 GiB RAM; Node v25.9.0 and Electron 45.2.1. The existing planar-grid fixtures are used at 1,250, 9,800 and 45,000 triangles. Workloads include 100 selected vertices, edges or faces, explicit-normal and no-normal controls, both X and Z motion, and shared-instance COW cases. Test geometry is exported and actually re-imported through production OBJ code before measurement.

The Node memory runner uses **21 fresh worker processes per version**, including three independent runs of each key large-edge direction. It records `heapUsed`, RSS, external memory and ArrayBuffer memory separately, with three GC/yield cycles between points. There is no forced GC inside timed operations. Initial CPU-side BufferGeometry construction/release is measured separately from history. Node creates no GPU renderer.

Both versions execute: 60 commits; three cycles of 30 Undo + 30 Redo; Undo 20 then a new branch; 75 additional geometry commits to exercise eviction; undoable deletion and replacement; then 61 empty-project commits to release every geometry snapshot. WeakRefs assert that discarded redo resources, evicted old resources and finally all removed resources/normals are collectible. A returned edge collection is deliberately held alive to test that derived data does not pin source geometry.

Key large-edge retained-history increments were stable to approximately 0.01 MiB at the displayed precision across three fresh runs. This small synthetic-run range does not establish a universal memory bound. Heap snapshots occur **after** the history60 measurement; later phase absolute heap values can also reflect snapshot/GC compaction and code trimming. RSS and GPU memory must not be inferred from V8 heap deltas.

### Retained heap added by 60 edits

All figures are **MiB above the topology-warmed imported state**, not total application memory.

| Workload | Before | After | Reduction |
| --- | --- | --- | --- |
| 1,250 triangles, edge group, normal-preserving X | 6.94 | 1.75 | 74.7% |
| 9,800 triangles, edge group, normal-preserving X | 44.15 | 3.77 | 91.5% |
| 45,000 triangles, vertex group, normal-preserving X | 196.68 | 11.25 | 94.3% |
| 45,000 triangles, edge group, normal-preserving X | 197.29 | 11.89 | 94.0% |
| 45,000 triangles, face group, normal-preserving X | 197.92 | 12.52 | 93.7% |
| 45,000 triangles, shared-instance edge group, X | 197.29 | 11.89 | 94.0% |
| 45,000 triangles, edge group, normal-changing Z | 197.29 | 197.29 | -0.0% |
| 45,000 triangles, edge group, no authored normals | 11.86 | 11.87 | -0.1% |

The large normal-preserving edge case drops **197.29 → 11.89 MiB (94.0%)**, while retaining the same 60 operations. The normal-changing case remains approximately **197.29 MiB**. This is a workload-dependent optimization, not a claim that all mesh histories now use 12 MiB. Moving a curved/non-coplanar mesh along X can still change normals and require a copy.

### Absolute Node heap through the lifecycle

Large edge group with explicit normals, X motion; `heapUsed` after controlled GC:

| Phase | Before, MiB | After, MiB |
| --- | --- | --- |
| empty | 9.77 | 9.77 |
| imported | 20.51 | 20.51 |
| CPUBufferGeometryAllocated | 20.56 | 20.56 |
| CPUBufferGeometryReleased | 20.55 | 20.56 |
| topologyWarmed | 39.73 | 39.73 |
| history60 | 237.01 | 51.62 |
| undoRedo3Cycles | 233.31 | 47.91 |
| newBranchAfterUndo20 | 170.92 | 44.23 |
| capacityEviction75 | 233.00 | 47.90 |
| modelDeletedUndoable | 229.73 | 47.71 |
| projectReplacedUndoable | 226.45 | 47.52 |
| allGeometryHistoryEvicted | 18.62 | 18.72 |

Undo/Redo does not add another set of normal arrays. Discarding a 20-entry redo branch releases all 20 tracked resource objects in every Node case. Capacity remains 60; old resource keys are collectible after eviction. Deletion/replacement preserves snapshots needed for Undo. After those snapshots are evicted, source resources and normal arrays are collected in all cases, including COW. The final heap deliberately still includes the held derived edge collection and loaded code; it should not return to the empty-process number.

### Renderer heap, GPU counts and process memory

The committed baseline was extracted with `git archive c33a0ec`; only the measurement harness was copied into that isolated tree. Fresh servers/module graphs and isolated profiles are used for both versions, avoiding hot-reload copies of source-module caches. Actual OBJ file-input import and real rendering are measured. Each phase settles for 750 ms and requests CDP GC three times. Commands pause for 30 ms, with a 750 ms autosave-settling pause every 20 commands. Latency samples exclude these pauses. `Runtime.getHeapUsage`, Electron process-memory metrics and renderer object counts are separate measurements.

The final fresh-server comparison reports renderer V8 `usedSize` in MiB:

| Phase | X before | X after | Z before | Z after |
| --- | --- | --- | --- | --- |
| defaultScene | 16.18 | 16.20 | 16.38 | 16.20 |
| OBJImportedAndRendered | 23.44 | 23.46 | 23.50 | 23.44 |
| topologyWarmed | 33.25 | 33.27 | 33.28 | 33.24 |
| history60 | 227.61 | 40.63 | 227.66 | 227.67 |
| undoRedo3Cycles | 228.82 | 41.85 | 228.83 | 228.82 |
| newBranchAfterUndo20 | 168.24 | 39.95 | 168.25 | 168.24 |
| modelDeletedUndoable | 167.23 | 38.92 | 167.25 | 167.24 |
| geometryHistoryEvicted | 166.08 | 24.58 | 166.07 | 24.48 |

The pre-fix background cleanup retains old geometry after history eviction in **both** movement directions. After the factory change, the tracked source resource and normal array are collected in both directions, even with an edge collection still held. The Z control is important: its legitimate normal-changing history remains large while active, but no longer stays pinned by the obsolete component context afterward.

Renderer counts are stable during 60 edits and the Undo/Redo cycles: **158 geometries / 14 textures**. Deleting the imported model returns them to **153 / 13**; replacing the scene and evicting its history reaches **131 / 3**, including intentionally cached assets. Active scene attribute-buffer bytes go from about **6.19 MB** while editing to **0.019 MB** in the empty scene. These are object/count observations, not GPU byte accounting.


GPU byte usage is unavailable here. Active scene attribute-buffer byte counts and geometry/texture counts describe live objects, not exclusive physical GPU memory or completed GPU work. Process working-set/private-memory values are recorded in the raw JSON; allocator reservation means they need not fall in lockstep with reclaimed JS objects. CPU BufferGeometry allocation in Node primarily increases ArrayBuffer/external memory, not the ordinary heap column above.

## D. CPU and interaction performance

The unchanged Stage 5B benchmark was run before and after with three warm-ups and 15 samples for all original fixtures/selections, including validation/serialization, import and restore. Raw results are retained. Some high-percentile samples varied substantially: for example the large normal-changing edge preview p95 was 6.70 → 21.34 ms in that run. With 15 samples, nearest-rank p95 is the maximum; this does not establish a reliable tail bound or its cause.

A supplemental **60-pair alternating-order CPU comparison**, with ten warm-ups, loads the committed baseline implementation and current implementation in the same process using the existing TypeScript dependency. Both have independent warmed topology caches; unchanged helper modules and inputs are shared. Full draft data is asserted deeply equal before timing, including signed zero. No GC is forced inside samples. This is a component comparison, not UI throughput or FPS.

| Edge group / absolute preview | Before p50 / p95, ms | After p50 / p95, ms |
| --- | --- | --- |
| 1250 triangles, no authored normals | 0.285 / 0.543 | 0.267 / 0.580 |
| 9800 triangles, no authored normals | 0.888 / 1.220 | 0.905 / 1.258 |
| 45000 triangles, no authored normals | 3.700 / 4.248 | 3.743 / 4.315 |
| 45000 triangles + normals, X | 5.421 / 6.023 | 4.918 / 5.429 |
| 45000 triangles + normals, Z | 5.807 / 7.492 | 5.919 / 8.353 |

Normal-preserving preview improves by about 9% in this paired test. Normal-changing preview has a small measured cost: 5.807 → 5.919 ms median (+1.9%), with p95 7.492 → 8.353 ms. This tradeoff is reported rather than claiming no regression. The no-normal large case remains about 3.7 ms, and cached edge resolution remains around 0.07 ms; the former ~46 ms topology-processing behavior has not returned.

The primary large attributed edge commit + full validation/serialization median was 38.20 → 37.73 ms; import was 94.31 → 94.46 ms and restoration 38.62 → 39.74 ms. Those modules are unchanged; individual variations should not be marketed as encoder/import optimizations. Undo/Redo reference moves remain sub-millisecond in the Node runner. Native command dispatch and two-RAF latencies are recorded separately in the renderer results; repaint/GPU completion and production FPS were not measured.

## E. Correctness verification

- TypeScript check, **119 automated tests**, and production build passed on the final implementation.
- Six focused unit tests cover unchanged-normal sharing for Vertex/Edge/Face groups; owned changed arrays, hard-corner data, frozen snapshots and unrelated submeshes; 65 mixed commits, exact history traversal, capacity, branch invalidation, no-op/cancel/failure behavior; COW followed by deformation and model deletion; project and actual OBJ round-trip consistency.
- The original topology-cache tests remain, including fresh same-ID topology, restored resources, identity-preserving previews and independent coincident faces. All 42 Node memory-worker runs enforce their retirement assertions.
- All seven original Electron suites passed: OBJ import, Object Mode, built-in transforms, vertex editing, edge/face editing, multi-selection and export. They retain capacity rollback, numerical/gizmo synchronization, camera/cancellation, hidden/locked/playback restrictions, save/reload, actual file round-trip and UAV regression assertions.
- Both final paced renderer-memory probes passed all lifecycle/collection assertions and the existing no-console-error assertion. The baseline probes fail the resource-retirement assertion, exposing the old retainer; those failures are retained as before/after evidence.
- Existing assertions and functional-suite 90-second timeouts are unchanged; only the new memory mode has the existing benchmark-style five-minute budget.

An initial uninterrupted-command development stress probe emitted React maximum-update-depth warnings both before and after the memory changes. These failed probes are **not** counted as clean passes. The paced memory workload above avoids conflating retained memory with an unsettled autosave/render stream, and uses the same pacing on both versions. The unpaced warning remains a separate stability observation; speculative inspector/autosave changes were reverted. No general React/state redesign was attempted.

Manual follow-up: packaged production heap/GPU soaks; rapid uninterrupted command stress; native background-image upload cancellation while closing the panel; native file-picker/overwrite failures; dense clipped/coplanar assets and extreme transforms; authored seam shading and displayed production-frame latency.

## F. Remaining limitations and next recommendation

The normal-changing control still stores approximately 185 MiB of new full-array normal backing data plus vertex history. Under flat `number[]` attributes and exact immutable snapshots, array-level sharing cannot share the unchanged *parts* of different arrays. Those distinct versions are legitimate storage, not evidence that the cache pins unreachable geometry.

Further reductions in that control would need a separately reviewed design: for example immutable normal blocks with lossless flattening at rendering/serialization boundaries, or carefully scoped attribute patches/checkpoints in history. Both change runtime representation/ownership and require explicit design review for COW, branching, eviction, load/replace, capacity failure and serialization. Do not use Float32 quantization, truncate Undo depth or silently reconstruct normals. No such representation change is implemented here.

The cleanup-factory fix removes the observed obsolete-history path without rewriting the editor context. Other long-lived callbacks or OS/browser-specific lifetimes are not proven free of retainers by this targeted investigation. Current runtime geometry still rebuilds full affected buffers, and Stage 5B topology caches retain their intentional derived data while resources are live. These remain measured tradeoffs and future investigation topics, not automatic new work.

### Reproduction and artifacts

```sh
node --experimental-strip-types scripts/benchmark-history-memory.mjs \
  --out /private/tmp/history-memory.json --snapshot /private/tmp/history.heapsnapshot
node scripts/summarize-history-heap.mjs /private/tmp/history.heapsnapshot \
  /private/tmp/history-heap-summary.json
node --expose-gc --experimental-strip-types scripts/benchmark-obj-editor.mjs \
  --memory --out /private/tmp/history-cpu.json
node --experimental-strip-types scripts/benchmark-history-preview-paired.mjs \
  --baseline c33a0ec --out /private/tmp/history-paired.json
# In another terminal, start a fresh server:
# npm run dev:web -- --port 5179
# Repeat with OBJ_HISTORY_AXIS=2 for the tilt control.
OBJ_HISTORY_AXIS=0 env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js \
  scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5179/ memory
# Optional renderer heap snapshot; keep binary snapshots outside the repository.
OBJ_HISTORY_HEAP=/private/tmp/renderer.heapsnapshot OBJ_HISTORY_AXIS=0 \
  env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js \
  scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5179/ memory
node scripts/trace-history-retainer.mjs /private/tmp/renderer.heapsnapshot RESOURCE_ID
```

- Node memory: [before](audits/obj-editor-5c-before-memory.json), [after](audits/obj-editor-5c-after-memory.json).
- Normal backing-store census: [before](audits/obj-editor-5c-before-node-heap.json), [after](audits/obj-editor-5c-after-node-heap.json).
- Renderer retaining path: [diagnostic](audits/obj-editor-5c-renderer-retainer.json); the route is from the original development probe, independent of the final fresh-server comparison.
- CPU: [before](audits/obj-editor-5c-before-cpu.json), [after](audits/obj-editor-5c-after-cpu.json), [60-pair guard](audits/obj-editor-5c-paired-cpu.json).
- Renderer: [before X](audits/obj-editor-5c-before-ui-plane.json), [after X](audits/obj-editor-5c-after-ui-plane.json), [before Z](audits/obj-editor-5c-before-ui-tilt.json), [after Z](audits/obj-editor-5c-after-ui-tilt.json).
- [Final command/interaction results](audits/obj-editor-5c-verification.json). Binary heap snapshots stay in temporary storage; the reproducible tools and compact analysis are included.

Work remains uncommitted on `feature/obj-editor`; `main` is unchanged at `1320078a65c021b589fc27a3f5bd096d62eab334`. No commit, push or subsequent stage was performed.
