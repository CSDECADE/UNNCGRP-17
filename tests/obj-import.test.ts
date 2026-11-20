import assert from "node:assert/strict";
import { test } from "node:test";
import { parseObj, prepareObjImport } from "../src/features/obj-import/obj.ts";
import { createObjGeometry } from "../src/features/obj-import/geometry.ts";
import { modelBounds } from "../src/core/model-bounds.ts";
import { emptyProject, exampleProject, importPlan, MAX_PROJECT_BYTES, parseProject, removeObject, serializeProject, validateProject } from "../src/core/project.ts";
import { UserInputError, ProjectValidationError } from "../src/core/errors.ts";
import { beginTransformSession } from "../src/core/transform.ts";

const vertices = "v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\n";
const triangle = vertices + "f 1 2 3\n";
const quad = vertices + "f 1 2 3 4\n";

test("imports a triangle with stable source IDs and retains unused vertices", () => {
  const r = parseObj(triangle, "triangle.OBJ");
  assert.deepEqual(r.vertices.map(v => v.id), ["v1", "v2", "v3", "v4"]);
  assert.deepEqual(r.meshes[0].triangles, [0, 1, 2]);
});

test("triangulates clockwise and counter-clockwise convex planar quads without changing connectivity", () => {
  assert.deepEqual(parseObj(quad, "quad.obj").meshes[0].triangles, [0, 1, 2, 0, 2, 3]);
  assert.deepEqual(parseObj(vertices + "f 4 3 2 1", "quad.obj").meshes[0].triangles, [3, 2, 1, 3, 1, 0]);
});

test("negative face indices resolve against declarations available at each face", () => {
  const r = parseObj(vertices + "f -4 -3 -2\nv 9 9 9\nf -5 -3 -2", "negative.obj");
  assert.deepEqual(r.meshes[0].triangles, [0, 1, 2, 0, 2, 3]);
});

test("preserves shared vertex references across object/group boundaries and does not weld coincident vertices", () => {
  const r = parseObj(vertices + "v 0 0 0\no A\nf 1 2 3\ng roof\nf 1 3 4\no B\nf 5 2 3", "parts.obj");
  assert.deepEqual(r.meshes.map(m => m.name), ["A", "A/roof", "B"]);
  assert.deepEqual(r.meshes.map(m => m.triangles), [[0, 1, 2], [0, 2, 3], [4, 1, 2]]);
  assert.deepEqual(r.vertices[0].position, r.vertices[4].position);
  assert.notEqual(r.vertices[0].id, r.vertices[4].id);
});

test("preserves per-corner UV and normal seams, including negative attribute indices", () => {
  const attributes = "vt 0 0\nvt 1 0\nvt 1 1\nvt 0.5 0.5\nvn 0 0 1\nvn 0 0 -1\n";
  const r = parseObj(vertices + attributes + "f 1/1/1 2/2/1 3/3/1\nf -4/-1/-1 -2/3/-1 -1/2/-1", "seams.obj");
  assert.deepEqual(r.meshes[0].triangles, [0, 1, 2, 0, 2, 3]);
  assert.deepEqual(r.meshes[0].uvs, [0, 0, 1, 0, 1, 1, .5, .5, 1, 1, 1, 0]);
  assert.deepEqual(r.meshes[0].normals, [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1]);
  const geometry = createObjGeometry(r, r.meshes[0]);
  assert.deepEqual(Array.from(geometry.getAttribute("uv").array), r.meshes[0].uvs);
  assert.deepEqual(Array.from(geometry.getAttribute("normal").array), r.meshes[0].normals);
  geometry.dispose();
  const normalsOnly = parseObj(vertices + "vn 0 0 1\nf 1//1 2//1 3//1", "normals.obj");
  assert.equal(normalsOnly.meshes[0].uvs, undefined);
  assert.equal(normalsOnly.meshes[0].normals!.length, 9);
});

test("supports comments, BOM, CRLF, scientific coordinates and explicit smoothing-off", () => {
  const r = parseObj("\uFEFF# comment\r\nv 0 0 0\r\nv 2e0 0 0 # x\r\nv 2 2 0\r\ns off\r\nf 1 2 3\r\n", "triangle.obj");
  assert.deepEqual(r.vertices[1].position, [2, 0, 0]);
});

test("rejects malformed and unsupported OBJ syntax with actionable errors", () => {
  const bad = [
    "", "v NaN 0 0\nf 1 1 1", "v Infinity 0 0", "v 10001 0 0", "v 0 0 0 1", "v 0 0 0 1 0 0",
    vertices + "f 0 2 3", vertices + "f 1 2 8", vertices + "f -5 -2 -1", vertices + "f 1.0 2 3",
    vertices + "f 1 2 2", vertices + "f 1/ 2/ 3/", vertices + "f 1// 2// 3//",
    vertices + "f 1 2 3 4 1", vertices + "f 1 3 2 4", // self-intersection
    "v 0 0 0\nv 2 0 0\nv .5 .5 0\nv 0 2 0\nf 1 2 3 4", // concave
    "v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 1\nf 1 2 3 4", // non-planar
    "v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3", // collinear
    vertices + "vt 0 0\nf 1/1 2 3", vertices + "vt 0 0\nf 1/1 2/1 3/1\nf 1 3 4",
    vertices + "vt 0 0 0", vertices + "vn 0 0 0", vertices + "vt 1e100 0",
    vertices + "mtllib building.mtl", vertices + "usemtl stone", vertices + "s 1", vertices + "g a b",
    vertices + "l 1 2", vertices + "p 1", vertices + "curv 0 1", vertices + "f 1 2 \\\n3",
    "f 1 2 3\n" + vertices, // forward references
  ];
  for (const text of bad) assert.throws(() => parseObj(text, "bad.obj"), UserInputError, text);
  assert.throws(() => parseObj(triangle, "bad.txt"), UserInputError);
  assert.throws(() => parseObj(triangle, "a".repeat(160) + ".obj"), UserInputError);
  assert.throws(() => parseObj("#".repeat(MAX_PROJECT_BYTES + 1), "large.obj"), UserInputError);
});

test("import is one first-class model with an independent resource and no UAV or input mutation", () => {
  const original = exampleProject(), before = structuredClone(original);
  const result = prepareObjImport(original, vertices + "o A\nf 1 2 3\no B\nf 1 3 4", "building.obj");
  assert.deepEqual(original, before);
  assert.equal(result.project.version, 2);
  assert.equal(result.project.models.length, original.models.length + 1);
  assert.equal(result.project.objResources!.length, 1);
  assert.equal(result.project.objResources![0].meshes.length, 2);
  assert.deepEqual(result.project.drones, original.drones);
  assert.deepEqual(result.project.viewpoints, original.viewpoints);
  assert.equal(result.model.kind, "obj");
  assert.deepEqual(result.model.position, [0, 0, 0]);
  assert.equal(result.model.visible, true);
  assert.equal(result.model.locked, false);
  assert.deepEqual(parseProject(serializeProject(result.project)), result.project);
  assert.deepEqual(parseProject(serializeProject(original)), original);
  const next = prepareObjImport(result.project, triangle, "second.obj");
  assert.notEqual(next.model.id, result.model.id);
  assert.notEqual(next.project.objResources![1].id, result.project.objResources![0].id);
});

test("missing resource references and version 1 OBJ instances fail explicitly", () => {
  const result = prepareObjImport(emptyProject(), triangle, "triangle.obj");
  assert.throws(() => validateProject({ ...result.project, objResources: [] }), ProjectValidationError);
  assert.throws(() => validateProject({ ...emptyProject(), models: [result.model] }), ProjectValidationError);
});

test("focus bounds use referenced local geometry without moving or recentering vertices", () => {
  const result = prepareObjImport(emptyProject(), "v 10 20 -30\nv 14 20 -30\nv 14 26 -30\nv 999 999 999\nf 1 2 3", "offset.obj");
  assert.deepEqual(modelBounds(result.model, result.project), { center: [12, 23, -30], size: [4, 6, 0] });
  assert.deepEqual(result.project.objResources![0].vertices[0].position, [10, 20, -30]);
});

test("render buffers retain corners and bounds and are independently owned by each instance", () => {
  const r = parseObj(quad, "quad.obj"), before = structuredClone(r);
  const a = createObjGeometry(r, r.meshes[0]), b = createObjGeometry(r, r.meshes[0]);
  assert.equal(a.getAttribute("position").count, 6);
  assert.equal(a.getAttribute("normal").count, 6);
  assert.deepEqual(a.boundingBox!.min.toArray(), [0, 0, 0]);
  assert.deepEqual(a.boundingBox!.max.toArray(), [2, 2, 0]);
  assert.ok(Number.isFinite(a.boundingSphere!.radius));
  a.getAttribute("position").setX(0, 42);
  assert.equal(b.getAttribute("position").getX(0), 0);
  assert.deepEqual(r, before);
  let disposed = false;
  a.addEventListener("dispose", () => { disposed = true; });
  a.dispose(); b.dispose();
  assert.equal(disposed, true);
});

test("removal cleans only the last referenced resource, and paths and candidate plans retain OBJ data", () => {
  const { project, model } = prepareObjImport(exampleProject(), triangle, "triangle.obj");
  const duplicate = { ...model, id: "duplicate", visible: false, locked: true };
  const withDuplicate = validateProject({ ...project, models: [...project.models, duplicate] });
  const removed = removeObject(withDuplicate, "model", model.id);
  assert.equal(removed.objResources!.length, 1);
  assert.equal(removed.models.at(-1)!.visible, false);
  assert.equal(removed.models.at(-1)!.locked, true);
  assert.equal(removeObject(removed, "model", duplicate.id).objResources!.length, 0);
  assert.deepEqual(removed.viewpoints, project.viewpoints);
  const candidate = importPlan(JSON.stringify({ version: 1, viewpoints: project.viewpoints }), project);
  assert.deepEqual(candidate.models, project.models);
  assert.deepEqual(candidate.objResources, project.objResources);
  assert.ok(beginTransformSession(project, { type: "model", id: model.id },
    { target: "position", snap: 0, lockHeight: false }));
});

test("the serialized resulting project limit rejects imports even when raw OBJ is small enough", () => {
  const count = 150000;
  const lines = Array.from({ length: count }, (_, i) => `v ${i % 1000} ${Math.floor(i / 1000)} 0`);
  for (let i = 1; i + 1001 <= count; i += 3) lines.push(`f ${i} ${i + 1} ${i + 1000}`);
  const text = lines.join("\n");
  assert.ok(Buffer.byteLength(text) < MAX_PROJECT_BYTES);
  const original = emptyProject();
  assert.throws(() => prepareObjImport(original, text, "large.obj"), /完整项目超过 5 MB/);
  assert.deepEqual(original, emptyProject());
});

test("existing model-count and dimension limits fail with specific import errors", () => {
  const model = exampleProject().models[0];
  const project = { ...emptyProject(), models: Array.from({ length: 500 }, (_, i) => ({ ...model, id: `model${i}` })) };
  assert.throws(() => prepareObjImport(project, triangle, "triangle.obj"), /500 个模型/);
  assert.throws(() => prepareObjImport(emptyProject(), "v -8000 0 0\nv 8000 0 0\nv 8000 1 0\nf 1 2 3", "wide.obj"), /单轴尺寸/);
  assert.equal(project.models.length, 500);
});
