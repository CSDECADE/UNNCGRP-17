import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeRoutes } from "../src/features/analysis/route-analysis.ts";
import { emptyProject, exampleProject, parseProject, poseAt, serializeProject } from "../src/core/project.ts";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { exportSelectedObj } from "../src/features/obj-export/obj.ts";
import { beginMeshTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import { withSelectionElements } from "../src/core/mesh-edit.ts";
import type { ObjModel, Project } from "../src/core/types.ts";

function fixture() {
  const { project } = prepareObjImport(exampleProject(), "v 40 15 20\nv 44 15 20\nv 44 19 20\nv 40 19 20\nv 40 15 20\no A\nf 1 2 3\nf 1 3 4\nf 5 4 3", "audit-building.obj");
  const model = project.models.find(m => m.kind === "obj") as ObjModel;
  const a = { modelId: model.id, meshId: project.objResources![0].meshes[0].id, kind: "face" as const, triangle: 0 };
  return { project, model, selected: withSelectionElements(a, [a, { ...a, triangle: 1 }]) };
}

test("audit: current route analysis and UAV poses are independent of edited OBJ geometry and static-model transforms", () => {
  const { project, model, selected } = fixture(), expected = analyzeRoutes(project);
  const poses = project.drones.map(drone => [0, .37, 1].map(progress => poseAt(project, drone, progress)));
  const session = updateTransformSession(beginMeshTransformSession(project, selected)!, { elementDelta: [.25, .5, .75] });
  const committed = commitTransformHistory({ past: [] as Project[], present: project, future: [] as Project[] }, session).present;
  const changed: Project = { ...committed, models: committed.models.map(item => item.id === model.id
    ? { ...model, position: [100, 20, 0], rotation: 35, rotationXYZ: [20, 35, -40], scale: [.5, 3, 2] }
    : { ...item, position: [50, 0, 50], rotation: 45, size: [30, 40, 20] }) };
  assert.deepEqual(analyzeRoutes(changed), expected);
  assert.deepEqual(changed.drones.map(drone => [0, .37, 1].map(progress => poseAt(changed, drone, progress))), poses);
  assert.equal(changed.drones, project.drones); assert.equal(changed.viewpoints, project.viewpoints);
});

test("audit: 65 repeated group transactions preserve immutable snapshots, enforce the 60-entry cap and export final geometry", () => {
  const { project, model, selected } = fixture(), original = structuredClone(project);
  let history = { past: [] as Project[], present: project, future: [] as Project[] };
  for (let i = 0; i < 65; i++) {
    const session = beginMeshTransformSession(history.present, selected)!;
    const first = updateTransformSession(session, { elementDelta: [0, 0, .0003] });
    const final = updateTransformSession(first, { elementDelta: [0, 0, .001] });
    history = commitTransformHistory(history, final);
  }
  assert.equal(history.past.length, 60); assert.deepEqual(project, original);
  assert.ok(Math.abs(history.past[0].objResources![0].vertices[0].position[2] - 20.005) < 1e-9);
  for (const index of [0, 1, 2, 3])
    assert.ok(Math.abs(history.present.objResources![0].vertices[index].position[2] - 20.065) < 1e-9);
  assert.deepEqual(history.present.objResources![0].vertices[4], project.objResources![0].vertices[4]);
  assert.deepEqual(parseProject(serializeProject(history.present)), history.present);
  const output = exportSelectedObj(history.present, { type: "model", id: model.id });
  const restored = prepareObjImport(emptyProject(), output.text, output.name).project.objResources![0];
  assert.deepEqual(restored.vertices.map(v => v.position), history.present.objResources![0].vertices.map(v => v.position));
  assert.deepEqual(restored.meshes.map(m => m.triangles), history.present.objResources![0].meshes.map(m => m.triangles));
});
