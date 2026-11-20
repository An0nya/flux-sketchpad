/* Static paint solver: a deterministic bank of small, individually aimed imaging facets. */
RF.Solvers.register({
  id: 'bench-gpt6luna-flex--paint-imager', name: 'Paint imager (static)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'radialFraction', label: 'Position toward envelope rim', type: 'range', min: 0.35, max: 0.95, step: 0.05, default: 0.65 },
    { key: 'aperture', label: 'Facet aperture scale', type: 'range', min: 0.25, max: 2, step: 0.05, default: 0.5 },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, src = input.source, S = src.pos;
    const env = input.envelope, paint = input.paint, lim = input.limits;
    const sources = input.sources && input.sources.length ? input.sources : [src];
    const cap = Math.max(0, lim.maxFacets | 0), keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const surfaces = [], intent = [];
    if (!cap || !paint || !paint.cells || !paint.cells.length) return { surfaces, intent };
    const srcFrame = RF.Source.frame(src), thetaMax = RF.Source.thetaMax(src);
    const T = RF.Engine.designFrame(input.target), R = paint.res | 0, ncell = R * R;
    const weights = new Array(ncell), cum = new Array(ncell);
    let total = 0;
    for (let i = 0; i < ncell; i++) { const w = Math.max(0, +paint.cells[i] || 0); weights[i] = w; total += w; cum[i] = total; }
    if (!(total > 0)) return { surfaces, intent };
    const chooseCell = (q) => {
      let lo = 0, hi = ncell - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < q) lo = m + 1; else hi = m; }
      if (weights[lo] > 0) return lo;
      for (let i = lo + 1; i < ncell; i++) if (weights[i] > 0) return i;
      for (let i = lo - 1; i >= 0; i--) if (weights[i] > 0) return i;
      return lo;
    };
    const targetPoint = (k) => {
      // Stratified sampling of paint energy, with a low-discrepancy offset inside each selected cell.
      const cell = chooseCell((k + 0.5) * total / cap);
      const i = cell % R, j = Math.floor(cell / R), step = 2 * T.half / R;
      const fract = (x) => x - Math.floor(x);
      const du = (fract((k + 1) * 0.6180339887498949) - 0.5) * 0.72;
      const dv = (fract((k + 1) * 0.7548776662466927) - 0.5) * 0.72;
      const u = -T.half + (i + 0.5 + du) * step, v = -T.half + (j + 0.5 + dv) * step;
      return { p: RF.Engine.targetUVtoWorld(T, u, v), cell };
    };
    // A conservative sphere around the complete patch must fit both the envelope and LED clearance.
    const margin = (P) => {
      const c = env.center, h = env.half, d = P.map((x, i) => x - c[i]);
      if (env.shape === 'box') return Math.min(h[0] - Math.abs(d[0]), h[1] - Math.abs(d[1]), h[2] - Math.abs(d[2]));
      if (env.shape === 'ellipsoid') {
        const q = Math.sqrt((d[0]/h[0])**2 + (d[1]/h[1])**2 + (d[2]/h[2])**2);
        return Math.max(0, (1 - q) * Math.min(h[0], h[1], h[2]));
      }
      const ax = env.axis === undefined ? 2 : env.axis, a = (ax + 1) % 3, b = (ax + 2) % 3;
      return Math.min(h[ax] - Math.abs(d[ax]), (1 - Math.sqrt((d[a]/h[a])**2 + (d[b]/h[b])**2)) * Math.min(h[a], h[b]));
    };
    // Stratify by emitted power (I(theta) sin(theta) dtheta), rather than solid angle alone;
    // this avoids spending many facets on very weak directions of a peaked/planar LED.
    const cdfN = 512, cdf = new Float64Array(cdfN + 1);
    let cdfTotal = 0, prev = 0;
    for (let j = 1; j <= cdfN; j++) {
      const th = thetaMax * j / cdfN;
      const val = RF.Source.intensity(src, th) * Math.sin(th);
      cdfTotal += (prev + val) * 0.5 * thetaMax / cdfN;
      cdf[j] = cdfTotal; prev = val;
    }
    const angleAt = (q) => {
      const goal = q * cdfTotal;
      let lo = 0, hi = cdfN;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < goal) lo = m + 1; else hi = m; }
      const j = Math.max(1, lo), a = cdf[j - 1], b = cdf[j];
      return thetaMax * ((j - 1) + (b > a ? (goal - a) / (b - a) : 0)) / cdfN;
    };
    // Golden-angle azimuths and a slight radial jitter avoid a single ring.
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < cap; k++) {
      const theta = angleAt((k + 0.5) / cap);
      const cosTheta = Math.cos(theta), phi = k * golden, st = Math.sin(theta);
      const dir = V.norm([
        cosTheta * srcFrame.a[0] + st * (Math.cos(phi) * srcFrame.u[0] + Math.sin(phi) * srcFrame.v[0]),
        cosTheta * srcFrame.a[1] + st * (Math.cos(phi) * srcFrame.u[1] + Math.sin(phi) * srcFrame.v[1]),
        cosTheta * srcFrame.a[2] + st * (Math.cos(phi) * srcFrame.u[2] + Math.sin(phi) * srcFrame.v[2]),
      ]);
      if (!(RF.Source.intensity(src, theta) > 0)) continue;
      const interval = Geo.envInterval(env, S, dir);
      const t0 = Math.max(0, interval[0], keep + 1e-4), t1 = interval[1];
      if (!(t1 > t0 + 0.1)) continue;
      const requestedFraction = Number.isFinite(+settings.radialFraction) ? +settings.radialFraction : 0.65;
      const frac = Math.max(0.1, Math.min(0.98, requestedFraction));
      const t = t0 + (t1 - t0) * (frac + 0.025 * Math.sin(k * 2.399963229728653));
      const P = V.madd(S, dir, t), pick = targetPoint(k), Z = pick.p;
      const aim = V.norm(V.sub(Z, P)), toSource = V.norm(V.sub(S, P));
      const normal = V.norm(V.add(aim, toSource));
      if (!Number.isFinite(normal[0])) continue;
      // Tangent basis. The paint's horizontal axis is the preferred facet axis.
      let ex0 = T.tu, ex = V.sub(ex0, V.mul(normal, V.dot(ex0, normal)));
      if (V.len(ex) < 1e-7) { ex0 = T.tv; ex = V.sub(ex0, V.mul(normal, V.dot(ex0, normal))); }
      ex = V.norm(ex);
      const room = margin(P);
      let sourceRoom = Infinity;
      for (const emitter of sources) sourceRoom = Math.min(sourceRoom, V.dist(P, emitter.pos) - keep);
      const di = V.dist(P, Z), focusScale = Math.max(1e-3, Math.min(t, di));
      // Aperture radius budget accounts for curvature sag as well as the outline. It is clipped
      // by both the local envelope margin and the real LED clearance of every emitter.
      const requestedAperture = Number.isFinite(+settings.aperture) ? +settings.aperture : 0.5;
      let h = Math.min(5.5 * requestedAperture, room / 1.55, sourceRoom / 1.55, 0.1 * focusScale);
      if (!(h > 0.08)) continue;
      let fits = false;
      for (let tries = 0; tries < 12; tries++) {
        const rad = Math.SQRT2 * h + 2 * h * h / focusScale;
        if (rad < room * 0.995 && rad < sourceRoom * 0.995) { fits = true; break; }
        h *= 0.8;
      }
      if (!fits || !(h > 0.06)) continue;
      const id = 'F' + surfaces.length;
      const cells = [[pick.cell, Math.max(1e-6, weights[pick.cell])]];
      surfaces.push({
        type: 'facet', id, P, S0: S.slice(), Z, flat: false, di,
        clip: { kind: 'rect', hx: h, hy: h, ref: ex },
        optics: { interaction: 'reflect', reflectivity: lim.reflectivity, twoSided: false },
      });
      intent.push({ facet: id, cells });
    }
    return { surfaces, intent, notes: ['Static stratified imaging facets; no trace/search performed in solve().'] };
  },
});

/* Optional trace-guided tuner. The static solver above remains independently usable and trace-free. */
RF.Solvers.register({
  id: 'bench-gpt6luna-flex--paint-imager-auto', name: 'Paint imager (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Tuning goal', type: 'select', options: [
      { value: 'faithful', label: 'Faithful pattern' },
      { value: 'throw', label: 'More light on paint' },
      { value: 'efficient', label: 'Quality/output balance' },
    ], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-gpt6luna-flex--paint-imager');
    const minDistance = +settings.minDistance || 0;
    const goal = settings.goal || 'faithful';
    let candidates;
    if (goal === 'throw') candidates = [[0.50, 0.80], [0.65, 0.65], [0.50, 0.50]];
    else if (goal === 'efficient') candidates = [[0.65, 0.35], [0.80, 0.35], [0.65, 0.50]];
    else candidates = [[0.65, 0.50], [0.50, 0.50], [0.75, 0.35]];
    if (!tools || typeof tools.trace !== 'function' || !base) {
      return base ? base.solve(input, { minDistance, radialFraction: 0.65, aperture: 0.5 }) : { surfaces: [], intent: [] };
    }
    const rayLimit = Math.max(1, (tools.budget && tools.budget.rays) || 90000);
    const candidateCount = Math.min(candidates.length, Math.max(1, Math.floor(rayLimit / 1000)));
    candidates = candidates.slice(0, candidateCount);
    const rays = Math.max(1, Math.min(30000, Math.floor(rayLimit / candidates.length)));
    let best = null;
    for (let i = 0; i < candidates.length; i++) {
      const [radialFraction, aperture] = candidates[i];
      const output = base.solve(input, { minDistance, radialFraction, aperture });
      let trace;
      try { trace = tools.trace(output.surfaces, { rays, seed: input.seed }); }
      catch (_) { continue; }
      const f = trace && trace.fidelity || {};
      const fidelity = Math.max(0, +f.fidelity || 0), onPaint = Math.max(0, +f.onPaint || 0);
      let value;
      if (goal === 'throw') value = onPaint;
      else if (goal === 'efficient') value = fidelity * Math.sqrt(Math.max(0.01, onPaint));
      else value = fidelity;
      if (!best || value > best.value + 1e-9) best = { output, value, fidelity, onPaint, radialFraction, aperture };
    }
    if (!best) best = { output: base.solve(input, { minDistance, radialFraction: 0.65, aperture: 0.5 }), radialFraction: 0.65, aperture: 0.5, fidelity: 0, onPaint: 0 };
    best.output.notes = (best.output.notes || []).concat([
      'Auto goal ' + goal + ' selected radialFraction=' + best.radialFraction + ', aperture=' + best.aperture +
      ' (pilot fidelity ' + (best.fidelity || 0).toFixed(3) + ', onPaint ' + (best.onPaint || 0).toFixed(3) + ').',
    ]);
    return best.output;
  },
});
