// SC1: visible beam in fog (single in-scatter, own lamps). Node, no browser: node tests/scatter.js — exits 1 on any failure.
// Off (no look.scatter, or visibility Infinity/null/0/absent) must hash to the pre-SC frames. Pinned hashes were captured on
// main 465e41c before SC1 (scratch capture, same recipes as below). Scatter itself is checked against its own model:
// exact zero where the lamp is aimed away, nonzero only inside the cone, a V-peak at 20 m, step convergence, determinism.
const crypto = require('crypto'), path = require('path');
const PINNED = {
  tiles_v200: '229cfbdf0daf7dddf35bee36f9e327b10c28ab2a16fa63d68e4cdac0e63589a3',
  tiles_v60: '421cb998646fcded7550b051770e5abc5e7836fc0f8738ac98f5bda6bb584ed8',
  tiles_inf: 'd4bb869b384f084321398012da741a58713102b64ff8974b3b50213ce880c344',
  tiles_v200_wet: 'cb2a80f9bdf87f30cbfe2b2ed7846c15e685a56f10bf3a2f9dcc5846382e2d93',
  render_v200: '89c3d35e97ce8a0b69020d76050df28b5b0ed9c9df0e16310f822f299e230be8',
  render_v60: '77ec26a4b062ab4de18db70cecdbfa27ecdb34d35a0802f634e7168acd315401',
  render_pl_inf: '4884754b720aead0d17a45d5ce7e8b1f84e354e41a6c60d734e4e0343c3c10f2',
};
const H = (buf) => crypto.createHash('sha256').update(Buffer.from(buf.buffer)).digest('hex');
// A narrow synthetic cone on the lamp axis (sigma 2 degrees, 35000 cd peak): makes "inside the cone" unambiguous.
const coneLut = (RF) => RF.Drive.lutFrom((h, v) => 35000 * Math.exp(-(h * h + v * v) / (2 * 4)));
function tilesHash(RF, V, extraLook, extraOpts) {
  const { recipe } = require('./drive-polish.js'), A = RF.DriveAnim;
  const p = recipe(RF, 'road', Object.assign({ tileCache: false }, extraOpts || {}), 96);
  Object.assign(p.look, extraLook || {}); if (V !== undefined) p.look.visibility = V;
  const world = A.tileWorld(p, 95, 2), buf = new Float32Array(p.w * p.h * 4);
  A.tileFrame(p, 95, 2, buf, 2, null, null, world); return H(buf);
}
function scene(RF) {
  const D = RF.Drive;
  return {
    w: 96, h: 54, hfov: 60, eye: D.eyeFor(), lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lane: 3.5, ss: 1,
    scene: { objects: [], markings: [], verge: ['grass', 1.5, 'grass'] }, pointLights: [{ x: 6, y: 0, z: 7, cd: 900, rgb: [1, 1, 1] }],
  };
}
function render(RF, base, look) {
  return RF.Drive.render(Object.assign({}, base, { look: Object.assign({ RL: 0.2, ambient: 0.05 }, look) }));
}
// Lamp off the road centre, sight line 2 m in front of the eye: the cone test geometry (eye on the x axis, lamp 0.6 m to the side).
function coneScene(RF, lut) {
  return { eye: [-2, 0, 0], lamps: [[0, 0.6, 0]], lut: lut || coneLut(RF), conv: 'A', lampRGB: [1, 1, 1], look: { visibility: 200 } };
}
// unit direction from the eye toward a target point
const toward = (eye, P) => { const d = [P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]], L = Math.hypot(d[0], d[1], d[2]); return [d[0] / L, d[1] / L, d[2] / L]; };
const rotY = (d, a) => [d[0] * Math.cos(a) + d[2] * Math.sin(a), d[1], -d[0] * Math.sin(a) + d[2] * Math.cos(a)];
const rotZ = (d, a) => [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a), d[2]];
const sum3 = (v) => v[0] + v[1] + v[2];

function run(RF, ok) {
  const D = RF.Drive, base = scene(RF);
  // 1. off frames: no look.scatter, or visibility Infinity, equal the pre-SC pinned hashes
  ok('SC off: frames at V=200, V=60 and wet at V=200 (no look.scatter) equal the pre-SC pinned hashes',
    tilesHash(RF, 200) === PINNED.tiles_v200 && tilesHash(RF, 60) === PINNED.tiles_v60 && tilesHash(RF, 200, { wet: true, wetSheen: true, wetModel: "ggx" }, { wet: true, wetSheen: true }) === PINNED.tiles_v200_wet,
    'v200=' + tilesHash(RF, 200).slice(0, 10) + ' v60=' + tilesHash(RF, 60).slice(0, 10));
  ok('SC off: scatter steps with visibility Infinity or absent give the pre-SC frames',
    H(render(RF, base, { visibility: Infinity, scatter: 8 }).rgb) === PINNED.render_pl_inf && H(render(RF, base, { scatter: 8 }).rgb) === PINNED.render_pl_inf &&
    tilesHash(RF, Infinity, { scatter: 8 }) === PINNED.tiles_inf);
  ok('SC off: scatter 0 at finite V equals scatter absent (V=200 and V=60 render pinned)',
    H(render(RF, base, { visibility: 200, scatter: 0 }).rgb) === PINNED.render_v200 && H(render(RF, base, { visibility: 60, scatter: 0 }).rgb) === PINNED.render_v60);
  // 2. V = Infinity adds exactly zero, per ray
  const cs = coneScene(RF);
  ok('SC V=Infinity: inScatter returns exact zeros', sum3(D.inScatter(Object.assign({}, cs, { look: { visibility: Infinity } }), [1, 0, 0], 120, 0.5, 16)) === 0 && D.inScatter(Object.assign({}, cs, { look: {} }), [1, 0, 0], 120, 0.5, 16).every((x) => x === 0));
  // 3. a lamp aimed away adds nothing (yaw pi turns the beam backwards; the LUT is zero outside its window)
  const ray = toward(cs.eye, [15, 0.6, 0]);
  const aimed = D.inScatter(cs, ray, 60, 0.5, 16), away = D.inScatter(Object.assign({}, cs, { yaw: Math.PI }), ray, 60, 0.5, 16);
  ok('SC aimed away: a lamp yawed pi adds exactly nothing; aimed at the ray it adds something', sum3(away) === 0 && sum3(aimed) > 0, 'aimed=' + sum3(aimed).toExponential(3) + ' away=' + sum3(away));
  // 4. nonzero only inside the cone: the ray aimed at the beam vs the same ray turned 30 degrees (horizontal) outside it
  const inside = sum3(D.inScatter(cs, ray, 60, 0.5, 16)), outside = sum3(D.inScatter(cs, rotZ(ray, Math.PI / 6), 60, 0.5, 16));
  ok('SC cone: a ray in the beam scatters; the same ray 30 degrees outside it is below 1e-3 of it', inside > 0 && outside < 1e-3 * inside, 'inside=' + inside.toExponential(3) + ' outside=' + outside.toExponential(3));
  // 5. density: at 20 m range, denser fog (smaller V) gives more scatter up to a peak, then less (transmittance)
  const scatAt = (V, sEnd) => sum3(D.inScatter(Object.assign({}, cs, { look: { visibility: V } }), toward(cs.eye, [15, 0.6, 0]), sEnd, 0.5, 64));
  const Vs = [5000, 2000, 1000, 500, 300, 200], mono = Vs.every((V, i) => i === 0 || scatAt(V, 20) > scatAt(Vs[i - 1], 20));
  const grid = [400, 300, 200, 160, 120, 100, 80, 60, 40, 20, 10, 5], vals = grid.map((V) => scatAt(V, 20)), peak = vals.indexOf(Math.max(...vals));
  ok('SC density (20 m): scatter rises as V falls from 5000 to 200, peaks at an interior V, and falls for denser fog', mono && peak > 0 && peak < grid.length - 1 && vals[grid.length - 1] < vals[peak],
    'peak at V=' + grid[peak] + ' values=' + vals.map((x) => x.toExponential(2)).join(' '));
  ok('SC density (saturation): beyond the peak, the 120 m and 20 m integrals agree within 2 percent (no light survives the air)', Math.abs(scatAt(10, 120) - scatAt(10, 20)) / scatAt(10, 20) < 0.02,
    'V=10: 20m=' + scatAt(10, 20).toExponential(3) + ' 120m=' + scatAt(10, 120).toExponential(3));
  // 6. high beam gives more scatter than low beam (same ray, the generic high LUT added on the same grid)
  const lowLut = D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), highLut = D.withHigh(lowLut, true);
  const rays = [[0.02, -0.03], [0, -0.02], [0, -0.1], [-0.02, -0.05]].map(([dy, dz]) => { const il = 1 / Math.hypot(1, dy, dz); return [il, dy * il, dz * il]; });
  const bq = Object.assign({}, base, { look: { visibility: 200 } });
  const totLow = rays.reduce((t, d) => t + sum3(D.inScatter(Object.assign({}, bq, { lut: lowLut }), d, 120, 0.5, 16)), 0);
  const totHigh = rays.reduce((t, d) => t + sum3(D.inScatter(Object.assign({}, bq, { lut: highLut }), d, 120, 0.5, 16)), 0);
  ok('SC high beam: more in-scatter than low beam on the same rays', totHigh > totLow && totLow > 0, 'low=' + totLow.toExponential(3) + ' high=' + totHigh.toExponential(3));
  // 7. finite and non-negative over a fan of rays, V, range and step counts
  let bad = 0, n = 0, neg = 0;
  for (let i = -6; i <= 6; i++) for (let j = -4; j <= 4; j++) {
    const il = 1 / Math.hypot(1, i * 0.01, j * 0.01), d = [il, i * 0.01 * il, j * 0.01 * il];
    for (const V of [10, 60, 200, 5000]) for (const sEnd of [0, 1, 20, 120, Infinity]) for (const N of [8, 16]) {
      const c = D.inScatter(Object.assign({}, bq, { look: { visibility: V } }), d, sEnd, 0.3, N); n++;
      if (!c.every(Number.isFinite)) bad++; if (c.some((x) => x < 0)) neg++;
    }
  }
  ok('SC NaN free: every ray, V, range and step count is finite and non-negative', bad === 0 && neg === 0, 'cases=' + n + ' nonfinite=' + bad + ' negative=' + neg);
  // 8. step convergence: averaged over 8 jitter offsets (one offset alone scatters ±35–95 % per pixel at 8 steps, measured), 8 vs 64 within 15 %
  const jits = Array.from({ length: 8 }, (_, k) => (k + 0.5) / 8), avg = (N, d) => jits.reduce((t, j) => t + sum3(D.inScatter(bq, d, 60, j, N)), 0) / jits.length;
  const conv = [[0, -0.1], [0, -0.02], [0.02, -0.03]].map(([dy, dz]) => { const il = 1 / Math.hypot(1, dy, dz), d = [il, dy * il, dz * il]; return Math.abs(avg(8, d) - avg(64, d)) / avg(64, d); });
  ok('SC steps: 8 vs 64 steps within 15 percent (jitter-averaged) on three rays', conv.every((e) => e < 0.15), 'rel=' + conv.map((e) => e.toFixed(3)).join(' '));
  // 9. determinism: jitter is a pure hash of the pixel; a frame with scatter on is identical when rendered twice and differs from off
  const jitOK = [[0, 0], [5, 9], [95, 53]].every(([x, y]) => { const a = D.scatterJitter(x, y); return a === D.scatterJitter(x, y) && a >= 0 && a < 1; });
  const h8a = H(render(RF, base, { visibility: 200, scatter: 8 }).rgb), h8b = H(render(RF, base, { visibility: 200, scatter: 8 }).rgb);
  ok('SC determinism: jitter is pure, and the scatter frame repeats bit for bit and differs from the off frame', jitOK && h8a === h8b && h8a !== PINNED.render_v200, 'jitter=' + jitOK);
  const tileOn = tilesHash(RF, 200, { scatter: 8 });
  ok('SC tile path: the scatter tile frame differs from the off frame and repeats', tileOn !== PINNED.tiles_v200 && tileOn === tilesHash(RF, 200, { scatter: 8 }));
  // 10. phase function: normalised over the sphere; pinned back-lobe and forward values (own-beam geometry is cos near -1)
  let I = 0; const m = 200000; for (let i = 0; i < m; i++) I += D.scatterPhase(-1 + (i + 0.5) * 2 / m) * 2 / m;
  const back = D.scatterPhase(-1), fwd = D.scatterPhase(1);
  ok('SC phase: 2 pi times the integral of p over cos is 1, back lobe (cos -1) near 0.0986 and forward near 1.0595', Math.abs(2 * Math.PI * I - 1) < 1e-5 && Math.abs(back - 0.09862) < 1e-4 && Math.abs(fwd - 1.0595) < 1e-3,
    'norm=' + (2 * Math.PI * I).toFixed(6) + ' back=' + back.toFixed(5) + ' fwd=' + fwd.toFixed(5));
}
module.exports = { run };
if (require.main === module) {
  let fails = 0; run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all scatter checks passed'); process.exitCode = fails ? 1 : 0;
}
