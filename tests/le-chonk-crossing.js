// le-chonk (10-31 ~18:10): endlessCrossing — opt-in level crossings on endless open tiles. OFF = byte-identical.
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim;
const anim = fs.readFileSync(ROOT + '/js/drive-anim.js', 'utf8');
const ckFile = path.join(ROOT, 'js', 'cache-keys.js');
const ck = fs.existsSync(ckFile) ? fs.readFileSync(ckFile, 'utf8') : '';
const hasCacheKey = anim.includes("cacheKey('animScene'");
let crossings = 0, adjacent = 0, bad = 0, nearTunnel = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 1; k < 300; k++) {
  const t = A.endlessTile(seed, k), p = A.endlessTile(seed, k - 1);
  if (t.crossing) { crossings++; if (p.crossing) adjacent++; if (t.kind !== 'straight' || t.biome !== 'open') bad++; if (p.tunnel || A.endlessTile(seed, k + 1).tunnel) nearTunnel++; }
}
ok('level crossings occur across seeds (open, straight tiles only)', crossings > 25 && bad === 0, { crossings, bad });
ok('never adjacent to another crossing or a tunnel', adjacent === 0 && nearTunnel === 0, { adjacent, nearTunnel });
ok('OFF inert: t.crossing = false default + src.tiles carries endlessCrossing', anim.includes('t.crossing = false;') && anim.includes('crossing: !!o.endlessCrossing,'));
ok('tileWorld builds ballast + 2 rails + ties + crossbucks, gated on cfg.crossing && tile.crossing && wild', anim.includes("if (cfg.crossing && tile.crossing && cfg.flags.wild !== false)") && (anim.match(/cls: 'crossing'/g) || []).length >= 5 && anim.includes("for (const ro of [-0.75, 0.75])"));
ok('crossbucks behind the signs consent flag', anim.includes('if (cfg.flags.signs !== false) for (const sd of [-1, 1]) { const sq'));
ok('wiring: skey/tkey/toggle', (anim.includes('!!o.endlessCrossing') || (hasCacheKey && ck.includes("'endlessCrossing'"))) && anim.includes("'data-anim': 'endlessCrossing'"));
let laybys = 0, layAdj = 0, layBad = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 1; k < 300; k++) { const t = A.endlessTile(seed, k), p = A.endlessTile(seed, k - 1);
  if (t.layby) { laybys++; if (p.layby || A.endlessTile(seed, k + 1).layby) layAdj++; if (t.kind !== 'straight' || t.biome !== 'open' || t.crossing) layBad++; } }
ok('laybys: seeded open straight tiles, never adjacent, never on a crossing tile', laybys > 20 && layAdj === 0 && layBad === 0, { laybys, layAdj, layBad });
ok('layby builds strip + parked car + sign (signs flag), behind wild', anim.includes("if (tile.layby && cfg.flags.wild !== false)") && anim.includes('KP.parkedCar(ls + 10, edgeL + 3.5)') && anim.includes("cls: 'layby'") && anim.includes("mat: 'asphalt', cls: 'layby'"));
ok('crossing adjacency uses hash neighbours (no endlessTile recursion)', anim.includes('hash neighbours'));
let fuels = 0, fAdj = 0, fBad = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 1; k < 300; k++) { const t = A.endlessTile(seed, k), p = A.endlessTile(seed, k - 1);
  if (t.fuel) { fuels++; if (p.fuel || A.endlessTile(seed, k + 1).fuel) fAdj++; if (t.kind !== 'straight' || t.biome !== 'open' || t.crossing || t.layby) fBad++; } }
ok('fuel stations: seeded open straight tiles, never adjacent, never on layby/crossing', fuels > 15 && fAdj === 0 && fBad === 0, { fuels, fAdj, fBad });
ok('fuel builds apron + canopy on 4 columns + fascia + 2 pumps + price sign (signs), behind wild', anim.includes("if (tile.fuel && cfg.flags.wild !== false)") && (anim.match(/cls: 'fuel'/g) || []).length >= 8 && anim.includes("mat: 'sign-yellow', cls: 'fuel'"));
console.log(fail === 0 ? `\nall ${pass} le-chonk-crossing checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
