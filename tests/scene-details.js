// OV scene details: the metric maths and the registry (js/scene-details.js), checked against hand calculations.
// node tests/scene-details.js — exits 1 on failure.
const { load } = require('./load.js');
const RF = load(), S = RF.SceneDetails;
let fails = 0;
const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.abs(b);

// 1. Illuminance from a point source: E = I cos / r^2
{
  // hand: 30 000 cd at 10 m, square on: 30000 / 100 = 300 lx
  ok('illuminance: 30 kcd at 10 m, square on, is 300 lx (2 %)', near(S.illuminance(30000, 10, 1), 300, 0.02), S.illuminance(30000, 10, 1));
  // hand: same lamp at 20 m, incidence 0.5: 30000 × 0.5 / 400 = 37.5 lx
  ok('illuminance: 30 kcd at 20 m, cos 0.5, is 37.5 lx (2 %)', near(S.illuminance(30000, 20, 0.5), 37.5, 0.02), S.illuminance(30000, 20, 0.5));
  // inverse square: doubling the distance quarters the lux
  ok('illuminance: doubling the distance quarters it', near(S.illuminance(30000, 40, 1) * 4, S.illuminance(30000, 20, 1), 1e-12));
  ok('illuminance: behind the surface or at r = 0 is 0', S.illuminance(30000, 10, -0.3) === 0 && S.illuminance(30000, 0, 1) === 0);
}

// 2. Road illuminance from a lamp at height h: E = I h / r^3 (lamp straight above the lane, lane centre straight ahead).
//    The reach metric is the distance where that falls to 1 lx: r^3 = I h, so r = cbrt(I h).
{
  const I = 30000, h = 0.6;                       // hand: cbrt(18000) = 26.2 m
  const lamps = [[0, 0, h]];
  const beam = () => I;                           // a uniform beam: candela the same in every direction
  const reach = S.firstFailure((d) => S.roadLux(lamps, beam, d, 0) >= 1, 0.05, 300, 1);   // from 1 m: the lamp's own foot is not ahead of it
  const hand = Math.cbrt(I * h);
  ok('road lux: the 1 lx reach from 30 kcd at 0.6 m matches cbrt(I h) within 2 %', near(reach, hand, 0.02), { reach, hand });
  // the sample point is on the road, so the lamp at height h lights it with cos = h / r: check one point against the formula
  const e10 = S.roadLux(lamps, beam, 10, 0), hand10 = I * h / Math.pow(Math.hypot(10, 0, h), 3);
  ok('road lux at 10 m equals I h / r^3 (2 %)', near(e10, hand10, 0.02), { e10, hand10 });
}

// 3. Angle off the beam axis
{
  ok('angle: x vs y is 90 deg', near(S.angleDeg([1, 0, 0], [0, 1, 0]), 90, 1e-9));
  ok('angle: x vs (1,1,0) is 45 deg', near(S.angleDeg([1, 0, 0], [1, 1, 0]), 45, 1e-9));
  ok('angle: lengths do not matter', near(S.angleDeg([3, 0, 0], [5, 5, 0]), 45, 1e-9));
  ok('angle: a zero vector is NaN', Number.isNaN(S.angleDeg([0, 0, 0], [1, 0, 0])));
}

// 4. Peak tracker: keeps the highest value and where it happened; the first of equal values is kept
{
  const pk = S.peakTracker();
  [[0.2, 90], [1.5, 70], [0.9, 60], [1.5, 40], [2.4, 35]].forEach(([v, at]) => pk.update(v, at));
  ok('peak: keeps the maximum and its distance', pk.value === 2.4 && pk.at === 35, pk);
  pk.reset();
  ok('peak: reset clears it', pk.value === 0 && pk.at === null);
}

// 5. firstFailure: stops at the first failing step; max if none fails; no float drift over many steps
{
  const ff = S.firstFailure((d) => d < 12.35, 0.05, 100);
  ok('firstFailure: finds the first failing step (within one step)', ff >= 12.35 && ff <= 12.4, ff);
  ok('firstFailure: returns max when nothing fails', S.firstFailure(() => true, 1, 50) === 50);
}

// 6. Registry: unique ids, groups, applies() returns null or a reason, extension through register()
{
  const ids = S.METRICS.map((m) => m.id);
  ok('registry: ids are unique', new Set(ids).size === ids.length, ids);
  ok('registry: every metric has a label, a group and a read()', S.METRICS.every((m) => m.label && m.group && typeof m.read === 'function'));
  const own = S.METRICS.filter((m) => m.group === 'own').map((m) => m.id);
  ok('registry: the own-car metrics are present', ['speed', 'highBeam', 'ahbReason', 'afsYaw', 'radius', 'radius100', 'grade', 'bank'].every((id) => own.includes(id)), own);
  const dup = (() => { try { S.register({ id: 'speed', label: 'x', read: () => 0 }); return false; } catch (e) { return true; } })();
  ok('registry: a duplicate id is refused', dup);
  const n0 = S.METRICS.length;
  S.register({ id: 'test_extra', label: 'Extra', read: (s) => s.speedKmh * 2 });
  const added = S.METRICS.find((m) => m.id === 'test_extra');
  ok('registry: a new metric is added with defaults', S.METRICS.length === n0 + 1 && added.group === 'own' && added.applies({}) === null && added.read({ speedKmh: 50 }) === 100);
  S.METRICS.splice(S.METRICS.indexOf(added), 1);                 // keep the registry as shipped for later checks
  const grade = S.METRICS.find((m) => m.id === 'grade');
  ok('applies: grade is greyed out off the pass with a reason', typeof grade.applies({ pass: false }) === 'string' && grade.applies({ pass: true }) === null);
}

// 7. Display text
{
  ok('format: null and NaN are a dash', S.format(null, 'm') === '—' && S.format(NaN, 'm') === '—');
  ok('format: Infinity is ∞ (straight road radius)', S.format(Infinity, 'm') === '∞');
  ok('format: % and degrees and lux get one decimal; km/h and m none; other units two', S.format(12.345, '%') === '12.3' && S.format(3.7, 'km/h') === '4' && S.format(0.5, 'lx') === '0.5' && S.format(1.2345, 'x') === '1.23');
  ok('format: strings pass through', S.format('auto high beam', '') === 'auto high beam');
  ok('groups: every registered metric has a known group', S.METRICS.every((m) => Object.prototype.hasOwnProperty.call(S.GROUPS, m.group)));
}

// 8. Oncoming and glare helpers
{
  // top source: the larger 10 lux / theta^2 term wins (a bright lamp 1 deg off beats a dim one dead ahead)
  const t = S.topSource([1, 0, 0], [[1, 0, 0, 3], [Math.cos(0.0175), Math.sin(0.0175), 0, 5]]);
  ok('topSource: the largest veil term wins, angle is at least 1 deg', t && t.lux === 5 && near(t.angle, 1, 0.01) && S.topSource([1, 0, 0], []) === null, t);
  // peak: lux 0.4, 2.0, 1.1 as the car approaches from 90 m: peak 2.0 at 60 m, and a car behind is never tracked
  const pk = new Map(), lux = { 90: 0.4, 60: 2.0, 30: 1.1 };
  [90, 60, 30].forEach((d) => S.samplePeaks(pk, [{ id: 'o1', rel: d }, { id: 'behind', rel: -5 }], (c) => lux[c.rel]));
  ok('peak per oncoming car: 2.0 lx at 60 m, not the latest 1.1 lx', pk.get('o1').value === 2 && pk.get('o1').at === 60, pk.get('o1'));
  ok('peak: a car behind us is not tracked', !pk.has('behind'));
  S.samplePeaks(pk, [{ id: 'o2', rel: 40 }], () => 0.5);
  ok('peak: a car no longer listed is forgotten', !pk.has('o1') && pk.has('o2'));
  // rows: nearest first, five at most, behind excluded, peak NaN until sampled
  const rows = S.oncomingRows([{ id: 'far', rel: 300 }, { id: 'near', rel: 20 }, { id: 'gone', rel: -2 }, { id: 'b', rel: 60 }, { id: 'c', rel: 80 }, { id: 'd', rel: 100 }, { id: 'e', rel: 120 }], 5, () => 1.5, () => 2, new Map());
  ok('oncoming rows: nearest five ahead, nearest first', rows.map((r) => r.id).join(',') === 'near,b,c,d,e', rows.map((r) => r.id));
  ok('oncoming rows: no sample yet means no peak (NaN), not 0', Number.isNaN(rows[0].peak) && rows[0].peakAt === null);
  // display: n/a shows the reason; a list uses its own text; numbers take their unit
  const m = S.METRICS.find((q) => q.id === 'oncoming');
  ok('display: a metric that does not apply shows the reason', S.display(m, null, 'oncoming traffic is off') === 'n/a (oncoming traffic is off)');
  ok('display: a list uses its own text', S.display(m, [], null) === 'none in range');
  ok('display: a number takes its unit', S.display(S.METRICS.find((q) => q.id === 'speed'), 49.6, null) === '50 km/h');
}

console.log(fails ? fails + ' FAILED' : 'all scene-details checks passed');
process.exitCode = fails ? 1 : 0;
