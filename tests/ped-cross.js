// PX: city pedestrians cross occasionally, and traffic logic stops cars for them.
// Uses the app's own functions: RF.DriveAnim.{source, pedCrossing, pedCrossingPose, pedestrianStop, stopFor, advanceTraffic, cameraStep, roadTile, IDM, TILE_LEN, PED}
// and RF.Drive.buildScene (the still scene builder). Positive controls: pedStop:false (cars drive through) and kerbPeople off (the old lane positions).
// Run: node tests/ped-cross.js (exits 1 on failure).
const SEED = 7, LANE = 3.5, EDGE_R = -LANE / 2, EDGE_L = 1.5 * LANE, V = 50 / 3.6, DT = 0.05, MIN_GAP = 2;

function run(RF, ok) {
  const A = RF.DriveAnim, D = RF.Drive;
  const need = ['pedCrossing', 'pedCrossingPose', 'pedestrianStop', 'stopFor', 'advanceTraffic', 'cameraStep', 'roadTile', 'source', 'IDM', 'PED', 'TILE_LEN'];
  if (need.some((f) => A[f] === undefined)) { ok('PX functions are exported', false, 'missing: ' + need.filter((f) => A[f] === undefined).join(', ')); return; }
  const mkSrc = (extra) => A.source('road', LANE, false, {}, Object.assign({ seed: SEED, speed: 50, trafficDensity: 0, trafficLogic: true, tiles: true }, extra || {}));
  const isJunction = (k) => ['intersection', 't-junction'].includes(A.roadTile(SEED, k).kind);

  // 1. Crossers: occasional (seeded, about half the urban tile-cycles), one per tile-cycle, deterministic, continuous, and across the carriageway
  {
    let cycles = 0, withCross = 0, deterministic = true, continuous = true, crossesFully = true, worstStep = 0;
    for (let k = 0; k < 80; k++) {
      if (A.roadTile(SEED, k).kind !== 'urban') continue;
      for (let c = 0; c < 3; c++) {
        cycles++;
        const ev = A.pedCrossing(SEED, k, c);
        if (!ev) continue;
        withCross++;
        if (JSON.stringify(A.pedCrossing(SEED, k, c)) !== JSON.stringify(ev)) deterministic = false;
        if (ev.start < c * A.PED.cycle + 5 || ev.start > c * A.PED.cycle + 30 || ev.end !== (c + 1) * A.PED.cycle) deterministic = false;
        let prev = null;
        for (let t = ev.start; t < ev.end; t += DT) {
          const p = A.pedCrossingPose(LANE, ev, t), q = A.pedCrossingPose(LANE, A.pedCrossing(SEED, k, c), t);
          if (p.off !== q.off || p.gait !== q.gait) deterministic = false;
          if (prev !== null) worstStep = Math.max(worstStep, Math.abs(p.off - prev));
          prev = p.off;
        }
        const a = A.pedCrossingPose(LANE, ev, ev.start).off, b = A.pedCrossingPose(LANE, ev, ev.start + (2 * LANE + 1.4) / A.PED.speed).off;
        if (Math.abs(Math.abs(b - a) - (2 * LANE + 1.4)) > 1e-6) crossesFully = false;
      }
    }
    continuous = worstStep <= A.PED.speed * DT + 1e-9;
    const frac = withCross / cycles;
    ok('PX crossers exist and are occasional (urban tile-cycles with a crossing, 3 cycles of 80 tiles)', withCross >= 1 && frac > 0.2 && frac < 0.8, 'urban tile-cycles ' + cycles + ', with a crossing ' + withCross + ' (' + frac.toFixed(2) + ')');
    ok('PX crossing is a pure function of (seed, tile, cycle, t): recomputed poses identical', deterministic);
    ok('PX walk is continuous (<= 1.4 m/s) and crosses the full carriageway kerb to kerb', continuous && crossesFully, 'worst step ' + worstStep.toExponential(2) + ' m');
  }

  // Find quiet crossings: urban, no junction within 2 tiles behind or 4 ahead, so the test is not disturbed by turns
  const quiet = [];
  for (let k = 0; k < 400 && quiet.length < 2; k++) {
    if (A.roadTile(SEED, k).kind !== 'urban') continue;
    let junction = false;
    for (let j = k - 2; j <= k + 4; j++) if (isJunction(j)) junction = true;
    if (junction) continue;
    for (let c = 0; c < 40; c++) { const ev = A.pedCrossing(SEED, k, c); if (ev) { quiet.push(ev); break; } }
  }

  // Simulate one car (preceding, camera or oncoming) towards one walker; report the gap to the walker while it is in the car's lane.
  const sim = (kind, ev, extra, how) => {
    const back = how && how.back || 300, lead = how && how.lead || 20;
    const src = mkSrc(extra), dir = kind === 'oncoming' ? -1 : 1, laneOff = kind === 'oncoming' ? LANE : 0;
    const x0 = ev.s - dir * back, t0 = ev.start - lead, t1 = ev.end + 15, half = A.IDM.length / 2;
    let state = { cars: [{ id: kind + ':test', kind, x: x0, v: V, a: 0 }] }, cam = { x: x0, v: V, a: 0 };
    let minGap = Infinity, minV = Infinity, gap = Infinity, finalV = 0;
    for (let t = t0; t <= t1; t += DT) {
      let c;
      if (kind === 'camera') { cam = A.cameraStep(src, cam, DT, t); c = cam; }
      else { A.advanceTraffic(src, state, state.cars[0] ? state.cars[0].x : x0, t); c = state.cars[0]; if (!c) break; }
      const front = c.x + dir * half;
      gap = dir * (ev.s - front);
      if (gap > 0 && gap < 120) minV = Math.min(minV, c.v);
      if (t >= ev.start && t < ev.end) {
        const p = A.pedCrossingPose(LANE, ev, t);
        if (p.off + 0.3 > laneOff - LANE / 2 && p.off - 0.3 < laneOff + LANE / 2) minGap = Math.min(minGap, gap);
      }
      if (gap < -10 && t > ev.end) break;
      finalV = c.v;
    }
    return { minGap, minV, passed: gap < 0, finalV };
  };

  // 2b. Full stop: the car is already on approach when the walker starts, so it must stop (speed to ~0) short of the walker
  quiet.slice(0, 1).forEach((ev) => {
    const r = sim('preceding', ev, undefined, { back: 40, lead: 6 });
    ok('PX full stop: preceding car already on approach stops (speed under 0.5 m/s) at >= 2 m, then passes', r.minGap >= MIN_GAP - 1e-6 && r.minV < 0.5 && r.passed && r.finalV > 1,
      'min gap in lane ' + r.minGap.toFixed(3) + ' m, min speed ' + r.minV.toFixed(2) + ' m/s, passed ' + r.passed + ', final ' + r.finalV.toFixed(2) + ' m/s');
  });
  // 2. Stop: no car comes within 2 m of a walker in its lane; the car really slows for it (not vacuous), and gets past once the walker is across
  for (const kind of ['preceding', 'camera', 'oncoming']) {
    quiet.forEach((ev, i) => {
      const r = sim(kind, ev), tag = kind + ' #' + (i + 1);
      ok('PX stop: ' + tag + ' at 50 km/h keeps >= 2 m from an in-lane walker, slows right down for it, then passes', r.minGap >= MIN_GAP - 1e-6 && r.minV < V / 2 && r.passed && r.finalV > 1,
        'min gap in lane ' + r.minGap.toFixed(3) + ' m, min speed on approach ' + r.minV.toFixed(2) + ' m/s (from ' + V.toFixed(2) + '), passed ' + r.passed + ', final ' + r.finalV.toFixed(2) + ' m/s');
      // 3. Positive control: the same run with the pedestrian stop disabled must come within 2 m (proves the check can fail)
      const c = sim(kind, ev, { pedStop: false });
      ok('PX positive control: ' + tag + ' with pedestrian stop off comes within 2 m', c.minGap < MIN_GAP, 'min gap in lane ' + c.minGap.toFixed(3) + ' m, min speed ' + c.minV.toFixed(2) + ' m/s');
    });
  }

  // 4. People off: no walkers, so no stop (the traffic logic still runs)
  if (quiet.length) {
    const ev = quiet[0], src = mkSrc({ pedStop: true }); src.tiles.flags = { people: false };
    const cars = [{ id: 'preceding:t', kind: 'preceding', x: ev.s - 300, v: V, a: 0 }];
    const s = A.pedestrianStop(src, cars[0], ev.start + 1);
    ok('PX people off: pedestrianStop is undefined (no phantom stops)', s === undefined, 'returned ' + s);
  }

  // 5. Static walkers in the animated city scene (tiles on) are off the carriageway. The still scene and the tiles-off scenery keep their positions (D4i pins tiles-off = original), so they are the positive control
  const inLane = (objs) => objs.filter((o) => o.detail && o.detail.kind === 'person' && o.detail.y > EDGE_R - 0.3 && o.detail.y < EDGE_L + 0.3).length;
  const animated = A.source('city', LANE, false, {}, { tiles: true, seed: SEED }).objects, still = D.buildScene('city', { Lw: LANE, A: null, us: false, seed: 7 }, {}).objects;
  const walkers = (objs) => objs.filter((o) => o.detail && o.detail.kind === 'person').length;
  ok('PX animated city: no static walker sits inside a lane', inLane(animated) === 0 && walkers(animated) >= 4, 'walkers ' + walkers(animated) + ', in lane ' + inLane(animated));
  ok('PX still scene: its walkers keep the old lane positions (positive control: they are in lane)', inLane(still) >= 2 && walkers(still) === walkers(animated), 'walkers ' + walkers(still) + ', in lane ' + inLane(still));
}

module.exports = { run };

if (typeof require !== 'undefined' && require.main === module) {
  const { load } = require('./load.js');
  let fails = 0;
  run(load(), (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; });
  console.log(fails ? fails + ' FAILED' : 'all ped-cross checks passed');
  process.exitCode = fails ? 1 : 0;
}
