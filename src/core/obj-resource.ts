import type { ObjMesh, ObjResource, ObjVertex, Vec3 } from "./types.ts";
import { ProjectValidationError } from "./errors.ts";

const fail = (): never => { throw new ProjectValidationError("OBJ 资源数据无效或包含不支持的字段"); };
function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  if (Object.keys(value).some(key => !fields.includes(key))) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160 ? value : fail();
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) && value.length > 0 ? value : fail();
}
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fail();
}
function position(value: unknown): Vec3 {
  const values = list(value);
  if (values.length !== 3) return fail();
  return Array.from(values, n => {
    const coordinate = number(n);
    return Math.abs(coordinate) <= 10000 ? coordinate : fail();
  }) as Vec3;
}
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length) fail();
}
function attribute(value: unknown, length: number): number[] {
  const values = list(value);
  if (values.length !== length) return fail();
  return Array.from(values, number);
}

/** Validate and copy supported geometry; never weld coincident logical vertices. */
export function validateObjResources(input: unknown): ObjResource[] {
  if (!Array.isArray(input)) return fail();
  const resources = Array.from(input, item => {
    const resource = record(item, ["id", "name", "format", "vertices", "meshes"]);
    if (resource.format !== "obj") return fail();
    const vertices: ObjVertex[] = Array.from(list(resource.vertices), item => {
      const vertex = record(item, ["id", "position"]);
      return { id: text(vertex.id), position: position(vertex.position) };
    });
    unique(vertices.map(vertex => vertex.id));
    const meshes: ObjMesh[] = Array.from(list(resource.meshes), item => {
      const mesh = record(item, ["id", "name", "triangles", "uvs", "normals"]);
      const triangles = Array.from(list(mesh.triangles), value => {
        const index = number(value);
        return Number.isSafeInteger(index) && index >= 0 && index < vertices.length ? index : fail();
      });
      if (triangles.length % 3 !== 0) return fail();
      const result: ObjMesh = { id: text(mesh.id), name: text(mesh.name), triangles };
      if (mesh.uvs !== undefined) result.uvs = attribute(mesh.uvs, triangles.length * 2);
      if (mesh.normals !== undefined) result.normals = attribute(mesh.normals, triangles.length * 3);
      return result;
    });
    unique(meshes.map(mesh => mesh.id));
    return { id: text(resource.id), name: text(resource.name), format: "obj" as const, vertices, meshes };
  });
  unique(resources.map(resource => resource.id));
  return resources;
}
