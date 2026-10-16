// Pedestrian gait: legs follow the distance walked (never the clock), and a stopped walker settles into a still pose.
// Uses the app's own functions (RF.DriveAnim.crossingPose / actorPose, RF.Drive.Models.pedestrian / build / foot).
// Run: node tests/ped-gait.js (exits 1 on failure). Also registered in tests/regress-node.js.
function run(RF, ok) {
  const A = RF.DriveAnim, M = RF.Drive.Models, S = M.PERSON_STRIDE, lane = 3.5, edgeR = -lane / 2;
  if (typeof A.crossingPose !== 'function' || typeof A.actorPose !== 'function' || typeof M.pedestrian !== 'function') {
    ok('PG pedestrian functions are exported (crossingPose, actorPose, pedestrian)', false, 'missing: ' + ['crossingPose', 'actorPose'].filter((f) => typeof A[f] !== 'function').concat(typeof M.pedestrian !== 'function' ? ['pedestrian'] : []).join(', '));
    return;
  }
  // 1. The crossing at a red light: the phase advances by (distance walked) / stride within 5 %, at every step
  {
    let worst = 0, steps = 0, prev = null, walked = 0;
    for (let s = 0; s <= 12.0001; s += 0.05) {
      const p = A.crossingPose(lane, edgeR, s);
      if (prev) {
        const dOff = Math.abs(p.off - prev.off), dPhase = (p.motion.distance - prev.motion.distance) / p.motion.stride;
        if (dOff > 1e-9) { steps++; worst = Math.max(worst, Math.abs(dPhase - dOff / S) / (dOff / S)); }
        walked += dOff;
      }
      prev = p;
    }
    ok('PG crossing: leg phase advances by distance/stride within 5 % at every step', steps > 50 && worst < 0.05, 'steps ' + steps + ', worst relative error ' + worst.toExponential(2) + ', walked ' + walked.toFixed(2) + ' m (' + (walked / S).toFixed(2) + ' cycles)');
  }
  // 2. No time term: the same distance gives the same gait and phase at any walking speed or start time
  {
    const mk = (spd, delay) => ({ id: 'x', kind: 'person', ptype: 'hivis', mode: 'cross', s0: 0, off0: 0, ds: 0, doff: -1, spd, delay, len: 8 });
    const a = A.actorPose(mk(0.7, 0), 3), b = A.actorPose(mk(1.3, 4), 4 + 2.1 / 1.3); // slow from t=0 and fast from t=4: both have walked 2.1 m
    const sameDist = Math.abs(a.motion.distance - b.motion.distance) < 1e-9;
    ok('PG same distance, different speed and start time: same motion and leg splay', sameDist && a.motion.state === b.motion.state && a.motion.stride === b.motion.stride && Math.abs(a.gait - b.gait) < 1e-12, 'distance ' + a.motion.distance.toFixed(3) + ' vs ' + b.motion.distance.toFixed(3) + ', gait ' + a.gait.toExponential(3) + ' vs ' + b.gait.toExponential(3));
  }
  // 3. A walker that arrives stops its cycle: after the settle window its pose is constant for 2 s (same nodes)
  {
    const actor = { id: 'x', kind: 'person', ptype: 'dark', mode: 'cross', s0: 0, off0: 0, ds: 0, doff: -1, spd: 1.3, delay: 0, len: 8 }, arrive = 8 / 1.3;
    const nodesAt = (tau) => { const p = A.actorPose(actor, tau); const m = M.build('person', { x: 0, y: p.off, yaw: 0, dir: [0, 1], motion: p.motion, gait: p.gait, ptype: 'dark' }); return { key: Array.from(m.nodes).join(','), state: p.motion.state, gait: p.gait }; };
    const ref = nodesAt(arrive + 0.35); let same = true, worstGait = 0, states = new Set();
    for (let tau = arrive + 0.35; tau <= arrive + 2.35 + 1e-9; tau += 0.1) { const n = nodesAt(tau); if (n.key !== ref.key) same = false; worstGait = Math.max(worstGait, Math.abs(n.gait)); states.add(n.state); }
    ok('PG arrived walker: pose constant across 2 s after the settle window, and standing', same && worstGait === 0 && [...states].join() === 'stand', 'nodes identical: ' + same + ', max |gait| ' + worstGait + ', states ' + [...states].join('/'));
    const mid = A.actorPose(actor, arrive + 0.15).motion; ok('PG settle: blend is half-way at 0.15 s after stopping', Math.abs(mid.blend - 0.5) < 1e-9, 'blend ' + mid.blend);
  }
  // 4. The crosswalk walker (the reported bug): cycle frozen after it reaches the far kerb, pose constant for 2 s
  {
    const at = (sp) => { const p = A.crossingPose(lane, edgeR, sp); const m = M.build('person', { x: 0, y: p.off, yaw: 0, dir: [0, 1], motion: p.motion, gait: p.gait, ptype: 'dark' }); return { key: Array.from(m.nodes).join(','), gait: p.gait, off: p.off, state: p.motion.state }; };
    const ref = at(12.5); let same = true, worstGait = 0, offs = new Set();
    for (let s = 12.5; s <= 14.5 + 1e-9; s += 0.1) { const n = at(s); if (n.key !== ref.key) same = false; worstGait = Math.max(worstGait, Math.abs(n.gait)); offs.add(n.off.toFixed(9)); }
    ok('PG crosswalk walker: after arrival the legs stop and the pose is constant for 2 s', same && worstGait === 0 && offs.size === 1 && at(12.5).state === 'stand', 'nodes identical: ' + same + ', max |gait| ' + worstGait + ', distinct offsets ' + offs.size);
  }
  // 5. Planted feet at the pedestrian stride: stance feet cancel ground travel (as M2 checks for the other gaits)
  {
    const d0 = 0.1 * S, d1 = 0.2 * S, f0 = M.foot('walk', d0 / S, 0, S), f1 = M.foot('walk', d1 / S, 0, S);
    ok('PG planted stance at the pedestrian stride cancels ground travel', f0.stance && f1.stance && Math.abs((f1.x + d1) - (f0.x + d0)) < 1e-12, 'x ' + f0.x.toFixed(4) + ' → ' + f1.x.toFixed(4));
  }
}
module.exports = { run };
if (require.main === module) {
  const { load } = require('./load.js'); const RF = load(); let fails = 0;
  const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
  run(RF, ok);
  console.log(fails ? fails + ' FAILED' : 'all ped-gait checks passed');
  process.exitCode = fails ? 1 : 0;
}
