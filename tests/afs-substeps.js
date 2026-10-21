// AFS lighting substeps: RF.DriveAnim.lightingSubsteps advances lightingStep in ~1/60 s substeps (max 12).
const { load } = require('./load.js');
function source(A) { return A.source('road', 3.5, false, {}, { mountainPass: true, seed: 7, speed: 80, trafficLogic: false, trafficDensity: 1 }); }
function manual(A, state, src, x, v, dt, n, afs, cornering) {
  let s = state;
  for (let i = 0; i < n; i++) s = A.lightingStep(s, src, x, v, dt / n, afs, cornering);
  return s;
}
function run(RF, ok) {
  const A = RF.DriveAnim, src = source(A), X = 700, V = 10;
  // 1. dt = 1/60 is exactly one lightingStep call.
  const one = A.lightingStep(null, src, X, V, 1 / 60, true, true);
  const sub1 = A.lightingSubsteps(null, src, X, V, 1 / 60, true, true);
  ok('AFS substeps: dt = 1/60 equals one lightingStep call exactly', sub1.yaw === one.yaw && sub1.left === one.left && sub1.right === one.right);
  // 2. dt = 0.1 is six substeps of dt/6.
  const sub6 = A.lightingSubsteps(null, src, X, V, 0.1, true, true);
  const man6 = manual(A, null, src, X, V, 0.1, 6, true, true);
  ok('AFS substeps: dt = 0.1 gives the same final yaw (1e-9) as 6 calls of dt/6', Math.abs(sub6.yaw - man6.yaw) <= 1e-9 && sub6.yaw !== 0);
  // 3. dt = 1.0 uses 12 substeps and respects the limits.
  const sub12 = A.lightingSubsteps(null, src, X, V, 1.0, true, true);
  const man12 = manual(A, null, src, X, V, 1.0, 12, true, true);
  ok('AFS substeps: dt = 1.0 uses n = 12 (matches 12 calls of dt/12)', Math.abs(sub12.yaw - man12.yaw) <= 1e-9);
  ok('AFS substeps: dt = 1.0 never exceeds AFS_MAX', Math.abs(sub12.yaw) <= A.AFS_MAX + 1e-12);
  ok('AFS substeps: dt = 1.0 total swivel stays within AFS_RATE * dt', Math.abs(sub12.yaw) <= A.AFS_RATE * 1.0 + 1e-12);
  // 4. Split-invariance: one 0.1 s frame vs six 1/60 s frames on a bend at 10 m/s.
  let split = null;
  for (let i = 0; i < 6; i++) split = A.lightingSubsteps(split, src, X, V, 1 / 60, true, true);
  const whole = A.lightingSubsteps(null, src, X, V, 0.1, true, true);
  ok('AFS substeps: 1 x 0.1 s and 6 x 1/60 s agree within 1e-3 rad at 10 m/s', Math.abs(whole.yaw - split.yaw) <= 1e-3);
  // 5. NaN free over a long run with a stall.
  let st = null, finite = true;
  for (let i = 0; i < 400; i++) { st = A.lightingSubsteps(st, src, X + i, V, i % 50 === 0 ? 0.5 : 0.1, true, true); finite &&= [st.yaw, st.left, st.right].every(Number.isFinite); }
  ok('AFS substeps: no NaN over a run with stalls', finite);
  // 6. AFS off: yaw 0, cornering lamps match lightingStep alone.
  const off = A.lightingSubsteps({ yaw: .2, left: 1, right: 1 }, src, X, V, 0.1, false, true);
  const offMan = manual(A, { yaw: .2, left: 1, right: 1 }, src, X, V, 0.1, 6, false, true);
  ok('AFS substeps: afs off gives yaw 0', off.yaw === 0);
  ok('AFS substeps: afs off cornering lamps match lightingStep alone', Math.abs(off.left - offMan.left) <= 1e-12 && Math.abs(off.right - offMan.right) <= 1e-12);
}
module.exports = { run };
if (require.main === module) {
  let fails = 0;
  run(load(), (n, c) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all AFS substep Node checks passed');
  process.exitCode = fails ? 1 : 0;
}
