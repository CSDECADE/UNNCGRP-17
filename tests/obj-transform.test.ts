import assert from "node:assert/strict";
import { test } from "node:test";
import { Vector3 } from "three";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { emptyProject, exampleProject, parseProject, serializeProject, validateProject } from "../src/core/project.ts";
import { beginTransformSession, updateTransformSession, commitTransformHistory } from "../src/core/transform.ts";
import { modelBounds, objWorldBounds } from "../src/core/model-bounds.ts";
import { objChangeAroundCenter, objMatrix, objPivot, objPositionFromPivot, objRotation, objScale } from "../src/core/obj-transform.ts";
import { ProjectValidationError } from "../src/core/errors.ts";
import type { ObjModel, Project, Vec3 } from "../src/core/types.ts";

function fixture() {
  const { project, model } = prepareObjImport(exampleProject(),
    "v 10 0 20\nv 14 0 20\nv 14 6 20\nv 10 6 20\nv 10 0 16\nv 10 6 16\no A\nf 1 2 3 4\no B\nf 1 4 6 5", "walls.obj");
  return { project, model: model as ObjModel };
}
const options = { target: "position" as const, snap: 0, lockHeight: false };
function session(project: Project, model: ObjModel) {
  const session = beginTransformSession(project, { type: "model", id: model.id }, options);
  assert.ok(session);
  return session;
}
const selected = (project: Project, id: string) => project.models.find(m => m.id === id) as ObjModel;
function close(actual: number[], expected: number[], tolerance = 1e-8) {
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < tolerance, `${actual} differs from ${expected}`));
}

test("OBJ translations use world XYZ, including negative Y, without modifying resources or UAVs", () => {
  const { project, model } = fixture(), before = structuredClone(project);
  for (let axis = 0; axis < 3; axis++) {
    const position: Vec3 = [0, 0, 0]; position[axis] = -7;
    const changed = updateTransformSession(session(project, model), { position });
    assert.deepEqual(selected(changed.draft, model.id).position, position);
    assert.equal(changed.draft.objResources, project.objResources);
    assert.equal(changed.draft.viewpoints, project.viewpoints);
    assert.equal(changed.draft.drones, project.drones);
  }
  assert.deepEqual(project, before);
});

test("full XYZ rotation updates orientation and its compatible Y mirror", () => {
  const { project, model } = fixture();
  for (let axis = 0; axis < 3; axis++) {
    const rotationXYZ: Vec3 = [0, 0, 0]; rotationXYZ[axis] = 90;
    const result = updateTransformSession(session(project, model), { rotationXYZ });
    const edited = selected(result.draft, model.id);
    assert.deepEqual(objRotation(edited), rotationXYZ);
    assert.equal(edited.rotation, rotationXYZ[1]);
    assert.deepEqual(parseProject(serializeProject(result.draft)), result.draft);
  }
});

test("uniform/non-uniform scale factors never repurpose size or mutate local geometry", () => {
  const { project, model } = fixture();
  for (const scale of [[2, 2, 2], [.5, 2, 3]] as Vec3[]) {
    const changed = updateTransformSession(session(project, model), { scale, size: [99, 99, 99] });
    assert.deepEqual(objScale(selected(changed.draft, model.id)), scale);
    assert.deepEqual(selected(changed.draft, model.id).size, model.size);
    assert.equal(changed.draft.objResources, project.objResources);
    assert.deepEqual(parseProject(serializeProject(changed.draft)), changed.draft);
  }
});

test("numerical edits and gizmo compensation preserve the same off-origin centre pivot", () => {
  const { project, model } = fixture(), center = modelBounds(model, project).center;
  const originalPivot = objPivot(model, center), rotationXYZ: Vec3 = [35, 60, -15], scale: Vec3 = [.5, 2, 3];
  const values = objChangeAroundCenter(model, center, { rotationXYZ, scale });
  const changed = updateTransformSession(session(project, model), values);
  const edited = selected(changed.draft, model.id);
  close(objPivot(edited, center), originalPivot);
  close(values.position, objPositionFromPivot(originalPivot, rotationXYZ, scale, center));
  const movedPivot = originalPivot.map((n, i) => n + [2, 3, -4][i]) as Vec3;
  const moved = updateTransformSession(session(changed.draft, edited), {
    position: objPositionFromPivot(movedPivot, rotationXYZ, scale, center),
  });
  close(objPivot(selected(moved.draft, model.id), center), movedPivot);
});

test("one completed gesture makes one history entry; no-op, cancelled and stale gestures make none", () => {
  const { project, model } = fixture();
  const history = { past: [] as Project[], present: project, future: [] as Project[] };
  let draft = session(project, model);
  for (let i = 1; i <= 10; i++) draft = updateTransformSession(draft, { position: [i, 0, 0] });
  assert.equal(history.present, project);
  const committed = commitTransformHistory(history, draft);
  assert.equal(committed.past.length, 1);
  assert.equal(committed.past[0], project);
  assert.deepEqual(selected(committed.present, model.id).position, [10, 0, 0]);
  assert.equal(commitTransformHistory(history, null), history);
  assert.equal(commitTransformHistory(history, session(project, model)), history);
  assert.equal(commitTransformHistory(committed, draft), committed);
  const undone = { past: [], present: committed.past[0], future: [committed.present] };
  assert.deepEqual(selected(undone.present, model.id), model);
  assert.deepEqual(selected(undone.future[0], model.id).position, [10, 0, 0]);
  const restored = updateTransformSession(draft, { position: model.position });
  assert.equal(commitTransformHistory(history, restored), history);
});

test("legacy OBJ yaw/default scale and version 1 built-in transformation behavior remain compatible", () => {
  const { project, model } = fixture();
  const legacy = { ...model, rotation: 45 };
  close(objRotation(legacy), [0, 45, 0]); close(objScale(legacy), [1, 1, 1]);
  const loaded = parseProject(serializeProject({ ...project, models: [legacy] }));
  assert.equal(selected(loaded, model.id).rotationXYZ, undefined);
  assert.equal(selected(loaded, model.id).scale, undefined);
  const builtin = exampleProject(), item = builtin.models[0];
  const started = beginTransformSession(builtin, { type: "model", id: item.id }, options)!;
  const changed = updateTransformSession(started, { position: [3, -5, 4], rotation: 90, size: [8, 9, 10] });
  assert.deepEqual(changed.draft.models[0].position, [3, 0, 4]);
  assert.equal(changed.draft.models[0].rotation, 90);
  assert.deepEqual(changed.draft.models[0].size, [8, 9, 10]);
  assert.equal(parseProject(serializeProject(changed.draft)).version, 1);
  assert.equal(emptyProject().version, 1);
  assert.throws(() => validateProject({ ...builtin, models: [{ ...item, scale: [2, 2, 2] }] }), ProjectValidationError);
});

test("locked and hidden objects cannot start transactions; invalid values cannot enter a draft", () => {
  const { project, model } = fixture();
  for (const properties of [{ locked: true }, { visible: false }]) {
    const restricted = { ...project, models: [{ ...model, ...properties }] };
    assert.equal(beginTransformSession(restricted, { type: "model", id: model.id }, options), null);
  }
  const started = session(project, model);
  assert.equal(updateTransformSession(started, { position: [NaN, 0, 0], rotationXYZ: [0, Infinity, 0], scale: [1, 2] }).draft, project);
  assert.equal(updateTransformSession(started, { position: new Array(3), rotationXYZ: new Array(3) }).draft, project);
  const clamped = selected(updateTransformSession(started, { scale: [-2, 0, 20000], position: [20000, -20000, 0] }).draft, model.id);
  assert.deepEqual(clamped.scale, [.01, .01, 10000]);
  assert.deepEqual(clamped.position, [10000, -10000, 0]);
});

test("invalid saved transforms and mismatched rotation representations fail explicitly", () => {
  const { project, model } = fixture();
  for (const properties of [
    { rotationXYZ: [10, 20, 30] }, { rotationXYZ: [10, 0] }, { rotationXYZ: [NaN, 0, 0] },
    { rotationXYZ: [0, 0, Infinity] }, { scale: [0, 1, 1] }, { scale: [-1, 1, 1] },
    { scale: [.001, 1, 1] }, { scale: [10001, 1, 1] }, { scale: null }, { scale: [1, 1] },
    { rotationXYZ: new Array(3) }, { scale: new Array(3) },
  ]) assert.throws(() => validateProject({ ...project, models: [{ ...model, ...properties }] }), ProjectValidationError);
});

test("multiple submeshes use one object matrix and transformed focus bounds enclose every rendered corner", () => {
  const { project, model } = fixture();
  const edited: ObjModel = { ...model, position: [7, 8, 9], rotation: 45, rotationXYZ: [30, 45, 60], scale: [2, .5, 3] };
  const transformed = { ...project, models: [edited] }, matrix = objMatrix(edited), bounds = objWorldBounds(edited, transformed);
  const resource = project.objResources![0];
  assert.equal(resource.meshes.length, 2);
  for (const mesh of resource.meshes) for (const index of mesh.triangles) {
    const point = new Vector3(...resource.vertices[index].position).applyMatrix4(matrix).toArray();
    point.forEach((n, i) => assert.ok(n >= bounds.center[i] - bounds.size[i] / 2 - 1e-8 && n <= bounds.center[i] + bounds.size[i] / 2 + 1e-8));
  }
  assert.deepEqual(parseProject(serializeProject(transformed)), transformed);
});
