const fs = require('fs'); const { RF } = require('/Users/anya/Projects/flux-sketchpad/tools/sqm-hl/lib.js'); const V = RF.V;
const sc = RF.State.deserialize(fs.readFileSync(process.argv[2], 'utf8')); const surf = RF.State.allSurfaces(sc); const G = RF.Geo.compile(surf);
for (const id of ['p3_ellipsoid_top', 'p3_ellipsoid_bottom']) {
  const k = surf.findIndex((s) => s.id === id); if (k < 0) continue; const s = surf[k], o = k * RF.Geo.STRIDE, D = G.D;
  const polys = RF.Geo.mesh(G, k), outl = RF.Geo.outline(G, k)[0];
  let bad = 0, n = 0, xs = [], ys = [], zs = []; for (const p of polys) for (const q of p) { n++; if (!q.every(Number.isFinite)) bad++; xs.push(q[0]); ys.push(q[1]); zs.push(q[2]); }
  const r = (a) => `${Math.min(...a).toFixed(1)}..${Math.max(...a).toFixed(1)}`;
  console.log(id, 'curv', s.curv.map((c) => +c.toFixed(5)).join(','), 'polys', polys.length, 'verts', n, 'non-finite', bad, '| mesh x', r(xs), 'y', r(ys), 'z', r(zs));
  // rim as outline() draws it (clip polygon lifted by sag): axial x vs angle round the rim
  const rim = outl.map((q) => q); const cx = sc.envelope.center; const ang = (q) => (Math.atan2(q[2] - s.P[2], q[1] - s.P[1]) * 180 / Math.PI + 360) % 360;
  const pick = [0, 45, 90, 135, 180, 225, 270, 315].map((a) => rim.reduce((b, q) => (Math.abs(((ang(q) - a + 540) % 360) - 180) < Math.abs(((ang(b) - a + 540) % 360) - 180) ? q : b)));
  console.log('   rim axial x by angle (0=+y horizontal, 90=up):', pick.map((q) => `${ang(q).toFixed(0)}°:x${q[0].toFixed(0)} r${Math.hypot(q[1] - s.P[1], q[2] - s.P[2]).toFixed(0)}`).join('  '));
  const ae = 1 / s.curv[3]; console.log('   vertex x', s.P[0].toFixed(1), 'a', ae.toFixed(1), 'b_x', Math.sqrt(ae / s.curv[0]).toFixed(1), 'b_z', Math.sqrt(ae / s.curv[1]).toFixed(1), 'clip polygon half-width y', r(s.clip.pts3.map((q) => q[1])), 'z', r(s.clip.pts3.map((q) => q[2])));
}
