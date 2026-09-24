/* modeA.js — Mode A: paint a target, tile it with source images.
 *
 * FLUX ACCOUNTING is done in solid angle from the source (the source's actual distribution):
 * every facet owns an exact direction cell (θ, φ) around the reflector axis, and its flux is the
 * integral of the real intensity over that cell.  Zones on the target get exactly that share of
 * the painted flux (solver.partitionZones).
 *
 * GEOMETRY is an optimisation, not a prescription.  Along each azimuthal spoke the reflector is a
 * tailored curve r(θ): each micro-facet's plane passes through the end of the previous one and has
 * the bisector normal toward the pattern centroid.  With a distant target that curve is a parabola
 * section — the curve family is one-parameter (its starting radius r0).  For every spoke and every
 * r0 we keep the longest contiguous run of micro-cells that lies inside the envelope, and choose
 * the r0 capturing the most flux (ties → larger r0: facets farther from the source see a smaller
 * source and paint sharper tiles).  Nothing sits on a fixed-radius shell; spokes pick their own r0,
 * so an asymmetric envelope yields a stretched, asymmetric reflector.
 *
 * Monotonicity by construction: the r0 series is anchored on the source/target scale (not on the
 * envelope), so a larger envelope only extends it, and a curve's inside-cells can only grow.
 * Hence the captured flux cannot fall when the envelope grows.
 *
 * Facets are then carved from the captured range with equal flux, placed on the spoke's curve,
 * re-aimed at their own zone (bisector), and — if curved — given the ellipsoidal curvature whose
 * tile matches the zone size (solveVergence).  Facet outlines are the direction-cell pyramid cut
 * by the facet surface, so a facet intercepts exactly its own cell (no overlap, no gaps).
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V, Geo, Solver } = RF;
  const D2R = Math.PI / 180;

  function generate(scene, opts) {
    opts = opts || {};
    const report = { ok: false, warnings: [], facets: [] };
    const src = scene.source, S = src.pos.slice(), fr = RF.Source.frame(src);
    const info = Solver.paintInfo(scene);
    const T = info.T;
    if (!info.n) { report.error = 'Nothing painted — paint the target first.'; return { surfaces: [], report }; }
    const budget = Math.max(1, Math.min(2000, scene.modeA.budget | 0));
    const Zc = RF.Engine.targetUVtoWorld(T, info.cu, info.cv);
    const w0 = V.norm(V.sub(S, Zc));             // vertex direction: away from the pattern
    const F = Solver.polarFrame(w0, T);
    const env = scene.envelope;
    const thCap = 175 * D2R;
    const Itot = RF.Source.totalIntegral(src);

    // ---- azimuthal support of the emission (directions that carry flux at all)
    const NPH = 720, marg = new Float64Array(NPH), NTH = 180;
    for (let a = 0; a < NPH; a++) {
      const ph = (a + 0.5) / NPH * 2 * Math.PI;
      let m = 0;
      for (let b = 0; b < NTH; b++) { const th = (b + 0.5) / NTH * thCap; m += Solver.intensityToward(src, fr, Solver.dirOf(F, th, ph)) * Math.sin(th); }
      marg[a] = m;
    }
    const mmax = Math.max(...marg);
    if (!(mmax > 0)) { report.error = 'The source emits no flux toward any usable direction.'; return { surfaces: [], report }; }
    // largest cyclic gap of (near) zero flux → support is its complement
    let bestGap = 0, gapEnd = -1;
    for (let a = 0; a < NPH; a++) {
      if (marg[a] > 1e-6 * mmax) continue;
      let len = 0; while (len < NPH && marg[(a + len) % NPH] <= 1e-6 * mmax) len++;
      if (len > bestGap) { bestGap = len; gapEnd = (a + len) % NPH; }
    }
    let ph0, phSpan;
    if (bestGap === 0) { ph0 = 0; phSpan = 2 * Math.PI; } else { ph0 = gapEnd / NPH * 2 * Math.PI; phSpan = (NPH - bestGap) / NPH * 2 * Math.PI; }
    // spoke count: roughly square cells for the budget, no facet wider than MAXA in φ or θ (a
    // flat facet cannot span a hemisphere).  If the budget cannot cover the whole support at that
    // size, keep the highest-flux azimuth window it can cover.
    const MAXA = 40 * D2R;
    let nSp = Math.max(1, Math.round(Math.sqrt(budget * phSpan / (2 * Math.PI)) * 1.2));
    nSp = Math.max(nSp, Math.ceil(phSpan / MAXA));
    if (nSp > budget) {
      nSp = budget;
      const win = Math.round(nSp * MAXA / (2 * Math.PI) * NPH), a0 = Math.round(ph0 / (2 * Math.PI) * NPH), span = Math.round(phSpan / (2 * Math.PI) * NPH);
      let best = -1, bestA = a0;
      for (let a = a0; a + win <= a0 + span; a++) { let f = 0; for (let q = a; q < a + win; q++) f += marg[q % NPH]; if (f > best) { best = f; bestA = a; } }
      ph0 = bestA / NPH * 2 * Math.PI; phSpan = win / NPH * 2 * Math.PI;
      report.warnings.push('Facet budget too small to cover every lit direction with facets ≤ 40° wide; using the brightest ' + (phSpan / D2R).toFixed(0) + '° of azimuth.');
    }

    // ---- r0 series anchored on source & target scale (never on the envelope)
    const srcR = RF.Source.boundingRadius(src);
    const dT = V.dist(S, Zc);
    // keep-out: packaging clearance around the emitter (LED dome / package) — a user constraint,
    // independent of the envelope, so it cannot break monotonicity.
    const keep = Math.max(env.keepOut || 0, 1.5 * srcR);
    const rMin = Math.max(keep, 2e-3 * dT);
    let rEnv = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) rEnv = Math.max(rEnv, V.dist(S, [env.center[0] + sx * env.half[0], env.center[1] + sy * env.half[1], env.center[2] + sz * env.half[2]]));
    const r0s = [];
    for (let r = rMin; r <= rEnv; r *= 1.08) r0s.push(r);
    report.search = { spokes: nSp, r0Candidates: r0s.length };

    const inside = (p) => Geo.envInside(env, p, 1e-12) && V.dist(p, S) >= keep * (1 - 1e-12);
    const spokes = [];
    for (let j = 0; j < nSp; j++) {
      const pa = ph0 + j * phSpan / nSp, pb = ph0 + (j + 1) * phSpan / nSp, pc = 0.5 * (pa + pb);
      // flux density in θ for this spoke (integrated over its φ range with the real distribution)
      const NF = 720, dens = new Float64Array(NF + 1), cdf = new Float64Array(NF + 1);
      const NPS = 8;
      for (let i = 0; i <= NF; i++) {
        const th = i / NF * thCap; let s = 0;
        for (let q = 0; q < NPS; q++) s += Solver.intensityToward(src, fr, Solver.dirOf(F, th, pa + (q + 0.5) / NPS * (pb - pa)));
        dens[i] = s * Math.sin(th) * (pb - pa) / NPS;
      }
      for (let i = 1; i <= NF; i++) cdf[i] = cdf[i - 1] + 0.5 * (dens[i] + dens[i - 1]) * thCap / NF;
      const ftot = cdf[NF];
      if (!(ftot > 0)) { spokes.push({ j, pa, pb, pc, flux: 0 }); continue; }
      const thAt = (f) => {                       // inverse CDF
        let lo = 0, hi = NF; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] <= f) lo = m; else hi = m; }
        const t = (f - cdf[lo]) / Math.max(1e-300, cdf[hi] - cdf[lo]);
        return (lo + t) / NF * thCap;
      };
      const fluxAt = (th) => { const x = th / thCap * NF, i = Math.min(NF - 1, Math.floor(x)), t = x - i; return cdf[i] + (cdf[i + 1] - cdf[i]) * t; };
      // micro-cells: union of equal-flux and ≤2.5° boundaries
      const bset = new Set([0, thCap]);
      for (let i = 1; i < 48; i++) bset.add(thAt(i / 48 * ftot));
      for (let t = 2.5 * D2R; t < thCap; t += 2.5 * D2R) bset.add(t);
      const tb = [...bset].sort((a, b) => a - b);
      const M = tb.length - 1;
      const cellFlux = []; for (let m = 0; m < M; m++) cellFlux.push(fluxAt(tb[m + 1]) - fluxAt(tb[m]));
      // march every candidate curve over all micro-cells, keep the best inside-run
      let best = null;
      for (const r0 of r0s) {
        let r = r0;
        const planes = [], ins = [];
        for (let m = 0; m < M; m++) {
          const Pst = V.madd(S, Solver.dirOf(F, tb[m], pc), r);
          const n = V.norm(V.add(V.norm(V.sub(S, Pst)), V.norm(V.sub(Zc, Pst))));
          const k = V.dot(n, V.sub(Pst, S));      // negative: n faces the source
          const rad = (th, ph) => { const d = Solver.dirOf(F, th, ph), den = V.dot(n, d); return den < 0 ? k / den : NaN; };
          const rb = rad(tb[m + 1], pc);
          const cr = [rad(tb[m], pa), rad(tb[m], pb), rad(tb[m + 1], pa), rad(tb[m + 1], pb)];
          if (!(rb > 0) || cr.some((x) => !(x > 0)) || rb > 50 * rEnv) break;       // curve ends (grazing)
          const cornersIn = inside(Pst) && inside(V.madd(S, Solver.dirOf(F, tb[m], pa), cr[0])) && inside(V.madd(S, Solver.dirOf(F, tb[m], pb), cr[1])) &&
            inside(V.madd(S, Solver.dirOf(F, tb[m + 1], pa), cr[2])) && inside(V.madd(S, Solver.dirOf(F, tb[m + 1], pb), cr[3]));
          planes.push({ Pst, n, k, r });
          ins.push(cornersIn);
          r = rb;
        }
        // longest contiguous inside run by flux
        let m = 0;
        while (m < ins.length) {
          if (!ins[m]) { m++; continue; }
          let e = m, f = 0; while (e < ins.length && ins[e]) { f += cellFlux[e]; e++; }
          if (!best || f > best.flux * (1 + 1e-12) || (Math.abs(f - best.flux) <= 1e-12 * f && r0 > best.r0)) best = { flux: f, r0, m0: m, m1: e, planes: planes.slice() };
          m = e;
        }
      }
      spokes.push({ j, pa, pb, pc, tb, cellFlux, fluxAt, thAt, ftot, best, flux: best ? best.flux : 0 });
    }

    // ---- allocate facets to spokes by captured flux (largest remainder)
    const Fcap = spokes.reduce((s, sp) => s + sp.flux, 0);
    if (!(Fcap > 0)) { report.error = 'No facet fits inside the envelope with a line of sight to the source.'; return { surfaces: [], report }; }
    const act = spokes.filter((sp) => sp.flux > 0);
    const quota = act.map((sp) => budget * sp.flux / Fcap);
    const nAlloc = quota.map((q) => Math.max(1, Math.floor(q)));
    let left = budget - nAlloc.reduce((a, b) => a + b, 0);
    const rema = quota.map((q, i) => [q - Math.floor(q), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (let t = 0; left > 0 && t < rema.length; t++, left--) nAlloc[rema[t][1]]++;
    while (left < 0) { const i = nAlloc.indexOf(Math.max(...nAlloc)); nAlloc[i]--; left++; }

    // ---- carve equal-flux facets along each spoke's chosen curve
    const items = [];
    act.forEach((sp, ai) => {
      const b = sp.best, nf = nAlloc[ai];
      if (nf <= 0) return;
      let thS = sp.tb[b.m0], thE = sp.tb[b.m1];
      if ((thE - thS) / nf > MAXA) {                // budget-limited: brightest θ window of nf·MAXA
        const w = nf * MAXA; let bestF = -1, bs = thS;
        for (let t = thS; t + w <= thE + 1e-12; t += 0.25 * D2R) { const f = sp.fluxAt(t + w) - sp.fluxAt(t); if (f > bestF) { bestF = f; bs = t; } }
        thS = bs; thE = bs + w;
      }
      const fS = sp.fluxAt(thS), fE = sp.fluxAt(thE);
      const radiusOnCurve = (th) => {          // curve radius at θ from the micro-plane containing it
        let m = b.m0; while (m + 1 < b.m1 && sp.tb[m + 1] <= th) m++;
        const pl = b.planes[m], d = Solver.dirOf(F, th, sp.pc);
        return pl.k / V.dot(pl.n, d);
      };
      for (let i = 0; i < nf; i++) {
        const fa = fS + (fE - fS) * i / nf, fb = fS + (fE - fS) * (i + 1) / nf;
        const ta = i === 0 ? thS : sp.thAt(fa), tbb = i === nf - 1 ? thE : sp.thAt(fb), tc = sp.thAt(0.5 * (fa + fb));
        const dir = Solver.dirOf(F, tc, sp.pc);
        items.push({ spoke: sp.j, ta, tb: tbb, tc, pa: sp.pa, pb: sp.pb, pc: sp.pc, w: fb - fa, dir, rc: radiusOnCurve(tc), pq: Solver.areaMap(F, dir) });
      }
    });
    const zones = Solver.partitionZones(items.map((it) => ({ w: it.w, p: it.pq[0], q: it.pq[1] })), info);

    // ---- build facets
    const surfaces = [];
    const refl = scene.modeA.reflectivity;
    const curved = scene.modeA.facetType === 'curved';
    let pulled = 0, dropped = 0, clamped = 0;
    items.forEach((it, idx) => {
      const z = zones[idx];
      if (!z || z.empty) { dropped++; return; }
      const Z = RF.Engine.targetUVtoWorld(T, z.aim[0], z.aim[1]);
      const cornerDirs = [[it.ta, it.pa], [it.tb, it.pa], [it.tb, it.pb], [it.ta, it.pb]].map(([t, p]) => Solver.dirOf(F, t, p));
      let built = null;
      for (let shrink = 1; shrink >= 0.35 && !built; shrink *= 0.95) {
        const P = V.madd(S, it.dir, it.rc * shrink);
        const fq = Geo.facetQuadric(P, S, Z, null);
        const k = V.dot(fq.n, V.sub(P, S));
        const flat3 = cornerDirs.map((d) => { const den = V.dot(fq.n, d); return den < 0 ? V.madd(S, d, k / den) : null; });
        if (flat3.some((p) => !p)) continue;
        let pts3 = flat3, di = null, tile = null;
        const { ex, ey } = Solver.facetFrame(fq, null);
        const apCov = Solver.apertureCov({ kind: 'poly', pts3: flat3 }, P, ex, ey);
        if (curved) {
          const sv = Solver.solveVergence(T, src, { P, S0: S, Z, apCov }, z.sigma);
          if (!sv.ok) continue;
          di = sv.di; tile = sv;
          const cq = Geo.facetQuadric(P, S, Z, di);
          pts3 = cornerDirs.map((d, ci) => {
            const roots = Geo.quadricRay(cq.A, cq.b, P, S, d).filter((t) => t > 0);
            if (!roots.length) return null;
            const want = V.dist(S, flat3[ci]);
            const t = roots.reduce((m, x) => (Math.abs(x - want) < Math.abs(m - want) ? x : m), Infinity);
            return V.madd(S, d, t);
          });
          if (pts3.some((p) => !p)) continue;
        } else {
          tile = Solver.tileModel(T, src, { P, S0: S, Z, flat: true, apCov });
        }
        if (!pts3.every((p) => Geo.envInside(env, p, 1e-9) && V.dist(p, S) >= keep * (1 - 1e-9)) || !Geo.envInside(env, P, 1e-9)) continue;
        built = { P, pts3, di, tile };
        if (shrink < 1) pulled++;
      }
      if (!built) { dropped++; return; }
      if (built.tile && built.tile.clamped) clamped++;
      const id = 'A' + idx;
      surfaces.push({
        type: 'facet', id, group: 'A', P: built.P, S0: S.slice(), Z, flat: !curved, di: curved ? built.di : null,
        clip: { kind: 'poly', pts3: built.pts3 }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
        info: { zone: idx, zoneSigma: z.sigma, tileSigma: built.tile ? built.tile.sigma : null, minSigma: built.tile ? (built.tile.sigmaMin || built.tile.sigmaS) : null, flux: it.w / Itot },
      });
    });
    report.ok = surfaces.length > 0;
    report.capturedFraction = items.reduce((s, it) => s + it.w, 0) / Itot;
    report.facetFluxFraction = surfaces.reduce((s, f) => s + f.info.flux, 0);
    report.placed = surfaces.length; report.pulled = pulled; report.dropped = dropped; report.clamped = clamped;
    report.spokes = spokes.map((sp) => ({ j: sp.j, flux: sp.flux / Itot, r0: sp.best ? sp.best.r0 : null, span: sp.best ? [sp.tb[sp.best.m0] / D2R, sp.tb[sp.best.m1] / D2R] : null }));
    report.frame = { w0: F.w0, e1: F.e1, e2: F.e2, Zc };
    if (dropped) report.warnings.push(dropped + ' facet(s) could not be placed inside the envelope and were dropped.');
    if (clamped) report.warnings.push(clamped + ' zone(s) are smaller than the source image through their facet (minimum-feature limit).');
    return { surfaces, report };
  }

  RF.ModeA = { generate };
})(typeof globalThis !== 'undefined' ? globalThis : this);
