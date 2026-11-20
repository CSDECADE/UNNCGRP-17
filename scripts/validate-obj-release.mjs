import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { architecturalObj, conditionAuthoredObj } from './obj-release-fixtures.mjs';
import { prepareObjImport } from '../src/features/obj-import/obj.ts';
import { exampleProject, serializeProject, parseProject, emptyProject } from '../src/core/project.ts';
import { meshEdges, resolveElement, withSelectionElements } from '../src/core/mesh-edit.ts';
import { distribution } from './obj-audit-fixtures.mjs';
import { beginMeshTransformSession, updateTransformSession } from '../src/core/transform.ts';
import { exportSelectedObj } from '../src/features/obj-export/obj.ts';
import { createObjGeometry } from '../src/features/obj-import/geometry.ts';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),out=args[args.indexOf('--out')+1];
const report={conditions:{timestamp:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,platform:platform(),arch:arch(),runs:15,warmup:3,note:'CPU milliseconds, independent operations. Synthetic architectural fixtures are not real-world scans. Diagnostic authored derivatives are explicitly separated from raw files.'},cases:[]};
const measure=fn=>{for(let i=0;i<3;i++)fn();const values=[];for(let i=0;i<15;i++){const t=performance.now();fn();values.push(performance.now()-t)}return distribution(values)};
function inspect(name,text,origin,diagnosis) {
 const row={name,origin,OBJBytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex'),diagnosis};report.cases.push(row);
 try{
  const start=performance.now(),parsed=prepareObjImport(exampleProject(),text,name);row.importFirstMs=performance.now()-start;
  const {project,model}=parsed,resource=project.objResources[0],meshId=(resource.meshes.find(m=>m.name==='Facade0')??resource.meshes[0]).id;
  row.accepted=true;row.vertices=resource.vertices.length;row.submeshes=resource.meshes.length;row.triangles=resource.meshes.reduce((n,m)=>n+m.triangles.length/3,0);row.projectBytes=Buffer.byteLength(serializeProject(project));
  const cold=performance.now();meshEdges(resource,meshId);row.firstEdgeTopologyMs=performance.now()-cold;
  const edges=meshEdges(resource,meshId),count=Math.min(100,edges.length),elements=Array.from({length:count},(_,i)=>({modelId:model.id,meshId,kind:'edge',edgeIds:edges[Math.floor(i*edges.length/count)].ids}));
  const selected=withSelectionElements(elements[0],elements),session=beginMeshTransformSession(project,selected);
  row.resolve100Edges=measure(()=>resolveElement(project,selected));
  row.preview100Edges=measure(()=>updateTransformSession(session,{elementDelta:[0,0,.0001]}));
  const activeMesh=resource.meshes.find(m=>m.id===meshId);row.activeSubmesh={name:activeMesh.name,triangles:activeMesh.triangles.length/3};row.renderGeometry=measure(()=>{const g=createObjGeometry(resource,activeMesh);g.dispose()});
  row.serialize=measure(()=>serializeProject(project));
  const encoded=serializeProject(project);assert.equal(serializeProject(parseProject(encoded)),encoded);row.serializedRoundtrip=true;
  const draft=updateTransformSession(session,{elementDelta:[0,0,.001]}).draft;
  try{row.editedProjectBytes=Buffer.byteLength(serializeProject(draft));row.groupCommitWithinBudget=true}catch(e){row.groupCommitWithinBudget=false;row.groupCommitError=e.message;}
  try{const output=exportSelectedObj(project,{type:'model',id:model.id});row.identityExportBytes=Buffer.byteLength(output.text);const reimport=prepareObjImport(emptyProject(),output.text,output.name);resource.vertices.forEach((v,i)=>v.position.forEach((n,axis)=>assert.ok(n===reimport.project.objResources[0].vertices[i].position[axis])));row.identityRoundtrip=true}catch(e){row.identityExportError=e.message;}
  const changed={...project,models:project.models.map(m=>m.id===model.id?{...m,rotation:35,rotationXYZ:[20,35,-40],scale:[.5,1.5,2]}:m)};
  try{row.transformedExportBytes=Buffer.byteLength(exportSelectedObj(changed,{type:'model',id:model.id}).text);row.transformedExportAccepted=true}catch(e){row.transformedExportAccepted=false;row.transformedExportError=e.message;}
 }catch(error){if(row.accepted){row.validationError=error.message;process.exitCode=1}else{row.accepted=false;row.error=error.message;}}
 return row;
}
for(const n of ['A','H']) {
 const raw=readFileSync(new URL(`../tests/fixtures/obj-release/kaykit/building_${n}.obj`,import.meta.url),'utf8');
 inspect(`building_${n}.obj`,raw,'Creator-authored KayKit CC0 OBJ, unmodified');
 const derivative=conditionAuthoredObj(raw);inspect(`conditioned-building_${n}.obj`,derivative.text,'Explicit diagnostic derivative of creator-authored OBJ',derivative);
 // Do not retain a duplicate large text payload in the results.
 delete report.cases.at(-1).diagnosis.text;
}
for(const [name,windows] of [['synthetic-small.obj',10],['synthetic-medium.obj',120],['synthetic-large.obj',1000],['synthetic-near.obj',1320],['synthetic-over.obj',1350]])inspect(name,architecturalObj({windows}),'Generated controlled box-frame building');
if(args.includes('--sibenik')) {
 const path=args[args.indexOf('--sibenik')+1],raw=readFileSync(path,'utf8');
 inspect('sibenik.obj',raw,'External Sibenik Cathedral, CC BY-NC, local evaluation only');
 inspect('diagnostic-sibenik.obj',conditionAuthoredObj(raw).text,'Explicit metadata/quad diagnostic derivative; no repair');
 let projected=0;const projectedText=conditionAuthoredObj(raw).text.split('\n').map(l=>{const a=l.trim().split(/\s+/);if(a[0]==='vt'&&a.length===4&&Number(a[3])===0){projected++;return a.slice(0,3).join(' ')}return l}).join('\n');
 inspect('zero-w-sibenik.obj',projectedText,'Further explicit diagnostic: zero third UV component projected to 2D, no geometry repair',{projectedUVs:projected});
}
writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.cases.map(({name,accepted,triangles,projectBytes,error,groupCommitWithinBudget,transformedExportAccepted})=>({name,accepted,triangles,projectBytes,error,groupCommitWithinBudget,transformedExportAccepted})),null,2));
