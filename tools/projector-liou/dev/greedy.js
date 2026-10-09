/* greedy.js — aims by matching pursuit on the ideal beam ("fill then fix"): every facet has a FOOTPRINT (the far-field blob its image makes, from the forward model at a nominal
 * aim; translation-invariant), and facets are placed one by one, biggest image first, where they fit the not-yet-served part of the beam best.  Lens-path facets only deliver
 * below the shield edge (the footprint is cut by the cut-off line: light above it is lost), so a facet whose image is taller than the room under the edge goes elsewhere and the
 * ones with small / flat images take the edge — the placement itself prefers a sharp edge made by the shield cutting the image.
 *   RF.P3.coarse(P, TStar, step)             → lm per coarse bin of the ideal beam (the residual to fill)
 *   RF.P3.placeLens(...)  (see main.js)      */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, F = P3.fwd, D2R = Math.PI / 180;

  // ideal beam (cd on the fine grid g) → lumens per bin of a coarser grid G (same origin, step a multiple of the fine step)
  function coarse(P, Tstar, G) {
    const g = P.g, k = Math.round(G.step / g.step), out = new Float64Array(G.nh * G.nv);
    for (let j = 0; j < g.nv; j++) { const J = Math.min(G.nv - 1, (j / k) | 0); for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; out[J * G.nh + Math.min(G.nh - 1, (i / k) | 0)] += Tstar[q] * g.om[q]; } }
    return out;
  }
  // a facet's footprint as pixel offsets from its flux centroid on grid G: { flux, di, dj, val, sh, sv (rms size, deg), hc, vc }
  function footOf(P, facet, post, G, na) {
    const fp = F.footprint(facet, P.S_, G, { na: na || 16, post }); if (!(fp.flux > 0)) return null;
    const n = fp.idx.length, di = new Int16Array(n), dj = new Int16Array(n), ci = (fp.hc - G.h0) / G.step - 0.5, cj = (fp.vc - G.v0) / G.step - 0.5, ri = Math.round(ci), rj = Math.round(cj);
    for (let q = 0; q < n; q++) { const i = fp.idx[q] % G.nh, j = (fp.idx[q] / G.nh) | 0; di[q] = i - ri; dj[q] = j - rj; }
    return { flux: fp.flux, di, dj, val: fp.val, n, hc: fp.hc, vc: fp.vc, ri, rj, sh: Math.sqrt(Math.max(1e-6, fp.cov[0])), sv: Math.sqrt(Math.max(1e-6, fp.cov[2])), cov: fp.cov };
  }
  // pixel (i, j) of grid G where the footprint's centroid goes for an aim (h, v)
  const pixOf = (G, h, v) => [Math.round((h - G.h0) / G.step - 0.5), Math.round((v - G.v0) / G.step - 0.5)];

  // gain of putting footprint fp with its centroid at pixel (ci, cj): lumens that land where the beam still wants light, minus lam × the rest
  // ww (optional): per-pixel weight of waste (e.g. > 1 where the ideal beam asks for almost nothing: a ceiling on spill)
  function gain(fp, G, ci, cj, resid, mask, lam, ww) {
    let fit = 0, waste = 0; const nh = G.nh, nv = G.nv;
    for (let q = 0; q < fp.n; q++) {
      const i = ci + fp.di[q], j = cj + fp.dj[q], v = fp.val[q];
      if (i < 0 || j < 0 || i >= nh || j >= nv) { waste += v; continue; }
      const p = j * nh + i, d = v * (mask ? mask[p] : 1), r = resid[p]; const f = d < r ? d : (r > 0 ? r : 0); fit += f; waste += (v - f) * (ww ? ww[p] : 1);
    }
    return fit - lam * waste;
  }
  function subtract(fp, G, ci, cj, resid, mask) {
    let del = 0; for (let q = 0; q < fp.n; q++) { const i = ci + fp.di[q], j = cj + fp.dj[q]; if (i < 0 || j < 0 || i >= G.nh || j >= G.nv) continue; const p = j * G.nh + i, d = fp.val[q] * (mask ? mask[p] : 1); resid[p] -= d; del += d; }
    return del;
  }
  // summed-area table of max(resid, 0) × mask for the candidate search
  function sat(G, resid, mask) {
    const W = G.nh + 1, S = new Float64Array(W * (G.nv + 1));
    for (let j = 0; j < G.nv; j++) { let row = 0; for (let i = 0; i < G.nh; i++) { const p = j * G.nh + i, r = resid[p] > 0 ? resid[p] * (mask ? Math.max(mask[p], 0.05) : 1) : 0; row += r; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } }
    return S;
  }
  const boxSum = (S, G, i0, j0, i1, j1) => { i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(G.nh, i1); j1 = Math.min(G.nv, j1); if (i1 <= i0 || j1 <= j0) return 0; const W = G.nh + 1; return S[j1 * W + i1] - S[j0 * W + i1] - S[j1 * W + i0] + S[j0 * W + i0]; };

  // place the footprints in the order o.order; fps[k] may be an array of ALTERNATIVES (e.g. several widths): the best (position, alternative) wins.
  // returns [{ k, h, v (the placed centroid, deg), alt, delivered }] and leaves the unserved light in resid
  function greedy(G, fps, resid, mask, o) {
    o = Object.assign({ lam: 0.5, top: 40 }, o || {});
    const out = [];
    for (const k of o.order) {
      const alts = Array.isArray(fps[k]) ? fps[k] : [fps[k]]; if (!alts.length || !alts[0]) continue;
      const S = sat(G, resid, mask); let best = null;
      alts.forEach((fp, a) => {
        const wi = Math.max(1, Math.round(1.5 * fp.sh / G.step)), wj = Math.max(1, Math.round(1.5 * fp.sv / G.step)), cand = [], stride = Math.max(1, Math.round(Math.min(wi, wj) / 2));
        for (let j = 0; j < G.nv; j += stride) for (let i = 0; i < G.nh; i += stride) { const s = boxSum(S, G, i - wi, j - wj, i + wi + 1, j + wj + 1); if (s > 0) cand.push([s, i, j]); }
        cand.sort((x, y) => y[0] - x[0]);
        const ok = (ci, cj) => !o.allowed || o.allowed(G.h0 + (ci + 0.5) * G.step, G.v0 + (cj + 0.5) * G.step, fp, k);
        // o.snap (screenless placement): → the highest row ≤ cj where the footprint may sit in column ci (e.g. its light above the cut-off is within tolerance), or null
        const at = (ci, cj) => { if (o.snap) { const j = o.snap(ci, cj, fp, k); return j === null || j < 0 ? null : j; } return ok(ci, cj) ? cj : null; };
        let b = null;
        for (const [, ci, cj0] of cand.slice(0, o.top)) { const cj = at(ci, cj0); if (cj === null) continue; const gn = gain(fp, G, ci, cj, resid, mask, o.lam, o.wasteW); if (!b || gn > b.gn) b = { gn, ci, cj }; }
        if (!b) return;
        for (let it = 0; it < 6; it++) { let moved = false; for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ci = b.ci + x, cj = at(ci, b.cj + y); if (cj === null || (ci === b.ci && cj === b.cj)) continue; const gn = gain(fp, G, ci, cj, resid, mask, o.lam, o.wasteW); if (gn > b.gn + 1e-12) { b = { gn, ci, cj }; moved = true; } } if (!moved) break; }
        if (!best || b.gn > best.gn) best = Object.assign(b, { a, fp });
      });
      if (!best) { out.push({ k, h: null, v: null, delivered: 0, alt: -1 }); continue; }
      const del = subtract(best.fp, G, best.ci, best.cj, resid, o.subMask !== undefined ? o.subMask : mask);      // o.subMask: what the placed light takes from the residual (an edge pass scores the band only but uses up all of it)
      out.push({ k, h: G.h0 + (best.ci + 0.5) * G.step, v: G.v0 + (best.cj + 0.5) * G.step, alt: best.a, delivered: del, gn: best.gn });
    }
    return out;
  }
  // a Gaussian footprint (flux lm, rms sizes sh, sv deg) on grid G, centred on pixel (0, 0)
  function gaussFoot(G, flux, sh, sv) {
    const ni = Math.ceil(3 * sh / G.step), nj = Math.ceil(3 * sv / G.step), di = [], dj = [], val = []; let tot = 0;
    for (let j = -nj; j <= nj; j++) for (let i = -ni; i <= ni; i++) { const w = Math.exp(-0.5 * ((i * G.step / sh) ** 2 + (j * G.step / sv) ** 2)); di.push(i); dj.push(j); val.push(w); tot += w; }
    return { flux, di: Int16Array.from(di), dj: Int16Array.from(dj), val: Float64Array.from(val, (w) => w / tot * flux), n: val.length, sh, sv, ri: 0, rj: 0, hc: 0, vc: 0 };
  }
  P3.coarse = coarse; P3.footOf = footOf; P3.pixOf = pixOf; P3.greedy = greedy; P3.gainAt = gain; P3.subtractAt = subtract; P3.gaussFoot = gaussFoot;
})();
