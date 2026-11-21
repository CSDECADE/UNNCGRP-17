// Reconstruction setup kept on the session (not in undo history): the textured reference model that
// stands in for the real building, its low-poly proxy, their shared placement and capture settings.
// See docs/reconstruction-capture.md.
import { ProjectValidationError } from "./feedback.ts";
import type { Vec3 } from "./types.ts";

export const MAX_MESH_BYTES = 128 * 1024 * 1024;

export type MeshAsset = { name: string; sha256: string; bytes: Uint8Array };
export type BuildingFrame = {
  /** Up axis of the model file. "z" files are converted with (x, y, z) -> (x, z, -y). */
  upAxis: "y" | "z";
  /** Translation in metres applied after the axis conversion. */
  offset: Vec3;
};
export type GeoOrigin = { lat: number; lon: number; alt: number };
export type CaptureSettings = {
  width: number;
  height: number;
  jpegQuality: number;
  origin: GeoOrigin;
  gpsNoise: { horizontal: number; vertical: number; seed: number };
};
export type ReconstructionSetup = {
  reference?: MeshAsset;
  proxy?: MeshAsset;
  frame: BuildingFrame;
  attribution: string;
  showReference: boolean;
  capture: CaptureSettings;
};

export const DEFAULT_CAPTURE: CaptureSettings = {
  width: 2048,
  height: 1536,
  jpegQuality: 0.92,
  // University of Nottingham Ningbo China; any origin works, it only feeds the GPS conversion.
  origin: { lat: 29.8017, lon: 121.5609, alt: 10 },
  gpsNoise: { horizontal: 1.5, vertical: 3, seed: 1 },
};
export function defaultReconstruction(): ReconstructionSetup {
  return { frame: { upAxis: "y", offset: [0, 0, 0] }, attribution: "", showReference: false, capture: structuredClone(DEFAULT_CAPTURE) };
}

export function isGlb(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 12 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function meshAsset(name: string, bytes: Uint8Array): Promise<MeshAsset> {
  if (bytes.byteLength > MAX_MESH_BYTES) throw new ProjectValidationError("模型文件超过 128 MB");
  if (!isGlb(bytes)) throw new ProjectValidationError("模型文件不是 .glb 格式");
  return { name: name.slice(0, 160) || "model.glb", sha256: await sha256Hex(bytes), bytes };
}

/** Model-file coordinates -> app coordinates (metres, Y up). */
export function modelToApp(p: Vec3, frame: BuildingFrame): Vec3 {
  const [x, y, z] = frame.upAxis === "z" ? [p[0], p[2], -p[1]] : p;
  return [x + frame.offset[0], y + frame.offset[1], z + frame.offset[2]];
}
/** Offset that centres the model's footprint on the origin and puts its lowest point at y = 0. */
export function centredOffset(min: Vec3, max: Vec3, upAxis: BuildingFrame["upAxis"]): Vec3 {
  const a = modelToApp(min, { upAxis, offset: [0, 0, 0] }), b = modelToApp(max, { upAxis, offset: [0, 0, 0] });
  const lo = a.map((n, i) => Math.min(n, b[i])), hi = a.map((n, i) => Math.max(n, b[i]));
  const clean = (n: number) => Math.round(n * 1000) / 1000 || 0;
  return [clean(-(lo[0] + hi[0]) / 2), clean(-lo[1]), clean(-(lo[2] + hi[2]) / 2)];
}

const fail = (message: string): never => {
  throw new ProjectValidationError(message);
};
const num = (x: unknown, min: number, max: number, what: string) =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : fail(`${what}超出支持范围`);
const obj = (x: unknown, what: string) =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : fail(`${what}格式无效`);

/** Validate the JSON part; `asset` resolves stored references (sha256) to bytes. */
export function validateReconstruction(
  input: unknown,
  asset: (ref: unknown, what: string) => MeshAsset | undefined,
): ReconstructionSetup {
  const r = obj(input, "重建设置");
  const f = obj(r.frame, "建筑放置");
  if (f.upAxis !== "y" && f.upAxis !== "z") fail("模型朝上方向无效");
  const offset = Array.isArray(f.offset) && f.offset.length === 3 ? (f.offset.map((n) => num(n, -10000, 10000, "建筑偏移")) as Vec3) : fail("建筑偏移无效");
  const c = obj(r.capture, "拍摄设置");
  const o = obj(c.origin, "坐标原点");
  const g = obj(c.gpsNoise, "GPS 噪声");
  const attribution = typeof r.attribution === "string" && r.attribution.length <= 500 ? r.attribution : fail("署名信息无效");
  return {
    reference: r.reference === undefined ? undefined : asset(r.reference, "参考模型"),
    proxy: r.proxy === undefined ? undefined : asset(r.proxy, "白模"),
    frame: { upAxis: f.upAxis as BuildingFrame["upAxis"], offset },
    attribution,
    showReference: r.showReference === true,
    capture: {
      width: Math.round(num(c.width, 64, 8192, "照片宽度")),
      height: Math.round(num(c.height, 64, 8192, "照片高度")),
      jpegQuality: num(c.jpegQuality, 0.3, 1, "JPEG 质量"),
      origin: { lat: num(o.lat, -90, 90, "纬度"), lon: num(o.lon, -180, 180, "经度"), alt: num(o.alt, -1000, 10000, "海拔") },
      gpsNoise: {
        horizontal: num(g.horizontal, 0, 100, "GPS 水平噪声"),
        vertical: num(g.vertical, 0, 100, "GPS 垂直噪声"),
        seed: Math.round(num(g.seed, 0, 2 ** 31, "随机种子")),
      },
    },
  };
}
/** JSON form with mesh bytes replaced by `ref(asset)`; used by packages and autosave. */
export function serializeReconstruction(r: ReconstructionSetup, ref: (a: MeshAsset) => unknown) {
  return {
    ...r,
    reference: r.reference && ref(r.reference),
    proxy: r.proxy && ref(r.proxy),
  };
}
