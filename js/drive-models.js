/* Opt-in model prototype. Poses are built once; CPU and GPU consume the same float32 nodes.
 * Ellipsoids use a conservative distance bound, capsules an exact distance, polynomial smooth union. */
(function(root){
  'use strict';
  const D=root.RF.Drive, MAX_NODES=32, STEPS=96, EPS=.002, BLEND=.045;
  const clamp=x=>Math.max(0,Math.min(1,x));
  function build(kind, o) {
    o=o||{};const nodes=[],eyes=[],yaw=(o.yaw||0)+(kind==='person'?Math.atan2((o.dir||[1,0])[1],(o.dir||[1,0])[0]):0),c=Math.cos(yaw),s=Math.sin(yaw),F=o.face||1;
    const point=p=>[c*p[0]-s*p[1],s*p[0]+c*p[1],p[2]], id=k=>D.MAT_KEYS.indexOf(k);
    const ell=(p,r,m)=>{p=point(p);nodes.push([...p,0,...r,1,0,0,0,id(m)]);};
    const cap=(a,b,r,m)=>{a=point(a);b=point(b);nodes.push([...a,r,...b,0,0,0,0,id(m)]);};
    const g=Math.max(-1,Math.min(1,(o.gait||0)/(kind==='deer'?.14:.11))), angle=g*.65;
    const joint=(p,l,a,dir)=>[p[0]+dir[0]*l*Math.sin(a),p[1]+dir[1]*l*Math.sin(a),p[2]-l*Math.cos(a)];
    if(kind==='person') {
      const torso=o.ptype==='light'?'cloth-light':o.ptype==='hivis'?'hivis':'cloth-dark', dir=[1,0];
      ell([0,0,1.17],[.17,.23,.33],torso);cap([0,0,1.43],[0,0,1.56],.065,'skin');ell([0,0,1.66],[.1,.095,.13],'skin');
      for(const side of [-1,1]) {
        const hip=[0,side*.115,.87],knee=joint(hip,.4,side*angle,dir),ankle=joint(knee,.4,side*angle-Math.max(0,-side*g)*.8,dir);
        cap(hip,knee,.085,'cloth-dark');cap(knee,ankle,.065,'cloth-dark');cap(ankle,[ankle[0]+dir[0]*.13,ankle[1]+dir[1]*.13,.07],.065,'cloth-dark');
        const shoulder=[0,side*.245,1.4],elbow=joint(shoulder,.28,-side*angle,dir),hand=joint(elbow,.27,-side*angle-.2,dir);
        cap(shoulder,elbow,.065,torso);cap(elbow,hand,.05,torso);ell(hand,[.055,.05,.065],'skin');
      }
    } else if(kind==='deer') {
      const bound=!!o.bound,bounce=bound?.10*Math.abs(g):0, z=bounce;
      ell([0,0,.97+z],[.23,.62,.32],'fur');ell([0,-F*.38,1.07+z],[.22,.25,.32],'fur');
      cap([0,-F*.42,1.06+z],[-.04,-F*.7,1.47+z],.14,'fur');ell([-.1,-F*.78,1.5+z],[.17,.13,.13],'fur');
      cap([-.16,-F*.79,1.48+z],[-.31,-F*.79,1.44+z],.085,'fur');
      for(const side of [-1,1]) {
        cap([side*.11,-F*.76,1.56+z],[side*.17,-F*.7,1.79+z],.042,'fur');
        for(const end of [-1,1]) {
          const a=(bound?end:side*end)*angle,hip=[side*.14,end*.43,.85+z],knee=joint(hip,.36,a,[0,F]),foot=joint(knee,.36,a-Math.max(0,-g*side*end)*.65,[0,F]);
          cap(hip,knee,.055,'fur');cap(knee,foot,.034,'fur');
        }
        eyes.push(point([-.246,-F*.78+side*.062,1.545+z]));
      }
      cap([0,F*.55,1.06+z],[.02,F*.77,1.19+z],.065,'fur');
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
    for(const n of nodes){n[8]=Math.cos(yaw);n[9]=Math.sin(yaw);}
    let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const n of nodes){const r=n[7]===1?Math.max(n[4],n[5],n[6]):n[3];for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],n[j]-r,n[7]===0?n[4+j]-r:Infinity);hi[j]=Math.max(hi[j],n[j]+r,n[7]===0?n[4+j]+r:-Infinity);}}
    const z=(lo[2]+hi[2])/2,r=Math.hypot(Math.max(Math.abs(lo[0]),Math.abs(hi[0])),Math.max(Math.abs(lo[1]),Math.abs(hi[1])),(hi[2]-lo[2])/2)+BLEND*nodes.length/4;
    const data=new Float32Array(nodes.flat());for(let i=0;i<nodes.length;i++){data[i*12+2]-=z;if(data[i*12+7]===0)data[i*12+6]-=z;}
    return {k:'sdf',x:o.x||0,y:o.y||0,z,r,nodes:data,nodeCount:nodes.length,mat:kind==='deer'?'fur':kind==='tree'?'foliage':'cloth-dark',cls:kind==='tree'?'veg':kind,ptype:o.ptype,eyes:eyes.map(p=>[p[0]+(o.x||0),p[1]+(o.y||0),p[2]]),gameHazard:o.gameHazard||0};
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
      if(ob.detailPart!=='person' && ob.detailPart!=='deer'){out.push(ob);continue;}
      if(!ob.detail)continue;const m=build(ob.detail.kind,{...ob.detail,x:ob.detail.x,y:ob.detail.y,gameHazard:ob.gameHazard});out.push(m);
      for(const e of m.eyes)out.push({k:'disc',x:e[0],y:e[1],z:e[2],r:.013,nx:-Math.cos(ob.detail.yaw),ny:-Math.sin(ob.detail.yaw),nz:0,sub:true,mat:'eyeshine',cls:'deer',gameHazard:ob.gameHazard});
    }
    return out;
  }
  D.Models={build,distance,trace,actors,MAX_NODES,STEPS,EPS,BLEND,material:()=>material};
})(typeof self!=='undefined'?self:globalThis);
