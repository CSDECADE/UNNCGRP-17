import { Matrix4, Quaternion, Raycaster, Vector2, Vector3, Vector4, type Camera, type Object3D } from "three";
import type { ObjMesh, ObjModel, ObjResource, Project, Selection, Vec3 } from "./types.ts";
import { objMatrix } from "./obj-transform.ts";
import { UserInputError } from "./errors.ts";
import { resourceBounds } from "./model-bounds.ts";

/** UI selection only; IDs are stable within the active instance's resource. */
export type VertexSelection = { modelId: string; meshId: string; vertexId: string | null };
export type MeshSelectionMode = "vertex" | "edge" | "face";
export type MeshElementSelection = VertexSelection | { modelId: string; meshId: string; kind: "edge"; edgeIds: [string, string] | null }
  | { modelId: string; meshId: string; kind: "face"; triangle: number | null };
export type MeshSelection = MeshElementSelection & { additional?: MeshElementSelection[] };
export const selectionMode = (selected: MeshSelection): MeshSelectionMode => "kind" in selected ? selected.kind : "vertex";
export function clearElement(selected: MeshSelection, kind = selectionMode(selected), meshId = selected.meshId): MeshSelection {
  const base = { modelId: selected.modelId, meshId };
  return kind === "edge" ? { ...base, kind, edgeIds: null } : kind === "face" ? { ...base, kind, triangle: null } : { ...base, vertexId: null };
}
export function singleElementKey(selected: MeshElementSelection) {
  return JSON.stringify([selected.modelId, selected.meshId, selectionMode(selected),
    "edgeIds" in selected ? selected.edgeIds && [...selected.edgeIds].sort() : "triangle" in selected ? selected.triangle : selected.vertexId]);
}
export function selectionElements(selected: MeshSelection): MeshElementSelection[] {
  const elements = [selected, ...(selected.additional ?? [])], unique = new Map<string, MeshElementSelection>();
  for (const element of elements) {
    const present = "vertexId" in element ? element.vertexId !== null : "edgeIds" in element ? element.edgeIds !== null : element.triangle !== null;
    if (!present) continue;
    const { additional: _additional, ...single } = element as MeshSelection;
    unique.set(singleElementKey(single), single);
  }
  return [...unique.values()];
}
export function elementKey(selected: MeshSelection) {
  return JSON.stringify([selected.modelId, selected.meshId, selectionMode(selected), selectionElements(selected).map(singleElementKey).sort()]);
}
export function withSelectionElements(scope: MeshSelection, elements: MeshElementSelection[]): MeshSelection {
  if (elements.some(element => element.modelId !== scope.modelId || element.meshId !== scope.meshId || selectionMode(element) !== selectionMode(scope)))
    throw new UserInputError("多选仅支持同一对象、子网格和元素类型。");
  const unique = elements.length ? selectionElements({ ...elements[0], additional: elements.slice(1) }) : [];
  return unique.length ? { ...unique[0], ...(unique.length > 1 ? { additional: unique.slice(1) } : {}) } : clearElement(scope);
}
export function updateMeshSelection(current: MeshSelection, picked: MeshElementSelection, toggle = false): MeshSelection {
  if (picked.modelId !== current.modelId || picked.meshId !== current.meshId || selectionMode(picked) !== selectionMode(current)) return current;
  if (!selectionElements(picked).length) return clearElement(current);
  if (!toggle) return withSelectionElements(current, [picked]);
  const elements = selectionElements(current), key = singleElementKey(picked);
  return withSelectionElements(current, elements.some(element => singleElementKey(element) === key)
    ? elements.filter(element => singleElementKey(element) !== key) : [...elements, picked]);
}
type MeshEdge = { ids: [string, string]; indices: [number, number] };
type MeshTopology = {
  referenced?: Set<number>;
  indices?: number[];
  edges?: MeshEdge[];
  edgeMap?: Map<string, MeshEdge>;
};
type ResourceTopology = { vertices?: Map<string, number>; meshes: Map<string, MeshTopology> };
// Resources are immutable snapshots. Values contain only derived IDs/indices:
// no resources, vertex objects, position/normal arrays or history references.
// A restored/replaced resource gets its own entry even if all IDs are reused.
const topologyCache = new WeakMap<ObjResource, ResourceTopology>();
function resourceTopology(resource: ObjResource) {
  let topology = topologyCache.get(resource);
  if (!topology) { topology = { meshes: new Map() }; topologyCache.set(resource, topology); }
  return topology;
}
function meshTopology(resource: ObjResource, mesh: ObjMesh) {
  const owner = resourceTopology(resource);
  let topology = owner.meshes.get(mesh.id);
  if (!topology) { topology = {}; owner.meshes.set(mesh.id, topology); }
  return topology;
}
function referencedVertices(resource: ObjResource, mesh: ObjMesh) {
  const topology = meshTopology(resource, mesh);
  if (!topology.referenced) {
    topology.referenced = new Set(mesh.triangles);
    topology.indices = [...topology.referenced];
    Object.freeze(topology.indices);
  }
  return topology;
}
function edgeTopology(resource: ObjResource, mesh: ObjMesh) {
  const topology = meshTopology(resource, mesh);
  if (topology.edges) return topology;
  const edges = new Map<string, MeshEdge>();
  for (let i = 0; i < mesh.triangles.length; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    let x = mesh.triangles[i + a], y = mesh.triangles[i + b];
    if (x === y) continue;
    if (resource.vertices[x].id > resource.vertices[y].id) [x, y] = [y, x];
    const ids: [string, string] = [resource.vertices[x].id, resource.vertices[y].id];
    const edge: MeshEdge = { ids, indices: [x, y] };
    Object.freeze(edge.ids); Object.freeze(edge.indices); Object.freeze(edge);
    edges.set(JSON.stringify(ids), edge);
  }
  topology.edgeMap = edges;
  topology.edges = [...edges.values()];
  Object.freeze(topology.edges);
  return topology;
}
/** Shared read-only derived collection; coordinates always come from resource.vertices. */
export function meshEdges(resource: ObjResource, meshId: string) {
  const mesh = resource.meshes.find(m => m.id === meshId);
  return mesh ? edgeTopology(resource, mesh).edges! : [];
}
export type EditRestrictions = { preview: boolean; playing: boolean; candidate: boolean; droneView: boolean };
export function editableObj(project: Project, selection: Selection, restrictions: EditRestrictions) {
  if (restrictions.preview || restrictions.playing || restrictions.candidate || restrictions.droneView || selection?.type !== "model") return null;
  const model = project.models.find(m => m.id === selection.id);
  if (model?.kind !== "obj" || !model.visible || model.locked) return null;
  const resource = project.objResources?.find(r => r.id === model.resourceId);
  return resource ? { model, resource } : null;
}
export function resolveElement(project: Project, selected: MeshSelection) {
  const model = project.models.find(m => m.id === selected.modelId);
  if (model?.kind !== "obj" || !model.visible || model.locked) return null;
  const resource = project.objResources?.find(r => r.id === model.resourceId);
  const mesh = resource?.meshes.find(m => m.id === selected.meshId);
  if (!resource || !mesh) return null;
  const elements = selectionElements(selected), kind = selectionMode(selected);
  const edgeMap = kind === "edge" ? edgeTopology(resource, mesh).edgeMap : undefined;
  const owner = kind === "vertex" ? resourceTopology(resource) : undefined;
  const vertexMap = owner && (owner.vertices ??= new Map(resource.vertices.map((v, i) => [v.id, i])));
  const referenced = kind === "vertex" ? referencedVertices(resource, mesh).referenced : undefined;
  const elementIndices = elements.map(element => {
    if (element.modelId !== selected.modelId || element.meshId !== selected.meshId || selectionMode(element) !== selectionMode(selected)) return [];
    if ("edgeIds" in element && element.edgeIds) return edgeMap?.get(JSON.stringify([...element.edgeIds].sort()))?.indices ?? [];
    if ("triangle" in element && element.triangle !== null && Number.isInteger(element.triangle) && element.triangle >= 0 && element.triangle < mesh.triangles.length / 3)
      return [...new Set(mesh.triangles.slice(element.triangle * 3, element.triangle * 3 + 3))];
    if ("vertexId" in element) {
      const index = vertexMap?.get(element.vertexId ?? "");
      if (index !== undefined && referenced?.has(index)) return [index];
    }
    return [];
  });
  const indices = elementIndices.some(indices => !indices.length) ? [] : [...new Set(elementIndices.flat())];
  if (elements.length && !indices.length) {
    return { model, resource, mesh, elements, elementIndices: [], indices, pivot: null };
  }
  const pivot = indices.length ? indices.reduce((point, i) => point.add(new Vector3(...resource.vertices[i].position)), new Vector3()).divideScalar(indices.length).toArray() : null;
  return { model, resource, mesh, elements, elementIndices, indices, pivot };
}
export function resolveVertex(project: Project, selected: VertexSelection) {
  const target = resolveElement(project, selected);
  return target ? { ...target, index: target.indices[0] ?? -1, vertex: target.indices.length ? target.resource.vertices[target.indices[0]] : null } : null;
}
export function coincidentElements(project: Project, selected: MeshSelection): MeshSelection[] {
  const primary = selectionElements(selected)[0];
  const target = primary && resolveElement(project, primary);
  if (!target?.pivot) return [];
  const { resource, mesh } = target, base = { modelId: selected.modelId, meshId: selected.meshId };
  const signature = (indices: number[]) => JSON.stringify(indices.map(i => JSON.stringify(resource.vertices[i].position)).sort());
  const key = signature(target.indices);
  if (selectionMode(selected) === "edge") return meshEdges(resource, mesh.id)
    .filter(edge => signature(edge.indices) === key).map(edge => ({ ...base, kind: "edge", edgeIds: edge.ids }));
  if (selectionMode(selected) === "face") return Array.from({ length: mesh.triangles.length / 3 }, (_, triangle) => triangle)
    .filter(i => signature(mesh.triangles.slice(i * 3, i * 3 + 3)) === key).map(triangle => ({ ...base, kind: "face", triangle }));
  return meshVertexIndices(resource, mesh.id).filter(i => signature([i]) === key)
    .map(i => ({ ...base, vertexId: resource.vertices[i].id }));
}
export function meshVertexIndices(resource: ObjResource, meshId: string) {
  const mesh = resource.meshes.find(m => m.id === meshId);
  return mesh ? referencedVertices(resource, mesh).indices! : [];
}
export function vertexWorldPosition(model: ObjModel, resource: ObjResource, index: number) {
  return new Vector3(...resource.vertices[index].position).applyMatrix4(objMatrix(model));
}
export function vertexLocalPosition(model: ObjModel, world: Vector3) {
  return world.clone().applyMatrix4(new Matrix4().copy(objMatrix(model)).invert()).toArray();
}

/** CSS-pixel tolerance, stable ties and occlusion checked at each candidate vertex. */
export function pickLogicalVertex(options: {
  resource: ObjResource; meshId: string; matrix: Matrix4; camera: Camera;
  pointer: { x: number; y: number }; width: number; height: number;
  visible?: (world: Vector3, index: number) => boolean; tolerance?: number;
}): string | null {
  const { resource, meshId, matrix, camera, pointer, width, height, visible } = options;
  let best: { id: string; distance: number } | undefined;
  for (const index of meshVertexIndices(resource, meshId)) {
    const vertex = resource.vertices[index], world = new Vector3(...vertex.position).applyMatrix4(matrix);
    const projected = world.clone().project(camera);
    if (projected.z < -1 || projected.z > 1) continue;
    const distance = Math.hypot((projected.x + 1) * width / 2 - pointer.x, (1 - projected.y) * height / 2 - pointer.y);
    if (distance > (options.tolerance ?? 10) || (best && distance >= best.distance - 1e-7) || (visible && !visible(world, index))) continue;
    best = { id: vertex.id, distance };
  }
  return best?.id ?? null;
}

export function vertexVisible(world: Vector3, camera: Camera, objects: Object3D[]) {
  const projected = world.clone().project(camera), ray = new Raycaster();
  ray.setFromCamera(new Vector2(projected.x, projected.y), camera);
  const distance = world.clone().sub(ray.ray.origin).dot(ray.ray.direction);
  const hit = ray.intersectObjects(objects, false).find(hit => {
    const depth = hit.point.clone().project(camera).z;
    return depth >= -1 && depth <= 1;
  });
  // Triangle/rasterization precision at a vertex requires a small relative allowance.
  return !hit || hit.distance >= distance - Math.max(1e-5, Math.abs(distance) * 1e-6);
}

type EdgePickOptions = Omit<Parameters<typeof pickLogicalVertex>[0], "visible"> & { visible?: (world: Vector3) => boolean };
export function pickLogicalEdge(options: EdgePickOptions): [string, string] | null {
  const { resource, meshId, matrix, camera, pointer, width, height } = options;
  let best: { ids: [string, string]; distance: number } | undefined;
  for (const edge of meshEdges(resource, meshId)) {
    const [a, b] = edge.indices.map(i => new Vector3(...resource.vertices[i].position).applyMatrix4(matrix));
    const clips = [a, b].map(p => new Vector4(p.x, p.y, p.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix));
    // Deliberately omit near/far-clipped edges rather than picking behind the camera.
    if (clips.some(p => p.w <= 0 || p.z < -p.w || p.z > p.w)) continue;
    const [pa, pb] = clips.map(p => new Vector2((p.x / p.w + 1) * width / 2, (1 - p.y / p.w) * height / 2));
    const segment = pb.clone().sub(pa), length = segment.lengthSq();
    if (length < 1e-10) continue;
    const t = Math.max(0, Math.min(1, new Vector2(pointer.x, pointer.y).sub(pa).dot(segment) / length));
    const distance = pa.addScaledVector(segment, t).distanceTo(new Vector2(pointer.x, pointer.y));
    if (distance > (options.tolerance ?? 8) || (best && distance >= best.distance - 1e-7)) continue;
    const perspectiveT = t * clips[0].w / ((1 - t) * clips[1].w + t * clips[0].w);
    const point = a.clone().lerp(b, perspectiveT);
    if (options.visible && !options.visible(point)) continue;
    best = { ids: edge.ids, distance };
  }
  return best?.ids ?? null;
}

/** The renderer expands triangle corners in order, so faceIndex is the resource triangle ordinal. */
export function pickLogicalFace(options: { camera: Camera; pointer: { x: number; y: number }; width: number; height: number;
  objects: Object3D[]; modelId: string; meshId: string }): number | null {
  const { camera, pointer, width, height, objects, modelId, meshId } = options, ray = new Raycaster();
  ray.setFromCamera(new Vector2(pointer.x / width * 2 - 1, 1 - pointer.y / height * 2), camera);
  const hits = ray.intersectObjects(objects, false).filter(hit => {
    const depth = hit.point.clone().project(camera).z;
    return depth >= -1 && depth <= 1;
  });
  if (!hits.length) return null;
  const limit = hits[0].distance + Math.max(1e-5, hits[0].distance * 1e-6);
  for (const hit of hits) {
    if (hit.distance > limit) break;
    if (hit.object.userData.objMeshId !== meshId) continue;
    for (let node: Object3D | null = hit.object; node; node = node.parent)
      if (node.name === `model-${modelId}`) return hit.faceIndex ?? null;
  }
  return null;
}

function faceNormal(resource: ObjResource, indices: number[]) {
  const [a, b, c] = indices.map(i => new Vector3(...resource.vertices[i].position));
  const scale = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  const normal = b.clone().sub(a).cross(c.clone().sub(a));
  if (!scale || normal.length() <= scale * scale * 1e-10)
    throw new UserInputError("移动会产生退化三角形，请调整顶点位置。");
  return normal.normalize();
}

/** Immutable absolute edit from the gesture's base, never accumulating round-off. */
export function translateLogicalVertex(base: Project, selected: VertexSelection, position: Vec3, copyId: string): Project {
  return translateMeshElement(base, selected, position, copyId);
}

export function translateMeshElement(base: Project, selected: MeshSelection, position: Vec3, copyId: string): Project {
  if (base.version !== 2) throw new UserInputError("此项目没有可编辑的 OBJ 资源。");
  const target = resolveElement(base, selected);
  if (!target?.pivot) throw new UserInputError("所选网格元素已不可编辑。");
  if (position.length !== 3 || !position.every(n => Number.isFinite(n) && Math.abs(n) <= 10000))
    throw new UserInputError("顶点局部坐标必须位于 ±10,000 米范围内。");
  if (position.every((n, i) => Math.abs(n - target.pivot![i]) < 1e-9)) return base;
  const { resource, model } = target, affected = new Set(target.indices);
  const delta = position.map((n, i) => n - target.pivot![i]);
  const vertices = resource.vertices.map((v, i) => {
    if (!affected.has(i)) return v;
    const next = v.position.map((n, axis) => n + delta[axis]) as Vec3;
    if (!next.every(n => Number.isFinite(n) && Math.abs(n) <= 10000)) throw new UserInputError("移动后的顶点局部坐标超出 ±10,000 米。");
    return { ...v, position: next };
  });
  let changed: ObjResource = { ...resource, vertices };
  const bounds = resourceBounds(changed);
  if (bounds.size.some(n => n > 10000)) throw new UserInputError("编辑后的模型尺寸不能超过 10,000 米。");
  const meshes = resource.meshes.map(mesh => {
    if (!mesh.triangles.some(i => affected.has(i))) return mesh;
    let normals = mesh.normals;
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      const triangle = mesh.triangles.slice(i, i + 3);
      if (!triangle.some(i => affected.has(i))) continue;
      const normal = faceNormal(changed, triangle);
      if (!normals || !mesh.normals) continue;
      const cornerNormals = [0, 1, 2].map(corner => new Vector3(...mesh.normals!.slice((i + corner) * 3, (i + corner + 1) * 3) as Vec3));
      if (cornerNormals.some(n => !n.toArray().every(value => Number.isFinite(Math.fround(value))) || n.lengthSq() === 0))
        throw new UserInputError("受影响的面包含无效法线，无法编辑。");
      if (triangle.every(i => affected.has(i))) continue;
      // Carry each authored corner normal with its face. Distinct hard-edge and
      // UV corner relationships survive; no cross-face averaging is introduced.
      const rotation = new Quaternion().setFromUnitVectors(faceNormal(resource, triangle), normal);
      if (normals === mesh.normals) normals = [...normals];
      for (let corner = i; corner < i + 3; corner++) {
        const offset = corner * 3, original = cornerNormals[corner - i];
        const values = original.applyQuaternion(rotation).toArray();
        normals.splice(offset, 3, ...values);
      }
    }
    return normals !== mesh.normals ? { ...mesh, normals } : mesh;
  });
  changed = { ...changed, meshes };
  const shared = base.models.some(m => m.kind === "obj" && m.id !== model.id && m.resourceId === resource.id);
  if (shared) changed = { ...changed, id: copyId };
  // This operation changes only coordinates and authored normals. Vertex IDs,
  // order, mesh IDs and triangle connectivity are unchanged, including COW.
  // Keep this inheritance private to this topology-preserving operation;
  // future topology changes must create a new resource without inheriting it.
  const topology = topologyCache.get(resource);
  if (topology) topologyCache.set(changed, topology);
  return { ...base, models: shared ? base.models.map(m => m.id === model.id ? { ...m, resourceId: copyId } : m) : base.models,
    objResources: shared ? [...base.objResources!, changed] : base.objResources!.map(r => r.id === resource.id ? changed : r) };
}

/** Stable references let unrelated render meshes retain their existing GPU buffers. */
export function meshGeometryUnchanged(before: ObjResource, after: ObjResource, mesh: ObjMesh) {
  return mesh.triangles.every(i => before.vertices[i] === after.vertices[i]);
}
