/* cells.js — the reflector's cells over the LED's whole emission sphere: directions with their lumens, which of them a lens-path facet can serve,
 * flux-equalised k-means cells (spherical Voronoi), and the depth map (each cell picks its own distance along its ray).
 *   dirs(P, N)            → { n, u (xyz), w (lm), rEnv }
 *   pickLb(P, lay, D, s)  → base path length Lb (mm) and the proxy score of the layout (flux-weighted image sharpness over the directions a facet can use)
 *   makeCells(P, lay, D, ok, K, s) → cells [{ j, c (unit centre), poly (gnomonic vertices), P (depth point), rho, Lc, m, q, flux, members }] */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, D2R = Math.PI / 180;

  function rhoEnv(P, d) {
    const S = P.Lp, E = P.E, keep = P.keep; if (!E.inside(V.add(S, V.mul(d, keep + 1)), 0.5)) return 0;
    let lo = keep + 1, hi = 600; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (E.inside(V.add(S, V.mul(d, m)), 0.5)) lo = m; else hi = m; } return lo;
  }
  function dirs(P, N) {
    const u = P3.fibSphere(N), w = new Float64Array(N), rEnv = new Float64Array(N); let tot = 0;
    for (let i = 0; i < N; i++) { const d = [u[3 * i], u[3 * i + 1], u[3 * i + 2]]; w[i] = P.I(d) * 4 * Math.PI / N; tot += w[i]; rEnv[i] = rhoEnv(P, d); }
    return { n: N, u, w, rEnv, tot };
  }
  const dirAt = (D, i) => [D.u[3 * i], D.u[3 * i + 1], D.u[3 * i + 2]];
  const LF = [1.1, 1.2, 1.3, 1.45, 1.6, 1.8, 2.0, 2.3, 2.7, 3.2, 4.0];
  function pickLb(P, lay, D, s) {
    let best = { Lb: lay.D * 1.5, sc: -1 };
    for (const lf of LF) {
      let sc = 0; for (let i = 0; i < D.n; i += 2) { if (!(D.w[i] > 0) || D.rEnv[i] <= P.keep + 1.5) continue; const c = P3.depthChoice(P, lay, dirAt(D, i), D.rEnv[i], null, lay.D * lf, true, s); if (c) sc += D.w[i] * c.q; }
      if (sc > best.sc) best = { Lb: lay.D * lf, sc };
    }
    best.proxy = 2 * best.sc / Math.max(1e-9, D.tot); return best;
  }
  // flux-equalised k-means on the sphere: weights w² make the centre density follow w (2-D k-means density ∝ weight^½), so every cell holds about the same lumens
  function kmeansSphere(D, ok, K, iters, wexp) {
    const idx = []; for (let i = 0; i < D.n; i++) if (ok[i] && D.w[i] > 0) idx.push(i);
    K = Math.min(K, idx.length); if (K < 1) return [];
    const wt = (i) => Math.pow(D.w[i], wexp || 2), cs = [], dmin = new Float64Array(D.n).fill(Infinity);
    let first = idx[0]; for (const i of idx) if (D.w[i] > D.w[first]) first = i;
    cs.push(dirAt(D, first));
    while (cs.length < K) {
      const c = cs[cs.length - 1]; let bi = -1, bv = -1;
      for (const i of idx) { const dx = D.u[3 * i] - c[0], dy = D.u[3 * i + 1] - c[1], dz = D.u[3 * i + 2] - c[2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < dmin[i]) dmin[i] = d2; const v = dmin[i] * wt(i); if (v > bv) { bv = v; bi = i; } }
      cs.push(dirAt(D, bi));
    }
    const own = new Int32Array(D.n).fill(-1);
    for (let it = 0; it < iters; it++) {
      const sx = new Float64Array(K), sy = new Float64Array(K), sz = new Float64Array(K);
      for (const i of idx) { let bj = 0, bd = -2; const x = D.u[3 * i], y = D.u[3 * i + 1], z = D.u[3 * i + 2]; for (let j = 0; j < K; j++) { const d = x * cs[j][0] + y * cs[j][1] + z * cs[j][2]; if (d > bd) { bd = d; bj = j; } } own[i] = bj; const w = wt(i); sx[bj] += w * x; sy[bj] += w * y; sz[bj] += w * z; }
      for (let j = 0; j < K; j++) { const l = Math.hypot(sx[j], sy[j], sz[j]); if (l > 0) cs[j] = [sx[j] / l, sy[j] / l, sz[j] / l]; }
    }
    return cs.map((c, j) => ({ j, c, members: idx.filter((i) => own[i] === j) })).filter((x) => x.members.length > 0);
  }
  // the spherical Voronoi cell of centre j as a convex polygon in gnomonic coordinates about it (great circles are straight lines there)
  function voronoi(cells, j, B) {                // cells = every centre of both classes ({ c }), so the polygons partition the whole sphere
    const c = cells[j].c, [e1, e2] = V.basis(c); let poly = [[-B, -B], [B, -B], [B, B], [-B, B]];
    for (let m = 0; m < cells.length && poly.length >= 3; m++) {
      if (m === j) continue; const q = cells[m].c, g = [c[0] - q[0], c[1] - q[1], c[2] - q[2]];
      poly = P3.clipHalf(poly, V.dot(g, e1), V.dot(g, e2), 1 - V.dot(c, q));
    }
    return { poly, e1, e2 };
  }
  const gnomonic = (c, e1, e2, x, y) => V.norm([c[0] + x * e1[0] + y * e2[0], c[1] + x * e1[1] + y * e2[1], c[2] + x * e1[2] + y * e2[2]]);

  function makeCells(P, lay, D, ok, K, s, centresL, centresD) {
    const cs = centresL || kmeansSphere(D, ok, K, 14, 2); if (!cs.length) return [];
    const all = cs.concat(centresD || []);
    const S = P.Lp, E = P.E, keep = P.keep, F = lay.F, u = lay.u, DF = lay.D;
    for (const c of cs) { c.flux = 0; for (const i of c.members) c.flux += D.w[i]; const vv = voronoi(all, all.indexOf(c), 1.2); c.poly = vv.poly; c.e1 = vv.e1; c.e2 = vv.e2; c.vdirs = vv.poly.map((p) => gnomonic(c.c, vv.e1, vv.e2, p[0], p[1])); c.rmax = rhoEnv(P, c.c); }
    // ONE base ellipsoid (path length Lb) for every cell: a continuous cup, so a reflected ray never runs into a neighbouring facet (letting every cell pick its own depth made
    // 40 % of the light hit other facets).  A cell whose base depth does not fit (envelope, lens cone, grazing) is dropped, not moved.
    for (const c of cs) { c.ch = P3.depthChoice(P, lay, c.c, Math.max(0, c.rmax), null, lay.Lb, true, s); }
    return cs.filter((c) => c.ch).map((c, k) => Object.assign(c, { k, P: c.ch.P, rho: c.ch.rho, Lc: c.ch.Lc, m: c.ch.m, q: c.ch.q }));
  }

  // ---- lens-bypass cells: directions the lens path cannot use.  A facet there sits as far out as the envelope allows (a big, flat-ish mirror = a sharp image), beside the lens
  // (its outgoing ray must clear the lens barrel: lateral distance from the lens axis ≥ a + 4), and bends the light by a real angle (d·x̂ < 0.85, no grazing).
  function directOk(P, lay, D, s, excl) {
    const ok = new Uint8Array(D.n), S = P.Lp; let flux = 0, rho = new Float64Array(D.n);
    for (let i = 0; i < D.n; i++) {
      if (!(D.w[i] > 0) || (excl && excl[i])) continue; const d = dirAt(D, i); if (d[0] > 0.85) continue; let r = D.rEnv[i] - 0.5; if (r <= P.keep + 2) continue;
      // push out until the lateral distance from the lens axis clears the barrel (the farther the better, so take the envelope-limited depth and check it)
      const Pp = V.add(S, V.mul(d, r)); if (Math.hypot(Pp[1] - lay.c.yA, Pp[2] - lay.c.zA) < lay.a + 4) continue;
      ok[i] = 1; rho[i] = r; flux += D.w[i];
    }
    return { ok, flux, rho };
  }
  function makeCellsDirect(P, lay, D, dk, K, s, centresD, centresL) {
    const cs = centresD; if (!cs.length) return [];
    const all = (centresL || []).concat(cs);
    for (const c of cs) { c.flux = 0; for (const i of c.members) c.flux += D.w[i]; const vv = voronoi(all, all.indexOf(c), 1.2); c.poly = vv.poly; c.e1 = vv.e1; c.e2 = vv.e2; }
    const S = P.Lp, out = [], an = RF.FarField.dirOf(0, -3, P.conv), E = P.E, keep = P.keep;
    for (const c of cs) {
      // the depth that lets the most of the cell's light find a mirror: a paraboloid (focus = LED, axis = the nominal aim) through the centre point, vertices/members that map outside
      // the envelope, inside the LED clearance or into the lens barrel are lost, so try a few depths between the wall and a third of it
      const rw = rhoEnv(P, c.c) - 0.5; let best = null;
      for (const f of [0.97, 0.85, 0.72, 0.6, 0.48, 0.38]) {
        const r = rw * f; if (r <= keep + 2) continue; const Pp = V.add(S, V.mul(c.c, r)), c0 = r * (1 - V.dot(c.c, an)); if (!(c0 > 1e-6)) continue;
        let fit = 0; for (const i of c.members) { const d = dirAt(D, i), den = 1 - V.dot(d, an); if (!(den > 1e-6)) continue; const p = V.add(S, V.mul(d, c0 / den)); if (E.inside(p, 0.15) && V.dist(p, S) > keep + 0.3 && Math.hypot(p[1] - lay.c.yA, p[2] - lay.c.zA) >= lay.a + 2) fit += D.w[i]; }
        if (!best || fit > best.fit * 1.02) best = { r, Pp, fit };
      }
      if (!best || best.fit < 0.4 * c.flux) continue;
      out.push(Object.assign(c, { k: out.length, P: best.Pp, rho: best.r, direct: true, fit: best.fit }));
    }
    return out;
  }
  P3.directOk = directOk; P3.makeCellsDirect = makeCellsDirect; P3.kmeansSphere = kmeansSphere;
  P3.dirs = dirs; P3.dirAt = dirAt; P3.pickLb = pickLb; P3.makeCells = makeCells; P3.gnomonic = gnomonic; P3.rhoEnv = rhoEnv;
})();
