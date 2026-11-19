import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleProject, parseProject, routeFor } from "../src/core/project.ts";
import {
  beginTransformSession,
  updateTransformSession,
  finishTransformSession,
  commitTransformHistory,
} from "../src/core/transform.ts";
import type { Project, Selection, Vec3 } from "../src/core/types.ts";

const options = { target: "position" as const, snap: 0, lockHeight: false };
function timedProject() {
  const project = exampleProject();
  project.source = "导入的算法结果";
  for (const drone of project.drones)
    routeFor(project, drone.id).forEach((point, i) => { point.time = i * 10; });
  return project;
}
const pointSelection = (p: Project): Selection => ({ type: "viewpoint", id: p.viewpoints[0].id });

test("拖动草稿实时改变拍摄点及航线，原项目和已导入时间直到提交前保持不变", () => {
  const project = timedProject(), original = JSON.stringify(project);
  let session = beginTransformSession(project, pointSelection(project), options)!;
  for (let i = 1; i <= 120; i++) {
    session = updateTransformSession(session, { position: [i, 18, 30] });
    assert.deepEqual(routeFor(session.draft, project.drones[0].id)[0].position, [i, 18, 30]);
  }
  assert.equal(JSON.stringify(project), original);
  assert.equal(session.draft.viewpoints[0].time, 0);
  const committed = finishTransformSession(session)!;
  assert.equal(committed.source, "用户手动编排");
  assert.ok(committed.viewpoints.every((point) => point.time === undefined));
  assert.deepEqual(parseProject(JSON.stringify(committed)), committed);
});

test("一次拖动只加入一条撤销记录；重复或过期 mouseUp 不会再次提交", () => {
  const project = timedProject();
  const history = { past: [] as Project[], present: project, future: [exampleProject()] };
  let session = beginTransformSession(project, pointSelection(project), options)!;
  for (let i = 0; i < 100; i++) session = updateTransformSession(session, { position: [i, 20, 6] });
  const next = commitTransformHistory(history, session);
  assert.equal(next.past.length, 1);
  assert.equal(next.past[0], project);
  assert.equal(next.future.length, 0);
  assert.equal(commitTransformHistory(next, session), next);
  const replacement = { ...history, present: exampleProject() };
  assert.equal(commitTransformHistory(replacement, session), replacement);
  assert.equal(commitTransformHistory(history, null), history);
});

test("点下即松开或拖回原处，不生成历史、不清时间、不改变方案来源", () => {
  const project = timedProject();
  const history = { past: [], present: project, future: [] };
  let session = beginTransformSession(project, pointSelection(project), options)!;
  assert.equal(finishTransformSession(session), null);
  session = updateTransformSession(session, { position: [30, 40, 50] });
  session = updateTransformSession(session, { position: [...project.viewpoints[0].position] });
  assert.equal(session.draft, project);
  assert.equal(commitTransformHistory(history, session), history);
  assert.equal(project.source, "导入的算法结果");
  assert.equal(project.viewpoints[0].time, 0);
});

test("吸附只作用于本次变化轴，不改变未动轴的小数或无操作的拍摄点", () => {
  const project = timedProject();
  project.viewpoints[0].position = [2.37, 15.43, -8.64];
  let session = beginTransformSession(project, pointSelection(project), { ...options, snap: 1 })!;
  session = updateTransformSession(session, { position: [2.37, 15.43, -8.64] });
  assert.equal(finishTransformSession(session), null);
  session = updateTransformSession(session, { position: [3.6, 15.43, -8.64] });
  assert.deepEqual(session.draft.viewpoints[0].position, [4, 15.43, -8.64]);
  const fine = updateTransformSession(beginTransformSession(project, pointSelection(project), { ...options, snap: 0.1 })!, { position: [2.67, 15.43, -8.64] });
  assert.ok(Math.abs(fine.draft.viewpoints[0].position[0] - 2.7) < 1e-9);
});

test("高度锁定只约束拍摄位置，镜头目标可独立调整高度", () => {
  const project = timedProject(), point = project.viewpoints[0];
  const position = updateTransformSession(beginTransformSession(project, pointSelection(project), { ...options, lockHeight: true })!, { position: [30, 99, 40] });
  assert.deepEqual(position.draft.viewpoints[0].position, [30, point.position[1], 40]);
  const target = updateTransformSession(beginTransformSession(project, pointSelection(project), { ...options, target: "target", lockHeight: true })!, { target: [2, 77, 3], position: [500, 500, 500] });
  assert.deepEqual(target.draft.viewpoints[0].target, [2, 77, 3]);
  assert.deepEqual(target.draft.viewpoints[0].position, point.position);
  assert.deepEqual(project.viewpoints[0].target, point.target);
});

test("缺失、锁定、隐藏对象以及非拍摄点的目标变换不能开始", () => {
  const project = exampleProject();
  assert.equal(beginTransformSession(project, null, options), null);
  assert.equal(beginTransformSession(project, { type: "viewpoint", id: "missing" }, options), null);
  project.models[0].locked = true;
  assert.equal(beginTransformSession(project, { type: "model", id: project.models[0].id }, options), null);
  assert.equal(beginTransformSession(project, { type: "drone", id: project.drones[0].id }, { ...options, target: "target" }), null);
  project.drones[0].visible = false;
  assert.equal(beginTransformSession(project, pointSelection(project), options), null);
});

test("变换拒绝非有限值且约束合法范围，不接受名称或引用等无关字段", () => {
  const project = timedProject(), point = project.viewpoints[0];
  let session = beginTransformSession(project, pointSelection(project), options)!;
  session = updateTransformSession(session, { position: [NaN, Infinity, 0], name: "changed", droneId: "other", rotation: 90 });
  assert.equal(session.draft, project);
  session = updateTransformSession(session, { position: [20000, -300, -20000] });
  assert.deepEqual(session.draft.viewpoints[0].position, [10000, 0, -10000]);
  assert.equal(session.draft.viewpoints[0].name, point.name);
  assert.equal(session.draft.viewpoints[0].droneId, point.droneId);
  assert.equal("rotation" in session.draft.viewpoints[0], false);
});

test("模型位置旋转尺寸在一次事务内提交，同时保留无人机及拍摄点", () => {
  const project = timedProject();
  let session = beginTransformSession(project, { type: "model", id: project.models[0].id }, options)!;
  session = updateTransformSession(session, { position: [20, 0, 30] as Vec3, rotation: 45, size: [10, 25, 12] });
  const next = finishTransformSession(session)!;
  assert.deepEqual(next.models[0].position, [20, 0, 30]);
  assert.equal(next.models[0].rotation, 45);
  assert.deepEqual(next.models[0].size, [10, 25, 12]);
  assert.equal(next.drones, project.drones);
  assert.equal(next.viewpoints, project.viewpoints);
  assert.notEqual(next.models[0], project.models[0]);
});
