// Derive an aligned low-poly "white model" (proxy) from a textured photogrammetry glb.
//
//   node make-proxy.mjs <reference.glb> <out-dir> [--ratio 0.0006] [--error 0.02]
//
// Output (same coordinate frame and units as the input, nothing is moved):
//   <out-dir>/proxy.glb   untextured, light grey, positions only
//   <out-dir>/proxy.obj   the same mesh as OBJ (for the OBJ importer / editors)
//   <out-dir>/proxy.json  stats and the bounding box, useful to choose the app placement
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, simplify, weld } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const [input, outDir] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!input || !outDir) {
  console.error("usage: node make-proxy.mjs <reference.glb> <out-dir> [--ratio 0.0006] [--error 0.02]");
  process.exit(2);
}
const ratio = option("ratio", 0.0006);
const error = option("error", 0.02);

const io = new NodeIO()
  .registerExtensions(KHRONOS_EXTENSIONS)
  .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const doc = await io.readBinary(new Uint8Array(await readFile(input)));
const root = doc.getRoot();

// Drop everything a white model does not need, so UV seams and normals don't block simplification.
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives())
    for (const semantic of prim.listSemantics()) if (semantic !== "POSITION") prim.setAttribute(semantic, null);
for (const texture of root.listTextures()) texture.dispose();
const white = doc.createMaterial("proxy-white").setBaseColorFactor([0.86, 0.87, 0.89, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(white);
// Write the proxy uncompressed so any glTF/OBJ reader can open it.
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === "KHR_draco_mesh_compression") ext.dispose();

const before = countTriangles(root);
await MeshoptSimplifier.ready;
await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }), dedup(), prune());
const after = countTriangles(root);

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "proxy.glb"), await io.writeBinary(doc));
const { obj, bounds } = toObj(root);
await writeFile(path.join(outDir, "proxy.obj"), obj);
await writeFile(
  path.join(outDir, "proxy.json"),
  JSON.stringify({ source: path.basename(input), trianglesBefore: before, trianglesAfter: after, ratio, error, bounds }, null, 2),
);
console.log(`triangles ${before} -> ${after}; bounds min ${bounds.min.map((n) => n.toFixed(2))} max ${bounds.max.map((n) => n.toFixed(2))}`);

function countTriangles(root) {
  let n = 0;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) n += (prim.getIndices()?.getCount() ?? prim.getAttribute("POSITION").getCount()) / 3;
  return n;
}
// Meshes in the source have no node transforms beyond identity; OBJ keeps the raw frame.
function toObj(root) {
  const lines = ["# Aero demo proxy (white model) derived from " + path.basename(input)];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let base = 1;
  for (const mesh of root.listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION"), idx = prim.getIndices();
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        lines.push(`v ${v.map((n) => +n.toFixed(5)).join(" ")}`);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], v[k]);
          max[k] = Math.max(max[k], v[k]);
        }
      }
      const count = idx ? idx.getCount() : pos.getCount();
      for (let i = 0; i < count; i += 3) {
        const f = [0, 1, 2].map((k) => (idx ? idx.getScalar(i + k) : i + k) + base);
        lines.push(`f ${f.join(" ")}`);
      }
      base += pos.getCount();
    }
  return { obj: lines.join("\n") + "\n", bounds: { min, max } };
}
