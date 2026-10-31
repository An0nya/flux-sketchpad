// frenchie / Anya 10-31 IRL note "even dry pavement can be reflective": registry + behaviour test for `dryStreaks`.
// Node: node tests/frenchie-dry-streaks.js — exits 1 on any failure.
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
load();
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
const drv = fs.readFileSync(path.join(ROOT, 'js', 'drive.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const three = fs.readFileSync(path.join(ROOT, 'js', 'drive-three.js'), 'utf8');
const shaders = fs.readFileSync(path.join(ROOT, 'js', 'drive-three-shaders.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
const lay = fs.readFileSync(path.join(ROOT, 'js', 'drive-layout.js'), 'utf8');
const e = Opt.OPTIONS.find((x) => x.id === 'dryStreaks');

// 1. registry
ok('registry: dryStreaks declared once, profile bool, default false, control, group surface', Opt.OPTIONS.filter((x) => x.id === 'dryStreaks').length === 1 && !!e && e.kind === 'profile' && e.type === 'bool' && e.default === false && e.control === '[data-dv="dryStreaks"]' && e.group === 'surface');
ok('registry: default false in DV_DEF', Opt.defaults().dryStreaks === false);
ok('registry: tests entry', JSON.stringify(e.tests) === '["node:frenchie-dry-streaks"]');

// 2. OFF = byte-identical: with dryStreaks off/absent the floor is 0, so wetEff === wetness exactly
ok('CPU: wetEff floor is 0 unless dryStreaks is on (OFF: wetEff === wetW)', drv.includes('wetEff = Math.max(wetW, look.dryStreaks === true ? 0.25 : 0)'));
ok('CPU: the three streak sites use wetEff, general wetW untouched elsewhere', (drv.match(/\* wetEff/g) || []).length === 3 && drv.includes('sheen = wetEff > 0 && look.wetSheen'));
ok('CPU: wetVeil gate + mirror weight use the dry floor too', drv.includes('Math.max(+opts.wetness || 0, opts.dryStreaks ? 0.25 : 0) > 0') && (drv.match(/Math\.max\(\+opts\.wetness \|\| 0, opts\.dryStreaks \? 0\.25 : 0\)/g) || []).length === 2);
ok('GPU: wetness uniform = max(true wetness, floor) and sheen gate follows wetEff', three.includes('const wetEff = Math.max(D.wetnessOf(look), look.dryStreaks === true ? 0.25 : 0); set(\'wetness\', wetEff); set(\'sheen\', wetEff > 0 && look.wetSheen ? 1 : 0);'));
ok('GPU: the wetness uniform feeds ONLY the two streak terms in the ground shader (grain keeps true wetness)', (shaders.match(/wetness/g) || []).length === 3 && three.includes('D.wetnessOf(look) > 0 ? 0.5 : 1'));   // decl + 2 uses
ok('GPU-path gates (drive-anim 875/1369) go through sheenOn, which includes the dry floor', (anim.match(/sheenOn\(/g) || []).length === 2 && anim.includes('const sheenOn = (o) => (D.wetnessOf(o) > 0 || o.dryStreaks === true) && !!o.wetSheen;'));
ok('glareOpts carries dryStreaks to the CPU veil', anim.includes('dryStreaks: o.dryStreaks === true };'));

// 3. wiring: look key, cache keys, layout
ok('look projection carries dryStreaks', anim.includes("dryStreaks: o.dryStreaks === true }"));
ok('both spec-ui picture-cache keys carry o.dryStreaks', (ui.match(/o\.distanceLod, o\.dryStreaks\]\)/g) || []).length === 2);
ok('drive-layout Wet road row lists the control', lay.includes("dv('dryStreaks')"));

// 4. behaviour, executed: the CPU wetEff maths with the real helpers
const D = globalThis.RF.Drive;
const wetEffOf = (look) => Math.max(D.wetnessOf(look), look.dryStreaks === true ? 0.25 : 0);
ok('executed: dry (wetness 0) + dryStreaks on -> wetEff 0.25; off -> 0 (byte-identical)', wetEffOf({ wetness: 0, dryStreaks: true }) === 0.25 && wetEffOf({ wetness: 0 }) === 0 && wetEffOf({ wetness: 0, dryStreaks: false }) === 0);
ok('executed: wet road never lowered by the floor (max, not override)', wetEffOf({ wetness: 0.8, dryStreaks: true }) === 0.8);

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
