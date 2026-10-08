#!/usr/bin/env node
// merge-traces.js — attach koef3 chart traces (traces.json) to KOEF3_2PT in js/source-presets.js, as each entry's `tr` field.
// Picks, per preset, the trace closest to koef3's quoted text points (raw tables preferred), and a luminance table whose CCT agrees.
// Rerunnable: replaces any existing `tr`.  Usage: node tools/source-specs/koef3/merge-traces.js [--write]
'use strict';
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, '..', '..', '..', 'js', 'source-presets.js'), src = fs.readFileSync(F, 'utf8');
const m = src.match(/const KOEF3_2PT = (\[.*?\]);\n/s), K = JSON.parse(m[1]);
const D = require('./traces.json');
const ip = (pts, x, c) => { pts = pts.filter((p) => p[c] != null); if (x < pts[0][0]) return c === 1 ? x / pts[0][0] * pts[0][1] : NaN;
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0] + 1e-9) { const a = pts[i - 1], b = pts[i], t = (x - a[0]) / (b[0] - a[0]); return a[c] + t * (b[c] - a[c]); } return NaN; };
const cct = (s) => (s.match(/(\d{4})\s?K/) || [])[1];
for (const k of K) {
  delete k.tr;
  const t = k.id.replace('k3-', '').replace(/-\d$/, ''), rs = D.filter((r) => r.thread_id === t);
  let best = null;
  for (const r of rs.filter((r) => r.chart_kind !== 'luminance_table_image')) {
    const e = k.pts.map((p) => ip(r.readings, p[0], 1) / p[1] - 1).filter(Number.isFinite);
    const sc = (e.length ? e.reduce((s, x) => s + Math.abs(x), 0) / e.length : 9) - (r.chart_kind === 'raw_table_text' ? 0.005 : 0);
    if (!best || sc < best.sc) best = { sc, r, e };
  }
  if (!best) { console.log(k.id, 'no trace — stays 2-pt'); continue; }
  const flux = best.r.readings.filter((p) => p[1] != null).map((p) => [p[0], p[1]]);
  const vf = best.r.readings.filter((p) => p[2] != null).map((p) => [p[0], p[2]]);
  const q = k.pts[k.pts.length - 1], end = flux[flux.length - 1];
  if (q[0] > end[0] && q[1] >= 0.97 * end[1]) { flux.push([q[0], q[1]]); vf.push([q[0], q[2]]); }   // his own max point, just past the traced end
  const want = cct(best.r.led_name) || cct(k.label);
  const lums = rs.filter((r) => r.chart_kind === 'luminance_table_image' && (!want || !cct(r.led_name) || cct(r.led_name) === want));
  const lum = lums.length === 1 ? lums[0].readings : null;
  k.tr = { flux, vf, lum, from: best.r.chart_kind === 'raw_table_text' ? 'table' : 'chart', name: best.r.led_name,
    err: +(best.e.length ? Math.max(...best.e.map(Math.abs)) * 100 : NaN).toFixed(1), note: best.r.problems && best.r.problems !== 'none' ? best.r.problems : '' };
  console.log(k.id.padEnd(12), k.tr.from.padEnd(5), String(flux.length).padStart(2), 'pts  max |Δ| vs quoted', String(k.tr.err).padStart(5) + '%', ' lum', lum ? lums[0].led_name.slice(0, 34) : (lums.length ? 'AMBIGUOUS ' + lums.length : '—'));
}
if (process.argv.includes('--write')) { fs.writeFileSync(F, src.replace(m[1], JSON.stringify(K))); console.log('written'); }
