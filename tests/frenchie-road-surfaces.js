// frenchie (11-04, Anya item 4; nemo/ROAD-SURFACES.md §7 RESOLVED 22:23Z) — road-surfaces PHYSICS option.
// roadSurfaces (bool, OFF) + roadSurface (enum, 'stock'): OFF = byte-identical. ON + non-stock: s drives
// k(s)=0.4+0.6s on the c(W)=W^2 wetBounce weight (CPU + 3 GPU sites) and the dryStreaks floor d0*s (d0=0.10).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
load();
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const D = RF.Drive;
const three = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');
const sh = fs.readFileSync(path.join(ROOT, 'js/drive-three-shaders.js'), 'utf8');
const halo = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

// ---- registry
const rs = Opt.OPTIONS.find((x) => x.id === 'roadSurfaces'), rsu = Opt.OPTIONS.find((x) => x.id === 'roadSurface');
ok('registry: roadSurfaces bool default false, surface group, control', !!rs && rs.type === 'bool' && rs.default === false && rs.group === 'surface' && rs.control === '[data-dv="roadSurfaces"]');
ok('registry: roadSurface enum stock default, values, requires roadSurfacesOn', !!rsu && rsu.type === 'enum' && rsu.default === 'stock' && JSON.stringify(rsu.values) === JSON.stringify(['stock', 'fresh', 'old', 'concrete', 'tar-snake']) && (rsu.requires || []).some((r) => r.rule === 'roadSurfacesOn'));
ok('registry: RULES has roadSurfacesOn on roadSurfaces eq true', !!Opt.RULES.roadSurfacesOn && JSON.stringify(Opt.RULES.roadSurfacesOn.cond) === JSON.stringify({ opt: 'roadSurfaces', eq: true }));
ok('defaults(): roadSurfaces false, roadSurface stock', Opt.defaults().roadSurfaces === false && Opt.defaults().roadSurface === 'stock');
ok('registry: haloConeEqui is registered (membership, not last-entry — a last-entry pin breaks the next appender, claude review 11-08)', Opt.OPTIONS.some((x) => x.id === 'haloConeEqui'));

// ---- laws (executed)
ok('executed: surfSOf undefined when OFF or stock', D.surfSOf({}) === undefined && D.surfSOf({ roadSurfaces: true, roadSurface: 'stock' }) === undefined && D.surfSOf({ roadSurface: 'fresh' }) === undefined);
ok('executed: surfSOf returns the spec s values', D.surfSOf({ roadSurfaces: true, roadSurface: 'fresh' }) === 0.35 && D.surfSOf({ roadSurfaces: true, roadSurface: 'old' }) === 0.22 && D.surfSOf({ roadSurfaces: true, roadSurface: 'concrete' }) === 0.30 && D.surfSOf({ roadSurfaces: true, roadSurface: 'tar-snake' }) === 0.50);
ok('executed: k(s)=0.4+0.6s; k=1 (byte-identical) when OFF/stock', D.surfKOf({}) === 1 && D.surfKOf({ roadSurfaces: true, roadSurface: 'stock' }) === 1 && Math.abs(D.surfKOf({ roadSurfaces: true, roadSurface: 'fresh' }) - 0.61) < 1e-12 && D.surfKOf({ roadSurfaces: true, roadSurface: 'tar-snake' }) === 0.7);
ok('executed: dryStreakFloorOf 0.25 when OFF/stock, d0*s (0.10) when ON', D.dryStreakFloorOf({}) === 0.25 && D.dryStreakFloorOf({ roadSurfaces: true, roadSurface: 'stock' }) === 0.25 && Math.abs(D.dryStreakFloorOf({ roadSurfaces: true, roadSurface: 'fresh' }) - 0.035) < 1e-12 && Math.abs(D.dryStreakFloorOf({ roadSurfaces: true, roadSurface: 'old' }) - 0.022) < 1e-12);
ok('executed: wetBounceW unchanged without a look (k=1) — W^2 law intact', Math.abs(D.wetBounceW(0, 1, 1) - 1) < 1e-12 && Math.abs(D.wetBounceW(0, 1, 0.4) - 0.16) < 1e-12 && D.wetBounceW(0, 1, 0) === 0);
ok('executed: wetBounceW applies k(s) with a look', Math.abs(D.wetBounceW(0, 1, 1, { roadSurfaces: true, roadSurface: 'tar-snake' }) - 0.7) < 1e-12 && Math.abs(D.wetBounceW(0, 1, 0.4, { roadSurfaces: true, roadSurface: 'old' }) - 0.16 * 0.532) < 1e-12);

// ---- wiring
// frenchie 11-10 (item 2, census): the two CPU source greps are now a behaviour check — the CPU frame is
// actually rendered with the option ON vs OFF. If any wetBounceW caller dropped the look argument (or the
// dryStreaks floor dropped dryStreakFloorOf), k(s) would stay 1 and the ON picture would equal the OFF one.
const A = RF.DriveAnim;
const W = 96, H = 54, DIST = 9740, T = 0;
const flags = { people: true, animals: true, signs: true, posts: true, powerlines: true, veg: true, obstacle: false };
const lamps = [[0, 0.7, 0.7], [0, -0.7, 0.7]];
const render = (look) => {
  const src = A.source('road', 3.5, false, flags, { seed: 7, tiles: true, trafficDensity: 0, density: 1 });
  const p = { w: W, h: H, hfov: 60, lamps, lut: D.lutFrom(() => 30000), conv: 'A', lane: 3.5, look, A: null, src };
  const sc = A.tileWorld(p, DIST, T);
  const rgba = new Float32Array(4 * W * H);
  D.render({ w: W, h: H, hfov: 60, eye: D.eyeFor(), lamps, lut: D.lutFrom(() => 30000), conv: 'A', lane: 3.5, arc: sc.A,
    layer: 'frame', ss: 2, rgba, look, scene: { objects: sc.objects, markings: sc.markings, verge: src.verge } });
  return rgba;
};
const pdiff = (x, y) => { let n = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 1e-6) n++; return n; };
const wetLook = { wetBounce: true, wetness: 0.5, dryStreaks: true };
const picOff = render(Object.assign({}, wetLook));
const picAbsent = render({ wetBounce: true, wetness: 0.5, dryStreaks: true, roadSurfaces: false });
const picOn = render(Object.assign({}, wetLook, { roadSurfaces: true, roadSurface: 'old' }));
ok('CPU: OFF is byte-identical to the option being absent (pixel diff 0)', pdiff(picOff, picAbsent) === 0, pdiff(picOff, picAbsent));
ok('CPU: the frame changes when roadSurfaces is on with a non-stock surface (wetBounceW callers pass the look, dryStreaks floor applies)', pdiff(picOff, picOn) > 100, pdiff(picOff, picOn));
ok('CPU: helpers exported on RF.Drive', ['wetBounceW', 'surfSOf', 'surfKOf', 'dryStreakFloorOf'].every((k) => typeof D[k] === 'function'));
// frenchie 11-10 (item 2, census): the six GPU/shader greps stay text, declared with the measured reason:
// the kSurf uniform is set on the WebGL context inside the three.js render loop and the shader strings are
// compiled on the GPU — no GL context and no browser in this VM (the GPU lane is measured on the host queue).
// The option's behaviour is covered end to end by the CPU frame render above (byte-identical OFF, changed ON).
ok('[KEEP: text — GPU lane, no headless GL seam; CPU render above covers the behaviour] GPU: kSurf uniform default 1 and set from surfKOf(look)', three.includes('kSurf: 1,') && three.includes("set('kSurf', D.surfKOf(look))"));
ok('[KEEP: text — GPU lane] GPU: dryStreaks floor via D.dryStreakFloorOf', three.includes('look.dryStreaks === true ? D.dryStreakFloorOf(look) : 0)'));
ok('[KEEP: text — GPU lane] shaders: kSurf declared in both uniform declarations', (sh.match(/wetModel, wetness, kSurf/g) || []).length === 2);
ok('[KEEP: text — GPU lane] shaders: both ext-B mirror loops multiply by kSurf', (sh.match(/\*wetU\*wetU\*kSurf;/g) || []).length === 2);
ok('[KEEP: text — GPU lane] halo: table program declares kSurf beside wetU; ext A multiplies by it', halo.includes("'uniform float wetU, kSurf;") && halo.includes('* wetU * wetU * kSurf;'));
ok('[KEEP: text — GPU lane] halo: all three table uniform sets carry kSurf', (halo.match(/kSurf: \{ value: D\.surfKOf\(look\) \}/g) || []).length === 3);
// the look literal is built inside the drive frame (V.p) — measured in af06: no Node hook can ask the app for
// it; option-plumbing carries the same declared KEEP for the halo group.
ok('[KEEP: text — look literal is frame-internal (af06 measured); no Node seam] drive-anim look carries roadSurfaces + roadSurface (rule 18 projection)', anim.includes('roadSurfaces: o.roadSurfaces === true, roadSurface: o.roadSurface || \'stock\''));
// spec-ui controls: behaviour — drive the real controls. The stub + bars() instrumentation is the same shape
// as tests/barbicane-ambient.js (neb 11-10).
const CK = require(path.join(ROOT, 'js', 'cache-keys.js'));
const om = CK.optionMap();
ok('spec-ui: both picture-cache recipes (stillFrame + ground) carry both options', om.stillFrame.includes('roadSurfaces') && om.stillFrame.includes('roadSurface') && om.ground.includes('roadSurfaces') && om.ground.includes('roadSurface'), { stillFrame: om.stillFrame.filter((x) => x.startsWith('roadSurf')), ground: om.ground.filter((x) => x.startsWith('roadSurf')) });
const Layout = RF.DriveLayout;
const rsRow = (Layout.LAYOUT || []).find((r) => (r[3] || []).some((s) => s === '[data-dv="roadSurfaces"]') && (r[3] || []).some((s) => s === '[data-dv="roadSurface"]'));
ok('drive-layout row lists both controls (asked of the layout module)', !!rsRow, rsRow && { tab: rsRow[0], title: rsRow[2] });
// spec-ui controls exist + sync: drive the real bar under a DOM stub (same shape as tests/barbicane-ambient.js)
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
const findEl = (sel) => ALL_ELS.filter((e) => e.matches && e.matches(sel));
const rsBtn = findEl('[data-dv="roadSurfaces"]')[0], rsuSel = findEl('[data-dv="roadSurface"]')[0];
ok('spec-ui: the roadSurfaces button and roadSurface select exist in the real bar', !!rsBtn && !!rsuSel, { btn: !!rsBtn, sel: !!rsuSel });
const dvOpts = RF.SpecUI.dvOpts(ui);
if (rsBtn) { rsBtn.click(); ok('clicking roadSurfaces sets the option', dvOpts.roadSurfaces === true, { roadSurfaces: dvOpts.roadSurfaces }); }
if (rsuSel) {
  rsuSel.value = 'old'; rsuSel.dispatch('change');
  ok('changing roadSurface sets the option to the select value', dvOpts.roadSurface === 'old', { roadSurface: dvOpts.roadSurface });
}
dvOpts.roadSurfaces = false; dvOpts.roadSurface = 'stock';
ui.driveBar.append(rsuSel);
RF.SpecUI.driveTools(ui, cv);
ok('spec-ui: the roadSurface select is disabled while roadSurfaces is off (re-sync)', !!rsuSel && rsuSel.disabled === true, rsuSel && { disabled: rsuSel.disabled });
ok('gate: NODE + wet group + MAP entries select the new test', gate.includes("'frenchie-road-surfaces'") && gate.includes("'node:frenchie-road-surfaces'"));

console.log(pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
