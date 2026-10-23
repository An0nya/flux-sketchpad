// Usage: node docs/inventory/scripts/uniforms.mjs   (Node only; reads js/*.js). Sampler declared/used counts and the uniform-row estimate. See docs/inventory/RENDER.md section 4.
import path from 'path';import {fileURLToPath} from 'url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const R=ROOT+'/js/';
import {createRequire} from 'module';const rq=createRequire(import.meta.url);const L=rq(path.join(ROOT,'tests/load.js'));L.load(['cct','beams','drive','drive-models','drive-scenes','drive-touge']);
const S=await import(R+'drive-three-shaders.js');
let touge,obj,halo;
try{touge=await import(R+'drive-touge-three.js')}catch(e){console.log('touge import fail',e.message.slice(0,120))}
try{obj=await import(R+'drive-three-objects.js')}catch(e){console.log('obj import fail',e.message.slice(0,160))}
function samplers(src){ // declared sampler names and whether statically referenced beyond declaration
  const names=new Map();
  for(const m of src.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?(sampler\w+)\s+([^;]+);/g)){
    for(const n of m[2].split(',')){const nm=n.trim().replace(/\[.*\]/,'');names.set(nm,m[1])}}
  const out=[];
  for(const [nm,ty] of names){
    const decl=new RegExp('uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?sampler\\w+\\s+[^;]*\\b'+nm+'\\b[^;]*;','g');
    const rest=src.replace(decl,'');
    const used=new RegExp('\\b'+nm+'\\b').test(rest);
    out.push({nm,ty,used});
  }
  return out;
}
const rows=[];
function add(label,src){const s=samplers(src);rows.push({label,declared:s.length,used:s.filter(x=>x.used).length,names:s.map(x=>x.nm+(x.used?'':'(unused)')).join(' ')});}
const variants=[];
for(const extras of [false,true])for(const atlas of (extras?[false,true]:[false]))for(const table of [false,true])variants.push({extras,atlas,table});
const tag=v=>`${v.extras?'lit':'plain'}${v.atlas?'+atlas':''}${v.table?'+table':''}`;
function lighten(base,v){let s=v.extras?S.withLighting(base,v.atlas):base;if(v.table)s=S.tableSource(s,!v.noBlend);return s}
for(const v of variants){add('FLAT ground  '+tag(v),lighten(S.ground,v));}
if(touge){
  // ribbon source reconstruction (same slicing as drive-touge-three.js surface())
  const ground=S.ground;const prefix=ground.slice(0,ground.indexOf('vec4 roadFrame'));
  let body=ground.slice(ground.indexOf('vec3 surface('),ground.indexOf('void main()'));
  body=body.replace('vec4 f=roadFrame(p.xy);','vec4 f=roadUV;').replace('n=vec3(0,0,1);','n=normalize(roadNormal);');
  const frag=prefix+'varying vec3 worldPoint, roadNormal; varying vec4 roadUV;\n'+body+'\nvoid main(){ vec3 c=surface(worldPoint,vec3(0,0,1),1.0,1.0); if(scatterSteps>0) c+=inScatter(vec3(0,0,-1),1.0,scatterJitter()); gl_FragColor=vec4(c,1); }\n';
  for(const v of variants){try{add('TOUGE ribbon '+tag(v),touge.passShader(lighten(frag,{...v,noBlend:true})));}catch(e){rows.push({label:'TOUGE ribbon '+tag(v),err:e.message.slice(0,100)})}}
  if(obj){for(const v of variants){try{add('FLAT object '+tag(v),lighten(obj.objectFragment,v));}catch(e){rows.push({label:'FLAT object '+tag(v),err:e.message.slice(0,100)})}
    try{add('TOUGE object '+tag(v),touge.passShader(lighten(obj.objectFragment,{...v,noBlend:true})));}catch(e){rows.push({label:'TOUGE object '+tag(v),err:e.message.slice(0,100)})}
    try{add('FLAT leafy '+tag(v),lighten(obj.leafyFragment,v));}catch(e){rows.push({label:'FLAT leafy '+tag(v),err:e.message.slice(0,100)})}}}
}
for(const v of [{extras:false,atlas:false},{extras:true,atlas:false},{extras:true,atlas:true}]){add('TABLE pass '+(v.extras?'lit':'plain')+(v.atlas?'+atlas':''),S.tablePassSource(v.extras?S.withLighting(S.ground,v.atlas):S.ground));}
add('BLUR',S.tableBlurSource);
for(const r of rows)console.log(JSON.stringify(r));
// ---- mesh car program (drive-three-models.js: lighting + own decls) and uniform-vector estimate
const lighting=S.ground.slice(0,S.ground.indexOf('vec4 roadFrame'));
const carBase=lighting+'\nuniform sampler2D bodyMap;uniform int maskMode;uniform bool wheel;uniform float samples;\nvoid main(){ vec4 q=texture2D(bodyMap,vec2(0)); }\n';
console.log('---- MESH CAR');
for(const v of variants){for(const mount of [false,true]){try{let s=lighten(carBase,mount?{...v,noBlend:true}:v);if(mount)s=touge.passShader(s);const r=samplers(s);console.log(JSON.stringify({label:(mount?'TOUGE':'FLAT')+' meshcar '+tag(v),declared:r.length,used:r.filter(x=>x.used).length}))}catch(e){console.log('meshcar err',e.message.slice(0,80))}}}
const ROWS={float:1,int:1,bool:1,vec2:1,vec3:1,vec4:1,ivec2:1,ivec3:1,ivec4:1,mat2:2,mat3:3,mat4:4};
const consts={ATLAS_N:16,HALO_MAX:32};
function uniformRows(src){
  let rows=0,comps=0,arrays=[];
  for(const m of src.matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|int|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4)\s+([^;]+);/g)){
    for(const n of m[2].split(',')){const mm=n.trim().match(/^(\w+)(?:\[\s*(\w+)\s*\])?/);if(!mm)continue;const cnt=mm[2]?(isNaN(+mm[2])?(consts[mm[2]]||0):+mm[2]):1;
      if(mm[2])arrays.push(mm[1]+'['+cnt+']:'+m[1]);const r=ROWS[m[1]]*cnt;rows+=r;}}
  return {rows,arrays};
}
console.log('---- UNIFORM ROWS (upper bound, 1 row per declared name; arrays n*rows)');
for(const [lab,src] of [['FLAT ground plain',lighten(S.ground,variants[0])],['FLAT ground lit+atlas+table',lighten(S.ground,{extras:true,atlas:true,table:true})],['TOUGE ribbon lit+atlas+table',touge.passShader(lighten(S.ground,{extras:true,atlas:true,table:true,noBlend:true}))],['FLAT object lit+atlas+table',lighten(obj.objectFragment,{extras:true,atlas:true,table:true})],['TOUGE object lit+atlas+table',touge.passShader(lighten(obj.objectFragment,{extras:true,atlas:true,table:true,noBlend:true}))]]){const r=uniformRows(src);console.log(lab,r.rows,r.arrays.join(' '))}
