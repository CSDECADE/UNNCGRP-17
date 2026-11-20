import { Euler, MathUtils, type Quaternion } from "three";
import type { Model, Vec3 } from "./types.ts";
import { objPivot, objPositionFromPivot, objRotation, objScale, objScaleFactors } from "./obj-transform.ts";
import { yawDegrees } from "../scene/dragMath.ts";

export type ModelTransformMode = "translate" | "rotate" | "scale";

/** Adapt the shared control target without changing the persisted model contract. */
export function modelControlPose(model: Model, center: Vec3) {
  return model.kind === "obj"
    ? { position: objPivot(model, center), rotation: objRotation(model), scale: objScale(model) }
    : { position: model.position, rotation: [0, model.rotation, 0] as Vec3, scale: model.size };
}

export function modelControlValues(model: Model, mode: ModelTransformMode, center: Vec3,
  position: Vec3, quaternion: Quaternion, scale: Vec3): Record<string, unknown> {
  if (model.kind !== "obj") {
    if (mode === "translate") return { position };
    if (mode === "rotate") return { rotation: yawDegrees(quaternion, model.rotation) };
    // TransformControls scales its empty target; these values are dimensions in metres.
    return { size: scale };
  }
  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  const rotation = [euler.x, euler.y, euler.z].map(MathUtils.radToDeg) as Vec3;
  const factors = objScaleFactors(scale);
  const values = { position: objPositionFromPivot(position, rotation, factors, center) };
  return mode === "translate" ? values
    : { ...values, ...(mode === "rotate" ? { rotationXYZ: rotation } : { scale: factors }) };
}
