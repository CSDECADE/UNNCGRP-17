// Supplemental cold-query and cache-lifetime observations, outside UI timings.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { auditGrid, auditSelection } from './obj-audit-fixtures.mjs';
import { meshEdges, meshVertexIndices, resolveElement, withSelectionElements } from '../src/core/mesh-edit.ts';
import { beginMeshTransformSession, updateTransformSession } from '../src/core/transform.ts';

if (!global.gc) throw new Error('Run with --expose-gc');
const runs = 15, warmup = 3;
function measure(fn) {
  for (let i = 0; i < warmup; i++) fn();
  const values = [];
  for (let i = 0; i < runs; i++) { const start = performance.now(); fn(); values.push(performance.now() - start); }
  values.sort((a, b) => a - b);
  return { n: runs, p50: +values[7].toFixed(6), p95: +values[14].toFixed(6), max: +values[14].toFixed(6) };
}
const report = { conditions: { node: process.version, runs, warmup,
  note: 'CPU milliseconds. Cold queries use fresh resource objects sharing unchanged fixture inputs, without translation inheritance. GC only outside timed operations. Heap is V8 retained heap, not GPU/RSS.' }, cases: [] };
for (const n of [25, 70, 150]) {
  const f = auditGrid(n), meshId = f.resource.meshes[0].id;
  global.gc(); const before = process.memoryUsage().heapUsed;
  let first = meshEdges(f.resource, meshId);
  const edgeCount = first.length, reusesCollection = first === meshEdges(f.resource, meshId);
  first = null;
  meshVertexIndices(f.resource, meshId);
  for (const kind of ['vertex', 'edge', 'face']) resolveElement(f.project, auditSelection(f, kind, 100, meshEdges, withSelectionElements));
  global.gc(); const additionalHeapMiB = (process.memoryUsage().heapUsed - before) / 2 ** 20;
  const row = { triangles: n * n * 2, edges: edgeCount, reusesCollection,
    topologyHeapMiB: +additionalHeapMiB.toFixed(3),
    coldEdgeQuery: measure(() => meshEdges({ ...f.resource }, meshId)), warmEdgeQuery: measure(() => meshEdges(f.resource, meshId)) };
  const selected = auditSelection(f, 'edge', 100, meshEdges, withSelectionElements);
  const session = beginMeshTransformSession(f.project, selected);
  row.repeatedGesture30Previews = measure(() => {
    let preview = session;
    for (let i = 1; i <= 30; i++) preview = updateTransformSession(preview, { elementDelta: [0, 0, i / 1000] });
    assert.ok(preview.draft !== session.base);
  });
  report.cases.push(row);
}

// Keep a derived collection alive deliberately: it must not retain a resource or
// its geometry arrays. Yield between GC and WeakRef inspection to avoid keeping
// the target alive through the current JS job's dereference guarantee.
function retired() {
  const f = auditGrid(150, { attributes: true });
  const collection = meshEdges(f.resource, f.resource.meshes[0].id);
  const resource = new WeakRef(f.resource), vertices = new WeakRef(f.resource.vertices), normals = new WeakRef(f.resource.meshes[0].normals);
  const selected = auditSelection(f, 'edge', 100, meshEdges, withSelectionElements);
  const session = beginMeshTransformSession(f.project, selected), previews = [];
  for (let i = 1; i <= 8; i++) previews.push(new WeakRef(updateTransformSession(session, { elementDelta: [0, 0, i / 1000] }).draft.objResources[0]));
  return { collection, resource, vertices, normals, previews };
}
const retiredState = retired();
for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); global.gc(); }
report.retirement = { heldDerivedEdges: retiredState.collection.length, resourceCollected: !retiredState.resource.deref(),
  vertexArrayCollected: !retiredState.vertices.deref(), normalArrayCollected: !retiredState.normals.deref(),
  previewResourcesCollected: retiredState.previews.filter(ref => !ref.deref()).length, previewResources: retiredState.previews.length };
const index = process.argv.indexOf('--out');
if (index >= 0) writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2));
else console.log(JSON.stringify(report, null, 2));
assert.ok(report.retirement.resourceCollected && report.retirement.vertexArrayCollected && report.retirement.normalArrayCollected);
assert.equal(report.retirement.previewResourcesCollected, report.retirement.previewResources);
