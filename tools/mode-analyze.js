#!/usr/bin/env node
// Rank every design that ran on a scene by a mode's metric, print the table next to the app's fidelity, and draw heatmap montages.
//   node tools/mode-analyze.js <mode> <scene> [--montage] [--pick best,mid,worst,vetoed] [--n 3] [--filter substring] [--dir bench-out/modes]
// modes: cutoff hotspot text photo uniformity light
// Montage numbers are the rank in the printed table (1 = best).  Written to <dir>/img/<mode>__<scene>__<kind>.png (gitignored).
'use strict';
const fs = require('fs'), path = require('path');
const M = require('./mode-scores.js'), H = require('./heatmap-png.js');
const a = process.argv.slice(2), opt = (k, d) => { const i = a.indexOf('--' + k); return i < 0 ? d : a[i + 1]; };
const mode = a[0], scene = a[1], dir = path.resolve(opt('dir', path.join(__dirname, '..', 'bench-out/modes')));
const f2 = (x, n) => (x === null || x === undefined || !isFinite(x) ? '—' : x.toFixed(n === undefined ? 2 : n)), pc = (x) => (x === null || x === undefined || !isFinite(x) ? '—' : (100 * x).toFixed(0));

const MODES = {
  cutoff: { fn: M.cutoff, gates: M.cutoffGates, key: (m) => m.score, head: 'width(fl) sharp offset  grad glare  holes', cols: (m) => [f2(m.width, 1) + '(' + f2(m.floorWidth, 1) + ')', f2(m.sharpness), f2(m.offset, 1), f2(m.gradient), f2(m.glare, 3), pc(m.litHoles)] },
  hotspot: { fn: M.hotspot, gates: M.hotspotGates, key: (m) => m.ofPossible, head: 'hotCd    ofPoss fillRel cover spill', cols: (m) => [f2(m.hotCd, 0).padStart(8), f2(m.ofPossible), f2(m.fillRel), pc(m.fillCover), pc(m.spill)] },
  text: { fn: M.text, gates: M.textGates, key: (m) => m.f1 * (1 - Math.min(1, m.farGlare / 0.3)) * (m.paintHoles > 0 ? 0.5 + 0.5 * Math.min(1, m.litHoles / m.paintHoles) : 1), head: 'recall leak farGl F1  contrast r    topology', cols: (m) => [pc(m.recall), pc(m.leak), f2(m.farGlare), f2(m.f1), f2(m.contrast), f2(m.r), (m.topologyOK ? 'ok' : 'lit ' + m.litComponents + '/' + m.paintComponents + ' holes ' + m.litHoles + '/' + m.paintHoles)] },
  photo: { fn: M.photo, gates: M.photoGates, key: (m) => 0.5 * m.rho * (1 - Math.min(1, 2 * m.lightnessErr)) + 0.5 * Math.max(0, m.detail), head: 'rho   pearson lightErr range detail spill', cols: (m) => [f2(m.rho), f2(m.pearson), f2(m.lightnessErr, 3), f2(m.rangeKept), f2(m.detail), pc(m.spill)] },
  uniformity: { fn: M.uniformity, gates: M.uniformityGates, key: (m) => m.score, head: 'cv    noise excess min/mean p10/mean tilt  spill', cols: (m) => [f2(m.cv, 3), f2(m.noiseCV, 3), f2(m.excessCV, 3), f2(m.minOverMean), f2(m.p10OverMean), f2(m.tiltShare), pc(m.spill)] },
  light: { fn: M.usefulLight, gates: (m, r) => ({ pass: r.row.fidelity >= M.GATES.light.fid, why: r.row.fidelity >= M.GATES.light.fid ? [] : ['fidelity ' + pc(r.row.fidelity)] }), key: (m) => m.usefulOfIdeal, head: 'useful/ideal onPaint', cols: (m) => [f2(m.usefulOfIdeal), pc(m.onPaint)] },
};
const spear = (x, y) => { const rk = (v) => { const i = v.map((q, n) => [q, n]).sort((p, q) => p[0] - q[0]), r = []; i.forEach((p, n) => (r[p[1]] = n)); return r; }, rx = rk(x), ry = rk(y), n = x.length; let d = 0; for (let i = 0; i < n; i++) d += (rx[i] - ry[i]) ** 2; return 1 - 6 * d / (n * (n * n - 1)); };

function load(scene, filter) {
  const rd = path.join(dir, 'runs');
  return fs.readdirSync(rd).filter((f) => f.startsWith(scene + '__') && f.endsWith('.json') && (!filter || f.includes(filter))).map((f) => JSON.parse(fs.readFileSync(path.join(rd, f), 'utf8')));
}
function analyse(mode, scene, filter) {
  const cfg = MODES[mode], runs = load(scene, filter), rows = [];
  for (const r of runs) { const m = cfg.fn(r), g = cfg.gates(m, r); rows.push({ label: r.label.replace(scene + '__', ''), run: r, m, g, key: cfg.key(m), w1: M.slicedW1(r) }); }
  rows.sort((x, y) => (y.g.pass - x.g.pass) || ((isFinite(y.key) ? y.key : -1e9) - (isFinite(x.key) ? x.key : -1e9)));
  return { cfg, rows };
}
if (require.main === module) {
  if (!MODES[mode]) { console.error('modes: ' + Object.keys(MODES).join(' ')); process.exit(1); }
  const { cfg, rows } = analyse(mode, scene, opt('filter', null));
  console.log('# ' + mode + ' on ' + scene + ' — ' + rows.length + ' designs, ranked: gates passed first, then the mode score.  fid = the app\'s fidelity, W1 = sliced Wasserstein (cells)');
  console.log('rank design               fid  onP  W1   score | ' + cfg.head + ' | gates');
  rows.forEach((r, n) => console.log(String(n + 1).padStart(3) + '  ' + r.label.padEnd(20) + pc(r.run.row.fidelity).padStart(4) + pc(r.run.row.onPaint).padStart(5) + f2(r.w1, 1).padStart(5) + f2(r.key, 3).padStart(8) + ' | ' + cfg.cols(r.m).join(' ') + ' | ' + (r.g.pass ? 'pass' : 'VETO ' + r.g.why.join(', '))));
  const ok = rows.filter((r) => isFinite(r.key)); console.log('Spearman(mode score, fidelity) = ' + f2(spear(ok.map((r) => r.key), ok.map((r) => r.run.row.fidelity)), 2) + '   Spearman(mode score, −W1) = ' + f2(spear(ok.map((r) => r.key), ok.map((r) => -r.w1)), 2));
  if (a.includes('--montage')) {
    const n = +opt('n', 3), kinds = (opt('pick', 'best,mid,worst,vetoed')).split(','), imgDir = path.join(dir, 'img'); fs.mkdirSync(imgDir, { recursive: true });
    const vetoed = rows.map((r, i) => [r, i]).filter(([r]) => !r.g.pass).sort((x, y) => (isFinite(y[0].key) ? y[0].key : -1e9) - (isFinite(x[0].key) ? x[0].key : -1e9));
    const pick = { best: rows.map((r, i) => [r, i]).slice(0, n), worst: rows.map((r, i) => [r, i]).slice(-n), mid: rows.map((r, i) => [r, i]).slice(Math.floor(rows.length / 2) - 1, Math.floor(rows.length / 2) - 1 + n), vetoed: vetoed.slice(0, n) };
    for (const kd of kinds) { const p = pick[kd]; if (!p || !p.length) continue; const m = H.montage(p.map(([r]) => r.run), { cols: 3, exposure: +opt('exposure', mode === 'uniformity' ? 1.6 : mode === 'photo' ? 1.3 : 1), numbers: p.map(([r, i]) => (i + 1) + ' ' + Math.round(100 * (isFinite(r.key) ? r.key : 0))) }); const f = path.join(imgDir, mode + '__' + scene + '__' + kd + '.png'); fs.writeFileSync(f, m.png); console.log(f + '  ' + p.map(([r, i]) => '#' + (i + 1) + ' ' + r.label).join(' | ')); }
  }
}
module.exports = { MODES, analyse, load };
