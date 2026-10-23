// Usage (from anywhere): node docs/inventory/scripts/reach.mjs   (Node only, no browser; reads js/*.js, changes nothing)
// Counts fragment-shader samplers per program variant: declared / textual / reachable-from-main. See docs/inventory/RENDER.md section 4.
import {createRequire} from 'module';import {fileURLToPath} from 'url';import path from 'path';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');const rq=createRequire(import.meta.url);
const L=rq(path.join(ROOT,'tests/load.js'));L.load(['cct','beams','drive','drive-models','drive-scenes','drive-touge']);
const R=ROOT+'/js/';
const S=await import(R+'drive-three-shaders.js');const touge=await import(R+'drive-touge-three.js');const obj=await import(R+'drive-three-objects.js');
function strip(src){return src.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'')}
function analyse(src0){
  const src=strip(src0);
  // split top-level into function defs + other text
  const funcs=new Map();let depth=0,i=0,top='',start=-1,head='';
  const toks=[];let buf='';
  for(let k=0;k<src.length;k++){const c=src[k];
    if(c==='{'){if(depth===0){head=buf;buf='';start=k}depth++;}
    else if(c==='}'){depth--;if(depth===0){const body=src.slice(start+1,k);const m=head.match(/(\w+)\s*\([^)]*\)\s*$/);if(m&&!/^(struct|if|for|while)$/.test(m[1])){funcs.set(m[1],body);}else{top+=head+'{'+body+'}';}buf='';}}
    else if(depth===0){buf+=c;if(c===';'){top+=buf;buf='';}}
  }
  top+=buf;
  const names=[...funcs.keys()];
  const samplers=[];for(const m of src.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler\w+\s+([^;]+);/g))for(const n of m[1].split(','))samplers.push(n.trim().replace(/\[.*\]/,''));
  const reach=new Set();const stack=['main'];
  while(stack.length){const f=stack.pop();if(reach.has(f)||!funcs.has(f))continue;reach.add(f);const body=funcs.get(f);for(const n of names)if(n!==f&&new RegExp('\\b'+n+'\\b').test(body))stack.push(n);}
  const text=[...reach].map(f=>funcs.get(f)).join('\n')+top.replace(/uniform[^;]*;/g,'');
  const used=samplers.filter(s=>new RegExp('\\b'+s+'\\b').test(text));
  const textual=samplers.filter(s=>{const rest=src.replace(/uniform[^;]*;/g,'');return new RegExp('\\b'+s+'\\b').test(rest)});
  return {declared:samplers.length,textual:textual.length,reachable:used.length,usedNames:used,unusedReach:samplers.filter(s=>!used.includes(s))};
}
const variants=[];for(const extras of [false,true])for(const atlas of (extras?[false,true]:[false]))for(const table of [false,true])variants.push({extras,atlas,table});
const tag=v=>`${v.extras?'lit':'plain'}${v.atlas?'+atlas':''}${v.table?'+table':''}`;
const lighten=(base,v)=>{let s=v.extras?S.withLighting(base,v.atlas):base;if(v.table)s=S.tableSource(s,!v.noBlend);return s};
const ground=S.ground;const prefix=ground.slice(0,ground.indexOf('vec4 roadFrame'));
let body=ground.slice(ground.indexOf('vec3 surface('),ground.indexOf('void main()'));
body=body.replace('vec4 f=roadFrame(p.xy);','vec4 f=roadUV;').replace('n=vec3(0,0,1);','n=normalize(roadNormal);');
// the real ribbon main, copied from drive-touge-three.js
const ribbonMain=`void main() { vec3 v=normalize(eye-worldPoint); float t=length(eye-worldPoint);
 vec3 c=surface(worldPoint,v,t,max(.003,dot(v,normalize(roadNormal))));
 if(sigma>0.0){float T=exp(-sigma*t); c=c*T+ambient*0.012*(1.0+0.8*max(0.0,1.0-abs(v.z)*8.0))*(1.0-T);}
 if(scatterSteps>0) c+=inScatter(-v,t<5000.0?t:1e20,scatterJitter());   // TOUGE-AIR-RIBBON
 if(haloOn>0) c+=haloScatter(t<5000.0?t:1e20);   // TOUGE-ELEV B2 (was missing from this copy)
 gl_FragColor=vec4(c,1);
 gl_FragDepth=min(.99999,t/5000.0); }`;
const ribbon=prefix+'varying vec3 worldPoint, roadNormal; varying vec4 roadUV;\n'+body+ribbonMain;
// the real mesh-car fragment: the template literal in js/drive-three-models.js (no ${} in it) appended to the same 'lighting' prefix
import fs from 'fs';
const modelsText=fs.readFileSync(R+'drive-three-models.js','utf8');
const tpl=modelsText.match(/const fragment=lighting\+`([\s\S]*?)`;/)[1];
const lighting=prefix.replace('vec4 gloss=texelFetch(materials,ivec2(id,2),0);','vec4 gloss=texelFetch(materials,ivec2(id,2),0);if(id==20){rho=vec3(.04);gloss=vec4(.10,.60,0,0);}');
const carBase=lighting+tpl;
const rows=[];
for(const v of variants){
  rows.push(['FLAT ground (full-screen)',tag(v),analyse(lighten(S.ground,v))]);
  rows.push(['TOUGE ribbon',tag(v),analyse(touge.passShader(lighten(ribbon,{...v,noBlend:true})))]);
  rows.push(['FLAT object (instanced)',tag(v),analyse(lighten(obj.objectFragment,v))]);
  rows.push(['TOUGE object (instanced)',tag(v),analyse(touge.passShader(lighten(obj.objectFragment,{...v,noBlend:true})))]);
  rows.push(['FLAT mesh car',tag(v),analyse(lighten(carBase,v))]);
  rows.push(['TOUGE mesh car',tag(v),analyse(touge.passShader(lighten(carBase,{...v,noBlend:true})))]);
}
for(const r of rows)console.log(r[0].padEnd(28),r[1].padEnd(16),'declared',r[2].declared,'textual',r[2].textual,'reachable',r[2].reachable,'not-reachable:',r[2].unusedReach.join(','));
