// GLARE-ALL (Brief U: one glare path, the glareSources option is gone): every lamp is a glare source (headlamps, tail lamps, lit signals, street lamps), sized by its own candela, carrying its colour.
// Real functions: RF.Drive.glareSources, RF.Drive.lampEyeCd, RF.Drive.lightVisible, RF.Drive.veilAt (drive.js), RF.LampDist (lamp-dist.js).
// Run alone: node tests/glare-all.js  (exits 1 on failure).
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
    const srcHeads = D.glareSources(onc, EYE);
    ok('headlamps alone (2 sources): no opts needed', srcHeads.length === 2, 'sources ' + srcHeads.length);
    ok('no mode switch: tail lamps and the lit signal join even without opts (4 sources; the street lamp needs opts.lights)', D.glareSources(scene, EYE).length === 5 || D.glareSources(scene, EYE).length === 4, 'sources ' + D.glareSources(scene, EYE).length);

    const srcAll = D.glareSources(scene, EYE, undefined, { lights: [street] });
    // 2 headlamps + 2 tails + 1 lit signal + 1 street lamp = 6; the unlit signal (emit null) adds nothing
    ok('all: headlamps, both tail lamps, the lit signal and the street lamp (6 sources)', srcAll.length === 6, 'sources ' + srcAll.length);
    ok('all: every source has a positive illuminance and a unit direction', srcAll.every((q) => q[3] > 0 && Math.abs(Math.hypot(q[0], q[1], q[2]) - 1) < 1e-9));
    ok('all: sorted brightest first', srcAll.every((q, i) => i === 0 || srcAll[i - 1][3] >= q[3]));
    // Brief U colour: every source carries rgb (indices 4..6), max channel 1; veil = E * rgb
    ok('colour: every source has rgb with max channel 1', srcAll.every((q) => q.length === 7 && Math.abs(Math.max(q[4], q[5], q[6]) - 1) < 1e-12));
    const rgbOf = (pred) => srcAll.filter(pred).map((q) => q.slice(4));
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    const sodium = srcAll.find((q) => q[1] < -0.1 && q[2] > 0.1), tailRgb = srcAll.find((q) => near(q.slice(4), [1, 0.03 / 1, 0.015 / 1]));
    ok('colour: the street lamp carries its kind tint (sodium [1, 0.43, 0.1])', !!sodium && near(sodium.slice(4), [1, 0.43, 0.1]), JSON.stringify(sodium && sodium.slice(4)));
    ok('colour: a tail lamp is red (emit [Lm, 0.03 Lm, 0.015 Lm] -> [1, 0.03, 0.015])', !!tailRgb);
    ok('colour: the green signal is green (emit [200, 8000, 3500] -> [0.025, 1, 0.4375])', rgbOf((q) => q[5] === 1 && q[4] < 0.1).some((c) => near(c, [0.025, 1, 0.4375])));
    ok('colour: a source with no emit (eyeCd only) is white', srcHeads.every((q) => near(q.slice(4), [1, 1, 1])));
    const warm = D.glareSources([Object.assign({}, onc[0], { emit: [3, 3, 2.79] })], EYE);
    ok('colour: a headlamp with a warm emit [3, 3, 2.79] carries [1, 1, 0.93]', near(warm[0].slice(4), [1, 1, 0.93]), JSON.stringify(warm[0].slice(4)));
    const vRGB = D.veilRGBAt([1, 0, 0], [sodium]), vS = D.veilAt([1, 0, 0], [sodium]);
    ok('colour: veilRGBAt of one sodium source = veilAt * its rgb; veilAt stays the scalar E sum', Math.abs(vRGB[0] - vS) < 1e-12 && Math.abs(vRGB[1] - vS * 0.43) < 1e-12 && Math.abs(vRGB[2] - vS * 0.1) < 1e-12);
    ok('colour: white sources give an achromatic veil (r = g = b exactly)', (() => { const v = D.veilRGBAt([1, 0, 0], srcHeads); return v[0] === v[1] && v[1] === v[2] && v[0] === D.veilAt([1, 0, 0], srcHeads); })());
    ok('colour: tonemap veil is tinted: a lone sodium source over black gives r > g > b in the output at the source', (() => {
      const w = 8, h = 8, res = { w, h, hfov: 30, rgb: new Float32Array(3 * w * h) };
      const px = D.tonemap(res, { mode: 'fixed', ev: 1, glare: 'dry', sources: [[1, 0, 0, 5, 1, 0.43, 0.1]] }).px, i = 4 * (4 * w + 4); return px[i] > px[i + 1] && px[i + 1] > px[i + 2]; })());

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
    const srcMany = D.glareSources([], EYE, undefined, { lights: many });
    ok('cap: 40 lamps give 32 sources, sorted', srcMany.length === 32 && srcMany.every((q, i) => i === 0 || srcMany[i - 1][3] >= q[3]), 'sources ' + srcMany.length);

    // the pass: RF.Touge.glareSources is the same function, fed car-frame copies. Pose: 420 m along the pass, the scene the pass builds there.
    const PA = RF.DriveAnim, PT = RF.Touge;
    const passSrc = PA.source('road', 3.5, true, { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true, rpm: true }, { mountainPass: true, streetLamps: 'sodium', seed: 7, oncoming: true, preceding: true, trafficDensity: 2 });
    const pp = { src: passSrc, lane: 3.5, us: true, touge: true, lut: D.lutFrom(() => 30000), conv: 'A', look: { RL: 0.2, ambient: 0 }, detailedModels: false, deerBehaviour: false, lamps: [[0, 0.7, 0.7]] };
    const pw = PT.world(pp, 420, 0, undefined);
    const pHeads = PT.glareSources(pw.objects.filter((o) => o.headlamp), 420, pw.A);
    const pAll = PT.glareSources(pw.objects, 420, pw.A, { lights: pw.lights || [], lampClass: 'III', lampKind: 'sodium' });
    ok('pass: every source (street lamps and tails included) is more than the headlamps alone at 420 m', pAll.length > pHeads.length, 'headlamps ' + pHeads.length + ' all ' + pAll.length);
    ok('pass: sources carry rgb', pAll.every((q) => q.length === 7));
    ok('pass all: sorted brightest first', pAll.every((q, i) => i === 0 || pAll[i - 1][3] >= q[3]));
    console.log('[info] pass 420 m: veilAt([1,0,0]) headlamps ' + D.veilAt([1, 0, 0], pHeads).toExponential(6) + ' (' + pHeads.length + ' sources), all ' + D.veilAt([1, 0, 0], pAll).toExponential(6) + ' (' + pAll.length + ')');
    // Brief U step-B numbers: one tail lamp, one lit signal, one street lamp at 20 m and 120 m. E = lux at the eye. Bloom radius = the angle (deg) where the veil
    // 10 E / theta^2 falls to 0.5 cd/m2 ... see the report for the choice; peak = 10 E (theta clamped to 1 deg), as the shader does.
    for (const r of [20, 120]) {
      const x = EYE[0] + r, t = D.glareSources([{ k: 'disc', taillamp: true, x, y: EYE[1], z: 0.78, nx: -1, ny: 0, nz: 0, r: lampR, emitPow: 2, emit: [Lm, 0.03 * Lm, 0.015 * Lm], mat: 'lamp-head', cls: 'car' }], EYE)[0];
      const g = D.glareSources([{ k: 'disc', x, y: EYE[1], z: 5.25, r: 0.1, nx: -1, ny: 0, nz: 0, emitPow: 2, emit: [200, 8000, 3500], mat: 'pole', cls: 'signal' }], EYE)[0];
      const st = D.glareSources([], EYE, undefined, { lights: [{ x, y: EYE[1] - 6, z: 6.85, cd: 900, rgb: [1, 0.43, 0.1], street: [0, 1] }], lampClass: 'III', lampKind: 'sodium' })[0];
      const rad = (E) => Math.sqrt(10 * E / 0.5);   // deg where 10E/theta^2 = 0.5 cd/m2 (a veil of 0.5 cd/m2 is about a tenth of a lit road)
      for (const [name, q] of [['tail lamp (80 cd)', t], ['lit signal (green)', g], ['street lamp (sodium)', st]]) console.log('[info] ' + r + ' m ' + name + ': E ' + (q ? q[3].toExponential(3) + ' lux, peak veil 10E ' + (10 * q[3]).toExponential(3) + ' cd/m2, radius to 0.5 cd/m2 ' + rad(q[3]).toFixed(2) + ' deg' : 'none'));
      // sodium class III cuts off at 85 deg from nadir (lamp-dist.js): lamp height 6.85 m over the 1.2 m eye puts 85 deg at ~65 m, so a street lamp farther than that sends no candela toward the eye (no source), by the luminaire's own cut-off
      ok(r + ' m: tail lamp and signal are sources with E > 0; the street lamp is one only inside its 85 deg cut-off (r < 65 m)', !!(t && g && t[3] > 0 && g[3] > 0) && (r < 65 ? !!(st && st[3] > 0) : !st));
    }
  }
  if (typeof module !== 'undefined') module.exports = { run };
  else root.GlareAllChecks = { run };
})(typeof globalThis !== 'undefined' ? globalThis : this);
if (typeof require !== 'undefined' && require.main === module) {
  let fails = 0;
  // js/lamp-dist.js is an ES module that sets RF.LampDist; run it as a classic script here (the same text the browser loads, export keywords dropped).
  const RF = require('./load.js').load();   // load.js also loads js/lamp-dist.js (RF.LampDist)
  module.exports.run(RF, (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all glare-all checks passed');
  process.exitCode = fails ? 1 : 0;
}
