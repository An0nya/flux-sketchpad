// SP1: positions, not just counts. scene-snapshot.js pins how many objects each scene places; this pins WHERE they are, as a sha1 of every
// object's kind and geometry, for road-static, road-wild, forest and city, at two seeds, with the route tiles on (tileWorld, 95 m and 400 m) and off (the built scene).
// A refactor that keeps every count but moves one tree fails here. The pins were captured on the untouched builders (base a9cb102) before any stage changed them.
// Node: node tests/scene-digest.js — exits 1 on any failure. SD_CAPTURE=1 prints the digests instead of checking them.
const crypto = require('crypto');
const { load } = require('./load.js');
const { plan } = require('./scene-snapshot.js');

const VIEW_FLAGS = { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: false, rpm: true };
const SEEDS = [7, 11];
// [label, scene, source options]: road-static is the still road (wild off), road-wild the random scenery, forest and city the static builders
const CASES = [['road-static', 'road', { wild: false }], ['road-wild', 'road', {}], ['forest', 'forest', {}], ['city', 'city', {}]];
// key -> sha1 (first 16 hex). Pinned from the untouched code; a change must change the pin here with the reason.
// PED-CLOTHING-MODES: the walker objects changed (palette colours and strip boxes, default mode mix). Re-baselined from the new build; with every
// cls 'person' object left out, all 24 digests equal the pre-change pins (checked against main b38c628, people on and off).
// PED-STRIPS-SDF: 22 of 24 changed (road-wild off unchanged; 'off' rows changed too, the walkers are in them). Cause: mix and small walkers now carry
// tape. The detailed (SDF) model draws torso bands, cuffs, shin bands and shoe patches, and the primitive torso bands replace the two back strips. none and vest
// are unchanged. Proof: with every cls 'person' object left out, all 24 digests equal main f52ed8a (checked in scratch, people on and off).
// SEEDED-KINDS (Brief S): the road, city and forest walkers ask for kind 'seeded' and person() draws dark or light (PED_LIGHT_SHARE) from a hash, so 19 of 24 changed
// (the five other road-wild pins kept their values; road-wild@11@tiles95 moved). Cause: the walker kinds from the hash, not positions.
// Proof: with globalThis.PED_FIXED_KINDS = true the build is the pre-change one and all 24 digests equal the PINS that were there before this change.
// SEEDED-KINDS wiring (Brief T item 2): the tile-world kits in drive-anim.js (junction, city crosser, wild chunk walkers, minigame hazards) now pass foliageSeed = the user seed,
// and the junction/city crossers ask for kind 'seeded' (junction crosser also gets a per-tile id). 10 of 24 moved: road-wild@7 tiles95/400 and every tiles95/tiles400 row at seed 11
// (static, wild, forest, city); every 'off' row and every seed-7 row of the other scenes kept its pin (their kits already got the seed 7). Proof: with globalThis.PED_FIXED_KINDS = true
// (which also restores the old seed and the fixed 'dark' crossers) all 24 digests of this build equal the 24 digests of the previous build (e51c4bc) with the flag on.
// PED-STRIP-SHARE (Brief T item 3, owner 2026-10-26): mix mode puts strips on ~12% of non-vest walkers (PED_STRIP_SHARE 0.12, was 0.5), so the strip boxes of the 'mix' walkers
// change in 21 of 24 rows (road-wild@7 off and tiles400 kept theirs: no walker's strip draw flipped there). Proof: with globalThis.PED_FIXED_KINDS = true (restores 0.5) all 24
// digests equal the 24 of the previous commit with the flag on (checked in scratch with SD_CAPTURE=1).
const PINS = {
  'road-static@7@tiles95': 'df5e3fb4899a2998',
  'road-static@7@tiles400': 'a276787a4a9dd961',
  'road-static@7@off': 'c98adbcab5f734d3',
  'road-wild@7@tiles95': '161a56911a1b5600',
  'road-wild@7@tiles400': '78a1f4fa844bf31c',
  'road-wild@7@off': '52d7698a66a3c969',
  'forest@7@tiles95': '27ba807e57931985',
  'forest@7@tiles400': 'a93a25b32ffd58cc',
  'forest@7@off': '00368976244addef',
  'city@7@tiles95': '53d02d37e912083e',
  'city@7@tiles400': '2bf7f7c12a23640e',
  'city@7@off': '1bbd73f321a5df1a',
  'road-static@11@tiles95': '3fd0aa2a31378188',
  'road-static@11@tiles400': '4ae8decf2bd17507',
  'road-static@11@off': '00d67fa591a2582e',
  'road-wild@11@tiles95': '1d69a111a5fcd03d',
  'road-wild@11@tiles400': '1adfa9c1824729cc',
  'road-wild@11@off': 'a613818373b10e52',
  'forest@11@tiles95': '0ddd7b1bf68d4d70',
  'forest@11@tiles400': '96877cbba8017c3b',
  'forest@11@off': '8d13fb1fe5ac3865',
  'city@11@tiles95': '910ea143e3f52008',
  'city@11@tiles400': '7d377e6887d3991a',
  'city@11@off': '36602be238155c9a',
};

// one object's identity: every field a builder sets that decides where it is and what it is
const FIELDS = ['k', 'cls', 'x', 'y', 'z0', 'z1', 'r', 'hx', 'hy', 'yaw', 'mat'];
function digest(objects) {
  const rows = objects.map((o) => FIELDS.map((f) => (o[f] === undefined ? null : o[f])));
  return crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

// the same plan() the snapshot uses, with another seed
function keyOf(label, seed, mode) { return label + '@' + seed + '@' + mode; }
function scenery(RF, scene, extra, seed, mode, dist) {
  const A = RF.DriveAnim;
  if (mode === 'off') return digest(A.source(scene, 3.5, false, VIEW_FLAGS, Object.assign({ seed, wild: extra.wild !== false && scene === 'road' }, {})).objects);
  const p = plan(RF, scene, Object.assign({}, extra, { seed }));
  return digest(A.tileWorld(p, dist, 2).objects);
}

function run(RF, ok) {
  const got = {}, bad = [];
  for (const seed of SEEDS) for (const [label, scene, extra] of CASES) for (const mode of ['tiles95', 'tiles400', 'off']) {
    const key = keyOf(label, seed, mode);
    const dist = mode === 'tiles400' ? 400 : 95;
    got[key] = scenery(RF, scene, Object.assign({}, extra), seed, mode === 'off' ? 'off' : 'tiles', dist);
    if (got[key] !== PINS[key]) bad.push(key + ' got ' + got[key] + ' pinned ' + (PINS[key] || '(none)'));
  }
  if (process.env.SD_CAPTURE) for (const key of Object.keys(got)) console.log('CAPTURE ' + key + ' ' + got[key]);
  ok('SP1 scene digest: every object of road-static, road-wild, forest and city sits where the pinned build put it (2 seeds, tiles at 95 m and 400 m, tiles off)',
    bad.length === 0, bad.length ? bad.join('; ') : 'all ' + Object.keys(PINS).length + ' digests match');
  return got;
}

module.exports = { run, digest, scenery, PINS, CASES, SEEDS };
if (require.main === module) {
  let fails = 0;
  const RF = load();
  run(RF, (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all scene digest checks passed');
  process.exitCode = fails ? 1 : 0;
}
