/* continuous.js — the CONTINUOUS mode (Liou 2009's real thing): one smooth reflector instead of independently aimed facets.
 * The stepped design's per-facet choices — first focus t along the emitter axis, aim (h, v) — are fitted with SMOOTH fields over the bowl (Fourier in the
 * azimuth φ × a quadratic in the polar angle θ, flux-weighted), then a regular mesh (rings × sectors, shared corners) is built on the base ellipsoid and every
 * patch is the local ellipsoid those fields give at its centre.  Neighbouring patches differ only by the fields' gradient, so the steps shrink with the mesh
 * (tools/projector-liou/steps.js measures them).  v is fitted from BELOW (asymmetric weights) so smoothing does not lift images over the line.
 *   RF.P3.continuousSurface(P, lay, s, ctx) → { facets, fit } | null
 *   ctx = { cL, fpL, recL, lensI, leakAt, postL, G, top }  (from main.js design()) */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {};

  // basis functions of (θ, φ): u = θ scaled to [−1, 1] over the bowl; Fourier order M in φ, Legendre order N in u
  function basis(M, N) {
    const fs = [];
    for (let n = 0; n <= N; n++) {
      const Pn = n === 0 ? () => 1 : n === 1 ? (u) => u : (u) => 1.5 * u * u - 0.5;
      fs.push((u, ph) => Pn(u));
      for (let m = 1; m <= M; m++) { fs.push((u, ph) => Pn(u) * Math.cos(m * ph)); fs.push((u, ph) => Pn(u) * Math.sin(m * ph)); }
    }
    return fs;
  }
  // weighted least squares with a small ridge: rows X (n × k), targets y, weights w → coefficients
  function wls(X, y, w, ridge) {
    const k = X[0].length, A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k);
    for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { b[a] += w[i] * X[i][a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += w[i] * X[i][a] * X[i][c]; }
    for (let a = 0; a < k; a++) A[a][a] += ridge;
    for (let i = 0; i < k; i++) {                      // Gauss–Jordan with partial pivoting
      let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; const d = A[i][i] || 1e-12;
      for (let c = 0; c < k; c++) A[i][c] /= d; b[i] /= d;
      for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i]; if (!f) continue; for (let c = 0; c < k; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    return b;
  }

  function continuousSurface(P, lay, s, ctx) {
    const { cL, fpL, recL, lensI, leakAt, postL, G } = ctx, S = P.Lp, src = P.src; let cVv;
    if (!recL.length) return null;
    const W = V.norm(lay.u), [e1, e2] = V.basis(W), ax = V.norm(src.axis || [1, 0, 0]), half = Math.max(0, (src.length || 0) / 2 - 0.1);
    const polar = (d) => { const c = Math.max(-1, Math.min(1, V.dot(d, W))); return [Math.acos(c), Math.atan2(V.dot(d, e2), V.dot(d, e1))]; };
    // samples: one per placed facet
    const smp = recL.map((rec) => { const c = cL[rec.k], fp = fpL[rec.k][rec.alt], S0 = fp.s0 || S, [th, ph] = polar(c.c); return { th, ph, t: half > 0 ? V.dot(V.sub(S0, S), ax) / half : 0, h: rec.aim[0], v: rec.aim[1], w: Math.max(1e-6, fp.flux) }; });
    let thMin = Math.min(...cL.map((c) => polar(c.c)[0])), thMax = Math.max(...cL.map((c) => polar(c.c)[0]));
    const uOf = (th) => (2 * (th - thMin) / Math.max(1e-9, thMax - thMin)) - 1;
    const fs = basis(s.contM, s.contN), row = (th, ph) => fs.map((f) => f(uOf(th), ph)), X = smp.map((q) => row(q.th, q.ph)), w = smp.map((q) => q.w), ridge = 1e-3 * w.reduce((a, b) => a + b, 0) / w.length;
    const cT = wls(X, smp.map((q) => q.t), w, ridge), cH = wls(X, smp.map((q) => q.h), w, ridge);
    // v from below: a sample the fit overshoots (would lift its image over the line) weighs 20× more next round
    cVv = wls(X, smp.map((q) => q.v), w, ridge); const wv = w.slice();
    for (let it = 0; it < 8; it++) { let any = false; X.forEach((x, i) => { const f = x.reduce((a, xi, j) => a + xi * cVv[j], 0); if (f > smp[i].v + 0.05) { wv[i] *= 20; any = true; } }); if (!any) break; cVv = wls(X, smp.map((q) => q.v), wv, ridge); }
    const ev = (c, th, ph) => row(th, ph).reduce((a, x, j) => a + x * c[j], 0);
    // contV 'snap' (Liou's rule): every patch as HIGH as it can go without leaking — found per mesh patch from its own footprint — then fitted smoothly from below
    let snapNote = '';
    if (s.contV === 'snap' && ctx.top) {
      const nR0 = s.contRings, nS0 = s.contSectors, vs = [], Xs = [], ws = [], tolS = s.leak;
      const Dv0 = lay.u, D0 = V.len(Dv0), rb = (d) => (lay.Lb * lay.Lb - D0 * D0) / (2 * (lay.Lb - V.dot(d, Dv0)));
      const dir0 = (th, ph) => V.norm(V.add(V.mul(W, Math.cos(th)), V.add(V.mul(e1, Math.sin(th) * Math.cos(ph)), V.mul(e2, Math.sin(th) * Math.sin(ph)))));
      for (let r = 0; r < nR0; r++) for (let q = 0; q < nS0; q++) {
        const t0 = thMin + (thMax - thMin) * r / nR0, t1 = thMin + (thMax - thMin) * (r + 1) / nR0, p0 = 2 * Math.PI * q / nS0, p1 = 2 * Math.PI * (q + 1) / nS0, tc = (t0 + t1) / 2, pc = (p0 + p1) / 2;
        const c = dir0(tc, pc), rho = rb(c); if (!(rho > P.keep + 1)) continue;
        const [ce1, ce2] = V.basis(c), gn = (d) => { const k = V.dot(d, c); return [V.dot(d, ce1) / k, V.dot(d, ce2) / k]; };
        const cell = { c, e1: ce1, e2: ce2, poly: [dir0(t0, p0), dir0(t0, p1), dir0(t1, p1), dir0(t1, p0)].map(gn), P: V.add(S, V.mul(c, rho)) };
        const t = Math.max(-1, Math.min(1, ev(cT, tc, pc))), S0 = V.add(S, V.mul(ax, t * half)), h = ev(cH, tc, pc), v0 = ctx.top(h) - 3;
        const f = P3.facetOf(P, lay, cell, lensI([h, v0]), 'tmp', S0), fp = f ? P3.footOf(P, f, postL, G, 16) : null; if (!fp) continue;
        const tol = tolS * fp.flux; let lo = fp.rj - 300, hi = fp.rj + 200;
        if (leakAt(fp, fp.ri, lo) > tol) continue; if (leakAt(fp, fp.ri, hi) <= tol) lo = hi; else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (leakAt(fp, fp.ri, m) > tol) hi = m; else lo = m; }
        vs.push(v0 + (lo - fp.rj) * G.step); Xs.push(row(tc, pc)); ws.push(fp.flux);
      }
      if (vs.length > fs.length) {
        let wv2 = ws.slice(); cVv = wls(Xs, vs, wv2, ridge);
        for (let it = 0; it < 10; it++) { let any = false; Xs.forEach((x, i) => { const f = x.reduce((a, xi, j) => a + xi * cVv[j], 0); if (f > vs[i] + 0.05) { wv2[i] *= 20; any = true; } }); if (!any) break; cVv = wls(Xs, vs, wv2, ridge); }
        const rmsS = Math.sqrt(Xs.reduce((a, x, i) => a + ws[i] * (x.reduce((b, xi, j) => b + xi * cVv[j], 0) - vs[i]) ** 2, 0) / ws.reduce((a, b) => a + b, 0));
        snapNote = `v = highest no-leak height per patch (${vs.length} patches, span ${Math.min(...vs).toFixed(1)}…${Math.max(...vs).toFixed(1)}°, smooth fit rms ${rmsS.toFixed(1)}°)`;
      }
    }
    const rms = (c, key) => Math.sqrt(smp.reduce((a, q) => a + q.w * (ev(c, q.th, q.ph) - q[key]) ** 2, 0) / smp.reduce((a, q) => a + q.w, 0));


    const fit = { rmsT: rms(cT, 't'), rmsH: rms(cH, 'h'), rmsV: rms(cVv, 'v'), terms: fs.length, samples: smp.length, snapNote };
    // the mesh: nR rings × nS sectors between the stepped design's polar limits; corners shared; patch centre on the base ellipsoid
    const nR = s.contRings, nS = s.contSectors, Dv = lay.u, D = V.len(Dv), Lb = lay.Lb, rhoBase = (d) => (Lb * Lb - D * D) / (2 * (Lb - V.dot(d, Dv)));
    const dirAt = (th, ph) => V.norm(V.add(V.mul(W, Math.cos(th)), V.add(V.mul(e1, Math.sin(th) * Math.cos(ph)), V.mul(e2, Math.sin(th) * Math.sin(ph)))));
    // INTEGRATE the surface: unknown y = log ρ at every mesh corner (rings 0…nR × sectors), equations "y(b) − y(a) = target slope × arc" on every edge, where the
    // target slope comes from the normal the fields ask for there (bisector of the directions to the patch's first focus S0 and its image point I):
    // for X = ρ d, n · ∂X/∂s = 0 ⇒ ∂ log ρ / ∂s = −(n · τ) / (n · d).  A weak prior holds the base cup's scale.  What cannot be integrated (curl) is left as aim error.
    const tAt = (th, ph) => Math.max(-1, Math.min(1, ev(cT, th, ph))), aimAt = (th, ph) => [ev(cH, th, ph), ev(cVv, th, ph)];
    const normalAt = (th, ph, X) => { const t = tAt(th, ph), S0 = V.add(S, V.mul(ax, t * half)), I = lensI(aimAt(th, ph)); return V.norm(V.add(V.norm(V.sub(S0, X)), V.norm(V.sub(I, X)))); };
    const thOf = (i) => thMin + (thMax - thMin) * i / nR, phOf = (j) => 2 * Math.PI * j / nS, vid = (i, j) => i * nS + ((j % nS) + nS) % nS, NV = (nR + 1) * nS;
    const y = new Float64Array(NV); for (let i = 0; i <= nR; i++) for (let j = 0; j < nS; j++) y[vid(i, j)] = Math.log(Math.max(1e-3, rhoBase(dirAt(thOf(i), phOf(j)))));
    const yBase = Float64Array.from(y), rhoAtDir = (th, ph, yv) => Math.exp(yv);
    let resid = 0;
    for (let pass = 0; pass < 3; pass++) {
      const A = Array.from({ length: NV }, () => new Float64Array(NV)), b = new Float64Array(NV), eqs = [];
      const edge = (a, c, th, ph, tau, arc) => {
        const d = dirAt(th, ph), X = V.mul(d, Math.exp((y[a] + y[c]) / 2)), Xw = V.add(S, X), nn = normalAt(th, ph, Xw), den = V.dot(nn, d);
        if (Math.abs(den) < 0.05 || !(arc > 1e-6)) return; const g = -V.dot(nn, tau) / den * arc;
        A[a][a] += 1; A[c][c] += 1; A[a][c] -= 1; A[c][a] -= 1; b[a] -= g; b[c] += g; eqs.push([a, c, g, arc]);
      };
      for (let i = 0; i <= nR; i++) for (let j = 0; j < nS; j++) {
        const th = thOf(i), ph = phOf(j);
        if (i < nR) { const tm = (th + thOf(i + 1)) / 2, dth = thOf(i + 1) - th, tau = V.norm(V.sub(dirAt(tm + 1e-4, ph), dirAt(tm - 1e-4, ph))); edge(vid(i, j), vid(i + 1, j), tm, ph, tau, dth); }
        if (Math.sin(th) > 0.02) { const pm = ph + Math.PI / nS, tau = V.norm(V.sub(dirAt(th, pm + 1e-4), dirAt(th, pm - 1e-4))); edge(vid(i, j), vid(i, j + 1), th, pm, tau, Math.sin(th) * 2 * Math.PI / nS); }
      }
      const lam = 0.02; for (let k = 0; k < NV; k++) { A[k][k] += lam; b[k] += lam * yBase[k]; }
      const sol = gaussSolve(A, b); for (let k = 0; k < NV; k++) y[k] = sol[k];
      let se = 0, sa = 0; for (const [a, c, g, arc] of eqs) { se += ((y[c] - y[a]) - g) ** 2 / (arc * arc); sa++; } resid = Math.atan(Math.sqrt(se / Math.max(1, sa))) * 180 / Math.PI;
    }
    const facets = []; let n = 0, dropped = 0;
    for (let r = 0; r < nR; r++) for (let q = 0; q < nS; q++) {
      const t0 = thOf(r), t1 = thOf(r + 1), p0 = phOf(q), p1 = phOf(q + 1), tc = (t0 + t1) / 2, pc = (p0 + p1) / 2;
      const c = dirAt(tc, pc), yc = (y[vid(r, q)] + y[vid(r, q + 1)] + y[vid(r + 1, q)] + y[vid(r + 1, q + 1)]) / 4, rho = Math.exp(yc); if (!(rho > P.keep + 1)) { dropped++; continue; }
      const [ce1, ce2] = V.basis(c), gn = (d) => { const k = V.dot(d, c); return [V.dot(d, ce1) / k, V.dot(d, ce2) / k]; };
      const poly = [dirAt(t0, p0), dirAt(t0, p1), dirAt(t1, p1), dirAt(t1, p0)].map(gn);
      const cell = { c, e1: ce1, e2: ce2, poly, P: V.add(S, V.mul(c, rho)) };
      const t = tAt(tc, pc), S0 = V.add(S, V.mul(ax, t * half)), aim = aimAt(tc, pc);
      const f = P3.facetOf(P, lay, cell, lensI(aim), 'p3_c' + n++, S0); if (!f) { dropped++; continue; }
      f.cls = 'L'; f.cont = { th: tc, ph: pc, t, aim }; facets.push(f);
    }
    fit.normalMismatch = resid;      // rms angle (°) between the integrated surface's slopes and the ones the fields asked for: the non-integrable part
    // leak check of the continuous patches (real footprints): reported, not fixed — sliding a patch alone would break the surface
    let leak = 0, tot = 0;
    for (const f of facets) { const fp = P3.footOf(P, f, postL, G, 16); if (!fp) continue; tot += fp.flux; leak += leakAt(fp, fp.ri, fp.rj); }
    fit.leakShare = tot > 0 ? leak / tot : 0; fit.patches = facets.length; fit.dropped = dropped;
    return { facets, fit };
  }
  function gaussSolve(A, b) {
    const n = b.length; A = A.map((r) => Float64Array.from(r)); b = Float64Array.from(b);
    for (let i = 0; i < n; i++) {
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]]; const d = A[i][i] || 1e-12;
      for (let r = i + 1; r < n; r++) { const f = A[r][i] / d; if (!f) continue; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
    }
    const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let v = b[i]; for (let c = i + 1; c < n; c++) v -= A[i][c] * x[c]; x[i] = v / (A[i][i] || 1e-12); }
    return x;
  }
  P3.continuousSurface = continuousSurface;
})();
