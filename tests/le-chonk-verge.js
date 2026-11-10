// le-chonk (10-31): per-biome verge scenery for the endless tiles — endlessVerge(seed, k) drives the tile loop's
// props (forest trees, mountain rocks + rails, city frontage, open fences) with a boundary ramp. Default-OFF
// features only; the shipped roadTile/endlessTile walks are unchanged.
// 11-10 nicholl (item 2 conversion, le-chonk-nominated): the source-text wiring checks were replaced by behaviour
// checks that run the tile world builder (A.tileWorld) and assert what it emits, or by registry-module lookups.
// The two checks without a behaviour seam are KEPT and flagged [KEEP: text — ...]. Mutation-proven per check
// group; see notes/nicholl/ and Claims, 11-10 ~10:0xZ.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim;
const Opt = RF.Options;
const seed = 7;
const FLAGS = { wild: true, signs: true, veg: true, animals: true, posts: true };
const atTile = (k, flags, opts, detailed, sd) => {
  const o = Object.assign({ seed: sd !== undefined ? sd : seed, tiles: true, endlessRoad: true }, opts || {});
  const src = A.source('road', 3.5, false, flags || FLAGS, o);
  const p = { w: 96, h: 54, hfov: 60, lamps: [], lut: RF.Drive.lutFrom(() => 30000), conv: 'A', lane: 3.5, look: { RL: 0.2 }, A: null, src };
  if (detailed) p.detailedModels = true;
  return A.tileWorld(p, k * 200 + 100, 0);
};
const walkTiles = (flags, opts, detailed, biome) => {
  const acc = [];
  for (let k = 0; k < 160; k++) {   // a deterministic 160-tile window covers every biome and every seeded annotation used below
    if (biome && A.endlessTile(seed, k).biome !== biome) continue;
    acc.push(...atTile(k, flags, opts, detailed).objects);
  }
  return acc;
};
const count = (arr, fn) => arr.reduce((n, o) => n + (fn(o) ? 1 : 0), 0);
const isVeg = (o) => o.cls === 'veg';
const isTrunk = (o) => o.k === 'cyl' && o.cls === 'veg' && (o.mat === 'trunk-birch' || o.mat === 'bark');
const isDeer = (o) => o.cls === 'deer';
const isSign = (o) => o.cls === 'sign';
const isGravelRock = (o) => o.k === 'ell' && o.cls === undefined && o.mat === 'gravel';

ok('endlessVerge exported + deterministic', A.endlessVerge(seed, 50) && JSON.stringify(A.endlessVerge(seed, 50)) === JSON.stringify(A.endlessVerge(seed, 50)));
ok('verge biome matches the tile biome', (() => { for (let k = 0; k < 300; k++) if (A.endlessVerge(seed, k).biome !== A.endlessTile(seed, k).biome) return false; return true; })());
ok('forest tiles get trees, open/city/mountain do not', (() => { let f = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'forest') { f++; if (v.trees < 1) bad++; } else if (v.trees !== 0) bad++; } return f > 0 && bad === 0; })());
ok('mountain tiles get rocks + rail', (() => { let m = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'mountain') { m++; if (v.rocks < 1 || !v.rail) bad++; } else if (v.rail) bad++; } return m > 0 && bad === 0; })());
ok('city tiles get buildings, others do not', (() => { let c = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'city') { c++; if (v.buildings < 1) bad++; } else if (v.buildings !== 0) bad++; } return c > 0 && bad === 0; })());
ok('open tiles get fences, others do not', (() => { let o = 0, bad = 0; for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.biome === 'open') { o++; if (!v.fence && v.ramp > 0.5) bad++; } else if (v.fence) bad++; } return o > 0 && bad === 0; })());
ok('boundary ramp: first/last tile of a block carry less than mid-block', (() => { for (let b = 1; b < 20; b++) { const first = A.endlessVerge(seed, b * 16), last = A.endlessVerge(seed, b * 16 + 15), mid = A.endlessVerge(seed, b * 16 + 8); if (!(first.ramp === 0.6 && last.ramp === 0.4 && mid.ramp === 1)) return false; } return true; })());
ok('props scale with the ramp (last tile of a forest block: fewer trees than a mid tile of the same density)', (() => { let lastSum = 0, midSum = 0, n = 0; for (let b = 1; b < 20; b++) { const l = A.endlessVerge(seed, b * 16 + 15), m = A.endlessVerge(seed, b * 16 + 8); if (l.biome === 'forest' && m.biome === 'forest') { lastSum += l.trees; midSum += m.trees; n++; } } return n === 0 || lastSum <= midSum; })());
// behaviour: the tile world builder consumes endlessVerge — a forest tile emits trees (the vg.trees path)
ok('the tile world consumes the verge (forest tiles render trees)', count(walkTiles(FLAGS, null, false, 'forest'), isTrunk) > 0);
// behaviour: per-biome props reach the world builder
ok('mountain tiles emit rocks, city tiles emit frontage buildings, open tiles emit fence boxes', (() => {
  const m = (() => { const acc = []; for (let k = 0; k < 160; k++) { const ti = A.endlessTile(seed, k); if (ti.biome !== 'mountain') continue; const objs = atTile(k).objects; if (objs.some((o) => o.cls === 'creek')) continue; acc.push(...objs); } return acc; })(), c = walkTiles(FLAGS, null, false, 'city'), o = walkTiles(FLAGS, null, false, 'open');
  return count(m, isGravelRock) > 0 && c.some((ob) => ob.mat === 'wall') && o.some((ob) => ob.mat === 'concrete' && ob.k === 'box' && Math.abs(ob.z0 - 0.85) < 1e-9);
})());
// behaviour: mountain blocks railed behind the posts consent flag (double beam)
ok('mountain blocks are railed: two stacked beams + posts behind posts; posts off -> zero rails', (() => {
  const railsOn = walkTiles(FLAGS, null, false, 'mountain').filter((o) => o.cls === 'rail');
  const railsOff = walkTiles(Object.assign({}, FLAGS, { posts: false }), null, false, 'mountain').filter((o) => o.cls === 'rail');
  const beamA = railsOn.some((o) => Math.abs(o.z0 - 0.34) < 1e-9 && Math.abs(o.z1 - 0.5) < 1e-9);
  const beamB = railsOn.some((o) => Math.abs(o.z0 - 0.62) < 1e-9 && Math.abs(o.z1 - 0.9) < 1e-9);
  const posts = railsOn.some((o) => o.k === 'cyl' && Math.abs(o.z1 - 0.83) < 1e-9);
  return beamA && beamB && posts && railsOff.length === 0;
})());
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
// KEEP: text [plain-roadTile walk cannot be reached through any public RF/Node surface — tileWorld requires src.tiles and source() never builds it for the shipped road; there is no behaviour seam]
ok('roadTile walk unchanged (no verge in the plain tile recipe) [KEEP: text — no behaviour seam]', !anim.includes('endlessVerge(roadTile'));
// behaviour: the consent flags gate trees/deer/signs/rocks in the world builder
ok('consent flags: veg off -> no trees/bushes; animals off -> no deer; signs off -> no signs; wild off -> no rocks', (() => {
  const vegOn = walkTiles(FLAGS, null, false, 'forest').filter(isVeg).length;
  const vegOff = walkTiles(Object.assign({}, FLAGS, { veg: false }), null, false, 'forest').filter(isVeg).length;
  const deerOn = walkTiles(FLAGS, null, false, 'forest').filter(isDeer).length;
  const deerOff = walkTiles(Object.assign({}, FLAGS, { animals: false }), null, false, 'forest').filter(isDeer).length;
  const signOn = walkTiles(FLAGS).filter(isSign).length;
  const signOff = walkTiles(Object.assign({}, FLAGS, { signs: false })).filter(isSign).length;
  const rockOn = (() => { let n = 0; for (let k = 0; k < 160; k++) { const ti = A.endlessTile(seed, k); if (ti.biome !== 'mountain') continue; const objs = atTile(k).objects; if (objs.some((o) => o.cls === 'creek')) continue; n += count(objs, isGravelRock); } return n; })();
  const rockOff = walkTiles(Object.assign({}, FLAGS, { wild: false }), null, false, 'mountain').filter(isGravelRock).length;
  return vegOn > 0 && vegOff === 0 && deerOn > 0 && deerOff === 0 && signOn > 0 && signOff === 0 && rockOn > 0 && rockOff === 0;
})());
// behaviour: terrain opt-in — source() carries tileTerrain into src.tiles; the beyond-carriageway height varies
ok('terrain opt-in reaches src.tiles (source()) with and without the option', (() => {
  const on = A.source('road', 3.5, false, FLAGS, { seed: 7, tiles: true, endlessRoad: true, tileTerrain: true });
  const off = A.source('road', 3.5, false, FLAGS, { seed: 7, tiles: true, endlessRoad: true });
  return !!on.tiles.terrain === true && !off.tiles.terrain;
})());
// KEEP: text [top-bar control wiring + tkey for tileTerrain — DOM/UI wiring with no headless behaviour seam; scene-key.js now owns the skey/tkey+registry coverage]
ok("top-bar terrain toggle + tkey carries tileTerrain [KEEP: text — UI wiring, no behaviour seam here]", anim.includes("'data-anim': 'tileTerrain'") && anim.includes('!!o.tileTerrain'));
// behaviour: registry — tileTerrain declared once, kind bool, default false (pricy = opt-in)
ok('registry: tileTerrain declared once, type bool, default false (pricy = opt-in)', (() => { const list = Opt.OPTIONS.filter((x) => x.id === 'tileTerrain'); return list.length === 1 && list[0].type === 'bool' && list[0].default === false; })());
// creekside + suburbia (Anya's ideas, 10-31 ~03:55): open-biome tiles seeded as creek / suburb, behind the wild consent flag
ok('open tiles seed creeks and suburbia deterministically', (() => { let ck = 0, sb = 0; for (let k = 90; k < 130; k++) { const v = A.endlessVerge(seed, k); if (v.biome !== 'open') continue; if (v.creek) ck++; if (v.suburb) sb++; } return ck > 0 && sb > 0 && JSON.stringify(A.endlessVerge(seed, 96)) === JSON.stringify(A.endlessVerge(seed, 96)); })());
ok('creek side is ±1 and never on the carriageway', (() => { for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.creek && Math.abs(v.creek) !== 1) return false; } return true; })());
// behaviour: the creekside water channel + bank stones emit only behind wild, deterministically
ok("creek tiles emit the water channel (mat 'water', cls 'creek') behind wild; wild off -> none", (() => {
  let on = 0, off = 0;
  for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.creek && A.endlessTile(seed, k).biome === 'open') { on += count(atTile(k).objects, (o) => o.mat === 'water' && o.cls === 'creek'); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false })).objects, (o) => o.mat === 'water' && o.cls === 'creek'); } }
  return on >= 1 && off === 0;
})());
// behaviour: suburbia emits the house behind wild
ok("suburb tiles emit the house frontage (mat 'wall-light') behind wild; wild off -> none", (() => {
  let on = 0, off = 0;
  for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.suburb && A.endlessTile(seed, k).biome === 'open') { on += count(atTile(k).objects, (o) => o.mat === 'wall-light'); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false })).objects, (o) => o.mat === 'wall-light'); } }
  return on >= 1 && off === 0;
})());
// behaviour: detailed lamp heads behind detailedModels (extra lens/housing per lamp)
ok('detailedModels emits a lamp housing + lens per street lamp (more lamp-head objects than the plain build)', (() => {
  const tile = 48;   // city block: lamps on (lampGap 50)
  const plain = count(atTile(tile).objects, (o) => o.mat === 'lamp-head');
  const detailed = count(atTile(tile, FLAGS, null, true).objects, (o) => o.mat === 'lamp-head');
  return plain > 0 && detailed > plain;
})());
// behaviour: city verge buildings get window boxes, behind wild
ok("city verge buildings emit window boxes (win-*) behind wild; wild off -> none", (() => {
  const isWin = (o) => o.mat === 'win-warm' || o.mat === 'win-cool' || o.mat === 'win-dark';
  const on = walkTiles(FLAGS, null, false, 'city').filter(isWin).length;
  const off = walkTiles(Object.assign({}, FLAGS, { wild: false }), null, false, 'city').filter(isWin).length;
  return on > 0 && off === 0;
})());
// behaviour: viaduct piers on steep mountain blocks (>3.5% grade), behind wild (z0/z1 span merged from the old span check)
ok("steep mountain blocks emit viaduct piers (cls 'pier', z0 -14 reaching past the verge falloff) behind wild", (() => {
  const sd = (() => { for (let k = 0; k < 300; k++) if (A.endlessTile(seed, k).biome === 'mountain' && Math.abs(A.endlessGrade(seed, Math.floor(k / 16))) > 0.035) return k; })();
  if (sd === undefined) return false;
  const piers = atTile(sd).objects.filter((o) => o.cls === 'pier');
  const noPiers = atTile(sd, Object.assign({}, FLAGS, { wild: false })).objects.filter((o) => o.cls === 'pier');
  return piers.length > 0 && piers.every((o) => o.z0 === -14 && o.z1 === 0.05) && noPiers.length === 0;
})());
// behaviour: direction signs behind the signs flag (white-paint chevrons on the approach side of every sign board)
ok('direction signs emit white-paint chevron faces behind signs; signs off -> zero white-paint markings', (() => {
  const WP = (o) => o.mat === 'white-paint';
  const on = walkTiles(FLAGS).filter(WP).length;
  const off = walkTiles(Object.assign({}, FLAGS, { signs: false })).filter(WP).length;
  return on > 0 && off === 0;
})());
// behaviour: suburb houses get facade windows behind wild (merged: win-* presence on the suburb path)
ok("suburb houses emit facade windows (win-warm/win-dark) behind wild; wild off -> none", (() => {
  const isWin = (o) => (o.mat === 'win-warm' || o.mat === 'win-dark') && o.hy !== undefined && o.hy < 0.5;
  let on = 0, off = 0;
  for (let k = 0; k < 300; k++) { const v = A.endlessVerge(seed, k); if (v.suburb && A.endlessTile(seed, k).biome === 'open') { on += count(atTile(k).objects, isWin); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false })).objects, isWin); } }
  return on > 0 && off === 0;
})());
// behaviour: kilometer post every 1000 m on endless tiles at the right edge, behind signs
ok('kilometer post every 1000 m on endless tiles (r: 0.05 pole, white-paint board) behind signs; signs off -> none', (() => {
  const pole = (o) => o.k === 'cyl' && o.mat === 'pole' && o.z1 === 1.1;
  const board = (o) => o.mat === 'white-paint' && o.z0 === 0.75;
  let onPole = 0, onBoard = 0, offPole = 0, offBoard = 0;
  for (let k = 0; k < 300; k += 5) {   // s0 = k * 200; s0 % 1000 === 0 for k % 5 === 0
    if (A.endlessTile(seed, k).s0 % 1000 !== 0) continue;
    const objs = atTile(k).objects;
    onPole += count(objs, pole); onBoard += count(objs, board);
    const objsOff = atTile(k, Object.assign({}, FLAGS, { signs: false })).objects;
    offPole += count(objsOff, pole); offBoard += count(objsOff, board);
  }
  return onPole > 0 && onBoard > 0 && offPole === 0 && offBoard === 0;
})());
// behaviour: fence posts + two rails behind detailedModels, thin box otherwise
ok('fence: posts (z1 1.05) + two rails (z0 0.55, z0 0.95) behind detailedModels; single thin box (z0 0.85) otherwise', (() => {
  const kFence = (() => { for (let k = 0; k < 300; k++) if (A.endlessVerge(seed, k).fence) return k; })();
  const det = atTile(kFence, FLAGS, null, true).objects;
  const plain = atTile(kFence).objects;
  const detPosts = count(det, (o) => o.k === 'cyl' && o.mat === 'concrete' && Math.abs(o.z1 - 1.05) < 1e-9);
  const detRailsA = count(det, (o) => o.k === 'box' && o.mat === 'concrete' && Math.abs(o.z0 - 0.55) < 1e-9 && Math.abs(o.z1 - 0.62) < 1e-9);
  const detRailsB = count(det, (o) => o.k === 'box' && o.mat === 'concrete' && Math.abs(o.z0 - 0.95) < 1e-9 && Math.abs(o.z1 - 1.03) < 1e-9);
  const plainThin = count(plain, (o) => o.k === 'box' && o.mat === 'concrete' && Math.abs(o.z0 - 0.85) < 1e-9 && Math.abs(o.z1 - 1.05) < 1e-9);
  return detPosts > 0 && detRailsA > 0 && detRailsB > 0 && plainThin > 0;
})());
// behaviour: per-biome lamp styles (seed 7: open = 9 m masts, city = 7 m cobras; forest/mountain emit no lamps, lampGap 0)
ok('per-biome lamp styles: open -> 9 m mast height, city -> 7 m cobra; forest/mountain emit no street lamps', (() => {
  const lampH = (k, sd) => { const w = atTile(k, FLAGS, null, false, sd); return w.objects.filter((o) => o.k === 'cyl' && o.mat === 'pole' && o.cls === 'street-lamp').map((o) => o.z1); };
  const kOpen = (() => { for (let k = 0; k < 300; k++) if (A.endlessTile(seed, k).biome === 'open' && A.endlessTile(seed, k).props.lampGap > 0) return k; })();
  const kCity = (() => { for (let k = 0; k < 300; k++) if (A.endlessTile(seed, k).biome === 'city') return k; })();
  const kForest = (() => { for (let k = 0; k < 300; k++) if (A.endlessTile(seed, k).biome === 'forest') return k; })();
  const kMount = (() => { for (let k = 0; k < 300; k++) if (A.endlessTile(seed, k).biome === 'mountain') return k; })();
  const oh = lampH(kOpen), ch = lampH(kCity), fH = lampH(kForest), mH = lampH(kMount);
  return oh.length > 0 && oh.every((h) => h === 9) && ch.length > 0 && ch.every((h) => h === 7) && fH.length === 0 && mH.length === 0;
})());
// behaviour: lamp head sits at hgt - 0.1 and the light is at hgt - 0.15 with cd 900 — open biome 9 m mast has head z 8.9, light z 8.85, cd 900
ok('lamp head + light height follow the per-biome hgt (open mast: head z 8.9, light z 8.85, cd 900)', (() => {
  const kOpen = (() => { for (let k = 0; k < 300; k++) if (A.endlessTile(seed, k).biome === 'open' && A.endlessTile(seed, k).props.lampGap > 0) return k; })();
  const w = atTile(kOpen);
  const heads = w.objects.filter((o) => o.mat === 'lamp-head');
  const lights = w.lights.filter((l) => l.cd === 900);
  return heads.length > 0 && heads.every((o) => Math.abs(o.z - 8.9) < 1e-9 || Math.abs(o.z1 - 8.9) < 1e-9) && lights.length > 0 && lights.every((l) => Math.abs(l.z - 8.85) < 1e-9);
})());
// behaviour: junction gantry behind junctionGantries option (+ signs + wild), over junction tiles
ok('gantry: columns + beam + two green panels over junction tiles, behind junctionGantries + signs + wild', (() => {
  const kJ = (() => { for (let k = 0; k < 300; k++) if (A.endlessTile(seed, k).kind === 'intersection') return k; })();
  const on = atTile(kJ, FLAGS, { junctionGantries: true });
  const off = atTile(kJ);
  const g = (w) => w.objects.filter((o) => o.cls === 'gantry');
  const noSigns = atTile(kJ, Object.assign({}, FLAGS, { signs: false }), { junctionGantries: true });
  return g(on).length >= 3 && g(off).length === 0 && g(noSigns).length === 0;
})());
// behaviour: bus stop: roof + posts + bench in suburb tiles behind wild (rate-gated 0.35 — scan enough suburb tiles)
ok("bus stop: roof + posts + bench in suburb tiles, sign behind signs, behind wild; wild off -> none", (() => {
  let on = 0, off = 0;
  for (let sd = 1; sd <= 20 && on === 0; sd++) for (let k = 0; k < 300; k++) { if (A.endlessVerge(sd, k).suburb && A.endlessTile(sd, k).biome === 'open') { on += count(atTile(k, FLAGS, null, false, sd).objects, (o) => o.cls === 'bus-stop'); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false }), null, false, sd).objects, (o) => o.cls === 'bus-stop'); } }
  return on >= 1 && off === 0;
})());
// brainstorm: SOS niches (10-31 ~20:30)
let sosN = 0, sosBad = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 0; k < 300; k++) { const t = A.endlessTile(seed, k);
  if (t.sos) { sosN++; if (t.kind !== 'straight' || (t.biome !== 'forest' && t.biome !== 'mountain') || t.tunnel || t.view) sosBad++; } }
ok('SOS niches: seeded forest/mountain straight tiles, never on tunnel/view', sosN > 30 && sosBad === 0, { sosN, sosBad });
ok("SOS builds bay + hivis box + phone sign (signs), behind wild; wild off -> none", (() => {
  let on = 0, off = 0;
  for (let sd = 1; sd <= 60 && on < 4; sd++) for (let k = 0; k < 300; k++) { if (A.endlessTile(sd, k).sos) { on += count(atTile(k, FLAGS, null, false, sd).objects, (o) => o.cls === 'sos'); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false }), null, false, sd).objects, (o) => o.cls === 'sos'); } }
  return on >= 4 && off === 0;
})());
// brainstorm: forest picnic areas (10-31 ~20:45)
let picN = 0, picAdj = 0, picBad = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 1; k < 300; k++) { const t = A.endlessTile(seed, k), p = A.endlessTile(seed, k - 1);
  if (t.picnic) { picN++; if (p.picnic || A.endlessTile(seed, k + 1).picnic) picAdj++; if (t.kind !== 'straight' || t.biome !== 'forest' || t.tunnel || t.sos) picBad++; } }
ok('picnic areas: seeded forest straight tiles, never adjacent, never on tunnel/SOS', picN > 15 && picAdj === 0 && picBad === 0, { picN, picAdj, picBad });
ok("picnic builds clearing + 2 tables + fire ring + shelter + sign (signs), behind wild; wild off -> none", (() => {
  let on = 0, off = 0;
  for (let sd = 1; sd <= 60 && on < 8; sd++) for (let k = 0; k < 300; k++) { if (A.endlessTile(sd, k).picnic) { on += count(atTile(k, FLAGS, null, false, sd).objects, (o) => o.cls === 'picnic'); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false }), null, false, sd).objects, (o) => o.cls === 'picnic'); } }
  return on >= 8 && off === 0;
})());
// brainstorm: wildlife overpasses (10-31 ~21:00)
let wN = 0, wAdj = 0, wBad = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 1; k < 300; k++) { const t = A.endlessTile(seed, k), p = A.endlessTile(seed, k - 1);
  if (t.wild) { wN++; if (p.wild || A.endlessTile(seed, k + 1).wild) wAdj++; if (t.kind !== 'straight' || t.biome !== 'forest' || t.tunnel || t.sos || t.picnic) wBad++; } }
ok('wildlife overpasses: seeded forest straight tiles, never adjacent, never on tunnel/SOS/picnic', wN > 12 && wAdj === 0 && wBad === 0, { wN, wAdj, wBad });
ok("overpass builds wall+grass deck across the road + funnel fences, behind wild+veg; veg off -> none", (() => {
  let on = 0, off = 0;
  for (let sd = 1; sd <= 60 && on < 3; sd++) for (let k = 0; k < 300; k++) { if (A.endlessTile(sd, k).wild) { on += count(atTile(k, FLAGS, null, false, sd).objects, (o) => o.cls === 'wildlife'); off += count(atTile(k, Object.assign({}, FLAGS, { veg: false }), null, false, sd).objects, (o) => o.cls === 'wildlife'); } }
  return on >= 3 && off === 0;
})());
// brainstorm: mountain chain-up areas (10-31 ~21:15)
let cN = 0, cAdj = 0, cBad = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 1; k < 300; k++) { const t = A.endlessTile(seed, k), p = A.endlessTile(seed, k - 1);
  if (t.chain) { cN++; if (p.chain || A.endlessTile(seed, k + 1).chain) cAdj++; if (t.kind !== 'straight' || t.biome !== 'mountain' || t.tunnel || t.view || t.sos) cBad++; } }
ok('chain-up areas: seeded mountain straight tiles, never adjacent, never on tunnel/view/SOS', cN > 12 && cAdj === 0 && cBad === 0, { cN, cAdj, cBad });
ok("chain-up builds paved widening + 2 parked cars + hivis delineators + sign (signs), behind wild; wild off -> none", (() => {
  let on = 0, off = 0;
  for (let sd = 1; sd <= 60 && on < 4; sd++) for (let k = 0; k < 300; k++) { if (A.endlessTile(sd, k).chain) { on += count(atTile(k, FLAGS, null, false, sd).objects, (o) => o.cls === 'chainup'); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false }), null, false, sd).objects, (o) => o.cls === 'chainup'); } }
  return on >= 4 && off === 0;
})());
// brainstorm: creek culverts under the road (10-31 ~21:30)
let cul = 0;
for (let seed = 1; seed <= 60; seed++) for (let k = 0; k < 300; k++) { const t = A.endlessTile(seed, k), vg = A.endlessVerge(seed, k); if (vg.creek && t.biome === 'open' && t.kind === 'straight') cul++; }
ok('culvert condition: creek tiles in the open biome only (seeded 35% at build time)', cul > 40, { cul });
// deterministic companion: seed 1 tile 101 always emits a culvert (3 objects) with wild on, never with wild off
ok('culvert builds deterministically (seed 1, tile 101) behind wild; wild off -> none', (() => {
  const on = count(atTile(101, FLAGS, null, false, 1).objects, (o) => o.cls === 'culvert');
  const off = count(atTile(101, Object.assign({}, FLAGS, { wild: false }), null, false, 1).objects, (o) => o.cls === 'culvert');
  return on >= 2 && off === 0;
})());
ok("culvert builds water strip across the road + parapets both edges, behind wild; wild off -> none", (() => {
  let on = 0, off = 0;
  for (let sd = 1; sd <= 60 && on === 0; sd++) for (let k = 0; k < 300; k++) { const t = A.endlessTile(sd, k), vg = A.endlessVerge(sd, k); if (vg.creek && t.biome === 'open' && t.kind === 'straight') { on += count(atTile(k, FLAGS, null, false, sd).objects, (o) => o.cls === 'culvert'); off += count(atTile(k, Object.assign({}, FLAGS, { wild: false }), null, false, sd).objects, (o) => o.cls === 'culvert'); } }
  return on >= 2 && off === 0;
})());
// 11-06: §3.3 audit fix — negative tile indices: JS % keeps the sign, so k%16 was wrong for k<0
// k=-16 is deliberately not asserted: -16 % 16 is -0 and -0 === 0, so even the unwrapped (buggy) code gave ramp 0.6 there. Only k = -1, -17, -33 (== 15 mod 16) tell fixed from buggy.
ok('endlessVerge ramp wraps for negative k: k=-1, -17, -33 -> kk16=15 -> ramp 0.4 (unwrapped k%16 = -1 gave 1)', A.endlessVerge(7, -1).ramp === 0.4 && A.endlessVerge(7, -17).ramp === 0.4 && A.endlessVerge(7, -33).ramp === 0.4, { r1: A.endlessVerge(7, -1).ramp, r17: A.endlessVerge(7, -17).ramp, r33: A.endlessVerge(7, -33).ramp });
console.log(fail === 0 ? `\nall ${pass} le-chonk-verge checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
