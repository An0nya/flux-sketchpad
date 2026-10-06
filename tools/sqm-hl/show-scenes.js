const { RF } = require('./lib.js');
const show = (name, sc) => {
  const s = sc.source, e = sc.envelope;
  console.log(`\n== ${name}: mode ${sc.mode}, source ${s.kind}/${s.shape || ''} ${s.w ? s.w + 'x' + s.h : 'r' + s.radius} @ [${s.pos.map((x) => x.toFixed(1))}] axis [${s.axis.map((x) => x.toFixed(3))}] ${s.power} lm dist ${s.dist}${s.preset ? ' preset ' + s.preset : ''}`);
  console.log(`   envelope ${e.shape} center [${e.center.map((x) => x.toFixed(1))}] half [${e.half.map((x) => x.toFixed(1))}] keepOut ${e.keepOut}; target dist ${sc.target.distance} size ${sc.target.size}; budget ${sc.modeA.budget}; refl ${sc.modeA.reflectivity}`);
  const d = e.center.map((c, i) => s.pos[i] - c);
  console.log(`   source offset from envelope centre [${d.map((x) => x.toFixed(1))}]`);
};
show('defaultScene()', RF.State.defaultScene());
show('testScene()', RF.State.testScene());
for (const f of Object.keys(RF.Spec.FIXTURES)) { const sc = RF.State.defaultScene(); sc.mode = 'D'; RF.Spec.applyFixture(sc, f); show('fixture ' + f, sc); }
