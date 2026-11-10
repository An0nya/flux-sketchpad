// barbicane (11-05, cyrus assignment) — seed option test. seed is an int road option (default 7, 0–99999)
// that seeds the deterministic traffic behaviour: dipFraction (high-beam dip timing) and weightedPick
// (traffic beam selection). Both are pure functions exported on RF.Drive.
//
// neb 11-10 (item 2, text -> behaviour): this suite was 22 checks over the SOURCE TEXT of five
// files (options-registry.js, drive.js, drive-anim.js, drive-layout.js, tests/gate.js) plus 11 calls
// of the exported pure functions. Converted to behaviour: the registry half asks the registry MODULE,
// the wiring half asks the app's OWN dip function (RF.Drive.Headlamp.dipParts) whether the seed
// reaches the traffic's high-beam dip, the UI half DRIVES the real seed control and the dice button
// under a DOM stub and reads what the app asks the store to do, the layout half asks the layout
// MODULE, and the gate half asks the GATE itself which suites node:all runs. The pure-function
// checks were already behaviour (they call the exported functions) and are kept as they are.
// What is left as text is flagged [KEEP: text] with the reason it cannot be a behaviour check.
// Node: node tests/barbicane-seed.js — exits 1 on any failure.
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
const D = RF.Drive;
const reg = Opt.OPTIONS.filter((o) => o.id === 'seed');
ok('the option is declared exactly once in the registry module', reg.length === 1, { declarations: reg.length });
const s = reg[0] || {};
ok('the option is an int from 0 to 99999 in steps of 1', s.type === 'int' && !!s.values && s.values.min === 0 && s.values.max === 99999 && s.values.step === 1, s.values);
ok('the option defaults to 7', s.default === 7, s.default);
ok('the option is in the road group', s.group === 'road', s.group);
ok('the option is labelled "scenery seed"', s.label === 'scenery seed', s.label);
ok('the option names its controls (the seed field and the dice button)', s.control === '[data-anim="seed"], [data-anim="dice"]', s.control);
ok('the option names its owner (drive-anim)', Array.isArray(s.owner) && s.owner.length === 1 && s.owner[0] === 'js/drive-anim.js', s.owner);
// neb 11-10 (item 2): the old suite tested /need\('seedUsed'\)/ against the STRINGIFIED requires —
// and the exported shape is {rule:'seedUsed', cond:...}, so that regex could never match: the old
// check passed for the wrong reason. Ask the module's own shape instead.
ok('the option requires seedUsed', Array.isArray(s.requires) && s.requires.length === 1 && s.requires[0] && s.requires[0].rule === 'seedUsed', s.requires);
ok('the option names a node test', Array.isArray(s.tests) && s.tests.indexOf('node:barbicane-seed') !== -1, s.tests);
ok('defaults(): seed === 7', Opt.defaults().seed === 7, Opt.defaults().seed);

// ---------------- 2. the pure functions (behaviour: the old suite already called them) ----------------
// neb 11-10 (item 2): these 11 checks were already behaviour — they call the exported pure functions
// RF.Drive.dipFraction / RF.Drive.weightedPick and assert the values. Nothing to convert; they are
// kept unchanged (the calls are the behaviour).
ok('dipFraction(7, car1, 200) deterministic', D.dipFraction(7, 'car1', 200) === 1);
ok('dipFraction(7, car1, 200) repeatable', D.dipFraction(7, 'car1', 200) === D.dipFraction(7, 'car1', 200));
ok('dipFraction: different seed → different result', D.dipFraction(7, 'car1', 200) !== D.dipFraction(99, 'car1', 200));
ok('dipFraction: distance affects dip (close=dipped, far=high)', D.dipFraction(7, 'car1', 50) < D.dipFraction(7, 'car1', 400) && D.dipFraction(7, 'car1', 400) === 1);
ok('dipFraction: undefined seed defaults to 7', D.dipFraction(undefined, 'car1', 200) === D.dipFraction(7, 'car1', 200));
ok('dipFraction: undefined carId defaults to still', D.dipFraction(7, 'still', 200) === D.dipFraction(7, undefined, 200));
ok('dipFraction: range 0-1', (() => { for (let s2 = 0; s2 <= 99999; s2 += 11111) { const v = D.dipFraction(s2, 'test', 300); if (v < 0 || v > 1) return false; } return true; })());
const pool3 = [{ id: 'beam-A' }, { id: 'beam-B' }, { id: 'beam-C' }];
ok('weightedPick(7, car1, pool3) deterministic', D.weightedPick(7, 'car1', pool3) === D.weightedPick(7, 'car1', pool3));
ok('weightedPick: different seed → potentially different pick', D.weightedPick(7, 'car1', pool3) !== D.weightedPick(12345, 'car1', pool3));
ok('weightedPick: empty pool → -1', D.weightedPick(7, 'car1', []) === -1);
ok('weightedPick: returns valid index (0..n-1)', (() => { const pick = D.weightedPick(7, 'car1', pool3); return pick >= 0 && pick < pool3.length; })());
ok('weightedPick: respect weights (beam-C weight 100, others 0)', D.weightedPick(7, 'car1', pool3, [0, 0, 100]) === 2);

// ---------------- 3. the wiring (behaviour: ask the app's own dip function) ----------------
// neb 11-10 (item 2): the old suite grepped drive.js for "dipFraction(o.seed" and for
// "dipFraction(p.src.traffic.seed" — two strings. The first one is now a behaviour check: the app's
// own RF.Drive.Headlamp.dipParts() takes the seed and returns the dip fraction it will draw, so
// asking it with two seeds shows whether the seed reaches the traffic's high-beam dip.
const ob = { x: -2, y: 0, z: 201.2, traffic: 'car1', nx: 0, ny: 1 };   // a car ~200 m ahead, facing the eye
const dipAt = (seed) => D.Headlamp.dipParts(ob, { seed, eye: [-2, 0.37, 1.2], mode: 'high-dip', conv: 'A' }).f;
ok('the app\'s own dip function reads the seed: seed 7 dips, seed 99 does not', dipAt(7) === 1 && dipAt(99) === 0, { s7: dipAt(7), s99: dipAt(99) });
ok('the app\'s dip function falls back to the default seed when none is given', dipAt(undefined) === dipAt(7), { undef: dipAt(undefined), s7: dipAt(7) });
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


// ---------------- 4. the UI (behaviour: drive the real controls) ----------------
// neb 11-10 (item 2): the old suite grepped drive-anim.js for '[data-anim="seed"]' and
// '[data-anim="dice"]'. That only proved the source mentions them. Here the real drive-anim builds
// its control bar under a DOM stub (the same stub shape as tests/traffic-subtick.js), the seed field
// and the dice button are found by their data-anim attributes, and the app's own handlers are
// observed: the field asks the store to set 'seed', the dice button asks for a fresh number.
const animSrc = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const patched = animSrc.replace(/\}\)\(typeof globalThis/, ';RF.DriveAnim.__bars = bars;})(typeof globalThis');
ok('the drive-anim source could be instrumented for the test', patched !== animSrc);
vm.runInThisContext(patched, { filename: 'js/drive-anim.js' });
const ui = { dvOpts: { seed: 7 }, driveBar: mkEl('div'), driveExtras: mkEl('div'), root: mkEl('div'), redrawSpec: () => {} };
const asked = [];
RF.DriveAnim.__bars(ui, (u, k, v) => asked.push([k, v]));
const find = (sel) => ALL_ELS.filter((e) => e.matches && e.matches(sel));
const seedInput = find('[data-anim="seed"]')[0];
const diceBtn = find('[data-anim="dice"]')[0];
ok('the drive bar has a seed field', !!seedInput, { found: find('[data-anim="seed"]').length });
ok('the drive bar has a dice button', !!diceBtn, { found: find('[data-anim="dice"]').length });
ok('the seed field is a number input bounded by the registry range',
  !!seedInput && seedInput.tagName === 'INPUT' && seedInput.attrs.type === 'number' && Number(seedInput.attrs.min) === 0 && Number(seedInput.attrs.max) === 99999,
  seedInput && { tag: seedInput.tagName, attrs: seedInput.attrs });
if (seedInput) {
  seedInput.value = '4242';
  seedInput.dispatch('change');
  ok('changing the seed field asks the store to set seed to its value',
    asked.length >= 1 && asked[0][0] === 'seed' && Number(asked[0][1]) === 4242, asked);
} else {
  ok('changing the seed field asks the store to set seed to its value', false, asked);
}
if (diceBtn) {
  const before = asked.length;
  diceBtn.click();
  const call = asked[before];
  ok('the dice button asks the store for a fresh seed inside the registry range',
    !!call && call[0] === 'seed' && Number.isFinite(Number(call[1])) && Number(call[1]) >= 0 && Number(call[1]) <= 99999, { call, all: asked });
} else {
  ok('the dice button asks the store for a fresh seed inside the registry range', false, asked);
}

// ---------------- 5. the layout (behaviour: ask the layout module) ----------------
// neb 11-10 (item 2): the old suite grepped drive-layout.js for "an('seed')" and "an('dice')". The
// layout module exports the row table as data, so ask it where those controls are placed.
// Exact selector match: a loose substring would also match 'seedX' (measured — a renamed control
// passed the first version of this check; the mutation has to be able to fail it).
const rows = (RF.DriveLayout.LAYOUT || []).map((r) => ({ tab: r[0], sub: r[1], title: r[2], sels: r[3] }));
const seedRow = rows.find((r) => (r.sels || []).some((s) => String(s).indexOf('[data-anim="seed"]') !== -1));
const diceRow = rows.find((r) => (r.sels || []).some((s) => String(s).indexOf('[data-anim="dice"]') !== -1));
ok('the layout module places the seed field in a row', !!seedRow, seedRow && { tab: seedRow.tab, title: seedRow.title });
ok('the layout module places the dice button in the same row as the seed field',
  !!seedRow && !!diceRow && seedRow.tab === diceRow.tab && seedRow.title === diceRow.title, { seed: seedRow && seedRow.title, dice: diceRow && diceRow.title });
ok('the seed controls sit in the scene tab\'s Road row',
  !!seedRow && seedRow.tab === 'scene' && seedRow.title === 'Road', seedRow && { tab: seedRow.tab, title: seedRow.title });

// ---------------- 6. the gate (behaviour: ask the gate which suites node:all runs) ----------------
// neb 11-10 (item 2): the old suite grepped tests/gate.js for "'barbicane-seed'". Ask the gate
// instead: --list-node-all prints exactly the suites the node:all group runs (nodeAll = the NODE
// array), so "is this suite in node:all?" is answerable without reading the source.
const gateList = require('child_process').execFileSync('node', [path.join(__dirname, 'gate.js'), '--list-node-all'], { cwd: ROOT, encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
ok('the gate runs this suite in node:all', gateList.indexOf('node:barbicane-seed') !== -1, { suites: gateList.length });

// ---------------- KEEP: text ----------------
// neb 11-10 (item 2): one string is left — drive.js calls "dipFraction(p.src.traffic.seed, ...)" for
// the traffic's own beam pick, inside the per-frame traffic path. It cannot be a behaviour check
// here: that call needs the drive view's frame loop and the traffic's live source scene, and this
// VM has no browser and no GPU (the drive path is measured on the host queue). The seed's effect on
// the traffic dip IS covered above, by the app's own dipParts() — so the option's behaviour is
// measured; only the traffic-source call site is left unmeasured here.
const drv = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
// the call must be exactly dipFraction(p.src.traffic.seed, ...) — a looser pattern still matched
// "seed + 1" (measured: the mutation did not fail the first version of this check)
ok('[KEEP: text] CPU: the traffic dip uses the traffic scene\'s seed', /dipFraction\(\s*p\.src\.traffic\.seed\s*,/.test(drv));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
