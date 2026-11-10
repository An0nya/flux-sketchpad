// frenchie (10-31): backlog §5 "4-way signals with side-profile cones" — option `signalConesOn`, taken over
// from nemotron and re-scoped per qwen's REVIEW-signal-cones.md: GEOMETRY ONLY (the lit signal lamp already
// feeds the glare/veil path via glareEmitter in js/drive.js, so no glare change and no double-count; the
// emit cols / photometric units are deliberately untouched). When ON, K.signal adds a side-profile visor
// slab in front of the head; when OFF (default) the scene is byte-identical.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const { load } = require('./load.js');
const RF = load(ROOT);
const O = RF.Options ? RF.Options.OPTIONS : require(path.join(ROOT, 'js/options-registry.js')).OPTIONS;
const opt = O.find((o) => o.id === 'signalConesOn');

ok('registry: signalConesOn declared once, bool, default false, group traffic, cost scene-regenerate', !!opt && opt.type === 'bool' && opt.default === false && opt.group === 'traffic' && opt.cost === 'scene-regenerate' && opt.control === '[data-dv="signalConesOn"]', opt && { type: opt.type, def: opt.default, group: opt.group, cost: opt.cost });
ok('registry: entry is appended after heatShimmer (END region, not spliced)', O.findIndex((o) => o.id === 'signalConesOn') > O.findIndex((o) => o.id === 'heatShimmer'), O[O.length - 1].id);   // append-safe: later options may follow
ok('registry note records the qwen re-scope (glare already ships) and the volumetric pass', !!opt && /already feeds the glare/.test(opt.note) && /Volumetric cone in haze ships too/.test(opt.note));

// executed: K.signal OFF vs ON — visor only when on
const kit = RF.Drive.kit({ Lw: 3.5, A: null, rand: RF.Drive.rng(7) });
const before = kit.O.length;
kit.signal(100, 0, 5.25, 'red', false);
const offCount = kit.O.length - before;
ok('K.signal(cone=false) adds the shipped 4 objects (housing + 3 discs), nothing more', offCount === 4, offCount);
const kit2 = RF.Drive.kit({ Lw: 3.5, A: null, rand: RF.Drive.rng(7) });
const b2 = kit2.O.length;
kit2.signal(120, 0, 5.25, 'green', true);
const added = kit2.O.slice(b2);
ok('K.signal(cone=true) adds exactly three hoods (one per lamp)', added.length === 7, added.length);
const hoods = added.filter((o) => o.k === 'box' && o.hx === 0.075);
ok('the extras are per-lamp hoods above each disc (NOT a face-wide slab, which qwen measured occluding the lit lamp)', hoods.length === 3, added.map((o) => o.k + ':' + o.hx).join(','));

// executed: no glare double-count — measured via the module: a lit signal is one glare source with the
// option on or off (frenchie 11-10, item 2: the old check grepped drive.js for the ABSENCE of the string)
const kitG = RF.Drive.kit({ Lw: 3.5, A: null, rand: RF.Drive.rng(7) });
kitG.signal(100, 0, 5.25, 'red', true);
const gOn = RF.Drive.glareSources(kitG.O, [0, 0, 1.2], [], { signalConesOn: true });
const gOff = RF.Drive.glareSources(kitG.O, [0, 0, 1.2], [], { signalConesOn: false });
ok('glare: one source with the option on or off (no double-count, measured via RF.Drive.glareSources)', gOn.length === gOff.length && gOn.length > 0, { on: gOn.length, off: gOff.length });
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
// call-site placement is frame code, not askable from Node; the flag reaching the tile cfg is the executed
// check below, and the no-double-count is measured above.
ok('[KEEP: text — call-site placement is frame code; flag-reaches-tile-cfg is the executed check below] drive-anim passes the flag only to K.signal call sites', (anim.match(/K\.signal\([^\n]*signalConesOn/g) || []).length === 2 && !/glareSources[\s\S]{0,200}signalConesOn/.test(anim));
const { sceneKeyHas } = require('./scene-key.js');
ok('skey/animScene carries the option (scene rebuilds on toggle)', sceneKeyHas(anim, ROOT, 'signalConesOn'));
// the flags literal is built inside the drive frame (af06 measured); the tiles cfg carrying it is executed below.
ok('[KEEP: text — flags literal is frame-internal (af06 measured)] flags literal carries it to the tile loop', /signalConesOn: !!o\.signalConesOn/.test(anim));

// scene level: a tiles source with the flag on builds visors, off does not (executed, not grep)
const mk = (on) => {
  const s = RF.DriveAnim.source('road', 3.5, true, { signs: true, posts: true, signalConesOn: on }, { tiles: true, seed: 7, density: 1.5 });
  const tiles = s.tiles;
  return tiles;
};
const withOn = mk(true), withOff = mk(false);
const countSig = (t) => {
  // walk the tile objects of a junction tile via the anim path is heavy; instead count signal visors in the built world objects is GPU-side.
  // Use the source's tiles flags + a direct kit probe (above) — here assert the flag reaches the tile cfg:
  return !!t && t.flags && t.flags.signalConesOn;
};
ok('tiles cfg carries signalConesOn true/false through the source', countSig(withOn) === true && countSig(withOff) === false, { on: countSig(withOn), off: countSig(withOff) });

// spec-ui + layout — behaviour: drive the real control under a DOM stub (pattern of tests/traffic-subtick.js,
// neb 11-10) and ask the cache-keys / layout modules (frenchie 11-10, item 2)
const CK = require(path.join(ROOT, 'js', 'cache-keys.js'));
const om = CK.optionMap();
ok('both picture-cache recipes (stillFrame + ground) + animScene carry it', om.stillFrame.includes('signalConesOn') && om.ground.includes('signalConesOn') && om.animScene.includes('signalConesOn'), { still: om.stillFrame.includes('signalConesOn'), ground: om.ground.includes('signalConesOn'), scene: om.animScene.includes('signalConesOn') });
const Layout = RF.DriveLayout;
const sigRow = (Layout.LAYOUT || []).find((r) => (r[3] || []).some((s) => s === '[data-dv="signalConesOn"]'));
ok('drive-layout has a row with the control (asked of the layout module)', !!sigRow, sigRow && { tab: sigRow[0], sub: sigRow[1], title: sigRow[2] });

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function matches(e, sel) {
  let tag = null; const attrs = []; let cls = null; let id = null; let rest = sel;
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
  Object.defineProperty(e, 'nextElementSibling', { get() { if (!e.parentElement) return null; const i = e.parentElement.children.indexOf(e); return i >= 0 ? e.parentElement.children[i + 1] : null; } });
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
  body, activeElement: null,
  getElementById: (id) => queryAll(body, '#' + id)[0] || null,
  querySelector: (s) => queryAll(body, s)[0] || null,
  querySelectorAll: (s) => queryAll(body, s),
  addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible',
};
const lsMap = new Map();
globalThis.localStorage = { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => lsMap.set(k, String(v)), removeItem: (k) => lsMap.delete(k) };
const vm = require('vm');
for (const f of ['panels', 'spec-ui']) {
  const p = path.join(ROOT, 'js', f + '.js');
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
const scene = RF.State.defaultScene();
scene.mode = 'D';
const ui = { store: { scene }, redrawSpec: () => {}, redraw: () => {} };
const wrap = mkEl('div'); body.append(wrap);
const cv = mkEl('canvas'); wrap.append(cv);
RF.SpecUI.driveTools(ui, cv);
const sigBtn = ALL_ELS.find((e) => e.attrs['data-dv'] === 'signalConesOn');
ok('spec-ui button exists in the real bar', !!sigBtn, { found: !!sigBtn, tag: sigBtn && sigBtn.tagName });
if (sigBtn) {
  sigBtn.click();
  ok('clicking it sets the option', RF.SpecUI.dvOpts(ui).signalConesOn === true, { v: RF.SpecUI.dvOpts(ui).signalConesOn });
  ui.driveBar.append(sigBtn);
  RF.SpecUI.driveTools(ui, cv);
  ok('spec-ui label sync shows "signal cones" (the label follows the option)', sigBtn.textContent === 'signal cones', { text: sigBtn.textContent });
}

// OFF byte-identical: the hood add is guarded — the guard lives in scene-build code, not askable from Node;
// the OFF path is proven behaviourally by the executed K.signal checks above (cone=false adds exactly the
// shipped 4 objects) and the render ratio check below.
const sc = fs.readFileSync(path.join(ROOT, 'js/drive-scenes.js'), 'utf8');
ok('[KEEP: text — guard is in scene-build code; OFF proven by the executed K.signal checks + render below] hood add is inside `if (cone)` (OFF path untouched)', /if \(cone\) add\(\{ k: 'box', x: p\.x - 0\.24/.test(sc));
ok('gate + all registered', fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8').includes("'frenchie-signal-cones'") && fs.readFileSync(path.join(ROOT, 'tests/all.js'), 'utf8').includes('frenchie-signal-cones'));

// qwen P0 render check: the visor must not hide the lit lamp head-on. CPU render (node-only, fast), 3x3 window
// on the predicted lamp pixel, ON/OFF luminance ratio must stay ~1. Rig lifted from qwen3.8max/scripts/signal-visor-occlusion.js.
{
  const D = RF.Drive;
  const uniformLut = (cd) => D.lutFrom(() => cd);
  const lam = (r) => ({ rho: [r, r, r], gloss: null, emit: null, retro: null, id: 1 });
  const X = 4, Y = 0, Z = 1.8, LIT = 'amber';
  const build = (cone) => { const k = D.kit({ Lw: 3.5, A: null, rand: D.rng(7) }); k.signal(X, Y, Z, LIT, cone); return k.O; };
  const base = (objects) => ({ w: 65, h: 36, hfov: 60, eye: [-2, 0, 1.2], lamps: [[0, 0, 0.65]], lut: uniformLut(20000), conv: 'A', lane: 3.5,
    mats: { asphalt: lam(0.1), gravel: lam(0.1), pole: lam(0.03) }, scene: { objects, markings: [], verge: ['gravel', 1, 'gravel'] } });
  const offR = D.render(base(build(false))), onR = D.render(base(build(true)));
  const tanH = Math.tan(30 * Math.PI / 180), tanV = tanH * 36 / 65;
  const d = [X - 0.18 + 2, 0, Z - 1.2];
  const u = -(d[1] / d[0]) / tanH, v = (d[2] / d[0]) / tanV;
  const cx = Math.round((u + 1) / 2 * 65 - 0.5), cy = Math.round((1 - v) / 2 * 36 - 0.5);
  let sumOff = 0, sumOn = 0;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) { sumOff += D.probe(offR, x, y).L; sumOn += D.probe(onR, x, y).L; }
  ok('render: the hoods do not hide the lit lamp head-on (3x3 window ON/OFF > 0.9)', sumOn / sumOff > 0.9, { ratio: +(sumOn / sumOff).toFixed(4), sumOff: +sumOff.toFixed(1), sumOn: +sumOn.toFixed(1) });
}

// ---- volumetric cone (signalConesOn + lampCone on + mist): the signal table + wiring ----
const LD = RF.LampDist;
ok('lamp-dist exports signalDist + SIGNAL_HALF_ANGLE (15 deg)', !!LD.signalDist && LD.SIGNAL_HALF_ANGLE === 15);
{
  const f = LD.signalDist();
  ok('signalDist: 19x25 = 475 values, deterministic', f.length === 475 && LD.signalDist() === f);
  const at = (g, ph) => f[GAMMA_I(g) * 25 + ph / 15];
  function GAMMA_I(g) { for (let i = 0; i < 19; i++) if (i * 5 === g) return i; return -1; }
  const peak = at(90, 0);
  ok('signalDist: peak at gamma 90 (horizontal), phi 0 (the face normal)', peak === Math.max(...Array.from(f)) && peak > 0, { peak, max: Math.max(...Array.from(f)) });
  ok('signalDist: zero beyond 2x the half-angle from the axis (visor cutoff)', at(90, 45) === 0 && at(60, 0) === 0, { g90p45: at(90, 45), g60p0: at(60, 0) });
  ok('signalDist: falls off with angle (g90p15 < g90p0)', at(90, 15) < at(90, 0) && at(90, 15) > 0);
}
{
  // frenchie 11-10 (item 2): the lampcone module is requireable in Node (tests/lampcone-signal-restore.js
  // drives it), so ask it instead of grepping its source.
  const kit = RF.Drive.kit({ Lw: 3.5, A: null, rand: RF.Drive.rng(7) });
  kit.signal(100, 0, 5.25, 'red', true);
  const objs = kit.O;
  const lc = require(path.join(ROOT, 'js/drive-three-lampcone.js'));
  const sigLamp = lc.lampsOf(objs).find((x) => x.kind === 'signal');
  ok('lampsOf carries the signal face normal as st (asked of the module)', !!sigLamp && Array.isArray(sigLamp.st) && sigLamp.st.length === 2, sigLamp && { st: sigLamp.st });
  ok('signalConeLamps is exported and pure-gated on the option (asked of the module)', typeof lc.signalConeLamps === 'function' && lc.signalConeLamps(objs, true).length > 0 && lc.signalConeLamps(objs, false).length === 0, { on: lc.signalConeLamps(objs, true).length, off: lc.signalConeLamps(objs, false).length });
  // build()/draw() are closures inside createLampCone(renderer) — they need a GL renderer, no Node seam;
  // the signal-list gating is behaviour-checked via signalConeLamps above and the uniform restore suite.
  const lcSrc = fs.readFileSync(path.join(ROOT, 'js/drive-three-lampcone.js'), 'utf8');
  ok('[KEEP: text — build()/draw() are closures inside createLampCone(renderer), GL-only; gating covered by signalConeLamps above] build() collects signals only when look.signalConesOn', /p\.look && p\.look\.signalConesOn/.test(lcSrc));
  ok('[KEEP: text — GL-only closure as above] draw() signal pass is skipped when the list is empty (OFF byte-identical GL)', /if \(last\.signals && last\.signals\.length\)/.test(lcSrc));
  ok('[KEEP: text — look literal is frame-internal (af06 measured)] drive-anim look carries signalConesOn', /signalConesOn: !!o\.signalConesOn/.test(anim));
  ok('registry note mentions the volumetric pass', /Volumetric cone in haze ships too/.test(opt.note));
}

console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
