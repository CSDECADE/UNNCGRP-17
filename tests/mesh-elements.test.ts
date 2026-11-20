import assert from "node:assert/strict";
import { test } from "node:test";
import { DoubleSide, Group, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { clearElement, coincidentElements, elementKey, meshEdges, pickLogicalEdge, pickLogicalFace, resolveElement, selectionMode, translateMeshElement, vertexLocalPosition, vertexVisible } from "../src/core/mesh-edit.ts";
import { beginMeshTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import { emptyProject, exampleProject, parseProject, serializeProject } from "../src/core/project.ts";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { exportSelectedObj } from "../src/features/obj-export/obj.ts";
import { createObjGeometry } from "../src/features/obj-import/geometry.ts";
import { objMatrix } from "../src/core/obj-transform.ts";
import type { MeshSelection } from "../src/core/mesh-edit.ts";
import type { ObjModel, Project, Vec3 } from "../src/core/types.ts";

function fixture() {
  const { project } = prepareObjImport(exampleProject(), `v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nv 0 0 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt .5 0\nvn 0 0 1\nvn 0 1 1\no A\nf 1/1/1 2/2/1 3/3/1\nf 1/4/2 3/3/2 4/1/2\nf 5/4/1 4/1/1 3/3/1\no B\nf 1 4 3`, "elements.obj");
  const model = project.models.find(m => m.kind === "obj") as ObjModel, resource = project.objResources![0];
  const edge: MeshSelection = { modelId: model.id, meshId: resource.meshes[0].id, kind: "edge", edgeIds: ["v1", "v2"] };
  const face: MeshSelection = { modelId: model.id, meshId: resource.meshes[0].id, kind: "face", triangle: 0 };
  return { project, model, resource, edge, face };
}
function close(actual: number[], expected: number[], epsilon = 1e-9) {
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < epsilon, `${actual} != ${expected}`));
}
test("triangulated edges deduplicate shared endpoints by IDs within a submesh, retaining diagonals and independent coincident edges", () => {
  const { resource, project, edge } = fixture(), edges = meshEdges(resource, resource.meshes[0].id);
  assert.equal(edges.length, 7);
  assert.equal(edges.filter(e => e.ids.join() === "v1,v3").length, 1);
  assert.ok(edges.some(e => e.ids.join() === "v3,v5"));
  assert.equal(meshEdges(resource, resource.meshes[1].id).length, 3);
  assert.deepEqual(resolveElement(project, { ...edge, kind: "edge", edgeIds: ["v2", "v1"] })!.indices, [0, 1]);
  assert.equal(elementKey(edge), elementKey({ ...edge, kind: "edge", edgeIds: ["v2", "v1"] }));
  const coincident = coincidentElements(project, { ...edge, kind: "edge", edgeIds: ["v1", "v3"] });
  assert.equal(coincident.length, 2); assert.notEqual(elementKey(coincident[0]), elementKey(coincident[1]));
});
test("mode/submesh switches clear elements while retaining active model scope and invalid references resolve to no selection", () => {
  const { project, edge, resource, face } = fixture();
  for (const mode of ["vertex", "edge", "face"] as const) {
    const cleared = clearElement(edge, mode);
    assert.equal(cleared.modelId, edge.modelId); assert.equal(cleared.meshId, edge.meshId);
    assert.equal(selectionMode(cleared), mode); assert.equal(resolveElement(project, cleared)!.pivot, null);
  }
  assert.equal(clearElement(face, "face", resource.meshes[1].id).meshId, resource.meshes[1].id);
  assert.deepEqual(resolveElement(project, { ...edge, kind: "edge", edgeIds: ["v2", "v4"] })!.indices, []);
  assert.deepEqual(resolveElement(project, { ...face, kind: "face", triangle: 99 })!.indices, []);
  assert.equal(coincidentElements(project, { ...face, kind: "face", triangle: 1 }).length, 2);
});
test("edge and face reference positions are local midpoint/centroid and selection resolves each unique vertex once", () => {
  const { project, edge, face } = fixture();
  assert.deepEqual(resolveElement(project, edge)!.pivot, [1, 0, 0]);
  close(resolveElement(project, face)!.pivot!, [4 / 3, 2 / 3, 0]);
  assert.equal(new Set(resolveElement(project, face)!.indices).size, 3);
});
test("edge picking uses CSS-pixel segment distance across camera distances and orthographic zoom, with occlusion", () => {
  const { resource, model, edge } = fixture();
  for (const distance of [5, 40, 200]) for (const orthographic of [false, true]) {
    const camera = orthographic ? new OrthographicCamera(-5, 5, 5, -5, .1, 1000) : new PerspectiveCamera(45, 1, .1, 1000);
    camera.position.set(1, 0, distance); camera.lookAt(1, 0, 0);
    if (camera instanceof OrthographicCamera) { camera.zoom = 10 / distance; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld(true);
    const options = { resource, meshId: edge.meshId, matrix: objMatrix(model), camera, width: 1000, height: 1000 };
    assert.deepEqual(pickLogicalEdge({ ...options, pointer: { x: 500, y: 505 } }), ["v1", "v2"]);
    assert.equal(pickLogicalEdge({ ...options, pointer: { x: 500, y: 520 } }), null);
    assert.equal(pickLogicalEdge({ ...options, pointer: { x: 500, y: 500 }, visible: () => false }), null);
  }
});
test("perspective edge occlusion is checked at the perspective-correct closest world point", () => {
  const { resource, model, edge } = fixture(); resource.vertices[1].position = [2, 0, -6];
  const camera = new PerspectiveCamera(45, 1, .1, 1000); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const a = new Vector3(...resource.vertices[0].position).project(camera), b = new Vector3(...resource.vertices[1].position).project(camera);
  const pointer = { x: ((a.x + b.x) / 2 + 1) * 500, y: 500 };
  let sampled: Vector3 | undefined;
  assert.deepEqual(pickLogicalEdge({ resource, meshId: edge.meshId, matrix: objMatrix(model), camera, pointer, width: 1000, height: 1000,
    visible: point => { sampled = point; return true; } }), ["v1", "v2"]);
  assert.ok(sampled); close(sampled.toArray(), [2 * 10 / 26, 0, -6 * 10 / 26]);
});
test("real mesh raycasting maps expanded faceIndex to the active resource triangle and rejects unrelated foreground meshes", () => {
  const { resource, face } = fixture(), camera = new PerspectiveCamera(45, 1, .1, 100);
  camera.position.set(1.5, .5, 10); camera.lookAt(1.5, .5, 0); camera.updateMatrixWorld(true);
  const root = new Group(); root.name = `model-${face.modelId}`;
  const mesh = new Mesh(createObjGeometry(resource, resource.meshes[0]), new MeshStandardMaterial({ side: DoubleSide }));
  mesh.userData.objMeshId = face.meshId; root.add(mesh); root.updateMatrixWorld(true);
  const options = { camera, pointer: { x: 500, y: 500 }, width: 1000, height: 1000, objects: [mesh], modelId: face.modelId, meshId: face.meshId };
  assert.equal(pickLogicalFace(options), 0);
  assert.equal(pickLogicalFace({ ...options, meshId: "other" }), null);
  const blocker = mesh.clone(); blocker.position.z = 5; blocker.userData = { objMeshId: "unrelated" }; blocker.updateMatrixWorld(true);
  assert.equal(pickLogicalFace({ ...options, objects: [blocker, mesh] }), null);
  assert.equal(vertexVisible(new Vector3(1.5, .5, 0), camera, [blocker]), false);
  mesh.geometry.dispose(); mesh.material.dispose();
});
for (const kind of ["edge", "face"] as const) {
  test(`${kind}: shared vertex translation preserves relative positions, topology, UVs, independent vertices and object state`, () => {
    const f = fixture(), selected = f[kind], target = resolveElement(f.project, selected)!, before = structuredClone(f.project);
    const delta = [.4, .2, .6], next = translateMeshElement(f.project, selected, target.pivot!.map((n, i) => n + delta[i]) as Vec3, "unused");
    assert.deepEqual(f.project, before); assert.equal(next.models, f.project.models);
    f.resource.vertices.forEach((v, i) => close(next.objResources![0].vertices[i].position,
      v.position.map((n, axis) => n + (target.indices.includes(i) ? delta[axis] : 0))));
    assert.deepEqual(next.objResources![0].meshes.map(m => m.triangles), f.resource.meshes.map(m => m.triangles));
    assert.deepEqual(next.objResources![0].meshes.map(m => m.uvs), f.resource.meshes.map(m => m.uvs));
    assert.deepEqual(next.objResources![0].vertices[4], f.resource.vertices[4]);
  });
  test(`${kind}: world gizmo conversion under XYZ rotation and non-uniform scale translates all resolved vertices equally`, () => {
    const f = fixture(), selected = f[kind]; Object.assign(f.model, { position: [5, 8, 3], rotation: 35, rotationXYZ: [20, 35, -40], scale: [.5, 3, 2] });
    const target = resolveElement(f.project, selected)!, matrix = objMatrix(f.model);
    const world = new Vector3(...target.pivot!).applyMatrix4(matrix).add(new Vector3(.3, -.2, .4));
    const local = vertexLocalPosition(f.model, world) as Vec3, next = translateMeshElement(f.project, selected, local, "unused");
    for (const index of target.indices) {
      const previous = new Vector3(...f.resource.vertices[index].position).applyMatrix4(matrix);
      const moved = new Vector3(...next.objResources![0].vertices[index].position).applyMatrix4(matrix);
      close(moved.sub(previous).toArray(), [.3, -.2, .4]);
    }
    assert.deepEqual(next.models, f.project.models);
  });
  test(`${kind}: existing transaction history, no-op, cancellation/stale, JSON persistence and OBJ round-trip remain consistent`, () => {
    const f = fixture(), selected = f[kind], target = resolveElement(f.project, selected)!;
    const session = beginMeshTransformSession(f.project, selected)!;
    const edited = updateTransformSession(session, { elementPosition: target.pivot!.map((n, i) => n + [.2, .1, .7][i]) });
    const history = { past: [] as Project[], present: f.project, future: [] as Project[] };
    assert.equal(commitTransformHistory(history, session), history); assert.equal(commitTransformHistory(history, null), history);
    const committed = commitTransformHistory(history, edited); assert.equal(committed.past.length, 1);
    assert.equal(commitTransformHistory(committed, edited), committed);
    assert.equal(commitTransformHistory(history, updateTransformSession(edited, { elementPosition: target.pivot })), history);
    assert.deepEqual(parseProject(serializeProject(committed.present)), committed.present);
    const file = exportSelectedObj(committed.present, { type: "model", id: f.model.id });
    const restored = prepareObjImport(emptyProject(), file.text, file.name).project.objResources![0];
    restored.vertices.forEach((v, i) => close(v.position, committed.present.objResources![0].vertices[i].position));
    assert.deepEqual(restored.meshes.map(m => m.triangles), f.resource.meshes.map(m => m.triangles));
    assert.deepEqual(restored.meshes.map(m => m.uvs), f.resource.meshes.map(m => m.uvs));
  });
  test(`${kind}: degeneracy, out-of-range vertices and invalid normals reject the whole edit without mutation`, () => {
    const f = fixture(), selected = f[kind], pivot = resolveElement(f.project, selected)!.pivot!;
    const before = structuredClone(f.project);
    for (const delta of [[0, 2, 0], [10000, 0, 0], [NaN, 0, 0]])
      assert.throws(() => translateMeshElement(f.project, selected, pivot.map((n, i) => n + delta[i]) as Vec3, "unused"));
    assert.deepEqual(f.project, before);
    f.resource.meshes[0].normals!.fill(0);
    assert.throws(() => translateMeshElement(f.project, selected, pivot.map((n, i) => n + [0, 0, 1][i]) as Vec3, "unused"), /法线/);
  });
}
test("fully translated face retains exact authored corner normals; partially affected neighbours rotate normals without welding seams", () => {
  const { project, face, resource } = fixture(), target = resolveElement(project, face)!;
  const next = translateMeshElement(project, face, target.pivot!.map((n, i) => n + [.2, .1, .7][i]) as Vec3, "unused");
  const normals = next.objResources![0].meshes[0].normals!;
  assert.deepEqual(normals.slice(0, 9), resource.meshes[0].normals!.slice(0, 9));
  assert.notDeepEqual(normals.slice(9, 18), resource.meshes[0].normals!.slice(9, 18));
  for (let i = 0; i < normals.length; i += 3)
    assert.ok(Math.abs(new Vector3(...normals.slice(i, i + 3) as Vec3).length() - new Vector3(...resource.meshes[0].normals!.slice(i, i + 3) as Vec3).length()) < 1e-9);
});
for (const kind of ["edge", "face"] as const) test(`${kind}: shared resources detach once while locked/hidden elements cannot start a transaction`, () => {
  const f = fixture(), selected = f[kind]; f.project.models.push({ ...f.model, id: "copy" });
  const target = resolveElement(f.project, selected)!;
  const session = beginMeshTransformSession(f.project, selected)!;
  const once = updateTransformSession(session, { elementPosition: target.pivot!.map((n, i) => n + [0, 0, .1][i]) });
  const twice = updateTransformSession(once, { elementPosition: target.pivot!.map((n, i) => n + [0, 0, .2][i]) });
  assert.equal(twice.draft.objResources!.length, 2); assert.equal(twice.draft.objResources![0], f.resource);
  assert.equal((once.draft.models.find(m => m.id === f.model.id) as ObjModel).resourceId,
    (twice.draft.models.find(m => m.id === f.model.id) as ObjModel).resourceId);
  for (const field of ["locked", "visible"] as const) {
    f.model[field] = field === "locked";
    assert.equal(beginMeshTransformSession(f.project, selected), null);
    f.model[field] = field !== "locked";
  }
});
