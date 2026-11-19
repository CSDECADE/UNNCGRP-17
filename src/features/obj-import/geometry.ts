import { BufferGeometry, Float32BufferAttribute } from "three";
import type { ObjMesh, ObjResource } from "../../core/types.ts";

/** Each instance owns its buffers; logical vertices and history are never mutated. */
export function createObjGeometry(resource: ObjResource, mesh: ObjMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(mesh.triangles.length * 3);
  mesh.triangles.forEach((index, i) => positions.set(resource.vertices[index].position, i * 3));
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  if (mesh.uvs) geometry.setAttribute("uv", new Float32BufferAttribute(mesh.uvs, 2));
  if (mesh.normals) geometry.setAttribute("normal", new Float32BufferAttribute(mesh.normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
