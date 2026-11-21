// Temporary route planner: elliptical orbits around the proxy's bounding box.
// Stands in until the real planning algorithm exists; its output is plain viewpoints.
import { clearTiming, makeDrone, uid, validateProject } from "../project.ts";
import type { Project, Vec3 } from "../types.ts";

export type OrbitOptions = {
  rings: number;        // side rings, bottom to top
  perRing: number;      // shots per ring
  standoff: number;     // metres between the bounding box and the ring
  minHeight: number;    // height of the lowest ring above the box bottom
  topRing: boolean;     // extra oblique ring looking down at the roof
};
export const DEFAULT_ORBIT: OrbitOptions = { rings: 3, perRing: 24, standoff: 12, minHeight: 3, topRing: true };
export type Bounds = { min: Vec3; max: Vec3 };
export type Shot = { position: Vec3; target: Vec3 };

export function orbitShots(bounds: Bounds, options: OrbitOptions = DEFAULT_ORBIT): Shot[] {
  const { min, max } = bounds;
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
  const height = Math.max(0.1, max[1] - min[1]);
  const rx = (max[0] - min[0]) / 2 + options.standoff, rz = (max[2] - min[2]) / 2 + options.standoff;
  const rings = Math.max(1, Math.round(options.rings)), per = Math.max(3, Math.round(options.perRing));
  const levels: { y: number; target: number; scale: number }[] = [];
  const low = min[1] + options.minHeight, high = max[1] + options.standoff * 0.5;
  for (let i = 0; i < rings; i++) {
    const y = rings === 1 ? (low + high) / 2 : low + ((high - low) * i) / (rings - 1);
    // Side rings look at the façade at mid height, never above the roof line.
    levels.push({ y, target: Math.min(y, min[1] + height * 0.5), scale: 1 });
  }
  // Pulled-in ring above the roof, looking down at the building centre.
  if (options.topRing) levels.push({ y: max[1] + Math.max(rx, rz) * 0.6, target: min[1], scale: 0.6 });
  const shots: Shot[] = [];
  levels.forEach((level, ring) => {
    for (let k = 0; k < per; k++) {
      // Alternate direction so consecutive rings join without a long transit.
      const a = ((ring % 2 ? per - k : k) / per) * Math.PI * 2;
      const round = (n: number) => Math.round(n * 1000) / 1000;
      shots.push({
        position: [round(cx + Math.cos(a) * rx * level.scale), round(level.y), round(cz + Math.sin(a) * rz * level.scale)],
        target: [round(cx), round(level.target), round(cz)],
      });
    }
  });
  return shots;
}

/** Replace the first drone's route (creating a drone if needed); other drones keep theirs. */
export function applyRoute(p: Project, shots: Shot[]): Project {
  if (!shots.length) return p;
  let drones = p.drones;
  if (!drones.length) {
    const drone = makeDrone(1);
    drone.position = shots[0].position;
    drones = [drone];
  }
  const droneId = drones[0].id;
  return validateProject(
    clearTiming({
      ...p,
      drones,
      viewpoints: [
        ...p.viewpoints.filter((v) => v.droneId !== droneId),
        ...shots.map((s, i) => ({ id: uid(), droneId, name: `拍摄点 ${i + 1}`, position: s.position, target: s.target })),
      ],
    }),
  );
}
