// EA: eye adaptation (adapt-mode exposure easing), headless. Node tests/eye-adapt.js — exits 1 on any failure.
// Real function: RF.Drive.adaptStep(state, target, dt). Domain: log2 of the gain k (stops).
const { load } = require('./load.js'); const RF = load(); const D = RF.Drive;
let fails = 0, n = 0; const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const L2 = (k) => Math.log2(k);

// run a step from state k0 toward target for `secs` of sim time at `fps`; returns the k reached
function run(k0, target, secs, fps) {
  let st = { k: k0 }; const dt = 1 / fps, steps = Math.round(secs * fps);
  for (let i = 0; i < steps; i++) st = D.adaptStep(st, target, dt);
  return st.k;
}
// fraction of the way from start to end, in stops
const frac = (start, end, now) => (L2(now) - L2(start)) / (L2(end) - L2(start));

ok('constants: darkening 0.4 s, brightening 3 s', D.ADAPT_DOWN_S === 0.4 && D.ADAPT_UP_S === 3, { down: D.ADAPT_DOWN_S, up: D.ADAPT_UP_S });

// step response: 63% (1 - 1/e) of the way at tau, in each direction
const down = run(1, 0.2, D.ADAPT_DOWN_S, 120), upk = run(0.2, 1, D.ADAPT_UP_S, 120);
const fDown = frac(1, 0.2, down), fUp = frac(0.2, 1, upk);
ok('darkening reaches ~63% of the stop-step at tau = 0.4 s', near(fDown, 1 - Math.exp(-1), 0.005), { fraction: +fDown.toFixed(4) });
ok('brightening reaches ~63% of the stop-step at tau = 3 s', near(fUp, 1 - Math.exp(-1), 0.005), { fraction: +fUp.toFixed(4) });
const dAt04 = frac(1, 0.2, run(1, 0.2, 0.4, 120)), uAt04 = frac(0.2, 1, run(0.2, 1, 0.4, 120));
ok('after 0.4 s darkening has covered ~63% and brightening only ~12.5% (1 - e^(-0.4/3))', near(dAt04, 1 - Math.exp(-1), 0.005) && near(uAt04, 1 - Math.exp(-0.4 / 3), 0.005), { darkening: +dAt04.toFixed(4), brightening: +uAt04.toFixed(4) });

// the round trip 1 -> 0.2 -> 1 settles and passes back through the start
let k = 1; const trace = [];
for (let i = 0; i < 120 * 17; i++) { k = D.adaptStep({ k }, i < 120 * 1.5 ? 0.2 : 1, 1 / 120).k; trace.push(k); }   // recovery needs ~13 s (3 s tau) to settle
const mid = trace[120 * 1.5 - 1], end = trace[trace.length - 1];
ok('round trip: darkens toward 0.2 under glare, then recovers toward 1 after it leaves', mid < 0.5 && end > 0.95, { atGlare: +mid.toFixed(3), recovered: +end.toFixed(3) });

// frame-rate independence: 30 vs 120 fps agree (same sim time)
for (const [name, a, b, tgt] of [['darkening', 1, 0.2, 0.2], ['brightening', 0.2, 1, 1]]) {
  const x30 = run(a, b, 1.0, 30), x120 = run(a, b, 1.0, 120), x60 = run(a, b, 1.0, 60);
  const rel = Math.abs(L2(x30) - L2(x120));
  ok('frame rate independence (' + name + '): 30 fps and 120 fps agree at 1 s', rel < 0.01, { x30: +x30.toFixed(5), x120: +x120.toFixed(5), x60: +x60.toFixed(5), stops: +rel.toFixed(5) });
}

// snap: no state, or a seek (dt beyond ADAPT_SEEK_S), or negative dt, jumps to target
ok('snap on first frame (no state): no fade-in on load', D.adaptStep(null, 0.2, 0).k === 0.2 && D.adaptStep(null, 1, 1 / 30).k === 1);
ok('snap on a seek (dt > ADAPT_SEEK_S)', D.adaptStep({ k: 1 }, 0.2, D.ADAPT_SEEK_S + 0.01).k === 0.2);
ok('snap when sim time goes backwards (dt < 0)', D.adaptStep({ k: 1 }, 0.2, -0.05).k === 0.2);

// paused: dt = 0 holds the state exactly, whatever the target is
ok('paused (dt = 0) holds the state, does not move toward target', D.adaptStep({ k: 0.7 }, 0.2, 0).k === 0.7 && D.adaptStep({ k: 0.7 }, 1, 0).k === 0.7);

// no-op: at a steady target the state stays on it
ok('steady target: state stays at target', near(run(0.5, 0.5, 2, 60), 0.5, 1e-12));

console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' eye-adapt checks passed');
process.exit(fails ? 1 : 0);
