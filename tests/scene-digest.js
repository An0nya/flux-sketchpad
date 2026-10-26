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
const PINS = {
  'road-static@7@tiles95': '8b380cf09f961522',
  'road-static@7@tiles400': '7766027dea5dc65a',
  'road-static@7@off': '7c19c32a0c28c6ac',
  'road-wild@7@tiles95': '3837f4a8265388ae',
  'road-wild@7@tiles400': '78a1f4fa844bf31c',
  'road-wild@7@off': '52d7698a66a3c969',
  'forest@7@tiles95': '4e8b202c45ec67cb',
  'forest@7@tiles400': 'ee145d7816e387c3',
  'forest@7@off': 'a64c40c9a16136c0',
  'city@7@tiles95': 'c2ff6f6e654f0594',
  'city@7@tiles400': 'ee19e88f7d859ad2',
  'city@7@off': 'cbe760abb2f3c39c',
  'road-static@11@tiles95': '3c2935013e25e449',
  'road-static@11@tiles400': 'caa3016457e7a738',
  'road-static@11@off': '806b7ab545de6e62',
  'road-wild@11@tiles95': '53e57b28119e904f',
  'road-wild@11@tiles400': 'b8d7c6719dcb0978',
  'road-wild@11@off': 'a613818373b10e52',
  'forest@11@tiles95': '2d8145e78adc63ab',
  'forest@11@tiles400': 'cb52ec44fb8e09e8',
  'forest@11@off': 'aa88a28a085b08e2',
  'city@11@tiles95': '6ed26a3e05b01e70',
  'city@11@tiles400': '709578607a3e0f43',
  'city@11@off': '7c47cd06f8a533b2',
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
