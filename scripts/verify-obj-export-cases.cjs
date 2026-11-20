const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({win,run,wait,click,key,snapshot,delay,input,dragStart,dragMove,release,control,before,testDir}) => {
 const checks=[];
 const openMenu = async () => {
  await run(`document.querySelector('[aria-label="添加模型"]').dispatchEvent(new PointerEvent('pointerdown',{button:0,ctrlKey:false,pointerType:'mouse',bubbles:true}))`);
  await wait(`!![...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('导出所选 OBJ'))`);
 };
 const exportClick = async () => {
  await openMenu();
  await run(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('导出所选 OBJ')).click()`);
  await delay(100);
 };
 const disabled = async () => {
  await openMenu();
  assert.equal(await run(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('导出所选 OBJ')).getAttribute('aria-disabled')`),'true');
  await key('Escape');await delay(80);
 };
 await disabled();
 const importFile = async (text,name) => {
  await run(`(()=>{const i=document.querySelector('input[accept=".obj"]'),d=new DataTransfer();d.items.add(new File([${JSON.stringify(text)}],${JSON.stringify(name)}));i.files=d.files;i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`!!document.querySelector('[aria-label="选择 ${name}"]')`);await delay(550);
 };
 const source=`v 10 0 2\nv 12 0 2\nv 12 2 2\nv 10 2 2\nv 10 0 2\nvt 0 0\nvt 1 0\nvt 1 1\nvt .5 0\nvn 1 1 1\nvn -1 0 1\no Front\nf 1/1/1 2/2/1 3/3/1\nf 1/4/2 3/3/1 4/1/2\no Back\nf 5 4 3`;
 await importFile(source,'export-source.obj');
 const initial=await snapshot();
 await click('锁定 export-source.obj');await click('隐藏 export-source.obj');
 await openMenu();
 assert.notEqual(await run(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('导出所选 OBJ')).getAttribute('aria-disabled')`),'true');
 await key('Escape');await click('显示 export-source.obj');await click('解锁 export-source.obj');
 await delay(550);assert.deepEqual(await snapshot(),initial);
 await input('位置 X',7);await input('位置 Y',-3);await input('旋转 X',23);await input('旋转 Y',35);await input('旋转 Z',-41);
 await input('缩放 X',.5);await input('缩放 Y',3);await input('缩放 Z',1.25);
 await click('移动 M');await wait(`!!(${control}?.object)`);await key('f');await delay(100);
 const activeStart=await dragStart('X'), activeEnd=await dragMove(activeStart);
 await openMenu();
 assert.equal(await run(`[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('导出所选 OBJ')).getAttribute('aria-disabled')`),'true');
 await key('Escape');await release(activeEnd);await key('Escape');await delay(100);
 // Native cancellation/error results traverse the same renderer adapter as the desktop preload.
 const checkpoint=await snapshot();
 await run(`window.p15Desktop={onCommand:()=>()=>{},saveObjFile:async()=>null};void 0`);
 await exportClick();await wait(`document.body.textContent.includes('已取消 OBJ 导出')`);
 assert.deepEqual(await snapshot(),checkpoint);
 await run(`window.p15Desktop.saveObjFile=async()=>{throw new Error('AERO_FILE_PERMISSION')};void 0`);
 await exportClick();await wait(`document.body.textContent.includes('无法访问该位置')`);
 assert.deepEqual(await snapshot(),checkpoint);
 await run('delete window.p15Desktop');
 checks.push('active-transaction-disabled','hidden-locked-read-only-export','native-cancel-and-error-state-unchanged');
 const download=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{
  assert.equal(item.getFilename(),'export-source.obj');
  item.setSavePath(path.join(testDir,'edited.obj'));
  item.once('done',(_e,state)=>state==='completed'?resolve():reject(new Error(state)));
 }));
 await exportClick();await download;
 const text=fs.readFileSync(path.join(testDir,'edited.obj'),'utf8');
 assert.deepEqual(await snapshot(),checkpoint);
 const edited=checkpoint.models.find(m=>m.kind==='obj');
 await run('document.activeElement?.blur()');await key('z',true);await delay(550);
 assert.notDeepEqual((await snapshot()).models.find(m=>m.id===edited.id).scale,edited.scale);
 await key('z',true,true);await delay(550);assert.deepEqual(await snapshot(),checkpoint);
 checks.push('browser-plain-text-download','export-does-not-create-history');
 // Compare actual rendered triangle corners and CPU attributes against the baked file.
 const positions = id => run(`(()=>{const root=window.__root.getState().scene.getObjectByName('model-${id}'), result=[];root.updateWorldMatrix(true,true);root.traverse(o=>{if(o.isMesh&&o.geometry?.getAttribute('position')&&o.material.isMeshStandardMaterial){const a=o.geometry.getAttribute('position');for(let i=0;i<a.count;i++)result.push(o.position.clone().fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).toArray());}});return result;})()`);
 const originalPositions=await positions(edited.id);
 assert.equal(originalPositions.length,9);
 const geometry = await run(`(async()=>{const {parseObj}=await import('/src/features/obj-import/obj.ts');return parseObj(${JSON.stringify(text)},'edited.obj');})()`);
 const originalResource=checkpoint.objResources.find(r=>r.id===edited.resourceId);
 assert.equal(geometry.vertices.length,originalResource.vertices.length);
 assert.deepEqual(geometry.meshes.map(m=>m.triangles),originalResource.meshes.map(m=>m.triangles));
 assert.deepEqual(geometry.meshes.map(m=>m.uvs),originalResource.meshes.map(m=>m.uvs));
 await importFile(text,'reimported.obj');
 const after=await snapshot(), restored=after.models.find(m=>m.name==='reimported.obj');
 assert.deepEqual(restored.position,[0,0,0]);assert.equal(restored.rotation,0);
 const restoredPositions=await positions(restored.id);assert.equal(restoredPositions.length,originalPositions.length);
 fs.writeFileSync(path.join(testDir,'geometry.json'),JSON.stringify({edited,restored,originalPositions,restoredPositions,checkpoint,after},null,2));
 restoredPositions.forEach((p,i)=>p.forEach((n,j)=>assert.ok(Math.abs(n-originalPositions[i][j])<1e-4,`${p} != ${originalPositions[i]}`)));
 assert.deepEqual(after.drones,before.drones);assert.deepEqual(after.viewpoints,before.viewpoints);
 checks.push('multi-submesh-UV-connectivity','rendered-world-geometry-round-trip','UAV-paths-unchanged');
 const saved=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_e,item)=>{item.setSavePath(path.join(testDir,'project.json'));item.once('done',(_e,state)=>state==='completed'?resolve():reject(new Error(state)));}));
 await run("document.querySelector('.right-topline .primary-button').click()");await saved;
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(testDir,'project.json'),'utf8')),after);
 await click('选择 '+before.models[0].name);await disabled();
 await click('选择 '+before.drones[0].name);await disabled();
 checks.push('project-JSON-save-regression','builtin-UAV-disabled');
 fs.writeFileSync(path.join(testDir,'export.png'),(await win.webContents.capturePage()).toPNG());
 return checks;
};
