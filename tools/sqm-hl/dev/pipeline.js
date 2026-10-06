/* pipeline.js — the headlamp SQM solver's core: spec → ideal beam → aims → one continuous reflector → facets → model → corrections.
 *   RF.SqmPipe.solve(input, S, tools) → { surfaces, best, P, ... }                                                                              */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, T = RF.SqmTarget, Pl = RF.SqmPlan, C = RF.SqmCore, E = RF.SqmEmit, F = RF.SqmFwd, Sh = RF.SqmShell;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const DEFAULTS = {
    N: 0, NA: 150, NAcoarse: 60, iters: 6, margin: 1.2, floorMargin: 1.2, gd: 0.34, peakCap: 300000, fluxFrac: 0.7, washCap: 12000,
    dimFrac: 0.2, dimTile: 10, dimFill: 1.35, mainFill: 1.5, softAll: 0.22, edgeSoft: 0.2, gTarget: 0.28, slack: 1.0, step: 0.05, cutPasses: 1, sweeps: 5, search: 4, maxShift: 0.6, wBand: 150, wTrack: 0.03, wEdge: 3, f0: 60, wPaint: 1.5, seedGain: 1.6, aimGuard: 0.011, rightSlope: 1.0, rightLift: 0, resBoost: 1, resV: -1.75, padH: 0, guardLift: 0, naEval: 100, naFinal: 250, alignGain: 0.8, leftLift: 0, push: 0, guardCarry: 1, shell: 'natural', shellMix: 1, shellDecals: 1, shellFill: 0.97, shellE: 1, shellP: 0, shellAxis: 'auto', shellTiltV: 0, shellTiltH: 0, shellTry: 'natural,fit,paraboloid,wall', shellMaxStep: 1, shellRank: 2, shellTol: -0.3,
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
    // the beam is designed over a wider window than the spec's (the IIHS left edge at 15 m is 15.8° off axis; the spec reads ±15°)
    const w0 = spec.window, pad = !spec.paintMode && S.padH > 0 ? S.padH : 0, win = [w0[0] - pad, w0[1] + pad, w0[2], w0[3]]; P.win = win;
    P.g = T.grid(win, S.step, conv); P.B = T.bands(spec, P.g, { lo: S.floorMargin || S.margin, hi: S.margin });
    P.grid = F.gridOf(win, S.step, conv, dist, P.Lp); P.S_ = F.sourceSamples(src, 128);
    P.rmin = Math.max(env.keepOut || 0, S.minDistance || 0) + RF.Source.boundingRadius(src) * 0.5; P.cut0 = T.cutOf(spec, { slope: S.rightSlope, lift: S.rightLift, leftLift: S.leftLift }); P.cutShift = 0; P.cut = P.cut0;
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
    if (!P.B.hi0) { P.B.hi0 = Float64Array.from(P.B.hi); P.B.wc0 = Float64Array.from(P.B.wc); } if (!S.guardCarry) { P.B.hi.set(P.B.hi0); P.B.wc.set(P.B.wc0); }       // guardCarry: the earlier call's guard caps stay ceilings while this call's ideal beam is built (a two-pass guard: the edge is tuned with the caps in place)
    P.des = P.isPaint ? paintDesign(P, capLm) : T.design({ spec: P.spec, g: P.g, B: P.B, fluxTarget: P.refl * capLm * 0.97, peakCap: S.peakCap, washCap: S.washCap, gd: S.gd, guard: S.aimGuard, guardLift: S.guardLift, cut: P.cut || null, road: S.gamma !== undefined ? { gamma: S.gamma } : undefined });
    if (P.des.guardDropped && !P.guardNoted) { P.guardNoted = true; P.notes.push('aim guard dropped: with its caps in place the cut-off could not reach the design sharpness (this spec asks for light above the cut-off), so the ideal beam was built without them'); }
    // the aim guard's caps become ceilings of the band the polish and the corrections work against
    P.B.hi.set(P.B.hi0); P.B.wc.set(P.B.wc0);
    if (P.des.guard) for (const c of P.des.guard) { const w = Math.pow(Math.max(9, c.px.length) / 9, -0.75); for (const q of c.px) { const cap = Math.max(c.cap, P.B.lo[q]); if (cap < P.B.hi[q]) P.B.hi[q] = cap; const ramp = clamp((P.g.vOf((q / P.g.nh) | 0) - c.vStart) / 0.3, 0.1, 1); if (w * ramp > P.B.wc[q]) P.B.wc[q] = w * ramp; } }     // full weight only 0.3° above where the cap starts: the realised tail is fatter than T*'s
    const sp = Pl.superpixels(P.g, P.des.T, 0.2), seeds = floorSeeds(P), tt = Pl.twoTier(sp, P.N, { dimFrac: S.dimFrac, dimTile: S.dimTile, reserve: seeds.length, boost: { gain: S.resBoost, vAbove: S.resV } });
    P.A = tt.main.map((a) => Object.assign(P.aimAt(a.h, a.v, a.F / P.refl, 'main'), { cov: a.cov }));
    P.Ad = tt.dim.map((a) => Object.assign(P.aimAt(a.h, a.v, a.F / P.refl, 'dim'), { cov: a.cov }));
    const area = 4 * (Math.PI / 180) ** 2 * 1.4 * 1.4;
    for (const sd of seeds) { let near = Infinity; for (const a of P.Ad) near = Math.min(near, Math.hypot(a.h - sd.h, a.v - sd.v)); if (near < 1.2) continue;
      P.Ad.push(Object.assign(P.aimAt(sd.h, sd.v, Math.max(0.12, sd.lo * S.margin * S.seedGain * area / P.refl), 'dim'), { cov: [1.0, 0, 1.0], seeded: true })); }
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
    // dish fill: every facet is pushed out along its own rays (a homothety about the LED: its aim and its flux are untouched, its LED image shrinks as 1/r) by a share `push` of the room the
    // envelope leaves it.  The surface is then no longer one continuous piece: neighbours meet with small steps.  A SHELL (shell.js) does the same with a prescribed radius per direction.
    let rho = null; P.shellInfo = null;
    if (P.shellSel && P.shellSel.kind !== 'natural') {
      const as0 = C.assign(D, on, P.A, x), Fr = Sh.frame(D, on, P.A, x, as0), r = Sh.rhoFor(Fr, P.shellSel, P.S.shellMix); rho = Array.from(r.rho);
      P.shellInfo = Object.assign({}, r.info, { steps: Sh.steps(D, on, P.A, x, as0, r.rho), sh: P.shellSel });
    } else if (P.S.push > 0) { const rm = E.rhoMax(D, on, P.A, x, C.assign(D, on, P.A, x), 0.97); rho = Array.from(rm.max).map((r) => Math.max(1, 1 + P.S.push * ((isFinite(r) ? r : 1) * 0.97 - 1))); }
    const em = E.emitAll(D, on, P.A, x, { refl: P.refl, rho }), as = em.assign; let facets = em.facets; facets.forEach((f) => { f.aimRef = P.A[f.aimIndex]; });
    if (P.Ad.length) { const dr = P.S.shellDecals === 0 ? null : rho, dec = E.placeDecals(D, on, P.A, x, as, P.Ad, { rho: dr }); for (const dc of dec.decals) { const f = E.decalFacet(D, on, x, P.A, as, dc, { rho: dr }); if (f) { f.aimRef = dc.aim; facets.push(f); } } }
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
  function evaluate(P, facets, D, on, naOverride) {
    const fld = F.field(facets, P.S_, P.grid, { na: naOverride > 0 ? naOverride : P.S.naEval > 0 ? P.S.naEval : 40, occlude: true }), Ed = directField(P, D, on), Et = new Float64Array(fld.E.length);
    for (let q = 0; q < Et.length; q++) Et[q] = fld.E[q] + Ed[q];
    const gj = T.judgeGrid(P.g, Et, { distance: P.dist, centre: P.Lp }), ev = RF.Spec.evaluate(gj, T.mdOf(P.spec));
    const hard = ev.rows.filter((r) => r.verdict === 'fail').length, worst = ev.rows.length ? Math.min(...ev.rows.map((r) => r.margin)) : 1;
    let deficit = 0; for (const r of ev.rows) if (r.margin < 0) deficit += Math.min(3, -r.margin);
    let score = -3 * hard - 6 * deficit + 0.5 * clamp(worst, -1, 0.2);          // fails count, but so does every row's shortfall (decades): fixing the second-worst row is progress too
    if (P.isPaint) { const g = P.g, f0 = P.S.f0; let c = 0, tot = 0; for (let q = 0; q < g.n; q++) { const t = P.des.T[q], f = Et[q] / g.om[q]; tot += g.om[q] * t; if (t > 0) { const a = Math.log(Math.max(f, f0)) - Math.log(Math.max(t, f0)); c += g.om[q] * t * a * a; } else if (f > f0) c += g.om[q] * 0.3 * f; } score = -c / Math.max(1e-9, tot) * 10; }
    return { fld, Ed, Et, gj, ev, hard, worst, deficit, score };
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
    const wc = P.B.wc, costPx = (q, e) => { const f = e / om[q]; let c = 0; if (lo[q] > 0 && f < lo[q]) { const d = (lo[q] - f) / lo[q]; c += wBand * wc[q] * d * d; } if (hi[q] < Infinity && f > hi[q]) { const d = (f - hi[q]) / hi[q]; c += wBand * wc[q] * d * d; }
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

  // ---------------------------------------------------------------- edge alignment: the cut-off inflection should sit at ONE height in every scan column (linearity row, and the aim the judge derives)
  // The three columns' inflections come from the stock judge itself (a one-item spec on the model's grid).  Each facet whose light lands on the edge of a column is tilted by the average offset
  // of the columns it serves, in proportion to how much of its flux is edge light.
  function colInflection(P, gj, hc, gi) {
    const md = Object.assign(T.mdOf(P.spec), { items: [Object.assign({}, gi, { h: hc, id: 'tmp', name: 'tmp', on: true, min: 1e-4, max: 0 })], aimMode: 'design', aimBox: null, aimTol: 0 });
    const r = RF.Spec.evaluate(gj, md).rows[0]; return r && r.at && isFinite(r.at[1]) ? r.at[1] : null;
  }
  function alignEdge(P, facets, m, params, gain) {
    const sp = P.spec, gi = sp.items.find((x) => x.kind === 'gradient'), li = sp.items.find((x) => x.kind === 'linearity'); if (!gi || !P.cut || !(gain > 0)) return null;
    const cols = [gi.h].concat(li && li.hs ? li.hs.filter((h) => Math.abs(h - gi.h) > 0.3) : []); if (cols.length < 2) return null;
    const infl = cols.map((hc) => colInflection(P, m.gj, hc, gi)); if (infl.some((v) => v === null)) return null;
    const sorted = infl.slice().sort((a, b) => a - b), ref = sorted[(sorted.length - 1) >> 1], dl = infl.map((v) => v - ref), spread = sorted[sorted.length - 1] - sorted[0];
    if (spread < 0.06) return { moved: 0, spread, infl };
    const g = P.g; let moved = 0;
    facets.forEach((f, k) => {
      const fp = m.fld.fps[k]; if (!fp || !(fp.flux > 0)) return; const w = new Float64Array(cols.length);
      for (let t = 0; t < fp.idx.length; t++) { const j = (fp.idx[t] / g.nh) | 0, i = fp.idx[t] - j * g.nh, h = g.hOf(i), v = g.vOf(j); if (v < ref - 0.5 || v > ref + 0.3) continue; for (let c = 0; c < cols.length; c++) if (Math.abs(h - cols[c]) <= 0.6) w[c] += fp.val[t]; }
      let sw = 0, d = 0; for (let c = 0; c < cols.length; c++) { sw += w[c]; d += w[c] * dl[c]; } if (!(sw > 0)) return; d /= sw;
      const frac = Math.min(1, (sw / fp.flux) / 0.4); if (frac < 0.1) return;
      params[k].dv -= gain * frac * d; moved++;
    });
    return { moved, spread, infl };
  }

  // ---------------------------------------------------------------- refine: corrections + aim polish + edge trim on FIXED geometry, for one set of shaping parameters
  function refine(P, Df, on, base, nat, cand, iters) {
    const S = P.S, saved = { mainFill: S.mainFill, softAll: S.softAll, edgeSoft: S.edgeSoft };
    Object.assign(S, cand.set || {}); const params = base.map(() => ({ dh: 0, dv: 0 }));
    let best = null, trust = S.maxShift, bad = 0;
    for (let it = 0; it <= iters; it++) {
      if (it > 0 && Date.now() - P.t0 > 0.55 * S.budgetMs) { P.lap('   time governor: stopping the corrections'); break; }
      const facets = realize(P, base, nat, params), m = evaluate(P, facets, Df, on);
      if (it === 0 && !P.draftSent && S.preview) { P.draftSent = true; try { S.preview(facets.map(cleanFacet), { label: 'first draft', note: `model ${m.ev.verdict} ${JSON.stringify(m.ev.n)}` }); } catch (e) { /* display only */ } }       // something to fall back on if the host stops the run
      P.lap(`[${cand.label}] iter ${it}: ${facets.length} facets, model ${m.ev.verdict} ${JSON.stringify(m.ev.n)} worst ${m.worst.toFixed(2)} | ${m.ev.rows.filter((r) => r.verdict !== 'pass').map((r) => r.name + ' ' + (+r.value).toPrecision(3) + (r.isMin ? '≥' : '≤') + (+r.bound).toPrecision(3)).join('; ')}`);
      if (!best || m.score > best.m.score) { best = { facets, m, it, params: params.map((p) => Object.assign({}, p)), edgeSoft: S.edgeSoft }; bad = 0; }
      else { bad++; params.forEach((p, k) => { p.dh = best.params[k].dh; p.dv = best.params[k].dv; }); S.edgeSoft = best.edgeSoft; trust *= 0.5; P.lap(`   worse: back to iteration ${best.it}, trust ${trust.toFixed(2)}°`); if (bad >= 3) break; }
      if (it === iters || m.hard === 0 && m.worst > 0.1) break;
      const gr = best.m.ev.rows.find((r) => r.unit === 'log'); if (gr && isFinite(gr.value) && gr.value > 0 && bad === 0) { const k = clamp(gr.value / S.gTarget, 0.5, 2.5); S.edgeSoft = clamp(Math.max(0.08, S.edgeSoft) * (k > 1 ? Math.pow(k, 0.8) : Math.pow(k, 0.5)), 0.05, 1.5); }
      const pol = polish(P, best.facets, best.m, { wBand: S.wBand, wTrack: P.isPaint ? S.wPaint : S.wTrack, wEdge: P.isPaint ? S.wPaint : S.wEdge, f0: S.f0, maxShift: trust, steps: [0.05, 0.1, 0.2].filter((q) => q <= trust + 1e-9), scales: [], sweeps: S.sweeps });
      const mv = applyTilt(P, pol, params); P.lap(`   polish (trust ${trust.toFixed(2)}°): cost ${pol.cost0.toFixed(1)} → ${pol.cost1.toFixed(1)}, ${mv} facets tilted`);
      if (S.alignGain > 0 && P.cut) { const al = alignEdge(P, best.facets, best.m, params, S.alignGain); if (al) P.lap(`   edge alignment: inflections ${al.infl.map((v) => v.toFixed(2)).join('/')} (spread ${al.spread.toFixed(2)}°), ${al.moved} facets nudged`); }
    }
    // final trim of the cut-off sharpness: only the vertical blur of the edge facets changes (no geometry), judged by the model
    { const gRow = (m) => m.ev.rows.find((r) => r.unit === 'log' && isFinite(r.value)); let g0 = gRow(best.m);
      if (g0 && P.cut) for (let k = 0; k < 4; k++) { const G = g0.value, gi = P.spec.items.find((x) => x.kind === 'gradient') || {}, lo = gi.min || 0.13, hi = gi.max || 0.4;
        if (G >= lo * 1.15 && G <= hi * 0.92) break; const f = G > hi * 0.92 ? 1.35 : 0.75; S.edgeSoft = clamp(Math.max(0.1, S.edgeSoft) * f, 0.05, 2); params.forEach((q, i) => { q.dh = best.params[i].dh; q.dv = best.params[i].dv; });
        const facets = realize(P, base, nat, params), m = evaluate(P, facets, Df, on); const g1 = gRow(m); P.lap(`   edge trim: edgeSoft ${S.edgeSoft.toFixed(2)} → G ${g1 ? g1.value.toFixed(2) : '–'}, model ${m.ev.verdict} ${JSON.stringify(m.ev.n)}`);
        if (m.score >= best.m.score - 0.05) { best = { facets, m, it: best.it, params: best.params, edgeSoft: S.edgeSoft }; g0 = g1 || g0; } else { S.edgeSoft = best.edgeSoft; break; } } }
    best.cand = cand; best.set = { mainFill: S.mainFill, softAll: S.softAll, edgeSoft: S.edgeSoft };
    Object.assign(S, saved); return best;
  }
  // shaping candidates the search tries (deterministic order; the first is the setting as given)
  function candidatesFor(S, n) {
    const mf = S.mainFill, sa = S.softAll, c = [[1, 1, 'base'], [0.8, 1, 'tighter'], [1.25, 1, 'wider'], [1, 0.5, 'crisper'], [1, 1.6, 'softer'], [0.8, 1.6, 'tight+soft'], [1.25, 0.5, 'wide+crisp'], [1.5, 1.6, 'widest'], [0.65, 1, 'tightest'], [0.8, 0.5, 'tight+crisp']];
    return c.slice(0, Math.max(1, Math.min(n, c.length))).map(([a, b, label]) => ({ label, set: { mainFill: mf * a, softAll: sa * b } }));
  }

  // the base shell: forced (S.shell = a kind) or ranked (S.shell = 'auto': every kind in S.shellTry gets a short refine on the noise-free model).  The natural surface is always run as the
  // reference; a rival must beat the incumbent clearly (0.3 score) and keep its steps under S.shellMaxStep.  Returns the chosen base and what to tell the user.
  function pickShell(P, Df, on, x, base0, nat0, slow) {
    const S = P.S, auto = S.shell === 'auto';
    let kinds = auto ? String(S.shellTry).split(',').map((k) => k.trim()).filter((k) => Sh.KINDS.includes(k) && k !== 'natural') : (Sh.KINDS.includes(S.shell) && S.shell !== 'natural' ? [S.shell] : []);
    if (!kinds.length || (auto && slow)) { if (auto && slow) P.notes.push('shell: no time to compare shells (slow run), the natural SQM surface is used'); return { base: base0, nat: nat0 }; }
    const as0 = C.assign(Df, on, P.A, x), Fr = Sh.frame(Df, on, P.A, x, as0), ax = S.shellAxis === 'manual' ? [S.shellTiltV, S.shellTiltH] : S.shellAxis === 'beam' ? [0, 0] : [null, null];
    const opts = { e: S.shellE, p: S.shellP, fill: S.shellFill, conv: P.conv, tiltV: ax[0], tiltH: ax[1] };
    const nI = { kind: 'natural', depth: 0, rhoMin: 1, rhoMax: 1, shareClamped: 0, steps: { edges: 0, median: 0, p95: 0, max: 0, over03: 0 } }; { const r = Sh.rhoFor(Fr, { kind: 'natural' }); nI.depth = r.info.depth; }
    const rows = [{ kind: 'natural', sel: null, label: 'natural SQM surface', base: base0, nat: nat0, info: nI }];
    for (const kind of kinds) {
      const sel = Sh.choose(Fr, kind, opts); if (!sel || !(sel.kind === 'wall' || sel.p > 0)) { rows.push({ kind, label: kind, skipped: 'no size of this shell fits the envelope' }); continue; }
      P.shellSel = sel; const base = buildBase(P, Df, on, x), nat = naturalOf(P, base); rows.push({ kind, sel, label: Sh.describe(sel), base, nat, info: P.shellInfo });
    }
    const t0 = Date.now(); let ran = 0;
    for (const row of rows) {
      if (row.skipped) continue; if (row.kind === 'natural' && !auto && S.shellRank < 2) continue;         // a forced shell on the fast tier is not compared with the natural surface
      if (ran > 0 && Date.now() - P.t0 > 0.4 * S.budgetMs) { row.skipped = 'out of time'; continue; }
      P.shellSel = row.sel; P.shellInfo = row.info; const r = refine(P, Df, on, row.base, row.nat, { label: 'shell ' + row.kind, set: {} }, Math.max(1, S.shellRank)); row.m = r.m; ran++;
      P.lap(`shell ${row.label}: model ${r.m.ev.verdict} ${JSON.stringify(r.m.ev.n)} worst ${r.m.worst.toFixed(2)} score ${r.m.score.toFixed(2)}, steps p95 ${row.info.steps ? row.info.steps.p95.toFixed(2) : '–'} mm`);
    }
    let pick = rows[0]; const forced = !auto, tol = S.shellTol === undefined ? -0.3 : S.shellTol;
    if (forced) pick = rows.find((r) => r.kind === kinds[0] && !r.skipped) || rows[0];
    else {       // a shell is taken when it ranks at least (natural − tol) in the model score; the best of those, ties to the smaller steps
      let cand = null;
      for (const row of rows.slice(1)) {
        if (row.skipped || !row.m) continue;
        if (S.shellMaxStep > 0 && row.info.steps && row.info.steps.p95 > S.shellMaxStep) { row.skipped = `steps ${row.info.steps.p95.toFixed(2)} mm > ${S.shellMaxStep} mm`; continue; }
        if (row.m.score >= rows[0].m.score - tol && (!cand || row.m.score > cand.m.score + 0.05 || (Math.abs(row.m.score - cand.m.score) <= 0.05 && row.info.steps.p95 < cand.info.steps.p95))) cand = row;
      }
      if (cand) pick = cand;
    }
    P.shellSel = pick.sel; P.shellInfo = pick.info;
    // the report: what was chosen, what it costs, and whether it blew up
    const st = pick.info.steps, nat = rows[0];
    P.shellReport = { chosen: pick.label, kind: pick.kind, info: pick.info, rows: rows.map((r) => ({ kind: r.kind, label: r.label, skipped: r.skipped || null, verdict: r.m ? r.m.ev.verdict : null, n: r.m ? r.m.ev.n : null, score: r.m ? +r.m.score.toFixed(2) : null, depth: r.info ? +r.info.depth.toFixed(0) : null, p95: r.info && r.info.steps ? +r.info.steps.p95.toFixed(2) : null })) };
    P.notes.push(`shell: ${pick.label}${auto ? ' (chosen by the model among ' + rows.filter((r) => r.m).map((r) => r.kind).join(', ') + ')' : ''}; deepest facet ${pick.info.depth.toFixed(0)} mm from the LED; steps between neighbouring facets median ${st.median.toFixed(2)} / 95 % ${st.p95.toFixed(2)} / max ${st.max.toFixed(2)} mm (${(100 * st.over03).toFixed(0)} % of the edges over 0.3 mm)`);
    const warn = (t) => P.notes.push('⚠ shell: ' + t);
    if (pick.info.shareClamped > 0.1) warn(`${(100 * pick.info.shareClamped).toFixed(0)} % of the light's facets could not reach the shell (${pick.info.clampedWall} held at the wall, ${pick.info.clampedLed} at the LED clearance, ${pick.info.invalid} with no radius there) — a smaller shell would fit better`);
    if (st.p95 > 0.6) warn(`large steps between neighbouring facets (95 % under ${st.p95.toFixed(2)} mm, max ${st.max.toFixed(2)} mm): the surface is far from continuous`);
    if (pick !== nat && nat.m && pick.m && pick.m.score < nat.m.score - 1.0) warn(`this shell costs the beam: model ${pick.m.ev.verdict} ${JSON.stringify(pick.m.ev.n)} (score ${pick.m.score.toFixed(1)}) against the natural surface's ${nat.m.ev.verdict} ${JSON.stringify(nat.m.ev.n)} (${nat.m.score.toFixed(1)}), same short search`);
    for (const r of rows) if (r.skipped) P.notes.push(`shell ${r.kind}: not used (${r.skipped})`);
    P.lap(`shell chosen: ${pick.label} (${Date.now() - t0} ms of ranking)`);
    return { base: pick.base, nat: pick.nat };
  }

  function solve(input, S0, tools) {
    const S = Object.assign({}, DEFAULTS, S0), P = problem(input, S, tools); P.tools = tools;
    const Dc = directions(P, S.NAcoarse), Df = directions(P, S.NA); let Mtot = 0; for (let i = 0; i < Df.n; i++) Mtot += Df.m[i];
    P.lap(`${Df.n} directions (${Dc.n} coarse), ${Mtot.toFixed(0)} lm`);
    design(P, (S.fluxFrac > 0 ? S.fluxFrac : 0.7) * Mtot);
    let onC = new Uint8Array(Dc.n).fill(1), x = new Float64Array(P.A.length).fill(Math.log(40)); balance(P, Dc, onC, x, true);
    let cov = fitSurface(P, Dc, onC, x, mainNeed(P)); P.lap(`pass 0: coarse cover ${cov.toFixed(0)} lm`);
    let overall = null; P.tPlan = Date.now() - P.t0;
    for (let pass = 0; pass < (P.cut0 ? S.cutPasses : 1); pass++) {
      design(P, cov); P.lap(`ideal beam (cut-off shift ${P.cutShift.toFixed(2)}°): ${P.des.flux.toFixed(0)} lm, G ${isFinite(P.des.edge.G) ? P.des.edge.G.toFixed(2) : '–'}, ${P.A.length} main + ${P.Ad.length} dim units`);
      onC = new Uint8Array(Dc.n).fill(1); x = new Float64Array(P.A.length).fill(Math.log(40)); balance(P, Dc, onC, x, true); fitSurface(P, Dc, onC, x, mainNeed(P));
      const on = new Uint8Array(Df.n).fill(1); cov = fitSurface(P, Df, on, x, mainNeed(P)); P.lap(`surface: covers ${cov.toFixed(0)} lm`);
      P.shellSel = null; let base = buildBase(P, Df, on, x), nat = naturalOf(P, base); P.tBase = Date.now() - P.t0;
      // a slow machine or a big problem (the plan and surface already took a third of the budget): one candidate, fewer corrections, no finer re-judging
      const slow = !P.isPaint && P.tBase > 0.3 * S.budgetMs; if (slow && pass === 0) P.notes.push(`slow run: planning took ${(P.tBase / 1000).toFixed(0)} s of the ${(S.budgetMs / 1000).toFixed(0)} s budget, so one candidate with fewer corrections is used`);
      if (S.shell && S.shell !== 'natural' && !P.isPaint) { const pk = pickShell(P, Df, on, x, base, nat, slow); base = pk.base; nat = pk.nat; }
      let best = null, tCand = 0; const cands = candidatesFor(S, P.isPaint || slow ? 1 : S.search), itersMain = slow ? Math.min(S.iters, 3) : S.iters;
      for (let ci = 0; ci < cands.length; ci++) {
        const tNow = Date.now() - P.t0;
        if (ci > 0 && (tNow > 0.45 * S.budgetMs || tNow + 1.2 * tCand > 0.6 * S.budgetMs)) { P.lap('   time governor: no more candidates'); break; }       // a candidate that cannot finish is not started
        const tc0 = Date.now(), r = refine(P, Df, on, base, nat, cands[ci], ci === 0 ? itersMain : Math.max(2, Math.ceil(itersMain * 0.6)));
        if (S.naFinal > 0 && S.naFinal > (S.naEval || 40) && !P.isPaint && !slow) r.m = evaluate(P, r.facets, Df, on, S.naFinal);          // the finalists are judged on a finer model than the loop works with
        P.lap(`candidate ${cands[ci].label}: model ${r.m.ev.verdict} ${JSON.stringify(r.m.ev.n)} worst ${r.m.worst.toFixed(2)} score ${r.m.score.toFixed(2)}`);
        if (!best || r.m.score > best.m.score + 0.3) { best = r; P.chosen = cands[ci].label; if (S.preview) { try { S.preview(r.facets.map(cleanFacet), { label: `candidate ${cands[ci].label}`, note: `model ${r.m.ev.verdict} ${JSON.stringify(r.m.ev.n)}` }); } catch (e) { /* display only */ } } }
        tCand = Math.max(tCand, Date.now() - tc0);
        if (S.progress) S.progress(0.5 + 0.4 * (ci + 1) / cands.length, `candidate ${ci + 1}/${cands.length}`);
        if (best.m.hard === 0 && best.m.worst > 0.15) break;
      }
      Object.assign(S, best.set); P.notes.push(`shaping candidate chosen: ${best.cand.label} (of ${cands.length} tried, switching needs a clear model gain)`);
      const res = { surfaces: best.facets, best, P, Df, on, pass, cutShift: P.cutShift }; if (!overall || best.m.score > overall.best.m.score) overall = res;
      // where did the model-judge find the cut-off inflection, against where it should be?  Move the design's line by the difference and go again.
      const gr = best.m.ev.rows.find((r) => r.unit === 'log' && r.at), line = P.cut0 ? P.cut0.line : 0;
      if (!gr || !P.cut0) break; const infl = gr.at[1], off = infl - (P.spec.aim && P.spec.aim.line < 0 ? P.spec.aim.line : -0.57) + (best.m.ev.reaim ? best.m.ev.reaim[1] || 0 : 0) * 0;
      P.lap(`model inflection ${infl.toFixed(2)}° (wanted ${(P.spec.aim && P.spec.aim.line < 0 ? P.spec.aim.line : -0.57).toFixed(2)}°)`);
      if (Math.abs(off) < 0.08) break; P.cutShift = clamp(P.cutShift - 0.9 * off, -1.5, 1.5);
    }
    { const en = enforceEnvelope(P, overall.surfaces); overall.surfaces = en.facets;
      if (en.shrunk || en.dropped) { P.notes.push(`envelope: ${en.shrunk} facet shrinks, ${en.dropped} dropped`);
        if (Date.now() - P.t0 < 0.75 * S.budgetMs) { try { overall.final = evaluate(P, overall.surfaces, overall.Df, overall.on, S.naFinal > 0 ? S.naFinal : 0); } catch (e) { /* the verdict before the shrinks stays */ } } }       // the report is about the finished design, shrinks included
      P.lap(`envelope check: ${en.shrunk} shrinks, ${en.dropped} dropped`); }
    overall.cover = cov; overall.Mtot = Mtot; overall.timing = `plan+surface ${((P.tPlan || 0) / 1000).toFixed(1)} s`;
    // verification trace: the real engine on the finished design, read at the AIM the model judge chose (the stock judge's cut-off aim is noise-sensitive: at ≤ 4 M rays it can
    // latch onto the beam's tail and read every row ~1° off).  Guided like the app's Refine; the report quotes a loose verdict (value ± 1σ inside the limit) beside the strict one.
    if (S.traces > 0 && S.traceRays > 0 && !P.isPaint && RF.Engine && RF.FarField && Date.now() - P.t0 > 0.8 * S.budgetMs) P.notes.push('verification trace skipped: out of time');
    else if (S.traces > 0 && S.traceRays > 0 && !P.isPaint && RF.Engine && RF.FarField) {
      try {
        // the app's worker gives a solver no scene (tools.scene is a harness extra), so the problem is rebuilt from the input
        const surf = overall.surfaces.map(cleanFacet), N = Math.min(4e6, S.traceRays * Math.max(1, S.traces)), spec = P.spec;
        const sc0 = { source: input.source, emitters: (input.sources || []).slice(1), target: input.target, envelope: input.envelope, mode: 'D', modeA: { paint: [] },
          sim: { bounces: input.limits.bounces || 4, floor: 0.01, seed: (input.seed | 0) + 11, res: 100, autoRes: false, rays: N, view: 'total' } };
        const opts = { win: spec.window, step: spec.step || 0.1, conv: P.conv, distance: P.dist, centre: P.Lp.slice() };
        const Pp = RF.Engine.prepare(sc0, surf); Pp.ffStreams = [opts]; Pp.guideLearn = true;
        const n0 = Math.max(100000, Math.floor(N / 4)); let c = RF.Engine.newCtx(Pp, n0, 0); RF.Engine.traceRange(c, 0, n0); c.next = n0; c.done = true;
        while (c.N < N) { const n1 = c.N, gd = RF.Engine.buildGuide(c); c = RF.Engine.extend(c, Math.min(N, 2 * n1), gd); RF.Engine.traceRange(c, n1, c.N); c.next = c.N; c.done = true; }
        const G = RF.FarField.build(c, opts), sh = (overall.final || overall.best.m).ev.shift || [0, 0], G2 = Object.assign({}, G, { h0: G.h0 - sh[0], v0: G.v0 - sh[1], h1: G.h1 - sh[0], v1: G.v1 - sh[1] });
        const md = Object.assign(T.mdOf(spec), { aimMode: 'design', aimBox: null, aimTol: 0 }), ev = RF.Spec.evaluate(G2, md), lo = { pass: 0, near: 0, fail: 0 };
        for (const r of ev.rows) lo[RF.SqmSolver ? RF.SqmSolver.loose(r) : 'pass']++;
        overall.trace = { spec: { n: ev.n, verdict: ev.verdict }, rays: N, loose: lo, aim: sh };
      } catch (e) { P.notes.push('verification trace failed: ' + e.message); }
    }
    return overall;
  }
  RF.SqmPipe = { pickShell, refine, candidatesFor, mainNeed, enforceEnvelope, cleanFacet, solve, DEFAULTS, problem, directions, design, balance, fitSurface, buildBase, naturalOf, realize, evaluate, directField, correct, polish };
})();
