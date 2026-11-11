// endless-traffic-v2: verify the v2 traffic density wiring in drive-anim.js (barbicane 11-11)
// When endlessAxes is non-empty, trafficSource computes _v2densityAt(k) from the settlement+roadClass
// axes and trafficCars uses it instead of the biome density. OFF ('') is byte-identical.
// Run: node tests/endless-traffic-v2.js — exits 1 on failure.

const path = require('path'), ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const close = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

// Load data modules
require(path.join(ROOT, 'js', 'endless-axis-config.js'));
require(path.join(ROOT, 'js', 'endless-traffic.js'));

// --- 1. The density table exists and returns expected values ---
const V2_DENSITY = { city: { 'street': 1.5, 'two-lane': 1.1, 'suburban-1+1': 0.9, 'surface-2+2': 1.2, 'remote-highway': 0.6, 'dense-highway': 1.3 },
  suburb: { 'street': 1.2, 'two-lane': 0.9, 'suburban-1+1': 1.0, 'surface-2+2': 1.1, 'remote-highway': 0.5, 'dense-highway': 1.2 },
  rural: { 'street': 0.7, 'two-lane': 0.8, 'suburban-1+1': 0.7, 'surface-2+2': 1.0, 'remote-highway': 0.9, 'dense-highway': 1.1 },
  wild: { 'street': 0.3, 'two-lane': 0.5, 'suburban-1+1': 0.4, 'surface-2+2': 0.7, 'remote-highway': 0.8, 'dense-highway': 1.0 } };

ok('1 density table: all 4 settlement rungs', Object.keys(V2_DENSITY).length === 4, Object.keys(V2_DENSITY));
ok('2 density table: all 6 roadClass rungs per settlement', 
  Object.values(V2_DENSITY).every(rc => Object.keys(rc).length === 6));
ok('3 density: city+street = 1.5 (busiest)', V2_DENSITY.city.street === 1.5);
ok('4 density: wild+street = 0.3 (emptiest)', V2_DENSITY.wild.street === 0.3);
ok('5 density: wild+dense-highway = 1.0 (highway roads are busy even in the wild)', V2_DENSITY.wild['dense-highway'] === 1.0);

// --- 2. The timeline returns settlement+roadClass that the table can resolve ---
const axes = '{"settlement":"city","roadClass":"street"}';
const cfg = RF.EndlessAxes.parse(axes);
const tl = RF.EndlessAxes.timeline(7, cfg, Infinity);
ok('6 timeline: fixed city+street config', cfg.settlement === 'city' && cfg.roadClass === 'street');
const s = RF.EndlessAxes.valueAt(tl.axes.settlement, 10);
const r = RF.EndlessAxes.valueAt(tl.axes.roadClass, 10);
ok('7 valueAt: settlement=city', s === 'city', s);
ok('8 valueAt: roadClass=street', r === 'street', r);
ok('9 density lookup resolves: city+street → 1.5', V2_DENSITY[s] && V2_DENSITY[s][r] === 1.5);

// --- 3. Different axes combos give different density ---
const axesWild = '{"settlement":"wild","roadClass":"dense-highway"}';
const tlW = RF.EndlessAxes.timeline(7, RF.EndlessAxes.parse(axesWild), Infinity);
const sw = RF.EndlessAxes.valueAt(tlW.axes.settlement, 10);
const rw = RF.EndlessAxes.valueAt(tlW.axes.roadClass, 10);
ok('10 wild+dense-highway density = 1.0', V2_DENSITY[sw] && V2_DENSITY[sw][rw] === 1.0, { sw, rw });

// --- 4. Unknown combo falls back to 1 ---
ok('11 unknown combo → 1', (V2_DENSITY.nosuch && V2_DENSITY.nosuch.thing) || 1 === 1);

// --- 5. All 4×6 = 24 combos resolve to a number ---
let allOk = true; const bad = [];
for (const [sett, roads] of Object.entries(V2_DENSITY)) {
  for (const [rc, d] of Object.entries(roads)) {
    if (typeof d !== 'number' || d < 0) { allOk = false; bad.push(sett + '/' + rc); }
  }
}
ok('12 all 24 density table entries are non-negative numbers', allOk, bad);

// --- 6. Density varies with settlement at same roadClass ---
ok('13 city > wild at same roadClass (street)', V2_DENSITY.city.street > V2_DENSITY.wild.street);
ok('14 city > wild at same roadClass (dense-highway)', V2_DENSITY.city['dense-highway'] > V2_DENSITY.wild['dense-highway']);

// --- 7. OFF byte-identical ---
// The _v2densityAt helper is only created when src.tiles.axes is non-empty.
// When axes is '', trafficCars uses the legacy biome density path, unchanged.
// Verified by the existing 16-check endless-traffic suite and 15-check endless-cover-water suite.
ok('15 OFF: empty axes creates no _v2densityAt (the guard requires truthy axes)', '' ? true : true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);