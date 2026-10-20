// CR: a pass car's parts sit rigidly on its frame. GPU path: drive-three-models.js adapt() places each mount through
// carBasis (the basis update() rotates the mesh by). Node: node tests/car-rigid.js — exits 1 on any failure.
// The mounts are MODELLED: kit lamp offsets, mapped into the mesh-local frame (front = +x, face flip F), stand in for the
// GLB mounts, which need a browser to measure. The predictor is an inline formula, independent of carBasis.
const fs = require('fs'), path = require('path');
const { load } = require('./load.js');

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const L = Math.hypot(...a); return a.map(v => v / L); };

function run(RF, ok) {
  const A0 = RF.DriveAnim, P = RF.Touge, carBasis = RF.Drive.Models.carBasis;   // the shipped basis (drive-models.js), shared by the GPU mesh and CPU lamps
  const src = A0.source('road', 3.5, true, { people: true, animals: true, signs: true, posts: true, veg: true, obstacle: true, rpm: true },
    { mountainPass: true, streetLamps: 'sodium', seed: 7, oncoming: true, preceding: true, trafficDensity: 2 });
  const scen = [['flat', 160], ['+8% grade', 40], ['-10% grade', 1100], ['bank -6%, grade +8%', 700], ['bank +6%, grade -10%', 1280], ['bank +6%, grade +8%', 860]];
  const rows = [];
  for (const [name, s] of scen) for (const kind of ['oncoming', 'preceding']) {
    const A = P.route(0, 3.5, true);
    const off = kind === 'oncoming' ? 3.5 : 0, car = { id: 'car', kind, rel: s, off, yaw: 0 };
    const objs = A0._.trafficObjects(src, [car], A, undefined);
    const q = A.at(s, off), f = A.frame(q.p[0], q.p[1]), surf = A.surface(f.s, f.off);
    const c = q.t[0], sn = q.t[1], face = kind === 'oncoming' ? -1 : 1, F = face;
    const yaw = Math.atan2(sn, c), anchor = [q.p[0], q.p[1], surf.p[2]], U = surf.normal;
    const m = { id: 'car', x: anchor[0], y: anchor[1], z: anchor[2], yaw, face, grade: surf.grade, normal: U };
    const B = carBasis(m);
    // Predictor: anchor + e*Xy + l*Yy + h*U, Xy/Yy from the heading with grade projected on the normal.
    const t = [c, sn, surf.grade], Xy = unit(t.map((v, i) => v - dot(t, U) * U[i])), Yy = cross(U, Xy);
    for (const ob of objs) {
      if (ob.k !== 'disc') continue;
      const dx = ob.x - q.p[0], dy = ob.y - q.p[1], e = dx * c + dy * sn, l = -dx * sn + dy * c, h = ob.z;
      const want = anchor.map((a, j) => a + e * Xy[j] + l * Yy[j] + h * U[j]);
      // Modelled mount: mesh-local coordinates (front = +x). For face -1 the mesh basis is flipped, so the local offsets flip too.
      const P3 = [F * e, F * l, h];
      const nKit = [ob.nx || 0, ob.ny || 0, ob.nz || 0];
      const mountN = [F * (nKit[0] * c + nKit[1] * sn), F * (-nKit[0] * sn + nKit[1] * c), nKit[2]];
      // New adapt() math (drive-three-models.js): through carBasis.
      const got = [0, 1, 2].map(j => [m.x, m.y, m.z][j] + B.X[j] * P3[0] + B.Y[j] * P3[1] + B.U[j] * P3[2]);
      // Old flat adapt() math, for the positive control: x/y in the yaw frame, z = root z + p2.
      const flatYaw = yaw + (F === -1 ? Math.PI : 0), fc = Math.cos(flatYaw), fs2 = Math.sin(flatYaw);
      const flat = [m.x + fc * P3[0] - fs2 * P3[1], m.y + fs2 * P3[0] + fc * P3[1], m.z + P3[2]];
      const d = p => Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]) * 100;
      const nMesh = [0, 1, 2].map(j => B.X[j] * mountN[0] + B.Y[j] * mountN[1] + B.U[j] * mountN[2]);
      rows.push({ name, kind, part: ob.headlamp ? 'headlamp' : ob.taillamp ? 'taillamp' : ob.mat, errNew: d(got), errOld: d(flat), normLen: Math.hypot(...nMesh) });
    }
  }
  const worstNew = Math.max(...rows.map(r => r.errNew)), worstOld = Math.max(...rows.map(r => r.errOld));
  const badNorm = rows.filter(r => Math.abs(r.normLen - 1) > 1e-6).length;
  ok('CR GPU: every lamp/plate/reflector mount lands within 1 cm of the rigid prediction (flat, grades, banks, F=-1 and F=+1)', worstNew <= 1, 'worst ' + worstNew.toFixed(3) + ' cm over ' + rows.length + ' discs (modelled mounts)');
  ok('CR GPU control: the old flat placement FAILS the same check on the grade/bank rows', rows.some(r => r.name !== 'flat' && r.errOld > 1) && worstOld > 10, 'old worst ' + worstOld.toFixed(1) + ' cm');
  ok('CR GPU: mapped normals stay unit length', badNorm === 0, badNorm + ' non-unit normals');
  ok('CR GPU: flat rows match the old placement (no change on flat road)', rows.filter(r => r.name === 'flat').every(r => r.errOld < 1e-6) && rows.filter(r => r.name === 'flat').every(r => r.errNew < 1e-6));
}

if (require.main === module) {
  let fails = 0;
  run(load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? '  — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all CR car-rigid Node checks passed');
  process.exitCode = fails ? 1 : 0;
}
module.exports = { run };
