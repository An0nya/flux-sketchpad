// SB0: what each scene places, counted through the animated path the page draws (tileWorld, with the view's flags on).
// Node, no browser: node tests/scene-snapshot.js — exits 1 on any failure.
// The pins are counts the code produced before a stage changed anything. A stage that moves a count must change the pin here, in the same commit, with the reason.
// Columns: studs, posts, signs, street lamps, deer, people, trees, markings.
const { load } = require('./load.js');

const KIND = {
  studs: (o) => o.cls === 'rpm', posts: (o) => o.cls === 'post', signs: (o) => o.cls === 'sign', lamps: (o) => o.cls === 'street-lamp',
  deer: (o) => o.cls === 'deer', people: (o) => o.cls === 'person', trees: (o) => o.cls === 'veg',
};
const COLS = ['studs', 'posts', 'signs', 'lamps', 'deer', 'people', 'trees', 'markings'];
// the flags the view sends (the drive view's defaults: DV_DEF in js/spec-ui.js)
const VIEW_FLAGS = { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: false, rpm: true };
// scene@dist -> counts in COLS order (SB0 capture, before any stage changed a count)
const PINS = {
  'road-wild@95': [41, 20, 4, 9, 9, 8, 61, 3],
  'road-wild@400': [41, 20, 0, 12, 18, 4, 64, 3],
  'road-static@95': [0, 24, 6, 9, 18, 12, 36, 3],
  'road-static@400': [0, 24, 6, 12, 18, 12, 36, 3],
  'forest@95': [0, 12, 2, 9, 27, 8, 695, 3],
  'forest@400': [0, 12, 2, 12, 27, 8, 695, 3],
  'city@95': [0, 0, 4, 9, 9, 16, 0, 3],
  'city@400': [0, 0, 4, 12, 9, 16, 0, 3],
  'pass@95': [0, 80, 2, 6, 9, 0, 108, 3],
  'pass@400': [0, 80, 4, 3, 0, 0, 108, 3],
};

// the page's tiled route with the view's flags, the same way recipe() in tests/drive-polish.js builds it, but with flags
function plan(RF, scene, extra) {
  const D = RF.Drive, A = RF.DriveAnim;
  const src = A.source(scene, 3.5, false, VIEW_FLAGS, Object.assign({ tiles: true, wild: true, seed: 7, oncoming: true, preceding: true, trafficDensity: 2 }, extra));
  return { w: 96, h: 54, hfov: 60, lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lane: 3.5, look: { wet: false, wetSheen: false, RL: 0.2, ambient: 0.05 }, src };
}
// the counts for one scene at one distance (t = 2, as the other Node tests use)
function counts(RF, name, dist) {
  const scene = name === 'road-wild' || name === 'road-static' ? 'road' : name;
  const p = plan(RF, scene, name === 'road-static' ? { wild: false } : name === 'pass' ? { mountainPass: true } : {});
  const world = RF.DriveAnim.tileWorld(p, dist, 2);
  const out = COLS.slice(0, 7).map((c) => world.objects.filter(KIND[c]).length);
  out.push(world.markings.length);
  return out;
}
const NAMES = ['road-wild', 'road-static', 'forest', 'city', 'pass'];

function run(RF, ok) {
  const D = RF.Drive, F = D.resolveFeatures;
  ok('SB0 resolveFeatures: road preset, forest/city/pass presets, overrides win, undefined override keeps the preset, unknown preset falls back to road',
    F({ preset: 'road' }).studs === true && F({ preset: 'forest' }).studs === false && F({ preset: 'city' }).studs === false && F({ preset: 'pass' }).people === false
    && F({ preset: 'forest', overrides: { studs: true } }).studs === true && F({ preset: 'road', overrides: { studs: undefined } }).studs === true
    && F({ preset: 'road', overrides: { studs: false } }).studs === false && F({ preset: 'nope' }).studs === true && F().posts === true);
  let bad = [];
  const got = {};
  for (const name of NAMES) for (const dist of [95, 400]) {
    const key = name + '@' + dist, c = counts(RF, name, dist); got[key] = c;
    if (JSON.stringify(c) !== JSON.stringify(PINS[key])) bad.push(key + ' got [' + c.join(',') + '] pinned [' + (PINS[key] || []).join(',') + ']');
  }
  ok('SB0 scene snapshot: every scene places the counts pinned before this stage (studs, posts, signs, lamps, deer, people, trees, markings)',
    bad.length === 0, bad.length ? bad.join('; ') : 'all ' + Object.keys(PINS).length + ' pins match');
  ok('SB0 positive control: the snapshot sees studs on the open road (41 at 95 m) and none on the still-built forest', got['road-wild@95'][0] > 0 && got['forest@95'][0] === 0);
}

module.exports = { run, counts, plan, COLS, PINS };
if (require.main === module) {
  let fails = 0;
  const RF = load();
  run(RF, (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  if (process.env.SB_CAPTURE) for (const name of NAMES) for (const dist of [95, 400]) console.log('CAPTURE ' + name + '@' + dist + ' ' + counts(RF, name, dist).join(','));
  console.log(fails ? fails + ' FAILED' : 'all scene snapshot checks passed');
  process.exitCode = fails ? 1 : 0;
}
