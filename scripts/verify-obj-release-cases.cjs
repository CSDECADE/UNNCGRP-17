const assert=require('node:assert/strict'),{createHash}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,run,wait,delay,click,key,input,dragStart,dragMove,release,setupRoot,testDir})=>{
 const scenario=process.env.OBJ_RELEASE_SCENARIO||'authored',record={scenario,conditions:{build:'Vite development',hiddenWindow:true},checks:[]};
 const init=()=>run(`(()=>{const s=window.__release5d={};s.editor=()=>{const el=document.querySelector('main'),k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));for(let n=el[k];n;n=n.return)for(const f of[n,n.alternate])for(let d=f?.dependencies?.firstContext;d;d=d.next){const e=d.memoizedValue;if(e?.readProject&&e?.beginMeshTransform)return e;}throw new Error('Editor not found')};})()`);
 const frame=code=>run(`(async()=>{${code};await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
 const project=()=>run(`window.__release5d.editor().readProject()`);
 const upload=async(text,name,selector='input[accept=".obj"]')=>{
  await run(`(()=>{window.__release5d.importStart=performance.now();const i=document.querySelector(${JSON.stringify(selector)}),d=new DataTransfer();d.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(name)}));i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 };
 const download=filename=>new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_e,item)=>{item.setSavePath(path.join(testDir,filename));item.once('done',(_e,state)=>state==='completed'?resolve():reject(new Error(state)));}));
 const menuExport=async()=>{await run(`document.querySelector('[aria-label="添加模型"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerType:'mouse',bubbles:true}))`);await wait(`!!document.querySelector('[role="menuitem"]')`);await run(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('导出所选 OBJ')).click()`);};
 await init();const initial=await project();
 const fixtures=await import('./obj-release-fixtures.mjs');
 if(scenario==='authored') {
  const raw=fs.readFileSync(path.join(__dirname,'../tests/fixtures/obj-release/kaykit/building_H.obj'),'utf8');
  await upload(raw,'raw-building_H.obj');await wait(`document.body.textContent.includes('mtllib')`);
  assert.deepEqual(await project(),initial);record.checks.push('raw-authored-OBJ-rejected-without-mutation');
  await upload(fixtures.conditionAuthoredObj(raw).text,'release-building.obj');
 }else if(scenario==='capacity')await upload(fixtures.architecturalObj({windows:1320}),'release-building.obj');
 else if(scenario==='stress') {
  await run(`(async()=>{const {auditGrid}=await import('/scripts/obj-audit-fixtures.mjs'),{exportSelectedObj}=await import('/src/features/obj-export/obj.ts');const f=auditGrid(150,{attributes:true}),out=exportSelectedObj(f.project,{type:'model',id:f.model.id}),i=document.querySelector('input[accept=".obj"]'),d=new DataTransfer();window.__release5d.importStart=performance.now();d.items.add(new File([out.text],'release-building.obj'));i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 }else throw new Error('Unknown release scenario');
 await wait(`!!window.__release5d.editor().readProject().models.find(m=>m.name==='release-building.obj')`);
 await wait(`(()=>{const e=window.__release5d.editor(),p=e.readProject(),m=p.models.find(m=>m.name==='release-building.obj'),r=p.objResources.find(r=>r.id===m.resourceId),g=window.__root.getState().scene.getObjectByName('model-'+m.id);if(!g)return false;let corners=0;g.traverse(o=>{if(o.userData.objMeshId)corners+=o.geometry.getAttribute('position').count});if(corners!==r.meshes.reduce((s,m)=>s+m.triangles.length,0))return false;window.__release5d.importRenderedMs=performance.now()-window.__release5d.importStart;return true})()`);
 record.importToRenderGeometryMs=await run(`window.__release5d.importRenderedMs`);
 await delay(750);record.autosaveStatus=await run(`window.__release5d.editor().autosaveStatus`);
 let p=await project(),m=p.models.find(m=>m.name==='release-building.obj');record.projectBytes=Buffer.byteLength(JSON.stringify(p));
 await run(`window.__release5d.modelId=${JSON.stringify(m.id)}`);
 const selectGroup=async(kind,count=3)=>{
  await run(`(async()=>{const s=window.__release5d,e=s.editor(),p=e.readProject(),m=p.models.find(m=>m.id===s.modelId),r=p.objResources.find(r=>r.id===m.resourceId),mesh=r.meshes.find(m=>m.name==='Facade0')??r.meshes[0],q=await import('/src/core/mesh-edit.ts');
   const t=performance.now(),edges=q.meshEdges(r,mesh.id);if(s.firstTopologyMs===undefined)s.firstTopologyMs=performance.now()-t;
   const base={modelId:m.id,meshId:mesh.id},kind=${JSON.stringify(kind)},count=${count};let elements=kind==='vertex'?r.vertices.slice(0,count).map(v=>({...base,vertexId:v.id})):kind==='face'?Array.from({length:count},(_,triangle)=>({...base,kind,triangle})):Array.from({length:Math.min(count,edges.length)},(_,i)=>({...base,kind,edgeIds:edges[Math.floor(i*edges.length/Math.min(count,edges.length))].ids}));
   e.selectMeshElement(q.withSelectionElements(elements[0],elements));})()`);
  await frame('');
 };
 if(scenario==='stress') {
  await run(`window.__release5d.editor().enterEditMode()`);await selectGroup('edge',100);
  const digest=p=>createHash('sha256').update(JSON.stringify(p.objResources)).digest('hex');const base=digest(await project());
  for(let i=0;i<60;i++){await frame(`const e=window.__release5d.editor();if(!e.beginMeshTransform()||!e.updateTransform({elementDelta:[0,0,.0001]})||!e.finishTransform())throw new Error('History setup failed')`);await delay(i%20===19?750:30);}
  const tip=digest(await project());await delay(750);
  const interval=Number(process.env.OBJ_RELEASE_KEY_INTERVAL||50),batch=Number(process.env.OBJ_RELEASE_KEY_BATCH||0);
  record.conditions={...record.conditions,nativeRendererKeyEvents:true,intervalMs:interval,batch,triangles:45000,historyEntries:60};
  await run(`(()=>{const s=window.__release5d;s.phase='undo';s.errors=[];s.keys=0;s.frames=[];const original=console.error;console.error=(...a)=>{if(a.some(v=>String(v).includes('Maximum update depth')))s.errors.push({phase:s.phase,stack:new Error().stack});original.apply(console,a)};s.restore=()=>{console.error=original;cancelAnimationFrame(s.raf)};let last=performance.now();const tick=t=>{s.frames.push(t-last);last=t;s.raf=requestAnimationFrame(tick)};s.raf=requestAnimationFrame(tick);document.querySelector('canvas').focus();s.count=e=>{if(e.key.toLowerCase()==='z'&&e.ctrlKey)s.keys++};window.addEventListener('keydown',s.count,true);})()`);
  try {
   for(const redo of [false,true]) {
    await run(`window.__release5d.phase=${JSON.stringify(redo?'redo':'undo')}`);
    for(let i=0;i<60;i++){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Z',modifiers:redo?['control','shift']:['control'],isAutoRepeat:i>0});await delay(batch&&i%batch===batch-1?750:interval);}
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Z',modifiers:redo?['control','shift']:['control']});await delay(1000);
    record.stress=await run(`({warnings:window.__release5d.errors,keys:window.__release5d.keys,RAFIntervals:window.__release5d.frames})`);fs.writeFileSync(path.join(testDir,'release.json'),JSON.stringify(record,null,2));assert.equal(digest(await project()),redo?tip:base);
   }
   record.stress=await run(`({warnings:window.__release5d.errors,keys:window.__release5d.keys,RAFIntervals:window.__release5d.frames})`);
   assert.equal(record.stress.keys,120);record.checks.push('native-undo60-redo60-exact-geometry');
  }finally{await run(`window.__release5d.restore();window.removeEventListener('keydown',window.__release5d.count,true)`);}
 }else if(scenario==='capacity') {
  const original=JSON.stringify(await project());assert.ok(record.projectBytes>4_980_000&&record.projectBytes<5_000_000);
  await run(`window.__release5d.editor().enterEditMode()`);await selectGroup('edge',100);
  const finished=await run(`(()=>{const e=window.__release5d.editor();if(!e.beginMeshTransform()||!e.updateTransform({elementDelta:[0,0,.001]}))throw new Error('Valid preview setup failed');return e.finishTransform()})()`);
  assert.equal(finished,false);assert.equal(JSON.stringify(await project()),original);record.checks.push('near-limit-group-commit-rejected-atomically');
  await run(`window.__release5d.editor().exitEditMode()`);await frame('');
  let saved=download('near-project.json');await run(`document.querySelector('.right-topline .primary-button').click()`);await saved;
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(testDir,'near-project.json'),'utf8')),JSON.parse(original));
  await upload(fixtures.architecturalObj({windows:1350}),'over.obj');await wait(`document.body.textContent.includes('OBJ 导入失败')`);assert.equal(JSON.stringify(await project()),original);
  await run(`(()=>{const e=window.__release5d.editor();if(!e.beginTransform({type:'model',id:window.__release5d.modelId})||!e.updateTransform({rotationXYZ:[20,35,-40],scale:[.5,1.5,2]})||!e.finishTransform())throw new Error('Object transform failed')})()`);await frame('');
  const transformed=JSON.stringify(await project());let downloads=0;const counter=()=>downloads++;win.webContents.session.on('will-download',counter);
  try{await menuExport();await wait(`[...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('导出失败'))`);await delay(200);assert.equal(downloads,0);assert.equal(JSON.stringify(await project()),transformed);}finally{win.webContents.session.removeListener('will-download',counter);}
  record.exportError=await run(`[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent).filter(t=>t.includes('导出失败'))`);
  await upload(fs.readFileSync(path.join(testDir,'near-project.json'),'utf8'),'near-project.json','input[accept=".json,.p15"]');await delay(800);assert.equal(JSON.stringify(await project()),original);
  record.checks.push('near-limit-download-restore','over-limit-import-rollback','baked-export-budget-failure-no-write');
 }else {
  await input('位置 X',100);await input('位置 Y',20);await key('f');await delay(200);
  for(const [label,axis,rotate]of [['移动 M','X',false],['旋转 R','Y',true],['缩放 K','X',false]]){await click(label);const s=await dragStart(axis);await release(await dragMove(s,rotate));}
  for(const [label,value]of [['旋转 X',20],['旋转 Y',35],['旋转 Z',-40],['缩放 X',.5],['缩放 Y',1.5],['缩放 Z',2]])await input(label,value);
  await click('切换编辑模式');
  for(const [kind,label]of [['vertex','顶点选择'],['edge','边选择'],['face','面选择']]) {
   await click(label);await selectGroup(kind,kind==='face'?2:3);await click('移动 M');
   const before=JSON.stringify((await project()).objResources),s=await dragStart('X');await release(await dragMove(s));
   assert.notEqual(JSON.stringify((await project()).objResources),before);
   await key('z',true);await delay(550);assert.equal(JSON.stringify((await project()).objResources),before);
   await key('z',true,true);await delay(550);
  }
  const beforeCancel=JSON.stringify((await project()).objResources);await click('移动 M');let s=await dragStart('Y'),end=await dragMove(s);await key('Escape');await release(end);assert.equal(JSON.stringify((await project()).objResources),beforeCancel);
  await run(`window.__release5d.editor().exitEditMode()`);await frame('');
  record.firstTopologyMs=await run(`window.__release5d.firstTopologyMs??null`);const final=await project();assert.deepEqual(final.drones,initial.drones);assert.deepEqual(final.viewpoints,initial.viewpoints);
  let saved=download('release-project.json');await run(`document.querySelector('.right-topline .primary-button').click()`);await saved;
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(testDir,'release-project.json'),'utf8')),JSON.parse(JSON.stringify(final)));
  saved=download('release-edited.obj');await menuExport();await saved;
  await upload(fs.readFileSync(path.join(testDir,'release-edited.obj'),'utf8'),'roundtrip-release.obj');await wait(`!!document.querySelector('[aria-label="选择 roundtrip-release.obj"]')`);await delay(750);
  const round=await project(),model=final.models.find(x=>x.id===m.id),resource=final.objResources.find(r=>r.id===model.resourceId),newModel=round.models.find(x=>x.name==='roundtrip-release.obj'),newResource=round.objResources.find(r=>r.id===newModel.resourceId);
  const {Vector3,Matrix4,Quaternion,Euler}=await import('three');const matrix=new Matrix4().compose(new Vector3(...model.position),new Quaternion().setFromEuler(new Euler(...(model.rotationXYZ??[0,model.rotation,0]).map(n=>n*Math.PI/180),'XYZ')),new Vector3(...(model.scale??[1,1,1])));
  resource.vertices.forEach((v,i)=>assert.ok(new Vector3(...v.position).applyMatrix4(matrix).distanceTo(new Vector3(...newResource.vertices[i].position))<1e-8));
  assert.deepEqual(newModel.position,[0,0,0]);assert.deepEqual(newResource.meshes.map(x=>x.triangles),resource.meshes.map(x=>x.triangles));
  await upload(fs.readFileSync(path.join(testDir,'release-project.json'),'utf8'),'release-project.json','input[accept=".json,.p15"]');await delay(800);
  assert.deepEqual(JSON.parse(JSON.stringify(await project())),JSON.parse(JSON.stringify(final)));
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await setupRoot();await init();await wait(`!!document.querySelector('[aria-label="选择 release-building.obj"]')`);
  assert.deepEqual(JSON.parse(JSON.stringify(await project())),JSON.parse(JSON.stringify(final)));
  await click('选择 release-building.obj');await key('f');await delay(400);
  record.checks.push('authored-derivative-native-object-TRS','authored-derivative-vertex-edge-face-native-groups','undo-redo-cancel','actual-JSON-OBJ-download-restore-reimport','baked-once-world-equivalence','UAV-data-unchanged');
 }
 record.firstTopologyMs??=await run(`window.__release5d.firstTopologyMs??null`);
 fs.writeFileSync(path.join(testDir,'release.json'),JSON.stringify(record,null,2));fs.writeFileSync(path.join(testDir,'release.png'),(await win.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({releaseReport:path.join(testDir,'release.json'),scenario,checks:record.checks}));return record.checks;
};
