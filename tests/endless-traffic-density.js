// Endless road: the biome density gate in trafficCars reads the tile the car stands on (not the car's slot index k).
// Executed: over a long drive, cars per tile in sparse biomes (mountain 0.4, forest 0.6) must be well below open/city (>= 1).
const { load } = require('./load.js');
const RF = load(), A = RF.DriveAnim;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const src = A.source('road', 3.5, false, {}, { seed: 11, speed: 80, trafficDensity: 3, oncoming: true, preceding: true, tiles: true, endlessRoad: true });
const L = A.TILE_LEN, tilesBy = {}, carsBy = {};
const biome = (k) => A.endlessTile(src.tiles.seed, k, src.tiles.preset, src.tiles.custom).biome;
for (let k = 0; k < 4000; k++) { const b = biome(k); tilesBy[b] = (tilesBy[b] || 0) + 1; }
const seen = new Set();
for (let dist = 0; dist < 4000 * L - 400; dist += 150) for (const c of A.trafficCars(src, dist, 0)) {
  if (seen.has(c.id)) continue; seen.add(c.id);
  const b = biome(Math.floor((dist + c.rel) / L)); carsBy[b] = (carsBy[b] || 0) + 1;
}
const rate = (b) => (carsBy[b] || 0) / (tilesBy[b] || 1), dense = ['open', 'city'].filter((b) => tilesBy[b] > 50), sparse = ['mountain', 'forest'].filter((b) => tilesBy[b] > 50);
const denseRate = Math.min(...dense.map(rate)), sparseRate = Math.max(...sparse.map(rate));
ok('test setup: both dense and sparse biomes occur', dense.length && sparse.length, tilesBy);
ok('cars per tile: sparse biomes (<= 0.6 density) carry clearly fewer cars than open/city', sparseRate < 0.8 * denseRate, { tilesBy, carsBy, denseRate, sparseRate });
console.log(`\n${pass + fail} checks, ${fail} failed`); process.exit(fail ? 1 : 0);
