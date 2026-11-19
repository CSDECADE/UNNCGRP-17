# OBJ Import and Editing Foundation — Stages 1–2

## Scope

Stage 1 introduced a serializable resource format and its persistence through the existing project pipeline. Stage 2 adds local OBJ import, rendering, object management, and basic project JSON save/restore. Object transformation controls and mesh editing remain outside the implemented scope.

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

Imported instances use a dedicated OBJ render branch, not the built-in box fallback. Import preserves source coordinates: +Y is up and units are interpreted as metres. It does not recenter, rotate, scale, or ground the source geometry. The initial instance has zero position and yaw. Its `size` is a bounds descriptor (with a minimum of 0.1 per axis for the existing model contract), not a geometry scaling command. Selection feedback and focus use the actual referenced local geometry bounds, including off-origin and planar models. Full object transformation editing is deferred to Stage 3.

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
4. Select the model in the viewport or the object list. Use the existing visibility, lock, duplicate, delete, and focus controls. Locked models can be selected but cannot be deleted or duplicated. Object transform tools remain unavailable for OBJ models in this stage.
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

Stage 3 must explicitly define imported-object rotation/scale semantics and connect them to the existing transform transactions. Stage 2 does not enable transform gizmos, direct dragging, vertex/edge/face selection, OBJ export, material loading, or topology editing. Very large or tiny models may exceed the existing camera's practical clipping/zoom range even when their data fits the file budget; no automatic coordinate normalization is performed.
