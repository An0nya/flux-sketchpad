// HDX4 step 1 analysis (throwaway). Reads a capture dir from hdx4_motion.js; the halo contribution per frame is luminance(on) - luminance(off).
// node hdx4_analyze.js <captureDir> [--out <json>]
// Box: fixed on frame 0's lamp pixel, +-5.4 m (3 car widths of 1.8 m) at the lamp's depth; the lamp disc (r < 0.3 m) is excluded.
// Per pixel, over the frames: |d2| = |x[t+1] - 2 x[t] + x[t-1]| (mean over t); step = |x[t+1] - x[t]|; scale = median_t(step) floored at 1 level.
// Metrics: mean |d2| (levels), relative roughness = mean|d2| / (mean step + 0.5 level), fraction of steps > 3 x max(scale, 1 level).
// Bins by pixel distance from the frame-0 lamp in metres: 0.3-1, 1-3, 3+.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const dir = process.argv[2], outIdx = process.argv.indexOf('--out'), OUTF = outIdx > 0 ? process.argv[outIdx + 1] : null;
function decodePNG(buf) {
  let p = 8, w, h, ct, bd; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error('unsupported PNG bd ' + bd + ' ct ' + ct);
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[dst + x - bpp] : 0, b = y ? out[dst - stride + x] : 0, c = (x >= bpp && y) ? out[dst - stride + x - bpp] : 0;
      let pr = 0;
      if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[dst + x] = (raw[src + x] + pr) & 255;
    }
  }
  return { w, h, bpp, out };
}
// luminance plane (Rec. 709 on the sRGB 8-bit values, which is what the page displays)
function lumPlane(img) { const { w, h, bpp, out } = img, Y = new Float32Array(w * h); for (let i = 0; i < w * h; i++) { const o = i * bpp; Y[i] = 0.2126 * out[o] + 0.7152 * out[o + 1] + 0.0722 * out[o + 2]; } return { w, h, Y }; }
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
const N = meta.frames.length;
const F0 = meta.frames[0], W = F0.W, H = F0.H, tanH = Math.tan(F0.hfov * Math.PI / 360);
// the screenshot is the canvas as displayed (CSS px), smaller than the render size W x H (meta): scale the render-space positions to it
const probe0 = decodePNG(fs.readFileSync(path.join(dir, 'on_0.png'))), SC = probe0.w / W;
const pxPerM = SC * (W / 2) / (meta.D * tanH);   // horizontal display pixels per metre at the nominal lamp depth D
const cx0 = F0.col * SC, cy0 = F0.row * SC, R = Math.round(5.4 * pxPerM), Rd = 0.3 * pxPerM;
// diff planes per frame: Y(on) - Y(off), over the box only
const DW = probe0.w, DH = probe0.h;
const x0 = Math.max(0, Math.floor(cx0 - R)), x1 = Math.min(DW - 1, Math.ceil(cx0 + R)), y0 = Math.max(0, Math.floor(cy0 - R)), y1 = Math.min(DH - 1, Math.ceil(cy0 + R));
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const series = new Float32Array(bw * bh * N);
const dist = new Float32Array(bw * bh);
for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) dist[yy * bw + xx] = Math.hypot(xx + x0 - cx0, yy + y0 - cy0) / pxPerM;
const keep = new Uint8Array(bw * bh); for (let i = 0; i < bw * bh; i++) keep[i] = dist[i] >= 0.3 ? 1 : 0;
for (let t = 0; t < N; t++) {
  const on = lumPlane(decodePNG(fs.readFileSync(path.join(dir, 'on_' + t + '.png'))));
  const off = lumPlane(decodePNG(fs.readFileSync(path.join(dir, 'off_' + t + '.png'))));
  if (on.w !== DW || on.h !== DH) throw new Error('canvas size changed at frame ' + t);
  for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
    const k = (yy + y0) * DW + (xx + x0), i = (t * bh + yy) * bw + xx;
    series[(yy * bw + xx) * N + t] = on.Y[k] - off.Y[k];
  }
}
// per-pixel metrics
const bins = { '0.3-1m': [], '1-3m': [], '3m+': [] };
const pixStat = (d) => (d < 1 ? '0.3-1m' : d < 3 ? '1-3m' : '3m+');
const acc = {};
for (const key of Object.keys(bins)) acc[key] = { d2: 0, step: 0, n: 0, bigSteps: 0, totSteps: 0, medSum: 0 };
const d2All = [], stepAll = [];
// smooth-signal control: least-squares degree-5 polynomial in time (normalised t in [-1,1]) per pixel; residual RMS in levels.
// A signal that is smooth in time but rounded to 8 bits has residual ~0.289 levels (uniform rounding), so ratios near 1 are "smooth".
const DEG = 5, Vm = []; for (let t = 0; t < N; t++) { const u = N > 1 ? 2 * t / (N - 1) - 1 : 0; Vm.push(Array.from({ length: DEG + 1 }, (_, k) => Math.pow(u, k))); }
const G = Array.from({ length: DEG + 1 }, () => new Float64Array(DEG + 1));
for (let a = 0; a <= DEG; a++) for (let b = 0; b <= DEG; b++) { let s2 = 0; for (let t = 0; t < N; t++) s2 += Vm[t][a] * Vm[t][b]; G[a][b] = s2; }
const Ginv = (() => { const n = DEG + 1, A = G.map((r, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)).map((v, j) => r[j])); const I = G.map((r, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; [I[c], I[p]] = [I[p], I[c]];
    const d = A[c][c]; for (let j = 0; j < n; j++) { A[c][j] /= d; I[c][j] /= d; } for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = 0; j < n; j++) { A[r][j] -= f * A[c][j]; I[r][j] -= f * I[c][j]; } } }
  return I; })();
const PM = Array.from({ length: DEG + 1 }, (_, a) => Array.from({ length: N }, (_, t) => { let s2 = 0; for (let b = 0; b <= DEG; b++) s2 += Ginv[a][b] * Vm[t][b]; return s2; }));   // (V^T V)^-1 V^T
const resAcc = {}; for (const key of Object.keys(bins)) resAcc[key] = { ss: 0, n: 0 };
for (let i = 0; i < bw * bh; i++) {
  if (!keep[i]) continue;
  const key = pixStat(dist[i]); if (!key) continue;
  const x = series.subarray(i * N, i * N + N);
  const st = [], d2 = [];
  for (let t = 0; t < N - 1; t++) st.push(Math.abs(x[t + 1] - x[t]));
  for (let t = 1; t < N - 1; t++) d2.push(Math.abs(x[t + 1] - 2 * x[t] + x[t - 1]));
  const sorted = st.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)], scale = Math.max(med, 1);
  const mStep = st.reduce((a, b) => a + b, 0) / st.length, mD2 = d2.reduce((a, b) => a + b, 0) / d2.length;
  const A = acc[key]; A.d2 += mD2; A.step += mStep; A.n++; A.medSum += med;
  for (const s of st) { A.totSteps++; if (s > 3 * scale) A.bigSteps++; }
  d2All.push(mD2); stepAll.push(mStep);
  const coef = PM.map((row) => row.reduce((s3, v, t) => s3 + v * x[t], 0)); let rss = 0;
  for (let t = 0; t < N; t++) { let fit = 0; for (let a = 0; a <= DEG; a++) fit += coef[a] * Vm[t][a]; const e = x[t] - fit; rss += e * e; }
  resAcc[key].ss += Math.sqrt(rss / N); resAcc[key].n++;
}
const out = { dir: path.basename(dir), fog: meta.fog, D: meta.D, sweep: meta.sweep, glare: meta.glare, W, H, displayPx: [DW, DH], pxPerM: +pxPerM.toFixed(2), boxPx: [bw, bh], frames: N, lampPx0: [+cx0.toFixed(1), +cy0.toFixed(1)], lampDriftPx: null, bins: {} };
const lp = meta.frames.map((f) => [f.col * SC, f.row * SC]);
out.lampDriftPx = [+Math.max(...lp.map((p) => Math.abs(p[0] - cx0))).toFixed(1), +Math.max(...lp.map((p) => Math.abs(p[1] - cy0))).toFixed(1)];
out.dLampFirstLast = [+meta.frames[0].dLamp.toFixed(3), +meta.frames[N - 1].dLamp.toFixed(3)];
out.eyeYFirstLast = [+meta.frames[0].eye[1].toFixed(3), +meta.frames[N - 1].eye[1].toFixed(3)];
out.tab = meta.frames[0].tab; out.lampsN = [...new Set(meta.frames.map((f) => f.lampsN))];
for (const key of Object.keys(bins)) { const A = acc[key]; if (!A.n) continue; const R = resAcc[key];
  out.bins[key] = { pix: A.n, meanAbsD2: +(A.d2 / A.n).toFixed(4), meanStep: +(A.step / A.n).toFixed(4), relRough: +((A.d2 / A.n) / (A.step / A.n + 0.5)).toFixed(4), fracBigStep: +(A.bigSteps / A.totSteps).toFixed(4), polyResRMS: +(R.ss / R.n).toFixed(4), polyResOverQuant: +((R.ss / R.n) / 0.289).toFixed(3) }; }
const meanAll = (a) => a.reduce((s, v) => s + v, 0) / a.length;
out.all = { pix: d2All.length, meanAbsD2: +meanAll(d2All).toFixed(4), meanStep: +meanAll(stepAll).toFixed(4) };
// the luminance-based (no diff) series for the lamp-side pixels, to see whether the halo is the whole story
console.log(JSON.stringify(out));
if (OUTF) fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
