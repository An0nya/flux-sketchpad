/* GPU-only car bodies and one relightable tree impostor. Optical discs remain analytic. */
import * as T from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { ground } from './drive-three-shaders.js';
const D=globalThis.RF.Drive, names=['sedan','suv','hatchback-sports'];
let assets,loading,assetError='';
const lighting=ground.slice(0,ground.indexOf('vec4 roadFrame'));
const vertex=`
varying vec3 worldPoint,worldNormal;varying vec2 modelUV;
void main(){vec4 p=instanceMatrix*vec4(position,1);worldPoint=p.xyz;worldNormal=mat3(instanceMatrix)*normal;modelUV=uv;
 vec3 q=p.xyz-eye;gl_Position=vec4(-q.y/tanH,q.z/(tanH*size.y/size.x),0,q.x);}
`;
const fragment=lighting+`
varying vec3 worldPoint,worldNormal;varying vec2 modelUV;
uniform sampler2D bodyMap;uniform int maskMode;uniform bool wheel;
void main(){vec3 p=worldPoint,n=normalize(worldNormal),ray=normalize(p-eye);float t=length(p-eye);
 if(t<.0001 || t>5000.0 || (ray.z<0.0 && t>=-eye.z/ray.z))discard;
 if(dot(n,ray)>0.0)n=-n;int id=wheel?31:30;
 vec3 tex=texture(bodyMap,modelUV).rgb;
 if(!wheel && max(tex.r,max(tex.g,tex.b))<.15)id=27;
 gl_FragDepth=min(.99999,t/5000.0);
 if(maskMode==2){gl_FragColor=vec4(float(id),0,p.z,0);return;}
 if(maskMode>0){gl_FragColor=vec4(0,0,0,1);return;}
 gl_FragColor=vec4(shade(p,n,-ray,id),1);
}
`;
export function modelMeshes(scene,uniforms,onReady) {
  const groups=new Map(),matrix=new T.Matrix4(),rotation=new T.Quaternion(),scale=new T.Vector3(1,1,1),position=new T.Vector3();let disposed=false,waiting=false;
  const state={ready:false,error:'',cars:0,triangles:0};
  return {
    get ready(){return state.ready;},state,
    load(){
      if(!loading && !assets && !assetError){const loader=new GLTFLoader();loading=Promise.all(names.map(name=>loader.loadAsync(new URL('../vendor/models/'+name+'.glb',import.meta.url).href))).then(gltfs=>{
        assets=gltfs.map(g=>{g.scene.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(g.scene),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),parts=[];
          // glTF Y up, +Z front -> app Z up, +X front. Bodies fit inside the retained lamp/plate planes ±2.21 m.
          const fit=new T.Matrix4().set(0,0,4.36/size.z,-center.z*4.36/size.z,1.76/size.x,0,0,-center.x*1.76/size.x,0,1.4/size.y,0,-bounds.min.y*1.4/size.y,0,0,0,1);
          g.scene.traverse(ob=>{if(ob.isMesh){const geometry=ob.geometry.clone().applyMatrix4(ob.matrixWorld).applyMatrix4(fit);parts.push({geometry,map:ob.material.map,wheel:ob.name.startsWith('wheel'),triangles:geometry.index?geometry.index.count/3:geometry.attributes.position.count/3});ob.geometry.dispose();ob.material.dispose();}});return parts;});loading=null;
      }).catch(e=>{assetError=String(e);loading=null;});}
      if(loading && !waiting){waiting=true;loading.then(()=>{if(!disposed){state.ready=!!assets;state.error=assetError;if(onReady)onReady();}});}
      if(!disposed){state.ready=!!assets;state.error=assetError;}
    },
    update(p,cars,ss,on){
      state.cars=cars.length;state.triangles=0;for(const g of groups.values())g.mesh.count=0;
      if(on && assets)for(let a=0;a<assets.length;a++){
        const list=cars.filter((_,i)=>i%assets.length===a);if(!list.length)continue;
        assets[a].forEach((part,j)=>{const key=a+':'+j;let g=groups.get(key);
          if(!g || g.mesh.instanceMatrix.count<list.length){if(g){scene.remove(g.mesh);g.mesh.dispose();g.mesh.material.dispose();}
            const local={...uniforms,bodyMap:{value:part.map},wheel:{value:part.wheel},maskMode:{value:0}};
            // Include the same lighting uniforms in the vertex stage (only eye, tanH and size are needed there).
            const material=new T.ShaderMaterial({uniforms:local,vertexShader:'uniform vec3 eye;uniform float tanH;uniform vec2 size;\n'+vertex,fragmentShader:fragment,depthTest:true,depthWrite:true,depthFunc:T.LessDepth,side:T.DoubleSide});
            const mesh=new T.InstancedMesh(part.geometry,material,Math.max(16,list.length*2));mesh.frustumCulled=false;scene.add(mesh);g={mesh,local};groups.set(key,g);
          }
          g.mesh.count=list.length;
          list.forEach((ob,i)=>{const m=ob.detail;position.set(m.x,m.y,0);rotation.setFromAxisAngle(new T.Vector3(0,0,1),m.yaw+(m.face===-1?Math.PI:0));matrix.compose(position,rotation,scale);g.mesh.setMatrixAt(i,matrix);state.triangles+=part.triangles;});g.mesh.instanceMatrix.needsUpdate=true;
        });
      }
    },
    mask(on){for(const g of groups.values())g.local.maskMode.value=typeof on==='number'?on:on?1:0;},
    dispose(){disposed=true;const geometries=new Set(),textures=new Set();for(const g of groups.values()){scene.remove(g.mesh);geometries.add(g.mesh.geometry);textures.add(g.local.bodyMap.value);g.mesh.dispose();g.mesh.material.dispose();}for(const geometry of geometries)geometry.dispose();for(const tex of textures)if(tex)tex.dispose();groups.clear();},
  };
}
export function bakeTree() {
  const w=64,h=128,tree=D.Models.build('tree',{h:9}),data=new Float32Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const yy=((x+.5)/w-.5)*9*.8,zz=(y+.5)/h*9,hit=D.Models.trace(tree,-12,yy,zz,1,0,0,30);
    if(Number.isFinite(hit.t))data.set([hit.n[1],hit.n[2],(-12+hit.t)/9,hit.id+1],4*(y*w+x));
  }
  const tex=new T.DataTexture(data,w,h,T.RGBAFormat,T.FloatType);tex.minFilter=tex.magFilter=T.NearestFilter;tex.needsUpdate=true;return tex;
}
