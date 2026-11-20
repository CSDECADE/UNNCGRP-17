import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyProject, parseProject, serializeProject } from "../src/core/project.ts";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { coincidentElements, meshEdges, meshVertexIndices, resolveElement, translateMeshElement, withSelectionElements } from "../src/core/mesh-edit.ts";
import { beginMeshTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import type { ObjResource, Project } from "../src/core/types.ts";

function fixture() {
  const { project } = prepareObjImport(emptyProject(), "v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nv 0 0 0\no A\nf 1 2 3\nf 1 3 4\nf 5 4 3\no B\nf 1 4 3", "cache.obj");
  const resource = project.objResources![0], model = project.models[0];
  return { project, resource, model, selected: { modelId: model.id, meshId: resource.meshes[0].id, vertexId: "v1" } };
}

// An independent, deliberately uncached oracle for the existing insertion/tie order.
function edges(resource: ObjResource, meshId: string) {
  const result = new Map<string, { ids: [string, string]; indices: [number, number] }>();
  const triangles = resource.meshes.find(m => m.id === meshId)!.triangles;
  for (let offset = 0; offset < triangles.length; offset += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    let x = triangles[offset + a], y = triangles[offset + b];
    if (x === y) continue;
    if (resource.vertices[x].id > resource.vertices[y].id) [x, y] = [y, x];
    const ids: [string, string] = [resource.vertices[x].id, resource.vertices[y].id];
    result.set(JSON.stringify(ids), { ids, indices: [x, y] });
  }
  return [...result.values()];
}

test("topology queries reuse protected derived collections and preserve edge order and submesh scope", () => {
  const { resource } = fixture();
  for (const mesh of resource.meshes) {
    const actual = meshEdges(resource, mesh.id), indices = meshVertexIndices(resource, mesh.id);
    assert.deepEqual(actual, edges(resource, mesh.id));
    assert.deepEqual(indices, [...new Set(mesh.triangles)]);
    assert.equal(meshEdges(resource, mesh.id), actual);
    assert.equal(meshVertexIndices(resource, mesh.id), indices);
    assert.throws(() => actual.pop(), TypeError);
    assert.throws(() => { actual[0].ids[0] = "poisoned"; }, TypeError);
    assert.throws(() => { actual[0].indices[0] = 999; }, TypeError);
    assert.throws(() => indices.push(999), TypeError);
  }
  assert.deepEqual(meshEdges(resource, "missing"), []);
  assert.deepEqual(meshVertexIndices(resource, "missing"), []);
});

test("same IDs on restored, duplicated, reindexed or changed topology never alias a cached resource", () => {
  const { project, resource, selected } = fixture(), cached = meshEdges(resource, selected.meshId);
  resolveElement(project, selected); // Warm both the edge and vertex lookup paths.
  const restored = parseProject(serializeProject(project));
  assert.notEqual(meshEdges(restored.objResources![0], selected.meshId), cached);
  assert.deepEqual(meshEdges(restored.objResources![0], selected.meshId), cached);
  for (const change of [
    (r: ObjResource) => { r.meshes[0].triangles = [1, 2, 3]; },
    (r: ObjResource) => { r.vertices.reverse(); r.meshes.forEach(m => { m.triangles = m.triangles.map(i => r.vertices.length - 1 - i); }); },
    (r: ObjResource) => { r.vertices[0].id = "replacement"; },
    (r: ObjResource) => { r.meshes[0].id = "replacement-mesh"; },
  ]) {
    const next = structuredClone(resource); change(next);
    for (const mesh of next.meshes) assert.deepEqual(meshEdges(next, mesh.id), edges(next, mesh.id));
    assert.notEqual(meshEdges(next, next.meshes[0].id), cached);
    const p: Project = { ...project, version: 2, objResources: [next] };
    const target = resolveElement(p, { ...selected, meshId: next.meshes[0].id });
    assert.equal(target?.indices.includes(next.vertices.findIndex(v => v.id === "v1")), target?.pivot !== null);
  }
  assert.equal(meshEdges(resource, selected.meshId), cached);
});

test("geometry-only vertex, edge and face previews share topology but resolve live coordinates", () => {
  const { project, resource, selected } = fixture(), cached = meshEdges(resource, selected.meshId);
  const referenced = meshVertexIndices(resource, selected.meshId);
  for (const single of [selected, { modelId: selected.modelId, meshId: selected.meshId, kind: "edge" as const, edgeIds: ["v1", "v2"] as [string, string] },
    { modelId: selected.modelId, meshId: selected.meshId, kind: "face" as const, triangle: 0 }]) {
    const pivot = resolveElement(project, single)!.pivot!;
    const session = beginMeshTransformSession(project, single)!;
    for (const z of [.1, .2, .3]) {
      const next = updateTransformSession(session, { elementDelta: [0, 0, z] }).draft;
      assert.equal(meshEdges(next.objResources![0], selected.meshId), cached);
      assert.equal(meshVertexIndices(next.objResources![0], selected.meshId), referenced);
      resolveElement(next, single)!.pivot!.forEach((n, axis) => assert.ok(Math.abs(n - (pivot[axis] + (axis === 2 ? z : 0))) < 1e-12));
    }
  }
  assert.equal(coincidentElements(project, selected).length, 2);
  const moved = translateMeshElement(project, selected, [0, 0, 1], "unused");
  assert.equal(coincidentElements(moved, selected).length, 1);
  assert.deepEqual(resolveElement(project, selected)!.pivot, [0, 0, 0]);
  assert.deepEqual(resolveElement(moved, { ...selected, vertexId: "v5" })!.pivot, [0, 0, 0]);
});

test("warmed topology preserves different pivots for coincident faces with different logical vertices", () => {
  const { project, resource, selected } = fixture();
  meshEdges(resource, selected.meshId);
  const a = { modelId: selected.modelId, meshId: selected.meshId, kind: "face" as const, triangle: 0 };
  const four = resolveElement(project, withSelectionElements(a, [a, { ...a, triangle: 1 }]))!;
  const five = resolveElement(project, withSelectionElements(a, [a, { ...a, triangle: 2 }]))!;
  assert.deepEqual(four.indices, [0, 1, 2, 3]); assert.deepEqual(four.pivot, [1, 1, 0]);
  assert.deepEqual(five.indices, [0, 1, 2, 4, 3]); assert.deepEqual(five.pivot, [.8, .8, 0]);
});

test("copy-on-write, cancellation and undo/redo retain correct topology and independent geometry", () => {
  const f = fixture(), cached = meshEdges(f.resource, f.selected.meshId);
  const shared = { ...f.project, models: [...f.project.models, { ...f.model, id: "other-instance" }] };
  const group = withSelectionElements(f.selected, [f.selected, { ...f.selected, vertexId: "v2" }]);
  let history = { past: [] as Project[], present: shared, future: [] as Project[] };
  const original = structuredClone(shared);
  for (let i = 0; i < 4; i++) {
    const session = beginMeshTransformSession(history.present, group)!;
    const preview = updateTransformSession(session, { elementDelta: [0, 0, .1] });
    const model = preview.draft.models[0]; assert.equal(model.kind, "obj");
    if (model.kind !== "obj") throw new Error("fixture");
    const resource = preview.draft.objResources!.find(r => r.id === model.resourceId)!;
    assert.equal(meshEdges(resource, f.selected.meshId), cached);
    assert.deepEqual(resolveElement(preview.draft, { ...f.selected, modelId: "other-instance" })!.pivot, [0, 0, 0]);
    assert.equal(commitTransformHistory(history, null), history); // cancellation adds nothing
    history = commitTransformHistory(history, preview);
  }
  const final = history.present;
  for (const restored of [...history.past, final, ...history.past.slice().reverse(), final]) {
    const target = resolveElement(restored, group)!;
    assert.equal(meshEdges(target.resource, group.meshId), cached);
    assert.deepEqual(target.pivot, target.indices.reduce((sum, index) => sum.map((n, axis) => n + target.resource.vertices[index].position[axis] / target.indices.length), [0, 0, 0]));
  }
  assert.deepEqual(shared, original);
  assert.deepEqual(parseProject(serializeProject(final)), final);
  const locked = { ...final, models: final.models.map(m => ({ ...m, locked: true })) };
  assert.equal(resolveElement(locked, group), null);
  assert.equal(resolveElement({ ...final, version: 2, objResources: [] }, group), null);
  assert.equal(resolveElement(final, { ...f.selected, vertexId: "unknown" })!.pivot, null);
  assert.equal(resolveElement(final, { ...f.selected, kind: "edge", edgeIds: ["v2", "v5"] })!.pivot, null);
});
