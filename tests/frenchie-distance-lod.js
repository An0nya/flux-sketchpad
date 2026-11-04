// frenchie / backlog §3 "level of detail by distance": registry + behaviour test for `distanceLod`.
// Node: node tests/frenchie-distance-lod.js — exits 1 on any failure. Scope: frenchie/S3LOD-SCOPE.md.
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
load();
const A = globalThis.RF.DriveAnim;
const Opt = require(path.join(ROOT, 'js', 'options-registry.js'));
const anim = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
const lay = fs.readFileSync(path.join(ROOT, 'js', 'drive-layout.js'), 'utf8');
const e = Opt.OPTIONS.find((x) => x.id === 'distanceLod');

// 1. registry: declared once, profile enum, default off, control, group, tests entry
ok('registry: distanceLod declared once, profile enum [off,low,medium,high], default "off"', Opt.OPTIONS.filter((x) => x.id === 'distanceLod').length === 1 && !!e && e.kind === 'profile' && e.type === 'enum' && JSON.stringify(e.values) === '["off","low","medium","high"]' && e.default === 'off');
ok('registry: control, group performance, tests entry', !!e && e.control === '[data-anim="distance-lod"]' && e.group === 'performance' && JSON.stringify(e.tests) === '["node:frenchie-distance-lod"]');
ok('registry: default is in DV_DEF', Opt.defaults().distanceLod === 'off');

// 2. the profile (exported on RF.DriveAnim next to shedPatch)
ok('lodPatch/LOD_LEVELS exported on RF.DriveAnim', typeof A.lodPatch === 'function' && !!A.LOD_LEVELS);
ok('off (or unknown) returns null — OFF = no patch = byte-identical', A.lodPatch({ distanceLod: 'off' }) === null && A.lodPatch({}) === null && A.lodPatch({ distanceLod: 'bogus' }) === null);
ok('caps are monotone with severity; haloRange is NOT patched (minimax F2: capping it truncates the halo look)', (() => { const L = A.LOD_LEVELS; const ps = ['low', 'medium', 'high'].map((k) => A.lodPatch({ distanceLod: k, haloRange: 400, scatterRange: 400, trafficRange: 800, scatterCullEps: 0.001, haloBins: 99 })); return !('haloRange' in ps[0]) && !('haloRange' in ps[2]) && ps[0].haloCars === 4 && ps[1].haloCars === 2 && ps[2].haloCars === 1 && !('haloBins' in ps[0]) && ps[0].scatterRange === 100 && ps[2].scatterRange === 50; })());
ok('min() with the user\'s own values: a lower user setting always wins (haloCars floor 1, scatterRange 50)', (() => { const p = A.lodPatch({ distanceLod: 'high', haloRange: 0, scatterRange: 50, trafficRange: 160, scatterCullEps: 100, haloCars: 1 }); return p.haloRange === undefined && p.haloCars === 1 && p.scatterRange === 50 && p.trafficRange === 160; })());
ok('F5: a knob edited mid-level is re-captured as the new base (not destroyed on lift)', /V\.lodBase\[k\] = o\[k\]/.test(fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8')));
ok('scatterCullEps multiplier is clamped at the registry max (100)', A.lodPatch({ distanceLod: 'high', haloRange: 400, scatterRange: 400, trafficRange: 800, scatterCullEps: 50 }).scatterCullEps === 100);

// 3. wiring: overlay in prepare(), control, labels sync, look key, exports, cache keys, layout
ok('prepare() applies the LOD overlay with base restore (off = no-op)', anim.includes('if (V.lodBase) { for (const k of LOD_KEYS)') && anim.includes('Object.assign(o, V.lodBase);') && anim.includes('const lod = lodPatch(o);') && anim.includes('else { V.lodBase = null; V.lodOver = null; }'));
ok('LOD keys are disjoint from the governor shed keys (no interaction)', (() => { const shed = anim.match(/const SHED_KEYS = \[[^\]]*\]/)[0]; return !['haloRange', 'scatterRange', 'trafficRange', 'scatterCullEps'].some((k) => shed.includes(k)); })());
ok('drive bar has the [data-anim="distance-lod"] select with change -> setDV', /data-anim': 'distance-lod'/.test(anim) && /ld\.addEventListener\('change', \(\) => \{ V\.lodOver = null; setDV\(ui, 'distanceLod', ld\.value\); \}\)/.test(anim));
ok('labels() syncs the select', anim.includes("ldEl.value = ['off', 'low', 'medium', 'high'].includes(o.distanceLod)"));
ok('look projection carries distanceLod', anim.includes("distanceLod: o.distanceLod || 'off'"));
ok('both spec-ui picture-cache keys carry o.distanceLod', (ui.match(/o\.distanceLod[,)\]]/g) || []).length === 2, (ui.match(/o\.distanceLod[,)\]]/g) || []).length);
ok('drive-layout Resolution pane lists the control', lay.includes("an('distance-lod')"));

console.log(n + ' checks, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
