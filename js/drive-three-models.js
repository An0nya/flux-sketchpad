/* GPU-only car bodies and relightable fixed-view tree cards. Optical lamps and rectangular plates remain analytic. */
import * as T from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { ground } from './drive-three-shaders.js';
const D=globalThis.RF.Drive, names=['sedan','suv','hatchback-sports'];
let assets,loading,assetError='';
// A GPU-only metal finish, using the existing microfacet lighting equation; no shared material-table change.
const lighting=ground.slice(0,ground.indexOf('vec4 roadFrame')).replace('vec4 gloss=texelFetch(materials,ivec2(id,2),0);','vec4 gloss=texelFetch(materials,ivec2(id,2),0);if(id==20){rho=vec3(.04);gloss=vec4(.10,.60,0,0);}');
const vertex=`
attribute float surfaceId;varying float modelId;varying vec3 worldPoint,worldNormal,localPoint;varying vec2 modelUV;
void main(){vec4 p=instanceMatrix*vec4(position,1);localPoint=position;modelId=surfaceId;worldPoint=p.xyz;worldNormal=mat3(instanceMatrix)*normal;modelUV=uv;
 vec3 q=carFromWorld*(p.xyz-eye);gl_Position=vec4(-q.y/tanH,q.z/(tanH*size.y/size.x),0,q.x);}
`;
const fragment=lighting+`
varying float modelId;varying vec3 worldPoint,worldNormal,localPoint;varying vec2 modelUV;
uniform sampler2D bodyMap;uniform int maskMode;uniform bool wheel;uniform float samples;
void main(){vec3 p=worldPoint,n=normalize(worldNormal),ray=normalize(p-eye);float t=length(p-eye);
 if(t<.0001 || t>5000.0)discard;
 if(ray.z<0.0 && t>=-eye.z/ray.z)discard;
 if(dot(n,ray)>0.0)n=-n;int id=int(modelId+.5);
 gl_FragDepth=min(.99999,t/5000.0);
 if(maskMode==2){gl_FragColor=vec4(float(id),0,p.z,0);return;}
 if(maskMode>0){gl_FragColor=vec4(0,0,0,1);return;}
 gl_FragColor=vec4(shade(p,n,-ray,id),1);
}
`;
export function modelMeshes(scene,uniforms,onReady) {
  const groups=new Map(),matrix=new T.Matrix4(),rotation=new T.Quaternion(),scale=new T.Vector3(1,1,1),position=new T.Vector3();let disposed=false,waiting=false;
  const state={ready:false,error:'',cars:0,triangles:0,mounts:[]};
  return {
    get ready(){return state.ready;},state,
    load(){
      if(!loading && !assets && !assetError){const loader=new GLTFLoader();loading=Promise.all(names.map(name=>loader.loadAsync(new URL('../vendor/models/'+name+'.glb',import.meta.url).href))).then(gltfs=>{
        assets=gltfs.map(g=>{g.scene.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(g.scene),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),parts=[];
          // glTF Y up, +Z front -> app Z up, +X front. Fit the asset envelope; mounts are measured against each transformed body below.
          const fit=new T.Matrix4().set(0,0,4.36/size.z,-center.z*4.36/size.z,1.76/size.x,0,0,-center.x*1.76/size.x,0,1.4/size.y,0,-bounds.min.y*1.4/size.y,0,0,0,1);
          g.scene.traverse(ob=>{if(ob.isMesh){let geometry=ob.geometry.clone().applyMatrix4(ob.matrixWorld).applyMatrix4(fit);if(geometry.index){const old=geometry;geometry=geometry.toNonIndexed();old.dispose();}
            const wheel=ob.name.startsWith('wheel'),pos=geometry.attributes.position,uv=geometry.attributes.uv,ids=new Float32Array(pos.count),indices=[],plateTriangles=[],canvas=document.createElement('canvas'),image=ob.material.map.image;canvas.width=image.width;canvas.height=image.height;const cx=canvas.getContext('2d');cx.drawImage(image,0,0);const pixels=cx.getImageData(0,0,image.width,image.height).data;
            for(let i=0;i<pos.count;i+=3){const u=(uv.getX(i)+uv.getX(i+1)+uv.getX(i+2))/3,v=(uv.getY(i)+uv.getY(i+1)+uv.getY(i+2))/3,k=(Math.min(image.height-1,Math.max(0,Math.floor(v*image.height)))*image.width+Math.min(image.width-1,Math.max(0,Math.floor(u*image.width))))*4,r=pixels[k]/255,g=pixels[k+1]/255,b=pixels[k+2]/255,z=(pos.getZ(i)+pos.getZ(i+1)+pos.getZ(i+2))/3,x=(pos.getX(i)+pos.getX(i+1)+pos.getX(i+2))/3,y=(pos.getY(i)+pos.getY(i+1)+pos.getY(i+2))/3,neutral=Math.max(r,g,b)-Math.min(r,g,b)<.08;
              // Verified against the original atlas render: pale cyan = glass, neutral dark = rubber, wheel hubs / neutral trim = metal. Coloured panels = paint.
              const glass=r>.7&&g-r>.035&&b-r>.07,metal=Math.abs(r-g)<.035&&r>.7&&b-r<.12;
              const id=wheel?(Math.max(r,g,b)<.32?31:20):glass?27:neutral&&Math.max(r,g,b)<.32?31:metal?20:30;ids.fill(id,i,i+3);
              // Remove Kenney's small octagonal white plate fixture; our regional rectangular sheeting replaces it on the bumper itself.
              if(!wheel&&metal&&Math.abs(x)>1.7&&Math.abs(y)<.38&&z<.6)plateTriangles.push(i);
            }
            // Remove the whole disconnected fixture (including its bevel), preserving the bumper behind it.
            const parent=Array.from({length:pos.count},(_,i)=>i),weld=new Map(),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},join=(a,b)=>{parent[find(a)]=find(b);};
            for(let i=0;i<pos.count;i++){const key=[pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>Math.round(v*1e6)).join(':');if(weld.has(key))join(i,weld.get(key));else weld.set(key,i);if(i%3)join(i,i-i%3);}
            const candidates=new Set(plateTriangles.map(find));for(let i=0;i<pos.count;i++)if(Math.abs(pos.getX(i))<1.5||Math.abs(pos.getY(i))>.4||pos.getZ(i)>.6)candidates.delete(find(i));
            for(let i=0;i<pos.count;i+=3)if(!candidates.has(find(i)))indices.push(i,i+1,i+2);
            geometry.setAttribute('surfaceId',new T.BufferAttribute(ids,1));geometry.setIndex(indices);parts.push({geometry,map:ob.material.map,wheel,triangles:indices.length/3});ob.geometry.dispose();ob.material.dispose();}});const body=parts.find(p=>!p.wheel),mesh=new T.Mesh(body.geometry,new T.MeshBasicMaterial({side:T.DoubleSide})),ray=new T.Raycaster();
          // headY/lamp: head-lamp centre (car y, z). SUV: the light housings either side of the plate are centred at |y|~0.47, z~0.70 (measured from head-on render, see tests/models-m2-page.js); the outer edge at 0.62 sat on the housing rim. Sedan/hatchback have no flanking housings, so they keep 0.62.
          const config=[{lamp:.68,tail:.78,plate:.43,headY:.62},{lamp:.70,tail:.90,plate:.46,headY:.47},{lamp:.63,tail:.77,plate:.40,headY:.62}][gltfs.indexOf(g)];
          const mount=(end,y,z,optional=false)=>{ray.set(new T.Vector3(end*4,y,z),new T.Vector3(-end,0,0));const hit=ray.intersectObject(mesh)[0];if(!hit){if(optional)return null;throw Error('no bumper/lamp surface '+end+'/'+y+'/'+z);}let normal=hit.face.normal.clone();if(normal.x*end<0)normal.negate();return {p:hit.point.clone().addScaledVector(normal,.001).toArray(),n:normal.toArray(),gap:.001};};
          parts.mounts={};for(const end of [-1,1])for(const type of ['head','tail','plate','reflector'])for(const side of type==='plate'?[0]:[-1,1]){const y=side*(type==='head'?config.headY:.70),z=type==='plate'?config.plate:type==='head'?config.lamp:type==='tail'?config.tail:config.tail-.14;const plateY=type==='plate'&&gltfs.indexOf(g)===1&&end===-1?.61:y,plateZ=type==='plate'&&gltfs.indexOf(g)===1&&end===-1?.50:z;let m=mount(end,plateY,plateZ);
            if(type==='plate'){
              let best=Infinity;
              for(let zz=plateZ-.06;zz<=plateZ+.061;zz+=.01){const centre=mount(end,plateY,zz,true);if(!centre)continue;let error=0;
                for(const yy of [-.26,0,.26])for(const dz of [-.076,0,.076]){const q=mount(end,plateY+yy,zz+dz,true);if(!q){error=Infinity;continue;}error=Math.max(error,Math.abs((q.p[0]-centre.p[0])*centre.n[0]+(q.p[1]-centre.p[1])*centre.n[1]+(q.p[2]-centre.p[2])*centre.n[2]));}
                const score=error+Math.abs(zz-plateZ)*.2;if(score<best){best=score;m={...centre,planeError:error};}
              }
            }
            parts.mounts[end+':'+type+':'+side]=m;}
          for(const end of [-1,1]){
            const m=parts.mounts[end+':plate:0'];m.bodyNormal=m.n;m.n=[end,0,0];const n=new T.Vector3(...m.n),t=new T.Vector3(-n.y,n.x,0).normalize(),up=new T.Vector3().crossVectors(n,t),centre=new T.Vector3(...m.p);let lift=0;
            for(const y of [-.26,0,.26])for(const z of [-.076,0,.076]){const q=centre.clone().addScaledVector(t,y).addScaledVector(up,z);ray.set(q.clone().addScaledVector(n,3),n.clone().negate());const hit=ray.intersectObject(mesh)[0];if(hit)lift=Math.max(lift,hit.point.clone().sub(q).dot(n)+.003);}
            centre.addScaledVector(n,lift);m.p=centre.toArray();m.padDepth=lift+.003;
            for(const us of [false,true]){
              const w=(us?.305:.520)/2+.003,h=(us?.152:.110)/2+.003,front=[],back=[];
              for(const [y,z]of [[-w,-h],[w,-h],[w,h],[-w,h]]){const q=centre.clone().addScaledVector(t,y).addScaledVector(up,z);front.push(q.clone().addScaledVector(n,-.001));ray.set(q.clone().addScaledVector(n,3),n.clone().negate());const hit=ray.intersectObject(mesh)[0];back.push(hit?hit.point.clone().addScaledVector(n,-.002):q.clone().addScaledVector(n,-Math.max(.01,lift)));}
              const verts=[],triangle=(a,b,c)=>verts.push(...a.toArray(),...b.toArray(),...c.toArray());triangle(front[0],front[1],front[2]);triangle(front[0],front[2],front[3]);
              for(let i=0;i<4;i++){const j=(i+1)%4;triangle(front[i],back[i],back[j]);triangle(front[i],back[j],front[j]);}
              const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(verts,3));geometry.computeVertexNormals();geometry.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(verts.length/3*2),2));geometry.setAttribute('surfaceId',new T.Float32BufferAttribute(new Float32Array(verts.length/3).fill(31),1));parts.push({geometry,map:body.map,wheel:true,region:us,triangles:verts.length/9});
            }
          }
          mesh.material.dispose();return parts;});loading=null;
      }).catch(e=>{assetError=String(e);loading=null;});}
      if(loading && !waiting){waiting=true;loading.then(()=>{if(!disposed){state.ready=!!assets;state.error=assetError;if(onReady)onReady();}});}
      if(!disposed){state.ready=!!assets;state.error=assetError;}
    },
    adapt(obs,p){
      if(!assets)return obs;const roots=new Map();for(const ob of obs)if(ob.detailPart==='car'&&ob.detail)roots.set(ob.modelId,ob.detail);
      const out=[];state.mounts=[];
      for(const ob of obs){const m=roots.get(ob.modelId);if(!m||ob.detailPart!=='car'){out.push(ob);continue;}if(ob.k!=='disc'){if(ob.detail)out.push({...ob,k:'mesh-car'});continue;}
        const a=D.Models.stableId(m.id)%assets.length,F=m.face===-1?-1:1,yaw=m.yaw+(F===-1?Math.PI:0),c=Math.cos(yaw),s=Math.sin(yaw),end=((ob.x-m.x)*Math.cos(m.yaw)+(ob.y-m.y)*Math.sin(m.yaw))*F>0?1:-1,type=ob.mat==='plate'?'plate':ob.mat==='reflector-red'?'reflector':ob.headlamp?'head':'tail',side=type==='plate'?0:Math.sign(-(ob.x-m.x)*s+(ob.y-m.y)*c),mount=assets[a].mounts[end+':'+type+':'+side];
        const q={...ob,x:m.x+c*mount.p[0]-s*mount.p[1],y:m.y+s*mount.p[0]+c*mount.p[1],z:(m.z||0)+mount.p[2],nx:c*mount.n[0]-s*mount.n[1],ny:s*mount.n[0]+c*mount.n[1],nz:mount.n[2],bs:undefined};
        if(type==='plate'){q.k='rect';q.rx=(p.us?.305:.520)/2;q.rz=(p.us?.152:.110)/2;q.r=Math.hypot(q.rx,q.rz);q.sub=false;}
        out.push(q);state.mounts.push({id:m.id,variant:names[a],type,side,end,...mount,width:q.rx?2*q.rx:undefined,height:q.rz?2*q.rz:undefined});
      }return out;
    },
    update(p,cars,ss,on){
      state.cars=cars.length;state.triangles=0;for(const g of groups.values()){g.mesh.count=0;g.local.samples.value=ss;}
      if(on && assets)for(let a=0;a<assets.length;a++){
        const list=cars.filter(ob=>D.Models.stableId(ob.detail.id)%assets.length===a);if(!list.length)continue;
        assets[a].forEach((part,j)=>{if(part.region!==undefined&&part.region!==!!p.us)return;const key=a+':'+j;let g=groups.get(key);
          if(!g || g.mesh.instanceMatrix.count<list.length){if(g){scene.remove(g.mesh);g.mesh.dispose();g.mesh.material.dispose();}
            const local={...uniforms,bodyMap:{value:part.map},wheel:{value:part.wheel},maskMode:{value:0},samples:{value:ss}};
            // Include the same lighting uniforms in the vertex stage (only eye, tanH and size are needed there).
            const material=new T.ShaderMaterial({uniforms:local,vertexShader:'uniform vec3 eye;uniform float tanH;uniform vec2 size;uniform mat3 carFromWorld;\n'+vertex,fragmentShader:fragment,depthTest:true,depthWrite:true,depthFunc:T.LessDepth,side:T.DoubleSide});
            const mesh=new T.InstancedMesh(part.geometry,material,Math.max(16,list.length*2));mesh.frustumCulled=false;scene.add(mesh);g={mesh,local};groups.set(key,g);
          }
          g.mesh.count=part.region===undefined||part.region===!!p.us?list.length:0;
          list.forEach((ob,i)=>{const m=ob.detail;position.set(m.x,m.y,m.z||0);
            if(m.normal){   // pass: sit on the road surface (its normal and grade) and follow the heading; flat cars keep the level pose below
              const F=m.face===-1?-1:1,n=m.normal,t=[Math.cos(m.yaw)*F,Math.sin(m.yaw)*F,(m.grade||0)*F],k=t[0]*n[0]+t[1]*n[1]+t[2]*n[2];
              const U=new T.Vector3(n[0],n[1],n[2]),X=new T.Vector3(t[0]-k*n[0],t[1]-k*n[1],t[2]-k*n[2]).normalize(),Y=new T.Vector3().crossVectors(U,X);
              rotation.setFromRotationMatrix(new T.Matrix4().makeBasis(X,Y,U));
            } else rotation.setFromAxisAngle(new T.Vector3(0,0,1),m.yaw+(m.face===-1?Math.PI:0));
            matrix.compose(position,rotation,scale);g.mesh.setMatrixAt(i,matrix);state.triangles+=part.triangles;});g.mesh.instanceMatrix.needsUpdate=true;
        });
      }
    },
    mask(on){for(const g of groups.values())g.local.maskMode.value=typeof on==='number'?on:on?1:0;},
    dispose(){disposed=true;const geometries=new Set(),textures=new Set();for(const g of groups.values()){scene.remove(g.mesh);geometries.add(g.mesh.geometry);textures.add(g.local.bodyMap.value);g.mesh.dispose();g.mesh.material.dispose();}for(const geometry of geometries)geometry.dispose();for(const tex of textures)if(tex)tex.dispose();groups.clear();},
  };
}
export function bakeTree() {
  const w=64,h=128,views=8,variants=3,data=new Float32Array(w*h*views*variants*4);
  for(let v=0;v<variants;v++){
    let id=0;while(D.Models.stableId(String(id))%3!==v)id++;
    const tree=D.Models.tree({h:9,id:String(id)});
    for(let view=0;view<views;view++){
      const angle=view*Math.PI*2/views,n=[Math.cos(angle),Math.sin(angle)],t=[-n[1],n[0]];
      for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
        const yy=((x+.5)/w-.5)*7.2,zz=(y+.5)/h*9,ox=n[0]*12+t[0]*yy,oy=n[1]*12+t[1]*yy;let best=30,normal,id;
        for(const ob of tree){const hit=D.hitObj(ob,ox,oy,zz,-n[0],-n[1],0,best,0);if(hit<best){best=hit;normal=D.hit().n.slice();id=D.MAT_KEYS.indexOf(ob.mat);}}
        if(normal)data.set([normal[0]*t[0]+normal[1]*t[1],normal[2],-(12-best)/9,id+1],4*(((v*views+view)*h+y)*w+x));
      }
    }
  }
  const tex=new T.DataTexture(data,w,h*views*variants,T.RGBAFormat,T.FloatType);tex.minFilter=tex.magFilter=T.NearestFilter;tex.needsUpdate=true;return tex;
}
