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
const PINS = {
  'road-static@7@tiles95': '3d1ef51f756bb803',
  'road-static@7@tiles400': '5dd4fb66ad7d7b5a',
  'road-static@7@off': '46a21df8e266d79a',
  'road-wild@7@tiles95': '6d48ea6665d52667',
  'road-wild@7@tiles400': '99a36cc4d00ca5e7',
  'road-wild@7@off': '52d7698a66a3c969',
  'forest@7@tiles95': 'b85d396d5ab90683',
  'forest@7@tiles400': '22afad566ed13694',
  'forest@7@off': '094ce49980840456',
  'city@7@tiles95': '9c8c81cf1e65e5c6',
  'city@7@tiles400': '459aea471c931371',
  'city@7@off': '8490905993044280',
  'road-static@11@tiles95': '78b03af0f0158317',
  'road-static@11@tiles400': 'acdfed4bbc00ee26',
  'road-static@11@off': '46a21df8e266d79a',
  'road-wild@11@tiles95': 'dfde28c048b1adec',
  'road-wild@11@tiles400': '8790a75c140db44b',
  'road-wild@11@off': 'a613818373b10e52',
  'forest@11@tiles95': '1c1d383da5daab4e',
  'forest@11@tiles400': 'f986fa8c3e77ed8b',
  'forest@11@off': '094ce49980840456',
  'city@11@tiles95': 'ddb5d3da8ea1008b',
  'city@11@tiles400': '252e9da616ba15ab',
  'city@11@off': '8490905993044280',
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
