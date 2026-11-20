/* Analytic LED-image tiling, plus an optional common-seed settings tuner.
 * The image-tiler solver itself never traces; only image-tiler-auto uses tools.trace. */
(function () {
  'use strict';
  const V = RF.V;
  const add = V.add, sub = V.sub, mul = V.mul, dot = V.dot, norm = V.norm;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Exact area of the intersection of a convex image polygon and a raster cell.
  function areaIn(poly, x, y) {
    for (const [axis, bound, sign] of [[0,x-.5,1],[0,x+.5,-1],[1,y-.5,1],[1,y+.5,-1]]) {
      const out = [];
      for (let i=0; i<poly.length; i++) {
        const a=poly[i], b=poly[(i+1)%poly.length];
        const da=sign*(a[axis]-bound), db=sign*(b[axis]-bound);
        if (da>=0) out.push(a);
        if ((da>=0)!==(db>=0)) { const t=da/(da-db); out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]); }
      }
      poly=out; if (!poly.length) return 0;
    }
    let a=0; for(let i=0;i<poly.length;i++){ const b=poly[i],c=poly[(i+1)%poly.length];a+=b[0]*c[1]-b[1]*c[0]; }
    return Math.abs(a)*.5;
  }
  function imageKernel(P, Z, source, T, cell) {
    const r=V.dist(P,source.pos), d=norm(sub(P,source.pos)), a=norm(sub(Z,P));
    const n=norm(sub(a,d)), L=V.dist(P,Z), sf=RF.Source.frame(source);
    function map(v) {
      let q=mul(sub(v,mul(d,dot(d,v))),-1/r);
      q=sub(q,mul(n,2*dot(n,q)));
      q=mul(sub(q,mul(a,dot(T.n,q)/dot(T.n,a))),L);
      return [dot(q,T.tu)/cell,dot(q,T.tv)/cell];
    }
    let w=source.w||2*(source.radius||0), h=source.h||2*(source.radius||0);
    if(source.kind==='point') w=h=0;
    const u=map(mul(sf.u,w)), v=map(mul(sf.v,h));
    // A tiny raster-cell footprint prevents singular point / edge-on source images.
    if(Math.abs(u[0]*v[1]-u[1]*v[0])<.04) {
      const sx=Math.max(.6,Math.hypot(u[0],v[0])),sy=Math.max(.6,Math.hypot(u[1],v[1]));
      u[0]=sx;u[1]=0;v[0]=0;v[1]=sy;
    }
    const poly=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t])=>[(s*u[0]+t*v[0])/2,(s*u[1]+t*v[1])/2]);
    const rx=Math.ceil((Math.abs(u[0])+Math.abs(v[0]))/2+.5),ry=Math.ceil((Math.abs(u[1])+Math.abs(v[1]))/2+.5);
    const k=[];let sum=0;
    for(let y=-Math.min(ry,100);y<=Math.min(ry,100);y++)for(let x=-Math.min(rx,100);x<=Math.min(rx,100);x++){
      const a=areaIn(poly,x,y);if(a>1e-9){k.push({x,y,v:a});sum+=a;}
    }
    for(const q of k)q.v/=sum;
    return k;
  }
  function room(env,P) {
    const d=sub(P,env.center),h=env.half;
    if(env.shape==='box')return Math.min(...h.map((v,i)=>v-Math.abs(d[i])));
    if(env.shape==='ellipsoid')return (1-Math.hypot(...d.map((v,i)=>v/h[i])))*Math.min(...h);
    const ax=env.axis===undefined?2:env.axis,i=(ax+1)%3,j=(ax+2)%3;
    return Math.min(h[ax]-Math.abs(d[ax]),(1-Math.hypot(d[i]/h[i],d[j]/h[j]))*Math.min(h[i],h[j]));
  }
  function solve(input, settings) {
    const src=input.source,env=input.envelope,T=RF.Engine.designFrame(input.target);
    const cap=Math.max(0,input.limits.maxFacets|0),keep=Math.max(env.keepOut||0,settings.minDistance||0);
    const R=settings.resolution||50,cell=input.target.size/R;
    const paint=new Float64Array(R*R),pr=input.paint.res;
    // Area resampling works both above and below the user's paint resolution.
    for(let y=0;y<R;y++)for(let x=0;x<R;x++){
      const x0=x*pr/R,x1=(x+1)*pr/R,y0=y*pr/R,y1=(y+1)*pr/R;
      let sum=0;
      for(let j=Math.floor(y0);j<Math.ceil(y1);j++)for(let i=Math.floor(x0);i<Math.ceil(x1);i++){
        if(i>=pr||j>=pr)continue;
        sum+=Math.max(0,input.paint.cells[j*pr+i]||0)*Math.max(0,Math.min(i+1,x1)-Math.max(i,x0))*Math.max(0,Math.min(j+1,y1)-Math.max(j,y0));
      }
      paint[y*R+x]=sum/((x1-x0)*(y1-y0));
    }
    let mass=0;for(const x of paint)mass+=x;
    if(!cap||!mass)return {surfaces:[],intent:[],notes:['No facets requested or no painted cells.']};
    const axis=norm(src.axis),ax=0,i=1,j=2;
    const nx=Math.max(1,Math.round(Math.sqrt(cap*1.3*env.half[i]/env.half[j]))),ny=Math.max(1,Math.ceil(cap*1.3/nx));
    const dx=2*env.half[i]/nx,dy=2*env.half[j]/ny;
    const interval=RF.Geo.envInterval(env,src.pos,axis);
    const axialReach=Number.isFinite(interval[1])&&interval[1]>0?interval[1]:Math.max(...env.half);
    const backReach=src.pos[0]-env.center[0]+env.half[0];
    const focal=Math.max(1,Math.min(Math.max(1,backReach*.9),axialReach*(settings.focal||.4)));
    const sites=[];const sources=input.sources||[src];
    const lit=Array.from(paint).filter(x=>x>0).length;
    const tileWidth=(settings.spread||1.6)*Math.sqrt(lit/cap)*cell;
    for(let iy=0;iy<ny;iy++)for(let ix=0;ix<nx;ix++){
      // The paraboloidal sheet gives incoming and outgoing light separate corridors.
      const P=env.center.slice();P[i]=env.center[i]-env.half[i]+(ix+.5)*dx;P[j]=env.center[j]-env.half[j]+(iy+.5)*dy;
      P[0]=src.pos[0]+((P[1]-src.pos[1])**2+(P[2]-src.pos[2])**2)/(4*focal)-focal;
      const r=V.dist(P,src.pos),d=norm(sub(P,src.pos)),n=norm(add(mul(d,-1),norm(sub(T.C,P))));
      if(Math.abs(n[ax])<.15)continue;
      const e1=[0,0,0],e2=[0,0,0];e1[i]=dx*.42;e2[j]=dy*.42;e1[ax]=-dot(n,e1)/n[ax];e2[ax]=-dot(n,e2)/n[ax];
      let rad=Math.max(V.len(add(e1,e2)),V.len(sub(e1,e2)));
      const available=Math.min(room(env,P),...sources.map(s=>V.dist(P,s.pos)-keep));
      // Bound the entire curved surface by a ball, not just its polygon outline.
      const shrink=Math.min(1,available/(rad*1.25));if(!(shrink>.08))continue;
      const U=mul(e1,shrink),W=mul(e2,shrink);rad*=shrink;
      const area=4*V.len(V.cross(U,W));
      const theta=Math.acos(clamp(dot(axis,d),-1,1));
      const flux=RF.Source.intensity(src,theta)*Math.max(0,-dot(d,n))*area/(r*r)*input.limits.reflectivity;
      if(flux<=0)continue;
      let k=imageKernel(P,T.C,src,T,cell);
      let vx=0,vy=0;for(const q of k){vx+=q.v*q.x*q.x;vy+=q.v*q.y*q.y;}
      const blur=Math.sqrt(Math.max(0,tileWidth*tileWidth-12*Math.sqrt(vx*vy)*cell*cell));
      const a=norm(sub(T.C,P));
      const project=e=>sub(e,mul(a,dot(T.n,e)/dot(T.n,a)));
      const pu=project(U),pw=project(W);
      const projectedArea=4*Math.abs(dot(V.cross(pu,pw),T.n));
      const defocus=blur/Math.sqrt(Math.max(1e-8,projectedArea));
      if(defocus>.01){
        const acc=new Map(),samples=5;
        for(let aa=0;aa<samples;aa++)for(let bb=0;bb<samples;bb++){
          const v=mul(add(mul(pu,(aa+.5)/samples*2-1),mul(pw,(bb+.5)/samples*2-1)),defocus/cell);
          const ox=dot(v,T.tu),oy=dot(v,T.tv);
          for(const q of k){const xx=q.x+ox,yy=q.y+oy,x0=Math.floor(xx),y0=Math.floor(yy),fx=xx-x0,fy=yy-y0;
            for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++){const x=x0+dx,y=y0+dy,key=x+','+y;const weight=q.v*(dx?fx:1-fx)*(dy?fy:1-fy)/(samples*samples);const old=acc.get(key);if(old)old.v+=weight;else acc.set(key,{x,y,v:weight});}
          }
        }
        k=[...acc.values()].filter(q=>q.v>1e-8);
      }
      sites.push({P,U,W,rad,flux,k,defocus,x:0,y:0,amp:0});
    }
    if(!sites.length)return {surfaces:[],intent:[],notes:['No safe illuminated sites in the envelope.']};
    // Fit high-capacity sites first; subsequent sweeps rotate the update order.
    sites.sort((a,b)=>b.flux-a.flux);sites.splice(cap);
    const total=sites.reduce((s,q)=>s+q.flux,0),brightness=total*(settings.fill||.55)/mass;
    const residual=Float64Array.from(paint,x=>x*brightness),weights=Float64Array.from(paint,x=>x>0?1:settings.gapWeight||2);
    const candidates=[];for(let y=0;y<R;y++)for(let x=0;x<R;x++)if(paint[y*R+x]>0)candidates.push([x,y]);
    function apply(s,sign){if(!s.amp)return;for(const q of s.k){const x=s.x+q.x,y=s.y+q.y;if(x>=0&&x<R&&y>=0&&y<R)residual[y*R+x]+=sign*s.amp*q.v;}}
    const passes=settings.passes||4;
    for(let pass=0;pass<passes;pass++)for(let z=0;z<sites.length;z++){
      const s=sites[(z*1+pass*17)%sites.length];apply(s,1);
      let best=-Infinity,bx=s.x,by=s.y,ba=0;
      for(const [x,y] of candidates){
        let dotr=0,norm2=0;
        for(const q of s.k){const u=x+q.x,v=y+q.y;
          if(u>=0&&u<R&&v>=0&&v<R){const p=v*R+u,w=weights[p];dotr+=w*q.v*residual[p];norm2+=w*q.v*q.v;}else norm2+=3*q.v*q.v;
        }
        const amp=norm2>0?clamp(dotr/norm2,0,s.flux):0,score=2*amp*dotr-amp*amp*norm2;
        if(score>best){best=score;bx=x;by=y;ba=amp;}
      }
      s.x=bx;s.y=by;s.amp=ba;apply(s,-1);
    }
    const surfaces=[],intent=[];
    for(const s of sites){
      if(s.amp<s.flux*.002)continue;
      const u=(s.x+.5-R/2)*cell,v=(s.y+.5-R/2)*cell,Z=add(T.C,add(mul(T.tu,u),mul(T.tv,v)));
      const n=norm(add(norm(sub(src.pos,s.P)),norm(sub(Z,s.P))));
      if(!Number.isFinite(n[ax])||Math.abs(n[ax])<.08)continue;
      // Reproject the aperture into its actual aiming plane.
      const project=e=>{const q=e.slice();q[ax]-=dot(n,q)/n[ax];return q;};
      let U=project(s.U),W=project(s.W);
      let scale=Math.sqrt(clamp(s.amp/s.flux,0,1));
      const rad=Math.max(V.len(add(U,W)),V.len(sub(U,W)));
      const available=Math.min(room(env,s.P),...sources.map(q=>V.dist(s.P,q.pos)-keep));
      scale=Math.min(scale,available/(rad*1.3));
      if(!(scale>0))continue;U=mul(U,scale);W=mul(W,scale);
      const pts3=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>add(s.P,add(mul(U,a),mul(W,b))));
      const id='image-'+surfaces.length;
      const distance=V.dist(s.P,Z),vergence=(1-s.defocus/Math.max(.05,scale))/distance;
      surfaces.push({type:'facet',id,P:s.P,S0:src.pos.slice(),Z,di:distance,vg:s.defocus>.01?[vergence,vergence]:undefined,flat:false,clip:{kind:'poly',pts3},optics:{interaction:'reflect',reflectivity:input.limits.reflectivity,twoSided:false}});
      const assigned=new Map();
      for(const q of s.k){
        const x=s.x+q.x,y=s.y+q.y;if(x<0||y<0||x>=R||y>=R)continue;
        const x0=x*pr/R,x1=(x+1)*pr/R,y0=y*pr/R,y1=(y+1)*pr/R;
        for(let j=Math.floor(y0);j<Math.ceil(y1);j++)for(let i=Math.floor(x0);i<Math.ceil(x1);i++){
          if(i>=pr||j>=pr||!(input.paint.cells[j*pr+i]>0))continue;
          const weight=q.v*Math.max(0,Math.min(i+1,x1)-Math.max(i,x0))*Math.max(0,Math.min(j+1,y1)-Math.max(j,y0));
          if(weight>0)assigned.set(j*pr+i,(assigned.get(j*pr+i)||0)+weight);
        }
      }
      intent.push({facet:id,cells:[...assigned]});
    }
    return {surfaces,intent,notes:[`${sites.length} analytic LED images; ${passes} raster-fitting passes at ${R}². No rays traced.`, 'Paraboloidal carrier, exact focused ellipsoids, amplitude set by aperture area.']};
  }
  RF.Solvers.register({id:'bench-gpt61sol-flex--image-tiler',name:'Analytic image tiler',version:'1.0',modes:['paint'],settings:[
    {key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:.5,default:0},
    {key:'spread',label:'Image overlap',type:'range',min:.5,max:3,step:.1,default:1.2},
    {key:'focal',label:'Carrier focal scale',type:'range',min:.2,max:1.5,step:.1,default:.4},
    {key:'fill',label:'Collected-flux utilization',type:'range',min:.1,max:1,step:.05,default:.8},
    {key:'gapWeight',label:'Dark-gap penalty',type:'range',min:.2,max:8,step:.2,default:2},
    {key:'passes',label:'Analytic fitting passes',type:'number',min:1,max:12,step:1,default:8},
    {key:'resolution',label:'Design raster resolution',type:'number',min:20,max:80,step:2,default:50}
  ],solve});

  RF.Solvers.register({
    id:'bench-gpt61sol-flex--image-tiler-auto',name:'Analytic image tiler · Auto',version:'1.0',modes:['paint'],
    settings:[
      {key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:.5,default:0},
      {key:'goal',label:'Optimization goal',type:'select',default:'faithful',options:[
        {value:'faithful',label:'Faithful painting'},
        {value:'throw',label:'Throw (preserve fidelity)'},
        {value:'efficient',label:'On-paint flux (preserve fidelity)'}
      ]}
    ],
    async solve(input,settings,tools) {
      const goal=['faithful','throw','efficient'].includes(settings.goal)?settings.goal:'faithful';
      const base=Object.assign(RF.Solvers.defaults(RF.Solvers.get('bench-gpt61sol-flex--image-tiler')),
        {minDistance:Math.max(0,settings.minDistance||0)});
      const patches=[{}, {fill:.65,gapWeight:3,spread:1}, {fill:.95},
        {spread:.8}, {spread:1.6}, {focal:.55,fill:.7}];
      const seed=input.seed|0; // Identical on EVERY trace, including the refinement stage.
      const rayBudget=tools.budget&&Number.isFinite(tools.budget.rays)?Math.max(0,Math.floor(tools.budget.rays)):Infinity;
      const coarseRays=Math.min(200000,Math.floor(rayBudget/(patches.length*2)));
      const fineRays=Math.min(650000,Math.floor((rayBudget-patches.length*coarseRays)/2));
      const checkScene={source:input.source,emitters:(input.sources||[]).slice(1),target:input.target,
        envelope:Object.assign({},input.envelope,{keepOut:Math.max(input.envelope.keepOut||0,base.minDistance)}),
        modeA:{budget:input.limits.maxFacets}};
      function valid(out) {
        const f=RF.Solvers.verify(checkScene,out);
        return !f.errors.length&&!f.intentErrors.length&&!f.violations.envelope.length&&
          !f.violations.keepOut.length&&!f.violations.budget;
      }
      const fallback=solve(input,base);
      // Empty paint and tiny trace budgets should return immediately, not rank sampling noise.
      if(!fallback.surfaces.length||coarseRays<1000){
        const out=valid(fallback)?fallback:{surfaces:[],intent:[],notes:['No valid baseline geometry.']};
        return Object.assign({},out,{notes:(out.notes||[]).concat('Auto: static fallback; no tracing needed or insufficient ray budget.')});
      }
      const candidates=[];
      let usedRays=0,traceCalls=0;
      async function measure(c,rays) {
        const trace=await tools.trace(c.out.surfaces,{rays,seed});
        usedRays+=rays;traceCalls++;
        const f=trace.fidelity||{};
        const onPaint=Number.isFinite(f.onPaint)?Math.max(0,f.onPaint):0;
        c.metric={fidelity:clamp(Number.isFinite(f.fidelity)?f.fidelity:0,0,1)*Math.min(1,onPaint/.015),
          onPaint,peak:Number.isFinite(trace.peakCd)?Math.max(0,trace.peakCd):0};
        c.trace=trace;
      }
      function rank(list) {
        const bestF=Math.max(...list.map(c=>c.metric.fidelity));
        const maxFlux=Math.max(1e-12,...list.map(c=>c.metric.onPaint));
        const maxPeak=Math.max(1e-12,...list.map(c=>c.metric.peak));
        for(const c of list){
          const f=c.metric.fidelity;
          const bonus=goal==='throw'?Math.sqrt(c.metric.peak/maxPeak):c.metric.onPaint/maxFlux;
          // A flux/throw goal may trade at most six fidelity points, and earns
          // no efficiency bonus below 50% fidelity. Faithful is strictly F first.
          c.utility=goal==='faithful'?f:f+.12*clamp((f-.5)/.25,0,1)*bonus;
          if(f<bestF-.06)c.utility=-1;
        }
        return list.slice().sort((a,b)=>b.utility-a.utility||b.metric.fidelity-a.metric.fidelity||a.index-b.index);
      }
      for(let index=0;index<patches.length;index++){
        const chosen=Object.assign({},base,patches[index]);
        const out=index===0?fallback:solve(input,chosen);
        if(!valid(out))continue; // Invalid geometry can never win, even if its trace looks good.
        const c={index,chosen,out};await measure(c,coarseRays);candidates.push(c);
        if(tools.progress)tools.progress((index+1)/(patches.length+2));
      }
      if(!candidates.length)return {surfaces:[],intent:[],notes:['Auto: no valid candidates.']};
      const ordered=rank(candidates),baseline=candidates.find(c=>c.index===0);
      // Always recheck the static baseline alongside the best challenger, at the
      // same higher ray count; never compare a fine result with a coarse result.
      const finalist=ordered.find(c=>c!==baseline);
      const finalists=baseline?[baseline,...(finalist?[finalist]:[])]:ordered.slice(0,2);
      if(fineRays>=coarseRays){
        for(const c of finalists)await measure(c,fineRays);
      }
      const winner=rank(finalists)[0];
      if(tools.progress)tools.progress(1);
      if(tools.preview)tools.preview(winner.out.surfaces,{label:'Auto · '+goal,trace:winner.trace});
      return Object.assign({},winner.out,{notes:(winner.out.notes||[]).concat([
        `Auto ${goal}: ${candidates.length} candidates, ${traceCalls} common-seed traces, ${usedRays} rays; seed ${seed}.`,
        'Selected static settings: '+JSON.stringify(winner.chosen),
        `Selection estimate: fidelity ${(100*winner.metric.fidelity).toFixed(2)}%, on paint ${(100*winner.metric.onPaint).toFixed(2)}%.`
      ])});
    }
  });
})();
