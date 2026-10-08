/* assemble.js — aims for the lens-path cells, facets (exact ellipsoids with foci LED and the cell's image point), engine surfaces, and the model's verdict. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, Pl = RF.SqmPlan, F = P3.fwd, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };

  // the facet polygon: the cell's Voronoi polygon (gnomonic coordinates about its centre) mapped onto the facet's quadric.  Every vertex that lands somewhere not allowed
  // (outside the envelope, inside the LED clearance, past the focus, …) is pulled toward the centre until it is; the convex hull of what is left is the clip.
  function cellPoly(P, cell, mapFn, validFn, scale) {
    const pts2 = [], sc = scale > 0 && scale < 1 ? Math.sqrt(scale) : (P.overlap > 1 && !(scale > 0) ? P.overlap : 1);      // P.overlap: grow lens-path facets past their cell so stepped neighbours overlap (no slits for an extended emitter)
    for (const [x0, y0] of cell.poly) {
      const x = x0 * sc, y = y0 * sc;
      let t = 1, ok = false;
      for (let it = 0; it < 14; it++) { const p = mapFn(P3.gnomonic(cell.c, cell.e1, cell.e2, x * t, y * t)); if (p && validFn(p)) { ok = true; break; } t *= 0.8; }
      if (ok) pts2.push([x * t, y * t]);
    }
    pts2.push([0, 0]);
    const h = P3.hull2(pts2); if (h.length < 3) return null;
    const hv = h.map((i) => pts2[i]);
    if (P3.area2(hv) < 0.05 * Math.min(1, sc * sc) * P3.area2(cell.poly)) return null;
    if (P.polyStats) P.polyStats.push(P3.area2(hv) / Math.max(1e-12, P3.area2(cell.poly)));
    return hv.map(([x, y]) => mapFn(P3.gnomonic(cell.c, cell.e1, cell.e2, x, y)));
  }
  function polyFor(P, lay, cell, I, S0) {
    const S = P.Lp, Pp = cell.P, E = P.E, keep = P.keep, Fx = lay.F[0], s0 = S0 || S, Ls = V.dist(Pp, s0) + V.dist(Pp, I);
    if (!(Ls > V.dist(s0, I))) return null;
    let rhoAt;
    if (!S0) { const uI = V.sub(I, S), DI = V.len(uI); rhoAt = (d) => (Ls * Ls - DI * DI) / (2 * (Ls - V.dot(d, uI))); }
    else rhoAt = (d) => { let lo = 0, hi = 800; for (let it = 0; it < 32; it++) { const m = (lo + hi) / 2, X = V.add(S, V.mul(d, m)); if (V.dist(X, s0) + V.dist(X, I) < Ls) lo = m; else hi = m; } return (lo + hi) / 2; };      // the ray from the LED centre meets the ellipsoid (foci: the chosen emitter point and I)
    const why = (k) => { if (P.polyWhy) P.polyWhy[k] = (P.polyWhy[k] || 0) + 1; return false; };
    return cellPoly(P, cell, (d) => { const r = rhoAt(d); if (!(r > 0 && r < 799)) { why('no surface'); return null; } return V.add(S, V.mul(d, r)); },
      (p) => (E.inside(p, 0.15) || why('outside envelope')) && (V.dist(p, S) > keep + 0.3 || why('LED clearance')) && (p[0] < Fx - 0.2 || why('past the focus')));
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
  // Liou's moving first focus, generalised: points along each of the emitter's own axes, from the centre out to the ends (n per side), so a facet can take ANY of them as its
  // first focus and hang its image as far to one side of its aim as it needs.  A filament gives points along its length; a chip, along its width and height.
  function emitterPoints(P, n) {
    const c = P.src.pos, ends = sourceEnds(P), out = [];
    for (const e of ends) for (let k = 1; k <= n; k++) out.push(V.add(c, V.mul(V.sub(e, c), k / n)));
    return out;
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
      const holes = shield.holes || []; let n = 0;
      const sheet = (q) => out.push(Math.abs(cy) > 1e-5 ? { type: 'quad', id: 'p3_shield' + n++, P: [xc, yF, ctr[2]], n: [-1, 0, 0], ref: [0, 1, 0], curv: [-cy, 0, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB }
        : { type: 'plane', id: 'p3_shield' + n++, P: ctr, n: [-1, 0, 0], clip: { kind: 'poly', pts3: q }, optics: ABSORB });
      for (let i = 0; i + 1 < ne; i++) {
        const pa = pts[i], pb = pts[i + 1], q = [pa, pb, bot(pb[1]), bot(pa[1])];
        if (Math.abs(pb[1] - pa[1]) < 1e-3 || q.some((x) => !P.E.inside(x, 0.1))) continue;
        // split the strip at the holes' y edges; inside a hole's y range the strip is two pieces, above and below the window
        const y0 = Math.min(pa[1], pb[1]), y1 = Math.max(pa[1], pb[1]), zTop = (y) => pa[2] + (pb[2] - pa[2]) * (y - pa[1]) / (pb[1] - pa[1]), at = (y, z) => [xOn(y), y, z];
        const cuts = [y0, y1]; for (const h of holes) for (const y of [h.y - h.r, h.y + h.r]) if (y > y0 && y < y1) cuts.push(y); cuts.sort((a, b) => a - b);
        for (let c = 0; c + 1 < cuts.length; c++) {
          const ya = cuts[c], yb = cuts[c + 1], ym = (ya + yb) / 2; if (yb - ya < 1e-4) continue;
          const h = holes.find((x) => Math.abs(ym - x.y) < x.r);
          if (!h) { sheet([at(ya, zTop(ya)), at(yb, zTop(yb)), at(yb, zb), at(ya, zb)]); continue; }
          const zh = h.z + h.r, zl = h.z - h.r;
          if (zh < Math.min(zTop(ya), zTop(yb))) sheet([at(ya, zTop(ya)), at(yb, zTop(yb)), at(yb, zh), at(ya, zh)]);
          if (zl > zb) sheet([at(ya, zl), at(yb, zl), at(yb, zb), at(ya, zb)]);
        }
      }
    }
    if (lay.cap) out.push({ type: 'rev', id: 'p3_cap', O: lay.cap.c, W: [1, 0, 0], ref: [0, 0, 1], seg: { kind: 'line', z0: 0, r0: 0, z1: 0, r1: lay.cap.r }, front: 1, optics: ABSORB });
    if (lay.barrel) {      // the lens holder: an absorbing tube at the lens radius from just ahead of the bowl to the lens
      let x0 = -Infinity; for (const f of facets) for (const q of (f.clip && f.clip.pts3) || []) x0 = Math.max(x0, q[0]);
      x0 = Math.max(x0 + 0.5, lay.cap ? lay.cap.c[0] : -Infinity); if (x0 < lay.O[0] - 1) out.push({ type: 'rev', id: 'p3_barrel', O: lay.O, W: [1, 0, 0], ref: [0, 0, 1], seg: { kind: 'line', z0: x0 - lay.O[0], r0: lay.a + 0.2, z1: 0, r1: lay.a + 0.2 }, front: 1, optics: ABSORB });
    }
    for (const sf of P3.lensSurfaces(L, lay.O, glass, 'p3_lens')) out.push(sf);
    return out;
  }

  // the model's verdict on a facet list (reflections through shield + lens; direct light is not in it)
  function evaluate(P, lay, shield, facets, na, stats) {
    const post = P3.makePost({ cap: lay.cap, barrel: lay.barrel, lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield, stats });
    const fld = F.field(facets, P.S_, P.grid, { na: na || 24, post }), gj = T.judgeGrid(P.g, fld.E, { distance: P.dist, centre: P.Lp }), ev = RF.Spec.evaluate(gj, T.mdOf(P.spec));
    const hard = ev.rows.filter((r) => r.verdict === 'fail').length, worst = ev.rows.length ? Math.min(...ev.rows.map((r) => r.margin)) : 1;
    let deficit = 0; for (const r of ev.rows) if (r.margin < 0) deficit += Math.min(3, -r.margin);
    return { fld, gj, ev, hard, worst, deficit, score: -3 * hard - 1 * ev.n.unsure - 6 * deficit + 0.5 * clamp(worst, -1, 0.2) + 0.003 * gj.lmWindow, lm: gj.lmWindow };
  }
  P3.polyFor = polyFor; P3.facetOf = facetOf; P3.sourceEnds = sourceEnds; P3.emitterPoints = emitterPoints; P3.entersLens = entersLens; P3.lensAims = lensAims; P3.surfacesOf = surfacesOf; P3.evaluate = evaluate; P3.facetDirect = facetDirect; P3.shape = shape;
})();
