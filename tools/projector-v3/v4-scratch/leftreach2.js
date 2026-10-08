// leftreach.js <rays> scene.json ...: illuminance (lx) at the IIHS LEFT-edge sensor (4.95 m left, 0.25 m up) at several distances, the farthest distance reaching 5 lx, and the official reach
const fs = require('fs'); const { RF, judge } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js');
const N = +process.argv[2]; const D = [15, 20, 25, 30, 40, 60];
for (const f of process.argv.slice(3)) {
  const sc = RF.State.deserialize(fs.readFileSync(f, 'utf8')); const { ev, ctx, P } = judge(sc, N); const Gw = RF.FarField.build(ctx, P.ffStreams[1]), sh = ev.shift || [0, 0];
  const road = Object.assign(RF.Road.defaults(), sc.modeD.road || {}), m = RF.Road.model({ road, conv: sc.modeD.conv || 'A', I: (h, v) => { const r = RF.FarField.intensityAt(Gw, h + sh[0], v + sh[1], 0.25); return r.cd > 0 ? r.cd : 0; } });
  const E = (x) => m.lux([x, 4.95, 0.25]); const ii = m.iihs(); let far = 0; for (let x = 6; x <= 120; x += 1) if (E(x) >= 5) far = x;
  console.log(f.split('/').pop().replace('.scene.json', '').padEnd(24), 'pass/fail/unsure', ev.n.pass + '/' + ev.n.fail + '/' + ev.n.unsure, 'lm', Math.round(Gw.lmWindow), '|', 'E(lx) at', D.map((d) => d + 'm:' + E(d).toFixed(1)).join(' '), '| farthest >=5 lx:', far, 'm | official left reach', ii.left, 'm | right', ii.right);
}
