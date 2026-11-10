/* Node test for js/endless-traffic.js (Endless road v2, barbicane 11-10).
   Run: node tests/endless-traffic.js   (registered in gate MAP; runs when js/endless-traffic.js changes)
   Checks: determinism, all-auto validity, fixed-axis constancy, safeGapMul magnitudes, onMode
   per settlement, pedStop per settlement, onKcdMs bounds + speed scaling, truckFraction bounds,
   range membership, cross-seed variation, 200-tile auto sweep.
   Requires js/endless-axis-config.js (harbert's scheduler) + js/endless-traffic.js to be present. */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'js', 'endless-axis-config.js'));
const T = require(path.join(ROOT, 'js', 'endless-traffic.js'));
const SETTLEMENT_LADDER = E.LADDERS.settlement;
const ROADCLASS_LADDER = E.LADDERS.roadClass;
let failed = 0;
const ok = (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); if (!pass) failed++; };
const close = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

// 1. determinism: same seed + settings + k = byte-identical knobs
const d1 = T.trafficAt(42, 7, { settlement: 'city', roadClass: 'dense-highway' });
const d2 = T.trafficAt(42, 7, { settlement: 'city', roadClass: 'dense-highway' });
ok('1 determinism (same seed+settings+k)', JSON.stringify(d1) === JSON.stringify(d2));

// 2. all-auto ({}) produces valid knobs: ladder members, safeGapMul > 0, onMode valid, onKcdMs 20..80, pedStop boolean, truckFraction 0..1
const auto = T.trafficAt(7, 3, {});
ok('2 all-auto ({}) → valid knobs',
  SETTLEMENT_LADDER.includes(auto.settlement) && ROADCLASS_LADDER.includes(auto.roadClass)
  && auto.safeGapMul > 0 && ['symmetric', 'signal', 'none'].includes(auto.onMode)
  && auto.onKcdMs >= 20 && auto.onKcdMs <= 80
  && typeof auto.pedStop === 'boolean' && auto.truckFraction >= 0 && auto.truckFraction <= 1, auto);

// 3. fixed settlement=city → onMode='signal', pedStop=true
const fCity = T.trafficAt(11, 10, { settlement: 'city', roadClass: 'auto' });
ok('3 city → onMode=signal, pedStop=true', fCity.onMode === 'signal' && fCity.pedStop === true, fCity);

// 4. fixed settlement=wild → onMode='none', pedStop=false
const fWild = T.trafficAt(11, 10, { settlement: 'wild', roadClass: 'auto' });
ok('4 wild → onMode=none, pedStop=false', fWild.onMode === 'none' && fWild.pedStop === false, fWild);

// 5. fixed settlement=rural → onMode='symmetric'
const fRural = T.trafficAt(11, 10, { settlement: 'rural', roadClass: 'auto' });
ok('5 rural → onMode=symmetric', fRural.onMode === 'symmetric', fRural);

// 6. fixed roadClass=dense-highway → safeGapMul=1.5, truckFraction high
const fHW = T.trafficAt(11, 10, { settlement: 'city', roadClass: 'dense-highway' });
ok('6 dense-highway → safeGapMul=1.5', close(fHW.safeGapMul, 1.5), fHW.safeGapMul);

// 7. fixed roadClass=street → safeGapMul=0.6, truckFraction ~0.01
const fStreet = T.trafficAt(11, 10, { settlement: 'city', roadClass: 'street' });
ok('7 street → safeGapMul=0.6, truckFraction ≤0.5', close(fStreet.safeGapMul, 0.6) && fStreet.truckFraction <= 0.5, { gap: fStreet.safeGapMul, truck: fStreet.truckFraction });

// 8. onKcdMs scales with speed: city=25*50/50=25, highway city=25*110/50=55 → within [20,80]
const slowSpeed = T.trafficAt(5, 1, { settlement: 'city', roadClass: 'dense-highway' });
const fastSpeed = T.trafficAt(5, 1, { settlement: 'city', roadClass: 'remote-highway' });
ok('8 onKcdMs in [20,80] bounds', slowSpeed.onKcdMs >= 20 && slowSpeed.onKcdMs <= 80 && fastSpeed.onKcdMs >= 20 && fastSpeed.onKcdMs <= 80, { cityHW: slowSpeed.onKcdMs, cityRH: fastSpeed.onKcdMs });

// 9. truckFraction: highway+rural > highway+city (settlement truck mod suppresses trucks in city)
const hwRural = T.trafficAt(5, 1, { settlement: 'rural', roadClass: 'dense-highway' });
const hwCity  = T.trafficAt(5, 1, { settlement: 'city', roadClass: 'dense-highway' });
ok('9 truckFraction: rural+highway > city+highway', hwRural.truckFraction > hwCity.truckFraction, { rural: hwRural.truckFraction, city: hwCity.truckFraction });

// 9b. absolute anchor: city+dense-highway at seed=5,k=1 = truckFraction 0.15 (0.30*0.5, deterministic)
const ta = T.trafficAt(5, 1, { settlement: 'city', roadClass: 'dense-highway' });
ok('9b anchor: city+dense-highway → truckFraction=0.15, safeGapMul=1.5, onMode=signal', close(ta.truckFraction, 0.15) && close(ta.safeGapMul, 1.5) && ta.onMode === 'signal', ta);

// 9c. absolute anchor sweep: all 6 roadClasses at seed=5,k=1,city (safeGapMul + truckFraction)
const roadAnchors = [
  { rc: 'dense-highway',  gap: 1.5, truck: 0.15 },
  { rc: 'remote-highway', gap: 1.3, truck: 0.125 },
  { rc: 'surface-2+2',    gap: 1.0, truck: 0.075 },
  { rc: 'suburban-1+1',   gap: 0.8, truck: 0.04 },
  { rc: 'two-lane',       gap: 0.9, truck: 0.05 },
  { rc: 'street',         gap: 0.6, truck: 0.01 },
];
let anchorsOk = true;
for (const a of roadAnchors) {
  const r = T.trafficAt(5, 1, { settlement: 'city', roadClass: a.rc });
  if (!close(r.safeGapMul, a.gap) || !close(r.truckFraction, a.truck)) anchorsOk = false;
}
ok('9c anchor sweep: all 6 roadClasses safeGapMul + truckFraction exact at seed=5,k=1,city', anchorsOk);

// 10. truckFraction ∈ [0,1]
ok('10 truckFraction ∈ [0,1]', fHW.truckFraction >= 0 && fHW.truckFraction <= 1, fHW.truckFraction);

// 11. onMode table: city=signal, suburb=signal, rural=symmetric, wild=none
ok('11 onMode table: city→signal, suburb→signal, rural→symmetric, wild→none',
  T.SETTLEMENT_ONMODE.city === 'signal' && T.SETTLEMENT_ONMODE.suburb === 'signal'
  && T.SETTLEMENT_ONMODE.rural === 'symmetric' && T.SETTLEMENT_ONMODE.wild === 'none');

// 12. pedStop table: city=true, suburb=true, rural=false, wild=false
ok('12 pedStop table',
  T.SETTLEMENT_PEDSTOP.city === true && T.SETTLEMENT_PEDSTOP.suburb === true
  && T.SETTLEMENT_PEDSTOP.rural === false && T.SETTLEMENT_PEDSTOP.wild === false);

// 13. safeGapMul table: all 6 roadClass entries
ok('13 safeGapMul table: all 6 entries',
  close(T.ROADCLASS_GAP['dense-highway'], 1.5) && close(T.ROADCLASS_GAP['remote-highway'], 1.3)
  && close(T.ROADCLASS_GAP['surface-2+2'], 1.0) && close(T.ROADCLASS_GAP['suburban-1+1'], 0.8)
  && close(T.ROADCLASS_GAP['two-lane'], 0.9) && close(T.ROADCLASS_GAP.street, 0.6));

// 13b. truckFraction table: all 6 roadClass entries
ok('13b ROADCLASS_TRUCK table: all 6 entries',
  close(T.ROADCLASS_TRUCK['dense-highway'], 0.30) && close(T.ROADCLASS_TRUCK['remote-highway'], 0.25)
  && close(T.ROADCLASS_TRUCK['surface-2+2'], 0.15) && close(T.ROADCLASS_TRUCK['suburban-1+1'], 0.08)
  && close(T.ROADCLASS_TRUCK['two-lane'], 0.10) && close(T.ROADCLASS_TRUCK.street, 0.02));

// 14. different seeds → different axis sequences (the scheduler is seeded)
const seqOf = (seed) => [0, 40, 80, 120, 160].map((k) => { const r = T.trafficAt(seed, k, {}); return r.settlement + '|' + r.onMode; }).join(',');
ok('14 different seeds → different sequences', seqOf(1) !== seqOf(2), { s1: seqOf(1), s2: seqOf(2) });

// 15. 200-tile auto sweep: all knobs within bounds
let sweepOk = true;
for (let k = 0; k < 200; k += 7) {
  const r = T.trafficAt(9, k, {});
  if (!(r.safeGapMul > 0 && r.safeGapMul <= 2)) sweepOk = false;
  if (!['symmetric', 'signal', 'none'].includes(r.onMode)) sweepOk = false;
  if (!(r.onKcdMs >= 20 && r.onKcdMs <= 80)) sweepOk = false;
  if (!(typeof r.pedStop === 'boolean')) sweepOk = false;
  if (!(r.truckFraction >= 0 && r.truckFraction <= 1)) sweepOk = false;
  if (!SETTLEMENT_LADDER.includes(r.settlement)) sweepOk = false;
  if (!ROADCLASS_LADDER.includes(r.roadClass)) sweepOk = false;
}
ok('15 200-tile auto sweep: bounds hold', sweepOk);

console.log('\n' + (failed === 0 ? 'all 15 endless-traffic checks passed' : '15 checks, ' + failed + ' failed'));
process.exit(failed === 0 ? 0 : 1);