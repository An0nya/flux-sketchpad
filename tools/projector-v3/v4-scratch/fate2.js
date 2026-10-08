// fate2.js <scene.json> [nRays]: where each class of ray ends. Samples rays of the judged trace (retrace), groups by FIRST surface touched
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js');
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); const N = +(process.argv[3] || 40000); sc.sim.bounces = Math.max(sc.sim.bounces || 3, 6);
const { P } = judge(sc, 2e5); const metas = P.G.metas, pw = sc.source.power;
const grp = (id) => /p3_ellipsoid_(UL|UR)/.test(id) ? 'upper quadrants' : /p3_ellipsoid_(LL|LR)/.test(id) ? 'lower quadrants' : /strip/.test(id) ? 'strip' : /shield/.test(id) ? 'shield' : /lens/.test(id) ? 'lens' : id;
const T = {}; const add = (g, f, n = 1) => { T[g] = T[g] || { n: 0 }; T[g].n += n; T[g][f] = (T[g][f] || 0) + n; };
for (let i = 0; i < N; i++) {
  const p = RF.Engine.retrace(P, i), ks = p.ks, first = ks.length ? grp(metas[ks[0]].id) : 'none (touched nothing)';
  let fate; const last = ks.length ? grp(metas[ks[ks.length - 1]].id) : '';
  if (p.end === 'target') fate = 'lands on the 25 m target';
  else if (p.end === 'escape') { const n = p.length, a = [p[n - 2][0] ?? p[3 * (n / 3 | 0) - 3], 0]; fate = 'escapes'; const q = Array.isArray(p[0]) ? p : null; let dx, dy; if (q) { dx = q[q.length - 1][0] - q[q.length - 2][0]; dy = q[q.length - 1][1] - q[q.length - 2][1]; } else { const m = p.length; dx = p[m - 3] - p[m - 6]; dy = p[m - 2] - p[m - 5]; } const ang = Math.atan2(Math.abs(dy), dx) * 180 / Math.PI; fate = dx < 0 ? 'escapes backwards' : ang > 11 ? (ang > 25 ? 'escapes forward beyond 25° sideways' : 'escapes forward 11-25° sideways') : 'escapes forward within 11° (misses target plane)'; }
  else if (p.end === 'absorb') fate = last === 'shield' ? 'absorbed by the shield' : 'absorbed by ' + last;
  else fate = 'other (' + p.end + ')';
  add(first, fate);
}
for (const [g, o] of Object.entries(T).sort((a, b) => b[1].n - a[1].n)) { console.log(`${g.padEnd(26)} ${(o.n / N * 100).toFixed(1).padStart(5)} % of emitted (${Math.round(o.n / N * pw)} lm)`); for (const [f, n] of Object.entries(o).filter(([k]) => k !== 'n').sort((a, b) => b[1] - a[1])) console.log(`      ${f.padEnd(52)} ${(n / N * 100).toFixed(1).padStart(5)} % (${Math.round(n / N * pw)} lm)`); }
