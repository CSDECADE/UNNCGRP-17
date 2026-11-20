# Stage 5A — OBJ Editor Engineering Audit

Audit date: 20 November 2026. Baseline: `6fc09cb7eaf88aa590dac604ad9f1ef075efd308`, branch `feature/obj-editor`.

## Scope and conclusion

The editor's resource, transaction and persistence architecture is functioning and does not require a redesign. The strongest measured problem is repeated topology/selection derivation for dense **edge** editing. It is present in interactive previews, not merely transaction startup. Vertex/face resolution and ordinary idle drawing have substantially different costs. The previous approximately 47–48 ms observation is reproducible as one CPU preview operation; it is not a viewport frame-time measurement.

No confirmed P0 data-integrity defect was found in the audited scenarios. This is bounded evidence, not a proof of correctness for arbitrary assets or event interleavings. Confirmed performance limitations, supported semantics and unresolved risks are separated below. Production application files were left unchanged; only fixtures, benchmarks, two focused tests, harness registration and this report/results were added. No optimization, new modeling feature, dependency, commit or push is part of Stage 5A.

## A. Current architecture assessment

| Area | Actual implementation | Assessment |
| --- | --- | --- |
| Geometry source | [`types.ts`](../src/core/types.ts), [`validateObjResources()`](../src/core/obj-resource.ts): resource-global vertex IDs, triangle index arrays, optional flat per-corner UV/normal arrays. | Preserves logical identity and seams without conflating CPU topology with expanded render vertices. No half-edge structure is needed for current operations. |
| Selection | [`selectionElements()`, `meshEdges()`, `resolveElement()`](../src/core/mesh-edit.ts): one primary element plus optional additional identities; canonical edge endpoint pairs, triangle ordinals, unique vertex union. | Appropriate for topology-preserving edits. Derivation is repeated frequently; triangle ordinals would need a separate identity policy only if topology operations are later introduced. |
| Picking/highlight | [`VertexOverlay`](../src/features/mesh-edit/VertexOverlay.tsx): screen-space vertex/edge projection, per-candidate occlusion, face raycasting; one mode-specific overlay. | Correct scope and ownership are reused. Every selected-resource change regenerates the active edge overlay, including topology derivation, even when connectivity is unchanged. |
| Translation | [`translateMeshElement()`](../src/core/mesh-edit.ts#L213) and [`updateTransformSession()`](../src/core/transform.ts#L69): absolute base-relative local pivot/delta, deduplicated index set, immutable draft. | One implementation serves all element types. The numerical-delta path resolves the base pivot, then resolves selection again inside translation. |
| Normals/bounds | `faceNormal()`, `resourceBounds()`, `translateMeshElement()`: validate affected triangles, retain fully translated normals, transport partially affected corner normals; scan bounds. | Avoids global smoothing and partial invalid commits. A partially affected mesh copies its complete normal array and scans its triangles. |
| Resource isolation | Same translation function reserves/reuses a copied resource ID only when another instance shares the source. | Preserves other instances and undo snapshots. Logical IDs and topology remain stable across the copy. |
| Transactions/history | [`editor.tsx`](../src/core/editor.tsx#L276), [`commitTransformHistory()`](../src/core/transform.ts): one draft, synchronous refs, stale/no-op guard, validation before history write; 60 project snapshots. | Cancellation and persistence boundaries are sound in tested cases. The history cap bounds count, not retained memory. Undo/Redo primarily replace references; rendering after them can still be expensive. |
| Rendering | [`ImportedMesh`](../src/features/obj-import/ObjMesh.tsx) and [`createObjGeometry()`](../src/features/obj-import/geometry.ts): memoized unaffected meshes; rebuild affected expanded buffers and bounds; owned-buffer disposal. | Existing isolation is useful. Affected meshes rebuild all corners; `Float32BufferAttribute` also copies the initially assembled position array. |
| React/R3F | [`VertexInspector`](../src/features/mesh-edit/VertexInspector.tsx), [`ObjectGizmo`](../src/features/obj-transform/ObjectGizmo.tsx), editor context. | Inspector resolves draft, committed and coincident-element data during render. Gizmo resolves in event handling and layout effects. Context updates such as autosave status can rerender these consumers without geometry changes. |
| Persistence | [`serializeProject()`](../src/core/project.ts#L224), `validateProject()`, `persistProject()`. | Atomic validation remains important. Serialization performs an input stringify/budget check, validated geometry copy, then another stringify/budget check. Autosave repeats it after the 450 ms debounce. |
| Interchange | [`parseObj()`/`prepareObjImport()`](../src/features/obj-import/obj.ts), [`exportSelectedObj()`](../src/features/obj-export/obj.ts). | Dedicated logical serialization avoids render-topology expansion and helpers. Export validates and re-imports into an empty project before saving; the CPU cost is deliberate and occurs on export, not on every drag sample. |

### Where repeated work occurs

`resolveElement()` constructs an edge collection and a second edge lookup map every time it resolves an edge selection. It also builds a referenced-index set; vertex resolution constructs an all-vertex ID map. These are topology operations even when only positions changed. `coincidentElements()` adds a primary-element resolution and another full candidate scan.

The separately profiled native edge-drag interval invoked `meshEdges()` **15 times** and constructed resolution maps **11 times** for 9,800 triangles; the 45,000-triangle cases recorded **18 / 14**. Counts include work until the render-buffer observation completes, rather than only the synchronous pointer handler. The 9,800-triangle call stacks identify:

- Translation: one resolution through `translateMeshElement()`.
- Gizmo event synchronization: one resolution.
- Inspector draft, committed and coincident-primary resolutions: six in development StrictMode, plus two additional coincident edge derivations.
- Overlay resolution: two, plus two edge-overlay memo-factory derivations in development StrictMode.
- Gizmo layout synchronization: one resolution.

The larger cases add another Overlay render pair and Gizmo layout synchronization before the observation endpoint. This is observed call-count evidence for the development build, not an assertion that production doubles every operation. [`main.tsx`](../src/main.tsx) enables StrictMode. Both the Node benchmark and the call graph independently establish redundant full-topology work; production UI timing remains a separate verification requirement.

## B. Performance findings

### Conditions and reproducibility

Machine: Apple M3 Pro, arm64 macOS, 18 GiB RAM. Node v25.9.0; Electron 45.2.1. The UI renderer identified ANGLE Metal on Apple M3 Pro. Benchmarks were run sequentially; the Node benchmark was not run concurrently with the UI benchmark. The system was not CPU-pinned or otherwise laboratory-controlled.

Node assets are deterministic planar grids: 25², 70² and 150² cells, two triangles per cell. Workloads select one or 100 vertices/edges/faces, with an additional four-submesh case. The attributed fixture uses explicit per-corner UVs/normals. It is approximately 2.94 MB of project JSON and fits the existing 5 MB limit. Selection samples are spread over the active submesh. A 100-edge selection in the large grid resolves to 200 vertices and affects 989 of 45,000 triangles.

Each CPU operation records its first invocation for that fixture, three warm-ups, then 15 samples with p50/p95/max. First invocation is not a fresh-process cold start; previous cases may have warmed the engine. With 15 samples the reported nearest-rank p95 is the observed maximum, so tail precision is limited. Full distributions and conditions are retained in [Node results](audits/obj-editor-5a-node.json). Memory measurements force GC only outside timed operations and report V8 heap retention, not total process/GPU memory.

```sh
node --expose-gc --experimental-strip-types scripts/benchmark-obj-editor.mjs \
  --memory --out /private/tmp/obj-audit-node.json
# Increase repetitions when comparing a proposed optimization:
OBJ_AUDIT_RUNS=30 node --experimental-strip-types scripts/benchmark-obj-editor.mjs \
  --out /private/tmp/obj-audit-node-repeat.json
```

The UI benchmark uses the existing isolated-profile Electron harness and Vite server, a hidden 1440 × 1000 window, actual native pointer gestures, one warm-up gesture and five measured gestures with four pointer samples each. It sets up a deterministic 100-edge selection using existing public editor methods read through test-only React context inspection. Selection timing toggles a real member, rather than repeatedly assigning the same state. Its endpoint observes both RAF callbacks and agreement of a changed sentinel corner (the first logical vertex, included in the selection) between the rendered position buffer and editor resource data. This sentinel is not a full-buffer equality check. It does **not** measure displayed paint, GPU completion or production-build frame rate. Draw timings are CPU WebGL submission timings; the editing RAF distribution also includes commit/history commands. Intrusive stack profiling is performed separately from latency measurements. See [UI results](audits/obj-editor-5a-ui.json).

```sh
# Start/reuse the existing Vite server; the benchmark does not stop it.
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js \
  scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ audit
```

Only this new benchmark mode has a five-minute timeout. Existing functional suites retain their 90-second timeout and original assertions. Private Fiber/context access is isolated to the benchmark and may need maintenance after React/R3F upgrades.

### CPU results

Times below are **p50 / p95 milliseconds**, independent operations rather than additive frame components.

| Operation, 100 selected edges | 1,250 triangles | 9,800 triangles | 45,000 triangles | 45,000 + UV/normals |
| --- | --- | --- | --- | --- |
| Membership toggle only | 0.09 / 0.15 | 0.08 / 0.79 | 0.08 / 0.08 | 0.08 / 0.12 |
| Resolve selection to vertices | 0.65 / 0.79 | 5.88 / 6.32 | 39.62 / 49.37 | 39.60 / 50.54 |
| Start transaction | 0.69 / 1.08 | 5.92 / 7.04 | 38.24 / 50.59 | 38.93 / 43.77 |
| Absolute preview, existing gizmo input | 0.99 / 1.93 | 6.74 / 7.38 | **47.01 / 66.19** | 46.91 / 60.01 |
| Numerical delta preview | 1.45 / 1.63 | 11.94 / 15.07 | 93.17 / 107.21 | 84.85 / 97.98 |
| History append only | <0.01 | <0.01 | <0.01 | <0.01 |
| History append + complete validation/serialization | 0.40 / 0.54 | 3.15 / 4.20 | 18.02 / 24.52 | 36.48 / 42.11 |

The numerical path's additional resolution is visible in both source and timing. The native gizmo uses absolute pivot input, so numerical-delta timings must not be substituted for the core native preview operation. Conversely, a native preview also causes UI-derived work beyond that core call.

| Operation on 45,000 triangles | No corner attributes, p50 / p95 ms | Explicit UV/normals, p50 / p95 ms |
| --- | --- | --- |
| Derive all active-submesh edges | 22.15 / 30.04 | 26.98 / 38.47 |
| Resolve 1 vertex / 100 vertices | 2.69 / 6.78; 3.06 / 3.31 | 2.66 / 5.88; 2.80 / 5.29 |
| Resolve 1 edge / 100 edges | 41.97 / 49.98; 39.62 / 49.37 | 37.41 / 52.27; 39.60 / 50.54 |
| Resolve 1 face / 100 faces | 1.51 / 6.12; 1.63 / 4.97 | 1.34 / 1.44; 1.61 / 2.23 |
| Vertex pick including occlusion | 8.51 / 9.14 | 8.67 / 14.16 |
| Edge pick including occlusion | 46.33 / 52.29 | 46.36 / 54.26 |
| Face raycast | 1.23 / 1.34 | 1.13 / 1.27 |
| Assemble full expanded positions | 5.84 / 6.36 | 6.11 / 8.07 |
| Position attribute copy | 0.13 / 0.16 | 0.28 / 0.38 |
| Recompute bounds on existing buffer | 1.54 / 1.65 | 1.38 / 1.61 |
| Build complete render geometry | 6.39 / 9.42 | 6.12 / 13.48 |
| Serialize project | 16.06 / 19.16 | 36.21 / 41.47 |
| Restore project | 15.99 / 17.88 | 40.26 / 42.60 |
| Export including exact round-trip preflight | 100.96 / 124.48 | 200.63 / 294.50 |

The 45,000-triangle attributed mesh split into four submeshes reduced active-submesh edge resolution to 7.74 / 10.70 ms and absolute preview to 12.31 / 14.55 ms. This supports active topology size as a root cause; it is not a recommendation to automatically split user geometry. Whole-project serialization remained 35.61 ms median because it still processes the complete scene.

One JSON stringify pass was 2.42 ms without attributes and 4.14 ms with attributes; UTF-8 encoding was 0.40/0.97 ms. Validation/copying plus its budget pass was 13.23/34.84 ms. Do not remove safety checks to recover this time: reuse validated immutable results or avoid redundant calls only with explicit correctness guarantees.

### Actual UI observations

Times are **p50 / p95 ms**. All 60 measured preview samples changed geometry identity and reached the position sentinel. Commit keeps the already previewed buffer, so a new geometry identity is not expected at mouse-up.

| Observation, 100 edges | 9,800 triangles | 45,000 triangles | 45,000 + UV/normals |
| --- | --- | --- | --- |
| Native preview event → two RAF callbacks | 58.5 / 62.6 | 314.4 / 399.5 | 338.7 / 393.3 |
| Native preview event → buffer sentinel match | **89.7 / 100.5** | **486.5 / 612.2** | **527.4 / 590.5** |
| Mouse-up → two RAF callbacks + buffer match | 128.1 / 153.3 | 727.4 / 850.4 | 785.1 / 838.5 |
| Selection toggle dispatch only | 6.1 / 6.3 | 31.7 / 32.3 | 36.9 / 42.4 |
| Selection toggle → two RAF callbacks | 58.4 / 60.7 | 340.4 / 360.1 | 388.5 / 413.4 |
| Undo → two RAF callbacks | 81.9 / 86.2 | 487.0 / 513.1 | 496.6 / 574.8 |
| Redo → two RAF callbacks | 80.1 / 86.2 | 482.0 / 517.6 | 485.0 / 527.3 |
| Idle RAF interval | 8.3 / 9.7 | 8.3 / 10.3 | 8.3 / 9.6 |
| RAF interval during edit/history sequence | 33.2 / 57.6 | 174.9 / 333.2 | 175.0 / 350.0 |
| WebGL render CPU submission during sequence | 0.3 / 0.7 | 0.4 / 2.5 | 0.3 / 2.5 |

Preview has 20 measured events per fixture; commit/history/selection each have five. Undo/Redo timings use the two-RAF endpoint, followed by exact editor-coordinate assertions; they do not use the preview buffer-sentinel endpoint. A two-RAF observation can precede an R3F buffer update, so these endpoints are deliberately reported separately. These are synthetic, paced native gestures in a hidden development window, not continuous-motion throughput or displayed frame timing.

The separate stack-profile interval recorded 18 edge derivations / 14 resolution maps for a large-mesh preview, 24 / 20 for completion, and 11 / 9 during the subsequent 850 ms autosave observation. These counts are timing-window dependent; they show where work occurs without proving a fixed number per browser event.

The call-count profile also observed topology work after commit and during autosave status updates, even though connectivity did not change. Undo/Redo dispatch itself was approximately 0.0–0.2 ms; its slow UI completion is derived-data/render propagation rather than a deep clone performed by the history operation. Idle drawing and an edit-heavy sequence must not be conflated. Development StrictMode, two React roots and context propagation amplify the repeated CPU work; the audit does not extrapolate a production FPS number from these results.

### Memory and resource lifetime

After 60 successive 100-edge commits on the 45,000-triangle fixture, retained V8 heap above the initial fixture was **11.7 MiB without authored attributes** and **197.0 MiB with explicit normals/UVs**. The source files were 1.59 MB and 2.94 MB respectively. Triangle/UV arrays remain shared, but each partially affected mesh receives a new full normal array; 60 snapshots retain those arrays. This is bounded history retention, not evidence of an unbounded leak. A 5 MB file budget does not bound heap retention.

The UI mode-cycle experiment did not show monotonic growth of `renderer.info.memory.geometries` across five enter/exit cycles. Counts include shared GLTF caches and gizmo resources, so zero is neither expected nor a valid leak threshold. Development instrumentation saw two large geometry factory products per committed version, consistent with StrictMode's render-phase checks. UUIDs constructed without a later explicit dispose are not by themselves proof of a GPU leak: discarded render-phase objects may never be uploaded. Production heap snapshots, longer mount/unmount soaks and GPU completion measurements remain gaps, rather than being declared clean by this short experiment.

## C. Correctness and reliability findings

### Confirmed defects versus limitations

No confirmed P0 functional/data-integrity bug was reproduced. One existing multi-selection interaction run failed its immediate gizmo-pivot assertion after a selection change; the unchanged full suite passed on retry. The failure compared `[41.24265, 16.07561, 20.22789]` with `[42, 17, 20]` at `verify-mesh-multiselect-cases.cjs:64`. It did not reproduce data corruption. A single successful retry does not resolve whether this is a test synchronization race or a transient application synchronization defect; preserve it as an open reliability finding. No assertion or delay was changed to obtain the retry result. Confirmed engineering problems are the measured dense-edge latency, redundant work on non-geometric context updates, complete affected-mesh buffer rebuilding, and potentially large but bounded normal-history retention. Normal-transport shading changes, triangle-based face identity, non-X-ray picking and single-submesh scope are explicit supported limitations, not newly discovered corruption.

| Scenario | Evidence/status | Remaining gap |
| --- | --- | --- |
| Coincident independent vertices/edges/faces | Existing selection/geometry tests and native multi-selection suite retain IDs and separate membership. | Dense, nearly coincident, clipped and coplanar silhouettes still need asset-specific visual checks. |
| Shared references and multiple submeshes | Unique-vertex union, UV/winding invariants, copy-on-write tests and native unaffected-buffer checks pass. | Future topology/ID caches must not be keyed by positions or resource ID alone. |
| XYZ rotation/non-uniform scale | Existing native XYZ drags and numerical/world equivalence tests pass; object transform fields remain intact. | Extreme camera clipping/precision at scene limits is not exhaustively sampled. |
| Invalid/degenerate geometry | Draft rejects invalid samples; completion validates full project before history write; capacity UI test rolls back the complete group. | Arbitrary self-intersection/collision detection is intentionally absent. |
| Rapid mode/selection changes, Esc, blur | Cancellation and repeated native gestures/undo/redo pass; the multi-selection suite passed unchanged on retry after one pivot assertion failure. | Trace selection-to-R3F pivot readiness and repeat this case; test-race versus transient UI defect remains unresolved. Deterministic sequences do not replace OS pointer-capture soaks. |
| History and repeated edits | Existing no-op/stale/one-entry cases pass. New audit test performs 65 group commits, verifies the 60-entry cap, immutable old snapshots, no preview accumulation, JSON restore and final OBJ geometry. | Memory is bounded by count rather than bytes; refresh deliberately discards undo history. |
| GPU ownership/disposal | Affected geometry is owned/disposed, unaffected geometry is memoized, and short mode cycles plateau. | Production/concurrent-render lifetime and long-session memory need dedicated soak/profile work. |
| Import/export/persistence | Existing round-trip, corner-seam, size-limit, native writer/cancel/error, browser download and actual re-import suites pass. | Native OS picker UX/overwrite behavior and maximum-size imports still require manual acceptance. |

Two audit tests fill specific gaps rather than repeating the complete existing matrix: static-geometry independence of route analysis/UAV poses, and 65 successive group edits through the capped history. Existing tests were not removed or weakened.

### UX review

Mode buttons, counts, orange highlights and local delta labels provide usable feedback in the tested workflows. Shift selection is isolated from modifier-pan; the native multi-selection suite verifies that camera pose stays unchanged. Current constraints worth communicating more clearly are:

- Object/Edit Mode and disabled eligibility are not strongly discoverable for a first-time user selecting a built-in building or UAV. A small eligibility tooltip/explanation is an optional improvement.
- Plain clicks on handles prioritize the gizmo; V and Shift picking provide the existing alternatives. Dense short edges and exact overlaps remain hard to target without X-ray/box selection, neither of which this audit proposes implementing.
- Absolute fields for single elements versus delta-and-Apply for groups are correctly distinguished, but the distinction should remain visible after any later UI simplification.
- History is available through Undo/Redo, not a browsable/persistent history panel. This is existing behavior and an optional UX request, not a regression.
- Error handling preserves the scene and uses existing feedback. Busy labels can only paint once synchronous import/export CPU work yields; a scheduling improvement is preferable to inventing another file workflow.

## D. Prioritized optimization plan

Estimates below describe relative implementation scope, not delivery commitments. Benefits are expected from the measured cause; acceptance must be based on before/after results on the same fixtures.

| Priority | Measured problem and proposed change | Scope/modules | Expected benefit | Correctness/invalidation risks and required regressions |
| --- | --- | --- | --- | --- |
| P0 | None confirmed in this audit. Preserve all validation, cancellation and isolation guarantees. | No immediate correctness rewrite justified. | Avoid optimizing by discarding safety. | Any newly reproduced corruption takes precedence over this plan. |
| P1-1 | Reuse derived topology: vertex-ID map, referenced-vertex set, canonical edges and edge lookup map. Dense edge resolution is ~40 ms even for one selected edge; a profiled preview interval derives edges 15–18 times in development. | Small/medium: `mesh-edit.ts` plus focused cache tests/benchmark integration; no persisted schema change. | Eliminate repeated O(triangle-count) edge derivation while topology/IDs are unchanged; benefit also applies to edge picking and overlays. | Translation changes vertex-array/resource object identities without changing IDs/order. Load/replace, resource deletion, copy-on-write, undo/redo and independently created resources can reuse IDs. Explicitly validate cache identity/invalidation; never key solely by `resourceId`. |
| P1-2 | Reuse resolved selection/pivots during a gesture and memoize Inspector/Overlay derivations on their actual resource/model/selection inputs. Avoid full geometry derivation after autosave-status changes. | Medium: `transform.ts`, `ObjectGizmo`, `VertexInspector`, `VertexOverlay`; possibly a narrow context-value split later. | Reduce repeated resolution, numerical delta's double pass and non-geometric rerender work. | Cached topology is not cached position data. Draft updates, cancel, history and object transforms must refresh pivots, bounds and normals. Do not suppress required UI updates to lower timings. |
| P1-R | Investigate the intermittent multi-selection pivot assertion before treating repeated selection/drag readiness as reliable. | Small diagnostic scope: existing native harness, `ObjectGizmo`, selection/context propagation. | Distinguish test-readiness timing from a user-visible stale pivot; add a focused regression only after reproduction. | Retain the original failure and original assertion. Do not mask it by indiscriminately increasing delays or count a retry as proof of absence. |
| P1-3 | Address normal-history retention: evaluate a conservative memory/byte budget before a more invasive patch/chunked history representation. 60 edits retained ~197 MiB. | Medium/high: history policy in `editor.tsx`/`transform.ts`, normal-array ownership and UX documentation. | Bound long-session heap more usefully than entry count alone. | Silent loss of undo depth is a UX change; patch/chunk sharing can corrupt old snapshots if mutated. Preserve current project schema and atomic completion; test mixed edits, redo branching and capacity failures. |
| P1-4 | Precompute vertex-to-triangle/corner adjacency; update affected owned render buffers/normal ranges and bounds deliberately. Full geometry rebuild costs ~6 ms despite only 989/45,000 triangles being affected. | Medium: geometry helpers, `ImportedMesh`, renderer update path. | Reduce allocations/upload work after topology caching exposes the next bottleneck. | Every expanded corner and hard-normal neighbour must update. Cancel/undo must restore buffers and bounding spheres. Unaffected instances/submeshes must retain buffers; no premature BVH/half-edge engine. |
| P2-1 | Reuse an immutable validated serialization result where safe; avoid duplicate export validation passes only after profiling. Preserve round-trip preflight. | Small/medium: project encoder, autosave/file/export hooks. | Reduce ~16–36 ms serialization and ~100–201 ms export latency without touching the drag core. | Preserve UTF-8 5 MB/16 MB budgets, stale-document handling, cancellation and atomic writes. Never cache by a mutable/stale ID. |
| P2-2 | Improve unsupported-mode explanations and dense-picking guidance. Profile larger scenes before considering a picking accelerator. | Small UX/documentation changes; later picking work only if measured. | Better discoverability without UI redesign. | Current face raycast is ~1.2 ms in the reference; a BVH is not the first justified optimization. Maintain occlusion and independent logical identity. |

## E. UAV integration considerations

[`analyzeRoutes()`](../src/features/analysis/route-analysis.ts) builds tracks from `project.drones`, `routeFor(project, drone.id)` and `timing(project)`. It computes route lengths/durations and simultaneous closest drone-to-drone separation under straight-line interpolation. It does **not** read models, OBJ resources, surface visibility, building bounds, camera coverage or building collisions.

[`AnalysisPanel`](../src/features/analysis/index.tsx) recomputes from the candidate/committed project identity. Static mesh commits can therefore trigger unnecessary recomputation, but the present results are not stale with respect to an input they do not use. The new audit test verifies identical analysis and `poseAt()` results after actual OBJ edits, imported-object XYZ/scale changes and built-in model position/dimension changes.

[`Playback`](../src/features/playback/index.tsx), `poseAt()`, `timing()` and [`DroneObject`/`CameraRig`](../src/Scene.tsx) derive flight and camera state from drones, viewpoints, target coordinates and progress. Targets are stored world coordinates, not references to mesh vertices. Editing a facade may make a manually authored target less useful visually, but it does not create an implemented collision/coverage result that must be recomputed. Candidate preview blocks editing, and applying a plan retains the validated scene snapshot.

No geometry-dependent analysis invalidation is required for the algorithms currently present. If a future external planner, collision or coverage result uses building geometry, it should carry an explicit dependency/revision key covering resource geometry **and instance transforms**. A loaded external route currently has no verifiable geometry provenance; do not present its visual clearance as a collision guarantee. No new algorithm, invalidation mechanism or UAV edit is implemented in this audit.

## F. Proposed Stage 5B

Recommend **derived topology/index reuse only**, beginning with P1-1. Capture a focused selection-to-pivot readiness trace for the intermittent assertion before modifying this hot path; do not hide the observation behind a broad retry policy. Keep the current project format, selection semantics, normal policy, transaction history and renderer ownership unchanged. Do not combine the first optimization with a BVH, worker, history rewrite, box selection or new modeling tool.

Acceptance should include:

1. Reuse edge/ID/reference maps across geometry-only preview changes while keeping live coordinates uncached.
2. Explicit tests for resource isolation, independent coincident IDs, load/replace, same-ID different resources, cancellation, undo/redo and cache retirement.
3. Preserve all existing functional tests and the audit's geometry/analysis invariants.
4. Repeat these benchmarks with the same fixtures and report p50/p95 and memory. A reasonable **target, not a promised result**, is at least an 80% reduction in 45,000-triangle edge-resolution CPU time and at most one topology build per unchanged topology during a gesture.
5. Repeat a native UI trace in development and add a production-build UI trace before stating a production frame-rate benefit. If remaining Overlay/coincident scans dominate, propose the next narrow stage using the new evidence.

## Verification and manual follow-up

- `npm run check`: passed.
- `npm test`: **108/108 passed** (106 existing tests plus two focused audit tests).
- `npm run build`: passed, including its TypeScript check and production bundle generation.
- Node benchmark: all five fixtures and all vertex/edge/face workloads completed, including the 60-edit heap experiment.
- Native Electron audit: passed three dense fixtures, real pointer previews, history restoration and resource-lifetime observations.
- `node --check` on all three new benchmark/fixture scripts and `git diff --check`: passed.

All seven existing full Electron suites passed in the completed sequential run:

| Harness mode | Result |
| --- | --- |
| `multi` | Passed on unchanged retry; initial run failed the pivot assertion described in section C. |
| `elements` | Passed: edge/face picking, transforms, history, cancellation and round-trip. |
| `edit` | Passed: vertex mode, shared-resource isolation, capacity rollback and unaffected buffers. |
| `verify-obj-ui.cjs` | Passed: import, persistence, selection, playback and analysis. |
| Default transform suite | Passed: OBJ Object Mode, numerical/gizmo synchronization and history. |
| `builtin` | Passed: building, cuboid and cylinder transforms, v1 restore and UAV regressions. |
| `export` | Passed: output integrity, writer/cancel/error paths and supported-type restrictions. |

The initial failure and successful unchanged retry are both part of this audit's result. The seven-suite pass does not close that intermittent synchronization question. Existing functional assertions and their 90-second timeout were retained.

Audit changes are isolated to `scripts/obj-audit-fixtures.mjs`, `scripts/benchmark-obj-editor.mjs`, `scripts/benchmark-obj-editor-ui-cases.cjs`, two tests in `tests/obj-audit.test.ts`, registration of the new `audit` harness mode, this report and its raw JSON results, and the audit link in `docs/obj-editor.md`. `src/`, dependencies and persisted schemas are unchanged. Work remains uncommitted on `feature/obj-editor`; `main` remains at `1320078a65c021b589fc27a3f5bd096d62eab334`.


Manual follow-up remains necessary for packaged native pickers/overwrite errors, near/far-clipped and coplanar dense assets, extreme transforms, shading at authored seams, OS-specific pointer capture/focus changes, long-session heap/GPU resource soaks and actual displayed production frame timing. Use representative assets and report scene complexity, selection size and build mode; do not interpret the synthetic reference as a maximum supported model size.
