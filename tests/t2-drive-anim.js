// T2: drive-anim through RF.DriveAnim — node tests only, no browser.
// Covers: IDM invariants, idmStep behaviour, traffic/curve/AFS/sim constants,
// seeded long-run determinism, export surface, state dump/load shape.
// exits 1 on any failure. Run: node tests/t2-drive-anim.js
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
console.log('T2 drive-anim — node test suite');

// Load the app — everything RF.DriveAnim needs must already be on globalThis.RF
load();
const DA = globalThis.RF.DriveAnim;
const IDM = DA.IDM;
ok('[SETUP] drive-anim loaded OK', !!DA && !!IDM);

// --------------- 1. IDM formula invariants ---------------
console.log('\n--- 1. IDM formula invariants ---');
// idmAcceleration(v, dv, s, v0, params) — v own speed, dv = v - leader.v, s gap, v0 desired speed
const aFree = DA.idmAcceleration(20, 0, Infinity, 30);
ok('free-road (s=Infinity) acceleration is positive', aFree > 0, { aFree });
ok('free-road acc <= IDM.a', aFree <= IDM.a, { aFree, a: IDM.a });

const aFollow = DA.idmAcceleration(20, 0, 50, 30);
ok('following at safe gap 50 m: near zero acc',
  Math.abs(aFollow) < 1, { aFollow });

const aClose = DA.idmAcceleration(20, 5, 10, 30);   // dv > 0 means own faster
ok('approaching leader (gap 10, dv 5): negative acc (braking)',
  aClose < 0, { aClose });

const aSlow = DA.idmAcceleration(10, -5, 50, 30);    // dv < 0 means own slower
ok('leader pulling away (gap 50, dv -5): positive acc',
  aSlow > 0, { aSlow });

const aZero = DA.idmAcceleration(0, 0, Infinity, 30);
ok('at v=0, free-road acc = a (max)', Math.abs(aZero - IDM.a) < 0.001, { aZero });

const aV0 = DA.idmAcceleration(30, 0, Infinity, 30);
ok('at v=v0, free-road acc ≈ 0', Math.abs(aV0) < 0.001, { aV0 });

const aFast = DA.idmAcceleration(35, 0, Infinity, 30);
ok('above desired speed: acc < 0', aFast < 0, { aFast });

// Gap sensitivity: smaller gap → more negative acc (at same speeds)
const aNear = DA.idmAcceleration(20, 0, 10, 30);
const aFar = DA.idmAcceleration(20, 0, 100, 30);
ok('smaller gap → more negative acc', aNear < aFar, { aNear, aFar });

// dv sign: positive dv (own faster) → more negative acc
const aDvPos = DA.idmAcceleration(20, 5, 30, 30);
const aDvNeg = DA.idmAcceleration(20, -5, 30, 30);
ok('positive dv reduces acc vs negative dv', aDvPos < aDvNeg, { aDvPos, aDvNeg });

// IDM constants
ok('IDM.dt = 0.05 (20 Hz)', IDM.dt === 0.05);
ok('IDM.T = 1.5 (time gap)', IDM.T === 1.5);
ok('IDM.s0 = 2 (minimum gap, m)', IDM.s0 === 2);
ok('IDM.a = 1 (max acc, m/s²)', IDM.a === 1);
ok('IDM.b = 1.5 (comfortable decel, m/s²)', IDM.b === 1.5);
ok('IDM.length = 4.4 (car length, m)', IDM.length === 4.4);
ok('IDM.delta = 4 (acc exponent)', IDM.delta === 4);

// idmAcceleration with custom params overrides defaults
const customParams = { a: 2, b: 3, T: 2 };
const accCustom = DA.idmAcceleration(20, 0, 50, 40, customParams);
const accDefault = DA.idmAcceleration(20, 0, 50, 40);
ok('custom params change output', accCustom !== accDefault, { accCustom, accDefault });

// --------------- 2. idmStep behaviour ---------------
console.log('\n--- 2. idmStep behaviour ---');

// Free road: car accelerates from 0
let freeCar = { x: 0, v: 0, a: 0 };
for (let i = 0; i < 4; i++)
  freeCar = DA.idmStep(freeCar, null, IDM.dt, 30);
ok('free road DT=0.2 s: v > 0 (started moving)', freeCar.v > 0, { v: freeCar.v });
ok('free road DT=0.2 s: x > 1 mm (moved forward)', freeCar.x > 0.001, { x: freeCar.x });

// Following at constant speed: car tracks leader
let folCar = { x: 0, v: 20, a: 0 };
const folLeader = { x: 50, v: 20, a: 0 };
for (let i = 0; i < 10; i++)
  folCar = DA.idmStep(folCar, folLeader, IDM.dt, 30);
ok('constant-speed follow: v stays near leader (20 m/s)',
  Math.abs(folCar.v - 20) < 0.5, { v: folCar.v });

// No leader at all (null)
let solo = { x: 0, v: 20, a: 0 };
const nextSolo = DA.idmStep(solo, null, IDM.dt, 30);
ok('no leader (null): car accelerates towards desired speed',
  nextSolo.v >= solo.v, { vBefore: solo.v, vAfter: nextSolo.v });

// Stop parameter: car decelerates to stop at given position
let stopCar = { x: 0, v: 15, a: 0 };
for (let i = 0; i < 200; i++) {
  const prev = stopCar;
  stopCar = DA.idmStep(stopCar, null, IDM.dt, 20, 30);  // stop at x=30
  if (stopCar.x >= 30) break;
  // prevent infinite loop: should have stopped or overshot
  if (i > 180) break;
}
ok('with stop=30 m: car does not overshoot stop line',
  stopCar.x <= 30 + 0.5, { x: stopCar.x, v: stopCar.v });

// --------------- 3. idmStep determinism over seeded long run ---------------
console.log('\n--- 3. idmStep seeded long-run determinism ---');
function runIDM(steps, seed) {
  let car = { x: 0, v: 20, a: 0 };
  const leader = { x: 50 + (seed % 10), v: 18, a: 0 };
  for (let i = 0; i < steps; i++)
    car = DA.idmStep(car, leader, IDM.dt, 30);
  return { x: car.x, v: car.v };
}
const run1 = runIDM(100, 7);
const run2 = runIDM(100, 7);
ok('seeded long run (100 steps) is deterministic', 
  run1.x === run2.x && run1.v === run2.v,
  { run1, run2 });

// Different seeds with different leader position → different results
const run3 = runIDM(100, 9);
ok('different seed gives different trajectory',
  (run1.x !== run3.x || run1.v !== run3.v),
  { seed7: run1, seed9: run3 });

// --------------- 4. Traffic constants ---------------
console.log('\n--- 4. Traffic constants ---');
ok('TRAFFIC_BRAKE = 3.5 m/s²', DA.TRAFFIC_BRAKE === 3.5);
ok('TRAFFIC_SPEED.oncoming = 50 km/h (13.889 m/s)',
  Math.abs(DA.TRAFFIC_SPEED.oncoming - 50 / 3.6) < 0.001);
ok('TRAFFIC_SPEED.preceding = 40 km/h (11.111 m/s)',
  Math.abs(DA.TRAFFIC_SPEED.preceding - 40 / 3.6) < 0.001);
ok('TURN_SPEED = 4 m/s', DA.TURN_SPEED === 4);
ok('TURN_PROBABILITY = 0.25', DA.TURN_PROBABILITY === 0.25);
ok('TURN_GAP = 5 s', DA.TURN_GAP === 5);
ok('PERIOD = 300 m', DA.PERIOD === 300);
ok('TILE_LEN is a positive number', typeof DA.TILE_LEN === 'number' && DA.TILE_LEN > 0,
  { TILE_LEN: DA.TILE_LEN });

// --------------- 5. AFS constants ---------------
console.log('\n--- 5. AFS constants ---');
const PI = Math.PI;
ok('AFS_MAX = 15° (π/12 rad)', Math.abs(DA.AFS_MAX - PI / 12) < 0.001,
  { AFS_MAX: DA.AFS_MAX });
ok('AFS_RATE = 12°/s', Math.abs(DA.AFS_RATE - 12 * PI / 180) < 0.001);
ok('AFS_RETURN = 30°/s', Math.abs(DA.AFS_RETURN - 30 * PI / 180) < 0.001);

// --------------- 6. SIM ceilings ---------------
console.log('\n--- 6. SIM ceilings ---');
ok('SIM_CEILINGS.low = 640', DA.SIM_CEILINGS.low === 640);
ok('SIM_CEILINGS.medium = 960', DA.SIM_CEILINGS.medium === 960);
ok('SIM_CEILINGS.high = 1600', DA.SIM_CEILINGS.high === 1600);
ok('SIM_CEILINGS.ultra = 2560', DA.SIM_CEILINGS.ultra === 2560);
ok('SIM_CEILINGS.native = 3840', DA.SIM_CEILINGS.native === 3840);
ok('SIM_CEILINGS is monotonic: low < medium < high < ultra < native',
  DA.SIM_CEILINGS.low < DA.SIM_CEILINGS.medium &&
  DA.SIM_CEILINGS.medium < DA.SIM_CEILINGS.high &&
  DA.SIM_CEILINGS.high < DA.SIM_CEILINGS.ultra &&
  DA.SIM_CEILINGS.ultra < DA.SIM_CEILINGS.native);

// --------------- 7. Curve helpers ---------------
console.log('\n--- 7. Curve helpers ---');
ok('curveSpeed is a function', typeof DA.curveSpeed === 'function');
ok('curveSections is a function', typeof DA.curveSections === 'function');
ok('curvatureAt is a function', typeof DA.curvatureAt === 'function');
ok('curveEnvelope is a function', typeof DA.curveEnvelope === 'function');

// curveSpeed(c): only curvature matters — desired speed not an input
const cs0 = DA.curveSpeed(0);           // straight road
const csMild = DA.curveSpeed(0.01);     // r=100 m
const csTight = DA.curveSpeed(0.05);    // r=20 m
ok('curveSpeed(0) = Infinity (straight)', cs0 === Infinity);
ok('curveSpeed(0.01) is finite', isFinite(csMild), { csMild });
ok('curveSpeed(0.05) is finite', isFinite(csTight), { csTight });
ok('tighter curve (0.05) → slower than milder curve (0.01)',
  csTight < csMild, { csTight, csMild });
ok('curveSpeed(0) = Infinity', DA.curveSpeed(0) === Infinity);
ok('curveSpeed formula: sqrt(3/k)', Math.abs(DA.curveSpeed(0.01) - Math.sqrt(3/0.01)) < 0.001,
  { got: DA.curveSpeed(0.01), formula: Math.sqrt(300) });

// --------------- 8. Export surface: named in brief ---------------
console.log('\n--- 8. Export surface ---');
const exported = Object.keys(DA);
for (const name of ['IDM', 'idmAcceleration', 'idmStep', 'curveSections', 'curvatureAt',
  'curveEnvelope', 'curveSpeed', 'speedLimit', 'autoSpeedKmh', 'autoUrban',
  'signalState', 'trafficSignal', 'junctionPlan', 'timeline',
  'stateDump', 'readState', 'loadState', 'laneDistance', 'laneAdvance',
  'steeringSignal', 'afsTarget', 'TRAFFIC_BRAKE', 'TURN_SPEED', 'TURN_PROBABILITY',
  'TURN_GAP', 'TRAFFIC_SPEED', 'PERIOD', 'SIM_CEILINGS', 'MIN_FPS', 'AFS_MAX',
  'AFS_RATE', 'AFS_RETURN', 'STATE_KIND', 'LOD_LEVELS', 'lightingSubsteps',
  'lightingStep', 'TILE_LEN', 'TILE_KINDS', 'EYE', 'ANIM_SCENES', 'CLASSES']) {
  ok(name + ' exported', exported.includes(name));
}

// --------------- 9. Function shapes ---------------
console.log('\n--- 9. Function shapes ---');
ok('idmAcceleration.length = 5 (v,dv,s,v0,params)', DA.idmAcceleration.length === 5,
  { len: DA.idmAcceleration.length });
ok('idmStep.length = 6 (car,leader,dt,v0,stop,params)', DA.idmStep.length === 6,
  { len: DA.idmStep.length });
ok('curveSpeed.length = 1 (curvature only)', DA.curveSpeed.length === 1,
  { len: DA.curveSpeed.length });
ok('lightingSubsteps is a function', typeof DA.lightingSubsteps === 'function');
ok('lightingStep is a function', typeof DA.lightingStep === 'function');
ok('timeline is a function (getter)', typeof DA.timeline === 'function');
ok('stateDump is a function', typeof DA.stateDump === 'function');
ok('readState is a function', typeof DA.readState === 'function');
ok('loadState is a function', typeof DA.loadState === 'function');

// --------------- 10. STATE_KIND ---------------
console.log('\n--- 10. STATE_KIND ---');
ok('STATE_KIND = "flux-state"', DA.STATE_KIND === 'flux-state');

// --------------- 11. LOD_LEVELS ---------------
console.log('\n--- 11. LOD_LEVELS ---');
ok('LOD_LEVELS is an object', DA.LOD_LEVELS !== null && typeof DA.LOD_LEVELS === 'object',
  { keys: DA.LOD_LEVELS ? Object.keys(DA.LOD_LEVELS).join(',') : null });
if (DA.LOD_LEVELS) {
  ok('LOD_LEVELS includes "low"', 'low' in DA.LOD_LEVELS);
  ok('LOD_LEVELS includes "medium"', 'medium' in DA.LOD_LEVELS);
  ok('LOD_LEVELS includes "high"', 'high' in DA.LOD_LEVELS);
  // Each LOD level has scatterRange, trafficRange, cullEps, cars
  for (const lvl of ['low', 'medium', 'high']) {
    const L = DA.LOD_LEVELS[lvl];
    ok('LOD_LEVELS.' + lvl + ' has scatterRange', L && typeof L.scatterRange === 'number');
    ok('LOD_LEVELS.' + lvl + ' has trafficRange', L && typeof L.trafficRange === 'number');
    ok('LOD_LEVELS.' + lvl + ' has cullEps', L && typeof L.cullEps === 'number');
    ok('LOD_LEVELS.' + lvl + ' has cars', L && typeof L.cars === 'number');
  }
}

// --------------- 12. TILE_KINDS ---------------
console.log('\n--- 12. TILE_KINDS ---');
ok('TILE_KINDS is an array', Array.isArray(DA.TILE_KINDS),
  { len: DA.TILE_KINDS ? DA.TILE_KINDS.length : 0 });
if (Array.isArray(DA.TILE_KINDS)) {
  ok('TILE_KINDS includes "straight"', DA.TILE_KINDS.includes('straight'));
  ok('TILE_KINDS includes "intersection"', DA.TILE_KINDS.includes('intersection'));
  ok('TILE_KINDS has 8 entries', DA.TILE_KINDS.length === 8,
    { kinds: DA.TILE_KINDS.join(', ') });
}

// --------------- summary ---------------
console.log('\n--- summary ---');
console.log((fails ? '[FAIL] ' : '[PASS] ') + n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);