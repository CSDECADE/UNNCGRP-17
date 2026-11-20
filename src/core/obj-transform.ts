import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { ObjModel, Vec3 } from "./types.ts";

export const objRotation = (model: ObjModel): Vec3 => model.rotationXYZ ?? [0, model.rotation, 0];
export const objScale = (model: ObjModel): Vec3 => model.scale ?? [1, 1, 1];
export const radians = (degrees: Vec3): Vec3 => degrees.map(n => n * Math.PI / 180) as Vec3;
export function objQuaternion(rotation: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(...radians(rotation), "XYZ"));
}
export function objMatrix(model: ObjModel): Matrix4 {
  return new Matrix4().compose(new Vector3(...model.position), objQuaternion(objRotation(model)), new Vector3(...objScale(model)));
}
export function objPivot(model: ObjModel, center: Vec3): Vec3 {
  return new Vector3(...center).applyMatrix4(objMatrix(model)).toArray();
}
export function objPositionFromPivot(pivot: Vec3, rotation: Vec3, scale: Vec3, center: Vec3): Vec3 {
  const offset = new Vector3(...center).multiply(new Vector3(...scale)).applyQuaternion(objQuaternion(rotation));
  return new Vector3(...pivot).sub(offset).toArray();
}

/** Clamp factors before pivot compensation so crossing zero never mirrors a mesh. */
export function objScaleFactors(scale: Vec3): Vec3 {
  return scale.map(n => Math.max(0.01, Math.min(10000, n))) as Vec3;
}

/** Inspector and gizmo share the same centre-pivot rotation/scale convention. */
export function objChangeAroundCenter(model: ObjModel, center: Vec3, values: { rotationXYZ?: Vec3; scale?: Vec3 }) {
  const rotationXYZ = values.rotationXYZ ?? objRotation(model);
  const scale = objScaleFactors(values.scale ?? objScale(model));
  return { ...values, position: objPositionFromPivot(objPivot(model, center), rotationXYZ, scale, center) };
}
