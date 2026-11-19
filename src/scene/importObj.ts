import { Box3, Mesh, Vector3 } from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { UserInputError } from "../core/feedback.ts";
import { makeModel, MAX_PROJECT_BYTES } from "../core/project.ts";
import type { Model, Vec3 } from "../core/types.ts";

const MAX_OBJ_BYTES = 32_000_000;

function parseGeometry(text: string) {
  const group = new OBJLoader().parse(text);
  const mesh = group.children[0];
  if (!(mesh instanceof Mesh)) {
    group.traverse((object) => {
      if ("geometry" in object) (object.geometry as import("three").BufferGeometry).dispose();
    });
    throw new UserInputError("OBJ 文件中没有可显示的面。");
  }
  const { geometry } = mesh;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => material.dispose());
  const bounds = new Box3().setFromBufferAttribute(geometry.getAttribute("position"));
  const dimensions = bounds.getSize(new Vector3());
  const longest = Math.max(...dimensions.toArray());
  if (!Number.isFinite(longest) || longest <= 0) {
    geometry.dispose();
    throw new UserInputError("OBJ 模型的顶点坐标无效。");
  }
  const center = bounds.getCenter(new Vector3());
  const scale = Math.min(50, Math.max(8, longest)) / longest;
  geometry.translate(-center.x, -bounds.min.y, -center.z).scale(scale, scale, scale);
  const size = dimensions.multiplyScalar(scale).toArray().map((n) => Math.max(0.1, n)) as Vec3;
  return { geometry, size };
}

export async function prepareObj(file: File): Promise<Extract<Model, { kind: "obj" }>> {
  if (!/\.obj$/i.test(file.name)) throw new UserInputError("请选择 .obj 模型文件。");
  if (file.size > MAX_OBJ_BYTES) throw new UserInputError("OBJ 文件超过 32 MB，请先简化模型。");

  // Keep only the geometry so imported projects have no external material or texture files.
  const lines: string[] = [];
  for (const line of (await file.text()).replace(/\\\r?\n/g, "").split(/\r?\n/)) {
    const tokens = line.split("#", 1)[0].trim().split(/\s+/);
    if (tokens[0] === "v") lines.push(tokens.slice(0, 4).join(" "));
    if (tokens[0] === "f") lines.push(tokens.map((token) => token.split("/", 1)[0]).join(" "));
  }
  const source = lines.join("\n");
  if (!lines.some((line) => line.startsWith("f ")))
    throw new UserInputError("OBJ 文件中没有可显示的面。");
  const compressed = await new Response(new Blob([source]).stream()
    .pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  if (Math.ceil(compressed.byteLength / 3) * 4 > MAX_PROJECT_BYTES)
    throw new UserInputError("压缩后的模型超过项目容量，请先简化模型。");
  const bytes = new Uint8Array(compressed);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));

  const { geometry, size } = parseGeometry(source);
  geometry.dispose();
  return {
    ...makeModel("box", 1),
    kind: "obj",
    name: file.name.slice(0, -4).trim().slice(0, 160) || "导入模型",
    obj: btoa(binary),
    size,
  };
}

export async function loadObjGeometry(obj: string) {
  const bytes = Uint8Array.from(atob(obj), (char) => char.charCodeAt(0));
  let length = 0;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        length += chunk.byteLength;
        if (length > MAX_OBJ_BYTES) throw new UserInputError("OBJ 模型超过 32 MB。");
        controller.enqueue(chunk);
      },
    }));
  return parseGeometry(await new Response(stream).text());
}
