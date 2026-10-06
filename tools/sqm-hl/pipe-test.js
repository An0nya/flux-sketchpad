// pipeline test: run RF.SqmPipe.solve on a named scene, then the real tracer.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF, judge } = require('./lib.js'); const { makeScene } = require('./scenes.js');
for (const f of ['target', 'plan', 'sqm', 'emit', 'fwd', 'pipeline']) vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'dev', f + '.js'), 'utf8'), { filename: f + '.js' });
const args = {}; for (let i = 2; i < process.argv.length; i++) { const s = process.argv[i]; if (s.startsWith('--')) args[s.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; }
const name = args.scene || 'box', preset = args.preset || 'ece-r112-b', N = +(args.n || 100);
const sc = args.file ? makeScene('file:' + args.file, { budget: N }) : makeScene(name, { preset, budget: N }); const input = RF.Solvers.inputOf(sc);
const S = { verbose: true }; for (const k of Object.keys(RF.SqmPipe.DEFAULTS)) if (args[k] !== undefined) S[k] = +args[k];
const t0 = Date.now(); const out = RF.SqmPipe.solve(input, S, { progress() {}, budget: { ms: 1e9 } }); const solveMs = Date.now() - t0;
const v = RF.Solvers.verify(sc, { surfaces: out.surfaces });
console.log(`solve ${(solveMs / 1000).toFixed(1)} s, ${out.surfaces.length} facets, best iteration ${out.best.it}; verify: envelope outside ${v.violations.envelope.length}, keepOut ${v.violations.keepOut.length}`);
const row = (r) => `${r.verdict.padEnd(6)} ${r.name.padEnd(18)} ${(+r.value).toPrecision(4).padStart(9)} ${r.isMin ? '>=' : '<='} ${r.bound.toPrecision ? r.bound.toPrecision(4) : r.bound}  m ${r.margin.toFixed(2)}`;
console.log('  MODEL aim:', out.best.m.ev.aim.note, JSON.stringify(out.best.m.ev.reaim)); for (const r of out.best.m.ev.rows.filter((r) => r.verdict !== 'pass')) console.log('  MODEL', row(r));
sc.groups.A.surfaces = out.surfaces; const { G, ev } = judge(sc, +(args.rays || 4e6));
console.log(`TRACE ${ev.verdict} ${JSON.stringify(ev.n)} lm in window ${G.lmWindow.toFixed(0)} aim: ${ev.aim.note} reaim ${JSON.stringify(ev.reaim)}`); for (const r of ev.rows.filter((r) => r.verdict !== 'pass')) console.log('  TRACE', row(r));
const { renderFF } = require('./ffpng.js'); const base = path.join(__dirname, 'out', `pipe-${args.file ? 'file' : name}-${preset}`);
fs.writeFileSync(base + '.png', renderFF(RF, G, sc.modeD, { ev, label: 'pipe ' + name, k: 0.1 }).png); for (const f of sc.groups.A.surfaces) { delete f.aimRef; delete f.aimIndex; delete f.decal; } fs.writeFileSync(base + '.scene.json', RF.State.serialize(sc)); console.log('wrote', base + '.png');
