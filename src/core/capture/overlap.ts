import type { Shot } from "./orbit.ts";
import type { Vec3 } from "../types.ts";

export type OverlapOptions = {
  fromShot: number;
  toShot: number;
  maxSpacingM: number;
  maxHeadingDeg: number;
};

type IndexedShot = Shot & { pathIndex: number };
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Insert bridging views on the existing polyline, keeping all original views in order. */
export function addOverlapShots(shots: IndexedShot[], path: Vec3[], opts: OverlapOptions) {
  const { fromShot, toShot, maxSpacingM, maxHeadingDeg } = opts;
  if (!Number.isInteger(fromShot) || !Number.isInteger(toShot) ||
      fromShot < 1 || fromShot >= toShot || toShot > shots.length ||
      !Number.isFinite(maxSpacingM) || maxSpacingM < 1 ||
      !Number.isFinite(maxHeadingDeg) || maxHeadingDeg < 1 || maxHeadingDeg > 180) {
    throw new Error("Invalid overlap shot range or spacing");
  }
  const result: Shot[] = [];
  const originalIndices: number[] = [];
  for (const [i, shot] of shots.entries()) {
    originalIndices.push(result.length);
    result.push(shot);
    if (i + 1 < fromShot || i + 1 >= toShot) continue;
    const next = shots[i + 1];
    const firstDirection = subtract(shot.target, shot.position);
    const lastDirection = subtract(next.target, next.position);
    const cosine = firstDirection.reduce((sum, n, k) => sum + n * lastDirection[k], 0) /
      (Math.hypot(...firstDirection) * Math.hypot(...lastDirection));
    const heading = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
    const segments = path.slice(shot.pathIndex, next.pathIndex + 1);
    const distances = segments.slice(1).map((point, k) => Math.hypot(...subtract(point, segments[k])));
    const length = distances.reduce((sum, n) => sum + n, 0);
    if (!(length > 0)) throw new Error("Cannot add overlap to a zero-length path section");
    const divisions = Math.max(1, Math.ceil(length / maxSpacingM), Math.ceil(heading / maxHeadingDeg));
    if (result.length + divisions > 1000) throw new Error("Too many overlap shots");
    let segment = 0, passed = 0;
    for (let step = 1; step < divisions; step++) {
      const t = step / divisions, distance = t * length;
      while (passed + distances[segment] < distance) passed += distances[segment++];
      const position = mix(segments[segment], segments[segment + 1], (distance - passed) / distances[segment]);
      result.push({ position, target: mix(shot.target, next.target, t) });
    }
  }
  return { shots: result, originalIndices };
}
