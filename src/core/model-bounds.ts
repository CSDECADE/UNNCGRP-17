import type { Model, ObjResource, Project, Vec3 } from "./types.ts";
import { Box3, Vector3 } from "three";
import { objMatrix } from "./obj-transform.ts";

export function resourceBounds(resource: ObjResource): { center: Vec3; size: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const mesh of resource.meshes) for (const index of mesh.triangles) {
    const position = resource.vertices[index].position;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  }
  return { center: min.map((n, i) => (n + max[i]) / 2) as Vec3,
    size: min.map((n, i) => max[i] - n) as Vec3 };
}

export function modelBounds(model: Model, project: Project): { center: Vec3; size: Vec3 } {
  if (model.kind !== "obj") return { center: [0, model.size[1] / 2, 0], size: model.size };
  const resource = project.objResources?.find(r => r.id === model.resourceId);
  if (!resource) throw new Error("Missing OBJ resource");
  return resourceBounds(resource);
}

export function objWorldBounds(model: Extract<Model, { kind: "obj" }>, project: Project, local = modelBounds(model, project)) {
  const box = new Box3().setFromCenterAndSize(new Vector3(...local.center), new Vector3(...local.size));
  box.applyMatrix4(objMatrix(model));
  return { center: box.getCenter(new Vector3()).toArray(), size: box.getSize(new Vector3()).toArray() };
}
