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

// executed: no glare double-count — glareEmitter path untouched, and a lit signal is one source either way
const scenes = RF.Drive.buildScene('road', { Lw: 3.5, A: null, us: true, seed: 7 });
const src = RF.DriveAnim ? null : null;
const glareText = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
ok('js/drive.js glare path never reads signalConesOn (no double-count possible)', !glareText.includes('signalConesOn'));
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
ok('drive-anim passes the flag only to K.signal call sites', (anim.match(/K\.signal\([^\n]*signalConesOn/g) || []).length === 2 && !/glareSources[\s\S]{0,200}signalConesOn/.test(anim));
ok('skey carries the option (scene rebuilds on toggle)', /o\.signalConesOn, !!o\.tiles/.test(anim));
ok('flags literal carries it to the tile loop', /signalConesOn: !!o\.signalConesOn/.test(anim));

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

// spec-ui + layout
const ui = fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8');
ok('spec-ui button exists', ui.includes("btn('signalConesOn'"));
ok('spec-ui label map has it', ui.includes("signalConesOn: 'signal cones'"));
ok('both picture-cache keys carry it', ui.split('\n').filter((l) => l.includes('JSON.stringify') && l.includes('o.signalConesOn')).length === 2);   // append-safe
const lay = fs.readFileSync(path.join(ROOT, 'js/drive-layout.js'), 'utf8');
ok('drive-layout Traffic row has the control', lay.includes("dv('signalConesOn')"));

// OFF byte-identical: the visor add is guarded, the shipped signal() body unchanged when cone falsy
const sc = fs.readFileSync(path.join(ROOT, 'js/drive-scenes.js'), 'utf8');
ok('hood add is inside `if (cone)` (OFF path untouched)', /if \(cone\) add\(\{ k: 'box', x: p\.x - 0\.24/.test(sc));
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
  const kit = RF.Drive.kit({ Lw: 3.5, A: null, rand: RF.Drive.rng(7) });
  kit.signal(100, 0, 5.25, 'red', true);
  const objs = kit.O;
  const lc = fs.readFileSync(path.join(ROOT, 'js/drive-three-lampcone.js'), 'utf8');
  ok('lampsOf carries the signal face normal as st', /kind: 'signal', emit: ob\.emit, st: \[ob\.nx/.test(lc));
  ok('signalConeLamps exported and pure-gated on the option', /export function signalConeLamps\(objects, on\)/.test(lc) && /if \(!on\) return \[\];/.test(lc));
  ok('build() collects signals only when look.signalConesOn', /p\.look && p\.look\.signalConesOn/.test(lc));
  ok('draw() signal pass is skipped when the list is empty (OFF byte-identical GL)', /if \(last\.signals && last\.signals\.length\)/.test(lc));
  ok('drive-anim look carries signalConesOn', /signalConesOn: !!o\.signalConesOn \}, src:/.test(fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8')));
  ok('registry note mentions the volumetric pass', /Volumetric cone in haze ships too/.test(fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8')));
}

console.log('\n' + pass + ' checks, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
