// PP: the mountain pass follows the generalized drive options (deer bolt, detailed models, sparse street lamps, edge lines only).
// Node, no browser: node tests/pass-parity.js — exits 1 on any failure. Positive control: lamps switched off must fail the lamp check.
const { load } = require('./load.js');

function run(RF, ok) {
  const A = RF.DriveAnim, P = RF.Touge, D = RF.Drive;
  const SEED = 7, PERIOD = 1600;
  const pass = (o) => {
    const src = A.source('road', 3.5, true, { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true, rpm: true }, { mountainPass: true, streetLamps: o.lamps || 'sodium', seed: SEED, oncoming: true, preceding: true, trafficDensity: 2, cline: o.cline });
    return { src, lane: 3.5, us: true, touge: true, lut: D.lutFrom(() => 30000), conv: 'A', look: { RL: 0.2, ambient: 0 }, detailedModels: !!o.detailed, deerBehaviour: !!o.deer, lamps: [[0, 0.7, 0.7]] };
  };
  const world = (p, dist, tauOf) => P.world(p, dist, 0, tauOf);
  const lamps = (w) => w.objects.filter(o => o.cls === 'street-lamp' && o.k === 'cyl');
  const deer = (w) => w.objects.filter(o => o.detailPart === 'deer' && o.detail);
  const near = (a, b, e) => Math.abs(a - b) <= e;

  // 1. Sparse lamps: positions from lampSpots over two laps, seeded and deterministic, only in two stretches, none near the crests.
  const absolute = new Set();
  for (let d = 0; d < 2 * PERIOD; d += 5) for (const c of P.lampSpots(d, SEED)) absolute.add(Math.round(c.rel + d) % PERIOD);
  const pts = [...absolute].sort((a, b) => a - b);
  // Stretch starts are 300..359 m and 1040..1079 m, lamps every 40 m from +20 m, so the lamps lie in [300, 480) and [1040, 1180) of each lap.
  const inStretch = s => (s >= 300 && s < 480) || (s >= 1040 && s < 1180);
  const crestClear = s => Math.min(...[160, 969].map(c => Math.abs(s - c))) > 20;
  ok('PP lamps: exactly 6 lamp positions per lap (two stretches of three)', pts.length === 6, 'per lap ' + pts.length + ': ' + pts.join(' '));
  ok('PP lamps: every position sits inside one of the two stretches and clear of the 160 m and 969 m crests', pts.every(s => inStretch(s) && crestClear(s)), pts.join(' '));
  ok('PP lamps: deterministic, same seed gives same spots', JSON.stringify(P.lampSpots(123, SEED)) === JSON.stringify(P.lampSpots(123, SEED)));
  // 2. Nothing elsewhere: a window that covers no stretch has no lamp objects; a window over a stretch does.
  const quiet = world(pass({}), 600), busy = world(pass({}), 280);
  ok('PP lamps: a window with no stretch in it has no street lamps', lamps(quiet).length === 0, 'at 600 m: ' + lamps(quiet).length);
  ok('PP lamps: a window over a stretch has lamps (pole, arm and head each) and point lights', lamps(busy).length > 0 && busy.objects.some(o => o.k === 'ell' && o.cls === 'street-lamp') && busy.objects.some(o => o.k === 'box' && o.cls === 'street-lamp') && busy.lights.length > 0, 'at 280 m: ' + lamps(busy).length + ' poles, ' + busy.lights.length + ' point lights');
  // Positive control: the same check, with street lamps switched off, must fail.
  const lampCheck = w => lamps(w).length > 0;
  const off = world(pass({ lamps: 'off' }), 280);
  ok('PP control: the lamp check passes with lamps on and FAILS with lamps off', lampCheck(busy) === true && lampCheck(off) === false, 'on ' + lampCheck(busy) + ' / off ' + lampCheck(off));

  // 3. Deer bolt: tauOf is read for the crest deer only with behaviour on, and the bolt clock moves the deer.
  const reads = [];
  const clock = k => { reads.push(k); return k === '@0:crest:160' ? 30 : -1; };
  const onW = world(pass({ deer: true }), 0, clock), onReads = reads.length;
  reads.length = 0;
  const offW = world(pass({ deer: false }), 0, clock), offReads = reads.length;
  const dOn = deer(onW), dOff = deer(offW);
  const crest = dOn.find(o => o.detail.id === '0:crest:160');
  ok('PP deer: behaviour on reads tauOf for the crest deer; behaviour off never reads it', onReads > 0 && offReads === 0, 'reads on ' + onReads + ' off ' + offReads);
  ok('PP deer: behaviour on gives each crest deer an attention object; off gives none', dOn.length > 0 && dOn.every(o => o.detail.attention) && dOff.every(o => !o.detail.attention), 'on ' + dOn.length + ' off ' + dOff.length);
  ok('PP deer: with a bolt clock past the bolt, the crest-160 deer is bolting and off the crest', !!crest && crest.detail.attention.state === 'bolt' && crest.detail.motion && crest.detail.motion.state === 'bound', crest ? crest.detail.attention.state : 'no deer');
  // Activation: the clock starts when the car is inside the deer's trigger distance (60..200 m), so at 60 m it is always started.
  const act = new Map();
  P.activate(pass({}).src, 100, 5, act);
  ok('PP deer: activate starts the 160 m crest deer when the car is 60 m away', act.get('@0:crest:160') === 5, JSON.stringify([...act]));
  const crestIds = new Set();
  for (let d = 0; d < PERIOD; d += 10) for (const c of P.crestDeer(d)) if (c.id.startsWith('0:')) crestIds.add(c.id);
  ok('PP deer: still two crest deer per lap (160 m and 969 m)', crestIds.size === 2 && crestIds.has('0:crest:160') && crestIds.has('0:crest:969'), [...crestIds].join(' '));

  // 4. Detailed models: deer are detailed (sdf) only with the toggle on; trees and deer change with it.
  const detOn = world(pass({ detailed: true }), 0), detOff = world(pass({ detailed: false }), 0);
  const sdfDeer = w => w.objects.filter(o => o.k === 'sdf' && o.cls === 'deer').length;
  ok('PP detail: detailed models on give sdf deer; off give none', sdfDeer(detOn) > 0 && sdfDeer(detOff) === 0, 'on ' + sdfDeer(detOn) + ' off ' + sdfDeer(detOff));
  ok('PP detail: the actor set changes with the toggle (trees and deer)', JSON.stringify(detOn.objects.map(o => o.k)) !== JSON.stringify(detOff.objects.map(o => o.k)));

  // 5. No pedestrians, no centre line, at many positions around the lap (lane studs are checked below).
  let people = 0, studs = 0, centre = 0, cars = 0, normals = 0;
  for (let d = 0; d < PERIOD; d += 97) {
    const w = world(pass({ detailed: true, deer: true }), d, () => -1);
    people += w.objects.filter(o => o.cls === 'person' || o.detailPart === 'person').length;
    studs += w.objects.filter(o => o.cls === 'rpm').length;
    const tr = w.objects.filter(o => o.traffic && o.detail);
    cars += tr.length; normals += tr.filter(o => o.detail.normal && o.detail.normal.length === 3).length;
  }
  ok('PP no pedestrians anywhere on the pass', people === 0, 'people seen ' + people);
  // SB1: studs on the pass are an owner decision (the old 'no lane studs' was a brief error, removed); every window of the lap has them
  ok('PP lane studs on the pass: present around the lap', studs > 0, 'studs seen ' + studs);
  // Centre line restored (PP2b): US solid = two yellow lines, broken = one dashed yellow line, plus the two white edge lines.
  const mk = (o) => world(pass(o), 0).markings;
  const solid = mk({}), brk = mk({ cline: 'broken' });
  ok('PP centre line: US solid double yellow on the pass', solid.filter(m => m.mat === 'yellow-paint').length === 2 && solid.filter(m => m.mat === 'white-paint' && !m.pat).length === 2, solid.map(m => m.mat).join(','));
  ok('PP centre line: broken yellow (passing zone) on the pass, with its dash pattern', brk.filter(m => m.mat === 'yellow-paint' && m.pat).length === 1 && brk.filter(m => m.mat === 'white-paint' && !m.pat).length === 2, brk.map(m => m.mat + (m.pat ? '/dash' : '')).join(','));
  ok('PP centre line: sits on the lane centre (offset Lw/2)', solid.filter(m => m.mat === 'yellow-paint').every(m => Math.abs((m.o0 + m.o1) / 2 - 3.5 / 2) < 0.2), solid.filter(m => m.mat === 'yellow-paint').map(m => ((m.o0 + m.o1) / 2).toFixed(2)).join(','));
  ok('PP traffic cars on the pass exist and every one carries the road normal for the GPU mesh car', cars > 0 && normals === cars, 'cars ' + cars + ', with normal ' + normals);

  // 6. PP2: the GPU mesh car body must be projected in the same car frame as the pass lamps and road (carFromWorld in the shader).
  // Metric: camera-space up error in metres between the mesh's projection and the primitive (lamp/road) projection of the same car origin.
  const fsM = require('fs'), pathM = require('path');
  const meshSrc = fsM.readFileSync(pathM.join(__dirname, '..', 'js', 'drive-three-models.js'), 'utf8');
  ok('PP2 mesh car vertex shader applies carFromWorld (source guard)', /uniform mat3 carFromWorld/.test(meshSrc) && /vec3 q=carFromWorld\*\(p\.xyz-eye\)/.test(meshSrc));
  // frame = [f,l,n] (car axes in world); eye = the shader's eye uniform (already rotated into world on the pass).
  // primitive: q = carFromWorld*(p-eye). mesh: q = carFromWorld*(p-eye) when fixed, p-eye when broken.
  function offsetAt(points, frame, eye, meshInCarFrame) {
    const [f, l, n] = frame, MT = [f, l, n];
    const mul = (v) => MT.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    let worst = 0;
    for (const pt of points) {
      const d = pt.map((v, i) => v - eye[i]), qP = mul(d), qM = meshInCarFrame ? mul(d) : d;
      worst = Math.max(worst, Math.abs(qM[2] - qP[2]));                         // camera-space up error, metres (how far the body sits off the lamp frame)
    }
    return worst;
  }
  const flatOff = offsetAt([[40, 1, .5], [90, -2, 1]], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [-2, .37, 1.2], false);
  ok('PP2 control: flat scene (carFromWorld = identity) has zero mesh-vs-lamp offset', flatOff === 0, flatOff);
  let fixedWorst = 0, brokenWorst = 0;
  for (let d = 0; d < PERIOD; d += 40) {
    const w = world(pass({ detailed: true }), d, () => -1), a = P.attitude(d), f = a.forward, l = a.left, n = a.up;
    const eye = [0, 1, 2].map(i => f[i] * -2 + l[i] * .37 + n[i] * 1.2);
    const pts = w.objects.filter(o => o.traffic && o.detail && o.detail.normal).map(o => [o.detail.x, o.detail.y, o.detail.z]);
    fixedWorst = Math.max(fixedWorst, offsetAt(pts, [f, l, n], eye, true));
    brokenWorst = Math.max(brokenWorst, offsetAt(pts, [f, l, n], eye, false));
  }
  ok('PP2 pass: mesh car body within 5 cm of the lamp/road frame at every 40 m of the lap', fixedWorst < 0.05, 'worst ' + fixedWorst.toFixed(4) + ' m');
  ok('PP2 control: the pre-fix projection (no carFromWorld) FAILS that 5 cm check', brokenWorst >= 0.05, 'pre-fix worst ' + brokenWorst.toFixed(3) + ' m');
  // 7. PP2c: a detailed deer's eyes lift with its body, so the rigid eye-to-body height holds on a cliff verge and on the crest.
  // The pre-fix control lifts each eye at its own terrain sample (no surfaceAnchor): it must fail the 5 cm check.
  const eyeErr = (dist, off, preFix) => {
    const A = P.route(dist, 3.5, true), K = D.kit({ Lw: 3.5, A, rand: D.rng(701) });
    K.deer(60, off, { id: 'probe:' + dist });
    const local = D.Models.actors(K.O.map(o => ({ ...o })), true);
    const eyesT = local.filter(o => o.k === 'disc' && o.mat === 'eyeshine'), sdfT = local.find(o => o.k === 'sdf');
    const lifted = local.map(o => P.lift(preFix ? { ...o, surfaceAnchor: undefined } : o, A));
    const sdfL = lifted.find(o => o.k === 'sdf'), eyesL = lifted.filter(o => o.k === 'disc' && o.mat === 'eyeshine');
    return Math.max(...eyesL.map((e, i) => Math.abs((e.z - sdfL.z) - (eyesT[i].z - sdfT.z))));
  };
  const cliffOff = 1.5 * 3.5 + 3.5;
  let eyeFixed = 0, eyeBroken = 0;
  for (const dist of [0, 40, 120, 240, 320, 560, 720, 880, 1000]) { eyeFixed = Math.max(eyeFixed, eyeErr(dist, cliffOff, false)); eyeBroken = Math.max(eyeBroken, eyeErr(dist, cliffOff, true)); }
  ok('PP2c deer eyes: rigid with the body on the cliff verge (<5 cm at 9 distances)', eyeFixed < 0.05, 'worst ' + (eyeFixed * 100).toFixed(2) + ' cm');
  ok('PP2c control: per-eye terrain lift (pre-fix) FAILS that check', eyeBroken >= 0.05, 'pre-fix worst ' + (eyeBroken * 100).toFixed(1) + ' cm');
  // 8. PP2d: auto high beam must not see oncoming lamps through a crest. Camera at 100 m, crest at 160 m (60 m ahead).
  const E = [-2, .37, 1.2], dist = 100, Ar = P.route(dist, 3.5, true);
  const lampAt = (s, off) => { const q = Ar.at(s, off), L = [q.p[0], q.p[1], Ar.height(s, off) + .7], h = Math.hypot(E[0] - L[0], E[1] - L[1]); return { k: 'disc', x: L[0], y: L[1], z: L[2], headlamp: true, nx: (E[0] - L[0]) / h, ny: (E[1] - L[1]) / h, nz: 0, r: .03, mat: 'lamp' }; };
  let hiddenS = null;
  for (let s = 70; s <= 158 && hiddenS === null; s += 2) { const L = lampAt(s, -1.75); if (L.x > E[0] && P.blocked(Ar, E, [L.x, L.y, L.z])) hiddenS = s; }
  ok('PP2d found a lamp beyond the crest that the terrain hides', hiddenS !== null, 'at rel ' + hiddenS + ' m');
  const hidden = lampAt(hiddenS, -1.75), blockedHook = pos => P.blocked(Ar, E, pos);
  ok('PP2d the sensor WITH the terrain hook does not see the hidden lamp', D.autoHighSense([hidden], E, { occluders: [hidden], lane: 3.5, blocked: blockedHook }).oncoming === false);
  ok('PP2d control: without the hook the same lamp is reported (the bug)', D.autoHighSense([hidden], E, { occluders: [hidden], lane: 3.5 }).oncoming === true);
  const nearLamp = lampAt(40, -1.75);
  ok('PP2d a lamp in plain view over the near crest still counts with the hook', !P.blocked(Ar, E, [nearLamp.x, nearLamp.y, nearLamp.z]) && D.autoHighSense([nearLamp], E, { occluders: [nearLamp], lane: 3.5, blocked: blockedHook }).oncoming === true);
  const animSrc = fsM.readFileSync(pathM.join(__dirname, '..', 'js', 'drive-anim.js'), 'utf8');
  ok('PP2d pass wiring: autoSense passes the terrain hook for p.touge', /blocked: \(pos\) => RF\.Touge\.blocked\(w\.A, E, pos\)/.test(animSrc));
}

module.exports = { run };
if (require.main === module) {
  let fails = 0;
  run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? '  — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all PP pass-parity Node checks passed');
  process.exitCode = fails ? 1 : 0;
}
