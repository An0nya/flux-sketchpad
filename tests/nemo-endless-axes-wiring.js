// nemo — endless-road-v2 phase 2: wire endlessAxes through the tile GEOMETRY.
// endlessTile now threads src.tiles.axes → endlessTileShaped → endlessTileRaw, where an ACTIVE axes
// string swaps RF.EndlessSettlementRoad.settlementRoadAt(seed,k,axes).tileWeights in for the biome
// default (precedence custom.weights > switchbacks > axes > biome). The memo key carries axes so two
// axes strings never collide. OFF (axes='') must be byte-identical to the legacy 4-arg call.
// Run: node tests/nemo-endless-axes-wiring.js — exits 1 on failure.
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
// drive-anim is in load.js FILES; the endless-road-v2 data modules are not, so pass them as extra
// (same order index.html loads them: axis-config before settlement-road, which consumes RF.EndlessAxes).
const RF = load(['endless-axis-config', 'endless-relief', 'endless-settlement-road']);
const A = RF.DriveAnim, AX = RF.EndlessAxes, SR = RF.EndlessSettlementRoad;

ok('modules: RF.EndlessAxes + RF.EndlessSettlementRoad present (v2 tags landed; load.js extra loads them for node)',
  !!AX && !!SR && typeof SR.settlementRoadAt === 'function' && typeof AX.fromUi === 'function');

// two clearly different FIXED axes configs (relief/cover/water left auto so only settlement+roadClass steer weights)
const autoRW = { relief: { lo: 'auto', hi: 'auto' }, cover: { lo: 'auto', hi: 'auto' }, water: { lo: 'auto', hi: 'auto' } };
const axesCity = AX.fromUi(Object.assign({ settlement: { lo: 'city', hi: 'city' }, roadClass: { lo: 'street', hi: 'street' } }, autoRW), 1);
const axesWild = AX.fromUi(Object.assign({ settlement: { lo: 'wild', hi: 'wild' }, roadClass: { lo: 'dense-highway', hi: 'dense-highway' } }, autoRW), 1);
ok('axes: fromUi produced two distinct non-empty JSON strings', axesCity !== '' && axesWild !== '' && axesCity !== axesWild);

// the override SOURCE is real: settlementRoadAt names all 8 kinds, clamped, and city vs wild differ
const wCity = SR.settlementRoadAt(7, 5, axesCity).tileWeights, wWild = SR.settlementRoadAt(7, 5, axesWild).tileWeights;
ok('settlementRoadAt: tileWeights names all 8 TILE_KINDS, clamped ≥0',
  A.TILE_KINDS.every((kd) => typeof wCity[kd] === 'number' && wCity[kd] >= 0) && A.TILE_KINDS.every((kd) => typeof wWild[kd] === 'number' && wWild[kd] >= 0));
ok('settlementRoadAt: city vs wild weights differ (axes actually steer the kind mix)', JSON.stringify(wCity) !== JSON.stringify(wWild));

const seed = 7;

// 1. OFF byte-identical: the legacy 4-arg call === the 5-arg call with axes='' (axes defaults to '')
let offSame = true; const offBad = [];
for (let k = 0; k < 80; k++) {
  if (JSON.stringify(A.endlessTile(seed, k, 'off', null)) !== JSON.stringify(A.endlessTile(seed, k, 'off', null, ''))) { offSame = false; offBad.push(k); }
}
ok('OFF: endlessTile(seed,k,preset,custom) === endlessTile(...,"") over 80 tiles (byte-identical; axes defaults to "")', offSame, offBad);

// 2. ON end-to-end: an active axes string changes the shaped tile somewhere (the override reaches endlessTile)
let diffTiles = 0;
for (let k = 0; k < 200; k++) {
  if (JSON.stringify(A.endlessTile(seed, k, 'off', null, '')) !== JSON.stringify(A.endlessTile(seed, k, 'off', null, axesCity))) diffTiles++;
}
ok('ON: fixed city axes change ≥1 shaped tile over 200 (tileWeights override is wired through, not just declared)', diffTiles > 0, diffTiles + ' differing tiles');

// 3. determinism: same axes string, same (seed,k) → identical tile
ok('ON: deterministic — same axes gives an identical tile on repeat calls',
  JSON.stringify(A.endlessTile(seed, 42, 'off', null, axesCity)) === JSON.stringify(A.endlessTile(seed, 42, 'off', null, axesCity)));

// 4. the memo key carries axes: same axes → the SAME (===) memoized object; different axes → no collision
const tCity1 = A.endlessTile(seed, 9, 'off', null, axesCity);
const tCity2 = A.endlessTile(seed, 9, 'off', null, axesCity);
const tWild = A.endlessTile(seed, 9, 'off', null, axesWild);
ok('memo: a repeat call with the same axes returns the identical (===) memoized object', tCity1 === tCity2);
ok('memo: different axes at the same (seed,k) are separate entries (distinct object references — the key carries axes, so no collision; content divergence is check #2)', tCity1 !== tWild);

// 5. axes steer the kind mix, not the biome walk (endlessBiome is axes-independent)
ok('axes leave the biome walk untouched (tile.biome is the same with and without axes)', (() => {
  for (let k = 0; k < 80; k++) if (A.endlessTile(seed, k, 'off', null, axesCity).biome !== A.endlessTile(seed, k, 'off', null, '').biome) return false;
  return true;
})());

// 6. precedence: preset=switchbacks beats axes (custom.weights > switchbacks > axes > biome)
let swSame = true; const swBad = [];
for (let k = 0; k < 60; k++) {
  if (JSON.stringify(A.endlessTile(seed, k, 'switchbacks', null, axesCity)) !== JSON.stringify(A.endlessTile(seed, k, 'switchbacks', null, ''))) { swSame = false; swBad.push(k); }
}
ok('precedence: preset=switchbacks overrides axes (switchbacks > axes)', swSame, swBad);

// 7. precedence: custom.weights beats axes
const custom = { weights: { straight: 1, '250R': 0, '250L': 0, '150R': 0, '150L': 0, intersection: 0, 't-junction': 0, urban: 0 } };
let cuSame = true; const cuBad = [];
for (let k = 0; k < 60; k++) {
  if (JSON.stringify(A.endlessTile(seed, k, 'off', custom, axesCity)) !== JSON.stringify(A.endlessTile(seed, k, 'off', custom, ''))) { cuSame = false; cuBad.push(k); }
}
ok('precedence: custom.weights overrides axes (custom > axes)', cuSame, cuBad);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
