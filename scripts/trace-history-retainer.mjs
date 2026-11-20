// Find one strong root path to a resource with a given ID in a V8 heap snapshot.
// A path is evidence of reachability, not an exclusive retained-size calculation.
import { readFileSync, writeFileSync } from 'node:fs';
const h=JSON.parse(readFileSync(process.argv[2],'utf8')), id=process.argv[3];
const nf=h.snapshot.meta.node_fields,ef=h.snapshot.meta.edge_fields,nw=nf.length,ew=ef.length;
const nn=nf.indexOf('name'),nc=nf.indexOf('edge_count'),et=ef.indexOf('type'),en=ef.indexOf('name_or_index'),to=ef.indexOf('to_node'),types=h.snapshot.meta.edge_types[et],n=h.nodes.length/nw;
const start=new Uint32Array(n+1),incoming=new Uint32Array(n),targets=[];
const label=i=>types[h.edges[i+et]]==='element'?h.edges[i+en]:h.strings[h.edges[i+en]];
const strong=i=>types[h.edges[i+et]]!=='weak'&&!String(label(i)).includes('part of key');
for(let v=0;v<n;v++)start[v+1]=start[v]+h.nodes[v*nw+nc]*ew;
for(let v=0;v<n;v++){
 let matches=false,vertices=false;
 for(let i=start[v];i<start[v+1];i+=ew){
  if(strong(i))incoming[h.edges[i+to]/nw]++;
  if(types[h.edges[i+et]]==='property'&&label(i)==='id'&&h.strings[h.nodes[h.edges[i+to]+nn]]===id)matches=true;
  if(types[h.edges[i+et]]==='property'&&label(i)==='vertices')vertices=true;
 }
 if(matches&&vertices)targets.push(v);
}
const offsets=new Uint32Array(n+1);for(let i=0;i<n;i++)offsets[i+1]=offsets[i]+incoming[i];
const parent=new Uint32Array(offsets[n]),edge=new Uint32Array(offsets[n]),cursor=offsets.slice();
for(let v=0;v<n;v++)for(let i=start[v];i<start[v+1];i+=ew)if(strong(i)){const target=h.edges[i+to]/nw,p=cursor[target]++;parent[p]=v;edge[p]=i;}
const seen=new Uint8Array(n),child=new Uint32Array(n),via=new Uint32Array(n),queue=new Uint32Array(n);
let head=0,tail=0,found=false;for(const t of targets){seen[t]=1;queue[tail++]=t;}
while(head<tail&&!found){const v=queue[head++];for(let p=offsets[v];p<offsets[v+1];p++){const a=parent[p];if(seen[a])continue;seen[a]=1;child[a]=v;via[a]=edge[p];queue[tail++]=a;if(a===0){found=true;break;}}}
const route=[];if(found){let v=0;while(!targets.includes(v)){const e=via[v];route.push({node:h.strings[h.nodes[v*nw+nn]],nodeOffset:v*nw,edgeType:types[h.edges[e+et]],edge:String(label(e))});v=child[v];}route.push({node:h.strings[h.nodes[v*nw+nn]],nodeOffset:v*nw,resourceId:id});}
const result={snapshot:process.argv[2],matchingResourceObjects:targets.length,strongPathFound:found,route,limitation:'One shortest strong path, excluding weak/conditional WeakMap edges; not a dominator or complete retainer analysis.'};
if(process.argv[4])writeFileSync(process.argv[4],JSON.stringify(result,null,2));else console.log(JSON.stringify(result,null,2));
