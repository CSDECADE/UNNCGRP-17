import { Vector3 } from "three";
import type { Model, ObjMesh, ObjResource, Project, Vec3 } from "../../core/types.ts";
import { UserInputError } from "../../core/errors.ts";
import { uid, validateProject } from "../../core/project.ts";
import { resourceBounds } from "../../core/model-bounds.ts";
import { MAX_OBJ_FILE_BYTES } from "../../core/obj-file.ts";

type Corner = { vertex: number; uv?: number; normal?: number };

function* lines(text: string) {
  // Scan without allocating an array for every line in a large text file.
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (start <= text.length) {
    const end = text.indexOf("\n", start);
    yield text.slice(start, end < 0 ? text.length : end);
    if (end < 0) break;
    start = end + 1;
  }
}

/** Deliberately restricted OBJ surface importer, preserving source v identities. */
export function parseObj(text: string, name: string): ObjResource {
  if (!name.toLowerCase().endsWith(".obj") || name.length > 160 || !name.trim())
    throw new UserInputError("请选择名称不超过 160 个字符的 .obj 文件。");
  if (new TextEncoder().encode(text).byteLength > MAX_OBJ_FILE_BYTES)
    throw new UserInputError("OBJ 文本超过 16 MB，请选择较小的文件。");
  const resource: ObjResource = { id: uid(), name, format: "obj", vertices: [], meshes: [] };
  const uvs: number[][] = [], normals: number[][] = [];
  let objectName = "Object", groupName = "", mesh: ObjMesh | undefined, line = 0;
  const fail = (message: string): never => { throw new UserInputError(`OBJ 第 ${line} 行：${message}`); };
  const numbers = (values: string[], count: number): number[] => {
    if (values.length !== count) return fail(`需要 ${count} 个数值；不支持额外的坐标、权重或颜色。`);
    return values.map(value => {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return fail("数值格式无效。");
      const n = Number(value);
      return Number.isFinite(n) && Number.isFinite(Math.fround(n)) ? n : fail("数值必须在有限的单精度浮点范围内。");
    });
  };
  const index = (value: string, length: number): number => {
    if (!/^[+-]?\d+$/.test(value)) return fail("面索引必须是非零整数。");
    const n = Number(value), resolved = n < 0 ? length + n : n - 1;
    if (!Number.isSafeInteger(n) || n === 0 || resolved < 0 || resolved >= length)
      return fail("面索引越界；不支持对尚未声明的顶点或属性的引用。");
    return resolved;
  };
  const corner = (value: string): Corner => {
    const parts = value.split("/");
    if (parts.length > 3 || !parts[0] || (parts.length === 2 && !parts[1]) ||
      (parts.length === 3 && !parts[2])) return fail("面顶点格式无效。");
    return { vertex: index(parts[0], resource.vertices.length),
      uv: parts[1] ? index(parts[1], uvs.length) : undefined,
      normal: parts[2] ? index(parts[2], normals.length) : undefined };
  };
  const checkPolygon = (corners: Corner[]) => {
    const points = corners.map(c => new Vector3(...resource.vertices[c.vertex].position));
    let scale = 0;
    for (const a of points) for (const b of points) scale = Math.max(scale, a.distanceTo(b));
    const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (!scale || normal.length() <= scale * scale * 1e-10) fail("退化三角形或四边形不受支持。");
    normal.normalize();
    if (points.length === 4) {
      if (Math.abs(points[3].clone().sub(points[0]).dot(normal)) > scale * 1e-6)
        fail("四边形必须共面；请先在建模软件中三角化。");
      for (let i = 0; i < 4; i++) {
        const a = points[(i + 1) % 4].clone().sub(points[i]);
        const b = points[(i + 2) % 4].clone().sub(points[(i + 1) % 4]);
        if (a.cross(b).dot(normal) <= scale * scale * 1e-10)
          fail("仅支持凸四边形；凹、自交或退化的四边形请先三角化。");
      }
    }
  };
  for (const source of lines(text)) {
    line++;
    const content = source.split("#", 1)[0].trim();
    if (!content) continue;
    if (content.length > 4096) fail("单行内容超过 4,096 个字符，请简化文件或拆分指令。");
    if (content.includes("\\")) fail("不支持续行语法。");
    const [command, ...values] = content.split(/\s+/);
    if (command === "v") {
      const position = numbers(values, 3) as Vec3;
      if (position.some(n => Math.abs(n) > 10000)) fail("局部坐标必须在 ±10,000 米范围内。");
      resource.vertices.push({ id: `v${resource.vertices.length + 1}`, position });
    } else if (command === "vt") uvs.push(numbers(values, 2));
    else if (command === "vn") {
      const normal = numbers(values, 3);
      if (normal.every(n => n === 0)) fail("法线不能为零向量。");
      normals.push(normal);
    } else if (command === "o" || command === "g") {
      if (command === "g" && values.length > 1) fail("一个面不能同时属于多个组。");
      const label = values.join(" ");
      if (label.length > 70) fail("对象或组名称不能超过 70 个字符。");
      if (command === "o") { objectName = label || "Object"; groupName = ""; }
      else groupName = label;
      mesh = undefined;
    } else if (command === "s") {
      if (values.length !== 1 || !["off", "0"].includes(values[0]))
        fail("暂不支持平滑组；请关闭平滑组并导出显式法线。");
    } else if (command === "f") {
      if (values.length !== 3 && values.length !== 4) fail("仅支持三角形和凸共面四边形；其他多边形请先三角化。");
      const corners = values.map(corner);
      for (const attribute of ["uv", "normal"] as const) {
        if (corners.some(c => (c[attribute] !== undefined) !== (corners[0][attribute] !== undefined)))
          fail("同一个面必须完整提供或全部省略 UV/法线。");
      }
      checkPolygon(corners);
      if (!mesh) {
        mesh = { id: `mesh${resource.meshes.length + 1}`, name: groupName ? `${objectName}/${groupName}` : objectName, triangles: [] };
        if (corners[0].uv !== undefined) mesh.uvs = [];
        if (corners[0].normal !== undefined) mesh.normals = [];
        resource.meshes.push(mesh);
      }
      if ((mesh.uvs !== undefined) !== (corners[0].uv !== undefined) ||
        (mesh.normals !== undefined) !== (corners[0].normal !== undefined))
        fail("同一子网格的面必须使用一致的 UV/法线格式。");
      const order = corners.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3];
      for (const i of order) {
        const c = corners[i];
        mesh.triangles.push(c.vertex);
        if (mesh.uvs) mesh.uvs.push(...uvs[c.uv!]);
        if (mesh.normals) mesh.normals.push(...normals[c.normal!]);
      }
    } else fail(`不支持 ${command} 指令（包括材质、线、点及自由曲面）。`);
  }
  if (!resource.meshes.length) throw new UserInputError("OBJ 文件中没有可导入的面。");
  return resource;
}

/** Prepare one atomic history update, validating the resulting project byte budget. */
export function prepareObjImport(project: Project, text: string, name: string): { project: Project; model: Model } {
  if (project.models.length >= 500) throw new UserInputError("场景最多支持 500 个模型，请先删除不需要的模型。");
  const resource = parseObj(text, name), bounds = resourceBounds(resource);
  if (bounds.size.some(n => n > 10000)) throw new UserInputError("模型的单轴尺寸超过当前场景支持的 10,000 米，请先调整源模型单位。");
  const model: Model = { id: uid(), kind: "obj", resourceId: resource.id, name,
    position: [0, 0, 0], rotation: 0, size: bounds.size.map(n => Math.max(0.1, n)) as Vec3,
    color: "#bdc5d2", visible: true, locked: false };
  try {
    const next = validateProject({ ...project, version: 2, models: [...project.models, model],
      objResources: [...(project.objResources ?? []), resource], source: "用户手动编排" });
    return { project: next, model };
  } catch (error) {
    if (error instanceof UserInputError)
      throw new UserInputError("导入后的完整项目超过 5 MB（包括场景、背景和模型），本次导入未应用。");
    throw error;
  }
}
