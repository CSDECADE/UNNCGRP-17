# Stage 5B — Mesh Topology Cache and Query Optimization

Baseline: `a314178` on `feature/obj-editor`. The optimized measurements use the uncommitted Stage 5B working tree on the same branch. The source change is confined to `src/core/mesh-edit.ts`; no project schema, dependency, UI, renderer, transaction or history redesign is included.

## A. Implementation summary

`meshEdges()` now reuses a lazy canonical edge collection and its edge lookup map. `resolveElement()` reuses the vertex-ID index and active-submesh referenced-vertex set, instead of rebuilding them on every call. Edge/face resolution no longer constructs an unused whole-mesh referenced set. `meshVertexIndices()` reuses the active-submesh index collection, which also benefits vertex picking and overlays.

Logical identity, canonical edge order, independent coincident vertices, triangle ordinals and unique-vertex group weighting are preserved. Selection membership, pivots, world/local conversion, picking projection/occlusion and coincidence signatures continue to use current geometry. The numerical-delta path still resolves twice; those lookups are now cheap, so no transaction-interface extension was warranted.

`translateMeshElement()` privately inherits the derived topology for its geometry-only result, including copy-on-write results. All coordinate limits, affected-triangle degeneracy checks, normal validation/transport, bounds checks, commit-time validation, serialization and history behavior remain intact. Bounds, normals and affected render buffers still update as before.

No adjacency structure was added: after topology reuse, the reference core preview is approximately 3.7 ms without authored normals and 5.5 ms with them. Additional adjacency/buffer machinery would add memory and invalidation complexity without being necessary for this bounded optimization. No BVH, worker or global cache service was introduced.

## B. Before/after benchmarks

### Method and conditions

Same Apple M3 Pro / arm64 macOS / 18 GiB machine, Node v25.9.0 and Electron 45.2.1. Existing Stage 5A fixtures and benchmark code were used unchanged for the primary CPU/UI comparisons. Measurements were sequential, with no concurrent benchmark or build. The machine was not CPU-pinned; these are comparative measurements, not controlled real-time guarantees.

CPU: three warm-ups and 15 timed samples per operation, reporting **p50 / p95 ms**. With 15 samples, nearest-rank p95 equals the observed maximum; individual tail samples remain noisy. One and 100 selected vertices/edges/faces, 1,250/9,800/45,000 triangles, explicit UV/normal and four-submesh fixtures all completed. Source project sizes and selected elements match Stage 5A. The large edge group has 100 edges, 200 unique vertices and 989 affected triangles.

The original benchmark's `edgeDerivation` label now measures a **warm edge query**, not a fresh derivation. The supplemental `benchmark-mesh-topology.mjs` explicitly distinguishes fresh-resource construction from warm reuse, repeats a 30-preview gesture, measures retained heap outside timings, and checks resource retirement with WeakRefs and explicit GC. Here “cold” means a missing topology entry for a fresh resource object after engine warm-up, not a fresh-process startup. The supplemental script was added before the production edit and run against both versions; copy it into an isolated baseline checkout when reproducing that comparison. Do not present warm-query timings as cold construction timings.

### Core edge editing, 100 edges

| Triangles / attributes | Resolve before → after | Absolute preview before → after | Median preview speedup |
| --- | --- | --- | --- |
| 1250 | 0.63 / 0.80 → 0.07 / 0.08 | 1.02 / 1.55 → 0.32 / 1.07 | 3.24× |
| 9800 | 5.39 / 7.67 → 0.07 / 0.09 | 6.72 / 7.84 → 0.83 / 1.22 | 8.09× |
| 45000 | 38.09 / 63.77 → 0.11 / 6.06 | 46.21 / 55.94 → 3.65 / 4.12 | 12.64× |
| 45000 + UV/normals | 40.98 / 52.98 → 0.07 / 0.08 | 42.95 / 56.69 → 5.51 / 6.38 | 7.80× |
| 45000 + UV/normals / 4 submeshes | 6.93 / 9.08 → 0.07 / 0.08 | 11.38 / 14.15 → 3.99 / 5.05 | 2.85× |

The 45,000-triangle absolute preview improves from **46.213 to 3.655 ms median (12.64×; 92.1% lower)**. Edge resolution improves from 38.092 to 0.108 ms median; its optimized p95 was 6.059 ms, so the median alone must not be treated as its worst-case latency.

### Vertex/face paths and completion, 45,000 triangles without corner attributes

| Operation / 100 elements | Before | After | Median speedup |
| --- | --- | --- | --- |
| vertex: resolve | 2.75 / 3.87 | 0.04 / 1.93 | 65.45× |
| vertex: numerical delta preview | 8.53 / 9.77 | 3.39 / 3.79 | 2.52× |
| edge: resolve | 38.09 / 63.77 | 0.11 / 6.06 | 352.70× |
| edge: numerical delta preview | 80.23 / 91.64 | 3.53 / 3.79 | 22.74× |
| face: resolve | 1.56 / 1.62 | 0.05 / 0.06 | 30.61× |
| face: numerical delta preview | 6.57 / 7.31 | 3.16 / 3.50 | 2.08× |
| Edge commit + complete validation/serialization | 17.25 / 21.37 | 15.60 / 17.79 | 1.11× |

History append alone remains below 0.01 ms. Commit/serialization and full geometry construction were not optimized; their variations are not evidence that caching accelerates the encoder or renderer. Small vertex/face previews were approximately unchanged, with occasional median regressions (for example the small 100-vertex absolute preview, 0.291 → 0.324 ms). The targeted dense-edge benefit is substantially larger than those variations. Membership toggling itself remains O(selection size); the gain is in resolving the changed selection afterward.

### Cold versus warm topology and repeated previews

| Triangles | Cold edge query before → after | Warm edge query after, p50 / p95 ms | 30 successive delta previews before → after |
| --- | --- | --- | --- |
| 1250 | 0.50 / 0.67 → 1.45 / 2.04 | 0.000375 / 0.001417 | 51.68 / 57.01 → 8.94 / 9.59 |
| 9800 | 4.34 / 6.39 → 9.47 / 17.44 | 0.000167 / 0.000250 | 413.21 / 434.78 → 31.02 / 111.40 |
| 45000 | 27.80 / 33.84 → 57.27 / 65.93 | 0.000375 / 0.001292 | 2444.12 / 2848.53 → 104.43 / 137.02 |

**Cold construction regresses**: the large first query is 27.80 → 57.27 ms median. The new path retains its lookup map and freezes published collections, adding first-use work. This tradeoff is retained because ordinary translation inherits the cache, avoiding repeated construction; the repeated 30-preview workload improves from 2,444 to 104 ms median. A new import/restore or independent resource still incurs the cold cost. No claim is made that every query is faster.

### Native UI

The same hidden 1440 × 1000 Vite development/React StrictMode window, ANGLE Metal renderer, one warm-up gesture and five measured gestures with four native pointer samples each were used before and after. Native preview completion checks a changed sentinel corner against the actual render position attribute after at least two RAF callbacks. It does not compare every corner, wait for GPU completion or observe displayed paint. Selection and history timings use a two-RAF endpoint, followed by history-coordinate assertions. These are different endpoints, reported explicitly.

| Observation | Fixture | Before | After | Median speedup |
| --- | --- | --- | --- | --- |
| Preview → buffer sentinel | 9800 | 87.00 / 92.90 | 23.10 / 24.70 | 3.77× |
| Mouse-up → buffer sentinel | 9800 | 125.30 / 141.00 | 18.90 / 21.50 | 6.63× |
| Selection → two RAF | 9800 | 56.10 / 57.10 | 12.40 / 15.30 | 4.52× |
| Undo → two RAF | 9800 | 79.30 / 86.30 | 21.20 / 23.00 | 3.74× |
| Redo → two RAF | 9800 | 78.90 / 84.00 | 20.20 / 22.10 | 3.91× |
| Preview → buffer sentinel | 45000 | 506.00 / 555.20 | 80.70 / 102.50 | 6.27× |
| Mouse-up → buffer sentinel | 45000 | 756.80 / 864.10 | 87.70 / 106.60 | 8.63× |
| Selection → two RAF | 45000 | 300.70 / 318.90 | 34.40 / 34.70 | 8.74× |
| Undo → two RAF | 45000 | 495.90 / 676.80 | 72.70 / 83.20 | 6.82× |
| Redo → two RAF | 45000 | 470.20 / 526.30 | 73.40 / 163.30 | 6.41× |
| Preview → buffer sentinel | 45000 + UV/normals | 508.70 / 587.80 | 77.60 / 103.70 | 6.56× |
| Mouse-up → buffer sentinel | 45000 + UV/normals | 786.40 / 848.20 | 113.00 / 125.60 | 6.96× |
| Selection → two RAF | 45000 + UV/normals | 369.30 / 378.80 | 31.00 / 32.30 | 11.91× |
| Undo → two RAF | 45000 + UV/normals | 490.30 / 527.90 | 72.90 / 77.40 | 6.73× |
| Redo → two RAF | 45000 + UV/normals | 500.70 / 509.00 | 70.00 / 76.00 | 7.15× |

The large unattributed preview observation improves **506.0 → 80.7 ms median (6.27×)**. The separate stack-profile interval constructs no new edge derivation or resolution maps during warm preview, completion or autosave; selection deduplication maps still occur. This confirms reuse rather than merely faster isolated lookup. The profiler detects Map construction at known call sites, not every possible computation; it is separate from latency measurement.

Editing/history RAF intervals improve from 166.7 / 358.3 to 24.9 / 50.0 ms for the large unattributed fixture. WebGL CPU submission remains approximately 0.3 ms median. Neither metric establishes production FPS or GPU paint completion. Dense UI latency remains much larger than the pure core preview: coincidence scans, overlay expansion, React propagation and full affected geometry buffers remain candidate costs. Five mode cycles plateau at the same renderer geometry count; this is a short lifetime observation, not a long-session leak proof.

### Reproduction and raw measurements

```sh
node --expose-gc --experimental-strip-types scripts/benchmark-obj-editor.mjs \
  --memory --out /private/tmp/obj-editor-node.json
node --expose-gc --experimental-strip-types scripts/benchmark-mesh-topology.mjs \
  --out /private/tmp/obj-editor-topology.json
npm run dev:web -- --port 5177
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js \
  scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5177/ audit
```

- CPU: [before](audits/obj-editor-5b-before-node.json), [after](audits/obj-editor-5b-after-node.json).
- Cold/warm topology, heap and retirement: [before](audits/obj-editor-5b-before-topology.json), [after](audits/obj-editor-5b-after-topology.json).
- Native UI: [before](audits/obj-editor-5b-before-ui.json), [after](audits/obj-editor-5b-after-ui.json).

## C. Cache design, ownership and invalidation

The private `WeakMap<ObjResource, ResourceTopology>` in `mesh-edit.ts` is owned by the resource snapshot. Derived values contain only ID strings, numeric indices, maps, sets and protected collections. They do not retain resource objects, vertex/normal arrays, projects or history. Public edge/index collections are shared read-only values, frozen to prevent a consumer from poisoning subsequent queries; maps remain private. All existing production consumers only read them.

| Operation | Cache behavior |
| --- | --- |
| Import, project restore, independent duplication or replacement | New resource object, cold entry, regardless of reused resource/mesh/vertex IDs. |
| Vertex/edge/face translation | Private inheritance after successful geometry validation; IDs/order/connectivity are unchanged. Pivots, positions, normals and bounds remain live. |
| Shared-resource copy-on-write | Same derived topology may be shared, with separate geometry arrays and resource IDs. No geometric state is cached. |
| Undo/Redo/cancel | Existing snapshot keys resolve their own derived data; shared topology is valid across coordinate-only versions. No draft coordinates can enter cached values. |
| Submesh selection | Separate lazily populated entries inside the owning topology record. Only active/reached queries allocate their data. |
| Deletion/history eviction | Weak keys do not keep obsolete resources alive; ordinary application/history references determine their lifetime. |
| Future topology changes | Must produce a new immutable resource snapshot without invoking translation inheritance. Changed IDs/order/connectivity require fresh derivation. |

The contract is the application's existing immutable snapshot model. Mutating a published resource's IDs or triangle arrays in place is unsupported; this optimization does not add an O(mesh size) checksum on every query. Future topology-changing code must use new snapshots and must not reuse the private inheritance block. Tests explicitly replace/reindex/change same-ID resources and verify independent results. Do not generalize inheritance into an ID-keyed global cache.

The warmed topology footprint was approximately **0.54 / 3.23 / 14.27 MiB** for 1,250 / 9,800 / 45,000 triangles, including edge and vertex/reference queries. These are noisy V8 retained-heap observations; the uncached control had small positive/negative GC deltas and is not an exact zero-memory baseline. Connectivity is stored once for a translated resource family, rather than once per history version.

After 60 edits, the existing history experiment still reports **11.7 MiB without authored normals and 197.0 MiB with them**, before and after. That delta is measured after warming selection/topology and **excludes the already resident cache**, so it must not be described as total editor memory. The optimization does not fix or reduce normal-history retention. In the explicit-GC retirement probe, the source resource, vertex array, normal array and all eight preview resources were collected even while a returned 67,800-edge collection remained strongly held.

## D. Correctness verification

TypeScript checking, all **113 automated tests** and the production build passed. Five focused cache tests add coverage for protected outputs and edge order; fresh same-ID restored/duplicated/reindexed/topology-changed resources; live positions across vertex/edge/face previews; shared-resource isolation, cancel and visits to undo/redo snapshots. Existing tests retain coverage for deduplication, independent coincident IDs, multiple submeshes, degenerate geometry, rotated/non-uniform objects, serialization limits and OBJ round-trip.

All seven relevant native interaction suites passed with the corrected fixture precondition. Vertex editing, single edge/face editing, OBJ import, Object Mode, built-in transforms and export passed their full suites; the full multi-selection suite then passed **three consecutive runs**, including a recorded run that exercised the alternative coincident-face branch. The dense native benchmark and explicit-GC retirement assertions also passed.

The initial failures, diagnostic runs and successful runs are all retained in the [interaction results](audits/obj-editor-5b-interactions.json). Native picker/overwrite UX and displayed production-frame timing remain manual checks; no assertions were removed or weakened.

### Resolution of the Stage 5A intermittent assertion

The original full multi-selection suite failed once and passed three times before optimization. In the initial optimized regression sequence, its three runs failed; a subsequent diagnostic sequence passed once and failed once. Those failures were retained and investigated, rather than treated as clean retries.

The diagnosis identifies an **ambiguous fixture selection, not an incorrect gizmo center**. The fixture's second and third triangles occupy the same surface but reference independent logical vertices (`v1` versus coincident `v5`). The test expected faces 1 + 2 and unique indices `[0, 1, 2, 3]`. The failure log records actual chips **faces 1 + 3**, and **five logical vertices**. Their unique-vertex centroid is `[41.6, 16.6, 20]` locally, which transforms to the observed `[41.24265, 16.07561, 20.22789]`; the desired four-vertex group instead gives `[42, 17, 20]` in world space. Waiting for RAFs cannot change the correct center of that different logical selection.

The native test now asserts that the ray picked one of the two valid overlapping faces. If it picked face 3, the test removes the other group member, uses the **existing coincident-face selector** to choose face 2, and Shift-clicks face 1 again. It then explicitly asserts that the selected chips are faces 1 + 2 before running all original four-vertex pivot, XYZ drag, numerical, cancellation, undo/redo, save and round-trip checks. Tolerances and timeouts are unchanged. This strengthens the fixture precondition without accepting the wrong expected center, welding independent vertices or changing production picking behavior.

The added unit regression explicitly distinguishes the four-vertex and five-vertex groups under warmed topology. `OBJ_PIVOT_DIAGNOSTICS=1` retains opt-in observations on any future assertion failure, then rethrows the original assertion. See the [member/scene diagnostic](audits/obj-editor-5b-pivot-diagnosis.json). This belongs to Stage 5B's verification scope; no speculative production gizmo fix was needed.

## E. Remaining risks and limitations

- First use has a measurable cold-construction penalty and additional resident topology memory, despite the large steady-state improvement.
- Cache validity depends on immutable resource snapshots; future topology operations need explicit fresh ownership and regression coverage.
- Coincidence signatures, picking projection/occlusion, affected-triangle scans, bounds, full normal-array copies and full affected render-buffer reconstruction remain. Adjacency, incremental buffers and render/Inspector memoization were deliberately deferred.
- Commit-time full validation/serialization, the autosave encoder and approximately 197 MiB of normal-history growth remain unchanged.
- The overlapping-face fixture is now explicit; this does not constitute exhaustive OS pointer-capture or event-interleaving coverage.
- Manual acceptance remains necessary for displayed production-frame timing, long-session heap/GPU soaks, extreme transforms, dense clipped/coplanar assets, authored seam shading and OS-specific focus/pointer-capture behavior.

## F. Next-stage recommendation

Keep this targeted optimization: the dense edge core and native UI benefits are substantial, while cache lifetime and snapshot isolation are covered by focused tests and an explicit retirement probe. No broader modeling infrastructure is needed to obtain this gain.

**History-memory investigation is a justified next bounded performance stage**: topology reuse did not change the approximately 197 MiB retained by 60 authored-normal edits. Begin with heap ownership/size accounting and a separately reviewed memory-budget policy or immutable normal-array sharing strategy; do not silently reduce undo depth or introduce mutable shared buffers. If interactive latency is the product priority, separately profile the remaining ~81 ms native-preview path before choosing a narrow coincidence/overlay change. No next stage is implemented automatically.

Implementation files: [`mesh-edit.ts`](../src/core/mesh-edit.ts), [`mesh-topology.test.ts`](../tests/mesh-topology.test.ts), [`benchmark-mesh-topology.mjs`](../scripts/benchmark-mesh-topology.mjs), and the fixture-precondition/diagnostic update in [`verify-mesh-multiselect-cases.cjs`](../scripts/verify-mesh-multiselect-cases.cjs). The report, raw measurements and the link in `docs/obj-editor.md` are the remaining changes.

Work remains uncommitted on `feature/obj-editor`; `main` remains at `1320078a65c021b589fc27a3f5bd096d62eab334`. No commit, push or subsequent stage was performed.
