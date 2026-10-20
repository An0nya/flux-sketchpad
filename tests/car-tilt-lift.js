// CR2: on the pass, a car's lamp discs follow the mesh mounts (drive-touge.js lift, meshLamp) when the detailed mesh car is drawn.
// Node: node tests/car-tilt-lift.js — exits 1 on any failure. Checks: gate off = the untilted lift (kit x,y; own-anchor road height);
// gate on = every car lamp on its mount, rigid (pair spacing = mount spacing, root distance = mount length), unit normals;
// non-car objects do not move; all three GLB variants are exercised.
// The gate-on and gate-off object lists differ in length (detailed people and deer), so objects are matched by key, not by index.
const { load } = require('./load.js');

function run(RF, ok) {
  const A0 = RF.DriveAnim, P = RF.Touge, D = RF.Drive;
  const src = A0.source('road', 3.5, true, { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true, rpm: true },
    { mountainPass: true, streetLamps: 'sodium', seed: 7, oncoming: true, preceding: true, trafficDensity: 2 });
  // A zero LUT: positions do not depend on it; trafficLight() only reads lut.data.
  const lut = { data: new Float32Array(4) };
  const off = { src, lane: 3.5, touge: true, detailedModels: false, lut, lowLut: lut };
  const on = { ...off, detailedModels: true };
  const isCarDisc = ob => ob.detailPart === 'car' && ob.k === 'disc';
  // Key = kind | material | part | car id, plus the occurrence index among objects with that key (the car kit order is fixed, so the key is stable across the gate).
  const keyed = list => { const seen = new Map(); return new Map(list.map(o => { const base = [o.k, typeof o.mat === 'function' ? 'fn' : o.mat, o.detailPart || '', o.modelId || ''].join('|'); const i = seen.get(base) || 0; seen.set(base, i + 1); return [base + '#' + i, o]; })); };
  const variants = new Set();
  let carDiscs = 0, fallback = 0, badRigid = 0, badNormal = 0, nonCarMoved = 0, nonCarChecked = 0, unmatched = 0, gateOffBad = 0, worstSpacing = 0, headMove = 0;
  // dist 0: the traffic cars sit 40 to 380 m ahead, in the pass. The grade and bank change along the route, so the frame set covers several attitudes.
  for (const dist of [0, 190.25, 400, 700, 764.2, 1100]) {
    const t = 0, A = P.route(dist, 3.5, true);   // world() builds its route from dist, so the lift heights come from this one
    const wOff = P.world(off, dist, t), wOn = P.world(on, dist, t);
    // Gate off: car discs are the kit discs with their own-anchor road height (the pre-CR2 lift).
    const kit = A0._.trafficObjects(src, A0.trafficCars(src, dist, t), A, off).filter(isCarDisc);
    const offCar = wOff.objects.filter(isCarDisc);
    if (kit.length !== offCar.length) { gateOffBad++; continue; }
    for (let i = 0; i < offCar.length; i++) {
      const k = kit[i], o = offCar[i], f = A.frame(k.x, k.y), h = A.height(f.s, f.off);
      if (o.x !== k.x || o.y !== k.y || Math.abs(o.z - (k.z + h)) > 1e-9) gateOffBad++;
    }
    const onMap = keyed(wOn.objects), byCar = new Map();
    for (const [key, o] of keyed(wOff.objects)) {
      const n = onMap.get(key);
      if (!n) { unmatched++; continue; }
      if (!isCarDisc(o)) {
        nonCarChecked++;
        if (o.x !== n.x || o.y !== n.y || o.z !== n.z) nonCarMoved++;
        continue;
      }
      carDiscs++;
      if (n.x === o.x && n.y === o.y && n.z === o.z) fallback++;   // the lamp did not move: no mount was used
      const root = wOn.objects.find(ob => ob.detailPart === 'car' && ob.detail && ob.modelId === n.modelId);
      if (!root) { fallback++; continue; }
      const len = Math.hypot(n.x - root.x, n.y - root.y, n.z - (root.detail.z || 0));
      if (len > 2.6) badRigid++;
      if (Math.abs(Math.hypot(n.nx, n.ny, n.nz) - 1) > 1e-3) badNormal++;   // the table holds normals to 1e-4
      if (n.headlamp) headMove = Math.max(headMove, Math.hypot(o.x - n.x, o.y - n.y));
      const list = byCar.get(n.modelId) || []; list.push(n); byCar.set(n.modelId, list);
    }
    // Head-lamp pair spacing of one car equals its variant's mount spacing (a rigid transform keeps distances).
    for (const [id, list] of byCar) {
      const heads = list.filter(n => n.headlamp);
      if (heads.length !== 2) continue;
      const v = D.Models.stableId(id) % 3; variants.add(v);
      const M = D.Models.MESH_MOUNTS[v];
      const want = Math.hypot(...M['1:head:1'].p.map((c, j) => c - M['1:head:-1'].p[j]));
      const got = Math.hypot(heads[0].x - heads[1].x, heads[0].y - heads[1].y, heads[0].z - heads[1].z);
      worstSpacing = Math.max(worstSpacing, Math.abs(got - want));
    }
  }
  ok('CR2 gate off: car lamps are the untilted lift (kit x,y, own-anchor road height)', gateOffBad === 0, { gateOffBad });
  ok('CR2 gate on: every car lamp moves onto a mount (no kit fallback)', fallback === 0 && carDiscs > 0, { fallback, carDiscs });
  ok('CR2 gate on: car lamps are rigid (distance from the car root within 2.6 m)', badRigid === 0, { badRigid });
  ok('CR2 gate on: lamp normals stay unit length (1e-3)', badNormal === 0, { badNormal });
  ok('CR2 gate on: head-lamp pair spacing equals the variant mount spacing (< 1 mm)', worstSpacing < 1e-3, { worstSpacing: +worstSpacing.toFixed(6) });
  ok('CR2 coverage: all three GLB variants appear among the test cars', variants.size === 3, { variants: [...variants].sort() });
  ok('CR2 gate on: non-car objects do not move', nonCarMoved === 0, { nonCarMoved, nonCarChecked, unmatched });
  ok('CR2 gate on: the head lamps do move (the gate changes something)', headMove > 0.01, { headMoveMax_m: +headMove.toFixed(3) });
}

if (require.main === module) {
  let fails = 0;
  run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d !== undefined ? '  - ' + JSON.stringify(d) : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all CR2 car-tilt-lift Node checks passed');
  process.exitCode = fails ? 1 : 0;
}
module.exports = { run };
