// CPU trace cost only (not fps): node tests/bench/DP-ground-cpu.js [frames=20] [--full]
// process.cpuUsage measures CPU consumed by this process, separately from elapsed time. --full adds forest/city.
const RF = require('../load.js').load(), { recipe } = require('../drive-polish.js'), A = RF.DriveAnim;
const frames = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 20), median = (a) => a.slice().sort((a, b) => a - b)[Math.floor(a.length / 2)];
for (const scene of process.argv.includes('--full') ? ['road', 'forest', 'city'] : ['road']) for (const kind of ['150R', 'intersection', 'urban']) for (const ss of [1, 2]) {
  const tile = Array.from({ length: 160 }, (_, k) => A.roadTile(7, k)).find((q) => q.kind === kind), p = recipe(RF, scene, { tileCache: true, streetLamps: 'off' }, 640), cache = p.src.tiles.groundCache, out = new Float32Array(p.w * p.h * 4), measurements = [];
  for (const cached of [false, true, true, false]) {
    p.src.tiles.groundCache = cached ? cache : null;
    const times = [];
    for (let i = -8; i < frames; i++) {
      const start = process.cpuUsage(); A.tileFrame(p, tile.s0 + 60 + Math.max(0, i) * 0.5, Math.max(0, i) * 0.036, out, ss);
      const elapsed = process.cpuUsage(start); if (i >= 0) times.push((elapsed.user + elapsed.system) / 1000);
    }
    measurements.push({ cached, medianCpuMs: median(times), meanCpuMs: times.reduce((a, b) => a + b, 0) / frames });
  }
  const uncached = (measurements[0].medianCpuMs + measurements[3].medianCpuMs) / 2, cached = (measurements[1].medianCpuMs + measurements[2].medianCpuMs) / 2;
  console.log(JSON.stringify({ scene, kind, ss, sim: [p.w, p.h], frames, method: 'process.cpuUsage user+system', uncachedCpuMs: uncached, cachedCpuMs: cached, speedup: uncached / cached, cacheHits: cache.hits, cacheMisses: cache.misses, cacheStorageBytes: cache.bytes, measurements }));
}
