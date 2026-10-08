/* polish.js — coordinate descent on the aims: every facet's footprint (translation-invariant, shield-masked for the lens path) slides in small steps and the move is kept when the
 * cost of the whole far field falls.  Cost per pixel = wBand · weight · (relative floor shortfall² + relative ceiling excess²) + wTrack · (relative miss of the ideal beam)².
 *   RF.P3.aggBands(P, G)                 → { lo, hi, wc, T (cd), n }  the spec's pixel bands and the ideal beam on grid G
 *   RF.P3.polish(G, fps, pos, mask, band, Efix, o) → moves pos in place; returns { before, after, moves }                                                   */
(function () {
  'use strict';
  const RF = globalThis.RF, P3 = RF.P3 = RF.P3 || {};

  function aggBands(P, G, Tstar, wmul) {
    const g = P.g, k = Math.round(G.step / g.step), n = G.nh * G.nv, lo = new Float64Array(n), hi = new Float64Array(n).fill(Infinity), wc = new Float64Array(n), Ts = new Float64Array(n), om = new Float64Array(n);
    for (let j = 0; j < g.nv; j++) { const J = Math.min(G.nv - 1, (j / k) | 0); for (let i = 0; i < g.nh; i++) {
      const q = j * g.nh + i, p = J * G.nh + Math.min(G.nh - 1, (i / k) | 0);
      if (P.B.lo[q] > lo[p]) lo[p] = P.B.lo[q]; if (P.B.hi[q] < hi[p]) hi[p] = P.B.hi[q]; { const w = P.B.wc[q] * (wmul ? wmul[q] : 1); if (w > wc[p]) wc[p] = w; } Ts[p] += Tstar[q] * g.om[q]; om[p] += g.om[q]; } }
    for (let p = 0; p < n; p++) Ts[p] = om[p] > 0 ? Ts[p] / om[p] : 0;
    return { lo, hi, wc, T: Ts, om };
  }
  function pixelCost(band, G, p, E, o) {
    const om = G.om[p], cd = E / om, lo = band.lo[p], hi = band.hi[p], T = band.T[p]; let v = 0;
    if (lo > 0 && cd < lo) { const r = (lo - cd) / lo; v += r * r; }
    if (cd > hi) { const r = (cd - hi) / hi; v += r * r; }
    const t = Math.max(T, o.tref), d = (cd - T) / t;
    return o.wBand * band.wc[p] * v + o.wTrack * d * d;
  }
  // pos[k] = [ci, cj] pixel of footprint k's centroid (null = unplaced); fps[k] = footprint (alternatives: fps[k] array with pos[k][2] = chosen alternative)
  function polish(G, fps, pos, mask, band, Efix, o) {
    o = Object.assign({ wBand: 150, wTrack: 0.03, steps: [8, 4, 2, 1], sweeps: 2, trust: 30, tref: 200, allowed: null, seed: 1 }, o || {});
    const n = G.nh * G.nv, E = Float64Array.from(Efix || new Float64Array(n)), C = new Float64Array(n), nh = G.nh, nv = G.nv;
    const fpOf = (k) => (Array.isArray(fps[k]) ? fps[k][pos[k][2] | 0] : fps[k]);
    const add = (fp, ci, cj, sgn) => { for (let q = 0; q < fp.n; q++) { const i = ci + fp.di[q], j = cj + fp.dj[q]; if (i < 0 || j < 0 || i >= nh || j >= nv) continue; const p = j * nh + i; E[p] += sgn * fp.val[q] * (mask ? mask[p] : 1); } };
    for (let k = 0; k < fps.length; k++) if (pos[k]) add(fpOf(k), pos[k][0], pos[k][1], 1);
    let total = 0; for (let p = 0; p < n; p++) { C[p] = pixelCost(band, G, p, E[p], o); total += C[p]; }
    const before = total, stamp = new Int32Array(n); let st = 0, moves = 0;
    const touched = [];
    const trial = (k, fo, co, fn, cn) => {                          // move footprint k from (fo @ co) to (fn @ cn); returns the cost change, leaves E changed (caller keeps or reverts)
      st++; touched.length = 0;
      const mark = (fp, c) => { for (let q = 0; q < fp.n; q++) { const i = c[0] + fp.di[q], j = c[1] + fp.dj[q]; if (i < 0 || j < 0 || i >= nh || j >= nv) continue; const p = j * nh + i; if (stamp[p] !== st) { stamp[p] = st; touched.push(p); } } };
      mark(fo, co); mark(fn, cn); add(fo, co[0], co[1], -1); add(fn, cn[0], cn[1], 1);
      let d = 0; for (const p of touched) d += pixelCost(band, G, p, E[p], o) - C[p];
      return d;
    };
    const rng = (() => { let s = o.seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    const order = []; for (let k = 0; k < fps.length; k++) if (pos[k]) order.push(k);
    const home = new Map(order.map((k) => [k, [pos[k][0], pos[k][1]]]));
    for (let sw = 0; sw < o.sweeps; sw++) for (const step of o.steps) {
      for (let r = order.length - 1; r > 0; r--) { const t = (rng() * (r + 1)) | 0; [order[r], order[t]] = [order[t], order[r]]; }
      for (const k of order) {
        const hk = home.get(k);
        const cands = [[step, 0], [-step, 0], [0, step], [0, -step]];
        // alternatives (widths): ±1
        const alt = Array.isArray(fps[k]) ? [-1, 1] : [];
        let best = null;
        for (const [a, b] of cands) {
          const c1 = [pos[k][0] + a, pos[k][1] + b, pos[k][2]]; const tr = o.trustOf ? o.trustOf(k) : o.trust; if (Math.abs(c1[0] - hk[0]) > tr || Math.abs(c1[1] - hk[1]) > tr) continue; if (o.allowed && !o.allowed(c1[0], c1[1], k)) continue;
          const fo = fpOf(k), d = trial(k, fo, pos[k], fo, c1);
          if (d < -1e-9 && (!best || d < best.d)) best = { d, c: c1 };
          add(fo, c1[0], c1[1], -1); add(fo, pos[k][0], pos[k][1], 1);               // revert
        }
        for (const da of alt) {
          const ai = (pos[k][2] | 0) + da; if (ai < 0 || ai >= fps[k].length) continue; const c1 = [pos[k][0], pos[k][1], ai], fo = fpOf(k), fn = fps[k][ai], d = trial(k, fo, pos[k], fn, c1);
          if (d < -1e-9 && (!best || d < best.d)) best = { d, c: c1 };
          add(fn, c1[0], c1[1], -1); add(fo, pos[k][0], pos[k][1], 1);
        }
        if (best) {                                                      // apply the best move and refresh the cost cache over the touched pixels
          const fo = fpOf(k), fn = Array.isArray(fps[k]) ? fps[k][best.c[2] | 0] : fps[k];
          trial(k, fo, pos[k], fn, best.c); for (const p of touched) { total += pixelCost(band, G, p, E[p], o) - C[p]; C[p] = pixelCost(band, G, p, E[p], o); }
          pos[k] = best.c; moves++;
        }
      }
    }
    return { before, after: total, moves, E };
  }
  P3.aggBands = aggBands; P3.polish = polish; P3.pixelCost = pixelCost;
})();
