// Paired CPU guard for the observed normal-transport tail variation. Both
// implementations use the same inputs and warmed independent topology caches.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as current from '../src/core/mesh-edit.ts';
import { auditGrid, auditSelection, distribution } from './obj-audit-fixtures.mjs';
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
const revision=args.includes('--baseline')?value('--baseline'):'c33a0ec';
const source=execFileSync('git',['show',`${revision}:src/core/mesh-edit.ts`],{encoding:'utf8'});
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 .replace(/from "([^"]+)"/g,(match,spec)=>`from "${spec==='three'?import.meta.resolve('three'):spec.startsWith('.')?new URL('../src/core/'+spec,import.meta.url).href:spec}"`);
const dir=mkdtempSync(join(tmpdir(),'obj-history-paired-')),file=join(dir,'baseline.mjs');writeFileSync(file,compiled);
try {
 const baseline=await import(pathToFileURL(file).href),runs=60,warmup=10;
 const result={conditions:{node:process.version,baseline:revision,runs,warmup,
  note:'Milliseconds; alternate baseline/current order each pair. No forced GC inside samples. Baseline TypeScript is transpiled with the existing TypeScript dependency into a temporary module; unchanged auxiliary modules are shared. Two topology caches are warmed. GC/OS interruptions can affect either sample; this is not UI frame time.'},cases:[]};
 for(const [n,attributes,axis] of [[25,false,2],[70,false,2],[150,false,2],[150,true,0],[150,true,2]]) {
  const f=auditGrid(n,{attributes}),s=auditSelection(f,'edge',100,baseline.meshEdges,baseline.withSelectionElements),pivot=baseline.resolveElement(f.project,s).pivot;
  const position=pivot.map((v,i)=>v+(i===axis ? .001 : 0));
  const before=()=>baseline.translateMeshElement(f.project,s,position,'copy'),after=()=>current.translateMeshElement(f.project,s,position,'copy');
  const b=before(),a=after();assert.deepEqual(a,b); // Exact data parity, including signed zero.
  for(let i=0;i<warmup;i++){before();after();}
  const times={before:[],after:[]};
  for(let i=0;i<runs;i++)for(const name of i%2?['after','before']:['before','after']){const start=performance.now();(name==='before'?before:after)();times[name].push(performance.now()-start);}
  result.cases.push({triangles:n*n*2,attributes,axis,exactParity:true,before:distribution(times.before),after:distribution(times.after)});
 }
 if(args.includes('--out'))writeFileSync(value('--out'),JSON.stringify(result,null,2));else console.log(JSON.stringify(result,null,2));
}finally{rmSync(dir,{recursive:true,force:true});}
