/* Bundled model solver: GPT-6 Astra (Codex), Flux solver benchmark run 2026-09-27 (workspace work-codex-astra6-flux-solver-20260927-0207).
 * Copied verbatim from that run's solvers/solver.js (sha256 c64fd4cd48ce…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote.
 * Exception (2026-10-05): display-only tools.preview calls added for Watch solve (patch-array-auto's measure). */
(function () {
/* Static finite-source reflector design. No tracing or sampled rays in solve(). */
(function () {
  'use strict';
  const V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Rectangular approximation of an arbitrary painted image. Empty borders are removed
  // after every split; mixed intensities and large patches receive more subdivisions.
  function partition(paint, budget) {
    const N = paint.res, p = paint.cells;
    function box(x0, y0, x1, y1) {
      let l = x1, r = x0, b = y1, t = y0, mass = 0, sq = 0, cells = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const w = Math.max(0, +p[y * N + x] || 0);
        if (!w) continue;
        l = Math.min(l, x); r = Math.max(r, x + 1); b = Math.min(b, y); t = Math.max(t, y + 1);
        mass += w; sq += w * w; cells.push([y * N + x, w]);
      }
      if (!mass) return null;
      const area = (r - l) * (t - b), mean = mass / area;
      return { l, r, b, t, mass, mean, cells, cost: 6 * (sq - mass * mean) + mass * ((r - l) ** 2 + (t - b) ** 2) / (N * N) };
    }
    const root = box(0, 0, N, N); if (!root) return [];
    const leaves = [root];
    while (leaves.length < budget) {
      let best = null;
      for (let i = 0; i < leaves.length; i++) {
        const q = leaves[i]; if (q.split === undefined) {
          let win = null;
          for (let axis = 0; axis < 2; axis++) {
            const lo = axis ? q.b : q.l, hi = axis ? q.t : q.r;
            for (let at = lo + 1; at < hi; at++) {
              const a = axis ? box(q.l, q.b, q.r, at) : box(q.l, q.b, at, q.t);
              const b = axis ? box(q.l, at, q.r, q.t) : box(at, q.b, q.r, q.t);
              if (!a || !b) continue;
              const gain = q.cost - a.cost - b.cost;
              if (!win || gain > win.gain) win = { a, b, gain };
            }
          }
          q.split = win;
        }
        if (q.split && (!best || q.split.gain > best.gain)) best = { ...q.split, i };
      }
      if (!best) break;
      leaves.splice(best.i, 1, best.a, best.b);
    }
    return leaves;
  }

  function solve(input, settings) {
    const env = input.envelope, S = input.source, L = S.pos, T = RF.Engine.designFrame(input.target);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0), cap = Math.max(0, input.limits.maxFacets | 0);
    const surfaces = [], intent = [], notes = [];
    if (!cap) return { surfaces, intent, notes };
    let regions = partition(input.paint, cap), count = regions.length;
    if (!count) return { surfaces, intent, notes: ['Empty painting.'] };
    const W = V.norm(V.sub(T.C, L)), U = V.inPlane(W, T.tu), H = V.cross(W, U);
    // Project the envelope bounding box onto the exit plane, then sample its rear boundary.
    const corners = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
      corners.push(V.sub(V.add(env.center, [x * env.half[0], y * env.half[1], z * env.half[2]]), L));
    const us = corners.map(p => V.dot(p, U)), vs = corners.map(p => V.dot(p, H));
    const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const candidates = [];
    // Use a rectangular array. Repartition below if emission or a curved envelope
    // excludes sites, so the remaining mirrors still cover the whole painting.
    const nx = Math.max(1, Math.ceil(Math.sqrt(count * (u1 - u0) / (v1 - v0))));
    const ny = Math.max(1, Math.ceil(count / nx));
    const du = (u1 - u0) / nx, dv = (v1 - v0) / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const Q = V.add(L, V.add(V.mul(U, u0 + (i + 0.5) * du), V.mul(H, v0 + (j + 0.5) * dv)));
      const interval = RF.Geo.envInterval(env, Q, W);
      if (!(interval[1] > interval[0])) continue;
      const depth = Math.min(interval[1] - interval[0], Math.min(du, dv) * settings.inset);
      const P = V.madd(Q, W, interval[0] + depth), r = V.dist(P, L), d = V.norm(V.sub(P, L));
      const intensity = RF.Source.intensity(S, Math.acos(clamp(V.dot(d, V.norm(S.axis)), -1, 1)));
      if (r < keep + Math.min(du, dv) * 0.5 || intensity < 0.005) continue;
      candidates.push({ P, r, intensity, capacity: intensity / (r * r) * du * dv });
    }
    candidates.sort((a, b) => b.capacity - a.capacity);
    if(candidates.length < count) { regions = partition(input.paint,candidates.length); count=regions.length; }
    regions.sort((a, b) => b.mass - a.mass);
    const n = Math.min(count, candidates.length), proposals = [], cell = input.target.size / input.paint.res;
    let brightness = Infinity;
    for (let i = 0; i < n; i++) {
      const q = regions[i], c = candidates[i], P = c.P;
      const Z = V.add(T.C, V.add(V.mul(T.tu, ((q.l + q.r) / 2 - input.paint.res / 2) * cell), V.mul(T.tv, ((q.b + q.t) / 2 - input.paint.res / 2) * cell)));
      const ah = V.norm(V.sub(Z, P)), sh = V.norm(V.sub(L, P)), normal = V.norm(V.add(ah, sh)), cos = V.dot(normal, ah);
      if (cos < 0.05) continue;
      const lift = d => V.sub(d, V.mul(ah, V.dot(normal, d) / cos));
      const a = lift(V.mul(T.tu, (q.r - q.l) * cell / 2)), b = lift(V.mul(T.tv, (q.t - q.b) * cell / 2));
      const offsets = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => V.add(V.mul(a,x),V.mul(b,y)));
      const spanU = Math.max(...offsets.map(d => Math.abs(V.dot(d,U)))), spanV = Math.max(...offsets.map(d => Math.abs(V.dot(d,H))));
      const kmin = Math.max(spanU / (du * settings.fill / 2), spanV / (dv * settings.fill / 2), 0.01);
      const rate = c.intensity * Math.abs(V.dot(ah, T.n)) / (c.r * c.r * q.mean);
      brightness = Math.min(brightness, rate / (kmin * kmin));
      proposals.push({ q, c, Z, ah, normal, offsets, rate, kmin, maximum:rate/(kmin*kmin) });
    }
    if(proposals.length) {
      const levels=proposals.map(p=>p.maximum).sort((a,b)=>a-b);
      brightness=levels[Math.floor((levels.length-1)*settings.brightnessQuantile)];
    }
    // First-order finite-source image model: convolve each rectangular patch with
    // the projected source covariance. Fit nonnegative patch strengths algebraically;
    // no rays, intersections, engine calls, or measured grids enter this calculation.
    if(settings.balance && proposals.length) {
      const R=input.paint.res, covariance=RF.Source.extentCov(S), N=R*R;
      const grid=new Float64Array(N), wanted=Float64Array.from(input.paint.cells), cols=[];
      const erf=x=>{ const sign=x<0?-1:1; x=Math.abs(x); const t=1/(1+0.3275911*x); return sign*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-x*x)); };
      const cdf=x=>0.5*(1+erf(x/Math.SQRT2));
      for(const p of proposals) {
        const d=V.norm(V.sub(p.c.P,L)), D=V.dist(p.Z,p.c.P), a=p.ah, n=p.normal;
        const map=e=>{
          const reflected=V.reflect(V.sub(e,V.mul(d,V.dot(d,e))),n);
          return V.mul(V.sub(reflected,V.mul(a,V.dot(T.n,reflected)/V.dot(T.n,a))),-D/p.c.r/cell);
        };
        const e=[[1,0,0],[0,1,0],[0,0,1]].map(map), rowU=e.map(v=>V.dot(v,T.tu)), rowV=e.map(v=>V.dot(v,T.tv));
        const variance=row=>{let s=0;for(let i=0;i<3;i++)for(let j=0;j<3;j++)s+=row[i]*covariance[i*3+j]*row[j];return s;};
        const sx=Math.sqrt(Math.max(0.08,variance(rowU))), sy=Math.sqrt(Math.max(0.08,variance(rowV))), q=p.q;
        const indices=[], values=[]; let norm=0;
        for(let y=Math.max(0,Math.floor(q.b-3*sy));y<Math.min(R,Math.ceil(q.t+3*sy));y++) {
          const fy=cdf((y+0.5-q.b)/sy)-cdf((y+0.5-q.t)/sy);
          for(let x=Math.max(0,Math.floor(q.l-3*sx));x<Math.min(R,Math.ceil(q.r+3*sx));x++) {
            const f=q.mean*fy*(cdf((x+0.5-q.l)/sx)-cdf((x+0.5-q.r)/sx));
            if(f<1e-6) continue;
            const at=y*R+x; indices.push(at);values.push(f);norm+=f*f;
          }
        }
        const upper=p.maximum/brightness, strength=Math.min(1,upper);
        cols.push({indices,values,norm,upper,strength});
        for(let i=0;i<indices.length;i++)grid[indices[i]]+=values[i]*strength;
      }
      for(let pass=0;pass<35;pass++) for(const c of cols) {
        let gradient=0;
        for(let i=0;i<c.indices.length;i++)gradient+=c.values[i]*(wanted[c.indices[i]]-grid[c.indices[i]]);
        const next=clamp(c.strength+gradient/(c.norm+0.025),0.08,c.upper), delta=next-c.strength;
        c.strength=next;
        for(let i=0;i<c.indices.length;i++)grid[c.indices[i]]+=c.values[i]*delta;
      }
      proposals.forEach((p,i)=>p.strength=cols[i].strength);
    }
    for (const p of proposals) {
      let k = Math.max(p.kmin,Math.sqrt(p.rate / (brightness*(p.strength||1)))), facet;
      // Bound the convex quadric sag between zero and its extreme corner sag.
      // The resulting prism is inside the convex envelope; a containing ball
      // stays outside the LED clearance. No optical ray intersection is needed.
      for (let attempt = 0; attempt < 35; attempt++, k *= 1.12) {
        const P = p.c.P, di = V.dist(P, p.Z) / (1 + k), fq = RF.Geo.facetQuadric(P, L, p.Z, di);
        const A = fq.A, b = fq.b, normal = p.normal;
        const quad = (x,y) => x[0]*(A[0]*y[0]+A[1]*y[1]+A[2]*y[2])+x[1]*(A[3]*y[0]+A[4]*y[1]+A[5]*y[2])+x[2]*(A[6]*y[0]+A[7]*y[1]+A[8]*y[2]);
        const sag = d => {
          const rr = RF.U.quadRoots(quad(normal,normal),2*quad(d,normal)+V.dot(b,normal),quad(d,d)+V.dot(b,d));
          if (!rr.length) return null;
          const h = rr.reduce((a,b) => Math.abs(a)<Math.abs(b)?a:b);
          return V.madd(V.add(P,d),normal,h);
        };
        const ds = p.offsets.map(d=>V.mul(d,1/k)), pts3 = ds.map(sag);
        let valid = pts3.every(Boolean);
        if(valid) {
          const heights=pts3.map((q,i)=>V.dot(V.sub(q,V.add(P,ds[i])),normal));
          const low=Math.min(0,...heights), high=Math.max(0,...heights);
          const radius=Math.hypot(Math.max(...ds.map(V.len)),Math.max(-low,high));
          if(p.c.r-radius<keep+1e-4)valid=false;
          for(const d of ds)for(const h of [low,high])if(!RF.Geo.envInside(env,V.madd(V.add(P,d),normal,h)))valid=false;
        }
        if(!valid) continue;
        facet={type:'facet',id:'R'+surfaces.length,P:P.slice(),S0:L.slice(),Z:p.Z,flat:false,di,clip:{kind:'poly',pts3},optics:{interaction:'reflect',reflectivity:input.limits.reflectivity,twoSided:false}};
        break;
      }
      if(facet) { surfaces.push(facet); intent.push({facet:facet.id,cells:p.q.cells}); }
      else intent.push({facet:null,cells:p.q.cells});
    }
    for(let i=n;i<count;i++) intent.push({facet:null,cells:regions[i].cells});
    notes.push('Static rectangular paint decomposition and finite-conjugate curved mirrors; no traced rays.');
    notes.push(surfaces.length+' mirrors; '+count+' paint regions; rear-array pitch '+du.toFixed(2)+' × '+dv.toFixed(2)+' mm.');
    notes.push('Analytical balancing '+settings.balance+'; brightness '+brightness.toExponential(3)+'.');
    return {surfaces,intent,notes};
  }
  RF.Solvers.register({id:'patch-array',name:'Patch array',version:'1.0',modes:['paint'],settings:[
    {key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:0.5,default:0},
    {key:'fill',label:'Array fill',type:'range',min:0.2,max:0.95,step:0.05,default:0.95},
    {key:'inset',label:'Boundary inset / pitch',type:'range',min:0.1,max:1,step:0.1,default:0.4},
    {key:'brightnessQuantile',label:'Collection level',type:'range',min:0,max:0.8,step:0.05,default:0.2},
    {key:'balance',label:'Analytical source blur compensation',type:'checkbox',default:true}
  ],solve});
})();

/* Optional bounded tuner. The static solver above is preserved byte-for-byte. */
(function () {
  'use strict';
  const base = RF.Solvers.get('patch-array');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  RF.Solvers.register({
    id: 'patch-array-auto', name: 'Patch array — auto', version: '1.0', modes: ['paint'],
    settings: [
      {key:'minDistance',label:'Min facet distance (mm)',type:'number',min:0,step:0.5,default:0},
      {key:'goal',label:'Optimization goal',type:'select',options:['faithful','throw','efficient'],default:'faithful'}
    ],
    async solve(input, settings, tools) {
      const start = {...RF.Solvers.defaults(base), minDistance:settings.minDistance || 0};
      const baseline = base.solve(input, start);
      const budget = tools.budget || {}, rayLimit = Math.min(20000000, Math.max(0, budget.rays === undefined ? 20000000 : budget.rays));
      const goal = ['faithful','throw','efficient'].includes(settings.goal) ? settings.goal : 'faithful';
      const fallback = reason => ({...baseline, notes:[...baseline.notes, 'Auto: '+reason+'; returned unchanged static defaults.']});
      if (!baseline.surfaces.length || !input.paint.cells.some(w=>w>0)) return fallback('no feasible baseline mirrors or no paint');
      // Deterministic work allocation. Do not choose an output based on wall-clock
      // timing: identical inputs and budgets should produce identical geometry.
      if (rayLimit < 250000 || (budget.ms !== undefined && budget.ms < 1000)) return fallback('insufficient tuning budget');
      // 12 screening traces + at most 5 final traces = 17 calls, 9.8m rays normally.
      const scale = Math.min(1, rayLimit / 9800000);
      const screenRays = Math.floor(400000 * scale), finalRays = Math.floor(1000000 * scale);
      const seed = input.seed | 0, trials = [], seen = new Set();
      let raysUsed = 0, rejected = 0;
      const verificationScene = {
        source:input.source, target:input.target,
        envelope:{...input.envelope,keepOut:Math.max(input.envelope.keepOut||0,start.minDistance)},
        modeA:{budget:input.limits.maxFacets}
      };
      const valid = output => {
        const f = RF.Solvers.verify(verificationScene,output);
        return !f.errors.length && !f.intentErrors.length && !f.violations.envelope.length && !f.violations.keepOut.length && !f.violations.budget &&
          output.surfaces.every(s=>s.optics.reflectivity===input.limits.reflectivity);
      };
      const compact = report => ({
        fidelity:report.fidelity ? report.fidelity.fidelity : 0,
        within:report.fidelity ? report.fidelity.within : 0,
        gapsDark:report.fidelity ? report.fidelity.gapsDark : 0,
        onPaint:report.fidelity ? report.fidelity.onPaint : 0,
        peakCd:report.peakCd || 0, peakNoise:report.peakNoise || 0
      });
      // Watch solve (display only): show each measured candidate with the trace it already has, at most once a
      // second.  Reads out/r only, so the result is the same with or without previews.
      let lastShow = 0;
      const show = (out, r, label) => {
        if (!tools || !tools.preview || tools.preview.none) return;
        const t = Date.now(); if (t - lastShow < 1000) return; lastShow = t;
        try { tools.preview(out.surfaces, { label, trace: r, note: 'auto-tuner candidate (static settings), traced' }); } catch (e) { /* display only */ }
      };
      const measure = async (out, rays, label) => {
        raysUsed += rays;
        const r = await tools.trace(out.surfaces,{rays,seed});
        if(tools.progress)tools.progress(Math.min(0.98,raysUsed/(12*screenRays+5*finalRays)));
        show(out, r, label);
        return compact(r);
      };
      const add = async (change, output) => {
        const chosen = RF.Solvers.sanitize(base,{...start,...change});
        const key = JSON.stringify(chosen);
        if(seen.has(key)) return; seen.add(key);
        const out = output || base.solve(input,chosen);
        if(!out.surfaces.length || !valid(out)){rejected++;return;}
        const report = await measure(out,screenRays,'screen '+(trials.length+1));
        trials.push({index:trials.length,settings:chosen,output:out,screen:report});
      };
      await add({},baseline);
      if(!trials.length) return fallback('baseline failed verification');
      const rMax = Math.max(...baseline.surfaces.map(s=>RF.V.dist(s.P,input.source.pos)));
      const candidates = [
        {brightnessQuantile:0.1},{brightnessQuantile:0.3},{brightnessQuantile:0.45},{brightnessQuantile:0.65},
        {inset:0.15},{inset:0.75},{fill:0.75},
        {minDistance:Math.max(start.minDistance,0.55*rMax)},
        {minDistance:Math.max(start.minDistance,0.75*rMax)}
      ];
      for(const c of candidates)await add(c);
      const baselineLight = Math.max(1e-12,trials[0].screen.onPaint);
      const quality = r => r.fidelity * Math.min(1,r.onPaint/(0.25*baselineLight));
      const merit = r => quality(r) + (goal==='faithful' ? 0 : 0.035*Math.log2(Math.max(1e-12,
        goal==='throw' ? r.peakCd/Math.max(1e-12,trials[0].screen.peakCd) : r.onPaint/baselineLight)));
      const ranked = [...trials].sort((a,b)=>merit(b.screen)-merit(a.screen)||a.index-b.index);
      const center = ranked[0].settings;
      // A small local refinement, not an unbounded Cartesian sweep.
      for(const d of [-0.05,0.05])await add({...center,brightnessQuantile:clamp(center.brightnessQuantile+d,0,0.8)});
      // Always remeasure baseline. Preserve both high-fidelity finalists and the
      // best collection/peak alternatives, rather than comparing unlike ray counts.
      const finalists = new Set([trials[0]]);
      [...trials].sort((a,b)=>quality(b.screen)-quality(a.screen)||a.index-b.index).slice(0,2).forEach(t=>finalists.add(t));
      for(const key of ['onPaint','peakCd']) {
        const best = [...trials].sort((a,b)=>b.screen[key]-a.screen[key]||a.index-b.index)[0];
        finalists.add(best);
      }
      { let fi = 0; for(const t of finalists)t.final=await measure(t.output,finalRays,'finalist '+(++fi)+'/'+finalists.size); }
      const list = [...finalists], reference = trials[0].final;
      const credible = list.filter(t=>t.final.onPaint>=0.25*reference.onPaint);
      const bestF = Math.max(...credible.map(t=>t.final.fidelity));
      let winner;
      if(goal==='faithful') {
        winner = credible.sort((a,b)=>b.final.fidelity-a.final.fidelity||a.index-b.index)[0];
        // Tiny apparent improvements are sampling noise, not a reason to move.
        if(winner.final.fidelity-reference.fidelity<0.004)winner=trials[0];
      } else {
        const eligible=credible.filter(t=>t.final.fidelity>=bestF-0.04);
        const utility=t=>goal==='efficient' ? t.final.onPaint : t.final.peakCd/(1+t.final.peakNoise);
        winner=eligible.sort((a,b)=>utility(b)-utility(a)||a.index-b.index)[0];
      }
      if(tools.progress)tools.progress(1);
      const tuning = {goal,seed,screenRays,finalRays,raysUsed,traceCalls:trials.length+finalists.size,rejected,
        selected:winner.settings,baseline:reference,selectedReport:winner.final,
        trials:trials.map(t=>({settings:t.settings,screen:t.screen,...(t.final?{final:t.final}:{})}))};
      return {...winner.output,tuning,notes:[
        'Auto '+goal+': '+trials.length+' candidates, '+finalists.size+' finalists, '+raysUsed+' rays; same seed '+seed+' throughout.',
        'Selected static settings '+JSON.stringify(winner.settings),
        'Finalist fidelity '+(reference.fidelity*100).toFixed(2)+'% → '+(winner.final.fidelity*100).toFixed(2)+'%; '+finalRays+' rays each.',
        ...winner.output.notes
      ]};
    }
  });
})();
})();
