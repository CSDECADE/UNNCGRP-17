import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { exportSelectedObj } from "../src/features/obj-export/obj.ts";
import { emptyProject, parseProject, removeObject, serializeProject } from "../src/core/project.ts";
import { meshEdges, resolveElement, withSelectionElements, type MeshElementSelection } from "../src/core/mesh-edit.ts";
import { beginMeshTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import type { Project, Vec3 } from "../src/core/types.ts";

function fixture() {
  const { project } = prepareObjImport(emptyProject(), "v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nv 0 0 0\nv 0 0 3\nv 2 0 3\nv 0 2 3\nvt 0 0\nvt 1 0\nvt 0 1\nvn 0 0 1\nvn 0 1 0\no A\nf 1/1/1 2/2/1 3/3/1\nf 1/3/2 3/2/2 4/1/2\nf 5/1/1 4/3/1 3/2/1\no B\nf 6/1/1 7/2/1 8/3/1", "history.obj");
  const resource = project.objResources![0], scope = { modelId: project.models[0].id, meshId: resource.meshes[0].id };
  const kinds: Record<string, MeshElementSelection[]> = {
    vertex: [{ ...scope, vertexId: "v1" }, { ...scope, vertexId: "v2" }],
    edge: [{ ...scope, kind: "edge", edgeIds: ["v1", "v2"] }, { ...scope, kind: "edge", edgeIds: ["v2", "v3"] }],
    face: [{ ...scope, kind: "face", triangle: 0 }, { ...scope, kind: "face", triangle: 1 }],
  };
  return { project, resource, scope, kinds };
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.values(value).forEach(freeze); Object.freeze(value);
}
const historyFor = (present: Project) => ({ past: [] as Project[], present, future: [] as Project[] });
const undo = (h: ReturnType<typeof historyFor>) => h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
const redo = (h: ReturnType<typeof historyFor>) => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;

for (const kind of ["vertex", "edge", "face"]) test(`${kind}: unchanged authored corner normals are structurally shared during real in-plane edits`, () => {
  const f = fixture(), selected = withSelectionElements(f.kinds[kind][0], f.kinds[kind]);
  const indices = resolveElement(f.project, selected)!.indices, topology = meshEdges(f.resource, f.scope.meshId), before = structuredClone(f.project);
  freeze(f.project);
  const session = updateTransformSession(beginMeshTransformSession(f.project, selected)!, { elementDelta: [.01, 0, 0] });
  const next = session.draft.objResources![0];
  assert.notEqual(session.draft, f.project); assert.notEqual(next.vertices, f.resource.vertices);
  assert.equal(next.meshes[0], f.resource.meshes[0]); assert.equal(next.meshes[1], f.resource.meshes[1]);
  assert.equal(next.meshes[0].normals, f.resource.meshes[0].normals);
  assert.equal(next.meshes[0].triangles, f.resource.meshes[0].triangles); assert.equal(next.meshes[0].uvs, f.resource.meshes[0].uvs);
  next.vertices.forEach((v, i) => { if (!indices.includes(i)) assert.equal(v, f.resource.vertices[i]); });
  assert.equal(meshEdges(next, f.scope.meshId), topology); assert.deepEqual(f.project, before);
  const committed = commitTransformHistory(historyFor(f.project), session);
  assert.equal(committed.past.length, 1); assert.equal(committed.past[0], f.project);
  assert.deepEqual(undo(committed).present, before); assert.equal(redo(undo(committed)).present, committed.present);
});

test("changed normal values still receive an owned exact array; frozen snapshots and unrelated submeshes remain intact", () => {
  const f = fixture(), selected = withSelectionElements(f.kinds.edge[0], f.kinds.edge);
  const before = structuredClone(f.resource); freeze(f.project);
  const tilted = updateTransformSession(beginMeshTransformSession(f.project, selected)!, { elementDelta: [0, 0, .3] }).draft;
  const next = tilted.objResources![0];
  assert.notEqual(next.meshes[0].normals, f.resource.meshes[0].normals);
  assert.notDeepEqual(next.meshes[0].normals, f.resource.meshes[0].normals);
  assert.deepEqual(next.meshes[0].normals!.slice(0, 9), before.meshes[0].normals!.slice(0, 9)); // fully translated first face
  assert.equal(next.meshes[1], f.resource.meshes[1]); assert.deepEqual(f.resource, before);
  assert.deepEqual(parseProject(serializeProject(tilted)), tilted);
  const model = tilted.models[0], output = exportSelectedObj(tilted, { type: "model", id: model.id });
  const restored = prepareObjImport(emptyProject(), output.text, output.name).project.objResources![0];
  assert.deepEqual(restored.vertices.map(v => v.position), next.vertices.map(v => v.position));
  restored.meshes.forEach((m, index) => {
    assert.deepEqual(m.triangles, next.meshes[index].triangles); assert.deepEqual(m.uvs, next.meshes[index].uvs);
    m.normals!.forEach((v, i) => assert.ok(Math.abs(v - next.meshes[index].normals![i]) < 1e-12));
  });
});

test("mixed shared/changed normal histories retain 60 entries, exact undo/redo, eviction and redo branching", () => {
  const f = fixture(), selected = withSelectionElements(f.kinds.vertex[0], f.kinds.vertex);
  let h = historyFor(f.project);
  const snapshots = [serializeProject(f.project)];
  for (let i = 0; i < 65; i++) {
    freeze(h.present);
    const delta: Vec3 = i % 2 ? [0, 0, .001] : [.0001, 0, 0];
    const base = beginMeshTransformSession(h.present, selected)!;
    const preview = updateTransformSession(base, { elementDelta: delta });
    h = commitTransformHistory(h, preview); snapshots.push(serializeProject(h.present));
  }
  assert.equal(h.past.length, 60);
  h.past.forEach((p, i) => assert.equal(serializeProject(p), snapshots[i + 5]));
  for (let i = 64; i >= 5; i--) { h = undo(h); assert.equal(serializeProject(h.present), snapshots[i]); }
  for (let i = 6; i <= 65; i++) { h = redo(h); assert.equal(serializeProject(h.present), snapshots[i]); }
  for (let i = 0; i < 4; i++) h = undo(h);
  const branch = updateTransformSession(beginMeshTransformSession(h.present, selected)!, { elementDelta: [0, .001, 0] });
  h = commitTransformHistory(h, branch); assert.equal(h.future.length, 0);
  assert.equal(commitTransformHistory(h, null), h);
  const noop = updateTransformSession(beginMeshTransformSession(h.present, selected)!, { elementDelta: [0, 0, 0] });
  assert.equal(commitTransformHistory(h, noop), h);
  const stored = serializeProject(h.present);
  assert.throws(() => updateTransformSession(beginMeshTransformSession(h.present, selected)!, { elementDelta: [20000, 0, 0] }));
  assert.equal(serializeProject(h.present), stored); assert.deepEqual(parseProject(stored), h.present);
});

test("COW normal sharing survives later deformation and deletion without changing either instance or history", () => {
  const f = fixture(), project = { ...f.project, models: [...f.project.models, { ...f.project.models[0], id: "other-instance" }] };
  const selected = withSelectionElements(f.kinds.edge[0], f.kinds.edge), original = structuredClone(project);
  const first = commitTransformHistory(historyFor(project), updateTransformSession(beginMeshTransformSession(project, selected)!, { elementDelta: [.01, 0, 0] }));
  const copy = resolveElement(first.present, selected)!.resource;
  assert.notEqual(copy.id, f.resource.id); assert.equal(copy.meshes[0].normals, f.resource.meshes[0].normals);
  freeze(first.present);
  const second = commitTransformHistory(first, updateTransformSession(beginMeshTransformSession(first.present, selected)!, { elementDelta: [0, 0, .1] }));
  assert.notEqual(resolveElement(second.present, selected)!.resource.meshes[0].normals, copy.meshes[0].normals);
  assert.deepEqual(project, original);
  const removed = removeObject(second.present, "model", f.scope.modelId);
  assert.deepEqual(removed.models.map(m => m.id), ["other-instance"]);
  assert.equal(removed.objResources!.length, 1); assert.equal(removed.objResources![0], f.resource);
  assert.equal(removeObject(removed, "model", "other-instance").objResources!.length, 0);
  assert.equal(undo(second).present, first.present); assert.equal(redo(undo(second)).present, second.present);
  assert.equal(meshEdges(copy, f.scope.meshId), meshEdges(f.resource, f.scope.meshId));
});
