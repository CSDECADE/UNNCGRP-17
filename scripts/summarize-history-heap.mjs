// Trace the explicit investigation root through history -> resources -> normals.
// This is a backing-store census, not a general retained-size/dominator analysis.
import { readFileSync, writeFileSync } from 'node:fs';
const heap = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const meta = heap.snapshot.meta, nf = meta.node_fields, ef = meta.edge_fields, nw = nf.length, ew = ef.length;
const name = nf.indexOf('name'), size = nf.indexOf('self_size'), count = nf.indexOf('edge_count');
const edgeType = ef.indexOf('type'), edgeName = ef.indexOf('name_or_index'), to = ef.indexOf('to_node');
const types = meta.edge_types[edgeType], starts = new Uint32Array(heap.nodes.length / nw);
let offset = 0;
for (let i = 0; i < starts.length; i++) { starts[i] = offset; offset += heap.nodes[i * nw + count] * ew; }
function children(node, type, key) {
  const result = [], end = starts[node / nw] + heap.nodes[node + count] * ew;
  for (let i = starts[node / nw]; i < end; i += ew) {
    const kind = types[heap.edges[i + edgeType]], label = kind === 'element' ? heap.edges[i + edgeName] : heap.strings[heap.edges[i + edgeName]];
    if (kind === type && (key === undefined || label === key)) result.push(heap.edges[i + to]);
  }
  return result;
}
const prop = (node, key) => children(node, 'property', key)[0], elements = node => node === undefined ? [] : children(node, 'element');
let root;
for (let i = 0; i < heap.edges.length; i += ew)
  if (types[heap.edges[i + edgeType]] === 'property' && heap.strings[heap.edges[i + edgeName]] === '__objHistorySnapshot') { root = heap.edges[i + to]; break; }
if (root === undefined) throw new Error('Investigation history root not found');
const projects = new Set([...elements(prop(root, 'past')), prop(root, 'present'), ...elements(prop(root, 'future'))]);
const normalArrays = new Set(), stores = new Set();
for (const project of projects) for (const resource of elements(prop(project, 'objResources')))
  for (const mesh of elements(prop(resource, 'meshes'))) {
    const normals = prop(mesh, 'normals'); if (normals === undefined) continue;
    normalArrays.add(normals); children(normals, 'internal', 'elements').forEach(node => stores.add(node));
  }
const summary = { snapshot: process.argv[2], retainingPath: 'global.__objHistorySnapshot -> past/present/future -> objResources -> meshes -> normals -> elements',
  projects: projects.size, normalArrays: normalArrays.size, uniqueNormalBackingStores: stores.size,
  normalBackingStoreSelfBytes: [...stores].reduce((n, node) => n + heap.nodes[node + size], 0),
  backingStoreNames: [...new Set([...stores].map(node => heap.strings[heap.nodes[node + name]]))],
  limitation: 'Self-size of backing stores reachable along the named history path; not an exclusive retained-size calculation for every object in the process.' };
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(summary, null, 2));
else console.log(JSON.stringify(summary, null, 2));
