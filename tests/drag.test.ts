import { test } from "node:test";
import assert from "node:assert/strict";
import { Ray, Vector3, Quaternion } from "three";
import { dragPosition, editingPlane, planeHit, yawDegrees, cameraUp } from "../src/scene/dragMath.ts";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { Group, PerspectiveCamera } from "three";

test("各编辑视图的拖动平面保留正确坐标，并保持抓取偏移", () => {
  const origin: [number, number, number] = [2.37, 15.43, -8.64];
  for (const [view, normal] of [["perspective", [0,1,0]], ["top", [0,1,0]], ["side", [1,0,0]], ["front", [0,0,1]]] as const) {
    const plane = editingPlane(view, origin);
    assert.ok(plane.normal.equals(new Vector3(...normal)));
    assert.ok(Math.abs(plane.distanceToPoint(new Vector3(...origin))) < 1e-9);
  }
  assert.deepEqual(dragPosition(origin, new Vector3(4,15.43,2), new Vector3(6,15.43,7), false), [4.37,15.43,-3.6400000000000006]);
  const fine = dragPosition(origin, new Vector3(0,0,0), new Vector3(10,0,20), true);
  assert.ok(Math.abs(fine[0] - 3.37) < 1e-9 && fine[1] === origin[1] && Math.abs(fine[2] + 6.64) < 1e-9);
});
test("近乎平行的视线不产生巨大位置跳跃", () => {
  const plane = editingPlane("top", [0,15,0]);
  assert.equal(planeHit(new Ray(new Vector3(0,16,0), new Vector3(1,-0.0001,0).normalize()), plane), null);
  assert.ok(planeHit(new Ray(new Vector3(0,30,0), new Vector3(0,-1,0)), plane)?.equals(new Vector3(0,15,0)));
});
test("模型偏航超过90度或为负角时不会被Euler分解折返", () => {
  for (const degrees of [0, 45, 90, 120, 179, -120, -179]) {
    const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), degrees * Math.PI/180);
    assert.ok(Math.abs(yawDegrees(quaternion) - degrees) < 1e-6);
  }
  for (const degrees of [270, -450, 720]) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0,1,0), degrees * Math.PI/180);
    assert.ok(Math.abs(yawDegrees(q, degrees) - degrees) < 1e-6);
  }
});
test("垂直拍摄使用一致的相机与视锥方向基准", () => {
  assert.deepEqual(cameraUp([0,30,0], [1,0,0]).toArray(), [0,0,1]);
  assert.deepEqual(cameraUp([20,15,30], [0,10,0]).toArray(), [0,1,0]);
});
test("官方变换控件退出后释放原生指针监听及渲染资源", () => {
  const listeners = new Map<string, Set<unknown>>();
  const canvas = { style: {}, addEventListener(type: string, fn: unknown) {
    if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn);
  }, removeEventListener(type: string, fn: unknown) { listeners.get(type)?.delete(fn); } };
  for (let i = 0; i < 5; i++) {
    const control = new TransformControls(new PerspectiveCamera(), canvas as unknown as HTMLElement);
    control.disconnect();
    const object = new Group(); new Group().add(object);
    control.attach(object);
    control.detach(); control.dispose();
  }
  for (const callbacks of listeners.values()) assert.equal(callbacks.size, 0);
});
