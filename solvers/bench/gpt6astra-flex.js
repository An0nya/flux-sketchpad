/* Analytic tiled imaging reflector. The static solve never traces.
 * The separately registered -auto tuner compares static settings using tools.trace. */
(function () {
  'use strict';
  const V = RF.V;
  const add = V.add, sub = V.sub, mul = V.mul, dot = V.dot, norm = V.norm;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  function solve(input, settings) {
    const env = input.envelope, src = input.source, S = src.pos;
    const cap = Math.max(0, Math.floor(input.limits.maxFacets));
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = RF.Engine.targetFrame(input.target), R = input.paint.res, pitch = input.target.size / R;
    const paint = input.paint.cells, cells = [];
    for (let i = 0; i < paint.length; i++) if (paint[i] > 0) cells.push({ i, x: (i % R + .5 - R / 2) * pitch, y: (Math.floor(i / R) + .5 - R / 2) * pitch, w: paint[i] });
    if (!cap || !cells.length) return { surfaces: [], intent: [], notes: ['No facets requested or empty painting.'] };
    const a = norm(sub(T.C, S)), u = norm(V.cross(a, T.tv)), v = V.cross(u, a);
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let bits = 0; bits < 8; bits++) {
      const p = env.center.map((x, k) => x + (bits & (1 << k) ? 1 : -1) * env.half[k]);
      [u, v].forEach((e, k) => { const q = dot(sub(p, S), e); lo[k] = Math.min(lo[k], q); hi[k] = Math.max(hi[k], q); });
    }
    const span = hi.map((h, k) => h - lo[k]);
    const step = Math.sqrt(span[0] * span[1] / (Math.max(16,cap) * 1.8));
    const nx = Math.max(1, Math.ceil(span[0] / step)), ny = Math.max(1, Math.ceil(span[1] / step));
    const dx = span[0] / nx, dy = span[1] / ny;
    const sa = RF.Source.frame(src).a;
    const clear = p => RF.Geo.envInside(env, p, -0.002) && (input.sources || [src]).every(s => V.dist(p, s.pos) > keep + .05);
    // Choose a confocal parent paraboloid by its useful aperture, favouring a long object distance.
    const scale = V.len(env.half) + V.dist(env.center, S);
    let best = [], bestScore = -1, bestK = 0;
    for (let ki = 1; ki <= 30; ki++) {
      const K = scale * ki / 22, list = [];
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x = lo[0] + (i + .5) * dx, y = lo[1] + (j + .5) * dy;
        const P = add(S, add(mul(a, (x*x+y*y-K*K)/(2*K)), add(mul(u,x),mul(v,y))));
        const r = V.dist(P,S), d = norm(sub(P,S));
        const intensity = RF.Source.intensity(src, Math.acos(clamp(dot(d,sa),-1,1)));
        if (!clear(P) || intensity < .02 || r < keep + step) continue;
        const n = norm(sub(a,d)), cos = dot(n,a);
        if (cos < .2) continue;
        // An aperture-space rectangle lifted into the tangent plane.
        const ex = sub(u,mul(a,dot(n,u)/cos)), ey = sub(v,mul(a,dot(n,v)/cos));
        const corners = [-1,1].flatMap(sx => [-1,1].map(sy => add(P,add(mul(ex,sx*dx*.47),mul(ey,sy*dy*.47)))));
        if (!corners.every(clear)) continue;
        const flux = intensity*dx*dy/(r*r);
        list.push({P,r,flux,x,y});
      }
      list.sort((p,q) => q.r-p.r);
      const selected = list.slice(0,cap);
      const score = selected.reduce((s,p)=>s+p.flux*Math.pow(p.r,settings.distanceBias),0);
      if (score > bestScore) { bestScore=score; best=selected; bestK=K; }
    }
    if (!best.length) return {surfaces:[],intent:[{facet:null,cells:cells.map(c=>[c.i,c.w])}],notes:['No usable parent aperture inside the clearance.']};
    // Recursive area partition of the painting. Equal-area tiles, not equal-flux tiles:
    // brightness is supplied by aperture area rather than by crowding bright regions.
    function partition(cs,n) {
      if (n<=1 || cs.length<=1) {
        const mass=cs.reduce((s,c)=>s+c.w,0), x=cs.reduce((s,c)=>s+c.x*c.w,0)/mass, y=cs.reduce((s,c)=>s+c.y*c.w,0)/mass;
        const vx=cs.reduce((s,c)=>s+c.w*(c.x-x)**2,0)/mass+pitch*pitch/12;
        const vy=cs.reduce((s,c)=>s+c.w*(c.y-y)**2,0)/mass+pitch*pitch/12;
        return [{x,y,w:mass,wx:Math.sqrt(12*vx),wy:Math.sqrt(12*vy),cells:cs}];
      }
      const xs=cs.map(c=>c.x),ys=cs.map(c=>c.y);
      const axis=Math.max(...xs)-Math.min(...xs)>=Math.max(...ys)-Math.min(...ys)?'x':'y';
      cs.sort((p,q)=>p[axis]-q[axis]||p.i-q.i);
      const nl=Math.floor(n/2), cut=clamp(Math.round(cs.length*nl/n),1,cs.length-1);
      return partition(cs.slice(0,cut),nl).concat(partition(cs.slice(cut),n-nl));
    }
    const tiles=partition(cells.slice(),best.length);
    // Decouple source distance from painting location using a deterministic permutation.
    best.sort((p,q)=>p.y-q.y||p.x-q.x);
    const ordered=best.map((p,i)=>({p,key:(i*.618033988749895)%1})).sort((p,q)=>p.key-q.key).map(x=>x.p);
    const sf=RF.Source.frame(src), sourceW=src.kind==='point'?0:src.shape==='rect'?src.w:2*(src.radius||1), sourceH=src.kind==='point'?0:src.shape==='rect'?src.h:2*(src.radius||1);
    const designs=[];
    for(let k=0;k<tiles.length;k++) {
      const t=tiles[k], b=ordered[k], P=b.P, Z=add(T.C,add(mul(T.tu,t.x),mul(T.tv,t.y))), ah=norm(sub(Z,P)), sh=norm(sub(S,P)), n=norm(add(ah,sh)), L=V.dist(Z,P);
      const reflect=e=>sub(e,mul(n,2*dot(n,e)));
      const image=e=> {const h=reflect(e); return mul(sub(h,mul(ah,dot(h,T.n)/dot(ah,T.n))),L/b.r);};
      const im1=image(mul(sf.u,sourceW)),im2=image(mul(sf.v,sourceH));
      const sx=Math.sqrt((dot(im1,T.tu)**2+dot(im2,T.tu)**2)/12+pitch*pitch/12);
      const sy=Math.sqrt((dot(im1,T.tv)**2+dot(im2,T.tv)**2)/12+pitch*pitch/12);
      const wx=settings.spread*t.wx, wy=settings.spread*t.wy;
      const p1=[dot(im1,T.tu),dot(im1,T.tv)],p2=[dot(im2,T.tu),dot(im2,T.tv)];
      let sourcePoly;
      if(src.shape==='disc') sourcePoly=Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return [(.5*Math.cos(a)*p1[0]+.5*Math.sin(a)*p2[0]),(.5*Math.cos(a)*p1[1]+.5*Math.sin(a)*p2[1])];});
      else sourcePoly=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[(x*p1[0]+y*p2[0])/2,(x*p1[1]+y*p2[1])/2]);
      designs.push({t,b,P,Z,n,ah,L,sx,sy,wx,wy,sourcePoly,weight:t.w});
    }
    // Closed-form image kernel: the projected LED polygon convolved with a rectangular
    // defocused aperture. Integrate its density over pixels by Gaussian quadrature.
    // This is a box-spline convolution, not a bundle of simulated rays. A Gaussian
    // fallback handles point / degenerate edge-on sources.
    const erf=x=>{const s=x<0?-1:1; x=Math.abs(x); const t=1/(1+.3275911*x); return s*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x));};
    const box=(x,w,s)=> Math.max(0,(erf((x+w/2)/(Math.SQRT2*s))-erf((x-w/2)/(Math.SQRT2*s)))/(2*Math.max(w,1e-9)));
    const area=p=>{let s=0;for(let i=0;i<p.length;i++){const q=p[(i+1)%p.length];s+=p[i][0]*q[1]-p[i][1]*q[0];}return Math.abs(s)/2;};
    function overlap(poly,x0,x1,y0,y1) {
      let p=poly;
      for(const [axis,bound,sign]of [[0,x0,1],[0,x1,-1],[1,y0,1],[1,y1,-1]]) {
        const q=[];if(!p.length)return 0;
        let a=p[p.length-1],da=sign*(a[axis]-bound);
        for(const b of p){const db=sign*(b[axis]-bound);if((da>=0)!==(db>=0)){const f=da/(da-db);q.push([a[0]+f*(b[0]-a[0]),a[1]+f*(b[1]-a[1])]);}if(db>=0)q.push(b);a=b;da=db;}p=q;
      }
      return area(p);
    }
    const models=designs.map(d=>{
      const entries=[], sourceArea=area(d.sourcePoly);
      const xmin=clamp(Math.floor((d.t.x-d.wx/2-3*d.sx)/pitch+R/2),0,R-1), xmax=clamp(Math.ceil((d.t.x+d.wx/2+3*d.sx)/pitch+R/2),0,R-1);
      const ymin=clamp(Math.floor((d.t.y-d.wy/2-3*d.sy)/pitch+R/2),0,R-1), ymax=clamp(Math.ceil((d.t.y+d.wy/2+3*d.sy)/pitch+R/2),0,R-1);
      for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++) {
        let z=0;
        if(settings.kernel==='polygon' && sourceArea>1e-4) {
          for(const ox of [.2113248654,.7886751346])for(const oy of [.2113248654,.7886751346]) {
            const xx=(x+ox-R/2)*pitch-d.t.x, yy=(y+oy-R/2)*pitch-d.t.y;
            z+=overlap(d.sourcePoly,xx-d.wx/2,xx+d.wx/2,yy-d.wy/2,yy+d.wy/2)*pitch*pitch/(4*sourceArea*d.wx*d.wy);
          }
        } else z=box((x+.5-R/2)*pitch-d.t.x,d.wx,d.sx)*box((y+.5-R/2)*pitch-d.t.y,d.wy,d.sy)*pitch*pitch;
        if(z>1e-6) entries.push([y*R+x,z]);
      }
      return entries;
    });
    const predicted=new Float64Array(R*R);
    designs.forEach((d,k)=>models[k].forEach(([i,z])=>predicted[i]+=d.weight*z));
    for(let it=0;it<50;it++) for(let k=0;k<designs.length;k++) {
      const d=designs[k]; let grad=0,curv=0;
      for(const [i,z] of models[k]) {const penalty=paint[i]>0?1:settings.darkWeight; grad+=penalty*z*(paint[i]-predicted[i]); curv+=penalty*z*z;}
      const change=Math.max(-d.weight,grad/Math.max(curv,1e-12))*.8;
      d.weight+=change; for(const [i,z]of models[k])predicted[i]+=change*z;
    }
    const ratios=designs.filter(d=>d.weight>1e-5).map(d=>d.b.flux/d.weight).sort((a,b)=>a-b);
    // Large overlapping LED images can share capacity; isolated small images cannot.
    const overlapRatios=designs.map(d=>Math.sqrt(d.sx*d.sy/(d.wx*d.wy))).sort((a,b)=>a-b);
    const utilization=settings.utilization*clamp(2*overlapRatios[Math.floor(overlapRatios.length/2)],.2,1);
    const brightness=(ratios[Math.floor(ratios.length*utilization)]||0)*settings.fill*settings.fill;
    // Bounded radiometric inversion: redistribute demand that an individual aperture cannot catch.
    if(settings.balance) {
      predicted.fill(0);
      designs.forEach((d,k)=>{d.maximum=d.b.flux*settings.fill*settings.fill/Math.max(brightness,1e-20);d.weight=Math.min(d.weight,d.maximum);models[k].forEach(([i,z])=>predicted[i]+=d.weight*z);});
      for(let it=0;it<40;it++)for(let k=0;k<designs.length;k++) {
        const d=designs[k];let grad=0,curv=0;
        for(const [i,z] of models[k]){const p=paint[i]>0?1:settings.darkWeight;grad+=p*z*(paint[i]-predicted[i]);curv+=p*z*z;}
        const next=clamp(d.weight+.8*grad/Math.max(curv,1e-12),0,d.maximum),delta=next-d.weight;
        d.weight=next;for(const [i,z]of models[k])predicted[i]+=delta*z;
      }
    }
    const surfaces=[],intent=[];
    for(let k=0;k<designs.length;k++) {
      const d=designs[k]; if(d.weight<1e-6)continue;
      const f=Math.min(settings.fill,Math.sqrt(brightness*d.weight/d.b.flux));
      const c=dot(d.n,d.ah); if(c<.1)continue;
      // Beam-aligned aperture axes. Their projections are orthogonal in the output beam.
      const bu=norm(sub(T.tu,mul(d.ah,dot(T.tu,d.ah)))), bv=V.cross(d.ah,bu);
      const ex=sub(bu,mul(d.ah,dot(bu,d.n)/c)), ey=sub(bv,mul(d.ah,dot(bv,d.n)/c));
      let hx=dx*f/2,hy=dy*f/2;
      let surface;
      for(let attempt=0;attempt<12;attempt++) {
        const pts3=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>add(d.P,add(mul(ex,x*hx),mul(ey,y*hy))));
        surface={type:'facet',id:'F'+k,P:d.P,S0:S.slice(),Z:d.Z,flat:false,di:d.L,vg:[(1-d.wx/(2*hx))/d.L,(1-d.wy/(2*hy))/d.L],ax:bu,clip:{kind:'poly',pts3},optics:{reflectivity:input.limits.reflectivity}};
        const G=RF.Geo.compile([surface]), D=G.D, fr=G.metas[0].frame;
        // Bound the ENTIRE curved patch, not just sampled outline points. For the
        // local quadratic Az²+B(x,y)z+C(x,y)=0, bound |C| and bound |B| below.
        // Its near root is then enclosed by +/- sag. The convex prism enclosing
        // the tangent polygon plus that sag must fit inside the convex envelope.
        const local=pts3.map(p=>{const q=sub(p,d.P);return [dot(q,fr.ex),dot(q,fr.ey)];});
        const X=Math.max(...local.map(p=>Math.abs(p[0]))),Y=Math.max(...local.map(p=>Math.abs(p[1])));
        const cb=Math.abs(D[12])*X*X+Math.abs(D[13])*Y*Y+2*Math.abs(D[15])*X*Y+Math.abs(D[18])*X+Math.abs(D[19])*Y;
        const bb=Math.abs(D[20])-2*Math.abs(D[16])*X-2*Math.abs(D[17])*Y, aa=Math.abs(D[14]);
        const disc=bb*bb-4*aa*cb;
        const sag=bb>0&&disc>=0?2*cb/(bb+Math.sqrt(disc)):Infinity;
        const radius=Math.hypot(Math.max(...pts3.map(p=>V.dist(p,d.P))),sag);
        const valid=Number.isFinite(sag) && (input.sources||[src]).every(s=>V.dist(d.P,s.pos)>keep+radius+.05)
          && pts3.every(p=>[-1,1].every(s=>RF.Geo.envInside(env,add(p,mul(d.n,s*sag)),-.002)));
        if(valid)break;
        surface=null;hx*=.8;hy*=.8;
      }
      if(surface){surfaces.push(surface);intent.push({facet:surface.id,cells:d.t.cells.map(c=>[c.i,c.w])});}
    }
    return {surfaces,intent,notes:['Analytic parent K='+bestK.toFixed(2)+' mm; '+surfaces.length+' imaging tiles; no traced rays.', 'Aperture weights fitted to analytic LED/aperture convolutions.']};
  }
  RF.Solvers.register({id:'bench-gpt6astra-flex--analytic-tiles',name:'Analytic imaging tiles',version:'1.0',modes:['paint'],settings:[
    {key:'balance',label:'Capacity balancing',type:'checkbox',default:true},
    {key:'utilization',label:'Aperture utilization quantile',type:'range',min:0,max:.8,step:.05,default:.3},
    {key:'kernel',label:'LED image model',type:'select',options:['polygon','gaussian'],default:'polygon'},
    {key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:.5,default:0},
    {key:'distanceBias',label:'Distance preference',type:'range',min:0,max:4,step:.25,default:2.5},
    {key:'fill',label:'Aperture fill',type:'range',min:.2,max:.95,step:.05,default:.9},
    {key:'spread',label:'Image tile width',type:'range',min:.3,max:2,step:.1,default:.9},
    {key:'darkWeight',label:'Dark-region penalty',type:'range',min:.1,max:5,step:.1,default:1.5}
  ],solve});

  // Keep the static algorithm and its defaults untouched. Only this separate tuner traces.
  const staticDef = RF.Solvers.get('bench-gpt6astra-flex--analytic-tiles');
  RF.Solvers.register({
    id: 'bench-gpt6astra-flex--analytic-tiles-auto', name: 'Analytic imaging tiles — auto', version: '1.0', modes: ['paint'],
    settings: [
      {key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:.5,default:0},
      {key:'goal',label:'Goal',type:'select',options:['faithful','throw','efficient'],default:'faithful'},
      {key:'testRays',label:'Rays per candidate',type:'number',min:25000,max:1000000,step:25000,default:750000}
    ],
    async solve(input, settings, tools) {
      const base = Object.assign(RF.Solvers.defaults(staticDef), {minDistance:settings.minDistance || 0});
      const baseline = solve(input, base);
      const fallback = reason => Object.assign({}, baseline, {notes:['Auto: '+reason+'; returned static defaults.', ...baseline.notes]});
      if (!baseline.surfaces.length) return fallback('no usable static aperture or no paint');
      if (!tools || typeof tools.trace !== 'function') return fallback('tracing unavailable');
      // Four explicit hypotheses, not a combinatorial sweep. Same portfolio for every goal,
      // so the goal changes selection, not the noise or the set of measured geometries.
      const portfolio = [
        {name:'balanced', changes:{}},
        {name:'narrow', changes:{spread:.65, fill:.95}},
        {name:'throughput', changes:{utilization:.6, fill:.95}},
        {name:'conservative', changes:{utilization:.1}}
      ];
      const budget = tools.budget || {};
      const rayLimit = Number.isFinite(budget.rays) ? Math.max(0,budget.rays) : Infinity;
      const msLimit = Number.isFinite(budget.ms) ? Math.max(0,budget.ms) : 60000;
      // Allocate the entire schedule before running it. No elapsed-time stopping rule:
      // otherwise machine load could change the chosen geometry for identical inputs.
      const rays = Math.floor(Math.min(clamp(+settings.testRays || 750000,25000,1000000),
        rayLimit / portfolio.length, msLimit * 50 / portfolio.length));
      if (rays < 25000 || msLimit < 2000) return fallback('trace budget too small for a fair comparison');
      const seed = input.seed | 0, measured = [];
      for (let k=0;k<portfolio.length;k++) {
        const item = portfolio[k], chosen = RF.Solvers.sanitize(staticDef,Object.assign({},base,item.changes));
        const output = k===0 ? baseline : solve(input,chosen);
        const trace = await tools.trace(output.surfaces,{rays,seed});
        const fd = trace && trace.fidelity;
        if (!fd || !Number.isFinite(fd.fidelity) || !Number.isFinite(fd.onPaint))
          throw new Error('analytic-tiles-auto: trace returned no finite fidelity/onPaint');
        const peak = Number.isFinite(trace.peakCd) ? Math.max(0,trace.peakCd) : 0;
        const peakNoise = Number.isFinite(trace.peakNoise) ? Math.max(0,trace.peakNoise) : 1;
        measured.push({name:item.name,settings:chosen,output,fidelity:fd.fidelity,onPaint:fd.onPaint,
          peak, safePeak:peak/(1+peakNoise)});
        if (tools.progress) tools.progress((k+1)/portfolio.length);
      }
      const bestFidelity = Math.max(...measured.map(c=>c.fidelity));
      // Throw / efficiency must remain within five percentage points of the best beam.
      // Never trade a severely damaged pattern for a bright hot spot or a flood.
      const eligible = measured.filter(c=>c.fidelity>=bestFidelity-(settings.goal==='faithful'?0:.05));
      const merit = c => settings.goal==='throw' ? c.safePeak : settings.goal==='efficient' ? c.onPaint : c.fidelity;
      let winner = eligible[0];
      for (const c of eligible.slice(1))
        if (merit(c)>merit(winner) || (merit(c)===merit(winner) && c.onPaint>winner.onPaint)) winner=c;
      const notes = [
        'Auto '+settings.goal+': selected '+winner.name+'; '+portfolio.length+' candidates × '+rays+' rays, seed '+seed+'.',
        'Selected static settings: '+JSON.stringify(winner.settings),
        'Candidate measurements: '+JSON.stringify(measured.map(c=>({name:c.name,fidelity:c.fidelity,onPaint:c.onPaint,peakCd:c.peak}))),
        ...winner.output.notes.map(n=>'Static construction: '+n)
      ];
      return Object.assign({},winner.output,{notes});
    }
  });
})();
