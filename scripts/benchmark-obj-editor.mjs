import { performance } from 'node:perf_hooks';
import { cpus, platform, arch, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Mesh, MeshStandardMaterial, DoubleSide, PerspectiveCamera, Matrix4, Vector3, Float32BufferAttribute } from 'three';
import { auditGrid, auditSelection, distribution } from './obj-audit-fixtures.mjs';
import { meshEdges, resolveElement, updateMeshSelection, selectionElements, withSelectionElements,
  translateMeshElement, pickLogicalVertex, pickLogicalEdge, pickLogicalFace, vertexVisible } from '../src/core/mesh-edit.ts';
import { beginMeshTransformSession, updateTransformSession, commitTransformHistory } from '../src/core/transform.ts';
import { resourceBounds } from '../src/core/model-bounds.ts';
import { createObjGeometry } from '../src/features/obj-import/geometry.ts';
import { serializeProject, parseProject, validateProject } from '../src/core/project.ts';
import { exportSelectedObj } from '../src/features/obj-export/obj.ts';
import { prepareObjImport } from '../src/features/obj-import/obj.ts';

const args = process.argv.slice(2), outputIndex = args.indexOf('--out');
const runs = Number(process.env.OBJ_AUDIT_RUNS || 15), warmup = 3;
if (!Number.isInteger(runs) || runs < 5) throw new Error('OBJ_AUDIT_RUNS must be an integer >= 5');
const report = { conditions: { timestamp: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version, cpu: cpus()[0]?.model, platform: platform(), arch: arch(), ramGiB: +(totalmem() / 2 ** 30).toFixed(1), warmup, runs,
  note: 'CPU only; synchronous production functions. p95 is a sample percentile, not a frame-time estimate. No logging or forced GC in timed operations.' }, cases: [] };
function measure(fn) {
  const firstStart = performance.now(); fn(); const firstMs = performance.now() - firstStart;
  for (let i = 0; i < warmup; i++) fn();
  const values = [];
  for (let i = 0; i < runs; i++) { const start = performance.now(); fn(); values.push(performance.now() - start); }
  return { firstMs: +firstMs.toFixed(3), ...distribution(values) };
}

for (const [n, attributes, submeshes] of [[25, false, 1], [70, false, 1], [150, false, 1], [150, true, 1], [150, true, 4]]) {
  const fixture = auditGrid(n, { attributes, submeshes }), { project, resource, model } = fixture;
  const json = serializeProject(project), row = { grid: n, triangles: n * n * 2, attributes, submeshes, projectBytes: Buffer.byteLength(json), operations: {}, workloads: [] };
  report.cases.push(row); const ops = row.operations;
  const targetX = Math.floor(n / 2), targetY = Math.floor(n / (2 * submeshes));
  const camera = new PerspectiveCamera(45, 1, .1, 2000); camera.position.set(targetX, targetY, n * 2); camera.lookAt(targetX, targetY, 0); camera.updateMatrixWorld(true);
  const geometries = resource.meshes.map(mesh => createObjGeometry(resource, mesh));
  const material = new MeshStandardMaterial({ side: DoubleSide });
  const objects = geometries.map((geometry, i) => { const mesh = new Mesh(geometry, material); mesh.name = `model-${model.id}`; mesh.userData.objMeshId = resource.meshes[i].id; mesh.updateMatrixWorld(true); return mesh; });
  const screen = local => { const p = new Vector3(...local).project(camera); return { x: (p.x + 1) * 500, y: (1 - p.y) * 500 }; };
  const pick = { resource, meshId: resource.meshes[0].id, matrix: new Matrix4(), camera, pointer: screen([targetX, targetY, 0]), width: 1000, height: 1000 };
  const edgePick = { ...pick, pointer: screen([targetX + .5, targetY, 0]) }, facePick = { ...pick, pointer: screen([targetX + 2 / 3, targetY + 1 / 3, 0]) };
  if (!pickLogicalVertex(pick) || !pickLogicalEdge(edgePick) || pickLogicalFace({ ...facePick, objects, modelId: model.id }) === null)
    throw new Error('Benchmark pick fixture must hit its active submesh');
  ops.edgeDerivation = measure(() => meshEdges(resource, pick.meshId));
  ops.boundsScan = measure(() => resourceBounds(resource));
  ops.pickVertexProjectionOnly = measure(() => pickLogicalVertex(pick));
  ops.pickVertexOcclusion = measure(() => pickLogicalVertex({ ...pick, visible: p => vertexVisible(p, camera, objects) }));
  ops.pickEdgeProjectionOnly = measure(() => pickLogicalEdge(edgePick));
  ops.pickEdgeOcclusion = measure(() => pickLogicalEdge({ ...edgePick, visible: p => vertexVisible(p, camera, objects) }));
  ops.pickFaceRaycast = measure(() => pickLogicalFace({ ...facePick, objects, modelId: model.id }));
  ops.assembleCornerPositions = measure(() => {
    const positions = new Float32Array(resource.meshes[0].triangles.length * 3);
    resource.meshes[0].triangles.forEach((index, i) => positions.set(resource.vertices[index].position, i * 3));
  });
  ops.copyPositionAttribute = measure(() => new Float32BufferAttribute(geometries[0].getAttribute('position').array, 3));
  ops.recomputeBoundsExistingBuffer = measure(() => { geometries[0].computeBoundingBox(); geometries[0].computeBoundingSphere(); });
  if (!attributes) ops.recomputeFlatNormalsExistingBuffer = measure(() => geometries[0].computeVertexNormals());
  else ops.copyCornerNormals = measure(() => resource.meshes[0].normals.slice());
  ops.buildRenderGeometry = measure(() => { const geometry = createObjGeometry(resource, resource.meshes[0]); geometry.dispose(); });
  ops.serializeProject = measure(() => serializeProject(project));
  ops.stringifyOnePass = measure(() => JSON.stringify(project));
  ops.utf8BudgetOnePass = measure(() => new TextEncoder().encode(json));
  ops.validateProjectIncludingBudget = measure(() => validateProject(project));
  ops.restoreProject = measure(() => parseProject(json));
  const exported = exportSelectedObj(project, { type: 'model', id: model.id });
  ops.exportWithRoundtripPreflight = measure(() => exportSelectedObj(project, { type: 'model', id: model.id }));
  ops.importPreparedProject = measure(() => prepareObjImport({ version: 1, name: 'empty', models: [], drones: [], viewpoints: [], source: '用户手动编排' }, exported.text, exported.name));
  for (const mode of ['vertex', 'edge', 'face']) for (const count of [1, 100]) {
    const selected = auditSelection(fixture, mode, count, meshEdges, withSelectionElements), target = resolveElement(project, selected);
    const members = selectionElements(selected), one = members[0], session = beginMeshTransformSession(project, selected);
    const edited = updateTransformSession(session, { elementDelta: [0, 0, .01] });
    const history = { past: [], present: project, future: [] };
    const workload = { mode, count: members.length, vertices: target.indices.length, affectedTriangles: resource.meshes.reduce((sum, mesh) => sum +
      Array.from({ length: mesh.triangles.length / 3 }, (_, i) => mesh.triangles.slice(i * 3, i * 3 + 3).some(index => target.indices.includes(index))).filter(Boolean).length, 0), operations: {} };
    row.workloads.push(workload); const times = workload.operations;
    times.shiftToggle = measure(() => updateMeshSelection(selected, one, true));
    times.resolveVertices = measure(() => resolveElement(project, selected));
    times.startTransaction = measure(() => beginMeshTransformSession(project, selected));
    times.previewAbsolute = measure(() => translateMeshElement(project, selected, target.pivot.map((v, i) => v + (i === 2 ? .01 : 0)), 'copy'));
    times.previewDelta = measure(() => updateTransformSession(session, { elementDelta: [0, 0, .01] }));
    times.commitHistoryOnly = measure(() => commitTransformHistory(history, edited));
    times.commitWithSerialization = measure(() => { const next = commitTransformHistory(history, edited); serializeProject(next.present); });
  }
  for (const geometry of geometries) geometry.dispose(); material.dispose();
  console.error(`Benchmarked ${row.triangles} triangles, attributes=${attributes}, submeshes=${submeshes}`);
}
if (args.includes('--memory')) {
  if (!global.gc) throw new Error('Use node --expose-gc with --memory');
  report.memory = [];
  for (const attributes of [false, true]) {
    global.gc(); const fixture = auditGrid(150, { attributes });
    const selected = auditSelection(fixture, 'edge', 100, meshEdges, withSelectionElements);
    let history = { past: [], present: fixture.project, future: [] };
    global.gc(); const baseline = process.memoryUsage().heapUsed;
    for (let i = 0; i < 60; i++) {
      const session = beginMeshTransformSession(history.present, selected);
      history = commitTransformHistory(history, updateTransformSession(session, { elementDelta: [0, 0, .001] }));
    }
    global.gc(); const retainedMiB = (process.memoryUsage().heapUsed - baseline) / 2 ** 20;
    report.memory.push({ triangles: 45000, attributes, historyEntries: history.past.length, retainedHeapMiB: +retainedMiB.toFixed(1),
      sourceProjectBytes: Buffer.byteLength(serializeProject(fixture.project)) });
    history = null;
  }
}
if (outputIndex >= 0) { writeFileSync(args[outputIndex + 1], JSON.stringify(report, null, 2)); console.error(`Saved ${args[outputIndex + 1]}`); }
else console.log(JSON.stringify(report, null, 2));
