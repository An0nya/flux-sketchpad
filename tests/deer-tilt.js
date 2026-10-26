// DT1 (Brief T item 4): the detailed deer on the pass tilts its body to the terrain normal; flat is unchanged.
// Real functions: RF.Drive.Models.build ('deer', o.normal), RF.Touge.world (crest deer get detail.normal). Node: node tests/deer-tilt.js
const { load } = require('./load.js');
function run(RF, ok) {
  const M = RF.Drive.Models, ph = 10 * Math.PI / 180, n = [0, Math.sin(ph), Math.cos(ph)];
  const flat = M.build('deer', { x: 0, y: 0 }), up = M.build('deer', { x: 0, y: 0, normal: [0, 0, 1] }), tilted = M.build('deer', { x: 0, y: 0, normal: n });
  const same = (a, b) => a.nodeCount === b.nodeCount && a.z === b.z && a.nodes.every((v, i) => v === b.nodes[i]);
  ok('DT1 no normal and normal (0,0,1) build the same bytes', same(flat, up));
  ok('DT1 a tilted normal changes the nodes', !same(flat, tilted));
  // nodes 0 and 1 are body ellipsoids along the body axis (y at yaw 0, 12 floats per node, z at index 2): the axis pitches by sin(10 deg) with the sign of the rotation z -> n
  const dz = (m) => m.nodes[2] - m.nodes[14], dy = (m) => m.nodes[1] - m.nodes[13];
  ok('DT1 body axis pitches by the terrain angle', Math.abs(dz(flat)) < 1e-6 && Math.abs(dz(tilted) - (-dy(flat) * Math.sin(ph))) < 1e-4, { flat: dz(flat), tilted: dz(tilted), expected: -dy(flat) * Math.sin(ph) });
  ok('DT1 the body stays rigid (axis length kept)', Math.abs(Math.hypot(dy(tilted), dz(tilted), tilted.nodes[0] - tilted.nodes[12]) - Math.hypot(dy(flat), dz(flat), 0)) < 1e-4);
  // the pass: crest deer are SDF bodies and at least one stands on sloped ground
  const src = RF.DriveAnim.source('road', 3.5, true, { people: false, animals: true, signs: false, posts: false, veg: false, obstacle: false, rpm: false }, { mountainPass: true, streetLamps: 'sodium', seed: 7 });
  const lut = { data: new Float32Array(4) }, p = { src, lane: 3.5, touge: true, detailedModels: true, lut, lowLut: lut };
  let deer = 0, sloped = 0;
  for (let dist = 60; dist < 1300; dist += 20) {
    const w = RF.Touge.world(p, dist, 0), A = RF.Touge.route(dist, 3.5, true);
    for (const o of w.objects) if (o.k === 'sdf' && o.cls === 'deer') { deer++; const f = A.frame(o.x, o.y), q = A.surface(f.s, f.off); if (Math.abs(q.normal[2] - 1) > 1e-5) sloped++; }
  }
  // plumbing: the nodes of a sloped deer differ from the same deer built flat (re-build from the world's own node data is not possible, so compare two worlds: pass vs flat route)
  const dn = (w) => w.objects.filter((o) => o.k === 'sdf' && o.cls === 'deer').map((o) => Array.from(o.nodes).slice(0, 24).map((v) => +v.toFixed(5)).join(','));
  let differ = 0, compared = 0;
  for (let dist = 60; dist < 1300; dist += 20) {
    const a = dn(RF.Touge.world(p, dist, 0)); if (!a.length) continue;
    const b = dn(RF.Touge.world({ ...p, touge: false }, dist, 0)); compared += a.length; if (a.join('|') !== b.join('|')) differ++;
  }
  ok('DT1 pass world: deer node data differs from the flat-route build of the same pose', compared > 0 && differ > 0, { compared, differ });
  ok('DT1 pass: crest deer are built as SDF bodies', deer > 0, { deer });
  ok('DT1 pass: at least one deer stands on sloped ground (the tilt is exercised)', sloped > 0, { sloped });
}
if (require.main === module) {
  let fails = 0;
  run(load(), (name, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + name + (d !== undefined ? '  - ' + JSON.stringify(d) : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all deer-tilt checks passed');
  process.exitCode = fails ? 1 : 0;
}
module.exports = { run };
