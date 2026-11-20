/* Static angular-aperture reflector.  No rays are traced during design. */
RF.Solvers.register({
  id: 'bench-gpt6sol-flex--angular-paint', name: 'Angular paint reflector', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Minimum LED distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'aperture', label: 'Aperture fill (0 = adaptive)', type: 'number', min: 0, max: 0.98, step: 0.01, default: 0 },
    { key: 'depth', label: 'Envelope depth', type: 'range', min: 0.3, max: 0.9, step: 0.01, default: 0.76 },
    { key: 'focus', label: 'Image focus factor (-1 = adaptive, 0 = flat)', type: 'number', min: -1, max: 2, step: 0.05, default: -1 },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, S = input.source.pos, env = input.envelope;
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const axis = V.norm(input.source.axis || [0, 0, 1]);
    const e = V.basis(axis), T = RF.Engine.designFrame(input.target);
    const res = input.paint.res, paint = input.paint.cells;
    const weights = [], cumulative = []; let total = 0;
    for (let k = 0; k < paint.length; k++) if (paint[k] > 0) {
      weights.push(k); total += paint[k]; cumulative.push(total);
    }
    if (!total) return { surfaces: [], intent: [], notes: ['Empty paint.'] };
    let minI = res, maxI = 0, minJ = res, maxJ = 0;
    for (const cell of weights) { const i = cell % res, j = Math.floor(cell/res);
      minI = Math.min(minI,i); maxI = Math.max(maxI,i); minJ = Math.min(minJ,j); maxJ = Math.max(maxJ,j); }
    const width = Math.max(maxI-minI+1,maxJ-minJ+1)*input.target.size/res;
    const available = Math.max(...env.half) * 0.8;
    const ledSize = Math.max(input.source.w || 1, input.source.h || 1, (input.source.radius || 0)*2);
    const detail = width / Math.max(1,ledSize*input.target.distance/available);
    const aperture = settings.aperture > 0 ? settings.aperture : (detail > 3.7 ? 0.55 : 0.87);
    const focus = settings.focus >= 0 ? settings.focus : (detail > 3.7 ? 0.1 : 1);
    const cap = input.limits.maxFacets, n = Math.max(2, Math.ceil(Math.sqrt(cap * 4 / Math.PI) / 0.76));
    const step = 2 / n, candidates = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = -1 + (i + 0.5) * step, v = -1 + (j + 0.5) * step;
      if (u*u + v*v > 0.87*0.87) continue;
      const dir = V.norm(V.add(V.mul(axis, Math.sqrt(Math.max(0, 1-u*u-v*v))), V.add(V.mul(e[0], u), V.mul(e[1], v))));
      const interval = Geo.envInterval(env, S, dir);
      if (!interval || interval[1] <= keep + 2) continue;
      const r = Math.max(keep + 1.5, (Math.max(keep,interval[0]) + (interval[1] - Math.max(keep,interval[0])) * settings.depth));
      if (r >= interval[1] - 0.5) continue;
      candidates.push({ u, v, dir, r });
    }
    const surfaces = [], intent = [], count = Math.min(cap, candidates.length);
    // Weighted Lloyd relaxation distributes equal-flux LED patches across the whole painting,
    // instead of stacking patches on a few rows of the inverse CDF.
    const aims = [];
    for (let k = 0; k < count; k++) {
      const q = (k + 0.5) * total / count;
      let lo = 0, hi = cumulative.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cumulative[m] < q) lo = m + 1; else hi = m; }
      const cell = weights[lo];
      aims.push([cell % res + 0.5, Math.floor(cell / res) + 0.5]);
    }
    for (let it = 0; it < 12; it++) {
      const sx = new Float64Array(count), sy = new Float64Array(count), sw = new Float64Array(count);
      for (const cell of weights) {
        const x = cell % res + 0.5, y = Math.floor(cell / res) + 0.5, w = paint[cell];
        let best = 0, bd = Infinity;
        for (let k = 0; k < count; k++) {
          const d = (x-aims[k][0])**2 + (y-aims[k][1])**2;
          if (d < bd) { bd = d; best = k; }
        }
        sx[best] += x*w; sy[best] += y*w; sw[best] += w;
      }
      for (let k = 0; k < count; k++) if (sw[k]) {
        aims[k][0] = sx[k]/sw[k]; aims[k][1] = sy[k]/sw[k];
      }
    }
    for (let k = 0; k < count; k++) {
      const a = candidates[Math.floor((k + 0.5) * candidates.length / count)], ci = aims[k][0], cj = aims[k][1];
      const cell = (Math.max(0,Math.min(res-1, Math.floor(cj))) * res + Math.max(0,Math.min(res-1,Math.floor(ci))));
      const uv = [(-0.5 + ci/res) * 2*T.half, (-0.5 + cj/res) * 2*T.half];
      const Z = RF.Engine.targetUVtoWorld(T, uv[0], uv[1]);
      const P = V.madd(S, a.dir, a.r), bisector = V.add(V.neg(a.dir), V.norm(V.sub(Z, P)));
      if (V.len(bisector) < 0.15) continue; // unusably grazing mirror
      const normal = V.norm(bisector);
      const sources = input.sources || [input.source];
      const clear = p => sources.every(src => V.dist(p, src.pos) > (src === sources[0] ? keep : (env.keepOut || 0)) + 0.4);
      if (!clear(P)) continue;
      const pts = [];
      for (const [dx, dy] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
        const u = a.u + dx*step*aperture/2, v = a.v + dy*step*aperture/2;
        if (u*u + v*v >= 0.999) break;
        const d = V.norm(V.add(V.mul(axis, Math.sqrt(1-u*u-v*v)), V.add(V.mul(e[0], u), V.mul(e[1], v))));
        const den = V.dot(d, normal);
        if (Math.abs(den) < 0.04) break;
        pts.push(V.madd(S, d, V.dot(V.sub(P,S), normal)/den));
      }
      if (pts.length !== 4 || !pts.every(p => Geo.envInside(env,p) && clear(p))) continue;
      const id = 'F' + k;
      const facet = { type: 'facet', id, P, S0: S.slice(), Z, flat: focus === 0,
        di: focus === 0 ? null : V.dist(Z,P) * focus, clip: { kind: 'poly', pts3: pts },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } };
      // The curved surface can sag outside a box even when its tangent-plane aperture fits.
      // Test the real quadric outline, then retract the aperture if necessary.
      let fits = false;
      for (let t = 0; t < 9; t++) {
        const G = Geo.compile([facet]);
        fits = Geo.outline(G, 0).every(poly => {
          if (!poly.every(p => Geo.envInside(env,p) && clear(p))) return false;
          const center = poly.reduce((a,p) => V.add(a,p),[0,0,0]).map(x => x/poly.length);
          for (const src of sources) {
            const radius = src === sources[0] ? keep : (env.keepOut || 0);
            for (let i = 0; i < poly.length; i++) {
              const p = poly[i], next = poly[(i+1)%poly.length];
              for (let a = 0; a <= 4; a++) for (let b = 0; a+b <= 4; b++) {
                const q = V.add(center,V.add(V.mul(V.sub(p,center),a/4), V.mul(V.sub(next,center),b/4)));
                const d = V.norm(V.sub(q,src.pos));
                const hit = Geo.intersect(G.D,G.poly,0,...src.pos,...d,1e-9,Infinity);
                if (hit >= 0 && hit < radius + 0.2) return false;
              }
            }
          }
          return true;
        });
        if (fits) break;
        facet.clip.pts3 = facet.clip.pts3.map(p => V.add(P, V.mul(V.sub(p,P),0.82)));
      }
      if (!fits) continue;
      surfaces.push(facet);
      intent.push({ facet: id, cells: [[cell, 1]] });
    }
    return { surfaces, intent, notes: ['Static equal-angular-area apertures; ' + surfaces.length + ' facets.'] };
  },
});

/* Optional trace-driven selector. The registered solver above remains purely static. */
RF.Solvers.register({
  id: 'bench-gpt6sol-flex--angular-paint-auto', name: 'Angular paint reflector (auto)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Minimum LED distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Tuning goal', type: 'select', options: [
      { value: 'faithful', label: 'Faithful painting' },
      { value: 'throw', label: 'Throw (subject to fidelity)' },
      { value: 'efficient', label: 'Efficiency (subject to fidelity)' },
    ], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-gpt6sol-flex--angular-paint');
    const defaults = Object.assign({}, RF.Solvers.defaults(base), { minDistance: settings.minDistance });
    // All candidates use identical ray indices and seed; only geometry changes.
    const variations = [
      {}, { aperture: 0.55, focus: 0.1 }, { aperture: 0.7, focus: 0.15 },
      { aperture: 0.87, focus: 0.1 }, { aperture: 0.87, focus: 1 },
      { aperture: 0.55, focus: 1 },
    ];
    const choices = variations.map(v => { const cfg = Object.assign({}, defaults, v);
      return { settings: cfg, output: base.solve(input, cfg) }; });
    if (!tools || !tools.trace) return choices[0].output;
    const seed = input.seed || 0;
    for (const c of choices) {
      const r = tools.trace(c.output.surfaces, { rays: 300000, seed });
      c.f = r.fidelity ? r.fidelity.fidelity : 0;
      c.flux = r.fidelity ? r.fidelity.onPaint : 0;
      c.peak = r.peakCd || 0;
    }
    const bestF = Math.max(...choices.map(c => c.f));
    const goal = settings.goal || 'faithful';
    // Throw/efficiency must retain a meaningful painting. Use the fidelity-first
    // candidate as a safe fallback whenever the threshold has no other takers.
    const eligible = choices.filter(c => c.f >= Math.max(0.42, bestF - (goal === 'faithful' ? 0.025 : 0.075)));
    if (!eligible.length) eligible.push(choices.reduce((a,b) => b.f > a.f ? b : a));
    const metric = c => goal === 'throw' ? c.peak : goal === 'efficient' ? c.flux : c.f + 0.12*c.flux;
    let chosen = eligible[0];
    for (const c of eligible.slice(1)) if (metric(c) > metric(chosen) + (goal === 'faithful' ? 0.008 : 0)) chosen = c;
    chosen.output.notes.push('Auto ' + goal + ': selected aperture ' + chosen.settings.aperture +
      ', focus ' + chosen.settings.focus + ' after ' + choices.length + ' common-seed traces (' +
      (100*chosen.f).toFixed(1) + '% pilot fidelity).');
    return chosen.output;
  },
});
