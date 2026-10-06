const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
for (const f of ['target', 'plan', 'sqm', 'emit', 'fwd', 'pipeline']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'dev', f + '.js'), 'utf8'), { filename: f + '.js' });
const sc = makeScene('box', { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const out = RF.SqmPipe.solve(input, { verbose: false, iters: 0, polishRounds: 0, cutPasses: 1 }, { progress() {}, budget: { ms: 1e9 } });
const P = out.P, Df = out.Df, on = out.on, x = out.best.x, S = P.S; const rowv = (m, n) => (m.ev.rows.find((r) => r.name === n) || {}).value;
const run = (label) => { const f = RF.SqmPipe.buildFacets(P, Df, on, x), m = RF.SqmPipe.evaluate(P, f, Df, on); console.log(label.padEnd(26), f.length, 'facets', m.ev.verdict, JSON.stringify(m.ev.n), '75R', (+rowv(m, '75R')).toFixed(0), 'ZIII', (+rowv(m, 'Zone III')).toFixed(0), 'G', (+rowv(m, 'Cut-off sharpness')).toFixed(3), 'window lm', m.Et.reduce((a, b) => a + b, 0).toFixed(0)); return m; };
run('repeat 1'); run('repeat 2');
for (const es of [0.05, 0.1, 0.2, 0.3, 0.5]) { S.edgeSoft = es; run('edgeSoft ' + es); }
S.edgeSoft = 0.2; for (const sa of [0.0, 0.1, 0.22, 0.35]) { S.softAll = sa; run('softAll ' + sa); }
S.softAll = 0.22; for (const mf of [1.0, 1.25, 1.5, 2.0]) { S.mainFill = mf; run('mainFill ' + mf); }
// who makes Zone III's worst pixel?
S.edgeSoft = 0.2; S.softAll = 0.22; S.mainFill = 1.5;
const f = RF.SqmPipe.buildFacets(P, Df, on, x), m = RF.SqmPipe.evaluate(P, f, Df, on), g = P.g;
const row = m.ev.rows.find((r) => r.name === 'Zone III'); console.log('Zone III worst at', JSON.stringify(row.at), 'value', row.value.toFixed(0));
const ih = g.iOf(row.at[0] + (m.ev.shift ? m.ev.shift[0] : 0)), jv = g.jOf(row.at[1] + (m.ev.shift ? m.ev.shift[1] : 0)); console.log('shift', JSON.stringify(m.ev.shift)); const q = jv * g.nh + ih;
const contrib = f.map((ff, k) => { const fp = m.fld.fps[k]; let v = 0; for (let t = 0; t < fp.idx.length; t++) if (fp.idx[t] === q) v = fp.val[t] / g.om[q]; return { k, v, a: ff.aimRef, ff }; }).filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
console.log('direct', (m.Ed[q] / g.om[q]).toFixed(0), 'cd; facets contributing:'); for (const c of contrib.slice(0, 6)) console.log(`  ${c.ff.id}${c.ff.decal ? '(decal)' : ''}: ${c.v.toFixed(0)} cd; aim (${c.a.h.toFixed(2)}, ${c.a.v.toFixed(2)}) ${c.a.tier} share ${c.a.g.toFixed(1)} lm, image σ (${Math.sqrt(m.fld.fps[c.k].cov[0]).toFixed(2)}, ${Math.sqrt(m.fld.fps[c.k].cov[2]).toFixed(2)})°`);
// brute force replica of the zone III reading
{ const it = P.spec.items.find((x) => x.name === 'Zone III'), sh = m.ev.shift, k = P.spec.kernel; let best = { cd: 0 };
  for (let v = -1; v <= 5; v += 0.05) for (let h = -9; h <= 9; h += 0.05) { if (!RF.Spec.inPoly(it.poly, h, v)) continue; const r = RF.FarField.intensityAt(m.gj, h + sh[0], v + sh[1], k); if (r.cd > best.cd) best = { cd: r.cd, h, v }; }
  console.log('brute-force max in Zone III (reading at +shift):', JSON.stringify(best), '(row says', row.value.toFixed(0), 'at', JSON.stringify(row.at), ')');
  const q2 = g.jOf(best.v + sh[1]) * g.nh + g.iOf(best.h + sh[0]);
  const c2 = f.map((ff, kk) => { const fp = m.fld.fps[kk]; let v = 0; for (let t = 0; t < fp.idx.length; t++) if (fp.idx[t] === q2) v = fp.val[t] / g.om[q2]; return { kk, v, ff, a: ff.aimRef }; }).filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
  console.log('direct', (m.Ed[q2] / g.om[q2]).toFixed(0), 'cd; contributors:', c2.slice(0, 5).map((c) => `${c.ff.id}${c.ff.decal ? 'd' : ''} ${c.v.toFixed(0)}cd aim(${c.a.h.toFixed(1)},${c.a.v.toFixed(1)}) ${c.a.tier}`).join(' | ')); }
