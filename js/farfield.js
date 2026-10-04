/* farfield.js — RF.FarField: luminous intensity by direction, from the exit rays a trace recorded (P.recordExit).
 * Pure: a finished (or running) trace context in, plain arrays out.  No DOM.
 *
 * What a goniometer measures is intensity I(H, V) in cd = lm/sr: light leaving the lamp per unit solid angle, as seen
 * from infinitely far away.  Every exit ray's LAST leg is a straight line, so binning those legs by DIRECTION gives
 * exactly that (distance = Infinity).  Binning them instead by where they cross a screen at distance D, as seen from
 * the photometric centre, gives what a screen photometer at D reads (illuminance × r² / cos θ, the "apparent
 * intensity"): the same code with one switch, so the near field converging onto the far field can be watched.
 *
 * Lamp frame: forward = world +x (the throw axis), right = world −y (the target's u as seen from the fixture),
 * up = world +z.  Photometric centre = the source position.
 *
 * Angle conventions (opts.conv) — which (H, V) a direction gets:
 *   'A'  V = elevation above the horizontal plane, H = azimuth in it:  d = (cos V cos H, cos V sin H, sin V).
 *        Lines of constant V are horizontal cones; constant H are vertical great circles.  dΩ = cos V dH dV.
 *   'B'  H = angle out of the vertical plane, V = rotation about the right axis:  d = (cos H cos V, sin H, cos H sin V).
 *        dΩ = cos H dH dV.
 *   'S'  flat screen: H = atan(x / D), V = atan(y / D) for screen coordinates (x, y) at distance D.
 * UN R112 (Rev.4, Annex 3 Figure A) defines its angles with a vertical polar axis, h = longitudinal planes around it and
 * v = latitude: that is 'A'.  The three agree to ~V·(1 − cos H), i.e. < 0.05° inside ±10° H.                          */
(function (root) {
  'use strict';
  const RF = root.RF;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const CONVS = ['A', 'B', 'S'];

  // (unit) lamp-frame components a = forward, b = right, c = up  →  [H, V] degrees (NaN where undefined)
  function hvOfABC(a, b, c, conv) {
    if (conv === 'B') return [Math.asin(Math.max(-1, Math.min(1, b))) * R2D, Math.atan2(c, a) * R2D];
    if (conv === 'S') return a > 0 ? [Math.atan(b / a) * R2D, Math.atan(c / a) * R2D] : [NaN, NaN];
    return [Math.atan2(b, a) * R2D, Math.asin(Math.max(-1, Math.min(1, c))) * R2D];
  }
  // world direction → [H, V]   (world: forward +x, right −y, up +z)
  function hvOf(d, conv) { const L = Math.hypot(d[0], d[1], d[2]) || 1; return hvOfABC(d[0] / L, -d[1] / L, d[2] / L, conv || 'A'); }
  // [H, V] → unit world direction
  function dirOf(h, v, conv) {
    const H = h * D2R, Vr = v * D2R;
    let a, b, c;
    if (conv === 'B') { a = Math.cos(H) * Math.cos(Vr); b = Math.sin(H); c = Math.cos(H) * Math.sin(Vr); }
    else if (conv === 'S') { const L = Math.hypot(1, Math.tan(H), Math.tan(Vr)); a = 1 / L; b = Math.tan(H) / L; c = Math.tan(Vr) / L; }
    else { a = Math.cos(Vr) * Math.cos(H); b = Math.cos(Vr) * Math.sin(H); c = Math.sin(Vr); }
    return [a, -b, c];
  }
  // exact solid angle of the (H, V) rectangle [h0,h1]×[v0,v1] (degrees) in a convention
  function binOmega(h0, h1, v0, v1, conv) {
    if (conv === 'B') return (v1 - v0) * D2R * (Math.sin(h1 * D2R) - Math.sin(h0 * D2R));
    if (conv === 'S') {   // rectangle on the unit-distance screen: Ω = Σ± atan(xy / √(1 + x² + y²))
      const F = (x, y) => Math.atan(x * y / Math.sqrt(1 + x * x + y * y)), x0 = Math.tan(h0 * D2R), x1 = Math.tan(h1 * D2R), y0 = Math.tan(v0 * D2R), y1 = Math.tan(v1 * D2R);
      return F(x1, y1) - F(x0, y1) - F(x1, y0) + F(x0, y0);
    }
    return (h1 - h0) * D2R * (Math.sin(v1 * D2R) - Math.sin(v0 * D2R));
  }

  /* Bin a trace's exit rays into an H/V grid.
   *   opts.win = [h0, h1, v0, v1] degrees (default ±45 × ±15) · opts.step = bin size in degrees (default 0.1)
   *   opts.conv = 'A' | 'B' | 'S' · opts.distance = Infinity (far field, default) or a screen distance in mm from the
   *   photometric centre (the screen is normal to the throw axis) · opts.centre = photometric centre (default [0,0,0])
   * Returns { E, E2, Om (per bin), sat: summed-area tables, nh, nv, h0, v0, step, conv, distance, lmWindow, lmExit, rays }.
   * E is in lm (already scaled for a partial / capped trace), Om in sr, so E/Om is cd.                                 */
  function build(ctx, opts) {
    opts = opts || {};
    const x = ctx.ex; if (!x) throw new Error('trace did not record exit rays (set P.recordExit before newCtx)');
    const win = opts.win || [-45, 45, -15, 15], step = opts.step || 0.1, conv = opts.conv || 'A';
    const dist = opts.distance === undefined || opts.distance === null ? Infinity : +opts.distance;
    const c = opts.centre || [0, 0, 0];
    const h0 = win[0], v0 = win[2], nh = Math.max(1, Math.round((win[1] - win[0]) / step)), nv = Math.max(1, Math.round((win[3] - win[2]) / step));
    const cov = RF.Engine.exitCoverage(ctx), scale = ctx.N / Math.max(1, cov);
    const E = new Float64Array(nh * nv), E2 = new Float64Array(nh * nv);
    let lmWindow = 0, lmExit = 0, rays = 0;
    const X = c[0] + dist, finite = isFinite(dist);
    for (let k = 0; k < x.n; k++) {
      if (x.i[k] >= cov) break;
      const e = x.e[k] * scale, q = 3 * k;
      lmExit += e;
      let a = x.d[q], b = -x.d[q + 1], cc = x.d[q + 2];
      if (finite) {                                    // where it crosses the screen, as seen from the centre
        if (!(a > 0)) continue;
        const t = (X - x.o[q]) / a; if (!(t > 0)) continue;
        const px = x.o[q] + t * x.d[q] - c[0], py = x.o[q + 1] + t * x.d[q + 1] - c[1], pz = x.o[q + 2] + t * x.d[q + 2] - c[2], L = Math.hypot(px, py, pz);
        a = px / L; b = -py / L; cc = pz / L;
      }
      const hv = hvOfABC(a, b, cc, conv);
      const i = Math.floor((hv[0] - h0) / step), j = Math.floor((hv[1] - v0) / step);
      if (!(i >= 0 && i < nh && j >= 0 && j < nv)) continue;
      const m = j * nh + i; E[m] += e; E2[m] += e * e; lmWindow += e; rays++;
    }
    const Om = new Float64Array(nh * nv);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) Om[j * nh + i] = binOmega(h0 + i * step, h0 + (i + 1) * step, v0 + j * step, v0 + (j + 1) * step, conv);
    const G = { E, E2, Om, nh, nv, h0, v0, step, h1: h0 + nh * step, v1: v0 + nv * step, conv, distance: dist, centre: c.slice(), lmWindow, lmExit, rays, coverage: cov, N: ctx.N,
      eRay: ctx.P.power / Math.max(1, ctx.N) * scale };   // one emitted ray's energy (lm), for the noise floor of an empty kernel
    G.sat = { E: sat(E, nh, nv), E2: sat(E2, nh, nv), Om: sat(Om, nh, nv) };
    return G;
  }
  // summed-area table, (nh+1)×(nv+1), S[j][i] = Σ of bins with index < (i, j)
  function sat(a, nh, nv) {
    const W = nh + 1, S = new Float64Array(W * (nv + 1));
    for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += a[j * nh + i]; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } }
    return S;
  }
  const box = (S, W, i0, i1, j0, j1) => S[j1 * W + i1] - S[j0 * W + i1] - S[j1 * W + i0] + S[j0 * W + i0];
  // bin index range covering [x − k, x + k], at least one bin (the one containing x)
  function span(x, k, x0, step, n) {
    let a = Math.round((x - k - x0) / step), b = Math.round((x + k - x0) / step);
    if (b <= a) { a = Math.floor((x - x0) / step); b = a + 1; }
    return [Math.max(0, Math.min(n, a)), Math.max(0, Math.min(n, b))];
  }
  /* Intensity at (h, v): light in the kernel square [h ± k] × [v ± k] (degrees, snapped to bins) over its solid angle.
   * sd = shot-noise standard deviation (compound Poisson: √(Σe² + e_ray²), the second term a floor for empty kernels); neff = equivalent number of equal-energy rays.
   * kv (optional) = a different vertical half-width (a cut-off scan wants a wide, flat kernel).
   * Outside the grid → { cd: NaN }.                                                                           */
  function intensityAt(G, h, v, k, kv) {
    const [i0, i1] = span(h, k, G.h0, G.step, G.nh), [j0, j1] = span(v, kv === undefined ? k : kv, G.v0, G.step, G.nv);
    if (i1 <= i0 || j1 <= j0) return { cd: NaN, sd: NaN, neff: 0 };
    const W = G.nh + 1, e = box(G.sat.E, W, i0, i1, j0, j1), e2 = box(G.sat.E2, W, i0, i1, j0, j1), om = box(G.sat.Om, W, i0, i1, j0, j1);
    if (!(om > 0)) return { cd: NaN, sd: NaN, neff: 0 };
    // + one ray's energy in quadrature: an empty or near-empty kernel is "probably under ~2 rays' worth", never "exactly 0 ± 0"
    return { cd: e / om, sd: Math.sqrt(e2 + G.eRay * G.eRay) / om, neff: e2 > 0 ? e * e / e2 : 0 };
  }
  // the whole kernel-smoothed intensity map (cd per bin centre) and its σ map
  function map(G, k) {
    const cd = new Float64Array(G.nh * G.nv), sd = new Float64Array(G.nh * G.nv);
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const r = intensityAt(G, G.h0 + (i + 0.5) * G.step, G.v0 + (j + 0.5) * G.step, k);
      cd[j * G.nh + i] = r.cd; sd[j * G.nh + i] = r.sd;
    }
    return { cd, sd };
  }
  // bin centre (h, v) of bin index
  const binCentre = (G, i, j) => [G.h0 + (i + 0.5) * G.step, G.v0 + (j + 0.5) * G.step];

  RF.FarField = { CONVS, hvOf, dirOf, binOmega, build, intensityAt, map, binCentre };
})(typeof globalThis !== 'undefined' ? globalThis : this);
