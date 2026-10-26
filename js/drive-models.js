/* Opt-in articulated actors and analytic tree clusters. Poses are built once; CPU and GPU consume the same float32 nodes.
 * Ellipsoids use a conservative distance bound, capsules an exact distance, polynomial smooth union. */
(function(root){
  'use strict';
  const D=root.RF.Drive, MAX_NODES=32, STEPS=96, EPS=.002, BLEND=.045;
  const clamp=x=>Math.max(0,Math.min(1,x)),fract=x=>x-Math.floor(x);
  const GAITS={stand:{stride:1,duty:1,lift:0},walk:{stride:1.05,duty:.68,lift:.12},trot:{stride:1.65,duty:.52,lift:.19},bound:{stride:2.5,duty:.32,lift:.28}};
  // Pure state machine: start and stop through walk; the caller can request a named gait.
  function locomotion(kind,distance,speed,moving,requested) {
    const target=GAITS[requested]?requested:kind==='person'?'walk':speed<1.7?'walk':speed<3.2?'trot':'bound';
    const state=!moving?'stand':distance<.45?'walk':distance<.9&&target==='bound'?'trot':target;
    return {state,distance,stride:GAITS[state].stride};
  }
  // A walker's legs follow the ground it has covered, never the clock: one leg cycle is PERSON_STRIDE metres (two steps of ~0.7 m; a tuning value).
  // BLEND_T: seconds for a stopped walker's legs to settle into a stand. LEG_SWING: primitive leg splay (m), as drive-scenes.js draws it.
  const PERSON_STRIDE=1.45,BLEND_T=.3,LEG_SWING=.11;
  function foot(state,phase,offset,stride,blend=1) {
    const g=GAITS[state]||GAITS.walk,q=fract(phase+offset),stance=q<g.duty,s=stride||g.stride;
    if(state==='stand')return {x:0,z:.045,stance:true};
    const t=(q-g.duty)/(1-g.duty),ease=t*t*(3-2*t),z=.045+(stance?0:g.lift*Math.sin(Math.PI*t));
    const x=stance?s*(g.duty/2-q):s*g.duty*(ease-.5);
    return {x:x*blend,z:.045+(z-.045)*blend,stance};
  }
  // A pedestrian's gait from the distance it has walked (m). stoppedFor: seconds since it stopped, or null while it walks (or before it starts).
  // Returns the motion for build() and the primitive leg splay: the cycle freezes where the walker stopped and the legs settle over BLEND_T.
  function pedestrian(distance,stoppedFor) {
    if(!(distance>0))return {motion:{state:'stand',distance:0,stride:GAITS.stand.stride,blend:0},gait:0};
    const blend=stoppedFor==null?1:clamp(1-stoppedFor/BLEND_T);
    return {motion:{state:blend>0?'walk':'stand',distance,stride:PERSON_STRIDE,blend},gait:LEG_SWING*blend*Math.sin(2*Math.PI*distance/PERSON_STRIDE)};
  }
  // Two-link inverse kinematics in the limb plane; bend chooses the knee/hock side.
  function knee(a,b,l1,l2,bend) {
    const dx=b[0]-a[0],dz=b[2]-a[2],d=Math.max(.001,Math.hypot(dx,dz)),r=Math.min(d,l1+l2-.0001),along=(l1*l1-l2*l2+r*r)/(2*r),h=Math.sqrt(Math.max(0,l1*l1-along*along));
    return [a[0]+dx/d*along+bend*(-dz/d)*h,a[1],a[2]+dz/d*along+bend*(dx/d)*h];
  }
  function stableId(value){let h=2166136261;for(const c of String(value)){h=Math.imul(h^c.charCodeAt(0),16777619);}return h>>>0;}
  // All timings, probabilities and angular acceptance below are gameplay tuning, not measured deer responses.
  const deerEnabled=p=>!!p&&(p.deerBehaviour===undefined?!!p.detailedModels:!!p.deerBehaviour);
  function deerProfile(id){
    const u=n=>D.rng(stableId(String(id)+':deer:'+n))();
    return {trigger:60+140*u(0),turn:.5+.5*u(1),freeze:1.2+3*u(2),never:u(3)<.15,early:u(4)<.2};
  }
  function deerAttention(id,elapsed){
    const p=deerProfile(id),t=Math.max(0,elapsed),turn=p.never?0:clamp(t/p.turn),bolt=p.early?.18:p.turn+p.freeze;
    return {state:elapsed<0?'grazing':t>=bolt?'bolt':p.never?'grazing':t<p.turn?'turning':'freeze',up:elapsed<0?0:turn,turn:elapsed<0?0:turn,bolt,elapsed,profile:p};
  }
  function tree(o){
    const h=o.h||9,v=stableId(o.id||'tree')%3,out=[],x=o.x||0,y=o.y||0,tag={detailPart:'analytic-tree',treeId:o.id};
    out.push({...tag,k:'cyl',x,y,r:h*.018,z0:0,z1:h*.65,mat:o.birch?'trunk-birch':'bark',cls:'veg',detail:{...o,variant:v}});
    for(let i=0;i<6+v;i++){
      const a=i*2.399+v*.7,r=h*(.125+.017*(i%3)),spread=h*(v===1?.13:.16),xx=x+Math.cos(a)*spread,yy=y+Math.sin(a)*spread,z=h*(.48+.045*i);
      const dz=z-h*.37,L=Math.hypot(xx-x,yy-y,dz),cz=(z+h*.37)/2;out.push({...tag,k:'cyl',x:(x+xx)/2,y:(y+yy)/2,r:h*.007,z0:cz-L/2,z1:cz+L/2,axis:[(xx-x)/L,(yy-y)/L,dz/L],mat:o.birch?'trunk-birch':'bark',cls:'veg'});
      out.push({...tag,k:'ell',x:xx,y:yy,z,rx:r,ry:r,rz:r,mat:'foliage',cls:'veg'});
    }
    return out;
  }
  function build(kind, o) {
    o=o||{};const nodes=[],eyes=[],yaw=(o.yaw||0)+(kind==='person'?Math.atan2((o.dir||[1,0])[1],(o.dir||[1,0])[0]):0),c=Math.cos(yaw),s=Math.sin(yaw),F=o.face||1;
    const yawPoint=p=>[c*p[0]-s*p[1],s*p[0]+c*p[1],p[2]];
    // Terrain tilt (the deer on the pass, o.normal = unit surface normal in the route frame): rotate the whole body about the anchor so its up axis becomes the normal
    // (Rodrigues, axis z x n). The ellipsoids keep yaw-only axes (the node format has no pitch), so only the node positions tilt: an approximation, fine for pass slopes.
    let tilt=null;if(kind==='deer'&&o.normal){const n=o.normal,ax=[-n[1],n[0],0],sn=Math.hypot(ax[0],ax[1]),cs=n[2];if(sn>1e-6){const k=[ax[0]/sn,ax[1]/sn,0];tilt=v=>{const d=k[0]*v[0]+k[1]*v[1],cr=[k[1]*v[2],-k[0]*v[2],k[0]*v[1]-k[1]*v[0]];return[v[0]*cs+cr[0]*sn+k[0]*d*(1-cs),v[1]*cs+cr[1]*sn+k[1]*d*(1-cs),v[2]*cs+cr[2]*sn];};}}
    const point=tilt?p=>tilt(yawPoint(p)):yawPoint, id=k=>D.MAT_KEYS.indexOf(k);
    const ell=(p,r,m,angle=0)=>{p=point(p);nodes.push([...p,0,...r,1,0,0,angle,id(m)]);};
    const cap=(a,b,r,m)=>{a=point(a);b=point(b);nodes.push([...a,r,...b,0,0,0,0,id(m)]);};
    const attention=o.attention;let eyeNormal=null;
    const legacy=(o.gait||0)/(kind==='deer'?.14:.11),state=o.motion?.state||(o.bound?'bound':Math.abs(legacy)>0?'walk':'stand'),settings=GAITS[state]||GAITS.walk;
    const phase=o.motion?o.motion.distance/(o.motion.stride||settings.stride):fract(legacy*.25),blend=o.motion?.blend??1,feet=[];
    if(kind==='person') {
      const pm=o.pedMats||{},torso=pm.torso||(o.ptype==='light'?'cloth-light':o.ptype==='hivis'?'hivis':'cloth-dark'),legsM=pm.legs||'cloth-dark';
      // pm.strips (mix and small clothing modes, drive-scenes.js): reflective tape, 'hivis-tape'. Two torso bands 5 cm tall (flattened ellipsoids just outside the
      // torso at z 1.02 and 1.28, the torso's width at each height plus about 1.2 cm), a cuff on each forearm, a band on each shin above the ankle, and a patch
      // on each shoe. Each band is a few nodes; the whole body stays under MAX_NODES (15 nodes without tape, 23 with).
      const tape=!!pm.strips, along=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
      ell([0,0,1.19],[.16,.21,.31],torso);cap([0,0,1.43],[0,0,1.55],.06,'skin');ell([.015,0,1.66],[.1,.095,.13],'skin');
      if(tape){ell([0,0,1.02],[.145,.195,.025],'hivis-tape');ell([0,0,1.28],[.165,.213,.025],'hivis-tape');}
      for(const side of [-1,1]) {
        const f=foot(state,phase,side===1?0:.5,o.motion?.stride,blend),hip=[0,side*.11,.89],ankle=[f.x,side*.11,f.z+.035],k=knee(hip,ankle,.43,.43,1);
        cap(hip,k,.075,legsM);cap(k,ankle,.052,legsM);cap([f.x-.04,side*.11,f.z],[f.x+.12,side*.11,f.z],.045,legsM);feet.push({...f,p:point([f.x,side*.11,f.z])});
        if(tape){cap(along(k,ankle,.8),along(k,ankle,.95),.06,'hivis-tape');cap([f.x+.04,side*.11,f.z],[f.x+.12,side*.11,f.z],.047,'hivis-tape');}
        const swing=state==='stand'?0:Math.sin(2*Math.PI*(phase+(side===1?0:.5)))*.32*blend,shoulder=[0,side*.23,1.4],elbow=[-swing*.55,side*.24,1.13],hand=[-.04-swing,side*.24,.9];
        cap(shoulder,elbow,.06,torso);cap(elbow,hand,.045,torso);ell(hand,[.05,.045,.06],'skin');
        if(tape)cap(along(elbow,hand,.6),along(elbow,hand,.8),.052,'hivis-tape');
      }
    } else if(kind==='deer') {
      const bound=state==='bound',cycle=fract(phase),air=bound?Math.max(0,Math.sin((cycle-.3)/.7*Math.PI))*.20:0,flex=bound?Math.sin(cycle*2*Math.PI)*.07:0,z=air;
      ell([0,F*.05,1.02+z],[.22,.53,.27],'fur');ell([0,-F*.36,1.02+z],[.205,.26,.34],'fur');ell([0,F*.37,1.01+z+flex],[.20,.26,.28],'fur');
      const up=attention?attention.up:1,turn=attention?attention.turn:1;
      const target=Math.atan2(-(o.y||0),-(o.x||1))-yaw,delta=Math.atan2(Math.sin(target-Math.PI),Math.cos(target-Math.PI)),angle=attention?F*Math.PI/2*(1-turn)+delta*turn:0;
      if(attention)eyeNormal=[-Math.cos(yaw+angle),-Math.sin(yaw+angle),0];
      const hc=[-.03,-F*(1.02-.25*up),.36+1.06*up+z],co=Math.cos(angle),si=Math.sin(angle),head=p=>[hc[0]+co*p[0]-si*p[1],hc[1]+si*p[0]+co*p[1],hc[2]+p[2]];
      cap([0,-F*.42,1.13+z],attention?head([0,F*.12,-.03]):[-.025,-F*.65,1.39+z],.115,'fur');ell(hc,[.095,.20,.115],'fur',angle);
      cap(head([-.04,-F*.07,-.02]),head([-.16,-F*.10,-.05]),.065,'fur');
      for(const side of [-1,1]) {
        ell(attention?head([side*.10,F*(.08-side*.055),.185]):[side*.10,-F*(.69+side*.055),1.605+z],[.038,.063,.125],'fur',angle);
        for(const end of [-1,1]) {
          const offset=bound?(end===-1?0:.16):state==='trot'?(side*end===1?0:.5):(side===1?0:.5)+(end===1?.25:0),f=foot(state,phase,offset),hip=[0,side*.13,.90+z+(end===1?flex:0)],ankle=[f.x,side*.13,f.z];
          const hock=[f.x-(end===1?.11:.025),side*.13,f.z+.25],k=knee(hip,hock,.34,.34,end===1?-1:1),map=p=>[p[1],F*(end*.40-p[0]),p[2]];
          cap(map(hip),map(k),end===1?.07:.055,'fur');cap(map(k),map(hock),.035,'fur');cap(map(hock),map(ankle),.021,'fur');ell(map(ankle),[.035,.05,.045],'tyre');feet.push({...f,p:point(map(ankle))});
        }
        if(!attention)eyes.push(point([-.145,-F*.81+side*.065,1.475+z]));else if(up>.15)eyes.push(point(head([-.115,-F*.04+side*.065,.055])));
      }
      cap([0,F*.53,1.08+z],[0,F*.67,1.12+z],.045,'fur');cap([0,F*.57,1.065+z],[0,F*.66,1.095+z],.027,'cloth-light');
    } else {
      const h=o.h||9;
      cap([0,0,0],[0,0,h*.72],.14,'bark');
      for(let i=0;i<7;i++) {
        const a=i*2.399,r=h*(.12+.025*(i%3)),z=h*(.46+.06*i),x=Math.cos(a)*r*.72,y=Math.sin(a)*r*.72;
        cap([0,0,h*.40],[x,y,z],.065,'bark');ell([x,y,z],[r,r*.85,r*1.13],'foliage');
      }
    }
    if(nodes.length>MAX_NODES)throw Error('model node limit');
    // Rotated ellipsoids retain their local axes. Texel 3 stores cosine/sine once per pose.
    for(const n of nodes){n[8]=Math.cos(yaw+n[10]);n[9]=Math.sin(yaw+n[10]);}
    let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const n of nodes){const r=n[7]===1?Math.max(n[4],n[5],n[6]):n[3];for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],n[j]-r,n[7]===0?n[4+j]-r:Infinity);hi[j]=Math.max(hi[j],n[j]+r,n[7]===0?n[4+j]+r:-Infinity);}}
    const z=(lo[2]+hi[2])/2,r=Math.hypot(Math.max(Math.abs(lo[0]),Math.abs(hi[0])),Math.max(Math.abs(lo[1]),Math.abs(hi[1])),(hi[2]-lo[2])/2)+BLEND*nodes.length/4;
    const data=new Float32Array(nodes.flat());for(let i=0;i<nodes.length;i++){data[i*12+2]-=z;if(data[i*12+7]===0)data[i*12+6]-=z;}
    return {k:'sdf',x:o.x||0,y:o.y||0,z,r,nodes:data,nodeCount:nodes.length,mat:kind==='deer'?'fur':kind==='tree'?'foliage':'cloth-dark',cls:kind==='tree'?'veg':kind,ptype:o.ptype,state,phase,feet,eyes:eyes.map(p=>[p[0]+(o.x||0),p[1]+(o.y||0),p[2]]),gameHazard:o.gameHazard||0,attention,eyeNormal};
  }
  function cylinder(ob,ox,oy,oz,dx,dy,dz,tmax){
    const A=ob.axis,p=[ox-ob.x,oy-ob.y,oz-(ob.z0+ob.z1)/2],d=[dx,dy,dz],half=(ob.z1-ob.z0)/2,pa=p.reduce((s,v,i)=>s+v*A[i],0),da=d.reduce((s,v,i)=>s+v*A[i],0),q=p.map((v,i)=>v-A[i]*pa),v=d.map((v,i)=>v-A[i]*da),a=v.reduce((s,n)=>s+n*n,0),b=q.reduce((s,n,i)=>s+2*n*v[i],0),c=q.reduce((s,n)=>s+n*n,0)-ob.r*ob.r;
    let t=tmax,n=null;const disc=b*b-4*a*c;
    if(a>1e-12&&disc>=0)for(const sign of [-1,1]){const h=(-b+sign*Math.sqrt(disc))/(2*a);if(h>1e-4&&h<t&&Math.abs(pa+h*da)<=half){t=h;n=q.map((x,i)=>(x+h*v[i])/ob.r);}}
    if(Math.abs(da)>1e-12)for(const sign of [-1,1]){const h=(sign*half-pa)/da;if(h>1e-4&&h<t&&q.reduce((s,x,i)=>s+(x+h*v[i])**2,0)<=ob.r*ob.r){t=h;n=A.map(x=>sign*x);}}
    return n?{t,n}:{t:Infinity};
  }
  let material=0;
  function distance(ob,x,y,z) {
    const a=ob.nodes;let best=1e20,bid=0;
    for(let i=0;i<ob.nodeCount;i++) {
      const k=i*12;let d;
      if(a[k+7]===1){const px=x-a[k],py=y-a[k+1],pz=z-a[k+2],c=a[k+8],s=a[k+9];d=(Math.hypot((c*px+s*py)/a[k+4],(-s*px+c*py)/a[k+5],pz/a[k+6])-1)*Math.min(a[k+4],a[k+5],a[k+6]);}
      else {const px=x-a[k],py=y-a[k+1],pz=z-a[k+2],bx=a[k+4]-a[k],by=a[k+5]-a[k+1],bz=a[k+6]-a[k+2],h=clamp((px*bx+py*by+pz*bz)/Math.max(1e-12,bx*bx+by*by+bz*bz));d=Math.hypot(px-bx*h,py-by*h,pz-bz*h)-a[k+3];}
      if(d<best)bid=a[k+11];const h=Math.max(BLEND-Math.abs(best-d),0)/BLEND;best=Math.min(best,d)-h*h*BLEND*.25;
    }
    material=bid;return best;
  }
  function trace(ob,ox,oy,oz,dx,dy,dz,tmax) {
    ox-=ob.x;oy-=ob.y;oz-=ob.z;const b=ox*dx+oy*dy+oz*dz,c=ox*ox+oy*oy+oz*oz-ob.r*ob.r,disc=b*b-c;
    if(disc<0)return {t:Infinity,steps:0};let t=Math.max(.0001,-b-Math.sqrt(disc)),end=Math.min(tmax,-b+Math.sqrt(disc)),steps=0;
    for(;steps<STEPS && t<end;steps++) {const d=distance(ob,ox+t*dx,oy+t*dy,oz+t*dz);if(d<EPS){const id=material,x=ox+t*dx,y=oy+t*dy,z=oz+t*dz,e=.001,n=[distance(ob,x+e,y,z)-distance(ob,x-e,y,z),distance(ob,x,y+e,z)-distance(ob,x,y-e,z),distance(ob,x,y,z+e)-distance(ob,x,y,z-e)],L=Math.hypot(...n)||1;return {t,n:n.map(v=>v/L),id,steps:steps+1};}t+=Math.max(d*.8,.0005);}
    return {t:Infinity,steps};
  }
  function actors(obs,on) {
    if(!on)return obs;const out=[];
    for(const ob of obs) {
      if(ob.detailPart==='tree'){if(ob.detail)out.push(...tree(ob.detail));continue;}
      if(ob.detailPart!=='person' && ob.detailPart!=='deer'){out.push(ob);continue;}
      if(!ob.detail)continue;const m=build(ob.detail.kind,{...ob.detail,x:ob.detail.x,y:ob.detail.y,gameHazard:ob.gameHazard});out.push(m);
      // Behavioural pupil: tuned 13 mm diameter; legacy keeps its 13 mm radius.
      // cos^8 incidence acceptance is tuning (half power ~23.5 degrees), not calibrated biology.
      for(const e of m.eyes)out.push({k:'disc',x:e[0],y:e[1],z:e[2],r:m.attention?.0065:.013,nx:m.eyeNormal?m.eyeNormal[0]:-Math.cos(ob.detail.yaw),ny:m.eyeNormal?m.eyeNormal[1]:-Math.sin(ob.detail.yaw),nz:0,eyeFalloff:m.attention?8:0,sub:true,mat:'eyeshine',cls:'deer',gameHazard:ob.gameHazard,surfaceAnchor:[ob.detail.x,ob.detail.y]});   // pass: lift the eye with the deer's body, not with the terrain under the eye (touge lift)
    }
    return out;
  }
  // CR2: the GLB mounts the GPU mesh car is drawn with, per variant (MESH_NAMES order = drive-three-models.js names). Measured in the page
  // (CR2 probe, state.mounts from drive-three-models.js adapt): p = mount point, n = normal, both in the mesh's own frame (x front, y left, z up).
  // Keys are end:type:side exactly as adapt() builds them. Only the keys the kit uses are listed; the page test checks every one.
  const MESH_NAMES=['sedan','suv','hatchback-sports'];
  const MESH_MOUNTS=[
    {'1:head:-1':{p:[2.01,-.62,.68],n:[1,0,0]},'1:head:1':{p:[2.01,.62,.68],n:[1,0,0]},'1:plate:0':{p:[2.0975,0,.43],n:[1,0,0]},
     '-1:tail:-1':{p:[.5938,-.7,.78],n:[-1,0,0]},'-1:tail:1':{p:[.5938,.7,.78],n:[-1,0,0]},'-1:reflector:-1':{p:[-1.5164,-.7,.6409],n:[-.4351,0,.9004]},'-1:reflector:1':{p:[-1.5164,.7,.6409],n:[-.4351,0,.9004]},'-1:plate:0':{p:[-2.0975,0,.43],n:[-1,0,0]}},
    {'1:head:-1':{p:[2.0195,-.47,.7],n:[1,0,0]},'1:head:1':{p:[2.0195,.47,.7],n:[1,0,0]},'1:plate:0':{p:[2.1023,0,.43],n:[1,0,0]},
     '-1:tail:-1':{p:[.6819,-.7,.9],n:[-1,0,0]},'-1:tail:1':{p:[.6819,.7,.9],n:[-1,0,0]},'-1:reflector:-1':{p:[.6819,-.7,.76],n:[-1,0,0]},'-1:reflector:1':{p:[.6819,.7,.76],n:[-1,0,0]},'-1:plate:0':{p:[-1.86,.61,.4993],n:[-1,0,0]}},
    {'1:head:-1':{p:[2.0254,-.62,.6296],n:[.9283,0,-.3719]},'1:head:1':{p:[2.0254,.62,.6296],n:[.9283,0,-.3719]},'1:plate:0':{p:[2.1065,0,.4],n:[1,0,0]},
     '-1:tail:-1':{p:[-1.9515,-.7,.77],n:[-1,0,0]},'-1:tail:1':{p:[-1.9515,.7,.77],n:[-1,0,0]},'-1:reflector:-1':{p:[-1.954,-.7,.6304],n:[-.9283,0,.3719]},'-1:reflector:1':{p:[-1.954,.7,.6304],n:[-.9283,0,.3719]},'-1:plate:0':{p:[-2.1065,0,.46],n:[-1,0,0]}},
  ];
  // Mount for one car part: the car's variant is stableId(id) mod 3, as adapt() picks it. null = no mount for that key.
  function meshMount(id,end,type,side){const v=MESH_MOUNTS[stableId(id)%MESH_NAMES.length];return v[end+':'+type+':'+side]||null;}
  // The pass car's rigid basis: X = heading (with the face flip F) projected on the road normal, Y = U x X, U = normal. Used by the GPU mesh (drive-three-models.js adapt, update) and the CPU lamps (drive-touge.js).
  function carBasis(m){const F=m.face===-1?-1:1,n=m.normal,t=[Math.cos(m.yaw)*F,Math.sin(m.yaw)*F,(m.grade||0)*F],k=t[0]*n[0]+t[1]*n[1]+t[2]*n[2],X=[t[0]-k*n[0],t[1]-k*n[1],t[2]-k*n[2]],L=Math.hypot(...X),x=X.map(v=>v/L),Y=[n[1]*x[2]-n[2]*x[1],n[2]*x[0]-n[0]*x[2],n[0]*x[1]-n[1]*x[0]];return{X:x,Y,U:n};}
  D.Models={TREE_COUNT:128,carBasis,meshMount,MESH_MOUNTS,TREE_DISTANCE:140,deerEnabled,deerProfile,deerAttention,build,distance,trace,cylinder,actors,tree,stableId,locomotion,foot,pedestrian,PERSON_STRIDE,BLEND_T,LEG_SWING,GAITS,MAX_NODES,STEPS,EPS,BLEND,material:()=>material};
})(typeof self!=='undefined'?self:globalThis);
