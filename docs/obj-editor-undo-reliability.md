# Stage 5E — Focused Undo/Redo Reliability Fix

Date: 2026-11-21. Branch: `feature/obj-editor`. Baseline: `67aca3d`. Scope: the development-mode native continuous-history failure documented in [Stage 5D](obj-editor-release-readiness.md). No changes to OBJ compatibility, storage limits, history representation/capacity, UAV semantics or dependencies. No commit or push is part of this stage.

## 1. Reproduction and investigation

The unchanged Stage 5D `release` stress scenario reproduced the failure before any production code changes: an imported 45,000-triangle attributed grid, 100 selected edges, sixty paced normal-changing commits, then sixty native Ctrl+Z events 50 ms apart. The expected geometry digest did not match; the renderer logged a passive update-depth warning and an uncaught maximum-depth error. The existing Ctrl+Shift+Z fix was retained.

The captured key stream was reduced to its first failing prefix: in the instrumented run, the passive counter reached 51 after key 51, the warning appeared on key 52, and key 53 encountered the nested-update exception. The remaining keys were unnecessary to trigger the defect. There were 60 captured Undo events but only 59 history-state dispatches: an exception interrupted one legitimate event. This is more precise than assuming the whole editor necessarily remained unmounted or permanently hung after the error.

No active transform or gizmo movement was necessary during that prefix. `cancelTransform` was the next state setter to encounter an already-exceeded root counter; it was not recursively calling Undo or originating the passive work. The resource size and event rate determine whether lower-priority work can finish; the observed 52/53-key boundary is not claimed as a universal minimum across devices or meshes.

Temporary, test-only instrumentation of the **installed React DOM 19.3.1 development dispatcher** recorded update source, priority lane, equality with current state, passive-effect phase and nested counters. It changed no application files. Instrumentation was removed and the original dependency file checksum restored before validating the correction. An initial trace attempt hit Vite's cached uninstrumented module and was discarded; the recorded trace came from a fresh service instance.

The [diagnostic evidence](audits/obj-editor-5e-diagnosis.json) contains selected trace events and controlled ablations. Ablations intentionally omitted selected redundant effect dispatches solely to isolate the cause; they are not release acceptance tests. Warnings were neither intercepted nor suppressed to manufacture a pass, and none of the ablation code remains in production or regression scripts.

## 2. Confirmed cause

This was an **input-driven scheduling chain**, not an effect independently changing project history forever:

1. Each native history key schedules the real history update at high priority (lane 2 in this installed renderer).
2. After its commit, `GroupTranslation`'s effect allocates and sets a fresh `[0,0,0]` even when the panel is already zero. Referential inequality creates another state update.
3. The editor's autosave effect also calls `setAutosaveStatus("saving")` on every committed project change, including when already saving. The trace shows equal-value requests still entering the queued update path under this workload; setter equality is not a guarantee that no work is enqueued when lanes already contain pending work.
4. These passive updates use lane 32. Before they settle, the next native event arrives. Commits combine lanes 2 and 32 (`34`) and schedule lane 32 again from their effects. The observed pending-lane and nested counters climb across the uninterrupted stream until React's guard is reached.

The observed passive state dispatches were confined to `GroupTranslation` and the editor autosave notification. Controlled experiments retained the full original workload:

| Diagnostic ablation | Result |
| --- | --- |
| Omit only the already-zero group reset | Still fails; autosave notification maintains queued passive work |
| Omit only equal-value editor passive status requests | Still fails; fresh zero-array resets maintain queued passive work |
| Omit both redundant sources | All 120 native keys pass; exact geometry recovery, no renderer errors; observed maximum nested update count 0 and passive count 1 |

The same input conditions passed in the production bundle in 5D. The trace explains the scheduling dependency and the effect of allowing a pause, but does not establish StrictMode itself as defective or prove an upstream React bug. StrictMode remains enabled. Different rendering costs can change whether pending work settles before the next input; production passing alone was not grounds to ignore the development exception.

## 3. Minimal correction

`src/core/editor.tsx`: mark the autosave status as saving **inside the history transaction when the committed project identity changes**, alongside `setHistory`. Remove that state update from the persistence effect. The effect still schedules the same 450 ms persistence timer, registers/unregisters `beforeunload`, and reports saved/error. Initial saving and paused-recovery behavior are retained; paused autosave is not changed to saving by history transitions. No history change means no new dirty notification.

`src/features/mesh-edit/VertexInspector.tsx`: reset the pending group delta on a committed project change only when it is nonzero. Use the existing synchronous pending ref to avoid dispatching a fresh zero array when there is nothing to reset. A typed nonzero delta still resets both the pending application and its visible values. Successful Apply still clears its fields as before.

The implementation changes only these two state synchronization sites. It does not throttle, debounce, ignore auto-repeat, reduce the number of keys, lengthen the original interval, reduce history capacity, disable StrictMode or catch/suppress React errors. Undo/Redo, cancellation, keyboard handling, geometry transforms and cache algorithms are unchanged.

## 4. Verification

The original stress script is unchanged. Its native key events, 60-entry setup, no-pause 50 ms sequence, 120-key assertion, exact resource digests and parent harness no-console-error assertion remain in force. `validate-undo-reliability.cjs` runs cases serially with a fresh Electron profile per invocation and records nonzero exit codes as failures. It additionally uses 35 ms and 120 ms continuous input and the existing 750 ms pause every twenty keys.

`verify-history-state-cases.cjs` fills nonzero group deltas using inspector inputs and uses actual Electron Ctrl+Z/Ctrl+Shift+Z events. It checks visible reset and the pending Apply behavior, exact whole-project recovery, saving/error/saved transitions, quota-failure preservation of the previous localStorage value and recovery through the next Redo. Dialogs, private editor state setters or mocks do not replace the native history key path. Private React context inspection is test-only; the test reads the current root's public editor methods rather than treating a stale alternate fiber as current state.

Final results: **123/123 automated unit/integration tests**, TypeScript checking and production build passed. All **17 serial Electron invocations** passed, including the seven original interaction suites. Every invocation had a fresh profile; the original no-console-error assertion remained active.

| Scenario | Before | After |
| --- | --- | --- |
| Original uninterrupted 50 ms native Undo/Redo | Reproduced depth error and geometry mismatch | 3/3 fresh instances pass; 120 keys each, exact base/tip geometry |
| Continuous 35 ms / 120 ms native input | Not repeated before this correction | Both pass, 120 keys each, exact geometry |
| Batched 50 ms, 750 ms pause every 20 keys | Passed in 5D | Pass |
| Production continuous 50 ms | Passed in 5D | Pass, exact geometry, no console errors |
| Nonzero pending delta, autosave dirty/error/retry | New targeted acceptance coverage | Pass, including whole-project equality |
| Original vertex/edge/face/multi-selection, object, built-in, export and import/application suites | Historical passes | All seven pass after correction |
| Dense native drag and renderer memory lifecycle | Historical passes | Both pass |

The original suites retain coverage for input-focus exclusions, Escape/window-blur/mode-change cancellation, camera recovery, visibility/locking, preview/candidate restrictions, save/reload, built-in dimension/yaw semantics and UAV playback/path analysis. The standalone initial post-fix 50 ms run also passed before the three-run final matrix; it is not substituted for that matrix.

## 5. Performance and memory safety

Topology lookup, immutable resource ownership, normal-array sharing, history eviction and geometry disposal implementations are untouched. All automated topology/history tests remain required. Focused remeasurement uses the existing native pointer audit for interaction latency and renderer-memory lifecycle suite for history/redo retirement, resource collection and scene buffer accounting. These exercise the changed component/editor lifetime paths; unrelated OBJ compatibility and storage-capacity benchmarks were not repeated.

CPU transaction timings and displayed frame rates must not be inferred from two-RAF UI observations. Controlled renderer garbage collection verifies retirement; residual process heap is not by itself a leaked-resource finding. Comparisons are against Stage 5D on the same host and are sample observations rather than guarantees on other hardware.

Observed native pointer latencies on the same Apple M3 Pro/ANGLE Metal host are below, in milliseconds (p50 / p95). There were 20 preview observations and five commit observations per row, with two-RAF/render-geometry observation overhead.

| Triangles / attributes | Preview 5D | Preview 5E | Commit 5D | Commit 5E |
| --- | ---: | ---: | ---: | ---: |
| 9,800 / none | 22.7 / 26.0 | 22.4 / 24.1 | 19.2 / 19.7 | 18.6 / 24.4 |
| 45,000 / none | 76.4 / 96.9 | 79.0 / 100.0 | 84.9 / 92.6 | 57.6 / 63.5 |
| 45,000 / UVs + normals | 79.1 / 122.6 | 83.1 / 118.0 | 113.0 / 119.5 | 79.7 / 89.8 |

These samples show no broad interaction-latency regression. Individual p95 values vary: the small-case commit p95 rose by 4.7 ms, and attributed large-case Undo p95 rose from 79.9 to 90.2 ms; only five samples underlie those tail observations. Large-case commit observations improved, while preview costs remain dominated by existing geometry/render work. Untimed selection-element resolution counts remained 21 per preview profile, matching 5D. No topology-query algorithm or cache ownership changed; automated topology tests pass.

The renderer memory suite passed 60 history entries, three Undo/Redo cycles, redo branching, deletion and full geometry-history eviction, with **zero update warnings**. Controlled-GC used heap: 23.44 MiB after import, 33.22 MiB after topology warming, 40.60 MiB at sixty unchanged-normal entries, 41.78 MiB after cycles, and 24.48 MiB after geometry-history eviction (5D: 24.61 MiB at eviction). WeakRefs confirmed collection of the original resource, normal array and discarded redo tip even with the 67,800-entry pure edge table held. This preserves the observed 5C resource-lifetime improvement. Normal-changing snapshot storage is still necessary and unchanged; this stage does not claim to reduce it.

## 6. Changed files

| File | Change |
| --- | --- |
| `src/core/editor.tsx` | Move dirty notification into the existing history transaction |
| `src/features/mesh-edit/VertexInspector.tsx` | Make project-change group reset idempotent |
| `scripts/verify-history-state-cases.cjs` | Focused native history/delta/autosave regression |
| `scripts/verify-obj-transform-ui.cjs` | Register the new history scenario; retain existing assertions |
| `scripts/validate-undo-reliability.cjs` | Serial reproducible native regression matrix |
| `docs/audits/obj-editor-5e-*.json` | Before/after, diagnosis, interaction and memory evidence |
| This report and documentation links | Root cause, fix, results and remaining acceptance scope |

## 7. Remaining risks and integration decision

The targeted application cause is established by the update trace, independent ablations and uninstrumented original regression. **The known reliability defect is resolved sufficiently for controlled internal integration review.** The original failing workload now passes repeatedly with exact geometry, alongside production, alternate-interval and regression coverage. Stage 5D’s historical open issue is closed by this targeted correction; its broader compatibility and manual-acceptance limitations remain. No evidence here broadens the supported OBJ profile or raises project capacity. Headless Electron input tests do not establish physical-screen performance, packaged OS-dialog behavior or reliability on every deployment machine. Dense meshes remain more expensive to edit; necessary normal-changing history storage remains a documented cost.

## 8. Manual acceptance before merge

- In the packaged app on the target machine, repeatedly hold Undo/Redo in Object and Edit Modes; include nonzero inspector deltas, a drag in progress and actual platform menu shortcuts. Verify geometry, cancellation and camera recovery.
- Test physical open/save/export dialog cancellation, overwrite and an unavailable or unwritable destination. Verify failures preserve the existing file and current project.
- Switch applications and open/close modal dialogs during dragging; verify cancellation and restored camera input.
- Save a near-limit project, restart the packaged app and compare restored geometry. Observe autosave/quota status and retain an explicit project file when local storage is unavailable.
- Validate a real business building using an explicitly supported geometry-only triangulated export profile; no such user-provided sample is currently available.
- Check displayed responsiveness on the deployment display/GPU, including relevant high-DPI or multi-monitor arrangements.

### Reproduce verification

Start separate development and production-preview services, with a fresh production build:

```sh
npm run check
npm test
npm run build
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5180 --strictPort
# In another terminal:
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5181 --strictPort
# In another terminal; all cases are serial and errors cause a nonzero exit:
node scripts/validate-undo-reliability.cjs http://127.0.0.1:5180/ http://127.0.0.1:5181/ /tmp/undo-validation
```

Run the unchanged original test alone with `OBJ_RELEASE_SCENARIO=stress` and harness mode `release`; use the Electron launcher pattern documented in Stage 5D. Mode `history` runs the new focused state regression. No diagnostic-only dependency patch is required or used for these commands.

### Evidence

- [State-update trace and causal ablations](audits/obj-editor-5e-diagnosis.json)
- [Original failure and uninstrumented after-fix stress/state results](audits/obj-editor-5e-stress.json)
- [Full verification manifest](audits/obj-editor-5e-verification.json)
- [Native pointer measurements](audits/obj-editor-5e-ui.json)
- [Renderer history/GC/resource-lifetime measurements](audits/obj-editor-5e-renderer-memory.json)

The first version of the new focused test returned a function from a storage-spy installation expression, which Electron could not clone. The test wrapper was corrected to return no value and rerun successfully; that harness-only preparation error is excluded from application findings. Final acceptance uses the normal, uninstrumented dependencies and unchanged original stress implementation.
