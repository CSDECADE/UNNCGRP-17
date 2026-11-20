import assert from "node:assert/strict";
import { test } from "node:test";
import { Matrix3, Vector3 } from "three";
import { exportSelectedObj } from "../src/features/obj-export/obj.ts";
import { parseObj, prepareObjImport } from "../src/features/obj-import/obj.ts";
import { exampleProject, emptyProject, serializeProject } from "../src/core/project.ts";
import { MAX_OBJ_FILE_BYTES, objFileName } from "../src/core/obj-file.ts";
import { objChangeAroundCenter, objMatrix } from "../src/core/obj-transform.ts";
import { resourceBounds } from "../src/core/model-bounds.ts";
import type { ObjModel, Vec3 } from "../src/core/types.ts";

const source = `v 10 0 2
v 12 0 2
v 12 2 2
v 10 2 2
v 10 0 2
v 50 50 50
vt 0 0
vt 1 0
vt 1 1
vt .5 0
vn 1 1 1
vn -1 0 1
o Front
f 1/1/1 2/2/1 3/3/1
f 1/4/2 3/3/1 4/1/2
o Back
f 5 4 3`;
function fixture() {
  const prepared = prepareObjImport(exampleProject(), source, "seams.obj");
  return { project: prepared.project, model: prepared.model as ObjModel };
}
function close(a: number[], b: number[], epsilon = 1e-9) {
  assert.equal(a.length, b.length);
  a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) <= epsilon * Math.max(1, Math.abs(b[i])), `${a} != ${b}`));
}
function roundTrip(model: ObjModel) {
  const { project } = fixture(); project.models = [model];
  project.objResources![0].id = model.resourceId;
  const original = structuredClone(project), resource = project.objResources![0];
  const file = exportSelectedObj(project, { type: "model", id: model.id });
  const restored = prepareObjImport(emptyProject(), file.text, file.name);
  const result = restored.project.objResources![0], matrix = objMatrix(model);
  assert.deepEqual(project, original);
  assert.equal(result.vertices.length, resource.vertices.length);
  assert.equal(result.meshes.length, resource.meshes.length);
  resource.vertices.forEach((v, i) => close(result.vertices[i].position, new Vector3(...v.position).applyMatrix4(matrix).toArray()));
  resource.meshes.forEach((mesh, i) => {
    const actual = result.meshes[i];
    assert.equal(actual.name, mesh.name);
    assert.deepEqual(actual.triangles, mesh.triangles); // winding and independent coincident indices
    assert.deepEqual(actual.uvs, mesh.uvs);
    if (mesh.normals) for (let j = 0; j < mesh.normals.length; j += 3) {
      const n = new Vector3(mesh.normals[j], mesh.normals[j + 1], mesh.normals[j + 2]);
      close(actual.normals!.slice(j, j + 3), n.applyNormalMatrix(new Matrix3().getNormalMatrix(matrix)).toArray());
    } else assert.equal(actual.normals, undefined);
  });
  const restoredModel = restored.model as ObjModel;
  assert.deepEqual(restoredModel.position, [0, 0, 0]);
  assert.equal(restoredModel.rotation, 0);
  assert.equal(restoredModel.scale, undefined);
  assert.equal(restoredModel.rotationXYZ, undefined);
  assert.equal(file.vertices, 6); assert.equal(file.triangles, 3);
  assert.ok(!/^(usemtl|mtllib|s|l|p) /m.test(file.text));
  return file;
}

test("unchanged OBJ preserves logical connectivity, independent coincident/unused vertices, groups and corner seams", () => {
  const { model } = fixture(); roundTrip(model);
});
test("translation, full XYZ rotation and uniform/non-uniform scale bake exactly once at identity re-import", () => {
  const { model } = fixture();
  for (const scale of [[1, 1, 1], [2, 2, 2], [.5, 3, 1.25]] as Vec3[])
    roundTrip({ ...model, position: [7, -3, 9], rotation: 35, rotationXYZ: [23, 35, -41], scale });
});
test("normal direction under non-uniform scale uses inverse transpose rather than the position matrix", () => {
  const { project, model } = prepareObjImport(emptyProject(), "v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 1 1 0\nf 1//1 2//1 3//1", "normal.obj");
  (project.models[0] as ObjModel).scale = [2, 1, 1];
  const file = exportSelectedObj(project, { type: "model", id: model.id });
  close(parseObj(file.text, file.name).meshes[0].normals!.slice(0, 3), [1 / Math.sqrt(5), 2 / Math.sqrt(5), 0]);
});
test("off-origin centre-pivot compensation is included once without recentering resource vertices", () => {
  const { project, model } = fixture(), center = resourceBounds(project.objResources![0]).center;
  roundTrip({ ...model, ...objChangeAroundCenter(model, center, { rotationXYZ: [30, -20, 11], scale: [2, .5, 3] }), rotation: -20 });
});
test("only the selected instance is exported and repeat exports leave scene, resources and project JSON unchanged", () => {
  const { project, model } = fixture();
  project.models.push({ ...model, id: "other", position: [100, 200, 300] });
  const before = serializeProject(project), selection = { type: "model" as const, id: model.id };
  const a = exportSelectedObj(project, selection), b = exportSelectedObj(project, selection);
  assert.deepEqual(a, b); assert.equal(serializeProject(project), before);
  assert.equal(parseObj(a.text, a.name).vertices.length, 6);
  for (const unsupported of [null, { type: "drone" as const, id: project.drones[0].id },
    { type: "model" as const, id: project.models.find(m => m.kind !== "obj")!.id }])
    assert.throws(() => exportSelectedObj(project, unsupported), /请选择/);
});
test("triangulated quads retain four vertices and every supported face-attribute form round-trips", () => {
  for (const attributes of ["", "vt 0 0", "vn 0 0 1", "vt 0 0\nvn 0 0 1"]) {
    const suffix = attributes.includes("vt") ? (attributes.includes("vn") ? "/1/1" : "/1") : attributes ? "//1" : "";
    const { project, model } = prepareObjImport(emptyProject(), `v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\n${attributes}\nf ${[1, 2, 3, 4].map(n => n + suffix).join(" ")}`, "quad.obj");
    const file = exportSelectedObj(project, { type: "model", id: model.id });
    const r = parseObj(file.text, file.name);
    assert.equal(r.vertices.length, 4); assert.deepEqual(r.meshes[0].triangles, [0, 1, 2, 0, 2, 3]);
    assert.deepEqual(r.meshes[0].uvs, project.objResources![0].meshes[0].uvs);
    assert.deepEqual(r.meshes[0].normals, project.objResources![0].meshes[0].normals);
  }
});
test("long importer object/group names and repeated submesh names remain separate", () => {
  const { project, model } = fixture(), resource = project.objResources![0];
  resource.meshes[0].name = `${"a".repeat(70)}/${"b".repeat(70)}`;
  resource.meshes.push({ ...structuredClone(resource.meshes[1]), id: "duplicate" });
  const file = exportSelectedObj(project, { type: "model", id: model.id });
  assert.deepEqual(parseObj(file.text, file.name).meshes.map(m => m.name), resource.meshes.map(m => m.name));
});
test("unrepresentable or invalid geometry fails before writing and leaves source unchanged", () => {
  const changes = [
    (f: ReturnType<typeof fixture>) => { f.project.models.find(m => m.id === f.model.id)!.position = [9999, 0, 0]; },
    (f: ReturnType<typeof fixture>) => { f.project.objResources![0].vertices = []; },
    (f: ReturnType<typeof fixture>) => { f.project.objResources![0].meshes[0].normals![0] = NaN; },
    (f: ReturnType<typeof fixture>) => { f.project.objResources![0].meshes[0].normals!.fill(0); },
    (f: ReturnType<typeof fixture>) => { f.project.objResources![0].meshes[0].triangles[0] = 999; },
    (f: ReturnType<typeof fixture>) => { f.project.objResources![0].meshes[0].triangles[0] = 1; },
    (f: ReturnType<typeof fixture>) => { f.project.objResources![0].meshes[0].name = "bad#name"; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f); const before = structuredClone(f.project);
    assert.throws(() => exportSelectedObj(f.project, { type: "model", id: f.model.id }));
    assert.deepEqual(f.project, before);
  }
});
test("OBJ text has an independent 16 MB UTF-8 budget while restored project JSON retains 5 MB", () => {
  const padded = `#${"x".repeat(5_000_000)}\n${source}`;
  assert.ok(prepareObjImport(emptyProject(), padded, "large-comments.obj").project.objResources!.length);
  assert.throws(() => parseObj("#".repeat(MAX_OBJ_FILE_BYTES + 1), "large.obj"), /16 MB/);
  assert.throws(() => parseObj(`v ${"1 ".repeat(3000)}`, "line.obj"), /4,096/);
});
test("export filenames are safe .obj basenames within the importer limit", () => {
  assert.equal(objFileName("..\\bad/model.OBJ"), "-bad-model.obj");
  assert.equal(objFileName("..."), "model.obj");
  assert.equal(objFileName("名字😀".repeat(100)).length <= 160, true);
  assert.equal(objFileName("mesh.obj"), "mesh.obj");
});

test("round-trip preflight rejects geometry whose normalized corner attributes exceed the restored JSON budget", () => {
  const { project, model } = prepareObjImport(emptyProject(), "v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 1 1 1\nf 1//1 2//1 3//1", "dense.obj");
  const mesh = project.objResources![0].meshes[0];
  mesh.triangles = Array.from({ length: 120_000 }, (_, i) => i % 3);
  mesh.normals = Array(360_000).fill(1);
  assert.ok(serializeProject(project).length < 5_000_000);
  const before = structuredClone(project);
  assert.throws(() => exportSelectedObj(project, { type: "model", id: model.id }), /无法按当前规则回导/);
  assert.deepEqual(project, before);
});
