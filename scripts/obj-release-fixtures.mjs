/** Controlled architectural stress assets, not real-world scans or BIM exports. */
export function architecturalObj({ windows = 120, floors = 10 } = {}) {
 const lines=['# Generated Stage 5D architectural fixture: slab floors and independent window-frame boxes',
  'vt 0 0','vt 1 0','vt 1 1','vt 0 1','vn 0 0 -1','vn 0 0 1','vn -1 0 0','vn 1 0 0','vn 0 -1 0','vn 0 1 0','s off'];
 let vertices=0;
 const faces=[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]];
 function box(x,y,z,w,h,d) {
  for(const p of [[x,y,z],[x+w,y,z],[x+w,y+h,z],[x,y+h,z],[x,y,z+d],[x+w,y,z+d],[x+w,y+h,z+d],[x,y+h,z+d]])
   lines.push('v '+p.map(v=>+v.toFixed(4)).join(' '));
  faces.forEach((face,n)=>lines.push('f '+face.map((index,corner)=>`${vertices+index+1}/${corner+1}/${n+1}`).join(' ')));
  vertices+=8;
 }
 lines.push('o Slabs');
 for(let floor=0;floor<=floors;floor++)box(0,floor*3,0,24,.15,16);
 for(let facade=0;facade<4;facade++) {
  lines.push('o Facade'+facade);
  const count=Math.floor(windows/4)+(facade<windows%4?1:0),bays=Math.ceil(count/floors),step=((facade<2?24:16)-1)/Math.max(1,bays),width=Math.min(1.3,step*.7);
  const frame=(x,y,w,h)=>facade<2?box(x,y,facade===0?0:15.88,w,h,.12):box(facade===2?0:23.88,y,x,.12,h,w);
  for(let i=0;i<count;i++) {
   const x=.3+(i%bays)*step,y=.5+Math.floor(i/bays)*3;
   // Four facade groups, with independent logical box corners at frame joints.
   // This remains a stress fixture, not a watertight construction/BIM model.
   frame(x,y,.08,1.8);frame(x+width,y,.08,1.8);
   frame(x,y,width+.08,.08);frame(x,y+1.72,width+.08,.08);
  }
 }
 return lines.join('\n')+'\n';
}

/** Explicit diagnostic conditioning only. Never used by the production importer. */
export function conditionAuthoredObj(text) {
 const changes={materialStatementsRemoved:0,smoothingStatementsDisabled:0,quadsTriangulated:0};
 const output=[];
 for(const line of text.split('\n')) {
  const values=line.trim().split(/\s+/),command=values[0];
  if(command==='mtllib'||command==='usemtl'){changes.materialStatementsRemoved++;continue;}
  if(command==='s'&&!['0','off'].includes(values[1])){changes.smoothingStatementsDisabled++;output.push('s off');continue;}
  if(command==='f'&&values.length===5){changes.quadsTriangulated++;output.push(`f ${values[1]} ${values[2]} ${values[3]}`,`f ${values[1]} ${values[3]} ${values[4]}`);continue;}
  output.push(line);
 }
 return {text:output.join('\n'),changes,
  notice:'Diagnostic derivative: drops material references, disables smoothing metadata while retaining explicit corner normals, and splits quads on the 1-3 diagonal. No vertices/UVs/normals or faces are discarded. Raw OBJ compatibility is assessed separately.'};
}
