import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyProject, exampleProject, importPlan, PATH_TARGET_DISTANCE } from "../src/core/project.ts";
import { ProjectValidationError, UserInputError } from "../src/core/feedback.ts";

const path = [
  { id: 2, x: 10, y: 20, z: -30, normal: { x: 0, y: 0, z: 2 } },
  { id: 1, x: 1, y: 2, z: 3, normal: { x: -1, y: 0, z: 0 } },
];

test("imports a path array onto the first drone and keeps other routes", () => {
  const project = exampleProject();
  const [first, second] = project.drones;
  const result = importPlan(JSON.stringify(path), project);
  const route = result.viewpoints.filter((v) => v.droneId === first.id);
  assert.equal(result.source, "导入的算法结果");
  assert.deepEqual(route.map((v) => v.name), ["拍摄点 1", "拍摄点 2"]);
  assert.deepEqual(route[0].position, [1, 2, 3]);
  assert.deepEqual(route[0].target, [1 - PATH_TARGET_DISTANCE, 2, 3]);
  // Normal is normalised before offsetting the target.
  assert.deepEqual(route[1].target, [10, 20, -30 + PATH_TARGET_DISTANCE]);
  assert.deepEqual(
    result.viewpoints.filter((v) => v.droneId === second.id),
    project.viewpoints.filter((v) => v.droneId === second.id),
  );
});

test("creates a drone at the first point when the scene has none", () => {
  const result = importPlan(JSON.stringify(path), emptyProject());
  assert.equal(result.drones.length, 1);
  assert.deepEqual(result.drones[0].position, [1, 2, 3]);
  assert.equal(result.viewpoints.length, 2);
});

test("rejects empty paths, malformed points and duplicate ids", () => {
  assert.throws(() => importPlan("[]", exampleProject()), UserInputError);
  assert.throws(() => importPlan(JSON.stringify([{ id: 1, x: 0, y: 0, z: 0 }]), exampleProject()), ProjectValidationError);
  assert.throws(() => importPlan(JSON.stringify([{ ...path[0], normal: { x: 0, y: 0, z: 0 } }]), exampleProject()), ProjectValidationError);
  assert.throws(() => importPlan(JSON.stringify([path[0], path[0]]), exampleProject()), ProjectValidationError);
});

test("still accepts the versioned plan format", () => {
  const project = exampleProject();
  const result = importPlan(JSON.stringify({ version: 1, viewpoints: project.viewpoints }), project);
  assert.equal(result.viewpoints.length, project.viewpoints.length);
});
