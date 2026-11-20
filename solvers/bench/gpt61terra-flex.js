/* Flux: static, image-forming micro-reflector array. */
(function () {
  'use strict';
  RF.Solvers.register({
    id: 'bench-gpt61terra-flex--mosaic-static', name: 'Image mosaic', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'height', label: 'Array height fraction', type: 'range', min: 0.3, max: 0.95, step: 0.05, default: 0.7 },
      { key: 'extent', label: 'Array width fraction', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.6 },
      { key: 'aperture', label: 'Facet fill', type: 'range', min: 0.2, max: 1, step: 0.05, default: 1 },
      { key: 'focus', label: 'Focus distance factor', type: 'range', min: 0.2, max: 2, step: 0.1, default: 1 },
      { key: 'spread', label: 'Aim spread', type: 'range', min: 0.5, max: 1.5, step: 0.05, default: 1 },
      { key: 'balance', label: 'Analytic image balance', type: 'range', min: 0, max: 100, step: 10, default: 100 },
    ],
    solve(input, settings) {
      const V = RF.V, Geo = RF.Geo, src = input.source, env = input.envelope, L = src.pos;
      const paint = input.paint, N = paint.res, cells = paint.cells, T = RF.Engine.designFrame(input.target);
      const cap = Math.max(0, Math.floor(input.limits.maxFacets));
      const out = [], intent = [], keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
      if (!cap || !cells || !cells.length) return { surfaces: out, intent };
      let total = 0, cx = 0, cy = 0;
      const cumulative = [];
      for (let k = 0; k < N * N; k++) {
        const w = Math.max(0, +cells[k] || 0); total += w;
        cx += w * (k % N + 0.5); cy += w * (Math.floor(k / N) + 0.5);
        cumulative.push(total);
      }
      if (!total) return { surfaces: out, intent };
      cx /= total; cy /= total;
      const f = RF.Source.frame(src), axis = f.a;
      // A plane transverse to the source axis, safely inset from the envelope.
      const intv = Geo.envInterval(env, L, axis), reach = intv[1];
      if (!(reach > keep + 1) || !isFinite(reach)) return { surfaces: out, intent, notes: ['No room above source clearance.'] };
      // Use the paraboloid r - dot(r, throw) = c: neighbouring mirrors follow a
      // common parent surface, rather than overlapping and blocking their own output.
      const throwDir = V.norm(V.sub(T.C, L));
      let up = V.sub(axis, V.mul(throwDir, V.dot(axis, throwDir)));
      if (V.len(up) < 1e-6) up = V.basis(throwDir)[0];
      up = V.norm(up);
      const side = V.norm(V.cross(throwDir, up));
      const c = reach * (settings.height || 0.8);
      const z0 = Math.max(keep * 1.1, reach * 0.16), z1 = reach * 0.9;
      const lateral = Math.min(reach, Math.max(...env.half)) * (settings.extent || 0.7);
      if (!(z1 > z0)) return { surfaces: out, intent, notes: ['Clearance leaves no usable array.'] };
      const nx = Math.min(cap, Math.max(1, Math.round(Math.sqrt(cap * 2 * lateral / Math.max(1e-6, z1-z0)))));
      const ny = Math.max(1, Math.floor(cap / nx));
      const dx = 2 * lateral / nx, dy = (z1-z0) / ny;
      const parab = (y,z) => V.add(L, V.add(V.mul(throwDir, (y*y+z*z-c*c)/(2*c)), V.add(V.mul(side,y), V.mul(up,z))));
      const halton = (i, base) => { let f = 1, x = 0; while (i) { f /= base; x += f * (i % base); i = Math.floor(i / base); } return x; };
      // Weighted quantiles of the raster; a low discrepancy sequence avoids regular banding.
      function sample(q) {
        let lo = 0, hi = cumulative.length - 1, value = q * total;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cumulative[m] < value) lo = m + 1; else hi = m; }
        return lo;
      }
      const count = nx * ny;
      for (let k = 0; k < count && out.length < cap; k++) {
        const ix = k % nx, iy = Math.floor(k / nx);
        const y = (ix + 0.5 - nx / 2) * dx, z = z0 + (iy + 0.5) * dy;
        const P = parab(y, z);
        if (!Geo.envInside(env, P)) continue;
        const cell = sample(halton(k + 1, 2)), spread = settings.spread || 1;
        const px = cx + ((cell % N + halton(k + 1, 3)) - cx) * spread;
        const py = cy + ((Math.floor(cell / N) + halton(k + 1, 5)) - cy) * spread;
        const uv = [(px / N - 0.5) * 2 * T.half, (py / N - 0.5) * 2 * T.half];
        const Z = RF.Engine.targetUVtoWorld(T, uv[0], uv[1]);
        const bisector = V.add(V.norm(V.sub(L, P)), V.norm(V.sub(Z, P)));
        if (V.len(bisector) < 0.2) continue;
        const n = V.norm(bisector);
        const ap = settings.aperture || 0.7;
        // Project parent-paraboloid cell corners onto this facet's tangent plane.
        const corner = (yy,zz) => { const p = parab(yy,zz), d = V.sub(p,P); return V.add(P, V.sub(d,V.mul(n,V.dot(n,d)))); };
        let pts = [corner(y-dx*ap/2,z-dy*ap/2),corner(y+dx*ap/2,z-dy*ap/2),corner(y+dx*ap/2,z+dy*ap/2),corner(y-dx*ap/2,z+dy*ap/2)];
        let radius = Math.max(...pts.map(p => V.dist(P,p))) * 1.35;
        const id = 'm' + k, di = V.dist(P, Z) * (settings.focus || 1);
        // Conservative enclosing ball includes tilt and curvature sag.  Shrink rather than
        // allowing a surface (not just its tangent outline) to touch a constraint.
        const safe = r => {
          if ((input.sources || [src]).some(s => V.dist(P, s.pos) < keep + r + 0.1)) return false;
          for (let x of [-1, 1]) for (let y of [-1, 1]) for (let z of [-1, 1])
            if (!Geo.envInside(env, [P[0] + x*r, P[1] + y*r, P[2] + z*r])) return false;
          return true;
        };
        for (let t = 0; t < 20 && (!safe(radius) || radius > V.dist(P,L)*0.25); t++) { pts = pts.map(p => V.add(P,V.mul(V.sub(p,P),0.75))); radius *= 0.75; }
        if (!safe(radius) || radius > V.dist(P,L)*0.25 || radius < 0.15) continue;
        out.push({ type: 'facet', id, P, S0: L, Z, di, flat: false, clip: { kind: 'poly', pts3: pts }, optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity } });
        const intentCell = Math.min(input.target.res-1,Math.floor((cell % N)*input.target.res/N)) + input.target.res*Math.min(input.target.res-1,Math.floor(Math.floor(cell/N)*input.target.res/N));
        intent.push({ facet: id, cells: [[intentCell, 1]] });
      }
      // Analytic irradiance balancing, not ray tracing. Linearise the source image at
      // each mirror centre and approximate its rectangular footprint by a Gaussian.
      // Move image centres down the residual gradient of a coarse paint raster.
      const rounds = settings.balance == null ? 50 : settings.balance;
      if (rounds && out.length) {
        const R = Math.min(50, N), step = 2*T.half/R, target = new Float64Array(R*R);
        for (let j=0;j<R;j++) for(let i=0;i<R;i++) {
          const x0=Math.floor(i*N/R), x1=Math.floor((i+1)*N/R), y0=Math.floor(j*N/R), y1=Math.floor((j+1)*N/R);
          let s=0, m=0; for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){s+=Math.max(0,+cells[y*N+x]||0);m++;} target[j*R+i]=s/Math.max(1,m);
        }
        const fr = RF.Source.frame(src), work = [];
        let weightSum=0, paintSum=0; for(const v of target) paintSum+=v;
        for (const s of out) {
          const P=s.P, d=V.norm(V.sub(P,L)), a=V.norm(V.sub(s.Z,P)), n=V.norm(V.sub(a,d));
          const poly=s.clip.pts3, area=V.len(V.cross(V.sub(poly[1],poly[0]),V.sub(poly[3],poly[0])));
          const dist=V.dist(P,L), intensity=RF.Source.intensity(src, Math.acos(Math.max(-1,Math.min(1,V.dot(d,axis)))));
          const weight=area*Math.abs(V.dot(n,d))*intensity/(dist*dist);
          if (!(weight>0)) continue;
          const t=V.dist(P,s.Z), den=V.dot(T.n,a);
          if (Math.abs(den)<1e-6) continue;
          function imageVec(b, size) {
            const incoming=V.mul(V.sub(b,V.mul(d,V.dot(d,b))), -1/dist);
            const reflected=V.sub(incoming,V.mul(n,2*V.dot(incoming,n)));
            const hit=V.mul(V.sub(reflected,V.mul(a,V.dot(T.n,reflected)/den)),t*size/step);
            return [V.dot(hit,T.tu),V.dot(hit,T.tv)];
          }
          const sw=src.kind==='point'?0:(src.shape==='rect'?src.w:2*(src.radius||1));
          const sh=src.kind==='point'?0:(src.shape==='rect'?src.h:2*(src.radius||1));
          const u=imageVec(fr.u,sw||0), v=imageVec(fr.v,sh||0);
          const variance=src.shape==='rect'?1/12:1/16;
          const xx=(u[0]*u[0]+v[0]*v[0])*variance+0.35, xy=(u[0]*u[1]+v[0]*v[1])*variance, yy=(u[1]*u[1]+v[1]*v[1])*variance+0.35;
          const det=xx*yy-xy*xy, uv=RF.Engine.worldToTargetUV(T,s.Z);
          work.push({s,weight,x:uv[0]/step+R/2,y:uv[1]/step+R/2, xx,xy,yy, invx:yy/det,invy:xx/det,invxy:-xy/det, norm:1/(2*Math.PI*Math.sqrt(det)), rad:Math.min(R,Math.ceil(3.5*Math.sqrt(Math.max(xx,yy))))});
          weightSum+=weight;
        }
        const scale=weightSum/Math.max(1e-9,paintSum), pred=new Float64Array(R*R);
        const visit=(w,fn)=> {
          const x0=Math.max(0,Math.floor(w.x-w.rad)), x1=Math.min(R-1,Math.ceil(w.x+w.rad));
          const y0=Math.max(0,Math.floor(w.y-w.rad)), y1=Math.min(R-1,Math.ceil(w.y+w.rad));
          for(let j=y0;j<=y1;j++) for(let i=x0;i<=x1;i++) {
            const dx=i+0.5-w.x,dy=j+0.5-w.y, q=w.invx*dx*dx+2*w.invxy*dx*dy+w.invy*dy*dy;
            if(q<14) fn(j*R+i, w.norm*Math.exp(-q/2),dx,dy);
          }
        };
        for(let iter=0;iter<rounds;iter++) {
          pred.fill(0);
          for(const w of work) visit(w,(k,g)=>{pred[k]+=w.weight*g/scale;});
          for(const w of work) {
            let gx=0,gy=0,sum=0;
            visit(w,(k,g,dx,dy)=> { const e=target[k]-pred[k]; gx+=g*e*dx; gy+=g*e*dy; sum+=g; });
            if(sum>0) { const rate=0.65/sum; w.x+=Math.max(-0.7,Math.min(0.7,gx*rate)); w.y+=Math.max(-0.7,Math.min(0.7,gy*rate)); }
          }
        }
        for(const w of work) {
          w.s.Z=RF.Engine.targetUVtoWorld(T,(w.x-R/2)*step,(w.y-R/2)*step);
          const ii=Math.max(0,Math.min(input.target.res-1,Math.floor(w.x/R*input.target.res)));
          const jj=Math.max(0,Math.min(input.target.res-1,Math.floor(w.y/R*input.target.res)));
          const it=intent.find(a=>a.facet===w.s.id); if(it) it.cells=[[jj*input.target.res+ii,1]];
        }
      }
      // Check the actual quadratic sag after aiming.  Bound it inside a safe ball
      // about P, including samples throughout the aperture, and shrink if necessary.
      // No rays are traced: localSag evaluates the surface equation directly.
      for (let k=out.length-1;k>=0;k--) {
        const s=out[k]; let valid=false;
        for(let attempt=0;attempt<12;attempt++) {
          const ball=Math.max(...s.clip.pts3.map(p=>V.dist(p,s.P)))*1.5;
          const sourceOK=(input.sources||[src]).every(q=>V.dist(q.pos,s.P)>=keep+ball+0.1);
          let envOK=true;
          for(let x of [-1,1]) for(let y of [-1,1]) for(let z of [-1,1]) if(!Geo.envInside(env,[s.P[0]+x*ball,s.P[1]+y*ball,s.P[2]+z*ball])) envOK=false;
          let sagOK=sourceOK && envOK;
          if(sagOK) {
            const C=Geo.compile([s]), D=C.D, ex=[D[3],D[4],D[5]], ey=[D[6],D[7],D[8]];
            const uv=s.clip.pts3.map(p=>{const q=V.sub(p,s.P); return [V.dot(q,ex),V.dot(q,ey)];});
            const mx=Math.max(...uv.map(p=>Math.abs(p[0]))), my=Math.max(...uv.map(p=>Math.abs(p[1])));
            for(let i=-4;i<=4 && sagOK;i++) for(let j=-4;j<=4;j++) {
              const x=mx*i/4,y=my*j/4,z=Geo.localSag(D,0,x,y);
              if(!isFinite(z) || Math.hypot(x,y,z)>ball*0.97) { sagOK=false; break; }
            }
          }
          if(sagOK) {valid=true;break;}
          s.clip.pts3=s.clip.pts3.map(p=>V.add(s.P,V.mul(V.sub(p,s.P),0.7)));
        }
        if(!valid) {out.splice(k,1); intent.splice(k,1);}
      }
      return { surfaces: out, intent, notes: ['Static source-image mosaic; analytic footprint balancing.'] };
    }
  });

  // Separately registered trace-driven selector; the static solver above never
  // calls tracing. Every candidate uses the same seed for common random numbers.
  RF.Solvers.register({
    id: 'bench-gpt61terra-flex--mosaic-auto', name: 'Image mosaic auto', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful' }, { value: 'throw', label: 'Throw' }, { value: 'efficient', label: 'Efficient' }
      ] },
    ],
    solve(input, settings, tools) {
      const def = RF.Solvers.get('bench-gpt61terra-flex--mosaic-static');
      const base = RF.Solvers.defaults(def);
      base.minDistance = settings.minDistance || 0;
      const variants = [
        {},
        { height: 0.9, extent: 0.55 },
        { height: 0.6, extent: 0.8 },
        { height: 0.8, extent: 0.45 },
      ];
      const budget = tools.budget || {}, rayBudget = Number.isFinite(budget.rays) ? budget.rays : 2e7;
      const msBudget = Number.isFinite(budget.ms) ? budget.ms : 60000;
      const rays = Math.floor(Math.min(180000, rayBudget / 8, msBudget * 28));
      const fallback = () => def.solve(input, base, tools);
      if (rays < 2000 || msBudget < 5000) return fallback();
      const seed = input.seed || 1, candidates = [];
      for (const v of variants) {
        const params = Object.assign({}, base, v), output = def.solve(input, params, tools);
        try {
          const trace = tools.trace(output.surfaces, { rays, seed });
          if (trace.fidelity) candidates.push({ params, output, trace });
        } catch (_) { break; }
      }
      if (!candidates.length) return fallback();
      // Ratios to the first design supply scale-independent proxies, not the
      // unavailable official reference. Fidelity remains the first objective.
      const reference = candidates[0].trace;
      const onRef = Math.max(1e-9, reference.fidelity.onPaint || 0);
      const peakRef = Math.max(1e-9, reference.peakCd || 0);
      function merit(t) {
        const f = t.fidelity, light = Math.min(1, (f.onPaint || 0) / (0.1 * onRef));
        const F = (f.fidelity || 0) * light, gate = Math.max(0, Math.min(1, (F - 0.5) / 0.25));
        const flux = Math.min(2, (f.onPaint || 0) / onRef) / 2;
        const peak = Math.min(2, (t.peakCd || 0) / peakRef) / 2;
        const goal = settings.goal || 'faithful';
        const bonus = goal === 'throw' ? 0.22 * peak : goal === 'efficient' ? 0.22 * flux : 0.04 * (0.7 * flux + 0.3 * peak);
        return F + gate * bonus;
      }
      candidates.sort((a,b) => merit(b.trace) - merit(a.trace));
      const finalists = candidates.slice(0, 2);
      for (const c of finalists) {
        try { c.refined = tools.trace(c.output.surfaces, { rays: rays * 2, seed }); c.refinedRays = rays * 2; }
        catch (_) { c.refined = c.trace; c.refinedRays = rays; }
      }
      finalists.sort((a,b) => merit(b.refined) - merit(a.refined));
      const best = finalists[0];
      best.output.notes = (best.output.notes || []).concat([
        'Auto: ' + (settings.goal || 'faithful') + ', height ' + best.params.height + ', extent ' + best.params.extent +
        '; sampled fidelity ' + (100 * best.refined.fidelity.fidelity).toFixed(1) + '% at ' + best.refinedRays + ' rays.'
      ]);
      return best.output;
    },
  });
})();
