#!/usr/bin/env node
'use strict';
// Beam-quality report over every saved 8 M result: node tools/spec-hl-v3/quality.js [--seed 1] → docs/spec-hl-v3/quality.{json,md}
// Reads each design's plot JSON (the judged-aim beam, ±25° × 10D…5U, 0.25° × 0.125°), so lumen shares are within that window.
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('../../tests/load.js'); const RF = load(); const Q = RF.BeamQuality;
const arg = process.argv.indexOf('--seed'), seed = arg > 0 ? process.argv[arg + 1] : '1';
const B = path.join(ROOT, 'bench-out/spec-hl-v3'), win = { h0: -25, h1: 25, v0: -10, v1: 5 }, rows = [];
const dirs = []; for (const d of fs.readdirSync(B)) { const p = path.join(B, d); if (!fs.statSync(p).isDirectory()) continue;
  if (fs.existsSync(path.join(p, 'plot-8000000-' + seed + '.json'))) dirs.push([d, p]);
  else for (const e of fs.readdirSync(p)) { const q = path.join(p, e); if (fs.statSync(q).isDirectory() && fs.existsSync(path.join(q, 'plot-8000000-' + seed + '.json'))) dirs.push([d + '/' + e, q]); } }
for (const [name, p] of dirs.sort()) {
  const plot = JSON.parse(fs.readFileSync(path.join(p, 'plot-8000000-' + seed + '.json'))), res = JSON.parse(fs.readFileSync(path.join(p, 'result-8000000-' + seed + '.json')));
  if (res.harnessVersion !== 2) continue;
  const I = (h, v) => { const i = Math.round((h - plot.h[0]) / 0.25), j = Math.round((v - plot.v[0]) / 0.125); return (plot.cd[j] && plot.cd[j][i]) || 0; };
  const q = Q.measure(I, win), c = res.curves || [], cd = (R, dir) => { const x = c.find((k) => k.R === R && k.dir === dir); return x ? x.d : null; };
  const dem = (res.road.demerits ? res.road.demerits.right + res.road.demerits.left : 0) + c.reduce((s, k) => s + (k.demerits || 0), 0);
  rows.push({ case: name, scene: res.name, preset: res.preset, solver: res.solver, tag: name.includes('/') ? name.split('/')[0] : '',
    n: res.n, lm: Math.round(res.lmWindow), straight: [res.road.farRight, res.road.farLeft], curves: { R250: cd(250, 'right'), L250: cd(250, 'left'), R150: cd(150, 'right'), L150: cd(150, 'left') }, iihsDemerits: +dem.toFixed(2), quality: q });
}
fs.writeFileSync(path.join(ROOT, 'docs/spec-hl-v3/quality.json'), JSON.stringify(rows, null, 1));
const f1 = (x) => (x == null ? '–' : (+x).toFixed(1)), f0 = (x) => (x == null ? '–' : Math.round(x)), pc = (x) => Math.round(100 * x) + '%';
const L = ['| scene | spec | solver | P/F/U | lm | straight R/L m | curves 250R/250L/150R/150L m | IIHS visibility demerits | width ⅓/¼/⅕ ° | height ¼ ° | lobes | stray | roughness | holes | fg peak | fg lm |', '|' + '---|'.repeat(16)];
for (const r of rows) { const q = r.quality, c = q.core || {}; L.push('| ' + [r.scene, r.preset.replace('-lb2v', '').replace('-r112-b', ''), r.solver + (r.tag ? ' (' + r.tag + ')' : ''), r.n.pass + '/' + r.n.fail + '/' + r.n.unsure, r.lm, r.straight.join('/'), [r.curves.R250, r.curves.L250, r.curves.R150, r.curves.L150].map(f0).join('/'), r.iihsDemerits,
  q.empty ? 'empty' : ['1/3', '1/4', '1/5'].map((k) => f0(c[k] && c[k].width)).join('/'), q.empty ? '–' : f1(c['1/4'].height), q.empty ? '–' : q.lobes.length, q.empty ? '–' : q.stray.ratio.toFixed(2), q.empty ? '–' : q.roughness.toFixed(2), q.empty ? '–' : pc(q.holes), q.empty ? '–' : q.foreground.peakRatio.toFixed(2), q.empty ? '–' : pc(q.foreground.lmShare)].join(' | ') + ' |'); }
fs.writeFileSync(path.join(ROOT, 'docs/spec-hl-v3/quality.md'), '# Beam quality, seed ' + seed + ', 8 M rays\n\nWindow ±25° × 10D…5U at the judged aim. IIHS demerits = straight right + left + four curves (lower is better). Report only, not part of any verdict.\n\n' + L.join('\n') + '\n');
console.log(rows.length + ' designs');
