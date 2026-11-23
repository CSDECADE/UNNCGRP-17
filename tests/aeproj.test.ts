import assert from "node:assert/strict";
import { test } from "node:test";
import { packSession, unpackSession } from "../src/core/aeproj/package.ts";
import { readZip, writeZip } from "../src/core/aeproj/zip.ts";
import { HISTORY_LIMIT, pushHistory, startHistory, type Session } from "../src/core/history.ts";
import { exampleProject, validateProject } from "../src/core/project.ts";
import type { Project } from "../src/core/types.ts";

const generator = { name: "test", version: "0" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const decode = (bytes: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(bytes));
const LIMITS = { maxEntries: 1e5, maxEntryBytes: 1e9, maxTotalBytes: 1e10 };

// An OBJ resource in the shape used by the OBJ editor (project version 2).
function cube(id = "obj-1", lift = 0) {
  const vertices = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ].map(([x, y, z], i) => ({ id: `v${i}`, position: [x, y + lift, z] }));
  const triangles = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 2, 6, 3, 6, 7];
  return { id, name: "cube", format: "obj", vertices, meshes: [{ id: "m1", name: "cube", triangles }] };
}
// Typed loosely so this file compiles before and after OBJ support lands in Project.
function withObj(base: Project, resources: unknown[]): Project {
  const models = [...base.models, ...resources.map((r, i) => ({
    id: `obj-model-${i}`, kind: "obj", name: "cube", resourceId: (r as { id: string }).id,
    position: [0, 0, 0], rotation: 0, size: [1, 1, 1], color: "#888888", visible: true, locked: false,
  }))];
  return { ...base, version: 2, models, objResources: resources } as unknown as Project;
}
function session(projects: Project[]): Session {
  let history = startHistory(projects[0], "打开项目", 0);
  projects.slice(1).forEach((p, i) => (history = pushHistory(history, p, `步骤 ${i + 1}`, i + 1)));
  return { history, checkpoints: [{ id: "c1", name: "检查点", createdAt: 5, project: projects[0] }] };
}
async function files(bytes: Uint8Array) {
  return readZip(bytes, LIMITS);
}
const resourcePaths = (f: Map<string, Uint8Array>) => [...f.keys()].filter((p) => p.startsWith("resources/"));

const objSupported = (() => {
  try {
    validateProject(withObj(exampleProject(), [cube()]));
    return true;
  } catch {
    return false;
  }
})();

test("background images round-trip and are stored once", async () => {
  const base = { ...exampleProject(), background: { mode: "image" as const, color: "#ffffff", grid: true, image: { name: "bg.png", dataUrl: PNG, width: 1, height: 1 } } };
  let p = validateProject(base);
  const projects = [p];
  for (let i = 0; i < 60; i++) projects.push((p = { ...p, name: `场景 ${i}` }));
  const s = session(projects);
  const bytes = await packSession(s, { generator, now: new Date(0) });
  const f = await files(bytes);
  assert.equal([...f.keys()].filter((k) => k.startsWith("assets/")).length, 1);
  assert.equal(decode(f.get("manifest.json")).formatVersion, 1);
  const { session: back } = await unpackSession(bytes);
  assert.equal(back.history.past.length, HISTORY_LIMIT);
  assert.deepEqual(back.history.present, s.history.present);
  assert.deepEqual(back.checkpoints, s.checkpoints);
});

test("an OBJ resource shared by every state is stored once, outside the scene JSON", async () => {
  const resource = cube();
  let p = withObj(exampleProject(), [resource]);
  const projects = [p];
  for (let i = 0; i < 60; i++) projects.push((p = { ...p, name: `场景 ${i}` }));
  const f = await files(await packSession(session(projects), { generator, now: new Date(0) }));
  assert.equal(resourcePaths(f).length, 1);
  assert.deepEqual(decode(f.get(resourcePaths(f)[0])), resource);
  const history = decode(f.get("history.json"));
  assert.deepEqual(history.past[0].project.objResources, [{ resource: resourcePaths(f)[0] }]);
  assert.ok(!new TextDecoder().decode(f.get("history.json")).includes('"vertices"'));
  const manifest = decode(f.get("manifest.json"));
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.projectVersion, 2);
});

test("an edited OBJ resource gets its own file; unchanged ones stay shared", async () => {
  const a = cube("a"), b = cube("b");
  const p0 = withObj(exampleProject(), [a, b]);
  const p1 = withObj(exampleProject(), [cube("a", 0.5), b]);
  const f = await files(await packSession(session([p0, p1, p1]), { generator, now: new Date(0) }));
  assert.equal(resourcePaths(f).length, 3);
});

test("packages without OBJ resources stay at format version 1", async () => {
  const f = await files(await packSession(session([exampleProject()]), { generator, now: new Date(0) }));
  assert.equal(resourcePaths(f).length, 0);
  assert.equal(decode(f.get("manifest.json")).formatVersion, 1);
});

// Rewrites one file of a package, keeping the manifest consistent, to build malformed inputs.
async function rewrite(bytes: Uint8Array, edit: (f: Map<string, Uint8Array>) => void) {
  const f = await files(bytes);
  edit(f);
  const manifest = decode(f.get("manifest.json"));
  manifest.files = {};
  for (const [path, data] of f) {
    if (path === "mimetype" || path === "manifest.json") continue;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>));
    manifest.files[path] = { sha256: [...digest].map((x) => x.toString(16).padStart(2, "0")).join(""), bytes: data.byteLength };
  }
  f.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));
  return writeZip([...f].map(([name, data]) => ({ name, data })), { store: () => true, date: new Date(0) });
}

test("a resource whose name does not match its content is rejected", async () => {
  const bytes = await packSession(session([withObj(exampleProject(), [cube()])]), { generator, now: new Date(0) });
  const bad = await rewrite(bytes, (f) => {
    const path = resourcePaths(f)[0];
    f.set(path, new TextEncoder().encode(JSON.stringify(cube("other"))));
  });
  await assert.rejects(unpackSession(bad), /资源/);
});

test("a missing resource file is rejected", async () => {
  const bytes = await packSession(session([withObj(exampleProject(), [cube()])]), { generator, now: new Date(0) });
  const bad = await rewrite(bytes, (f) => f.delete(resourcePaths(f)[0]));
  await assert.rejects(unpackSession(bad), /缺少/);
});

test("format versions newer than 2 ask the user to update", async () => {
  const bytes = await packSession(session([exampleProject()]), { generator, now: new Date(0) });
  const f = await files(bytes);
  const manifest = decode(f.get("manifest.json"));
  f.set("manifest.json", new TextEncoder().encode(JSON.stringify({ ...manifest, formatVersion: 3 })));
  const bad = await writeZip([...f].map(([name, data]) => ({ name, data })), { store: () => true, date: new Date(0) });
  await assert.rejects(unpackSession(bad), /更新应用/);
});

test("OBJ scenes round-trip and states share one resource object", { skip: !objSupported && "project version 2 (OBJ) not merged yet" }, async () => {
  const p0 = validateProject(withObj(exampleProject(), [cube()]));
  const projects = [p0];
  let p = p0;
  for (let i = 0; i < 110; i++) projects.push((p = { ...p, name: `场景 ${i}` }));
  const s = session(projects);
  const bytes = await packSession(s, { generator, now: new Date(0) });
  const { session: back } = await unpackSession(bytes);
  assert.deepEqual(back.history.present, s.history.present);
  assert.deepEqual(back.history.past, s.history.past.slice(-HISTORY_LIMIT));
  const resources = (x: Project) => (x as unknown as { objResources: unknown[] }).objResources[0];
  assert.equal(resources(back.history.past[0].project), resources(back.history.present.project));
  assert.equal(resources(back.checkpoints[0].project), resources(back.history.present.project));
});
