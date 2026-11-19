import type { Model, ObjResource, Project, Vec3 } from "./types.ts";

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
