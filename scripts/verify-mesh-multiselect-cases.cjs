const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({win,run,wait,click,key,snapshot,delay,input,before,selectionOnly,testDir,dragStart,dragMove,release,control,setupRoot}) => {
 const checks=[];
 const source='v 40 15 20\nv 44 15 20\nv 44 19 20\nv 40 19 20\nv 40 15 20\nvt 0 0\nvt 1 0\nvt 1 1\nvt .5 0\nvn 0 0 1\nvn 0 1 1\no A\nf 1/1/1 2/2/1 3/3/1\nf 1/4/2 3/3/2 4/1/2\nf 5/4/1 4/1/1 3/3/1\no B\nf 1 4 3';
 await run(`(()=>{const i=document.querySelector('input[accept=".obj"]'),d=new DataTransfer();d.items.add(new File([${JSON.stringify(source)}],'multi.obj'));i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await wait(`!!document.querySelector('[aria-label="选择 multi.obj"]')`);await delay(550);
 const initial=await snapshot(), model=initial.models.find(m=>m.kind==='obj');
 const count=()=>run(`Number(document.querySelector('[aria-label="已选元素数量"]').textContent)`);
 const pointer=async local=>run(`(()=>{const root=window.__root.getState(),o=root.scene.getObjectByName('model-${model.id}');o.updateWorldMatrix(true,true);const p=o.position.clone().set(...${JSON.stringify(local)}).applyMatrix4(o.matrixWorld).project(root.camera),r=root.gl.domElement.getBoundingClientRect();return{x:Math.round(r.x+(p.x+1)*r.width/2),y:Math.round(r.y+(1-p.y)*r.height/2)};})()`);
 const at=async(p,shift=false,move=0)=>{
  const modifiers=shift?['shift']:[];
  win.webContents.sendInputEvent({type:'mouseMove',...p,modifiers});win.webContents.sendInputEvent({type:'mouseDown',button:'left',...p,clickCount:1,modifiers});
  if(move)win.webContents.sendInputEvent({type:'mouseMove',x:p.x+move,y:p.y,modifiers});
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',x:p.x+move,y:p.y,clickCount:1,modifiers});await delay(120);
 };
 const pick=async(local,shift=false)=>at(await pointer(local),shift);
 await key('f');await delay(100);await click('切换编辑模式');await wait(`!!document.querySelector('.vertex-inspector')`);await delay(180);
 for(const [mode,a,b,highlight,expected] of [
  ['顶点',[40,15,20],[44,15,20],'selected-edit-vertex',2],
  ['边',[42,15,20],[44,17,20],'selected-edit-edge',4],
  ['面',[40+8/3,15+4/3,20],[40+4/3,15+8/3,20],'selected-edit-face',6],
 ]) {
  await click(mode+'选择');assert.equal(await count(),0);
  await pick(a);assert.equal(await count(),1);
  const camera=await run(`({position:window.__root.getState().camera.position.toArray(),target:window.__root.getState().controls.target.toArray()})`);
  await pick(b,true);assert.equal(await count(),2);
  assert.equal(await run(`window.__root.getState().scene.getObjectByName('${highlight}').geometry.getAttribute('position').count`),expected);
  assert.deepEqual(await run(`({position:window.__root.getState().camera.position.toArray(),target:window.__root.getState().controls.target.toArray()})`),camera);
  await at(await pointer(b),true,15);assert.equal(await count(),2); // Shift drag is neither a camera pan nor a selection click.
  assert.deepEqual(await run(`({position:window.__root.getState().camera.position.toArray(),target:window.__root.getState().controls.target.toArray()})`),camera);
  await pick(a,true);assert.equal(await count(),1);await pick(b,true);assert.equal(await count(),0);
  await pick(a);await pick(b,true);await pick(b);assert.equal(await count(),1);
  await at(await run(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:Math.round(r.right-10),y:Math.round(r.top+15)};})()`));assert.equal(await count(),0);
  checks.push(mode+': Shift-add-remove, plain-replace, empty-clear, all-highlights, no-camera-conflict');
 }
 await click('顶点选择');await pick([40,15,20]);
 await run(`[...document.querySelectorAll('.vertex-inspector button')].find(e=>e.textContent.includes('追加重合')).click()`);assert.equal(await count(),2);
 await click('移除 v5');assert.equal(await count(),1);
 await run(`(()=>{const s=document.querySelector('[aria-label="编辑子网格"]');s.value=${JSON.stringify(initial.objResources[0].meshes[1].id)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);assert.equal(await count(),0);
 assert.deepEqual(await snapshot(),initial);
 fs.writeFileSync(path.join(testDir,'multi.png'),(await win.webContents.capturePage()).toPNG());
 await run('document.activeElement?.blur()');await key('z',true);await wait(`!document.querySelector('[aria-label="选择 multi.obj"]')`);
 await key('z',true,true);await wait(`!!document.querySelector('[aria-label="选择 multi.obj"]')`);await delay(550);assert.deepEqual(await snapshot(),initial);
 checks.push('independent-coincident-members','submesh-reset','selection-no-project-history');
 if(selectionOnly) return checks;
 await click('选择 multi.obj');
 await input('旋转 X',20);await input('旋转 Y',35);await input('旋转 Z',-40);
 await input('缩放 X',.5);await input('缩放 Y',3);await input('缩放 Z',2);
 await key('f');await delay(100);
 const objectBase=await snapshot(), original=objectBase.objResources[0], close=(a,b,eps=1e-6)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<eps,`${a} != ${b}`));
 const world=state=>run(`(async()=>{const {objMatrix}=await import('/src/core/obj-transform.ts'),{Vector3}=await import('/node_modules/.vite/deps/three.js');const p=${JSON.stringify(state)},m=p.models.find(m=>m.id===${JSON.stringify(model.id)});return p.objResources.find(r=>r.id===m.resourceId).vertices.map(v=>new Vector3(...v.position).applyMatrix4(objMatrix(m)).toArray());})()`);
 const verifyPivot=async(state,indices)=>{
  const positions=await world(state), actual=await run(`${control}.object.position.toArray()`),
   expected=[0,1,2].map(axis=>indices.reduce((n,i)=>n+positions[i][axis],0)/indices.length);
  try { close(actual,expected); } catch(error) {
   if(process.env.OBJ_PIVOT_DIAGNOSTICS){
    const observation={actual,expected,indices,mode:await run(`document.querySelector('.vertex-inspector h3').textContent`)};
    observation.members=await run(`[...document.querySelectorAll('.mesh-selection-list button')].map(e=>e.textContent)`);
    observation.count=await run(`document.querySelector('[aria-label="已选元素数量"]').parentElement.textContent`);
    observation.scene=await run(`(()=>{const result=[];window.__root.getState().scene.traverse(o=>{
     if(o.name==='object-transform-gizmo'||o.name==='object-transform-pivot'||o.name.startsWith('selected-edit-'))
      result.push({name:o.name,uuid:o.uuid,position:o.position.toArray(),target:o.controls?.object?.position.toArray(),vertices:o.geometry?.getAttribute('position')?.count});
    });return result;})()`);
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    observation.afterTwoRaf=await run(`${control}.object.position.toArray()`);
    await delay(250);observation.after250ms=await run(`${control}.object.position.toArray()`);
    console.log('PIVOT_DIAGNOSTIC',JSON.stringify(observation));
   }
   throw error; // Diagnostics never retry, relax or replace the original assertion.
  }
 };
 await click('切换编辑模式');await wait(`!!document.querySelector('.vertex-inspector')`);
 let numeric;
 for(const [mode,a,b,indices] of [
  ['顶点',[40,15,20],[44,15,20],[0,1]],
  ['边',[42,15,20],[44,17,20],[0,1,2]],
  ['面',[40+8/3,15+4/3,20],[40+4/3,15+8/3,20],[0,1,2,3]],
 ]) {
  await click(mode+'选择');await delay(180);await pick(a);await click('移动 M');await wait(`!!(${control}?.object)`);
  await pick(b,true);assert.equal(await count(),2);await wait(`!!(${control}?.object)`);
  if(mode==='面') {
   // Faces 2 and 3 coincide but reference different logical vertices. A native
   // ray may legitimately pick either. Establish the intended 1+2 fixture via
   // the existing coincident-face selector before asserting its four-vertex pivot.
   const members=()=>run(`[...document.querySelectorAll('.mesh-selection-list button')].map(e=>e.getAttribute('aria-label')).sort()`);
   const picked=await members();
   assert.ok(JSON.stringify(picked)===JSON.stringify(['移除 三角面 1','移除 三角面 2'])||
    JSON.stringify(picked)===JSON.stringify(['移除 三角面 1','移除 三角面 3']),JSON.stringify(picked));
   if(picked.includes('移除 三角面 3')) {
    await click('移除 三角面 1');assert.equal(await count(),1);
    await run(`(()=>{const button=[...document.querySelectorAll('.vertex-inspector button')].find(e=>e.textContent.startsWith('切换重合面'));if(!button)throw new Error('Missing coincident-face selector');button.click();})()`);
    await pick(a,true);
    checks.push('coincident-face-alternative-resolved-through-existing-UI');
   }
   assert.deepEqual(await members(),['移除 三角面 1','移除 三角面 2']);
   assert.equal(await count(),2);
  }
  assert.equal(await run('window.__root.getState().controls.enabled'),true);await verifyPivot(objectBase,indices);
  for(const [axis,component] of [['X',0],['Y',1],['Z',2]]) {
   const s=await dragStart(axis), e=await dragMove(s);assert.deepEqual(await snapshot(),objectBase);
   assert.equal(await run(`document.querySelector('[aria-label="平移增量 X"]').disabled`),true);
   await release(e);const moved=await snapshot(), previous=await world(objectBase), after=await world(moved);
   const delta=after[indices[0]].map((n,i)=>n-previous[indices[0]][i]);assert.ok(Math.abs(delta[component])>.01);
   delta.forEach((n,i)=>{if(i!==component)assert.ok(Math.abs(n)<1e-6)});
   previous.forEach((p,i)=>close(after[i],p.map((n,j)=>n+(indices.includes(i)?delta[j]:0))));
   assert.deepEqual(moved.models,objectBase.models);assert.deepEqual(moved.objResources[0].meshes.map(m=>m.triangles),original.meshes.map(m=>m.triangles));
   await key('z',true);await delay(550);assert.deepEqual(await snapshot(),objectBase);
  }
  await input('平移增量 X',.25);await input('平移增量 Y',.5);await input('平移增量 Z',.75);
  assert.deepEqual(await snapshot(),objectBase); // pending numeric deltas do not edit geometry
  await run(`[...document.querySelectorAll('.group-translation button')].find(e=>e.textContent.includes('应用平移')).click()`);await delay(550);
  numeric=await snapshot();numeric.objResources[0].vertices.forEach((v,i)=>close(v.position,original.vertices[i].position.map((n,axis)=>n+(indices.includes(i)?[.25,.5,.75][axis]:0))));
  assert.deepEqual(numeric.models,objectBase.models);assert.deepEqual(numeric.objResources[0].meshes.map(m=>m.uvs),original.meshes.map(m=>m.uvs));
  for(const axis of ['X','Y','Z'])assert.equal(await run(`document.querySelector('[aria-label="平移增量 ${axis}"]').value`),'0');
  await verifyPivot(numeric,indices);
  await run(`[...document.querySelectorAll('.group-translation button')].find(e=>e.textContent.includes('应用平移')).click()`);await delay(80); // zero delta creates no entry
  await key('z',true);await delay(550);assert.deepEqual(await snapshot(),objectBase);
  await key('z',true,true);await delay(550);assert.deepEqual(await snapshot(),numeric);
  let s=await dragStart('Y'), end=await dragMove(s);await key('Escape');await release(end);assert.deepEqual(await snapshot(),numeric);
  if(mode!=='面') {await key('z',true);await delay(550);assert.deepEqual(await snapshot(),objectBase);}
  checks.push(mode+': unique-centroid, world-XYZ rotated/nonuniform group, atomic numeric delta, one-entry/no-op/undo-redo/cancel');
 }
 await click('移动 M');let s=await dragStart('Z'), end=await dragMove(s);await run(`window.dispatchEvent(new Event('blur'))`);await release(end);assert.deepEqual(await snapshot(),numeric);
 await click('移动 M');s=await dragStart('X');end=await dragMove(s);await click('边选择');await release(end);assert.equal(await count(),0);assert.deepEqual(await snapshot(),numeric);
 // Build a new group on the changed geometry and cancel it by entering playback preview.
 await click('面选择');await delay(180);
 await pick([40+8/3+.25,15+4/3+.5,20.75]);await pick([40+4/3+.25,15+8/3+.5,20.75],true);assert.equal(await count(),2);
 await click('移动 M');await wait(`!!(${control}?.object)`);
 fs.writeFileSync(path.join(testDir,'multi.png'),(await win.webContents.capturePage()).toPNG());
 s=await dragStart('Y');end=await dragMove(s);await click('预演方案');await release(end);await wait(`!document.querySelector('.vertex-inspector')`);assert.deepEqual(await snapshot(),numeric);
 assert.equal(await run(`document.querySelector('[aria-label="切换编辑模式"]').disabled`),true);await click('退出预演');
 assert.deepEqual(numeric.drones,before.drones);assert.deepEqual(numeric.viewpoints,before.viewpoints);
 checks.push('blur-element-mode-preview-cancel','camera-recovery','UAV-unchanged');
 const download=filename=>new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_e,item)=>{item.setSavePath(path.join(testDir,filename));item.once('done',(_e,state)=>state==='completed'?resolve():reject(new Error(state)));}));
 let saved=download('multi-project.json');await run(`document.querySelector('.right-topline .primary-button').click()`);await saved;assert.deepEqual(JSON.parse(fs.readFileSync(path.join(testDir,'multi-project.json'),'utf8')),numeric);
 saved=download('multi-edited.obj');await run(`document.querySelector('[aria-label="添加模型"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',bubbles:true}))`);await wait(`!!document.querySelector('[role="menuitem"]')`);
 await run(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('导出所选 OBJ')).click()`);await saved;
 const output=fs.readFileSync(path.join(testDir,'multi-edited.obj'),'utf8');
 await run(`(()=>{const i=document.querySelector('input[accept=".obj"]'),d=new DataTransfer();d.items.add(new File([${JSON.stringify(output)}],'multi-reimport.obj'));i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await wait(`!!document.querySelector('[aria-label="选择 multi-reimport.obj"]')`);await delay(550);
 const restored=await snapshot(), imported=restored.models.find(m=>m.name==='multi-reimport.obj'), expected=await world(numeric);assert.deepEqual(imported.position,[0,0,0]);
 restored.objResources.find(r=>r.id===imported.resourceId).vertices.forEach((v,i)=>close(v.position,expected[i]));
 await key('z',true);await delay(550);assert.deepEqual(await snapshot(),numeric);
 await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});await wait(`!!document.querySelector('[aria-label="选择 multi.obj"]')`);await setupRoot();assert.deepEqual(await snapshot(),numeric);
 checks.push('JSON-save-reload-no-selection-metadata','OBJ-actual-file-roundtrip');
 // Copy-on-write can exceed capacity; the entire group operation must roll back.
 await run(`(()=>{const p=${JSON.stringify(numeric)};p.models=p.models.filter(m=>m.kind==='obj');p.models.push({...p.models[0],id:'capacity-copy',name:'capacity-copy.obj',position:[100,30,0]});for(let n=0;n<50000;n++)p.objResources[0].vertices.push({id:'padding-'+n+'xxxxxxxxxxxxxxxxxxxx',position:[0,0,0]});const i=document.querySelector('input[accept=".json,.p15"]'),d=new DataTransfer();d.items.add(new File([JSON.stringify(p)],'group-capacity.json'));i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await wait(`!!document.querySelector('[aria-label="选择 capacity-copy.obj"]')`);await click('选择 multi.obj');await key('f');await delay(100);await click('切换编辑模式');await wait(`!!window.__root.getState().scene.getObjectByName('edit-vertices')`);await delay(180);
 await pick(numeric.objResources[0].vertices[0].position);await pick(numeric.objResources[0].vertices[1].position,true);assert.equal(await count(),2);
 await input('平移增量 Z',.2);await run(`[...document.querySelectorAll('.group-translation button')].find(e=>e.textContent.includes('应用平移')).click()`);await wait(`document.body.textContent.includes('变换未应用')`);
 await click('切换编辑模式');await run('document.activeElement?.blur()');await key('z',true);await wait(`!document.querySelector('[aria-label="选择 capacity-copy.obj"]')`);await delay(550);assert.deepEqual(await snapshot(),numeric);
 checks.push('whole-group-capacity-rollback-no-extra-history');
 return checks;
};
