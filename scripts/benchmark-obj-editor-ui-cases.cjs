const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ win, run, wait, click, key, delay, setupRoot, dragStart, release, control, testDir }) => {
 const report = { conditions: { url: win.webContents.getURL(), window: [1440,1000],
  note: 'Vite development React StrictMode. Actual native pointer drags; each sample is observed through two RAF callbacks. Hidden Electron window, not displayed paint or GPU completion. Instrumentation is test-only. Context access is used for deterministic 100-element fixture setup.' }, cases: [] };
 const frame = code => run(`(async()=>{const start=performance.now();${code};const dispatch=performance.now()-start;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {dispatchMs:dispatch,twoRafMs:performance.now()-start};})()`);
 await run(`(async()=>{
  const {BufferGeometry}=await import('/node_modules/.vite/deps/three.js');
  const state=window.__objAudit={created:new Map(),disposed:new Set(),draws:[],intervals:[],capture:false,sequence:0};
  const setAttribute=BufferGeometry.prototype.setAttribute,dispose=BufferGeometry.prototype.dispose;
  BufferGeometry.prototype.setAttribute=function(name,attribute){if(name==='position')state.created.set(this.uuid,attribute.count);return setAttribute.call(this,name,attribute)};
  BufferGeometry.prototype.dispose=function(){state.disposed.add(this.uuid);return dispose.call(this)};
  state.restore=()=>{BufferGeometry.prototype.setAttribute=setAttribute;BufferGeometry.prototype.dispose=dispose};
  const gl=window.__root.getState().gl,render=gl.render;
  gl.render=function(...args){const start=performance.now();try{return render.apply(this,args)}finally{if(state.capture)state.draws.push(performance.now()-start)}};
  state.restoreRender=()=>{gl.render=render};
  let previous=performance.now();const tick=now=>{if(state.capture)state.intervals.push(now-previous);previous=now;state.raf=requestAnimationFrame(tick)};state.raf=requestAnimationFrame(tick);
  // Read the existing public editor methods through the mounted React context.
  // This harness uses private React DOM fiber links only for fixture setup; no production hook is added.
  state.editor=()=>{const element=document.querySelector('main'),key=Object.keys(element).find(k=>k.startsWith('__reactFiber$'));
    for(let node=element[key];node;node=node.return)for(const fiber of [node,node.alternate])for(let dep=fiber?.dependencies?.firstContext;dep;dep=dep.next){const value=dep.memoizedValue;if(value?.readProject&&value?.selectMeshElement&&value?.beginMeshTransform)return value;}
    throw new Error('Editor context not found');};
  state.geometry=()=>{let result;window.__root.getState().scene.traverse(o=>{if(o.isMesh&&o.material?.isMeshStandardMaterial&&o.geometry?.getAttribute('position')?.count===state.fixture?.resource.meshes[0].triangles.length)result=o.geometry});return result};
  state.observe=type=>{state.pending=new Promise(resolve=>{const canvas=gl.domElement;const listener=()=>{const start=performance.now(),before=state.geometry()?.uuid;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{const twoRafMs=performance.now()-start;let checks=0;
        const check=()=>{const geometry=state.geometry(),expected=state.editor().readProject().objResources[0].vertices[0].position;
          if(!geometry)throw new Error('Audit render geometry not found');const a=geometry.getAttribute('position');
          if(expected.every((n,i)=>Math.abs(n-[a.getX(0),a.getY(0),a.getZ(0)][i])<1e-4))resolve({twoRafMs,renderMatchMs:performance.now()-start,geometryChanged:before!==geometry.uuid});
          else if(checks++<30)requestAnimationFrame(check);else throw new Error('Committed render geometry did not match the editor resource');};check();}));};canvas.addEventListener(type,listener,{capture:true,once:true});});};
  state.renderer={renderer:gl.getContext().getParameter(gl.getContext().RENDERER),vendor:gl.getContext().getParameter(gl.getContext().VENDOR)};
  const debug=gl.getContext().getExtension('WEBGL_debug_renderer_info');if(debug)state.renderer.unmasked=gl.getContext().getParameter(debug.UNMASKED_RENDERER_WEBGL);
 })()`);
 report.conditions.renderer=await run('window.__objAudit.renderer');
 const stats=values=>{const sorted=[...values].sort((a,b)=>a-b),p=q=>sorted[Math.max(0,Math.ceil(q*sorted.length)-1)];return {n:values.length,p50:+p(.5).toFixed(2),p95:+p(.95).toFixed(2),max:+p(1).toFixed(2)}};
 const positionSample = () => run(`window.__objAudit.editor().readProject().objResources[0].vertices[0].position`);
 try {
  for(const [n,attributes] of [[70,false],[150,false],[150,true]].filter(([n])=>!process.env.OBJ_AUDIT_CASES||process.env.OBJ_AUDIT_CASES.split(',').includes(String(n)))) {
   await run(`(async()=>{const {auditGrid,auditSelection}=await import('/scripts/obj-audit-fixtures.mjs'),mesh=await import('/src/core/mesh-edit.ts');
     window.__objAudit.created.clear();window.__objAudit.disposed.clear();
     const fixture=auditGrid(${n},{attributes:${attributes}});fixture.model.position=[40,15,20];window.__objAudit.fixture=fixture;
     window.__objAudit.selection=auditSelection(fixture,'edge',100,mesh.meshEdges,mesh.withSelectionElements);
     window.__objAudit.member=mesh.selectionElements(window.__objAudit.selection)[0];
     window.__objAudit.editor().replace(fixture.project);})()`);
   await wait(`!!document.querySelector('[aria-label="选择 audit-grid.obj"]')`);await delay(550);
   await frame(`const e=window.__objAudit.editor();e.select({type:'model',id:'audit-model'});e.focus();`);await delay(200);
   const row={triangles:n*n*2,attributes,warmupGestures:1,measuredGestures:5,preview:[],commit:[],undo:[],redo:[],select:[],idle:{},diagnostics:{}};report.cases.push(row);
   // UI selection costs include validation and the actual React/R3F update, not just Set manipulation.
   await frame(`window.__objAudit.editor().enterEditMode()`);
   await frame(`window.__objAudit.editor().selectMeshElement(window.__objAudit.selection)`);
   for(let i=0;i<6;i++){
    const sample=await frame(`window.__objAudit.editor().pickMeshElement(window.__objAudit.member,true)`);
    if(i)row.select.push(sample);
   }
   await frame(`window.__objAudit.editor().setTool('translate')`);await wait(`!!(${control}?.object)`);
   const initial=await positionSample();
   const baselineGpu=await run('window.__root.getState().gl.info.memory.geometries');
   await run('window.__objAudit.capture=true;window.__objAudit.draws=[];window.__objAudit.intervals=[];void 0');await delay(300);
   row.idle=await run('({draws:window.__objAudit.draws,intervals:window.__objAudit.intervals})');
   await run('window.__objAudit.capture=false;void 0');
   for(let iteration=0;iteration<6;iteration++) {
    const start=await dragStart('X'),dx=start.x-start.origin.x,dy=start.y-start.origin.y,norm=Math.hypot(dx,dy)||1;
    await run('window.__objAudit.capture=true;window.__objAudit.draws=[];window.__objAudit.intervals=[];void 0');
    let end;
    for(let step=1;step<=4;step++) {
     end={x:Math.round(start.x+dx/norm*step*2),y:Math.round(start.y+dy/norm*step*2)};
     await run(`window.__objAudit.observe('pointermove');void 0`);
     win.webContents.sendInputEvent({type:'mouseMove',button:'left',...end});
     const sample=await run('window.__objAudit.pending');
     if(iteration)row.preview.push(sample);
    }
    const changed=await positionSample();assert.notDeepEqual(changed,initial);
    await run(`window.__objAudit.observe('pointerup');void 0`);
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',...end,clickCount:1});
    const committed=await run('window.__objAudit.pending');if(iteration)row.commit.push(committed);
    assert.equal(await run('window.__root.getState().controls.enabled'),true);
    const undid=await frame(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);
    if(iteration)row.undo.push(undid);assert.deepEqual(await positionSample(),initial);
    const redid=await frame(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true}))`);
    if(iteration)row.redo.push(redid);assert.deepEqual(await positionSample(),changed);
    await frame(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);assert.deepEqual(await positionSample(),initial);
    const rendering=await run('({draws:window.__objAudit.draws,intervals:window.__objAudit.intervals})');
    if(iteration){row.draws=(row.draws||[]).concat(rendering.draws);row.intervals=(row.intervals||[]).concat(rendering.intervals);}
    await run('window.__objAudit.capture=false;void 0');
   }
   // Count call sites in a SEPARATE untimed gesture: stack capture is intrusive.
   const start=await dragStart('X');
   await run(String.raw`(()=>{const state=window.__objAudit,NativeMap=window.Map;state.calls={};state.callStacks={};window.Map=new Proxy(NativeMap,{construct(target,args){
      const stack=new Error().stack.split('\n'),caller=stack[2]||'unknown';const key=caller.includes('meshEdges')?'meshEdges':caller.includes('resolveElement')?'resolveElement.map':caller.includes('selectionElements')?'selectionElements':'other';
      state.calls[key]=(state.calls[key]||0)+1;if(key==='meshEdges')state.callStacks[stack.slice(2,6).join('\n')]=(state.callStacks[stack.slice(2,6).join('\n')]||0)+1;return Reflect.construct(target,args);}});state.restoreMap=()=>{window.Map=NativeMap};})()`);
   await run(`window.__objAudit.observe('pointermove');void 0`);
   const dx=start.x-start.origin.x,dy=start.y-start.origin.y,norm=Math.hypot(dx,dy)||1,end={x:Math.round(start.x+dx/norm*5),y:Math.round(start.y+dy/norm*5)};
   win.webContents.sendInputEvent({type:'mouseMove',button:'left',...end});await run('window.__objAudit.pending');
   row.diagnostics.calls=await run('({counts:window.__objAudit.calls,stacks:window.__objAudit.callStacks})');
   await run(`window.__objAudit.calls={};window.__objAudit.callStacks={};window.__objAudit.observe('pointerup');void 0`);
   win.webContents.sendInputEvent({type:'mouseUp',button:'left',...end,clickCount:1});await run('window.__objAudit.pending');
   row.diagnostics.commitCalls=await run('({counts:window.__objAudit.calls,stacks:window.__objAudit.callStacks})');
   await run(`window.__objAudit.calls={};window.__objAudit.callStacks={};void 0`);await delay(850);
   row.diagnostics.autosaveCalls=await run('({counts:window.__objAudit.calls,stacks:window.__objAudit.callStacks})');
   await run('window.__objAudit.restoreMap();void 0');
   await frame(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);assert.deepEqual(await positionSample(),initial);
   const generated=await run(`(()=>{const s=window.__objAudit,ids=[...s.created].filter(([_id,count])=>count===${n*n*6}).map(([id])=>id);return{created:ids.length,disposed:ids.filter(id=>s.disposed.has(id)).length,undisposed:ids.filter(id=>!s.disposed.has(id)).length};})()`);
   await frame(`window.__objAudit.editor().exitEditMode()`);await delay(100);
   const afterGpu=await run('window.__root.getState().gl.info.memory.geometries');
   row.diagnostics.geometry={baselineGpu,afterGpu,importedGeometryTracking:generated};
   // Repeat mode mounts/unmounts to look for a growing renderer geometry count.
   const gpuCycle=[];
   for(let i=0;i<5;i++){
    await frame(`const e=window.__objAudit.editor();e.enterEditMode();e.selectMeshElement(window.__objAudit.selection);e.setTool('translate')`);
    await frame(`window.__objAudit.editor().exitEditMode()`);gpuCycle.push(await run('window.__root.getState().gl.info.memory.geometries'));
   }
   row.diagnostics.gpuAfterModeCycles=gpuCycle;
   await frame(`const e=window.__objAudit.editor();e.exitEditMode();e.setTool('select')`);await delay(100);
   row.diagnostics.gpuWithoutGizmo=await run('window.__root.getState().gl.info.memory.geometries');
   row.previewSummary=stats(row.preview.map(s=>s.renderMatchMs));row.commitSummary=stats(row.commit.map(s=>s.renderMatchMs));
   row.undoSummary={dispatch:stats(row.undo.map(s=>s.dispatchMs)),twoRaf:stats(row.undo.map(s=>s.twoRafMs))};
   row.redoSummary={dispatch:stats(row.redo.map(s=>s.dispatchMs)),twoRaf:stats(row.redo.map(s=>s.twoRafMs))};
   row.selectSummary={dispatch:stats(row.select.map(s=>s.dispatchMs)),twoRaf:stats(row.select.map(s=>s.twoRafMs))};
   row.renderSubmitSummary=stats(row.draws);row.rafDuringEditingSummary=stats(row.intervals);
   row.idleSummary={renderSubmit:stats(row.idle.draws),raf:stats(row.idle.intervals)};
   console.log(JSON.stringify({auditCase:[row.triangles,attributes],preview:row.previewSummary,commit:row.commitSummary,resolveCalls:row.diagnostics.calls.counts,gpuCycle}));
   fs.writeFileSync(path.join(testDir,'audit-ui.json'),JSON.stringify(report,null,2));
  }
  fs.writeFileSync(path.join(testDir,'audit.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({auditReport:path.join(testDir,'audit-ui.json')}));
  return ['native-dense-drags','real-editor-undo-redo','separate-untimed-call-profile','GPU-mode-cycle-observation'];
 } finally {
  await run('window.__objAudit.restoreMap?.();window.__objAudit.restore();window.__objAudit.restoreRender();cancelAnimationFrame(window.__objAudit.raf);void 0');
 }
};
