// le-chonk (10-31): per-biome verge scenery for the endless tiles — endlessVerge(seed, k) drives the tile loop's
// props (forest trees, mountain rocks + rails, city frontage, open fences) with a boundary ramp. Default-OFF
// features only; the shipped roadTile/endlessTile walks are unchanged.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim;
const seed = 7;

ok('endlessVerge exported + deterministic', A.endlessVerge(seed, 50) && JSON.stringify(A.endlessVerge(seed, 50)) === JSON.stringify(A.endlessVerge(seed, 50)));
ok('verge biome matches the tile biome', (() => { for (let k = 0; k < 300; k++) if (A.endlessVerge(seed, k).biome !== A.endlessTile(seed, k).biome) return false; return true; })());
ok('forest tiles get trees, open/city/mountain do not', (() => { let f = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'forest') { f++; if (v.trees < 1) bad++; } else if (v.trees !== 0) bad++; } return f > 0 && bad === 0; })());
ok('mountain tiles get rocks + rail', (() => { let m = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'mountain') { m++; if (v.rocks < 1 || !v.rail) bad++; } else if (v.rail) bad++; } return m > 0 && bad === 0; })());
ok('city tiles get buildings, others do not', (() => { let c = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'city') { c++; if (v.buildings < 1) bad++; } else if (v.buildings !== 0) bad++; } return c > 0 && bad === 0; })());
ok('open tiles get fences, others do not', (() => { let o = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'open') { o++; if (!v.fence && v.ramp > 0.5) bad++; } else if (v.fence) bad++; } return o > 0 && bad === 0; })());
ok('boundary ramp: first/last tile of a block carry less than mid-block', (() => { for (let b = 1; b < 20; b++) { const first = A.endlessVerge(seed, b * 16), last = A.endlessVerge(seed, b * 16 + 15), mid = A.endlessVerge(seed, b * 16 + 8); if (!(first.ramp === 0.6 && last.ramp === 0.4 && mid.ramp === 1)) return false; } return true; })());
ok('props scale with the ramp (last tile of a forest block: fewer trees than a mid tile of the same density)', (() => { let lastSum = 0, midSum = 0, n = 0; for (let b = 1; b < 20; b++) { const l = A.endlessVerge(seed, b * 16 + 15), m = A.endlessVerge(seed, b * 16 + 8); if (l.biome === 'forest' && m.biome === 'forest') { lastSum += l.trees; midSum += m.trees; n++; } } return n === 0 || lastSum <= midSum; })());
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok('tileWorld consumes endlessVerge', anim.includes('const vg = endlessVerge(cfg.seed, tile.k)'));
ok('tile loop emits trees/rocks/buildings/fence per verge', anim.includes('KP.tree(tile.s0 + u - dist') && anim.includes("mat: 'gravel'") && anim.includes("mat: 'wall'") && anim.includes("mat: 'concrete'"));
ok('mountain blocks always railed (not preset-only)', anim.includes("tile.biome === 'mountain' && cfg.flags.posts !== false"));
ok('endlessVerge exported on RF.DriveAnim', 'endlessVerge' in A);
// OFF: plain (non-endless) tiles untouched
ok('roadTile walk unchanged (no verge in the plain tile recipe)', !anim.includes('endlessVerge(roadTile'));

// consent toggles (Anya 10-31: the procedural tile gen pulls from the user-set feature list — the existing scene flags)
ok('rails gated on the posts flag (consent: disable posts -> no guardrail)', anim.includes("tile.biome === 'mountain' && cfg.flags.posts !== false"));
ok('bushes/trees gated on veg, deer on animals, signs on signs, rocks/buildings/fences on wild', anim.includes('cfg.flags.veg !== false && bp') && anim.includes('cfg.flags.animals !== false') && anim.includes('cfg.flags.signs !== false') && (anim.match(/cfg\.flags\.wild !== false/g) || []).length >= 3);
// terrain opt-in: off -> heightFn ignores off (regression); on -> verge varies, road center unchanged
ok('tileTerrain off: endlessElev height is off-independent (road + verge on the pure grade walk)', (() => { const h = A.endlessElev(seed, 'off', false); return h(5000, 0) === h(5000, 30) && h(5000, -30) === h(5000, 0); })());
ok('tileTerrain on: verge varies with off beyond the carriageway, carriageway unchanged', (() => { const h = A.endlessElev(seed, 'off', true), h0 = A.endlessElev(seed, 'off', false); let varies = false; for (let s = 1000; s < 9000; s += 137) { if (h(s, 0) !== h0(s, 0)) return false; if (Math.abs(h(s, 12) - h(s, 0)) > 0.01 || Math.abs(h(s, -12) - h(s, 0)) > 0.01) varies = true; } return varies && h(5000, 2) === h0(5000, 2); })());
ok('tileTerrain deterministic + cached per (seed, preset, terrain)', A.endlessElev(seed, 'off', true) === A.endlessElev(seed, 'off', true) && A.endlessElev(seed, 'off', true) !== A.endlessElev(seed, 'off', false));
ok('src.tiles carries tileTerrain; tileA/tileWorld pass it to endlessElev', anim.includes('terrain: !!o.tileTerrain') && anim.includes('endlessElev(p.src.tiles.seed, p.src.tiles.preset, !!p.src.tiles.terrain)') && anim.includes('endlessElev(cfg.seed, cfg.preset, !!cfg.terrain)'));
ok('top-bar terrain toggle + tkey carries tileTerrain', anim.includes("'data-anim': 'tileTerrain'") && anim.includes('!!o.tileTerrain'));
const reg = fs.readFileSync(path.join(ROOT, 'js', 'options-registry.js'), 'utf8');
ok('registry: tileTerrain bool default false (pricy = opt-in)', reg.includes("id: 'tileTerrain'") && /id: 'tileTerrain'[^]*?default: false/.test(reg));
// creekside + suburbia (Anya's ideas, 10-31 ~03:55): open-biome tiles seeded as creek / suburb, behind the wild consent flag
ok('open tiles seed creeks and suburbia deterministically', (() => { let ck = 0, sb = 0; for (let k = 90; k < 130; k++) { const v = A.endlessVerge(seed, k); if (v.biome !== 'open') continue; if (v.creek) ck++; if (v.suburb) sb++; } return ck > 0 && sb > 0 && JSON.stringify(A.endlessVerge(seed, 96)) === JSON.stringify(A.endlessVerge(seed, 96)); })());
ok('creek side is ±1 and never on the carriageway', (() => { for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.creek && Math.abs(v.creek) !== 1) return false; } return true; })());
ok('tile loop emits the water channel + bank stones + reeds, gated on wild', anim.includes("mat: 'water', cls: 'creek'") && (anim.match(/mat: 'gravel'/g) || []).length >= 1 && anim.includes("vg.creek && cfg.flags.wild !== false"));
ok('suburb emits house + driveway mark + parked car, gated on wild', anim.includes("vg.suburb && cfg.flags.wild !== false") && anim.includes('KP.parkedCar') && anim.includes("mat: 'gravel', pat:"));
ok('water material appended last (existing MAT ids unmoved)', (() => { const D = RF.Drive; return D.MAT_KEYS.indexOf('water') === D.MAT_KEYS.length - 1 && D.MAT_KEYS.indexOf('asphalt') === 0 && D.MAT_KEYS.indexOf('sky') === 37; })());
// tile detail builds (10-31 ~04:20, catalogue #1/#2/#4/#9 cheap versions)
ok('detailed lamp head behind detailedModels (housing + lens)', anim.includes("if (p.detailedModels)") && (anim.match(/mat: 'lamp-head'/g) || []).length >= 2);
ok('city verge buildings get window boxes on the road face, behind wild', anim.includes("mat: KR() < 0.22 ? 'win-warm' : KR() < 0.3 ? 'win-cool' : 'win-dark'") && anim.includes('toward = sd < 0 ? 1 : -1'));
ok('viaduct piers on steep mountain blocks (>3.5% grade), behind wild', anim.includes("cls: 'pier'") && anim.includes("Math.abs(endlessGrade(cfg.seed, Math.floor(tile.k / 16), cfg.preset)) > 0.035"));
ok('direction-sign chevron glyph behind signs', anim.includes("KP.sign(gs, go, 'green'") && anim.includes("mat: 'white-paint' }); }   // direction sign + white chevron glyph"));
ok('pier z span reaches past the verge falloff (z0 -14)', anim.includes("z0: -14, z1: 0.05, mat: 'concrete', cls: 'pier'"));
// next tile batch (10-31 ~05:00): W-look double-beam rails, suburb facade windows, kilometer posts
ok('guardrail is a double beam (two stacked boxes) behind posts', (anim.match(/cls: 'rail' }/g) || []).length >= 1 && anim.includes("z0: .34, z1: .5") && anim.includes("z0: .62, z1: .9"));
ok('suburb houses get facade windows, behind wild', anim.includes('suburb facade windows') && anim.includes("mat: KR() < 0.3 ? 'win-warm' : 'win-dark'"));
ok('kilometer post every 1000 m on endless tiles at the right edge', anim.includes("tile.s0 % 1000 === 0") && anim.includes("edgeR - 1.6") && anim.includes("z0: 0, z1: 1.1, r: 0.05, mat: 'pole'"));
ok('km post gated on endless + signs flag', anim.includes('cfg.endless && cfg.flags.signs !== false && tile.s0 % 1000 === 0'));
console.log(fail === 0 ? `\nall ${pass} le-chonk-verge checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
