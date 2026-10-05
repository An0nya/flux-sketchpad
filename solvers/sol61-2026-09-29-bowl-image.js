/* Bundled model solver: GPT-6.1 Sol (Codex, max), Flux solver benchmark run 2026-09-29 (workspace work-sol61-codex-flux-solver-20260929-1737).
 * Copied verbatim from that run's solvers/solver.js (sha256 25205704a269…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote.
 * Exception (2026-10-05): display-only tools.preview calls added for Watch solve (bowl-image-auto's candidate loop). */
(function () {
/* Bowl image solver. All calculations in solve are geometry and area integrals.
 * A paraboloid supplies a nonblocking scaffold; each patch is an exact ellipsoid
 * aimed at the painting. Finite source images are integrated over target cells,
 * then nonnegative area fitting balances the painting without tracing rays.
 */
(function () {
  'use strict';
  const V = RF.V, G = RF.Geo, E = RF.Engine, S = RF.Source;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const at = (p, a, x, b, y) => V.add(p, V.add(V.mul(a, x), V.mul(b, y)));
  const mv = (A, x) => [A[0]*x[0]+A[1]*x[1]+A[2]*x[2], A[3]*x[0]+A[4]*x[1]+A[5]*x[2], A[6]*x[0]+A[7]*x[1]+A[8]*x[2]];
  function area(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const q=p[i], r=p[(i+1)%p.length]; a += q[0]*r[1]-q[1]*r[0]; }
    return Math.abs(a)*0.5;
  }
  function clip(p, axis, edge, side) {
    const out = [];
    for (let i=0; i<p.length; i++) {
      const a=p[i], b=p[(i+1)%p.length], da=side*(a[axis]-edge), db=side*(b[axis]-edge);
      if (da >= 0) out.push(a);
      if ((da>=0)!==(db>=0)) { const t=da/(da-db); out.push([a[0]+t*(b[0]-a[0]), a[1]+t*(b[1]-a[1])]); }
    }
    return out;
  }
  function deposit(poly, mass, res, out) {
    const ar=area(poly); if (!(ar>1e-12)) return;
    const xs=poly.map(p=>p[0]), ys=poly.map(p=>p[1]);
    const i0=Math.max(0,Math.floor(Math.min(...xs))), i1=Math.min(res-1,Math.floor(Math.max(...xs)));
    const j0=Math.max(0,Math.floor(Math.min(...ys))), j1=Math.min(res-1,Math.floor(Math.max(...ys)));
    for (let j=j0; j<=j1; j++) for (let i=i0; i<=i1; i++) {
      let p=clip(poly,0,i,1); p=clip(p,0,i+1,-1); p=clip(p,1,j,1); p=clip(p,1,j+1,-1);
      if (p.length>=3) { const k=j*res+i; out.set(k,(out.get(k)||0)+mass*area(p)/ar); }
    }
  }

  // A conservative sag bound over a tangent polygon, using the quadric's
  // curvature eigenvalue and its tangent/normal coupling. Convex envelope tests
  // on the resulting prism protect the entire patch, including its interior.
  function patch(P, Z, L, U, W, hx, hy, di, env, keep, id, reflectivity) {
    const Q=G.facetQuadric(P,L,Z,di), n=Q.n;
    const A=V.norm(V.sub(Z,P)), den=V.dot(n,A); if (den<0.08) return null;
    const x=V.sub(U,V.mul(A,V.dot(n,U)/den)), y=V.sub(W,V.mul(A,V.dot(n,W)/den));
    const ex=V.inPlane(n,U), ey=V.cross(n,ex), An=mv(Q.A,n);
    const qx=V.dot(ex,mv(Q.A,ex)), qy=V.dot(ey,mv(Q.A,ey)), qxy=V.dot(ex,mv(Q.A,ey));
    const lam=0.5*(qx+qy+Math.hypot(qx-qy,2*qxy)), gamma=Math.hypot(V.dot(ex,An),V.dot(ey,An));
    const aa=V.dot(n,An), bb=Math.abs(V.dot(Q.b,n));
    let scale=1;
    for (let attempt=0; attempt<12; attempt++,scale*=0.84) {
      const dx=V.mul(x,hx*scale), dy=V.mul(y,hy*scale);
      const tang=[V.neg(V.add(dx,dy)),V.sub(dx,dy),V.add(dx,dy),V.sub(dy,dx)];
      const rad=Math.max(...tang.map(V.len)), B=bb-2*rad*gamma, disc=B*B-4*aa*lam*rad*rad;
      if (!(B>0&&disc>0)) continue;
      const sag=2*lam*rad*rad/(B+Math.sqrt(disc));
      if (V.dist(P,L)-rad-sag < keep+1e-5) continue;
      if (!tang.every(t=>[-1,1].every(s=>G.envInside(env,V.add(P,V.add(t,V.mul(n,s*sag))),-1e-5)))) continue;
      const pts3=tang.map(t=>V.add(P,t));
      return { surface:{type:'facet',id,P,S0:L.slice(),Z,flat:false,di,clip:{kind:'poly',pts3},optics:{interaction:'reflect',reflectivity,twoSided:false}},
        hx:hx*scale,hy:hy*scale,x,y,n,rad,scale };
    }
    return null;
  }

  function scaffold(input, settings, N, T, points) {
    const L=input.source.pos, env=input.envelope, A=V.norm(V.sub(T.C,L));
    const U=V.inPlane(A,T.tu), W=V.cross(A,U); if(V.dot(W,T.tv)<0) { for(let i=0;i<3;i++) W[i]*=-1; }
    let ulo=Infinity,uhi=-Infinity,vlo=Infinity,vhi=-Infinity,rmax=0;
    for (const i of [-1,1]) for (const j of [-1,1]) for (const k of [-1,1]) {
      const d=V.sub([env.center[0]+i*env.half[0],env.center[1]+j*env.half[1],env.center[2]+k*env.half[2]],L);
      const u=V.dot(d,U),v=V.dot(d,W); ulo=Math.min(ulo,u);uhi=Math.max(uhi,u);vlo=Math.min(vlo,v);vhi=Math.max(vhi,v);rmax=Math.max(rmax,V.len(d));
    }
    const keep=Math.max(env.keepOut||0,settings.minDistance||0), floor=Math.max(keep,settings.radiusFloor*rmax), fr=S.frame(input.source), planar=input.source.kind==='planar';
    const size=S.extentSize(input.source), cw=2*T.half/input.paint.res;
    let perimeter=0;
    const res=input.paint.res, paint=input.paint.cells;
    for(const p of points) { const i=p.k%res,j=(p.k/res)|0; for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]) if(i+a<0||i+a>=res||j+b<0||j+b>=res||!(paint[(j+b)*res+i+a]>0)) perimeter++; }
    const feature=Math.max(cw,2*points.length*cw/Math.max(1,perimeter));
    const intensity=(d,r)=>S.intensity(input.source,Math.acos(clamp(V.dot(d,fr.a)/r,-1,1)));
    const sample=(u,v,c)=>{const z=(u*u+v*v-c*c)/(2*c),P=at(V.madd(L,A,z),U,u,W,v),d=V.sub(P,L),r=V.len(d);return {P,r,d,u,v};};
    let best=-1, C=0;
    for(let ci=0;ci<22;ci++) {
      const c=rmax*(0.10+1.50*(ci+0.5)/22); let merit=0;
      for(let j=0;j<24;j++) for(let i=0;i<24;i++) {
        const q=sample(ulo+(i+0.5)/24*(uhi-ulo),vlo+(j+0.5)/24*(vhi-vlo),c);
        if(q.r<floor+0.04*rmax||!G.envInside(env,q.P,-0.035))continue;
        const it=intensity(q.d,q.r); if(!(it>0)||planar&&V.dot(q.d,fr.a)<=0)continue;
        const blur=V.dist(q.P,T.C)*size/q.r;
        merit+=it/(q.r*q.r)/(1+settings.sharpness*(blur/feature)**2);
      }
      if(merit>best) {best=merit;C=c;}
    }
    C*=settings.depth;
    const make=(ny)=>{
      const nx=Math.max(1,Math.round(ny*(uhi-ulo)/(vhi-vlo))),du=(uhi-ulo)/nx,dv=(vhi-vlo)/ny,out=[];
      for(let j=0;j<ny;j++)for(let i=0;i<nx;i++) {
        const q=sample(ulo+(i+0.5)*du,vlo+(j+0.5)*dv,C);
        if(q.r<floor+0.01*rmax||!G.envInside(env,q.P,-1e-5))continue;
        const it=intensity(q.d,q.r);if(!(it>1e-6))continue;
        const p=patch(q.P,T.C,L,U,W,du*settings.fill/2,dv*settings.fill/2,V.dist(q.P,T.C),env,keep,'',input.limits.reflectivity);
        if(!p||p.scale<0.6)continue;
        q.du=du;q.dv=dv;q.cap=4*p.hx*p.hy*it/(q.r*q.r);q.rank=q.cap/(1+settings.sharpness*(V.dist(q.P,T.C)*size/q.r/feature)**2);out.push(q);
      }
      return out;
    };
    let ny=Math.max(2,Math.round(Math.sqrt(N*(vhi-vlo)/(uhi-ulo)))), pool=make(ny);
    for(let tries=0;pool.length<N&&tries<7;tries++){ny=Math.ceil(ny*Math.sqrt(N/Math.max(1,pool.length))*1.05);ny=Math.min(ny,Math.ceil(6*Math.sqrt(N))+10);pool=make(ny);}
    pool.sort((a,b)=>b.rank-a.rank||a.v-b.v||a.u-b.u);
    return {slots:pool.slice(0,N),U,W,A,keep,C,intensity,normalization:S.totalIntegral(input.source)};
  }

  // Deterministic brightness-weighted centroidal partition of the painting.
  function aims(points,N,iterations,cw) {
    const total=points.reduce((s,p)=>s+p.w,0), out=[];
    let acc=0, q=0;
    for(let i=0;i<N;i++) {const want=(i+0.5)/N*total;while(q<points.length-1&&acc+points[q].w<want)acc+=points[q++].w;out.push({u:points[q].u,v:points[q].v,mass:total/N,area:points.length*cw*cw/N});}
    const count=Math.min(iterations,Math.max(2,Math.floor(1.6e7/Math.max(1,N*points.length))));
    for(let pass=0;pass<count;pass++) {
      const su=new Float64Array(N),sv=new Float64Array(N),sm=new Float64Array(N),sa=new Float64Array(N);
      for(const p of points){let k=0,best=Infinity;for(let i=0;i<N;i++){const d=(p.u-out[i].u)**2+(p.v-out[i].v)**2;if(d<best){best=d;k=i;}}su[k]+=p.w*p.u;sv[k]+=p.w*p.v;sm[k]+=p.w;sa[k]++;}
      for(let i=0;i<N;i++)if(sm[i]>0){out[i].u=su[i]/sm[i];out[i].v=sv[i]/sm[i];out[i].mass=sm[i];out[i].area=sa[i]*cw*cw;}
    }
    return out;
  }

  // First derivative of the reflected finite-source image at the facet centre.
  // This is an algebraic optical map, not a sampled or traced ray.
  function imageMap(P,Z,L,n,T) {
    const d=V.norm(V.sub(P,L)), a=V.norm(V.sub(Z,P)), r=V.dist(P,L), D=V.dist(P,Z), den=V.dot(a,T.n);
    const projection=x=>V.sub(x,V.mul(a,V.dot(x,T.n)/den));
    const source=x=>{const dx=V.mul(V.sub(x,V.mul(d,V.dot(d,x))),-1/r), rr=V.reflect(dx,n), y=V.mul(projection(rr),D);return [V.dot(y,T.tu),V.dot(y,T.tv)];};
    const aperture=x=>{const y=projection(x);return [V.dot(y,T.tu),V.dot(y,T.tv)];};
    return {source,aperture,D};
  }
  function footprint(input,T,p,aim,defocus) {
    const src=input.source,fr=S.frame(src),J=imageMap(p.surface.P,p.surface.Z,src.pos,p.n,T), cw=2*T.half/input.paint.res;
    const centre=[(aim.u+T.half)/cw,(aim.v+T.half)/cw], out=new Map();
    const convert=q=>[centre[0]+q[0]/cw,centre[1]+q[1]/cw];
    const ax=J.aperture(V.mul(p.x,-defocus*p.hx)),ay=J.aperture(V.mul(p.y,-defocus*p.hy));
    const aperturePoly=[[-ax[0]-ay[0],-ax[1]-ay[1]],[ax[0]-ay[0],ax[1]-ay[1]],[ax[0]+ay[0],ax[1]+ay[1]],[-ax[0]+ay[0],-ax[1]+ay[1]]];
    let polygons=[];
    if(src.kind==='planar'&&src.shape!=='disc') {
      const a=J.source(V.mul(fr.u,src.w/2)),b=J.source(V.mul(fr.v,src.h/2));
      polygons.push({poly:[[-a[0]-b[0],-a[1]-b[1]],[a[0]-b[0],a[1]-b[1]],[a[0]+b[0],a[1]+b[1]],[-a[0]+b[0],-a[1]+b[1]]],w:1});
    } else if(src.kind==='planar') {
      const a=J.source(V.mul(fr.u,src.radius)),b=J.source(V.mul(fr.v,src.radius)),poly=[];
      for(let i=0;i<24;i++){const t=i*Math.PI/12;poly.push([a[0]*Math.cos(t)+b[0]*Math.sin(t),a[1]*Math.cos(t)+b[1]*Math.sin(t)]);}polygons.push({poly,w:1});
    } else if(src.kind==='volume') {
      // Moment-matched compact elliptical projection for volume emitters.
      const C=S.extentCov(src), rows=[[1,0,0],[0,1,0],[0,0,1]].map(J.source);
      let xx=0,xy=0,yy=0;for(let i=0;i<3;i++)for(let j=0;j<3;j++){xx+=rows[i][0]*C[3*i+j]*rows[j][0];xy+=rows[i][0]*C[3*i+j]*rows[j][1];yy+=rows[i][1]*C[3*i+j]*rows[j][1];}
      const a=2*Math.sqrt(Math.max(0,xx)),b=a>1e-9?4*xy/a:0,c=2*Math.sqrt(Math.max(0,yy-b*b/4)),poly=[];
      for(let i=0;i<24;i++){const t=i*Math.PI/12;poly.push([a*Math.cos(t),b*Math.cos(t)+c*Math.sin(t)]);}polygons.push({poly,w:1});
    }
    if(!polygons.length||!(area(polygons[0].poly)>1e-8)) {
      if(area(aperturePoly)>1e-8)deposit(aperturePoly.map(convert),1,input.paint.res,out);
      else {const i=Math.floor(centre[0]),j=Math.floor(centre[1]);if(i>=0&&i<input.paint.res&&j>=0&&j<input.paint.res)out.set(j*input.paint.res+i,1);}
    } else {
      const spread=Math.hypot(...ax)+Math.hypot(...ay), widths=polygons[0].poly;
      const sourceWidth=Math.sqrt(area(widths)), samples=spread<0.1*cw?1:spread>1.5*sourceWidth?5:3;
      const nodes=samples===1?[0]:samples===3?[-Math.sqrt(3/5),0,Math.sqrt(3/5)]:[-0.9061798459,-0.5384693101,0,0.5384693101,0.9061798459];
      const weights=samples===1?[1]:samples===3?[5/18,4/9,5/18]:[0.1184634425,0.2393143352,0.2844444444,0.2393143352,0.1184634425];
      for(let i=0;i<nodes.length;i++)for(let j=0;j<nodes.length;j++)for(const q of polygons){const du=nodes[i]*ax[0]+nodes[j]*ay[0],dv=nodes[i]*ax[1]+nodes[j]*ay[1];deposit(q.poly.map(z=>convert([z[0]+du,z[1]+dv])),q.w*weights[i]*weights[j],input.paint.res,out);}
    }
    return [...out].filter(q=>q[1]>1e-10);
  }

  function fit(basis,paint,gapWeight,passes,initial) {
    const n=paint.length, pred=new Float64Array(n), weights=new Float64Array(n), alpha=new Float64Array(basis.length);
    let sum=0,count=0;for(const p of paint)if(p>0){sum+=p;count++;}const typical=sum/count;
    for(let k=0;k<n;k++)weights[k]=paint[k]>0?1/(paint[k]*paint[k]):gapWeight/(typical*typical);
    if(initial)for(let i=0;i<basis.length;i++){alpha[i]=initial[i];for(const [k,w] of basis[i])pred[k]+=alpha[i]*w;}
    const norm=basis.map(b=>b.reduce((s,q)=>s+q[1]*q[1]*weights[q[0]],0));
    for(let pass=0;pass<passes;pass++) {
      for(let z=0;z<basis.length;z++) {
        const i=pass%2?basis.length-1-z:z;if(!(norm[i]>0))continue;
        let dot=0;for(const [k,w] of basis[i])dot+=w*weights[k]*(paint[k]-pred[k]);
        const next=Math.max(0,alpha[i]+dot/norm[i]), delta=next-alpha[i];alpha[i]=next;
        for(const [k,w] of basis[i])pred[k]+=delta*w;
      }
    }
    return {alpha,pred,weights};
  }

  // Coordinate descent on image positions. Candidate quality is an area-overlap
  // least-squares calculation; there is no forward ray or visibility simulation.
  function refine(input,settings,T,bowl,patches,basis,targets,defocuses,fitted) {
    const paint=input.paint.cells,cw=2*T.half/input.paint.res;
    const passes=Math.min(settings.aimPasses,Math.max(1,Math.floor(5000/Math.max(1,patches.length))));
    for(let pass=0;pass<passes;pass++) {
      for(let z=0;z<patches.length;z++) {
        const i=pass%2?patches.length-1-z:z,old=basis[i],alpha=fitted.alpha[i],aim=targets[i],p=patches[i];
        // Large redundant dictionaries already have many inactive images.
        // Spend position work on the images contributing to the field.
        if(patches.length>300&&alpha<=1e-10)continue;
        for(const [k,w]of old)fitted.pred[k]-=alpha*w;
        const assess=b=>{let dot=0,norm=0;for(const [k,w]of b){dot+=w*fitted.weights[k]*(paint[k]-fitted.pred[k]);norm+=w*w*fitted.weights[k];}return {gain:dot>0&&norm>0?dot*dot/norm:0,alpha:dot>0&&norm>0?dot/norm:0};};
        const current=assess(old);let best=current.gain,bestAlpha=current.alpha,bestB=old,bestP=p,bestAim=aim;
        const step=Math.max(cw*0.35,Math.sqrt(aim.area)*0.30)*Math.pow(0.6,pass);
        for(const [du,dv]of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const candidate={...aim,u:aim.u+du*step,v:aim.v+dv*step};
          if(Math.abs(candidate.u)>T.half||Math.abs(candidate.v)>T.half)continue;
          const Z=at(T.C,T.tu,candidate.u,T.tv,candidate.v),D=V.dist(p.surface.P,Z);
          const next=patch(p.surface.P,Z,input.source.pos,bowl.U,bowl.W,p.hx,p.hy,D/(1+defocuses[i]),input.envelope,bowl.keep,p.surface.id,input.limits.reflectivity);
          if(!next)continue;
          const b=footprint(input,T,next,candidate,defocuses[i]),q=assess(b);
          if(q.gain>best*1.0001){best=q.gain;bestAlpha=q.alpha;bestB=b;bestP=next;bestAim=candidate;}
        }
        basis[i]=bestB;patches[i]=bestP;targets[i]=bestAim;fitted.alpha[i]=bestAlpha;
        for(const [k,w]of bestB)fitted.pred[k]+=bestAlpha*w;
      }
      fitted=fit(basis,paint,settings.gapWeight,12,fitted.alpha);
    }
    return fitted;
  }

  function solve(input,settings,tools) {
    const T=E.designFrame(input.target),res=input.paint.res,cw=2*T.half/res,points=[];
    const cap=Math.max(0,Math.floor(input.limits.maxFacets));
    for(let k=0;k<res*res;k++)if(input.paint.cells[k]>0)points.push({k,w:input.paint.cells[k],u:-T.half+(k%res+0.5)*cw,v:-T.half+(Math.floor(k/res)+0.5)*cw});
    if(!points.length||!cap)return {surfaces:[],intent:[],notes:['No painted cells or no facet capacity.']};
    const N=Math.min(cap,Math.max(1,points.length)),bowl=scaffold(input,settings,N,T,points),slots=bowl.slots;
    if(!slots.length)return {surfaces:[],intent:[{facet:null,cells:points.map(p=>[p.k,p.w])}],notes:['No bowl patches fit the envelope and requested clearance.']};
    const targets=aims(points,slots.length,settings.lloyd,cw);
    targets.sort((a,b)=>b.mass-a.mass||a.v-b.v||a.u-b.u);slots.sort((a,b)=>b.cap-a.cap||a.v-b.v||a.u-b.u);
    const patches=[],basis=[],capacities=[],usedTargets=[],defocuses=[];
    for(let i=0;i<slots.length;i++) {
      const q=slots[i],aim=targets[i],Z=at(T.C,T.tu,aim.u,T.tv,aim.v),D=V.dist(q.P,Z);
      let p=patch(q.P,Z,input.source.pos,bowl.U,bowl.W,q.du*settings.fill/2,q.dv*settings.fill/2,D,input.envelope,bowl.keep,'B'+i,input.limits.reflectivity);
      if(!p)continue;
      const J=imageMap(q.P,Z,input.source.pos,p.n,T), C=S.extentCov(input.source),rows=[[1,0,0],[0,1,0],[0,0,1]].map(J.source);
      let sourceVariance=0;for(let a=0;a<3;a++)for(let b=0;b<3;b++)sourceVariance+=C[3*a+b]*(rows[a][0]*rows[b][0]+rows[a][1]*rows[b][1])/2;
      const ax=J.aperture(V.mul(p.x,p.hx)),ay=J.aperture(V.mul(p.y,p.hy)),apVariance=(ax[0]**2+ax[1]**2+ay[0]**2+ay[1]**2)/6;
      const desired=aim.area*settings.smoothing**2/12, df=Math.sqrt(Math.max(0,desired-sourceVariance)/Math.max(1e-9,apVariance));
      p=patch(q.P,Z,input.source.pos,bowl.U,bowl.W,q.du*settings.fill/2,q.dv*settings.fill/2,D/(1+df),input.envelope,bowl.keep,'B'+i,input.limits.reflectivity);
      if(!p)continue;
      const capacity=4*p.hx*p.hy*bowl.intensity(q.d,q.r)/(q.r*q.r)/bowl.normalization*input.limits.reflectivity;
      patches.push(p);basis.push(footprint(input,T,p,aim,df));capacities.push(capacity);usedTargets.push(aim);defocuses.push(df);
    }
    let fitted=fit(basis,input.paint.cells,settings.gapWeight,settings.fitPasses);
    fitted=refine(input,settings,T,bowl,patches,basis,usedTargets,defocuses,fitted);
    for(let i=0;i<patches.length;i++){
      const p=patches[i],d=V.sub(p.surface.P,input.source.pos),r=V.len(d);
      capacities[i]=4*p.hx*p.hy*bowl.intensity(d,r)/(r*r)/bowl.normalization*input.limits.reflectivity;
    }
    const ratios=[];for(let i=0;i<patches.length;i++)if(fitted.alpha[i]>1e-8)ratios.push(capacities[i]/fitted.alpha[i]);ratios.sort((a,b)=>a-b);
    const exposure=(ratios.length?ratios[Math.floor(settings.saturation*(ratios.length-1))]:0)*settings.throughput;
    const surfaces=[],intent=[];
    for(let i=0;i<patches.length;i++) {
      const factor=Math.sqrt(clamp(exposure*fitted.alpha[i]/Math.max(1e-15,capacities[i]),0,1));if(factor<0.015)continue;
      const p=patches[i],D=V.dist(p.surface.P,p.surface.Z);
      // Keep the aperture image's size when reducing collecting area. Without
      // this compensation, point-source and defocused images shrink as well.
      const finalPatch=patch(p.surface.P,p.surface.Z,input.source.pos,bowl.U,bowl.W,p.hx*factor,p.hy*factor,D/(1+defocuses[i]/factor),input.envelope,bowl.keep,p.surface.id,input.limits.reflectivity);
      if(!finalPatch)continue;
      const s=finalPatch.surface;surfaces.push(s);
      const cells=basis[i].filter(q=>input.paint.cells[q[0]]>0).map(q=>[q[0],q[1]*exposure*fitted.alpha[i]]);intent.push({facet:s.id,cells});
    }
    if(tools&&tools.progress)tools.progress(1);
    return {surfaces,intent,notes:[surfaces.length+' exact ellipsoidal facets on a target-facing bowl; no tracing in solve.',
      'Bowl path offset '+bowl.C.toFixed(3)+' mm; analytical image/area fit with '+settings.fitPasses+' area and '+settings.aimPasses+' position passes.',
      'Predicted captured capacity '+(100*capacities.reduce((a,b)=>a+b,0)).toFixed(2)+'% of source; fitted exposure '+exposure.toExponential(3)+'.']};
  }

  RF.Solvers.register({id:'bowl-image',name:'Bowl image',version:'1.0',modes:['paint'],settings:[
    {key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:0.5,default:0},
    {key:'fill',label:'Patch fill',type:'range',min:0.35,max:0.96,step:0.01,default:0.82},
    {key:'depth',label:'Bowl depth factor',type:'range',min:0.5,max:1.5,step:0.05,default:1},
    {key:'sharpness',label:'Prefer distant facets',type:'range',min:0,max:8,step:0.25,default:2},
    {key:'radiusFloor',label:'Min radius / envelope reach',type:'range',min:0,max:0.85,step:0.05,default:0.25},
    {key:'smoothing',label:'Image overlap',type:'range',min:0.5,max:2.5,step:0.1,default:1.6},
    {key:'gapWeight',label:'Dark area fit weight',type:'range',min:0.1,max:5,step:0.1,default:1},
    {key:'saturation',label:'Capacity saturation quantile',type:'range',min:0,max:0.5,step:0.05,default:0.05},
    {key:'throughput',label:'Area fit scale',type:'range',min:0.25,max:1.3,step:0.05,default:0.95},
    {key:'lloyd',label:'Aim refinement passes',type:'range',min:0,max:20,step:1,default:10},
    {key:'aimPasses',label:'Image position fit passes',type:'range',min:0,max:6,step:1,default:3},
    {key:'fitPasses',label:'Area fit passes',type:'range',min:4,max:100,step:4,default:32},
  ],solve});
})();

/* Optional tuner, deliberately separate from the static solver above.
 * The input selects a fixed work plan. Wall-clock timing never changes which
 * candidates are scored, so completed solves remain deterministic. The host's
 * 60-second cutoff is the final guard on unusually expensive scenes.
 */
(function () {
  'use strict';
  const base=RF.Solvers.get('bowl-image');
  RF.Solvers.register({id:'bowl-image-auto',name:'Bowl image — auto',version:'1.0',modes:['paint'],settings:base.settings.concat([
    {key:'goal',label:'Tuning goal',type:'select',options:['faithful','throw','efficient'],default:'faithful'},
    {key:'tuneSeconds',label:'Target tuning time (s)',type:'number',min:0.5,max:55,step:0.5,default:5},
  ]),solve(input,settings,tools) {
    const fixed=RF.Solvers.sanitize(base,settings),painted=input.paint.cells.filter(p=>p>0).length;
    if(!painted||!input.limits.maxFacets)return base.solve(input,fixed,tools);
    const variants=settings.goal==='throw'?[
      {},{fill:0.92,radiusFloor:0.15,throughput:1.25,saturation:0.2},
      {throughput:1.2,saturation:0.15},{radiusFloor:0.4,gapWeight:2},
      {fill:0.9,depth:1.15},{depth:0.85},{radiusFloor:0.4},{smoothing:1.9},
    ]:settings.goal==='efficient'?[
      {},{fill:0.92,radiusFloor:0.15,throughput:1.2,saturation:0.2},
      {throughput:1.2,saturation:0.15},{fill:0.92,depth:0.9},
      {radiusFloor:0.4},{gapWeight:2},{depth:0.85},{smoothing:1.9},
    ]:[
      {},{radiusFloor:0.4},{gapWeight:2},{depth:0.85},
      {smoothing:1.9},{radiusFloor:0.4,gapWeight:2},
      {throughput:1.2,saturation:0.15},{radiusFloor:0.5,smoothing:1.8},
    ];
    const V=RF.V,env=input.envelope,L=input.source.pos;
    let reach=0;for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])reach=Math.max(reach,V.dist(L,[env.center[0]+x*env.half[0],env.center[1]+y*env.half[1],env.center[2]+z*env.half[2]]));
    const N=Math.min(input.limits.maxFacets,painted),cw=input.target.size/input.paint.res;
    const imageCells=V.dist(L,RF.Engine.designFrame(input.target).C)*RF.Source.extentSize(input.source)/Math.max(cw*Math.max(reach*0.35,env.keepOut||0,fixed.minDistance),1e-6);
    const estimatedMs=250+2.5*N+0.004*N*Math.min(1600,imageCells*imageCells);
    const hostMs=Number.isFinite(tools.budget&&tools.budget.ms)?Math.max(500,tools.budget.ms-1500):55000;
    const targetMs=Math.min(55000,hostMs,1000*settings.tuneSeconds);
    let count=Math.max(1,Math.min(variants.length,Math.floor(targetMs/estimatedMs)));
    const available=Number.isFinite(tools.budget&&tools.budget.rays)?Math.max(0,tools.budget.rays):4e6;
    const rays=Math.min(500000,Math.floor(available/count));
    if(rays<10000)return base.solve(input,fixed,tools);
    let winner=null,best=-Infinity,reference=null,picked=null;
    const history=[];
    // Watch solve (display only): each traced candidate with its own trace, at most once a second.  Reads out/result only.
    let lastShow=0;
    const show=(out,result,label)=>{
      if(!tools||!tools.preview||tools.preview.none)return;
      const t=Date.now();if(t-lastShow<1000)return;lastShow=t;
      try{tools.preview(out.surfaces,{label,trace:result,note:'static bowl-image settings variant'});}catch(e){/* display only */}
    };
    for(let i=0;i<count;i++) {
      const candidate=RF.Solvers.sanitize(base,Object.assign({},fixed,variants[i]));
      // A tuner may vary its own knobs; the user's hard clearance preference,
      // facet cap and reflectivity are retained for every candidate.
      candidate.minDistance=fixed.minDistance;
      const out=base.solve(input,candidate,{progress(v){if(tools.progress)tools.progress((i+0.5*v)/count);}});
      const result=tools.trace(out.surfaces,{rays,seed:input.seed,attribution:false,occlusion:false});
      show(out,result,'candidate '+(i+1)+'/'+count);
      const fd=result.fidelity||{},f=(fd.fidelity||0)*Math.min(1,(fd.onPaint||0)/0.005);
      if(!reference)reference={on:Math.max(1e-9,fd.onPaint||0),peak:Math.max(1e-9,result.peakCd||0)};
      const gate=Math.max(0,Math.min(1,(f-0.5)/0.25));
      const flux=Math.min(2,(fd.onPaint||0)/reference.on)/2,peak=Math.min(2,(result.peakCd||0)/reference.peak)/2;
      const utility=settings.goal==='efficient'?f+0.5*gate*flux:settings.goal==='throw'?f+0.5*gate*peak:f+0.03*gate*(0.7*flux+0.3*peak);
      history.push({candidate:i,fidelity:fd.fidelity||0,onPaint:fd.onPaint||0,peakCd:result.peakCd||0,utility});
      if(utility>best+0.002||winner===null){best=utility;winner=out;picked=candidate;}
      if(tools.progress)tools.progress((i+1)/count);
    }
    return {surfaces:winner.surfaces,intent:winner.intent,notes:(winner.notes||[]).concat([
      'Auto '+settings.goal+': '+count+' fixed candidates, '+rays+' rays each, seed '+input.seed+'.',
      'Selected static settings '+JSON.stringify(picked)+'.',
      'Candidate measurements '+JSON.stringify(history)+'.',
    ])};
  }});
})();
})();
