import { Matrix3, Vector3 } from "three";
import type { Project, Selection } from "../../core/types.ts";
import { UserInputError } from "../../core/errors.ts";
import { emptyProject, validateProject } from "../../core/project.ts";
import { MAX_OBJ_FILE_BYTES, objFileName } from "../../core/obj-file.ts";
import { objMatrix } from "../../core/obj-transform.ts";
import { prepareObjImport } from "../obj-import/obj.ts";

export type ObjExport = { name: string; text: string; vertices: number; triangles: number };

/** Encode only project data, retaining logical vertices rather than render corners. */
export function exportSelectedObj(project: Project, selection: Selection): ObjExport {
  const selected = selection?.type === "model" ? project.models.find(m => m.id === selection.id) : undefined;
  if (!selected || selected.kind !== "obj") throw new UserInputError("请选择一个导入的 OBJ 模型；内置模型和无人机暂不支持 OBJ 导出。");
  const source = project.objResources?.find(r => r.id === selected.resourceId);
  if (!source) throw new UserInputError("所选模型的 OBJ 资源不存在。");
  // Validate an isolated snapshot; unrelated scene objects can never enter the output.
  let checked: Project;
  try { checked = validateProject({ ...emptyProject(), version: 2, models: [selected], objResources: [source] }); }
  catch { throw new UserInputError("所选 OBJ 的资源或变换数据无效，无法导出。"); }
  const model = checked.models[0];
  if (model.kind !== "obj") throw new UserInputError("模型格式不受支持。");
  const resource = checked.objResources![0], matrix = objMatrix(model);
  const normalMatrix = new Matrix3().getNormalMatrix(matrix), name = objFileName(model.name);
  const chunks: string[] = [], encoder = new TextEncoder();
  let bytes = 0, triangleCount = 0;
  const append = (line: string) => {
    const text = line + "\n";
    bytes += encoder.encode(text).byteLength;
    if (bytes > MAX_OBJ_FILE_BYTES) throw new UserInputError("导出的 OBJ 文本超过 16 MB，本次未写入文件。");
    chunks.push(text);
  };
  const numeric = (value: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
      throw new UserInputError("模型包含无法导出的非有限数值。");
    return Object.is(value, -0) ? "0" : String(value);
  };
  const group = (label: string) => {
    if (label !== label.trim() || /[#\\\r\n]/.test(label) || /\s{2,}|[^\S ]/.test(label))
      throw new UserInputError("子网格名称包含 OBJ 不支持的字符或空白，无法无损导出。");
    if (label.length <= 70) { append(`o ${label}`); return; }
    // Stage 2 encodes o/g names as "object/group". Recover a compatible split.
    for (let i = 1; i < label.length - 1; i++) {
      const left = label.slice(0, i), right = label.slice(i + 1);
      if (label[i] === "/" && left.length <= 70 && right.length <= 70 && !/\s/.test(right) && left === left.trim()) {
        append(`o ${left}`); append(`g ${right}`); return;
      }
    }
    throw new UserInputError("子网格名称过长，无法按当前 OBJ 分组规则无损导出。");
  };
  append("# Aero OBJ export: object transforms baked once; no materials or editor helpers");
  for (const vertex of resource.vertices) {
    const point = new Vector3(...vertex.position).applyMatrix4(matrix);
    append(`v ${point.toArray().map(numeric).join(" ")}`);
  }
  const uvIndices = new Map<string, number>(), normalIndices = new Map<string, number>();
  const attribute = (kind: "vt" | "vn", values: number[], indices: Map<string, number>) => {
    const key = values.map(numeric).join(" ");
    let index = indices.get(key);
    if (index === undefined) { index = indices.size + 1; indices.set(key, index); append(`${kind} ${key}`); }
    return index;
  };
  for (const mesh of resource.meshes) {
    group(mesh.name);
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      const corners: string[] = [];
      for (let j = 0; j < 3; j++) {
        const corner = i + j, vertex = mesh.triangles[corner] + 1;
        const uv = mesh.uvs ? attribute("vt", mesh.uvs.slice(corner * 2, corner * 2 + 2), uvIndices) : undefined;
        let normal: number | undefined;
        if (mesh.normals) {
          const n = new Vector3(...mesh.normals.slice(corner * 3, corner * 3 + 3) as [number, number, number]);
          if (!n.toArray().every(value => Number.isFinite(Math.fround(value))) || n.lengthSq() === 0)
            throw new UserInputError("模型包含无效或零长度法线，无法导出。");
          n.applyNormalMatrix(normalMatrix);
          normal = attribute("vn", n.toArray(), normalIndices);
        }
        corners.push(normal !== undefined ? `${vertex}/${uv ?? ""}/${normal}` : uv !== undefined ? `${vertex}/${uv}` : String(vertex));
      }
      append(`f ${corners.join(" ")}`);
      triangleCount++;
    }
  }
  const text = chunks.join("");
  // Reuse the exact importer and project budget. Never emit a file that cannot be
  // restored into an empty project because of coordinates, triangles or geometry size.
  try { prepareObjImport(emptyProject(), text, name); }
  catch (error) {
    throw new UserInputError(`导出结果无法按当前规则回导，本次未写入文件。${error instanceof UserInputError ? error.message : "请检查模型几何。"}`);
  }
  return { name, text, vertices: resource.vertices.length, triangles: triangleCount };
}
