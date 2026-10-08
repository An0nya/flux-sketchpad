#!/usr/bin/env node
// hot.js <thresholdCd> <rays> scene.json ... : width of the >= threshold hotspot in a traced far field (box-smoothed 0.4 deg), at the judge's own grid
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js');
const T = +process.argv[2], N = +process.argv[3];
for (const f of process.argv.slice(4)) {
  const sc = RF.State.deserialize(fs.readFileSync(f, 'utf8')); const { G, ev } = judge(sc, N);
  const K = 0.4, st = 0.1, grid = [], hs = [], vs = [];
  for (let h = -10; h <= 10.0001; h += st) hs.push(+h.toFixed(3)); for (let v = -6; v <= 4.0001; v += st) vs.push(+v.toFixed(3));
  let pk = 0, pi = 0, pj = 0;
  for (let j = 0; j < vs.length; j++) { grid.push([]); for (let i = 0; i < hs.length; i++) { const r = RF.FarField.intensityAt(G, hs[i], vs[j], K); const c = isFinite(r.cd) ? r.cd : 0; grid[j].push(c); if (c > pk) { pk = c; pi = i; pj = j; } } }
  const run = (row, i0, thr) => { let a = i0, b = i0; while (a > 0 && row[a - 1] >= thr) a--; while (b < row.length - 1 && row[b + 1] >= thr) b++; return [hs[a], hs[b]]; };
  let widest = [0, 0, 0], area = 0, vmin = 99, vmax = -99;
  for (let j = 0; j < vs.length; j++) { let a = null, b = null; for (let i = 0; i < hs.length; i++) if (grid[j][i] >= T) { area++; if (a === null) a = i; b = i; vmin = Math.min(vmin, vs[j]); vmax = Math.max(vmax, vs[j]); } if (a !== null && hs[b] - hs[a] > widest[2]) widest = [hs[a], hs[b], hs[b] - hs[a]]; }
  const rp = pk >= T ? run(grid[pj], pi, T) : [0, 0];
  console.log(`${f.split('/').pop().replace('.scene.json', '').padEnd(26)} peak ${Math.round(pk).toString().padStart(6)} @ (${hs[pi].toFixed(1)},${vs[pj].toFixed(1)})  >=${T}: row-of-peak h ${rp[0].toFixed(1)}..${rp[1].toFixed(1)} (${(rp[1] - rp[0]).toFixed(1)} wide) | widest row ${widest[0].toFixed(1)}..${widest[1].toFixed(1)} (${widest[2].toFixed(1)}) | v ${vmin.toFixed(1)}..${vmax.toFixed(1)} | area ${(area * st * st).toFixed(1)} deg2 | pass ${ev.n.pass}/${ev.n.fail}/${ev.n.unsure}`);
}
