// vertical profile through h = -2.5 as the judge reads it (kernel 0.25 × 0.035), model vs trace, and the log-gradient.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF, judge } = require('./lib.js'); const { makeScene } = require('./scenes.js');
for (const f of ['target', 'plan', 'sqm', 'emit', 'fwd', 'pipeline']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'dev', f + '.js'), 'utf8'), { filename: f + '.js' });
const sc = makeScene('box', { preset: 'ece-r112-b', budget: 100 }); const input = RF.Solvers.inputOf(sc);
const out = RF.SqmPipe.solve(input, { verbose: false, iters: 1, cutPasses: 1 }, { progress() {}, budget: { ms: 1e9 } }); const m = out.best.m;
sc.groups.A.surfaces = out.surfaces; const { G } = judge(sc, 8e6);
const prof = (Gx, name) => { const rows = []; let top = 0; const get = (v) => RF.FarField.intensityAt(Gx, -2.5, v, 0.25, 0.035).cd; for (let v = -1.5; v <= 0.5; v += 0.05) top = Math.max(top, get(v) || 0);
  for (let v = -1.5; v <= 1.5001; v += 0.1) { const a = get(v), b = get(v + 0.1); rows.push(`${v.toFixed(2)}: ${(a || 0).toFixed(0).padStart(6)}  G=${a > 0 && b > 0 ? Math.log10(a / b).toFixed(2) : ' - '}${a < 0.02 * top ? ' (<gate)' : ''}`); } console.log(name, 'scan max', top.toFixed(0), 'cd, gate', (0.02 * top).toFixed(0)); console.log(rows.join('\n')); };
prof(m.gj, 'MODEL'); prof(G, 'TRACE');
