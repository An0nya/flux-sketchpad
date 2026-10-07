/* assemble.js — aims for the lens-path cells, facets (exact ellipsoids with foci LED and the cell's image point), engine surfaces, and the model's verdict. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, Pl = RF.SqmPlan, F = P3.fwd, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };

  // the facet polygon: the cell's Voronoi polygon (gnomonic coordinates about its centre) mapped onto the facet's quadric.  Every vertex that lands somewhere not allowed
  // (outside the envelope, inside the LED clearance, past the focus, …) is pulled toward the centre until it is; the convex hull of what is left is the clip.
  function cellPoly(P, cell, mapFn, validFn, scale) {
    const pts2 = [], sc = scale > 0 && scale < 1 ? Math.sqrt(scale) : 1;
    for (const [x0, y0] of cell.poly) {
      const x = x0 * sc, y = y0 * sc;
      let t = 1, ok = false;
      for (let it = 0; it < 14; it++) { const p = mapFn(P3.gnomonic(cell.c, cell.e1, cell.e2, x * t, y * t)); if (p && validFn(p)) { ok = true; break; } t *= 0.8; }
      if (ok) pts2.push([x * t, y * t]);
    }
    pts2.push([0, 0]);
    const h = P3.hull2(pts2); if (h.length < 3) return null;
    const hv = h.map((i) => pts2[i]);
    if (P3.area2(hv) < 0.05 * sc * sc * P3.area2(cell.poly)) return null;
    return hv.map(([x, y]) => mapFn(P3.gnomonic(cell.c, cell.e1, cell.e2, x, y)));
  }
  function polyFor(P, lay, cell, I, S0) {
    const S = P.Lp, Pp = cell.P, E = P.E, keep = P.keep, Fx = lay.F[0], s0 = S0 || S, Ls = V.dist(Pp, s0) + V.dist(Pp, I);
    if (!(Ls > V.dist(s0, I))) return null;
    let rhoAt;
    if (!S0) { const uI = V.sub(I, S), DI = V.len(uI); rhoAt = (d) => (Ls * Ls - DI * DI) / (2 * (Ls - V.dot(d, uI))); }
    else rhoAt = (d) => { let lo = 0, hi = 800; for (let it = 0; it < 32; it++) { const m = (lo + hi) / 2, X = V.add(S, V.mul(d, m)); if (V.dist(X, s0) + V.dist(X, I) < Ls) lo = m; else hi = m; } return (lo + hi) / 2; };      // the ray from the LED centre meets the ellipsoid (foci: the chosen emitter point and I)
    return cellPoly(P, cell, (d) => { const r = rhoAt(d); return r > 0 && r < 799 ? V.add(S, V.mul(d, r)) : null; }, (p) => E.inside(p, 0.15) && V.dist(p, S) > keep + 0.3 && p[0] < Fx - 0.2);
  }
  function facetOf(P, lay, cell, I, id, S0) {
    const pts3 = polyFor(P, lay, cell, I, S0); if (!pts3 || pts3.length < 3) return null;
    return { type: 'facet', id, P: cell.P, S0: (S0 || P.Lp).slice(), Z: I, di: V.dist(I, cell.P), flat: false, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: P.refl } };
  }
  // the emitter's extreme points along its own axes (a filament's two ends, a chip's edges): a facet whose first focus is such a point hangs the emitter's image on ONE side of its aim
  // (Liou 2009, "projector headlamp without a screen"): put the aim on the cut-off line and the image lies below it, no screen needed to stop the half above
  function sourceEnds(P) {
    const src = P.src, fr = RF.Source.frame(src), c = src.pos, out = [], add = (v, h) => { if (h > 0.05) { out.push(V.add(c, V.mul(v, h))); out.push(V.add(c, V.mul(v, -h))); } };
    if (src.length > 0) add(fr.a, src.length / 2 - 0.1); else { add(fr.u, (src.w || 0) / 2 - 0.05); add(fr.v, (src.h || 0) / 2 - 0.05); if (!(src.w > 0) && src.radius > 0) { add(fr.u, src.radius); add(fr.v, src.radius); } }
    return out.slice(0, 6);
  }
  // does the chief ray P → I enter the lens aperture?
  function entersLens(lay, Pp, I) {
    const w = V.sub(I, Pp); if (!(w[0] > 0)) return false; const t = (lay.xL - Pp[0]) / w[0], X = V.add(Pp, V.mul(w, t));
    return Math.hypot(X[1] - lay.F[1], X[2] - lay.F[2]) <= 0.92 * lay.a;
  }

  // aims: the ideal beam's lens-reachable part, cut into equal-flux cells, paired with the facets by image size (sharp facets ↔ small, bright cells)
  function lensAims(P, lay, cells, des, s) {
    const g = P.g, top = P.cut ? P.cut.top : () => 5, TL = new Float64Array(g.n), vmin = -20;
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); if (v < vmin) continue; for (let i = 0; i < g.nh; i++) { const h = g.hOf(i); if (Math.abs(h) > s.spread || v > top(h)) continue; TL[j * g.nh + i] = des.T[j * g.nh + i]; } }
    const sp = Pl.superpixels(g, TL, 0.4), aims = Pl.kmeans(sp, cells.length, 20, 1);
    const size = (a) => Math.sqrt(a.area) / D2R;                              // the cell's width (deg)
    const byA = aims.map((a, i) => i).sort((x, y) => size(aims[x]) - size(aims[y])), byC = cells.map((c, i) => i).sort((x, y) => cells[y].q - cells[x].q);
    const out = new Array(cells.length).fill(null);
    for (let r = 0; r < Math.min(byA.length, byC.length); r++) out[byC[r]] = aims[byA[r]];
    return { out, aims, flux: sp.reduce((x, q) => x + q.f, 0) };
  }


  // ---- lens-bypass facets: a paraboloid (focus = LED) aimed at a far-field direction, widened by two-curvature shaping (copied from SQM's emit.js)
  function eig2(c) { const tr = (c[0] + c[2]) / 2, d = Math.sqrt(Math.max(0, ((c[0] - c[2]) / 2) ** 2 + c[1] * c[1])); const l1 = tr + d, l2 = tr - d, th = 0.5 * Math.atan2(2 * c[1], c[0] - c[2]); return { l1, l2, e1: [Math.cos(th), Math.sin(th)], e2: [-Math.sin(th), Math.cos(th)] }; }
  function apertureStd(f, b) {
    const fq = F.quadricOf(f), A = F.apertureSamples(f, fq, 24); let m = 0, m2 = 0;
    for (let a = 0; a < A.n; a++) { const y = (A.pts[7 * a] - f.P[0]) * b[0] + (A.pts[7 * a + 1] - f.P[1]) * b[1] + (A.pts[7 * a + 2] - f.P[2]) * b[2]; m += y; m2 += y * y; }
    m /= Math.max(1, A.n); return Math.sqrt(Math.max(1e-12, m2 / Math.max(1, A.n) - m * m));
  }
  function shape(P, f, aim, extraCov) {
    const ev = eig2(extraCov), l1 = Math.max(0, ev.l1), l2 = Math.max(0, ev.l2); if (l1 < 1e-4 && l2 < 1e-4) return f;
    const d0 = RF.FarField.dirOf(aim.h, aim.v, P.conv), eps = 0.5, axes = [ev.e1, ev.e2].map((e) => V.norm(V.sub(RF.FarField.dirOf(aim.h + eps * e[0], aim.v + eps * e[1], P.conv), d0)));
    const vg = [l1, l2].map((l, k) => { const sg = Math.sqrt(l) * D2R, sap = apertureStd(f, axes[k]); return -(sg / Math.max(sap, 1e-3)); });
    return Object.assign({}, f, { vg, ax: axes[0] });
  }
  function polyForPar(P, lay, cell, a, scale) {
    const S = P.Lp, Pp = cell.P, d0 = V.norm(V.sub(Pp, S)), r0 = V.dist(Pp, S), c0 = r0 * (1 - V.dot(d0, a)), E = P.E, keep = P.keep; if (!(c0 > 1e-6)) return null;
    return cellPoly(P, cell, (d) => { const den = 1 - V.dot(d, a); return den > 1e-6 ? V.add(S, V.mul(d, c0 / den)) : null; },
      (p) => E.inside(p, 0.15) && V.dist(p, S) > keep + 0.3 && Math.hypot(p[1] - lay.c.yA, p[2] - lay.c.zA) >= lay.a + 2, scale);
  }
  function facetDirect(P, lay, cell, h, v, id, extraCov, scale) {
    const a = RF.FarField.dirOf(h, v, P.conv), pts3 = polyForPar(P, lay, cell, a, scale); if (!pts3 || pts3.length < 3) return null;
    const Z = V.add(cell.P, V.mul(a, 1e6));
    let f = { type: 'facet', id, P: cell.P, S0: P.Lp.slice(), Z, di: V.dist(Z, cell.P), flat: false, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: P.refl } };
    if (extraCov) f = shape(P, f, { h, v }, extraCov);
    return f;
  }

  function surfacesOf(P, lay, shield, facets, s) {
    const out = facets.slice(), L = lay.L, glass = s.fresnel ? { interaction: 'refract', reflectivity: 0, ior: s.ior, fresnel: 'exact', twoSided: false } : { interaction: 'refract', reflectivity: 0.9, ior: s.ior, fresnelT: 0.96, twoSided: false };
    if (shield) {
      const { xc, cy, yF, pts, ne, zb } = shield, xOn = (y) => xc + 0.5 * cy * (y - yF) ** 2, ctr = [xc, yF, (lay.F[2] + shield.zbRaw) / 2], bot = (y) => [xOn(y), y, zb];
      for (let i = 0; i + 1 < ne; i++) {
        const pa = pts[i], pb = pts[i + 1], q = [pa, pb, bot(pb[1]), bot(pa[1])];
        if (Math.abs(pb[1] - pa[1]) < 1e-3 || q.some((x) => !P.E.inside(x, 0.1))) continue;
        out.push(Math.abs(cy) > 1e-5 ? { type: 'quad', id: 'p3_shield' + i, P: [xc, yF, ctr[2]], n: [-1, 0, 0], ref: [0, 1, 0], curv: [-cy, 0, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB }
          : { type: 'plane', id: 'p3_shield' + i, P: ctr, n: [-1, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB });
      }
    }
    for (const sf of P3.lensSurfaces(L, lay.O, glass, 'p3_lens')) out.push(sf);
    return out;
  }

  // the model's verdict on a facet list (reflections through shield + lens; direct light is not in it)
  function evaluate(P, lay, shield, facets, na, stats) {
    const post = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield, stats });
    const fld = F.field(facets, P.S_, P.grid, { na: na || 24, post }), gj = T.judgeGrid(P.g, fld.E, { distance: P.dist, centre: P.Lp }), ev = RF.Spec.evaluate(gj, T.mdOf(P.spec));
    const hard = ev.rows.filter((r) => r.verdict === 'fail').length, worst = ev.rows.length ? Math.min(...ev.rows.map((r) => r.margin)) : 1;
    let deficit = 0; for (const r of ev.rows) if (r.margin < 0) deficit += Math.min(3, -r.margin);
    return { fld, gj, ev, hard, worst, deficit, score: -3 * hard - 1 * ev.n.unsure - 6 * deficit + 0.5 * clamp(worst, -1, 0.2) + 0.003 * gj.lmWindow, lm: gj.lmWindow };
  }
  P3.polyFor = polyFor; P3.facetOf = facetOf; P3.sourceEnds = sourceEnds; P3.entersLens = entersLens; P3.lensAims = lensAims; P3.surfacesOf = surfacesOf; P3.evaluate = evaluate; P3.facetDirect = facetDirect; P3.shape = shape;
})();
