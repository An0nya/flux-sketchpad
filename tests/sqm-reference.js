// W3c: the sqm-hl functions as they were at 5b9818b (before the speed-ups of footprint / logBlur / polish), verbatim apart from the signature lines,
// kept as the reference the new ones must equal bit for bit (tests/regress-node.js, "W3c sqm-hl").  Do not edit; if the solver's maths changes on purpose, say so in the test.
'use strict';
  function footprint(F, f, S, grid, opt) {  const { quadricOf, apertureSamples, emitTo } = F, RF = globalThis.RF;
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
  function polish(P, facets, m, opt) {
    const g = P.g, nh = g.nh, nv = g.nv, n = g.n, om = g.om, fps = m.fld.fps, T_ = P.des.T, lo = P.B.lo, hi = P.B.hi;
    const wBand = opt.wBand, f0 = opt.f0, E = Float64Array.from(m.Et), cut = P.cut;
    // pixel weights for tracking: edge zone heavy, plateau light
    const wt = new Float64Array(n);
    for (let j = 0; j < nv; j++) { const v = g.vOf(j); for (let i = 0; i < nh; i++) { const q = j * nh + i; let w = opt.wTrack; if (cut) { const t = cut.top(g.hOf(i)); if (v > t - 1.4 && v < t + 1.6) w = opt.wEdge; } wt[q] = w; } }
    const wc = P.B.wc, costPx = (q, e) => { const f = e / om[q]; let c = 0; if (lo[q] > 0 && f < lo[q]) { const d = (lo[q] - f) / lo[q]; c += wBand * wc[q] * d * d; } if (hi[q] < Infinity && f > hi[q]) { const d = (f - hi[q]) / hi[q]; c += wBand * wc[q] * d * d; }
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
module.exports = { footprint, logBlur, polish };
