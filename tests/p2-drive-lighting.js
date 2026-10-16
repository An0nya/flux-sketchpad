// P2: independent photometric/geometry checks; no browser or optical solver required.
function run(RF, ok) {
  const D = RF.Drive, A = RF.DriveAnim, near = (a, b, e = 1e-8) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
  const lamp = (x, id, nx = -1) => ({ k: 'disc', x, y: 0, z: 0.68, r: 0.08, nx, ny: 0, nz: 0, mat: 'lamp-head', headlamp: true, traffic: id, emit: [1, 1, 1] });
  const lamps = Array.from({ length: 20 }, (_, i) => [lamp(20 + i * 10, i), { ...lamp(20 + i * 10, i), y: 1.24 }]).flat();
  const sources = D.trafficSources(lamps);
  ok('P2 nearest eight whole cars, two lamps each, 150 m limit', sources.length === 16 && sources.every(q => q.car < 8) && D.trafficSources([lamp(151, 'far')], [0, 0, 1]).length === 0);
  const body = { k: 'box', x: 30, y: 0, hx: 2.2, hy: 0.9, yaw: Math.PI / 4, z0: 0.25, z1: 0.85, traffic: 'pre' }, c = Math.SQRT1_2;
  const tail = { ...lamp(30 - c * 2.21, 'pre'), y: -c * 2.21, headlamp: false, taillamp: true, nx: -c, ny: -c };
  const preceding = D.trafficSources([body, tail])[0];
  ok('P2 preceding light follows rotated body front and faces forward', near(preceding.nx, c) && near(preceding.ny, c) && near(preceding.x * c + preceding.y * c, 30 * c + 2.21));
  const lut = D.lutFrom(() => 20000), beam = { lut, conv: 'A' }, source = { x: 0, y: 0, z: 0.68, nx: 1, ny: 0 };
  ok('P2 traffic direction uses local forward/left and rejects behind', near(D.trafficAt(source, beam, 20, 0, 0), 20000) && D.trafficAt(source, beam, -20, 0, 0) === 0);
  ok('P2 symmetric uses actual design and convention; generic uses D5 low beam asset', D.trafficBeam({ lut, conv: 'B', src: { traffic: { onMode: 'symmetric' } } }).lut === lut && D.trafficBeam({ lut, conv: 'B', src: { traffic: { onMode: 'symmetric' } } }).conv === 'B' && near(D.lutAt(D.trafficBeam({}).lut, 3.125, -1.125), D.Headlamp.generic(3.125, -1.125, false), 1e-6));
  const p = { w: 160, h: 90, hfov: 60, eye: [-2, 0, 1.2], lamps: [], lut, conv: 'A', lane: 3.5, look: { ambient: 0 }, src: { traffic: { onMode: 'generic' } }, scene: { objects: [lamp(30, 1)], markings: [], verge: ['grass', 1.5, 'grass'] }, ss: 1 };
  const off = D.render(p), on = D.render({ ...p, trafficBeams: true }); let groundGain = 0;
  for (let i = 0; i < p.w * p.h; i++) if (on.keys[on.mat[i]] === 'asphalt') groundGain += on.rgb[i * 3] - off.rgb[i * 3];
  ok('P2 traffic adds ground luminance with no own light or ambient', groundGain > 0, { groundGain });
  const board = { k: 'box', x: 20, y: 0, hx: 0.02, hy: 0.5, z0: 0.7, z1: 1.7, mat: 'cloth-dark', emit: [100, 100, 100] };
  const returned = D.surfaceSources([board], p)[0];
  ok('P2 a 1 m² face returning 100 cd/m² produces 100 cd, with RGB retained', near(returned.area, 1) && near(returned.cd, 100) && near(returned.rgb[1], 1) && near(returned.returnedLuminance, 100));
  const signs = D.kit({ Lw: 3.5, A: null, us: false, rand: () => 0.5 }); signs.sign(30, -3, 'white');
  const lit = D.surfaceSources(signs.O, { ...p, lamps: [[0, -0.7, 0.65]] });
  ok('P2 real procedural sign returns computed positive luminance, dark beam returns none', lit.length > 0 && lit[0].returnedLuminance > 0 && D.surfaceSources(signs.O, { ...p, lamps: [[0, -0.7, 0.65]], lut: D.lutFrom(() => 0) }).length === 0);
  ok('P2 lit-surface sources bounded at eight and default reflection API unchanged', D.surfaceSources(Array.from({ length: 20 }, (_, i) => ({ ...board, x: 10 + i })), p).length === 8 && D.reflectionSources(signs.O).length === 0);
  const zero = A.pitchStep(null, 0, 10), brake = A.pitchStep(null, -4, 2), accel = A.pitchStep(null, 2, 2), relax = A.pitchStep(brake, 0, 2);
  ok('P2 braking dips, acceleration lifts, suspension settles to documented tuning', zero.angle === 0 && near(brake.angle, -0.48 * Math.PI / 180) && near(accel.angle, 0.24 * Math.PI / 180) && Math.abs(relax.angle) < 1e-7);
  let steps = null; for (let i = 0; i < 100; i++) steps = A.pitchStep(steps, -4, 0.01);
  ok('P2 suspension solution independent of frame subdivision', near(steps.angle, A.pitchStep(null, -4, 1).angle, 1e-12));
  const narrow = D.lutFrom((h, v) => Math.max(0, 1000 + v * 100), { step: 0.1 });
  for (const conv of ['A', 'B', 'S']) ok('P2 positive pitch samples lower lamp-local vertical angle in ' + conv, D.beamAt(narrow, conv, 30, 0, 0, 0.01) < D.beamAt(narrow, conv, 30, 0, 0, 0));
  const eyeBeam = { ...p, lamps: [[0, 0, 0.65]], lut: D.trafficBeam({}).lut }, car = { rel: 30, off: 0 };
  ok('P2 pitch also shifts the Drive oncoming-eye/flash illuminance lookup', A.eyeLux({ ...eyeBeam, pitch: -0.01 }, car) < A.eyeLux(eyeBeam, car));
  const V = A._.V, saved = { ...V };
  try {
    const src = A.source('city', 3.5, false, {}, { tiles: true, trafficLogic: true, speed: 130, oncoming: false, preceding: false, seed: 7 });
    Object.assign(V, { src, info: { o: { speed: 130, lampPitch: true } }, p: { lane: 3.5 } });
    const st = { dist: 100, t: 8, total: 0, camera: null }; A._.advanceCamera(st, 0.1);
    ok('P2 initial traffic camera at road speed limit does not invent braking acceleration', Math.abs(st.acceleration) < 5, { acceleration: st.acceleration });
  } finally { for (const k of Object.keys(V)) if (!(k in saved)) delete V[k]; Object.assign(V, saved); }
  const unchanged = D.render({ ...p, trafficBeams: false, surfaceSheen: false, pitch: 0 });
  ok('P2 explicit settings off identical to omitted options on CPU', off.rgb.every((v, i) => v === unchanged.rgb[i]));
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (n, c, detail) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (detail ? ' ' + JSON.stringify(detail) : '')); if (!c) fails++; }); console.log(fails ? fails + ' FAILED' : 'all P2 Node checks passed'); process.exitCode = fails ? 1 : 0; }
