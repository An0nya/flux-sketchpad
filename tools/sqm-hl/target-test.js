// Does the IDEAL beam pass the judge?  Build T* for a scene's spec, run RF.Spec.evaluate on it (noise-free), print rows and a picture.
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'dev', 'target.js'), 'utf8'), { filename: 'target.js' });
const T = RF.SqmTarget;
const name = process.argv[2] || 'box', preset = process.argv[3] || 'ece-r112-b', flux = +(process.argv[4] || 650);
const sc = makeScene(name, { preset }); const spec = RF.Spec.solverSpec(sc);
const g = T.grid(spec.window, 0.05, spec.conv), B = T.bands(spec, g, { lo: 1.2, hi: 1.2 });
const P = { spec, g, B, fluxTarget: flux, gd: +(process.argv[5] || 0.34), peakCap: +(process.argv[6] || 80000), washCap: +(process.argv[7] || 12000) };
const t0 = Date.now(); const D = T.design(P); console.log('edge', JSON.stringify(D.edge), 'tries', JSON.stringify(D.tries)); console.log(`design ${Date.now() - t0} ms: alpha ${D.alpha.toFixed(3)}, wash ${D.W0.toFixed(0)} cd, flux ${D.flux.toFixed(0)} lm, leftover ${D.leftover.toFixed(0)} lm`);
const t1 = Date.now(); const ev = T.judge(g, D.T, spec); console.log(`judge ${Date.now() - t1} ms: verdict ${ev.verdict} n ${JSON.stringify(ev.n)} aim: ${ev.aim.note} reaim ${JSON.stringify(ev.reaim)}`);
for (const r of ev.rows) console.log(r.verdict.padEnd(7), r.name.padEnd(20), (typeof r.value === 'number' ? r.value.toPrecision(4) : r.value).toString().padStart(10), r.isMin ? '>=' : '<=', typeof r.bound === 'number' ? r.bound.toPrecision(4) : r.bound, ' margin', r.margin !== undefined ? (+r.margin).toFixed(2) : '');
let pk = 0; for (const x of D.T) pk = Math.max(pk, x); console.log('peak', pk.toFixed(0), 'cd');
// picture
const { renderFF } = require('./ffpng.js');
const E = new Float64Array(g.n); for (let q = 0; q < g.n; q++) E[q] = D.T[q] * g.om[q];
const G = T.judgeGrid(g, E); const r = renderFF(RF, G, Object.assign({}, sc.modeD), { ev, label: 'T* ' + name + ' ' + preset, k: 0.1, lo: 50 }); fs.writeFileSync(path.join(__dirname, 'out', `target-${name}-${preset}.png`), r.png); console.log('png out/target-' + name + '-' + preset + '.png');
