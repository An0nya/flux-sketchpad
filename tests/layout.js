// Layout arithmetic (headless): node tests/layout.js — exits 1 on failure.
// Every collapse × expand combination at several workspace sizes: sizes fill the space exactly,
// nothing is negative, collapsed panes stay visible (rail/bar), and an expanded pane dominates.
globalThis.RF = {}; require('../js/layout.js'); const L = RF.Layout;
let fails = 0, n = 0; const bad = (m) => { if (fails < 12) console.log('[FAIL] ' + m); fails++; };
const sizes = [[1400, 800], [1000, 700], [640, 500], [420, 380]];
for (const [W, H] of sizes) for (let mask = 0; mask < 16; mask++) for (const x of [null].concat(L.PANES)) {
  const collapsed = {}; L.PANES.forEach((p, i) => { if (mask & (1 << i)) collapsed[p] = true; });
  const st = { collapsed, expanded: x }, r = L.compute(st, W, H), tag = W + '×' + H + ' c=' + mask + ' x=' + x; n++;
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  if (sum(r.cols) !== W) bad(tag + ' cols sum ' + sum(r.cols));
  if (sum(r.rows) !== H) bad(tag + ' rows sum ' + sum(r.rows));
  if (r.cols.concat(r.rows, r.pair.sizes).some((v) => v < 0 || !isFinite(v))) bad(tag + ' negative/NaN size');
  for (const p of L.PANES) if (collapsed[p] && !r.cls[p]) bad(tag + ' collapsed ' + p + ' has no rail/bar');
  const eff = L.sanitize(st).expanded;
  if (eff === 'scene' && (mask & 14) !== 14 && W >= 2 * L.K.MIN + L.K.DIV && r.cols[0] < Math.min(Math.round((W - L.K.DIV) * L.K.DOM), W - L.K.DIV - L.K.MIN) - 1) bad(tag + ' expanded scene not dominant');
  if ((eff === 'editor' || eff === 'result') && !collapsed.scene && W >= 2 * L.K.MIN + L.K.DIV && r.cols[2] < r.cols[0]) bad(tag + ' expanded map: right column not dominant');
}
// expand restores: the stored shares are untouched by expanding
const base = { split: 0.4, rowSplit: 0.55, pairSplit: 0.5, collapsed: {} };
const a = L.compute(base, 1400, 800), b = L.compute(Object.assign({}, base, { expanded: 'optics' }), 1400, 800), c = L.compute(base, 1400, 800);
if (JSON.stringify(a) !== JSON.stringify(c) || b.rows[2] <= a.rows[2]) bad('expand/restore round trip');
// garbage in → defaults, not NaN
const g = L.compute({ split: 'x', rowSplit: 7, collapsed: null, expanded: 'nope' }, 1200, 700);
if (g.cols.some((v) => !isFinite(v))) bad('sanitize');
console.log((fails ? '[FAIL] ' + fails + ' of ' : '[PASS] all ') + n + ' layouts fill the space; collapsed panes stay reachable; expand dominates and restores');
process.exit(fails ? 1 : 0);
