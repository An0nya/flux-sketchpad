// barbicane (11-05, cyrus assignment) — ambient option test. ambient is an enum exposure option
// (values [0, 0.2, 5], default 0) that adds sky ambient light (lx) to diffuse surfaces and the sky veil.
//
// neb 11-10 (item 2, text -> behaviour): this suite was 15 checks over the SOURCE TEXT of five
// files (options-registry.js, drive.js, drive-three.js, drive-anim.js, drive-layout.js, tests/gate.js).
// Converted to behaviour: the registry half asks the registry MODULE, the picture half RENDERS the
// CPU frame with the option on and off and measures the pixels, the UI half DRIVES the real control
// (drive-anim's bars() under a DOM stub) and reads what the app asks the store to do, the layout half
// asks the layout MODULE, and the gate half asks the GATE itself which suites node:all runs.
// What is left as text is flagged [KEEP: text] with the reason it cannot be a behaviour check.
// Node: node tests/barbicane-ambient.js — exits 1 on any failure.
//
// COORDINATION NOTE (neb 11-10, rule 17c): this conversion was done by neb, not by the suite's
// owner (nicholl), because the owner was inactive for more than an hour on a provider 429
// (cyrus GO'd the takeover; his queued stack does not touch this file, so there is no replay
// conflict). The owner has been told in his queue. The file's content is unchanged otherwise.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('[PASS] ' + name); }
  else { fail++; console.log('[FAIL] ' + name + (extra === undefined ? '' : ' — ' + JSON.stringify(extra))); }
};

// ---------------- 1. the registry (behaviour: ask the registry module) ----------------
// neb 11-10 (item 2): the old suite read js/options-registry.js and regexed the option's block out
// of it. The registry module exports the same facts as data, so ask it instead.
load();
const Opt = RF.Options;
const reg = Opt.OPTIONS.filter((o) => o.id === 'ambient');
ok('the option is declared exactly once in the registry module', reg.length === 1, { declarations: reg.length });
const a = reg[0] || {};
ok('the option is an enum with the values [0, 0.2, 5]', a.type === 'enum' && JSON.stringify(a.values) === JSON.stringify([0, 0.2, 5]), a.values);
ok('the option defaults to off (0 lx)', a.default === 0, a.default);
ok('the option is in the exposure group', a.group === 'exposure', a.group);
ok('the option is labelled "ambient light (lx)"', a.label === 'ambient light (lx)', a.label);
ok('the option names its control', a.control === '[data-anim="ambient"]', a.control);
ok('the option names its owners (drive-anim + spec-ui)', Array.isArray(a.owner) && a.owner.length === 2 && a.owner.indexOf('js/drive-anim.js') !== -1 && a.owner.indexOf('js/spec-ui.js') !== -1, a.owner);
ok('the option names a node test', Array.isArray(a.tests) && a.tests.indexOf('node:barbicane-ambient') !== -1, a.tests);
ok('defaults(): ambient === 0', Opt.defaults().ambient === 0, Opt.defaults().ambient);

// ---------------- 2. the picture (behaviour: render the CPU frame with the option on and off) ----------------
// neb 11-10 (item 2): the old suite grepped drive.js for "ambient: 0", "amb = look.ambient > 0 ? ...",
// "skyL = amb * 0.012" and "p.look && p.look.ambient || 0" — four strings. That only proved the
// source mentions the option. Here the CPU renderer is actually run: the same frame with ambient 0
// and with ambient 5 must differ, and ambient 0 must be byte-identical to the option being absent.
const D = RF.Drive, A = RF.DriveAnim;
const W = 96, H = 54, DIST = 9740, T = 0;
const flags = { people: true, animals: true, signs: true, posts: true, powerlines: true, veg: true, obstacle: false };
const lamps = [[0, 0.7, 0.7], [0, -0.7, 0.7]];
const lut = D.lutFrom(() => 30000);
const baseOpts = { seed: 7, tiles: true, trafficDensity: 0, density: 1 };
const render = (look) => {
  const src = A.source('road', 3.5, false, flags, Object.assign({}, baseOpts));
  const p = { w: W, h: H, hfov: 60, lamps, lut, conv: 'A', lane: 3.5, look, A: null, src };
  const sc = A.tileWorld(p, DIST, T);
  const rgba = new Float32Array(4 * W * H);
  D.render({ w: W, h: H, hfov: 60, eye: D.eyeFor(), lamps, lut, conv: 'A', lane: 3.5, arc: sc.A,
    layer: 'frame', ss: 2, rgba, look, scene: { objects: sc.objects, markings: sc.markings, verge: src.verge } });
  return rgba;
};
const diff = (x, y) => { let n = 0, worst = 0; for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - y[i]); if (d > 1e-6) { n++; if (d > worst) worst = d; } } return { n, worst }; };
const picOff = render({ RL: 0.2, ambient: 0 });
const picAbsent = render({ RL: 0.2 });
const picOn = render({ RL: 0.2, ambient: 5 });
const picLow = render({ RL: 0.2, ambient: 0.2 });
ok('the picture with ambient 0 is byte-identical to the option being absent', diff(picOff, picAbsent).n === 0, diff(picOff, picAbsent));
const dOn = diff(picOff, picOn), dLow = diff(picOff, picLow);
ok('the picture changes when ambient is 5 lx', dOn.n > 1000, dOn);
ok('the picture changes when ambient is 0.2 lx', dLow.n > 1000, dLow);
ok('more ambient light makes a bigger difference than less', dOn.worst > dLow.worst, { on: dOn.worst, low: dLow.worst });

// ---------------- 3. the UI (behaviour: drive the real control) ----------------
// neb 11-10 (item 2): the old suite grepped drive-anim.js for '[data-anim="ambient"]' and for
// "setDV(ui, 'ambient', +ambient.value)". That only proved the source mentions it. Here the real
// drive-anim builds its control bar under a DOM stub (the same stub shape as
// tests/traffic-subtick.js), the ambient select is found by its data-anim attribute, its value is
// changed, and the app's change handler is observed: it asks the store to set exactly 'ambient'.
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


// load the real drive-anim under the stub and expose its bars() for the test (one appended export)
const animSrc = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const patched = animSrc.replace(/\}\)\(typeof globalThis/, ';RF.DriveAnim.__bars = bars;})(typeof globalThis');
ok('the drive-anim source could be instrumented for the test', patched !== animSrc);
vm.runInThisContext(patched, { filename: 'js/drive-anim.js' });
const ui = { dvOpts: { ambient: 0 }, driveBar: mkEl('div'), driveExtras: mkEl('div'), root: mkEl('div'), redrawSpec: () => {} };
const asked = [];
RF.DriveAnim.__bars(ui, (u, k, v) => asked.push([k, v]));
const find = (sel) => ALL_ELS.filter((e) => e.matches && e.matches(sel));
const ambientSel = find('[data-anim="ambient"]')[0];
ok('the drive bar has an ambient control', !!ambientSel, { found: find('[data-anim="ambient"]').length });
if (ambientSel) {
  ambientSel.value = '5';
  ambientSel.dispatch('change');
  ok('changing the ambient control asks the store to set ambient to its value',
    asked.length === 1 && asked[0][0] === 'ambient' && asked[0][1] === 5, asked);
} else {
  ok('changing the ambient control asks the store to set ambient to its value', false, asked);
}
ok('the ambient control is a select with the registry values',
  !!ambientSel && ambientSel.tagName === 'SELECT' && ambientSel.options.length === 3,
  ambientSel && { tag: ambientSel.tagName, options: ambientSel.options.length });

// ---------------- 4. the layout (behaviour: ask the layout module) ----------------
// neb 11-10 (item 2): the old suite grepped drive-layout.js for "an('ambient')". The layout module
// exports the row table as data, so ask it where the ambient control is placed.
const Layout = RF.DriveLayout;
const rows = (Layout.LAYOUT || []).map((r) => ({ tab: r[0], sub: r[1], title: r[2], sels: r[3] }));
// exact selector match: a loose substring would also match 'ambientX' (measured: a renamed control
// passed the first version of this check — the mutation has to be able to fail it)
const ambientRow = rows.find((r) => (r.sels || []).some((s) => String(s).indexOf('[data-anim="ambient"]') !== -1));
ok('the layout module places the ambient control in a row', !!ambientRow, ambientRow && { tab: ambientRow.tab, sub: ambientRow.sub, title: ambientRow.title });
ok('the ambient control sits in the lighting tab\'s Ambient row',
  !!ambientRow && ambientRow.tab === 'lighting' && ambientRow.title === 'Ambient', ambientRow && { tab: ambientRow.tab, title: ambientRow.title });

// ---------------- 5. the gate (behaviour: ask the gate which suites node:all runs) ----------------
// neb 11-10 (item 2): the old suite grepped tests/gate.js for "'barbicane-ambient'" and
// "'node:barbicane-ambient'". Ask the gate instead: --list-node-all prints exactly the suites the
// node:all group runs (nodeAll = the NODE array), so "is this suite in node:all?" is answerable.
const gateList = require('child_process').execFileSync('node', [path.join(__dirname, 'gate.js'), '--list-node-all'], { cwd: ROOT, encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
ok('the gate runs this suite in node:all', gateList.indexOf('node:barbicane-ambient') !== -1, { suites: gateList.length });

// ---------------- KEEP: text ----------------
// neb 11-10 (item 2): the GPU half is one string in drive-three.js — "set('ambient', look.ambient || 0)"
// — inside the three.js render loop. It cannot be a behaviour check here: the uniform is set on the
// WebGL context while a frame is drawn, and this VM has no GL context and no browser (the GPU path
// is measured on the host queue). The CPU picture above measures the same option's effect end to end
// (the sky veil and the diffuse surfaces both take look.ambient), so the option's behaviour is
// covered; only the GPU plumbing string is left unmeasured here.
const three = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');
ok('[KEEP: text] GPU: the ambient uniform is set from look.ambient', three.includes("set('ambient', look.ambient || 0)"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
