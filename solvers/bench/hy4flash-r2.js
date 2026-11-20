/* Static paint solver.  No ray tracing: the geometry is computed from the scene, the LED and the paint.
 *
 * Idea: the smallest image a mirror at distance r can make is the LED's angular size times the throw.
 * Blur the painting by that kernel (that is the best a perfect design could look like), quantise the
 * blurred painting into one spot per available facet, and build an ellipsoid that images the LED onto
 * each spot.  Facet area sets how much flux goes to that spot: peak intensity = R·L·A·cos, hence
 * A ∝ desired_illuminance × throw² / (luminance·cos).
 */
(function () {
  'use strict';
  const V = RF.V, Geo = RF.Geo, Eng = RF.Engine, Ph = RF.Photometry;

  function lcg(seed) { let s = (seed | 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; }; }

  // ---- candidate mirror sites: a plane behind the LED, inside the envelope.  Keeping every facet in
  // one plane normal to the throw axis means reflected beams leave the array without crossing another
  // facet, so no facet shadows its neighbours (the main loss of a boundary-scattered layout).
  function candidates(env, S, axis, keep, rLo, rHi, minCt) {
    const c = env.center, h = env.half, out = [];
    const xmin = c[0] - h[0], xmax = c[0] + h[0], span = xmax - xmin;
    const d = Math.max(keep + 3, 0.11 * span);
    let x = S[0] - d;
    if (x < xmin + 0.06 * span) x = Math.min(xmax - 0.06 * span, S[0] + d);
    const a = V.norm(axis), grid = 16;
    for (let iy = 0; iy < grid; iy++) for (let iz = 0; iz < grid; iz++) {
      const p = [x, c[1] + (2 * (iy + 0.5) / grid - 1) * h[1] * 0.92,
                    c[2] + (2 * (iz + 0.5) / grid - 1) * h[2] * 0.92];
      const q = V.sub(p, S), r = V.len(q);
      if (!(r > rLo && r < rHi)) continue;
      if (V.dot(V.mul(q, 1 / r), a) < minCt) continue;
      if (!Geo.envInside(env, p, -0.001) || r < keep + 2) continue;
      out.push({ P: p, r, ct: V.dot(V.mul(q, 1 / r), a) });
    }
    return out;
  }

  // Pick sites: near the wanted LED distance, spread out in space.
  function pickSites(cands, n, rWant, seed, S, env, spread) {
    const rng = lcg(seed), chosen = [];
    if (!cands.length) return chosen;
    const weight = (q) => {
      const s = Math.log(Math.max(1.05, q.r) / Math.max(1.05, rWant));
      const ahead = Math.max(0, q.P[0] - S[0]) / Math.max(1, env.half[0]);
      return Math.exp(-0.5 * (s / spread) ** 2) * (0.35 + 0.65 * q.ct) * Math.exp(-0.5 * (ahead / 0.12) ** 2);
    };
    // start from the best candidate, then farthest-point sample in 3D with a distance preference
    let best = 0; for (let i = 1; i < cands.length; i++) if (weight(cands[i]) > weight(cands[best])) best = i;
    chosen.push(cands[best]);
    const spacing = Math.max(6, Math.sqrt(4200 / Math.max(1, n)) * 0.9);
    while (chosen.length < n && chosen.length < cands.length) {
      let bi = -1, bs = -Infinity;
      for (let i = 0; i < cands.length; i++) {
        const q = cands[i]; let taken = false, near = Infinity;
        for (const p of chosen) { const d = V.dist(p.P, q.P); if (d < 0.4 * spacing) { taken = true; break; } if (d < near) near = d; }
        if (taken) continue;
        const sep = Math.min(1, near / spacing);
        const s = weight(q) * (0.25 + 0.75 * sep) * (0.75 + 0.25 * rng());
        if (s > bs) { bs = s; bi = i; }
      }
      if (bi < 0) break;
      chosen.push(cands[bi]);
    }
    return chosen;
  }

  // ---- weighted clustering of the blurred painting into one spot per facet
  function clusters(paint, R, T, n, cell) {
    const pts = [];
    for (let k = 0; k < R * R; k++) if (paint[k] > 1e-4) {
      const i = k % R, j = (k / R) | 0;
      pts.push({ u: -T.half + (i + 0.5) * cell, v: -T.half + (j + 0.5) * cell, w: paint[k], k });
    }
    if (!pts.length) return [];
    n = Math.min(n, pts.length);
    const centers = [];
    let first = 0; for (let i = 1; i < pts.length; i++) if (pts[i].w > pts[first].w) first = i;
    centers.push({ u: pts[first].u, v: pts[first].v });
    const d2 = pts.map((p) => (p.u - centers[0].u) ** 2 + (p.v - centers[0].v) ** 2);
    while (centers.length < n) {
      let bi = -1, bs = -1;
      for (let i = 0; i < pts.length; i++) { const s = pts[i].w * pts[i].w * d2[i]; if (s > bs) { bs = s; bi = i; } }
      if (bi < 0) break;
      centers.push({ u: pts[bi].u, v: pts[bi].v });
      for (let i = 0; i < pts.length; i++) d2[i] = Math.min(d2[i], (pts[i].u - pts[bi].u) ** 2 + (pts[i].v - pts[bi].v) ** 2);
    }
    const asg = new Int32Array(pts.length).fill(-1);
    for (let pass = 0; pass < 7; pass++) {
      const su = new Float64Array(n), sv = new Float64Array(n), sw = new Float64Array(n);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]; let bi = 0, bd = Infinity;
        for (let j = 0; j < centers.length; j++) { const d = (p.u - centers[j].u) ** 2 + (p.v - centers[j].v) ** 2; if (d < bd) { bd = d; bi = j; } }
        asg[i] = bi; su[bi] += p.u * p.w; sv[bi] += p.v * p.w; sw[bi] += p.w;
      }
      for (let j = 0; j < centers.length; j++) if (sw[j] > 0) { centers[j].u = su[j] / sw[j]; centers[j].v = sv[j] / sw[j]; }
    }
    const out = centers.map((c) => ({ u: c.u, v: c.v, w: 0, n: 0, cells: [] }));
    for (let i = 0; i < pts.length; i++) { const o = out[asg[i]]; o.w += pts[i].w; o.n++; o.cells.push(pts[i].k); }
    return out.filter((o) => o.n > 0);
  }

  // Image of the extended LED on the target: a ray from an LED point offset e sees its transverse
  // component rotated by the mirror, then multiplied by throw / LED distance.  Returns full box
  // widths in target cells along the target's u and v axes.
  function imageWidths(P, S, Z, frame, source, cell) {
    const q = V.norm(V.sub(P, S)), sh = V.neg(q), ah = V.norm(V.sub(Z, P)), nrm = V.norm(V.add(sh, ah));
    const r = V.dist(P, S), di = V.dist(P, Z), fr = RF.Source.frame(source);
    let edges;
    if (source.kind === 'planar') edges = source.shape === 'disc'
      ? [[V.mul(fr.u, 2 * source.radius), 1], [V.mul(fr.v, 2 * source.radius), 1]]
      : [[V.mul(fr.u, source.w), 1], [V.mul(fr.v, source.h), 1]];
    else if (source.shape === 'cylinder') edges = [[V.mul(fr.a, source.length), 1], [V.mul(V.basis(fr.a)[0], 2 * source.radius), 1]];
    else edges = [[V.mul(fr.u, 2 * source.radius), 1], [V.mul(fr.v, 2 * source.radius), 1]];
    let du = 0, dv = 0;
    for (const e of edges) {
      const E = e[0], perp = V.sub(E, V.mul(q, V.dot(E, q)));
      const refl = V.sub(perp, V.mul(nrm, 2 * V.dot(perp, nrm)));
      du += Math.abs(V.dot(refl, frame.tu)) * di / r;
      dv += Math.abs(V.dot(refl, frame.tv)) * di / r;
    }
    return [Math.max(0.5, Math.min(60, du / cell)), Math.max(0.5, Math.min(60, dv / cell))];
  }

  // Fit nonnegative facet amplitudes to the blurred painting with a linear (no-tracing) overlap model.
  function fitAmplitudes(spec, paint, R, iterations) {
    const model = new Float64Array(R * R), entries = spec.map((f) => {
      const out = [], i0 = Math.max(0, Math.floor(f.cu - f.wu / 2)), i1 = Math.min(R - 1, Math.ceil(f.cu + f.wu / 2));
      const j0 = Math.max(0, Math.floor(f.cv - f.wv / 2)), j1 = Math.min(R - 1, Math.ceil(f.cv + f.wv / 2));
      const ax = (i) => Math.max(0, Math.min(i + 0.5, f.cu + f.wu / 2) - Math.max(i - 0.5, f.cu - f.wu / 2));
      const ay = (j) => Math.max(0, Math.min(j + 0.5, f.cv + f.wv / 2) - Math.max(j - 0.5, f.cv - f.wv / 2));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const w = ax(i) * ay(j); if (w > 1e-6) out.push([j * R + i, w]);
      }
      return out;
    });
    const a = spec.map((f) => f.e0), floor = 1e-3;
    const mean0 = a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const lo = 0.08 * mean0, hi = 5 * mean0;
    for (let it = 0; it < iterations; it++) {
      model.fill(0);
      for (let k = 0; k < entries.length; k++) for (const [idx, w] of entries[k]) model[idx] += a[k] * w;
      for (let k = 0; k < entries.length; k++) {
        let num = 0, den = 0;
        for (const [idx, w] of entries[k]) { num += w * paint[idx] / Math.max(floor, model[idx]); den += w * w; }
        if (den > 0) a[k] = Math.max(lo, Math.min(hi, a[k] * (num / den)));
      }
    }
    return a;
  }

  // largest centred rectangle at P in the mirror plane that stays in the envelope and clear of the LED
  function fitClip(env, S, P, ex, ey, h, keep) {
    const at = (a, b) => [P[0] + ex[0] * a + ey[0] * b, P[1] + ex[1] * a + ey[1] * b, P[2] + ex[2] * a + ey[2] * b];
    let lo = 0, hi = h;
    for (let it = 0; it < 12; it++) {
      const m = 0.5 * (lo + hi); let ok = true;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const q = at(sx * m, sy * m);
        if (!Geo.envInside(env, q, -0.002) || V.dist(q, S) < keep + 1.2) { ok = false; break; }
      }
      if (ok) lo = m; else hi = m;
    }
    return Math.max(0.3, lo);
  }

  RF.Solvers.register({
    id: 'bench-hy4flash-r2--static-map', name: 'Static paint map', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'blur', label: 'Paint blur scale', type: 'range', min: 0.3, max: 2, step: 0.1, default: 1 },
      { key: 'coverage', label: 'Spot coverage', type: 'range', min: 0.5, max: 5, step: 0.1, default: 1.8 },
      { key: 'fill', label: 'Aperture fill', type: 'range', min: 0.02, max: 0.8, step: 0.02, default: 0.22 },
      { key: 'spread', label: 'Distance spread', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.42 },
      { key: 'shield', label: 'Block direct LED light', type: 'checkbox', default: true },
      { key: 'active', label: 'Facet budget used', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.6 },
      { key: 'adaptive', label: 'Fewer facets for a blurry LED', type: 'checkbox', default: false },
    ],
    solve(input, settings) {
      const env = input.envelope, S = input.source.pos.slice(), T = input.target, R = input.paint.res;
      const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
      const cell = T.size / R, frame = Eng.targetFrame(T);
      const srcLike = { source: input.source, envelope: env, target: T };
      const ker = Ph.achievableKernel(srcLike).cells * (+settings.blur || 1);
      const adapt = settings.adaptive ? Math.max(0.5, Math.min(1, 1 - 0.1 * Math.max(0, ker - 1))) : 1;
      const N = Math.max(1, Math.round(input.limits.maxFacets * (+settings.active || 1) * adapt));
      const paint = Ph.boxBlur(Float64Array.from(input.paint.cells), R, ker);
      let support = 0, mx = 0; for (let k = 0; k < R * R; k++) if (paint[k] > 1e-4) { support++; mx = Math.max(mx, paint[k]); }
      if (!support || !(mx > 0)) return { surfaces: [], intent: [{ facet: null, cells: [] }], notes: ['empty painting'] };
      const spots = clusters(paint, R, frame, N, cell);
      let n = spots.length;

      // spot size in target cells → mirror distance from the LED (image = LED × throw / r)
      let led = input.source.kind === 'planar' ? (input.source.shape === 'disc' ? 2 * input.source.radius : Math.min(input.source.w, input.source.h))
        : input.source.shape === 'cylinder' ? Math.min(2 * input.source.radius, input.source.length) : 2 * input.source.radius;
      const wCells = Math.max(0.8, Math.max(ker, Math.sqrt((+settings.coverage) * support / Math.max(1, n))));
      const rWant = Math.max(keep + 4, led * T.distance / Math.max(0.5, wCells * cell));
      let cands = candidates(env, S, V.norm(input.source.axis), keep, keep + 2, 1e5, 0.16);
      if (cands.length < 2 * n) cands = candidates(env, S, V.norm(input.source.axis), keep, keep + 2, 1e5, 0.02);
      if (!cands.length) return { surfaces: [], intent: [{ facet: null, cells: [] }], notes: ['no legal mirror sites'] };
      let rMax = 0; for (const q of cands) rMax = Math.max(rMax, q.r);
      const sites = pickSites(cands, n, Math.min(rWant, rMax), (input.seed | 0) + 17, S, env, +settings.spread || 0.42);
      if (!sites.length) return { surfaces: [], intent: [{ facet: null, cells: [] }], notes: ['no legal sites after spacing'] };
      if (sites.length < n) { n = sites.length; spots.length = n; }

      // one optical footprint per facet; fit their amplitudes to the blurred painting
      const spec = [];
      for (let i = 0; i < n; i++) {
        const c = spots[i], P = sites[Math.min(i, sites.length - 1)].P;
        const Z = Eng.targetUVtoWorld(frame, c.u, c.v);
        const [wu, wv] = imageWidths(P, S, Z, frame, input.source, cell);
        spec.push({ P, Z, wu, wv,
          cu: (c.u + frame.half) / cell - 0.5, cv: (c.v + frame.half) / cell - 0.5,
          e0: c.w / Math.max(1, c.n) });
      }
      const amp = fitAmplitudes(spec, paint, R, 20);
      const raw = [];
      for (let i = 0; i < n; i++) {
        const { P, Z } = spec[i];
        const sh = V.norm(V.sub(S, P)), ah = V.norm(V.sub(Z, P));
        const ci = Math.max(0.2, Math.sqrt(Math.max(0, 0.5 * (1 + V.dot(sh, ah)))));
        const L = Ph.luminance(input.source, sh), Lv = isFinite(L) && L > 0 ? L : 1;
        raw.push(amp[i] * V.dist(Z, P) ** 2 / Math.max(1e-9, Lv * ci));
      }
      // total aperture: a fraction of the envelope's projected silhouette
      const uProj = V.norm(V.sub(frame.C, S));
      let silhouette = 0;
      if (env.shape === 'box') silhouette = Math.abs(uProj[0]) * 4 * env.half[1] * env.half[2] + Math.abs(uProj[1]) * 4 * env.half[0] * env.half[2] + Math.abs(uProj[2]) * 4 * env.half[0] * env.half[1];
      else silhouette = Math.PI * (env.half[0] * env.half[1] + env.half[1] * env.half[2] + env.half[0] * env.half[2]) * 0.5;
      let sum = 0; for (const x of raw) sum += x;
      const total = silhouette * (+settings.fill || 0.22);
      const gain = sum > 0 ? total / sum : 1;
      const surfaces = [], intent = [], notes = [];
      // A free absorbing baffle in front of the LED: direct light crosses the target at high v (the LED
      // points up), while the reflected beams leave the high facets almost horizontally well above it.
      if (settings.shield) {
        const xMax = env.center[0] + env.half[0];
        let L = Math.max(keep + 1.5, 5);
        if (S[0] + L > xMax - 2) L = Math.max(1.5, xMax - 2 - S[0]);
        if (L > keep + 0.8) {
          const zh = Math.max(1.5, L * T.size / (2 * Math.max(1, T.distance)) + 1.0);
          let yh = env.half[1] * 0.99, x = S[0] + L, zlo = S[2] - zh, zhi = S[2] + zh;
          const pt = (y, z) => [x, env.center[1] + y, z];
          for (let it = 0; it < 40; it++) {
            const ok = [[-yh, zlo], [yh, zlo], [yh, zhi], [-yh, zhi]].every(([y, z]) => Geo.envInside(env, pt(y, z), -0.002));
            if (ok) break;
            yh *= 0.97;
            zlo += (env.center[2] - zlo) * 0.04; zhi += (env.center[2] - zhi) * 0.04;
          }
          if (yh > 1 && zhi - zlo > 0.2) surfaces.push({ type: 'plane', id: 'BAFFLE', P: [x, env.center[1], (zlo + zhi) / 2], n: [-1, 0, 0],
            clip: { kind: 'poly', pts3: [pt(-yh, zlo), pt(yh, zlo), pt(yh, zhi), pt(-yh, zhi)] },
            optics: { interaction: 'absorb' } });
          intent.push({ facet: 'BAFFLE', cells: [] });
        }
      }
      for (let i = 0; i < n; i++) {
        const c = spots[i], P = spec[i].P, Z = spec[i].Z;
        const sh = V.norm(V.sub(S, P)), ah = V.norm(V.sub(Z, P));
        const nrm = V.norm(V.add(sh, ah));
        const ex = V.inPlane(nrm, frame.tv), ey = V.cross(nrm, ex);
        let area = Math.max(1, Math.min(raw[i] * gain, total * 4 / n));
        let h = Math.sqrt(area) / 2;
        h = fitClip(env, S, P, ex, ey, h, keep);
        const id = 'F' + i;
        surfaces.push({ type: 'facet', id, group: 'A', P: P.slice(), S0: S.slice(), Z,
          di: V.dist(P, Z), flat: false,
          clip: { kind: 'rect', hx: h, hy: h, ref: ex },
          optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } });
        intent.push({ facet: id, cells: c.cells.map((k) => [k, Math.max(1e-6, paint[k])]) });
      }
      notes.push(n + ' ellipsoidal facets; blur ' + ker.toFixed(2) + ' cells; r ' + rWant.toFixed(1) + ' mm; mean area ' + (surfaces.reduce((a, s) => a + (s.type === 'facet' ? 4 * s.clip.hx * s.clip.hy : 0), 0) / Math.max(1, n)).toFixed(1) + ' mm²');
      return { surfaces, intent, notes };
    },
  });

  // ---------------------------------------------------------------- optional trace-driven tuner
  // Same geometry engine as above; only the *choice* of settings uses tools.trace.  All candidates
  // are traced with the same seed, so a difference in score is a difference in geometry, not dice.
  const TRIALS = [
    { active: 0.35, fill: 0.12, coverage: 1.2, blur: 1.0 },
    { active: 0.45, fill: 0.22, coverage: 1.8, blur: 1.0 },
    { active: 0.50, fill: 0.12, coverage: 2.8, blur: 0.8 },
    { active: 0.60, fill: 0.12, coverage: 1.8, blur: 1.0 },
    { active: 0.60, fill: 0.22, coverage: 1.2, blur: 1.0 },
    { active: 0.60, fill: 0.22, coverage: 1.8, blur: 0.8 },
    { active: 0.60, fill: 0.22, coverage: 1.8, blur: 1.0 },
    { active: 0.60, fill: 0.22, coverage: 1.8, blur: 1.3 },
    { active: 0.60, fill: 0.22, coverage: 2.8, blur: 1.0 },
    { active: 0.60, fill: 0.35, coverage: 1.8, blur: 1.0 },
    { active: 0.80, fill: 0.35, coverage: 2.8, blur: 1.2 },
    { active: 0.80, fill: 0.50, coverage: 2.8, blur: 1.0 },
    { active: 1.00, fill: 0.22, coverage: 1.8, blur: 1.0 },
    { active: 1.00, fill: 0.50, coverage: 1.8, blur: 1.0 },
    { active: 0.80, fill: 0.70, coverage: 2.8, blur: 1.0 },
    { active: 1.00, fill: 0.70, coverage: 1.8, blur: 1.0 },
  ];
  function goalScore(goal, out, tr, maxFacets) {
    const f = tr && tr.fidelity, fid = f ? f.fidelity : 0, onPaint = f ? f.onPaint : 0;
    const lit = Math.min(1, onPaint / 0.01);                  // do not reward a black design
    const reach = Math.min(1, onPaint / 0.08);
    const placed = (out.surfaces || []).filter((q) => (q.optics && q.optics.interaction || 'reflect') === 'reflect').length;
    if (goal === 'throw') return lit * (0.25 * fid + 0.75 * Math.log10(1 + (tr ? tr.peakCd : 0)) / 6);
    if (goal === 'efficient') return fid * lit * (0.4 + 0.6 * reach) * (1 - 0.65 * placed / Math.max(1, maxFacets));
    return fid * lit + 0.02 * fid * reach;                     // faithful
  }

  RF.Solvers.register({
    id: 'bench-hy4flash-r2--static-map-auto', name: 'Static paint map (tuned)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: [
        { value: 'faithful', label: 'Faithful' }, { value: 'throw', label: 'Throw' }, { value: 'efficient', label: 'Efficient' } ], default: 'faithful' },
      { key: 'rays', label: 'Rays per trial', type: 'range', min: 20000, max: 200000, step: 10000, default: 60000 },
    ],
    solve(input, settings, tools) {
      const base = RF.Solvers.get('bench-hy4flash-r2--static-map');
      const goal = settings.goal === 'throw' || settings.goal === 'efficient' ? settings.goal : 'faithful';
      const maxFacets = input.limits.maxFacets, seed = input.seed | 0;
      const fallback = Object.assign(RF.Solvers.defaults(base), goal === 'throw'
        ? { active: 1, fill: 0.5, coverage: 2.8 } : goal === 'efficient'
        ? { active: 0.45, fill: 0.12, coverage: 1.8 } : {}, { minDistance: settings.minDistance });
      if (!base || !tools || typeof tools.trace !== 'function')
        return base ? base.solve(input, fallback, tools) : { surfaces: [], intent: [], notes: ['static solver missing'] };

      const trials = [];
      const budgetRays = Math.max(20000, Math.min(200000, +settings.rays || 60000));
      for (let i = 0; i < TRIALS.length; i++) {
        const cfg = Object.assign(RF.Solvers.defaults(base), TRIALS[i], { minDistance: settings.minDistance });
        let out;
        try { out = base.solve(RF.U.deepCopy(input), cfg, tools); } catch (e) { continue; }
        if (!out || !out.surfaces || !out.surfaces.length) continue;
        let tr = null;
        try { tr = tools.trace(out.surfaces, { rays: budgetRays, seed }); }
        catch (e) { break; }                                   // ray budget exhausted: keep what we have
        trials.push({ cfg, out, tr, score: goalScore(goal, out, tr, maxFacets) });
        if (tools.progress) tools.progress(0.1 + 0.7 * (i + 1) / TRIALS.length);
      }
      if (!trials.length) {
        const out = base.solve(input, fallback, tools);
        out.notes = (out.notes || []).concat(goal + ': no successful trace; used static defaults');
        return out;
      }
      trials.sort((a, b) => b.score - a.score);
      const shortlist = trials.slice(0, Math.min(3, trials.length));
      for (const t of shortlist) {
        try {
          const tr = tools.trace(t.out.surfaces, { rays: budgetRays * 4, seed });
          t.score = goalScore(goal, t.out, tr, maxFacets); t.tr = tr;
          t.rays = budgetRays * 4;
        } catch (e) { t.rays = budgetRays; }
        if (tools.progress) tools.progress(1);
      }
      shortlist.sort((a, b) => b.score - a.score);
      const best = shortlist[0];
      const out = best.out;
      out.notes = (out.notes || []).concat(
        goal + ': traced ' + trials.length + ' geometries (' + budgetRays + ' rays each), refined ' + shortlist.length +
        ' winner ' + JSON.stringify(Object.fromEntries(['active', 'fill', 'coverage', 'blur'].map((k) => [k, best.cfg[k]]))) +
        ' refineF=' + (best.tr.fidelity ? best.tr.fidelity.fidelity.toFixed(3) : '—') +
        ' peak=' + Math.round(best.tr.peakCd || 0) + ' cd');
      return out;
    },
  });
})();
