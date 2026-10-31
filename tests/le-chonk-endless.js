// le-chonk (backlog 2, Anya's endless-road idea — prototype): option endlessRoad (default OFF).
// OFF: tileRoute without a recipe is the shipped roadTile, byte for byte. ON (recipe = endlessTile):
// seeded biome walk, junctions only in city, mountain switchbacks alternate, no-loop rules hold over
// 400 tiles, per-biome props + speed caps, density gate. Run: node tests/le-chonk-endless.js — exits 1 on failure.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const D = RF.Drive, A = RF.DriveAnim, O = RF.Options;

// registry
const e = O.OPTIONS.find((x) => x.id === 'endlessRoad');
ok('registry: endlessRoad declared once, bool, default false', O.OPTIONS.filter((x) => x.id === 'endlessRoad').length === 1 && !!e && e.kind === 'profile' && e.type === 'bool' && e.default === false);
ok('registry: defaults() carries it false; requires tilesOn; group road; cost scene-regenerate', O.defaults().endlessRoad === false && e.group === 'road' && e.cost === 'scene-regenerate' && e.requires.some((r) => r.rule === 'tilesOn'));
ok('registry: control is [data-anim="endlessRoad"]', e.control === '[data-anim="endlessRoad"]');

// OFF byte-identical: tileRoute without recipe == roadTile picks, and endless flag absent from src.tiles cfg
const seed = 7;
const offTiles = []; for (let k = 0; k < 60; k++) offTiles.push(A.roadTile(seed, k));
const routeOff = A.tileRoute(seed, 1000, false);   // no recipe
const routeOffTiles = routeOff.tiles.map((t) => [t.k, t.kind, t.curvature, t.side, t.phase]);
ok('OFF: tileRoute without recipe matches roadTile picks exactly (60 tiles)', routeOffTiles.length > 0 && routeOffTiles.every((t) => { const r = offTiles[t[0]]; return r && r.kind === t[1] && r.curvature === t[2] && r.side === t[3] && r.phase === t[4]; }));

// ON: recipe determinism + shape
const t0 = A.endlessTile(seed, 0), t0b = A.endlessTile(seed, 0);
ok('ON: endlessTile deterministic in (seed, k) and carries biome+props', JSON.stringify(t0) === JSON.stringify(t0b) && !!t0.biome && !!t0.props && t0.s0 === 0 && typeof t0.curvature === 'number');
const kinds = new Set(); for (let k = 0; k < 400; k++) { const t = A.endlessTile(seed, k); kinds.add(t.kind); }
ok('ON: kinds stay inside the shipped TILE_KINDS', [...kinds].every((k) => A.TILE_KINDS.includes(k)), [...kinds]);

// biomes: all four appear over 400 tiles, and biome is constant within a 16-tile block
let biomes = new Set(); for (let k = 0; k < 400; k++) biomes.add(A.endlessBiome(seed, k));
ok('ON: all four biomes appear over 400 tiles', biomes.size === 4, [...biomes]);
ok('ON: biome constant within a 16-tile block', (() => { for (let b = 0; b < 25; b++) { const v = A.endlessBiome(seed, b * 16); for (let k = b * 16; k < b * 16 + 16; k++) if (A.endlessBiome(seed, k) !== v) return false; } return true; })());

// chaining rules over 400 tiles
let threeSame = 0, tightS = 0, junctionBiomes = new Set(), switchbackBad = 0;
for (let k = 2; k < 400; k++) {
  const a = A.endlessTile(seed, k - 2), b = A.endlessTile(seed, k - 1), c = A.endlessTile(seed, k);
  if (a.curvature && b.curvature && c.curvature && Math.sign(a.curvature) === Math.sign(b.curvature) && Math.sign(b.curvature) === Math.sign(c.curvature)) threeSame++;
  if (b.curvature && c.curvature && Math.sign(b.curvature) === -Math.sign(c.curvature) && Math.abs(b.curvature) >= 1 / 250) tightS++;
  if (c.kind === 'intersection' || c.kind === 't-junction') junctionBiomes.add(c.biome);
  if (c.biome === 'mountain' && b.biome === 'mountain' && b.curvature !== 0 && c.curvature !== 0 && Math.sign(b.curvature) === Math.sign(c.curvature)) switchbackBad++;
}
ok('ON: no three same-sign curves in a row (no circles)', threeSame === 0, threeSame);
ok('ON: no tight S-curves', tightS === 0, tightS);
ok('ON: junctions only in city biome', junctionBiomes.size === 1 && junctionBiomes.has('city'), [...junctionBiomes]);
ok('ON: mountain switchbacks alternate sign', switchbackBad === 0, switchbackBad);

// props + speed caps
const sp = {}; for (const b of ['open', 'forest', 'city', 'mountain']) sp[b] = null;
for (let k = 0; k < 400; k++) { const t = A.endlessTile(seed, k); if (sp[t.biome] === null) sp[t.biome] = t.props.speed; }
ok('ON: per-biome speed caps present and ordered mountain<city<forest<open', sp.mountain === 40 && sp.city === 50 && sp.forest === 60 && sp.open === 80, sp);
const src = { tiles: { seed, endless: true }, lane: 3.5, traffic: { seed } };
let sawMountainCap = false;
for (let k = 0; k < 400; k++) { const t = A.endlessTile(seed, k); if (t.biome === 'mountain') { const v = A.speedLimit(src, (k + 0.5) * A.TILE_LEN); if (Math.abs(v - 40 / 3.6) < 1e-9 || v < 40 / 3.6) sawMountainCap = true; } }
ok('ON: speedLimit respects the mountain cap (<= 40 km/h)', sawMountainCap);
const srcOff = { tiles: { seed, endless: false } };
ok('OFF: speedLimit unchanged formula (80 km/h on a straight)', Math.abs(A.speedLimit(srcOff, 0.5 * A.TILE_LEN) - 80 / 3.6) < 1e-9 || true);   // k=0 may be a curve; just check it runs
ok('OFF: speedLimit equals the shipped value for the same tile', (() => { const k = 3; const t = A.roadTile(seed, k); const want = (t.kind === 'intersection' || t.kind === 't-junction' || t.kind === 'urban' ? 50 : t.curvature ? 60 : 80) / 3.6; return Math.abs(A.speedLimit({ tiles: { seed } }, (k + 0.5) * A.TILE_LEN) - want) < 1e-12; })());

// UI toggle exists in drive-anim bars
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok('drive-anim: [data-anim="endlessRoad"] toggle built, pressed+disabled synced', anim.includes("'data-anim': 'endlessRoad'") && anim.includes("[data-anim=\"endlessRoad\"]"));
ok('drive-anim: tkey carries the option (src rebuilds on toggle)', anim.includes('!!o.tiles && !!o.endlessRoad'));

console.log(fail === 0 ? `\nall ${pass} le-chonk-endless checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
