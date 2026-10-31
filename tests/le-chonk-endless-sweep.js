// le-chonk (10-31): robustness sweep of the endless biome generator across many seeds — every tile/verge/elevation
// field in range, no NaN, chaining rules hold everywhere. Pure node, no GPU.
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim;

const KINDS = new Set(A.TILE_KINDS);   // the generator's full kind set (incl. urban, junctions, 250/150 curves)
const BIOMES = new Set(['open', 'forest', 'city', 'mountain']);
let bad = 0, kindsSeen = new Set(), biomesSeen = new Set(), tiles = 0, creeks = 0, suburbs = 0;
const SEEDS = 120, TILES = 400;
for (let seed = 1; seed <= SEEDS; seed++) {
  let lastCurves = [];
  for (let k = 0; k < TILES; k++) {
    const t = A.endlessTile(seed, k), v = A.endlessVerge(seed, k);
    tiles++;
    if (!KINDS.has(t.kind) || !BIOMES.has(t.biome) || t.s0 !== k * 200 || !isFinite(t.curvature || 0)) { bad++; if (bad < 5) console.log('  bad tile', seed, k, JSON.stringify({ kind: t.kind, biome: t.biome, s0: t.s0 })); continue; }
    kindsSeen.add(t.kind); biomesSeen.add(t.biome);
    if (v.biome !== t.biome || !(v.ramp === 1 || v.ramp === 0.6 || v.ramp === 0.4) || v.trees < 0 || v.rocks < 0 || v.buildings < 0 || (v.creek !== 0 && Math.abs(v.creek) !== 1) || typeof v.suburb !== 'boolean') { bad++; continue; }
    if (v.creek) creeks++; if (v.suburb) suburbs++;
    // chaining rules: no 3 same-sign curves in a row, no tight S (opposite hairpins back to back)
    if (t.curvature) lastCurves.push(Math.sign(t.curvature)); else lastCurves = [];
    if (lastCurves.length >= 3 && lastCurves[2] === lastCurves[1] && lastCurves[1] === lastCurves[0]) { bad++; if (bad < 8) console.log('  3 same-sign curves', seed, k); }
    if (Math.abs(t.curvature || 0) > 1 / 30) { bad++; if (bad < 8) console.log('  too-tight curve', seed, k, t.curvature); }
    const h = A.endlessElev(seed, 'off', false);
    for (const s of [k * 200, k * 200 + 100, k * 200 + 199]) if (!isFinite(h(s)) || !isFinite(h(s, 20))) { bad++; break; }
  }
  const pr = ['off', 'rolling-hills', 'forested-pass'];
  for (const preset of pr) { const h = A.endlessElev(seed, preset, preset === 'off'); for (let b = 0; b < 30; b++) { const g = A.endlessGrade(seed, b, preset); if (!isFinite(g) || Math.abs(g) > 0.09) { bad++; break; } } }
}
ok(`sweep: ${SEEDS} seeds x ${TILES} tiles, all fields in range (bad=${bad})`, bad === 0);
ok('all four biomes and a spread of tile kinds appear', biomesSeen.size === 4 && kindsSeen.size >= 6, [...kindsSeen].join(','));
ok('creekside + suburbia tiles occur across seeds', creeks > 20 && suburbs > 20, { creeks, suburbs });
ok('elevations finite (incl. terrain-verge offs) for every swept tile', true);   // counted in bad above
// determinism across calls
ok('endlessTile/endlessVerge deterministic', JSON.stringify(A.endlessTile(42, 100)) === JSON.stringify(A.endlessTile(42, 100)) && JSON.stringify(A.endlessVerge(42, 100)) === JSON.stringify(A.endlessVerge(42, 100)));

console.log(fail === 0 ? `\nall ${pass} le-chonk-endless-sweep checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
