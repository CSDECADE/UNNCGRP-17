# Stage 5D — OBJ Editor Release Readiness

Validation date: 2026-11-21. Branch: `feature/obj-editor`; baseline `61b5961`. This report evaluates Stages 1–5C and the isolated shortcut correction described below. No schema, dependency, import profile, history limit or storage architecture changes were made. `main` was not modified. No commit or push was performed.

The [5A audit](obj-editor-audit.md), [5B topology report](obj-editor-topology-optimization.md) and [5C memory report](obj-editor-history-memory.md) were reviewed before extending coverage. This stage adds authored-asset regression tests, explicit conditioning diagnostics, capacity workflows and native keyboard pressure probes. Existing tests were retained.

## A. Feature acceptance matrix

| Area | Evidence and result | Qualification |
| --- | --- | --- |
| Import and scene integration | Existing import suite; authored derivative and 63,492-triangle synthetic import | Raw authored files can be explicitly rejected; see B |
| Object translation, XYZ rotation, non-uniform scale | Native pointer gizmos, numerical inputs, inspector synchronization, Undo/Redo | Built-ins retain dimensions and Y-only rotation; UAV transforms remain unsupported |
| Vertex, edge and face editing | Existing viewport picking suites and authored derivative group drags | Triangulated faces; one object/submesh/type per group |
| Shift multi-selection and overlapping geometry | Existing multi/element/vertex suites exercise native picking, coincident IDs and active-submesh scope | No cross-object group editing; dense overlays remain a cost |
| Cancellation and restrictions | Escape, synthetic window-blur notification, mode switching, camera restoration, locked/hidden, preview/candidate restrictions | Physical application switching and OS modal focus remain manual checks |
| History | Ordinary gestures and paced 60-entry native keyboard round-trip pass | Continuous pressure has a confirmed failure; see D |
| Project save/restore | Actual browser JSON download, file-input restoration, reload; near-limit download/restore | Browser download routing is automated; OS dialogs are not physically exercised |
| OBJ export/re-import | Actual file download; world-coordinate equivalence after object and element edits; triangle order and identity object on re-import | Geometry-only profile; capacity preflight can refuse transformed output |
| UAV coexistence | Playback/path-analysis suites; authored workflow retains drones/viewpoints; pure-core route/pose regressions | Building edits are not obstacle-aware route planning |

Authored-asset group membership is seeded through the public editor API; actual gizmo dragging uses Electron mouse events. This supplements native viewport selection tests rather than claiming that every authored architectural feature was independently clicked. Test harnesses inspect private React/R3F roots; these are test-only techniques.

## B. Realistic model compatibility

The user has no business building OBJ available. No repository fixture is treated as a surveyed architectural/BIM acceptance sample.

Two unmodified Blender-authored buildings are pinned from [KayKit City Builder Bits 1.0](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0/tree/63976910ca04d16f0fc531b9c614244be8128713), by Kay Lousberg, under its [CC0 license](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0/blob/63976910ca04d16f0fc531b9c614244be8128713/LICENSE.txt). Their bytes, hashes, license and exact preprocessing are recorded in [fixture provenance](../tests/fixtures/obj-release/README.md).

| Sample | Complexity | Observed compatibility |
| --- | --- | --- |
| Raw KayKit A / H | 65,003 / 152,172 OBJ bytes | Both reject `mtllib` at line 3; removing material statements exposes unsupported smoothing metadata; disabling it exposes nonplanar quads |
| Explicit diagnostic derivatives A / H | 635 / 1,558 logical vertices; 828 / 1,885 triangles; UVs and explicit corner normals | Accepted; exact serialized round-trip and transformed world-coordinate export/re-import pass |
| Generated small / medium architecture | 612 / 5,892 triangles; five submeshes | Accepted; geometry, attributes and identity export/re-import validated |
| Generated large architecture | 48,132 triangles; 32,088 vertices; about 3.707 MB JSON | Accepted; identity export passes; rotated/non-uniformly scaled export fails its re-import capacity preflight |
| Generated near-limit architecture | 63,492 triangles; 42,328 vertices; about 4.996 MB JSON | Accepted; identity export and actual JSON save/restore pass; a normal-changing 100-edge translation exceeds the budget and is rejected atomically |
| Generated over-limit architecture | 64,932 triangles; 2,118,392 OBJ bytes | Import rejected because resulting JSON exceeds 5,000,000 bytes; current project unchanged |
| Sibenik Cathedral, external diagnostic | 5,202,682 OBJ bytes; archive metadata lists 75,284 triangles | Raw file rejects `mtllib`; explicit metadata conditioning then rejects 3-component texture coordinates; projecting 38,681 zero-W texture coordinates to 2D then exposes a degenerate triangle. No geometry repair/discard performed |

Sibenik is a genuinely authored architectural benchmark by Marko Dabrovic. Its [primary archive metadata](https://casual-effects.com/g3d/data10/research/model/sibenik/info.js) identifies a CC BY-NC license and corrections/texture contributions. It was used for local noncommercial investigation, remains outside the repository and is an optional benchmark input. It is **not an accepted large architectural workload**.

Diagnostic conditioning removes material references, disables smoothing metadata while preserving explicit normals, and splits quads on the 1–3 diagonal. No vertex/UV/normal arrays or faces are discarded. These transformations are disclosed test preparation, not hidden importer behavior. Raw compatibility remains a rejection result. Existing corner seams and normals are exercised, but this does not establish broad textured-model support.

The controlled architecture generator uses repeated box-frame façades and floor slabs, shared vertices within boxes and coincident independent corners at joints. It is deterministic geometry, not a scan, watertight BIM model or substitute for customer data.

Current limits are 16,000,000 input OBJ bytes and 5,000,000 complete-project JSON UTF-8 bytes. The latter is often the effective limit because JSON stores per-corner attributes. Baking rotated floating-point coordinates and normals can enlarge the re-import representation substantially. No claim of a universal triangle capacity is appropriate. JSON also canonicalizes signed zero to zero; serialized stability and numerical geometry are checked rather than requiring preservation of the IEEE sign bit through JSON.

## C. Performance and memory findings

CPU and application measurements are separate. CPU runs use three warm-ups and fifteen measured repetitions; cold import/topology values are single observations. Electron tests use isolated profiles, a hidden 1440×1000 window and background throttling disabled. These measurements describe this host, not a cross-device service target.

The final corpus, CPU and controlled-GC results are linked below. CPU geometry construction measures one explicitly named active submesh, not an entire rendered frame. Import-to-render-geometry timing waits for installed scene buffers with the expected corner count; it does not measure first displayed paint. Observed development runs: conditioned H 95.3 ms; near-limit architecture 275.3 ms, including UI scheduling/polling. The near-limit first edge topology query took 17.6 ms in its Electron run.

Actual native pointer measurements on the Apple M3 Pro/ANGLE Metal renderer are summarized below. Preview/commit values include waiting for two RAF callbacks and checking committed render geometry; they are UI latency observations, not isolated transaction CPU time. There were 20 preview samples and five commits/Undo/Redo/selection samples per case.

| Triangles / attributes | Preview p50 / p95 (ms) | Commit p50 / p95 (ms) | Undo / Redo p95, two RAF (ms) | Selection p95, two RAF (ms) |
| --- | ---: | ---: | ---: | ---: |
| 9,800 / no corner attributes | 22.7 / 26.0 | 19.2 / 19.7 | 23.6 / 24.4 | 14.1 |
| 45,000 / no corner attributes | 76.4 / 96.9 | 84.9 / 92.6 | 76.6 / 76.0 | 31.2 |
| 45,000 / UVs and normals | 79.1 / 122.6 | 113.0 / 119.5 | 79.9 / 77.7 | 34.0 |

Large models remain noticeably less responsive despite fast cached topology resolution. Resource copying, attributes, geometry buffers, serialization and rendering must not be collapsed into the topology-query benchmark. No claim of smooth 60 FPS is supported.

A fresh paced renderer memory run passed sixty history entries, three Undo/Redo cycles, redo-branch retirement, deletion and history eviction with zero update warnings. Controlled-GC used heap was 23.47 MiB after import, 33.26 MiB after topology warming, 40.63 MiB with sixty unchanged-normal history entries, 41.87 MiB after cycles and 24.61 MiB after geometry-history eviction. WeakRefs confirmed collection of both resource and normals while a held 67,800-entry edge table remained available. Heap not returning to startup is not itself evidence of leakage: loaded modules/UI/cache structures differ. GL counts and CPU scene buffers are recorded separately in the renderer artifact; physical GPU allocation bytes were not measured.

The native keyboard probe uses a 45,000-triangle attributed grid, 100 selected edges and sixty normal-changing history entries. Setup is deliberately paced. Native Ctrl+Z / Ctrl+Shift+Z are then sent at stated intervals. RequestAnimationFrame callback intervals are retained as scheduler responsiveness evidence, **not displayed FPS, GPU duration or compositor frame delivery**. Physical-screen interactive FPS and high-DPI/multi-monitor behavior remain unmeasured.

The clean serial CPU corpus run (Node v25.9.0, Apple M3 Pro, arm64, 18 GiB RAM) measured the following. Import/topology columns are cold single observations; the remaining columns are fifteen-sample p95 CPU milliseconds. The medium/large generated cases exercise Façade0 rather than the much smaller slab submesh.

| Sample | Import (ms) | First edge topology (ms) | 100-edge preview p95 (ms) | Full JSON serialize p95 (ms) |
| --- | ---: | ---: | ---: | ---: |
| Conditioned KayKit A | 8.41 | 1.40 | 2.81 | 1.78 |
| Conditioned KayKit H | 9.11 | 2.34 | 2.00 | 3.59 |
| Generated medium, 5,892 triangles | 17.14 | 1.76 | 2.00 | 7.00 |
| Generated large, 48,132 triangles | 175.09 | 12.39 | 8.81 | 56.78 |
| Generated near-limit, 63,492 triangles | 132.59 | 12.92 | 8.21 | 76.03 |

Independent Node controlled-GC probes reproduced approximately **11.89 MiB** history growth after topology warming for unchanged-normal planar X edits, versus **197.29 MiB** for normal-changing Z edits at 45,000 triangles/60 entries. Both collected original/edited resources and normal arrays after eviction, even while retaining the pure edge table. Twenty discarded redo snapshots were collected in each case. Final heap was 22.43 / 22.42 MiB after all geometry history was retired; this is not a requirement to return to process-start heap. The broader five-case CPU benchmark also passed, including the four-submesh workload; its separate normal-changing history measurements were 11.7 MiB without attributes and 197.0 MiB with attributes.

Stage 5C's unchanged-normal sharing and resource-owned topology cache remain in place. Normal-changing snapshots still require their normal arrays; memory must be evaluated separately from the favorable planar translation case. Controlled GC and collection assertions test eviction, discarded redo, removal and cache lifetimes. Node CPU buffers are not GPU allocations. Prior renderer-retainer evidence remains in the 5C report; it is not relabeled as a new 5D heap experiment.

## D. Reliability findings

No P0 data corruption was observed in successful import/edit/save/export workflows. Rejected imports, over-budget commits and failed export preflight preserve the live project. The following findings prevent an unconditional readiness claim.

### P1 development defect — Continuous native Undo can terminate the development render

**Follow-up:** [Stage 5E](obj-editor-undo-reliability.md) subsequently established and corrected the two passive-update sources. Repeated uninstrumented native regressions pass. The following 5D observations remain the historical before-fix evidence.

Reproduction: run the `release` stress scenario with `OBJ_RELEASE_SCENARIO=stress`, default 50 ms key interval and no batches. Import the attributed 150×150 grid, select 100 edges, establish 60 paced Z-offset commits, focus canvas and send sixty native Ctrl+Z keydowns. This reproduced before and after the shortcut fix in independent profiles.

Expected: return exactly to pre-edit geometry without renderer errors. Actual: React reports `Maximum update depth exceeded`, followed by an uncaught update-depth error; the sixty-Undo geometry assertion fails. The captured warning stack passes through React state dispatch, `cancelTransform`, `undo` and `App`'s key handler. This identifies the observed update path, **not the root causal effect or a proven minimal fix**. Development rendering/context synchronization and passive state updates require further isolation. No speculative inspector/autosave guards were introduced.

The same 60 Undo + 60 Redo sequence passes with a 750 ms pause after each twenty keys. This narrows the trigger but does not justify dismissing it: held-key repetition is a plausible interaction. Normal editing remains validated; pressure robustness is unresolved. Scope demonstrated so far: development editor availability/history interaction; risk: unsaved work may become inaccessible until reload in that environment. The production bundle passed the same 50 ms, sixty-Undo/sixty-Redo sequence, with exact geometry and no console errors. It uses the same public editor methods and native key events, seeded from the controlled fixture without Vite source imports. This does not establish a production renderer crash or identify the root cause of the development-only failure. Preserve the failing regression and investigate development scheduling with a minimal reproduction. Production-bundle evidence is recorded below.

### P1 — Real Ctrl+Shift+Z did not invoke browser-mode Redo (fixed)

At 120 ms between events, all 120 Undo/Redo keydowns reached the page without console errors, but Redo did not restore the tip geometry. Native Shift changes `KeyboardEvent.key` to uppercase `Z`; `App` compared only lowercase `z`. Existing synthetic helpers supplied lowercase `z` even with Shift and therefore missed this defect.

The isolated fix normalizes only the Undo/Redo key comparison with `toLowerCase()`. Desktop menu ownership, target exclusions and other shortcuts remain unchanged. The native batched pressure regression now proves actual Shift+Z Redo and exact geometry recovery. The remaining update-depth failure is independent. Risk: minimal case-normalization change; ordinary suites are rerun.

### P1 capability constraint — General architectural OBJ intake is not ready

Raw Blender assets and the cathedral are explicitly rejected by the documented narrow syntax/geometry profile. This is deliberate rejection, not silent corruption, but prevents a claim of general architecture-asset readiness. Expected for general intake: preserve supported geometry while clearly handling material/smoothing/polygon options. Current behavior: reject before mutation. Smallest follow-up: document a reproducible geometry-only triangulated export preset and validate an actual business building; separately scope an opt-in compatibility pass for material/smoothing metadata. Do not silently triangulate arbitrary polygons or drop bad faces.

### P2 — Valid project can exhaust editing/export headroom

Near-limit reproduction: generate 1,320 façade windows, import, select 100 Façade0 edges and preview local Z +0.001. Preview is geometrically valid; commit exceeds full-project JSON capacity and returns false without history/state mutation. Save/restore of the original passes. A 1,350-window import is rejected. At 1,000 windows, XYZ rotation `[20,35,-40]` plus scale `[0.5,1.5,2]` can make baked export exceed re-import JSON capacity even though the current project fits.

Cause: full JSON validation and exact re-import preflight share the existing 5 MB limit; coordinate/normal precision expansion consumes headroom. It is safe refusal with a usability cost. Smallest follow-up: expose projected JSON budget/headroom and distinguish “valid preview, capacity-rejected commit” before considering a carefully measured configurable capacity increase. No automatic IndexedDB/binary storage migration is warranted by this stage.

### Remaining manual acceptance

Native adapter tests use stubbed dialogs with real temporary file I/O: project/OBJ writes, cancellation, invalid requests, unavailable destinations, atomic write failure and preservation of an existing file. Browser tests route actual downloads to temporary paths. Neither proves physical OS open/save dialog behavior, user cancellation, overwrite prompts, Finder permissions or modal focus recovery in the packaged desktop app.

Before release, manually test packaged app open/save/export cancellation, overwrite and an unavailable destination, then switch apps during an active drag and check cancellation/camera recovery. Save a near-limit project, restart and compare restored geometry; observe autosave status and retain an explicit file copy if browser quota rejects autosave. Unit tests cover quota failure and recovery preservation, but quota varies by runtime. Finally test a representative business building and sustained native Undo/Redo on the target deployment machine. These are uncompleted acceptance checks, not implied automated passes.

## E. Integration assessment

Existing UAV playback, path analysis, viewpoint data and built-in transformations are retained. Authored-asset tests compare drones/viewpoints before and after edits, route-analysis results and sampled playback poses. The existing import UI suite plays/pauses a route and renders path analysis after save/reload. Built-in object dimensions/yaw remain covered by their own transformation and export suites; UAV transformation semantics were not extended.

Current route analysis derives tracks from drone/viewpoint/timing data; it does not consume edited building triangle geometry for collision, visibility or coverage. Moving a wall therefore changes visualization, not computed route safety. No new dependency or planning algorithm was added.

Only one production line changed (`src/App.tsx`, normalized history shortcut). Other additions are test fixtures, test/benchmark scripts, audit evidence and this report. No mesh representation or project serialization changes were made.

## F. Release recommendation

**Ready with documented limitations for restricted-profile internal integration.** Ordinary workflows and the production pressure probe pass. General architectural OBJ compatibility and final packaged-desktop acceptance are not established. The reproducible development-only continuous-Undo failure remains an open P1 engineering issue; this recommendation does not label it resolved or promise production behavior on other hardware.

Minimum follow-up: isolate and fix the development update-depth failure while preserving the passing production regression, repeat pressure testing in the target desktop runtime, finish physical OS file-dialog acceptance, and validate one actual business building with an explicit supported export profile. Preserve capacity guards and report their practical consequences. Additional modeling features, storage redesign and a new development stage are outside this recommendation.

### Reproduction commands

```sh
npm run check
npm test
npm run build
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort
node --experimental-strip-types scripts/validate-obj-release.mjs --out /tmp/obj-corpus.json
node --expose-gc --experimental-strip-types scripts/benchmark-obj-editor.mjs --memory --out /tmp/obj-cpu.json
node --experimental-strip-types scripts/benchmark-history-memory.mjs --probe --out /tmp/obj-memory.json
```

Electron launcher pattern (run from repository root, with a running server):

```sh
OBJ_RELEASE_SCENARIO=stress node -e 'const {spawn}=require("node:child_process");const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const p=spawn(require("electron"),["scripts/verify-obj-transform-ui.cjs","http://127.0.0.1:5180/","release"],{env,stdio:"inherit"});p.on("exit",c=>process.exit(c??1));'
```

Scenario values are `authored`, `capacity`, `stress`; pressure controls are `OBJ_RELEASE_KEY_INTERVAL` and `OBJ_RELEASE_KEY_BATCH`. Batch `20` uses a 750 ms pause. Existing transform harness modes: default, `builtin`, `export`, `edit`, `elements`, `multi`; `verify-obj-ui.cjs` is the independent import/application suite. Production pressure probe: `verify-obj-production-stress.cjs` against Vite preview, without development-module imports. The optional cathedral requires a separately licensed local `--sibenik /absolute/path/sibenik.obj`; default validation is offline and reproducible.

### Changed files and validation evidence

| Files | Purpose |
| --- | --- |
| `src/App.tsx` | One-line history-key case normalization |
| `tests/obj-release.test.ts`, `tests/fixtures/obj-release/` | Four authored-asset regression tests; pinned original files and license/provenance |
| `scripts/obj-release-fixtures.mjs`, `scripts/validate-obj-release.mjs` | Controlled architectural generator, explicit diagnostics and CPU corpus validation |
| `scripts/verify-obj-release-cases.cjs`, `scripts/verify-obj-transform-ui.cjs` | Release scenarios registered in existing harness; existing no-console-error assertions retained |
| `scripts/verify-obj-production-stress.cjs` | Production-bundle native pressure regression without development imports |
| `docs/obj-editor.md`, this report, `docs/audits/obj-editor-5d-*.json` | Documentation and reproducible evidence |

Validation results: TypeScript check passed; **123/123 unit/integration tests** passed; production build passed. All **seven original Electron suites** passed after the shortcut fix. New authored and capacity scenarios passed; the native batched pressure scenario passed. The continuous development pressure scenario intentionally remains a failing regression with saved evidence. Production import/application and continuous pressure scenarios passed. Native dense-drag audit and renderer memory lifecycle suites passed. Corpus, five-case CPU benchmark and both controlled-GC probes completed successfully. No failure assertion was weakened to obtain these results.

Evidence:

- [Verification manifest](audits/obj-editor-5d-verification.json)
- [Compatibility and CPU corpus](audits/obj-editor-5d-corpus.json), [broader CPU benchmark](audits/obj-editor-5d-cpu.json)
- [Native pointer UI measurements](audits/obj-editor-5d-ui.json), [renderer memory lifecycle](audits/obj-editor-5d-renderer-memory.json)
- [Unchanged-normal memory](audits/obj-editor-5d-memory-plane.json), [normal-changing memory](audits/obj-editor-5d-memory-tilt.json)
- [Authored workflow](audits/obj-editor-5d-authored.json), [capacity boundaries](audits/obj-editor-5d-capacity.json)
- [Continuous development failure](audits/obj-editor-5d-stress-continuous.json), [batched native pass](audits/obj-editor-5d-stress-batch.json), [pre-fix native Redo failure](audits/obj-editor-5d-pre-fix-stress120.json)
- [Production continuous native pass](audits/obj-editor-5d-production-stress.json)

The initial corpus pilot overlapped unit tests and was excluded from reported performance; final CPU measurements ran serially after interaction tests. Preliminary production harness setup errors were corrected before measurement and are not application defects. The production pressure fixture is seeded through the existing project-replacement API; production file import/download/reload is independently covered by the original import suite. No production-only screenshot is used as evidence of physical-screen FPS.
