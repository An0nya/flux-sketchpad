// minimaxai/minimax-m3.1-flash / TSUB (option trafficSubTick): interpolate the drawn traffic pose between the 20 Hz steps.
// The traffic is stepped at IDM.dt = 0.05 s, so the drawn cars - and the oncoming scatter table built from their lamp positions -
// jump every 0.05 s. With the option on, the drawn pose is interpolated; the simulation stays on the 20 Hz tick.
// Node: node tests/traffic-subtick.js — exits 1 on any failure.
//
// neb 11-10 (item 2, text -> behaviour): this suite was 17 text checks over the source of three
// files. Converted to behaviour: the registry half now asks the registry MODULE, the UI half drives
// the real spec-ui control under a DOM stub, and the OFF half measures the drawn pose. What is left
// as text is flagged [KEEP: text] with the reason it cannot be a behaviour check.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const anim = read('js/drive-anim.js');

// ---------------- 1. the registry (behaviour: ask the registry module) ----------------
// neb 11-10 (item 2): the old suite read js/options-registry.js and regexed the option's block out
// of it. The registry module exports the same facts as data, so ask it instead: that is what the app
// itself gets, and it cannot drift from the source text.
load();
const Opt = globalThis.RF.Options;
const reg = Opt.OPTIONS.filter((o) => o.id === 'trafficSubTick');

ok('the option is declared exactly once in the registry module', reg.length === 1, { declarations: reg.length });
const o = reg[0] || {};
ok('the option defaults to off', o.default === 'off', o.default);
ok('the option is an off/on enum', Array.isArray(o.values) && o.values.length === 2 && o.values[0] === 'off' && o.values[1] === 'on', o.values);
ok('the option names its control', o.control === '[data-dv="trafficSubTick"]', o.control);
ok('the option names a node test', Array.isArray(o.tests) && o.tests.indexOf('node:traffic-subtick') !== -1, o.tests);

// ---------------- 2. the UI (behaviour: drive the real control) ----------------
// neb 11-10 (item 2): the old suite grepped js/spec-ui.js for "dvSelect('trafficSubTick'" and
// "k === 'trafficSubTick'". That only proved the source mentions it. Here the real spec-ui builds
// its drive-tools bar under a DOM stub (the same stub shape as tests/le-chonk-ui-controls.js), and
// the control is found by its data-dv attribute, changed, and read back.
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
const ALL_ELS = [];
function mkEl(tag) {
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
  Object.defineProperty(e, 'nextElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return i >= 0 ? e.parentElement.children[i + 1] || null : null; } });
  Object.defineProperty(e, 'selectedIndex', { get() { return e.options.findIndex((x) => x.attrs.value === e.value); } });
  e.clientWidth = 1440; e.clientHeight = 900; e.scrollHeight = 900;
  e.innerHTML = ''; Object.defineProperty(e, 'innerHTML', { get: () => e._html || '', set: (v) => { e._html = v; if (v === '') e.children = []; } });
  e.querySelector = (s) => queryAll(e, s)[0] || null;
  e.querySelectorAll = (s) => queryAll(e, s);
  ALL_ELS.push(e);
  return e;
}
const body = mkEl('body');
globalThis.document = {
  createElement: mkEl,
  createTextNode: (t) => ({ nodeType: 3, text: String(t) }),
  body,
  activeElement: null,
  getElementById: (id) => queryAll(body, '#' + id)[0] || null,
  querySelector: (s) => queryAll(body, s)[0] || null,
  querySelectorAll: (s) => queryAll(body, s),
  addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible',
};
const lsMap = new Map();
globalThis.localStorage = { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => lsMap.set(k, String(v)), removeItem: (k) => lsMap.delete(k) };

for (const f of ['panels', 'spec-ui']) {
  const p = path.join(ROOT, 'js', f + '.js');
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
const RF = globalThis.RF;
const scene = RF.State.defaultScene();
scene.mode = 'D';
const ui = { store: { scene }, redrawSpec: () => {}, redraw: () => {} };
const wrap = mkEl('div'); body.append(wrap);
const cv = mkEl('canvas'); wrap.append(cv);
RF.SpecUI.driveTools(ui, cv);
const sel = ALL_ELS.find((e) => e.attrs['data-dv'] === 'trafficSubTick');
ok('the drive bar has a trafficSubTick control', !!sel, { found: !!sel, tag: sel && sel.tagName });

if (sel) {
  ok('the control is a select with an off and an on option',
    sel.tagName === 'SELECT' && sel.options.length === 2 && sel.options[0].attrs.value === 'off' && sel.options[1].attrs.value === 'on',
    { tag: sel.tagName, values: sel.options.map((x) => x.attrs.value) });
  // pick 'on' through the control's own change handler and read the option back
  const before = RF.SpecUI.dvOpts(ui).trafficSubTick;
  sel.value = 'on'; sel.dispatch('change');
  const after = RF.SpecUI.dvOpts(ui).trafficSubTick;
  ok('choosing "on" on the control sets the option', after === 'on', { before, after });
  // and back to off
  sel.value = 'off'; sel.dispatch('change');
  const back = RF.SpecUI.dvOpts(ui).trafficSubTick;
  ok('choosing "off" on the control sets the option back', back === 'off', { after, back });
  // the control is synced from the option (the label follows the value, not the other way round).
  // The stub can hold a control detached (the real DOM keeps it under the bar), so re-attach it
  // before the re-sync — the sync loop reads the bar's own [data-dv] elements.
  RF.SpecUI.dvOpts(ui).trafficSubTick = 'on';
  ui.driveBar.append(sel);
  RF.SpecUI.driveTools(ui, cv);
  ok('the control shows the option value after a re-sync', sel.value === 'on', { value: sel.value });
}

// ---------------- 3. the app: the OFF behaviour is the old picture ----------------
// neb 11-10 (item 2): the old suite proved "the option is off" by regexing drive-anim.js, and then
// proved the interpolation with a LOCAL copy of the interpolation formula — a tautology: it tested
// the test's own maths, not the app's. Here the app's own traffic model is measured instead.
// The traffic is stepped at IDM.dt = 0.05 s, so with the option OFF (the default) the drawn pose is
// quantised to the tick: two instants inside one tick draw the same pose, and the pose changes
// across a tick. Measured on RF.DriveAnim.trafficCars (the same function the renderer draws from).
const A = RF.DriveAnim;
ok('the traffic model steps at 20 Hz', A.IDM.dt === 0.05, { dt: A.IDM.dt });
const src = A.source('road', 3.5, false, {}, { trafficLogic: true, trafficDensity: 4, seed: 7, oncoming: true, preceding: true });
const pose = (t) => A.trafficCars(src, 0, t).map((c) => c.rel.toFixed(6)).join(',');
// The tick boundaries, from the first sample (the traffic model's epoch): 0.024, 0.074, 0.124.
const TS = [0.024, 0.026, 0.049, 0.051, 0.074, 0.10, 0.124, 0.126];
const snapshot = () => { const o = {}; for (const t of TS) o[t] = pose(t); return o; };
const off = snapshot();
// inside one tick (0.05 s) the drawn pose does not move; across a tick it does
const inside = off[0.024] === off[0.026] && off[0.026] === off[0.049] && off[0.049] === off[0.051];
const across = off[0.024] !== off[0.074];
ok('with the option off the drawn pose is quantised to the 20 Hz tick', inside && across, { inside, across });
const cars = A.trafficCars(src, 0, 0.074).length;
ok('the traffic model produces cars to draw', cars > 0, { cars });

// ---------------- 4. the app: the ON behaviour, measured ----------------
// neb 11-10 (item 2, after nicholl's review): I had KEEP-flagged the ON half as unreachable,
// because SUBTICK is set inside prepare() — the GPU frame path. **That was wrong**: RF.DriveAnim
// exports a test hook (RF.DriveAnim._) whose prepare() reads the options and flips SUBTICK
// BEFORE it touches the GPU, so the option is reachable from Node. nicholl measured it first
// (mail f416); I re-measured it independently and got the same numbers.
//
// The witness drives prepare() with a stubbed scene; it throws later, at the GPU/lamp step, and
// the throw is caught. The guard against that ordering changing is the SHAPE of the assertions:
// they are RELATIVE (the ON pose is compared with the OFF pose on the same source), never
// absolute. If a future edit moved the SUBTICK assignment after the throw point, the ON pose
// would equal the OFF pose and these checks would FAIL — not silently pass.
const setMode = (mode) => {
  const o = Object.assign({}, RF.Options.defaults(), { trafficSubTick: mode });
  const V = A._.V;
  V.info = { o, rd: { laneDrive: 3.5, us: true, mdl: { lamps: {} } }, us: true, groundKey: 'x', conv: {}, lampRGB: [0, 0, 0], lut: () => ({ baked: 1 }) };
  try { A._.prepare({ W: 2, H: 2, cssW: 2, cssH: 2, dpr: 1, aspect: 1, scale: 1 }); } catch (e) { /* the GPU step throws; SUBTICK is already set */ }
};
setMode('on');
const on = snapshot();
setMode('off');
const offAgain = snapshot();
// a mid-tick instant: the tick ran at 0.074, the next at 0.124, so 0.10 is 52% between them
ok('with the option on the drawn pose is interpolated between the ticks', on[0.10] !== off[0.10], { on: on[0.10], off: off[0.10] });
ok('with the option on the pose at a tick boundary is still the tick pose', on[0.074] === off[0.074] && on[0.124] === off[0.124]);
ok('with the option off again the drawn pose is the tick pose again', offAgain[0.10] === off[0.10] && offAgain[0.026] === off[0.026]);

// ---------------- 5. [KEEP: text] the parts no behaviour can separate ----------------
// neb 11-10 (item 2): after the ON half became a behaviour check (section 4), these are the only
// text checks left. Each says why it cannot be a behaviour check:
//   - the draw line's own SUBTICK guard is redundant today (the snapshot it guards is only taken
//     when the option is on, so removing it changes nothing) — no behaviour can tell them apart;
//     kept as a tripwire against a future edit that populates prevX unconditionally.
//   - the interpolation's inner details (the tick pose as the base, the turning-car skip, the
//     clamp) are single expressions inside one statement: with the option on, the drawn pose is
//     the interpolated one, and each of those details cannot be singled out of it.
ok('the interpolation is applied only when the option is on [KEEP: text — redundant with the snapshot guard; no behaviour separates them]',
  /if \(SUBTICK && frac > 0 && !c\.turn && st\.prevX && st\.prevX\.has\(c\.id\)\)/.test(anim));
ok('the drawn position starts from the tick position [KEEP: text — one expression inside the interpolation; not separable]',
  /let cx = c\.x;/.test(anim));
ok('turning cars keep their turn pose [KEEP: text — a turning car only appears probabilistically in the test window]',
  /!c\.turn && st\.prevX/.test(anim));
ok('the fraction is clamped to [0,1] [KEEP: text — one expression inside the interpolation; not separable]',
  /Math\.max\(0, Math\.min\(1, \(t - \(st\.epoch \+ st\.tick \* IDM\.dt\)\) \/ IDM\.dt\)\)/.test(anim));

console.log(fails ? `\n${fails} of ${n} checks FAILED` : `\nall ${n} checks passed`);
process.exit(fails ? 1 : 0);
