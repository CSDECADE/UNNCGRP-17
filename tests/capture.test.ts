import assert from "node:assert/strict";
import { test } from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import {
  appToEnu, buildCapturePackage, colmapPose, enuToApp, enuToGps, gpsToEnu, intrinsics, quaternion,
} from "../src/core/capture/format.ts";
import { applyRoute, orbitShots, DEFAULT_ORBIT } from "../src/core/capture/orbit.ts";
import { DEFAULT_CAPTURE } from "../src/core/reconstruction.ts";
import { emptyProject, exampleProject, routeFor } from "../src/core/project.ts";
import type { Vec3 } from "../src/core/types.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// Pinhole projection of an app-space point with the ground-truth pose.
function project(point: Vec3, position: Vec3, target: Vec3, w: number, h: number, fov: number) {
  const { R, t } = colmapPose(position, target);
  const X = appToEnu(point);
  const c = R.map((r, i) => r[0] * X[0] + r[1] * X[1] + r[2] * X[2] + t[i]);
  const k = intrinsics(w, h, fov);
  return { u: k.fx * (c[0] / c[2]) + k.cx, v: k.fy * (c[1] / c[2]) + k.cy, depth: c[2] };
}

test("axis conventions round trip", () => {
  const p: Vec3 = [3, 4, -5];
  assert.deepEqual(appToEnu(p), [3, 5, 4]);
  assert.deepEqual(enuToApp(appToEnu(p)), p);
  const origin = { lat: 29.8, lon: 121.56, alt: 10 };
  const back = gpsToEnu(enuToGps([120, -45, 30], origin), origin);
  [120, -45, 30].forEach((n, i) => close(back[i], n, 1e-6));
});

test("intrinsics from vertical field of view", () => {
  const k = intrinsics(4096, 3072, 58.1);
  close(k.fy, 1536 / Math.tan((58.1 * Math.PI) / 360));
  assert.equal(k.fx, k.fy);
  assert.deepEqual([k.cx, k.cy], [2048, 1536]);
});

test("ground-truth pose: target at principal point, up is -v, right is +u", () => {
  const position: Vec3 = [30, 15, 40], target: Vec3 = [0, 5, 0];
  const centre = project(target, position, target, 2048, 1536, 60);
  close(centre.u, 1024, 1e-6);
  close(centre.v, 768, 1e-6);
  assert.ok(centre.depth > 0);
  assert.ok(project([0, 8, 0], position, target, 2048, 1536, 60).v < 768, "higher point appears higher in the image");
  // Looking from +x+z towards the origin, the camera's right points to +x / -z.
  assert.ok(project([3, 5, -3], position, target, 2048, 1536, 60).u > 1024);
});

test("ground truth matches what a three.js camera renders", () => {
  const w = 2048, h = 1536, fov = 58;
  for (const [position, target] of [
    [[30, 15, 40], [0, 5, 0]],
    [[-12, 40, 3], [0, 0, 0]],
    [[0, 50, 0.01], [0, 0, 0]], // near-nadir uses the alternative up vector
  ] as [Vec3, Vec3][]) {
    const camera = new PerspectiveCamera(fov, w / h, 0.1, 1000);
    camera.position.set(...position);
    const dir = new Vector3(...target).sub(camera.position).normalize();
    camera.up.set(...((Math.abs(dir.y) > 0.98 ? [0, 0, 1] : [0, 1, 0]) as Vec3));
    camera.lookAt(...target);
    camera.updateMatrixWorld();
    for (const point of [[2, 3, -1], [-4, 1, 2], [5, 6, 5]] as Vec3[]) {
      const ndc = new Vector3(...point).project(camera);
      const ours = project(point, position, target, w, h, fov);
      close(ours.u, ((ndc.x + 1) / 2) * w, 1e-6);
      close(ours.v, ((1 - ndc.y) / 2) * h, 1e-6);
    }
  }
});

test("quaternion reproduces the rotation", () => {
  const { R, q } = colmapPose([10, 20, 30], [1, 2, -3]);
  const [w, x, y, z] = q;
  const fromQ = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  R.forEach((row, i) => row.forEach((n, j) => close(fromQ[i][j], n, 1e-9)));
  close(Math.hypot(...quaternion(R)), 1, 1e-12);
});

test("orbit keeps its distance and aims at the building", () => {
  const bounds = { min: [-18, 0, -26] as Vec3, max: [18, 7.5, 26] as Vec3 };
  const shots = orbitShots(bounds);
  assert.equal(shots.length, (DEFAULT_ORBIT.rings + 1) * DEFAULT_ORBIT.perRing);
  for (const s of shots.slice(0, DEFAULT_ORBIT.rings * DEFAULT_ORBIT.perRing)) {
    const outside = Math.abs(s.position[0]) > 18 || Math.abs(s.position[2]) > 26;
    assert.ok(outside, "side rings stay outside the footprint");
    assert.ok(s.position[1] >= bounds.min[1] + DEFAULT_ORBIT.minHeight - 1e-9);
  }
  for (const s of shots.slice(-DEFAULT_ORBIT.perRing)) assert.ok(s.position[1] > bounds.max[1], "top ring above the roof");
});

test("applyRoute replaces only the first drone's route", () => {
  const p = exampleProject();
  const [first, second] = p.drones;
  const shots = orbitShots({ min: [-5, 0, -5], max: [5, 5, 5] }, { ...DEFAULT_ORBIT, rings: 1, perRing: 6, topRing: false });
  const next = applyRoute(p, shots);
  assert.equal(routeFor(next, first.id).length, 6);
  assert.deepEqual(routeFor(next, second.id), routeFor(p, second.id));
  const fresh = applyRoute(emptyProject(), shots);
  assert.equal(fresh.drones.length, 1);
  assert.equal(fresh.viewpoints.length, 6);
});

test("capture package: frames, deterministic noise, COLMAP text", () => {
  const p = applyRoute(emptyProject(), orbitShots({ min: [-18, 0, -26], max: [18, 7.5, 26] }));
  const meta = { createdAt: "2026-11-21T00:00:00.000Z", generator: { name: "Aero", version: "test" }, attribution: "x", hasReferenceModel: true };
  const a = buildCapturePackage(p, DEFAULT_CAPTURE, meta);
  const b = buildCapturePackage(p, DEFAULT_CAPTURE, meta);
  assert.deepEqual(a.capture, b.capture);
  assert.equal(a.capture.frames.length, p.viewpoints.length);
  assert.equal(a.capture.frames[0].file, "images/0001.jpg");
  assert.equal(a.groundTruth.frames.length, a.capture.frames.length);
  // Priors are noisy but close: horizontal sigma 1.5 m, vertical 3 m.
  const errors = a.capture.frames.map((f, i) => {
    const c = a.groundTruth.frames[i].center;
    return Math.hypot(f.position[0] - c[0], f.position[1] - c[1]);
  });
  const rms = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);
  assert.ok(rms > 1 && rms < 3, `horizontal rms ${rms}`);
  const lines = a.colmap.imagesTxt.split("\n").filter((l) => l && !l.startsWith("#"));
  assert.equal(lines.length, p.viewpoints.length);
  assert.match(lines[0], /^1 (-?[\d.e-]+ ){7}1 0001\.jpg$/);
  assert.match(a.colmap.camerasTxt, /\n1 PINHOLE 2048 1536 /);
});
