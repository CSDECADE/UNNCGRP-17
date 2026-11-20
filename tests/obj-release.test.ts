import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Vector3 } from "three";
import { prepareObjImport } from "../src/features/obj-import/obj.ts";
import { exportSelectedObj } from "../src/features/obj-export/obj.ts";
import { exampleProject, parseProject, serializeProject, poseAt } from "../src/core/project.ts";
import { beginMeshTransformSession, beginTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import { meshEdges, withSelectionElements, type MeshElementSelection } from "../src/core/mesh-edit.ts";
import { objMatrix } from "../src/core/obj-transform.ts";
import { analyzeRoutes } from "../src/features/analysis/route-analysis.ts";
import type { Project } from "../src/core/types.ts";

// Test-only conditioning is intentionally explicit; it is not part of the app.
function diagnostic(text: string) {
  return text.split("\n").filter(l => !/^\s*(mtllib|usemtl)\b/.test(l)).flatMap(line => {
    if (/^\s*s\s/.test(line)) return ["s off"];
    const a = line.trim().split(/\s+/);
    return a[0] === "f" && a.length === 5 ? [`f ${a[1]} ${a[2]} ${a[3]}`, `f ${a[1]} ${a[3]} ${a[4]}`] : [line];
  }).join("\n");
}
for (const name of ["A", "H"]) {
  const raw = readFileSync(new URL(`./fixtures/obj-release/kaykit/building_${name}.obj`, import.meta.url), "utf8");
  test(`release: authored KayKit ${name} rejects unsupported raw metadata rather than losing it silently`, () => {
    const original = exampleProject(), before = serializeProject(original);
    assert.throws(() => prepareObjImport(original, raw, `building_${name}.obj`), /mtllib/);
    const noMaterials = raw.split("\n").filter(l => !/^\s*(mtllib|usemtl)\b/.test(l)).join("\n");
    assert.throws(() => prepareObjImport(original, noMaterials, `building_${name}.obj`), /平滑组/);
    assert.throws(() => prepareObjImport(original, noMaterials.replace(/^s .+$/gm, "s off"), `building_${name}.obj`), /共面/);
    assert.equal(serializeProject(original), before);
  });
  test(`release: explicitly conditioned KayKit ${name} survives transforms, element groups, history and baked round-trip`, () => {
    const base = exampleProject(), analysis = analyzeRoutes(base), poses = base.drones.map(d => poseAt(base, d, .37));
    const imported = prepareObjImport(base, diagnostic(raw), `building_${name}.obj`), model = imported.model;
    let history = { past: [] as Project[], present: imported.project, future: [] as Project[] };
    const transform = beginTransformSession(history.present, { type: "model", id: model.id }, { target: "position", snap: 0, lockHeight: false })!;
    history = commitTransformHistory(history, updateTransformSession(transform, { position: [100, 20, 20], rotationXYZ: [20, 35, -40], scale: [.5, 1.5, 2] }));
    const r = history.present.objResources![0], scope = { modelId: model.id, meshId: r.meshes[0].id };
    const selections: MeshElementSelection[][] = [
      r.vertices.slice(0, 3).map(v => ({ ...scope, vertexId: v.id })),
      meshEdges(r, scope.meshId).slice(0, 3).map(edge => ({ ...scope, kind: "edge", edgeIds: edge.ids })),
      [0, 1].map(triangle => ({ ...scope, kind: "face", triangle })),
    ];
    for (const elements of selections) {
      const before = history.present, selection = withSelectionElements(elements[0], elements);
      const session = updateTransformSession(beginMeshTransformSession(before, selection)!, { elementDelta: [0, 0, .00001] });
      assert.equal(commitTransformHistory(history, null), history);
      history = commitTransformHistory(history, session);
      assert.equal(history.past.at(-1), before); assert.deepEqual(history.present.objResources![0].meshes[0].triangles, r.meshes[0].triangles);
      assert.deepEqual(history.present.objResources![0].meshes[0].uvs, r.meshes[0].uvs);
    }
    const final = history.present, encoded = serializeProject(final), restored = parseProject(encoded);
    // JSON canonicalizes signed zero; require exact serialized data and preserve
    // geometric equivalence rather than treating -0 as a lost normal direction.
    assert.equal(serializeProject(restored), encoded); assert.deepEqual(analyzeRoutes(final), analysis);
    assert.deepEqual(final.drones.map(d => poseAt(final, d, .37)), poses);
    const output = exportSelectedObj(final, { type: "model", id: model.id });
    const round = prepareObjImport(exampleProject(), output.text, output.name).project;
    const edited = final.models.find(m => m.id === model.id)!;
    if (edited.kind !== "obj") throw new Error("fixture");
    final.objResources![0].vertices.forEach((v, i) => {
      const expected = new Vector3(...v.position).applyMatrix4(objMatrix(edited));
      assert.ok(expected.distanceTo(new Vector3(...round.objResources![0].vertices[i].position)) < 1e-9);
    });
    assert.deepEqual(round.objResources![0].meshes.map(m => m.triangles), final.objResources![0].meshes.map(m => m.triangles));
    assert.deepEqual(final.drones, base.drones); assert.deepEqual(final.viewpoints, base.viewpoints);
  });
}
