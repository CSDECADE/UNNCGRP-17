const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const testDir = fs.mkdtempSync(path.join(tmpdir(), 'aero-transform-ui-'));
app.setPath('userData', path.join(testDir, 'profile'));
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const timeout = setTimeout(() => { console.error('Transform UI test timed out'); app.exit(1); }, ['audit','memory','release'].includes(process.argv[3])?300000:90000);
app.whenReady().then(async () => {
 const win = new BrowserWindow({ show: false, width: 1440, height: 1000,
  webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
 const errors = []; let phase='startup';
 win.webContents.on('console-message', event => { if(event.level==='error') errors.push(event.message); });
 const run = code => win.webContents.executeJavaScript(code, true);
 const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
 const wait = async code => { for(let i=0;i<200;i++){ if(await run(code)) return; await delay(30); } throw new Error('Timed out: '+code); };
 const click = label => run(`document.querySelector('[aria-label="${label}"]').click()`);
 const key = (key, ctrl=false, shift=false) => run(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:${ctrl},shiftKey:${shift},bubbles:true}))`);
 const snapshot = () => run("JSON.parse(localStorage.getItem('p15.project.v1'))");
 const model = async () => (await snapshot()).models.find(m=>m.kind==='obj');
 const close = (actual, expected, eps=1e-5) => actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<eps,`${actual} != ${expected}`));
 const input = async (label, value) => {
  phase='input '+label;
  win.webContents.focus();
  await run(`(()=>{const e=document.querySelector('input[aria-label="${label}"]');e.focus();e.select();})()`);
  await win.webContents.insertText(String(value));
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await delay(550);
 };
 const setupRoot = () => run(`(async()=>{const fiber=await import('/node_modules/.vite/deps/@react-three_fiber.js');for(let i=0;i<200;i++){const root=fiber._roots.get(document.querySelector('canvas'));if(root?.store){window.__root=root.store;return;}await new Promise(r=>setTimeout(r,25));}throw new Error('Fiber root was not mounted');})()`);
 const control = "window.__root.getState().scene.getObjectByName('object-transform-gizmo')?.controls";
 const dragging = `${control}?.dragging`;
 const moveTo = async point => { win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x),y:Math.round(point.y)}); await delay(30); };
 // Project actual installed TransformControls picker geometry to find an unobstructed handle.
 const handle = axis => run(`(()=>{const root=window.__root.getState(), c=${control}; if(!c) throw new Error('No gizmo');
  root.scene.updateMatrixWorld(true); const picker=c._gizmo.picker[c.mode], canvas=root.gl.domElement.getBoundingClientRect();
  const origin=c.object.position.clone().project(root.camera); const screen=v=>({x:canvas.x+(v.x+1)*canvas.width/2,y:canvas.y+(1-v.y)*canvas.height/2});
  for(const mesh of picker.children.filter(m=>m.name===${JSON.stringify(axis)})){
   const attr=mesh.geometry?.getAttribute('position'); if(!attr)continue;
   mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
   const candidates=[box.getCenter(c.object.position.clone())];
   for(let i=0;i<attr.count;i+=Math.max(1,Math.floor(attr.count/100)))candidates.push(c.object.position.clone().fromBufferAttribute(attr,i));
   for(const local of candidates){const projected=local.applyMatrix4(mesh.matrixWorld).project(root.camera);
    const p=screen(projected);if(${JSON.stringify(axis)}==='XYZ'&&Math.hypot(p.x-screen(origin).x,p.y-screen(origin).y)<3)continue;if(projected.z>1||p.x<canvas.x+15||p.x>canvas.right-15||p.y<canvas.y+15||p.y>canvas.bottom-15)continue;
    for(let ox=-3;ox<=3;ox++)for(let oy=-3;oy<=3;oy++){
     const safe={x:Math.round(p.x)+ox,y:Math.round(p.y)+oy};let inside=true;
     for(const [tx,ty] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]){
      c.pointerHover({x:(safe.x+tx-canvas.x)/canvas.width*2-1,y:1-(safe.y+ty-canvas.y)/canvas.height*2,button:-1});
      if(c.axis!==${JSON.stringify(axis)}){inside=false;break;}
     }
     if(inside)return {...safe,origin:screen(origin)};
    }
   }
  }throw new Error('No pickable handle '+${JSON.stringify(axis)}+' mode '+c.mode);})()`);
 const dragStart = async axis => {
  phase='drag '+axis; await wait(`!!(${control}?.object)`); await delay(50);
  const point=await handle(axis);await moveTo(point);
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',x:Math.round(point.x),y:Math.round(point.y),clickCount:1});
  await wait(dragging);
  assert.equal(await run('window.__root.getState().controls.enabled'),false);
  return point;
 };
 const dragMove = async (start, rotate=false) => {
  const dx=start.x-start.origin.x, dy=start.y-start.origin.y;
  const norm=Math.hypot(dx,dy)||1;
  const end={x:start.x+(rotate?-dy:dx)/norm*45,y:start.y+(rotate?dx:dy)/norm*45};
  for(let i=1;i<=6;i++){
   win.webContents.sendInputEvent({type:'mouseMove',button:'left',x:Math.round(start.x+(end.x-start.x)*i/6),y:Math.round(start.y+(end.y-start.y)*i/6)});
   await delay(20);
  }
  return end;
 };
 const release = async point => {
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',x:Math.round(point.x),y:Math.round(point.y),clickCount:1});
  await wait(`!(${dragging})`);await delay(550);
  assert.equal(await run('window.__root.getState().controls.enabled'),true);
 };
 try {
  await win.loadURL(process.argv[2]||'http://127.0.0.1:5176/');
  await wait("!!document.querySelector('canvas') && !!localStorage.getItem('p15.project.v1')");
  await setupRoot();
  const before=await snapshot();
  if(['builtin','export','edit-selection','edit','elements','multi-selection','multi','audit','memory','release'].includes(process.argv[3])){
   const cases=process.argv[3]==='release'?'./verify-obj-release-cases.cjs':process.argv[3]==='memory'?'./benchmark-history-ui-cases.cjs':process.argv[3]==='audit'?'./benchmark-obj-editor-ui-cases.cjs':process.argv[3].startsWith('multi')?'./verify-mesh-multiselect-cases.cjs':process.argv[3]==='elements'?'./verify-mesh-elements-cases.cjs':process.argv[3].startsWith('edit')?'./verify-mesh-edit-cases.cjs':process.argv[3]==='export'?'./verify-obj-export-cases.cjs':'./verify-builtin-transform-cases.cjs';
   const checks=await require(cases)({win,run,wait,click,key,snapshot,delay,input,
    dragStart,dragMove,release,setupRoot,control,before,testDir,selectionOnly:['edit-selection','multi-selection'].includes(process.argv[3])});
   assert.equal(errors.length,0,JSON.stringify(errors));
   const screenshot=process.argv[3]==='release'?'release.png':process.argv[3]==='memory'?'memory.png':process.argv[3]==='audit'?'audit.png':process.argv[3].startsWith('multi')?'multi.png':process.argv[3]==='elements'?'elements.png':process.argv[3]==='edit-selection'?'edit-selection.png':process.argv[3]==='export'?'export.png':process.argv[3]==='edit'?'edit.png':'builtins.png';
   console.log(JSON.stringify({passed:true,checks,screenshot:path.join(testDir,screenshot)}));
   clearTimeout(timeout);app.exit(0);return;
  }
  const obj=fs.readFileSync(path.join(__dirname,'../tests/fixtures/obj-building.obj'),'utf8');
  await run(`(()=>{const input=document.querySelector('input[accept=".obj"]'), data=new DataTransfer();data.items.add(new File([${JSON.stringify(obj)}],'transform.obj'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait("!!document.querySelector('input[aria-label=\"位置 X\"]')");await delay(550);
  const initial=await model(), originalResources=(await snapshot()).objResources;
  await click('移动 M');await wait(`!!(${control})`);
  // Genuine native pointer translation; numerical fields must track the draft before commit.
  const start=await dragStart('X'), end=await dragMove(start);
  const liveX=Number(await run("document.querySelector('input[aria-label=\"位置 X\"]').value"));
  assert.ok(Math.abs(liveX-initial.position[0])>.1);
  close((await model()).position,initial.position); // no autosave of a draft
  assert.equal(await run("document.querySelector('input[aria-label=\"位置 X\"]').disabled"),true);
  await release(end);
  const translated=await model();assert.ok(Math.abs(translated.position[0]-initial.position[0])>.1);
  assert.equal(await run("document.querySelector('[aria-label=\"选择 transform.obj\"]').getAttribute('aria-pressed')"),'true');
  await run('document.activeElement?.blur()');await key('z',true);await delay(550);close((await model()).position,initial.position);
  close(await run(`window.__root.getState().scene.getObjectByName('model-${initial.id}').position.toArray()`),initial.position);
  await key('z',true,true);await delay(550);close((await model()).position,translated.position);
  // Escape before pointer-up must discard the live draft, release orbit, and leave no undo entry.
  const cancelStart=await dragStart('Y'), cancelEnd=await dragMove(cancelStart);
  await key('Escape');await release(cancelEnd);close((await model()).position,translated.position);
  assert.equal(await run(`!!(${control})`),false);
  await key('z',true);await delay(550);close((await model()).position,initial.position);
  await key('z',true,true);await delay(550);close((await model()).position,translated.position);
  // Numeric edits commit through the same transaction and update the scene/gizmo.
  await input('位置 X',12.3456);await input('位置 Y',-3.25);await input('位置 Z',4.5);
  close((await model()).position,[12.3456,-3.25,4.5]);
  await input('旋转 X',25);await input('旋转 Y',35);await input('旋转 Z',-15);
  await input('缩放 X',1.5);await input('缩放 Y',.75);await input('缩放 Z',2);
  const numeric=await model();close(numeric.rotationXYZ,[25,35,-15]);close(numeric.scale,[1.5,.75,2]);
  await click('移动 M');await wait(`!!(${control}?.object)`);
  await run("document.querySelector('input[aria-label=\"位置 X\"]').focus();document.querySelector('input[aria-label=\"位置 X\"]').select()");
  await win.webContents.insertText('999');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await delay(550);close((await model()).position,numeric.position);
  assert.equal(await run(`!!(${control}?.object)`),true);

  close(await run(`window.__root.getState().scene.getObjectByName('model-${initial.id}').scale.toArray()`),numeric.scale);
  // A pending numeric edit must commit before a native gizmo gesture starts.
  await run("document.querySelector('input[aria-label=\"位置 X\"]').focus();document.querySelector('input[aria-label=\"位置 X\"]').select()");
  await win.webContents.insertText(String(numeric.position[0]+.001));
  const pendingStart=await dragStart('X'), pendingEnd=await dragMove(pendingStart);await release(pendingEnd);
  await key('z',true);await delay(550);close((await model()).position,[numeric.position[0]+.001,numeric.position[1],numeric.position[2]]);
  await key('z',true);await delay(550);close((await model()).position,numeric.position);
  // Native local rotation and scale, including uniform XYZ scale.
  await click('选择 transform.obj');await key('f');await click('旋转 R');await wait(`!!(${control})`);
  const rotateStart=await dragStart('Z'), rotateEnd=await dragMove(rotateStart,true);await release(rotateEnd);
  const rotated=await model();assert.notDeepEqual(rotated.rotationXYZ,numeric.rotationXYZ);
  await key('z',true);await delay(550);close((await model()).rotationXYZ,numeric.rotationXYZ);
  await key('z',true,true);await delay(550);close((await model()).rotationXYZ,rotated.rotationXYZ);
  await click('缩放 K');
  const scaleStart=await dragStart('X'), scaleEnd=await dragMove(scaleStart);await release(scaleEnd);
  const scaled=await model();assert.ok(Math.abs(scaled.scale[0]-rotated.scale[0])>.01);
  close(scaled.scale.slice(1),rotated.scale.slice(1));
  const uniformStart=await dragStart('XYZ'), uniformEnd=await dragMove(uniformStart);await release(uniformEnd);
  const uniform=await model();const ratios=uniform.scale.map((n,i)=>n/scaled.scale[i]);close(ratios,[ratios[0],ratios[0],ratios[0]]);
  assert.ok(Math.abs(ratios[0]-1)>.01);
  await click('锁定 transform.obj');await wait(`!(${control})`);
  assert.equal(await run("document.querySelector('input[aria-label=\"旋转 X\"]').disabled"),true);
  await click('解锁 transform.obj');await wait(`!!(${control})`);
  await click('隐藏 transform.obj');await wait(`!(${control})`);await click('显示 transform.obj');await wait(`!!(${control})`);
  await click('预演方案');await wait(`!(${control})`);
  assert.equal(await run("document.querySelector('input[aria-label=\"缩放 X\"]').disabled"),true);
  await click('退出预演');await click('缩放 K');await wait(`!!(${control}?.object)`);await key('f');await delay(100);
  await click('多机路径分析');await wait("!!document.querySelector('.route-analysis input[type=file]')");
  const plan=JSON.stringify({version:1,viewpoints:before.viewpoints});
  await run(`(()=>{const input=document.querySelector('.route-analysis input[type=file]'),data=new DataTransfer();data.items.add(new File([${JSON.stringify(plan)}],'candidate.json'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait("!!document.querySelector('.candidate-banner')");await click('关闭弹窗');
  assert.equal(await run(`!!(${control})`),false);
  assert.equal(await run("document.querySelector('input[aria-label=\"位置 X\"]').disabled"),true);
  await run("[...document.querySelectorAll('.candidate-banner button')].find(e=>e.textContent.includes('取消')).click()");
  await click('缩放 K');await wait(`!!(${control}?.object)`);
  await wait("JSON.parse(localStorage.getItem('p15.project.v1')).models.some(m=>m.kind==='obj'&&m.visible&&!m.locked)");
  const transformed=await snapshot();
  assert.deepEqual(transformed.objResources,originalResources);
  assert.deepEqual(transformed.drones,before.drones);assert.deepEqual(transformed.viewpoints,before.viewpoints);
  fs.writeFileSync(path.join(testDir,'transformed.png'),(await win.webContents.capturePage()).toPNG());
  const saved=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_e,item)=>{item.setSavePath(path.join(testDir,'transformed.json'));item.once('done',(_e,state)=>state==='completed'?resolve():reject(new Error(state)));}));
  await run("document.querySelector('.right-topline .primary-button').click()");await saved;
  const disk=JSON.parse(fs.readFileSync(path.join(testDir,'transformed.json'),'utf8'));assert.deepEqual(disk,transformed);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});
  await wait("!!document.querySelector('[aria-label=\"选择 transform.obj\"]')");await setupRoot();await wait(`!!window.__root.getState().scene.getObjectByName('model-${initial.id}')`);await click('选择 transform.obj');
  close((await model()).rotationXYZ,uniform.rotationXYZ);close((await model()).scale,uniform.scale);
  close(await run(`window.__root.getState().scene.getObjectByName('model-${initial.id}').scale.toArray()`),uniform.scale);
  close(await run(`window.__root.getState().scene.getObjectByName('model-${initial.id}').position.toArray()`),uniform.position);
  phase='restored render transform';
  const expectedQuaternion=await run(`(async()=>{const m=await import('/src/core/obj-transform.ts');return m.objQuaternion(${JSON.stringify(uniform.rotationXYZ)}).toArray()})()`);
  close(await run(`window.__root.getState().scene.getObjectByName('model-${initial.id}').quaternion.toArray()`),expectedQuaternion);
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify({passed:true,screenshot:path.join(testDir,'transformed.png'),checks:['native-translation','single-gesture-undo-redo','live-inspector-sync','cancel','numeric-XYZ','pending-input-before-drag','native-rotation','non-uniform-scale','uniform-scale','locked-hidden-preview-candidate','geometry-unchanged','save-reload','UAV-unchanged','camera-recovery']}));
  clearTimeout(timeout);app.exit(0);
 } catch(error){console.error('phase',phase);console.error(error);console.error('rendererErrors',errors);fs.writeFileSync(path.join(testDir,'failure.png'),(await win.webContents.capturePage()).toPNG());console.error(testDir);clearTimeout(timeout);app.exit(1);}
});
