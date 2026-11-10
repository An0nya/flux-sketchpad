// endless-axis-ui (harbert, 11-10): part 2 of endless-road-v2 slice (a) — the endlessAxes registry option, the
// scene-tab axis controls and the share-preset. Node-only: the DOM mapping lives in RF.EndlessAxes
// (axisPair/axisFromPair/fromUi) precisely so this file can check it without a browser; the control BUILD itself
// is covered by the options-registry control check + le-chonk's ui-controls sweep class.
//   node tests/endless-axis-ui.js
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
globalThis.RF = {};
require(path.join(ROOT, 'js', 'options-registry.js'));
const A = require(path.join(ROOT, 'js', 'endless-axis-config.js'));
console.log('endless-axis-ui — the endlessAxes option, axis controls and preset');

// ---- 1. the registry option ----
const Opt = globalThis.RF.Options;
const e = Opt.OPTIONS.find((o) => o.id === 'endlessAxes');
ok('the endlessAxes option is declared', !!e);
ok('default is empty string (OFF = all axes auto, byte-identical v1 walk)', e && e.default === '');
ok('kind profile, type text, scene-regenerate cost, requires tiles', e && e.kind === 'profile' && e.type === 'text' && e.cost === 'scene-regenerate' && JSON.stringify(e.requires).includes('tiles'));
ok('declared tests include node:endless-axis-ui (this file) and it exists', e && (e.tests || []).includes('node:endless-axis-ui') && fs.existsSync(path.join(ROOT, 'tests', 'endless-axis-ui.js')));
ok('control selector cited and present in drive-anim.js (the group wrapper)', e && /data-anim="?endlessAxes"?'?/.test(e.control) && fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8').includes("'data-anim': 'endlessAxes'"));
ok('index.html loads the axis modules (axis-config before endless-relief)', (() => { const h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'); return h.includes('js/endless-axis-config.js') && h.includes('js/endless-relief.js') && h.indexOf('endless-axis-config.js') < h.indexOf('endless-relief.js'); })());

// ---- 2. OFF behaviour: '' parses to the all-auto config ----
const off = A.parse('');
ok("parse('') = all five axes auto, curviness 1", A.AXES.every((a) => off[a] === 'auto') && off.userCurviness === 1);
ok('fromUi of an all-auto group serializes back to empty string (the OFF value)', A.fromUi({ settlement: { lo: 'auto', hi: 'auto' }, roadClass: { lo: 'auto', hi: 'auto' }, relief: { lo: 'auto', hi: 'auto' }, cover: { lo: 'auto', hi: 'auto' }, water: { lo: 'auto', hi: 'auto' } }, 1) === '');
ok('fromUi clamps an out-of-range curviness into the JSON (0.25..4)', (() => { const j9 = A.fromUi({ settlement: { lo: 'auto', hi: 'auto' }, roadClass: { lo: 'auto', hi: 'auto' }, relief: { lo: 'auto', hi: 'auto' }, cover: { lo: 'auto', hi: 'auto' }, water: { lo: 'auto', hi: 'auto' } }, 9); return JSON.parse(j9).userCurviness === 4; })());

// ---- 3. the axis control mapping: pair <-> config, both directions ----
ok('axisPair: auto config -> auto/auto selects', JSON.stringify(A.axisPair({}, 'settlement')) === '{"lo":"auto","hi":"auto"}');
ok('axisPair: fixed rung -> same rung in both selects', JSON.stringify(A.axisPair({ settlement: 'city' }, 'settlement')) === '{"lo":"city","hi":"city"}');
ok('axisPair: range -> lo=min, hi=max', JSON.stringify(A.axisPair({ roadClass: { min: 'two-lane', max: 'dense-highway' } }, 'roadClass')) === '{"lo":"two-lane","hi":"dense-highway"}');
ok('axisFromPair: both auto -> auto', A.axisFromPair('relief', 'auto', 'auto') === 'auto');
ok('axisFromPair: lo===hi -> fixed rung', A.axisFromPair('cover', 'forest', 'forest') === 'forest');
ok('axisFromPair: lo<hi -> auto-within {min,max}', JSON.stringify(A.axisFromPair('relief', 'rolling', 'hilly')) === '{"min":"rolling","max":"hilly"}');
ok('axisFromPair: inverted pair swaps to ladder order (same semantics as parse)', JSON.stringify(A.axisFromPair('relief', 'hilly', 'rolling')) === '{"min":"rolling","max":"hilly"}');
ok('axisFromPair: half-set pair (one end auto) -> auto, not a broken range', A.axisFromPair('cover', 'forest', 'auto') === 'auto');
ok('axisFromPair: unknown rung -> auto (fail-soft, like parse)', A.axisFromPair('water', 'ocean', 'river') === 'auto');

// ---- 4. round trip: what the UI writes is what parse reads, and the timeline honours it ----
const uiJson = A.fromUi({ settlement: { lo: 'city', hi: 'city' }, roadClass: { lo: 'two-lane', hi: 'dense-highway' }, relief: { lo: 'auto', hi: 'auto' }, cover: { lo: 'auto', hi: 'auto' }, water: { lo: 'auto', hi: 'auto' } }, 1.25);
const cfg = A.parse(uiJson);
ok('UI JSON round-trips through parse (axes by name, ranges as ladder indices)', cfg.settlement === 'city' && cfg.userCurviness === 1.25 && cfg.roadClass.min === A.LADDERS.roadClass.indexOf('dense-highway') && cfg.roadClass.max === A.LADDERS.roadClass.indexOf('two-lane'));
const tl = A.timeline(7, uiJson, 64);
const fixed = tl.axes.settlement.filter((r) => r.value !== 'city');
ok('a fixed axis never leaves its rung (timeline honours the UI-written config)', fixed.length === 0, fixed.length + ' off-rung runs');
ok('determinism: same UI JSON, same timeline (first 5 run boundaries)', JSON.stringify(A.timeline(7, uiJson, 64).axes.settlement.slice(0, 5)) === JSON.stringify(tl.axes.settlement.slice(0, 5)));

// ---- 5. the share preset ----
const SP = require(path.join(ROOT, 'js', 'share-presets.js'));
const p = SP.get('endless-road');
ok("the 'endless-road' share preset exists and turns tiles + endless road on", !!p && p.tiles === true && p.endlessRoad === true);
ok('the preset is in names()', SP.names().includes('endless-road'));
ok('the preset endlessAxes string is valid per parse (fail-soft would hide a typo, so assert the range survives as ladder indices)', (() => { const c = A.parse(p.endlessAxes); return c.relief.min === A.LADDERS.relief.indexOf('rolling') && c.relief.max === A.LADDERS.relief.indexOf('hilly') && c.userCurviness === 1.25; })());
ok('the preset touches no legacy scene (scene stays road)', p.scene === 'road');
ok('a serialized preset applies onto registry defaults cleanly (apply writes valid options)', (() => { const store = { s: new Map(), setItem(k, v) { this.s.set(k, v); }, getItem(k) { return this.s.has(k) ? this.s.get(k) : null; } }; const okApply = SP.apply('endless-road', store); const saved = JSON.parse(store.getItem('flux/driveView')); return okApply === true && saved.endlessAxes === p.endlessAxes && saved.tiles === true; })());

// ---- 6. the scene dropdown entry (source-level: the option text + the handler) ----
const specUi = fs.readFileSync(path.join(ROOT, 'js', 'spec-ui.js'), 'utf8');
ok("the scene dropdown has an '__endless' entry labelled as a prototype", specUi.includes("'__endless'") && specUi.includes('Endless road (prototype)'));
ok('picking __endless sets tiles + endlessRoad; picking a real scene clears endlessRoad', specUi.includes("v === '__endless'") && specUi.includes("if (dvOpts(ui).endlessRoad) setDV(ui, 'endlessRoad', false)"));
ok('the scene sync shows __endless while tiles+endlessRoad are on', specUi.includes("o.endlessRoad && o.tiles ? '__endless' : o.scene"));
const scenes = fs.readFileSync(path.join(ROOT, 'js', 'drive-scenes.js'), 'utf8');
ok('the legacy scenes are labelled (legacy), values and builds untouched', scenes.includes("'Open road (legacy)'") && scenes.includes("'Forest road (legacy)'") && scenes.includes("'City street (legacy)'"));

// ---- 7. the axis controls exist in drive-anim.js and are placed in the scene pane ----
const da = fs.readFileSync(path.join(ROOT, 'js', 'drive-anim.js'), 'utf8');
const dl = fs.readFileSync(path.join(ROOT, 'js', 'drive-layout.js'), 'utf8');
ok('drive-anim builds the lo/hi pair per axis + the curviness input', A.AXES.every((a) => da.includes("'endlessAxes_' + axis + end") || (da.includes("endlessAxes_" + a)) ) && da.includes("'endlessCurviness'"));
ok('the axis group is placed in the scene pane (drive-layout endless row has an(endlessAxes))', dl.includes("an('endlessAxes')"));
ok('the sync block writes axisPair values back into the selects and the curviness input', da.includes('RF.EndlessAxes.axisPair(cfg, axis)') && da.includes('s2.value = String(cfg.userCurviness)'));

console.log('\n' + (fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' endless-axis-ui checks passed'));
process.exit(fails ? 1 : 0);
