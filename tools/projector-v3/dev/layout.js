/* layout.js — where the lens, the focus and the shield go, and how deep each reflector cell can sit.
 *   lens candidate c = { n, f, a, kind, k, beta, back, yA, zA }   (back = how far the lens exit sits behind the envelope front)
 *   lay = { L, c, F (paraxial focus), O (entry vertex), xL, f, a, tanMax, D (focus distance from the LED), shield }                           */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, D2R = Math.PI / 180;

  function lensFor(P, c) {
    const key = [c.n, c.f, c.a, c.kind, c.k, c.beta].join('|'); P.lensCache = P.lensCache || new Map();
    if (!P.lensCache.has(key)) P.lensCache.set(key, P3.makeLens(c.n, c.f, c.a, c.kind, c.k, c.beta));
    return P.lensCache.get(key);
  }
  function placeLens(P, c) {
    const why = (r) => { P.why = P.why || {}; P.why[r] = (P.why[r] || 0) + 1; return null; };
    const L = lensFor(P, c); if (!L) return why('no lens design'); if (L.tanAcc < 0.3) return why('lens accepts too narrow a cone');
    const E = P.E, S0 = P.Lp, keep = P.keep, xExit = E.xmax - 0.6 - c.back, xL = xExit - L.t, F = [xL - L.bfd, c.yA, c.zA];
    for (let i = 0; i < 12; i++) { const cs = Math.cos(i * Math.PI / 6) * c.a, sn = Math.sin(i * Math.PI / 6) * c.a; for (const x of [xL + L.sag0, xL + L.t + L.sag1, xL + L.t]) if (!E.inside([x, c.yA + cs, c.zA + sn], 0.2)) return why('lens does not fit the envelope'); }
    if (S0[0] > xL - keep - 1 && Math.hypot(S0[1] - c.yA, S0[2] - c.zA) < c.a + keep + 1) return why('LED inside the lens');
    if (F[0] < E.xmin + 3) return why('focus behind the envelope'); if (F[0] - S0[0] < 8) return why('focus less than 8 mm ahead of the LED');
    return { L, c, F, O: [xL, c.yA, c.zA], xL, xExit, f: c.f, a: c.a, tanMax: 0.85 * L.tanAcc, D: V.dist(S0, F), u: V.sub(F, S0) };
  }
  // the focal-surface point whose bundle leaves the lens toward the far-field direction (h, v) degrees (the lens inverts)
  function imgPointDir(lay, d, dzExtra) {
    const L = lay.L, F = lay.F, ty = -d[1] / d[0], tz = -d[2] / d[0], tt = Math.hypot(ty, tz), th = Math.atan(tt) / D2R, m = P3.mapAt(L, th), sc = tt > 1e-9 ? m.rho / tt : lay.f;
    return [F[0] + m.dz + (dzExtra || 0), F[1] + ty * sc, F[2] + tz * sc];
  }
  const imgPoint = (P, lay, h, v, dzExtra) => imgPointDir(lay, RF.FarField.dirOf(h, v, P.conv), dzExtra);

  // the shield: a sheet near the focal surface whose edge is the cut-off line mapped through the lens (its field curvature fitted)
  function shieldFor(P, lay, s, dTop) {      // dTop: a number (the whole edge) or { L, R } (the left / right of the beam, own side R)
    if (!P.cut || s.shield === 'off') return null;
    const { F, f, a, L } = lay, E = P.E, fm = /fmvss/i.test(P.spec.preset || '');
    const defocus = s.shieldDefocus >= 0 ? s.shieldDefocus : (fm ? 0 : 0.12 * f / 12), W = Math.min(a * 1.15, f * Math.tan(s.spread * D2R) + 2), NE = 28, edge = [], top0 = P.cut.top, dL = typeof dTop === 'object' && dTop ? dTop.L : (dTop || 0), dR = typeof dTop === 'object' && dTop ? dTop.R : (dTop || 0), top = (h) => top0(h) - (h * P.cut.own > 0 ? dR : dL);
    for (let i = 0; i <= NE; i++) {
      const dy = -W + 2 * W * i / NE; let lo = -60, hi = 60;
      for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (imgPoint(P, lay, m, top(m))[1] - F[1] < dy) lo = m; else hi = m; }
      const H = (lo + hi) / 2; edge.push(imgPoint(P, lay, H, top(H), defocus));
    }
    let zb = F[2] - a - 1; for (let it = 0; it < 60 && (!E.inside([F[0], F[1] + W, zb], 0.3) || !E.inside([F[0], F[1] - W, zb], 0.3)); it++) zb += 0.5;
    const xc = F[0] + defocus; let num = 0, den = 0; for (const p of edge) { const dy = p[1] - F[1]; num += (p[0] - xc) * dy * dy; den += 0.5 * dy ** 4; }
    const cy = s.shieldCurved && den > 0 ? num / den : 0, xOn = (y) => xc + 0.5 * cy * (y - F[1]) ** 2;
    const pts = edge.map((p) => [xOn(p[1]), p[1], p[2]]).concat([[xOn(F[1] + W), F[1] + W, zb], [xOn(F[1] - W), F[1] - W, zb]]), ctr = [xc, F[1], (F[2] + zb) / 2];
    for (const p of pts) for (let it = 0; it < 30 && !E.inside(p, 0.2); it++) { p[1] = ctr[1] + (p[1] - ctr[1]) * 0.93; p[2] = ctr[2] + (p[2] - ctr[2]) * 0.93; p[0] = xOn(p[1]); }      // hard envelope clip
    const ne = edge.length, ed = pts.slice(0, ne).map((p) => [p[1], p[2]]).sort((p, q) => p[0] - q[0]);
    return { xc, cy, yF: F[1], edge: ed, zb: Math.max(zb, pts[ne][2], pts[ne + 1][2]), W, defocus, pts, ne, zbRaw: zb };
  }

  // ---------------------------------------------------------------- reflector depth along a direction d (unit, from the LED)
  // Candidates: the confocal ellipsoids (foci LED, F) of path length Lb·mul, plus the envelope-hugging depth.  Each must: sit inside the envelope, stay behind the focal
  // surface, send its chief ray into the lens aperture (tan ≤ tanMax), not graze (< 72° incidence), and not hide behind another facet (shell test).
  // Score = image sharpness − a penalty for leaving the base path length (keeps the depth map near-consistent).
  const LMUL = [1, 0.92, 1.08, 0.85, 1.17, 0.78, 1.28, 1.42];
  function depthChoice(P, lay, d, rmax, shell, Lb, cheap, s) {
    const { F, a } = lay, S = P.Lp, u = lay.u, D = lay.D, keep = P.keep, tanMax = lay.tanMax; let best = null;
    const rhos = [];
    for (const mul of cheap ? [1] : LMUL) { const Lc = Lb * mul; if (Lc > D + 0.5) rhos.push((Lc * Lc - D * D) / (2 * (Lc - V.dot(d, u)))); }
    rhos.push(rmax - 0.5);
    for (const rho of rhos) {
      if (!(rho > keep + 1) || rho > rmax - 0.3) continue;
      const Pp = V.add(S, V.mul(d, rho)), w = V.sub(F, Pp), lw = V.len(w);
      if (w[0] < 1) continue;
      if (Math.hypot(w[1], w[2]) / w[0] > tanMax) continue;
      if (V.dot(d, w) / lw > 0.81) continue;
      if (shell && shell(Pp, F)) continue;
      const m = lw / rho, img = m * P.ledW / lay.f / D2R, q = 1 / (1 + img / 4), Lc = rho + lw, sc = q - s.depthPenalty * Math.abs(Math.log(Lc / Lb));
      if (!best || sc > best.sc) best = { rho, P: Pp, q, m, sc, Lc };
    }
    return best;
  }
  P3.placeLens = placeLens; P3.imgPoint = imgPoint; P3.imgPointDir = imgPointDir; P3.shieldFor = shieldFor; P3.depthChoice = depthChoice; P3.lensFor = lensFor;
})();
