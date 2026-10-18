// Pure P0 controller, sampled attribution and worker payload checks. No browser.
function run(RF, ok) {
  const D = RF.DriveAnim, step = (s, ms, extra) => D.resolutionStep(s, ms, Object.assign({ enabled: true }, extra));
  let s = D.resolutionState(); const original = JSON.stringify(s);
  for (let i = 0; i < 5; i++) s = step(s, 100);
  ok('P0 no early scale reduction and controller input is immutable', s.scale === 1 && original === JSON.stringify(D.resolutionState()));
  s = step(s, 100); ok('P0 sustained slow frames lower one step', s.scale === 0.85 && s.cooldown === 20);
  for (let i = 0; i < 20; i++) s = step(s, 100);
  ok('P0 cooldown prevents oscillation', s.scale === 0.85);
  for (let i = 0; i < 6; i++) s = step(s, 100);
  ok('P0 second sustained reduction', s.scale === 0.7);
  for (let i = 0; i < 20; i++) s = step(s, 10);
  for (let i = 0; i < 59; i++) s = step(s, 10);
  ok('P0 restoration waits for sustained headroom', s.scale === 0.7);
  s = step(s, 10); ok('P0 restores one step after 60 headroom frames', s.scale === 0.85);
  for (let i = 0; i < 500; i++) s = step(s, 100);
  ok('P0 lower scale bound (ladder extended to 0.3 for min-fps mode)', s.scale === 0.3);
  ok('P0 disabling or pinning resets full scale; invalid timings ignored', step(s, 100, { enabled: false }).scale === 1 && step(s, 100, { pinned: true }).scale === 1 && JSON.stringify(step(s, NaN)) === JSON.stringify(s));
  let calm = D.resolutionState(); for (let i = 0; i < 300; i++) calm = step(calm, i % 2 ? 34 : 32);
  ok('P0 target neighbourhood does not oscillate', calm.scale === 1);
  let target = D.resolutionState(); for (let i = 0; i < 8; i++) target = step(target, 50, { target: 100 });
  ok('P0 custom target honoured', target.scale === 1);
  D.resetStats(); const empty = D.stats();
  ok('P0 stats keeps legacy fields and empty breakdown is finite', empty.fps === 0 && empty.p95Ms === 0 && empty.renderScale === 1 && empty.breakdown.frameMs === 0 && empty.breakdown.gpuMs === null && Object.values(empty.breakdown.components).every((r) => r.ms === 0 && r.pct === 0));
  D._.V.times = [0, 20, 40, 70]; const cadence = D.stats(); D.resetStats();
  ok('P0 fps uses completed-frame median; p95 uses actual intervals', cadence.fps === 50 && cadence.rafMedianMs === 20 && cadence.p95Ms === 30);
  const sample = { frameMs: 100, mainMs: 100, objectMs: 30, groundMs: 40, wetMs: 10, traceCpuMs: 80, trafficMs: 5, placementMs: 3, uploadMs: 2, glMs: 4, composeMs: 1, glareMs: 2, finalVeilMs: 1, detectorMs: 1, cacheHits: 9, cacheMisses: 2, sampledRays: 64 };
  const b = D.breakdown([sample]);
  ok('P0 breakdown units, percentages, cache counts and honest GPU status', b.frameMs === 100 && b.components.groundMs.ms === 40 && b.components.groundMs.pct === 40 && b.components.otherMs.ms === 5 && b.cache.hits === 9 && b.cache.misses === 2 && b.sampledRays === 64 && b.gpuMs === null);
  const mixed = D.breakdown([sample, { ...sample, worker: true, mainMs: 20, workerRoundTripMs: 80 }]);
  ok('P0 mixed worker/main samples retain separate residual accounting', mixed.components.otherMs.ms === 5 && mixed.components.objectMs.scope.includes('worker'));
  const paced = D.breakdown([{ ...sample, frameMs: 120, pacingMs: 20 }]);
  ok('P0 pacing has its own component and frame denominator', paced.components.pacingMs.ms === 20 && Math.abs(paced.components.pacingMs.pct - 100 / 6) < 1e-9 && paced.components.otherMs.ms === 5);
  const p = require('./drive-polish.js').recipe(RF, 'city', { tiles: true, wet: true, wetSheen: true, tileCache: true }, 128), rgba = new Float32Array(4 * p.w * p.h);
  D.objects(p, 95, rgba, 2, null, null, null, 12); const unprofiled = new Float32Array(rgba);
  p.profile = {}; D.objects(p, 95, rgba, 2, null, null, null, 12);
  const r = p.profile;
  ok('P0 profiling leaves every Float32 pixel unchanged', rgba.every((v, i) => v === unprofiled[i]));
  ok('P0 sampled trace partitions measured render; raw samples and cache hits exist', r.traceMs > 0 && r.groundMs >= 0 && r.wetMs >= 0 && r.objectMs >= 0 && Math.abs(r.traceMs - r.objectMs - r.groundMs - r.wetMs) < 1e-8 && r.sampledRays > 0 && r.sampledRays < r.rays && r.cacheHits > 0, JSON.stringify(r));
  const worker = D.tracer(); worker.cfg({ id: 1, p, src: ['city', 3.5, false, {}, { tiles: true, wet: true, wetSheen: true, tileCache: true, seed: 7 }] });
  const job = worker.job({ seq: 1, dist: 95, t: 12, ss: 2, act: [], c: 0, K: 1, profile: true });
  ok('P0 worker transports measured trace profile without scene changes', job.profile.traceMs > 0 && job.ms >= job.profile.traceMs && job.profile.sampledRays > 0 && new Float32Array(job.buf).some((v) => v > 0));
  // Exercise actual sizing, not only the controller. No DOM is needed for clientWidth/clientHeight.
  const V = D._.V, saved = { canvas: V.canvas, info: V.info, resolution: V.resolution, pinSS: V.pinSS };
  try {
    V.canvas = { parentElement: { clientWidth: 1600, clientHeight: 900 } }; V.info = { o: { scene: 'city', wet: true, wetSheen: true, dynamicResolution: false } }; V.resolution = { scale: 0.4 }; V.pinSS = 0;
    const full = D._.size(); V.info.o.dynamicResolution = true; const small = D._.size(); V.pinSS = 2; const pin = D._.size();
    ok('P0 actual render scale lowers the ceiling-limited width (default High 1600, wet no longer capped at 640); pinSS restores full dimensions', full.W === 1600 && small.W === 640 && pin.W === 1600 && small.cssW === full.cssW && small.dpr === full.dpr, JSON.stringify({ full, small, pin }));
  } finally { Object.assign(V, saved); }
}
module.exports = { run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; }); console.log(fails ? fails + ' FAILED' : 'all P0 Node checks passed'); process.exitCode = fails ? 1 : 0; }
