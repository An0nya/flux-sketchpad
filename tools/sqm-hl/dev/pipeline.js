/* pipeline.js — the headlamp SQM solver's core: spec → ideal beam → aims → one continuous reflector → facets → model → corrections.
 *   RF.SqmPipe.solve(input, S, tools) → { surfaces, best, P, ... }                                                                              */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, T = RF.SqmTarget, Pl = RF.SqmPlan, C = RF.SqmCore, E = RF.SqmEmit, F = RF.SqmFwd;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const DEFAULTS = {
    N: 0, NA: 150, NAcoarse: 60, iters: 6, margin: 1.2, gd: 0.34, peakCap: 80000, washCap: 12000,
    dimFrac: 0.2, dimTile: 10, dimFill: 1.35, mainFill: 1.5, softAll: 0.22, edgeSoft: 0.2, gTarget: 0.28, slack: 1.0, step: 0.05, cutPasses: 1, sweeps: 5, maxShift: 0.6, wBand: 8, wTrack: 0.03, wEdge: 3, f0: 60, wPaint: 1.5,
  };

  // PAINT MODE (no input.spec): the target is the painting on the target plane.  A spec without rows, a window that holds the plane, and the plane's distance along the throw.
  function paintSpec(input, S) {
    const T_ = RF.Engine.designFrame(input.target), Lp = input.source.pos, hf = T_.half, conv = 'A';
    let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) { const X = V.add(T_.C, V.add(V.mul(T_.tu, a * hf), V.mul(T_.tv, b * hf))), hv = RF.FarField.hvOf(V.sub(X, Lp), conv); h0 = Math.min(h0, hv[0]); h1 = Math.max(h1, hv[0]); v0 = Math.min(v0, hv[1]); v1 = Math.max(v1, hv[1]); }
    const win = [Math.max(-85, Math.floor(h0 - 1)), Math.min(85, Math.ceil(h1 + 1)), Math.max(-85, Math.floor(v0 - 1)), Math.min(85, Math.ceil(v1 + 1))];
    const step = Math.max(0.05, Math.sqrt((win[1] - win[0]) * (win[3] - win[2]) / 3e5)), dx = V.dot(V.sub(T_.C, Lp), [1, 0, 0]);
    return { preset: 'paint', items: [], conv, kernel: Math.max(0.15, step * 1.5), step, window: win, traffic: 'RHT', measure: { distance: dx > 0 ? dx : Infinity }, aim: { mode: 'design', line: -0.57, scan: 3, box: null, itemReaim: 0 }, centre: Lp.slice(), paintMode: true };
  }
  // the painting as an intensity map T*(h, v) in cd: a painted cell wants E ∝ weight on the plane, so a ray landing there needs I = E r² / cosθ
  function paintDesign(P, capLm) {
    const g = P.g, input = P.input, T_ = RF.Engine.designFrame(input.target), res = input.paint.res, cells = input.paint.cells, fake = { target: input.target, source: input.source, modeD: { conv: P.conv } }, Lp = P.Lp;
    const raw = new Float64Array(g.n); let any = false;
    for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nh; i++) {
      const h = g.hOf(i), v = g.vOf(j), uv = RF.Spec.planeUV(fake, h, v); if (!uv) continue;
      const ci = Math.floor((uv[0] + T_.half) / (2 * T_.half) * res), cj = Math.floor((uv[1] + T_.half) / (2 * T_.half) * res); if (ci < 0 || cj < 0 || ci >= res || cj >= res) continue;
      const w = cells[cj * res + ci]; if (!(w > 0)) continue;
      const d = RF.FarField.dirOf(h, v, P.conv), cs = Math.abs(V.dot(d, T_.n)), t = V.dot(V.sub(T_.C, Lp), T_.n) / V.dot(d, T_.n), r = Math.abs(t); if (!(cs > 1e-6)) continue;
      raw[j * g.nh + i] = w * r * r / cs; any = true;
    }
    if (!any) throw new Error('nothing painted');
    const flux = (a) => { let s = 0; for (let q = 0; q < g.n; q++) s += a * raw[q] * g.om[q]; return s; }, a = P.refl * capLm * 0.97 / Math.max(1e-30, flux(1)), Tt = Float64Array.from(raw, (x) => x * a);
    return { T: Tt, alpha: a, W0: 0, flux: flux(a), leftover: 0, edge: { sv: 0, dTop: 0, G: NaN }, ev: null, road: null, glow: null, wash: null };
  }
  function problem(input, S, tools) {
    const src = input.source, env = input.envelope, refl = input.limits.reflectivity, spec = input.spec || paintSpec(input, S), conv = spec.conv || 'A';
    if (spec.paintMode) S = Object.assign(S, { step: spec.step });
    const dd = spec.measure && +spec.measure.distance, dist = dd > 0 && isFinite(dd) ? dd : Infinity;      // the host's JSON copy turns the far field (Infinity) into null
    const P = { S, input, src, env, spec, refl, conv, dist, isPaint: !!spec.paintMode, Lp: src.pos.slice(), N: S.N > 0 ? Math.min(S.N, input.limits.maxFacets) : input.limits.maxFacets, t0: Date.now(), notes: [] };
    P.lap = (s) => { if (S.verbose) console.log(`[${((Date.now() - P.t0) / 1000).toFixed(1)}s] ${s}`); };
    P.g = T.grid(spec.window, S.step, conv); P.B = T.bands(spec, P.g, { lo: S.margin, hi: S.margin });
    P.grid = F.gridOf(spec.window, S.step, conv, dist, P.Lp); P.S_ = F.sourceSamples(src, 128);
    P.rmin = Math.max(env.keepOut || 0, S.minDistance || 0) + RF.Source.boundingRadius(src) * 0.5; P.cut0 = T.cutOf(spec); P.cutShift = 0; P.cut = P.cut0;
    // the aim point of a facet at Pf toward direction d: on the measuring screen as seen from the photometric centre (finite distance: no parallax), else far away along d
    P.plane = spec.paintMode ? RF.Engine.designFrame(input.target) : null;
    P.zOf = (Pf, d) => { if (P.plane) { const den = V.dot(d, P.plane.n); if (Math.abs(den) > 1e-9) { const t = V.dot(V.sub(P.plane.C, P.Lp), P.plane.n) / den; if (t > 0) return V.add(P.Lp, V.mul(d, t)); } }
      return isFinite(dist) && d[0] > 0.05 ? V.add(P.Lp, V.mul(d, dist / d[0])) : V.add(Pf, V.mul(d, 1e6)); };
    P.aimAt = (h, v, share, tier) => { const d = RF.FarField.dirOf(h, v, conv); return { c: isFinite(dist) ? Math.max(1, V.dist(P.zOf(P.Lp, d), P.Lp)) : 1e6, ax: d[0], ay: d[1], az: d[2], g: share, h, v, tier, Z(Pf) { return P.zOf(Pf, [this.ax, this.ay, this.az]); } }; };
    return P;
  }
  const directions = (P, NA) => C.directions(P.src, P.env, { NA, margin: 0.3, rmin: P.rmin, B: RF.FarField.dirOf(0, -1, P.conv) });

  // floors that sit above the cut-off (the sign points) each need a dim unit whose image reaches them
  function floorSeeds(P) {
    const cut = P.cut; if (!cut) return []; const seeds = [];
    for (const it of P.spec.items) { const pts = it.kind === 'point' ? [[it.h, it.v]] : it.kind === 'sum' ? it.pts : null; if (!pts || !(it.min > 0)) continue; for (const [h, v] of pts) if (v > cut.top(h) + 0.3) seeds.push({ h, v, lo: it.kind === 'sum' ? it.min / it.pts.length : it.min }); }
    return seeds;
  }
  function design(P, capLm) {
    const S = P.S; if (P.cut0) { const c0 = P.cut0, sh = P.cutShift; P.cut = Object.assign({}, c0, { line: c0.line + sh, top: (h) => c0.top(h) + sh }); }
    P.des = P.isPaint ? paintDesign(P, capLm) : T.design({ spec: P.spec, g: P.g, B: P.B, fluxTarget: P.refl * capLm * 0.97, peakCap: S.peakCap, washCap: S.washCap, gd: S.gd, cut: P.cut || null, road: S.gamma !== undefined ? { gamma: S.gamma } : undefined });
    const sp = Pl.superpixels(P.g, P.des.T, 0.2), seeds = floorSeeds(P), tt = Pl.twoTier(sp, P.N, { dimFrac: S.dimFrac, dimTile: S.dimTile, reserve: seeds.length });
    P.A = tt.main.map((a) => Object.assign(P.aimAt(a.h, a.v, a.F / P.refl, 'main'), { cov: a.cov }));
    P.Ad = tt.dim.map((a) => Object.assign(P.aimAt(a.h, a.v, a.F / P.refl, 'dim'), { cov: a.cov }));
    const area = 4 * (Math.PI / 180) ** 2 * 1.4 * 1.4;
    for (const sd of seeds) { let near = Infinity; for (const a of P.Ad) near = Math.min(near, Math.hypot(a.h - sd.h, a.v - sd.v)); if (near < 1.2) continue;
      P.Ad.push(Object.assign(P.aimAt(sd.h, sd.v, Math.max(0.15, sd.lo * S.margin * 3 * area / P.refl), 'dim'), { cov: [1.0, 0, 1.0], seeded: true })); }
    P.Ad.forEach((a, k) => { a.idx = k; });
  }

  // ---------------------------------------------------------------- the reflector: sizes by optimal transport, scaled so the beam's light is what gets covered
  function balance(P, D, on, x, cold, taus) { if (cold) C.newton(D, on, P.A, x, taus || [0.1, 0.03, 0.01, 0.003, 0.001], 0.03, 30, { window: 0.08 }); else C.newton(D, on, P.A, x, taus || [0.003, 0.001], 0.03, 25, { window: 0.08 }); }
  function fitSurface(P, D, on, x, need) {
    for (let round = 0; round < 6; round++) {
      let mon = 0; for (let i = 0; i < D.n; i++) if (on[i]) mon += D.m[i];
      const share = clamp(need * P.S.slack / mon, 0.05, 0.98), f = E.fit(D, on, P.A, x, share, true);
      C.newton(D, on, P.A, x, [0.003, 0.001], 0.03, 25, { window: 0.08 });
      if (Math.abs(f.q - 1) < 0.004 && !f.dropped) break;
    }
    let cov = 0; for (let i = 0; i < D.n; i++) if (on[i]) cov += D.m[i]; return cov;
  }
  const mainNeed = (P) => P.A.reduce((s, a) => s + a.g, 0) + P.Ad.reduce((s, a) => s + a.g, 0);

  // ---------------------------------------------------------------- facets from the state
  // the geometry: one focused facet per cell set (+ the decals for the dim units), clipped to the envelope.  Fixed once the surface is solved.
  function buildBase(P, D, on, x) {
    const em = E.emitAll(D, on, P.A, x, { refl: P.refl }), as = em.assign; let facets = em.facets; facets.forEach((f) => { f.aimRef = P.A[f.aimIndex]; });
    if (P.Ad.length) { const dec = E.placeDecals(D, on, P.A, x, as, P.Ad, {}); for (const dc of dec.decals) { const f = E.decalFacet(D, on, x, P.A, as, dc, {}); if (f) { f.aimRef = dc.aim; facets.push(f); } } }
    E.clipEnvelope(facets, P.env, P.Lp, P.rmin); return facets.filter((f) => !f._dead);
  }
  const cleanFacet = (f) => { const g = { type: 'facet', id: f.id, P: f.P, S0: f.S0, Z: f.Z, flat: false, di: f.di, clip: f.clip, optics: f.optics }; if (f.vg) { g.vg = f.vg; g.ax = f.ax; } return g; };
  // the host's own envelope / clearance check (surface edges included) on the finished facets: shrink a violating facet about its centre until it passes, drop it if it never does
  function enforceEnvelope(P, facets) {
    const sceneV = { source: P.input.source, emitters: [], envelope: P.env, modeA: { budget: P.input.limits.maxFacets }, target: P.input.target };
    let fs = facets.map((f) => Object.assign({}, f)), shrunk = 0, dropped = 0;
    for (let pass = 0; pass < 6; pass++) {
      const v = RF.Solvers.verify(sceneV, { surfaces: fs.map(cleanFacet) }); if (v.errors && v.errors.length) break;
      const bad = new Set(v.violations.envelope.concat(v.violations.keepOut)); if (!bad.size) break;
      fs = fs.map((f) => { if (!bad.has(f.id)) return f; shrunk++; return Object.assign({}, f, { clip: { kind: 'poly', pts3: f.clip.pts3.map((q) => V.add(f.P, V.mul(V.sub(q, f.P), 0.92))) } }); });
    }
    const v = RF.Solvers.verify(sceneV, { surfaces: fs.map(cleanFacet) }), bad = new Set(v.violations.envelope.concat(v.violations.keepOut));
    if (bad.size) { dropped = bad.size; fs = fs.filter((f) => !bad.has(f.id)); }
    return { facets: fs, shrunk, dropped };
  }
  const naturalOf = (P, base) => F.field(base, P.S_, P.grid, { na: 24 }).fps.map((fp) => ({ cov: fp.cov, flux: fp.flux }));
  // the parameters on top of the geometry: a tilt of every facet's aim (dh, dv: nearly free, a 0.4° tilt moves a 7 mm facet's edge 0.02 mm) and the image shaping
  function realize(P, base, nat, params) {
    const cut = P.cut, es = P.S.edgeSoft, ea = P.S.softAll * P.S.softAll;
    return base.map((f, k) => {
      const a = f.aimRef, pr = params[k], h = a.h + pr.dh, v = a.v + pr.dv, d = RF.FarField.dirOf(h, v, P.conv), Z = P.zOf(f.P, d);
      const g = Object.assign({}, f, { Z, di: V.dist(f.P, Z) }), c = a.cov; if (!c || !(nat[k].flux > 0)) return g;
      const fill = a.tier === 'dim' ? P.S.dimFill : P.S.mainFill, n = nat[k].cov; let want = [c[0] * fill, c[1] * fill, c[2] * fill];
      if (cut && es > 0) { const top = cut.top(a.h); if (v + 2.2 * Math.sqrt(Math.max(n[2], want[2])) > top - 0.5) want[2] = Math.max(want[2], n[2] + es * es); }
      return E.shape(g, { h, v }, [Math.max(want[0] - n[0], ea), want[1] - n[1], Math.max(want[2] - n[2], ea)], P.conv, {});
    });
  }
  // light that meets no mirror leaves along its own direction: the source's intensity there (smooth), wherever no covered cell sits
  function directField(P, D, on) {
    const grid = P.grid, Ed = new Float64Array(grid.nh * grid.nv), src = P.src, fr = D.fr, Itot = RF.Source.totalIntegral(src), NA = D.NA, NP = D.NP;
    for (let j = 0; j < grid.nv; j++) for (let i = 0; i < grid.nh; i++) {
      const u = RF.FarField.dirOf(grid.h0 + (i + 0.5) * grid.step, grid.v0 + (j + 0.5) * grid.step, P.conv), ca = clamp(V.dot(u, D.B), -1, 1), a = Math.min(NA - 1, Math.floor((1 - ca) / 2 * NA));
      let phi = Math.atan2(V.dot(u, D.e2), V.dot(u, D.e1)); if (phi < 0) phi += 2 * Math.PI; const q = Math.min(NP - 1, Math.floor(phi / (2 * Math.PI) * NP)), ci = D.cellOf[q * NA + a];
      if (ci >= 0 && on[ci]) continue;                                     // a mirror covers this direction
      const I = RF.Source.intensity(src, Math.acos(clamp(V.dot(u, fr.a), -1, 1))); if (!(I > 0)) continue;
      Ed[j * grid.nh + i] = src.power * I / Itot * grid.om[j * grid.nh + i];
    }
    return Ed;
  }
  function evaluate(P, facets, D, on) {
    const fld = F.field(facets, P.S_, P.grid, { na: 40, occlude: true }), Ed = directField(P, D, on), Et = new Float64Array(fld.E.length);
    for (let q = 0; q < Et.length; q++) Et[q] = fld.E[q] + Ed[q];
    const gj = T.judgeGrid(P.g, Et, { distance: P.dist, centre: P.Lp }), ev = RF.Spec.evaluate(gj, T.mdOf(P.spec));
    const hard = ev.rows.filter((r) => r.verdict === 'fail').length, worst = ev.rows.length ? Math.min(...ev.rows.map((r) => r.margin)) : 1;
    let score = -hard * 10 + Math.max(-3, worst);
    if (P.isPaint) { const g = P.g, f0 = P.S.f0; let c = 0, tot = 0; for (let q = 0; q < g.n; q++) { const t = P.des.T[q], f = Et[q] / g.om[q]; tot += g.om[q] * t; if (t > 0) { const a = Math.log(Math.max(f, f0)) - Math.log(Math.max(t, f0)); c += g.om[q] * t * a * a; } else if (f > f0) c += g.om[q] * 0.3 * f; } score = -c / Math.max(1e-9, tot) * 10; }
    return { fld, Ed, Et, gj, ev, hard, worst, score };
  }

  // ---------------------------------------------------------------- the correction: every unit's share moves toward what the ideal beam wants from the pixels its image covers
  function correct(P, facets, m, eta) {
    const g = P.g, byAim = new Map(); facets.forEach((f, k) => byAim.set(f.aimRef, m.fld.fps[k]));
    let pk = 0; for (let q = 0; q < g.n; q++) { const cd = P.des.T[q]; if (cd > pk) pk = cd; } const tref = Math.max(200, 0.03 * pk), w = new Float64Array(g.n);
    for (let q = 0; q < g.n; q++) { const t = Math.max(P.des.T[q], tref), cd = m.Et[q] / g.om[q]; let k = 1; if (cd < P.B.lo[q] || cd > P.B.hi[q]) k = 4; w[q] = k / (t * t); }
    for (const a of P.A.concat(P.Ad)) {
      const f = byAim.get(a); if (!f || !(f.flux > 0)) { a.g *= 1.15; continue; }
      let num = 0, den = 0; for (let k = 0; k < f.idx.length; k++) { const q = f.idx[k], b = f.val[k] / g.om[q] / f.flux; num += w[q] * b * Math.max(0, P.des.T[q] - m.Ed[q] / g.om[q]); den += w[q] * b * (m.Et[q] / g.om[q]); }
      a.g *= clamp(Math.pow(num / Math.max(den, 1e-30), eta), 0.7, 1.4);
    }
  }


  // ---------------------------------------------------------------- aim polish: slide every unit's image (and scale its light) in the MODEL to cut the violation + track the ideal beam.
  // Footprints are translation-invariant to first order, so a move is a re-indexing of a sparse array, not a re-trace.  The cost, per pixel (cd f):
  //   band:   ((lo − f)₊ / lo)² + ((f − hi)₊ / hi)²                      (a floor or ceiling of the spec, with its margin)
  //   track:  (ln max(f, f0) − ln max(T*, f0))²  where T* is the ideal beam, weighted heavily around the cut-off (the edge shape is what the judge reads there)
  function polish(P, facets, m, opt) {
    const g = P.g, nh = g.nh, nv = g.nv, n = g.n, om = g.om, fps = m.fld.fps, T_ = P.des.T, lo = P.B.lo, hi = P.B.hi;
    const wBand = opt.wBand, f0 = opt.f0, E = Float64Array.from(m.Et), cut = P.cut;
    // pixel weights for tracking: edge zone heavy, plateau light
    const wt = new Float64Array(n);
    for (let j = 0; j < nv; j++) { const v = g.vOf(j); for (let i = 0; i < nh; i++) { const q = j * nh + i; let w = opt.wTrack; if (cut) { const t = cut.top(g.hOf(i)); if (v > t - 1.4 && v < t + 1.6) w = opt.wEdge; } wt[q] = w; } }
    const costPx = (q, e) => { const f = e / om[q]; let c = 0; if (lo[q] > 0 && f < lo[q]) { const d = (lo[q] - f) / lo[q]; c += wBand * d * d; } if (hi[q] < Infinity && f > hi[q]) { const d = (f - hi[q]) / hi[q]; c += wBand * d * d; }
      const a = Math.log(Math.max(f, f0)) - Math.log(Math.max(T_[q], f0)); return c + wt[q] * a * a; };
    // each unit: its sparse footprint in (i, j) bins, its current shift in bins, its share multiplier
    const U = facets.map((f, k) => { const fp = fps[k], ii = new Int32Array(fp.idx.length), jj = new Int32Array(fp.idx.length); for (let t = 0; t < fp.idx.length; t++) { jj[t] = (fp.idx[t] / nh) | 0; ii[t] = fp.idx[t] - jj[t] * nh; } return { f, ii, jj, val: fp.val, di: 0, dj: 0, k: 1, aim: f.aimRef }; });
    const mark = new Int32Array(n).fill(-1), delta = new Float64Array(n); let stamp = 0;
    const trial = (u, di, dj, kk) => {       // cost change if unit u moved to (di, dj) with scale kk (others fixed)
      stamp++; const touched = []; const put = (q, d) => { if (mark[q] !== stamp) { mark[q] = stamp; delta[q] = 0; touched.push(q); } delta[q] += d; };
      for (let t = 0; t < u.val.length; t++) { const i = u.ii[t] + u.di, j = u.jj[t] + u.dj; if (i >= 0 && j >= 0 && i < nh && j < nv) put(j * nh + i, -u.k * u.val[t]); }
      for (let t = 0; t < u.val.length; t++) { const i = u.ii[t] + di, j = u.jj[t] + dj; if (i >= 0 && j >= 0 && i < nh && j < nv) put(j * nh + i, kk * u.val[t]); }
      let d = 0; for (const q of touched) d += costPx(q, Math.max(0, E[q] + delta[q])) - costPx(q, E[q]); return { d, touched: touched.map((q) => [q, delta[q]]) };
    };
    const apply = (u, di, dj, kk, tr) => { for (const [q, dd] of tr.touched) E[q] = Math.max(0, E[q] + dd); u.di = di; u.dj = dj; u.k = kk; };
    const maxShift = Math.round(opt.maxShift / g.step), steps = opt.steps.map((x) => Math.max(1, Math.round(x / g.step))), scales = opt.scales;
    let total = 0; for (let q = 0; q < n; q++) total += costPx(q, E[q]); const c0 = total, order = U.map((_, i) => i);
    for (let sweep = 0; sweep < opt.sweeps; sweep++) {
      let moved = 0;
      for (const ui of order) {
        const u = U[ui]; let best = null;
        const cands = []; for (const st of steps) for (const [a, b] of [[st, 0], [-st, 0], [0, st], [0, -st]]) cands.push([u.di + a, u.dj + b, u.k]); for (const sc of scales) cands.push([u.di, u.dj, u.k * sc]);
        for (const [di, dj, kk] of cands) { if (Math.abs(di) > maxShift || Math.abs(dj) > maxShift || kk < 0.3 || kk > 3) continue; const tr = trial(u, di, dj, kk); if (tr.d < -1e-9 && (!best || tr.d < best.tr.d)) best = { di, dj, kk, tr }; }
        if (best) { apply(u, best.di, best.dj, best.kk, best.tr); total += best.tr.d; moved++; }
      }
      if (!moved) break;
    }
    return { units: U, cost0: c0, cost1: total, E };
  }
  function applyTilt(P, pol, params) { let moved = 0; pol.units.forEach((u, k) => { if (u.di || u.dj) { params[k].dh += u.di * P.g.step; params[k].dv += u.dj * P.g.step; moved++; } }); return moved; }
  function applyPolishOld(P, pol) {
    const g = P.g; let moved = 0;
    for (const u of pol.units) { const a = u.aim; if (!a || a.polished === pol) continue; a.polished = pol; const dh = u.di * g.step, dv = u.dj * g.step; if (u.di || u.dj || u.k !== 1) moved++;
      a.h += dh; a.v += dv; const d = RF.FarField.dirOf(a.h, a.v, P.conv); a.ax = d[0]; a.ay = d[1]; a.az = d[2]; a.g *= u.k; }
    return moved;
  }

  function solve(input, S0, tools) {
    const S = Object.assign({}, DEFAULTS, S0), P = problem(input, S, tools); P.tools = tools;
    const Dc = directions(P, S.NAcoarse), Df = directions(P, S.NA); let Mtot = 0; for (let i = 0; i < Df.n; i++) Mtot += Df.m[i];
    P.lap(`${Df.n} directions (${Dc.n} coarse), ${Mtot.toFixed(0)} lm`);
    design(P, 0.7 * Mtot);
    let onC = new Uint8Array(Dc.n).fill(1), x = new Float64Array(P.A.length).fill(Math.log(40)); balance(P, Dc, onC, x, true);
    let cov = fitSurface(P, Dc, onC, x, mainNeed(P)); P.lap(`pass 0: coarse cover ${cov.toFixed(0)} lm`);
    let overall = null; P.tPlan = Date.now() - P.t0;
    for (let pass = 0; pass < (P.cut0 ? S.cutPasses : 1); pass++) {
      design(P, cov); P.lap(`ideal beam (cut-off shift ${P.cutShift.toFixed(2)}°): ${P.des.flux.toFixed(0)} lm, G ${isFinite(P.des.edge.G) ? P.des.edge.G.toFixed(2) : '–'}, ${P.A.length} main + ${P.Ad.length} dim units`);
      onC = new Uint8Array(Dc.n).fill(1); x = new Float64Array(P.A.length).fill(Math.log(40)); balance(P, Dc, onC, x, true); fitSurface(P, Dc, onC, x, mainNeed(P));
      const on = new Uint8Array(Df.n).fill(1); cov = fitSurface(P, Df, on, x, mainNeed(P)); P.lap(`surface: covers ${cov.toFixed(0)} lm`);
      const base = buildBase(P, Df, on, x), nat = naturalOf(P, base), params = base.map(() => ({ dh: 0, dv: 0 }));
      let best = null, trust = S.maxShift, bad = 0;
      for (let it = 0; it <= S.iters; it++) {
        if (it > 0 && Date.now() - P.t0 > 0.55 * S.budgetMs) { P.lap('   time governor: stopping the corrections'); break; }
        const facets = realize(P, base, nat, params), m = evaluate(P, facets, Df, on);
        P.lap(`iter ${it}: ${facets.length} facets, model ${m.ev.verdict} ${JSON.stringify(m.ev.n)} worst ${m.worst.toFixed(2)} | ${m.ev.rows.filter((r) => r.verdict !== 'pass').map((r) => r.name + ' ' + (+r.value).toPrecision(3) + (r.isMin ? '≥' : '≤') + (+r.bound).toPrecision(3)).join('; ')}`);
        if (!best || m.score > best.m.score) { best = { facets, m, it, params: params.map((p) => Object.assign({}, p)), edgeSoft: S.edgeSoft }; bad = 0; if (S.preview) { try { S.preview(facets.map(cleanFacet), { label: `round ${it}`, note: `model ${m.ev.verdict} ${JSON.stringify(m.ev.n)}` }); } catch (e) { /* display only */ } } if (S.progress) S.progress(0.5 + 0.4 * it / Math.max(1, S.iters), `round ${it}/${S.iters}`); }
        else { bad++; params.forEach((p, k) => { p.dh = best.params[k].dh; p.dv = best.params[k].dv; }); S.edgeSoft = best.edgeSoft; trust *= 0.5; P.lap(`   worse: back to iteration ${best.it}, trust ${trust.toFixed(2)}°`); if (bad >= 3) break; }
        if (it === S.iters || m.hard === 0 && m.worst > 0.1) break;
        const gr = best.m.ev.rows.find((r) => r.unit === 'log'); if (gr && isFinite(gr.value) && gr.value > 0 && bad === 0) { const k = clamp(gr.value / S.gTarget, 0.5, 2.5); S.edgeSoft = clamp(Math.max(0.08, S.edgeSoft) * (k > 1 ? Math.pow(k, 0.8) : Math.pow(k, 0.5)), 0.05, 1.5); }
        const pol = polish(P, best.facets, best.m, { wBand: S.wBand, wTrack: P.isPaint ? S.wPaint : S.wTrack, wEdge: P.isPaint ? S.wPaint : S.wEdge, f0: S.f0, maxShift: trust, steps: [0.05, 0.1, 0.2].filter((q) => q <= trust + 1e-9), scales: [], sweeps: S.sweeps });
        const mv = applyTilt(P, pol, params); P.lap(`   polish (trust ${trust.toFixed(2)}°): cost ${pol.cost0.toFixed(1)} → ${pol.cost1.toFixed(1)}, ${mv} facets tilted`);
      }
      const res = { surfaces: best.facets, best, P, Df, on, pass, cutShift: P.cutShift }; if (!overall || best.m.score > overall.best.m.score) overall = res;
      // where did the model-judge find the cut-off inflection, against where it should be?  Move the design's line by the difference and go again.
      const gr = best.m.ev.rows.find((r) => r.unit === 'log' && r.at), line = P.cut0 ? P.cut0.line : 0;
      if (!gr || !P.cut0) break; const infl = gr.at[1], off = infl - (P.spec.aim && P.spec.aim.line < 0 ? P.spec.aim.line : -0.57) + (best.m.ev.reaim ? best.m.ev.reaim[1] || 0 : 0) * 0;
      P.lap(`model inflection ${infl.toFixed(2)}° (wanted ${(P.spec.aim && P.spec.aim.line < 0 ? P.spec.aim.line : -0.57).toFixed(2)}°)`);
      if (Math.abs(off) < 0.08) break; P.cutShift = clamp(P.cutShift - 0.9 * off, -1.5, 1.5);
    }
    { const en = enforceEnvelope(P, overall.surfaces); overall.surfaces = en.facets; if (en.shrunk || en.dropped) P.notes.push(`envelope: ${en.shrunk} facet shrinks, ${en.dropped} dropped`); P.lap(`envelope check: ${en.shrunk} shrinks, ${en.dropped} dropped`); }
    overall.cover = cov; overall.Mtot = Mtot; overall.timing = `plan+surface ${((P.tPlan || 0) / 1000).toFixed(1)} s`;
    // verification traces: the real engine on the finished design, scored with the app's judge; the report quotes a loose verdict next to the strict one
    if (S.traces > 0 && tools && tools.trace && S.traceRays > 0) {
      try { const surf = overall.surfaces.map(cleanFacet), tr = tools.trace(surf, { rays: Math.min(2e6, S.traceRays), spec: true });
        if (tr && tr.spec) { const lo = { pass: 0, near: 0, fail: 0 }; for (const r of tr.spec.rows) lo[RF.SqmSolver ? RF.SqmSolver.loose(r) : 'pass']++; overall.trace = { spec: tr.spec, rays: Math.min(2e6, S.traceRays), loose: lo }; } } catch (e) { P.notes.push('verification trace failed: ' + e.message); }
    }
    return overall;
  }
  RF.SqmPipe = { enforceEnvelope, cleanFacet, solve, DEFAULTS, problem, directions, design, balance, fitSurface, buildBase, naturalOf, realize, evaluate, directField, correct, polish };
})();
