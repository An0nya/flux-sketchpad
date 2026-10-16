// GC: the minigame car slows for bends on tiled roads and holds the slider speed everywhere else.
// Run: node tests/game-curves.js   (exit 1 on any failure). Needs git on PATH for the no-tiles identity check against main.
const path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const KMH = 3.6, MOUNTAIN_TOL = 1.05, CITY_TOL = 1.05;

// Drive the game car with hazards optionally disabled (limit 0 = nothing spawns). Returns per-step [x, v] and final state.
function drive(RF, { src, speed = 80, wet = true, seed = 7, dist = 3000, hazards = false, lane = 3.5, touge = false, G = RF.DriveGame }) {
  const g = G.create({ speed, wet, seed, acceleration: 'original' });
  if (!hazards) g.limit = 0;
  const p = { src, lane, touge, deerBehaviour: false, lamps: [] };  // no lamps: hazard spawn only needs eyeLux to return a number
  const trace = [];
  for (let guard = 0; guard < 2e6 && g.x < dist && !g.done; guard++) { G.step(g, G.STEP, lane, p); trace.push([g.x, g.v]); }
  return { trace, g };
}
// Curvature tiles and their metric limit, from the same accessor drive-anim.js uses (Touge tiles are 200 m).
const mountainLimit = (RF, k) => { const c = Math.abs(RF.Touge.tile(0, k).curvature); return c > 1e-6 ? Math.sqrt(3 / c) : Infinity; };

// Mountain pass: every curved tile must be taken at or below sqrt(3 R) (+5 %), and straight runs after bends must regain 75 km/h.
function checkMountain(RF, trace, dist) {
  const maxIn = new Map();
  for (const [x, v] of trace) { const k = Math.floor(x / 200); maxIn.set(k, Math.max(maxIn.get(k) ?? 0, v)); }
  let worst = -Infinity, worstK = null, curved = 0, violations = 0;
  for (const [k, vmax] of maxIn) {
    const lim = mountainLimit(RF, k); if (!isFinite(lim)) continue;
    curved++; if (vmax > lim * MOUNTAIN_TOL) violations++;
    if (vmax / lim - 1 > worst) { worst = vmax / lim - 1; worstK = k; }
  }
  // Straight runs of >=3 tiles that start after a bend and end inside the run: max speed there must reach 75 km/h.
  let regainOk = true, runs = 0, run = [], sawCurve = false;
  const flush = () => { if (sawCurve && run.length >= 3 && run[run.length - 1] < Math.floor(dist / 200)) { runs++; if (Math.max(...run.map((k) => maxIn.get(k) ?? 0)) < 75 / KMH) regainOk = false; } run = []; };
  for (let k = 0; k < Math.floor(dist / 200); k++) {
    if (isFinite(mountainLimit(RF, k))) { flush(); sawCurve = true; } else run.push(k);
  }
  flush();
  return { curved, violations, worstOverKmh: worst === -Infinity ? 0 : worst * 100, worstK, regainOk, runs };
}

function run(RF, ok) {
  const A = RF.DriveAnim, G = RF.DriveGame;
  const pass = A.source('road', 3.5, false, {}, { mountainPass: true });
  const DIST = 3000;

  // (1) Mountain pass, slider 80 km/h, wet.
  const m = drive(RF, { src: pass, dist: DIST, touge: true });
  const r1 = checkMountain(RF, m.trace, DIST);
  console.log(`  mountain: ${r1.curved} curved tiles, violations ${r1.violations}, worst overspeed ${r1.worstOverKmh.toFixed(2)} % at tile ${r1.worstK}, straight runs ${r1.runs}`);
  ok('GC mountain pass: every hairpin/bend at or below sqrt(3R) x1.05 over 3 km', r1.curved > 0 && r1.violations === 0);
  ok('GC mountain pass: speed returns to >= 75 km/h on long straights', r1.runs > 0 && r1.regainOk);

  // (2) Tiled city/rural road: curve tiles at or below 60 km/h (+5 %). The run starts at x=0 with the car already at speed,
  // so tile 0 is excluded (no run-up before it).
  let curveMax = 0, curveTiles = 0, tileBad = 0;
  for (const seed of [1, 2, 3]) {
    const tiled = A.source('road', 3.5, false, {}, { tiles: true, seed });
    const { trace } = drive(RF, { src: tiled, speed: 80, dist: DIST, seed });
    for (const [x, v] of trace) {
      if (x < 200) continue;
      const tile = A.roadTile(tiled.tiles.seed, Math.floor(x / 200));
      if (!tile.curvature || tile.kind === 'urban') continue;
      curveMax = Math.max(curveMax, v * KMH); curveTiles++; if (v * KMH > 60 * CITY_TOL) tileBad++;
    }
  }
  console.log(`  tiled: ${curveTiles} samples on curve tiles, max ${curveMax.toFixed(2)} km/h`);
  ok('GC tiles: speed on curve tiles <= 60 km/h +5 %', curveTiles > 0 && tileBad === 0);

  // (3) No tiles: byte-identical trace to main (hazards on, slider above 80 so any silent clamp would show).
  let mainSrc = null;
  try { mainSrc = execFileSync('git', ['show', 'main:js/drive-game.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }); } catch (e) { mainSrc = null; }
  if (mainSrc === null) { ok('GC no tiles: identical to main (git show main unavailable, SKIPPED)', false); }
  else {
    const copy = Object.assign({}, RF); const sandbox = { RF: copy };
    vm.runInNewContext(mainSrc, sandbox, { filename: 'main:drive-game.js' });
    const OLD = sandbox.RF.DriveGame, flat = A.source('road', 3.5, false, {}, {});
    let identical = true;
    for (const speed of [50, 80, 130]) for (const seed of [11, 12]) {
      const a = drive(RF, { src: flat, speed, seed, hazards: true, dist: 1500, G }), b = drive(RF, { src: flat, speed, seed, hazards: true, dist: 1500, G: OLD });
      const same = a.trace.length === b.trace.length && a.trace.every((s, i) => s[0] === b.trace[i][0] && s[1] === b.trace[i][1]) && JSON.stringify(a.g.results) === JSON.stringify(b.g.results);
      identical &&= same;
    }
    ok('GC no tiles: speed trace and hazard results identical to main (speeds 50/80/130)', identical);
  }

  // (4) POSITIVE CONTROL: old behaviour (cap disabled, car holds slider speed) must fail check (1).
  const realApproach = A.approachSpeed;
  A.approachSpeed = () => Infinity;
  try {
    const c = drive(RF, { src: pass, dist: DIST, touge: true });
    const r4 = checkMountain(RF, c.trace, DIST);
    console.log(`  positive control (cap off): worst overspeed ${r4.worstOverKmh.toFixed(2)} % at tile ${r4.worstK}, violations ${r4.violations}`);
    ok('GC positive control: fixed slider target fails the mountain apex bound', r4.violations > 0);
  } finally { A.approachSpeed = realApproach; }
}

module.exports = { run };
if (require.main === module) {
  const { load } = require('./load.js'); const RF = load();
  let fail = 0;
  run(RF, (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fail++; });
  console.log(fail ? fail + ' FAILED' : 'all GC checks passed'); process.exitCode = fail ? 1 : 0;
}
