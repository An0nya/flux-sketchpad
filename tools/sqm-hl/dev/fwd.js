/* fwd.js — forward model: the far field a set of facets paints, from exact geometry (no ray tracer).
 *
 * For one facet: sample points X on its aperture (the clip polygon, on the real quadric, with its real normal) and points s on the
 * emitter; each pair (s, X) carries the flux  q_s · E_s(d) · cosθ_X · dA_X / |X − s|²  (q_s = the sample's share of the emitter,
 * E_s(d) = its radiant intensity toward d, normalised so the whole emitter gives Φ) times the mirror's reflectivity, and leaves along
 * the exact reflection.  That is what the ray tracer samples, so flux AND pattern come out of one computation.
 *
 *   RF.SqmFwd.sourceSamples(src, n)            → { n, pos[3n], q[n], nrm[3n] | null, kind }
 *   RF.SqmFwd.footprint(facet, src, samples, opt) → { flux (lm), E: Map/sparse bins } and moments
 *   RF.SqmFwd.field(facets, src, grid, opt)    → Float64Array E (lm per bin) + per-facet columns
 * Grid: { h0, v0, step, nh, nv, conv, distance (mm, Infinity = far field), centre }.                                         */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, D2R = Math.PI / 180;
  const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

  // ------------------------------------------------------------------ emitter samples
  // q: share of the emitter's flux each sample represents (sums to 1).  nrm: outward skin normals for an opaque (surface-emitting) body.
  function sourceSamples(src, n) {
    n = Math.max(1, n | 0);
    const fr = RF.Source.frame(src), p = src.pos, pos = [], q = [], nrm = [];
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const push = (x, w, nn) => { pos.push(x[0], x[1], x[2]); q.push(w); if (nn) nrm.push(nn[0], nn[1], nn[2]); };
    let kind = 'dist';
    if (src.kind === 'point') push(p, 1);
    else if (src.kind === 'planar') {
      if (src.shape === 'disc') { for (let i = 1; i <= n; i++) { const r = src.radius * Math.sqrt(halton(i, 2)), t = 2 * Math.PI * halton(i, 3); push(at(r * Math.cos(t), r * Math.sin(t), 0), 1); } }
      else { const m = Math.max(1, Math.round(Math.sqrt(n * (src.w || 1) / (src.h || 1)))), k = Math.max(1, Math.round(n / m)); for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) push(at(((i + 0.5) / m - 0.5) * src.w, ((j + 0.5) / k - 0.5) * src.h, 0), 1); }
    } else if (RF.Source.frame && src.emission === 'surface') {           // an opaque Lambertian skin (a filament coil)
      kind = 'skin';
      if (src.shape === 'cylinder') {
        const R = src.radius, L = src.length, aSide = 2 * Math.PI * R * L, aCap = Math.PI * R * R, aTot = aSide + 2 * aCap, nSide = Math.max(1, Math.round(n * aSide / aTot));
        const nA = Math.max(1, Math.round(Math.sqrt(nSide * 2 * Math.PI * R / L))), nH = Math.max(1, Math.round(nSide / nA));
        for (let i = 0; i < nA; i++) for (let j = 0; j < nH; j++) { const a = (i + 0.5) / nA * 2 * Math.PI, h = ((j + 0.5) / nH - 0.5) * L, nr = V.add(V.mul(fr.u, Math.cos(a)), V.mul(fr.v, Math.sin(a))); push(V.add(at(0, 0, h), V.mul(nr, R)), aSide / aTot / (nA * nH), nr); }
        const nC = Math.max(1, Math.round(n * aCap / aTot / 4)) + 3;
        for (const sg of [1, -1]) for (let i = 1; i <= nC; i++) { const r = R * Math.sqrt(halton(i, 2)), t = 2 * Math.PI * halton(i, 3); push(at(r * Math.cos(t), r * Math.sin(t), sg * L / 2), aCap / aTot / nC, V.mul(fr.a, sg)); }
      } else {                                                           // sphere
        for (let i = 1; i <= n; i++) { const c = 1 - 2 * halton(i, 2), s = Math.sqrt(Math.max(0, 1 - c * c)), t = 2 * Math.PI * halton(i, 3), nr = V.add(V.mul(fr.a, c), V.add(V.mul(fr.u, s * Math.cos(t)), V.mul(fr.v, s * Math.sin(t)))); push(V.add(p, V.mul(nr, src.radius)), 1 / n, nr); }
      }
    } else if (src.shape === 'cylinder') { for (let i = 1; i <= n; i++) { const r = src.radius * Math.sqrt(halton(i, 2)), t = 2 * Math.PI * halton(i, 3), h = (halton(i, 5) - 0.5) * src.length; push(V.add(at(0, 0, h), V.add(V.mul(fr.u, r * Math.cos(t)), V.mul(fr.v, r * Math.sin(t)))), 1); } }
    else { for (let i = 1; i <= n; i++) { const c = 1 - 2 * halton(i, 2), s = Math.sqrt(Math.max(0, 1 - c * c)), t = 2 * Math.PI * halton(i, 3), r = src.radius * Math.cbrt(halton(i, 5)); push(V.add(p, V.add(V.mul(fr.a, r * c), V.add(V.mul(fr.u, r * s * Math.cos(t)), V.mul(fr.v, r * s * Math.sin(t))))), 1); } }
    const W = q.reduce((a, b) => a + b, 0), cnt = pos.length / 3;
    return { n: cnt, pos: Float64Array.from(pos), q: Float64Array.from(q.map((x) => x / W)), nrm: nrm.length ? Float64Array.from(nrm) : null, kind, src, itot: RF.Source.totalIntegral(src), fr };
  }
  // radiant intensity of sample b toward unit d, normalised so the whole emitter radiates src.power (lm per sr)
  function emitTo(S, b, dx, dy, dz) {
    const src = S.src;
    if (S.kind === 'skin') { const c = S.nrm[3 * b] * dx + S.nrm[3 * b + 1] * dy + S.nrm[3 * b + 2] * dz; return c > 0 ? src.power * c / Math.PI : 0; }
    const a = S.fr.a, ct = Math.max(-1, Math.min(1, a[0] * dx + a[1] * dy + a[2] * dz));
    return src.power * RF.Source.intensity(src, Math.acos(ct)) / S.itot;
  }

  // ------------------------------------------------------------------ one facet: aperture samples on the real quadric
  function quadricOf(f) { return !f.flat && Array.isArray(f.vg) ? RF.Geo.facetQuadric2(f.P, f.S0, f.Z, f.vg, f.ax) : RF.Geo.facetQuadric(f.P, f.S0, f.Z, f.flat ? null : f.di); }
  function apertureSamples(f, fq, na) {
    const clip = f.clip || { kind: 'disc', r: 1 }, { ex, ey } = RF.Solver.facetFrame(fq, clip.ref), P = f.P, pts = [];
    let poly = null;
    if (clip.kind === 'poly') poly = clip.pts3.map((q) => { const d = V.sub(q, P); return [V.dot(d, ex), V.dot(d, ey)]; });
    else if (clip.kind === 'rect') poly = [[-clip.hx, -clip.hy], [clip.hx, -clip.hy], [clip.hx, clip.hy], [-clip.hx, clip.hy]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    if (poly) for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } else { x0 = -clip.r; x1 = clip.r; y0 = -clip.r; y1 = clip.r; }
    const inside = (x, y) => { if (!poly) return x * x + y * y <= clip.r * clip.r; let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c < 0) s |= 1; else if (c > 0) s |= 2; if (s === 3) return false; } return true; };
    let got = 0, i = 1, guard = 0; const out = [];
    while (got < na && guard++ < na * 40) { const x = x0 + (x1 - x0) * halton(i, 2), y = y0 + (y1 - y0) * halton(i, 3); i++; if (!inside(x, y)) continue; const sp = RF.Solver.surfPoint(fq, P, ex, ey, x, y); if (!sp) continue; out.push(sp.X[0], sp.X[1], sp.X[2], sp.n[0], sp.n[1], sp.n[2], (sp.n[0] * fq.n[0] + sp.n[1] * fq.n[1] + sp.n[2] * fq.n[2])); got++; }
    // area of the polygon in the tangent plane (mm²) for the flux weights
    let area = 0; if (poly) { for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; } area = Math.abs(area) / 2; } else area = Math.PI * clip.r * clip.r;
    return { pts: Float64Array.from(out), n: out.length / 7, area };
  }

  // ------------------------------------------------------------------ footprint of one facet on a far-field grid
  // returns { flux, idx: Int32Array, val: Float64Array (lm per bin, bilinear), hc, vc (flux centroid), cov [hh, hv, vv] in degrees² }
  function footprint(f, S, grid, opt) {
    opt = opt || {};
    const fq = quadricOf(f), refl = f.optics && f.optics.reflectivity !== undefined ? f.optics.reflectivity : 0.9;
    const A = apertureSamples(f, fq, opt.na || 48); if (opt.occ) opt.occ(f, A);
    const nh = grid.nh, nv = grid.nv, acc = new Map();
    const fin = isFinite(grid.distance), plane = fin ? grid.centre[0] + grid.distance : 0, c0 = grid.centre;
    let flux = 0, mh = 0, mv = 0, shh = 0, shv = 0, svv = 0;
    const wA = A.area / Math.max(1, A.n);
    for (let a = 0; a < A.n; a++) {
      const o = 7 * a, X0 = A.pts[o], X1 = A.pts[o + 1], X2 = A.pts[o + 2], n0 = A.pts[o + 3], n1 = A.pts[o + 4], n2 = A.pts[o + 5], tilt = A.pts[o + 6];
      if (tilt === 0) continue; const dA = wA / Math.max(0.2, tilt);
      for (let b = 0; b < S.n; b++) {
        const sx = S.pos[3 * b], sy = S.pos[3 * b + 1], sz = S.pos[3 * b + 2];
        let dx = X0 - sx, dy = X1 - sy, dz = X2 - sz; const r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2); dx /= r; dy /= r; dz /= r;
        const cp = -(dx * n0 + dy * n1 + dz * n2); if (!(cp > 0)) continue;                    // must meet the reflecting face
        const E = emitTo(S, b, dx, dy, dz); if (!(E > 0)) continue;
        const w = S.q[b] * E * cp * dA / r2 * refl; if (!(w > 0)) continue;
        const k = 2 * (dx * n0 + dy * n1 + dz * n2), ox = dx - k * n0, oy = dy - k * n1, oz = dz - k * n2;
        let ux = ox, uy = oy, uz = oz;
        if (fin) { if (!(ox > 1e-9)) continue; const t = (plane - X0) / ox; ux = X0 + t * ox - c0[0]; uy = X1 + t * oy - c0[1]; uz = X2 + t * oz - c0[2]; const L = Math.hypot(ux, uy, uz); ux /= L; uy /= L; uz /= L; }
        const hv = RF.FarField.hvOf([ux, uy, uz], grid.conv), gh = (hv[0] - grid.h0) / grid.step - 0.5, gv = (hv[1] - grid.v0) / grid.step - 0.5;
        flux += w; mh += w * hv[0]; mv += w * hv[1]; shh += w * hv[0] * hv[0]; shv += w * hv[0] * hv[1]; svv += w * hv[1] * hv[1];
        const i0 = Math.floor(gh), j0 = Math.floor(gv), fh = gh - i0, fv = gv - j0;
        for (let jj = 0; jj < 2; jj++) for (let ii = 0; ii < 2; ii++) { const i = i0 + ii, j = j0 + jj; if (i < 0 || j < 0 || i >= nh || j >= nv) continue; const key = j * nh + i, ww = w * (ii ? fh : 1 - fh) * (jj ? fv : 1 - fv); acc.set(key, (acc.get(key) || 0) + ww); }
      }
    }
    const idx = new Int32Array(acc.size), val = new Float64Array(acc.size); let q = 0; for (const [k, v] of acc) { idx[q] = k; val[q] = v; q++; }
    const hc = flux > 0 ? mh / flux : 0, vc = flux > 0 ? mv / flux : 0;
    return { flux, idx, val, hc, vc, cov: flux > 0 ? [shh / flux - hc * hc, shv / flux - hc * vc, svv / flux - vc * vc] : [0, 0, 0], samples: A.n * S.n };
  }

  // the field (lm per bin) of a list of facets, plus each facet's footprint
  // Occluder: which aperture samples of facet j has a NEARER facet in front of, along the ray from the source centre?  (sets the sample's tilt slot to 0 → no flux)
  function makeOccluder(facets, src) {
    const G = RF.Geo.compile(facets), Lp = src.pos, rad = facets.map((f) => { let r = 0; for (const q of f.clip.pts3) r = Math.max(r, V.dist(q, f.P)); return r + 0.6; });
    return (f, A) => {
      const j = facets.indexOf(f); if (j < 0) return; let blockedN = 0;
      for (let a = 0; a < A.n; a++) {
        const X = [A.pts[7 * a], A.pts[7 * a + 1], A.pts[7 * a + 2]], d = V.sub(X, Lp), L = V.len(d), u = [d[0] / L, d[1] / L, d[2] / L];
        for (let k = 0; k < facets.length; k++) {
          if (k === j) continue; const c = facets[k].P, w = V.sub(c, Lp), t0 = V.dot(w, u); if (t0 < 0 || t0 > L + rad[k]) continue;
          const dx = w[0] - t0 * u[0], dy = w[1] - t0 * u[1], dz = w[2] - t0 * u[2]; if (dx * dx + dy * dy + dz * dz > rad[k] * rad[k]) continue;
          const t = RF.Geo.intersect(G.D, G.poly, k, Lp[0], Lp[1], Lp[2], u[0], u[1], u[2], 1e-9, L - 1e-4); if (t >= 0 && t < L - 1e-4) { A.pts[7 * a + 6] = 0; blockedN++; break; }
        }
      }
      A.blocked = blockedN;
    };
  }
  function field(facets, S, grid, opt) {
    opt = Object.assign({}, opt); if (opt.occlude) opt.occ = makeOccluder(facets, S.src);
    const E = new Float64Array(grid.nh * grid.nv), fps = [];
    for (const f of facets) { const fp = footprint(f, S, grid, opt); fps.push(fp); for (let q = 0; q < fp.idx.length; q++) E[fp.idx[q]] += fp.val[q]; }
    return { E, fps };
  }
  // intensity (cd) at (h, v) from a field, box kernel k (degrees), like the judge's: E_sum / Ω_sum over the bins the box covers
  function gridOf(win, step, conv, distance, centre) {
    const nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step);
    const g = { h0: win[0], v0: win[2], step, nh, nv, conv: conv || 'A', distance: distance > 0 ? distance : Infinity, centre: centre.slice() };
    g.om = new Float64Array(nh * nv); for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) g.om[j * nh + i] = RF.FarField.binOmega(g.h0 + i * step, g.h0 + (i + 1) * step, g.v0 + j * step, g.v0 + (j + 1) * step, g.conv);
    return g;
  }
  RF.SqmFwd = { makeOccluder, sourceSamples, emitTo, quadricOf, apertureSamples, footprint, field, gridOf, halton };
})();
