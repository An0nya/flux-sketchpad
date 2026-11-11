// endless-traffic-v2: verify the v2 traffic density wiring in drive-anim.js (barbicane 11-11)
// When endlessAxes is non-empty, trafficSource computes _v2densityAt(k) from the settlement+roadClass
// axes and trafficCars uses it instead of the biome density. OFF ('') is byte-identical.
// Run: node tests/endless-traffic-v2.js — exits 1 on failure.

const path = require('path'), fs = require('fs'), ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };

// Load the full app through load.js + the v2 data modules (same order as index.html)
const { load } = require('./load.js');
const RF = load(['endless-axis-config', 'endless-relief', 'endless-settlement-road', 'endless-cover-water', 'endless-traffic']);
const A = RF.DriveAnim, AX = RF.EndlessAxes;

ok('modules: RF.EndlessAxes + RF.DriveAnim present', !!AX && !!A && typeof A.endlessTile === 'function' && typeof AX.parse === 'function');

// --- source-slice: extract the app's V2_DENSITY from js/drive-anim.js ---
const drvSrc = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const dm = drvSrc.match(/const V2_DENSITY\s*=\s*(\{[\s\S]*?\}\s*\});/);
ok('source-slice: V2_DENSITY table found in drive-anim.js', !!dm);
if (!dm) { console.log(pass + ' passed, ' + fail + ' failed'); process.exit(1); }
const VD = (0, eval)('(' + dm[1].replace(/[\s;]+$/, '') + ')');
ok('source-sliced table: city+street = 1.5', VD.city && VD.city.street === 1.5, VD.city && VD.city.street);
ok('source-sliced table: wild+street = 0.3', VD.wild && VD.wild.street === 0.3, VD.wild && VD.wild.street);
ok('source-sliced table: wild+dense-highway = 1.0', VD.wild && VD.wild['dense-highway'] === 1.0, VD.wild && VD.wild['dense-highway']);

// --- ON: build a source with axes active, verify _v2densityAt exists and works ---
const axesF = AX.fromUi({
  settlement: { lo: 'city', hi: 'city' }, roadClass: { lo: 'street', hi: 'street' },
  relief: { lo: 'auto', hi: 'auto' }, cover: { lo: 'auto', hi: 'auto' }, water: { lo: 'auto', hi: 'auto' }
}, 1);
ok('axes: fromUi produced non-empty string', axesF !== '');

const baseOpts = { seed: 7, tiles: true, endlessRoad: true, trafficDensity: 1, oncoming: true, preceding: true, onKcd: 30, trafficMarkers: true };
const srcON = A.source('road', 3.5, false, {}, Object.assign({ endlessAxes: axesF }, baseOpts));
ok('ON: trafficSource created _v2densityAt on src.tiles', typeof srcON.tiles._v2densityAt === 'function', typeof srcON.tiles._v2densityAt);
ok('ON: _v2densityAt at k=10 (city+street) = 1.5', srcON.tiles._v2densityAt(10) === 1.5, srcON.tiles._v2densityAt(10));
ok('ON: _v2densityAt is cached (same tile same value)', srcON.tiles._v2densityAt(10) === srcON.tiles._v2densityAt(10));
ok('ON: _v2densityAt at k=50 (city+street, same fixed axes) = 1.5', srcON.tiles._v2densityAt(50) === 1.5, srcON.tiles._v2densityAt(50));

// --- OFF: empty axes → no _v2densityAt ---
const srcOFF = A.source('road', 3.5, false, {}, Object.assign({ endlessAxes: '' }, baseOpts));
ok('OFF: empty axes → _v2densityAt is undefined', srcOFF.tiles._v2densityAt === undefined, typeof srcOFF.tiles._v2densityAt);

// --- END-TO-END: trafficCars ON vs OFF differ ---
const carsON = A.trafficCars(srcON, 0, 0);
const carsOFF = A.trafficCars(srcOFF, 0, 0);
ok('trafficCars: ON (city+street density=1.5) produces cars near k=0', carsON.length > 0, carsON.length + ' cars');
ok('trafficCars: ON vs OFF car sets differ (density override changes car spawns)', JSON.stringify(carsON) !== JSON.stringify(carsOFF),
  'carsON=' + carsON.length + ' carsOFF=' + carsOFF.length);

// --- OFF identity: src with axes="" === src without endlessAxes option ---
const srcNoAxes = A.source('road', 3.5, false, {}, baseOpts);
const carsNoAxes = A.trafficCars(srcNoAxes, 0, 0);
ok('OFF identity: cars with axes="" === cars without endlessAxes option',
  JSON.stringify(carsOFF) === JSON.stringify(carsNoAxes),
  'carsOFF=' + carsOFF.length + ' carsNoAxes=' + carsNoAxes.length);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);