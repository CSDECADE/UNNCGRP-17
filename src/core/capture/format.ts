// Photo package ("aero-capture" v1) — the interface shared by simulated and real flights.
// Pure functions: camera intrinsics/extrinsics, app <-> ENU <-> WGS84, capture.json and the
// ground-truth COLMAP text model. See docs/reconstruction-capture.md §4–§6.
import type { Drone, Project, Vec3, Viewpoint } from "../types.ts";
import type { CaptureSettings, GeoOrigin } from "../reconstruction.ts";
import { routeFor } from "../project.ts";

export const CAPTURE_FORMAT = "aero-capture";
export const CAPTURE_VERSION = 1;

type M3 = [Vec3, Vec3, Vec3]; // rows
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const mulMV = (m: M3, v: Vec3): Vec3 => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as Vec3;

/** App (X right, Y up, Z towards viewer) -> local ENU: E = x, N = -z, U = y. */
export const appToEnu = (p: Vec3): Vec3 => [p[0], -p[2], p[1]];
export const enuToApp = (p: Vec3): Vec3 => [p[0], p[2], -p[1]];

const EARTH_RADIUS = 6378137;
/** Local tangent-plane approximation; accurate to centimetres within a few kilometres. */
export function enuToGps(enu: Vec3, origin: GeoOrigin): GeoOrigin {
  const lat0 = (origin.lat * Math.PI) / 180;
  return {
    lat: origin.lat + ((enu[1] / EARTH_RADIUS) * 180) / Math.PI,
    lon: origin.lon + ((enu[0] / (EARTH_RADIUS * Math.cos(lat0))) * 180) / Math.PI,
    alt: origin.alt + enu[2],
  };
}
export function gpsToEnu(gps: GeoOrigin, origin: GeoOrigin): Vec3 {
  const lat0 = (origin.lat * Math.PI) / 180;
  return [
    (((gps.lon - origin.lon) * Math.PI) / 180) * EARTH_RADIUS * Math.cos(lat0),
    (((gps.lat - origin.lat) * Math.PI) / 180) * EARTH_RADIUS,
    gps.alt - origin.alt,
  ];
}

export type Intrinsics = { width: number; height: number; fx: number; fy: number; cx: number; cy: number };
/** `fov` is the vertical field of view in degrees (three.js convention, Drone.fov). */
export function intrinsics(width: number, height: number, fov: number): Intrinsics {
  const fy = height / 2 / Math.tan((fov * Math.PI) / 360);
  return { width, height, fx: fy, fy, cx: width / 2, cy: height / 2 };
}

/** Same up rule as the editor's camera preview (scene/dragMath.ts cameraUp). */
export function cameraUpApp(position: Vec3, target: Vec3): Vec3 {
  const d = norm(sub(target, position));
  return Math.abs(d[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
}
/**
 * Camera-to-world rotation in ENU with COLMAP/OpenCV camera axes (x right, y down, z forward).
 * Matches three.js `camera.up = cameraUp; camera.lookAt(target)` used by the renderer.
 */
export function cameraToWorldEnu(position: Vec3, target: Vec3): M3 {
  const f = norm(sub(target, position));
  const right = norm(cross(f, cameraUpApp(position, target)));
  const up = cross(right, f);
  const axes = [appToEnu(right), appToEnu(neg(up)), appToEnu(f)]; // camera x, y, z in world
  return [0, 1, 2].map((r) => [axes[0][r], axes[1][r], axes[2][r]]) as M3;
}
/** World-to-camera rotation quaternion [qw, qx, qy, qz] (COLMAP order) from a rotation matrix. */
export function quaternion(m: M3): [number, number, number, number] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const t = a + e + i;
  let q: [number, number, number, number];
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [s / 4, (h - f) / s, (c - g) / s, (d - b) / s];
  } else if (a > e && a > i) {
    const s = Math.sqrt(1 + a - e - i) * 2;
    q = [(h - f) / s, s / 4, (b + d) / s, (c + g) / s];
  } else if (e > i) {
    const s = Math.sqrt(1 + e - a - i) * 2;
    q = [(c - g) / s, (b + d) / s, s / 4, (f + h) / s];
  } else {
    const s = Math.sqrt(1 + i - a - e) * 2;
    q = [(d - b) / s, (c + g) / s, (f + h) / s, s / 4];
  }
  return q[0] < 0 ? (q.map((n) => -n) as typeof q) : q;
}
export type Pose = { R: M3; t: Vec3; center: Vec3; q: [number, number, number, number] };
export function colmapPose(position: Vec3, target: Vec3): Pose {
  const c2w = cameraToWorldEnu(position, target);
  const R = [0, 1, 2].map((r) => [c2w[0][r], c2w[1][r], c2w[2][r]]) as M3; // transpose
  const center = appToEnu(position);
  return { R, t: neg(mulMV(R, center)), center, q: quaternion(R) };
}

/** Deterministic noise so the same settings give the same package. */
export function gaussian(seed: number) {
  let s = seed >>> 0 || 1;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

export type CaptureFrame = { drone: Drone; viewpoint: Viewpoint; index: number; file: string; cameraId: number };
/** Every viewpoint of every drone, in route order; one camera per distinct field of view. */
export function captureFrames(p: Project): { frames: CaptureFrame[]; cameras: { id: number; fov: number }[] } {
  const cameras: { id: number; fov: number }[] = [];
  const frames: CaptureFrame[] = [];
  for (const drone of p.drones) {
    let camera = cameras.find((c) => c.fov === drone.fov);
    if (!camera) cameras.push((camera = { id: cameras.length + 1, fov: drone.fov }));
    for (const viewpoint of routeFor(p, drone.id)) {
      const index = frames.length;
      frames.push({ drone, viewpoint, index, file: `images/${String(index + 1).padStart(4, "0")}.jpg`, cameraId: camera.id });
    }
  }
  return { frames, cameras };
}

export type CaptureMeta = {
  createdAt: string;
  generator: { name: string; version: string };
  attribution: string;
  hasReferenceModel: boolean;
};
/** capture.json, ground_truth/poses.json and the ground-truth COLMAP text model. */
export function buildCapturePackage(p: Project, settings: CaptureSettings, meta: CaptureMeta) {
  const { frames, cameras } = captureFrames(p);
  const noise = gaussian(settings.gpsNoise.seed);
  const k = new Map(cameras.map((c) => [c.id, intrinsics(settings.width, settings.height, c.fov)]));
  const round = (n: number, d = 6) => Math.round(n * 10 ** d) / 10 ** d;
  const cameraJson = cameras.map((c) => {
    const i = k.get(c.id)!;
    return { id: c.id, model: "PINHOLE", width: i.width, height: i.height, params: [i.fx, i.fy, i.cx, i.cy].map((n) => round(n)) };
  });
  const poses = frames.map((f) => colmapPose(f.viewpoint.position, f.viewpoint.target));
  const capture = {
    format: CAPTURE_FORMAT,
    version: CAPTURE_VERSION,
    source: "simulated" as const,
    createdAt: meta.createdAt,
    generator: meta.generator,
    project: p.name,
    crs: { type: "local-enu", units: "m", origin: settings.origin },
    cameras: cameraJson,
    frames: frames.map((f, i) => {
      const { horizontal: h, vertical: v } = settings.gpsNoise;
      const c = poses[i].center;
      const prior: Vec3 = [c[0] + noise() * h, c[1] + noise() * h, c[2] + noise() * v];
      const gps = enuToGps(prior, settings.origin);
      return {
        file: f.file,
        camera: f.cameraId,
        droneId: f.drone.id,
        viewpointId: f.viewpoint.id,
        index: f.index,
        position: prior.map((n) => round(n, 3)),
        gps: { lat: round(gps.lat, 9), lon: round(gps.lon, 9), alt: round(gps.alt, 3) },
        positionSigma: [h, h, v],
      };
    }),
    groundTruth: "ground_truth/poses.json",
    attribution: meta.attribution,
  };
  const groundTruth = {
    format: "aero-capture-ground-truth",
    version: 1,
    note: "Exact poses of the simulated cameras. For evaluation only; never feed into reconstruction.",
    crs: capture.crs,
    convention: "COLMAP: world-to-camera R|t, camera x right / y down / z forward; center in ENU metres",
    cameras: cameraJson,
    frames: frames.map((f, i) => ({
      file: f.file,
      camera: f.cameraId,
      qvec: poses[i].q.map((n) => round(n, 9)),
      tvec: poses[i].t.map((n) => round(n, 6)),
      center: poses[i].center.map((n) => round(n, 6)),
      target: appToEnu(f.viewpoint.target).map((n) => round(n, 6)),
    })),
    referenceModel: meta.hasReferenceModel ? { file: "ground_truth/reference.glb", frame: "ground_truth/reference_frame.json" } : null,
  };
  const camerasTxt = [
    "# Camera list with one line of data per camera:",
    "#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]",
    `# Number of cameras: ${cameras.length}`,
    ...cameraJson.map((c) => `${c.id} PINHOLE ${c.width} ${c.height} ${c.params.join(" ")}`),
  ].join("\n") + "\n";
  const imagesTxt = [
    "# Image list with two lines of data per image:",
    "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME",
    "#   POINTS2D[] as (X, Y, POINT3D_ID)",
    `# Number of images: ${frames.length}, mean observations per image: 0`,
    ...frames.flatMap((f, i) => [
      `${i + 1} ${poses[i].q.map((n) => round(n, 9)).join(" ")} ${poses[i].t.map((n) => round(n, 6)).join(" ")} ${f.cameraId} ${f.file.slice("images/".length)}`,
      "",
    ]),
  ].join("\n") + "\n";
  const points3DTxt = "# 3D point list with one line of data per point:\n#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n# Number of points: 0, mean track length: 0\n";
  return { frames, capture, groundTruth, colmap: { camerasTxt, imagesTxt, points3DTxt } };
}
