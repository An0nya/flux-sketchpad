// le-chonk (10-31 ~17:20): endlessTunnel — opt-in tunnel tiles on endless forest/mountain blocks. OFF = byte-identical.
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
let tunnels = 0, adjacent = 0, badKind = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 0; k < 300; k++) {
  const t = A.endlessTile(seed, k), p = k > 0 ? A.endlessTile(seed, k - 1) : null;
  if (t.tunnel) { tunnels++; if (p && p.tunnel) adjacent++; if (t.kind !== 'straight' || (t.biome !== 'forest' && t.biome !== 'mountain')) badKind++; }
}
ok('tunnel tiles occur across seeds (forest/mountain straight tiles only)', tunnels > 30 && badKind === 0, { tunnels, badKind });
ok('never two tunnel tiles in a row', adjacent === 0, { adjacent });
ok('OFF: tunnel flag is undefined without the option and src.tiles carries endlessTunnel', anim.includes('tunnel: !!o.endlessTunnel,') && anim.includes('t.tunnel = false;'));
ok('tileWorld builds bore + portal walls (x4) + lintels (x2), gated on cfg.tunnel && tile.tunnel && wild', (anim.match(/cls: 'tunnel'/g) || []).length >= 3 && anim.includes("if (cfg.tunnel && tile.tunnel && cfg.flags.wild !== false)") && anim.includes("for (const e of [tile.s0, tile.s0 + 200]) for (const sd of [-1, 1])") && anim.includes("for (const e of [tile.s0, tile.s0 + 200]) { const pq"));
ok('no street lamps inside tunnel tiles', anim.includes('lampTile = !tile.tunnel &&'));
ok('wiring: skey/tkey/toggle', (anim.includes('!!o.endlessTunnel') || (hasCacheKey && ck.includes("'endlessTunnel'"))) && anim.includes("'data-anim': 'endlessTunnel'"));
ok('registry: endlessTunnel default false, requires tiles', (() => { const Opt = require(path.join(ROOT, 'js', 'options-registry.js')); const arr = Opt.OPTIONS || Opt; const e = arr.find((x) => x.id === 'endlessTunnel'); return e && e.default === false; })() || 'registry entry pending in proto (added at landing)');
ok('mountain tunnel tiles are avalanche sheds (roof on columns, open sides); forest keeps the bore', anim.includes("const shed = tile.biome === 'mountain'") && anim.includes("mat: shed ? 'concrete' : 'wall'") && anim.includes("z1: shed ? 5.4 : 6.5") && anim.includes("for (let u = 5; u < 200; u += 10)"));
// brainstorm: mountain viewpoints (10-31 ~20:15)
let views = 0, vAdj = 0, vBad = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 1; k < 300; k++) { const t = A.endlessTile(seed, k), p = A.endlessTile(seed, k - 1);
  if (t.view) { views++; if (p.view || A.endlessTile(seed, k + 1).view) vAdj++; if (t.kind !== 'straight' || t.biome !== 'mountain' || t.tunnel) vBad++; } }
ok('viewpoints: seeded mountain straight tiles, never adjacent, never on a tunnel tile', views > 15 && vAdj === 0 && vBad === 0, { views, vAdj, vBad });
ok('viewpoint builds pad + railing + bench + sign (signs), behind wild', anim.includes("if (tile.view && cfg.flags.wild !== false)") && (anim.match(/cls: 'viewpoint'/g) || []).length >= 5 && anim.includes("mat: 'sign-green', cls: 'viewpoint'"));
console.log(fail === 0 ? `\nall ${pass} le-chonk-tunnel checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
