/* TG GPU-only ribbon terrain. Existing shaders are retained byte-for-byte outside the pass. */
import * as T from '../vendor/three/three.module.min.js';
import { ground } from './drive-three-shaders.js';
const uniforms = `uniform mat3 worldFromCar, carFromWorld; uniform sampler2D passDepth, passShadow0, passShadow1; uniform float trafficPitch[64];\n`;
export function passShader(source, vertex = false) {
  if (vertex) return source;
  let s = uniforms + source;
  s = s.replace('float cornerIntensity(vec3 d,vec3 origin) {', 'float cornerIntensity(vec3 d,vec3 origin) { d=carFromWorld*d; origin=carFromWorld*origin;');
  s = s.replace('float intensity(vec3 d) {', 'float intensity(vec3 d) { d=carFromWorld*d;');
  s = s.replace('float I=intensity(d)', `vec3 sd=carFromWorld*d; float st=length(d); vec2 suv=vec2(-sd.y/1.2,sd.z/.6)/sd.x*.5+.5;
    if(sd.x>0.0 && all(greaterThanEqual(suv,vec2(0))) && all(lessThanEqual(suv,vec2(1)))) {
      float depth=i==0 ? texture2D(passShadow0,suv).r : texture2D(passShadow1,suv).r;
      vec2 cell=(floor(suv*vec2(2048,1024))+.5)/vec2(2048,1024);
      vec3 sr=worldFromCar*normalize(vec3(1,-(cell.x*2.0-1.0)*1.2,(cell.y*2.0-1.0)*.6));
      vec3 pn=normalize(cross(dFdx(p),dFdy(p)));float den=dot(sr,pn), expected=dot(d,pn)/den;
      if(abs(den)>.000001 && expected>0.0 && expected/5000.0>depth+0.00003)continue;
    }
    float I=intensity(d)`);
  // BA5: the traffic loop has two spellings: the legacy one-table text and the atlas text (per-lamp tint 'otint'). Both get the pitch.
  const loopCall = /r\+=rho\*(vec3\(1,1,0\.93\)|otint)\*otherIntensity\(local\)/;
  if (!loopCall.test(s) && s.includes('otherIntensity(local)')) throw Error('BA5 touge pass: traffic loop text changed');   // no traffic loop (the plain pass material) is fine
  s = s.replace(loopCall, (m, tint) => `float cp=cos(trafficPitch[i]),sp=sin(trafficPitch[i]);local=vec3(cp*local.x+sp*local.z,local.y,cp*local.z-sp*local.x);
    r+=rho*${tint}*otherIntensity(local)`);
  s = s.replace('float wetLobe(vec3 d,vec3 v) {', `float wetLobe(vec3 d,vec3 v,vec3 normal) {
    vec3 x=normalize(vec3(normal.z,0,-normal.x)), y=cross(normal,x);
    d=vec3(dot(d,x),dot(d,y),dot(d,normal));v=vec3(dot(v,x),dot(v,y),dot(v,normal));`)
    .replace('wetLobe(reflection[i].xyz-p,v)', 'wetLobe(reflection[i].xyz-p,v,n)').replace('wetLobe(-d,v)', 'wetLobe(-d,v,n)');
  // Analytic proxies retain their actual-world rays; only the camera projection changes.
  s = s.replace('n=vec3(0,0,1), v=-ray;', 'n=vec3(0,0,1), v=-ray; ray=worldFromCar*ray; v=-ray;');
  s = s.replace('if(ray.z<0.0 && t>=-eye.z/ray.z)discard;', 'if(t/5000.0>texture2D(passDepth,gl_FragCoord.xy/(size*samples)).r+0.000002)discard;');
  // In pass mode aTie carries surface gradients for rigid car/rail primitives (old tie ranks are unused).
  s = s.replace('vec3 o=eye-center; float ca=', `vec3 o=eye-center;
 vec3 bx=normalize(vec3(1,0,ties.x)), by=normalize(vec3(-ties.x*ties.y,1,ties.y)), bz=normalize(cross(bx,by)); by=cross(bz,bx);
 mat3 basis=mat3(bx,by,bz); vec3 originalRay=ray;
 o=vec3(dot(o,bx),dot(o,by),dot(o,bz)); ray=vec3(dot(ray,bx),dot(ray,by),dot(ray,bz));
 float ca=`);
  s = s.replace('if(abs(pose.x)<1e-8) hit=', 'if(false) hit=');
  s = s.replace('if(!(t>1e-4 && t<5000.0))discard;vec3 p=eye+t*ray;', 'n=basis*n; ray=originalRay; v=-ray; if(!(t>1e-4 && t<5000.0))discard;vec3 p=eye+t*ray;');
  return s;
}
export function surface(u) {
  const geometry = new T.BufferGeometry(), scene = new T.Scene(), camera = new T.Camera();
  const prefix = ground.slice(0, ground.indexOf('vec4 roadFrame'));
  let body = ground.slice(ground.indexOf('vec3 surface('), ground.indexOf('void main()'));
  body = body.replace('vec4 f=roadFrame(p.xy);', 'vec4 f=roadUV;').replace('n=vec3(0,0,1);', 'n=normalize(roadNormal);');
  body = body.replace('int(verge.y)', 'off>1.5*lane+2.2 ? 20 : int(verge.y)');
  const fragment = prefix + 'varying vec3 worldPoint, roadNormal; varying vec4 roadUV;\n' + body + `
void main() { vec3 v=normalize(eye-worldPoint); float t=length(eye-worldPoint);
 vec3 c=surface(worldPoint,v,t,max(.003,dot(v,normalize(roadNormal))));
 if(sigma>0.0){float T=exp(-sigma*t); c=c*T+ambient*0.012*(1.0+0.8*max(0.0,1.0-abs(v.z)*8.0))*(1.0-T);}
 if(scatterSteps>0) c+=inScatter(-v,t<5000.0?t:1e20,scatterJitter());   // TOUGE-AIR-RIBBON: the air beam on the road, direct or table lookup at the surface distance t, as the flat ground main (the pass beam pattern is patched by passShader)
 if(haloOn>0) c+=haloScatter(t<5000.0?t:1e20);   // TOUGE-ELEV B2: the traffic halo, read at the ribbon's surface distance (as the ground does)
 gl_FragColor=vec4(c,1);
 gl_FragDepth=min(.99999,t/5000.0); }
`;
  const vertex = `uniform vec3 eye; uniform float tanH; uniform vec2 size; uniform mat3 carFromWorld;
 attribute vec4 routeUV; varying vec3 worldPoint, roadNormal; varying vec4 roadUV;
 void main(){worldPoint=position;roadNormal=normal;roadUV=routeUV;vec3 q=carFromWorld*(position-eye);
 gl_Position=vec4(-q.y/tanH,q.z/(tanH*size.y/size.x),0,q.x);}`;
  const material = new T.ShaderMaterial({ uniforms: u, vertexShader: vertex, fragmentShader: fragment, side: T.DoubleSide, depthTest: true, depthWrite: true });
  const shadowMaterial = new T.ShaderMaterial({uniforms:u,vertexShader:vertex,fragmentShader:'uniform vec3 eye;varying vec3 worldPoint;void main(){gl_FragDepth=min(.99999,length(worldPoint-eye)/5000.0);gl_FragColor=vec4(0);}',side:T.DoubleSide});
  const shadowScene = new T.Scene(), shadowMesh = new T.Mesh(geometry,shadowMaterial);shadowMesh.frustumCulled=false;shadowScene.add(shadowMesh);
  const shadows = Array.from({length:2},()=>new T.WebGLRenderTarget(2048,1024,{depthTexture:new T.DepthTexture(1024,512,T.FloatType),depthBuffer:true}));
  const mesh = new T.Mesh(geometry, material); mesh.frustumCulled = false; scene.add(mesh);
  // TOUGE-SKY-VEIL: the sky gets the same halo veil as the far ground. haloScatter(1e20) saturates at 120 m and reads only gl_FragCoord, so no view ray is needed.
  // The sky fragment reuses the ground prefix (ambient, tanH, size, screen and the halo tables are declared there); halo off = the old ambient-only colour.
  // REVIEW B4: the sky also gets our own air beam (direct or table lookup, saturating at S_MAX like the flat sky), or lit cliffs and trees stand out against a black sky in haze.
  // worldFromCar is declared by passShader, which drive-three.js applies to this material (shading(..., mountain = true)) along with the table text.
  const skyFragment = prefix + 'void main(){vec3 ray=worldFromCar*normalize(vec3(1,-screen.x*tanH,screen.y*tanH*size.y/size.x));vec3 c=vec3(ambient*.012*(1.0+.8*max(0.0,1.0-abs(ray.z)*8.0)));if(scatterSteps>0) c+=inScatter(ray,1e20,scatterJitter());if(haloOn>0) c+=haloScatter(1e20);gl_FragColor=vec4(c,1);}';
  const skyMaterial = new T.ShaderMaterial({ uniforms: u, vertexShader: 'varying vec2 screen;void main(){screen=position.xy;gl_Position=vec4(position.xy,.999999,1);}', fragmentShader: skyFragment, depthTest: false, depthWrite: false });
  const sky = new T.Mesh(new T.PlaneGeometry(2,2), skyMaterial); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
  return { scene, camera, material, skyMaterial,
    shadows(renderer){
      const eye=u.eye.value.clone(),size=u.size.value.clone(),tan=u.tanH.value;
      u.size.value.set(2048,1024);u.tanH.value=1.2;
      for(let i=0;i<2;i++){u.eye.value.copy(u.lamp.value[Math.min(i,u.nLamp.value-1)]);renderer.setRenderTarget(shadows[i]);renderer.render(shadowScene,camera);}
      u.eye.value.copy(eye);u.size.value.copy(size);u.tanH.value=tan;
      u.passShadow0.value=shadows[0].depthTexture;u.passShadow1.value=shadows[1].depthTexture;
    },
    update(A, dist) {
      const lane=A.lane, offsets=[-75,-18,-lane/2-2.3,-lane/2-2.2,-lane/2,0,1.5*lane,1.5*lane+2.2,1.5*lane+2.3,25,70];
      const start=Math.floor((dist-35)/2)*2, rows=191, cols=offsets.length, count=rows*cols;
      if(!geometry.attributes.position){
        geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(count*3),3).setUsage(T.DynamicDrawUsage));
        geometry.setAttribute('normal',new T.BufferAttribute(new Float32Array(count*3),3).setUsage(T.DynamicDrawUsage));
        geometry.setAttribute('routeUV',new T.BufferAttribute(new Float32Array(count*4),4).setUsage(T.DynamicDrawUsage));
        const idx=[];for(let i=0;i<rows-1;i++)for(let j=0;j<cols-1;j++){const a=i*cols+j,b=a+cols;idx.push(a,b,a+1,a+1,b,b+1);}geometry.setIndex(idx);
      }
      const pos=geometry.attributes.position.array,normals=geometry.attributes.normal.array,uv=geometry.attributes.routeUV.array;
      for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
        const s=start+i*2-dist,station=s+dist,tile=globalThis.RF.Touge.tile(0,Math.floor(station/200)),u=station-tile.s0;
        const fade=Math.max(0,Math.min(1,(u-15)/35,(185-u)/35)),limit=tile.curvature ? 70*(1-fade)+.7/Math.abs(tile.curvature)*fade : 75;
        const off=tile.curvature>0?Math.min(offsets[j],limit):tile.curvature<0?Math.max(offsets[j],-limit):offsets[j],q=A.surface(s,off),k=i*cols+j,t=A.at(s).t;
        pos.set(q.p,k*3);normals.set(q.normal,k*3);uv.set([s,off,...t],k*4);
      }
      for(const key of ['position','normal','routeUV'])geometry.attributes[key].needsUpdate=true;
    },
    dispose(){geometry.dispose();material.dispose();shadowMaterial.dispose();shadows.forEach(q=>q.dispose());sky.geometry.dispose();skyMaterial.dispose();}
  };
}
