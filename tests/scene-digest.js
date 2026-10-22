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
const PINS = {
  'road-static@7@tiles95': 'f72165fa8a46de9b',
  'road-static@7@tiles400': '8780ad3dfa5c163e',
  'road-static@7@off': '619140acc991bc8d',
  'road-wild@7@tiles95': '1eb5ad5de97e8d0d',
  'road-wild@7@tiles400': 'c115b66599ea0ae6',
  'road-wild@7@off': '52d7698a66a3c969',
  'forest@7@tiles95': 'c13a88d509de5901',
  'forest@7@tiles400': '926fe2eec9f4b94f',
  'forest@7@off': '147f4ad401a44c25',
  'city@7@tiles95': 'b89a885fd4de2f7f',
  'city@7@tiles400': 'eda34d6dc38c5a44',
  'city@7@off': 'bb9996a602f5c4cf',
  'road-static@11@tiles95': '594ff54c155cf0e0',
  'road-static@11@tiles400': '54af8224ee6aed02',
  'road-static@11@off': '619140acc991bc8d',
  'road-wild@11@tiles95': 'ff6defebc07304be',
  'road-wild@11@tiles400': '124dc03af7d00821',
  'road-wild@11@off': 'a613818373b10e52',
  'forest@11@tiles95': 'a44e731bb5ab6ec8',
  'forest@11@tiles400': '0b0052c4f2e4608e',
  'forest@11@off': '147f4ad401a44c25',
  'city@11@tiles95': '972867e0b609959e',
  'city@11@tiles400': '48d5f7fc6e0c0080',
  'city@11@off': 'bb9996a602f5c4cf',
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
