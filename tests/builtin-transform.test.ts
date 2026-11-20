import assert from "node:assert/strict";
import { test } from "node:test";
import { Quaternion } from "three";
import { exampleProject, makeModel, parseProject, poseAt, serializeProject } from "../src/core/project.ts";
import { beginTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import { modelControlPose, modelControlValues } from "../src/core/model-transform.ts";
import { objQuaternion } from "../src/core/obj-transform.ts";
import { analyzeRoutes } from "../src/features/analysis/route-analysis.ts";
import type { Model, ModelKind, Vec3 } from "../src/core/types.ts";

const options = { target: "position" as const, snap: 0, lockHeight: false };
const kinds: ModelKind[] = ["building", "box", "cylinder"];

for (const kind of kinds) {
  test(`${kind}: shared control adapter preserves bottom-origin, Y yaw and physical dimensions`, () => {
    const model: Model = { ...makeModel(kind, 1), position: [2, 3, 4], rotation: 35 };
    const pose = modelControlPose(model, [0, model.size[1] / 2, 0]);
    assert.deepEqual(pose.position, model.position);
    assert.deepEqual(pose.rotation, [0, 35, 0]);
    assert.deepEqual(pose.scale, model.size);
    assert.deepEqual(modelControlValues(model, "translate", [0, 99, 0], [8, 9, 10], new Quaternion(), [1, 1, 1]),
      { position: [8, 9, 10] });
    const rotated = modelControlValues({ ...model, rotation: 350 }, "rotate", [0, 99, 0], [0, 0, 0], objQuaternion([0, 10, 0]), model.size);
    assert.ok(Math.abs(Number(rotated.rotation) - 370) < 1e-8);
    assert.deepEqual(Object.keys(rotated), ["rotation"]);
    const size: Vec3 = [30, 12, 8];
    assert.deepEqual(modelControlValues(model, "scale", [0, 99, 0], [999, 999, 999], new Quaternion(), size), { size });
  });

  test(`${kind}: interactive/numeric updates share one transaction and serialize as legacy fields`, () => {
    const project = exampleProject(), model = makeModel(kind, 1);
    project.models = [model];
    project.viewpoints.forEach((v, i) => { v.time = (i % 4) * 6; });
    const original = structuredClone(project), originalAnalysis = analyzeRoutes(project);
    const beforePlayback = project.drones.map(d => poseAt(project, d, .5));
    const selection = { type: "model" as const, id: model.id };
    let session = beginTransformSession(project, selection, options)!;
    assert.ok(session);
    const control = (mode: "translate" | "rotate" | "scale", position: Vec3, rotation: number, size: Vec3) =>
      modelControlValues(model, mode, [0, model.size[1] / 2, 0], position, objQuaternion([0, rotation, 0]), size);
    session = updateTransformSession(session, control("translate", [5, -3, 8], 0, model.size));
    session = updateTransformSession(session, control("rotate", [0, 0, 0], 135, model.size));
    session = updateTransformSession(session, control("scale", [0, 0, 0], 0, [15, 16, 17]));
    session = updateTransformSession(session, control("scale", [0, 0, 0], 0, [20, 21, 22]));
    const updated = session.draft.models[0];
    assert.deepEqual(updated.position, [5, 0, 8]);
    assert.ok(Math.abs(updated.rotation - 135) < 1e-8);
    assert.deepEqual(updated.size, [20, 21, 22]); // absolute dimensions, never repeatedly multiplied
    assert.equal(Object.hasOwn(updated, "scale"), false);
    assert.equal(Object.hasOwn(updated, "rotationXYZ"), false);
    const history = { past: [] as typeof project[], present: project, future: [] as typeof project[] };
    const committed = commitTransformHistory(history, session);
    assert.equal(committed.past.length, 1);
    assert.equal(committed.past[0], project);
    assert.deepEqual(project, original);
    assert.deepEqual(parseProject(serializeProject(committed.present)), committed.present);
    assert.equal(committed.present.version, 1);
    assert.equal(commitTransformHistory(history, null), history);
    assert.equal(commitTransformHistory(committed, session), committed);
    assert.deepEqual(committed.present.drones, project.drones);
    assert.deepEqual(committed.present.viewpoints, project.viewpoints);
    assert.deepEqual(analyzeRoutes(committed.present), originalAnalysis);
    assert.deepEqual(committed.present.drones.map(d => poseAt(committed.present, d, .5)), beforePlayback);
    const numeric = beginTransformSession(committed.present, selection, options)!;
    const dimensions = updateTransformSession(numeric, { size: [12.3456, 8.5, 6.75] });
    assert.deepEqual(dimensions.draft.models[0].size, [12.3456, 8.5, 6.75]);
    assert.deepEqual(dimensions.draft.models[0].position, updated.position);
  });
}

test("built-in uniform/non-uniform dimensions retain the bottom anchor and old size constraints", () => {
  const project = exampleProject(), model = project.models[0], selection = { type: "model" as const, id: model.id };
  const session = beginTransformSession(project, selection, options)!;
  for (const size of [[48, 36, 28], [8, 40, 3], [-2, 0, 20000]] as Vec3[]) {
    const result = updateTransformSession(session, { size });
    assert.deepEqual(result.draft.models[0].position, model.position);
    assert.deepEqual(result.draft.models[0].size, size.map(n => Math.max(.1, Math.min(10000, Math.abs(n)))));
    assert.deepEqual(modelControlPose(result.draft.models[0], [0, 100, 0]).position, model.position);
  }
});

test("hidden/locked built-ins cannot start a gesture; cancelling/no-op leaves history untouched", () => {
  const project = exampleProject(), model = project.models[0], selection = { type: "model" as const, id: model.id };
  for (const fields of [{ visible: false }, { locked: true }]) {
    const restricted = { ...project, models: [{ ...model, ...fields }] };
    assert.equal(beginTransformSession(restricted, selection, options), null);
  }
  const history = { past: [], present: project, future: [] };
  const session = beginTransformSession(project, selection, options)!;
  assert.equal(commitTransformHistory(history, session), history);
  const moved = updateTransformSession(session, { position: [3, 4, 5] });
  const cancelled = updateTransformSession(moved, { position: model.position });
  assert.equal(commitTransformHistory(history, cancelled), history);
});
