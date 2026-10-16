// GR: pure checks for dynamic-resolution back-off (no browser). Simulated frame times, summed as the clock.
function simulate(D, cost, seconds, from = D.resolutionState(), opts = {}) {
  let s = from, ms = 0, changes = [], last = s.scale, n = 0;
  while (ms < seconds * 1000) {
    const c = typeof cost === 'function' ? cost(s.scale, ms) : cost[s.scale], t = c * (1 + 0.04 * Math.sin(n++ * 1.7));       // ±4 % deterministic jitter
    s = D.resolutionStep(s, t, Object.assign({ enabled: true }, opts)); ms += t;
    if (s.scale !== last) { changes.push([Math.round(ms), s.scale]); last = s.scale; }
  }
  return { s, changes, ms };
}
function run(RF, ok) {
  const D = RF.DriveAnim;
  // heavy CPU scene: 0.55 runs fast enough to step up, 0.7 is too slow to stay: the controller bounces between them
  const heavy = { 1: 120, 0.85: 80, 0.7: 45, 0.55: 21, 0.4: 12 };
  const warm = simulate(D, heavy, 60), window = (r, a, b) => r.changes.filter(c => c[0] >= a * 1000 && c[0] < b * 1000).length;
  const long = simulate(D, heavy, 600);
  let worst = 0; for (let a = 60; a + 60 <= 600; a += 10) worst = Math.max(worst, window(long, a, a + 60));
  ok('GR heavy steady load: ≤2 scale changes in any 60 s window after the 60 s warm-up (worst ' + worst + ', warm-up ' + warm.changes.length + ')', worst <= 2);
  ok('GR back-off doubles the step-up wait per bounce and caps it', long.s.hold >= 30000 && long.s.hold <= 240000);
  // load drops: scene gets light after the controller has backed off; it must still climb back to 1
  const light = { 1: 20, 0.85: 18, 0.7: 15, 0.55: 12, 0.4: 10 };
  const mixed = simulate(D, (sc, t) => t < 300000 ? heavy[sc] : light[sc], 700);
  ok('GR recovery after load drops (final scale ' + mixed.s.scale + ', changes ' + JSON.stringify(mixed.changes.slice(-5)) + ')', mixed.s.scale === 1);
  const recoveredAt = (mixed.changes.find(c => c[0] > 300000 && c[1] === 1) || [Infinity])[0];
  ok('GR recovery within 6 min of the load dropping (' + Math.round((recoveredAt - 300000) / 1000) + ' s)', recoveredAt - 300000 < 360000);
  // a single genuine step-up with no bounce is unchanged and leaves no wait behind
  let s = D.resolutionState(); for (let i = 0; i < 12; i++) s = D.resolutionStep(s, 100, { enabled: true });
  for (let i = 0; i < 200; i++) s = D.resolutionStep(s, 10, { enabled: true });
  ok('GR no bounce, no hold: first step-up still takes ~80 frames, hold stays 0', s.scale >= 0.85 && s.hold === 0 && s.holdUntil === 0);
  // stable 30 s after a step-up clears the back-off
  let b = D.resolutionState(); b.hold = 120000; b.upAt = b.clock = 100000; b.holdUntil = 0; b.index = 1; b.scale = 0.85;
  for (let i = 0; i < 1100; i++) b = D.resolutionStep(b, 30, { enabled: true });
  ok('GR 30 s stable after a step-up resets the hold', b.hold === 0);
  ok('GR old saved states without the new fields still step', D.resolutionStep({ scale: 1, index: 0, slow: 5, fast: 0, cooldown: 0, average: 100 }, 100, { enabled: true }).scale === 0.85);
}
module.exports = { run, simulate };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (n, c) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n); if (!c) fails++; }); console.log(fails ? fails + ' FAILED' : 'all GR Node checks passed'); process.exitCode = fails ? 1 : 0; }
