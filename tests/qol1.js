// QOL1: motion integrates distance as well as speed; driver choices stay fixed for both lamps and every frame.
function run(RF, ok) {
  const M = RF.DriveGame, D = RF.Drive, A = RF.DriveAnim;
  const motion = M.cruiseMotion(0, 1, false, false, 20, true);
  ok('QOL1 gentle recovery: 2.5 m/s after 1s, 1.25m travelled', Math.abs(motion.v - 2.5) < 1e-9 && Math.abs(motion.dx - 1.25) < 1e-9, JSON.stringify(motion));
  const capped = M.cruiseMotion(19, 2, false, false, 20, true);
  ok('QOL1 acceleration ends at cruise without overshooting distance', capped.v === 20 && Math.abs(capped.dx - 39.8) < 1e-9);
  const g = M.create({ seed: 7, speed: 72, acceleration: 'gentle' }); g.next = 1e9; g.v = 0; g.resume = 0;
  M.step(g, 1, 3.5);
  const pitch = A.pitchStep(null, g.v, 1);
  ok('QOL1 game resumes through fixed steps; P2 pitch follows actual bounded acceleration', Math.abs(g.v - 2.5) < 1e-8 && Math.abs(g.x - 1.25) < 1e-8 && pitch.angle > 0 && pitch.angle < Math.PI / 180, JSON.stringify({ v: g.v, x: g.x, pitch: pitch.angle }));
  const held = M.create({ seed: 7, speed: 72, acceleration: 'gentle' }); held.next = 1e9; held.v = 0; held.resume = 3;
  M.step(held, 2, 3.5); ok('QOL1 waiting after stop cannot accelerate early', held.v === 0 && held.x === 0);
  const legacy = M.create({ seed: 7, speed: 72 }); legacy.next = 1e9; legacy.v = 0; legacy.resume = 0; M.step(legacy, M.STEP, 3.5);
  ok('QOL1 original recovery remains default', legacy.v === 20);
  const choices = Array.from({ length: 1000 }, (_, i) => D.dipState(7, 'oncoming:' + i, 500)), forgetful = choices.filter(c => c.forgetful).length;
  ok('QOL1 seeded dip distances stay 150–400m, some drivers forget', choices.every(c => c.at >= 150 && c.at <= 400) && forgetful > 0 && forgetful < 100, JSON.stringify({ forgetful, sample: choices.slice(0, 3) }));
  const id = choices.findIndex(c => !c.forgetful), c = choices[id], ob = { x: 80, y: 3.5, z: .68, nx: -1, ny: 0, traffic: 'oncoming:' + id };
  ok('QOL1 smooth short switch: high above threshold, half at threshold, dipped below', D.dipState(7, ob.traffic, c.at + 5).high === 1 && D.dipState(7, ob.traffic, c.at).high === .5 && D.dipState(7, ob.traffic, c.at - 5).high === 0);
  const low = D.Headlamp.cd(ob, { mode: 'generic' }), dip = D.Headlamp.cd(ob, { mode: 'high-dip', seed: 7 }), high = D.Headlamp.cd(ob, { mode: 'high' });
  ok('QOL1 close oncoming driver dips; static high mode remains brighter', low === dip && high > low, JSON.stringify({ low, dip, high }));
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; }); console.log(fails ? fails + ' FAILED' : 'all QOL1 Node checks passed'); process.exitCode = fails ? 1 : 0; }
