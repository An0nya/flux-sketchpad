// AF: auto high beam fixes + static-curve AFS hook. Node tests/ahb-fix.js, exits 1 on any failure.
// Real functions only: RF.DriveAnim.source / roadTile / autoUrban / autoUrbanInput / autoSpeedKmh / curvatureAt.
// POSITIVE CONTROL: drop the mountain guard in autoUrbanInput (or the arc branch in curvatureAt) and the matching
// check below must FAIL. The trap check (raw autoUrban is true somewhere on the pass) shows the guard is not vacuous.
const { load } = require('./load.js'); const RF = load(); const A = RF.DriveAnim, V = A._.V;
let fails = 0, n = 0; const ok = (name, cond, detail) => { n++; console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
const TL = A.TILE_LEN, SEED = 7;
const kind = (k) => A.roadTile(SEED, k).kind;
const isJ = (k) => ['intersection', 't-junction'].includes(kind(k));

// 1. urban rule on the default road: current tile only, urban kind only
{
  let kS = -1, kU = -1, kJ = -1;
  for (let k = 1; k < 200; k++) {
    if (kS < 0 && kind(k) !== 'urban' && !isJ(k) && kind(k + 1) === 'urban') kS = k;   // straight-ish tile, urban next
    if (kU < 0 && kind(k) === 'urban') kU = k;
    if (kJ < 0 && isJ(k) && kind(k - 1) !== 'urban' && kind(k + 1) !== 'urban') kJ = k;  // junction with no urban neighbour
    if (kS > 0 && kU > 0 && kJ > 0) break;
  }
  ok('found probe tiles on seed 7 (straight-before-urban, urban, isolated junction)', kS > 0 && kU > 0 && kJ > 0, { kS, kU, kJ });
  ok('autoUrban false on the tile before an urban tile (old rule read k+1 and said true)', !A.autoUrban(SEED, kS * TL + 1), kS);
  ok('autoUrban true on an urban tile', A.autoUrban(SEED, kU * TL + 1), kU);
  ok('autoUrban false on a junction tile (junction no longer counts as urban)', !A.autoUrban(SEED, kJ * TL + 1), kJ);
  ok('autoUrbanInput (default road, no pass) true on an urban tile', A.autoUrbanInput(A.source('road', 3.5, false, {}, { tiles: true, seed: SEED }), kU * TL + 1), kU);
}

// 2. mountain pass: the pass tile sequence never yields urban
{
  const pass = A.source('road', 3.5, false, {}, { mountainPass: true });
  ok('pass source has tiles.mountain set', !!(pass.tiles && pass.tiles.mountain), pass.tiles && pass.tiles.mountain);
  let trap = 0, flagged = 0, guardedTrue = 0;
  for (let d = 0; d < 40 * TL; d += 7) {
    if (A.autoUrban(pass.tiles.seed, d)) trap++;          // what the old call read: default road kinds with the pass seed
    if (A.autoUrbanInput(pass, d)) guardedTrue++;
    flagged++;
  }
  ok('trap present: raw autoUrban on the pass seed IS true somewhere (guard is not vacuous)', trap > 0, { trap, flagged });
  ok('pass: autoUrbanInput never true over 40 tiles', guardedTrue === 0, { guardedTrue, flagged });
  let passUrban = 0; for (let k = 0; k < 40; k++) if (RF.Touge.tile(0, k).kind === 'urban') passUrban++;
  ok('pass: RF.Touge.tile has no urban kind over 40 tiles', passUrban === 0, passUrban);
}

// 3. speed input: camera speed when the camera runs, slider fallback
{
  ok('speed: camera 20 m/s -> 72 km/h (not the slider)', A.autoSpeedKmh({ camera: { v: 20 } }, 80) === 72, A.autoSpeedKmh({ camera: { v: 20 } }, 80));
  ok('speed: camera stopped (v 0) -> 0 km/h', A.autoSpeedKmh({ camera: { v: 0 } }, 80) === 0);
  ok('speed: no camera -> slider', A.autoSpeedKmh({ camera: null }, 30) === 30);
  ok('speed: no camera, no slider -> 50 fallback (unchanged)', A.autoSpeedKmh({ camera: null }, undefined) === 50);
}

// 4. static-curve AFS hook: curvatureAt reads the shape arc (V.info.A) when tiles are off
{
  const prev = V.info, off = A.source('road', 3.5, false, {}, {});
  const probe = [0, 300, 1000];
  V.info = null;
  ok('straight: no info -> curvature 0', probe.every((x) => A.curvatureAt(off, x) === 0));
  V.info = { A: null };
  ok('straight: arc null (no shape selected) -> curvature 0', probe.every((x) => A.curvatureAt(off, x) === 0));
  V.info = { A: RF.Road.arc(200, 'left') };
  ok('shape left R200, tiles off -> +1/200 at every x', probe.every((x) => Math.abs(A.curvatureAt(off, x) - 1 / 200) < 1e-12), probe.map((x) => A.curvatureAt(off, x)));
  V.info = { A: RF.Road.arc(200, 'right') };
  ok('shape right R200, tiles off -> -1/200', probe.every((x) => Math.abs(A.curvatureAt(off, x) + 1 / 200) < 1e-12));
  V.info = { A: RF.Road.arc(200, 'left') };
  const c = 1 / 200;
  ok('offset form c/(1-off*c) matches the tile branch', Math.abs(A.curvatureAt(off, 0, 1) - c / (1 - c)) < 1e-12, A.curvatureAt(off, 0, 1));
  // sign and magnitude against a same-radius tile curve (the tile branch is the reference)
  const tiled = A.source('road', 3.5, false, {}, { tiles: true, seed: SEED });
  let kc = -1; for (let k = 0; k < 200; k++) if (A.roadTile(SEED, k).curvature) { kc = k; break; }
  const tile = A.roadTile(SEED, kc), x = tile.s0 + 100, tc = A.curvatureAt(tiled, x);
  ok('reference: tile curve found and non-zero', kc >= 0 && Math.abs(tc) > 0, { kc, tc });
  V.info = { A: RF.Road.arc(Math.abs(1 / tc), tc > 0 ? 'left' : 'right') };
  ok('same-radius arc matches tile curvature sign and magnitude', Math.abs(A.curvatureAt(off, x) - tc) < 1e-12, { tile: tc, arc: A.curvatureAt(off, x) });
  V.info = prev;
}

console.log(fails ? fails + ' of ' + n + ' FAILED' : 'all ' + n + ' AF checks passed');
process.exitCode = fails ? 1 : 0;
