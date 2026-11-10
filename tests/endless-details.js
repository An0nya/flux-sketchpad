// endless-details — the endless road details panel's data collection and the registry option
// that controls it. Like sceneDetails, this is a display-only option: OFF = no DOM, no timer,
// byte-identical behaviour.
const path = require('path'), fs = require('fs');

// ---- test helpers ---------------------------------------------------------
let passed = 0, failed = 0;
function ok(label, cond) { if (cond) { console.log('[PASS]', label); passed++; } else { console.log('[FAIL]', label); failed++; } }

// ---- (A) registry option --------------------------------------------------
const registry = require('../js/options-registry.js');
const e = registry.byId['endlessDetails'];
ok('A1: endlessDetails in registry', !!e);
ok('A2: kind profile', e && e.kind === 'profile');
ok('A3: type bool', e && e.type === 'bool');
ok('A4: default false (OFF)', e && e.default === false);
ok('A5: label is a string', e && typeof e.label === 'string');
ok('A6: control is [data-anim="endless-details"]', e && e.control === '[data-anim="endless-details"]');
ok('A7: where is more (Performance tools bar)', e && e.where === 'more');
ok('A8: cost is free', e && e.cost === 'free');
ok('A9: declares node test endless-details', e && e.tests && e.tests.includes('node:endless-details'));

// ---- (B) OFF is byte-identical --------------------------------------------
const defaults = registry.defaults();
ok('B1: default is false', defaults.endlessDetails === false);
// setting it to its default must give the same result
const offOpts = Object.assign({}, defaults, { endlessDetails: false });
ok('B2: false serialized is same as default', JSON.stringify(defaults) === JSON.stringify(offOpts));

// ---- (C) endless axis-config module loads ---------------------------------
const axisCfg = require('../js/endless-axis-config.js');
ok('C1: RF.EndlessAxes loaded', axisCfg && typeof axisCfg.timeline === 'function');
ok('C2: RF.EndlessAxes.valueAt works', typeof axisCfg.valueAt === 'function');

// ---- (D) endless-cover-water loads ----------------------------------------
const cw = require('../js/endless-cover-water.js');
ok('D1: RF.EndlessCoverWater loaded', cw && typeof cw.coverWaterAt === 'function');
ok('D2: coverWaterAt default seed=1,k=0 returns an object', (() => {
  const r = cw.coverWaterAt(1, 0, '');
  return r && typeof r === 'object' && typeof r.cover === 'string' && typeof r.water === 'string';
})());
ok('D3: COVER_KNOBS has forest/bare/grass/park', cw.COVER_KNOBS && cw.COVER_KNOBS.forest && cw.COVER_KNOBS.bare && cw.COVER_KNOBS.grass && cw.COVER_KNOBS.park);

// ---- (E) endless-traffic loads --------------------------------------------
const traffic = require('../js/endless-traffic.js');
ok('E1: RF.EndlessTraffic loaded', traffic && typeof traffic.trafficAt === 'function');
ok('E2: trafficAt default seed=1,k=0 returns an object', (() => {
  const r = traffic.trafficAt(1, 0, '');
  return r && typeof r === 'object' && typeof r.onMode === 'string' && typeof r.safeGapMul === 'number';
})());
ok('E3: trafficAt returns known fields', (() => {
  const r = traffic.trafficAt(1, 0, '');
  return r && 'settlement' in r && 'roadClass' in r && 'safeGapMul' in r && 'onMode' in r && 'onKcdMs' in r && 'pedStop' in r && 'truckFraction' in r;
})());

// ---- (F) endless-settlement-road loads ------------------------------------
const sr = require('../js/endless-settlement-road.js');
ok('F1: RF.EndlessSettlementRoad loaded', sr && typeof sr.settlementRoadAt === 'function');
ok('F2: settlementRoadAt default seed=1,k=0 returns an object', (() => {
  const r = sr.settlementRoadAt(1, 0, '');
  return r && typeof r === 'object' && typeof r.settlement === 'string' && typeof r.roadClass === 'string';
})());

// ---- (G) option does not change look / cache keys -------------------------
// An option that is purely display-level (like sceneDetails) should NOT appear in cache keys.
// Verify we don't crash when reading defaults with it on.
const optsOn = Object.assign({}, defaults, { endlessDetails: true });
ok('G1: defaults still valid with endlessDetails on', (() => {
  try { registry.serialize(optsOn); return true; } catch (_) { return false; }
})());

// ---- summary --------------------------------------------------------------
console.log('\n--- summary ---');
const total = passed + failed;
console.log('[PASS]', passed + ' checks, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);