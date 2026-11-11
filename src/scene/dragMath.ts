import { Plane, Vector3, type Ray, type Quaternion } from "three";
import type { CameraView, Vec3 } from "../core/types.ts";

export function editingPlane(view: CameraView, origin: Vec3) {
  const normal = view === "side" ? new Vector3(1, 0, 0)
    : view === "front" ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  return new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(...origin));
}
export function planeHit(ray: Ray, plane: Plane): Vector3 | null {
  // A near-parallel ray makes a small screen movement jump a very long distance.
  if (Math.abs(ray.direction.dot(plane.normal)) < 0.035) return null;
  return ray.intersectPlane(plane, new Vector3());
}
export function dragPosition(origin: Vec3, start: Vector3, end: Vector3, fine: boolean): Vec3 {
  return new Vector3(...origin).add(end.clone().sub(start).multiplyScalar(fine ? 0.1 : 1)).toArray();
}
export function yawDegrees(rotation: Quaternion, initial = 0): number {
  const direction = new Vector3(0, 0, 1).applyQuaternion(rotation);
  const angle = Math.atan2(direction.x, direction.z) * 180 / Math.PI;
  return angle + Math.round((initial - angle) / 360) * 360;
}
export function cameraUp(position: Vec3, target: Vec3): Vector3 {
  const direction = new Vector3(...target).sub(new Vector3(...position)).normalize();
  return Math.abs(direction.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
}
