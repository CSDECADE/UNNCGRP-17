# OBJ Import, Object Mode, Export and Mesh Translation — Stages 1–4C

## Scope

Stage 1 introduced a serializable resource format and its persistence through the existing project pipeline. Stage 2 added local OBJ import, rendering, object management, and basic project JSON save/restore. Stage 3A added OBJ transformations. Stage 3A+ extended the same controls and inspector to the built-in building, cuboid and cylinder while retaining their existing yaw and dimension semantics. Stage 3B added selected-OBJ export with baked transforms and verified re-import compatibility. Stage 4A added Edit Mode with logical vertex selection and translation. Stage 4B extended the same workflow to individual edges and triangular faces. Stage 4C adds same-type multi-selection and group translation within one submesh. UAV editing and topology operations remain outside the implemented scope.

Resources are stored in the existing `Project` state. They are not a second scene or editor state. An imported file creates one `kind: "obj"` instance in the existing `models` list; its `resourceId` references the geometry, including multiple submeshes. Stage 1 version 2 projects containing unattached resources remain valid. Existing built-in models and UAV workflows remain unchanged.

## Project Compatibility

- Version 1 retains its existing structure and behavior. Loading or saving a legacy project does not upgrade it automatically.
- Version 2 requires an `objResources` array, which may be empty. Each resource is embedded in the project JSON; no filesystem path or external cache is required to restore its geometry.
- Adding resources requires explicitly creating a version 2 project. A version 1 project containing `objResources` is rejected rather than accepting an extension that older readers would silently discard.
- Existing older builds reject version 2 as unsupported. They cannot safely open or edit these files.
- Unknown version 2 project fields and unknown resource, mesh, or vertex fields are rejected. Future unsupported geometry extensions must not be silently removed during validation.

The existing `parseProject()` and `validateProject()` entry points accept both versions. `serializeProject()` validates the complete project and produces a self-contained JSON string for persistence. Both automatic saves and the Stage 2 project-file fallback use this encoder. Version 1 cannot contain OBJ instances; version 2 instances must reference an existing resource. Stage 1 builds reject the new instance kind rather than opening it incorrectly.

## Resource Representation

The data types are defined in `src/core/types.ts`; resource validation is implemented in `src/core/obj-resource.ts`.

```ts
type ObjResource = {
  id: string;
  name: string;
  format: "obj";
  vertices: { id: string; position: [number, number, number] }[];
  meshes: {
    id: string;
    name: string;
    triangles: number[];
    uvs?: number[];
    normals?: number[];
  }[];
};
```

Each vertex has a stable resource-local ID and a position in local coordinates, measured in metres. Distinct vertices may occupy the same position; validation never merges them. Resource IDs are unique within a project. Vertex IDs and mesh IDs are unique within their respective resource.

Each consecutive triple in `triangles` indexes the resource's logical vertex array. The array index is a compact serialized reference, not a GPU buffer index or persistent selection identity. Future editing code must identify vertices by their stable IDs and maintain references if it changes vertex ordering. Stage 1 does not change topology or vertex order.

UVs and normals are optional, flat arrays associated with triangle corners. UVs contain two numbers per corner; normals contain three. This allows triangles to share a logical vertex while retaining separate UVs or normals at seams. A later renderer can expand these references into render vertices without making render indices the source of editable vertex identity.

The format supports multiple triangle meshes within a resource. It does not represent original polygon boundaries, materials, textures, lines, points, smoothing groups, or arbitrary OBJ metadata. The Stage 2 importer rejects unsupported directives rather than claiming a lossless conversion of every OBJ file. Supplied normals are retained; meshes without normals receive flat triangle normals in their runtime render buffers.

## Geometry and Object Transformations

Resources contain local geometry only. Existing `Model.position`, `Model.rotation`, and `Model.size` retain their current built-in-model semantics. They do not modify stored OBJ vertices, and OBJ resources do not implicitly transform UAVs, viewpoints, or paths.

Imported instances use a dedicated OBJ render branch, not the built-in box fallback. Import preserves source coordinates: +Y is up and units are interpreted as metres. It does not recenter, rotate, scale, or ground the source geometry. The initial instance has zero position and yaw. Its `size` is a bounds descriptor (with a minimum of 0.1 per axis for the existing model contract), not a geometry scaling command. Selection feedback and focus account for the actual local bounds and the complete object transform, including off-origin and planar models.

Resource validation makes independent copies of accepted arrays. Runtime geometry and editing drafts must remain separate from committed resource data. Future geometry edits should replace only the affected resource data on commit, keeping previous history states immutable.

## Capacity and Failure Handling

The existing maximum project-file size remains **5,000,000 UTF-8 bytes**, including geometry, viewpoints, background images, and all other project fields. This limit is enforced when parsing, validating an in-memory project, and serializing it. The existing Electron file channel enforces the same byte limit without modification.

No independent vertex-count limit is introduced: the encoded project size is the acceptance criterion. For illustration, a generated fixture with one mesh, sequential triangle references, short vertex IDs, and no UVs, normals, or background image produced:

| Logical vertices | Triangles | Serialized UTF-8 bytes |
| --- | --- | --- |
| 1,000 | 333 | 48,726 |
| 10,000 | 3,333 | 523,025 |
| 50,000 | 16,666 | 2,703,018 |

These measurements are examples, not supported-complexity or performance guarantees. Coordinate precision, identifiers, corner attributes, and existing scene content materially affect capacity.

Browser storage quotas are separate from the file limit and vary by environment and available storage. A project below the file limit can still fail to autosave. Serialization occurs before `setItem()`; invalid or oversized data is not written. Quota or storage-access failures return the existing `error` status, which the current UI exposes as a persistent notice. The module does not truncate geometry, delete previous saves, or automatically retry by omitting resources. The current committed project remains in memory.

The optional `project-files` module is absent in this checkout. Stage 2 supplies a narrowly scoped fallback through its existing hook contract: save a complete project JSON, open a project JSON, and reset the document path for a new project. Electron uses the existing JSON IPC and atomic file writer; browser preview requests a JSON download and restores through the existing hidden file input. Advanced file management and plan export are not implemented. An installed `project-files` module continues to take precedence over this fallback.

## Validation and Verification

Validation rejects unsupported project/resource versions and fields, duplicate IDs, missing or empty resource geometry, malformed triangle lists, non-integer or out-of-range references, non-finite values, and inconsistent corner attribute lengths. Local vertex coordinates use the existing scene coordinate range of -10,000 to 10,000 metres. Coincident vertices and degenerate triangles are retained; geometric repair is outside this stage.

Run the existing checks:

```sh
npm run check
npm test
npm run build
```

`tests/obj-persistence.test.ts` covers legacy compatibility, version 2 round trips, multi-mesh and seam data, invalid inputs, detached validation results, object-transform/history compatibility, candidate-plan preservation, UTF-8 byte boundaries, oversized geometry, storage quota failures, and actual file reads/writes through `desktop/files.cjs`. The disk test verifies that an oversized write leaves the existing file unchanged.

Storage quota failures are simulated deterministically in the test suite. The optional Electron UI smoke test also checks the visible failure notice and verifies that the file-save fallback retains geometry after a simulated quota failure. Real platform quota exhaustion and native OS file dialogs still require manual verification.

## Stage 2 Usage

1. Launch the application with `npm run dev`, or use `npm run dev:web` for browser preview.
2. Open the **Model** menu on the bottom toolbar and select **Import OBJ** (`导入 OBJ…`).
3. Select a supported `.obj` file. Import adds one model, selects it, and focuses the camera on its actual geometry. It switches out of playback preview without changing UAV paths or viewpoints.
4. Select the model in the viewport or the object list. Use the existing visibility, lock, duplicate, delete, and focus controls. Locked models can be selected but cannot be deleted, duplicated, or transformed. Stage 3A also enables the Move, Rotate, and Scale tools for editable OBJ instances.
5. Select **Save** or **Save Project File**. The complete JSON includes all imported geometry. In browser preview, confirm that the requested download completed.
6. Use **Open Project** from the project menu to restore the JSON, or reload to restore the most recent successful local autosave. A failed autosave does not include later edits: save a project file before closing.

Use `tests/fixtures/obj-building.obj` as a small import example. Its two walls are offset from the built-in example building so viewport selection can be tested without overlapping that building.

## Supported OBJ Syntax

| Syntax | Support |
| --- | --- |
| `v x y z` | Three finite coordinates; source-order IDs `v1`, `v2`, etc. remain distinct even at identical coordinates. All declared vertices, including unused vertices, are retained. |
| `vt u v` | Exactly two finite texture coordinates. |
| `vn x y z` | Three finite components and a nonzero normal. |
| `f v …`, `v/vt`, `v//vn`, `v/vt/vn` | Positive or negative nonzero integer indices into declarations already present at that line. Forward references are rejected. |
| Triangular faces | Nondegenerate triangles with the supplied winding preserved. |
| Quadrilateral faces | Strictly convex, planar quads split along the first-to-third corner diagonal. Degenerate, concave, self-intersecting and non-planar quads are rejected. Other polygons must be triangulated before import. |
| `o`, `g` | Object/group boundaries start submeshes lazily when a face follows. Only one group name per directive is supported. Object/group labels are limited to 70 characters each. |
| `s off`, `s 0` | Accepted. Other smoothing groups are rejected. |
| Comments and whitespace | Full-line/inline `#` comments, UTF-8 BOM, LF/CRLF, and scientific notation are supported. |

All corners within a face, and all faces within one submesh, must consistently provide or omit each optional UV/normal attribute. Submeshes may use different attribute layouts. Source vertex references determine connectivity; positions are never used to weld vertices. Per-corner attributes are copied to each triangle corner during triangulation, preserving supported seams. Existing scene limits still apply: at most 500 models, local coordinates within ±10,000 metres, and model dimensions no greater than 10,000 metres per axis.

Material directives (`mtllib`, `usemtl`), lines, points, free-form surfaces, vertex colors/weights, line continuations, unsupported attribute arities, and all unrecognized directives fail with a line-numbered error. Disable material export and smoothing groups when preparing a file, or simplify it in a modeling tool first. The renderer uses a neutral double-sided material; UVs are retained for future use but no texture is loaded. Rendering uses Float32 buffers, and importer values must be within the finite Float32 range.

The parser is intentionally small and restricted. Using `OBJLoader` alone would not retain the original logical vertex identities required by the project resource format. Stage 2 therefore parses this documented subset directly and uses the existing Three.js `BufferGeometry` for rendering; no new dependency or parallel renderer is introduced.

## Scene and History Integration

`prepareObjImport()` prepares and validates the entire next project before `useEditor().importObj()` commits it. Raw OBJ size and resulting serialized project size are both checked; a small source file can expand past the project limit. An unsuccessful import leaves the current project unchanged. A successful import is one undoable action.

`ModelObject` reuses the existing `Transformable` selection and pointer behavior. Each imported submesh receives its own runtime buffers through `createObjGeometry()` and `ImportedMesh`. No geometry is shared mutably between instances. Buffers compute normals when absent and update bounds on construction; component cleanup disposes them. Materials follow the existing declarative React Three Fiber lifecycle.

Duplicates may reference the same immutable resource but own independent render buffers. Deleting the final instance removes its resource from the current snapshot; existing history states retain their own data. Resources that were already unattached in a Stage 1 project are preserved. The existing playback and candidate-plan workflows retain OBJ models and resources without transforming paths.

## Stage 2 Verification

`tests/obj-import.test.ts` covers triangles, quad triangulation, negative indices, multiple submeshes, logical connectivity, coincident vertices, UV/normal seams, malformed and unsupported files, instance validation, legacy compatibility, bounds, independent render buffers, resource cleanup, candidate plans, and the resulting-project byte budget.

For an optional UI smoke test, start `npm run dev:web -- --port 5176 --strictPort` in one terminal. In another terminal on macOS, run:

```sh
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-ui.cjs http://127.0.0.1:5176/
```

The script runs the real application page in an isolated Electron profile. It supplies files to the real input handler, sends native mouse events for viewport selection, checks list selection, visibility, locking, import undo/redo, focus, browser-download save, file restore, reload recovery, invalid input, playback, analysis, and simulated quota failure with file-save recovery. Screenshots and downloaded snapshots are written to a temporary directory reported on completion. This tests the browser fallback inside Electron; it does not exercise native file-picker dialogs or the packaged desktop preload.

Manual acceptance checks:

1. Import the supplied fixture through the native picker; confirm both walls render as one list item. Select it from the viewport and list; double-click or press **F** to focus.
2. Hide/show and lock/unlock it. Confirm a locked model remains selectable and rejects deletion; unlock and delete, then undo/redo.
3. Save JSON, close/reopen the application, and open the saved file. Confirm model appearance and supported attributes survive. Repeat with a legacy version 1 project.
4. In desktop mode, cancel open/save dialogs, save to a writable path, and attempt an unwritable path. Confirm errors do not replace the current project or discard geometry.
5. Import an unsupported OBJ and a project-expanding oversized OBJ. Confirm a useful error and an unchanged scene.
6. Navigate with orbit/pan/zoom, add or inspect viewpoints, run playback, and open path analysis. Confirm the original UAV paths and viewpoint targets remain unchanged.

Stage 2 did not implement object transformations; those are documented below for Stage 3A. Very large or tiny models may exceed the existing camera's practical clipping/zoom range even when their data fits the file budget; no automatic coordinate normalization is performed.

## Stage 3A: Object Transformations

Select an imported OBJ and use **Move (M)**, **Rotate (R)**, or **Scale (K)**. The visible gizmo operates on the entire logical model, including every submesh. Drag an axis, plane, or rotation ring; use the centre scale handle for uniform scaling. Releasing the pointer commits one history entry. **Esc** cancels an active drag and returns to the selection tool.

The inspector provides XYZ position, rotation, and scale inputs. Press **Enter** or leave the field to commit one numerical edit. **Esc** in an input discards its pending text without running scene shortcuts. Fields display up to four decimal places; saved values retain their numerical precision. Inputs are disabled during a gizmo drag and reflect its live draft. Pending inspector text is committed before a new gizmo gesture caches its start state. A rejected numerical transaction restores the field to its actual project value.

### Representation and Compatibility

Only OBJ instances gain these optional fields:

```ts
rotationXYZ?: [number, number, number]; // XYZ Euler angles, degrees
scale?: [number, number, number];       // positive local-axis factors
```

Without `rotationXYZ`, the existing scalar `rotation` is interpreted as `[0, rotation, 0]`. Without `scale`, factors are `[1, 1, 1]`. Old Stage 2 files therefore retain their exact appearance and do not require a bulk migration. Built-in models continue to use their original yaw and size fields; Stage 3A+ supplies their interactions through the same Object Mode without requiring the missing manual module.

When `rotationXYZ` is present, it is the full orientation and the scalar `rotation` must equal its Y component. Transactions maintain this compatibility mirror, and validation rejects inconsistent saved values. `size` remains the original unscaled bounds descriptor. New fields stay within version 2; Stage 2 readers reject these unknown fields rather than silently dropping transformations.

### Coordinates and Pivot

- **Position** is the object origin in world metres; parent scene groups are untransformed. OBJ origins may have negative Y. Each position component is bounded to ±10,000 metres.
- **Orientation** uses right-handed XYZ Euler angles in degrees. Rotation gizmo axes follow the current local orientation. Euler values describe the complete orientation; dragging a local ring can change more than one displayed component.
- **Scale** uses local-axis factors, limited to 0.01–10,000. Zero, negative/mirrored, and non-finite factors are not accepted. Interactive crossings through zero clamp to the minimum positive factor.
- **Pivot** is the centre of the resource's local geometry bounding box, transformed into world space. Both the gizmo and numerical rotation/scale operations preserve this world-space centre. They compensate the object's origin position when needed; seeing position values change during rotation or scaling is expected. Direct position edits translate the entire model.

The object matrix is `T(position) · R(XYZ) · S(scale)`. Local geometry and submesh relationships remain unchanged. The control target is a single empty runtime group at the centre pivot, not another model or project state. `objPositionFromPivot()` converts its transform back to the stored object origin. This adapter keeps the gizmo usable for files whose source geometry is far from their origin without rewriting vertices.

Position bounds can prevent exact centre preservation at extreme transforms. Focus uses the transformed bounding box; press **F** after large size changes to refit the view. Euler angles have the usual gimbal-lock and equivalent-angle representations near singular orientations. Quaternion calculations are used at runtime, but the persisted and numerical representation remains explicit XYZ Euler angles.

### Transaction and Input Lifecycle

`ObjectGizmo` uses the installed Three.js `TransformControls`. Both it and `TransformInspector` call the existing `beginTransform()`, `updateTransform()`, and `finishTransform()` methods; drafts and committed project history remain in `useEditor()`. Drag updates do not create history entries or autosave geometry. A no-op produces no entry. Completion validates serialization against the existing file budget before committing; if that check fails, the draft is discarded with a message.

Cancellation discards the transaction and restores runtime transforms. It also occurs on pointer cancellation, window blur/backgrounding, selection/tool/view changes, preview activation, and the existing undo/redo flow. A late pointer-up cannot commit a cancelled session. Saving during an active drag remains blocked by the existing project snapshot guard.

Camera orbit is disabled while a gizmo drag is active and restored on completion or cancellation. Gizmo helpers are tagged as editor overlays, and the existing scene-input context suppresses selection clicks from the gesture. The input boundary composes with an installed `manualControls` provider rather than replacing it. Static-model transforms do not depend on that optional module. Static models use the shared gizmo rather than the optional provider's direct pointer-drag handler; no manual module is recreated. A future manual-module integration must avoid rendering a second static-model gizmo.

Locked/hidden models, playback, preview, candidate plans, and the drone camera view prevent OBJ editing. Entering preview retains the application's existing switch to the selection tool; choose a transform tool again after leaving preview. Full object matrices affect the imported model only: UAV positions, routes, viewpoint targets and timestamps are not rewritten.

Geometry buffers and materials remain owned by the existing imported-mesh renderer. Gizmo disposal releases its helper geometry, materials, DOM listeners and target attachment. OBJ annotation labels are positioned outside the transformed group so object scaling does not enlarge their screen size.

### Stage 3A Verification

`tests/obj-transform.test.ts` covers per-axis translation/rotation, positive uniform and non-uniform scales, centre compensation, single-entry transaction history, cancellation/no-op/stale transactions, legacy representations and built-in transforms, invalid data, locked/hidden restrictions, resource immutability, and transformed multi-submesh bounds.

With the Vite preview running, execute the optional Electron integration test:

```sh
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/
```

This isolated-profile test uses native mouse events to drag installed gizmo handles and native text input for the inspector. It checks live numerical feedback, camera suspension/recovery, one-step undo/redo, cancellation, numerical XYZ transforms, rotation and non-uniform/uniform scale, edit restrictions, unchanged local geometry and UAV data, and saved/reloaded transforms. The test inspects the development Fiber root and control picker solely to locate handles; these test internals may need adjustment when rendering dependencies change. No diagnostic global state is added to production code.

Manual checks:

1. Import the supplied multi-wall fixture. Drag each translation axis and each rotation ring; confirm all submeshes move as one object. Try planar and off-origin models in perspective and orthographic views.
2. Adjust each numerical component, verify the gizmo follows it, and undo/redo. Change a value and press Esc before committing; confirm the project remains unchanged.
3. Drag and press Esc, switch tools, change selection/view, or leave the window. Confirm the original model returns, orbit navigation works, and a subsequent pointer-up adds no history entry.
4. Exercise axis, plane and uniform scale handles. Confirm positive clamping near zero and verify normals, selection feedback and focus after combined rotations/non-uniform scale.
5. Lock/hide the selected model, enter playback or candidate preview, and switch to the drone camera. Confirm the corresponding restrictions, then return to editing and choose a tool again.
6. Save and reopen project JSON in browser and desktop modes. Check transformed appearance and unchanged paths/targets. Recheck a version 1 built-in scene and an older version 2 OBJ file.

Stage 3B export and the later Edit Mode stages are documented below. Stage 3A itself changes object transforms only. Material/texture export and topology operations remain outside the implementation.

## Stage 3A+: Built-in Static Models

Select a building, cuboid or cylinder from the existing list or viewport, then activate **Move (M)**, **Rotate (R)** or **Scale (K)**. These models use the same `ObjectGizmo`, `TransformInspector`, transaction lifecycle, camera suspension, cancellation, and history as imported OBJ instances.

| Model | Position | Rotation | Scale tool / numerical dimensions |
| --- | --- | --- | --- |
| Built-in building | XYZ world position of the bottom-centre origin | Y-axis yaw only, degrees | Edits the existing XYZ size parameters in metres; the existing GLB child group scales relative to its nominal 24 × 18 × 14 base dimensions. |
| Cuboid | Same | Same | Edits width X, height Y and depth Z in metres; the original procedural geometry is rebuilt. |
| Cylinder | Same | Same | Edits X diameter, Y height and Z diameter in metres, retaining the existing elliptical-footprint behavior. |

The built-in pivot stays at the bottom-centre origin. Rotation and dimension edits do not compensate or change `position`; increasing height extends the model upward from the same anchor. The inspector shows **Dimensions** (`尺寸`) in metres, not OBJ-style scale factors. The scale gizmo still supports axis and uniform handles, but its empty runtime target's scale values represent absolute dimensions; `modelControlValues()` converts them into `size` updates. They are never written as a new model `scale` field. The real rendered parent group remains at identity scale, leaving the existing rendering code responsible for dimensions.

Only the Y rotation ring is available for built-ins. X/Z rotation rings, screen-space rotation and free rotation are disabled. `yawDegrees()` unwraps quaternion-derived yaw relative to the existing scalar angle rather than reading an Euler Y value that can flip beyond 90°. The numerical inspector likewise exposes only Rotation Y.

Existing limits remain: position components within the supported scene range, edited Y position at least zero, yaw within ±10,000°, and dimensions 0.1–10,000 metres. Dimensions retain the existing positive-size constraints, including how gesture values are clamped. Project validation and rendering contracts are unchanged. A version 1 project containing only built-ins remains version 1 after editing and saving; no OBJ transform fields or geometry resources are added.

Selection, focus, visibility, locking, candidate preview, playback and drone-camera restrictions follow the same static Object Mode conventions. Inspector fields track the live gesture and remain disabled during dragging. Each completed gesture is one undo entry; cancelled and unchanged gestures add none. The whole-project serialization check also runs before committing built-in gestures. Static-model changes do not modify UAV poses, viewpoint positions/targets, route timing or analysis inputs.

### Reuse and Verification

`src/core/model-transform.ts` is a small adapter between model semantics and the installed `TransformControls`. It branches only for the OBJ versus built-in data contracts. OBJ centre compensation and full XYZ orientation continue to use `obj-transform.ts`; built-ins keep bottom anchoring, scalar yaw and physical dimensions. The existing `manualControls` loading mechanism remains available for other modules, but the static editing integration does not depend on it.

`tests/builtin-transform.test.ts` covers all three types, control-to-data conversion, continuous Y yaw, absolute dimension updates, bottom anchoring, history/cancellation, hidden/locked restrictions, version 1 round trips, and unchanged UAV playback and analysis results, including timestamped routes.

Use the shared Electron UI harness in built-in mode:

```sh
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ builtin
```

The additional cases reuse the existing native mouse and text-input helpers. They exercise all three built-ins, check that unsupported rotation handles/inputs are absent, compare rendered dimension ratios with inspector parameters, verify the real parent stays at identity scale, and test cancellation, history, visibility/locking, preview/candidate restrictions, version 1 file save/reload and UAV playback. Run the original command without `builtin` for OBJ regression, and `scripts/verify-obj-ui.cjs` for the Stage 2 regression.

Manual acceptance should additionally cover each axis and plane handle in perspective and orthographic views, repeated tool/view switches during a gesture, dimension clamping near zero, native desktop file dialogs, and loading an existing project containing both OBJ and built-in models. For the cylinder, confirm that changing the X/Z diameters changes the footprint without adding X/Z rotation.

## UAV Editing Recommendation — Not Implemented

The current drone contract contains `position`, a scalar Y-axis `rotation`, and `fov`. It has no object scale or full XYZ orientation. Outside preview, `DroneObject` renders the stored position and body yaw. In preview, `poseAt()` supplies positions from the viewpoint route, and the body yaw is derived from the interpolated camera target. When a route exists, its first viewpoint is the preview start; changing the stored drone position would not move that route. The drone-camera view also follows route/target data, so it is not simply a view through the stored body yaw.

A future UAV editing feature should therefore label these fields as a **scene/parked pose**, editable only outside playback, preview and candidate mode. Such an operation would update only `Drone.position` and `Drone.rotation`, use the existing transaction/history system, and explicitly leave route points, targets and timestamps unchanged. It should not be described as editing a takeoff keyframe unless a separate rule links it to a route point.

Waypoint position and camera-target editing should remain explicit viewpoint operations. Translating a whole trajectory should be a separate, clearly named command with an explicit policy for whether camera targets move too. It must not be inferred from dragging the drone. No UAV gizmo, numerical pose editor, waypoint edit or trajectory transformation is added in Stage 3A+.

## Stage 3B: Selected OBJ Export

Select an imported OBJ instance and choose **Model → Export Selected OBJ** (`导出所选 OBJ…`) on the bottom toolbar. The action is unavailable for built-in models, UAVs, viewpoints, an empty selection, an active transformation, or a candidate plan. Complete or cancel a numerical edit or gizmo gesture before exporting. Hidden and locked imported models can be exported: this is a read-only operation. Playback does not change static model geometry, so exporting a committed static OBJ remains permitted during playback.

Only the selected instance's referenced resource is serialized. Other instances, built-in geometry, UAVs, trajectories, viewpoints, grid helpers, selection outlines and gizmos never enter the output. Export does not update project data, source resources, selection, pivot, transformation fields, autosave contents or history. Undo after export still undoes the preceding edit. Importing the resulting file is a separate, ordinary undoable import.

### Serialization and Transform Conventions

`src/features/obj-export/obj.ts` implements a dedicated serializer over the existing project resource. The installed Three.js `OBJExporter` reads render buffers, which expand logical vertices into triangle corners in this application. It can also emit `usemtl`, which the restricted importer rejects. Exporting project data avoids topology expansion and helper filtering, requires no dependency, and keeps the serialized resource as the source of truth.

- Emit every logical vertex once, in resource order, including unused vertices and independently indexed vertices at identical positions. Never weld or recenter vertices.
- Bake the existing matrix `T(position) × R(Euler XYZ) × S(scale)` into vertex positions exactly once. Legacy OBJ instances use their scalar Y rotation and unit scale defaults. The existing centre-pivot compensation is already part of `position`; export adds no further pivot offset. `size` remains descriptive data and is not applied as another scale.
- Transform supplied normals using the inverse transpose of the matrix's linear part, then normalize. Positive scale factors preserve winding. Export does not synthesize normals for meshes without supplied normals; re-import generates their usual flat render normals.
- Retain each triangle's logical indices and winding, mesh order, mesh name, UV values and per-corner normal directions. Exact duplicate UV/normal values may share OBJ attribute indices; vertex identity is independent of those attribute indices. UV and normal seams therefore remain intact.
- Start a new object/group boundary for each submesh, including repeated names. Names produced by the importer remain representable; long combined `object/group` names are split into compatible `o` and `g` directives. Project-authored names that cannot be represented faithfully fail explicitly.
- Emit only comments, `v`, `vt`, `vn`, `o`, `g` and triangular `f` directives with positive references to existing declarations. No MTL files, materials, colors, smoothing groups, editor metadata or texture files are exported. Numerical output retains JavaScript double precision; rendering still uses Float32 buffers.

Re-import creates a new resource and instance at identity transform. The baked geometry occupies the same world-space location. Resource/vertex IDs, instance metadata, original transform fields and the original editing pivot are not OBJ interchange metadata; use project JSON to preserve the complete editing session. Future rotations of the re-imported instance use the usual bounds-centre pivot of its baked geometry.

### Limits and Preflight

Standalone OBJ input and output have an independent **16,000,000 UTF-8 byte** limit. Project JSON retains the existing **5,000,000-byte** limit. The OBJ parser scans lines without allocating a full line array and rejects non-comment instruction lines longer than 4,096 characters. The serializer accounts for output bytes incrementally before joining its bounded chunks; it does not expand the source into runtime render geometry. Validation, attribute tables and the re-import check still consume additional memory and run synchronously, so exports near the limit can briefly pause the UI.

Before opening a save dialog or requesting a browser download, export runs the exact `prepareObjImport()` pipeline against an empty project. This enforces valid triangles, the current ±10,000-metre coordinate and 10,000-metre dimension limits, finite supported attributes, and the restored project JSON budget. A valid edited project can have baked coordinates or expanded normalized corner attributes outside these limits; export reports that failure and writes nothing. It does not clamp, truncate, discard unused vertices or change topology to make the file fit. Re-import into an already populated project remains subject to that project's remaining capacity and model count.

### Browser and Desktop Saving

The browser requests a plain-text Blob download with a sanitized `.obj` basename of at most 160 characters. Blob URLs and temporary anchors are released through the same `downloadText()` helper used by project JSON saving. Browser feedback confirms that a download was requested; completion or cancellation must be checked in the browser's download UI.

Electron uses the separate `p15:save-obj` preload/IPC channel. It shares the existing sender authorization, file-operation exclusion, safe error mapping and atomic temporary-file/rename writer. `desktop/obj-files.cjs` validates the text budget and filename independently, presents an OBJ-only save filter and writes plain text. Cancellation returns without writing. A destination without an `.obj` suffix is rejected instead of silently renaming it after overwrite confirmation. Write failures preserve the previous destination and remove temporary output. OBJ export never changes the project's document path or recent-project list. JSON open/save validation remains JSON-only and retains its original byte limit. An older desktop preload requires an application restart to enable the new channel.

### Verification

`tests/obj-export.test.ts` compares logical vertices, winding, connectivity, groups, UVs and normal directions after export/re-import. Cases cover identity, translation, XYZ rotation, uniform/non-uniform scaling, off-origin pivot compensation, seam attributes, coincident and unused vertices, all supported face forms, invalid data, safe filenames, text budgets and restored-project expansion. CPU comparisons use relative tolerance `1e-9`.

`tests/obj-save.test.ts` exercises the real atomic OBJ writer, independent JSON validation, dialog cancellation, rejected destinations, UTF-8 limits, permission/disk/read-only errors, preservation of an existing file after a simulated rename failure, browser/native adapter outcomes and the dedicated preload channel. Native dialogs are injected in these tests; they do not claim to exercise the operating system's picker UI.

With the Vite server running, execute:

```sh
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ export
```

The isolated-profile integration test applies numerical transforms, checks export restrictions during an actual gizmo gesture, simulates desktop cancellation/write errors, downloads the OBJ through the browser path, verifies unchanged project/history, re-imports the downloaded file and compares actual rendered mesh corners within `1e-4` metres. It also checks UV/connectivity preservation, project JSON saving, unsupported selections and unchanged UAV/path data. Development-only Fiber inspection remains confined to test code.

Run `npm run check`, `npm test`, `npm run build` and the existing Stage 2, Stage 3A and Stage 3A+ Electron suites as regressions. On a packaged desktop build, manually verify the native OBJ picker, cancellation, writable/unwritable destinations, overwrite confirmation, incorrect suffix rejection and a subsequent project Save to confirm that its original document path is retained. In an external browser, confirm the downloaded filename and download cancellation behavior. Exercise a larger representative asset on the target machine to assess responsiveness.

### Export Contract for Mesh Editing

The serializer reads the current resource, not the original source text or a cached GPU mesh. Stage 4A uses the same export path without changing its format. Edits must maintain valid logical indices and complete per-corner attributes. Vertex/mesh IDs need not survive OBJ interchange, but independently indexed vertices must remain independent. Degenerate triangles and unsupported names are rejected before saving. Stage 3B itself introduced no geometry editing.

## Stage 4A: Edit Mode and Vertex Translation

### Workflow

1. Select a visible, unlocked imported OBJ. Built-in parametric models and UAVs cannot enter Edit Mode.
2. Use the **Object Mode / Edit Mode** button on the bottom toolbar. **Tab** toggles modes when the viewport or document body has keyboard focus; text fields, dropdowns, dialogs, menus and other controls retain their ordinary keyboard behavior.
3. Choose the active submesh in the vertex inspector. Its referenced logical vertices appear as blue points; click within 10 CSS pixels to select a visible vertex. The selected vertex is orange, and its stable ID appears in the inspector.
4. Press **M** or choose Move, then drag a world X, Y or Z handle. The inspector shows the live model-local coordinates. Precise local coordinate inputs use the same transaction path.
5. Release to commit one history operation. **Esc**, window blur, pointer cancellation, tool/view changes or leaving Edit Mode cancel an active gesture. Camera navigation is suspended during the drag and restored afterwards. Esc keeps the logical vertex selected and returns to the selection tool.
6. Undo/redo, save project JSON or export the selected OBJ normally. Export and project save are blocked while a vertex transaction is active. Re-import the exported file to obtain the edited world geometry at identity object transform.

Mode and vertex selection are transient editor state, not project metadata. Reload or opening a project starts in Object Mode. Selecting a different object in the list exits Edit Mode. Hiding/locking the active model, entering playback/candidate preview or switching to the UAV camera exits Edit Mode and cancels any draft. Other camera views remain available. During Edit Mode, canvas clicks do not select unrelated models or create viewpoints; object rotation, scaling, object duplication and deletion are unavailable.

### Selection Architecture

`VertexSelection` in `src/core/mesh-edit.ts` contains `{ modelId, meshId, vertexId }`. Resource lookup always goes through the active model, so selection remains meaningful when an instance resource is detached. Mesh and vertex IDs remain stable. No GPU buffer index is stored as a logical selection.

`VertexOverlay` renders one fixed-screen-size point per distinct referenced vertex in the active submesh. Picking projects logical resource positions through the current instance and camera matrices, compares distances in CSS pixels and resolves ties in stable source order. Perspective distance and orthographic zoom therefore do not change the pick radius. The marker may be smaller than its pick tolerance.

Each candidate is tested for occlusion at its projected centre against visible standard/physical mesh surfaces, including imported models, built-in models and UAV assets. Editor labels, selection helpers, gizmos and the translucent ground are excluded. This is surface picking without an X-ray option: hidden rear vertices cannot normally be selected through a foreground mesh. A small relative depth tolerance avoids rejecting a surface vertex because of triangle-edge numerical error. Exactly coplanar surfaces and tolerance-sized silhouettes remain ambiguous; selecting the intended object/submesh explicitly resolves the editing scope. No spatial acceleration structure is currently installed.

Coincident vertices remain independently indexed. A **Switch Coincident Vertex** button cycles the exactly coincident candidates in the active submesh. The deterministic viewport pick initially chooses the first eligible ID. Submesh switching clears the vertex selection. Unused vertices are preserved in the resource and export, but this stage displays/selects only vertices referenced by the active submesh.

A resource's logical vertices are global across its submeshes. Editing a vertex shared by several submeshes updates every reference to that same ID, including repeated triangle corners. Those references describe one logical vertex; separating them would change topology. Independently indexed vertices at the same coordinates, and submeshes that do not reference the selected vertex, remain unchanged.

### Transactions, Coordinates and Resource Sharing

The existing `TransformSession` has a small optional vertex target. `beginVertexTransformSession()` captures the immutable base project and stable selection. `updateTransformSession()` creates a resource draft from that base for each absolute local-coordinate update. Existing `commitTransformHistory()`, `finishTransform()`, cancellation, the 60-entry history limit and committed-only autosave are reused. There is one active transform transaction for both modes.

The existing `ObjectGizmo` handles attachment, pointer gestures, camera suspension, pending inspector input, cancellation and disposal in both modes. In Edit Mode its proxy is placed at `M × p_local`, where `M = T × R × S` is the unchanged object matrix. World-space gizmo positions are converted through `M⁻¹` to resource-local coordinates. Non-uniform object scale and XYZ rotation are therefore accounted for without baking them into the resource or updating the instance transform. Geometry changes affect subsequent object bounds and the usual bounds-centre pivot; the current object's position, rotation, scale and descriptive `size` fields remain intact.

Duplicate OBJ instances initially share resources. On the first effective vertex draft, a shared resource is copied under a new resource ID and only the active model reference changes. One reserved ID is reused throughout that gesture. Cancel/no-op discards the copy; undo restores original sharing. Subsequent edits of an exclusive resource keep its resource ID. Logical vertex and submesh IDs remain unchanged within the copy. Unrelated instances and their buffers remain untouched.

Final completion runs the existing complete-project serializer before adding history. This includes the cost of detaching a shared resource and any longer normal values. A project that fits before editing may exceed 5 MB afterwards; completion then discards the complete draft and retains the previous project, inspector value and history. There is no partial commit or separate geometry persistence store.

### Geometry and Normal Policy

The edit replaces only the selected logical vertex's position. Triangle indices, order, winding, vertex IDs and UV arrays are retained. Local coordinates remain finite and within ±10,000 metres; referenced model dimensions remain at most 10,000 metres per axis. Moves that create a degenerate affected triangle are rejected. A rejected drag sample leaves the last valid draft position visible; releasing commits that valid position, while Esc cancels the entire gesture. Self-intersections and collisions between otherwise nondegenerate triangles are not evaluated.

For meshes without explicit normals, the existing non-indexed renderer regenerates flat face normals. For authored per-corner normals, only triangles referencing the edited logical vertex are updated. Their original corner normals are rotated by the shortest rotation from the base face direction to the edited face direction. Vector magnitudes and distinct per-corner relationships are retained; untouched triangles retain their original values. Invalid normals or an undefined base face direction cause an explicit rejection. No vertex welding, global smoothing or cross-face normal averaging is performed.

This policy preserves hard-edge separation and authored corner offsets while making affected faces follow the deformation. It does not reconstruct a modeling tool's original smoothing groups or weighted-normal modifier. A formerly smooth boundary between differently deformed faces can acquire a shading discontinuity; a configurable smoothing/normal policy should be considered separately for a later stage. Recomputing all normals indiscriminately would lose information that the current resource already preserves.

`ImportedMesh` compares resource identity, mesh data and the referenced logical vertex objects. Unaffected meshes retain their existing geometry and GPU buffers. Affected meshes rebuild their existing per-corner geometry, normals, bounding box and bounding sphere; their old owned buffers are disposed. Model selection/focus bounds and vertex markers follow the current draft resource. There is no stale BVH to rebuild.

### Verification and Manual Acceptance

Stage 4A implementation map:

| Files | Responsibility |
| --- | --- |
| `src/core/mesh-edit.ts` | New logical selection, picking, coordinate conversion, immutable resource edits and normal transport. |
| `src/core/editor.tsx`, `src/core/transform.ts` | Mode state, restrictions and vertex targets within existing transactions/history. |
| `src/features/mesh-edit/VertexOverlay.tsx`, `VertexInspector.tsx` | New viewport markers/picking and focused vertex inspector. |
| `src/features/obj-transform/ObjectGizmo.tsx` | Reused control lifecycle with a vertex translation target. |
| `src/features/obj-import/ObjMesh.tsx` | Retain unaffected instance/submesh GPU geometry. |
| `src/App.tsx`, `src/Scene.tsx`, `src/style.css` | Mode action, scoped shortcuts, scene interaction guards and panel styling. |
| `src/ui/Controls.tsx` | Prevent focus/Tab on a rounded numeric readout from changing its full-precision value. |
| `tests/mesh-edit.test.ts`, `scripts/verify-mesh-edit-cases.cjs`, `scripts/verify-obj-transform-ui.cjs` | Focused geometry tests and existing Electron harness integration. |
| `docs/obj-editor.md` | Architecture, conventions, validation and manual acceptance. |

`tests/mesh-edit.test.ts` covers mode eligibility, stable IDs, submesh scope, independent coincident vertices, screen-space picking across camera distances/zooms, foreground occlusion, local and transformed world translation, shared triangle corners, unaffected mesh buffers, UV/normal conventions, one-entry/no-op/cancel/stale history, shared-resource isolation, JSON persistence, OBJ round trips and invalid geometry.

Step A was verified independently with the selection-only Electron suite before vertex modification was implemented. Both modes use the existing isolated-profile test harness:

```sh
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ edit-selection
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ edit
```

The full suite uses native pointer and text events for logical picking and all three world translation axes under combined XYZ rotation and non-uniform scaling. It verifies draft/autosave separation, live inspector state, unchanged object transforms/connectivity, Undo/Redo, Esc/blur/mode-switch cancellation, camera recovery, numerical local editing, project download/reload, actual OBJ file export/re-import, visibility/locking/preview restrictions and unchanged UAV data. A shared-resource case exceeds the project budget on detachment and verifies atomic rejection without an extra undo entry. Development Fiber inspection is confined to tests; no diagnostic state is added to production.

Run the type check, all unit tests, production build and the existing import, Object Mode, built-in transform and OBJ export Electron suites as regressions. Manual acceptance should additionally cover:

- Dense, overlapping and nearly coplanar surfaces: orbit and zoom, pick near silhouettes, switch submeshes and cycle coincident IDs. Confirm the absence of X-ray picking is understandable.
- Every translation axis and plane in perspective and orthographic views, especially on very small/large or strongly non-uniformly scaled models. Try a move through a degenerate position; check last-valid feedback and cancellation.
- A pending inspector edit followed immediately by a gizmo drag; text input Tab/Esc; pointer cancellation or window switching during a drag; selection/view changes during a drag. Confirm camera navigation recovers.
- Authored normal seams, initially smooth surfaces and meshes without normals. Inspect shading after deformation and export/re-import; evaluate whether the documented face-transport policy suits the asset.
- Two instances sharing a resource: edit one, undo/redo and save/reopen. Confirm that the other instance retains its geometry and paths/viewpoint targets are unchanged.
- Native desktop project/OBJ saving and reopening after geometry edits, plus a representative large asset on the target hardware. Picking scans logical vertices and surface geometry, and affected buffers are rebuilt per draft; this lightweight version is not optimized for dense production meshes.

Stage 4A originally implemented one selected vertex and translation only. Stage 4B below adds individual edge/face translation through that same infrastructure. Multiple selection, topology changes, smoothing controls and picking acceleration remain outside the implementation.

Validation on 20 November 2026: all 71 unit tests, the TypeScript check, production build, independent Step A selection suite, full vertex-editing suite, and the four existing import/Object Mode/built-in transform/OBJ export Electron suites passed. OS-native picker behavior, dense-asset responsiveness and the visual edge cases listed above remain manual acceptance checks.

## Stage 4B: Edge and Face Selection and Translation

### Workflow and Selection Identity

Enter Edit Mode on an imported OBJ and choose **Vertex**, **Edge** or **Face** (`顶点`, `边`, `面`) in the existing inspector. Click an eligible element in the viewport, press **M**, and drag an existing world-space translation handle. The mode buttons are explicit controls; no number-key shortcuts are added. Existing Tab, M, text-input focus rules and camera navigation remain unchanged. Switching element modes preserves the active model and submesh, cancels a draft and clears the selected element. Switching submeshes preserves the element mode but clears the selection. Re-entering Edit Mode starts in Vertex Mode.

`MeshSelection` extends the Stage 4A selection state, rather than adding another editor or history store:

| Mode | Transient identity | Logical vertices | Local reference position |
| --- | --- | --- | --- |
| Vertex | Model ID, mesh ID, vertex ID | One vertex | Vertex position |
| Edge | Model ID, mesh ID, canonical pair of vertex IDs | Both endpoints, once each | Endpoint midpoint |
| Face | Model ID, mesh ID, zero-based triangle ordinal | Each unique triangle vertex, once | Triangle centroid |

Edges are derived from consecutive triangle triples and deduplicated using canonical logical vertex-ID pairs within the active submesh. Adjacent triangles share one selectable edge when they reference the same endpoints. Distinct vertices at identical positions remain distinct endpoints. A face is one stored triangle; the non-indexed render buffer expands corners in the same order, so the mesh raycast's `faceIndex` identifies that resource triangle. Triangle ordinals are sufficient because this stage never changes triangle order or topology; they are not a proposed persistent face-ID scheme for future topology operations.

The importer already triangulates quads and does not retain original polygon boundaries. Their diagonals are therefore selectable edges, and each half is a selectable face. No polygon merging or half-edge structure is introduced. The existing coincident-element control now cycles exactly overlapping edges and faces as well as vertices, retaining their independent logical identities. It is not multiple selection.

### Picking and Visual Feedback

Vertex picking retains the Stage 4A 10-CSS-pixel tolerance. Edge picking measures the pointer's distance to each projected logical segment with an 8-CSS-pixel tolerance, independent of perspective distance or orthographic zoom. The closest point is converted back using perspective-correct interpolation before occlusion testing. Stable source order resolves exact distance ties. Projected zero-length segments and edges crossing the camera's near/far clipping planes are deliberately omitted; move the camera to bring the complete edge into view.

Face picking uses the nearest actual mesh-surface raycast at the pointer. Mesh metadata identifies the resource submesh, and the ancestor model group identifies the active instance. Hits belonging to another model or another submesh are rejected rather than selecting through them. Surfaces outside the camera depth range are ignored. Within the existing small depth tolerance, explicitly choosing the active submesh permits selection between coplanar overlapping triangles. This avoids arbitrary render-buffer vertex selection while retaining predictable submesh scope.

All three modes share the existing visible-surface filtering and camera/preview/lock restrictions. Blue segments show active-submesh edges. A selected edge is orange with enlarged endpoint markers; a selected face has a translucent orange triangle overlay with depth testing and a small polygon offset. Highlights and markers are editor overlays with no picking geometry of their own, and never enter project JSON or OBJ export. Standard/physical foreground surfaces occlude elements; this remains a non-X-ray workflow. Near silhouettes, tiny segments, exact coplanar overlaps and dense meshes still require visual acceptance on representative assets.

### One Translation Path

`resolveElement()` maps the selected element to an immutable logical index set and its current reference position. `translateMeshElement()` subtracts the gesture base reference position from the requested local reference position, then applies that one delta to each unique logical vertex. Relative endpoint/triangle positions therefore remain unchanged. Independently indexed vertices and unreferenced geometry do not move. Shared references across adjacent triangles or submeshes follow the same moved logical vertices, without splitting them or changing topology.

The inspector labels coordinates explicitly: **Vertex Local**, **Edge Midpoint Local** and **Face Centroid Local** (`顶点局部`, `边中点局部`, `面重心局部`). These are absolute target reference positions, not individual endpoint coordinates or delta fields. The difference from the base reference position is the common local translation delta. During a drag, the inspector also displays that delta separately. Focusing and leaving a rounded readout still does not alter the underlying full-precision geometry.

The existing `ObjectGizmo` proxy is placed at the world-space reference position. Its world-space translation is mapped through the unchanged instance matrix inverse, exactly as in Stage 4A. A rotated, non-uniformly scaled OBJ therefore moves all selected vertices by the intended world delta while preserving object position, Euler rotation, scale and descriptive size. Edge and face rotation/scaling remain unavailable.

`TransformSession` now has a mesh-element target that uses the existing base/draft project, reserved resource-copy ID, completion validation and shared history. Stage 4A vertex helper entry points delegate to the same path for compatibility. Shared-resource detachment, last-valid drag feedback, Esc/blur/pointer/mode cancellation, camera suspension, single-entry completion, stale/no-op rejection and the complete-project 5 MB check are unchanged. Save/restore and Stage 3B OBJ export read the resulting committed resources directly; no new serialized fields or project version are needed.

### Geometry and Normal Integrity

Only the selected unique vertex positions are replaced. All affected triangles are checked before the draft is accepted, including neighbours that reference moved endpoints. A degenerate face, a non-finite/out-of-range resulting vertex, excessive model dimensions or invalid affected normals reject the whole sample without partial mutation. Invalid final project capacity rejects the whole completion. Releasing after a rejected drag sample commits the last valid draft, while cancellation restores the gesture base.

Triangle indices, order, winding, logical IDs, submesh memberships and UV arrays remain unchanged. If every vertex of a triangle moves together, its authored normals remain exactly unchanged because the triangle undergoes a pure translation. Partially affected triangles retain Stage 4A's per-corner normal transport: rotate each authored normal with its face without welding, global smoothing or cross-face averaging. Meshes without authored normals continue to generate flat render normals. The existing smooth-boundary limitation remains: adjacent deformed faces can develop a shading discontinuity because original smoothing groups are not represented.

The same affected-mesh renderer updates corner buffers, bounding boxes and bounding spheres. Unaffected submeshes and instances retain their owned geometry buffers. No spatial acceleration structure has been added or invalidated. Self-intersections and collision resolution remain outside scope.

### Files and Verification

The implementation extends `src/core/mesh-edit.ts`, `src/core/transform.ts`, `src/core/editor.tsx`, `src/features/mesh-edit/VertexOverlay.tsx`, `VertexInspector.tsx`, and `src/features/obj-transform/ObjectGizmo.tsx`. `src/features/obj-import/ObjMesh.tsx` adds submesh metadata for face raycasting; `src/style.css` adds the small selection-mode button group. Existing module names are retained to avoid reorganizing Stage 4A solely for this extension. Stage 4B adds `tests/mesh-elements.test.ts` and `scripts/verify-mesh-elements-cases.cjs`, and registers the latter in the existing interaction harness. No dependency, asset pipeline, project format, JSON save path or OBJ exporter change is required.

Focused tests compare edge deduplication and IDs, coincident independent elements, mode resets, midpoint/centroid pivots, pixel-based edge selection, perspective-correct occlusion, actual Three.js raycasts and triangle ordinals, common vertex deltas, rotated/non-uniform instances, UV and normal integrity, degeneration rejection, shared-resource isolation, history, persistence and OBJ round trips. Vertex tests remain active as regressions.

Run the new isolated-profile Electron suite with the existing Vite server:

```sh
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ elements
```

It uses native pointer events to select a real edge and face, verifies their highlight geometry and world pivots, moves the selected endpoints/vertices under XYZ rotation and non-uniform scale, exercises numerical reference coordinates and rejected degeneration, verifies cancellation and mode/submesh changes, checks undo/redo and unchanged UVs/object/UAV data, downloads project/OBJ files, re-imports the OBJ and reloads saved geometry. The existing `edit`, Object Mode, built-in transform, import and export suites provide regressions.

Manual acceptance:

1. Import a triangulated quad, enter Edge Mode and pick both its boundary and diagonal. Confirm one edge is highlighted and both endpoints move together. Pick a triangular face and confirm all three vertices move together.
2. Repeat with XYZ object rotation, different scale factors on each axis, and perspective/orthographic cameras. Confirm midpoint/centroid handoff between gizmo and numeric coordinates; try each handle and cancel with Esc, window switching and selection-mode changes.
3. Switch active submeshes on overlapping geometry. Test foreground occlusion, exactly coincident independent elements and the cycling control. Bring a near-clipped edge fully into view before selecting it.
4. Move an edge/face toward a degenerate neighbour and beyond scene limits. Confirm last-valid feedback, complete cancellation, normal camera recovery and no extra undo entries.
5. Inspect authored hard edges, UV seams and formerly smooth boundaries after moving adjacent faces. Export and re-import, hide the source instance and compare the geometry. Save/reopen project JSON in browser and native desktop modes.
6. Check a dense representative mesh on target hardware. Edge derivation and picking are linear scans, and occlusion uses ordinary mesh raycasts; no acceleration or dense-mesh performance guarantee is introduced.

Stage 4B originally supported one vertex, edge or triangular face at a time. Stage 4C below extends selection to collections while retaining unique-vertex resolution and one transaction per gesture. Built-in/GLTF mesh editing, topology reconstruction and modeling operations remain excluded.

Stage 4B validation on 20 November 2026: all 88 unit tests, the TypeScript check and production build passed. Six Electron interaction suites passed: edge/face editing, the complete Stage 4A vertex workflow, OBJ import, Object Mode, built-in transforms and OBJ export. Dense meshes, near-clipped/coplanar picking, authored shading appearance and OS-native picker behavior remain the manual checks described above.

## Stage 4C: Multi-selection and Group Translation

### Selection Controls

Within a visible, unlocked imported OBJ's active submesh, Vertex, Edge and Face modes now support collections of their existing logical element identities:

- Plain click replaces the collection with the picked element.
- Shift + left click toggles membership: add an unselected element or remove a selected one.
- Clicking empty space clears the collection, including a Shift click that finds no eligible element.
- Switching element type or submesh clears all element selections and cancels any active draft, preserving the active OBJ. Re-entering Edit Mode starts with no selected vertices.
- The inspector displays both the selected-element count and the unique logical-vertex count. Selected-item chips allow removal by identity, which is particularly useful for coincident geometry.
- The existing coincident-element cycle acts on the first selected element and preserves other members. Already selected alternatives are skipped. **Append Coincident Element** adds an independently indexed overlapping element without merging positions or replacing the group. The cycle/add controls remain scoped to that first element's exact geometric overlap.

Shift + left pointer-down is intercepted only in Edit Mode, before OrbitControls or TransformControls can start their modifier-pan/drag on that gesture. The Shift state is captured at pointer-down, so releasing the key before mouse-up does not change toggle intent. Shift dragging beyond the existing click movement threshold neither pans the camera nor changes membership. Ordinary drag navigation, wheel zoom, middle/right buttons and Object Mode's controls retain their previous behavior. Plain clicks on a visible transform handle still operate the gizmo; use **V** when selecting through a handle's screen-space footprint. Shift selection takes priority over the gizmo.

No cross-submesh or mixed-element-type collection is supported. Occlusion rules, perspective-correct edge picking, triangle raycasting, clipping limitations and the absence of X-ray selection are unchanged. Coincident independent vertices, edges and faces remain distinct by ID even if their orange overlays occupy the same pixels; counts and item chips make their membership visible.

### Minimal Collection Representation

`MeshSelection` retains its Stage 4B primary element shape and adds an optional `additional` array of same-scope, same-type element identities. This preserves existing single-selection entry points without introducing another state store. The array contains individual elements, not nested selection groups. Canonical identity keys remove duplicate elements, and the overall membership key is independent of selection order. Coordinates are never used for identity deduplication.

`selectionElements()` resolves the membership list, `updateMeshSelection()` implements replace/toggle/clear, and `withSelectionElements()` rejects scope/type mixing. `resolveElement()` resolves all members using the existing resource connectivity and returns both per-element index lists for overlays and one unique vertex-index union for editing. If any member is stale or invalid, the group has no editable pivot; it is not silently reduced to the remaining valid members.

Selection changes remain temporary UI state and do not enter the existing project history. Undo after selection-only interactions still undoes the preceding geometry/project operation. Project JSON, autosave and OBJ contain geometry only, never the primary/additional selection state. Loading/reloading resets Edit Mode as before.

The existing overlay is extended: point highlights use unique vertex indices, while edge and face highlights retain each selected pair/triangle's own render-corner sequence. Thus adjacent selected elements are all visible while shared endpoints receive one geometric modification. There is no separate selection renderer or topology engine.

### Group Pivot and Coordinate Conventions

Every group uses the arithmetic centroid of its **unique selected logical vertices** in model-local space. It is not an average of element midpoints/centroids, which would weight shared endpoints repeatedly. The existing object matrix maps this pivot to world space for the same TransformControls proxy used by single-element editing.

The geometry operation is unchanged: subtract the base local pivot from an absolute local target pivot and add that common delta to each unique vertex exactly once. The new `elementDelta` transaction input simply converts a local delta to that same absolute target before invoking the existing operation. World-space gizmo positions still pass through the inverse instance matrix. Rotated and non-uniformly scaled OBJ instances therefore retain their object transforms while their selected geometry receives the intended common world displacement.

Each preview is calculated from the transaction's immutable initial project and selection, rather than from the preceding draft. Relative positions, connectivity, IDs, UVs and shared-resource isolation remain intact. Fully translated triangles retain authored normals exactly; partially affected neighbours retain the Stage 4A/4B per-corner normal transport policy. Existing bounds updates, finite/range checks and degeneration rejection apply to the entire vertex union.

Single selections retain the previous absolute vertex/midpoint/centroid fields. With multiple elements selected, those editable absolute fields are replaced by:

1. A read-only local selection centre.
2. Explicit local **Translation Delta X/Y/Z** (`平移增量`) inputs.
3. **Apply Translation** (`应用平移`), which submits the complete vector as one undoable operation.

Entering values alone does not move geometry. Apply settles the currently focused input before reading the vector, so a click directly from a field includes its latest text. Successful application clears the delta inputs to zero and moves the group pivot with the geometry. Zero application adds no history entry. A rejected operation retains the entered delta for correction while restoring all geometry. Changing collection membership resets the pending numeric form; any other committed edit/undo/redo resets it as well. Gizmo dragging does not apply a prepared numerical vector; its successful commit clears that vector. During a drag, inputs are disabled and the inspector separately reports the live local displacement.

### Transactions, Restrictions and Persistence

The existing mesh target, immutable base/draft project, reserved copy-on-write resource ID, camera suspension, cancellation and history completion are reused for all three element types. No group-specific geometry algorithm or history store is introduced.

A completed group drag or Apply action creates one entry. Cancel, focus loss, pointer cancellation, tool/mode/submesh changes and playback/candidate transitions restore the entire gesture base. Invalid drag samples retain the last valid group draft. Range/degeneration failures cannot update only some vertices. Final serialization validates the complete project, including resource-copy and normal-array costs, before committing. A capacity failure rolls back the whole group and adds no history entry.

Hidden, locked, playback, candidate and UAV-camera restrictions are unchanged. Built-in parametric/GLTF models and UAV geometry cannot enter Edit Mode. Existing scene routing prevents element selection from creating viewpoints or selecting unrelated scene objects. Saving and OBJ export use committed project geometry and remain unavailable during an active gesture; group selection metadata does not affect either format.

### Files and Verification

Stage 4C changes `src/core/mesh-edit.ts`, `src/core/editor.tsx`, `src/core/transform.ts`, `src/features/mesh-edit/VertexOverlay.tsx`, `VertexInspector.tsx`, `src/style.css` and the existing Electron harness. It adds `tests/mesh-multiselect.test.ts` and `scripts/verify-mesh-multiselect-cases.cjs`. The existing ObjectGizmo, runtime mesh ownership, project serialization and OBJ exporter are reused without new dependencies or persisted schema fields.

Step A selection was independently verified before enabling group transformations. Focused tests cover collections, Shift toggling, replace/clear, scope changes, coincident identities, shared-vertex deduplication, an asymmetric centroid case, geometry/UV/normal preservation, object transforms, world-gizmo/local-delta equivalence, base-relative previews, stale/no-op/cancel history, resource sharing, restrictions, JSON and OBJ round trips.

With the Vite server running, use the existing isolated-profile Electron harness:

```sh
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ multi-selection
env -u ELECTRON_RUN_AS_NODE node node_modules/electron/cli.js scripts/verify-obj-transform-ui.cjs http://127.0.0.1:5176/ multi
```

The first suite checks native Shift-click membership, every selected highlight, normal-click replacement, empty/mode/submesh clearing, independent coincident elements, no camera conflict and no selection-only history. The full suite additionally exercises all world axes for each group type under XYZ rotation and non-uniform scale, centroid placement, one-entry numeric vector application and reset, zero operations, undo/redo, Esc/blur/mode/preview cancellation, camera recovery, unchanged UAV data, project save/reload, actual OBJ download/re-import and a shared-resource capacity failure that must roll back the complete group.

### Measured Performance and Limits

A local Node CPU measurement on 20 November 2026 used planar regular grids with 100 uniformly sampled selected edges. Each cell contributed two triangles. Resolution/draft figures are medians of seven runs after warm-up; edge-picking figures are medians of three runs with ordinary Three.js occlusion raycasting against the same mesh, a 1,000 × 1,000 viewport and a perspective camera. The draft measurement includes selection resolution. It excludes React, GPU buffer upload and drawing, so these are component timings, not frame-rate guarantees.

| Triangles | Unique selected vertices | Resolve collection (ms) | Create draft (ms) | Pick edge with occlusion (ms) |
| --- | --- | --- | --- | --- |
| 1,250 | 199 | 0.88 | 1.51 | 1.78 |
| 9,800 | 200 | 6.99 | 8.33 | 10.58 |
| 45,000 | 200 | 47.31 | 47.94 | 47.11 |

Dense topology is a clear limitation of the existing linear edge derivation and raycasts. Several resolutions and affected-buffer updates can occur during a browser interaction, so end-to-end latency can exceed these numbers. No acceleration library or new editing architecture is introduced here. A subsequent optimization should first profile representative browser assets, then consider caching ID/edge lookup tables by topology revision, reducing repeated resolution and updating affected buffers in place. An acceleration structure should be justified by those measurements and include explicit invalidation tests.

Manual acceptance:

- In each mode, build a group with Shift clicks, remove members, replace it with a plain click and clear it on empty space. Test Shift release before mouse-up, Shift click on a gizmo footprint and Shift drag; confirm normal camera controls still work.
- On overlapping geometry, append independent coincident elements and remove them by chip. Orbit and change zoom, then switch submesh/type and confirm the full group is cleared.
- Use an asymmetric selection to check the unique-vertex centroid. Rotate/non-uniformly scale the object, drag every axis, and compare a prepared local numeric delta with the corresponding world movement. Check direct field-to-Apply clicks and input focus/Tab without editing.
- Cancel group movement with Esc, window switching, mode changes and preview. Try degeneration, coordinate limits and an oversized shared-resource copy. Verify all vertices roll back together and the next Undo still targets the preceding operation.
- Save/reopen project JSON in browser and native desktop modes. Export/re-import OBJ, hide the original to inspect the overlap, and inspect authored seams and partially deformed smooth boundaries. Recheck UAV playback and analysis.
- Measure a representative dense mesh on the target machine; the synthetic CPU results above do not establish a maximum interactive asset size.

Stage 4C remains same-type selection within one submesh and translation only. Box/lasso selection, cross-submesh groups, topology changes, proportional editing, element rotation/scaling and built-in/UAV mesh editing remain excluded. No subsequent stage is automatically implemented.

Stage 4C validation on 20 November 2026: all 106 unit tests, the TypeScript check and production build passed. The independent multi-selection Step A suite passed, followed by seven full Electron suites: group editing, single edge/face editing, vertex editing, OBJ import, Object Mode, built-in transforms and OBJ export. Native picker behavior, dense-asset responsiveness and the overlapping/clipped-surface cases above remain manual acceptance checks.

For the subsequent architecture, correctness, memory and native-interaction measurements, see the [Stage 5A engineering audit](obj-editor-audit.md). It includes reproducible benchmarks and a proposed optimization scope; it does not implement Stage 5B.
