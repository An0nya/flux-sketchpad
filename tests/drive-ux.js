// UX1: run standalone or from regress-node; no browser or wall-clock timing.
function run(RF, ok) {
  const A = RF.DriveAnim, M = RF.DriveGame, a = A._, J = JSON.stringify;
  const saved = { info: a.V.info, src: a.V.src };
  try {
    for (const speed of [30, 50, 80, 130]) {
      a.V.info = { o: { speed } }; a.V.src = A.source('road', 3.5, true, {}, { trafficLogic: true, preceding: false, oncoming: false, trafficDensity: 0, speed });
      const st = { dist: 0, total: 0, t: 0, camera: null }, target = Math.min(speed, 80);
      a.advanceCamera(st, .05); const initial = st.camera.v * 3.6;
      a.advanceCamera(st, 5); const cruising = st.camera.v * 3.6;
      ok('UX1 free road starts and cruises at min(slider, limit), slider ' + speed, Math.abs(initial - target) < 1e-8 && Math.abs(cruising - target) < 1e-8, J({ initial, cruising, target, distance: st.dist }));
      st.dist += 100; a.advanceCamera(st, .05);
      ok('UX1 seek restarts at target rather than rest, slider ' + speed, Math.abs(st.camera.v * 3.6 - target) < 1e-8, J(st.camera));
    }
    a.V.info = { o: { speed: 130 } }; a.V.src = A.source('road', 3.5, true, {}, { trafficLogic: false, speed: 130 });
    const st = { dist: 0, total: 0, t: 0 }; a.advanceCamera(st, 2);
    ok('UX1 logic OFF keeps uncapped slider arithmetic', Math.abs(st.dist - 130 / 3.6 * 2) < 1e-9 && st.camera === null, J(st));
  } finally { Object.assign(a.V, saved); }
  for (const kind of ['deer', 'person']) for (const side of [-1, 1]) {
    const g = M.create({ seed: 1, speed: 50, verdict: 'pass' }); g.next = Infinity; g.v = 0; g.brake = true;
    const h = { id: 1, born: 0, kind, s0: 30, off0: 0, ds: 0, doff: -side, spd: kind === 'person' ? 1.3 : 3.5, len: 0, side, resolved: false };
    g.hazards.push(h); M.step(g, .05, 3.5); const start = M.pose(g, h, g.t), result = g.results[0];
    ok('UX1 stopped encounter starts visible departure: ' + kind + '/' + side, result && !result.hit && !!h.leaving && Math.abs(M.pose(g, h, g.t + .3).off) > Math.abs(start.off), J({ result, start, leaving: h.leaving }));
    // Force a slow departure to prove the gate, independently of the 2 s minimum.
    h.leaving.spd = .2; g.brake = false; const x = g.x; M.step(g, 3, 3.5);
    ok('UX1 release after 2 s still waits for occupied lane: ' + kind + '/' + side, g.v === 0 && g.x === x && !M.laneClear(g), J({ t: g.t, x: g.x, v: g.v, pose: M.pose(g, h, g.t) }));
    let premature = false;
    for (let i = 0; i < 600 && g.resume !== null; i++) { const clear = M.laneClear(g); M.step(g, .05, 3.5); if (g.v > 0 && !clear && !M.laneClear(g)) premature = true; }
    ok('UX1 resumes only after entire actor clears lane: ' + kind + '/' + side, !premature && g.v > 0 && M.laneClear(g) && g.results.length === 1, J({ t: g.t, v: g.v, pose: M.pose(g, h, g.t), results: g.results.length }));
    const world = { A: null, objects: [] }; A._.gameObjects(g, world, 3.5);
    ok('UX1 departed actor remains rendered off-road: ' + kind + '/' + side, world.objects.length > 0 && Math.abs(M.pose(g, h, g.t).off) > 3.5 / 2, world.objects.length + ' objects');
  }
  for (const opts of [{ clearLane: false }, { rules: 'legacy' }]) {
    const g = M.create({ seed: 1, speed: 50, ...opts }); g.next = Infinity; g.v = 0;
    const h = { id: 1, born: 0, kind: 'deer', s0: 30, off0: 0, ds: 0, doff: 1, spd: 0, len: 0, side: -1 };
    g.hazards.push(h); M.step(g, 2.1, 3.5);
    ok('UX1 prior resume remains reachable ' + J(opts), g.v === 50 / 3.6 && !h.leaving, J({ v: g.v, pose: M.pose(g, h, g.t) }));
  }
  for (const seed of [0, 21]) {
    const g = M.create({ seed, speed: 75, verdict: 'pass' }), h = M.spawn(g, 3.5); g.next = Infinity;
    while (h.s0 - g.x > 50) M.step(g, .05, 3.5);
    g.brake = true;
    while (!g.results.length && g.t < 20) M.step(g, .05, 3.5);
    const stopped = { x: g.x, gap: h.s0 - g.x, t: g.t }; g.brake = false;
    let overlap = false, resumed = null;
    while (g.x < h.s0 + 5 && g.t < 30) {
      M.step(g, .05, 3.5); const ps = M.pose(g, h, g.t);
      if (M.overlap(M.car(g.x), M.box(ps, h.kind))) overlap = true;
      if (g.v > 0 && !resumed) resumed = { t: g.t, off: ps.off, clear: M.laneClear(g) };
    }
    ok('UX1 seeded stop-short encounter drives past departed ' + h.kind + ', seed ' + seed, g.results.length === 1 && !g.results[0].hit && stopped.gap > 0 && resumed && resumed.clear && !overlap && g.x > h.s0 + 5, J({ stopped, resumed, finalX: g.x, hazard: M.pose(g, h, g.t), overlap }));
  }
}
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; }); console.log(fails ? fails + ' FAILED' : 'all drive-ux checks passed'); process.exitCode = fails ? 1 : 0; }
module.exports = { run };
