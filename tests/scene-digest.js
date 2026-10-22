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
const PINS = {
  'road-static@7@tiles95': 'ab67e7b6e25b9cbf',
  'road-static@7@tiles400': '4016c6e5ed689358',
  'road-static@7@off': 'c50d9a8d4e55c248',
  'road-wild@7@tiles95': 'cd69e4e0171e3792',
  'road-wild@7@tiles400': '897cbc8e1effeb6e',
  'road-wild@7@off': '52d7698a66a3c969',
  'forest@7@tiles95': '9abd05f429731329',
  'forest@7@tiles400': 'f887d4bb312a2eaa',
  'forest@7@off': '9dd957d63f1499ad',
  'city@7@tiles95': '614f519c8f9a2437',
  'city@7@tiles400': '03c3388d27e2f6c1',
  'city@7@off': '227b99bb5e94dd14',
  'road-static@11@tiles95': '5de1a0aa7bcf809f',
  'road-static@11@tiles400': '12b6830ff207f23b',
  'road-static@11@off': 'c50d9a8d4e55c248',
  'road-wild@11@tiles95': 'dbfe95af9eb43c7f',
  'road-wild@11@tiles400': 'c6d7e11a65ed26b1',
  'road-wild@11@off': 'a613818373b10e52',
  'forest@11@tiles95': 'c17f3f61effb5fa1',
  'forest@11@tiles400': '522a02f78b643639',
  'forest@11@off': '9dd957d63f1499ad',
  'city@11@tiles95': '4feade3518ecb8a4',
  'city@11@tiles400': '4dc05b3cc1c95545',
  'city@11@off': '227b99bb5e94dd14',
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
