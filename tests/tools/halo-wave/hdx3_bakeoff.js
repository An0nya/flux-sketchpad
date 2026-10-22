// HDX3 addendum: offline interpolation bake-off (no browser). Input: dump.json + dump_cum.f32 from hdx3_dump.js.
// Ground truth: exact C(d_end) on the cell ray (refInt, 256 steps, s0 = 0.5, RGB sum). Approximations use ONLY exact C at bin edges
// (and, for rule e, the exact value at each bin's geometric midpoint). node hdx3_bakeoff.js <dir>
const fs = require('fs');
const DIR = process.argv[2];
const H = JSON.parse(fs.readFileSync(DIR + '/dump.json', 'utf8'));
const raw = fs.readFileSync(DIR + '/dump_cum.f32'); const F = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const NODES = H.nodes, NN = NODES + 1, S0 = 0.5, SMAX = 120;
const nodeE = (j) => S0 * Math.pow(SMAX / S0, j / NODES);
// exact cumulative from the node table (node cum is the RGB MEAN, so x3 gives the RGB sum), log-linear interpolation in d
function makeCum(off, n) {
  const base = off; return (d) => {
    if (!(d > S0)) return 0; if (d >= SMAX) return 3 * F[base + NODES];
    const j = Math.log(d / S0) / Math.log(SMAX / S0) * NODES, j0 = Math.floor(j), t = j - j0;
    return 3 * (F[base + j0] * (1 - t) + F[base + j0 + 1] * t);
  };
}
// layouts (edges, ascending, last = 120)
function geoEdges(n, lo = S0, hi = SMAX) { return Array.from({ length: n }, (_, k) => lo * Math.pow(hi / lo, (k + 1) / n)); }
function anchored(D) {
  const e = [...geoEdges(3, S0, 0.45 * D), 0.45 * D, 0.7 * D, 0.85 * D, D, Math.min(1.6 * D, SMAX), ...geoEdges(5, Math.min(1.6 * D, SMAX), SMAX)];
  const u = []; for (const x of e.sort((a, b) => a - b)) if (x > S0 && x < SMAX && (!u.length || x - u[u.length - 1] > 1e-3)) u.push(x); u.push(SMAX); return u;
}
const LAYOUTS = (D, adapt) => ({
  adaptive6: adapt,
  ladder6: [8, 14, 22, 34, 60, 120],
  geo8: geoEdges(8),
  geo12: geoEdges(12),
  geo16: geoEdges(16),
  geo24: geoEdges(24),
  anchored: anchored(D),
});
// --- rules. Each returns f(d) given the layout edges E (ascending), bin cumulative values Cv[k] = C(E[k]) and optional midpoint values M[k] = C(sqrt(E[k-1]E[k]))
function ruleA(E, Cv) {   // today's rule: bin 0 linear in d from 0; later bins linear in log d between edges
  return (d) => { if (!(d > 0)) return 0; const dd = Math.min(d, E[E.length - 1]);
    for (let k = 0; k < E.length; k++) if (dd <= E[k]) {
      if (k === 0) return Cv[0] * (dd / E[0]);
      const pe = E[k - 1], f = Math.log(dd / pe) / Math.log(E[k] / pe); return Cv[k - 1] + (Cv[k] - Cv[k - 1]) * f; } return Cv[E.length - 1]; };
}
function ruleB(E, Cv) {   // linear in log d everywhere, bin 0 anchored at C(0.5)=0
  return (d) => { if (!(d > S0)) return 0; const dd = Math.min(d, E[E.length - 1]);
    for (let k = 0; k < E.length; k++) if (dd <= E[k]) {
      const pe = k === 0 ? S0 : E[k - 1], pc = k === 0 ? 0 : Cv[k - 1];
      const f = Math.log(dd / pe) / Math.log(E[k] / pe); return pc + (Cv[k] - pc) * f; } return Cv[E.length - 1]; };
}
function ruleC(E, Cv) {   // power law C = C_hi (d/e_hi)^p, p = exponent of the previous two edges (C_{k-2}->C_{k-1}); bin 0 linear
  return (d) => { if (!(d > 0)) return 0; const dd = Math.min(d, E[E.length - 1]);
    for (let k = 0; k < E.length; k++) if (dd <= E[k]) {
      if (k === 0) return Cv[0] * (dd / E[0]);
      let p = 1; if (k >= 2 && Cv[k - 2] > 0 && Cv[k - 1] > 0) p = Math.log(Cv[k - 1] / Cv[k - 2]) / Math.log(E[k - 1] / E[k - 2]);
      return Cv[k] * Math.pow(dd / E[k], p); } return Cv[E.length - 1]; };
}
function ruleC2(E, Cv) {  // geometric: log C linear in log d between edges (power law fitted to both ends); bin 0 linear
  return (d) => { if (!(d > 0)) return 0; const dd = Math.min(d, E[E.length - 1]);
    for (let k = 0; k < E.length; k++) if (dd <= E[k]) {
      if (k === 0) return Cv[0] * (dd / E[0]);
      const pe = E[k - 1], f = Math.log(dd / pe) / Math.log(E[k] / pe);
      if (Cv[k - 1] > 0 && Cv[k] > 0) return Cv[k - 1] * Math.pow(Cv[k] / Cv[k - 1], f);
      return Cv[k - 1] + (Cv[k] - Cv[k - 1]) * f; } return Cv[E.length - 1]; };
}
function ruleD(E, Cv) {   // monotone cubic Hermite (Fritsch-Carlson) in (log d, log C) through the edges; bin 0 by rule B (log from 0.5)
  const n = E.length, x = E.map(Math.log), y = Cv.map((c) => Math.log(Math.max(c, 1e-300)));
  const h = [], dl = []; for (let k = 0; k < n - 1; k++) { h.push(x[k + 1] - x[k]); dl.push((y[k + 1] - y[k]) / h[k]); }
  const m = new Array(n).fill(0); m[0] = dl[0]; m[n - 1] = dl[n - 2];
  for (let k = 1; k < n - 1; k++) { if (dl[k - 1] * dl[k] <= 0) m[k] = 0; else { const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]; m[k] = (w1 + w2) / (w1 / dl[k - 1] + w2 / dl[k]); } }
  const B = ruleB(E, Cv);
  return (d) => { if (!(d > S0)) return 0; const dd = Math.min(d, E[n - 1]); if (dd <= E[0]) return B(dd);
    const lx = Math.log(dd); let k = 0; while (k < n - 2 && lx > x[k + 1]) k++;
    const t = (lx - x[k]) / h[k], t2 = t * t, t3 = t2 * t, hh = h[k];
    const v = (2 * t3 - 3 * t2 + 1) * y[k] + (t3 - 2 * t2 + t) * hh * m[k] + (-2 * t3 + 3 * t2) * y[k + 1] + (t3 - t2) * hh * m[k + 1];
    return Math.exp(v); };
}
function ruleE(E, Cv, Mv) {  // piecewise linear in d through edges and geometric-midpoint samples (one extra stored value per bin)
  return (d) => { if (!(d > 0)) return 0; const dd = Math.min(d, E[E.length - 1]);
    const xs = [S0], ys = [0]; for (let k = 0; k < E.length; k++) { xs.push(Math.sqrt((k ? E[k - 1] : S0) * E[k])); ys.push(Mv[k]); xs.push(E[k]); ys.push(Cv[k]); }
    for (let i = 0; i < xs.length - 1; i++) if (dd <= xs[i + 1]) { const t = (dd - xs[i]) / (xs[i + 1] - xs[i]); return ys[i] + (ys[i + 1] - ys[i]) * t; }
    return Cv[E.length - 1]; };
}

function ruleF(E, Cv) {   // monotone cubic Hermite (Fritsch-Carlson) in (log d, C) linear in C: zero-safe, GLSL-friendly; bin 0 by rule B
  const n = E.length, x = E.map(Math.log), y = Cv.slice();
  const h = [], dl = []; for (let k = 0; k < n - 1; k++) { h.push(x[k + 1] - x[k]); dl.push((y[k + 1] - y[k]) / h[k]); }
  const m = new Array(n).fill(0); m[0] = dl[0]; m[n - 1] = dl[n - 2];
  for (let k = 1; k < n - 1; k++) { if (dl[k - 1] * dl[k] <= 0) m[k] = 0; else { const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]; m[k] = (w1 + w2) / (w1 / dl[k - 1] + w2 / dl[k]); } }
  const B = ruleB(E, Cv);
  return (d) => { if (!(d > S0)) return 0; const dd = Math.min(d, E[n - 1]); if (dd <= E[0]) return B(dd);
    const lx = Math.log(dd); let k = 0; while (k < n - 2 && lx > x[k + 1]) k++;
    const t = (lx - x[k]) / h[k], t2 = t * t, t3 = t2 * t, hh = h[k];
    return (2 * t3 - 3 * t2 + 1) * y[k] + (t3 - 2 * t2 + t) * hh * m[k] + (-2 * t3 + 3 * t2) * y[k + 1] + (t3 - t2) * hh * m[k + 1]; };
}
const RULES = { a_today: ruleA, b_logAll: ruleB, c_powPrev: ruleC, c2_geometric: ruleC2, d_pchip: ruleD, d2_pchipLin: ruleF, e_midpoints: ruleE };
// --- scoring
const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const results = []; const profile = {}; let consist = [];
const runs = H.runs.map((r, ri) => {
  const off = ri === 0 ? 0 : 0; return r;
});
let base = 0;
for (let ri = 0; ri < H.runs.length; ri++) {
  const run = H.runs[ri], n = run.n, cumOf = (i) => makeCum(i * NN, NODES);
  // point i's cumulative
  const pts = []; for (let i = 0; i < n; i++) pts.push({ sEnd: run.sEnd[i], exact: run.exact[i], cum: (d) => { const b = (base + i) * NN; return cumAtIdx(b, d); } });
  function cumAtIdx(b, d) { if (!(d > S0)) return 0; if (d >= SMAX) return 3 * F[b + NODES]; const j = Math.log(d / S0) / Math.log(SMAX / S0) * NODES, j0 = Math.floor(j), t = j - j0; return 3 * (F[b + j0] * (1 - t) + F[b + j0 + 1] * t); }
  // consistency: node interpolation vs exact at sEnd
  const cons = pts.map((p) => p.cum(p.sEnd) / p.exact).filter((v) => isFinite(v) && v > 0);
  consist.push({ D: run.D, median_nodeCum_over_exact_at_sEnd: +q(cons, 0.5).toFixed(4), p95abs: +q(cons.map((v) => Math.abs(Math.log(v))), 0.95).toFixed(4) });
  const cpu95 = q(pts.map((p) => p.exact), 0.95), sig = pts.filter((p) => p.exact >= 0.01 * cpu95 && p.exact > 0);
  const layouts = LAYOUTS(run.D, run.edges);
  for (const [lname, E] of Object.entries(layouts)) {
    for (const [rname, R] of Object.entries(RULES)) {
      const ratios = [], rows = [];
      for (const p of sig) {
        // knot values: exact C at edges, plus exact C at geometric midpoints for rule e
        const Cv = E.map((e) => p.cum(e)); const Mv = E.map((e, k) => p.cum(Math.sqrt((k ? E[k - 1] : S0) * e)));
        const f = rname === 'e_midpoints' ? R(E, Cv, Mv) : R(E, Cv);
        const approx = f(p.sEnd); const ratio = approx / p.exact; ratios.push(ratio); rows.push({ d: p.sEnd, ratio });
      }
      const lr = ratios.map((r) => Math.abs(Math.log(Math.max(r, 1e-12))));
      results.push({ D: +run.D.toFixed(1), layout: lname, nb: E.length, rule: rname, n: sig.length, median: +q(ratios, 0.5).toFixed(3), p95abslog: +q(lr, 0.95).toFixed(3), worst: +Math.max(...lr).toFixed(3) });
      if (Math.round(run.D) === 50) { profile[lname + '|' + rname] = rows; }
    }
  }
  base += n;
}
fs.writeFileSync(DIR + '/bakeoff_results.json', JSON.stringify({ results, consistency: consist }, null, 0));
fs.writeFileSync(DIR + '/bakeoff_profile_D50.json', JSON.stringify(profile));
console.log('consistency', JSON.stringify(consist));
console.log(JSON.stringify(results.length));
