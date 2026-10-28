/* Instanced proxy meshes: rasterization bounds the work, analytic hits retain the CPU primitives and subpixel lamps. */
import * as T from '../vendor/three/three.module.min.js';
import { sdf } from './drive-models-glsl.js';
import { modelMeshes, bakeTree } from './drive-three-models.js';
import { ground } from './drive-three-shaders.js';
import { passShader } from './drive-touge-three.js';
const D = globalThis.RF.Drive;
const objectVertex = `
attribute vec3 aCenter; attribute vec4 aShape, aPose, aBounds, aEmit, aPlane, aTie; attribute vec3 aMat; attribute vec4 aFlags;
flat varying vec3 center; flat varying vec4 shape, pose, emission, planes, ties; flat varying vec3 matInfo; flat varying vec2 flags,lod; flat varying float order;
varying vec2 screen;
void main() { center=aCenter; shape=aShape; pose=aPose; emission=aEmit; planes=aPlane; ties=aTie; matInfo=aMat; flags=aFlags.xy;lod=aFlags.zw; order=aMat.z;
 screen=mix(aBounds.xz,aBounds.yw,position.xy+0.5); gl_Position=vec4(screen,0,1); }
`;
export const objectFragment = ground.slice(0, ground.indexOf('vec4 roadFrame')).replace('retro*Ep;', 'retro*Ep*retroScale*pow(NoL,eyeFalloff);').replace('vec3 shade(', 'float retroScale=1.0,eyeFalloff=0.0;\nvec3 shade(') + `
flat varying vec3 center; flat varying vec4 shape, pose, emission, planes, ties; flat varying vec3 matInfo; flat varying vec2 flags,lod; flat varying float order;
uniform sampler2DArray materialMap;
uniform vec3 mapExtent;
uniform int mapped, maskMode, signKind;
uniform float samples;
uniform bool detailed;
float nearT, farT; int face;
bool slab(float o,float d,float lo,float hi,int f) {
 if(abs(d)<1e-12) return o>=lo && o<=hi;
 float a=(lo-o)/d,b=(hi-o)/d;int fa=f*2,fb=f*2+1;
 if(a>b){float z=a;a=b;b=z;int k=fa;fa=fb;fb=k;}
 if(a>nearT){nearT=a;face=fa;}farT=min(farT,b);return nearT<=farT;
}
${sdf}
void main() {
 if(lod.y!=0.0){float threshold=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);if(lod.y>0.0?threshold<lod.x:threshold>=lod.x)discard;}
 vec2 pixelScreen=gl_FragCoord.xy/(size*samples)*2.0-1.0;
 vec3 ray=normalize(vec3(1,-pixelScreen.x*tanH,pixelScreen.y*tanH*size.y/size.x)), n=vec3(0,0,1), v=-ray;
 float t=1e20, coord=0.0, scale=1.0, modelId=-1.0, work=0.0; int hf=0, kind=int(shape.w+0.5);
 vec3 o=eye-center; float ca=cos(pose.x),sn=sin(pose.x);
 if(kind==4) {
   bool hit=modelTrace(o,ray,t,n,modelId,work);
   if(maskMode==3){gl_FragDepth=hit?min(.99999,t/5000.0):.999999;gl_FragColor=vec4(work,hit?1.0:0.0,1,1);return;}
   if(!hit)discard;
 } else if(kind==5) {
   vec3 normal=pose.yzw,tangent=vec3(-normal.y,normal.x,0);float den=dot(ray,normal);if(abs(den)<1e-9)discard;
   t=-dot(o,normal)/den;vec3 q=o+t*ray;vec2 uv=vec2(dot(q,tangent)/(shape.x*2.0)+.5,q.z/(shape.z*2.0)+.5);
   if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))discard;
   vec4 card=texture(treeCard,vec2(uv.x,(uv.y+planes.z)/24.0));if(card.w<.5)discard;modelId=floor(card.w+.5)-1.0;if(modelId==7.0&&pose.x>.5)modelId=9.0;
   n=normalize(normal*sqrt(max(0.0,1.0-dot(card.xy,card.xy)))+tangent*card.x+vec3(0,0,card.y));
   t+=-card.z*(shape.z*2.0)/den;
 } else if(kind==0) {
   vec3 q=o/shape.xyz, d=ray/shape.xyz; float a=dot(d,d),b=2.0*dot(q,d),c=dot(q,q)-1.0,disc=b*b-4.0*a*c;
   if(disc<0.0) discard; t=(-b-sqrt(disc))/(2.0*a); n=normalize((o+t*ray)/(shape.xyz*shape.xyz)); coord=atan(n.y,n.x)*shape.x;
 } else if(kind==1) {
   vec3 q=vec3(ca*o.x+sn*o.y,-sn*o.x+ca*o.y,o.z),d=vec3(ca*ray.x+sn*ray.y,-sn*ray.x+ca*ray.y,ray.z);
   nearT=1e-4;farT=1e20;face=-1;
   bool hit;
   if(abs(pose.x)<1e-8) hit=slab(eye.x,ray.x,planes.x,planes.y,0)&&slab(eye.y,ray.y,planes.z,planes.w,1)&&slab(q.z,d.z,-shape.z,shape.z,2);
   else hit=slab(q.x,d.x,-shape.x,shape.x,0)&&slab(q.y,d.y,-shape.y,shape.y,1)&&slab(q.z,d.z,-shape.z,shape.z,2);
   if(!hit||face<0)discard;
   t=nearT;hf=face;vec3 h=q+t*d,nn=vec3(0);
   if(face<2){nn.x=face==0?-1.0:1.0;coord=h.y;}else if(face<4){nn.y=face==2?-1.0:1.0;coord=h.x;}else{nn.z=face==4?-1.0:1.0;coord=h.x;}
   n=vec3(ca*nn.x-sn*nn.y,sn*nn.x+ca*nn.y,nn.z);
 } else if(kind==2) {
   // Cross-product distance avoids subtracting nearly equal squared ranges for distant thin posts.
   float a=dot(ray.xy,ray.xy),b=dot(o.xy,ray.xy),crossD=o.x*ray.y-o.y*ray.x,disc=a*shape.x*shape.x-crossD*crossD;
   if(a>1e-12 && disc>=0.0) for(int k=0;k<2;k++){float h=(-b+(k==0?-1.0:1.0)*sqrt(disc))/a,z=o.z+h*ray.z;if(h>1e-4 && z>=-shape.z && z<=shape.z){t=h;n=vec3((o.xy+h*ray.xy)/shape.x,0);coord=atan(n.y,n.x)*shape.x;break;}}
   if(ray.z<0.0 && o.z>shape.z){float h=(shape.z-o.z)/ray.z;vec2 q=o.xy+h*ray.xy;if(h>1e-4 && h<t && dot(q,q)<=shape.x*shape.x){t=h;n=vec3(0,0,1);coord=q.x;hf=4;}}
 } else if(kind==7) {
   vec3 axis=pose.yzw;float pa=dot(o,axis),da=dot(ray,axis);vec3 q=o-axis*pa,d=ray-axis*da;
   float a=dot(d,d),b=2.0*dot(q,d),c=dot(q,q)-shape.x*shape.x,disc=b*b-4.0*a*c;
   if(a>1e-12&&disc>=0.0)for(int k=0;k<2;k++){float h=(-b+(k==0?-1.0:1.0)*sqrt(disc))/(2.0*a);if(h>1e-4&&h<t&&abs(pa+h*da)<=shape.z){t=h;n=(q+h*d)/shape.x;}}
   if(abs(da)>1e-12)for(int k=0;k<2;k++){float sign=k==0?-1.0:1.0,h=(sign*shape.z-pa)/da;if(h>1e-4&&h<t&&dot(q+h*d,q+h*d)<=shape.x*shape.x){t=h;n=sign*axis;}}
 } else if(kind==6) {
   n=pose.yzw;float den=dot(ray,n);if(abs(den)<1e-9)discard;t=-dot(o,n)/den;vec3 q=o+t*ray,tangent=normalize(vec3(-n.y,n.x,0)),up=cross(n,tangent);
   if(abs(dot(q,tangent))>shape.x||abs(dot(q,up))>shape.z)discard;
 } else {
   n=pose.yzw;float den=dot(ray,n);if(lod.x<0.0&&den>=0.0)discard;if(abs(den)<1e-9)discard;t=-dot(o,n)/den;vec3 q=o+t*ray;
   float footprint=t*2.0*tanH/(size.x*samples);
   if(flags.x>0.0 && PI*shape.x*shape.x<footprint*footprint){vec2 a=abs(q.yz/footprint);if(any(greaterThanEqual(a,vec2(1))))discard;scale=PI*shape.x*shape.x/(footprint*footprint)*(1.0-a.x)*(1.0-a.y);}
   else {if(dot(q,q)>shape.x*shape.x)discard;coord=length(q);}
 }
 if(!(t>1e-4 && t<5000.0))discard;vec3 p=eye+t*ray;
 if(ray.z<0.0 && t>=-eye.z/ray.z)discard;
 if(dot(n,ray)>0.0)n=-n;
 int id=modelId>=0.0?int(modelId+.5):int(matInfo.x+0.5);
 if(kind==4 && id==15 && ((p.z>1.0 && p.z<1.06)||(p.z>1.26 && p.z<1.32)))id=16;
 if(mapped==2) {
   float gx=floor((coord+400.0)/2.6),gz=floor(p.z/3.2),cell=fract((coord+400.0)/2.6),cz=fract(p.z/3.2);
   if(p.z<3.0 || cell<0.2 || cell>0.8 || cz<0.25 || cz>0.8) id=hf==0?26:25;
   else id=int(texelFetch(materialMap,ivec3(int(gx-mapExtent.x),int(gz),0),0).r*255.0+0.5);
 } else if(mapped==3) {
   id=signKind;
   if(hf!=0)id=20;
   else {float zc=(mapExtent.y+mapExtent.z)/2.0;bool edge=abs(coord)>mapExtent.x-0.07 || p.z<mapExtent.y+0.07 || p.z>mapExtent.z-0.07;
     if(signKind==18)id=edge||(abs(p.z-zc-0.2)<0.06 && abs(coord)<mapExtent.x*0.6)||(abs(p.z-zc+0.1)<0.06 && abs(coord)<mapExtent.x*0.76)?17:18;
     else if(signKind==19)id=(abs(coord)<0.07 && p.z>mapExtent.y+0.2 && p.z<mapExtent.z-0.25)||(abs(coord)<0.07 && p.z>mapExtent.y+0.1 && p.z<mapExtent.y+0.18)||edge?12:19;
     else id=edge||(abs(p.z-zc)<0.12 && abs(coord)<0.25)?12:17;
   }
 } else if(mapped==4) id=((p.z>1.0 && p.z<1.06)||(p.z>1.26 && p.z<1.32))?16:15;
 else if(mapped==5) id=hf==5?30:27;
 else if(mapped==1) {float z=(p.z-mapExtent.y)/max(1e-6,mapExtent.z-mapExtent.y);id=int(texture(materialMap,vec3(clamp(coord/mapExtent.x*0.5+0.5,0.0,1.0),clamp(z,0.0,1.0),float(hf))).r*255.0+0.5);}
 gl_FragDepth=min(0.99999,t/5000.0+(kind==1 && hf<4 ? ties[hf]*1e-8 : 0.0)+order*1e-10);
 if(detailed && mapped==2 && hf<4) {
   float style=lod.x;
   vec2 uv=vec2((coord+400.0)/2.6,p.z/3.2),f=fract(uv),aa=max(fwidth(uv),vec2(.001));
   if(style==1.0){f.x=fract(uv.x*2.0);aa.x*=2.0;}
   if(style==2.0 && id==25)id=26;
   float panel=1.0-smoothstep(.008,.008+aa.x,min(f.x,1.0-f.x));
   float rail=1.0-smoothstep(.012,.012+aa.y,min(f.y,1.0-f.y));
   if((id==28||id==29||id==27) && (abs(f.x-.5)<.014 || (style!=2.0 && abs(f.y-.52)<.012)))id=20;
   if(panel>.5 || rail>.5)id=20;
 }
 if(maskMode==2){gl_FragColor=vec4(float(id),coord,p.z,order);return;}
 if(maskMode>0){float bit=matInfo.y>0.0?exp2(matInfo.y-1.0):0.0;gl_FragColor=vec4(bit,id==11?bit:0.0,0,1);return;}
 // Negative lod.x carries only the behavioural eye acceptance exponent.
 retroScale=scale;eyeFalloff=lod.x<0.0?-lod.x:0.0;vec3 color=shade(p,n,v,id);float NoV=dot(n,v);
 if(NoV>0.0){vec3 emit=emission.w<0.0?texelFetch(materials,ivec2(id,3),0).rgb:emission.rgb;color+=emit*scale*(emission.w>1.0?pow(NoV,emission.w):NoV)*lampRGB;}
 if(sigma>0.0){float T=exp(-sigma*t); color=color*T+vec3(flags.y>0.0?0.0:ambient*0.012*(1.0+0.8*max(0.0,1.0-abs(ray.z)*8.0))*(1.0-T));}
 if(scatterSteps>0 && flags.y<=0.0) color+=inScatter(ray,t,scatterJitter());
 if(haloOn>0 && flags.y<=0.0) color+=haloScatter(t);
 gl_FragColor=vec4(color,flags.y>0.0?0.0:1.0);
}
`;
// Only leaf buckets compile this source. The off shader above remains byte-identical to M2.
// Object-local metres anchor the pattern through camera motion, bends and repeated chunks.
export const leafyFragment = objectFragment.replace(
  'coord=atan(n.y,n.x)*shape.x;', `coord=atan(n.y,n.x)*shape.x;
   vec3 leafQ=(o+t*ray)*(shape.z<.65?9.0:5.0);
   vec3 axis=abs(n);vec2 leafUV=axis.z>max(axis.x,axis.y)?leafQ.xy:axis.x>axis.y?leafQ.yz:leafQ.xz;
   vec2 cell=floor(leafUV),f=fract(leafUV)-.5;
   float hash=fract(dot(fract(vec3(cell.x,cell.y,cell.x)*.1031),vec3(17.1,31.7,13.3)));
   if(hash>.5)f=f.yx;
   // Elliptical leaf tips erode the outer contour most; subpixel detail closes smoothly.
   float footprint=max(length(dFdx(leafUV)),length(dFdy(leafUV)));
   float tip=dot(f*vec2(1.25,2.0),f*vec2(1.25,2.0));
   float edge=1.0-abs(dot(n,ray)),filterLeaf=1.0-smoothstep(.35,1.0,footprint);
   if(tip>mix(2.0,mix(1.05,.65,edge),filterLeaf))discard;
  `);

// SM1b (option trafficShadowObjects): the proxies cast into the traffic shadow maps. Same instances, a second mesh per group with a map program:
// the vertex bounds each instance in the map's view (exact sphere tangents per axis), the fragment is the pass object text with the camera ray swapped for the map's
// pixel ray, and it writes distance / 5000 and returns before any shading. Emissive and glow instances (lamp lenses) do not cast. Built and compiled only when drawn.
const mapVertex = `
attribute vec3 aCenter; attribute vec4 aShape, aPose, aBounds, aEmit, aPlane, aTie; attribute vec3 aMat; attribute vec4 aFlags;
uniform mat3 carFromWorld; uniform vec3 omEye, omF, omL, omU; uniform vec2 omTan, omRes;
flat varying vec3 center; flat varying vec4 shape, pose, emission, planes, ties; flat varying vec3 matInfo; flat varying vec2 flags,lod; flat varying float order;
vec2 ext(float x, float y, float R) { float d = length(vec2(x, y)); if (d <= R) return vec2(-1e3, 1e3); float c = atan(y, x), a = asin(R / d); return vec2(c - a < -1.55 ? -1e3 : tan(c - a), c + a > 1.55 ? 1e3 : tan(c + a)); }
void main() { center=aCenter; shape=aShape; pose=aPose; emission=aEmit; planes=aPlane; ties=aTie; matInfo=aMat; flags=aFlags.xy;lod=aFlags.zw; order=aMat.z;
 vec3 v = carFromWorld * aCenter - omEye; float R = length(aShape.xyz) * 1.02 + 0.05, x = dot(v, omF);
 if (x + R <= 0.5 || aFlags.y > 0.0 || aEmit.w >= 0.0) { gl_Position = vec4(2, 2, 2, 1); return; }
 vec2 ex = ext(x, dot(v, omL), R), ey = ext(x, dot(v, omU), R), px = 4.0 / omRes;
 vec4 b = clamp(vec4(-ex.y / omTan.x - px.x, -ex.x / omTan.x + px.x, ey.x / omTan.y - px.y, ey.y / omTan.y + px.y), -1.01, 1.01);
 if (b.x >= 1.0 || b.y <= -1.0 || b.z >= 1.0 || b.w <= -1.0) { gl_Position = vec4(2, 2, 2, 1); return; }
 gl_Position = vec4(mix(b.xz, b.yw, position.xy + 0.5), 0, 1); }
`;
function mapText(source) {
  let s = passShader(source);
  const swaps = [
    ['void main() {\n if(lod.y', 'uniform vec3 omEyeW, omF, omL, omU; uniform vec2 omTan, omRes; uniform float omRow;\n#define eye omEyeW\nvoid main() {\n if(lod.y'],
    ['vec2 pixelScreen=gl_FragCoord.xy/(size*samples)*2.0-1.0;\n vec3 ray=normalize(vec3(1,-pixelScreen.x*tanH,pixelScreen.y*tanH*size.y/size.x)),', 'vec2 pixelScreen=(gl_FragCoord.xy-vec2(0.0,omRow))/omRes*2.0-1.0;\n vec3 ray=normalize(omF-pixelScreen.x*omTan.x*omL+pixelScreen.y*omTan.y*omU),'],
    ['if(t/5000.0>texture2D(passDepth,gl_FragCoord.xy/(size*samples)).r+0.000002)discard;', 'if(t<0.5)discard;{float dm=min(.99999,t/5000.0);gl_FragDepth=dm;gl_FragColor=vec4(dm,0.0,0.0,1.0);return;}'],
  ];
  for (const [a, b] of swaps) { if (!s.includes(a)) throw Error('SM1b: object text changed near ' + a.slice(0, 40)); s = s.replace(a, b); }
  return s;
}
export function objects(renderer, uniforms, onModelsReady) {
  const scene = new T.Scene(), camera = new T.Camera(), groups = new Map(), maps = new Map();
  const mapScene = new T.Scene(), omU = { omEye: { value: new T.Vector3() }, omEyeW: { value: new T.Vector3() }, omF: { value: new T.Vector3() }, omL: { value: new T.Vector3() }, omU: { value: new T.Vector3() }, omTan: { value: new T.Vector2(1, 1) }, omRes: { value: new T.Vector2(1, 1) }, omRow: { value: 0 } }; let ver = 0, lastHash = -1;   // SM1b
  const models=modelMeshes(scene,uniforms,onModelsReady);let nodeTexture=null,nodeData=null,card=null;const prototype={actors:0,nearTrees:0,farTrees:0,leafPrimitives:0,proxyPrimitives:0,proxyTriangles:0};
  const zero = new T.DataArrayTexture(new Uint8Array(6), 1, 1, 6); zero.format=T.RedFormat;zero.needsUpdate=true;
  const fields={aCenter:3,aShape:4,aPose:4,aBounds:4,aEmit:4,aPlane:4,aTie:4,aMat:3,aFlags:4};
  function materialMap(ob) {
    if (typeof ob.mat !== 'function') return null;
    const source=String(ob.mat),cacheKey=source.includes('hivis-tape')?'vest':source.includes('face === 5')?'cabin':ob.mat;
    let cached=maps.get(cacheKey);if(cached)return cached;
    const extent=Math.max(ob.hx||ob.r||1,ob.hy||1),lo=ob.z0||0,hi=ob.z1||2;
    let w=256,h=256,mode=1,mapExtent=new T.Vector3(extent,lo,hi),signKind=0;
    if(source.includes('win(h, seed)')) {mode=2;const gx0=Math.floor((400-extent)/2.6);w=Math.floor((400+extent)/2.6)-gx0+1;h=Math.ceil(hi/3.2);mapExtent=new T.Vector3(gx0,0,0);}
    else if(source.includes('const zc')) {mode=3;mapExtent=new T.Vector3(ob.hy,lo,hi);for(const u of [0,ob.hy*0.6,-ob.hy*0.6])for(const z of [lo+(hi-lo)*0.3,lo+(hi-lo)*0.7]){const key=ob.mat({u,z,face:0});if(key.startsWith('sign-')&&key!=='sign-back')signKind=D.MAT_KEYS.indexOf(key);}}
    else if(source.includes('hivis-tape'))mode=4;
    else if(source.includes("face === 5"))mode=5;
    if(mode>=3){w=h=1;}
    const data=new Uint8Array(w*h*6);
    for(let face=0;face<6;face++)for(let y=0;y<h;y++)for(let x=0;x<w;x++) {const u=mode===2?(x+mapExtent.x+0.5)*2.6-400:((x+.5)/w*2-1)*extent,z=mode===2?(y+0.5)*3.2:lo+(y+.5)/h*(hi-lo);data[(face*h+y)*w+x]=Math.max(0,D.MAT_KEYS.indexOf(ob.mat({u,z,face,x:ob.x,y:ob.y})));}
    const tex=new T.DataArrayTexture(data,w,h,6);tex.format=T.RedFormat;tex.needsUpdate=true;
    cached={tex,extent:mapExtent,mode,signKind};maps.set(cacheKey,cached);return cached;
  }
  function drop(g){scene.remove(g.mesh);g.mesh.geometry.dispose();g.mesh.dispose();g.mesh.material.dispose();if(g.mapMesh){mapScene.remove(g.mapMesh);g.mapMesh.dispose();g.mapMesh.material.dispose();}}
  function group(key, count, map, leafy) {
    let g=groups.get(key);if(g && g.capacity>=count)return g;
    if(g)drop(g);
    const capacity=Math.max(16,2**Math.ceil(Math.log2(count))),geometry=new T.PlaneGeometry(1,1),attrs={};
    for(const [name,n]of Object.entries(fields)){attrs[name]=new T.InstancedBufferAttribute(new Float32Array(n*capacity),n).setUsage(T.DynamicDrawUsage);geometry.setAttribute(name,attrs[name]);}
    const local={...uniforms,materialMap:{value:map?map.tex:zero},mapExtent:{value:map?map.extent:new T.Vector3(1,0,1)},mapped:{value:map?map.mode:0},signKind:{value:map?map.signKind:0},maskMode:{value:0},samples:{value:1},detailed:{value:false},sdfNodes:{value:null},treeCard:{value:null}};
    const material=new T.ShaderMaterial({uniforms:local,vertexShader:objectVertex,fragmentShader:leafy?leafyFragment:objectFragment,depthTest:true,depthWrite:true,depthFunc:T.LessDepth});
    const mesh=new T.InstancedMesh(geometry,material,capacity);mesh.frustumCulled=false;scene.add(mesh);g={mesh,attrs,capacity,uniforms:local,leafy,mapMesh:null};groups.set(key,g);return g;
  }
  return {
    scene,camera,
    update(p,obs,ss) {
      prototype.actors=prototype.nearTrees=prototype.farTrees=prototype.leafPrimitives=0;
      // Pass: only the car swap runs (the pass world already built its deer and trees; leafy foliage stays off on the pass).
      if(p.touge && p.detailedModels){models.load();obs=models.adapt(obs,p);}
      if((p.detailedModels || p.leafyFoliage) && !p.touge){
        if(p.detailedModels){models.load();obs=models.adapt(D.Models.actors(obs,true),p);}
        else obs=obs.flatMap(ob=>ob.detailPart==='tree'?(ob.detail?D.Models.tree(ob.detail):[]):[ob]);
        if(!card)card=bakeTree();
        const roots=obs.filter(ob=>ob.detailPart==='analytic-tree'&&ob.detail),ranges=roots.map(ob=>Math.hypot(ob.x+2,ob.y-.37)).sort((a,b)=>a-b),cutoff=Math.min(D.Models.TREE_DISTANCE,ranges[D.Models.TREE_COUNT]||Infinity),detailed=[];
        const fades=new Map(roots.map(ob=>[ob.treeId,Math.max(0,Math.min(1,(Math.hypot(ob.x+2,ob.y-.37)-(cutoff-8))/8))]));
        for(const ob of obs){
          if(ob.detailPart==='analytic-tree'){
            const fade=fades.get(ob.treeId);if(fade<1)detailed.push({...ob,lod:[fade,1]});
            if(ob.detail){const m=ob.detail,h=m.h||9;
              if(fade<1)prototype.nearTrees++;
              if(fade>0){const angle=Math.atan2(.37-m.y,-2-m.x),view=((Math.round(angle*8/(2*Math.PI))%8)+8)%8,a=view*Math.PI/4;detailed.push({k:'impostor',x:m.x,y:m.y,z:h*.5,rx:h*.4,rz:h*.5,r:h*.75,nx:Math.cos(a),ny:Math.sin(a),nz:0,cardIndex:m.variant*8+view,birch:m.birch,lod:[fade,-1],mat:'foliage',bs:[m.x,m.y,h*.5,h*.75]});prototype.farTrees++;}
            }continue;
          }
          if(ob.k==='sdf' && ob.cls!=='veg')prototype.actors++;detailed.push(ob);
        }
        obs=detailed;
      }
      const cars=obs.filter(ob=>ob.k==='mesh-car');models.update(p,cars,ss,p.detailedModels);obs=obs.filter(ob=>ob.k!=='mesh-car');
      const sdfs=obs.filter(ob=>ob.k==='sdf');
      if(!nodeData || nodeData.length<D.Models.MAX_NODES*12*Math.max(1,sdfs.length)){
        if(nodeTexture)nodeTexture.dispose();const capacity=Math.max(1,sdfs.length*2);nodeData=new Float32Array(D.Models.MAX_NODES*12*capacity);
        nodeTexture=new T.DataTexture(nodeData,D.Models.MAX_NODES*3,capacity,T.RGBAFormat,T.FloatType);
      }
      sdfs.forEach((ob,i)=>{nodeData.set(ob.nodes,i*D.Models.MAX_NODES*12);ob.sdfRow=i;});if(sdfs.length)nodeTexture.needsUpdate=true;

      const tieRanks=new Map(),planes=new Map();
      // CPU subtraction retains tiny offsets between otherwise coincident city facades.
      // Preserve that order before converting geometry to float; only axis-aligned box faces share these groups.
      for(const ob of obs)if(ob.k==='box' && Math.abs(ob.yaw||0)<1e-8){const ranks=[0,0,0,0];tieRanks.set(ob,ranks);for(let face=0;face<4;face++){const center=face<2?ob.x:ob.y,half=face<2?ob.hx:ob.hy,eye=face<2?(p.eye||[-2,.37,1.2])[0]:(p.eye||[-2,.37,1.2])[1],bound=face%2?half:-half,world=center+bound,key=face+':'+Math.round(world*1e7);if(!planes.has(key))planes.set(key,[]);planes.get(key).push({ob,face,d:Math.abs(bound-(eye-center))});}}
      for(const values of planes.values())if(values.length>1){values.sort((a,b)=>a.d-b.d);values.forEach((v,i)=>tieRanks.get(v.ob)[v.face]=i);}
      const buckets=new Map(),tanH=Math.tan(p.hfov*Math.PI/360),tanV=tanH*p.h/p.w,eye=p.eye||[-2,.37,1.2];let count=0;
      obs.forEach((ob,index)=>{
        if(!ob.bs){if(ob.k==='rect')ob.bs=[ob.x,ob.y,ob.z,ob.r];else D.boundOf(ob);}const [x,y,z,R]=ob.bs; let dx=x-eye[0],dy=y-eye[1],dz=z-eye[2];
        if(p.touge){const q=new T.Vector3(x,y,z).sub(uniforms.eye.value).applyMatrix3(uniforms.carFromWorld.value);dx=q.x;dy=q.y;dz=q.z;}
        const d=Math.hypot(dx,dy,dz);
        if(dx+R<=.05)return;
        let bounds=[-1,1,-1,1];
        if(d>R*1.001 && dx>.05){const cx=-dy/dx/tanH,cy=dz/dx/tanV,rp=Math.tan(Math.asin(Math.min(1,R/d)))*1.15;bounds=[cx-rp/tanH-4/p.w,cx+rp/tanH+4/p.w,cy-rp/tanV-4/p.h,cy+rp/tanV+4/p.h];if(bounds[0]>1||bounds[1]<-1||bounds[2]>1||bounds[3]<-1)return;}
        const leafy=!!(p.leafyFoliage&&!p.touge&&ob.k==='ell'&&ob.mat==='foliage'&&(ob.foliage||ob.detailPart==='analytic-tree'));
        const source=typeof ob.mat==='function'?String(ob.mat):'',key=leafy?'FO-leaves':source.includes('hivis-tape')?'vest':source.includes('face === 5')?'cabin':source?ob.mat:'constant';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({ob,index,bounds,leafy});count++;if(leafy)prototype.leafPrimitives++;
      });
      for(const g of groups.values())g.mesh.count=0;
      for(const [key,items]of buckets){const g=group(key,items.length,materialMap(items[0].ob),items[0].leafy);g.mesh.count=items.length;g.mesh.renderOrder=items[0].index;g.uniforms.samples.value=ss;g.uniforms.detailed.value=!!p.detailedModels;g.uniforms.sdfNodes.value=nodeTexture;g.uniforms.treeCard.value=card;
        items.forEach(({ob,index,bounds},i)=>{const k=ob.k,kind=k==='sdf'?4:k==='impostor'?5:k==='rect'?6:k==='ell'?0:k==='box'?1:k==='cyl'?(ob.axis?7:2):3,zc=k==='box'||k==='cyl'?(ob.z0+ob.z1)/2:ob.z;
          const values={aCenter:[ob.x,ob.y,zc],aShape:k==='sdf'?[ob.r,ob.r,ob.r,kind]:k==='impostor'||k==='rect'?[ob.rx,ob.rx,ob.rz,kind]:k==='ell'?[ob.rx,ob.ry,ob.rz,kind]:k==='box'?[ob.hx,ob.hy,(ob.z1-ob.z0)/2,kind]:[ob.r,ob.r,k==='cyl'?(ob.z1-ob.z0)/2:ob.r,kind],aPose:[k==='impostor'?(ob.birch?1:0):(ob.yaw||0),...(ob.axis||[ob.nx||0,ob.ny||0,ob.nz||0])],aBounds:bounds,aTie:p.touge ? (ob.passSlope||[0,0,0,0]) : tieRanks.get(ob)||[0,0,0,0],aPlane:k==='sdf'?[ob.sdfRow,ob.nodeCount,0,0]:k==='impostor'?[0,0,ob.cardIndex,0]:[ob.x-(ob.hx||0),ob.x+(ob.hx||0),ob.y-(ob.hy||0),ob.y+(ob.hy||0)],aEmit:[...(ob.emit||[0,0,0]),ob.emit?(ob.emitPow||1):-1],aMat:[Math.max(0,D.MAT_KEYS.indexOf(ob.mat)),ob.gameHazard||0,index],aFlags:[ob.sub?1:0,ob.glow?1:0,...(ob.lod||[ob.eyeFalloff?-ob.eyeFalloff:ob.facadeStyle||0,0])]};
          for(const [name,v]of Object.entries(values))g.attrs[name].array.set(v,i*fields[name]);
        });for(const a of Object.values(g.attrs))a.needsUpdate=true;
      }
      for(const [key,g] of groups) if(!g.mesh.count){drop(g);groups.delete(key);const map=maps.get(key);if(map){map.tex.dispose();maps.delete(key);}}
      // SM1b: the casters' version moves only when the instance data (or the SDF nodes) changed, so a still frame keeps its maps (the map key holds this).
      let h = 2166136261; const mix = (arr, n) => { const u32 = new Uint32Array(arr.buffer, arr.byteOffset, n); for (let i = 0; i < n; i++) h = Math.imul(h ^ u32[i], 16777619); };
      for (const g of groups.values()) { h = Math.imul(h ^ g.mesh.count, 16777619); for (const [name, n] of Object.entries(fields)) mix(g.attrs[name].array, g.mesh.count * n); }
      if (sdfs.length) mix(nodeData, sdfs.length * D.Models.MAX_NODES * 12);
      if (h !== lastHash) { lastHash = h; ver++; }
      prototype.proxyPrimitives=count;prototype.proxyTriangles=count*2;
      return count;
    },
    prototype,models,
    // SM1b: the casters for one map. view: eye and axes in the car frame (cfw: carFromWorld), row: the map's first row in the stacked target.
    casters: {
      get ver() { return ver; },
      scene: mapScene,
      view(m, row, W, H, cfw) {
        omU.omEye.value.fromArray(m.eye); omU.omEyeW.value.fromArray(m.eye).applyMatrix3(cfw.clone().transpose()); omU.omF.value.fromArray(m.f); omU.omL.value.fromArray(m.l); omU.omU.value.fromArray(m.u);
        omU.omTan.value.set(m.tanH, m.tanV); omU.omRes.value.set(W, H); omU.omRow.value = row;
        for (const g of groups.values()) {
          if (!g.mapMesh) { const mat = new T.ShaderMaterial({ uniforms: { ...g.uniforms, ...omU, maskMode: { value: 0 } }, vertexShader: mapVertex, fragmentShader: mapText(g.leafy ? leafyFragment : objectFragment), depthTest: true, depthWrite: true, depthFunc: T.LessDepth, side: T.DoubleSide });
            g.mapMesh = new T.InstancedMesh(g.mesh.geometry, mat, g.capacity); g.mapMesh.frustumCulled = false; mapScene.add(g.mapMesh); }
          g.mapMesh.count = g.mesh.count;
        }
      },
    },
    mask(on){models.mask(on);for(const g of groups.values())g.uniforms.maskMode.value=typeof on==='number'?on:on?1:0;},
    dispose(){models.dispose();if(nodeTexture)nodeTexture.dispose();if(card)card.dispose();for(const g of groups.values())drop(g);for(const m of maps.values())m.tex.dispose();zero.dispose();groups.clear();maps.clear();},
  };
}
