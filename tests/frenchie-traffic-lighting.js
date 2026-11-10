// frenchie (10-31): backlog §5 "Traffic-lighting presets" — option `trafficLighting`, a dropdown that applies
// a street-lighting preset by writing the existing knobs (streetLamps / lampClass / lampRule). Default 'off'
// writes nothing, so OFF is byte-identical. The map + matcher live in options-registry.js (node-testable here).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const O = require(path.join(ROOT, 'js/options-registry.js'));
const opt = O.OPTIONS.find((o) => o.id === 'trafficLighting');

ok('registry: trafficLighting declared once, enum, default off, group street-lamps, cost scene-regenerate', !!opt && opt.type === 'enum' && opt.default === 'off' && opt.group === 'street-lamps' && opt.cost === 'scene-regenerate' && opt.control === '[data-dv="trafficLighting"]', opt && { def: opt.default, group: opt.group });
ok('registry: entry is in the tail of OPTIONS (after signalConesOn; later options may append past it)', O.OPTIONS.findIndex((x) => x.id === 'trafficLighting') > O.OPTIONS.findIndex((x) => x.id === 'signalConesOn'));   // append-safe
ok('values: off + 5 presets', !!opt && opt.values.join(',') === 'off,sodium-urban,led-urban,sodium-all,led-sparse,no-lamps', opt && opt.values);

// preset map: every written value is a valid member of the target option's enum
ok('TRAFFIC_LIGHTING exported with 5 presets', O.TRAFFIC_LIGHTING && Object.keys(O.TRAFFIC_LIGHTING).length === 5);
const byId = Object.fromEntries(O.OPTIONS.map((o) => [o.id, o]));
let valid = true, bad = [];
for (const [name, w] of Object.entries(O.TRAFFIC_LIGHTING || {})) for (const [k, v] of Object.entries(w)) {
  const t = byId[k];
  if (!t || !(t.values || []).includes(String(v)) && t.type === 'enum') { valid = false; bad.push(name + ':' + k + '=' + v); }
  if (t && t.type === 'enum' && t.values && !t.values.map(String).includes(String(v))) { valid = false; bad.push(name + ':' + k + '=' + v); }
}
ok('every preset write is a valid enum member of its target option', valid, bad);
ok('no preset writes the preset key itself or an unknown option', Object.values(O.TRAFFIC_LIGHTING).every((w) => Object.keys(w).every((k) => byId[k] && k !== 'trafficLighting')));

// executed: the matcher
ok('trafficLightingOf: default options match nothing -> off', O.trafficLightingOf(O.defaults()) === 'off', O.trafficLightingOf(O.defaults()));
ok('trafficLightingOf: a preset\'s writes match that preset', O.trafficLightingOf({ ...O.defaults(), ...O.TRAFFIC_LIGHTING['led-urban'] }) === 'led-urban');
ok('trafficLightingOf: a hand-tweaked knob falls back to off', O.trafficLightingOf({ ...O.defaults(), ...O.TRAFFIC_LIGHTING['led-urban'], lampClass: 'V' }) === 'off');

// OFF semantics: 'off' is not in the map, so applying the select's off value writes nothing
ok("'off' is not a preset (applying it writes no knobs)", !O.TRAFFIC_LIGHTING['off']);

// UI wiring
const ui = fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8');
const ckFile = path.join(ROOT, 'js', 'cache-keys.js');
const ck = fs.existsSync(ckFile) ? fs.readFileSync(ckFile, 'utf8') : '';
const useCacheKey = ui.includes('cacheKey(');
ok('spec-ui select exists and applies the map via setDV', ui.includes("dvSelect('trafficLighting'") && /TRAFFIC_LIGHTING\[v\]/.test(ui) && /for \(const k in w\) setDV\(ui, k, w\[k\]\)/.test(ui));
ok('label sync recomputes the match (trafficLightingOf)', ui.includes("else if (k === 'trafficLighting') { b.value = RF.Options.trafficLightingOf(o); }"));
ok('both picture-cache keys carry it', useCacheKey ? (ck.match(/'trafficLighting'/g) || []).length >= 2 : ui.split('\n').filter((l) => l.includes('JSON.stringify') && l.includes('o.trafficLighting')).length === 2);
const lay = fs.readFileSync(path.join(ROOT, 'js/drive-layout.js'), 'utf8');
// 11-02 merge-review follow-up (qwen): the old whole-text includes() passed even when the selector sat
// as an ignored 5th row element (place() drops it) — assert the EXECUTED row shape instead
require(path.join(ROOT, 'js', 'drive-layout.js'));   // IIFE: sets globalThis.RF.DriveLayout
const layRows = globalThis.RF && RF.DriveLayout ? RF.DriveLayout.LAYOUT : null;
ok('every LAYOUT row has exactly 4 elements [tab, sub, title, sels] (a 5th is silently dropped by place())', !!layRows && layRows.every((r) => Array.isArray(r) && r.length === 4), layRows && layRows.filter((r) => r.length !== 4).map((r) => [r.length, r[2]]));
const lampsRow = layRows ? layRows.find((r) => r[2] === 'Street lamps') : null;
ok('Street lamps row carries trafficLighting INSIDE its selector list', !!lampsRow && lampsRow[3].includes('[data-dv="trafficLighting"]'), lampsRow && lampsRow[3]);
ok('raw Street lamps row text ends with the selector list closed (]], not ], dv(...))', /\['lighting', 'lamps', 'Street lamps', \[.*\]\],\s*$/.test(lay.split('\n').find((l) => l.includes("'Street lamps'")) || ''));
ok('gate + all registered', fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8').includes("'frenchie-traffic-lighting'") && fs.readFileSync(path.join(ROOT, 'tests/all.js'), 'utf8').includes('frenchie-traffic-lighting'));

console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
