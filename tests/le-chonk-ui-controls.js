// le-chonk-ui-controls: drive-view controls behave, in Node — no browser, no GL (claude's brief item 1).
// Builds the spec-ui drive-tools bar against a minimal DOM stub and checks, for every registry option
// with a [data-dv] control: the control exists, activating it changes the option, and the disabled
// conditions clear when their requirements are turned on. Catches the roadSurfaces class: a toggle
// created with no click handler leaves the option stuck off and its dependent select greyed out.
// exits 1 on any failure. Run: node tests/le-chonk-ui-controls.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
console.log('le-chonk-ui-controls — drive-view controls in Node');

// ---------------- minimal DOM stub ----------------
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function matches(e, sel) {
  // one simple selector: tag, .class, #id, [attr], [attr="v"] (combinations of those)
  const re = /(^|[.#\[])([^.#\[]+)/g; let m, tag = null;
  const attrs = []; let cls = null, id = null;
  let rest = sel;
  const tm = rest.match(/^[a-zA-Z][a-zA-Z0-9]*/); if (tm) { tag = tm[0].toUpperCase(); rest = rest.slice(tm[0].length); }
  while (rest.length) {
    if (rest[0] === '.') { const mm = rest.match(/^\.([^.#\[]+)/); if (!mm) return false; cls = (cls || []); cls.push(mm[1]); rest = rest.slice(mm[0].length); }
    else if (rest[0] === '#') { const mm = rest.match(/^#([^.#\[]+)/); if (!mm) return false; id = mm[1]; rest = rest.slice(mm[0].length); }
    else if (rest[0] === '[') { const mm = rest.match(/^\[([^\]=]+)(?:="([^\]]*)")?\]/); if (!mm) return false; attrs.push([mm[1], mm[2]]); rest = rest.slice(mm[0].length); }
    else return false;
  }
  if (tag && e.tagName !== tag) return false;
  if (id && e.attrs.id !== id) return false;
  if (cls && !cls.every((c) => (e.className || '').split(/\s+/).includes(c))) return false;
  for (const [k, v] of attrs) { const val = e.attrs[k]; if (val === undefined) return false; if (v !== undefined && val !== v) return false; }
  return true;
}
function queryAll(root, sel) {
  const parts = sel.trim().split(/\s+/);   // descendant combinators only
  let cur = [root];
  for (const p of parts) {
    const next = [];
    const seen = new Set();
  const walk = (e) => { for (const c of e.children || []) { if (c.nodeType === 1 && !seen.has(c)) { seen.add(c); if (matches(c, p)) next.push(c); walk(c); } } };
    for (const e of cur) walk(e);
    cur = next;
  }
  return cur;
}
const ALL_ELS = [];
function mkEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], attrs: {}, listeners: {},
    style: {}, dataset: {}, value: '', disabled: false, hidden: false, textContent: '', className: '', parentElement: null,
  };
  const cl = { add: (...c) => { const s = new Set((e.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); e.className = [...s].join(' '); }, remove: (...c) => { const s = new Set((e.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => s.delete(x)); e.className = [...s].join(' '); }, toggle: (c, f) => { const has = (e.className || '').split(/\s+/).includes(c); const want = f === undefined ? !has : !!f; if (want) cl.add(c); else cl.remove(c); return want; }, contains: (c) => (e.className || '').split(/\s+/).includes(c) };
  e.classList = cl;
  const isDesc = (a, b) => { let x = b; while (x) { if (x === a) return true; x = x.parentElement; } return false; };
  const detach = (k) => { if (isDesc(k, e)) return;   // never create a cycle (browser throws HierarchyRequestError; we skip) 
    if (k.parentElement) { const i = k.parentElement.children.indexOf(k); if (i >= 0) k.parentElement.children.splice(i, 1); } k.parentElement = e; };
  e.append = (...kids) => { for (const k of kids) { if (k === null || k === undefined) continue; if (k.nodeType) { detach(k); e.children.push(k); } else e.children.push({ nodeType: 3, text: String(k) }); } };
  e.appendChild = (k) => { e.append(k); return k; };
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); if (k.startsWith('data-')) e.dataset[camel(k.slice(5))] = String(v); };
  e.getAttribute = (k) => e.attrs[k];
  e.addEventListener = (t, fn) => { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.dispatch = (t, ev) => { for (const fn of e.listeners[t] || []) if (typeof fn === 'function') fn(ev || { target: e }); };
  e.click = () => e.dispatch('click');
  e.matches = (sel) => matches(e, sel);
  e.closest = (sel) => { let x = e; while (x) { if (x.nodeType === 1 && matches(x, sel)) return x; x = x.parentElement; } return null; };
  e.prepend = (...kids) => { for (const k of kids.reverse()) { if (k && k.nodeType) { detach(k); e.children.unshift(k); } } };
  e.insertBefore = (k, ref) => { if (k && k.nodeType) { detach(k); const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, k); } return k; };
  e.remove = () => { if (e.parentElement) { const i = e.parentElement.children.indexOf(e); if (i >= 0) e.parentElement.children.splice(i, 1); e.parentElement = null; } };
  e.replaceChildren = (...kids) => { e.children = []; e.append(...kids); };
  e.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 });
  e.after = (...kids) => { const p = e.parentElement; if (!p) return; let i = p.children.indexOf(e) + 1; for (const k of kids) { if (k && k.nodeType) { detach(k); p.children.splice(i++, 0, k); } } };
  e.before = (...kids) => { const p = e.parentElement; if (!p) return; let i = p.children.indexOf(e); for (const k of kids) { if (k && k.nodeType) { detach(k); p.children.splice(i++, 0, k); } } };
  e.focus = () => {}; e.blur = () => {};
  Object.defineProperty(e, 'options', { get() { return e.children.filter((c) => c.nodeType === 1 && c.tagName === 'OPTION'); } });
  Object.defineProperty(e, 'firstElementChild', { get() { return e.children.find((c) => c.nodeType === 1) || null; } });
  Object.defineProperty(e, 'lastElementChild', { get() { const k = e.children.filter((c) => c.nodeType === 1); return k[k.length - 1] || null; } });
  Object.defineProperty(e, 'previousElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return i > 0 ? e.parentElement.children[i - 1] : null; } });
  Object.defineProperty(e, 'nextElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return e.parentElement.children[i + 1] || null; } });
  Object.defineProperty(e, 'selectedIndex', { get() { return e.options.findIndex((o) => o.attrs.value === e.value); } });
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


// ---------------- load the app, then panels + spec-ui ----------------
load();
for (const f of ['panels', 'spec-ui']) {
  const p = path.join(ROOT, 'js', f + '.js');
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
const RF = globalThis.RF;
ok('[SETUP] panels + spec-ui load under the DOM stub', !!RF.Panels && !!RF.SpecUI && typeof RF.SpecUI.driveTools === 'function');

// ---------------- build the drive-tools bar ----------------
const scene = RF.State.defaultScene();
scene.mode = 'D';
const ui = { store: { scene }, redrawSpec: () => {}, redraw: () => {} };
const wrap = mkEl('div'); body.append(wrap);
const cv = mkEl('canvas'); wrap.append(cv);
RF.SpecUI.driveTools(ui, cv);   // builds ui.driveBar inside wrap
const bar = ui.driveBar;
ok('[SETUP] driveTools built a bar', !!bar, {});
// driveTools moves the controls into the layout shell (RF.DriveLayout staging -> tabs), so search the whole wrap
// the stub tree can hold detached fragments, so collect every element ever created and require the bar in its ancestor chain
const byDv = {};
for (const b of ALL_ELS) if (b.attrs['data-dv'] && !byDv[b.attrs['data-dv']]) byDv[b.attrs['data-dv']] = b;
const reachesBar = (e) => { let x = e, seen = new Set(); while (x && !seen.has(x)) { seen.add(x); if (x === bar) return true; x = x.parentElement; } return false; };
const L = ui.driveLayout, layoutEls = new Set([L.root, L.top, L.strip, L.body, L.sheet, L.staging, L.stage].concat(Object.values(L.panes), Object.values(L.subs)));
const reachesLayout = (e) => { let x = e, seen = new Set(); while (x && !seen.has(x)) { seen.add(x); if (layoutEls.has(x)) return true; x = x.parentElement; } return false; };
const placed = Object.values(byDv).filter(reachesLayout).length;
ok('[SETUP] controls were placed into the layout', placed > 40, { placed, total: Object.keys(byDv).length });
const O = RF.Options, opts = O.OPTIONS.filter((o) => o.control && o.control.includes('data-dv'));
ok('registry lists [data-dv] controls', opts.length > 40, { n: opts.length });

// ---------------- 1. every registry [data-dv] control exists in the bar ----------------
console.log('\n--- 1. every registry data-dv control is reachable in the bar ---');
const ctlKey = (o) => (o.control.match(/data-dv="([^"]+)"/) || [])[1];
const missing = opts.filter((o) => { const k = ctlKey(o); return !k || !byDv[k]; }).map((o) => o.id + " -> " + o.control);
ok('every registry option with a [data-dv] control has the element', !missing.length, missing);

// ---------------- 2. activating a toggle changes its option ----------------
console.log('\n--- 2. clicking each data-dv toggle changes its option (roadSurfaces class) ---');
const boolOpts = opts.filter((o) => o.type === 'bool' && byDv[o.id] && byDv[o.id].tagName === 'BUTTON');
let stuck = [];
for (const o of boolOpts) {
  const before = !!RF.SpecUI.dvOpts(ui)[o.id];
  byDv[o.id].click();
  const after = !!RF.SpecUI.dvOpts(ui)[o.id];
  if (before === after) stuck.push(o.id);
  byDv[o.id].click();   // flip back
}
ok('every data-dv toggle button has a working click handler', !stuck.length, stuck);

// ---------------- 3. selects set their option on change ----------------
console.log('\n--- 3. every data-dv select sets its option on change ---');
const selOpts = opts.filter((o) => o.kind !== 'derived' && ctlKey(o) === o.id && byDv[ctlKey(o)] && byDv[ctlKey(o)].tagName === 'SELECT' && byDv[ctlKey(o)].children.length > 1);
let deadSel = [];
for (const o of selOpts) {
  const s = byDv[ctlKey(o)];
  const v0 = s.children.map((c) => c.attrs.value).find((v) => v !== s.value) || s.children[0].attrs.value;
  const before = RF.SpecUI.dvOpts(ui)[o.id];
  s.value = v0; s.dispatch('change');
  const after = RF.SpecUI.dvOpts(ui)[o.id];
  if (before === after && String(before) === String(after)) deadSel.push(o.id + ' (' + v0 + ')');
  s.value = s.children[0].attrs.value; s.dispatch('change');   // restore
}
ok('every data-dv select commits a change', !deadSel.length, deadSel);

// ---------------- 4. disabled conditions clear when requirements are on ----------------
console.log('\n--- 4. dependent controls enable once their requirement is on ---');
// roadSurface select is greyed while roadSurfaces is off (spec-ui.js sync) — the roadSurfaces bug's blast radius
const rsBtn = byDv['roadSurfaces'], surfSel = byDv['roadSurface'];
ok('roadSurfaces toggle + roadSurface select both present', !!rsBtn && !!surfSel);
bar.append(...Object.values(byDv));   // re-attach (see below) then re-sync labels/disabled from current options
RF.SpecUI.driveTools(ui, cv);
ok('roadSurface is disabled while roadSurfaces is off', !!surfSel.disabled);
rsBtn.click();   // turn roadSurfaces on (pre-fix: no handler, nothing happens)
bar.append(...Object.values(byDv));   // in the real DOM the controls live under the bar (L.root = bar); the stub can hold them detached, so re-attach before re-sync
RF.SpecUI.driveTools(ui, cv);
ok('roadSurface enables once roadSurfaces is on', !!RF.SpecUI.dvOpts(ui).roadSurfaces && !surfSel.disabled, { roadSurfaces: RF.SpecUI.dvOpts(ui).roadSurfaces, disabled: surfSel.disabled });

console.log('\n' + (fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' le-chonk-ui-controls checks passed'));
process.exit(fails ? 1 : 0);
