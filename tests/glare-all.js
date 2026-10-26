// GLARE-ALL (option glareSources): what the veil and adaptation see under 'oncoming' (default, headlamps only) and 'all'.
// Real functions: RF.Drive.glareSources, RF.Drive.lampEyeCd, RF.Drive.lightVisible, RF.Drive.veilAt (drive.js), RF.LampDist (lamp-dist.js).
// Run alone: node tests/glare-all.js  (exits 1 on failure). Registered as node:glare-all in options-registry.js.
// Not covered here: the pass path through RF.Touge.glareSources (see the report), and the live wiring: see tests/regress/GS1-glare-sources.js.
(function (root) {
  function run(RF, ok) {
    const D = RF.Drive, EYE = [-2, 0.37, 1.2], LD = RF.LampDist;
    // oncoming car: two headlamps on its face, 60 m ahead (same geometry as glare-occlusion.js)
    const lamp = (y) => ({ k: 'disc', headlamp: true, traffic: 'onc', x: 58.01, y, z: 0.68, nx: -1, ny: 0, nz: 0, r: 0.1, eyeCd: 20000, mat: 'lamp-head' });
    const onc = [lamp(0.9), lamp(2.1)];
    // preceding car 20 m ahead: two taillamps on its rear face, facing back (emit as drive-scenes.js car(): tailCd 80, emitPow 2)
    const tailCd = 80, lampR = 0.045, Lm = tailCd / (Math.PI * lampR * lampR);
    const tails = [0.1, 1.4].map((y) => ({ k: 'disc', taillamp: true, traffic: 'pre', x: 15.79, y, z: 0.78, nx: -1, ny: 0, nz: 0, r: lampR, emitPow: 2, emit: [Lm, 0.03 * Lm, 0.015 * Lm], mat: 'lamp-head', cls: 'car' }));
    // lit signal head (green) at 40 m, right side, facing the car: emit as drive-scenes.js signal() (green [200, 8000, 3500])
    const signal = { k: 'disc', x: 39.8, y: -4, z: 3.0, r: 0.1, nx: -1, ny: 0, nz: 0, emitPow: 2, emit: [200, 8000, 3500], mat: 'pole', cls: 'signal' };
    const unlitSignal = Object.assign({}, signal, { x: 39.8, y: -5, emit: null });
    // street lamp at 30 m, on the right side of the road (y = -6), its arm reaching toward the road (street = +y)
    const street = { x: 30, y: -6, z: 6.85, cd: 900, rgb: [1, 0.43, 0.1], street: [0, 1] };
    // the lamp's own fixture: pole (cylinder, no z in the horizontal test) and head, both within 1 m of the light
    const fixture = [{ k: 'cyl', x: 30, y: -6.8, r: 0.065, z0: 0, z1: 7, mat: 'pole', cls: 'street-lamp' }, { k: 'ell', x: 30, y: -6.1, z: 6.9, rx: 0.3, ry: 0.18, rz: 0.05, emit: [9000, 4300, 1000], mat: 'lamp-head', cls: 'street-lamp' }];

    const scene = [...onc, ...tails, signal, unlitSignal, ...fixture];
    const srcOnc = D.glareSources(scene, EYE);
    const srcOncExplicit = D.glareSources(scene, EYE, undefined, { mode: 'oncoming', lights: [street] });
    ok('oncoming: headlamps only (2 sources), lights and tails and signals ignored', srcOnc.length === 2, 'sources ' + srcOnc.length);
    ok('oncoming: an explicit opts with mode oncoming gives the same sources as no opts', JSON.stringify(srcOnc) === JSON.stringify(srcOncExplicit));

    const srcAll = D.glareSources(scene, EYE, undefined, { mode: 'all', lights: [street] });
    // 2 headlamps + 2 tails + 1 lit signal + 1 street lamp = 6; the unlit signal (emit null) adds nothing
    ok('all: headlamps, both tail lamps, the lit signal and the street lamp (6 sources)', srcAll.length === 6, 'sources ' + srcAll.length);
    ok('all: every source has a positive illuminance and a unit direction', srcAll.every((q) => q[3] > 0 && Math.abs(Math.hypot(q[0], q[1], q[2]) - 1) < 1e-9));
    ok('all: sorted brightest first', srcAll.every((q, i) => i === 0 || srcAll[i - 1][3] >= q[3]));

    // the street lamp alone: the table factor is applied, so its cd toward the eye is cd * I(gamma, phi)/I_REF
    const cdEye = D.lampEyeCd(street, EYE, { lampClass: 'III', lampKind: 'sodium' });
    const vx = EYE[0] - street.x, vy = EYE[1] - street.y, vz = EYE[2] - street.z, rr = Math.hypot(vx, vy, vz);
    const g = Math.acos(-vz / rr) * 180 / Math.PI, phi = LD.phiOf(street.street, [vx, vy]);
    const expect = street.cd * LD.roadFactorAt('III', LD.kindOfLamp('sodium'), g, phi);
    ok('lampEyeCd: the lamp-dist factor for gamma and phi (street side)', Math.abs(cdEye - expect) < 1e-9 && cdEye > 0, 'cd ' + cdEye.toFixed(3) + ' vs ' + expect.toFixed(3));
    ok('lampEyeCd: a lamp with no street direction keeps its cd', D.lampEyeCd({ x: 0, y: 0, z: 6.85, cd: 900 }, EYE, {}) === 900);
    ok('lampEyeCd: the pass copy (lampStreet) gives the same factor as street', D.lampEyeCd({ x: 30, y: -6, z: 6.85, cd: 900, lampStreet: [0, 1] }, EYE, { lampClass: 'III', lampKind: 'sodium' }) === cdEye);

    // the street lamp's own pole, arm and head do not hide it. Checked with the plain occluded() test: none of the three hit this geometry (see the report).
    ok('street lamp in plain view with its own pole and head beside it: visible', D.lightVisible(street, EYE, fixture));
    const hidden = [{ k: 'box', x: 20, y: -4, z0: 0, z1: 12, hx: 0.5, hy: 6, yaw: 0, mat: 'brick' }];
    ok('street lamp behind a building on the line of sight: not visible', !D.lightVisible(street, EYE, hidden));

    // the cap: 40 isotropic lamps (no street direction, so no cut-off) at 20..98 m, 32 kept, brightest first
    const many = Array.from({ length: 40 }, (_, i) => ({ x: 20 + i * 2, y: -6, z: 6.85, cd: 900 }));
    const srcMany = D.glareSources([], EYE, undefined, { mode: 'all', lights: many });
    ok('cap: 40 lamps give 32 sources, sorted', srcMany.length === 32 && srcMany.every((q, i) => i === 0 || srcMany[i - 1][3] >= q[3]), 'sources ' + srcMany.length);

    // the pass: RF.Touge.glareSources is the same function, fed car-frame copies. Pose: 420 m along the pass, the scene the pass builds there.
    const PA = RF.DriveAnim, PT = RF.Touge;
    const passSrc = PA.source('road', 3.5, true, { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true, rpm: true }, { mountainPass: true, streetLamps: 'sodium', seed: 7, oncoming: true, preceding: true, trafficDensity: 2 });
    const pp = { src: passSrc, lane: 3.5, us: true, touge: true, lut: D.lutFrom(() => 30000), conv: 'A', look: { RL: 0.2, ambient: 0 }, detailedModels: false, deerBehaviour: false, lamps: [[0, 0.7, 0.7]] };
    const pw = PT.world(pp, 420, 0, undefined);
    const pOnc = PT.glareSources(pw.objects, 420, pw.A), pOncX = PT.glareSources(pw.objects, 420, pw.A, { mode: 'oncoming' });
    const pAll = PT.glareSources(pw.objects, 420, pw.A, { mode: 'all', lights: pw.lights || [], lampClass: 'III', lampKind: 'sodium' });
    ok('pass oncoming: explicit mode oncoming equals no opts', JSON.stringify(pOnc) === JSON.stringify(pOncX), 'sources ' + pOnc.length);
    ok('pass all: more sources than oncoming at 420 m (preceding tails and street lamps seen)', pAll.length > pOnc.length, 'oncoming ' + pOnc.length + ' all ' + pAll.length);
    ok('pass all: sorted brightest first', pAll.every((q, i) => i === 0 || pAll[i - 1][3] >= q[3]));
    console.log('[info] pass 420 m: veilAt([1,0,0]) oncoming ' + D.veilAt([1, 0, 0], pOnc).toExponential(6) + ' (' + pOnc.length + ' sources), all ' + D.veilAt([1, 0, 0], pAll).toExponential(6) + ' (' + pAll.length + ')');
    // veil: fixed pose, the same scene under both modes (the numbers go in the report)
    const vOnc = D.veilAt([1, 0, 0], srcOnc), vAll = D.veilAt([1, 0, 0], srcAll);
    ok('veil: all is larger than oncoming on this pose (more sources)', vAll > vOnc, 'oncoming ' + vOnc.toExponential(4) + ' all ' + vAll.toExponential(4));
    if (typeof console !== 'undefined') console.log('[info] veilAt([1,0,0]) oncoming ' + vOnc.toExponential(6) + ', all ' + vAll.toExponential(6) + ', sources ' + srcOnc.length + ' / ' + srcAll.length);
  }
  if (typeof module !== 'undefined') module.exports = { run };
  else root.GlareAllChecks = { run };
})(typeof globalThis !== 'undefined' ? globalThis : this);
if (typeof require !== 'undefined' && require.main === module) {
  let fails = 0;
  // js/lamp-dist.js is an ES module that sets RF.LampDist; run it as a classic script here (the same text the browser loads, export keywords dropped).
  const RF = require('./load.js').load(), fs = require('fs'), path = require('path'), vm = require('vm');
  if (!RF.LampDist) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'lamp-dist.js'), 'utf8').replace(/^export /gm, ''), { filename: 'lamp-dist.js' });
  module.exports.run(RF, (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all glare-all checks passed');
  process.exitCode = fails ? 1 : 0;
}
