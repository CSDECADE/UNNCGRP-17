# OBJ Editor — User Guide

This guide describes `feature/obj-editor` through Stage 5E. It uses project **JSON** files and an in-memory Undo/Redo history. The `.aeproj` packages, checkpoints and start screen available on the newer `main` branch have **not** been integrated here.

The application currently displays Chinese labels. English action names below include those labels where needed. Developers can find implementation details in the [technical documentation](obj-editor.md).

## 1. Open the application and import your first model

From the repository root, install dependencies once, then launch Electron:

```sh
npm ci
npm run dev
```

Use Node.js 22.13 or newer; the project README recommends Node 24 LTS. `npm run dev` builds and launches the desktop app. For browser preview, run `npm run dev:web` and open the local address printed by Vite.

For a reliable first exercise, use [`tests/fixtures/obj-building.obj`](../tests/fixtures/obj-building.obj). It is a small two-wall fixture. Arbitrary downloaded buildings and the raw KayKit files in the test assets may contain unsupported OBJ directives; prepare them as described below before trying them.

1. Open **Model** (`模型`) on the bottom toolbar.
2. Choose **Import OBJ…** (`导入 OBJ…`).
3. Select the `.obj` file in the file picker.
4. A successful import adds one item to the object list, selects it and focuses the camera. A file with several submeshes still appears as one model.
5. Click the item or its visible surface to select it. Press **F**, or double-click the object, to focus it again.

If import fails, read the message before changing the file. A rejected import leaves the previous project intact. Source coordinates are interpreted as metres with +Y up; the importer does not automatically rescale or recenter geometry.

## 2. Place the building in Object Mode

Make sure the imported model is visible and unlocked. Exit preview/playback or any candidate-plan view, and use the perspective or an orthographic scene camera rather than the drone camera.

### Move

Select **Move** (`移动`, **M**). Drag a gizmo axis or plane. The axes move the whole model in world coordinates, including all its submeshes. Release the mouse to finish one undoable operation.

Alternatively, edit **Position X/Y/Z** (`位置 X/Y/Z`) in the right inspector. These numbers describe the model origin in world metres. Press **Enter** or leave the field to commit.

### Rotate

Select **Rotate** (`旋转`, **R**) and drag a rotation ring. Imported OBJ models support XYZ rotation. The inspector shows XYZ Euler angles in degrees; dragging a local ring can change more than one displayed component.

### Scale

Select **Scale** (`缩放`, **K**). Drag an axis for directional scale or the centre scale handle for uniform scale. The inspector accepts positive local scale factors: `1` is the original factor, `2` doubles that axis, and `0.5` halves it. Zero and mirrored/negative scales are unsupported.

Rotation and scaling keep the geometry's centre pivot in place. The Position values may change to compensate; this is expected. Editing Position directly moves the whole model.

### Cancel or use built-in objects

Press **Esc** during a gizmo drag to discard its draft and return to the selection tool. Pressing Esc while typing in a numerical input cancels that input's pending text instead.

The built-in building, cuboid and cylinder also support Object Mode. Their rotation is Y-only, and scale controls change physical XYZ dimensions in metres. They do not support this OBJ Edit Mode or OBJ export. UAV transforms are not part of this editor.

## 3. Edit the mesh

### Enter Edit Mode and choose a submesh

1. Select an imported OBJ model.
2. Click **Switch Edit Mode** (`切换编辑模式`), or press **Tab** while the canvas is focused.
3. The inspector shows **Vertex / Edge / Face** controls (`顶点选择`, `边选择`, `面选择`).
4. If the file has several parts, choose **Edit Submesh** (`编辑子网格`) in the inspector.

Changing the submesh or element type clears the current element selection. Selection is limited to one object, one submesh and one type at a time. Click the mode button or press Tab on the canvas to return to Object Mode. Tab inside an input continues ordinary field navigation.

### Select a vertex, edge or face

Choose the type in the inspector, then click a visible element. Selected elements receive an orange highlight. Click empty space to clear selection. Press **V** to use the selection tool if the gizmo makes a small element difficult to click.

A face is one **triangle**, including either half of an imported quad. An edge may be the diagonal created when a quad was triangulated. Moving an edge moves both endpoints; moving a face moves its three vertices together. Other faces sharing those logical vertices follow the edit.

The editor does not select through solid geometry. Orbit the camera to expose hidden elements, focus the model and choose the correct submesh. When coincident-element controls appear, use **Switch Coincident…** (`切换重合…`) to choose an alternative, or **Append Coincident…** (`追加重合…`) to add one. Equal positions can belong to different vertices; selecting one does not automatically select the others.

### Move a single element

Press **M** and drag the translation gizmo. Mesh gizmos use **world XYZ**, even when the object is rotated or non-uniformly scaled.

The single-element numerical fields instead describe an **absolute position in the model's local coordinates**:

| Selection | Numerical position means |
| --- | --- |
| Vertex | The selected vertex position |
| Edge | The midpoint of its two endpoints |
| Face | The triangle centroid |

Enter the desired coordinate, rather than an increment. For example, to move local X from `40` to `40.05`, enter `40.05`; the field does not evaluate an expression such as `40 + 0.05`. Edge and face inputs translate all their vertices by the reference-point difference.

Use a small first movement. A move that collapses a triangle or exceeds scene bounds is rejected. During a drag, the last valid preview can remain visible; release commits that valid result, or press Esc to cancel the whole gesture.

### Select and move a group

1. Hold **Shift** and click additional elements of the same type.
2. Shift-click a selected element to remove it. A plain click replaces the group.
3. Check the selected-element count and highlights. The inspector also lists removable members.
4. Press **M** to drag the group with the world-axis gizmo, or enter **Local Translation Delta** (`局部平移增量 Δ`) X/Y/Z values.
5. For numerical group movement, click **Apply Translation** (`应用平移`).

Group inputs are **local increments**, not absolute positions. Entering X `0.05`, Y `0`, Z `0` moves the group 0.05 metres along model-local X. All components apply as one operation and reset after success. Undo/Redo also clears a pending nonzero group increment when the committed project changes.

A vertex shared by several selected elements moves once. The group pivot is the mean position of its unique vertices. Moving several faces can deform adjacent, unselected triangles; the editor does not detach faces or create new geometry.

## 4. Keyboard and mouse reference

Scene shortcuts apply when focus is outside text fields, dialogs, menus and selects, subject to the current model/mode restrictions. Desktop Undo/Redo inside text editing is routed to text editing rather than scene history.

| Key or mouse action | Applicable context | Result |
| --- | --- | --- |
| Click model / object-list item | Object Mode | Select model |
| Double-click model, or **F** | Scene with an active selection | Focus selection; F also cancels an active transform |
| **V** | Object/Edit Mode | Activate selection tool |
| **M** | Editable object or selected mesh elements | Activate Move |
| **R** | Object Mode | Activate Rotate; imported OBJ XYZ, built-in Y yaw |
| **K** | Object Mode with a model | Activate Scale/dimension controls |
| **Tab** with canvas/body focus | Eligible imported OBJ or active Edit Mode | Enter/exit Edit Mode |
| Click visible mesh element | Edit Mode | Replace element selection |
| **Shift + click** element | Edit Mode | Add/remove group membership without modifier-pan |
| Click empty pick area | Edit Mode | Clear element selection |
| Drag gizmo handle / release | Active transform tool | Preview / commit one operation |
| **Esc** during scene drag | Object/Edit Mode | Cancel draft and select the selection tool |
| **Enter** or blur a number field | Numerical inspector | Commit its pending value |
| **Esc** inside a number field | Numerical inspector | Cancel pending text |
| **Cmd+Z** (macOS) / **Ctrl+Z** | Scene history | Undo |
| **Cmd+Shift+Z** / **Ctrl+Shift+Z** | Scene history | Redo |
| **Cmd+S** / **Ctrl+S** | Project | Save current project JSON |
| **Cmd+Shift+S** / **Ctrl+Shift+S** | Desktop app | Save project JSON as another file |
| **Cmd+D** / **Ctrl+D** | Object Mode with an unlocked model | Duplicate model; initially shares its immutable geometry resource |
| **Delete** / **Backspace** | Object Mode with an unlocked selection | Delete selected object; Edit Mode does not delete mesh elements |
| Left-drag empty scene space | Perspective / orthographic scene camera | Orbit / pan |
| Right- or middle-drag | Scene camera | Pan |
| Mouse wheel | Scene camera | Zoom |

Blender shortcuts such as G for movement or S for scale are not implemented here. This editor uses M and K.

## 5. Undo, redo and cancellation

The current branch retains up to 60 past project states in memory. A complete drag adds one entry; intermediate pointer positions do not. A no-op or canceled drag adds none. Element selection changes do not add history entries.

Undo/Redo cancels an active transformation and then changes the committed history state. To discard a gesture without moving through history, use Esc. A new committed edit after Undo discards the redo branch.

The Undo/Redo stack is not saved in project JSON or local autosave. Reloading restores the most recently saved project state, not its previous edit timeline. Checkpoints and browsable/persisted history belong to the newer main branch and are not available here.

## 6. Save a project or export an OBJ

### Save the complete project

Click **Save** (`保存`) or use Cmd/Ctrl+S. The current feature branch writes a `.p15.json` project containing the scene, imported geometry, object transforms, UAVs, viewpoints and supported background settings.

Desktop mode uses a save dialog and retains the project path for subsequent saves. Browser preview requests a download; confirm that the browser actually completed it. Finish or cancel an active transform before saving. Open the project menu and choose **Open Project…** (`打开项目…`) to restore a saved JSON file.

Local autosave stores only the latest committed project on this machine. Storage failure is shown in the UI; the current in-memory project remains, but later edits are not safely in the previous autosave. Save an explicit JSON copy before closing. Version 2 JSON containing OBJ resources cannot be opened by older version-1-only builds.

### Export the selected mesh

Select an **imported OBJ**, open the **Model** menu and choose **Export Selected OBJ…** (`导出所选 OBJ…`). Finish or cancel active transforms and candidate plans first. Built-in models and UAVs are not exportable through this action. A selected hidden or locked imported OBJ can still export.

The file contains that model's supported geometry and attributes, with its object transform baked once. It does not contain UAV paths, the rest of the project, materials, selection or Undo history. Desktop export uses its own save dialog and does not change the project's JSON save path.

Re-importing the export creates another model. Its object transform starts at identity because the placement is already included in its vertices. It should occupy the exported world location, including mesh edits. Export does not reset the original model.

| File/action | Use it for |
| --- | --- |
| Project `.p15.json` | Continue editing the complete current scene |
| Exported `.obj` | Exchange one selected imported model's baked geometry |
| Local autosave | Recover the latest successfully stored project on this machine |
| `.aeproj` | Newer main-branch workflow; not integrated into this feature branch |

## 7. Complete building exercise

1. Import the small [building fixture](../tests/fixtures/obj-building.obj), or a compatible prepared building OBJ.
2. Select it and press F. Check visibility/lock state in the object list.
3. In Object Mode, enter Y rotation `15` degrees and X scale `1.1`; inspect the result. Use M for a small placement adjustment.
4. Enter Edit Mode. Choose a submesh and Vertex, Edge or Face selection.
5. Select one visible element and make a small translation. Use Esc once during a drag to practice canceling it.
6. Shift-select several elements of that same type. Enter local X delta `0.05`, leave Y/Z at `0`, and click Apply Translation.
7. Undo and redo the operation. Check that the group movement returns and that numerical delta fields clear.
8. Exit Edit Mode and save the complete project JSON. Keep this as the recoverable scene copy.
9. With the imported model selected, export it as OBJ.
10. Hide the original, re-import the exported file and focus the new instance. Compare its placement and shape; overlapping visible originals can otherwise make comparison confusing.

This exercise does not certify an arbitrary production building, its original materials or architectural dimensions. Validate those with your own compatible source and target workflow.

## 8. Prepare a compatible Blender export

Use a copy of the source model and check units/orientation before export. The [Blender OBJ manual](https://docs.blender.org/manual/en/5.0/files/import_export/obj.html) describes the Wavefront exporter, triangulation, normals and material options; labels vary by Blender version.

1. Export only the intended mesh through **File → Export → Wavefront (.obj)**.
2. Enable triangulated output, or triangulate the mesh deliberately before export. Resolve degenerate faces in the source.
3. Disable material export. The resulting OBJ must not contain `mtllib` or `usemtl`.
4. Export explicit normals if required; UVs are optional. Check that texture coordinates contain two components.
5. Check smoothing statements in the exported text: this editor accepts only `s off` or `s 0`. An exporter may still emit numbered groups; prepare the shading/export accordingly before importing.
6. Verify exported scale and Y-up orientation. OBJ coordinates are read directly as metres.

This is preparation guidance, not a tested preset for every Blender release. Do not silently delete unsupported geometry or assume a raw Blender export will work. The importer reports unsupported lines explicitly.

## 9. Troubleshooting

| Problem | What to check |
| --- | --- |
| Import rejected | Read the line-numbered error. The supported subset is listed in the [technical profile](obj-editor.md#limitations-and-supported-input-profile). |
| Error mentions `mtllib` or `usemtl` | Re-export a geometry-only copy without material directives. MTL/textures are unsupported. |
| Smoothing-group error | Prepare output using only `s off`/`s 0`; explicit normals are supported. |
| Polygon/planarity/degeneracy error | Triangulate unsupported polygons and repair degenerate source geometry; arbitrary n-gons and concave/nonplanar quads are rejected. |
| Imported model is hard to see | Select its list item, show/unlock it and press F. Check source scale/origin and camera view. There is no automatic rescaling or grounding. |
| Cannot enter Edit Mode | Select a visible, unlocked imported OBJ; leave preview/playback/candidate mode and drone camera view. Built-ins and UAVs are ineligible. |
| Cannot select an element | Check active submesh/type, press V, focus/orbit to expose it and avoid the gizmo handle. Hidden/occluded elements are not selected through surfaces. |
| Only half a quad selects | Face Mode selects triangles; imported quad boundaries are not retained. |
| Adjacent faces also move | They share logical vertices. The edit changes those shared positions, rather than detaching the selected face. |
| Numeric movement seems to use different axes | Mesh gizmos use world XYZ; single-element positions and group delta fields use model-local XYZ. |
| Delete does not remove a face | Mesh-element deletion is unsupported. Return to Object Mode to delete a whole model. |
| Export action is unavailable | Select an imported OBJ and finish/cancel the active transaction or candidate plan. Built-ins/UAVs do not export. |
| Export reports capacity failure | Baked coordinate/normal precision can expand re-imported JSON past 5 MB. Use a smaller source/scene or an earlier saved transform; the app does not automatically simplify or truncate it. |
| Save or autosave fails | Check destination/storage availability and the full-project budget. Keep the app open and save to an available location. The old autosave may not include recent edits. |
| Re-import overlaps the original | Placement was baked into OBJ. Hide one instance for comparison. |
| Undo history disappears on restart | This branch saves the current project only; `.aeproj` session/history integration is pending. |

OBJ files are limited to 16,000,000 bytes; complete project JSON to 5,000,000 bytes. A small input file can exceed the project limit after import. Dense meshes can be slow even below those limits. Group selection remains within one object/submesh/type, and Edit Mode supports translation only. Unsupported files and over-budget operations are explicitly rejected; they are not automatically repaired.

Packaged system dialogs, platform focus behavior, a real architectural business model and target-machine responsiveness still require manual acceptance. See the [current validation and integration boundary](obj-editor.md#validation-and-evidence).
