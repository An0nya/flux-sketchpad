#!/usr/bin/env node
// Gate: our analytic lens (3D trace, field map, `rev` surfaces) agrees with the ENGINE's own ray trace through the same surfaces.
const { RF, loadDev, ROOT } = require('./lib.js'); loadDev(['lens']);
const P3 = RF.P3, V = RF.V, D2R = Math.PI / 180;
const n = 1.59, glass = { interaction: 'refract', reflectivity: 0.9, ior: n, fresnelT: 1, twoSided: false };
const cases = [['curve-in', 40, 25, -n * n, 0], ['flat-in', 40, 25, -2.0, 0], ['flat-in', 40, 25, -1.0, 0], ['bi', 40, 25, -1.6, 0.7]];
let bad = 0;
for (const [kind, f, a, k, beta] of cases) {
  const L = P3.makeLens(n, f, a, kind, k, beta); if (!L) { console.log(kind, 'k', k, ': NO LENS'); bad++; continue; }
  const O = [100, 3, -2], surfs = P3.lensSurfaces(L, O, glass, 'T');
  const sc = RF.State.testScene(); sc.groups.A.surfaces = surfs; for (const g of ['B', 'C']) if (sc.groups[g]) sc.groups[g].enabled = false; sc.sim.bounces = 6;
  const Pp = RF.Engine.prepare(sc, RF.State.allSurfaces(sc));
  const Fw = [O[0] - L.bfd, O[1], O[2]];                                       // the paraxial focus
  let maxErr = 0, nOk = 0, nMiss = 0, nBoth = 0;
  for (let th = 0; th <= 20; th += 5) for (let i = 0; i < 25; i++) {
    // a ray from a point near the focus toward a point on the lens face
    const ang = th * D2R, src = [Fw[0], Fw[1] + L.f * Math.tan(ang) * 0.0, Fw[2]];
    const tx = (i % 5 - 2) / 2 * a * 0.7, ty = (Math.floor(i / 5) - 2) / 2 * a * 0.7;
    const d = V.norm([L.bfd, tx - L.f * Math.tan(ang) * 0, ty + 0]);                    // toward the lens face
    const dd = V.norm([L.bfd * Math.cos(ang) + 0, tx, ty]), dir = V.norm([Math.cos(ang) * L.bfd, tx + Math.sin(ang) * L.bfd, ty]);
    const r = RF.Engine.probeRay(Pp, src, dir, 1), ev = r.events.filter((e) => e.type === 'refract');
    const mine = P3.traceLens(L, [src[0] - O[0], src[1] - O[1], src[2] - O[2]], [dir[0], dir[1], dir[2]]);
    const eng = ev.length === 2 ? ev[1].dOut : null;
    if (!mine && !eng) { nBoth++; continue; }
    if (!mine || !eng) { nMiss++; continue; }
    const e = Math.acos(Math.min(1, V.dot(eng, V.norm(mine.d)))) / D2R; maxErr = Math.max(maxErr, e); nOk++;
  }
  const ok = nMiss === 0 && maxErr < 1e-4 && nOk > 10; if (!ok) bad++;
  console.log((ok ? 'PASS ' : 'FAIL ') + kind.padEnd(8), 'k', String(k).padEnd(6), 'efl', L.efl.toFixed(3), 'bfd', L.bfd.toFixed(2), 't', L.t.toFixed(2), 'agree', nOk, 'disagree-on-hit', nMiss, 'both-miss', nBoth, 'max angle err', maxErr.toExponential(1) + '°',
    '| blur 0/10/20°:', [0, 4, 8].map((i) => (L.map[i] ? L.map[i].blur.toFixed(2) : '–')).join('/'), 'tanAcc', L.tanAcc.toFixed(2));
}
process.exitCode = bad ? 1 : 0; console.log(bad ? 'LENS GATE FAILED' : 'lens gate ok');
