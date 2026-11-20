import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { writeHeapSnapshot } from 'node:v8';
import { performance } from 'node:perf_hooks';
import { auditGrid, auditSelection, distribution } from './obj-audit-fixtures.mjs';
import { meshEdges, meshVertexIndices, resolveElement, withSelectionElements } from '../src/core/mesh-edit.ts';
import { beginMeshTransformSession, updateTransformSession, commitTransformHistory } from '../src/core/transform.ts';
import { emptyProject, removeObject } from '../src/core/project.ts';
import { prepareObjImport } from '../src/features/obj-import/obj.ts';
import { exportSelectedObj } from '../src/features/obj-export/obj.ts';
import { createObjGeometry } from '../src/features/obj-import/geometry.ts';

const args = process.argv.slice(2), value = key => args[args.indexOf(key) + 1];
const undo = h => h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1), future: [h.present, ...h.future] } : h;
const redo = h => h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
const append = (h, p) => ({ past: [...h.past, h.present].slice(-60), present: p, future: [] });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function collect() { for (let i = 0; i < 3; i++) { await tick(); global.gc(); } }
function census(h) {
  const projects = new Set([...h.past, h.present, ...h.future]), resources = new Set(), vertices = new Set(), vertexArrays = new Set(), meshes = new Set(), triangles = new Set(), uvs = new Set(), normals = new Set();
  for (const p of projects) for (const r of p.objResources ?? []) {
    resources.add(r); vertexArrays.add(r.vertices); r.vertices.forEach(v => vertices.add(v));
    for (const m of r.meshes) { meshes.add(m); triangles.add(m.triangles); if (m.uvs) uvs.add(m.uvs); if (m.normals) normals.add(m.normals); }
  }
  return { projects: projects.size, resources: resources.size, vertexArrays: vertexArrays.size, vertexObjects: vertices.size, meshes: meshes.size,
    triangleArrays: triangles.size, uvArrays: uvs.size, normalArrays: normals.size, normalNumberSlots: [...normals].reduce((n, a) => n + a.length, 0) };
}
function imported(config) {
  const grid = auditGrid(config.n, { attributes: config.attributes });
  const output = exportSelectedObj(grid.project, { type: 'model', id: grid.model.id });
  const { project } = prepareObjImport(emptyProject(), output.text, 'history-memory.obj');
  if (config.shared) project.models.push({ ...project.models[0], id: 'other-instance' });
  return project;
}
async function worker(config) {
  if (!global.gc) throw new Error('Worker requires --expose-gc');
  let history = { past: [], present: emptyProject(), future: [] };
  const points = [], timings = { edit: [], undo: [], redo: [] };
  async function point(name) { await collect(); const memory = process.memoryUsage(); points.push({ name, ...memory, graph: census(history) }); }
  await point('empty'); history.present = imported(config); await point('imported');
  let geometry = history.present.objResources.flatMap(r => r.meshes.map(m => createObjGeometry(r, m)));
  await point('CPUBufferGeometryAllocated'); geometry.forEach(g => g.dispose()); geometry = null;
  await point('CPUBufferGeometryReleased');
  const f = { project: history.present, model: history.present.models[0], resource: history.present.objResources[0] };
  const selected = auditSelection(f, config.kind, config.count ?? 100, meshEdges, withSelectionElements);
  const heldEdges = meshEdges(f.resource, selected.meshId); meshVertexIndices(f.resource, selected.meshId);
  for (const kind of ['vertex', 'edge', 'face']) resolveElement(f.project, auditSelection(f, kind, 100, meshEdges, withSelectionElements));
  const original = { project: new WeakRef(f.project), resource: new WeakRef(f.resource), vertices: new WeakRef(f.resource.vertices), normals: f.resource.meshes[0].normals && new WeakRef(f.resource.meshes[0].normals) };
  // Fixture helpers must not themselves keep the imported project alive.
  f.project = f.model = f.resource = null;
  await point('topologyWarmed');
  function edit() {
    const start = performance.now(), session = beginMeshTransformSession(history.present, selected);
    const delta = [0, 0, 0]; delta[config.axis] = .0001;
    history = commitTransformHistory(history, updateTransformSession(session, { elementDelta: delta }));
    timings.edit.push(performance.now() - start);
  }
  function change(back) { const start = performance.now(); history = back ? undo(history) : redo(history); timings[back ? 'undo' : 'redo'].push(performance.now() - start); }
  edit();
  const firstNormalDifference = (() => {
    const before = history.past[0].objResources[0].meshes[0].normals;
    if (!before) return null;
    const m = history.present.models[0], r = history.present.objResources.find(r => r.id === m.resourceId), after = r.meshes[0].normals;
    return before.reduce((n, v, i) => n + !Object.is(v, after[i]), 0);
  })();
  for (let i = 1; i < 60; i++) edit(); await point('history60'); assert.equal(history.past.length, 60);
  if (config.snapshot) { globalThis.__objHistorySnapshot = history; writeHeapSnapshot(config.snapshot); delete globalThis.__objHistorySnapshot; }
  for (let cycle = 0; cycle < 3; cycle++) { for (let i = 0; i < 30; i++) change(true); for (let i = 0; i < 30; i++) change(false); }
  await point('undoRedo3Cycles');
  for (let i = 0; i < 20; i++) change(true);
  const discarded = history.future.map(p => new WeakRef(p.objResources.find(r => r.id === p.models[0].resourceId)));
  edit(); await point('newBranchAfterUndo20'); assert.equal(history.future.length, 0);
  const discardedCollected = discarded.filter(ref => !ref.deref()).length; assert.equal(discardedCollected, discarded.length);
  for (let i = 0; i < 75; i++) edit(); await point('capacityEviction75'); assert.equal(history.past.length, 60);
  assert.equal(original.project.deref(), undefined);
  // A shared instance legitimately retains its original resource until removal.
  if (!config.shared) { assert.equal(original.resource.deref(), undefined); assert.equal(original.vertices.deref(), undefined); }
  const edited = new WeakRef(history.present.objResources.find(r => r.id === history.present.models[0].resourceId));
  history = append(history, removeObject(history.present, 'model', selected.modelId)); await point('modelDeletedUndoable');
  if (config.shared) history = append(history, removeObject(history.present, 'model', 'other-instance'));
  assert.equal(history.present.objResources.length, 0);
  assert.ok(edited.deref(), 'Deletion is undoable: old geometry must remain reachable through history');
  // Project replacement is also undoable in the real editor; do not call it a clear.
  history = append(history, emptyProject()); await point('projectReplacedUndoable');
  for (let i = 0; i < 61; i++) history = append(history, { ...history.present, name: `empty-${i}` });
  await point('allGeometryHistoryEvicted');
  const retirement = { originalResource: !original.resource.deref(), editedResource: !edited.deref(), normalArray: !original.normals || !original.normals.deref(), heldEdges: heldEdges.length };
  assert.ok(retirement.originalResource && retirement.editedResource && retirement.normalArray);
  return { config, points, firstNormalDifference, discardedCollected, discardedCount: discarded.length, retirement,
    cpu: Object.fromEntries(Object.entries(timings).map(([k, values]) => [k, distribution(values)])) };
}

if (args.includes('--worker')) {
  const result = await worker(JSON.parse(value('--worker'))); console.log(JSON.stringify(result));
} else {
  const configs = [];
  for (const n of [25, 70, 150]) for (const kind of (n === 150 ? ['vertex', 'edge', 'face'] : ['edge']))
    for (const [attributes, axis] of [[false, 2], [true, 0], [true, 2]]) configs.push({ n, kind, attributes, axis });
  configs.push({ n: 150, kind: 'edge', attributes: true, axis: 0, shared: true });
  configs.push({ n: 150, kind: 'edge', attributes: true, axis: 2, shared: true });
  for (let repeat = 1; repeat <= 2; repeat++) for (const axis of [0, 2]) configs.push({ n: 150, kind: 'edge', attributes: true, axis, repeat });
  const report = { conditions: { node: process.version, revision: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
    note: 'Fresh Node process per case; controlled GC between memory points, never inside CPU samples. heapUsed/external/arrayBuffers/rss are separate byte measurements. No GPU is created in this Node benchmark. History reference moves mirror editor.tsx. All geometry checks use production import/transform/removal code.' }, cases: [] };
  const chosen = args.includes('--probe') ? configs.filter(c => c.n === 150 && c.kind === 'edge' && c.attributes && c.axis === 0 && !c.shared && !c.repeat) : configs;
  for (const config of chosen) {
    if (args.includes('--snapshot') && config.n === 150 && config.kind === 'edge' && config.attributes && config.axis === 0 && !config.shared && !config.repeat) config.snapshot = value('--snapshot');
    const run = spawnSync(process.execPath, ['--expose-gc', '--experimental-strip-types', import.meta.filename, '--worker', JSON.stringify(config)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (run.status !== 0) { process.stderr.write(run.stderr); process.stderr.write(run.stdout); process.exit(run.status ?? 1); }
    report.cases.push(JSON.parse(run.stdout)); console.error('Memory case', JSON.stringify(config));
    if (args.includes('--out')) writeFileSync(value('--out'), JSON.stringify(report, null, 2));
  }
  if (!args.includes('--out')) console.log(JSON.stringify(report, null, 2));
}
