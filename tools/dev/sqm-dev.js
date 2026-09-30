// in-process SQM debugging: node tools/dev/sqm-dev.js scene[,scene] ['{"settings":1}'] [rays]
const path = require('path'), fs = require('fs'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const RF = require(path.join(ROOT, 'tests/load.js')).load();
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'solvers/lab-sqm.js'), 'utf8'));
const scenes = require(path.join(ROOT, 'tools/bench-scenes.js')).all(RF);
const names = (process.argv[2] || 'default').split(','), over = JSON.parse(process.argv[3] || '{}'), RAYS = +(process.argv[4] || 300000);
if (process.env.SQMDBG) globalThis.SQMDBG = +process.env.SQMDBG;
const S = RF.Solvers, def = S.get('sqm');
for (const nm of names) {
  const sc = scenes[nm](); sc.mode = 'A'; sc.solve = { id: 'sqm' };
  const settings = S.sanitize(def, Object.assign(S.defaults(def), { minDistance: 0 }, over));
  if (over.debug) settings.debug = true;
  const t0 = Date.now(); const out = def.solve(S.inputOf(sc), settings, {}); const ms = Date.now() - t0;
  sc.groups.A.surfaces = out.surfaces; sc.sim.seed = 90210;
  const P = RF.Engine.prepare(sc, RF.State.allSurfaces(sc)); const c = RF.Engine.runSync(P, RAYS);
  const fd = RF.Photometry.fidelity(sc, P, c);
  console.log(nm.padEnd(16), 'fid', (100 * fd.fidelity).toFixed(1), 'within', (100 * fd.within).toFixed(1), 'gaps', (100 * fd.gapsDark).toFixed(1), 'onPaint', (100 * fd.onPaint).toFixed(1), 'pred', (100 * out.pred.fid).toFixed(1), '/', (100 * out.pred.onPaint).toFixed(1), 'patches', out.surfaces.length, ms + 'ms');
  if (out.debug && out.debug.truth) console.log('   continuum flux error vs targets (fine lattice):', JSON.stringify(out.debug.truth, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
  if (process.env.SHOW) {                                   // delivered/wanted ratio per painted cell: . <0.5, - <0.8, = within, + <1.25.. , # <2, @ >2 ; ' ' unpainted
    const R = sc.target.res, ra = fd.ratioAt, step = +process.env.SHOW;
    for (let j = R - 1; j >= 0; j -= step) { let s = ''; for (let i = 0; i < R; i += step) { const k = j * R + i, v = ra[k]; s += sc.modeA.paint[k] <= 0 ? (fd.verdict[k] === 3 ? '!' : ' ') : v < 0.5 ? '.' : v < 0.8 ? '-' : v <= 1.25 ? '=' : v < 1.6 ? '+' : v < 2 ? '#' : '@'; } console.log(s); }
  }
  if (process.env.NOTES) console.log(out.notes.join('\n'));
}
