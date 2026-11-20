const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

module.exports = async ({ win, run, wait, delay, testDir }) => {
 const axis = Number(process.env.OBJ_HISTORY_AXIS ?? 0);
 assert.ok(axis === 0 || axis === 2);
 const report = { conditions: { axis, triangles: 45000, attributes: true, url: win.webContents.getURL(),commandPauseMs:30,batchSize:20,batchPauseMs:750,postPhaseSettlingMs:750,
  note: 'Hidden development/StrictMode Electron. Actual OBJ file-input import, public editor transactions, CDP controlled GC. Runtime.getHeapUsage bytes are renderer V8 measurements; process working-set KB and GPU object counts are separate, not GPU byte measurements.' }, points: [], timing: { edit: [], undo: [], redo: [] } };
 let commands=0;
 const frame = async code => {
  const result=await run(`(async()=>{const start=performance.now();${code};const dispatchMs=performance.now()-start;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return{dispatchMs,twoRafMs:performance.now()-start}})()`);
  await delay(++commands%20===0?750:30);return result; // Let autosave settle every 20 commands, outside latency samples.
 };
 await run(`(()=>{const s=window.__historyMemory={updateWarnings:[]},original=console.error;console.error=(...args)=>{if(args.some(v=>String(v).includes('Maximum update depth')))s.updateWarnings.push(new Error().stack);original.apply(console,args)};s.restoreConsole=()=>{console.error=original};s.editor=()=>{const element=document.querySelector('main'),key=Object.keys(element).find(k=>k.startsWith('__reactFiber$'));
  for(let node=element[key];node;node=node.return)for(const fiber of [node,node.alternate])for(let dep=fiber?.dependencies?.firstContext;dep;dep=dep.next){const e=dep.memoizedValue;if(e?.readProject&&e?.beginMeshTransform)return e;}throw new Error('Missing editor context');};})()`);
 win.webContents.debugger.attach('1.3');
 async function point(name) {
  await delay(750);
  for(let i=0;i<3;i++) await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
  const heap=await win.webContents.debugger.sendCommand('Runtime.getHeapUsage');
  const objects=await run(`(()=>{const gl=window.__root.getState().gl,scene=window.__root.getState().scene,buffers=new Set(),materials=new Set();let objCorners=0;
   scene.traverse(o=>{if(o.geometry)for(const a of Object.values(o.geometry.attributes))if(a.array?.buffer)buffers.add(a.array.buffer);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);if(o.userData.objMeshId)objCorners+=o.geometry.getAttribute('position').count;});
   return{GPUCounts:{...gl.info.memory,programs:gl.info.programs?.length},activeSceneBufferBytes:[...buffers].reduce((n,b)=>n+b.byteLength,0),activeSceneMaterials:materials.size,objCorners};})()`);
  const metric=app.getAppMetrics().find(m=>m.pid===win.webContents.getOSProcessId());
  report.points.push({name,heap,objects,rendererProcessMemoryKB:metric?.memory});
  report.updateWarnings=await run(`window.__historyMemory.updateWarnings`);
  fs.writeFileSync(path.join(testDir,'history-memory.json'),JSON.stringify(report,null,2));
 }
 try {
  await point('defaultScene');
  await run(`(async()=>{const {auditGrid}=await import('/scripts/obj-audit-fixtures.mjs'),{exportSelectedObj}=await import('/src/features/obj-export/obj.ts');const f=auditGrid(150,{attributes:true}),out=exportSelectedObj(f.project,{type:'model',id:f.model.id});
   const input=document.querySelector('input[accept=".obj"]'),data=new DataTransfer();data.items.add(new File([out.text],'history-grid.obj'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`!!document.querySelector('[aria-label="选择 history-grid.obj"]')`);
  await frame(`window.__historyMemory.editor().focus()`); await point('OBJImportedAndRendered');
  await run(`(async()=>{const {auditSelection}=await import('/scripts/obj-audit-fixtures.mjs'),mesh=await import('/src/core/mesh-edit.ts'),s=window.__historyMemory,e=s.editor(),p=e.readProject(),m=p.models.find(m=>m.kind==='obj'),r=p.objResources.find(r=>r.id===m.resourceId);
   s.modelId=m.id;s.resourceId=r.id;s.selection=auditSelection({project:p,model:m,resource:r},'edge',100,mesh.meshEdges,mesh.withSelectionElements);s.edges=mesh.meshEdges(r,s.selection.meshId);
   s.resource=new WeakRef(r);s.normals=new WeakRef(r.meshes[0].normals);e.enterEditMode();e.selectMeshElement(s.selection);document.querySelector('input[accept=".obj"]').value='';})()`);
  // Separate scope: an escaping edit callback must not capture setup resources
  // in the debugger-observed lexical context and become a benchmark retainer.
  await run(`(()=>{const s=window.__historyMemory;s.edit=()=>{const e=s.editor();if(!e.beginMeshTransform())throw new Error('Begin failed');const delta=[0,0,0];delta[${axis}]=.0001;if(!e.updateTransform({elementDelta:delta})||!e.finishTransform())throw new Error('Edit failed');};})()`);
  await point('topologyWarmed');
  for(let i=0;i<60;i++) report.timing.edit.push(await frame(`window.__historyMemory.edit()`));
  await point('history60');
  for(let cycle=0;cycle<3;cycle++) {
   for(let i=0;i<30;i++)report.timing.undo.push(await frame(`window.__historyMemory.editor().undo()`));
   for(let i=0;i<30;i++)report.timing.redo.push(await frame(`window.__historyMemory.editor().redo()`));
  }
  await point('undoRedo3Cycles');
  await run(`(()=>{const s=window.__historyMemory,p=s.editor().readProject();s.redoTip=new WeakRef(p.objResources.find(r=>r.id===p.models.find(m=>m.id===s.modelId).resourceId));})()`);
  for(let i=0;i<20;i++)await frame(`window.__historyMemory.editor().undo()`);
  await frame(`window.__historyMemory.edit()`);await point('newBranchAfterUndo20');
  assert.equal(await run(`window.__historyMemory.editor().canRedo`),false);
  report.redoTipCollected=await run(`!window.__historyMemory.redoTip.deref()`);assert.equal(report.redoTipCollected,true);
  await frame(`const e=window.__historyMemory.editor();e.exitEditMode();e.select({type:'model',id:window.__historyMemory.modelId});e.remove()`);
  await point('modelDeletedUndoable');
  assert.equal(await run(`window.__historyMemory.editor().readProject().models.some(m=>m.id===window.__historyMemory.modelId)`),false);
  await run(`(async()=>{const {emptyProject}=await import('/src/core/project.ts');window.__historyMemory.empty=emptyProject;})()`);
  for(let i=0;i<61;i++)await frame(`window.__historyMemory.editor().replace({...window.__historyMemory.empty(),name:'empty-${i}'})`);
  await point('geometryHistoryEvicted');
  report.retirement=await run(`({resource:!window.__historyMemory.resource.deref(),normals:!window.__historyMemory.normals.deref(),heldEdges:window.__historyMemory.edges.length})`);
  report.resourceId=await run(`window.__historyMemory.resourceId`);
  fs.writeFileSync(path.join(testDir,'history-memory.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({historyReport:path.join(testDir,'history-memory.json'),axis,retirement:report.retirement}));
  if(process.env.OBJ_HISTORY_HEAP){
   const file=process.env.OBJ_HISTORY_HEAP;fs.writeFileSync(file,'');
   const chunk=(_event,method,params)=>{if(method==='HeapProfiler.addHeapSnapshotChunk')fs.appendFileSync(file,params.chunk)};
   win.webContents.debugger.on('message',chunk);
   try{await win.webContents.debugger.sendCommand('HeapProfiler.takeHeapSnapshot',{reportProgress:false});}finally{win.webContents.debugger.removeListener('message',chunk);}
  }
  assert.equal(report.retirement.resource,true);assert.equal(report.retirement.normals,true);
  const stats=a=>{a=[...a].sort((x,y)=>x-y);return{n:a.length,p50:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1]}};
  report.timingSummary=Object.fromEntries(Object.entries(report.timing).map(([k,a])=>[k,{dispatch:stats(a.map(v=>v.dispatchMs)),twoRaf:stats(a.map(v=>v.twoRafMs))}]));
  fs.writeFileSync(path.join(testDir,'history-memory.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(testDir,'memory.png'),(await win.webContents.capturePage()).toPNG());
  return ['actual-OBJ-import-render','history60','undo-redo-3cycles','redo-branch-release','undoable-deletion','history-eviction-resource-release'];
 } finally { await run(`window.__historyMemory.restoreConsole()`);win.webContents.debugger.detach(); }
};
