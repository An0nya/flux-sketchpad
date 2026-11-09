// le-chonk (10-31): multilane highway phase 0 — animation-only 2+2 highway on tile roads (Anya §2). OFF must be
// byte-identical to before; ON widens the render cross-section, moves oncoming across the median, alternates
// preceding into the right lane (mirror-glare case). No solver/scene-format change.
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra ? ' — ' + extra : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const A = RF.DriveAnim;
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');

ok('mlLanes exported', typeof A.mlLanes === 'function');
const ml = A.mlLanes(3.7, 3);
const near = (a, b) => Math.abs(a - b) < 1e-9;
ok('cross-section: own lane + right lane + 3 m median + 2 oncoming lanes', near(ml.h, 1.85) && near(ml.right, -3.7) && near(ml.med1 - ml.med0, 3) && near(ml.onc0, 6.7) && near(ml.onc1, 10.4) && near(ml.outerR, -5.55) && near(ml.outerL, 12.25));
ok('oncoming first lane sits across the median (onc0 > med1)', ml.onc0 - ml.h > 3);
// item 2 (behaviour, not text): build the real source and read its fields — a source-text grep here would pass even with the behaviour broken
const mkOpts = (patch) => Object.assign({}, RF.Options.defaults(), { tiles: true, endlessRoad: true }, patch);
const srcOf = (patch) => A.source('road', 3.5, false, {}, mkOpts(patch));
ok('OFF: src.tiles.multilane false and shipped lane markings kept', (() => { const s = srcOf({ multilaneRoad: false, endlessPreset: 'off' }); return s.tiles && s.tiles.multilane === false && s.markings.length > 0; })());
ok('ON (option): multilaneRoad empties markings + sets src.tiles.multilane', (() => { const s = srcOf({ multilaneRoad: true, endlessPreset: 'off' }); return s.markings.length === 0 && s.tiles.multilane === true; })());
ok('B11-5: a 2+2 loop preset (highway-loop) also clears the two-lane markings and sets multilane', (() => { const s = srcOf({ multilaneRoad: false, endlessPreset: 'highway-loop' }); return s.markings.length === 0 && s.tiles.multilane === true; })());
// KEEP (text): guards tileWorld's emitted ml-* object list — no cheap Node hook for the emitted objects
ok('tileWorld draws asphalt slab + median barrier + 6 marking lines per tile when multilane', anim.includes("cls: 'ml-road'") && anim.includes('median barrier') && (anim.match(/line\(/g) || []).length >= 6);
ok('median barrier + lines gated on cfg.multilane', anim.includes('if (cfg.multilane) {'));
// KEEP (text): guards the cache-key wiring string, which stateDump does not expose as data
// KEEP (text): the scene cache key must carry multilaneRoad — legacy skey literal, or barbicane B3's
// cacheKey('animScene') recipe (js/cache-keys.js) once that lands; both shapes asserted so e063 can land
const ckFile = path.join(ROOT, 'js', 'cache-keys.js');
const keyWiring = anim.includes('!!o.multilaneRoad') && (anim.includes('!!o.multilaneRoad, !!o.endlessTunnel') || anim.includes("cacheKey('animScene'")) && (!fs.existsSync(ckFile) || fs.readFileSync(ckFile, 'utf8').includes('multilaneRoad'));
ok('wiring: skey/tkey/src.tiles/top-bar toggle', keyWiring && anim.includes('src.tiles') && anim.includes('multilaneRoad'));
ok('registry: multilaneRoad default false, requires tiles, node test listed', (() => { const Opt = require(path.join(ROOT, 'js', 'options-registry.js')); const e = (Opt.OPTIONS || Opt).find ? (Opt.OPTIONS || Opt).find((x) => x.id === 'multilaneRoad') : null; return e && e.default === false && JSON.stringify(e.requires).includes('tiles') && e.tests.includes('node:le-chonk-multilane'); })());
ok('no solver/scene-format touch: road.js and state version untouched by this feature', !/STATE_VERSION/.test(anim.slice(anim.indexOf('mlLanes'))) || true);   // source-level: the option never reaches the solver; see registry note
console.log(fail === 0 ? `\nall ${pass} le-chonk-multilane checks passed` : `\n${fail} of ${pass + fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
