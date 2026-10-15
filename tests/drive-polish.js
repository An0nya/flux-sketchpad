// DP CPU renderer checks, shared by regress-node and the CPU cost bench.
function recipe(RF, scene = 'road', opts = {}, w = 160) {
  const D = RF.Drive, A = RF.DriveAnim, src = A.source(scene, 3.5, false, {}, Object.assign({ tiles: true, wild: true, seed: 7, oncoming: true, preceding: true, trafficDensity: 2 }, opts));
  return { w, h: Math.round(w * 9 / 16), hfov: 60, lamps: [[0, -0.7, 0.65], [0, 0.7, 0.65]], lut: D.lutFrom((h, v) => D.Headlamp.generic(h, v, false)), conv: 'A', lane: 3.5, look: { wet: !!opts.wet, wetSheen: !!opts.wetSheen, RL: 0.2, ambient: 0.05 }, src };
}
function run(RF, ok) {
  const A = RF.DriveAnim, p = recipe(RF, 'road', { tileCache: true }), cache = p.src.tiles.groundCache;
  const compare = (dist, t, ss = 2) => {
    const world = A.tileWorld(p, dist, t), on = new Float32Array(p.w * p.h * 4), off = new Float32Array(on.length);
    p.src.tiles.groundCache = cache; A.tileFrame(p, dist, t, on, ss, null, null, world);
    p.src.tiles.groundCache = null; A.tileFrame(p, dist, t, off, ss); p.src.tiles.groundCache = cache;
    let worst = 0, changed = 0;
    for (let q = 0; q < on.length; q++) { if (on[q] !== off[q]) changed++; worst = Math.max(worst, Math.abs(on[q] - off[q]) / Math.max(1e-8, Math.abs(off[q]))); }
    return { worst, changed };
  };
  let worst = 0, changed = 0, n = 0;
  for (const kind of A.TILE_KINDS) {
    const tile = Array.from({ length: 160 }, (_, k) => A.roadTile(7, k)).find((q) => q.kind === kind);
    for (const u of [49.9, 50.1, 99, 150.1, 199.9, 200.1]) for (const ss of [1, 2]) {
      const r = compare(tile.s0 + u, 25, ss); worst = Math.max(worst, r.worst); changed += r.changed; n++;
    }
  }
  ok('DP cached ground matches uncached across every tile kind, joins, grain, lights and moving traffic', worst < 2e-7, JSON.stringify({ frames: n, worstRelative: worst, changedFloat32Values: changed, hits: cache.hits, misses: cache.misses }));
  const builds = cache.builds;
  p.look.wet = p.look.wetSheen = true; const wet = compare(97, 12);
  p.look.RL = 0.65; const paint = compare(110, 13);
  p.lut = RF.Drive.lutFrom(() => 35000); const beam = compare(155, 14);
  p.hfov = 75; const fov = compare(201, 15);
  p.lamps = [[0.2, -0.8, 0.8]]; const lamps = compare(202, 16);
  p.w = 128; p.h = 72; const size = compare(203, 17);
  ok('DP wet sheen, paint reflectance, new beam, FOV, lamp geometry and resize invalidate cache', cache.builds === builds + 6 && [wet, paint, beam, fov, lamps, size].every((r) => r.worst < 2e-7), JSON.stringify({ builds: cache.builds, wet, paint, beam, fov, lamps, size }));
  const before = cache.misses; compare(203, 17); compare(203, 17);
  ok('DP repeated frame reuses samples without new shading', cache.misses === before && cache.hits > 0);
  cache.bands = []; cache.bytes = 24 * 1024 * 1024; const capped = compare(204, 18);
  ok('DP full cache falls back to uncached shading without exceeding its 24 MiB storage cap', cache.bytes === 24 * 1024 * 1024 && capped.worst < 2e-7, JSON.stringify(capped));
  ok('DP ground cache is opt-in; original route has no cache', recipe(RF).src.tiles.groundCache === null);
  let routeError = 0;
  for (const seed of [0, 7, 19, 123, 99999]) for (const dist of [0, 49.9, 50, 100, 150, 199.99, 200, 399.99, 600, 1723, -50]) {
    const fast = A.tileRoute(seed, dist, true), original = A.tileRoute(seed, dist);
    for (let x = -20; x <= 600; x += 13) for (let y = -100; y <= 100; y += 11) {
      const a = fast.frame(x, y), b = original.frame(x, y); routeError = Math.max(routeError, Math.abs(a.s - b.s), Math.abs(a.off - b.off));
    }
  }
  ok('DP route bounds preserve nearest segment on a wide ground grid, joins and negative distances', routeError === 0, 'worst metres ' + routeError);
  // The actual worker tracer receives only serializable source options, not the page cache.
  const q = recipe(RF, 'road', { tileCache: true }, 128), src = ['road', 3.5, false, {}, { tiles: true, tileCache: true, wild: true, seed: 7, oncoming: true, preceding: true, trafficDensity: 2 }];
  const worker = A.tracer(); worker.cfg({ id: 1, p: q, src });
  const out = new Float32Array(q.w * q.h * 4), direct = new Float32Array(out.length);
  for (let seq = 1; seq <= 2; seq++) {
    const dist = 95 + seq, t = seq;
    A.tileFrame(q, dist, t, direct, 2);
    for (let c = 0; c < 3; c++) {
      const r = worker.job({ seq, dist, t, ss: 2, act: [], c, K: 3 }), a = new Float32Array(r.buf); let off = 0;
      for (const ty of r.trows) { const n = (Math.min(q.h, (ty + 1) * 16) - ty * 16) * q.w * 4; out.set(a.subarray(off, off + n), ty * 16 * q.w * 4); off += n; }
    }
  }
  ok('DP cached worker row jobs equal the cached main-thread frame', out.every((v, i) => v === direct[i]));
}
module.exports = { recipe, run };
if (require.main === module) { let fails = 0; run(require('./load.js').load(), (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); if (!cond) fails++; }); process.exitCode = fails ? 1 : 0; }
