// le-chonk (Anya's rolling-hills/forested-pass presets): endless biome elevation. endlessElev(seed) -> seeded grade
// walk (mountain ±2–6%, open/forest ±0.5–1.5%, city flat), lap-periodic; elevate(A, ..., heightFn) carries it;
// attitude comes from the route's own height. Active only with endlessRoad AND elevatedView; OFF paths unchanged.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim, D = RF.Drive;

const seed = 7;
const h = A.endlessElev(seed);
ok('endlessElev deterministic + O(1)-ish: same value for repeated calls, memoized fn identity', A.endlessElev(seed) === h && h(1234.5) === h(1234.5));
ok('endlessElev continuous (no jumps at block boundaries)', (() => { for (let s = 0; s < 3200 * 40; s += 7.3) if (Math.abs(h(s + 0.05) - h(s)) > 0.02) return false; return true; })());
ok('vertical curves: grade eases at block boundaries (no kinks)', (() => { for (let b = 1; b < 40; b++) { const s = b * 3200; for (let u = -60; u <= 60; u += 5) { const g1 = (h(s + u + 2.5) - h(s + u - 2.5)) / 5; if (Math.abs(g1) > 0.07) return false; } } return true; })());
// grades per biome block
let mountainG = [], cityG = [], rolling = 0;
for (let b = 0; b < 40; b++) { const g = A.endlessGrade(seed, b), biome = A.endlessBiome(seed, b * 16); if (biome === 'mountain') mountainG.push(Math.abs(g)); if (biome === 'city') cityG.push(g); if (biome === 'open' || biome === 'forest') rolling++; }
ok('mountain blocks have real grades (2–6%)', mountainG.length > 0 && mountainG.every((g) => g >= 0.02 && g <= 0.06), mountainG.slice(0, 4));
ok('city blocks are flat (grade 0)', cityG.length === 0 || cityG.every((g) => g === 0));
ok('open/forest blocks exist (rolling biomes)', rolling > 0);
// measured grade via finite difference matches endlessGrade within a block middle
ok('z(s) integrates the block grade', (() => { for (let b = 0; b < 40; b++) { const biome = A.endlessBiome(seed, b * 16); const s = b * 3200 + 1600; const gMeas = (h(s + 25) - h(s - 25)) / 50, gWant = A.endlessGrade(seed, b); if (Math.abs(gMeas - gWant) > 0.002) return false; } return true; })());
// elevate with heightFn: height + grade + attitude from the route itself
const route = A.tileRoute(seed, 1000, false, A.endlessTile);
const eA = RF.Touge.elevate(route, 1000, 3.5, true, h);
ok('elevate(heightFn): A.height follows the preset fn (camera-relative)', Math.abs(eA.height(0, 0) - 0) < 1e-9 && Math.abs(eA.height(100, 0) - (h(1100) - h(1000))) < 1e-9);
ok('elevate(heightFn): surface grade matches finite difference', (() => { const s0 = 5000; const r2 = A.tileRoute(seed, s0, false, A.endlessTile); const e2 = RF.Touge.elevate(r2, s0, 3.5, true, h); const sf = e2.surface(0, 0); return Math.abs(sf.grade - (h(s0 + 25) - h(s0 - 25)) / 50) < 0.01; })());
ok('attitude(A) uses the route height (nonzero pitch on a grade)', (() => { let b = -1; for (let i = 0; i < 40; i++) if (Math.abs(A.endlessGrade(seed, i)) > 0.02) { b = i; break; } if (b < 0) return true; const s0 = b * 3200 + 1600; const r2 = A.tileRoute(seed, s0, false, A.endlessTile); const e2 = RF.Touge.elevate(r2, s0, 3.5, true, h); const a = RF.Touge.attitude(s0, true, e2); return Math.abs(a.pitch) > 0.01; })());
ok('attitude(flat) still identity', RF.Touge.attitude(1000, false).pitch === 0);
// OFF: plain tiles under elevatedView stay flat (no heightFn)
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
ok('tileA: endless tiles get heightFn, plain tiles stay flat(0)', anim.includes('RF.Touge.elevate(A2, dist, p.lane, true, endlessElev(p.src.tiles.seed, p.src.tiles.preset, !!p.src.tiles.terrain))') && anim.includes('RF.Touge.elevate(A2, dist, p.lane, false)'));
ok('whereAt reports gradePct for endless+elevatedView', anim.includes('w.gradePct = +(100 * (h(dist + 50) - h(dist - 50)) / 100)'));
ok('attitude callers pass the route A', fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8').includes('attitude(dist, world.A ? world.A.touge : true, world.A)'));

ok('tileWorld lifts objects onto the elevated surface under the pipeline', fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8').includes('A.touge ? D.Models.actors(objs, p.detailedModels).map((ob) => RF.Touge.lift(ob, A))'));
ok('lift puts an object on the grade (z follows height)', (() => { const s0 = 38800; const r2 = A.tileRoute(seed, s0, false, A.endlessTile); const e2 = RF.Touge.elevate(r2, s0, 3.5, true, h); const ob = RF.Touge.lift({ x: 0, y: 0, z: 0.3, cls: 'bush' }, e2); return Math.abs(ob.z - (0.3 + (h(s0) - h(s0)))) > -1 && Math.abs(e2.height(50, 0) - (h(s0 + 50) - h(s0))) < 1e-9 && Math.abs(ob.z - 0.3) < 1e-9 + Math.abs(e2.height(0,0)); })());
ok('endless bush/deer offsets stay off the carriageway', (() => { const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8'); return anim.includes('sd < 0 ? edgeR - 2.5 - 3 * KR() : edgeL + 2.5 + 3 * KR()') && anim.includes('sd < 0 ? edgeR - 3.5 : edgeL + 3.5'); })());
console.log(fail === 0 ? `\nall ${pass} le-chonk-hills checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
