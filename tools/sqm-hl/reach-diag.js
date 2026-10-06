#!/usr/bin/env node
/* reach-diag.js scene.json [more.json…] — where does the 5 lx reach stop? Prints E (lx) and the intensity along the right and left road edges. */
const { RF, loadScene, judge } = require('./lib.js');
for (const f of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const sc = loadScene(f), { G, ev, ctx, P } = judge(sc, 8e6); const Gw = RF.FarField.build(ctx, P.ffStreams[1]), sh = ev.shift || [0, 0];
  const road = Object.assign(RF.Road.defaults(), sc.modeD.road || {}), conv = sc.modeD.conv || 'A';
  const I = (h, v) => { const r = RF.FarField.intensityAt(Gw, h + sh[0], v + sh[1], 0.25); return r.cd > 0 ? r.cd : 0; };
  const m = RF.Road.model({ road, conv, I }), ii = m.iihs(); console.log('\n' + f.split('/').pop(), 'shift', sh, 'reach', ii.right, ii.left, 'glare', ii.glareMax.toFixed(1));
  for (const [name, y, xs] of [['right', -1.65, [10, 20, 30, 40, 50, 60, 80, 100, 120]], ['left', 4.95, [15, 20, 25, 30, 40, 50, 60, 70]]]) {
    const row = xs.map((x) => { const L = road.two ? [[0, 0.7, 0.65], [0, -0.7, 0.65]] : [[0, -0.7, 0.65]]; const E = m.lux([x, y, 0.25]); const d = [x, y - 0.7, 0.25 - 0.65], hv = RF.FarField.hvOf(d, conv); return `${x}m: ${E.toFixed(1)}lx (${hv[0].toFixed(1)},${hv[1].toFixed(2)}) ${I(hv[0], hv[1]).toFixed(0)}cd`; });
    console.log(name.padEnd(6), row.join(' | '));
  }
}
