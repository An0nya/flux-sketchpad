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
