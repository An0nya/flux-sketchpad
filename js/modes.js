/* modes.js — RF.Modes: how to judge a design for a KIND of painting (cutoff · hotspot · text · photo · even wash), and how to
 * tell which kind a painting is.  Pure functions on plain data: no DOM, no tracing, no solver calls.  It lives with the solver
 * environment (js/solver-env.js) so the worker, the bench and the tools all use ONE copy; solvers/lab-auto.js is its client.
 *
 * A "run" is one traced design:  { R, paint[R*R], D[R*R], row }
 *   D   = the light each paint cell received, as a share of the LED's total emission (from tools.trace, see runFromTrace)
 *   row = constants the metrics need: { rays, cdPerD, achievableKernelCells, fidelity, onPaint, spill }
 * Row 0 of every array is the BOTTOM of the target (v up), so "above" means a larger row index.
 *
 * Every threshold in GATES is a PROPOSAL, set while looking at heatmaps of 16 scenes (AUTOTUNE-MODES.md); none is calibrated on
 * other viewers.  A GATE vetoes a design; a score ranks the designs that pass.  Goals rank RELATIVE to the best candidate in the
 * same search (peak, light), because an absolute target ("75% of the possible peak") may be unreachable.                          */
(function (root) {
  'use strict';
  const RF = root.RF;

  const GATES = {
    cutoff: { glare: 0.05, offsetCells: 1.0, litHoles: 0.05 },        // brightest 1% of 5×5 patches above the edge ≤ 5% of a typical lit cell; the edge within `tol` cells (a setting; 1 by default); ≤ 5% of the lit zone under half of what the paint asked
    hotspot: { fillRelLo: 0.6, fillRelHi: 1.6, fillCover: 0.85, spill: 0.25 },
    text: { recall: 0.6, leak: 0.2, farGlare: 0.15, light: 0.5 },     // score = F1 × (1 − far glare/0.3) × (0.5 + 0.5 × share of the paint's holes still open); light = floor on light on paint, as a share of the best candidate's
    photo: { rho: 0.85, spill: 0.15, light: 0.5 },
    wash: { minOverMean: 0.7, spill: 0.15, light: 0.6 },
  };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const median = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };
const pctl = (a, q) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]; };
const sum = (a) => { let s = 0; for (const x of a) s += x; return s; };

// ---- geometry of the painting: signed distance to the edge (cells; + inside the paint, − outside; adjacent cells are ±0.5) and which way the edge faces
const geoCache = new Map();
function geometry(paint, R, K) {
  K = K || 10; let key = R + ':' + K; for (let k = 0; k < paint.length; k += 7) key += paint[k] > 0 ? '1' : '0';
  if (geoCache.has(key)) return geoCache.get(key);
  const sd = new Float32Array(R * R), up = new Int8Array(R * R);       // up: 1 = the nearest opposite cell is above (a painted cell's edge on its top side, or an unpainted cell whose nearest paint is BELOW it)
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const k = j * R + i, me = paint[k] > 0; let best = K + 1, bdy = 0;
    for (let b = -K; b <= K; b++) for (let a = -K; a <= K; a++) {
      const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= R || jj >= R) continue; const d = Math.hypot(a, b); if (d >= best) continue;
      if ((paint[jj * R + ii] > 0) !== me) { best = d; bdy = b; }
    }
    sd[k] = (me ? 1 : -1) * (best > K ? K + 0.5 : best - 0.5);
    up[k] = me ? (bdy > 0 ? 1 : 0) : (bdy < 0 ? 1 : 0);              // painted: opposite above → top edge of the lit zone.  unpainted: paint below → this is dark cell above a lit zone
  }
  const g = { sd, up }; geoCache.set(key, g); return g;
}
const kernelOf = (run) => Math.max(1, run.row.achievableKernelCells || 1);
const interior = (run, geo, extra) => { const t = kernelOf(run) / 2 + 1 + (extra || 0), out = []; for (let k = 0; k < run.D.length; k++) if (run.paint[k] > 0 && geo.sd[k] >= t) out.push(k); return out; };
// a typical lit level: the median of the light in the deep interior of the paint (falls back to the median of all painted cells)
function litLevel(run, geo) {
  const idx = interior(run, geo); const src = idx.length >= 20 ? idx : run.paint.map((w, k) => (w > 0 ? k : -1)).filter((k) => k >= 0);
  return median(src.map((k) => run.D[k]));
}
function boxBlur(a, R, w) {                                              // separable fractional box blur (like RF.Photometry.boxBlur)
  if (!(w > 1e-6)) return Float64Array.from(a); const h = w / 2;
  const pass = (g, alongX) => { const out = new Float64Array(R * R); for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const c = alongX ? i : j, a0 = c + 0.5 - h, b0 = c + 0.5 + h; let s = 0; for (let q = Math.floor(a0); q < Math.ceil(b0); q++) { if (q < 0 || q >= R) continue; s += (Math.min(b0, q + 1) - Math.max(a0, q)) * (alongX ? g[j * R + q] : g[q * R + i]); } out[j * R + i] = s / w; } return out; };
  return pass(pass(a, true), false);
}
// means of the b×b blocks whose cells are (almost) all in the mask: a stray-light reading needs an aperture, since 1 ray in 1 cell is 1/rays-per-cell of the lit level
function blockMeans(D, R, mask, b, minFrac) {
  const out = []; for (let j0 = 0; j0 + b <= R; j0 += b) for (let i0 = 0; i0 + b <= R; i0 += b) { let n = 0, s = 0; for (let j = j0; j < j0 + b; j++) for (let i = i0; i < i0 + b; i++) { const k = j * R + i; if (mask(k)) { n++; s += D[k]; } } if (n >= (minFrac || 0.9) * b * b) out.push(s / n); }
  return out;
}
const deliveredOn = (run, mask) => { let s = 0; for (let k = 0; k < run.D.length; k++) if (mask(k)) s += run.D[k]; return s; };

// ---- edge spread: mean level (as a share of `level`) in 0.5-cell bins of signed distance, over the cells picked by `pick`
function edgeSpread(run, geo, level, pick, K) {
  K = K || 8; const lv = typeof level === 'function' ? level : () => level, nb = 4 * K, sumb = new Float64Array(nb), cnt = new Float64Array(nb);
  for (let k = 0; k < run.D.length; k++) { if (!pick(k)) continue; const s = geo.sd[k]; if (s < -K || s >= K) continue; const b = Math.floor((s + K) * 2); sumb[b] += run.D[k] / lv(k); cnt[b]++; }
  const esf = []; for (let b = 0; b < nb; b++) esf.push({ d: -K + (b + 0.5) / 2, v: cnt[b] >= 5 ? sumb[b] / cnt[b] : NaN, n: cnt[b] });
  return esf;
}
function crossing(esf, y, from) {                                        // first position ≥ `from` where the profile rises through y (linear); −Infinity/NaN handled by callers
  const pts = esf.filter((p) => !isNaN(p.v));
  for (let n = 0; n < pts.length; n++) { if (pts[n].d < from) continue; if (pts[n].v >= y) { if (n === 0 || pts[n - 1].d < from) return pts[n].d; const a = pts[n - 1], b = pts[n]; return a.d + (y - a.v) / (b.v - a.v) * (b.d - a.d); } }
  return NaN;
}

// ================================================================== 1. CUTOFF
// Target: the light stops at the line I painted.  Below it, lit; above it, dark, and the change happens over as few cells as the LED image allows.
function cutoff(run) {
  const R = run.R, geo = geometry(run.paint, R), kern = kernelOf(run), level = litLevel(run, geo), P = run.paint;
  const top = (k) => geo.up[k] === 1 && Math.abs(geo.sd[k]) < 8;         // cells on the lit-below / dark-above edges
  // exposure: what a design that reproduced the paint's relative levels would deliver per unit of paint (median over the deep interior)
  const inn = interior(run, geo), expo = (() => { let a = 0, b = 0; for (const k of inn) { a += run.D[k]; b += P[k]; } return b > 0 ? a / b : 0; })();   // light per unit of paint, over the deep interior (mass-matched, so a design that piles light in one place can't zero it)
  const pedge = (k) => { if (P[k] > 0) return P[k]; const i = k % R, j = (k / R) | 0; let m = 0, best = 1e9; for (let b = -8; b <= 8; b++) for (let a = -8; a <= 8; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= R || jj >= R) continue; const q = jj * R + ii, d = a * a + b * b; if (P[q] > 0 && d < best) { best = d; m = P[q]; } } return m; };   // the paint at the cell, or at the nearest painted cell
  const esf = edgeSpread(run, geo, (k) => Math.max(1e-300, expo * pedge(k)), top);   // (unpainted cells farther than 8 cells from any paint are never in the profile: |sd| < 8)      // brightness as a share of what the painted level next to the edge asked for
  const t10 = crossing(esf, 0.1, -8), t50 = crossing(esf, 0.5, -8), t90 = crossing(esf, 0.9, isNaN(t10) ? -8 : t10);
  const width = isNaN(t90) || isNaN(t10) ? 16 : t90 - t10;               // 10→90% width, cells (16 = never got there)
  const floorW = 0.8 * kern;                                              // a box-blurred step of width k has a 10–90% width of 0.8 k
  // ECE R112-style gradient: the largest drop in log10 of the level between neighbouring bins one cell apart (level floored at 1%)
  let grad = 0; for (let n = 0; n + 2 < esf.length; n++) { const a = esf[n + 2].v, b = esf[n].v; if (!isNaN(a) && !isNaN(b)) grad = Math.max(grad, Math.log10(Math.max(0.01, a)) - Math.log10(Math.max(0.01, b))); }
  // glare: the brightest 1% of the 5×5-cell patches lying wholly in the dark zone ABOVE lit paint (paint below in the same column), beyond the blur, as a share of a typical lit cell
  const isAbove = (k) => P[k] <= 0 && geo.up[k] === 1 && -geo.sd[k] >= kern / 2 + 2, isDark = (k) => P[k] <= 0 && -geo.sd[k] >= kern / 2 + 2;
  const ab = blockMeans(run.D, R, isAbove, 5).map((x) => x / level), dk = blockMeans(run.D, R, isDark, 5).map((x) => x / level);
  const above = []; for (let k = 0; k < P.length; k++) if (isAbove(k)) above.push(run.D[k] / level);
  const inner = inn, holes = inner.length ? inner.filter((k) => run.D[k] < 0.5 * expo * P[k]).length / inner.length : NaN;   // lit zone cells under half of what the paint asked there
  const sharp = floorW / Math.max(width, floorW);
  const glare = ab.length ? pctl(ab, 0.99) : 0;
  const offset = isNaN(t50) ? NaN : t50;                                  // + = the lit zone creeps past the painted line into the dark, − = it stops short
  const litCover = inner.length ? 1 - holes : 0;
  return { width, floorWidth: floorW, sharpness: sharp, offset, gradient: grad, glare, glareAll: dk.length ? pctl(dk, 0.99) : 0, meanAbove: above.length ? sum(above) / above.length : 0, litHoles: holes, level,
    score: sharp * litCover * (1 - Math.min(1, glare / 0.1)) };
}
function cutoffGates(m, opt) { const g = GATES.cutoff, why = []; if (!(m.glare <= g.glare)) why.push('glare ' + m.glare.toFixed(2)); if (!(Math.abs(m.offset) <= (opt && opt.tol !== undefined ? opt.tol : g.offsetCells))) why.push('edge off by ' + (isNaN(m.offset) ? '?' : m.offset.toFixed(1))); if (!(m.litHoles <= g.litHoles)) why.push('lit holes ' + (100 * m.litHoles).toFixed(0) + '%'); return { pass: !why.length, why }; }

// ================================================================== 2. HOTSPOT
// Target: the brightest possible centre with the wide fill still reading as a fill (not a hole around a spike).
function hotspot(run) {
  const P = run.paint, R = run.R, D = run.D, pmax = Math.max(...P), row = run.row, geo = geometry(P, R), kern = kernelOf(run);
  const hot = [], fillc = []; for (let k = 0; k < P.length; k++) if (P[k] >= 0.75 * pmax) hot.push(k); else if (P[k] > 0 && geo.sd[k] >= kern / 2 + 1) fillc.push(k);
  const hotD = hot.map((k) => D[k]), fillD = fillc.map((k) => D[k]), hotMean = sum(hotD) / Math.max(1, hot.length), hotMed = median(hotD);
  const fluxPk = row.capturable > 0 ? row.cdPerD * row.capturable * row.reflectivity * (pmax / sum(P)) : NaN, possible = Math.min(fluxPk, row.envelopeCeiling || Infinity);   // Anya's 'possible peak' (phase 1); the goal tuners rank against the best candidate instead
  const hotCd = hotMean * row.cdPerD;
  const ratioPaint = fillc.length ? median(fillc.map((k) => P[k])) / pmax : NaN, ratioGot = fillc.length ? median(fillD) / Math.max(1e-300, hotMed) : NaN;
  const fillRel = fillc.length ? ratioGot / ratioPaint : NaN;
  const fillCover = fillc.length ? fillc.filter((k) => D[k] >= 0.5 * (P[k] / pmax) * hotMed).length / fillc.length : NaN;   // per cell: at least half of what the paint asked there, at the hot zone's own scale
  return { hotCd, possibleCd: possible, ofPossible: possible > 0 ? hotCd / possible : NaN, hotCells: hot.length, fillCells: fillc.length, fillRel, fillCover, spill: row.spill, peakRow: row.peakCd, onPaint: row.onPaint };
}
// (a one-level painting has no fill zone: only the spill guard applies)
function hotspotGates(m) { const g = GATES.hotspot, why = []; if (!m.fillCells) { if (!(m.spill <= g.spill)) why.push('spill ' + (100 * m.spill).toFixed(0) + '%'); return { pass: !why.length, why }; } if (!(m.fillRel >= g.fillRelLo && m.fillRel <= g.fillRelHi)) why.push('fill level ×' + (isNaN(m.fillRel) ? '?' : m.fillRel.toFixed(2))); if (!(m.fillCover >= g.fillCover)) why.push('fill coverage ' + (100 * m.fillCover).toFixed(0) + '%'); if (!(m.spill <= g.spill)) why.push('spill ' + (100 * m.spill).toFixed(0) + '%'); return { pass: !why.length, why }; }

// ================================================================== 3. TEXT / LINE ART
// Target: every stroke is lit end to end, and the gaps between strokes stay clearly darker than the strokes.  Brightness levels don't matter.
function connected(mask, R) {                                            // components of a boolean mask (foreground 8-connected, background 4-connected) → { count, holes } (holes = background components not touching the border)
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]], N4 = N8.slice(0, 4);
  const lab = new Int8Array(R * R); let count = 0; const st = [];
  const flood = (s, want, nb, mark, touch) => { mark[s] = 1; st.push(s); while (st.length) { const k = st.pop(), i = k % R, j = (k / R) | 0; if (touch && (i === 0 || j === 0 || i === R - 1 || j === R - 1)) touch.hit = true; for (const [a, b] of nb) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= R || jj >= R) continue; const q = jj * R + ii; if ((mask[q] ? 1 : 0) === want && !mark[q]) { mark[q] = 1; st.push(q); } } } };
  for (let s = 0; s < R * R; s++) if (mask[s] && !lab[s]) { count++; flood(s, 1, N8, lab); }
  const bg = new Int8Array(R * R); let holes = 0;
  for (let s = 0; s < R * R; s++) if (!mask[s] && !bg[s]) { const t = { hit: false }; flood(s, 0, N4, bg, t); if (!t.hit) holes++; }
  return { count, holes };
}
function text(run) {
  const P = run.paint, R = run.R, D = run.D, geo = geometry(P, R), kern = kernelOf(run);
  const win = new Uint8Array(P.length); for (let k = 0; k < P.length; k++) if (-geo.sd[k] <= 6 || P[k] > 0) win[k] = 1;      // the painting and 6 cells around it
  const ref = pctl(P.map((w, k) => (w > 0 ? D[k] : NaN)).filter((x) => !isNaN(x)), 0.9), thr = 0.5 * ref;                    // "lit" = at least half of the strokes' bright end
  // "achievable": what a perfect design would show through the smallest LED image = the paint blurred by the kernel (Tb).
  // Cells that image would show lit (≥ 50% of its brightest) must be lit; cells it would show dark (≤ 25%) inside the window must be dark.
  const Tb = boxBlur(P, R, kern), tmax = Math.max(...Tb), paintCells = [], gapBand = [], litWant = [];
  for (let k = 0; k < P.length; k++) { if (P[k] > 0) paintCells.push(k); if (win[k] && Tb[k] >= 0.5 * tmax) litWant.push(k); if (win[k] && Tb[k] <= 0.25 * tmax && P[k] <= 0) gapBand.push(k); }
  const recall = litWant.filter((k) => D[k] >= thr).length / litWant.length, leak = gapBand.length ? gapBand.filter((k) => D[k] >= thr).length / gapBand.length : 0;
  const f1 = recall + (1 - leak) > 0 ? 2 * recall * (1 - leak) / (recall + 1 - leak) : 0;
  // contrast: stroke skeleton (deepest painted cells) vs the gap cells right beside them, the ratio of medians
  const skel = paintCells.filter((k) => geo.sd[k] >= Math.max(1, geo.sd[paintCells.reduce((b, q) => (geo.sd[q] > geo.sd[b] ? q : b), paintCells[0])] * 0.6));
  const contrast = (median(skel.map((k) => D[k])) - median(gapBand.map((k) => D[k]))) / Math.max(1e-300, median(skel.map((k) => D[k])) + median(gapBand.map((k) => D[k])));
  // legibility correlation with the paint the optics could at best show (paint blurred by the smallest LED image)
  const T = boxBlur(P, R, kern), idx = []; for (let k = 0; k < P.length; k++) if (win[k]) idx.push(k);
  let mx = 0, my = 0; for (const k of idx) { mx += D[k]; my += T[k]; } mx /= idx.length; my /= idx.length; let sxy = 0, sxx = 0, syy = 0; for (const k of idx) { sxy += (D[k] - mx) * (T[k] - my); sxx += (D[k] - mx) ** 2; syy += (T[k] - my) ** 2; }
  const r = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  // topology: lit components / holes inside the window vs the painting's
  const Db = boxBlur(D, R, 2), refB = pctl(P.map((w, k) => (w > 0 ? Db[k] : NaN)).filter((x) => !isNaN(x)), 0.9), litMask = new Uint8Array(P.length); for (const k of idx) litMask[k] = Db[k] >= 0.5 * refB ? 1 : 0;   // topology on a 2-cell blur: the eye integrates over about that much const pm = Uint8Array.from(P, (w) => (w > 0 ? 1 : 0));
  const pm = Uint8Array.from(P, (w) => (w > 0 ? 1 : 0)), tl = connected(litMask, R), tp = connected(pm, R);
  // far stray light: the brightest 1% of 5×5-cell patches at least 6 cells from any stroke, as a share of the strokes' bright end (streaks and haze that the near-gap band doesn't see)
  const far = blockMeans(D, R, (k) => P[k] <= 0 && -geo.sd[k] >= 6, 5).map((x) => x / ref), farGlare = far.length ? pctl(far, 0.99) : 0;
  return { farGlare, recall, leak, f1, contrast, r, litComponents: tl.count, paintComponents: tp.count, litHoles: tl.holes, paintHoles: tp.holes, topologyOK: tl.count === tp.count && tl.holes === tp.holes, thr };
}
function textGates(m) { const g = GATES.text, why = []; if (!(m.recall >= g.recall)) why.push('recall ' + (100 * m.recall).toFixed(0) + '%'); if (!(m.leak <= g.leak)) why.push('gap leak ' + (100 * m.leak).toFixed(0) + '%'); if (!(m.farGlare <= g.farGlare)) why.push('far glare ' + m.farGlare.toFixed(2)); return { pass: !why.length, why }; }

// ================================================================== 4. PHOTO / LITHOPHANE
// Target: the brightness steps follow the picture: brighter where the picture is brighter, in the right proportion (judged on a
// perceptual scale, since eyes compare ratios), and the dark frame stays dark.
function ranks(a) { const idx = a.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = new Float64Array(a.length); for (let n = 0; n < idx.length;) { let m = n; while (m + 1 < idx.length && idx[m + 1][0] === idx[n][0]) m++; for (let q = n; q <= m; q++) r[idx[q][1]] = (n + m) / 2; n = m + 1; } return r; }
function corr(x, y) { const n = x.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0; }
function photo(run) {
  const P = run.paint, R = run.R, D = run.D, geo = geometry(P, R), kern = kernelOf(run);
  const T = boxBlur(P, R, kern), idx = []; for (let k = 0; k < P.length; k++) if (P[k] > 0 && geo.sd[k] >= kern / 2 + 0.5) idx.push(k);   // painted cells away from the picture's edge
  const b = 4, ib = new Map();                                             // 4×4-cell blocks: keep shot noise from being read as tone error
  for (const k of idx) { const key = ((k / R | 0) >> 2) * 1000 + ((k % R) >> 2); const o = ib.get(key) || { d: 0, t: 0, n: 0 }; o.d += D[k]; o.t += T[k]; o.n++; ib.set(key, o); }
  const d = [], t = []; for (const o of ib.values()) if (o.n >= 8) { d.push(o.d / o.n); t.push(o.t / o.n); }
  const sd = sum(d), st = sum(t), k = sd > 0 ? st / sd : 0;
  const lum = (x) => Math.cbrt(Math.max(0, x));                            // lightness-like (CIE L* is ~ cube root)
  const tmax = Math.max(...t); let err = 0; for (let n = 0; n < d.length; n++) err += Math.abs(lum(d[n] * k / tmax) - lum(t[n] / tmax)); err /= d.length;
  const rho = corr(Array.from(ranks(d)), Array.from(ranks(t))), pearson = corr(d, t);
  // dynamic range kept: the picture's 10→90% span of the tones vs ours (a flat grey scores 0)
  const span = (a) => pctl(a, 0.9) / Math.max(1e-300, pctl(a, 0.1)), rangeKept = Math.log(span(d.map((x) => x * k))) / Math.log(span(t));
  // fine detail (the eyes and mouth of a portrait): correlation of the high-passed delivered map (2-cell denoise, minus an 8-cell blur) with the high-passed target
  const Db = boxBlur(D, R, 2), hp = (g) => { const lo = boxBlur(g, R, 8), o = new Float64Array(g.length); for (let q = 0; q < g.length; q++) o[q] = g[q] - lo[q]; return o; }, hd = hp(Db), ht = hp(T), dx = [], dy = [];
  for (const q of idx) if (geo.sd[q] >= 6) { dx.push(hd[q]); dy.push(ht[q]); }
  const detail = corr(dx, dy);
  return { detail, rho, pearson, lightnessErr: err, rangeKept, blocks: d.length, spill: run.row.spill, onPaint: run.row.onPaint };
}
function photoGates(m) { const g = GATES.photo, why = []; if (!(m.rho >= g.rho)) why.push('rank corr ' + m.rho.toFixed(2)); if (!(m.spill <= g.spill)) why.push('spill ' + (100 * m.spill).toFixed(0) + '%'); return { pass: !why.length, why }; }

// ================================================================== 5. UNIFORMITY
// Target: an even wash: no dark patches, no bright patches, no tilt.  Judged on 4×4-cell blocks (single-cell speckle is ray noise, not the design).
function uniformity(run) {
  const P = run.paint, R = run.R, D = run.D, geo = geometry(P, R), kern = kernelOf(run);
  const cells = []; for (let k = 0; k < P.length; k++) if (P[k] > 0 && geo.sd[k] >= kern / 2 + 2) cells.push(k);   // the wash without its blurred rim
  const blocks = new Map(); for (const k of cells) { const key = ((k / R | 0) >> 2) * 1000 + ((k % R) >> 2); const o = blocks.get(key) || { s: 0, n: 0 }; o.s += D[k]; o.n++; blocks.set(key, o); }
  const v = []; for (const o of blocks.values()) if (o.n >= 12) v.push(o.s / o.n);
  const mean = sum(v) / v.length, sdv = Math.sqrt(sum(v.map((x) => (x - mean) ** 2)) / v.length);
  const raysPerCell = mean * run.row.rays * 1;                             // D is a share of the emission, so rays/cell ≈ D × N
  const noiseCV = 1 / Math.sqrt(Math.max(1e-9, raysPerCell * 16));         // shot noise of a 16-cell block
  const cv = sdv / mean, excess = Math.sqrt(Math.max(0, cv * cv - noiseCV * noiseCV));
  const minOverMean = Math.min(...v) / mean, p10OverMean = pctl(v, 0.1) / mean, p90OverMean = pctl(v, 0.9) / mean;
  // tilt vs blotches: the plane fit's share of the variance (a tilt is explained by a plane; blotches aren't)
  let sx = 0, sy = 0, n = 0; const pts = []; for (const [key, o] of blocks) if (o.n >= 12) { pts.push([key % 1000, (key / 1000) | 0, o.s / o.n]); }
  const mxx = sum(pts.map((p) => p[0])) / pts.length, myy = sum(pts.map((p) => p[1])) / pts.length; let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0; for (const p of pts) { const x = p[0] - mxx, y = p[1] - myy, z = p[2] - mean; a11 += x * x; a12 += x * y; a22 += y * y; b1 += x * z; b2 += y * z; }
  const det = a11 * a22 - a12 * a12, cx = det ? (b1 * a22 - b2 * a12) / det : 0, cy = det ? (a11 * b2 - a12 * b1) / det : 0; let res = 0; for (const p of pts) res += (p[2] - mean - cx * (p[0] - mxx) - cy * (p[1] - myy)) ** 2;
  const tiltShare = sdv > 0 ? 1 - res / pts.length / (sdv * sdv) : 0;
  return { cv, noiseCV, excessCV: excess, minOverMean, p10OverMean, p90OverMean, tiltShare, blocks: v.length, rate: raysPerCell, spill: run.row.spill, onPaint: run.row.onPaint, score: 1 / (1 + 10 * excess) };
}
function uniformityGates(m) { const g = GATES.wash, why = []; if (!(m.p10OverMean >= g.minOverMean)) why.push('p10/mean ' + m.p10OverMean.toFixed(2)); if (!(m.spill <= g.spill)) why.push('spill ' + (100 * m.spill).toFixed(0) + '%'); return { pass: !why.length, why }; }

// ================================================================== general: how far the light is from where the paint wants it
// Sliced Wasserstein-1 (in cells): project both distributions (each scaled to total 1) onto 8 directions, the mean distance the light must be
// moved along each to become the painting.  Degrades smoothly when light is misplaced, and can't be met by getting single cells right.
function slicedW1(run, angles) {
  const R = run.R, P = run.paint, D = run.D, A = angles || 8, sp = sum(P), sd = sum(D); if (!(sp > 0 && sd > 0)) return NaN;
  let tot = 0; const nb = Math.ceil(R * Math.SQRT2 * 2) + 2;
  for (let a = 0; a < A; a++) {
    const th = Math.PI * a / A, c = Math.cos(th), s = Math.sin(th), h1 = new Float64Array(nb), h2 = new Float64Array(nb);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const b = Math.floor((i * c + j * s + R) * 2), k = j * R + i; h1[b] += P[k] / sp; h2[b] += D[k] / sd; }
    let c1 = 0, c2 = 0, w = 0; for (let b = 0; b < nb; b++) { c1 += h1[b]; c2 += h2[b]; w += Math.abs(c1 - c2) * 0.5; } tot += w;
  }
  return tot / A;
}


// ================================================================== running a goal
// ---- the numbers a run needs from the app: LED image size, cd per unit of D, and D itself from a tools.trace() result
function ledMinSize(src) {
  if (src.kind === 'planar') return src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h);
  if (src.shape === 'cylinder') return Math.min(2 * src.radius, src.length);
  return 2 * src.radius;
}
// input = the solver's input ({ source, envelope, target, paint, limits }); rays = what the trace used
function context(input, rays) {
  const R = input.paint.res, T = RF.Engine.targetFrame(input.target), dm = RF.V.dist(T.C, input.source.pos) / 1000, cellM2 = (2 * T.half / R) ** 2 * 1e-6;
  const ker = RF.Photometry.achievableKernel({ source: input.source, envelope: input.envelope, target: input.target });
  return { R, rays: rays || 0, cdPerD: input.source.power * dm * dm / cellM2, kernel: ker, kernelCells: Math.max(1, ker.cells), ledMin: ledMinSize(input.source), reflectivity: input.limits.reflectivity };
}
function runFromTrace(input, tr, ctx) {
  const R = ctx.R, G = RF.Engine.toPaintGrid(tr.grid, tr.res, R), em = tr.energy.emitted || 1, f = tr.fidelity || {};
  return { R, paint: input.paint.cells, D: Array.from(G, (x) => x / em),
    row: { rays: ctx.rays, cdPerD: ctx.cdPerD, achievableKernelCells: ctx.kernelCells, fidelity: f.fidelity, onPaint: f.onPaint, spill: f.spill, peakCd: tr.peakCd, reflectivity: ctx.reflectivity } };
}

// ---- one design, one goal → raw metrics + the gates it fails.  opt.tol = the cutoff edge tolerance in cells.
function evaluate(goal, run, opt) {
  opt = opt || {}; let m, g;
  if (goal === 'cutoff') { m = cutoff(run); g = cutoffGates(m, opt); }
  else if (goal === 'hotspot') { m = hotspot(run); g = hotspotGates(m); }
  else if (goal === 'text') { m = text(run); g = textGates(m); }
  else if (goal === 'photo') { m = photo(run); g = photoGates(m); }
  else if (goal === 'wash') { m = uniformity(run); g = uniformityGates(m); }
  else if (goal === 'general') { m = {}; g = { pass: true, why: [] }; }              // no specific target: the app's fidelity alone
  else throw new Error('unknown goal ' + goal);
  return { goal, m, gates: g, fid: run.row.fidelity, onPaint: run.row.onPaint, peak: goal === 'cutoff' ? hotspot(run).hotCd : goal === 'general' ? 0 : m.hotCd };
}
const textScore = (m) => m.f1 * (1 - Math.min(1, m.farGlare / 0.3)) * (m.paintHoles > 0 ? 0.5 + 0.5 * Math.min(1, m.litHoles / m.paintHoles) : 1);
const photoScore = (m) => 0.5 * m.rho * (1 - Math.min(1, 2 * m.lightnessErr)) + 0.5 * Math.max(0, m.detail);
// Rank evaluated candidates ({ ev } each, from evaluate) for a goal, RELATIVE to each other; sets .score (0..1, higher better) and .veto (reasons, or '').
//   cutoff  : edge sharpness × fidelity × peak (÷ the best peak among candidates)          gates: glare, edge within tol, lit holes
//   hotspot : peak (÷ the best peak among candidates) × fidelity                           gates: fill level, fill coverage, spill
//   text    : legibility score (F1, far glare, loops)                                       gates as above + light on paint ≥ 50% of the best candidate's
//   photo   : rank + tone + detail                                                          gates + light floor
//   wash    : noise-free evenness                                                           gates + light floor
// Returns the candidates sorted best first (vetoed last).
function rank(goal, cands) {
  const pass = cands.filter((c) => c.ev.gates.pass), pool = pass.length ? pass : cands;
  const ref = (f) => Math.max(1e-300, ...pool.map(f).filter(isFinite));
  const peakRef = ref((c) => c.ev.peak), lightRef = ref((c) => c.ev.onPaint);
  for (const c of cands) {
    const e = c.ev, m = e.m, why = e.gates.why.slice(); let s;
    const light = GATES[goal] && GATES[goal].light;
    if (light && e.onPaint < light * lightRef) why.push('light on paint ' + (100 * e.onPaint).toFixed(0) + '% < ' + Math.round(100 * light) + '% of the best (' + (100 * lightRef).toFixed(0) + '%)');
    if (goal === 'cutoff') s = m.sharpness * (e.fid || 0) * (e.peak / peakRef);
    else if (goal === 'hotspot') s = (e.peak / peakRef) * (e.fid || 0);
    else if (goal === 'text') s = textScore(m) * (0.85 + 0.15 * e.onPaint / lightRef);
    else if (goal === 'photo') s = photoScore(m);
    else if (goal === 'general') s = (e.fid || 0) * (0.8 + 0.2 * e.onPaint / lightRef);
    else s = m.score;
    c.score = isFinite(s) ? s : 0; c.veto = why.join(', ');
  }
  return cands.slice().sort((a, b) => ((a.veto ? 1 : 0) - (b.veto ? 1 : 0)) || b.score - a.score);
}

// ================================================================== what kind of painting is this?
// Features of the paint map, then a short decision list.  Simple on purpose: every step can be read back to the user.
//   strokeCells : typical stroke width = twice the distance-to-edge along the ridge of the painted shapes
//   levels      : how many of 20 brightness bins hold ≥ 2% of the painted cells
//   flatTop     : share of painted columns whose top edge lies within 1 row of the most common top row (with nothing painted above it)
//   peakStands  : the brightest level ÷ the median painted level;  hotShare = share of painted cells ≥ 75% of the brightest
function paintFeatures(paint, R, kernelCells) {
  const n = R * R; let np = 0, pmax = 0; const vals = [];
  for (let k = 0; k < n; k++) if (paint[k] > 0) { np++; pmax = Math.max(pmax, paint[k]); vals.push(paint[k]); }
  if (!np) return { painted: 0 };
  const bins = new Array(20).fill(0); for (const v of vals) bins[Math.min(19, Math.floor(v / pmax * 20))]++;
  const levels = bins.filter((c) => c >= 0.02 * np).length, med = median(vals);
  const geo = geometry(paint, R), ridge = [];
  for (let j = 1; j < R - 1; j++) for (let i = 1; i < R - 1; i++) { const k = j * R + i, s = geo.sd[k]; if (!(paint[k] > 0) || s < 1) continue; let top = true; for (let b = -1; b <= 1 && top; b++) for (let a = -1; a <= 1; a++) if (geo.sd[k + b * R + a] > s) { top = false; break; } if (top) ridge.push(2 * s); }
  const strokeCells = ridge.length ? median(ridge) : 0;
  const tops = new Map(); let cols = 0;                                        // top edge of each painted column
  for (let i = 0; i < R; i++) { let t = -1; for (let j = R - 1; j >= 0; j--) if (paint[j * R + i] > 0) { t = j; break; } if (t >= 0) { cols++; tops.set(t, (tops.get(t) || 0) + 1); } }
  let modal = -1, mc = 0; for (const [t, c] of tops) if (c > mc) { mc = c; modal = t; }
  let near = 0; for (const [t, c] of tops) if (Math.abs(t - modal) <= 1) near += c;
  const aboveClear = modal < R - 3;                                            // the flat edge isn't just the top of the target
  return { painted: np, coverage: np / n, levels, strokeCells, kernelCells, flatTop: cols ? near / cols : 0, flatCols: cols / R, aboveClear, peakStands: pmax / Math.max(1e-9, med), hotShare: vals.filter((v) => v >= 0.75 * pmax).length / np };
}
// → { kind: 'text'|'cutoff'|'hotspot'|'photo'|'wash'|'general', why, features }
function classify(paint, R, kernelCells) {
  const f = paintFeatures(paint, R, kernelCells), pc = (x) => Math.round(100 * x) + '%', c1 = (x) => (Math.round(10 * x) / 10);
  if (!f.painted) return { kind: 'general', why: 'nothing is painted', features: f };
  const uniform = f.peakStands < 2;                                              // no level stands out from the rest
  const thin = f.strokeCells <= Math.max(4 * kernelCells, 8) && f.strokeCells <= 10 && f.coverage < 0.25 && f.levels <= 3 && uniform;
  if (thin) return { kind: 'text', why: 'thin strokes (about ' + c1(f.strokeCells) + ' cells wide, the LED image is ' + c1(kernelCells) + ' cells) at one brightness → text / line art', features: f };
  if (f.flatTop >= 0.5 && f.flatCols > 0.75 && f.aboveClear && f.levels <= 8) return { kind: 'cutoff', why: 'a straight top edge on ' + pc(f.flatTop) + ' of the painted width, spanning ' + pc(f.flatCols) + ' of the target, nothing above it, ' + f.levels + ' brightness levels → cutoff', features: f };
  if (f.levels >= 6 && (f.coverage >= 0.5 || f.peakStands < 3)) return { kind: 'photo', why: 'many brightness levels (' + f.levels + ') with ' + (f.coverage >= 0.5 ? pc(f.coverage) + ' of the target painted' : 'no bright core (peak only ' + c1(f.peakStands) + '× the typical level)') + ' → photo', features: f };
  if (f.peakStands >= 2 && f.hotShare <= 0.35 && f.levels >= 2) return { kind: 'hotspot', why: 'a bright core (' + c1(f.peakStands) + '× the typical level, ' + pc(f.hotShare) + ' of the painted cells) on a wider fill → hotspot', features: f };
  if (f.levels <= 2) return { kind: 'wash', why: 'one brightness level over ' + pc(f.coverage) + ' of the target, shapes wider than a stroke → even wash', features: f };
  return { kind: 'general', why: 'no clear type (' + f.levels + ' levels, ' + pc(f.coverage) + ' painted) → general purpose', features: f };
}

// ================================================================== what would help most (evidence, not advice)
// kind, features, ctx (from context()), input; capturable = share of the LED's emission that passes through the envelope
function capturable(input) {
  const smp = RF.Source.makeSampler(input.source), o = [0, 0, 0], d = [0, 0, 0]; let s = 12345, n = 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 20000; i++) { RF.Source.sampleRay(smp, rnd(), rnd(), rnd(), rnd(), rnd(), o, d); const iv = RF.Geo.envInterval(input.envelope, o, d); if (iv && iv[1] > Math.max(0, iv[0]) + 1e-6) n++; }
  return n / 20000;
}
function recommend(kind, f, ctx, input) {
  const out = [];
  if ((kind === 'text' || kind === 'cutoff') && f.strokeCells && ctx.kernelCells > f.strokeCells / 1.5) {
    const want = f.strokeCells / 1.5, k = want / ctx.kernelCells, k0 = ctx.kernel;
    out.push('The LED image (' + ctx.kernelCells.toFixed(1) + ' cells) is wider than a stroke needs (strokes are ' + f.strokeCells.toFixed(1) + ' cells; about ' + want.toFixed(1) + ' or less would read cleanly). A die of about ' + (ctx.ledMin * k).toFixed(2) + ' mm (now ' + ctx.ledMin.toFixed(2) + ') would do it, or facets ' + (k0.r / k).toFixed(0) + ' mm from the LED (now at best ' + k0.r.toFixed(0) + ' mm), which needs a bigger envelope.');
  }
  const cap = capturable(input);
  if (cap < 0.9) out.push('Only ' + Math.round(100 * cap) + '% of the LED\'s light passes through the envelope; a bigger envelope, or turning the LED toward it, would put more light to use.');
  return out;
}

RF.Modes = { GATES, geometry, cutoff, cutoffGates, hotspot, hotspotGates, text, textGates, photo, photoGates, uniformity, uniformityGates, slicedW1, boxBlur, litLevel, edgeSpread, connected, median, pctl,
  context, runFromTrace, evaluate, rank, textScore, photoScore, paintFeatures, classify, recommend, capturable };
})(typeof globalThis !== 'undefined' ? globalThis : this);
