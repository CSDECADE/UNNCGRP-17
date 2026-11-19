import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyProject, exampleProject, importPlan, MAX_PROJECT_BYTES,
  parseProject, serializeProject, validateProject,
} from "../src/core/project.ts";
import { persistProject, ProjectValidationError, UserInputError } from "../src/core/feedback.ts";
import { beginTransformSession, commitTransformHistory, updateTransformSession } from "../src/core/transform.ts";
import type { Project } from "../src/core/types.ts";

function fixture(): Extract<Project, { version: 2 }> {
  return {
    ...exampleProject(), version: 2,
    objResources: [{
      id: "resource-1", name: "教学楼.obj", format: "obj",
      vertices: [
        { id: "v1", position: [0, 0, 0] },
        { id: "v2", position: [1, 0, 0] },
        { id: "v3", position: [1, 1, 0] },
        { id: "v4", position: [0, 1, 0] },
        // Coincident but topologically distinct: must not be welded to v1.
        { id: "v5", position: [0, 0, 0] },
      ],
      meshes: [
        { id: "mesh-1", name: "Facade", triangles: [0, 1, 2, 0, 2, 3],
          uvs: [0, 0, 1, 0, 1, 1, 0.5, 0, 1, 1, 0, 1],
          normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1] },
        { id: "mesh-2", name: "Separate part", triangles: [4, 1, 3] },
      ],
    }],
  };
}

test("legacy projects remain version 1 and retain built-in models and routes", () => {
  for (const original of [emptyProject(), exampleProject()]) {
    assert.deepEqual(parseProject(JSON.stringify(original)), original);
    assert.deepEqual(parseProject(serializeProject(original)), original);
    assert.equal(Object.hasOwn(validateProject(original), "objResources"), false);
  }
});

test("v2 round trip preserves multiple meshes, logical identities and corner seams", () => {
  const original = fixture();
  const restored = parseProject(serializeProject(original));
  assert.deepEqual(restored, original);
  assert.equal(restored.version, 2);
  if (restored.version !== 2) throw new Error("Expected v2");
  assert.notStrictEqual(restored.objResources[0].vertices, original.objResources[0].vertices);
  restored.objResources[0].vertices[0].position[0] = 9;
  assert.equal(original.objResources[0].vertices[0].position[0], 0);
  assert.equal(restored.objResources[0].vertices[4].position[0], 0);
  assert.equal(restored.objResources[0].vertices[4].id, "v5");
});

test("version changes are explicit and unsupported extensions fail instead of losing data", () => {
  const project = fixture();
  const bad = [
    { ...project, version: 1 },
    { ...project, version: 3 },
    { ...project, objResources: undefined },
    { ...project, objResources: null },
    { ...project, objInstances: [] },
  ];
  for (const value of bad) assert.throws(() => validateProject(value), ProjectValidationError);
  assert.deepEqual(parseProject(serializeProject({ ...emptyProject(), version: 2, objResources: [] })),
    { ...emptyProject(), version: 2, objResources: [] });
});

test("invalid resource data and unsupported fields fail without mutating the input", () => {
  const changes: Array<(p: ReturnType<typeof fixture>) => void> = [
    p => { p.objResources.push(structuredClone(p.objResources[0])); },
    p => { p.objResources[0].vertices[1].id = "v1"; },
    p => { p.objResources[0].meshes[1].id = "mesh-1"; },
    p => { p.objResources[0].vertices[0].position[0] = NaN; },
    p => { p.objResources[0].vertices[0].position[0] = Infinity; },
    p => { p.objResources[0].vertices[0].position[0] = 10001; },
    p => { p.objResources[0].meshes[0].triangles[0] = 5; },
    p => { p.objResources[0].meshes[0].triangles[0] = -1; },
    p => { p.objResources[0].meshes[0].triangles[0] = 0.5; },
    p => { p.objResources[0].meshes[0].triangles.pop(); },
    p => { p.objResources[0].meshes[0].uvs!.pop(); },
    p => { p.objResources[0].meshes[0].normals![0] = Infinity; },
    p => { p.objResources[0].meshes[0].normals = []; },
    p => { p.objResources[0].vertices = []; },
    p => { p.objResources[0].meshes = []; },
    p => { delete p.objResources[0].vertices[0]; },
    p => { Object.assign(p.objResources[0], { format: "gltf" }); },
    p => { Object.assign(p.objResources[0], { materials: ["unsupported"] }); },
    p => { Object.assign(p.objResources[0].vertices[0], { selected: true }); },
    p => { Object.assign(p.objResources[0].meshes[0], { polygons: [[0, 1, 2, 3]] }); },
  ];
  for (const change of changes) {
    const project = fixture();
    change(project);
    const before = structuredClone(project);
    assert.throws(() => validateProject(project), ProjectValidationError);
    assert.throws(() => serializeProject(project), ProjectValidationError);
    assert.deepEqual(project, before);
  }
});

test("object transform history and candidate plans preserve resources without moving UAV paths", () => {
  const project = fixture();
  const session = beginTransformSession(project, { type: "model", id: project.models[0].id },
    { target: "position", snap: 0, lockHeight: false });
  assert.ok(session);
  const edited = updateTransformSession(session, { position: [10, 0, 0] });
  const history = commitTransformHistory({ past: [] as Project[], present: project, future: [] as Project[] }, edited);
  assert.equal(history.past[0], project);
  assert.deepEqual(history.present.viewpoints, project.viewpoints);
  assert.deepEqual(history.present.drones, project.drones);
  assert.equal(history.present.objResources, project.objResources);
  assert.deepEqual(parseProject(serializeProject(history.present)).objResources, project.objResources);
  const candidate = importPlan(JSON.stringify({ version: 1, viewpoints: project.viewpoints }), project);
  assert.deepEqual(candidate.objResources, project.objResources);
  assert.equal(candidate.version, 2);
});

test("autosave writes restorable geometry and reports quota failures without replacing the previous save", () => {
  let saved = serializeProject(emptyProject());
  const storage = { setItem: (_key: string, text: string) => { saved = text; } };
  const project = fixture();
  assert.equal(persistProject(storage, "project", project), "saved");
  assert.deepEqual(parseProject(saved), project);
  const before = saved;
  const full = { setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } };
  assert.equal(persistProject(full, "project", fixture()), "error");
  assert.equal(saved, before);
  const invalid = fixture();
  invalid.objResources[0].meshes[0].triangles[0] = 999;
  let calls = 0;
  assert.equal(persistProject({ setItem: () => { calls++; } }, "project", invalid), "error");
  assert.equal(calls, 0);
});

function sizedProject(extraBytes: number): string {
  const project = { ...emptyProject(), version: 2, objResources: [] };
  const json = JSON.stringify(project);
  // JSON whitespace is legal and counts against the on-disk budget.
  return json + " ".repeat(MAX_PROJECT_BYTES - Buffer.byteLength(json) + extraBytes);
}

test("file capacity is measured in UTF-8 bytes and oversized text fails explicitly", () => {
  assert.equal(parseProject(sizedProject(0)).version, 2);
  assert.throws(() => parseProject(sizedProject(1)), UserInputError);
  const base = JSON.stringify({ ...emptyProject(), version: 2, objResources: [] });
  const unicode = base + " ".repeat(MAX_PROJECT_BYTES - Buffer.byteLength(base) - 2) + "中";
  assert.ok(unicode.length < MAX_PROJECT_BYTES);
  assert.throws(() => parseProject(unicode), UserInputError);
});

test("oversized geometry is rejected before autosave writes or replaces data", () => {
  const project = fixture();
  project.objResources[0].vertices = Array.from({ length: 100000 }, (_, i) =>
    ({ id: `vertex-${i}`, position: [i / 100, 1.23456789, 2.3456789] }));
  assert.ok(Buffer.byteLength(JSON.stringify(project)) > MAX_PROJECT_BYTES);
  assert.throws(() => validateProject(project), UserInputError);
  assert.throws(() => serializeProject(project), UserInputError);
  let calls = 0;
  assert.equal(persistProject({ setItem: () => { calls++; } }, "project", project), "error");
  assert.equal(calls, 0);
});

test("cyclic project data fails explicitly", () => {
  const project = fixture();
  Object.assign(project, { cycle: project });
  assert.throws(() => serializeProject(project), ProjectValidationError);
});

test("the existing Electron JSON file channel preserves v2 geometry and rejects oversized writes atomically", async () => {
  const require = createRequire(import.meta.url);
  const { readTextFile, writeTextFile, validateText } = require("../desktop/files.cjs");
  const directory = await mkdtemp(join(tmpdir(), "aero-obj-persistence-"));
  const path = join(directory, "project.json");
  try {
    const project = fixture();
    const text = serializeProject(project);
    await writeTextFile(path, text);
    assert.deepEqual(parseProject(await readTextFile(path)), project);
    assert.equal(Buffer.byteLength(validateText(sizedProject(0)), "utf8"), MAX_PROJECT_BYTES);
    assert.throws(() => validateText(sizedProject(1)), { code: "TOO_LARGE" });
    await assert.rejects(writeTextFile(path, sizedProject(1)), { code: "TOO_LARGE" });
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
