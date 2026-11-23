import assert from "node:assert/strict";
import { test } from "node:test";
import { applyNuavCaptureRoute, buildNuavOverlapRoute } from "../src/core/capture/nuav.ts";
import { captureFrames } from "../src/core/capture/format.ts";
import { emptyProject } from "../src/core/project.ts";
import type { BuildingFrame } from "../src/core/reconstruction.ts";

const frame: BuildingFrame = { upAxis: "z", offset: [-2, 3, 4] };
const start = { x: -20, y: 8, z: 10 };
const point = { x: -10, y: 12, z: 5 };
const plan = {
  format: "drone-coverage-path-nuav/v1",
  droneCount: 1,
  coverageParams: { fovDeg: 70 },
  drones: [{
    id: 1, start,
    path: [{ ...start, shot: 0 }, { ...point, shot: 1 }, { ...start, shot: 0 }],
    shots: [{ ...point, pathIndex: 1, axis: { x: 0, y: 1, z: 0 }, dist_m: 6 }],
  }],
};

test("单机航线只按标记生成照片，且沿 OBJ 朝向应用模型坐标变换", () => {
  const project = applyNuavCaptureRoute(emptyProject(), plan, frame);
  assert.deepEqual(project.drones[0].position, [-22, 13, -4]);
  assert.deepEqual(project.viewpoints[0].position, [-12, 8, -8]);
  assert.deepEqual(project.viewpoints[0].target, [-12, 8, -14]);
  const capture = captureFrames(project);
  assert.equal(capture.frames.length, 1);
  assert.equal(capture.cameras[0].fov, 70);
});

test("拍照元数据与航线标记错位时拒绝导入", () => {
  const broken = structuredClone(plan);
  broken.drones[0].shots[0].pathIndex = 0;
  assert.throws(() => applyNuavCaptureRoute(emptyProject(), broken, frame), /有效的单机/);
});

test("补拍沿原路径的转折点插值，并保留原照片编号映射", () => {
  const route = structuredClone(plan);
  const end = { x: -5, y: 17, z: 5 };
  route.drones[0].path = [
    { ...start, shot: 0 },
    { ...point, shot: 1 },
    { x: -5, y: 12, z: 5, shot: 0 },
    { ...end, shot: 1 },
    { ...start, shot: 0 },
  ];
  route.drones[0].shots.push({ ...end, pathIndex: 3, axis: { x: 0, y: 1, z: 0 }, dist_m: 6 });
  const { project, originalIndices } = buildNuavOverlapRoute(emptyProject(), route, frame, {
    fromShot: 1, toShot: 2, maxSpacingM: 5, maxHeadingDeg: 12,
  });
  assert.deepEqual(originalIndices, [0, 2]);
  assert.deepEqual(project.viewpoints.map(({ position }) => position), [
    [-12, 8, -8], [-7, 8, -8], [-7, 8, -13],
  ]);
});
