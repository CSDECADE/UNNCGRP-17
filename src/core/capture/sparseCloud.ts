import { validatePhotoSet, type PhotoSet } from "./photoSet.ts";
export const MAX_SPARSE_CLOUD_BYTES = 12_000_000;

export type SparseCloud = {
  kind: "sparse" | "dense";
  sourcePointCount: number;
  positions: Float32Array;
  colors: Float32Array;
  registeredImages: number;
  totalImages: number;
};

export function parseSparseCloud(text: string): SparseCloud {
  return cloudFromJson(JSON.parse(text));
}
/** A point cloud file plus the photo fingerprint written by tools/colmap (absent in older files). */
export function parseCloudFile(text: string): { cloud: SparseCloud; photos?: PhotoSet } {
  const input = JSON.parse(text);
  const cloud = cloudFromJson(input);
  return input.photos === undefined ? { cloud } : { cloud, photos: validatePhotoSet(input.photos) };
}
function cloudFromJson(input: any): SparseCloud {
  const invalid = () => new Error("请选择有效的 Aero 点云 JSON。");
  const dense = input?.format === "aero-dense-cloud";
  if ((!dense && input?.format !== "aero-sparse-cloud") || input.version !== 1 ||
      input.coordinates !== "aero-y-up-m" || !Array.isArray(input.points) ||
      input.points.length < 1 || input.points.length > 200_000 ||
      !Number.isSafeInteger(input.registeredImages) || input.registeredImages < 1 ||
      !Number.isSafeInteger(input.totalImages) || input.totalImages < input.registeredImages) {
    throw invalid();
  }
  const sourcePointCount = dense ? input.sourcePointCount : input.points.length;
  if (!Number.isSafeInteger(sourcePointCount) || sourcePointCount < input.points.length) throw invalid();
  const positions = new Float32Array(input.points.length * 3);
  const colors = new Float32Array(positions.length);
  // Three vertex colors are linear, while COLMAP stores RGB bytes in sRGB.
  for (const [i, row] of input.points.entries()) {
    if (!Array.isArray(row) || row.length !== 6) throw invalid();
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = row[axis], channel = row[axis + 3];
      if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 100_000 ||
          !Number.isInteger(channel) || channel < 0 || channel > 255) throw invalid();
      positions[i * 3 + axis] = coordinate;
      const srgb = channel / 255;
      colors[i * 3 + axis] = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    }
  }
  return { kind: dense ? "dense" : "sparse", sourcePointCount, positions, colors, registeredImages: input.registeredImages, totalImages: input.totalImages };
}

// ---- binary storage (.aeproj assets/<sha256>.cloud, autosave) -------------------------------------
// Little-endian: "AECL", u32 version (1), u32 point count, float32 xyz × n, then sRGB bytes rgb × n.
// 15 bytes per point instead of ~41 in the JSON exchange format. Colours are stored as the original
// sRGB bytes; the linear float colours used for display convert back to them exactly.
const CLOUD_MAGIC = 0x4c434541; // "AECL"
const HEADER = 12;
export const MAX_CLOUD_POINTS = 200_000;

const toSrgbByte = (linear: number) =>
  Math.round(255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055));
const toLinear = (byte: number) => {
  const srgb = byte / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
};

export function encodeCloudPoints(cloud: SparseCloud): Uint8Array {
  const n = cloud.positions.length / 3;
  const out = new Uint8Array(HEADER + n * 15);
  const view = new DataView(out.buffer);
  view.setUint32(0, CLOUD_MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, n, true);
  for (let i = 0; i < n * 3; i++) {
    view.setFloat32(HEADER + i * 4, cloud.positions[i], true);
    out[HEADER + n * 12 + i] = Math.min(255, Math.max(0, toSrgbByte(cloud.colors[i])));
  }
  return out;
}

export type CloudMeta = Omit<SparseCloud, "positions" | "colors">;
export function decodeCloudPoints(bytes: Uint8Array, meta: CloudMeta): SparseCloud {
  const invalid = () => new Error("点云数据无效");
  if (bytes.byteLength < HEADER) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(8, true);
  if (view.getUint32(0, true) !== CLOUD_MAGIC || view.getUint32(4, true) !== 1 || n < 1 || n > MAX_CLOUD_POINTS ||
      bytes.byteLength !== HEADER + n * 15 || meta.sourcePointCount < n) throw invalid();
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) {
    const p = view.getFloat32(HEADER + i * 4, true);
    if (!Number.isFinite(p) || Math.abs(p) > 100_000) throw invalid();
    positions[i] = p;
    colors[i] = toLinear(bytes[HEADER + n * 12 + i]);
  }
  return { ...meta, positions, colors };
}

/** Encoded bytes and their SHA-256, cached per cloud object (clouds are immutable once loaded). */
const encoded = new WeakMap<SparseCloud, { sha256: string; bytes: Uint8Array }>();
export async function cloudAsset(cloud: SparseCloud): Promise<{ sha256: string; bytes: Uint8Array }> {
  const known = encoded.get(cloud);
  if (known) return known;
  const bytes = encodeCloudPoints(cloud);
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  const value = { sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""), bytes };
  encoded.set(cloud, value);
  return value;
}
export const cloudMeta = ({ kind, sourcePointCount, registeredImages, totalImages }: SparseCloud): CloudMeta =>
  ({ kind, sourcePointCount, registeredImages, totalImages });
