/* SQM headlamp solver (sqm-hl) — a continuous reflector for a beam SPECIFICATION (Spec mode), built with the supporting-quadric method.
 *
 * (header filled in at packaging time)                                                                                                       */

(function (globalThis) {
// ============================================================ fwd
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

// ============================================================ target
/* target.js — the IDEAL BEAM: a far-field intensity map T*(h, v) in cd that satisfies the spec with margin, has a cut-off edge of a
 * chosen sharpness, and puts the remaining light where a driver wants it (the road).  No optics here: the real judge (RF.Spec.evaluate)
 * is run on T* itself, on a noise-free grid, so "does the ideal beam pass?" is answered before any mirror exists.
 *
 *   RF.SqmTarget.grid(spec, step)                         → pixel grid (centres, solid angles)
 *   RF.SqmTarget.bands(spec, grid, margins)                → { lo, hi } per pixel (cd), margins applied
 *   RF.SqmTarget.design(P, grid, bands, params)            → { T, flux, ... }
 *   RF.SqmTarget.judge(grid, cdMap, md)                    → RF.Spec.evaluate on a noise-free field                              */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function grid(win, step, conv) {
    const nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step), n = nh * nv;
    const g = { win, step, conv: conv || 'A', nh, nv, n, h0: win[0], v0: win[2], om: new Float64Array(n) };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) g.om[j * nh + i] = RF.FarField.binOmega(g.h0 + i * step, g.h0 + (i + 1) * step, g.v0 + j * step, g.v0 + (j + 1) * step, g.conv);
    g.hOf = (i) => g.h0 + (i + 0.5) * step; g.vOf = (j) => g.v0 + (j + 0.5) * step;
    g.iOf = (h) => Math.floor((h - g.h0) / step); g.jOf = (v) => Math.floor((v - g.v0) / step);
    return g;
  }
  const satOf = (a, nh, nv) => { const W = nh + 1, S = new Float64Array(W * (nv + 1)); for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += a[j * nh + i]; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } } return S; };
  // a noise-free judge grid from lm per bin (the object RF.Spec.evaluate reads)
  function judgeGrid(g, E, o) {
    o = o || {}; const nh = g.nh, nv = g.nv, E2 = new Float64Array(nh * nv); let lm = 0; for (let q = 0; q < E.length; q++) lm += E[q];
    return { E, E2, Om: g.om, nh, nv, h0: g.h0, v0: g.v0, step: g.step, h1: g.h0 + nh * g.step, v1: g.v0 + nv * g.step, conv: g.conv, distance: o.distance > 0 ? o.distance : Infinity, centre: (o.centre || [0, 0, 0]).slice(),
      lmWindow: lm, lmExit: lm, rays: 1e9, coverage: 1, N: 1e9, streamed: true, eRay: 0, sat: { E: satOf(E, nh, nv), E2: satOf(E2, nh, nv), Om: satOf(g.om, nh, nv) } };
  }
  function mdOf(spec) {
    const a = spec.aim || {}, box = a.box ? Object.assign({}, a.box) : null;
    return { items: spec.items, traffic: 'RHT', conv: spec.conv, kernel: spec.kernel, step: spec.step || 0.1, aimMode: a.mode || 'design', aimLine: a.line, aimScan: a.scan, aimBox: box && spec.traffic === 'LHT' ? { left: box.right, right: box.left, up: box.up, down: box.down } : box, itemReaim: a.itemReaim || 0, aimTol: 0 };
  }
  function judge(g, cd, spec, o) {
    const E = new Float64Array(g.n); for (let q = 0; q < g.n; q++) E[q] = cd[q] * g.om[q];
    return RF.Spec.evaluate(judgeGrid(g, E, o), mdOf(spec));
  }

  // ---- the spec as per-pixel floors and ceilings (cd), with a margin on each (factor ≥ 1: floor × m, ceiling ÷ m)
  function bands(spec, g, mg) {
    mg = Object.assign({ lo: 1.25, hi: 1.25 }, mg || {});
    const lo = new Float64Array(g.n), hi = new Float64Array(g.n).fill(Infinity), k = spec.kernel > 0 ? spec.kernel : 0.15, items = spec.items;
    const rad = Math.max(k, g.step / 2) + 1e-9;
    const pxAt = (h, v) => { const out = [], i0 = g.iOf(h - rad), i1 = g.iOf(h + rad), j0 = g.jOf(v - rad), j1 = g.jOf(v + rad); for (let j = Math.max(0, j0); j <= Math.min(g.nv - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(g.nh - 1, i1); i++) out.push(j * g.nh + i); if (!out.length) { const i = g.iOf(h), j = g.jOf(v); if (i >= 0 && j >= 0 && i < g.nh && j < g.nv) out.push(j * g.nh + i); } return out; };
    const pxIn = (poly) => { let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const [h, v] of poly) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } const out = []; for (let j = Math.max(0, g.jOf(v0)); j <= Math.min(g.nv - 1, g.jOf(v1)); j++) for (let i = Math.max(0, g.iOf(h0)); i <= Math.min(g.nh - 1, g.iOf(h1)); i++) if (RF.Spec.inPoly(poly, g.hOf(i), g.vOf(j))) out.push(j * g.nh + i); return out; };
    const refMin = (name) => { const it = items.find((x) => x.name === name && x.kind === 'point'); return it && it.min > 0 ? it.min : 0; };
    const setLo = (px, v) => { for (const p of px) if (v * mg.lo > lo[p]) lo[p] = v * mg.lo; };
    const setHi = (px, v) => { for (const p of px) if (v / mg.hi < hi[p]) hi[p] = v / mg.hi; };
    const rows = [];
    for (const it of items) {
      let px = null, mn = it.min || 0, mx = it.max || 0, per = 1;
      if (it.kind === 'point') px = pxAt(it.h, it.v);
      else if (it.kind === 'zone') px = pxIn(it.poly);
      else if (it.kind === 'sum') { for (const [h, v] of it.pts) { const p = pxAt(h, v); if (it.min > 0) setLo(p, it.min / it.pts.length); rows.push({ name: it.name, kind: 'sum-pt', px: p }); } continue; }
      else continue;
      if (it.maxRel) { const r = refMin(it.maxRel.ref); if (r > 0) mx = mx > 0 ? Math.min(mx, it.maxRel.factor * r) : it.maxRel.factor * r; }
      if (mn > 0) setLo(px, mn); if (mx > 0) setHi(px, mx);
      rows.push({ name: it.name, kind: it.kind, px, min: mn, max: mx });
    }
    return { lo, hi, rows };
  }

  // ---- log-domain blur along v (and a little along h): a step in intensity becomes a smooth edge with ONE steepest point
  function logBlur(g, T, sv, sh) {
    const lg = new Float64Array(g.n); for (let q = 0; q < g.n; q++) lg[q] = Math.log(Math.max(T[q], 1e-3));
    const pass = (src, sigma, vert) => {
      if (!(sigma > 0)) return src; const r = Math.ceil(3 * sigma / g.step), w = []; let ws = 0; for (let d = -r; d <= r; d++) { const x = Math.exp(-0.5 * (d * g.step / sigma) ** 2); w.push(x); ws += x; }
      const out = new Float64Array(g.n);
      for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nh; i++) { let s = 0, ww = 0; for (let d = -r; d <= r; d++) { const ii = vert ? i : i + d, jj = vert ? j + d : j; if (ii < 0 || jj < 0 || ii >= g.nh || jj >= g.nv) continue; s += w[d + r] * src[jj * g.nh + ii]; ww += w[d + r]; } out[j * g.nh + i] = s / ww; }
      return out;
    };
    const o = pass(pass(lg, sv, true), sh, false); const T2 = new Float64Array(g.n); for (let q = 0; q < g.n; q++) T2[q] = Math.exp(o[q]); return T2;
  }

  RF.SqmTarget = { grid, judgeGrid, judge, mdOf, bands, logBlur, satOf };
})();

// ======================================================================= design of T*
(function () {
  'use strict';
  const RF = globalThis.RF, T = RF.SqmTarget, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // road-driven plateau: the intensity (cd) that gives E(x, y) = E100 · (100 / x)^gamma on the road where each pixel's ray lands
  // (a vertical sensor 25 cm up facing the car, IIHS), within the road + a verge, out to the IIHS distances (100 m right edge, 60 m left edge).
  function roadPlateau(g, spec, R) {
    R = Object.assign({ mountH: 0.65, lane: 3.3, sensorZ: 0.25, E100: 1, gamma: 0.8, verge: 1.5, lamps: 2, nearM: 4, farR: 100, farL: 60 }, R || {});
    const out = new Float64Array(g.n), drop = R.mountH - R.sensorZ, sg = spec.traffic === 'LHT' ? -1 : 1, yR = -R.lane / 2, yL = 1.5 * R.lane;
    if (!(drop > 0)) return out;
    for (let j = 0; j < g.nv; j++) {
      const v = g.vOf(j); if (!(v < -0.05)) continue;
      const dist = drop / Math.tan(-v * D2R);
      for (let i = 0; i < g.nh; i++) {
        const h = sg * g.hOf(i), x = dist * Math.cos(h * D2R), y = -dist * Math.sin(h * D2R);
        if (x < R.nearM) continue;
        const o = y < yR ? yR - y : y > yL ? y - yL : 0, wy = Math.exp(-((o / R.verge) ** 2));
        const goal = R.farR + (R.farL - R.farR) * clamp((y - yR) / (yL - yR), 0, 1), wx = 1 / (1 + Math.exp((x - goal) / 8));
        const E = R.E100 * Math.pow(100 / x, R.gamma) * wy * wx, r = Math.hypot(x, y, drop);
        out[j * g.nh + i] = E * r * r / (x / r) / R.lamps;
      }
    }
    return out;
  }
  // a soft dilation of the floors that sit above the cut-off (the sign points): a dim glow, not isolated pixels
  function glowField(g, lo, hi, radius) {
    const out = new Float64Array(g.n), r = Math.ceil(radius / g.step);
    for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; if (!(lo[q] > 0) || g.vOf(j) < 0.2) continue;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= g.nh || jj >= g.nv) continue; const d = Math.hypot(di, dj) * g.step, w = d <= radius * 0.5 ? 1 : Math.max(0, 1 - (d - radius * 0.5) / (radius * 0.5)); const p = jj * g.nh + ii; if (lo[q] * w > out[p]) out[p] = lo[q] * w; } }
    return out;
  }
  // the cut-off line of the spec: where the beam's top edge sits at each H (needs a cut-off scan in the spec): the aim rule's line on the oncoming
  // side (R112 0.57° D, FMVSS VOL 0.4° D), rising on the own side (ECE 15° up to +1°, US ≈ 1.4°/° up to +1°).
  function cutOf(spec) {
    if (!spec.items.some((x) => x.kind === 'gradient')) return null;
    const line = spec.aim && spec.aim.line < 0 ? spec.aim.line : -0.57, own = spec.traffic === 'LHT' ? -1 : 1, us = /^fmvss/.test(spec.preset || ''), t15 = Math.tan(15 * D2R);
    return { line, own, us, top: (h) => { const x = own * h; return x <= 0 ? line : us ? Math.min(line + 1.4 * x, 1.0) : Math.min(line + x * t15, 1.0); } };
  }
  const fluxOf = (g, Tf) => { let s = 0; for (let q = 0; q < g.n; q++) s += Tf[q] * g.om[q]; return s; };

  // a wide foreground wash: the sink for light the road term cannot use (below the spec's own zones, wide, smooth)
  function washShape(g, spec, o) {
    o = Object.assign({ sigH: 18, top: -4.2, ramp: 1.6, bottom: -14 }, o || {}); const out = new Float64Array(g.n);
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); let t = clamp((o.top - v) / o.ramp, 0, 1); t = t * t * (3 - 2 * t); if (v < o.bottom) t *= Math.max(0, 1 - (o.bottom - v) / 6); if (!(t > 0)) continue; for (let i = 0; i < g.nh; i++) out[j * g.nh + i] = t * Math.exp(-((g.hOf(i) / o.sigH) ** 2)); }
    return out;
  }
  /* One T* for given parameters.  plateau = alpha · road (zero above the cut-off line shifted down by dTop), max'ed with the wash (level W0) and the glow, clamped by
   * the floors/ceilings, a log-domain blur of width sv makes the edges, a final clamp keeps every pixel inside its band.                                         */
  function build(P, S, alpha, W0, sv, dTop) {
    const { g, B } = P, n = g.n, Th = new Float64Array(n), cut = S.cut, cap = P.peakCap > 0 ? P.peakCap : Infinity;
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; let s = alpha * S.road[q]; if (cut && v > cut.top(g.hOf(i)) - dTop) s = 0; s = Math.max(Math.min(s, cap), W0 * S.wash[q], S.glow[q]); Th[q] = clamp(s, B.lo[q], B.hi[q]); } }
    const Tb = T.logBlur(g, Th, sv, P.sh >= 0 ? P.sh : 0.1), Tf = new Float64Array(n);
    for (let q = 0; q < n; q++) { let x = Tb[q]; if (x < 1e-2) x = 0; Tf[q] = clamp(x, B.lo[q], B.hi[q]); }
    return Tf;
  }
  const hardFails = (ev) => ev.rows.filter((r) => r.verdict === 'fail').length;
  // the wash level that makes the post-blur flux equal the target (the road term is fixed by the peak cap)
  function washFor(P, S, alpha, sv, dTop, fluxTarget) {
    let lo = 0, hi = P.washCap > 0 ? P.washCap : 1e5; if (fluxOf(P.g, build(P, S, alpha, hi, sv, dTop)) < fluxTarget) return hi;     // even the cap cannot absorb it
    if (fluxOf(P.g, build(P, S, alpha, 0, sv, dTop)) >= fluxTarget) return 0;
    for (let it = 0; it < 14; it++) { const m = 0.5 * (lo + hi); (fluxOf(P.g, build(P, S, alpha, m, sv, dTop)) < fluxTarget ? (lo = m) : (hi = m)); }
    return 0.5 * (lo + hi);
  }
  /* design(P): P = { spec, g, B, fluxTarget (lm in the window), peakCap (cd), washCap (cd), gd (design G per 0.1°; the realised edge is softer, so aim a bit sharp), road, glowR }.
   * Searches the edge: for each shift dTop of the plateau below the line, the blur that gives gd; keeps the first that passes the real judge. */
  function design(P) {
    const { g, spec } = P, gd = P.gd || 0.34, road = roadPlateau(g, spec, P.road); let rmax = 0; for (const x of road) if (x > rmax) rmax = x;
    const S = { road, wash: washShape(g, spec, P.wash), glow: glowField(g, P.B.lo, P.B.hi, P.glowR || 3.0), cut: P.cut === undefined ? cutOf(spec) : P.cut };
    const alpha = P.peakCap > 0 ? P.peakCap / Math.max(1e-9, rmax) : (P.alpha || 1);
    const hasGrad = spec.items.some((x) => x.kind === 'gradient');
    const tries = []; let best = null;
    for (const dTop of (hasGrad ? (P.dTops || [0, 0.1, 0.2, 0.3, 0.45, 0.6]) : [0])) {
      let sv = P.sv > 0 ? P.sv : 0.3, Tf = null, W0 = 0, G = NaN;
      for (let it = 0; it < 4; it++) {
        W0 = P.fluxTarget > 0 ? washFor(P, S, alpha, sv, dTop, P.fluxTarget) : 0; Tf = build(P, S, alpha, W0, sv, dTop);
        if (!hasGrad) break;
        const ev = T.judge(g, Tf, spec), gr = ev.rows.find((r) => r.unit === 'log'); if (!gr || !(gr.value > 0)) break;
        G = gr.value; if (Math.abs(G - gd) < 0.02) break; sv *= clamp(G / gd, 0.5, 2);
      }
      const ev = T.judge(g, Tf, spec), res = { dTop, sv, W0, G, T: Tf, fails: hardFails(ev), worst: Math.min(...ev.rows.map((r) => r.margin)), ev };
      tries.push(res); if (!best || res.fails < best.fails || (res.fails === best.fails && res.worst > best.worst + 0.02)) best = res;
      if (res.fails === 0 && res.worst > 0.04) { best = res; break; }
    }
    const flux = fluxOf(g, best.T);
    return { T: best.T, alpha, W0: best.W0, flux, leftover: Math.max(0, (P.fluxTarget || 0) - flux), edge: { sv: best.sv, dTop: best.dTop, G: best.G }, ev: best.ev, tries: tries.map((t) => ({ dTop: t.dTop, sv: +t.sv.toFixed(3), G: +t.G.toFixed(3), fails: t.fails, worst: +t.worst.toFixed(2) })), road, glow: S.glow, wash: S.wash };
  }
  T.washShape = washShape;
  T.roadPlateau = roadPlateau; T.glowField = glowField; T.cutOf = cutOf; T.design = design; T.fluxOf = fluxOf;
})();

// ============================================================ plan
/* plan.js — the aim layout: N aims (far-field directions) with a flux each, from the ideal beam T*.
 * v0: flux-weighted k-means (Lloyd) over super-pixels of T*, so every aim carries about the same flux and the density of aims follows the light. */
(function () {
  'use strict';
  const RF = globalThis.RF;
  function hil(x, y, order) { let d = 0; for (let s = 1 << (order - 1); s > 0; s >>= 1) { const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0; d += s * s * ((3 * rx) ^ ry); if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } const t = x; x = y; y = t; } } return d; }
  // aggregate T* (cd per pixel on grid g) into super-pixels of `sp` degrees: each = { h, v (flux centroid), f (lm), om, area }
  function superpixels(g, T, sp) {
    const k = Math.max(1, Math.round(sp / g.step)), nx = Math.ceil(g.nh / k), ny = Math.ceil(g.nv / k), out = [];
    for (let J = 0; J < ny; J++) for (let I = 0; I < nx; I++) {
      let f = 0, h = 0, v = 0, om = 0;
      for (let j = J * k; j < Math.min(g.nv, (J + 1) * k); j++) for (let i = I * k; i < Math.min(g.nh, (I + 1) * k); i++) { const q = j * g.nh + i, w = T[q] * g.om[q]; om += g.om[q]; if (w > 0) { f += w; h += w * g.hOf(i); v += w * g.vOf(j); } }
      if (f > 1e-9) out.push({ h: h / f, v: v / f, f, om, I, J });
    }
    return out;
  }
  function kmeans(sp, N, iters, bias) {
    bias = bias === undefined ? 1 : bias;                              // 1 = by flux (equal-flux cells); 0 = by area
    const n = sp.length; N = Math.min(N, n);
    const w = sp.map((s) => Math.pow(s.f, bias) * Math.pow(s.om, 1 - bias)), W = w.reduce((a, b) => a + b, 0);
    const ord = sp.map((s, i) => i).sort((a, b) => hil(sp[a].I, sp[a].J, 10) - hil(sp[b].I, sp[b].J, 10) || a - b);
    let cs = [], acc = 0, nxt = W / N / 2; for (const i of ord) { acc += w[i]; if (acc >= nxt && cs.length < N) { cs.push({ h: sp[i].h, v: sp[i].v }); nxt += W / N; } }
    const own = new Int32Array(n);
    for (let it = 0; it < iters; it++) {
      const sh = new Float64Array(cs.length), sv = new Float64Array(cs.length), sw = new Float64Array(cs.length);
      for (let i = 0; i < n; i++) { let bj = 0, bd = Infinity; for (let j = 0; j < cs.length; j++) { const d = (sp[i].h - cs[j].h) ** 2 + (sp[i].v - cs[j].v) ** 2; if (d < bd) { bd = d; bj = j; } } own[i] = bj; sh[bj] += sp[i].h * w[i]; sv[bj] += sp[i].v * w[i]; sw[bj] += w[i]; }
      cs = cs.map((c, j) => sw[j] > 0 ? { h: sh[j] / sw[j], v: sv[j] / sw[j] } : c);
    }
    const aims = cs.map((c) => ({ h: c.h, v: c.v, F: 0, area: 0, mh: 0, mv: 0, shh: 0, shv: 0, svv: 0 }));
    for (let i = 0; i < n; i++) { const a = aims[own[i]], f = sp[i].f; a.F += f; a.area += sp[i].om; a.mh += f * sp[i].h; a.mv += f * sp[i].v; a.shh += f * sp[i].h * sp[i].h; a.shv += f * sp[i].h * sp[i].v; a.svv += f * sp[i].v * sp[i].v; }
    for (const a of aims) { if (a.F > 0) { const mh = a.mh / a.F, mv = a.mv / a.F; a.cov = [a.shh / a.F - mh * mh, a.shv / a.F - mh * mv, a.svv / a.F - mv * mv]; } else a.cov = [0, 0, 0]; }
    return aims.filter((a) => a.F > 0);
  }
  // two tiers: the main beam (flux-weighted cells) and the dim regions (area-weighted cells: a few big, wide tiles for the glow)
  function twoTier(sp, N, o) {
    o = Object.assign({ dimCut: 0.04, dimTile: 10, dimFrac: 0.2, iters: 20, reserve: 0 }, o || {});
    let pk = 0; for (const s of sp) { const cd = s.f / s.om; if (cd > pk) pk = cd; }
    const dim = [], main = []; for (const s of sp) (s.f / s.om < Math.max(o.dimAbs || 0, o.dimCut * pk) ? dim : main).push(s);
    let dimArea = 0; for (const s of dim) dimArea += s.om / (Math.PI / 180) ** 2;
    const nDim = dim.length ? Math.max(1, Math.min(Math.round(N * o.dimFrac) - o.reserve, Math.round(dimArea / o.dimTile))) : 0;
    const aD = nDim > 0 ? kmeans(dim, nDim, o.iters, 0) : [], aM = kmeans(main, Math.max(1, N - aD.length - o.reserve), o.iters, 1);
    return { main: aM, dim: aD, peak: pk };
  }
  RF.SqmPlan = { superpixels, kmeans, twoTier };
})();

// ============================================================ sqm
/* sqm.js — the supporting-quadric core: one continuous reflector as the lower envelope of confocal ellipsoids (paraboloids for a far-field aim).
 *
 * Aim j (a far-field direction, or a point Z_j at distance c_j) owns the ellipsoid with foci LED and Z_j and one size number β_j (its extra path
 * length): r_j(u) = β(β + 2c) / (2β + 2c(1 − u·â_j)) along direction u from the LED.  In every direction the NEAREST ellipsoid is the mirror, so the
 * surface is continuous.  Growing β_j shrinks cell j.  The sizes are found so that each cell catches its share of the light: semi-discrete optimal
 * transport, solved by damped Newton on an entropic dual (Kitagawa–Mérigot–Thibert) at falling temperature τ.
 *
 *   RF.SqmCore.directions(src, env, opt)  → D { n, ux,uy,uz, m (lm), rEnv, rMin, ang, q, a, NA, NP, B, e1, e2, dOm }
 *   RF.SqmCore.balance(D, A, opt)         → { x (ln β), assign (Int32Array), flux[], err, ... }  A[j] = { c, ax, ay, az, g (target lm) }
 *   RF.SqmCore.radius(A[j], x, u)         → r
 */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- directions: an equal-area grid about the beam axis B
  function directions(src, env, o) {
    o = Object.assign({ NA: 120, margin: 0.3, rmin: 0, B: [1, 0, 0] }, o || {});
    const NA = o.NA, NP = 2 * NA, B = V.norm(o.B), [e1, e2] = V.basis(B), fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src), dOm = 4 * Math.PI / (NA * NP), Lp = src.pos;
    const ux = [], uy = [], uz = [], m = [], rEnv = [], rMin = [], ang = [], qq = [], aa = [];
    for (let q = 0; q < NP; q++) for (let a = 0; a < NA; a++) {
      const ca = 1 - 2 * (a + 0.5) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = (q + 0.5) / NP * 2 * Math.PI;
      const u = V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa));
      const I = RF.Source.intensity(src, Math.acos(clamp(V.dot(u, fr.a), -1, 1))); if (!(I > 0)) continue;
      const iv = RF.Geo.envInterval(env, Lp, u); if (!iv || !(iv[1] > Math.max(0, iv[0]))) continue;
      const rE = iv[1] - o.margin, rM = Math.max(o.rmin, iv[0] > 0 ? iv[0] + o.margin : 0); if (!(rE > rM)) continue;
      ux.push(u[0]); uy.push(u[1]); uz.push(u[2]); m.push(src.power * I / Itot * dOm); rEnv.push(rE); rMin.push(rM); ang.push(Math.acos(ca) * 180 / Math.PI); qq.push(q); aa.push(a);
    }
    const cellOf = new Int32Array(NA * NP).fill(-1); for (let i = 0; i < qq.length; i++) cellOf[qq[i] * NA + aa[i]] = i;
    return { cellOf, n: ux.length, ux: Float64Array.from(ux), uy: Float64Array.from(uy), uz: Float64Array.from(uz), m: Float64Array.from(m), rEnv: Float64Array.from(rEnv), rMin: Float64Array.from(rMin), ang: Float64Array.from(ang), q: Int32Array.from(qq), a: Int32Array.from(aa), NA, NP, B, e1, e2, dOm, Lp: Lp.slice(), fr };
  }
  // corner direction of cell (q, a): the grid line crossing (q·dφ, a·dα)
  function corner(D, q, a) { const ca = 1 - 2 * a / D.NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), phi = q / D.NP * 2 * Math.PI; return V.add(V.mul(D.B, ca), V.mul(V.add(V.mul(D.e1, Math.cos(phi)), V.mul(D.e2, Math.sin(phi))), sa)); }

  const radius = (A, x, u) => { const b = Math.exp(x), c2 = 2 * A.c; return b * (b + c2) / (2 * b + c2 * (1 - (u[0] * A.ax + u[1] * A.ay + u[2] * A.az))); };

  // ---------------------------------------------------------------- dense Cholesky solve (A symmetric positive definite, destroyed)
  function chol(A, b, n) {
    for (let j = 0; j < n; j++) {
      let s = A[j * n + j]; for (let k = 0; k < j; k++) s -= A[j * n + k] * A[j * n + k];
      if (!(s > 1e-300)) return null; const dj = Math.sqrt(s); A[j * n + j] = dj;
      for (let i = j + 1; i < n; i++) { let t = A[i * n + j]; for (let k = 0; k < j; k++) t -= A[i * n + k] * A[j * n + k]; A[i * n + j] = t / dj; }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let t = b[i]; for (let k = 0; k < i; k++) t -= A[i * n + k] * y[k]; y[i] = t / A[i * n + i]; }
    for (let i = n - 1; i >= 0; i--) { let t = y[i]; for (let k = i + 1; k < n; k++) t -= A[k * n + i] * y[k]; y[i] = t / A[i * n + i]; }
    return y;
  }

  /* ---------------------------------------------------------------- the balance
   * D: directions (those with D.on[i] = 1 are in play), A: aims, x: Float64Array(J) ln β (in/out), taus: temperature schedule.
   * Soft cell mass F_j = Σ_i m_i p_ij, p_ij ∝ exp(−ln r_ij / τ).  Newton on F(x) = g with M = −∂F/∂x (a weighted graph Laplacian over neighbouring
   * cells), Levenberg damping, a step is kept only if the relative flux error falls.  Candidate lists per direction (every aim whose radius is within a
   * window of the smallest) keep a step O(directions × few).                                                                                            */
  function newton(D, on, A, x, taus, tolLast, maxIt, o) {
    o = o || {}; const J = A.length, nd = D.n, WIN = o.window || 0.08;
    let tot = 0; for (let i = 0; i < nd; i++) if (on[i]) tot += D.m[i];
    let gsum = 0; for (const a of A) gsum += a.g; const want = A.map((a) => a.g / gsum * tot);
    const cc = new Float64Array(J), ax = new Float64Array(J), ay = new Float64Array(J), az = new Float64Array(J);
    for (let j = 0; j < J; j++) { cc[j] = 2 * A[j].c; ax[j] = A[j].ax; ay[j] = A[j].ay; az[j] = A[j].az; }
    const b = new Float64Array(J), q = new Float64Array(J), e2 = new Float64Array(J), gb = new Float64Array(J);
    const setB = () => { for (let j = 0; j < J; j++) { const bj = Math.exp(x[j]); b[j] = bj; q[j] = bj * (bj + cc[j]); e2[j] = 2 * bj; gb[j] = 1 + bj / (bj + cc[j]); } };
    const xr = new Float64Array(J).fill(NaN); let coff = new Int32Array(nd + 1), cidx = new Int32Array(nd * 6 + 64), tauBuilt = 0;
    const rOf = (i, j) => q[j] / (e2[j] + cc[j] * (1 - (D.ux[i] * ax[j] + D.uy[i] * ay[j] + D.uz[i] * az[j])));
    const drift = () => { let mx = 0; for (let j = 0; j < J; j++) { const d = Math.abs(x[j] - xr[j]); if (!(d <= mx)) mx = d; } return mx; };
    const R = new Float64Array(J);
    const rebuild = (tau) => {
      xr.set(x); tauBuilt = tau; const w = Math.exp(2 * 1.3 * WIN + 18 * tau); let n = 0;
      for (let i = 0; i < nd; i++) {
        coff[i] = n; if (!on[i]) continue;
        let rmin = Infinity; for (let j = 0; j < J; j++) { const r = rOf(i, j); R[j] = r; if (r < rmin) rmin = r; }
        const thr = rmin * w; if (n + J > cidx.length) { const g2 = new Int32Array(Math.max(cidx.length * 2, n + J)); g2.set(cidx.subarray(0, n)); cidx = g2; }
        for (let j = 0; j < J; j++) if (R[j] <= thr) cidx[n++] = j;
      }
      coff[nd] = n;
    };
    const F = new Float64Array(J), M = new Float64Array(J * J), pp = new Float64Array(J), cj = new Int32Array(J), gg = new Float64Array(J), lr = new Float64Array(J);
    const evalF = (tau, wantM) => {
      setB(); if (drift() > WIN || tau > tauBuilt) rebuild(tau);
      F.fill(0); if (wantM) M.fill(0); const cut = 18 * tau;
      for (let i = 0; i < nd; i++) {
        if (!on[i]) continue; const o0 = coff[i], o1 = coff[i + 1]; let lmin = Infinity;
        for (let t = o0; t < o1; t++) { const j = cidx[t], l = Math.log(rOf(i, j)); lr[t - o0] = l; if (l < lmin) lmin = l; }
        let nc = 0, zs = 0;
        for (let t = 0; t < o1 - o0; t++) if (lr[t] - lmin <= cut) { cj[nc] = cidx[o0 + t]; const p = Math.exp(-(lr[t] - lmin) / tau); pp[nc] = p; zs += p; nc++; }
        const fl = D.m[i];
        for (let t = 0; t < nc; t++) { pp[t] /= zs; F[cj[t]] += fl * pp[t]; }
        if (wantM) {
          const f = fl / tau;
          for (let t = 0; t < nc; t++) { const j = cj[t]; gg[t] = gb[j] - 2 * b[j] / (e2[j] + cc[j] * (1 - (D.ux[i] * ax[j] + D.uy[i] * ay[j] + D.uz[i] * az[j]))); }
          for (let t = 0; t < nc; t++) { const pt = pp[t]; if (pt < 1e-7) continue; const it = cj[t] * J; M[it + cj[t]] += f * gg[t] * pt * (1 - pt); for (let u = 0; u < nc; u++) if (u !== t && pp[u] >= 1e-7) M[it + cj[u]] -= f * gg[u] * pt * pp[u]; }
        }
      }
    };
    const norm = (res) => { let s = 0; for (let j = 0; j < J; j++) s += res[j] * res[j] / (want[j] * want[j]); return Math.sqrt(s / J); };
    const res = new Float64Array(J), res2 = new Float64Array(J), Asym = new Float64Array(J * J), xo = new Float64Array(J);
    let soft = 0, iters = 0;
    for (let si = 0; si < taus.length; si++) {
      const tau = taus[si], last = si === taus.length - 1; let mu = 1e-3, revived = 0;
      for (let it = 0; it < maxIt; it++) {
        iters++; evalF(tau, true); for (let j = 0; j < J; j++) res[j] = F[j] - want[j];
        let worst = 0; for (let j = 0; j < J; j++) worst = Math.max(worst, Math.abs(res[j]) / want[j]); soft = worst;
        if (worst < (last ? tolLast : Math.max(0.05, tolLast))) break;
        // a cell with (almost) no flux has no gradient: shrink it until it is within ~3τ of winning its best direction
        let dead = 0; for (let j = 0; j < J; j++) if (F[j] < 1e-3 * want[j]) dead++;
        if (dead && revived < 6) {
          revived++; const mr = new Float64Array(J).fill(Infinity), isd = new Uint8Array(J); for (let j = 0; j < J; j++) if (F[j] < 1e-3 * want[j]) isd[j] = 1;
          for (let i = 0; i < nd; i++) { if (!on[i]) continue; let rmin = Infinity; for (let j = 0; j < J; j++) { const r = rOf(i, j); R[j] = r; if (r < rmin) rmin = r; } for (let j = 0; j < J; j++) if (isd[j]) { const t = R[j] / rmin; if (t < mr[j]) mr[j] = t; } }
          for (let j = 0; j < J; j++) if (isd[j] && mr[j] < Infinity) x[j] -= Math.max(0, Math.log(mr[j]) / gb[j]) + 3 * tau;
          it--; continue;
        }
        const n0 = norm(res); let dm = 0; for (let j = 0; j < J; j++) dm += M[j * J + j]; dm = dm / J + 1e-300;
        let ok = false;
        for (let tries = 0; tries < 8 && !ok; tries++, mu *= 10) {
          for (let i = 0; i < J; i++) { for (let j = 0; j < J; j++) Asym[i * J + j] = 0.5 * (M[i * J + j] + M[j * J + i]); Asym[i * J + i] += mu * (M[i * J + i] + 1e-3 * dm); }
          const dl = chol(Asym, res, J); if (!dl) continue;
          let mean = 0; for (let j = 0; j < J; j++) mean += dl[j]; mean /= J; for (let j = 0; j < J; j++) dl[j] = clamp(dl[j] - mean, -0.3, 0.3);
          for (let s = 1; s > 0.05 && !ok; s *= 0.5) {
            xo.set(x); for (let j = 0; j < J; j++) x[j] += s * dl[j];
            evalF(tau, false); for (let j = 0; j < J; j++) res2[j] = F[j] - want[j];
            if (norm(res2) < n0 * (1 - 1e-3 * s)) { ok = true; mu = Math.max(1e-6, mu * 0.05 / 10); } else x.set(xo);
          }
        }
        if (!ok) break;
      }
    }
    return { soft, iters };
  }

  // hard partition at x: each direction in play goes to the aim with the smallest radius
  function assign(D, on, A, x) {
    const J = A.length, nd = D.n, asg = new Int32Array(nd).fill(-1), rr = new Float64Array(nd), flux = new Float64Array(J);
    const b = A.map((a, j) => Math.exp(x[j])), cc = A.map((a) => 2 * a.c);
    for (let i = 0; i < nd; i++) {
      if (!on[i]) continue; let bj = -1, br = Infinity;
      for (let j = 0; j < J; j++) { const A_ = A[j], r = b[j] * (b[j] + cc[j]) / (2 * b[j] + cc[j] * (1 - (D.ux[i] * A_.ax + D.uy[i] * A_.ay + D.uz[i] * A_.az))); if (r > 0 && r < br) { br = r; bj = j; } }
      asg[i] = bj; rr[i] = br; if (bj >= 0) flux[bj] += D.m[i];
    }
    return { asg, rr, flux };
  }

  RF.SqmCore = { directions, corner, radius, newton, assign, chol };
})();

// ============================================================ emit
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

// ============================================================ pipeline
/* pipeline.js — the headlamp SQM solver's core: spec → ideal beam → aims → one continuous reflector → facets → model → corrections.
 *   RF.SqmPipe.solve(input, S, tools) → { surfaces, best, P, ... }                                                                              */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, T = RF.SqmTarget, Pl = RF.SqmPlan, C = RF.SqmCore, E = RF.SqmEmit, F = RF.SqmFwd;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const DEFAULTS = {
    N: 0, NA: 150, NAcoarse: 60, iters: 6, margin: 1.2, gd: 0.34, peakCap: 80000, washCap: 12000,
    dimFrac: 0.2, dimTile: 10, dimFill: 1.35, mainFill: 1.5, softAll: 0.22, edgeSoft: 0.2, gTarget: 0.28, slack: 1.0, step: 0.05, cutPasses: 1, sweeps: 5, maxShift: 0.6, wBand: 8, wTrack: 0.03, wEdge: 3, f0: 60,
  };

  function problem(input, S, tools) {
    const src = input.source, env = input.envelope, spec = input.spec, refl = input.limits.reflectivity, conv = spec.conv || 'A';
    const dd = spec.measure && +spec.measure.distance, dist = dd > 0 && isFinite(dd) ? dd : Infinity;      // the host's JSON copy turns the far field (Infinity) into null
    const P = { S, input, src, env, spec, refl, conv, dist, Lp: src.pos.slice(), N: S.N > 0 ? Math.min(S.N, input.limits.maxFacets) : input.limits.maxFacets, t0: Date.now(), notes: [] };
    P.lap = (s) => { if (S.verbose) console.log(`[${((Date.now() - P.t0) / 1000).toFixed(1)}s] ${s}`); };
    P.g = T.grid(spec.window, S.step, conv); P.B = T.bands(spec, P.g, { lo: S.margin, hi: S.margin });
    P.grid = F.gridOf(spec.window, S.step, conv, dist, P.Lp); P.S_ = F.sourceSamples(src, 128);
    P.rmin = Math.max(env.keepOut || 0, S.minDistance || 0) + RF.Source.boundingRadius(src) * 0.5; P.cut0 = T.cutOf(spec); P.cutShift = 0; P.cut = P.cut0;
    // the aim point of a facet at Pf toward direction d: on the measuring screen as seen from the photometric centre (finite distance: no parallax), else far away along d
    P.zOf = (Pf, d) => (isFinite(dist) && d[0] > 0.05 ? V.add(P.Lp, V.mul(d, dist / d[0])) : V.add(Pf, V.mul(d, 1e6)));
    P.aimAt = (h, v, share, tier) => { const d = RF.FarField.dirOf(h, v, conv); return { c: isFinite(dist) ? dist : 1e6, ax: d[0], ay: d[1], az: d[2], g: share, h, v, tier, Z(Pf) { return P.zOf(Pf, [this.ax, this.ay, this.az]); } }; };
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
    P.des = T.design({ spec: P.spec, g: P.g, B: P.B, fluxTarget: P.refl * capLm * 0.97, peakCap: S.peakCap, washCap: S.washCap, gd: S.gd, cut: P.cut || null, road: S.gamma !== undefined ? { gamma: S.gamma } : undefined });
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
    return { fld, Ed, Et, gj, ev, hard, worst, score: -hard * 10 + Math.max(-3, worst) };
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
      design(P, cov); P.lap(`ideal beam (cut-off shift ${P.cutShift.toFixed(2)}°): ${P.des.flux.toFixed(0)} lm, G ${P.des.edge.G.toFixed(2)}, ${P.A.length} main + ${P.Ad.length} dim units`);
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
        const pol = polish(P, best.facets, best.m, { wBand: S.wBand, wTrack: S.wTrack, wEdge: S.wEdge, f0: S.f0, maxShift: trust, steps: [0.05, 0.1, 0.2].filter((q) => q <= trust + 1e-9), scales: [], sweeps: S.sweeps });
        const mv = applyTilt(P, pol, params); P.lap(`   polish (trust ${trust.toFixed(2)}°): cost ${pol.cost0.toFixed(1)} → ${pol.cost1.toFixed(1)}, ${mv} facets tilted`);
      }
      const res = { surfaces: best.facets, best, P, Df, on, pass, cutShift: P.cutShift }; if (!overall || best.m.score > overall.best.m.score) overall = res;
      // where did the model-judge find the cut-off inflection, against where it should be?  Move the design's line by the difference and go again.
      const gr = best.m.ev.rows.find((r) => r.unit === 'log' && r.at), line = P.cut0 ? P.cut0.line : 0;
      if (!gr || !P.cut0) break; const infl = gr.at[1], off = infl - (P.spec.aim && P.spec.aim.line < 0 ? P.spec.aim.line : -0.57) + (best.m.ev.reaim ? best.m.ev.reaim[1] || 0 : 0) * 0;
      P.lap(`model inflection ${infl.toFixed(2)}° (wanted ${(P.spec.aim && P.spec.aim.line < 0 ? P.spec.aim.line : -0.57).toFixed(2)}°)`);
      if (Math.abs(off) < 0.08) break; P.cutShift = clamp(P.cutShift - 0.9 * off, -1.5, 1.5);
    }
    overall.cover = cov; overall.Mtot = Mtot; overall.timing = `plan+surface ${((P.tPlan || 0) / 1000).toFixed(1)} s`;
    // verification traces: the real engine on the finished design, scored with the app's judge; the report quotes a loose verdict next to the strict one
    if (S.traces > 0 && tools && tools.trace && S.traceRays > 0) {
      try { const surf = overall.surfaces.map(cleanFacet), tr = tools.trace(surf, { rays: Math.min(2e6, S.traceRays), spec: true });
        if (tr && tr.spec) { const lo = { pass: 0, near: 0, fail: 0 }; for (const r of tr.spec.rows) lo[RF.SqmSolver ? RF.SqmSolver.loose(r) : 'pass']++; overall.trace = { spec: tr.spec, rays: Math.min(2e6, S.traceRays), loose: lo }; } } catch (e) { P.notes.push('verification trace failed: ' + e.message); }
    }
    return overall;
  }
  RF.SqmPipe = { cleanFacet, solve, DEFAULTS, problem, directions, design, balance, fitSurface, buildBase, naturalOf, realize, evaluate, directField, correct, polish };
})();

// ============================================================ solver-main
/* solver-main.js — registration, settings, quality presets, notes.  The solver proper is RF.SqmPipe (pipeline.js). */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;
  const ID = 'sqm-hl', VERSION = '0.1';

  // quality presets: what each tier spends (directions, correction rounds, polish sweeps, verification traces)
  const QUALITY = {
    fast:   { NA: 110, NAcoarse: 50, iters: 4, sweeps: 3, traces: 0, traceRays: 0 },
    normal: { NA: 150, NAcoarse: 60, iters: 6, sweeps: 5, traces: 1, traceRays: 1000000 },
    best:   { NA: 220, NAcoarse: 80, iters: 10, sweeps: 8, traces: 2, traceRays: 2000000 },
  };
  // [key, label, type, default, extra] — tier 1 first (constraints, quality, the beam's goals), then tier 2 (everything the algorithm decides by itself; adv: true)
  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'quality', label: 'Quality (fast ≈ 10 s, normal ≈ 20 s, best ≈ 45 s for 100 facets; Node timings)', type: 'select', default: 'normal', options: [{ value: 'fast', label: 'fast' }, { value: 'normal', label: 'normal' }, { value: 'best', label: 'best' }] },
    { key: 'facets', label: 'Facets to use (0 = the whole budget). ~16 gives a nominal beam, 40–50 starts to pass, 100 is the sweet spot, above ~300 is slow', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'peakCap', label: 'Peak intensity the ideal beam may ask for, cd (default 80,000; reasonable 20,000–200,000; the étendue of the source and the dish decide what is reachable)', type: 'number', min: 100, step: 1000, default: 80000 },
    { key: 'washCap', label: 'Foreground wash level the left-over light may fill, cd (default 12,000; reasonable 2,000–30,000)', type: 'number', min: 0, step: 500, default: 12000 },
    { key: 'margin', label: 'Design margin on every floor and ceiling, × (default 1.2 = 20 %; reasonable 1.05–1.6; 1 = design to the limit)', type: 'number', min: 1, step: 0.05, default: 1.2 },
    { key: 'dimFrac', label: 'Largest share of the facets the dim glow units may take (default 0.2; reasonable 0–0.35)', type: 'number', min: 0, step: 0.01, default: 0.2 },
    { key: 'gamma', label: 'Road uniformity: illuminance falls as distance^−γ (default 0.8; 0 = even, 1 = typical halogen, reasonable 0–1.5)', type: 'number', min: 0, step: 0.05, default: 0.8, adv: true },
    { key: 'cutG', label: 'Cut-off sharpness the ideal beam is built with, log10 per 0.1° (default 0.34; the real edge comes out softer; the spec decides the allowed window)', type: 'number', min: 0.02, step: 0.01, default: 0.34, adv: true },
    { key: 'gTarget', label: 'Cut-off sharpness the corrections steer the real edge to (default 0.28)', type: 'number', min: 0.02, step: 0.01, default: 0.28, adv: true },
    { key: 'NA', label: 'Direction grid, polar bands (−1 = by quality; 150 → ~45,000 directions; cost grows with its square)', type: 'number', min: -1, step: 10, default: -1, adv: true },
    { key: 'iters', label: 'Correction rounds (−1 = by quality)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'sweeps', label: 'Aim polish sweeps per round (−1 = by quality)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'trustDeg', label: 'Largest aim tilt the polish may make in one round, degrees (default 0.6; a 0.4° tilt moves a 7 mm facet edge 0.02 mm)', type: 'number', min: 0, step: 0.05, default: 0.6, adv: true },
    { key: 'mainFill', label: 'Main images spread to this × their cell (default 1.5; fills the gaps between neighbours)', type: 'number', min: 0, step: 0.05, default: 1.5, adv: true },
    { key: 'dimFill', label: 'Dim glow images spread to this × their cell (default 1.35)', type: 'number', min: 0, step: 0.05, default: 1.35, adv: true },
    { key: 'softAll', label: 'Extra blur on every image, degrees 1σ (default 0.22; removes seams between tiles)', type: 'number', min: 0, step: 0.01, default: 0.22, adv: true },
    { key: 'dimTile', label: 'Dim region area per glow unit, deg² (default 10)', type: 'number', min: 0.5, step: 0.5, default: 10, adv: true },
    { key: 'slack', label: 'Light the dish covers vs what the ideal beam needs, × (default 1; more = a smaller dish, blurrier images)', type: 'number', min: 0.5, step: 0.05, default: 1, adv: true },
    { key: 'wBand', label: 'Polish: weight of floor/ceiling violations (default 8)', type: 'number', min: 0, step: 0.5, default: 8, adv: true },
    { key: 'wEdge', label: 'Polish: weight of tracking the ideal cut-off shape (default 3)', type: 'number', min: 0, step: 0.1, default: 3, adv: true },
    { key: 'wTrack', label: 'Polish: weight of tracking the ideal beam elsewhere (default 0.03)', type: 'number', min: 0, step: 0.01, default: 0.03, adv: true },
    { key: 'traces', label: 'Verification traces at the end (−1 = by quality; each ≤ 2 M rays; the report quotes a loose verdict: value ± 1σ inside the limit)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'traceRays', label: 'Rays per verification trace (−1 = by quality)', type: 'number', min: -1, step: 100000, default: -1, adv: true },
  ];

  const loose = (r) => { if (!isFinite(r.value) || !(r.bound > 0 || r.unit === 'deg')) return 'unsure'; const sd = r.sd || 0; const ok = r.isMin ? r.value - sd >= r.bound : r.value + sd <= r.bound, bad = r.isMin ? r.value < r.bound / 10 : r.value > r.bound * 10; return bad ? 'fail' : ok ? 'pass' : 'near'; };

  function solve(input, set, tools) {
    const q = QUALITY[set.quality] || QUALITY.normal, S = {};
    for (const k of ['NA', 'iters', 'sweeps', 'traces', 'traceRays']) S[k] = set[k] >= 0 && set[k] !== undefined && !(set[k] === -1) ? set[k] : q[k];
    Object.assign(S, { N: set.facets > 0 ? set.facets : 0, peakCap: set.peakCap, washCap: set.washCap, margin: set.margin, dimFrac: set.dimFrac, dimTile: set.dimTile, dimFill: set.dimFill, mainFill: set.mainFill, softAll: set.softAll, slack: set.slack,
      gd: set.cutG, gTarget: set.gTarget, maxShift: set.trustDeg, wBand: set.wBand, wEdge: set.wEdge, wTrack: set.wTrack, gamma: set.gamma, NAcoarse: Math.max(40, Math.round(S.NA * 0.4)), minDistance: set.minDistance });
    const prog = (f, s) => { if (tools && tools.progress) tools.progress(f, s); };
    S.progress = prog; S.preview = tools && tools.preview && !tools.preview.none ? tools.preview : null; S.budgetMs = tools && tools.budget && isFinite(tools.budget.ms) ? tools.budget.ms : 120000;
    if (!input.spec) throw new Error('sqm-hl designs to a beam specification: switch to Spec mode (a regulation or your own rows)');
    const t0 = Date.now(), out = RF.SqmPipe.solve(input, S, tools), P = out.P, notes = [];
    const surfaces = out.surfaces.map((f) => { const g = { type: 'facet', id: f.id, P: f.P, S0: f.S0, Z: f.Z, flat: false, di: f.di, clip: f.clip, optics: f.optics }; if (f.vg) { g.vg = f.vg; g.ax = f.ax; } return g; });
    const m = out.best.m; notes.push(`${surfaces.length} facets of one continuous surface (${P.A.length} cells + ${P.Ad.length} dim units); the dish covers ${out.cover.toFixed(0)} of the LED's ${out.Mtot.toFixed(0)} lm, the beam asks for ${P.des.flux.toFixed(0)} lm in the window`);
    notes.push(`model (noise-free) verdict: ${m.ev.verdict} ${JSON.stringify(m.ev.n)}, worst margin ${m.worst.toFixed(2)} decades` + (m.ev.rows.filter((r) => r.verdict !== 'pass').length ? ' — ' + m.ev.rows.filter((r) => r.verdict !== 'pass').map((r) => `${r.name} ${(+r.value).toPrecision(3)} ${r.isMin ? '≥' : '≤'} ${(+r.bound).toPrecision(3)}`).join('; ') : ''));
    if (out.trace) { const tr = out.trace.spec; notes.push(`traced at ${(out.trace.rays / 1e6).toFixed(1)} M rays: ${tr.n.pass} pass · ${tr.n.fail} fail · ${tr.n.unsure} unsure (loose bar: value ± 1σ inside the limit → ${out.trace.loose.pass} pass · ${out.trace.loose.near} near · ${out.trace.loose.fail} off)`); }
    notes.push(`time ${((Date.now() - t0) / 1000).toFixed(1)} s` + (out.timing ? ' (' + out.timing + ')' : ''));
    return { surfaces, notes, extras: { model: { verdict: m.ev.verdict, n: m.ev.n } } };
  }
  RF.Solvers.register({ id: ID, name: 'SQM headlamp (continuous reflector)', version: VERSION, modes: ['paint'], settings: SETTINGS, solve });
  RF.SqmSolver = { solve, SETTINGS, QUALITY, loose };
})();

})(Object.assign(Object.create(globalThis), { RF: Object.create(globalThis.RF) }));
