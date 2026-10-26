// SP2 (stage 3): the forest and the city are parameter sets for one generator (drive-scenes.js: generateScenery, SCENERY, sceneryParams).
// This file holds the three claims the generator must keep:
//  1. ORACLE: at the defaults the generator returns exactly what the old per-scene builders returned, for every flag combination, two seeds,
//     the kerb / lane placement, a second lane width and the US centre line. The old builders are copied below, verbatim from base a9cb102.
//  2. RATES: a rate of 0 removes its class and nothing else (the bushes stay where they were when the trees go, and so on); a rate above 1
//     adds items; the backdrop switched on in the forest leaves the trees and bushes where they were.
//  3. OPTIONS: ctx.scenery reaches the generator through the scene builder, and an unknown set name throws.
// Node: node tests/scenery-params.js — exits 1 on any failure.
const { load } = require('./load.js');

// ----- the old builders, verbatim from base a9cb102 (js/drive-scenes.js:168-207) -----
function legacyForest(ctx, o) {
  const D = RF_DRIVE, kit = RF_DRIVE.kit;
        const k = kit(ctx), R = ctx.rand;
        for (const side of [1, -1]) for (let s = 4; s < 280; s += 3.2 + 4 * R()) {
          const off = side > 0 ? k.edgeL + 2.6 + 9 * R() * R() : k.edgeR - 2.6 - 9 * R() * R();
          k.tree(s, off, { birch: R() < 0.18 });
          if (R() < 0.6) { const off2 = side > 0 ? k.edgeL + 12 + 28 * R() : k.edgeR - 12 - 28 * R(); k.tree(s + 2 * R(), off2); }
          if (R() < 0.35) k.bush(s + 1.5, side > 0 ? k.edgeL + 1.8 + 2 * R() : k.edgeR - 1.8 - 2 * R(), 0.5 + 0.5 * R());
        }
        for (let s = 25; s < 280; s += 50) k.post(s, k.edgeR - 0.9);
        if (o.signs) k.sign(115, k.edgeR - 2.0, 'yellow', { w: 0.8, h: 0.8 });
        if (o.animals) { k.deer(48, k.edgeR - 3.2); k.deer(88, k.edgeL + 3.0); k.deer(130, k.edgeL + 5.5); }
        if (o.people) { k.person(70, k.edgeR - 1.4, 'dark'); k.person(40, k.edgeL + 1.3, 'hivis'); }
        return { objects: k.O, markings: D.laneMarkings(ctx.Lw, { us: ctx.us }), verge: ['gravel', 1.0, 'leaves'] };
}
function legacyCity(ctx, o) {
  const D = RF_DRIVE, kit = RF_DRIVE.kit;
        const k = kit(ctx), R = ctx.rand, walk = 3.0, setback = 2.5, win = ({ u, z, face }, seed) => {   // windows on the faces seen from the road
          const gx = Math.floor((u + 400) / 2.6), gz = Math.floor(z / 3.2), cell = (u + 400) / 2.6 - gx, cz = z / 3.2 - gz;
          if (z < 3.0 || cell < 0.2 || cell > 0.8 || cz < 0.25 || cz > 0.8) return face === 0 ? 'wall-light' : 'wall';
          const h = Math.sin((gx + 1) * 12.9898 + (gz + 1) * 78.233 + seed * 3.1) * 43758.5453, f = h - Math.floor(h);
          return f < 0.22 ? 'win-warm' : f < 0.3 ? 'win-cool' : 'win-dark';
        };
        for (const side of [1, -1]) for (let s = -8, i = 0; s < 280; s += 15 + 14 * R(), i++) {
          const len = 12 + 10 * R(), hgt = 9 + 18 * R(), dep = 7 + 4 * R(), off = side > 0 ? k.edgeL + walk + setback + dep : k.edgeR - walk - setback - dep, p = k.at(s + len, off), seed = i + (side > 0 ? 0 : 50);
          k.add({ k: 'box', x: p.x, y: p.y, z0: 0, z1: hgt, hx: len, hy: dep, yaw: p.yaw, facadeStyle:seed%3, mat: (h) => win(h, seed) });
        }
        for (let s = 12; s < 280; s += 32) for (const side of [1, -1]) { const off = side > 0 ? k.edgeL + 0.9 : k.edgeR - 0.9; k.add({ k: 'cyl', x: k.at(s, off).x, y: k.at(s, off).y, r: 0.07, z0: 0, z1: 7.5, mat: 'pole' }); }
        for (let s = 20; s < 160; s += 11 + 9 * R()) k.parkedCar(s, k.edgeR - 1.3);
        for (let s = 30; s < 140; s += 17 + 10 * R()) k.parkedCar(s + 5, k.edgeL + 1.3 + 0.9);
        if (o.signs) { k.sign(75, k.edgeR - 1.0, 'white', { w: 0.6, h: 0.8, z0: 2.0 }); k.sign(135, k.edgeR - 1.0, 'green', { w: 1.4, h: 0.7, z0: 2.3 }); }
        // ctx.kerbPeople (set by the animated drive view only): the two walkers that stood in the lanes move to the right-hand pavement, so the still Spec scene is unchanged
        if (o.people) { ctx.kerbPeople ? (k.person(48, k.edgeR - 3.0, 'dark'), k.person(50, k.edgeR - 3.0, 'hivis')) : (k.person(48, 0.3, 'dark'), k.person(48.4, -1.4, 'hivis')); k.person(46, k.edgeL + 1.5, 'light'); k.person(92, k.edgeR - 2.0, 'dark'); }
        if (o.animals) k.deer(110, k.edgeL + 2.2);
        const marks = D.laneMarkings(ctx.Lw, { us: ctx.us });
        for (let b = k.edgeR + 0.4; b < k.edgeL - 0.2; b += 1.0) marks.push({ o0: b, o1: b + 0.5, mat: 'white-paint', pat: { s0: 40, s1: 1e5, period: 1e6, on: 3.5 } });   // zebra crossing, 40–43.5 m
        marks.push({ o0: k.edgeR, o1: 0.2 + ctx.Lw / 2 - 0.4, mat: 'white-paint', pat: { s0: 38, s1: 1e5, period: 1e6, on: 0.4 } });                                                 // stop line in our lane
        return { objects: k.O, markings: marks, verge: ['concrete', walk, 'concrete'] };
}
let RF_DRIVE = null;

// a stable text form of one object: functions (the facade and hi-vis materials) become their output at three sample points
function show(o) {
  const samples = [{ u: 1.3, z: 0.4, face: 0 }, { u: -20.7, z: 4.6, face: 1 }, { u: 2.2, z: 1.1, face: 0 }];
  return JSON.stringify(o, (key, v) => (typeof v === 'function' ? samples.map((s) => { try { return v(s); } catch (e) { return 'ERR'; } }).join('|') : v));
}
function same(a, b) {
  if (a.objects.length !== b.objects.length) return 'object count ' + a.objects.length + ' vs ' + b.objects.length;
  for (let i = 0; i < a.objects.length; i++) if (show(a.objects[i]) !== show(b.objects[i])) return 'object ' + i + ' differs: ' + show(a.objects[i]) + ' vs ' + show(b.objects[i]);
  if (show(a.markings) !== show(b.markings)) return 'markings differ';
  if (show(a.verge) !== show(b.verge)) return 'verge differs';
  return '';
}

function run(RFload, ok) {
  RF_DRIVE = RFload.Drive;
  const D = RF_DRIVE, F = D.generateScenery;
  // SEEDED-KINDS (Brief S): the legacy builders above hard-code the old fixed kinds ('dark', 'hivis'), so the oracle compares with globalThis.PED_FIXED_KINDS on.
  // The seeded default is checked in tests/ped-kinds.js. The flag is switched off again after the two oracle checks.
  globalThis.PED_FIXED_KINDS = true;
  // 1. oracle: both sets, all flag combinations, seeds, kerb and lane, two lane widths, US centre line
  const bad = [];
  let n = 0;
  for (const name of ['forest', 'city']) for (const seed of [7, 11, 123]) for (const Lw of [3.5, 3.0]) for (const us of [false, true]) for (const kerbPeople of [false, true]) for (const flags of [
    { people: true, animals: true, signs: true }, { people: false, animals: false, signs: false }, { people: true, animals: false, signs: false }, { people: false, animals: true, signs: true }, { people: false, animals: true, signs: false },
  ]) {
    const ctx = { Lw, A: null, us, seed, kerbPeople, density: 1.5, broken: false };
    const legacy = name === 'forest' ? legacyForest(Object.assign({}, ctx, { rand: D.rng(seed) }), flags) : legacyCity(Object.assign({}, ctx, { rand: D.rng(seed) }), flags);
    const now = F(name, Object.assign({}, ctx, { rand: D.rng(seed) }), flags);
    const diff = same(legacy, now); n++;
    if (diff) bad.push(name + ' seed ' + seed + ' Lw ' + Lw + ' us ' + us + ' kerb ' + kerbPeople + ' ' + JSON.stringify(flags) + ': ' + diff.slice(0, 160));
  }
  ok('SP2 oracle: the generator at the defaults equals the old forest and city builders (' + n + ' cases: 2 sets, 3 seeds, 2 widths, US line, kerb/lane, 5 flag sets)', bad.length === 0, bad.length ? bad.slice(0, 3).join(' | ') : 'all ' + n + ' cases equal');
  // and through the public builder (SCENES.forest.build / SCENES.city.build), the route the views use
  const viaBuilder = [];
  for (const name of ['forest', 'city']) { const ctx = { Lw: 3.5, A: null, us: false, seed: 7, kerbPeople: true, rand: D.rng(7) }; const legacy = name === 'forest' ? legacyForest(Object.assign({}, ctx, { rand: D.rng(7) }), { people: true, animals: true, signs: true }) : legacyCity(Object.assign({}, ctx, { rand: D.rng(7) }), { people: true, animals: true, signs: true }); const got = D.scenes[name].build(Object.assign({}, ctx, { rand: D.rng(7) }), { people: true, animals: true, signs: true }); const d = same(legacy, got); if (d) viaBuilder.push(name + ': ' + d.slice(0, 120)); }
  ok('SP2 oracle via the public builder: SCENES.forest.build and SCENES.city.build equal the old builders', viaBuilder.length === 0, viaBuilder.join(' | ') || 'both equal');
  globalThis.PED_FIXED_KINDS = false;

  // 2. rates: each class is compared with the default output, class by class (the rest must come out identical)
  const base = { people: true, animals: true, signs: true }, seed = 7;
  const ctxOf = (kerb) => ({ Lw: 3.5, A: null, us: false, seed, kerbPeople: !!kerb, density: 1.5, rand: D.rng(seed) });
  const vegOf = (r) => r.objects.filter((o) => o.cls === 'veg').map(show);
  const clsOf = (r, cls) => r.objects.filter((o) => o.cls === cls).map(show);
  const notCls = (r, cls) => r.objects.filter((o) => o.cls !== cls).map(show);
  const dflt = F('forest', ctxOf(), base);
  const treesOnly = vegOf(F('forest', ctxOf(), base, { roadside: { bushRate: 0 } }));           // the trees, with the bushes thinned out
  const bushesOnly = vegOf(dflt).filter((s) => !treesOnly.includes(s));                                // the bushes: default veg minus the trees
  ok('SP2 rates: treeRate 0 removes the trees and leaves every bush where it was (same objects, same order)',
    treesOnly.length > 0 && bushesOnly.length > 0 && JSON.stringify(vegOf(F('forest', ctxOf(), base, { roadside: { treeRate: 0 } }))) === JSON.stringify(bushesOnly),
    'trees ' + treesOnly.length + ', bushes ' + bushesOnly.length);
  ok('SP2 rates: bushRate 0 removes the bushes and leaves every tree where it was (same objects, same order)',
    JSON.stringify(vegOf(F('forest', ctxOf(), base, { roadside: { bushRate: 0 } }))) === JSON.stringify(treesOnly));
  const noDeer = F('forest', ctxOf(), base, { deer: { rate: 0 } });
  ok('SP2 rates: deerRate 0 removes the forest deer and nothing else moves',
    clsOf(noDeer, 'deer').length === 0 && clsOf(dflt, 'deer').length > 0 && JSON.stringify(notCls(noDeer, 'deer')) === JSON.stringify(notCls(dflt, 'deer')));
  const more = F('forest', ctxOf(), base, { roadside: { treeRate: 2 } }), moreVeg = vegOf(more);
  ok('SP2 rates: treeRate 2 adds trees; every default object is still there and the bushes are unchanged',
    vegOf(dflt).every((s) => moreVeg.includes(s)) && moreVeg.length > vegOf(dflt).length
    && moreVeg.filter((s) => bushesOnly.includes(s)).length === bushesOnly.length,
    'veg ' + moreVeg.length + ' vs ' + vegOf(dflt).length);
  const backdrop = F('forest', ctxOf(), base, { backdrop: { walk: 3, setback: 2.5, fresh: true } });
  const notBuilding = (r) => r.objects.filter((o) => o.facadeStyle === undefined).map(show);
  ok('SP2 backdrop: switching it on in the forest adds buildings and leaves every other object where it was (its own stream)',
    backdrop.objects.filter((o) => o.facadeStyle !== undefined).length > 0 && JSON.stringify(notBuilding(backdrop)) === JSON.stringify(notBuilding(dflt)),
    'buildings ' + backdrop.objects.filter((o) => o.facadeStyle !== undefined).length);
  const cityKerb = F('city', ctxOf(true), base), cityNoPeople = F('city', ctxOf(true), base, { people: { rate: 0 } });
  ok('SP2 rates: people rate 0 in the city removes the pedestrians and nothing else moves',
    clsOf(cityKerb, 'person').length > 0 && clsOf(cityNoPeople, 'person').length === 0 && JSON.stringify(notCls(cityNoPeople, 'person')) === JSON.stringify(notCls(cityKerb, 'person')));
  // 3. options
  // the animated view reaches the generator through source(): opts.scenery is the override layer
  { const flags = { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: false, rpm: true };
    const plainVeg = RFload.DriveAnim.source('forest', 3.5, false, flags, { seed: 7 }).objects.filter((o) => o.cls === 'veg').length;
    const noTreeVeg = RFload.DriveAnim.source('forest', 3.5, false, flags, { seed: 7, scenery: { roadside: { treeRate: 0 } } }).objects.filter((o) => o.cls === 'veg').length;
    ok('SP2 options: source() passes opts.scenery to the forest generator (treeRate 0 leaves fewer veg objects; no scenery option = the defaults)', noTreeVeg < plainVeg && noTreeVeg > 0, 'veg ' + noTreeVeg + ' vs ' + plainVeg); }
  let threw = false; try { F('road', ctxOf(), base); } catch (e) { threw = true; }
  ok('SP2 options: an unknown or non-generated set name throws (road is not a parameter set)', threw);
  const viaCtx = D.scenes.forest.build(Object.assign(ctxOf(), { scenery: { roadside: { treeRate: 0 } } }), base);
  ok('SP2 options: ctx.scenery reaches the forest builder (treeRate 0 removes trees through the public builder)', vegOf(viaCtx).length === bushesOnly.length && JSON.stringify(vegOf(viaCtx)) === JSON.stringify(bushesOnly) && treesOnly.length > 0);
  ok('SP2 options: sceneryParams merges overrides without mutating the set (a second call sees the defaults again)',
    D.sceneryParams('forest', { roadside: { treeRate: 0 } }).roadside.treeRate === 0 && D.SCENERY.forest.roadside.treeRate === 1 && D.sceneryParams('forest', {}).roadside.treeRate === 1);
}

module.exports = { run, legacyForest, legacyCity, show, same };
if (require.main === module) {
  let fails = 0;
  const RFload = load();
  run(RFload, (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all scenery params checks passed');
  process.exitCode = fails ? 1 : 0;
}
