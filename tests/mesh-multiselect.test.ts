import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { clearElement, editableObj, elementKey, resolveElement, selectionElements, singleElementKey, translateMeshElement, updateMeshSelection, vertexLocalPosition, withSelectionElements } from "../src/core/mesh-edit.ts";
import { beginMeshTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import { emptyProject, parseProject, serializeProject } from "../src/core/project.ts";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { exportSelectedObj } from "../src/features/obj-export/obj.ts";
import { objMatrix } from "../src/core/obj-transform.ts";
import type { MeshElementSelection, MeshSelection } from "../src/core/mesh-edit.ts";
import type { ObjModel, Project, Vec3 } from "../src/core/types.ts";

function fixture() {
  const { project } = prepareObjImport(emptyProject(), "v 0 0 0\nv 4 0 0\nv 4 4 0\nv 0 4 0\nv 0 0 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt .5 0\nvn 0 0 1\nvn 0 1 1\no A\nf 1/1/1 2/2/1 3/3/1\nf 1/4/2 3/3/2 4/1/2\nf 5/4/1 4/1/1 3/3/1\no B\nf 1 4 3", "groups.obj");
  const scope = { modelId: project.models[0].id, meshId: project.objResources![0].meshes[0].id };
  return { project, scope, kinds: {
    vertex: [{ ...scope, vertexId: "v1" }, { ...scope, vertexId: "v2" }, { ...scope, vertexId: "v5" }],
    edge: [{ ...scope, kind: "edge", edgeIds: ["v1", "v2"] }, { ...scope, kind: "edge", edgeIds: ["v2", "v3"] }],
    face: [{ ...scope, kind: "face", triangle: 0 }, { ...scope, kind: "face", triangle: 1 }],
  } as Record<"vertex" | "edge" | "face", MeshElementSelection[]> };
}
for (const kind of ["vertex", "edge", "face"] as const) test(`${kind}: Shift toggles stable identities; plain click replaces, empty click and mode switches clear`, () => {
  const { project, kinds } = fixture(), [a, b] = kinds[kind];
  let selection = updateMeshSelection(clearElement(a), a);
  assert.equal(selectionElements(selection).length, 1);
  selection = updateMeshSelection(selection, b, true);
  assert.equal(selectionElements(selection).length, 2);
  const before = structuredClone(selection);
  assert.equal(elementKey(withSelectionElements(selection, [a, b, a])), elementKey(selection));
  assert.equal(elementKey(withSelectionElements(selection, [b, a])), elementKey(selection));
  selection = updateMeshSelection(selection, a, true);
  assert.deepEqual(selectionElements(selection).map(singleElementKey), [singleElementKey(b)]);
  assert.equal(selectionElements(updateMeshSelection(selection, b, true)).length, 0);
  assert.equal(selectionElements(updateMeshSelection(before, a)).length, 1);
  assert.equal(selectionElements(updateMeshSelection(before, clearElement(a), true)).length, 0);
  assert.equal(resolveElement(project, clearElement(before, kind === "face" ? "vertex" : "face"))!.pivot, null);
});
test("group pivot is the centroid of unique logical vertices, not an average of edge/face centroids", () => {
  const { project, kinds } = fixture();
  project.objResources![0].vertices[1].position = [6, 0, 0]; // asymmetric quad exposes shared-vertex weighting errors
  const edge = withSelectionElements(kinds.edge[0], kinds.edge), face = withSelectionElements(kinds.face[0], kinds.face);
  assert.deepEqual(resolveElement(project, edge)!.indices, [0, 1, 2]);
  close(resolveElement(project, edge)!.pivot!, [10 / 3, 4 / 3, 0]);
  assert.deepEqual(resolveElement(project, face)!.indices, [0, 1, 2, 3]);
  assert.deepEqual(resolveElement(project, face)!.pivot, [2.5, 2, 0]);
});
test("coincident vertices/edges and overlapping independent faces stay separately selected by logical IDs", () => {
  const { project, kinds, scope } = fixture();
  const vertices = withSelectionElements(kinds.vertex[0], [kinds.vertex[0], kinds.vertex[2]]);
  assert.deepEqual(resolveElement(project, vertices)!.indices, [0, 4]);
  assert.equal(selectionElements(vertices).length, 2);
  const edges = withSelectionElements(kinds.edge[0], [
    { ...scope, kind: "edge", edgeIds: ["v1", "v3"] }, { ...scope, kind: "edge", edgeIds: ["v5", "v3"] },
  ]);
  assert.deepEqual(resolveElement(project, edges)!.indices, [0, 2, 4]);
  assert.equal(selectionElements(edges).length, 2);
  const faces = withSelectionElements(kinds.face[0], [kinds.face[1], { ...scope, kind: "face", triangle: 2 }]);
  assert.deepEqual(resolveElement(project, faces)!.indices, [0, 2, 3, 4]);
  assert.equal(selectionElements(faces).length, 2);
});
test("selection scope is one model/submesh/type; stale members invalidate the entire group rather than moving only valid members", () => {
  const { project, kinds } = fixture(), [a, b] = kinds.vertex;
  const group = withSelectionElements(a, [a, b]);
  for (const bad of [{ ...b, meshId: "other" }, { ...b, modelId: "other" }, kinds.face[0]]) {
    assert.equal(updateMeshSelection(group, bad, true), group);
    assert.throws(() => withSelectionElements(a, [a, bad]));
  }
  const stale: MeshSelection = { ...a, additional: [{ ...a, vertexId: "missing" }] };
  assert.equal(resolveElement(project, stale)!.pivot, null);
});
function close(a: number[], b: number[], epsilon = 1e-9) {
  assert.equal(a.length, b.length); a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < epsilon, `${a} != ${b}`));
}
for (const kind of ["vertex", "edge", "face"] as const) {
  test(`${kind} group: common delta changes every unique vertex exactly once and preserves IDs, topology, UVs and object transforms`, () => {
    const { project, kinds } = fixture(), selected = withSelectionElements(kinds[kind][0], kinds[kind].slice(0, 2));
    const target = resolveElement(project, selected)!, before = structuredClone(project), delta: Vec3 = [.25, .5, 1];
    const next = translateMeshElement(project, selected, target.pivot!.map((n, i) => n + delta[i]) as Vec3, "copy");
    assert.deepEqual(project, before); assert.equal(next.models, project.models);
    next.objResources![0].vertices.forEach((v, i) => {
      assert.equal(v.id, project.objResources![0].vertices[i].id);
      close(v.position, project.objResources![0].vertices[i].position.map((n, axis) => n + (target.indices.includes(i) ? delta[axis] : 0)));
    });
    assert.deepEqual(next.objResources![0].meshes.map(m => m.triangles), project.objResources![0].meshes.map(m => m.triangles));
    assert.deepEqual(next.objResources![0].meshes.map(m => m.uvs), project.objResources![0].meshes.map(m => m.uvs));
    for (let i = 0; i < project.objResources![0].meshes[0].triangles.length; i += 3) {
      const triangle = project.objResources![0].meshes[0].triangles.slice(i, i + 3);
      if (triangle.every(index => target.indices.includes(index)))
        assert.deepEqual(next.objResources![0].meshes[0].normals!.slice(i * 3, (i + 3) * 3), project.objResources![0].meshes[0].normals!.slice(i * 3, (i + 3) * 3));
    }
  });
  test(`${kind} group: numerical local delta matches world gizmo conversion on a rotated/non-uniform OBJ; previews always use the gesture base`, () => {
    const { project, kinds } = fixture(), selected = withSelectionElements(kinds[kind][0], kinds[kind].slice(0, 2)), model = project.models[0] as ObjModel;
    Object.assign(model, { position: [8, -2, 5], rotation: 35, rotationXYZ: [20, 35, -40], scale: [.5, 3, 2] });
    const target = resolveElement(project, selected)!, matrix = objMatrix(model), worldDelta = new Vector3(.2, -.3, .4);
    const local = vertexLocalPosition(model, new Vector3(...target.pivot!).applyMatrix4(matrix).add(worldDelta)) as Vec3;
    const delta = local.map((n, i) => n - target.pivot![i]);
    const session = beginMeshTransformSession(project, selected)!;
    const gizmo = updateTransformSession(session, { elementPosition: local });
    const numeric = updateTransformSession(updateTransformSession(session, { elementDelta: [.1, .2, .3] }), { elementDelta: delta });
    numeric.draft.objResources![0].vertices.forEach((v, i) => {
      close(v.position, gizmo.draft.objResources![0].vertices[i].position);
      if (target.indices.includes(i)) close(new Vector3(...v.position).applyMatrix4(matrix).sub(new Vector3(...project.objResources![0].vertices[i].position).applyMatrix4(matrix)).toArray(), worldDelta.toArray());
    });
    close(resolveElement(numeric.draft, selected)!.pivot!, local);
  });
  test(`${kind} group: one history entry, cancel/no-op/stale safety, JSON save and baked OBJ re-import`, () => {
    const { project, kinds } = fixture(), selected = withSelectionElements(kinds[kind][0], kinds[kind].slice(0, 2));
    const history = { past: [] as Project[], present: project, future: [] as Project[] }, session = beginMeshTransformSession(project, selected)!;
    const edited = updateTransformSession(session, { elementDelta: [.25, .5, 1] });
    const committed = commitTransformHistory(history, edited); assert.equal(committed.past.length, 1);
    assert.equal(committed.past[0], project); assert.equal(commitTransformHistory(committed, edited), committed);
    assert.equal(commitTransformHistory(history, null), history);
    assert.equal(commitTransformHistory(history, updateTransformSession(edited, { elementDelta: [0, 0, 0] })), history);
    assert.deepEqual(parseProject(serializeProject(committed.present)), committed.present);
    const file = exportSelectedObj(committed.present, { type: "model", id: selected.modelId });
    const restored = prepareObjImport(emptyProject(), file.text, file.name).project.objResources![0];
    restored.vertices.forEach((v, i) => close(v.position, committed.present.objResources![0].vertices[i].position));
    assert.deepEqual(restored.meshes.map(m => m.triangles), committed.present.objResources![0].meshes.map(m => m.triangles));
    assert.ok(!file.text.includes('additional'));
  });
  test(`${kind} group: shared-resource isolation, invalid samples and hidden/locked/playback restrictions are atomic`, () => {
    const { project, kinds } = fixture(), selected = withSelectionElements(kinds[kind][0], kinds[kind].slice(0, 2)), model = project.models[0] as ObjModel;
    project.models.push({ ...model, id: "copy" });
    const before = structuredClone(project), session = beginMeshTransformSession(project, selected)!;
    const changed = updateTransformSession(session, { elementDelta: [0, 0, .5] });
    assert.equal(changed.draft.objResources!.length, 2); assert.equal(changed.draft.objResources![0], project.objResources![0]);
    assert.equal(changed.draft.models[1], project.models[1]); assert.deepEqual(project, before);
    assert.throws(() => updateTransformSession(changed, { elementDelta: [20000, 0, 0] }));
    assert.deepEqual(project, before);
    for (const field of ["locked", "visible"] as const) {
      model[field] = field === "locked"; assert.equal(beginMeshTransformSession(project, selected), null); model[field] = field !== "locked";
    }
    for (const field of ["playing", "preview", "candidate", "droneView"] as const)
      assert.equal(editableObj(project, { type: "model", id: model.id }, { playing: false, preview: false, candidate: false, droneView: false, [field]: true }), null);
  });
}
