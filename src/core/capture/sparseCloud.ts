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
  const input = JSON.parse(text);
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
