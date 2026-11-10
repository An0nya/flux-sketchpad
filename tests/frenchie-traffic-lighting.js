// frenchie (10-31): backlog §5 "Traffic-lighting presets" — option `trafficLighting`, a dropdown that applies
// a street-lighting preset by writing the existing knobs (streetLamps / lampClass / lampRule). Default 'off'
// writes nothing, so OFF is byte-identical. The map + matcher live in options-registry.js (node-testable here).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
require(path.join(ROOT, 'tests/load.js')).load();   // full module set FIRST (an early require would make load() early-return)
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

// UI wiring — behaviour: drive the real select under a DOM stub (pattern of tests/traffic-subtick.js,
// neb 11-10); cache keys asked of the cache-keys module (frenchie 11-10, item 2)
const CK = require(path.join(ROOT, 'js', 'cache-keys.js'));
const om = CK.optionMap();
ok('both picture-cache recipes (stillFrame + ground) carry it', om.stillFrame.includes('trafficLighting') && om.ground.includes('trafficLighting'), { still: om.stillFrame.includes('trafficLighting'), ground: om.ground.includes('trafficLighting') });
// the select itself: drive the real control under a DOM stub (compact form of the traffic-subtick stub)
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function matches(e, sel) {
  const re = /(^|[.#\[])([^.#\[]+)/g; let m, tag = null; const attrs = []; let cls = null; let id = null; let rest = sel;
  const tm = rest.match(/^[a-zA-Z][a-zA-Z0-9]*/); if (tm) { tag = tm[0].toUpperCase(); rest = rest.slice(tm[0].length); }
  while (rest.length) {
    if (rest[0] === '.') { const mm = rest.match(/^\.([^.#\[]+)/); if (!mm) return false; cls = (cls || []); cls.push(mm[1]); rest = rest.slice(mm[0].length); }
    else if (rest[0] === '#') { const mm = rest.match(/^#([^.#\[]+)/); if (!mm) return false; id = mm[1]; rest = rest.slice(mm[0].length); }
    else if (rest[0] === '[') { const mm = rest.match(/^\[([^\]=]+)(?:="([^"]*)")?\]/); if (!mm) return false; attrs.push([mm[1], mm[2]]); rest = rest.slice(mm[0].length); }
    else return false;
  }
  if (tag && e.tagName !== tag) return false;
  if (id && e.attrs.id !== id) return false;
  if (cls && !cls.every((c) => (e.className || '').split(/\s+/).includes(c))) return false;
  for (const [k, v] of attrs) { const val = e.attrs[k]; if (val === undefined) return false; if (v !== undefined && val !== v) return false; }
  return true;
}
function queryAll(root, sel) {
  const parts = sel.trim().split(/\s+/); let cur = [root];
  for (const p of parts) {
    const next = []; const seen = new Set();
    const walk = (e) => { for (const c of e.children || []) { if (c.nodeType === 1 && !seen.has(c)) { seen.add(c); if (matches(c, p)) next.push(c); walk(c); } } };
    for (const e of cur) walk(e); cur = next;
  }
  return cur;
}
const ELS = [];
function el(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], attrs: {}, listeners: {},
    style: {}, dataset: {}, value: '', disabled: false, hidden: false, textContent: '', className: '', parentElement: null,
  };
  const cl = {
    add: (...c) => { const s = new Set((e.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); e.className = [...s].join(' '); },
    remove: (...c) => { const s = new Set((e.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => s.delete(x)); e.className = [...s].join(' '); },
    contains: (c) => (e.className || '').split(/\s+/).includes(c),
    toggle: (c, on) => { if (on === undefined) { if ((e.className || '').split(/\s+/).includes(c)) cl.remove(c); else cl.add(c); } else if (on) cl.add(c); else cl.remove(c); },
  };
  e.classList = cl;
  const isDesc = (a, b) => { let x = b; while (x) { if (x === a) return true; x = x.parentElement; } return false; };
  const detach = (k) => { if (isDesc(k, e)) return; if (k.parentElement) { const i = k.parentElement.children.indexOf(k); if (i >= 0) k.parentElement.children.splice(i, 1); } k.parentElement = e; };
  e.append = (...kids) => { for (const k of kids) { if (k === null || k === undefined) continue; if (k.nodeType) { detach(k); e.children.push(k); } else e.children.push({ nodeType: 3, text: String(k) }); } };
  e.appendChild = (k) => { e.append(k); return k; };
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); if (k.startsWith('data-')) e.dataset[camel(k.slice(5))] = String(v); };
  e.getAttribute = (k) => e.attrs[k];
  e.addEventListener = (t, fn) => { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.removeEventListener = () => {};
  e.dispatch = (t, ev) => { for (const fn of e.listeners[t] || []) if (typeof fn === 'function') fn(ev || { target: e }); };
  e.click = () => e.dispatch('click');
  e.matches = (sel) => matches(e, sel);
  e.closest = (sel) => { let x = e; while (x) { if (x.nodeType === 1 && matches(x, sel)) return x; x = x.parentElement; } return null; };
  e.prepend = (...kids) => { for (const k of kids.reverse()) { if (k && k.nodeType) { detach(k); e.children.unshift(k); } } };
  e.insertBefore = (k, ref) => { if (k && k.nodeType) { detach(k); const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, k); } return k; };
  e.remove = () => { if (e.parentElement) { const i = e.parentElement.children.indexOf(e); if (i >= 0) e.parentElement.children.splice(i, 1); e.parentElement = null; } };
  e.replaceChildren = (...kids) => { e.children = []; e.append(...kids); };
  e.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 });
  e.after = () => {}; e.before = () => {};
  e.focus = () => {}; e.blur = () => {};
  Object.defineProperty(e, 'options', { get() { return e.children.filter((c) => c.nodeType === 1 && c.tagName === 'OPTION'); } });
  Object.defineProperty(e, 'firstElementChild', { get() { return e.children.find((c) => c.nodeType === 1) || null; } });
  Object.defineProperty(e, 'lastElementChild', { get() { const k = e.children.filter((c) => c.nodeType === 1); return k[k.length - 1] || null; } });
  Object.defineProperty(e, 'previousElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return i > 0 ? e.parentElement.children[i - 1] : null; } });
  Object.defineProperty(e, 'nextElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return i >= 0 ? e.parentElement.children[i + 1] : null; } });
  Object.defineProperty(e, 'selectedIndex', { get() { return e.options.findIndex((x) => x.attrs.value === e.value); } });
  e.clientWidth = 1440; e.clientHeight = 900; e.scrollHeight = 900;
  e.innerHTML = ''; Object.defineProperty(e, 'innerHTML', { get: () => e._html || '', set: (v) => { e._html = v; if (v === '') e.children = []; } });
  e.querySelector = (s) => queryAll(e, s)[0] || null;
  e.querySelectorAll = (s) => queryAll(e, s);
  ELS.push(e);
  return e;
}
const body2 = el('body');
globalThis.document = { createElement: el, createTextNode: (t) => ({ nodeType: 3, text: String(t) }), body: body2, activeElement: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const vm2 = require('vm');
for (const f of ['panels', 'spec-ui']) vm2.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), { filename: f });
const scene2 = RF.State.defaultScene(); scene2.mode = 'D';
const ui2 = { store: { scene: scene2 }, redrawSpec: () => {}, redraw: () => {} };
const wrap2 = el('div'); body2.append(wrap2); const cv2 = el('canvas'); wrap2.append(cv2);
RF.SpecUI.driveTools(ui2, cv2);
const tlSel = ELS.find((e) => e.attrs['data-dv'] === 'trafficLighting');
ok('spec-ui select exists in the real bar', !!tlSel && tlSel.tagName === 'SELECT', { found: !!tlSel });
if (tlSel) {
  const preset = Object.keys(RF.Options.TRAFFIC_LIGHTING)[0];
  tlSel.value = preset; tlSel.dispatch('change');
  const o = RF.SpecUI.dvOpts(ui2);
  const w = RF.Options.TRAFFIC_LIGHTING[preset];
  ok('picking a preset applies the whole map via the control (setDV per knob)', Object.keys(w).every((k) => o[k] === w[k]), { preset, applied: Object.keys(w).filter((k) => o[k] === w[k]).length + '/' + Object.keys(w).length });
  ui2.driveBar.append(tlSel);
  RF.SpecUI.driveTools(ui2, cv2);
  ok('label sync recomputes the match (the select shows trafficLightingOf(o))', tlSel.value === RF.Options.trafficLightingOf(o), { value: tlSel.value, match: RF.Options.trafficLightingOf(o) });
}
// 11-02 merge-review follow-up (qwen): the old whole-text includes() passed even when the selector sat
// as an ignored 5th row element (place() drops it) — assert the EXECUTED row shape instead
require(path.join(ROOT, 'js', 'drive-layout.js'));   // IIFE: sets globalThis.RF.DriveLayout
// the old raw row-text check was superseded by the executed row-shape checks below (frenchie 11-10, item 2)
const layRows = globalThis.RF && RF.DriveLayout ? RF.DriveLayout.LAYOUT : null;
ok('every LAYOUT row has exactly 4 elements [tab, sub, title, sels] (a 5th is silently dropped by place())', !!layRows && layRows.every((r) => Array.isArray(r) && r.length === 4), layRows && layRows.filter((r) => r.length !== 4).map((r) => [r.length, r[2]]));
const lampsRow = layRows ? layRows.find((r) => r[2] === 'Street lamps') : null;
ok('Street lamps row carries trafficLighting INSIDE its selector list', !!lampsRow && lampsRow[3].includes('[data-dv="trafficLighting"]'), lampsRow && lampsRow[3]);
// the raw row-text check was superseded by the executed LAYOUT row-shape checks above (frenchie 11-10, item 2)
ok('gate + all registered', fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8').includes("'frenchie-traffic-lighting'") && fs.readFileSync(path.join(ROOT, 'tests/all.js'), 'utf8').includes('frenchie-traffic-lighting'));

console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
