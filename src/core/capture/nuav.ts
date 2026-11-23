import { UserInputError } from "../feedback.ts";
import { makeDrone } from "../project.ts";
import { modelToApp, type BuildingFrame } from "../reconstruction.ts";
import type { Project, Vec3 } from "../types.ts";
import { applyRoute } from "./orbit.ts";
import { addOverlapShots, type OverlapOptions } from "./overlap.ts";

function invalid(): never {
  throw new UserInputError("请选择有效的单机 DronePathPlannerN 规划结果。");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function xyz(value: unknown): Vec3 {
  const { x, y, z } = record(value);
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number" ||
      ![x, y, z].every(Number.isFinite)) return invalid();
  return [x, y, z];
}

/** Map the planner's Z-up OBJ coordinates using the same placement as the building. */
function parseNuavCaptureRoute(project: Project, input: unknown, frame: BuildingFrame, overlap?: OverlapOptions) {
  if (frame.upAxis !== "z") throw new UserInputError("此规划结果需要与参考模型对齐的 Z 轴朝上 OBJ。");
  if (project.drones.length > 1) throw new UserInputError("单机规划要求项目最多有一架无人机。");
  const result = record(input);
  if (result.format !== "drone-coverage-path-nuav/v1" || result.droneCount !== 1 ||
      !Array.isArray(result.drones) || result.drones.length !== 1) return invalid();
  const fov = record(result.coverageParams).fovDeg;
  if (typeof fov !== "number" || !Number.isFinite(fov) || fov < 10 || fov > 120) return invalid();
  const drone = record(result.drones[0]);
  if (drone.id !== 1 || !Array.isArray(drone.path) || !Array.isArray(drone.shots) || !drone.shots.length)
    return invalid();
  const path = drone.path.map(record);
  const plannedShots: unknown[] = drone.shots;
  let next = 0;
  const shots = path.flatMap((waypoint, index) => {
    if (waypoint.shot === 0) return [];
    if (waypoint.shot !== 1) return invalid();
    const shot = record(plannedShots[next++]);
    const position = xyz(waypoint);
    if (shot.pathIndex !== index || xyz(shot).some((n, i) => Math.abs(n - position[i]) > 1e-5))
      return invalid();
    const axis = xyz(shot.axis);
    const distance = shot.dist_m;
    if (Math.hypot(...axis) < 0.99 || Math.hypot(...axis) > 1.01 ||
        typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) return invalid();
    const target: Vec3 = [
      position[0] + axis[0] * distance,
      position[1] + axis[1] * distance,
      position[2] + axis[2] * distance,
    ];
    return [{ pathIndex: index, position: modelToApp(position, frame), target: modelToApp(target, frame) }];
  });
  if (next !== plannedShots.length) return invalid();
  const start = modelToApp(xyz(drone.start), frame);
  const views = overlap
    ? addOverlapShots(shots, path.map((waypoint) => modelToApp(xyz(waypoint), frame)), overlap)
    : { shots, originalIndices: shots.map((_, i) => i) };
  return {
    project: applyRoute({ ...project, drones: [{ ...(project.drones[0] ?? makeDrone(1)), position: start, fov }] }, views.shots),
    originalIndices: views.originalIndices,
  };
}


export function applyNuavCaptureRoute(project: Project, input: unknown, frame: BuildingFrame): Project {
  return parseNuavCaptureRoute(project, input, frame).project;
}

export function buildNuavOverlapRoute(project: Project, input: unknown, frame: BuildingFrame, overlap: OverlapOptions) {
  return parseNuavCaptureRoute(project, input, frame, overlap);
}
