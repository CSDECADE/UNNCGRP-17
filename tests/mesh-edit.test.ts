import assert from "node:assert/strict";
import { test } from "node:test";
import { BoxGeometry, Mesh, MeshStandardMaterial, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { emptyProject, parseProject, serializeProject } from "../src/core/project.ts";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { editableObj, meshGeometryUnchanged, meshVertexIndices, pickLogicalVertex, resolveVertex, translateLogicalVertex, vertexLocalPosition, vertexVisible, vertexWorldPosition } from "../src/core/mesh-edit.ts";
import { objMatrix } from "../src/core/obj-transform.ts";
import { beginVertexTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import { exportSelectedObj } from "../src/features/obj-export/obj.ts";
import { createObjGeometry } from "../src/features/obj-import/geometry.ts";
import type { ObjModel, Project, Vec3 } from "../src/core/types.ts";

function fixture() {
  const result = prepareObjImport(emptyProject(), `v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nv 0 0 0\no A\nf 1 2 3\nf 1 3 4\nf 5 4 3\no B\nf 1 4 3`, "edit.obj");
  const model = result.project.models[0];
  assert.equal(model.kind, "obj");
  if (model.kind !== "obj") throw new Error("fixture");
  const resource = result.project.objResources![0];
  return { project: result.project, model, resource,
    selected: { modelId: model.id, meshId: resource.meshes[0].id, vertexId: "v1" } };
}
const unrestricted = { preview: false, playing: false, candidate: false, droneView: false };
test("Edit Mode accepts only active visible unlocked OBJ outside playback/candidate/drone view", () => {
  const { project, model } = fixture(), selection = { type: "model" as const, id: model.id };
  assert.ok(editableObj(project, selection, unrestricted));
  for (const key of Object.keys(unrestricted)) assert.equal(editableObj(project, selection, { ...unrestricted, [key]: true }), null);
  for (const field of ["locked", "visible"] as const) {
    const next = structuredClone(project); next.models[0][field] = field === "locked";
    assert.equal(editableObj(next, selection, unrestricted), null);
  }
  assert.equal(editableObj(project, null, unrestricted), null);
  assert.equal(editableObj(project, { type: "drone", id: model.id }, unrestricted), null);
  const builtin = { ...model, kind: "box" as const };
  assert.equal(editableObj({ ...project, models: [builtin] }, selection, unrestricted), null);
});
test("vertex selection uses stable IDs, one active submesh and never welds coincident vertices", () => {
  const { project, resource, selected } = fixture();
  assert.deepEqual(meshVertexIndices(resource, selected.meshId), [0, 1, 2, 3, 4]);
  assert.equal(resolveVertex(project, selected)?.vertex?.id, "v1");
  assert.equal(resolveVertex(project, { ...selected, vertexId: "v5" })?.vertex?.id, "v5");
  assert.equal(resolveVertex(project, { ...selected, meshId: resource.meshes[1].id, vertexId: "v5" })?.vertex, null);
  assert.equal(resolveVertex(project, { ...selected, meshId: "missing" }), null);
});
test("logical picking has constant CSS-pixel tolerance under perspective distance and orthographic zoom", () => {
  const { model, resource, selected } = fixture();
  for (const distance of [5, 50, 300]) for (const orthographic of [false, true]) {
    const camera = orthographic ? new OrthographicCamera(-5, 5, 5, -5, .1, 1000) : new PerspectiveCamera(45, 1, .1, 1000);
    if (camera instanceof OrthographicCamera) { camera.zoom = 30 / distance; camera.updateProjectionMatrix(); }
    camera.position.set(0, 0, distance); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const common = { resource, meshId: selected.meshId, matrix: objMatrix(model), camera, width: 1000, height: 1000 };
    assert.equal(pickLogicalVertex({ ...common, pointer: { x: 495, y: 505 } }), "v1");
    assert.equal(pickLogicalVertex({ ...common, pointer: { x: 480, y: 520 } }), null);
    assert.equal(pickLogicalVertex({ ...common, pointer: { x: 500, y: 500 }, visible: () => false }), null);
    assert.equal(pickLogicalVertex({ ...common, pointer: { x: 500, y: 500 }, visible: (_p, i) => i === 4 }), "v5");
  }
});
test("occlusion prevents selecting through unrelated foreground surfaces", () => {
  const camera = new PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const blocker = new Mesh(new BoxGeometry(2, 2, 1), new MeshStandardMaterial()); blocker.position.z = 5; blocker.updateMatrixWorld(true);
  assert.equal(vertexVisible(new Vector3(), camera, [blocker]), false);
  assert.equal(vertexVisible(new Vector3(0, 0, 6), camera, [blocker]), true);
  assert.equal(vertexVisible(new Vector3(), camera, []), true);
  blocker.geometry.dispose(); blocker.material.dispose();
});

test("local edit updates every shared triangle corner without moving independent coincident vertices or object transforms", () => {
  const { project, model, resource, selected } = fixture(), before = structuredClone(project);
  const next = translateLogicalVertex(project, selected, [-.5, 0, 1], "unused");
  assert.deepEqual(project, before); assert.equal(next.models, project.models);
  assert.deepEqual(next.models[0], model); assert.equal(next.objResources![0].vertices[0].id, "v1");
  assert.deepEqual(next.objResources![0].vertices[4].position, [0, 0, 0]);
  assert.deepEqual(next.objResources![0].meshes.map(m => m.triangles), resource.meshes.map(m => m.triangles));
  for (const mesh of next.objResources![0].meshes) {
    const geometry = createObjGeometry(next.objResources![0], mesh), positions = geometry.getAttribute("position");
    mesh.triangles.forEach((index, corner) => {
      const expected = index === 0 ? [-.5, 0, 1] : resource.vertices[index].position;
      assert.deepEqual([positions.getX(corner), positions.getY(corner), positions.getZ(corner)], expected);
    });
    assert.ok(geometry.boundingBox!.containsPoint(new Vector3(-.5, 0, 1)));
    assert.ok(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)); geometry.dispose();
  }
});
test("world XYZ gizmo positions invert a rotated non-uniform instance matrix without changing object transforms", () => {
  const { project, model, resource, selected } = fixture();
  Object.assign(model, { position: [8, -3, 5], rotation: 35, rotationXYZ: [20, 35, -40], scale: [.5, 3, 2] });
  const start = vertexWorldPosition(model, resource, 0), objectBefore = structuredClone(model);
  for (let axis = 0; axis < 3; axis++) {
    const end = start.clone(); end.setComponent(axis, end.getComponent(axis) + .3);
    const local = vertexLocalPosition(model, end) as Vec3;
    const changed = translateLogicalVertex(project, selected, local, "unused");
    const actual = vertexWorldPosition(model, changed.objResources![0], 0);
    assert.ok(actual.distanceTo(end) < 1e-10); assert.deepEqual(changed.models[0], objectBefore);
  }
});
test("only affected render meshes change; UVs, winding and per-corner hard normal distinctions survive", () => {
  const { project, resource, selected } = fixture();
  resource.vertices.push({ id: "v6", position: [0, 0, 4] }, { id: "v7", position: [1, 0, 4] }, { id: "v8", position: [0, 1, 4] });
  resource.meshes.push({ id: "unrelated", name: "unrelated", triangles: [5, 6, 7] });
  const mesh = resource.meshes[0]; mesh.uvs = mesh.triangles.flatMap((_, i) => [i % 2, 0]);
  mesh.normals = mesh.triangles.flatMap((_, i) => i < 3 ? [0, 0, 1] : [0, 1, 1]);
  const oldNormals = [...mesh.normals], next = translateLogicalVertex(project, selected, [0, 0, .7], "unused");
  const changed = next.objResources![0];
  assert.equal(changed.meshes[2], resource.meshes[2]);
  assert.equal(meshGeometryUnchanged(resource, changed, resource.meshes[2]), true);
  assert.equal(meshGeometryUnchanged(resource, { ...changed, id: "detached" }, resource.meshes[2]), true);
  assert.equal(meshGeometryUnchanged(resource, changed, resource.meshes[0]), false);
  assert.equal(changed.meshes[0].uvs, mesh.uvs); assert.equal(changed.meshes[0].triangles, mesh.triangles);
  assert.notDeepEqual(changed.meshes[0].normals, oldNormals);
  assert.deepEqual(changed.meshes[0].normals!.slice(18), oldNormals.slice(18)); // unaffected triangle's authored normals
  // Each changed face rotates its authored corner vectors without averaging or changing their length.
  for (let i = 0; i < oldNormals.length; i += 3) {
    const previous = new Vector3(...oldNormals.slice(i, i + 3) as Vec3);
    const actual = new Vector3(...changed.meshes[0].normals!.slice(i, i + 3) as Vec3);
    assert.ok(Math.abs(previous.length() - actual.length()) < 1e-10);
  }
  assert.deepEqual(mesh.normals, oldNormals);
});
test("one vertex gesture reuses object history; cancellation, no-op and stale completion make no entries", () => {
  const { project, selected } = fixture();
  let session = beginVertexTransformSession(project, selected)!;
  session = updateTransformSession(session, { vertexPosition: [-.2, 0, .4] });
  session = updateTransformSession(session, { vertexPosition: [-.3, 0, .5] });
  const history = { past: [] as Project[], present: project, future: [] as Project[] };
  const result = commitTransformHistory(history, session);
  assert.equal(result.past.length, 1); assert.equal(result.past[0], project);
  assert.deepEqual(result.present.objResources![0].vertices[0].position, [-.3, 0, .5]);
  assert.equal(commitTransformHistory(result, session), result);
  assert.equal(commitTransformHistory(history, null), history);
  assert.equal(commitTransformHistory(history, beginVertexTransformSession(project, selected)), history);
  const returned = updateTransformSession(session, { vertexPosition: [0, 0, 0] });
  assert.equal(commitTransformHistory(history, returned), history);
  assert.deepEqual(result.past[0], project); // undo restores resource references and values
});
test("shared instances detach their resource once per committed gesture and undo restores original sharing", () => {
  const { project, model, resource, selected } = fixture();
  project.models.push({ ...model, id: "copy", position: [20, 0, 0] });
  const session = beginVertexTransformSession(project, selected)!;
  const a = updateTransformSession(session, { vertexPosition: [-1, 0, 0] });
  const b = updateTransformSession(a, { vertexPosition: [-2, 0, 0] });
  assert.equal(b.draft.objResources!.length, 2);
  assert.equal((b.draft.models[0] as ObjModel).resourceId, (a.draft.models[0] as ObjModel).resourceId);
  assert.equal(b.draft.objResources![0], resource); assert.equal(b.draft.models[1], project.models[1]);
  assert.equal(resolveVertex(b.draft, selected)?.vertex?.id, "v1");
  assert.equal(resolveVertex(b.draft, { ...selected, modelId: "copy" })?.vertex, resource.vertices[0]);
  const history = commitTransformHistory({ past: [] as Project[], present: project, future: [] as Project[] }, b);
  assert.equal(history.past[0].objResources!.length, 1);
});
test("edited resources survive JSON save/restore and selected OBJ export/re-import with transforms baked once", () => {
  const { project, model, selected } = fixture();
  Object.assign(model, { position: [8, 4, 5], rotation: 35, rotationXYZ: [20, 35, -40], scale: [.5, 3, 2] });
  const changed = translateLogicalVertex(project, selected, [-1, 0, .5], "unused");
  const restored = parseProject(serializeProject(changed)); assert.deepEqual(restored, changed);
  const output = exportSelectedObj(restored, { type: "model", id: model.id });
  const imported = prepareObjImport(emptyProject(), output.text, output.name);
  changed.objResources![0].vertices.forEach((v, i) => {
    const expected = new Vector3(...v.position).applyMatrix4(objMatrix(model));
    assert.ok(expected.distanceTo(new Vector3(...imported.project.objResources![0].vertices[i].position)) < 1e-10);
  });
  assert.deepEqual(imported.project.objResources![0].meshes.map(m => m.triangles), changed.objResources![0].meshes.map(m => m.triangles));
});
test("invalid positions, degenerate faces and restricted targets never change source resources", () => {
  const { project, resource, selected } = fixture(), before = structuredClone(project);
  for (const position of [[NaN, 0, 0], [10001, 0, 0], [2, 0, 0]] as Vec3[])
    assert.throws(() => translateLogicalVertex(project, selected, position, "unused"));
  assert.deepEqual(project, before);
  for (const field of ["locked", "visible"] as const) {
    const next = structuredClone(project); next.models[0][field] = field === "locked";
    assert.equal(beginVertexTransformSession(next, selected), null);
  }
  assert.equal(beginVertexTransformSession(project, { ...selected, vertexId: "missing" }), null);
  assert.equal(resource.vertices[0].id, "v1");
});
