#!/usr/bin/env node
/* cut-profile.js scene.json [h=-2.5] — the stock judge's cut-off scan column: I(v) and the log-step per 0.1° the judge ranks (top 6 steps highlighted). */
const { RF, loadScene, judge } = require('./lib.js');
const f = process.argv[2], h = +(process.argv[3] || -2.5), sc = loadScene(f), { G, ev } = judge(sc, +(process.argv[4] || 8e6));
const kv = Math.max(G.step / 2, 0.035) * 0.99, rows = []; let top = 0;
for (let v = -3.57; v <= 2.43 + 1e-9; v += 0.05) { const a = RF.FarField.intensityAt(G, h, v, 0.25, kv); if (a.cd > top) top = a.cd; }
for (let v = -3.57; v + 0.1 <= 2.43 + 1e-9; v += 0.05) { const a = RF.FarField.intensityAt(G, h, v, 0.25, kv), b = RF.FarField.intensityAt(G, h, v + 0.1, 0.25, kv); const ok = a.cd > 0 && b.cd > 0 && a.cd >= 0.02 * top; rows.push({ v: +(v + 0.05).toFixed(2), a: a.cd, b: b.cd, g: ok ? Math.log10(a.cd / b.cd) : null }); }
const rank = rows.filter((r) => r.g !== null).sort((x, y) => y.g - x.g).slice(0, 6).map((r) => r.v);
console.log(f.split('/').pop(), 'column h', h, 'top', top.toFixed(0), 'judge aim note:', ev.aim.note, 'shift', ev.shift.map((x) => +x.toFixed(2)));
console.log('top gradient positions:', rank.join(', '));
for (const r of rows) if (r.v > -1.6 && r.v < 1.0 && Math.round(r.v * 100) % 10 === 0 || rank.includes(r.v)) console.log(String(r.v).padStart(6), r.a.toFixed(0).padStart(7), r.g === null ? '   (gated)' : r.g.toFixed(3).padStart(8), rank.includes(r.v) ? ' <= top' : '');
