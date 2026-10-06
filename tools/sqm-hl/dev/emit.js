/* emit.js — from a balanced SQM state to facets: scale to the envelope, drop what cannot fit, one exact-quadric facet per cell set. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, C = RF.SqmCore;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // scale the whole surface (every radius) so that `fitShare` of the light fits inside the envelope; directions that still stick out (or sit inside the
  // clearance) are dropped (no mirror: their light leaves unshaped).  Returns { q (scale applied), dropped }.
  function fit(D, on, A, x, fitShare, grow) {
    const as = C.assign(D, on, A, x), rat = []; let tot = 0;
    for (let i = 0; i < D.n; i++) if (on[i] && as.asg[i] >= 0) { rat.push([as.rr[i] / D.rEnv[i], D.m[i]]); tot += D.m[i]; }
    rat.sort((a, b) => a[0] - b[0]); let acc = 0, q = rat.length ? rat[rat.length - 1][0] : 1; for (const r of rat) { acc += r[1]; if (acc >= fitShare * tot) { q = r[0]; break; } }
    if (q > 1 || (grow && Math.abs(q - 1) > 0.002)) for (let j = 0; j < A.length; j++) x[j] -= Math.log(q * 1.002);      // r ∝ β for a far aim
    const a2 = C.assign(D, on, A, x); let dropped = 0;
    for (let i = 0; i < D.n; i++) if (on[i] && (a2.asg[i] < 0 || a2.rr[i] > D.rEnv[i] || a2.rr[i] < D.rMin[i])) { on[i] = 0; dropped++; }
    return { q, dropped };
  }

  // the facet of aim j: its cells, the exact ellipsoid through the cell set's mean direction, clipped to the hull of the cells' corners
  function facetOf(D, A, x, as, j, byJ, o) {
    const cs = byJ[j]; if (!cs || cs.length < 1) return null;
    const a = A[j], Lp = D.Lp; let u = [0, 0, 0], W = 0; for (const i of cs) { u = V.add(u, V.mul([D.ux[i], D.uy[i], D.uz[i]], D.m[i])); W += D.m[i]; } u = V.norm(u);
    const rho = o && o.rho ? o.rho[j] : 1, r0 = rho * C.radius(a, x[j], u), P = V.add(Lp, V.mul(u, r0));
    const Z = a.Z ? a.Z(P) : V.add(P, V.mul([a.ax, a.ay, a.az], 1e6)), di = V.dist(P, Z), n = V.norm(V.add(V.norm(V.sub(Lp, P)), V.norm(V.sub(Z, P))));
    const [ex, ey] = V.basis(n), pts = [], p2 = [];
    for (const i of cs) { const q = D.q[i], aa = D.a[i]; for (const [dq, da] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const w = C.corner(D, q + dq, aa + da), r = rho * C.radius(a, x[j], w); if (!(r > 0) || r > 1e6) continue; const p = V.add(Lp, V.mul(w, r)); pts.push(p); p2.push([V.dot(V.sub(p, P), ex), V.dot(V.sub(p, P), ey)]); } }
    if (p2.length < 3) return null;
    const idx = p2.map((_, i) => i).sort((s, t) => p2[s][0] - p2[t][0] || p2[s][1] - p2[t][1]);
    const cr = (o_, s, t) => (p2[s][0] - p2[o_][0]) * (p2[t][1] - p2[o_][1]) - (p2[s][1] - p2[o_][1]) * (p2[t][0] - p2[o_][0]), lo = [], hi = [];
    for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1)).map((i) => pts[i]); if (hull.length < 3) return null;
    const f = { type: 'facet', id: (o && o.prefix || 'Q') + j, P, S0: Lp.slice(), Z, flat: false, di, clip: { kind: 'poly', pts3: hull }, optics: { interaction: 'reflect', reflectivity: o && o.refl !== undefined ? o.refl : 0.9 } };
    Object.defineProperty(f, '_own', { value: { ex, ey, n, p2, rho, j }, enumerable: false, writable: true });
    return f;
  }
  function emitAll(D, on, A, x, o) {
    const as = C.assign(D, on, A, x), byJ = A.map(() => []);
    for (let i = 0; i < D.n; i++) if (on[i] && as.asg[i] >= 0) byJ[as.asg[i]].push(i);
    const out = []; A.forEach((a, j) => { const f = facetOf(D, A, x, as, j, byJ, o); if (f) { f.aimIndex = j; out.push(f); } });
    return { facets: out, assign: as };
  }
  // a convex hull can cover directions that have NO mirror (they would be reflected, wrongly, by the hull's extra area) — clip every facet's polygon
  // by bisector half-planes until no uncovered direction's ray lands inside it.
  function polyClip(poly, c, p) {            // keep the side of the bisector of (c, p) that holds c
    const mx = (c[0] + p[0]) / 2, my = (c[1] + p[1]) / 2, nx = c[0] - p[0], ny = c[1] - p[1], out = [];
    const side = (q) => (q[0] - mx) * nx + (q[1] - my) * ny;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], sa = side(a), sb = side(b);
      if (sa >= 0) out.push(a); if ((sa >= 0) !== (sb >= 0)) { const t = sa / (sa - sb); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); } }
    return out;
  }
  const area2 = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
  const inside2 = (poly, q) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]); if (c < 0) s |= 1; else if (c > 0) s |= 2; if (s === 3) return false; } return true; };
  function clipConflicts(D, on, A, x, facets, o) {
    const U = []; for (let i = 0; i < D.n; i++) if (!on[i]) U.push(i);
    let clipped = 0, dead = 0, lost = 0;
    for (const f of facets) {
      const w = f._own; if (!w) continue; const a = A[w.j], Lp = D.Lp; let poly = f.clip.pts3.map((q) => [V.dot(V.sub(q, f.P), w.ex), V.dot(V.sub(q, f.P), w.ey)]); const a0 = area2(poly); let changed = false;
      for (let it = 0; it < 60; it++) {
        let hit = null, hd = 0;
        for (const i of U) {
          const u = [D.ux[i], D.uy[i], D.uz[i]], r = w.rho * C.radius(a, x[w.j], u); if (!(r > 0) || r > 1e5) continue;
          const X = V.add(Lp, V.mul(u, r)), q = [V.dot(V.sub(X, f.P), w.ex), V.dot(V.sub(X, f.P), w.ey)];
          if (inside2(poly, q)) { let bd = Infinity, bc = null; for (const c of w.p2) { const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2; if (d < bd) { bd = d; bc = c; } } if (!hit || bd < hd) { hit = { q, c: bc }; hd = bd; } }
        }
        if (!hit) break; const np = polyClip(poly, hit.c, hit.q); if (np.length < 3) { poly = np; break; } poly = np; changed = true;
      }
      if (poly.length < 3 || area2(poly) < 0.15 * a0) { f._dead = true; dead++; continue; }
      if (changed) { f.clip.pts3 = poly.map((q) => V.add(f.P, V.add(V.mul(w.ex, q[0]), V.mul(w.ey, q[1])))); clipped++; lost += 1 - area2(poly) / a0; }
    }
    return { clipped, dead, meanLost: clipped ? lost / clipped : 0 };
  }
  /* Clip every facet's polygon to what is really allowed: its surface points inside the envelope (with a hair of margin) and outside the LED clearance.
   * Outside vertices are pulled to the boundary along the polygon's edges and the polygon is cut by the chord between each leaving/entering pair (a convex
   * cut: the engine needs convex clips).  Keeps the facet's own area; drops a facet only when (almost) nothing is left.                                        */
  function clipEnvelope(facets, env, Lp, rmin, o) {
    o = o || {}; const tol = o.tol === undefined ? -0.003 : o.tol; let clipped = 0, dead = 0;
    for (const f of facets) {
      const fq = RF.SqmFwd.quadricOf(f), w = f._own; if (!w) continue;
      const ex = w.ex, ey = w.ey; let poly = f.clip.pts3.map((q) => [V.dot(V.sub(q, f.P), ex), V.dot(V.sub(q, f.P), ey)]); const a0 = area2(poly);
      const ok = (q) => { const sp = RF.Solver.surfPoint(fq, f.P, ex, ey, q[0], q[1]); if (!sp) return false; return RF.Geo.envInside(env, sp.X, tol) && V.dist(sp.X, Lp) >= rmin; };
      let changed = false;
      for (let pass = 0; pass < 8; pass++) {
        const ins = poly.map(ok); if (ins.every(Boolean)) break; if (!ins.some(Boolean)) { poly = []; break; }
        changed = true; const n = poly.length, cross = [];                      // crossing points on edges, in order
        for (let i = 0; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n], ia = ins[i], ib = ins[(i + 1) % n]; if (ia === ib) continue; let lo = 0, hi = 1;
          for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2, q = [a[0] + mid * (b[0] - a[0]), a[1] + mid * (b[1] - a[1])]; if (ok(q) === ia) lo = mid; else hi = mid; }
          const t = ia ? lo : hi; cross.push({ i, leaving: ia, q: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] }); }
        // cut by the chord between each leaving crossing and the next entering one, keeping the side with the centre (0, 0) when inside, else the larger part
        for (let c = 0; c < cross.length; c++) { if (!cross[c].leaving) continue; const c1 = cross[c], c2 = cross[(c + 1) % cross.length]; if (c2.leaving) continue;
          const nx = -(c2.q[1] - c1.q[1]), ny = c2.q[0] - c1.q[0]; let keep = 0, drop = 0; poly.forEach((q, i) => { const d = (q[0] - c1.q[0]) * nx + (q[1] - c1.q[1]) * ny; if (ins[i]) keep += d; }); const sg = keep >= 0 ? 1 : -1;
          const out = []; const m = poly.length; for (let i = 0; i < m; i++) { const a = poly[i], b = poly[(i + 1) % m], da = sg * ((a[0] - c1.q[0]) * nx + (a[1] - c1.q[1]) * ny), db = sg * ((b[0] - c1.q[0]) * nx + (b[1] - c1.q[1]) * ny);
            if (da >= 0) out.push(a); if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); } } poly = out; break; }
        if (poly.length < 3) break;
      }
      if (poly.length < 3 || area2(poly) < 0.08 * a0) { f._dead = true; dead++; continue; }
      if (changed) { f.clip.pts3 = poly.map((q) => V.add(f.P, V.add(V.mul(ex, q[0]), V.mul(ey, q[1])))); clipped++; }
    }
    return { clipped, dead };
  }
  /* DECALS: tiny-share facets (the dim glow units) are not given a cell by the transport (it would be a thin ring whose hull covers half the dish).  Each is a
   * compact patch carved out of the finished surface: its centre is the covered direction where the surface normal is closest to the normal the aim needs
   * (so it stays almost edge-to-edge with its neighbours), grown to the flux it must carry, sitting a hair in front of the surface so it is the mirror there.   */
  function placeDecals(D, on, A, x, as, dims, o) {
    o = o || {}; const taken = new Uint8Array(D.n), out = [], Lp = D.Lp, centres = [];
    // for every covered direction: where the surface is and what its normal is
    const P_ = new Float64Array(3 * D.n), N_ = new Float64Array(3 * D.n), room = new Float64Array(D.n);
    for (let i = 0; i < D.n; i++) { if (!on[i] || as.asg[i] < 0) continue; const r = as.rr[i], u = [D.ux[i], D.uy[i], D.uz[i]], P = V.add(Lp, V.mul(u, r)), a = A[as.asg[i]], ah = [a.ax, a.ay, a.az], n = V.norm(V.add(V.norm(V.sub(Lp, P)), ah)); P_.set(P, 3 * i); N_.set(n, 3 * i); room[i] = r / D.rEnv[i]; }
    for (const d of dims.slice().sort((p, q) => q.g - p.g)) {
      const ah = [d.ax, d.ay, d.az]; let best = -1, bt = Infinity;
      for (let i = 0; i < D.n; i++) {
        if (!on[i] || taken[i] || as.asg[i] < 0 || room[i] > 0.97) continue; const P = [P_[3 * i], P_[3 * i + 1], P_[3 * i + 2]];
        const nreq = V.norm(V.add(V.norm(V.sub(Lp, P)), ah)), c = V.dot(nreq, [N_[3 * i], N_[3 * i + 1], N_[3 * i + 2]]); let tilt = Math.acos(clamp(c, -1, 1));
        for (const q of centres) { const dd = V.dist(P, q); if (dd < 12) tilt += (12 - dd) * 0.05; }      // keep decals apart
        if (tilt < bt) { bt = tilt; best = i; }
      }
      if (best < 0) continue; const uc = [D.ux[best], D.uy[best], D.uz[best]];
      // grow the patch: nearest covered, untaken cells (by angle) until it holds the flux
      const cand = []; for (let i = 0; i < D.n; i++) if (on[i] && !taken[i] && as.asg[i] >= 0) { const c = D.ux[i] * uc[0] + D.uy[i] * uc[1] + D.uz[i] * uc[2]; if (c > 0.9) cand.push([1 - c, i]); }
      cand.sort((p, q) => p[0] - q[0]); const cells = []; let fl = 0; for (const [, i] of cand) { cells.push(i); fl += D.m[i]; if (fl >= d.g) break; }
      for (const i of cells) taken[i] = 1; centres.push([P_[3 * best], P_[3 * best + 1], P_[3 * best + 2]]);
      out.push({ aim: d, cells, centre: best, tilt: bt, flux: fl });
    }
    return { decals: out, taken };
  }
  function decalFacet(D, on, x, A, as, dc, o) {
    const a = dc.aim, Lp = D.Lp, i0 = dc.centre, u = [D.ux[i0], D.uy[i0], D.uz[i0]];
    // the surface point at the centre direction, brought a hair toward the LED so the decal (tilted to its own aim) is the mirror over its whole patch
    const rS = as.rr[i0]; let P = V.add(Lp, V.mul(u, rS));
    const ah = [a.ax, a.ay, a.az], Z = a.Z ? a.Z(P) : V.add(P, V.mul(ah, 1e6)), n = V.norm(V.add(V.norm(V.sub(Lp, P)), V.norm(V.sub(Z, P)))), [ex, ey] = V.basis(n);
    const pts2 = [], rows = [];
    for (const i of dc.cells) { const q = D.q[i], aa = D.a[i]; for (const [dq, da] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const w = C.corner(D, q + dq, aa + da), p = V.add(Lp, V.mul(w, rS)); const d = V.sub(p, P); pts2.push([V.dot(d, ex), V.dot(d, ey)]); } }
    if (pts2.length < 3) return null;
    const idx = pts2.map((_, i) => i).sort((s, t) => pts2[s][0] - pts2[t][0] || pts2[s][1] - pts2[t][1]), cr = (o_, s, t) => (pts2[s][0] - pts2[o_][0]) * (pts2[t][1] - pts2[o_][1]) - (pts2[s][1] - pts2[o_][1]) * (pts2[t][0] - pts2[o_][0]), lo = [], hi = [];
    for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1)).map((i) => pts2[i]); if (hull.length < 3) return null;
    let w2 = 0; for (const q of hull) w2 = Math.max(w2, Math.hypot(q[0], q[1]));
    const lift = Math.min(1.5, 0.3 + w2 * Math.tan(Math.min(dc.tilt, 0.6)) * 0.6);      // mm toward the LED: the tilt's edge height
    P = V.add(Lp, V.mul(u, Math.max(0.5, rS - lift)));
    const Z2 = a.Z ? a.Z(P) : V.add(P, V.mul(ah, 1e6)), n2 = V.norm(V.add(V.norm(V.sub(Lp, P)), V.norm(V.sub(Z2, P)))), [ex2, ey2] = V.basis(n2);
    const poly = hull.map((q) => V.add(P, V.add(V.mul(ex, q[0]), V.mul(ey, q[1]))));         // the same patch, re-based on the lifted centre (prism along the new normal)
    const f = { type: 'facet', id: (o && o.prefix || 'Q') + 'd' + (a.idx !== undefined ? a.idx : 0), P, S0: Lp.slice(), Z: Z2, flat: false, di: V.dist(P, Z2), clip: { kind: 'poly', pts3: poly }, optics: { interaction: 'reflect', reflectivity: o && o.refl !== undefined ? o.refl : 0.9 } };
    Object.defineProperty(f, '_own', { value: { ex: ex2, ey: ey2, n: n2, p2: hull, rho: 1, j: -1 }, enumerable: false, writable: true }); f.decal = true; return f;
  }
  function rhoMax(D, on, A, x, as, margin) {
    const J = A.length, rm = new Float64Array(J).fill(Infinity), rmin = new Float64Array(J).fill(0);
    for (let i = 0; i < D.n; i++) { if (!on[i] || as.asg[i] < 0) continue; const j = as.asg[i]; rm[j] = Math.min(rm[j], D.rEnv[i] / as.rr[i]); rmin[j] = Math.max(rmin[j], D.rMin[i] / as.rr[i]); }
    return { max: rm, min: rmin };
  }
  // ---- two-curvature shaping: widen each facet's image to its cell.  Extra spread covariance (deg²) → vergences along two beam-frame axes.
  const D2R = Math.PI / 180;
  function eig2(c) { const tr = (c[0] + c[2]) / 2, d = Math.sqrt(Math.max(0, ((c[0] - c[2]) / 2) ** 2 + c[1] * c[1])); const l1 = tr + d, l2 = tr - d, th = 0.5 * Math.atan2(2 * c[1], c[0] - c[2]); return { l1, l2, e1: [Math.cos(th), Math.sin(th)], e2: [-Math.sin(th), Math.cos(th)] }; }
  function apertureStd(f, b) {          // std (mm) of the facet's aperture along the world direction b (⟂ the aim), from samples on the real quadric
    const fq = RF.SqmFwd.quadricOf(f), A = RF.SqmFwd.apertureSamples(f, fq, 24); let m = 0, m2 = 0; for (let a = 0; a < A.n; a++) { const y = (A.pts[7 * a] - f.P[0]) * b[0] + (A.pts[7 * a + 1] - f.P[1]) * b[1] + (A.pts[7 * a + 2] - f.P[2]) * b[2]; m += y; m2 += y * y; }
    m /= Math.max(1, A.n); return Math.sqrt(Math.max(1e-12, m2 / Math.max(1, A.n) - m * m));
  }
  function shape(f, aim, extraCov, conv, o) {      // returns a copy of f with vg/ax set so the image gains `extraCov` ([hh, hv, vv] deg²)
    o = o || {}; const ev = eig2(extraCov), l1 = Math.max(0, ev.l1), l2 = Math.max(0, ev.l2); if (l1 < 1e-4 && l2 < 1e-4) return f;
    const d0 = RF.FarField.dirOf(aim.h, aim.v, conv), eps = 0.5, axes = [ev.e1, ev.e2].map((e) => V.norm(V.sub(RF.FarField.dirOf(aim.h + eps * e[0], aim.v + eps * e[1], conv), d0)));
    const vg = [l1, l2].map((l, k) => { const s = Math.sqrt(l) * D2R, sap = apertureStd(f, axes[k]); return -(s / Math.max(sap, 1e-3)) * (o.gain || 1); });
    return Object.assign({}, f, { vg, ax: axes[0] });
  }
  RF.SqmEmit = { placeDecals, decalFacet, clipEnvelope, shape, eig2, rhoMax, fit, facetOf, emitAll };
})();
