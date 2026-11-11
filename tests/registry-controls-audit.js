// registry-controls-audit: every registry option's control EXISTS in the live DOM and WORKS —
// in Node, no browser, no GL (claude's brief item 1; item-2: text checks → behaviour checks).
//
// WHY THIS REPLACES A TEXT SCAN: the old registry audit (barbicane's 4f08, superseded by this)
// read index.html and js/drive-anim.js as TEXT and asked "does the string data-anim="x" appear
// somewhere?". That is a spelling check, not a behaviour check: a control can be spelled right and
// still be missing from the page, and a renamed local variable can redden the file while the
// behaviour is unchanged. This suite builds the REAL UI under a DOM stub and asks the behavioural
// questions instead:
//
//   1. does the element exist in the live DOM, and is it reachable in the layout tree?
//   2. does clicking the toggle change the option it claims to control?
//   3. does the option's value come back out as the control's own state?
//   4. does the control carry a label a user can read?
//   5. does a control the registry says is gated actually report itself disabled?
//
// SCOPE: the whole registry, both halves — the data-anim toolbar (drive-anim.js, uncovered by any
// suite) and the data-dv bar (spec-ui.js). The data-dv half overlaps tests/le-chonk-ui-controls.js
// on existence and click; this suite adds the data-anim half and the round-trip (option → control
// state), which is the half no suite had.
//
// Run: node tests/registry-controls-audit.js — exits 1 on any failure.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, ROOT } = require('./load.js');
let fails = 0, n = 0;
const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  - ' + JSON.stringify(detail))); if (!cond) fails++; };
console.log('registry-controls-audit — registry controls exist and work, in Node');

// ---------------- minimal DOM stub (the le-chonk-ui-controls pattern) ----------------
// A real element: createElement returns one of these, with the DOM methods the app calls.
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function matches(e, sel) {
  const list = String(sel).split(',').map((p) => p.trim()).filter(Boolean);   // a selector LIST: any part matching is a match
  if (list.length > 1) return list.some((p) => matches(e, p));
  if (!list.length) return false;                         // an empty selector matches nothing (not everything)
  let tag = null, cls = null, id = null; const attrs = [];
  let rest = sel.trim();
  const tm = rest.match(/^[a-zA-Z][a-zA-Z0-9]*/); if (tm) { tag = tm[0].toUpperCase(); rest = rest.slice(tm[0].length); }
  while (rest.length) {
    if (rest[0] === '.') { const mm = rest.match(/^\.([^.#\[]+)/); if (!mm) return false; cls = (cls || []); cls.push(mm[1]); rest = rest.slice(mm[0].length); }
    else if (rest[0] === '#') { const mm = rest.match(/^#([^.#\[]+)/); if (!mm) return false; id = mm[1]; rest = rest.slice(mm[0].length); }
    else if (rest[0] === '[') { const mm = rest.match(/^\[([^\]=]+)(?:=(?:"([^\]]*)"|'([^\]]*)'|([^\]]*)))?\]/); if (!mm) return false; attrs.push([mm[1], mm[2] !== undefined ? mm[2] : (mm[3] !== undefined ? mm[3] : mm[4])]); rest = rest.slice(mm[0].length); }
    else return false;
  }
  if (tag && e.tagName !== tag) return false;
  if (id && e.attrs.id !== id) return false;
  if (cls && !cls.every((c) => (e.className || '').split(/\s+/).includes(c))) return false;
  for (const [k, v] of attrs) { const val = e.attrs[k]; if (val === undefined) return false; if (v !== undefined && val !== v) return false; }
  return true;
}
function queryAll(root, sel) {
  // A comma-separated selector LIST is the UNION of its groups (the DOM spec). The app uses that
  // form: js/drive-anim.js:2822 queries seven cabin-offset controls in one call. Splitting the
  // whole selector on whitespace instead would shred the groups and leave each with a trailing
  // comma, and the empty trailing group then matched EVERY element — which silently hid the
  // cabin-offset controls from the app's own `disabled` write. (That was a bug in this stub, not
  // in the app: the elements existed, the selector just did not find them.)
  const groups = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
  const out = []; const seen = new Set();
  for (const g of groups) {
    const parts = g.split(/\s+/);   // descendant combinators only
    let cur = [root];
    for (const p of parts) {
      const next = []; const seenG = new Set();
      const walk = (e) => { for (const c of e.children || []) { if (c.nodeType === 1 && !seenG.has(c)) { seenG.add(c); if (matches(c, p)) next.push(c); walk(c); } } };
      for (const e of cur) walk(e);
      cur = next;
    }
    for (const e of cur) if (!seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}
const ALL_ELS = [];
function mkEl(tag) {
  const e = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], attrs: {}, listeners: {},
    style: {}, dataset: {}, value: '', disabled: false, hidden: false, textContent: '', className: '', parentElement: null,
  };
  const cl = { add: (...c) => { const s = new Set((e.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); e.className = [...s].join(' '); }, remove: (...c) => { const s = new Set((e.className || '').split(/\s+/).filter(Boolean)); c.forEach((x) => s.delete(x)); e.className = [...s].join(' '); }, toggle: (c, f) => { const has = (e.className || '').split(/\s+/).includes(c); const want = f === undefined ? !has : !!f; if (want) cl.add(c); else cl.remove(c); return want; }, contains: (c) => (e.className || '').split(/\s+/).includes(c) };
  e.classList = cl;
  // detach(k, newParent): move k out of its current parent's children and make newParent its
  // parent. The new parent must be an ARGUMENT, not the closure's `e`: after()/before() insert a
  // SIBLING, so their new parent is e.parentElement. (v3 of this suite had `detach` close over
  // `e`, so `prev.after(el)` set el.parentElement = prev instead of prev's parent — the element
  // then sat in the right children array with the wrong parent pointer, and the layout's
  // unit() helper (js/drive-layout.js, `e.parentElement.matches('.drive-slider')`) read that
  // wrong pointer and picked the wrong element to place. That silently moved unrelated controls
  // into each other's subtrees and made the label check read a label off the WRONG child.)
  const detach = (k, newParent) => { if (k === newParent) return;
    if (k.parentElement) { const i = k.parentElement.children.indexOf(k); if (i >= 0) k.parentElement.children.splice(i, 1); }
    k.parentElement = newParent; };
  // A text child contributes to the parent's textContent, as in the DOM: the app builds
  // E('summary', {}, 'use in traffic') and the label of that control IS that string.
  e.append = (...kids) => { for (const k of kids) { if (k === null || k === undefined) continue; if (k.nodeType) { detach(k, e); e.children.push(k); } else { const t = String(k); e.children.push({ nodeType: 3, text: t }); e.textContent += t; } } };
  e.appendChild = (k) => { e.append(k); return k; };
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); if (k.startsWith('data-')) e.dataset[camel(k.slice(5))] = String(v); if (k === 'class') e.className = String(v); };
  e.getAttribute = (k) => e.attrs[k];
  e.hasAttribute = (k) => Object.prototype.hasOwnProperty.call(e.attrs, k);
  e.removeAttribute = (k) => { delete e.attrs[k]; if (k.startsWith('data-')) delete e.dataset[camel(k.slice(5))]; if (k === 'class') e.className = ''; };
  e.toggleAttribute = (k, f) => { const want = f === undefined ? !e.hasAttribute(k) : !!f; if (want) e.setAttribute(k, ''); else e.removeAttribute(k); return want; };
  e.addEventListener = (t, fn) => { (e.listeners[t] = e.listeners[t] || []).push(fn); };
  e.dispatch = (t, ev) => { for (const fn of e.listeners[t] || []) if (typeof fn === 'function') fn(ev || { target: e }); };
  e.click = () => e.dispatch('click');
  e.matches = (sel) => matches(e, sel);
  e.closest = (sel) => { let x = e; while (x) { if (x.nodeType === 1 && matches(x, sel)) return x; x = x.parentElement; } return null; };
  e.prepend = (...kids) => { for (const k of kids.reverse()) { if (k && k.nodeType) { detach(k, e); e.children.unshift(k); } } };
  e.insertBefore = (k, ref) => { if (k && k.nodeType) { detach(k, e); const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, k); } return k; };
  e.remove = () => { if (e.parentElement) { const i = e.parentElement.children.indexOf(e); if (i >= 0) e.parentElement.children.splice(i, 1); e.parentElement = null; } };
  e.replaceChildren = (...kids) => { e.children = []; e.append(...kids); };
  e.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 });
  e.after = (...kids) => { const p = e.parentElement; if (!p) return; let i = p.children.indexOf(e) + 1; for (const k of kids) { if (k && k.nodeType) { detach(k, p); p.children.splice(i++, 0, k); } } };
  e.before = (...kids) => { const p = e.parentElement; if (!p) return; let i = p.children.indexOf(e); for (const k of kids) { if (k && k.nodeType) { detach(k, p); p.children.splice(i++, 0, k); } } };
  e.focus = () => {}; e.blur = () => {};
  Object.defineProperty(e, 'options', { get() { return e.children.filter((c) => c.nodeType === 1 && c.tagName === 'OPTION'); } });
  Object.defineProperty(e, 'firstElementChild', { get() { return e.children.find((c) => c.nodeType === 1) || null; } });
  Object.defineProperty(e, 'lastElementChild', { get() { const k = e.children.filter((c) => c.nodeType === 1); return k[k.length - 1] || null; } });
  Object.defineProperty(e, 'previousElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return i > 0 ? e.parentElement.children[i - 1] : null; } });
  Object.defineProperty(e, 'nextElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return i >= 0 ? e.parentElement.children[i + 1] : null; } });
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
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} });
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
const lsMap = new Map();
globalThis.localStorage = { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => lsMap.set(k, String(v)), removeItem: (k) => lsMap.delete(k) };

// ---------------- load the app, then the modules that build the drive UI ----------------
load();
for (const f of ['endless-axis-config', 'panels', 'spec-ui']) {
  const p = path.join(ROOT, 'js', f + '.js');
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
const RF = globalThis.RF, O = RF.Options;
ok('[SETUP] the app modules load under the DOM stub', !!RF.Options && !!RF.SpecUI && !!RF.DriveAnim && !!RF.DriveLayout);

// ---------------- build the real drive UI: spec-ui's bar, then drive-anim's toolbar ----------------
// The scene is 'road' (an animation scene), so drive-anim's sync() runs its normal path: the
// toolbar is built and labels() syncs it. V.lost makes sync() return before it needs a GL
// context, so the suite stays at ~0.5 s instead of rendering a frame.
const scene = RF.State.defaultScene(); scene.mode = 'D';
const ui = {
  store: { scene },
  dvOpts: Object.assign({}, O.defaults(), { scene: 'road' }),
  dvAnim: { view: 'anim', playing: false, popout: false, dist: 0, total: 0, t: 0 },
  redrawSpec: () => {}, redraw: () => {}, display: 'drive',
};
const wrap = mkEl('div'); body.append(wrap);
const cv = mkEl('canvas'); wrap.append(cv);
RF.SpecUI.driveTools(ui, cv);
ok('[SETUP] spec-ui built the drive-tools bar and the layout shell', !!ui.driveBar && !!ui.driveLayout);
// The toolbar drive-anim is handed must be the STABLE ui.driveBar, not a fresh element: drive-anim
// builds its buttons INTO the toolbar it is given (topButtons()/bars() append to it), and its
// "have I built this yet?" guards look for [data-game="toggle"] inside that same element
// (js/drive-anim.js:2157 topButtons, :2322 bars). Handing it a throwaway div makes every guard
// miss, so each sync() rebuilt ~136 controls — that is what made v2 of this suite take 93 s
// instead of a second, and it is a stub bug, not an app bug.
const I = {
  rd: { laneDrive: 3.5 }, o: ui.dvOpts, A: null, mirrored: false, us: { seed: 7 }, conv: null,
  lut: () => ({ low: [], high: [] }), tm: null, groundKey: 'k',
  setDV: (u, k, v) => { u.dvOpts[k] = v; }, toolbar: ui.driveBar,
};
RF.DriveAnim._.V.lost = true;
RF.DriveAnim.sync(ui, cv, I);
const L = ui.driveLayout;
// the live controls, by their data-anim / data-dv name
const live = {};
for (const e of ALL_ELS) {
  const a = e.attrs['data-anim'], d = e.attrs['data-dv'];
  if (a && !live['anim:' + a]) live['anim:' + a] = e;
  if (d && !live['dv:' + d]) live['dv:' + d] = e;
}
const layoutEls = new Set([L.root, L.top, L.strip, L.body, L.sheet, L.staging, L.stage, L.left, L.right, L.content, L.rcontent]
  .concat(Object.values(L.panes), Object.values(L.subs)));
const inLayout = (e) => { let x = e; while (x) { if (layoutEls.has(x)) return true; x = x.parentElement; } return false; };
const animCount = Object.keys(live).filter((k) => k.startsWith('anim:')).length;
const dvCount = Object.keys(live).filter((k) => k.startsWith('dv:')).length;
ok('[SETUP] drive-anim built its toolbar', animCount > 100, { anim: animCount, dv: dvCount });
// the toolbar must be REUSED, not rebuilt per sync: count the elements drive-anim owns before and
// after a second sync. A rebuild would mean the guard missed and the controls under test would be
// detached copies rather than the live ones.
const ownedBefore = ALL_ELS.length;
RF.DriveAnim.sync(ui, cv, I);
const ownedAfter = ALL_ELS.length;
ok('[SETUP] a second sync() reuses the toolbar instead of rebuilding it', ownedAfter === ownedBefore,
  { before: ownedBefore, after: ownedAfter, rebuilt: ownedAfter - ownedBefore });

// each half has its own owner: data-anim is synced by drive-anim's labels(), data-dv by
// spec-ui's driveTools(). Re-syncing the right one is what makes the round-trip check real.
const resync = (kind) => { if (kind === 'anim') RF.DriveAnim.sync(ui, cv, I); else RF.SpecUI.driveTools(ui, cv); };

// ---------------- 1. every registry control exists in the live DOM ----------------
console.log('\n--- 1. every registry option with a control selector has that element ---');
const withCtl = O.OPTIONS.filter((o) => o.control && o.control.trim() && o.control.trim() !== 'none');
const sel = (o) => (o.control.match(/data-(anim|dv)="([^"]+)"/) || []);
const prose = withCtl.filter((o) => !sel(o)[1]);           // a prose control ("Spec > Road sidebar row")
const missing = [], orphaned = [];
for (const o of withCtl) {
  const m = sel(o); if (!m[1]) continue;
  const key = m[1] + ':' + m[2];
  if (!live[key]) missing.push(o.id + ' -> ' + o.control);
  else if (!inLayout(live[key])) orphaned.push(o.id + ' -> ' + o.control);
}
ok('every registry control element exists in the live DOM', !missing.length, missing);
ok('every registry control element is reachable in the layout tree', !orphaned.length, orphaned);
ok('the registry has controls to audit (and the prose ones are named, not silently skipped)', withCtl.length > 100 && prose.length < 10,
  { controls: withCtl.length, prose: prose.map((o) => o.id) });

// ---------------- 2. clicking a toggle changes the option it claims to control ----------------
console.log('\n--- 2. clicking each bool toggle changes its option ---');
const boolOpts = withCtl.filter((o) => o.type === 'bool');
const stuck = [], notToggles = [];
for (const o of boolOpts) {
  const m = sel(o); if (!m[1]) continue;
  const el = live[m[1] + ':' + m[2]];
  if (!el) continue;
  if (el.tagName !== 'BUTTON') { notToggles.push(o.id + ' (' + el.tagName + ')'); continue; }
  const before = !!ui.dvOpts[o.id];
  el.click();
  const after = !!ui.dvOpts[o.id];
  if (before === after) stuck.push(o.id);
  el.click();                                   // flip back
}
ok('every bool control that is a button has a working click handler', !stuck.length, stuck);
ok('every bool control is a button or a named select', notToggles.length <= 1, notToggles);

// ---------------- 3. the option's value comes back out as the control's own state ----------------
console.log('\n--- 3. the option value comes back as the control state (the sync half) ---');
// Flip each bool option in the app's own option object, re-run the app's own sync for that half,
// and read the control's own attribute back. This is the behaviour the old text scan tried to
// prove by looking for the string 'aria-pressed' near the id in the source.
//
// NOT every aria-pressed is the option: some are DERIVED from the option (or from the view state)
// by the app. The derived ones are listed here with the source line that derives them, because a
// control whose pressed state is derived must be checked against the DERIVED value — comparing it
// with the raw option is a false failure, and skipping it silently would be a hole.
//   playing        js/drive-anim.js:2850  run = st.playing && (st.view === 'anim' || st.popout)
//   deerBehaviour  js/drive-anim.js:2832  D.Models.deerEnabled(o) = undefined ? !!detailedModels : !!deerBehaviour
//   gpuRenderer    js/drive-anim.js:2837  data-failed, NOT aria-pressed (the GPU switch has no pressed state)
//   safeGap        js/drive-anim.js:2879  o.safeGap !== false (true unless explicitly off)
//   high           js/drive-anim.js:2834  !!V.high (a session state, not the option)
//   cline          js/drive-anim.js:2888  o.cline === 'broken' && I.us
const DERIVED = {
  playing: (o, st) => st.playing && (st.view === 'anim' || st.popout),
  deerBehaviour: (o) => (o.deerBehaviour === undefined ? !!o.detailedModels : !!o.deerBehaviour),
  safeGap: (o) => o.safeGap !== false,
};
const syncChecked = [], syncBad = [];
for (const o of boolOpts) {
  const m = sel(o); if (!m[1]) continue;
  const el = live[m[1] + ':' + m[2]];
  if (!el || el.tagName !== 'BUTTON') continue;
  if (el.attrs['aria-pressed'] === undefined) continue;   // a control that does not report a pressed state
  const derived = DERIVED[o.id];
  const before = !!ui.dvOpts[o.id];
  const want = !before;
  ui.dvOpts[o.id] = want;
  resync(m[1]);
  // what the control SHOULD show: the derived expression if this option has one, else the option
  const expect = derived ? !!derived(ui.dvOpts, ui.dvAnim) : want;
  const got = el.attrs['aria-pressed'];
  syncChecked.push(o.id);
  if (got !== String(expect)) syncBad.push(o.id + ' (aria-pressed=' + got + ', expected=' + expect + ')');
  ui.dvOpts[o.id] = before;                                  // flip back
  resync(m[1]);
}
ok('the option value comes back as the control state', !syncBad.length, syncBad);
ok('the sync half actually exercised a meaningful number of controls', syncChecked.length >= 20, { checked: syncChecked.length });

// ---------------- 3b. the SELECT controls: both directions of the round trip ----------------
// A <select> carries its state in .value, not in aria-pressed, so the check above never touches
// it: 67 registry controls are selects. A select can be broken in two independent ways, and each
// needs a different question:
//
//   (a) the control does not SHOW what the user picked — the app's sync writes the wrong value
//       (or none): pick a different value, dispatch 'change', and the control must show it.
//   (b) the control does not FOLLOW the option — the app never writes the control back, so a
//       stale value survives a re-sync: corrupt the control's value and the app's own sync must
//       put it back.
//
// (b) is the one the text scan could never see (it looked for the string 'aria-pressed' near the
// id in the source), and (a) alone misses a DELETED sync line — the control keeps the value the
// test just set, so it looks right. Together they catch both.
//
// Per-control expectations would be brittle (the app derives many of these: airLevel comes from
// a bundle, trafficLighting from a preset), so the check asks the APP what the value should be:
// the control's own value after the app's own sync IS the answer. No table, no duplicated logic.
//
// The store is restored as a WHOLE, not key by key: some of these controls write MANY option keys
// at once (airLevel applies a bundle, trafficLighting a preset), so a per-key restore would leave
// the store dirty and every later check would read the dirt.
console.log('\n--- 3b. every select control shows the value and follows the option ---');
const selBad = [], selChecked = [];
const snapStore = () => JSON.stringify(ui.dvOpts);
const restoreStore = (s) => { const o = JSON.parse(s); for (const k of Object.keys(ui.dvOpts)) delete ui.dvOpts[k]; Object.assign(ui.dvOpts, o); };
for (const o of withCtl) {
  const m = sel(o); if (!m[1]) continue;
  const el = live[m[1] + ':' + m[2]]; if (!el) continue;
  if (el.tagName !== 'SELECT') continue;
  const choices = [...(el.options || [])].map((op) => op.attrs.value);
  if (choices.length < 2) continue;                    // a one-option select cannot change
  const store = snapStore(), v0 = el.value;
  const target = choices.find((v) => v !== v0);
  // (a) the control shows what the user picked
  el.value = target; el.dispatch('change', { target: el }); resync(m[1]);
  const shown = el.value;
  if (shown !== target) selBad.push(o.id + ' (picked ' + target + ', the control shows ' + shown + ')');
  // (b) the control follows the option: the app's own sync puts the value back
  const corrupt = choices.find((v) => v !== shown) ?? choices[0];
  el.value = corrupt; resync(m[1]);
  const back = el.value;
  if (back !== shown) selBad.push(o.id + ' (the app did not sync the control back: ' + shown + ' -> ' + back + ')');
  selChecked.push(o.id);
  // restore the whole store, then let the app re-sync the controls
  restoreStore(store); el.value = v0; resync(m[1]);
}
ok('every select control shows the value it was given and follows the option', !selBad.length, selBad);
ok('the select half actually exercised a meaningful number of controls', selChecked.length >= 20,
  { checked: selChecked.length });

// ---------------- 4. every control carries a label a user can read ----------------
console.log('\n--- 4. every registry control carries a visible label ---');
// A label is a title, an aria-label, or text the user can READ. Text can be the element's own
// textContent OR the text of a child the user sees: the traffic-beam-list control is a <details>
// whose visible label is its <summary> ("use in traffic", js/drive-anim.js:2466), so the reader
// has to descend. (v2 read only the element's own textContent and false-failed this one.)
const text = (e) => (e.textContent || '').trim() || (e.children || []).map(text).join(' ').trim();
const unlabelled = [];
for (const o of withCtl) {
  const m = sel(o); if (!m[1]) continue;
  const el = live[m[1] + ':' + m[2]];
  if (!el) continue;
  if (!(el.attrs.title || el.attrs['aria-label'] || text(el))) unlabelled.push(o.id + ' -> ' + o.control);
}
ok('every registry control has a title, an aria-label, or readable text', !unlabelled.length, unlabelled);

// ---------------- 5. a gated control reports itself disabled ----------------
// console.log('\n--- 5. the registry\'s gating agrees with the DOM\'s disabled state ---');
// The registry carries the gating as DATA (js/options-registry.js: RULES + need() + the
// 'requires'/'conflicts' arrays on each option). The old text scan checked that the DATA was
// there; this checks that the UI honours it: if the registry says this option needs something
// that is not true, the control must be disabled in the DOM, and if the requirement IS met the
// control must be enabled. RF.Options.unmet() is the app's own evaluator of that data.
const CTX = { renderer: 'cpu', preset: 'us' };
const gated = withCtl.filter((o) => (o.requires || []).some((r) => r.effect === 'disabled')
  || (o.conflicts || []).some((r) => r.effect === 'disabled'));
const gatedChecked = [], gatedBad = [];
for (const o of gated) {
  const m = sel(o); if (!m[1]) continue;
  const el = live[m[1] + ':' + m[2]];
  if (!el) continue;
  // the registry's own verdict: an unmet 'requires' rule OR a triggered 'conflicts' rule, either
  // with effect 'disabled', means the control must be disabled.
  const verdict = O.unmet(o.id, ui.dvOpts, CTX).some((u) => u.effect === 'disabled');
  const got = !!el.disabled;
  gatedChecked.push(o.id);
  if (verdict !== got) gatedBad.push(o.id + ' (registry says disabled=' + verdict + ', DOM disabled=' + got + ')');
}
ok('a control the registry gates reports itself disabled, and an ungated one does not',
  !gatedBad.length, gatedBad);
ok('the gating half actually exercised a meaningful number of controls', gatedChecked.length >= 5,
  { checked: gatedChecked.length, gated: gated.length });

console.log('\n' + (fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' registry-controls-audit checks passed'));
process.exit(fails ? 1 : 0);
