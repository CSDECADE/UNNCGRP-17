# OBJ Import and Static Object Mode — Stages 1–3A+

## Scope

Stage 1 introduced a serializable resource format and its persistence through the existing project pipeline. Stage 2 added local OBJ import, rendering, object management, and basic project JSON save/restore. Stage 3A added OBJ transformations. Stage 3A+ extends the same controls and inspector to the built-in building, cuboid and cylinder while retaining their existing yaw and dimension semantics. UAV editing, OBJ export and mesh editing remain outside the implemented scope.

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

Stage 3B remains separate: no OBJ export, material/texture export, mesh selection, geometry manipulation, or topology operations are implemented here. An exporter will need to apply the complete object matrix and appropriate normal transform once, without baking transforms into the stored resource or applying them twice.

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
