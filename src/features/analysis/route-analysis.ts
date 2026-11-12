import { routeFor, timing } from "../../core/project.ts";
import type { Project, Vec3 } from "../../core/types.ts";

type Track = { id: string; name: string; positions: Vec3[]; times: number[] };
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function at(track: Track, time: number): Vec3 {
  const { positions, times } = track;
  if (time <= times[0]) return positions[0];
  const last = times.length - 1;
  if (time >= times[last]) return positions[last];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (times[mid] <= time) lo = mid;
    else hi = mid;
  }
  const ratio = (time - times[lo]) / (times[hi] - times[lo]);
  return positions[lo].map((n, i) => n + (positions[hi][i] - n) * ratio) as Vec3;
}

function closest(a: Track, b: Track) {
  const boundaries = [...new Set([0, ...a.times, ...b.times])].sort((x, y) => x - y);
  let start = subtract(at(a, 0), at(b, 0));
  let best = dot(start, start), time = 0;
  for (let i = 1; i < boundaries.length; i++) {
    const end = subtract(at(a, boundaries[i]), at(b, boundaries[i]));
    const velocity = subtract(end, start);
    const norm = dot(velocity, velocity);
    const fraction = norm > 0 ? Math.max(0, Math.min(1, -dot(start, velocity) / norm)) : 0;
    const relative = start.map((n, k) => n + velocity[k] * fraction) as Vec3;
    const squared = dot(relative, relative);
    if (squared < best) {
      best = squared;
      time = boundaries[i - 1] + (boundaries[i] - boundaries[i - 1]) * fraction;
    }
    start = end;
  }
  return { a: a.name, b: b.name, id: `${a.id}/${b.id}`, distance: Math.sqrt(best), time };
}

export function analyzeRoutes(project: Project) {
  const { timed } = timing(project);
  const tracks: Track[] = project.drones.map((drone) => {
    const points = routeFor(project, drone.id);
    return { id: drone.id, name: drone.name, positions: points.map((point) => point.position),
      times: points.map((point, i) => timed ? point.time! : i * 6) };
  });
  const routes = tracks.map(({ id, name, positions, times }) => ({ id, name,
    count: positions.length,
    distance: positions.reduce((sum, position, i) => i ? sum + Math.hypot(...subtract(position, positions[i - 1])) : sum, 0),
    duration: times.length > 1 ? times.at(-1)! - times[0] : 0,
  }));
  const pairs = tracks.flatMap((a, i) => a.times.length ? tracks.slice(i + 1)
    .filter((b) => b.times.length).map((b) => closest(a, b)) : [])
    .sort((a, b) => a.distance - b.distance);
  return { timed, routes, pairs, totalDistance: routes.reduce((sum, route) => sum + route.distance, 0) };
}
