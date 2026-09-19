(function (O) {
  'use strict';
  const {V}=O;
  function surface(s,index) {
    const a={...s,index,id:s.id??index};
    if(s.vertices) {
      a.center=V.mul(s.vertices.reduce((p,q)=>V.add(p,q),[0,0,0]),1/3);
      a.e1=V.sub(s.vertices[1],s.vertices[0]);a.e2=V.sub(s.vertices[2],s.vertices[0]);a.normal=V.unit(V.cross(a.e1,a.e2));a.frame=V.frame(a.normal);
      a.bounds=bounds(s.vertices);return a;
    }
    a.frame=V.frame(s.normal);a.normal=a.frame.n;
    const z=s.focal?(s.width*s.width+s.height*s.height)/(16*s.focal):0;
    a.bounds=bounds([-1,1].flatMap(x=>[-1,1].flatMap(y=>[0,z].map(h=>V.add(s.center,V.world([x*s.width/2,y*s.height/2,h],a.frame))))));return a;
  }
  function bounds(points) {return {min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};}
  function intersect(s,o,d,eps=1e-8) {
    if(s.vertices) {
      const p=V.cross(d,s.e2),det=V.dot(s.e1,p);if(Math.abs(det)<V.len(s.e1)*V.len(s.e2)*1e-12)return null;
      const q=V.sub(o,s.vertices[0]),u=V.dot(q,p)/det;if(u<0||u>1)return null;
      const r=V.cross(q,s.e1),v=V.dot(d,r)/det;if(v<0||u+v>1)return null;
      const t=V.dot(s.e2,r)/det;return t>eps?{t,p:V.add(o,V.mul(d,t)),n:s.normal,s}:null;
    }
    const p=V.local(V.sub(o,s.center),s.frame),v=V.local(d,s.frame);
    let roots;
    // Exact intersection with z=(x²+y²)/(4f), not a thin-lens kick.
    if(s.focal) {
      const k=1/(4*s.focal),a=k*(v[0]*v[0]+v[1]*v[1]),b=2*k*(p[0]*v[0]+p[1]*v[1])-v[2],c=k*(p[0]*p[0]+p[1]*p[1])-p[2];
      if(Math.abs(a)<1e-14/Math.max(s.width,s.height))roots=Math.abs(b)>1e-14?[-c/b]:[];
      else {const disc=b*b-4*a*c;if(disc<0)return null;const q=-.5*(b+(b<0?-1:1)*Math.sqrt(disc));roots=q===0?[-b/(2*a)]:[q/a,c/q].sort((x,y)=>x-y);}
    } else roots=Math.abs(v[2])>1e-14?[-p[2]/v[2]]:[];
    for(const t of roots) {if(t<=eps)continue;const x=p[0]+v[0]*t,y=p[1]+v[1]*t;if(Math.abs(x)>s.width/2||Math.abs(y)>s.height/2)continue;if(s.disc&&(x*x/(s.width*s.width)+y*y/(s.height*s.height))>.25)continue;
      const n=s.focal?V.unit(V.world([-x/(2*s.focal),-y/(2*s.focal),1],s.frame)):s.normal;
      return {t,p:V.add(o,V.mul(d,t)),n,s};
    }return null;
  }
  function boxHit(b,o,d,limit) {let lo=0,hi=limit;for(let k=0;k<3;k++){if(Math.abs(d[k])<1e-16){if(o[k]<b.min[k]||o[k]>b.max[k])return false;continue;}let a=(b.min[k]-o[k])/d[k],c=(b.max[k]-o[k])/d[k];if(a>c)[a,c]=[c,a];lo=Math.max(lo,a);hi=Math.min(hi,c);if(lo>hi)return false;}return true;}
  function tree(list) {
    if(!list.length)return null;
    const b={min:[0,1,2].map(k=>Math.min(...list.map(s=>s.bounds.min[k]))),max:[0,1,2].map(k=>Math.max(...list.map(s=>s.bounds.max[k])))};
    if(list.length<=4)return {...b,items:list};const axis=[0,1,2].sort((a,c)=>(b.max[c]-b.min[c])-(b.max[a]-b.min[a]))[0];
    list.sort((a,c)=>a.center[axis]-c.center[axis]||String(a.id).localeCompare(String(c.id)));const m=list.length>>1;return {...b,left:tree(list.slice(0,m)),right:tree(list.slice(m))};
  }
  function nearest(root,o,d,eps,limit=Infinity) {
    let hit=null,dist=limit;const stack=root?[root]:[];
    while(stack.length){const b=stack.pop();if(!boxHit(b,o,d,dist))continue;if(b.items){for(const s of b.items){const h=intersect(s,o,d,eps);if(h&&(h.t<dist||(h.t===dist&&String(h.s.id)<String(hit?.s.id)))){hit=h;dist=h.t;}}}else{stack.push(b.left,b.right);}}return hit;
  }
  function corners(s,steps=1) {
    if(s.vertices)return s.vertices;
    const f=s.frame||V.frame(s.normal),out=[];
    if(s.disc){for(let j=0;j<32;j++){const t=j/32*Math.PI*2,x=Math.cos(t)*s.width/2,y=Math.sin(t)*s.height/2;out.push(V.add(s.center,V.world([x,y,s.focal?(x*x+y*y)/(4*s.focal):0],f)));}return out;}
    const edges=[[-1,-1,1,-1],[1,-1,1,1],[1,1,-1,1],[-1,1,-1,-1]];
    for(const [x,y,xx,yy]of edges)for(let j=0;j<steps;j++){const u=(x+(xx-x)*j/steps)*s.width/2,v=(y+(yy-y)*j/steps)*s.height/2;out.push(V.add(s.center,V.world([u,v,s.focal?(u*u+v*v)/(4*s.focal):0],f)));}return out;
  }
  function inside(e,p,margin=0) {const q=V.sub(p,e.center),r=e.size.map(x=>Math.max(1e-9,x/2-margin));if(e.kind==='box')return q.every((x,k)=>Math.abs(x)<=r[k]+1e-9);if(e.kind==='cylinder')return Math.hypot(q[0]/r[0],q[2]/r[2])<=1&&Math.abs(q[1])<=r[1];return q.reduce((a,x,k)=>a+(x/r[k])**2,0)<=1;}
  function fits(e,s) {return inside(e,s.center)&&corners(s,4).every(p=>inside(e,p));}
  function targetHit(target,o,d,eps) {
    const f=target.frame||V.planeFrame(target.normal),den=V.dot(d,f.n);if(Math.abs(den)<1e-14)return null;
    const t=V.dot(V.sub(target.center,o),f.n)/den;if(t<=eps)return null;const p=V.add(o,V.mul(d,t)),q=V.local(V.sub(p,target.center),f);
    if(Math.abs(q[0])>=target.width/2||Math.abs(q[1])>=target.height/2)return null;
    return {t,p,u:q[0]/target.width+.5,v:q[1]/target.height+.5};
  }
  O.Geometry={surface,intersect,bounds,tree,nearest,corners,inside,fits,targetHit};
})(Optics);
