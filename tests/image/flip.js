// LDR-FLIP (Andersson et al. 2020, "FLIP: A Difference Evaluator for Alternating Images"), plain JS, no dependencies.
// Ported from NVIDIA's reference implementation (github.com/NVlabs/flip, BSD-3-Clause: src/pytorch/flip_loss.py, same constants),
// with the 2D filters split into exact separable passes. Commit f730c8d reports reproducing NVIDIA's published mean 0.159693; that check is not in this repo (no NVIDIA images here), and selftest.js does not repeat it.
//   flip(ref, test, { ppd }) -> { map: Float32Array (w*h, 0..1), mean, p50, p95, p99, max, w, h }
// ref/test: { w, h, data: RGBA bytes, sRGB }. Alpha is ignored. ppd = pixels per degree of visual angle; the default 67.02 is NVIDIA's
// (a 0.7 m wide 4K monitor seen from 0.7 m). The value is a per-pixel perceived difference when flipping between the two images:
// 0 = indistinguishable, 1 = maximal.
'use strict';
const QC = 0.7, QF = 0.5, PC = 0.4, PT = 0.95, DEFAULT_PPD = (0.7 * 3840 / 0.7) * Math.PI / 180;
const WR = [0.950428545, 1, 1.088900371];                                       // D65 reference white (XYZ of linear RGB 1,1,1)
const M = [10135552 / 24577794, 8788810 / 24577794, 4435075 / 24577794, 2613072 / 12288897, 8788810 / 12288897, 887015 / 12288897, 1425312 / 73733382, 8788810 / 73733382, 70074185 / 73733382];
const MI = [3.241003275, -1.537398934, -0.498615861, -0.969224334, 1.875930071, 0.041554224, 0.055639423, -0.204011202, 1.057148933];
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; }

// separable convolution with replicate padding: rows with kx, then columns with ky
function sep(src, w, h, kx, ky, out, tmp) {
  const rx = (kx.length - 1) >> 1, ry = (ky.length - 1) >> 1;
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) { let s = 0; for (let k = -rx; k <= rx; k++) { const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k; s += kx[k + rx] * src[o + xx]; } tmp[o + x] = s; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -ry; k <= ry; k++) { const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k; s += ky[k + ry] * tmp[yy * w + x]; } out[y * w + x] = s; }
  return out;
}
const norm = (k) => { let s = 0; for (const v of k) s += v; return k.map((v) => v / s); };
// CSF filters (contrast sensitivity per opponent channel): sums of Gaussians in visual degrees. Returns [{ k: 1D kernel, wt }]
// such that the 2D kernel = sum wt * k(x) k(y), normalised to sum 1 as in the reference.
function csf(ppd) {
  const P = { A: [[1, 0.0047], [0, 1e-5]], RG: [[1, 0.0053], [0, 1e-5]], BY: [[34.1, 0.04], [13.5, 0.025]] };
  const r = Math.ceil(3 * Math.sqrt(0.04 / (2 * Math.PI * Math.PI)) * ppd), dx = 1 / ppd, out = {};
  for (const [ch, terms] of Object.entries(P)) {
    const parts = terms.filter(([a]) => a > 0).map(([a, b]) => { const g = Float64Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-Math.PI * Math.PI * ((i - r) * dx) ** 2 / b)); let s = 0; for (const v of g) s += v; return { c: a * Math.sqrt(Math.PI / b) * s * s, k: g.map((v) => v / s) }; });
    const tot = parts.reduce((s, p) => s + p.c, 0); out[ch] = parts.map((p) => ({ k: p.k, wt: p.c / tot }));
  }
  return out;
}
// edge (1st derivative) and point (2nd derivative) detectors, positive weights normalised to 1 and negative to -1 (exact as separable: g(y) > 0)
function detectors(ppd) {
  const sd = 0.5 * 0.082 * ppd, r = Math.ceil(3 * sd), g = Float64Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sd * sd)));
  const signNorm = (f) => { let p = 0, n = 0; for (const v of f) { if (v > 0) p += v; else n -= v; } return f.map((v) => v > 0 ? v / p : v < 0 ? v / n : 0); };
  return { g: norm(g), edge: signNorm(g.map((v, i) => -(i - r) * v)), point: signNorm(g.map((v, i) => ((i - r) ** 2 / (sd * sd) - 1) * v)) };
}
const labF = (t) => t > 216 / 24389 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29;
function huntLab(r, g, b, out, o) {                                             // linear RGB -> Hunt-adjusted L*a*b*
  const X = (M[0] * r + M[1] * g + M[2] * b) / WR[0], Y = M[3] * r + M[4] * g + M[5] * b, Z = (M[6] * r + M[7] * g + M[8] * b) / WR[2];
  const fx = labF(X), fy = labF(Y), fz = labF(Z), L = 116 * fy - 16;
  out[o] = L; out[o + 1] = 0.01 * L * 500 * (fx - fy); out[o + 2] = 0.01 * L * 200 * (fy - fz);
}
function prepare(img, n) {                                                       // sRGB bytes -> YCxCz planes
  const Y = new Float32Array(n), Cx = new Float32Array(n), Cz = new Float32Array(n), d = img.data;
  for (let i = 0; i < n; i++) {
    const r = LIN[d[i * 4]], g = LIN[d[i * 4 + 1]], b = LIN[d[i * 4 + 2]];
    const X = (M[0] * r + M[1] * g + M[2] * b) / WR[0], Yy = M[3] * r + M[4] * g + M[5] * b, Z = (M[6] * r + M[7] * g + M[8] * b) / WR[2];
    Y[i] = 116 * Yy - 16; Cx[i] = 500 * (X - Yy); Cz[i] = 200 * (Yy - Z);
  }
  return { Y, Cx, Cz };
}
function pipeline(img, w, h, F, D) {
  const n = w * h, { Y, Cx, Cz } = prepare(img, n), tmp = new Float32Array(n), t2 = new Float32Array(n);
  const filt = (src, parts) => { const acc = new Float32Array(n); for (const p of parts) { sep(src, w, h, p.k, p.k, t2, tmp); for (let i = 0; i < n; i++) acc[i] += p.wt * t2[i]; } return acc; };
  const fY = filt(Y, F.A), fX = filt(Cx, F.RG), fZ = filt(Cz, F.BY), lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {                                                  // filtered YCxCz -> linear RGB, clamp to the unit cube, -> Hunt Lab
    const yy = (fY[i] + 16) / 116, X = (yy + fX[i] / 500) * WR[0], Yv = yy, Z = (yy - fZ[i] / 200) * WR[2];
    const c = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
    huntLab(c(MI[0] * X + MI[1] * Yv + MI[2] * Z), c(MI[3] * X + MI[4] * Yv + MI[5] * Z), c(MI[6] * X + MI[7] * Yv + MI[8] * Z), lab, i * 3);
  }
  const yn = new Float32Array(n); for (let i = 0; i < n; i++) yn[i] = (Y[i] + 16) / 116;
  const mag = (fk) => { const a = sep(yn, w, h, fk, D.g, new Float32Array(n), tmp), b = sep(yn, w, h, D.g, fk, new Float32Array(n), tmp); for (let i = 0; i < n; i++) a[i] = Math.hypot(a[i], b[i]); return a; };
  return { lab, edge: mag(D.edge), point: mag(D.point) };
}
function flip(ref, test, opts) {
  opts = opts || {}; const ppd = opts.ppd || DEFAULT_PPD, w = ref.w, h = ref.h, n = w * h;
  if (test.w !== w || test.h !== h) throw new Error('flip: size mismatch ' + w + 'x' + h + ' vs ' + test.w + 'x' + test.h);
  const F = csf(ppd), D = detectors(ppd), R = pipeline(ref, w, h, F, D), T = pipeline(test, w, h, F, D);
  const g = [0, 0, 0], b = [0, 0, 0]; huntLab(0, 1, 0, g, 0); huntLab(0, 0, 1, b, 0);
  const cmax = Math.pow(Math.abs(g[0] - b[0]) + Math.hypot(g[1] - b[1], g[2] - b[2]), QC), pcc = PC * cmax;
  const map = new Float32Array(n); let sum = 0, mx = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 3, e = Math.pow(Math.abs(R.lab[o] - T.lab[o]) + Math.hypot(R.lab[o + 1] - T.lab[o + 1], R.lab[o + 2] - T.lab[o + 2]), QC);
    const dc = e < pcc ? (PT / pcc) * e : PT + ((e - pcc) / (cmax - pcc)) * (1 - PT);
    const df = Math.pow(Math.max(Math.abs(R.edge[i] - T.edge[i]), Math.abs(R.point[i] - T.point[i])) / Math.SQRT2, QF);
    const v = Math.pow(dc, 1 - df); map[i] = v; sum += v; if (v > mx) mx = v;
  }
  return Object.assign({ map, w, h, mean: sum / n, max: mx }, quantiles(map, opts.mask));
}
// p50/p95/p99 of the map (optionally only where mask[i] is 0 = not ignored), by a 4096-bin histogram (0..1)
function quantiles(map, mask) {
  const H = new Uint32Array(4097); let n = 0;
  for (let i = 0; i < map.length; i++) if (!mask || !mask[i]) { H[Math.min(4096, Math.floor(map[i] * 4096))]++; n++; }
  const q = (p) => { const t = p * n; let c = 0; for (let k = 0; k <= 4096; k++) { c += H[k]; if (c >= t) return k / 4096; } return 1; };
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99) };
}
// magma-like colour ramp for error maps (0 black-purple .. 1 pale yellow), RGBA bytes
const RAMP = [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]];
function heatmap(map, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { const t = Math.max(0, Math.min(1, map[i])) * 8, k = Math.min(7, Math.floor(t)), f = t - k, a = RAMP[k], b = RAMP[k + 1]; for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(a[c] + (b[c] - a[c]) * f); out[i * 4 + 3] = 255; }
  return out;
}
module.exports = { flip, heatmap, quantiles, DEFAULT_PPD };
