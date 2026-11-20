/** Deterministic audit assets; no production state or dependencies are introduced. */
export function auditGrid(n, { attributes = false, submeshes = 1 } = {}) {
  const vertices = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++)
    vertices.push({ id: `v${vertices.length}`, position: [x, y, 0] });
  const meshes = Array.from({ length: submeshes }, (_, i) => ({ id: `mesh${i}`, name: `Grid${i}`, triangles: [],
    ...(attributes ? { uvs: [], normals: [] } : {}) }));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x, b = a + 1, c = a + n + 2, d = a + n + 1;
    const mesh = meshes[Math.min(submeshes - 1, Math.floor(y * submeshes / n))];
    mesh.triangles.push(a, b, c, a, c, d);
    if (attributes) {
      mesh.uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      mesh.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    }
  }
  const resource = { id: 'audit-resource', name: 'audit-grid.obj', format: 'obj', vertices, meshes };
  const model = { id: 'audit-model', kind: 'obj', resourceId: resource.id, name: 'audit-grid.obj', position: [0, 0, 0], rotation: 0,
    size: [n, n, .1], color: '#bdc5d2', visible: true, locked: false };
  const project = { version: 2, name: 'OBJ audit', models: [model], drones: [], viewpoints: [], source: '用户手动编排', objResources: [resource] };
  return { project, model, resource };
}

export function auditSelection(fixture, mode, count, meshEdges, withSelectionElements) {
  const { resource, model } = fixture, mesh = resource.meshes[0], base = { modelId: model.id, meshId: mesh.id };
  const candidates = mode === 'edge' ? meshEdges(resource, mesh.id).map(e => ({ ...base, kind: 'edge', edgeIds: e.ids }))
    : mode === 'face' ? Array.from({ length: mesh.triangles.length / 3 }, (_, triangle) => ({ ...base, kind: 'face', triangle }))
    : [...new Set(mesh.triangles)].map(i => ({ ...base, vertexId: resource.vertices[i].id }));
  const members = Array.from({ length: Math.min(count, candidates.length) }, (_, i) => candidates[Math.floor(i * candidates.length / Math.min(count, candidates.length))]);
  return withSelectionElements(members[0], members);
}

export function distribution(samples) {
  const values = [...samples].sort((a, b) => a - b), percentile = p => values[Math.max(0, Math.ceil(values.length * p) - 1)];
  return { n: values.length, p50: +percentile(.5).toFixed(3), p95: +percentile(.95).toFixed(3), max: +values.at(-1).toFixed(3) };
}
