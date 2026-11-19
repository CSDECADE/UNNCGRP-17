# OBJ Editing Foundation — Stage 1

## Scope

Stage 1 adds a serializable resource format and validates its persistence through the existing project pipeline. It does not add OBJ parsing, a model import button, resource rendering, object instances, transform controls, mesh selection, or mesh manipulation.

Resources are stored in the existing `Project` state. They are not a second scene or editor state. Until Stage 2 provides instances and rendering, resources in a version 2 project are retained but are not displayed or selectable. Existing built-in models and UAV workflows remain unchanged.

## Project Compatibility

- Version 1 retains its existing structure and behavior. Loading or saving a legacy project does not upgrade it automatically.
- Version 2 requires an `objResources` array, which may be empty. Each resource is embedded in the project JSON; no filesystem path or external cache is required to restore its geometry.
- Adding resources requires explicitly creating a version 2 project. A version 1 project containing `objResources` is rejected rather than accepting an extension that older readers would silently discard.
- Existing older builds reject version 2 as unsupported. They cannot safely open or edit these files.
- Unknown version 2 project fields and unknown resource, mesh, or vertex fields are rejected. Future unsupported geometry extensions must not be silently removed during validation.

The existing `parseProject()` and `validateProject()` entry points accept both versions. `serializeProject()` validates the complete project and produces a self-contained JSON string for persistence. `persistProject()` now uses this encoder for automatic saves. A future project-file UI should also use this encoder before calling the existing Electron JSON file channel or creating a browser download.

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

The format supports multiple triangle meshes within a resource. It does not yet represent original polygon boundaries, materials, textures, lines, points, smoothing groups, or arbitrary OBJ metadata. A future importer must explicitly report unsupported source features rather than claiming a lossless conversion of every OBJ file. Normals are preserved as supplied finite values; normalization and recomputation belong to the later geometry-editing stage.

## Geometry and Object Transformations

Resources contain local geometry only. Existing `Model.position`, `Model.rotation`, and `Model.size` retain their current built-in-model semantics. They do not modify stored OBJ vertices, and OBJ resources do not implicitly transform UAVs, viewpoints, or paths.

Imported object instances, their resource references, and full object transformations are intentionally deferred. Stage 2 must introduce an explicit instance representation and render branch; it must not pass an OBJ resource through the current built-in box fallback. Stage 3 will connect transformations to the existing transaction and history mechanism.

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

The optional `project-files` module is absent in this checkout. Its current save controls cannot provide a file fallback. Before enabling interactive OBJ import, Stage 2 must provide or integrate a usable file-save path so a reported autosave failure can be resolved without closing the application.

## Validation and Verification

Validation rejects unsupported project/resource versions and fields, duplicate IDs, missing or empty resource geometry, malformed triangle lists, non-integer or out-of-range references, non-finite values, and inconsistent corner attribute lengths. Local vertex coordinates use the existing scene coordinate range of -10,000 to 10,000 metres. Coincident vertices and degenerate triangles are retained; geometric repair is outside this stage.

Run the existing checks:

```sh
npm run check
npm test
npm run build
```

`tests/obj-persistence.test.ts` covers legacy compatibility, version 2 round trips, multi-mesh and seam data, invalid inputs, detached validation results, object-transform/history compatibility, candidate-plan preservation, UTF-8 byte boundaries, oversized geometry, storage quota failures, and actual file reads/writes through `desktop/files.cjs`. The disk test verifies that an oversized write leaves the existing file unchanged.

Storage quota failures are simulated deterministically in the test suite. Real browser/Electron quota behavior, UI notices, reload recovery, and viewport interactions require manual verification in the target environment. Stage 1 has no visible OBJ editing feature to exercise in the viewport.
