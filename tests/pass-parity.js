// PP: the mountain pass follows the generalized drive options (deer bolt, detailed models, sparse street lamps, edge lines only).
// Node, no browser: node tests/pass-parity.js — exits 1 on any failure. Positive control: lamps switched off must fail the lamp check.
const { load } = require('./load.js');

function run(RF, ok) {
  const A = RF.DriveAnim, P = RF.Touge, D = RF.Drive;
  const SEED = 7, PERIOD = 1600;
  const pass = (o) => {
    const src = A.source('road', 3.5, true, { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true, rpm: true }, { mountainPass: true, streetLamps: o.lamps || 'sodium', seed: SEED, oncoming: true, preceding: true, trafficDensity: 2 });
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

  // 5. No pedestrians, no centre line, no lane studs, at many positions around the lap.
  let people = 0, studs = 0, centre = 0, cars = 0, normals = 0;
  for (let d = 0; d < PERIOD; d += 97) {
    const w = world(pass({ detailed: true, deer: true }), d, () => -1);
    people += w.objects.filter(o => o.cls === 'person' || o.detailPart === 'person').length;
    studs += w.objects.filter(o => o.cls === 'rpm').length;
    centre += w.markings.filter(m => m.pat || m.mat !== 'white-paint').length;
    const tr = w.objects.filter(o => o.traffic && o.detail);
    cars += tr.length; normals += tr.filter(o => o.detail.normal && o.detail.normal.length === 3).length;
  }
  ok('PP no pedestrians anywhere on the pass', people === 0, 'people seen ' + people);
  ok('PP no lane studs on the pass', studs === 0, 'studs seen ' + studs);
  ok('PP only the two edge lines (no centre line, dashed or yellow)', centre === 0, 'extra markings ' + centre);
  ok('PP traffic cars on the pass exist and every one carries the road normal for the GPU mesh car', cars > 0 && normals === cars, 'cars ' + cars + ', with normal ' + normals);
}

module.exports = { run };
if (require.main === module) {
  let fails = 0;
  run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? '  — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all PP pass-parity Node checks passed');
  process.exitCode = fails ? 1 : 0;
}
