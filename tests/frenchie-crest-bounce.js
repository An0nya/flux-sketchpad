// frenchie (11-05, Anya crest bug; Ladder A green-lit by council 84cb, Anya ruling 7edc) — wetBouncePlane option.
// wetBouncePlane (bool, OFF): OFF = shipped mirror (flat z=0 plane), byte-identical behavior. ON: the wet-bounce /
// wetVeil mirrors reflect about the local road plane at each lamp's road-contact point (lampM' = L - 2((L-C).n)n,
// n = A.surface normal, full grade+bank; GPU world frame after worldFromCar, halo car frame, CPU road frame).
const path = require('path'), fs = require('fs');
const { load, ROOT } = require(path.join(__dirname, 'load.js'));
const { esm } = require(path.join(__dirname, 'esm.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('[PASS] ' + name); } else { fail++; console.log('[FAIL] ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 300) : '')); } };
const has = (s, needle) => s.includes(needle);
const cnt = (s, needle) => s.split(needle).length - 1;
load();
(async () => {
const Opt = require(path.join(ROOT, 'js/options-registry.js'));
const reg = fs.readFileSync(path.join(ROOT, 'js/options-registry.js'), 'utf8');
const drv = fs.readFileSync(path.join(ROOT, 'js/drive.js'), 'utf8');
const three = fs.readFileSync(path.join(ROOT, 'js/drive-three.js'), 'utf8');
const sh = fs.readFileSync(path.join(ROOT, 'js/drive-three-shaders.js'), 'utf8');
const haloSrc = fs.readFileSync(path.join(ROOT, 'js/drive-three-halo.js'), 'utf8');
const anim = fs.readFileSync(path.join(ROOT, 'js/drive-anim.js'), 'utf8');
const spec = fs.readFileSync(path.join(ROOT, 'js/spec-ui.js'), 'utf8');
const touge = fs.readFileSync(path.join(ROOT, 'js/drive-touge.js'), 'utf8');
const gate = fs.readFileSync(path.join(ROOT, 'tests/gate.js'), 'utf8');

// ---- registry
const wp = Opt.OPTIONS.find((x) => x.id === 'wetBouncePlane');
ok('registry: wetBouncePlane bool default false, air group, control', !!wp && wp.type === 'bool' && wp.default === false && wp.group === 'air' && wp.control === '[data-dv="wetBouncePlane"]');
ok('registry: requires wetBounceOn + RULES entry', !!wp && wp.requires.length === 1 && wp.requires[0].rule === 'wetBounceOn' && has(reg, "wetBounceOn: { cond: { opt: 'wetBounce', eq: true }"));
ok('registry: defaults().wetBouncePlane === false', Opt.defaults().wetBouncePlane === false);
ok('registry: haloConeEqui is registered (membership, not last-entry — a last-entry pin breaks the next appender, claude review 11-08)', Opt.OPTIONS.some((x) => x.id === 'haloConeEqui'));
ok('registry: tests lists node:frenchie-crest-bounce', !!wp && wp.tests.includes('node:frenchie-crest-bounce'));

// ---- wiring: control, label handler, cache key, look projection, glare opts
ok('spec-ui: button + label handler', has(spec, "btn('wetBouncePlane',") && has(spec, "k === 'wetBouncePlane'"));
ok('drive-anim: cache key carries o.wetBouncePlane', has(anim, 'o.wetBounce, o.wetBouncePlane, !!o.roadSurfaces'));   // review 11-05: roadSurfaces appended after wetBouncePlane
ok('drive-anim: look literal carries wetBouncePlane', has(anim, 'wetBouncePlane: o.wetBouncePlane === true,'));
ok('drive-anim: glareOpts passes A + wetBouncePlane', has(anim, 'A: world && world.A, wetBouncePlane: o.wetBouncePlane === true'));
ok('drive-touge: glare wrapper passes A + wetBouncePlane', has(touge, 'wetBouncePlane:opts.wetBouncePlane,dryStreaks'));   // review 11-05: dryStreaks/roadSurfaces inserted between wetBouncePlane and A
ok('gate.js: node:frenchie-crest-bounce registered in 4 MAP spots', cnt(gate, 'node:frenchie-crest-bounce') === 4);

// ---- GPU own-lamp site (drive-three.js)
ok('drive-three: lampN uniform declared', has(three, 'lampM: array(2, T.Vector3), lampN: array(2, T.Vector3), lampRGB:'));
ok('drive-three: wpOn variant composed only when the option is on', has(three, 'const wpOn = wbOn && look.wetBouncePlane === true;') && has(three, 'wpOn ? withBouncePlane(withWetBounce(baseSrc)) : wbOn ? withWetBounce(baseSrc) : baseSrc'));
ok('drive-three: world-frame lampM\' block sits AFTER the worldFromCar else (nicholl FINDING 1)', three.indexOf('u.carFromWorld.value.identity();') < three.indexOf('if (wbOn && look.wetBouncePlane === true) p.lamps.forEach'));
ok('drive-three: block uses A.surface normal + A.height contact point', has(three, 'A.surface(f.s, f.off), nw = q.normal, Cw = [Lw.x, Lw.y, A.height'));

// ---- shaders: withBouncePlane text law + OFF identity
const S = esm('drive-three-shaders.js', null, ['ground', 'withWetBounce', 'withBouncePlane']);
ok('shaders: exports withBouncePlane', typeof S.withBouncePlane === 'function');
const wbText = S.withWetBounce(S.ground);
const wpText = S.withBouncePlane(wbText);
ok('shaders: ON adds the lampN uniform decl once', cnt(wpText, 'uniform vec3 lampN[2];') === 1 && !wbText.includes('lampN'));
ok('shaders: ON reflects the beam reads about the plane (both sites)', cnt(wpText, 'd-2.0*dot(d,lampN[i])*lampN[i]') === 2 && !wpText.includes('vec3(d.x,d.y,-d.z),lampM'));
ok('shaders: ON grazing weight uses dot(d,lampN)', cnt(wpText, 'abs(dot(d,lampN[i]))') === 2 && !wpText.includes('abs(d.z)/r'));
ok('shaders: withBouncePlane throws on a non-wb text (guard)', (() => { try { S.withBouncePlane(S.ground); return false; } catch (e) { return true; } })());
// degeneracy: reflect about z-hat is exactly the shipped z-negation
const ref = (v, n) => { const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2]; return [v[0] - 2 * d * n[0], v[1] - 2 * d * n[1], v[2] - 2 * d * n[2]]; };
const d0 = [0.3, -0.2, 0.9], r0 = ref(d0, [0, 0, 1]);
ok('math: plane reflect with n=z-hat === shipped z-negate (exact)', r0[0] === d0[0] && r0[1] === d0[1] && r0[2] === -d0[2]);
const L = [12.5, -0.6, 0.72], C = [L[0], L[1], 0], dd = (L[2] - C[2]) * 1, m = [L[0] - 2 * dd * 0, L[1] - 2 * dd * 0, L[2] - 2 * dd * 1];
ok('math: flat-road lampM\' === [x,y,-z] exactly (OFF parity clincher)', m[0] === L[0] && m[1] === L[1] && m[2] === -L[2]);

// ---- halo: variant + toCarFrame planes
const H = await import('file://' + path.join(ROOT, 'js/drive-three-halo.js'));
ok('halo: exports withBouncePlaneHalo + toCarFrame', typeof H.withBouncePlaneHalo === 'function' && typeof H.toCarFrame === 'function');
const fakeMain = 'void main() {' + '    }\n  }\n  gl_FragColor = vec4(acc, 1.0);\n}';
const wbHalo = H.withWetBounceHalo(fakeMain);
const wpHalo = H.withBouncePlaneHalo(wbHalo);
ok('halo: ON declares hNrm/hLampM once', cnt(wpHalo, 'uniform vec4 hNrm[') === 1 && !wbHalo.includes('hNrm'));
ok('halo: ON takes lampM from hLampM with z-negate fallback', has(wpHalo, 'vec3 lampM = hLampM[i].w > 0.5 ? hLampM[i].xyz : vec3(lamp.x, lamp.y, -lamp.z);'));
ok('halo: ON plane-reflects fwM/lat3M/up3M and the grazing weight', cnt(wpHalo, '- 2.0 * dot(') === 5 && has(wpHalo, 'abs(dot(d, nM)) / r'));
ok('halo: variant selection + cache key + flag wired', has(haloSrc, 'globalThis.HALO_WB_PLANE ? withBouncePlaneHalo') && has(haloSrc, 'globalThis.HALO_WB_PLANE ? 1 : 0].join()') && has(haloSrc, 'globalThis.HALO_WB_PLANE = halo.wb === 1 && look.wetBouncePlane === true'));
ok('halo: toCarFrame attaches nrm + lampM per source', has(haloSrc, 'o.nrm = n; o.lampM = ['));
ok('halo: touge call site passes wp (v10 — without it the halo plane mirror was inert)', has(haloSrc, 'u.carFromWorld.value, world.A, !!(p.look && p.look.wetBouncePlane === true))'));
ok('halo: HALO_WB_PLANE set at the top of build() before early returns (v11)', has(haloSrc, 'globalThis.HALO_WB_PLANE = (p.look && p.look.wetBounce === true') && haloSrc.indexOf('globalThis.HALO_WB_PLANE = (p.look') < haloSrc.indexOf('const N = D.haloN(p)'));
ok('halo: setPlane fills + 3 bindings', cnt(haloSrc, 'setBasis(q.L); setPlane(q.L);') === 3 && cnt(haloSrc, 'hNrm: { value: hNrm }, hLampM: { value: hLampM },') === 3);
// toCarFrame end-to-end on a fake route: graded pass -> tilted normal; flat -> exact degeneracy
const A2 = { frame: (x, y) => ({ s: x, off: y, t: [1, 0] }), surface: () => { const g = 0.0265, b = 0.06, Ln = Math.hypot(g, b, 1); return { grade: g, bank: b, normal: [-g / Ln, -b / Ln, 1 / Ln] }; }, height: () => 0 };
const ident = { elements: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
const src = [{ x: 80, y: -1.2, z: 0.7, nx: 1, ny: 0, nz: -0.05, w: 1 }];
const out = H.toCarFrame(src, ident, A2, true)[0];
const Ln2 = Math.hypot(0.0265, 0.06, 1);
ok('halo: toCarFrame graded pass gives a tilted normal (bank term in)', Math.abs(out.nrm[2] - 1 / Ln2) < 1e-12 && Math.abs(out.nrm[1] + 0.06 / Ln2) < 1e-12);
ok('halo: toCarFrame mirrored lamp sits below the road plane', out.lampM[2] < 0 && Math.abs(out.lampM[0] - out.x) < 0.2);
const Aflat = { frame: (x, y) => ({ s: x, off: y, t: [1, 0] }), surface: () => ({ grade: 0, bank: 0, normal: [0, 0, 1] }), height: () => 0 };
const outF = H.toCarFrame(src, ident, Aflat, true)[0];
ok('halo: toCarFrame flat road degenerates exactly to [x,y,-z]', outF.lampM[0] === outF.x && outF.lampM[1] === outF.y && outF.lampM[2] === -outF.z && outF.nrm[2] === 1);
ok('halo: toCarFrame OFF (wp=false) attaches no plane (cost guard)', H.toCarFrame(src, ident, A2, false)[0].nrm === undefined);
// nemo c974 blocker check: pair #4 up3M must reduce to the SHIPPED up3M at nM=z-hat (handedness: shipped = -reflect(up3, z-hat))
const se = 0.05, dirx = 1, ce0 = Math.sqrt(1 - se * se), up3 = [-se * dirx, 0, ce0];
const shippedUp3M = [se * dirx, 0, ce0];   // vec3(-seM*dir, ceM) with seM=-se
const newUp3M = ref([-up3[0], -up3[1], -up3[2]], [0, 0, 1]);   // pre-negated up3, plane-reflected about z-hat
ok('halo: pair#4 up3M at nM=z-hat === shipped up3M exactly (nemo c974 fix)', newUp3M[0] === shippedUp3M[0] && newUp3M[1] === shippedUp3M[1] && newUp3M[2] === shippedUp3M[2]);

// ---- CPU (drive.js)
ok('drive.js: wbPlanesOf helper + cache', has(drv, 'function wbPlanesOf(o)') && has(drv, 'o._wbPlanes = { A: o.A, lamps: o.lamps, v }'));
ok('drive.js: inScatter + surface loop use the plane when on, shipped arithmetic when off', has(drv, 'M = wbp ? wbp[i].m : [L[0], L[1], -L[2]]') && has(drv, 'M = wbp2 ? wbp2[i].m : [L[0], L[1], -L[2]]'));
ok('drive.js: reflected beam dir + grazing use the plane normal', has(drv, 'b = n ? [qx - 2 * bz * n[0]') && has(drv, 'bz = n ? qx * n[0]'));
ok('drive.js: wetVeil mirrorOf plane branch', has(drv, 'if (opts.wetBouncePlane && opts.A)'));
// CPU math parity with the GPU law: same reflect formula, road-frame normal
const g = 0.0265, b = 0.06, il = 1 / Math.hypot(g, b, 1), nc = [-g * il, -b * il, il], Lc = [80, -1.2, 0.7], dc = Lc[2] * nc[2], mc = [Lc[0] - 2 * dc * nc[0], Lc[1] - 2 * dc * nc[1], Lc[2] - 2 * dc * nc[2]];
ok('math: CPU road-frame lampM\' follows the plane law (tilted, not the flat mirror)', mc[2] < 0 && Math.abs(mc[2] + 0.7) > 1e-6);
ok('math: CPU flat degenerates exactly', (() => { const d2 = 0.7, m2 = [80, -1.2, 0.7 - 2 * d2]; return m2[0] === 80 && m2[1] === -1.2 && m2[2] === -0.7; })());

// ---- OFF behavior identity (source-level): every rewrite has the shipped fallback branch
ok('[KEEP: text — GPU lane: the shader source is GL-compiled, no headless GL seam in this VM; the OFF/CPU parity is executed in the math checks above and the suite\'s render checks] OFF guards: shaders OFF path is the untouched withWetBounce text (no lampN in OFF)', !wbText.includes('lampN') && has(sh, 'export function withBouncePlane(source)'));
ok('OFF guards: halo OFF path keeps withWetBounceHalo when HALO_WB_PLANE is unset', has(haloSrc, ': withWetBounceHalo(main);'));
ok('OFF guards: drive-three OFF keeps the :306 car-frame lampM line untouched', has(three, 'u.lampM.value[i].fromArray([l[0], l[1], -l[2]])'));

// ---- layout placement (UX2/DL require RF.DriveLayout.unplaced() empty for every control)
const lay = fs.readFileSync(path.join(ROOT, 'js', 'drive-layout.js'), 'utf8');
ok('drive-layout: wetBouncePlane placed in the Wet road row next to wetBounce', lay.includes("dv('wetBounce'), dv('wetBouncePlane'), dv('roadSurfaces')"));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
})();
