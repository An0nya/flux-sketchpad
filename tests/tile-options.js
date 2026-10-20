// SP3 (stage 4): tile kinds and lamps as options. Node: node tests/tile-options.js — exits 1 on any failure.
// 1. roadTile(seed, k, weights): with no weights, or with every weight 1, the tile is byte-identical to the old formula (kind, side, phase, curvature)
//    over 1000 tiles. With other weights the kind changes, but side and phase do not: the kind takes exactly one draw, as before.
// 2. lampRule (source option, default 'urban-only' = today's lamps on junction and urban tiles, 4 per tile): 'off' places none,
//    'sparse' places 2 per tile on the same tiles, 'all' also lights the straights. The default is today's placement (the scene snapshot pins it).
const { load } = require('./load.js');
const { plan } = require('./scene-snapshot.js');

const TILE_LEN = 200, TILE_KINDS = ['straight', '250R', '250L', '150R', '150L', 'intersection', 't-junction', 'urban'];
// the old formula, copied from base a9cb102 (js/drive-anim.js:roadTile), for the oracle
function legacyTile(D, seed, k) {
  const R = D.rng((Math.imul(seed | 0, 2654435761) ^ Math.imul(k + 1, 0x85EBCA6B)) >>> 0), kind = TILE_KINDS[Math.floor(R() * TILE_KINDS.length)];
  return { k, s0: k * TILE_LEN, kind, curvature: /[RL]$/.test(kind) ? (kind.endsWith('L') ? 1 : -1) / parseInt(kind, 10) : 0, side: R() < 0.5 ? -1 : 1, phase: Math.floor(R() * 50) };
}

function run(RFload, ok) {
  const A = RFload.DriveAnim, D = RFload.Drive;
  // 1. roadTile oracle
  const allOnes = Object.fromEntries(TILE_KINDS.map((kd) => [kd, 1]));
  let bad = [], n = 0;
  for (let seed = 1; seed <= 5; seed++) for (let k = 0; k < 200; k++) {
    const want = JSON.stringify(legacyTile(D, seed, k)), a = JSON.stringify(A.roadTile(seed, k)), b = JSON.stringify(A.roadTile(seed, k, undefined)), c = JSON.stringify(A.roadTile(seed, k, allOnes));
    n++; if (a !== want || b !== want || c !== want) bad.push('seed ' + seed + ' k ' + k + ': ' + want + ' | ' + a + ' | ' + b + ' | ' + c);
  }
  ok('SP3 roadTile: no weights, undefined weights and all weights 1 give the old tile byte for byte (' + n + ' tiles)', bad.length === 0, bad.slice(0, 2).join(' || ') || 'all ' + n + ' tiles identical');
  // the weights change the kinds, and only the kinds: side and phase still come from the same draws
  const urbanless = { urban: 0 }, heavyJunctions = { intersection: 6, 't-junction': 6 };
  let kindsChanged = 0, shifted = [];
  for (let seed = 1; seed <= 5; seed++) for (let k = 0; k < 200; k++) {
    const want = legacyTile(D, seed, k);
    for (const w of [urbanless, heavyJunctions]) {
      const t = A.roadTile(seed, k, w);
      if (t.side !== want.side || t.phase !== want.phase) shifted.push(seed + ':' + k);
      if (t.kind !== want.kind) kindsChanged++;
    }
  }
  ok('SP3 roadTile weights: side and phase never move with the weights (one draw for the kind, as before)', shifted.length === 0, shifted.slice(0, 5).join(' ') || 'none moved');
  const noUrban = Array.from({ length: 1000 }, (_, i) => A.roadTile(1 + (i % 5), Math.floor(i / 5), urbanless)).filter((t) => t.kind === 'urban').length;
  ok('SP3 roadTile weights: urban weight 0 gives no urban tile in 1000, and the weights move the kinds (' + kindsChanged + ' kinds changed of 2000)', noUrban === 0 && kindsChanged > 0, 'urban ' + noUrban);
  // 2. lamp rule
  const lampsOf = (extra) => { const p = plan(RFload, 'road', extra); return A.tileWorld(p, 95, 2).objects.filter((o) => o.cls === 'street-lamp').length; };
  const dflt = lampsOf({}), urban = lampsOf({ lampRule: 'urban-only' }), off = lampsOf({ lampRule: 'off' }), sparse = lampsOf({ lampRule: 'sparse' }), all = lampsOf({ lampRule: 'all' });
  ok('SP3 lamp rule: the default is today\'s urban-only placement (explicit urban-only gives the same count)', dflt === urban && dflt > 0, 'default ' + dflt + ', urban-only ' + urban);
  ok('SP3 lamp rule: off places no street lamps', off === 0, 'off ' + off);
  ok('SP3 lamp rule: sparse places fewer lamps than urban-only and some (' + sparse + ' vs ' + urban + ')', sparse > 0 && sparse < urban, 'sparse ' + sparse);
  ok('SP3 lamp rule: all lights more lamps than urban-only, straights included (' + all + ' vs ' + urban + ')', all > urban, 'all ' + all);
}

module.exports = { run, legacyTile };
if (require.main === module) {
  let fails = 0;
  const RFload = load();
  run(RFload, (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all tile option checks passed');
  process.exitCode = fails ? 1 : 0;
}
