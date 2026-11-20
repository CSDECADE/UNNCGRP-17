// Production-bundle pressure probe. Test-only context access; no Vite source imports.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'aero-release-production-'));
app.setPath('userData',path.join(dir,'profile'));app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const timeout=setTimeout(()=>app.exit(2),180000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{backgroundThrottling:false}}),errors=[];
 win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});
 const run=s=>win.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const report={build:'production',hiddenWindow:true,intervalMs:Number(process.env.OBJ_RELEASE_KEY_INTERVAL||50),batch:Number(process.env.OBJ_RELEASE_KEY_BATCH||0),errors};
 try{
  await win.loadURL(process.argv[2]||'http://127.0.0.1:5181/');
  for(let i=0;i<200;i++){if(await run(`!!document.querySelector('canvas')`))break;await delay(30)}
  const {auditGrid}=await import('./obj-audit-fixtures.mjs'),fixture=auditGrid(150,{attributes:true});
  await run(`(()=>{const el=document.querySelector('main'),k=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));for(let n=el[k];n;n=n.return)for(const f of[n,n.alternate])for(let d=f?.dependencies?.firstContext;d;d=d.next)if(d.memoizedValue?.readProject){window.__getEditor=()=>{for(let n=el[k];n;n=n.return)for(const f of[n,n.alternate])for(let d=f?.dependencies?.firstContext;d;d=d.next)if(d.memoizedValue?.readProject)return d.memoizedValue;throw Error('Context missing')};return;}throw Error('Context missing')})()`);
  await run(`window.__getEditor().replace(${JSON.stringify(fixture.project)})`);await delay(750);
  await run(`(()=>{const e=window.__getEditor();e.select({type:'model',id:'audit-model'})})()`);await delay(100);
  await run(`window.__getEditor().enterEditMode()`);await delay(100);
  const edges=new Map();for(let i=0;i<fixture.resource.meshes[0].triangles.length;i+=3){const t=fixture.resource.meshes[0].triangles.slice(i,i+3);for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3],ids=[a,b].sort((a,b)=>a-b).map(x=>'v'+x);edges.set(ids.join(':'),ids)}}
  const all=[...edges.values()],elements=Array.from({length:100},(_,i)=>({kind:'edge',modelId:'audit-model',meshId:'mesh0',edgeIds:all[Math.floor(i*all.length/100)]}));
  await run(`window.__getEditor().selectMeshElement({...${JSON.stringify(elements[0])},additional:${JSON.stringify(elements.slice(1))}})`);await delay(100);
  const digest=async()=>createHash('sha256').update(await run(`JSON.stringify(window.__getEditor().readProject().objResources)`)).digest('hex');
  const base=await digest();
  for(let i=0;i<60;i++){await run(`(async()=>{const e=window.__getEditor();if(!e.beginMeshTransform()||!e.updateTransform({elementDelta:[0,0,.0001]})||!e.finishTransform())throw Error('Setup failed');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);await delay(i%20===19?750:30)}
  const tip=await digest();report.setupErrors=errors.splice(0);assert.deepEqual(report.setupErrors,[]);
  await run(`document.querySelector('canvas').focus();window.__keys=0;window.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='z')window.__keys++},true)`);
  report.phases=[];
  for(const redo of [false,true]){
   for(let i=0;i<60;i++){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Z',modifiers:redo?['control','shift']:['control'],isAutoRepeat:i>0});await delay(report.batch&&i%report.batch===report.batch-1?750:report.intervalMs)}
   win.webContents.sendInputEvent({type:'keyUp',keyCode:'Z'});await delay(1000);
   const actual=await digest(),expected=redo?tip:base;report.phases.push({phase:redo?'redo':'undo',actual,expected,exact:actual===expected});assert.equal(actual,expected);
  }
  report.keys=await run('window.__keys');assert.equal(report.keys,120);assert.deepEqual(errors,[]);report.passed=true;
 }catch(e){report.passed=false;report.failure=e.stack??String(e)}
 fs.writeFileSync(path.join(dir,'production-stress.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(dir,'production.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify({report:path.join(dir,'production-stress.json'),passed:report.passed}));clearTimeout(timeout);app.exit(report.passed?0:1);
});
