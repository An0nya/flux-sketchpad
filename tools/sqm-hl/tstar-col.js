// T* in the stock judge's cut-off scan column: profile + floors, no optics
const fs = require('fs'), vm = require('vm'), path = require('path');
const { RF } = require('./lib.js'); const { makeScene } = require('./scenes.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'dev', 'target.js'), 'utf8'), { filename: 'target.js' }); const T = RF.SqmTarget;
const name = process.argv[2] || 'box', preset = process.argv[3] || 'ece-r112-b', h = +(process.argv[4] || -2.5);
const sc = makeScene(name, { preset }); const spec = RF.Spec.solverSpec(sc), g = T.grid(spec.window, 0.05, spec.conv), B = T.bands(spec, g, { lo: 1.2, hi: 1.2 });
const D = T.design({ spec, g, B, fluxTarget: 650, gd: 0.34, peakCap: 80000, washCap: 12000, guard: +(process.argv[5] || 0.011) }); const i = g.iOf(h);
console.log('T* column h', h, 'edge', JSON.stringify(D.edge)); for (let v = -1.0; v <= 2.5; v += 0.15) { const j = g.jOf(v), q = j * g.nh + i; console.log(v.toFixed(2).padStart(6), 'T*', D.T[q].toFixed(0).padStart(6), ' lo', B.lo[q].toFixed(0).padStart(5), ' hi', isFinite(B.hi[q]) ? B.hi[q].toFixed(0).padStart(6) : '   inf'); }
