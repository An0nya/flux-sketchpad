/* SB2 fixtures only. All solves and photometric measurements go through tools/flux.js. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { RF, makeScene: oldScene } = require('./lab.js');
if (!RF.SealedBeamV2) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../../solvers/sealed-beam-v2.js'), 'utf8'), { filename: 'sealed-beam-v2.js' });
const ID = 'sealed-beam-v2';
function makeScene(lamp, beam, model, over) {
  const sc = oldScene(lamp, beam, { preset: beam === 'low' ? 'fmvss-lb2m' : 'fmvss-ub2' });
  RF.SourcePresets.apply(sc.source, (model === 'h4' ? 'h4-assembly-' : 'sealed-beam-assumed-') + beam);
  // H4 mounting ASSUMED: driving-filament centre at focus. R37 gives the relative filament spacing (6.7 forward, 1.4 up).
  const offset = beam === 'high' ? [0, 0, 0] : model === 'h4' ? [6.7, 0, 1.4] : [0, 1.5, 2.5];
  const pattern = Object.fromEntries(RF.SealedBeamV2.KNOBS.map((k) => [k[0], k[beam === 'high' ? 6 : 5]]));
  const values = Object.assign(pattern, { lamp, beam, sourceModel: model, mount: 'fixed', tune: false, tuneAim: 'frozen', tuneSeconds: 0,
    lowFwd: offset[0], lowLeft: offset[1], lowUp: offset[2], sourceFwd: offset[0], sourceLeft: offset[1], sourceUp: offset[2], sourceAz: model === 'h4' ? 0 : 90, sourceEl: 0, sourceRoll: 0 }, over || {});
  sc.solve = { id: ID }; sc.solverSettings = { [ID]: values };
  const s = RF.Solvers.settingsOf(sc, ID);
  RF.SealedBeamSource.adjustSource(sc, s, ['sourceModel', ...RF.SealedBeamSource.POSE_KEYS.filter((k, i) => s.mount !== 'follow' || i >= 3)]);
  const L = RF.SealedBeamSource.layout({ source: sc.source }, s), x0 = L.vx - 2, x1 = L.xin + 28, R = L.a + 12;
  Object.assign(sc.envelope, { shape: 'cylinder', axis: 0, center: [(x0 + x1) / 2, 0, 0], half: [(x1 - x0) / 2, R, R], keepOut: model === 'h4' ? 0 : 5 });
  sc.target.size = Math.round(RF.Spec.fitTargetSize(sc)); sc.modeA.paint = RF.Spec.seedPaint(sc);
  return sc;
}
module.exports = { RF, ID, makeScene };
