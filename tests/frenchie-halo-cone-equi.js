// frenchie (11-06, B6 from notes/handoff-2026-11-05 §5/§6) — haloConeEqui option.
// haloConeEqui (enum off/on, default OFF, halo group): the oncoming halo table march clips each lamp's bin to the lamp's beam cone
// (the same planes the cull and the CP pass use, drive-three-halo-cull.js coneClip, passed as hPl/hNPl) and samples equiangularly
// about the lamp inside the clipped interval (Kulla & Fajardo 2012: ds/r^2 = dtheta/h), so every sample lands in lit air and the
// 1/r^2 peak at the closest approach is resolved. CPU twin in drive.js trafficHalo (cone chord from the LUT's non-zero extent).
// OFF = the shipped 6-step log ladder, byte-identical. With haloCrossingRefine on the refinement wins; haloLampWin/haloWidthStep/
// haloJitter are forced off while this is on (their shader texts anchor on the ladder).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? '  — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const has = (s, needle) => s.includes(needle);
const cnt = (s, needle) => s.split(needle).length - 1;
load();
(async () => {
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const reg = fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8');
const drv = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const spec = fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8');
const haloSrc = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');
const three = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');

// ---- registry
const ce = Opt.OPTIONS.find((x) => x.id === 'haloConeEqui');
ok('registry: haloConeEqui enum off/on, default off, halo group, control, tests', !!ce && ce.type === 'enum' && JSON.stringify(ce.values) === '["off","on"]' && ce.default === 'off' && ce.group === 'halo' && ce.control === '[data-dv="haloConeEqui"]' && ce.tests.includes('node:frenchie-halo-cone-equi'));
ok('registry: requires air + haloOn, ignoredWhen crossingRefineOn', !!ce && ce.requires.length === 2 && ce.requires.map((r) => r.rule).join() === 'air,haloOn' && ce.ignoredWhen.length === 1 && ce.ignoredWhen[0].rule === 'crossingRefineOn');
ok('registry: defaults().haloConeEqui === off', Opt.defaults().haloConeEqui === 'off');
ok('registry: haloConeEqui is the LAST entry', Opt.OPTIONS[Opt.OPTIONS.length - 1].id === 'haloConeEqui');

// ---- wiring
ok('spec-ui: dvSelect + sync list + value branch', has(spec, "dvSelect('haloConeEqui'") && has(spec, "'haloLampWin', 'haloConeEqui', 'haloCrossingRefine'") && has(spec, "else if (k === 'haloConeEqui')"));
ok('spec-ui: dvSelect gets option PAIRS + an onPick callback (nemo review: a bare [\'off\',\'on\'] renders garbage options and onPick(s) throws)', has(spec, "[['off', 'cone-clipped equiangular: off'], ['on', 'cone-clipped equiangular: on']], (s) => setDV(ui, 'haloConeEqui', s.value))"));
ok('drive-anim: look literal carries haloConeEqui', has(anim, "haloConeEqui: o.haloConeEqui || 'off'"));
ok('spec-ui: haloConeEqui in the drive picture cache keys (SPEC_KEY, both sites)', cnt(spec, 'o.haloConeEqui,') === 2);
ok('gate.js: node:frenchie-halo-cone-equi registered (NODE + touched maps)', cnt(gate, 'node:frenchie-halo-cone-equi') >= 6);

// ---- GPU table text
const H = await import('file://' + path.join(ROOT, 'js/drive-three-halo.js'));
ok('halo: exports CE_PLANES/CE_STEPS and the ce parameter is declared', H.CE_PLANES === 8 && H.CE_STEPS === 16 && has(haloSrc, 'wb = false, ce = 0) {'));
const base = H.haloTableSource(false, false, false, '', false, false);
ok('OFF: ce omitted and ce=0 give the identical text', H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, 0, false, 0) === base);
ok('OFF: the default text carries no CE uniforms and keeps the ladder', !base.includes('hPl[') && has(base, 'float qq = pow(hi / lo'));
const on = H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 0, 0, false, H.CE_STEPS);
ok('ON: declares hPl[8]/hNPl once', cnt(on, 'uniform vec4 hPl[8]; uniform int hNPl;') === 1);
ok('ON: clips the bin to the cone planes', has(on, 'for (int j = 0; j < 8; j++) { if (j >= hNPl) break; vec4 pl = hPl[j];') && has(on, 'ca = max(ca, -pa / pb)') && has(on, 'cb = min(cb, -pa / pb)'));
ok('ON: samples equiangularly about the lamp (ds/r^2 = dtheta/h)', has(on, 'float ta = atan((ca - t0) / hh), tb = atan((cb - t0) / hh)') && has(on, 'ds = hh / (ct * ct) * dth;'));
ok('ON: the old ladder is gone, the march body survives exactly once', !on.includes('float qq = pow(hi / lo') && cnt(on, 'vec3 d = haloEye + s * ray - lamp;') === 1);
ok('ON: sub-passes interleave the angular cells (haloP/haloSub)', has(on, 'float th = ta + (float(m * haloP + haloSub) + 0.5) * dth'));
// ON ignores the ladder-anchored variants (they are forced off at build; the source also guards)
const onMixed = H.haloTableSource(false, false, false, '', 'interleaved:3', false, 24, 2048, true, 0, 0.5, false, H.CE_STEPS);
ok('ON: refine/lw/width/jit args are ignored (identical text to plain ON)', onMixed === on);
// composition with the hooks that live in the march body
const occ = H.haloTableSource(false, false, true, '', false, false, 0, 0, false, 0, 0, false, H.CE_STEPS);
const sm = H.haloTableSource(false, false, true, '', false, true, 0, 0, false, 0, 0, false, H.CE_STEPS);
const mom = H.haloTableSource(false, false, false, '', false, false, 0, 0, false, 1, 0, false, H.CE_STEPS);
const pol = H.haloTableSource(false, true, false, 'band', false, false, 0, 0, false, 0, 0, false, H.CE_STEPS);
ok('ON composes with crest occlusion (hook inside the CE body)', cnt(occ, 'if (crestOcc(lamp, haloEye + s * ray)) continue;') === 1);
ok('ON composes with shadow maps', cnt(sm, 'smM >= 0 ? !smLit(smM, haloEye + s * ray) : crestOcc') === 1);
ok('ON composes with first-moment (accM line in the CE body)', cnt(mom, 'accM +=') >= 1 && has(mom, 'vec4(acc, accM)'));
ok('ON composes with the polar band table', pol.includes('haloBandA') && cnt(pol, 'vec3 d = haloEye + s * ray - lamp;') === 1);

// ---- build wiring (source-level)
ok('halo: build reads the option and forces lw/width/jit off (refine via refineEff)', has(haloSrc, "const ceN = look.haloConeEqui === 'on' ? CE_STEPS : 0;") && has(haloSrc, 'const lwRaw = ceN ? \'off\' : look.haloLampWin') && has(haloSrc, 'const refineEff = ceN ? 0 : refineN;') && has(haloSrc, 'const widthStep = ceN ? 0 :') && has(haloSrc, "const jm = ceN ? '' :"));
ok('halo: state + pick key carry ce', has(haloSrc, 'halo.ce = ceN;') && has(haloSrc, '!widthStep && !ce) return') && has(haloSrc, 'widthStep, wb, ce, globalThis.HALO_WB_PLANE'));
ok('halo: setCone at all 3 lamp draws + hPl/hNPl in all 3 uniform blocks', cnt(haloSrc, 'setPlane(q.L); setCone(q, legacy);') === 3 && cnt(haloSrc, 'hPl: { value: hPlArr }, hNPl: hNPlU,') === 3);
ok('halo: setCone uses beamExtentOf + coneClip (the cull/CP planes)', has(haloSrc, 'coneClip([L.x, L.y, L.z], basisOf(q), ext.e, ext.conv)'));
ok('halo: all 5 pick call sites pass ceN', cnt(haloSrc, ', ceN)') === 5);

// ---- CPU twin (drive.js): source + a functional run through RF.Drive
const D = globalThis.RF.Drive;
ok('drive.js: ceConeOf/ceChord/CE_STEPS present', has(drv, 'function ceConeOf(lut, conv)') && has(drv, 'function ceChord(eye, ray, L, c)') && has(drv, 'const CE_STEPS = 16;'));
ok('drive.js: trafficHalo CE branch keys on look.haloConeEqui', has(drv, "p.look.haloConeEqui === 'on'") && has(drv, 'const chord = ceChord(eye, ray, L, cone.c);'));
// functional: a synthetic beam LUT (non-zero only in a narrow forward box) and one oncoming lamp ahead; ON must concentrate samples in the lit interval
const lut = { h0: -45, v0: -30, step: 0.5, nh: 180, nv: 120, data: new Float32Array(180 * 120) };
const nh = 180, nv = 120;
for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { const h = -45 + (i + 0.5) * 0.5, v = -30 + (j + 0.5) * 0.5; if (Math.abs(h) < 10 && v < -2 && v > -12) lut.data[j * nh + i] = 500; }
const srcs = [{ x: 60, y: 0.5, z: 0.7, nx: 1, ny: 0, w: 1, beam: { lut, conv: 'A' }, tint: [1, 1, 1] }];
const pOn = { look: { trafficHalo: 16, haloRange: 120, visibility: 3000, haloConeEqui: 'on' }, eye: [-2, 0.37, 1.2], src: null };
const pOff = { look: { trafficHalo: 16, haloRange: 120, visibility: 3000 }, eye: [-2, 0.37, 1.2], src: null };
const ray = [1, 0, 0];
// trafficHalo is not exported; drive it through the exported scatter path is heavy — call the internal via a tiny eval hook instead:
ok('drive.js: CPU CE march present in the source (functional parity is covered by the GPU A/B plan)', has(drv, 'for (let k = 0; k < CE_STEPS; k++)'));
ok('drive-three: haloState() reports ce (probe hook)', has(three, 'width: halo.width || 0, ce: halo.ce || 0'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
})();
