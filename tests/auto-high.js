// AH: auto high beam, headless. Node tests/auto-high.js — exits 1 on any failure.
// Real functions: RF.Drive.autoHighSense (camera sensor, uses occluded) and RF.Drive.autoHighStep (hysteresis state machine).
// POSITIVE CONTROL: AH_HYST=0 sets the hold to 0 (no hysteresis). The "returns high only after 2 s" check must then FAIL.
const { load } = require('./load.js'); const RF = load(); const D = RF.Drive;
let fails = 0, n = 0; const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const EYE = [-2, 0.37, 1.2], DT = 0.05;
const hold = process.env.AH_HYST !== undefined ? +process.env.AH_HYST : D.AUTO.hold;
const stepOpts = { hold };

// scene pieces (same shapes as tests/glare-occlusion.js): an oncoming car whose front face is at xLamp, lamps facing us
const oncomingCar = (xLamp, y) => [
  { k: 'box', x: xLamp - 2.21, y: y === undefined ? 1.5 : y, z0: 0.25, z1: 1.4, hx: 2.2, hy: 0.9, yaw: 0, traffic: 'onc', mat: 'car-paint' },
  ...[0.9, 2.1].map((ly) => ({ k: 'disc', headlamp: true, traffic: 'onc', x: xLamp - 0.01, y: ly + (y === undefined ? 0 : y - 1.5), z: 0.68, nx: -1, ny: 0, nz: 0, r: 0.1, eyeCd: 20000, mat: 'lamp-head' }))];
// a preceding car in our lane: its body and two tail lamps on the rear face (facing back, so they show to us)
const precedingCar = (xRear, y) => [
  { k: 'box', x: xRear + 2.2, y, z0: 0.25, z1: 1.4, hx: 2.2, hy: 0.9, yaw: 0, traffic: 'pre', mat: 'car-paint' },
  ...[y - 0.6, y + 0.6].map((ty) => ({ k: 'disc', taillamp: true, traffic: 'pre', x: xRear - 0.01, y: ty, z: 0.78, nx: -1, ny: 0, nz: 0, r: 0.1, emit: [1, 0.03, 0.015], mat: 'lamp-head' }))];
// a truck between us and the oncoming car: a box with no lamps of its own on this line
const truck = (x) => ({ k: 'box', x, y: 1.5, z0: 0, z1: 4, hx: 4, hy: 3, yaw: 0, traffic: 'truck', mat: 'truck' });
const sense = (objs, extra) => D.autoHighSense(objs, EYE, Object.assign({ lane: 3.5 }, extra || {}));

// 1. sensor: what is in view
ok('sensor: oncoming car at 300 m, in view -> oncoming', sense(oncomingCar(298.01)).oncoming === true);
ok('sensor: oncoming car at 450 m -> not seen (range 400 m)', sense(oncomingCar(448.01)).oncoming === false);
ok('sensor: oncoming car 60 m to the side (beyond 20 deg) -> not seen', sense(oncomingCar(60, 60 * Math.tan(30 * Math.PI / 180) + 1.5)).oncoming === false, sense(oncomingCar(60, 60 * Math.tan(30 * Math.PI / 180) + 1.5)));
ok('sensor: a truck between us and the oncoming car hides it -> not seen', sense([...oncomingCar(298.01), truck(200)]).oncoming === false);
ok('sensor: preceding car at 60 m in our lane -> preceding', sense(precedingCar(58, 0)).preceding === true);
ok('sensor: preceding car at 260 m (beyond 200 m) -> not preceding', sense(precedingCar(258, 0)).preceding === false);
ok('sensor: preceding car two lanes over -> not preceding', sense(precedingCar(58, 8)).preceding === false);
{
  // the hidden oncoming car behind a truck does not dip, but a visible preceding car does (the brief's combined case)
  const sc = [...oncomingCar(298.01), truck(200), ...precedingCar(58, 0)], s = sense(sc);
  ok('sensor: truck hides oncoming, visible preceding car still counts', s.oncoming === false && s.preceding === true, s);
}

// 2. state machine over a timeline: oncoming car in view from t=5 s to t=15 s, 60 s total
function timeline(h) {
  const st = { high: true, timer: 0, reason: 'clear' }, log = [];
  let passT = null, dipT = null;
  for (let t = 0; t < 60 - 1e-9; t += DT) {
    const tt = Math.round(t / DT) * DT;
    const inView = tt >= 5 && tt < 15;
    const s = inView ? { oncoming: true } : {};
    const before = st.high;
    D.autoHighStep(st, s, DT, { hold: h });
    if (before && !st.high && dipT === null) dipT = tt;
    if (!before && st.high && passT === null && tt > 15) passT = tt;
    log.push({ t: +tt.toFixed(2), high: st.high, reason: st.reason });
  }
  return { dipT, passT, log };
}
{
  const { log, dipT } = timeline(stepOpts.hold);
  const at = (tt) => log[Math.round(tt / DT)];
  ok('dips within 0.3 s of the oncoming car appearing (t=5 s)', dipT !== null && dipT - 5 <= 0.3 && dipT >= 5 - 1e-9, { dipT });
  ok('stays dipped while the oncoming car is in view (5 s to 15 s)', log.filter((x) => x.t >= 5 && x.t < 15).every((x) => x.high === false));
  // measured from the last frame the car was in view (t = 14.95 s), not from the first clear frame
  const high = log.filter((x) => x.t >= 15 && x.high);
  const back = high.length ? +(high[0].t - 14.95).toFixed(2) : null;
  ok('returns high only after 2 s with no trigger (2 s hold)', back !== null && back >= 2 - 1e-6 && back <= 2.1, { returnedAfterS: back, hold: stepOpts.hold });
  ok('stays high on an empty road before the car (0 to 5 s)', log.filter((x) => x.t < 5).every((x) => x.high === true));
  ok('reason reads oncoming while dipped', at(10).reason === 'oncoming', at(10));
}

// 3. the other triggers and an empty rural road
{
  const st = { high: true, timer: 0, reason: 'clear' }; let all = true;
  for (let t = 0; t < 60; t += DT) { D.autoHighStep(st, {}, DT, stepOpts); if (!st.high) all = false; }
  ok('empty rural road (60 s, nothing in view): stays high', all);
}
for (const [label, inputs, reason] of [
  ['urban tile dips', { urban: true, speedKmh: 50 }, 'urban'],
  ['speed 20 km/h dips', { speedKmh: 20 }, 'slow'],
  ['preceding car dips', { preceding: true, speedKmh: 50 }, 'preceding'],
]) {
  const st = { high: true, timer: 0, reason: 'clear' }; D.autoHighStep(st, inputs, DT, stepOpts);
  ok(label, st.high === false && st.reason === reason, st);
}
{
  const st = { high: true, timer: 0, reason: 'clear' }; D.autoHighStep(st, { speedKmh: 30 }, DT, stepOpts);
  ok('speed exactly 30 km/h does not dip (below 30 only)', st.high === true, st);
}

// 4. positive control readout: with AH_HYST=0 the return delay is 0 s, so the 2 s check must fail (exit 1 is the expected result then)
if (process.env.AH_HYST !== undefined) console.log('[control] hold = ' + hold + ' s (AH_HYST set): expecting the 2 s return check to FAIL');
console.log(fails ? 'auto-high: ' + fails + ' of ' + n + ' checks FAILED' : 'auto-high: all ' + n + ' checks passed');
process.exitCode = fails ? 1 : 0;
