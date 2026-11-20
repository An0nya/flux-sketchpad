/* solver.js — static and auto-tuning reflector solvers for Flux
 *
 * tile-v1: Tile a 45° mirror surface above the LED with N curved facets,
 *   each aimed at a different painted target cluster. Static — no ray tracing.
 *
 * tile-auto: Same algorithm, but traces candidate designs to pick the
 *   best mirror position and tile count. -auto suffix exempts it from the
 *   "no trace" rule.
 */

// ---- Shared helpers ----

/** Build facets and intent for a given mirror surface and tile grid.
 *  Returns { surfaces, intent, notes }. */
function buildDesign(input, settings, bestSurface, tileX, tileY) {
  const V = RF.V;
  const env = input.envelope;
  const S0 = input.source.pos;
  const keep = Math.max(env.keepOut || 0, settings.minDistance || 0) + 0.5;
  const maxFacets = input.limits.maxFacets;
  const reflectivity = input.limits.reflectivity;
  const paint = input.paint;
  const T = RF.Engine.targetFrame(input.target);
  const paintRes = paint.res;
  const facetHalf = settings.facetSize * 0.5;

  const notes = [];
  const surfaces = [];
  const intent = [];

  // Collect painted cells
  const paintCells = [];
  for (let i = 0; i < paint.cells.length; i++) {
    if (paint.cells[i] > 0) {
      const col = i % paintRes;
      const row = Math.floor(i / paintRes);
      const uv = RF.Engine.cellCenter(T, col, row);
      const world = V.add(T.C, V.add(V.mul(T.tu, uv[0]), V.mul(T.tv, uv[1])));
      paintCells.push({ idx: i, world, weight: paint.cells[i] });
    }
  }
  if (!paintCells.length) {
    notes.push('No painted cells');
    return { surfaces, intent, notes, needs: { bounces: 2 } };
  }

  notes.push('Mirror surface half=' + bestSurface.half.toFixed(0) + 'mm at ' +
            JSON.stringify(bestSurface.P.map(v => v.toFixed(1))));
  notes.push('Tiling ' + tileX + '×' + tileY + ' = ' + (tileX * tileY) +
            ' facets (max ' + maxFacets + ')');

  // Create tile centers on the surface
  const { P: surfP, ex: surfEx, ey: surfEy, half: surfHalf } = bestSurface;
  const tileCenters = [];
  for (let ix = 0; ix < tileX; ix++) {
    for (let iy = 0; iy < tileY; iy++) {
      const u = (ix + 0.5) / tileX * 2 - 1;
      const v = (iy + 0.5) / tileY * 2 - 1;
      const P = V.add(surfP, V.add(V.mul(surfEx, u * surfHalf * 0.9),
                                   V.mul(surfEy, v * surfHalf * 0.9)));
      tileCenters.push(P);
    }
  }

  // Cluster target cells into zones matching tile count
  const nClusters = Math.min(tileCenters.length, paintCells.length);
  let clusters;
  {
    const targetHalf = T.half;
    const gridSize = Math.max(1, Math.ceil(Math.sqrt(nClusters * 1.4)));
    const cellSz = 2 * targetHalf / gridSize;
    const gridMap = {};
    for (const pc of paintCells) {
      const uv = [V.dot(V.sub(pc.world, T.C), T.tu),
                  V.dot(V.sub(pc.world, T.C), T.tv)];
      const gx = Math.min(gridSize - 1, Math.max(0,
        Math.floor((uv[0] + targetHalf) / cellSz)));
      const gy = Math.min(gridSize - 1, Math.max(0,
        Math.floor((uv[1] + targetHalf) / cellSz)));
      const key = gy * gridSize + gx;
      if (!gridMap[key]) gridMap[key] = { sum: [0, 0, 0], weight: 0 };
      gridMap[key].sum = V.add(gridMap[key].sum, V.mul(pc.world, pc.weight));
      gridMap[key].weight += pc.weight;
    }
    clusters = [];
    for (const key of Object.keys(gridMap)) {
      const g = gridMap[key];
      if (g.weight > 0)
        clusters.push({ Z: V.mul(g.sum, 1 / g.weight), weight: g.weight });
    }
    while (clusters.length > nClusters) {
      clusters.sort((a, b) => a.weight - b.weight);
      const s = clusters.shift();
      let bd = Infinity, bi = -1;
      for (let i = 0; i < clusters.length; i++) {
        const d = V.dist(s.Z, clusters[i].Z);
        if (d < bd) { bd = d; bi = i; }
      }
      const c = clusters[bi];
      const tw = c.weight + s.weight;
      c.Z = V.mul(V.add(V.mul(c.Z, c.weight), V.mul(s.Z, s.weight)), 1 / tw);
      c.weight = tw;
    }
    while (clusters.length < nClusters && clusters.length > 0) {
      clusters.sort((a, b) => b.weight - a.weight);
      const c = clusters.shift();
      if (c.weight < 0.02) { clusters.push(c); break; }
      const off = V.mul(V.norm([Math.random() - 0.5, Math.random() - 0.5, 0]),
                       T.half * 0.2);
      clusters.push({ Z: V.add(c.Z, off), weight: c.weight * 0.5 });
      clusters.push({ Z: V.sub(c.Z, off), weight: c.weight * 0.5 });
    }
  }

  // Match each tile to best cluster
  const usedClusters = new Set();
  for (let ti = 0; ti < tileCenters.length && surfaces.length < maxFacets; ti++) {
    const P = tileCenters[ti];
    let bestScore = -Infinity, bestZ = null, bestPts3 = null, bestCi = -1;

    for (let ci = 0; ci < clusters.length; ci++) {
      if (usedClusters.has(ci)) continue;
      const Z = clusters[ci].Z;
      const toLED = V.sub(S0, P);
      const toZ = V.sub(Z, P);
      const n = V.norm(V.add(V.norm(toLED), V.norm(toZ)));

      const [fex, fey] = V.basis(n);
      const pts3 = [
        V.add(P, V.add(V.mul(fex, -facetHalf), V.mul(fey, -facetHalf))),
        V.add(P, V.add(V.mul(fex, facetHalf), V.mul(fey, -facetHalf))),
        V.add(P, V.add(V.mul(fex, facetHalf), V.mul(fey, facetHalf))),
        V.add(P, V.add(V.mul(fex, -facetHalf), V.mul(fey, facetHalf))),
      ];
      let ok = true;
      for (const pt of pts3) {
        if (!RF.Geo.envInside(env, pt, 1e-6) || V.dist(pt, S0) < keep) {
          ok = false; break;
        }
      }
      if (!ok) continue;

      const dLED = V.dist(P, S0);
      const cosInc = -V.dot(V.norm(toLED), n);
      const score = clusters[ci].weight * cosInc / (dLED * dLED);
      if (score > bestScore) {
        bestScore = score;
        bestZ = Z; bestPts3 = pts3; bestCi = ci;
      }
    }

    if (!bestZ) continue;
    usedClusters.add(bestCi);

    const id = 'F' + surfaces.length;
    const facet = {
      type: 'facet', id, P, S0, Z: bestZ,
      clip: { kind: 'poly', pts3: bestPts3 },
      optics: { interaction: 'reflect', reflectivity },
    };
    if (settings.curvature === 'focus') {
      facet.flat = false; facet.di = V.dist(P, bestZ);
    } else if (settings.curvature === 'collimate') {
      facet.flat = false; facet.di = Infinity;
    } else {
      facet.flat = true;
    }
    surfaces.push(facet);
  }

  // Intent
  for (const s of surfaces) {
    const targetHalf = T.half;
    const aimU = V.dot(V.sub(s.Z, T.C), T.tu);
    const aimV = V.dot(V.sub(s.Z, T.C), T.tv);
    const csz = 2 * targetHalf / paintRes;
    const aimCol = Math.round((aimU + targetHalf) / csz - 0.5);
    const aimRow = Math.round((aimV + targetHalf) / csz - 0.5);
    const intentCells = [];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const c2 = aimCol + dc, r2 = aimRow + dr;
        if (c2 < 0 || c2 >= paintRes || r2 < 0 || r2 >= paintRes) continue;
        const idx = r2 * paintRes + c2;
        if (paint.cells[idx] > 0)
          intentCells.push([idx, paint.cells[idx]]);
      }
    }
    if (intentCells.length) intent.push({ facet: s.id, cells: intentCells });
  }

  notes.push(surfaces.length + ' facets placed');
  if (surfaces.length === 0) notes.push('WARNING: no facets placed');

  return { surfaces, intent, notes, needs: { bounces: 2 } };
}


// ---- Shared: find valid mirror surfaces ----

/** Scan mirror positions and return an array of valid surfaces sorted by
 *  static score (larger + farther = better). */
function findMirrors(input, settings) {
  const V = RF.V;
  const env = input.envelope;
  const S0 = input.source.pos;
  const sourceAxis = V.norm(input.source.axis);
  const T = RF.Engine.targetFrame(input.target);
  const throwDir = V.norm(V.mul(T.n, -1));
  const idealNormal = V.norm(V.add(sourceAxis, throwDir));
  const [baseEx, baseEy] = V.basis(idealNormal);
  const safeDist = (Math.max(env.keepOut || 0, settings.minDistance || 0) + 0.5)
                   + settings.facetSize * 0.5 * Math.sqrt(2);

  const surfaces = [];

  for (let half = 20; half >= 8; half -= 2) {
    for (let zOff = 5; zOff <= 50; zOff += 5) {
      for (let xOff = 0; xOff <= 25; xOff += 5) {
        const P = [S0[0] + xOff, S0[1], S0[2] + zOff];
        const pts3 = [
          V.add(P, V.add(V.mul(baseEx, -half), V.mul(baseEy, -half))),
          V.add(P, V.add(V.mul(baseEx, half), V.mul(baseEy, -half))),
          V.add(P, V.add(V.mul(baseEx, half), V.mul(baseEy, half))),
          V.add(P, V.add(V.mul(baseEx, -half), V.mul(baseEy, half))),
        ];
        let ok = true;
        for (const pt of pts3) {
          if (!RF.Geo.envInside(env, pt, 1e-6) || V.dist(pt, S0) < safeDist) {
            ok = false; break;
          }
        }
        if (!ok) continue;
        const d = V.dist(P, S0);
        const score = 4 * half * half * d;
        surfaces.push({ P, ex: baseEx, ey: baseEy, half, d, score });
      }
    }
  }
  surfaces.sort((a, b) => b.score - a.score);
  return surfaces;
}


// =====================================================================
// tile-v1 — static solver (no ray tracing)
// =====================================================================

RF.Solvers.register({
  id: 'bench-dsv4pro-r3--tile-v1',
  name: '45° mirror tiler',
  version: '1.0',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number',
      min: 0, step: 0.5, default: 0 },
    { key: 'curvature', label: 'Facet curvature', type: 'select', options: [
      { value: 'flat', label: 'Flat' },
      { value: 'collimate', label: 'Collimate' },
      { value: 'focus', label: 'Focus on target' },
    ], default: 'focus' },
    { key: 'facetSize', label: 'Facet size (mm)', type: 'range',
      min: 3, max: 30, step: 1, default: 10 },
    { key: 'tileX', label: 'Tiles in X', type: 'range',
      min: 1, max: 20, step: 1, default: 6 },
    { key: 'tileY', label: 'Tiles in Y', type: 'range',
      min: 1, max: 20, step: 1, default: 6 },
  ],

  solve(input, settings) {
    const maxFacets = input.limits.maxFacets;

    // Find best mirror surface by static scoring
    const candidates = findMirrors(input, settings);
    if (!candidates.length) {
      return { surfaces: [], intent: [], notes: ['No valid mirror surface found'],
               needs: { bounces: 2 } };
    }
    const bestSurface = candidates[0];

    // Determine tile count
    const tileX = settings.tileX > 0 ? settings.tileX :
      Math.max(1, Math.min(Math.floor(2 * bestSurface.half / settings.facetSize),
                          Math.ceil(Math.sqrt(maxFacets))));
    const tileY = settings.tileY > 0 ? settings.tileY :
      Math.max(1, Math.min(Math.floor(2 * bestSurface.half / settings.facetSize),
                          Math.ceil(maxFacets / tileX)));

    return buildDesign(input, settings, bestSurface, tileX, tileY);
  },
});


// =====================================================================
// tile-auto — auto-tuning solver (traces candidates, picks best)
// =====================================================================

RF.Solvers.register({
  id: 'bench-dsv4pro-r3--tile-auto',
  name: '45° mirror tiler (auto)',
  version: '1.0',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number',
      min: 0, step: 0.5, default: 0 },
    { key: 'curvature', label: 'Facet curvature', type: 'select', options: [
      { value: 'flat', label: 'Flat' },
      { value: 'collimate', label: 'Collimate' },
      { value: 'focus', label: 'Focus on target' },
    ], default: 'focus' },
    { key: 'facetSize', label: 'Facet size (mm)', type: 'range',
      min: 3, max: 30, step: 1, default: 10 },
    { key: 'tileX', label: 'Tiles in X', type: 'range',
      min: 1, max: 20, step: 1, default: 6 },
    { key: 'tileY', label: 'Tiles in Y', type: 'range',
      min: 1, max: 20, step: 1, default: 6 },
    { key: 'traceRays', label: 'Rays per candidate', type: 'range',
      min: 5000, max: 50000, step: 5000, default: 15000 },
  ],

  solve(input, settings, tools) {
    const maxFacets = input.limits.maxFacets;
    const traceRays = settings.traceRays || 15000;

    // If the user pinned tileX/tileY, skip auto-tuning — just use them
    if (settings.tileX > 0 && settings.tileY > 0 &&
        settings.tileX !== 6 && settings.tileY !== 6) {
      // user override: act like the static solver
      const mirrors = findMirrors(input, settings);
      if (!mirrors.length) {
        return { surfaces: [], intent: [],
                 notes: ['No valid mirror surface found'], needs: { bounces: 2 } };
      }
      return buildDesign(input, settings, mirrors[0], settings.tileX, settings.tileY);
    }

    // Gather valid mirror surfaces
    const mirrors = findMirrors(input, settings);
    if (!mirrors.length) {
      return { surfaces: [], intent: [], notes: ['No valid mirror surface found'],
               needs: { bounces: 2 } };
    }

    // Generate candidate tile configs based on mirror size.
    // Try every mirror × tile combination. No dedup: different mirror
    // positions yield different results even at the same tile count.
    const candidates = [];
    for (const m of mirrors.slice(0, 5)) {
      const maxTiles = Math.floor(2 * m.half / settings.facetSize);
      for (let tx = Math.max(2, maxTiles - 2); tx <= Math.min(maxTiles, 8); tx++) {
        for (let ty = Math.max(2, maxTiles - 2); ty <= Math.min(maxTiles, 8); ty++) {
          if (tx * ty > maxFacets) continue;
          if (tx * ty < 4) continue;
          candidates.push({ m, tx, ty });
        }
      }
    }

    const notes = [];
    notes.push('Auto-tuning: evaluating ' + candidates.length +
              ' candidates at ' + traceRays + ' rays each');

    // Build and trace each candidate
    let bestFidelity = -Infinity;
    let bestDesign = null;
    let bestNotes = '';

    for (const c of candidates) {
      const result = buildDesign(input, settings, c.m, c.tx, c.ty);
      if (!result.surfaces.length) continue;

      try {
        const tr = tools.trace(result.surfaces, {
          rays: traceRays,
          bounces: 2,
        });
        if (tr && tr.fidelity && tr.fidelity.fidelity > bestFidelity) {
          bestFidelity = tr.fidelity.fidelity;
          bestDesign = result;
          bestNotes = 'Auto-picked ' + c.tx + '×' + c.ty +
                     ' on mirror half=' + c.m.half + 'mm d=' + c.m.d.toFixed(0) +
                     'mm → fidelity ' + (bestFidelity * 100).toFixed(1) + '%';
        }
      } catch (e) {
        // Trace can fail — skip candidate.
      }
    }

    if (!bestDesign) {
      // Fallback: use the static solver's top pick
      notes.push('All auto candidates failed; falling back to static pick');
      const bestSurface = mirrors[0];
      const tileX = settings.tileX > 0 ? settings.tileX :
        Math.max(1, Math.min(Math.floor(2 * bestSurface.half / settings.facetSize),
                            Math.ceil(Math.sqrt(maxFacets))));
      const tileY = settings.tileY > 0 ? settings.tileY :
        Math.max(1, Math.min(Math.floor(2 * bestSurface.half / settings.facetSize),
                            Math.ceil(maxFacets / tileX)));
      bestDesign = buildDesign(input, settings, bestSurface, tileX, tileY);
    }

    // Prepend tuning notes to the design's notes
    if (bestNotes) notes.push(bestNotes);
    bestDesign.notes = notes.concat(bestDesign.notes);

    return bestDesign;
  },
});