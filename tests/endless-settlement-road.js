/* Node test for js/endless-settlement-road.js (Endless road v2, nemo 11-10).
   Run: node tests/endless-settlement-road.js   (registered in the gate MAP; runs when js/endless-settlement-road.js changes)
   Checks: determinism, all-auto validity, tileWeights names all 8 kinds, fixed-axis constancy,
   speedLimit = min of the two rungs (reusing harbert's SPEED), userCurviness biases curves, the road-class
   junction gate, the gradual density blend + sharp hard-switch (densityAt on constructed runs), runAt,
   range membership, cross-seed variation, and a 200-tile bounds sweep.
   Requires js/endless-axis-config.js (harbert's scheduler) to be present. */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js', 'endless-axis-config.js'));
const S = require(path.join(ROOT, 'js', 'endless-settlement-road.js'));
const KINDS = S.TILE_KINDS;
const DKEYS = ['buildings', 'driveways', 'intersections', 'peds', 'trafficDensity'];
let failed = 0;
const ok = (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); if (!pass) failed++; };
const close = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);
const curveSum = (w) => w['250R'] + w['250L'] + w['150R'] + w['150L'];

// 1. determinism: same seed + settings + k = byte-identical knobs
const d1 = S.settlementRoadAt(42, 7, { settlement: 'auto', roadClass: 'auto' });
const d2 = S.settlementRoadAt(42, 7, { settlement: 'auto', roadClass: 'auto' });
ok('1 determinism (same seed+settings+k)', JSON.stringify(d1) === JSON.stringify(d2));

// 2. all-auto ({}) produces valid knobs: ladder members, densities in [0,1], all 8 kinds, speedLimit>0, sane geometry
const auto = S.settlementRoadAt(7, 3, {});
ok('2 all-auto ({}) → valid knobs',
  E.LADDERS.settlement.includes(auto.settlement) && E.LADDERS.roadClass.includes(auto.roadClass)
  && KINDS.every((kd) => kd in auto.tileWeights && auto.tileWeights[kd] >= 0)
  && DKEYS.every((k2) => auto[k2] >= 0 && auto[k2] <= 1)
  && auto.speedLimit > 0 && (auto.laneCount === 2 || auto.laneCount === 4)
  && auto.roadWidth > 0 && auto.shoulder >= 0 && typeof auto.median === 'boolean', auto);

// 3. tileWeights names ALL 8 kinds (pickKind counts an unnamed kind as weight 1)
const tw = auto.tileWeights;
ok('3 tileWeights names all 8 TILE_KINDS, each a number ≥0', KINDS.length === 8 && KINDS.every((kd) => typeof tw[kd] === 'number' && tw[kd] >= 0), tw);

// 4. fixed settlement axis → constant settlement + densities across k (sharp, no blend)
const fCity = [0, 5, 50, 200].map((k) => S.settlementRoadAt(11, k, { settlement: 'city', roadClass: 'auto' }));
ok('4 fixed settlement=city constant across k',
  fCity.every((r) => r.settlement === 'city' && close(r.buildings, S.SETTLEMENT_DENSITY.city.buildings) && close(r.trafficDensity, S.SETTLEMENT_DENSITY.city.trafficDensity)),
  fCity.map((r) => r.settlement));

// 5. fixed roadClass axis → constant cross-section geometry across k
const fHW = [0, 5, 50, 200].map((k) => S.settlementRoadAt(11, k, { settlement: 'auto', roadClass: 'dense-highway' }));
ok('5 fixed roadClass=dense-highway → constant geometry (4 lanes, 15 m, median, 3 m shoulder)',
  fHW.every((r) => r.roadClass === 'dense-highway' && r.laneCount === 4 && close(r.roadWidth, 15) && r.median === true && close(r.shoulder, 3)),
  fHW.map((r) => [r.laneCount, r.roadWidth, r.median]));

// 6. speedLimit = min(settlement SPEED, roadClass SPEED), reusing harbert's table (city 50 vs dense-highway 110 → 50)
const sl = S.settlementRoadAt(5, 9, { settlement: 'city', roadClass: 'dense-highway' });
const expectSL = Math.min(E.SPEED.settlement.city, E.SPEED.roadClass['dense-highway']);
ok('6 speedLimit = min of the two rungs (city 50, dense-highway 110 → 50)', sl.speedLimit === expectSL && sl.speedLimit === 50, { got: sl.speedLimit, expectSL });

// 7. userCurviness scales the curve kinds (250/150) linearly; straight is unchanged
const cLo = S.settlementRoadAt(5, 4, { roadClass: 'two-lane', userCurviness: 0.5 }).tileWeights;
const cMid = S.settlementRoadAt(5, 4, { roadClass: 'two-lane', userCurviness: 1 }).tileWeights;
const cHi = S.settlementRoadAt(5, 4, { roadClass: 'two-lane', userCurviness: 2 }).tileWeights;
ok('7 userCurviness scales curves (0.5<1<2, hi=2×mid), straight constant',
  curveSum(cLo) < curveSum(cMid) && curveSum(cMid) < curveSum(cHi)
  && close(curveSum(cHi), 2 * curveSum(cMid), 1e-6)
  && close(cLo.straight, cMid.straight) && close(cMid.straight, cHi.straight),
  { lo: curveSum(cLo), mid: curveSum(cMid), hi: curveSum(cHi), straight: cMid.straight });

// 8. road-class junction gate: dense-highway suppresses urban/intersection vs street at the same settlement
const jHW = S.settlementRoadAt(5, 4, { settlement: 'city', roadClass: 'dense-highway' }).tileWeights;
const jSt = S.settlementRoadAt(5, 4, { settlement: 'city', roadClass: 'street' }).tileWeights;
ok('8 junction gate: dense-highway urban/intersection << street (city settlement)',
  jHW.urban < jSt.urban && jHW.intersection < jSt.intersection, { hw: [jHW.urban, jHW.intersection], st: [jSt.urban, jSt.intersection] });

// 9. densityAt blends a 'gradual' entry over the first ~15% of the run (from `from` to `value`)
const runs = [
  { value: 'rural', startK: 0, endK: 100, style: 'sharp', from: null },
  { value: 'city', startK: 100, endK: 200, style: 'gradual', from: 'rural' },
];
const ruralB = S.SETTLEMENT_DENSITY.rural.buildings, cityB = S.SETTLEMENT_DENSITY.city.buildings;
const dAt100 = S.densityAt(runs, 100).buildings;   // t=0 → rural
const dAt115 = S.densityAt(runs, 115).buildings;   // blendLen=round(100*0.15)=15 → t=1 → city
const dMid = S.densityAt(runs, 107).buildings;     // t≈0.47 → strictly between
ok('9 densityAt gradual blend: start=from, +15%=value, mid between',
  close(dAt100, ruralB) && close(dAt115, cityB) && dMid > ruralB && dMid < cityB, { dAt100, dAt115, dMid, ruralB, cityB });

// 10. densityAt does NOT blend a 'sharp' entry (hard switch to the value)
const sharpRuns = [
  { value: 'rural', startK: 0, endK: 100, style: 'sharp', from: null },
  { value: 'city', startK: 100, endK: 200, style: 'sharp', from: 'rural' },
];
ok('10 densityAt sharp entry = value densities (no blend)', close(S.densityAt(sharpRuns, 100).buildings, cityB), S.densityAt(sharpRuns, 100).buildings);

// 11. runAt returns the run containing k (boundaries inclusive of startK)
ok('11 runAt finds the containing run', S.runAt(runs, 50).value === 'rural' && S.runAt(runs, 150).value === 'city' && S.runAt(runs, 100).value === 'city');

// 12. range {min,max} uses ladder NAMES (parseAxis L.indexOf); both-unknown -> auto (full range)
const ranged = [0, 30, 90, 150, 300].map((k) => S.settlementRoadAt(3, k, { settlement: { min: 'suburb', max: 'rural' }, roadClass: 'auto' }).settlement);
ok('12 settlement {min:suburb,max:rural} (NAMES) stays within [suburb,rural]', ranged.every((v) => v === 'suburb' || v === 'rural'), ranged);

// 13. different seeds → different axis sequences (the scheduler is seeded)
const seqOf = (seed) => [0, 40, 80, 120, 160, 200].map((k) => { const r = S.settlementRoadAt(seed, k, {}); return r.settlement + '/' + r.roadClass; }).join(',');
ok('13 different seeds → different settlement/roadClass sequences', seqOf(1) !== seqOf(2), { s1: seqOf(1), s2: seqOf(2) });

// 14. 200-tile auto sweep: densities in [0,1], geometry sane, tileWeights complete + ≥0 everywhere
let sweepOk = true;
for (let k = 0; k < 200; k += 7) {
  const r = S.settlementRoadAt(9, k, {});
  if (!DKEYS.every((k2) => r[k2] >= 0 && r[k2] <= 1)) sweepOk = false;
  if (!((r.laneCount === 2 || r.laneCount === 4) && r.roadWidth > 0 && r.shoulder >= 0 && typeof r.median === 'boolean')) sweepOk = false;
  if (!KINDS.every((kd) => kd in r.tileWeights && r.tileWeights[kd] >= 0)) sweepOk = false;
  if (!(r.speedLimit > 0)) sweepOk = false;
}
ok('14 200-tile auto sweep: bounds + completeness hold', sweepOk);

console.log('\n' + (failed === 0 ? 'all 14 endless-settlement-road checks passed' : '14 checks, ' + failed + ' failed'));
process.exit(failed === 0 ? 0 : 1);
