/* beam-quality.js — RF.BeamQuality: how the beam looks, reported next to the regulation verdict, never part of it.
 * Pure: give it an intensity lookup I(h, v) in cd in the road's frame (RF.Road.beamOf: already aimed by the judge or the
 * user, mirrored so the own side is +h, v = 0 = the horizon after that aim). A sloppy cut-off that makes the judge aim
 * the lamp down reads as a lower, taller beam here, on purpose.
 *
 *   peak        brightest point inside the centre box (±5° h, 0…4° down)
 *   stray       brightest separate lobe (see lobes) outside the box, as a ratio of the peak: > 1 = the "hotspot" is a side
 *               lobe. Lobes dimmer than 1/3 of the peak don't count; the hotspot's own shoulder past the box is not a lobe.
 *   core[f]     f = 1/3, 1/4, 1/5: cells ≥ f·peak, dropouts up to 1° bridged, the blob that holds the peak;
 *               width/height in degrees, extents (h0…h1, v0…v1 from the horizon), area in deg²
 *   lobes       separate bright peaks ≥ 1/3 of the peak with prominence ≥ 15 % OF THE MAIN PEAK (persistence on the
 *               superlevel sets: a peak counts only if the beam dips that far before it joins a brighter one). Measured
 *               against the main peak, not the lobe's own height: ripple along a flat band at 1/3 peak is not a lobe.
 *   roughness   blotchiness inside the 1/4 core's row spans (dropouts included): Σ|I − blur(I)| ÷ Σ blur(I), with a small
 *               Gaussian blur (σ 0.75° h × 0.25° v). A smooth taper barely changes under it (≈ 0.03 for a 4° × 0.8° hotspot);
 *               streaks, blotches and gaps a degree or two across do (a ±40 % ripple at 2° reads ≈ 0.25). 0 = smooth.
 *   holes       share of the 1/4 core's row spans below 1/4 peak (the dropouts the bridging forgave)
 *   foreground  brightest point below 4° D as a ratio of the peak, and that region's share of the lumens in the grid
 * No DOM, no tracing; Node loads it like the other scripts. */
(function (root) {
  'use strict';
  const RF = root.RF;
  const D2R = Math.PI / 180;
  const DEF = { rough: { h: 0.75, v: 0.25 }, h0: -30, h1: 30, dh: 0.25, v0: -15, v1: 5, dv: 0.125, box: { h: 5, top: 0, bottom: -4 }, fracs: [1 / 3, 1 / 4, 1 / 5], gap: 1, lobeFrac: 1 / 3, prominence: 0.15, fgV: -4, strayTop: 1 };

  function sample(I, o) {
    const H = [], Vv = [];
    for (let h = o.h0; h <= o.h1 + 1e-9; h += o.dh) H.push(+h.toFixed(6));
    for (let v = o.v0; v <= o.v1 + 1e-9; v += o.dv) Vv.push(+v.toFixed(6));
    const ni = H.length, nj = Vv.length, cd = new Float64Array(ni * nj);
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) { const x = I(H[i], Vv[j]); cd[j * ni + i] = x > 0 && isFinite(x) ? x : 0; }
    return { H, V: Vv, ni, nj, cd };
  }

  // the blob of cells ≥ T holding (pi, pj), bridging dark runs up to `gap` degrees (dilate by half the gap each way, flood, keep lit cells)
  function core(g, pi, pj, T, o) {
    const { ni, nj, cd, H, V } = g, lit = new Uint8Array(ni * nj), D = new Uint8Array(ni * nj);
    for (let k = 0; k < cd.length; k++) lit[k] = cd[k] >= T ? 1 : 0;
    const ri = Math.ceil(o.gap / o.dh / 2), rj = Math.ceil(o.gap / o.dv / 2);
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (lit[j * ni + i])
      for (let b = Math.max(0, j - rj); b <= Math.min(nj - 1, j + rj); b++) for (let a = Math.max(0, i - ri); a <= Math.min(ni - 1, i + ri); a++) D[b * ni + a] = 1;
    const seen = new Uint8Array(ni * nj), st = [pj * ni + pi], mine = new Uint8Array(ni * nj);
    let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity, n = 0;
    while (st.length) {
      const k = st.pop(); if (seen[k] || !D[k]) continue; seen[k] = 1;
      const i = k % ni, j = (k - i) / ni;
      if (lit[k]) { mine[k] = 1; n++; if (H[i] < h0) h0 = H[i]; if (H[i] > h1) h1 = H[i]; if (V[j] < v0) v0 = V[j]; if (V[j] > v1) v1 = V[j]; }
      if (i > 0) st.push(k - 1); if (i < ni - 1) st.push(k + 1); if (j > 0) st.push(k - ni); if (j < nj - 1) st.push(k + ni);
    }
    const r3 = (x) => +x.toFixed(3);
    return { mine, n, out: n ? { width: r3(h1 - h0 + o.dh), height: r3(v1 - v0 + o.dv), h: [r3(h0), r3(h1)], v: [r3(v0), r3(v1)], area: r3(n * o.dh * o.dv) } : null };
  }

  // separate bright peaks: union-find over cells in descending order; when two blobs meet at level s, the one with the
  // lower summit b dies with prominence (b − s) / peak. Peaks ≥ lobeFrac·peak that die with ≥ `prominence` (or never die) count.
  function lobes(g, peak, o) {
    const { ni, nj, cd, H, V } = g, n = ni * nj, ord = [], par = new Int32Array(n).fill(-1), top = new Int32Array(n);
    const floor = Math.max(0, (o.lobeFrac - o.prominence) * peak);
    for (let k = 0; k < n; k++) if (cd[k] >= floor && V[(k - k % ni) / ni] <= o.strayTop) ord.push(k);
    ord.sort((a, b) => cd[b] - cd[a]);
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const dead = new Map();
    for (const k of ord) {
      par[k] = k; top[k] = k; const i = k % ni;
      for (const m of [i > 0 ? k - 1 : -1, i < ni - 1 ? k + 1 : -1, k - ni, k + ni]) {
        if (m < 0 || m >= n || par[m] < 0) continue;
        const a = find(k), b = find(m); if (a === b) continue;
        const win = cd[top[a]] >= cd[top[b]] ? a : b, lose = win === a ? b : a, t = top[lose];
        if (t !== k) dead.set(t, (cd[t] - cd[k]) / peak);       // the lower summit dies at this saddle (k itself is no summit), dip ÷ main peak
        par[lose] = win;
      }
    }
    const out = [];
    for (const k of ord) {
      if ((par[k] === k && top[k] === k) || dead.has(k)) {
        const prom = dead.has(k) ? dead.get(k) : 1;
        if (cd[k] >= o.lobeFrac * peak && prom >= o.prominence) { const i = k % ni; out.push({ h: H[i], v: V[(k - i) / ni], ratio: +(cd[k] / peak).toFixed(3) }); }
      }
    }
    return out;
  }

  // separable Gaussian blur of the sampled grid, σ in cells (edges: renormalised over the cells that exist)
  function blur(g, sh, sv) {
    const { ni, nj, cd } = g, ker = (s) => { const r = Math.ceil(3 * s), w = []; for (let d = -r; d <= r; d++) w.push(Math.exp(-d * d / (2 * s * s))); return { r, w }; };
    const kh = ker(sh), kv = ker(sv), T = new Float64Array(ni * nj), O = new Float64Array(ni * nj);
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) { let a = 0, n = 0; for (let d = -kh.r; d <= kh.r; d++) { const x = i + d; if (x < 0 || x >= ni) continue; a += kh.w[d + kh.r] * cd[j * ni + x]; n += kh.w[d + kh.r]; } T[j * ni + i] = a / n; }
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) { let a = 0, n = 0; for (let d = -kv.r; d <= kv.r; d++) { const y = j + d; if (y < 0 || y >= nj) continue; a += kv.w[d + kv.r] * T[y * ni + i]; n += kv.w[d + kv.r]; } O[j * ni + i] = a / n; }
    return O;
  }

  function measure(I, opts) {
    const o = Object.assign({}, DEF, opts || {}); o.box = Object.assign({}, DEF.box, (opts && opts.box) || {});
    const g = sample(I, o), { ni, nj, cd, H, V } = g;
    const inBox = (h, v) => Math.abs(h) <= o.box.h && v <= o.box.top && v >= o.box.bottom;
    let pk = 0, pi = -1, pj = -1, all = 0;
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const x = cd[j * ni + i]; if (V[j] <= o.strayTop && x > all) all = x;
      if (inBox(H[i], V[j]) && x > pk) { pk = x; pi = i; pj = j; }
    }
    if (!(pk > 0.01 * all)) return { empty: true, note: 'the centre box holds under 1 % of the brightest light' };
    const rep = { peak: { cd: Math.round(pk), h: H[pi], v: V[pj] }, stray: { ratio: 0, h: null, v: null }, core: {} };
    let quarter = null;
    for (const f of o.fracs) {
      const c = core(g, pi, pj, f * pk, o), key = f === 1 / 3 ? '1/3' : f === 1 / 4 ? '1/4' : f === 1 / 5 ? '1/5' : String(+f.toFixed(4));
      rep.core[key] = c.out; if (f === 1 / 4) quarter = c;
    }
    // roughness and holes on the 1/4 core's row spans
    if (quarter && quarter.n) {
      const B = blur(g, o.rough.h / o.dh, o.rough.v / o.dv);
      let span = 0, dark = 0, dev = 0, base = 0;
      for (let j = 0; j < nj; j++) {
        let a = -1, b = -1; for (let i = 0; i < ni; i++) if (quarter.mine[j * ni + i]) { if (a < 0) a = i; b = i; }
        if (a < 0) continue;
        for (let i = a; i <= b; i++) { const k = j * ni + i; span++; if (!quarter.mine[k]) dark++; dev += Math.abs(cd[k] - B[k]); base += B[k]; }
      }
      rep.roughness = base > 0 ? +(dev / base).toFixed(3) : 0;
      rep.holes = +(dark / span).toFixed(3);
    }
    rep.lobes = lobes(g, pk, o);
    for (const l of rep.lobes) if (!inBox(l.h, l.v) && l.ratio > rep.stray.ratio) rep.stray = { ratio: l.ratio, h: l.h, v: l.v };
    // foreground: below fgV; lumens ≈ Σ I · cos v · dh · dv (rad²) over the sampled grid
    let fgMax = 0, lmAll = 0, lmFg = 0; const dO = o.dh * o.dv * D2R * D2R;
    for (let j = 0; j < nj; j++) { const w = Math.cos(V[j] * D2R) * dO; for (let i = 0; i < ni; i++) { const x = cd[j * ni + i], lm = x * w; lmAll += lm; if (V[j] < o.fgV) { lmFg += lm; if (x > fgMax) fgMax = x; } } }
    rep.foreground = { peakRatio: +(fgMax / pk).toFixed(3), lmShare: lmAll > 0 ? +(lmFg / lmAll).toFixed(3) : 0, below: o.fgV };
    rep.lmGrid = Math.round(lmAll);
    return rep;
  }

  RF.BeamQuality = { DEF, measure, sample };
})(typeof globalThis !== 'undefined' ? globalThis : this);
