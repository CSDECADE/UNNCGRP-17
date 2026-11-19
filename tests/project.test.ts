import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Box3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  clearTiming,
  emptyProject,
  exampleProject,
  importPlan,
  parseProject,
  poseAt,
  removeObject,
  reorderPoint,
  routeFor,
  timing,
  validateProject,
} from "../src/core/project.ts";

test("项目保存与重开保留完整场景及任务", () => {
  const p = exampleProject();
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  assert.deepEqual(validateProject(emptyProject()), emptyProject());
});
test("删除无人机会清除其拍摄点，保留其他任务", () => {
  const p = exampleProject(),
    id = p.drones[0].id,
    next = removeObject(p, "drone", id);
  assert.equal(next.drones.length, 1);
  assert.equal(next.viewpoints.length, 4);
  assert.ok(next.viewpoints.every((v) => v.droneId !== id));
  assert.equal(p.viewpoints.length, 8);
});
test("拒绝重复标识和不存在的无人机引用", () => {
  const p = exampleProject();
  p.models[0].id = p.drones[0].id;
  assert.throws(() => validateProject(p), /重复/);
  const q = exampleProject();
  q.viewpoints[0].droneId = "missing";
  assert.throws(() => validateProject(q), /不存在/);
});
test("拒绝无穷坐标、未知模型、零尺寸和非法视场角", () => {
  for (const mutate of [
    (p: any) => (p.models[0].position[0] = Infinity),
    (p: any) => (p.models[0].kind = "remote-url"),
    (p: any) => (p.models[0].size[1] = 0),
    (p: any) => (p.drones[0].fov = 180),
  ]) {
    const p = exampleProject();
    mutate(p);
    assert.throws(() => validateProject(p));
  }
});
test("拒绝不完整或不递增的时间数据", () => {
  const p = exampleProject();
  p.viewpoints[0].time = 0;
  assert.throws(() => validateProject(p), /完整/);
  const route = routeFor(p, p.drones[0].id);
  route.forEach((v) => (v.time = 1));
  assert.throws(() => validateProject(p), /递增/);
});
test("只有顺序的演示不得标记为实际时间", () => {
  assert.equal(timing(exampleProject()).timed, false);
});
test("含时间方案按统一秒数插值并在任务结束后保持位置", () => {
  const p = exampleProject();
  p.viewpoints = p.viewpoints.slice(0, 2);
  p.viewpoints[0].position = [0, 10, 0];
  p.viewpoints[0].time = 0;
  p.viewpoints[1].position = [20, 20, 10];
  p.viewpoints[1].time = 20;
  assert.deepEqual(poseAt(p, p.drones[0], 0.5).position, [10, 15, 5]);
  assert.deepEqual(poseAt(p, p.drones[0], 2).position, [20, 20, 10]);
  assert.equal(timing(p).duration, 20);
});
test("无航线的无人机保持设置的位置", () => {
  const p = emptyProject(),
    sample = exampleProject();
  p.drones = [sample.drones[0]];
  assert.deepEqual(poseAt(p, p.drones[0], 0.5).position, p.drones[0].position);
});
test("算法结果预览独立于原方案并保留模型与无人机", () => {
  const p = exampleProject(),
    before = JSON.stringify(p),
    newPoints = structuredClone(p.viewpoints);
  newPoints[0].position = [10, 30, 10];
  const candidate = importPlan(
    JSON.stringify({ version: 1, viewpoints: newPoints }),
    p,
  );
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(candidate.models, p.models);
  assert.equal(candidate.source, "导入的算法结果");
  assert.equal(candidate.viewpoints[0].position[1], 30);
});
test("导入失败不修改原方案", () => {
  const p = exampleProject(),
    before = JSON.stringify(p);
  assert.throws(() => importPlan('{"version":1,"viewpoints":[{}]}', p));
  assert.equal(JSON.stringify(p), before);
  assert.throws(() => parseProject("x".repeat(5_000_001)), /5 MB/);
});
test("移动拍摄点保留其他顺序并清除过时的时间信息", () => {
  const p = exampleProject();
  p.viewpoints.forEach((v, i) => (v.time = i));
  const ids = routeFor(p, p.drones[0].id).map((v) => v.id),
    next = reorderPoint(p, ids[0], 2);
  assert.deepEqual(
    routeFor(next, p.drones[0].id).map((v) => v.id),
    [ids[1], ids[2], ids[0], ids[3]],
  );
  assert.ok(next.viewpoints.every((v) => v.time === undefined));
  assert.ok(p.viewpoints.every((v) => v.time !== undefined));
});
test("手动方案移除时间信息时不会丢失镜头目标", () => {
  const p = exampleProject();
  p.viewpoints.forEach((v, i) => (v.time = i));
  const next = clearTiming(p);
  assert.deepEqual(
    next.viewpoints.map((v) => v.target),
    p.viewpoints.map((v) => v.target),
  );
  assert.equal(next.source, "用户手动编排");
});
test("生成的 GLB 可由真实加载器解析，独立实例互不影响", async () => {
  for (const name of ["building", "drone"]) {
    const buffer = readFileSync(new URL("../public/models/" + name + ".glb", import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      "",
    );
    const a = gltf.scene.clone(true),
      b = gltf.scene.clone(true);
    a.position.x = 37;
    assert.equal(b.position.x, 0);
    assert.ok(
      new Box3()
        .setFromObject(gltf.scene)
        .getSize(new (await import("three")).Vector3())
        .length() > 0,
    );
  }
});
