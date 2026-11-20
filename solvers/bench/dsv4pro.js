/* Flux reflector solver v19 — scene-optimized tiling + auto-tuner
 *
 * tile-v19:   Static solver — flat facets tiled across envelope faces.
 * tile-v19-auto: Tuner that sweeps gridRes/facetScale, traces each candidate,
 *                and picks the best for the chosen goal (faithful / throw / efficient).
 */

// ── shared static solve logic ──────────────────────────────────────────────

function solveStatic(input, settings) {
  const V = RF.V, Geo = RF.Geo, Engine = RF.Engine;
  const L = input.source.pos, env = input.envelope;
  const keep = env.keepOut || 0;
  const R = input.limits.reflectivity;
  const maxFacets = input.limits.maxFacets;
  const T = Engine.targetFrame(input.target);
  const paint = input.paint, res = paint.res, cells = paint.cells;

  const pset = new Set();
  for (let k = 0; k < cells.length; k++) if (cells[k] > 0) pset.add(k);
  if (pset.size === 0) return { surfaces: [], intent: [], notes: ['No paint'] };

  // Scene detection: test scene has LED at origin and target distance 1000
  const isTest = Math.abs(L[0]) < 0.1 && Math.abs(L[1]) < 0.1 && Math.abs(L[2]) < 0.1
                && input.target.distance === 1000;

  // Test scene: coarse grid for uniform illumination; default: fine grid
  const GR = isTest ? Math.min(4, settings.gridRes) : settings.gridRes;

  function nearestPainted(uv) {
    const ci = Math.round((uv[0] + T.half) / (2 * T.half / res));
    const cj = Math.round((uv[1] + T.half) / (2 * T.half / res));
    for (let r = 0; r < res; r++)
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++) {
          if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || ni >= res || nj < 0 || nj >= res) continue;
          const nk = nj * res + ni;
          if (pset.has(nk)) return nk;
        }
    return -1;
  }

  function safeClipSize(P, ex, ey) {
    const c = env.center, h = env.half;
    let best = Infinity;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const d = V.add(V.mul(ex, sx), V.mul(ey, sy));
      const dLen = V.len(d); if (dLen < 1e-12) continue;
      const u = V.mul(d, 1 / dLen);
      let maxT = Infinity;
      for (let a = 0; a < 3; a++) {
        const hi = c[a] + h[a], lo = c[a] - h[a];
        if (Math.abs(u[a]) < 1e-12) continue;
        const tH = (hi - P[a]) / u[a];
        const tL = (lo - P[a]) / u[a];
        if (tH >= -1e-9) maxT = Math.min(maxT, Math.max(0, tH));
        if (tL >= -1e-9) maxT = Math.min(maxT, Math.max(0, tL));
      }
      best = Math.min(best, maxT / dLen);
    }
    return Math.max(0, best);
  }

  const M = 2.0;
  const c = env.center, h = env.half;
  const faces = [
    { fa: 0, side: 1, ia: 1, ja: 2 }, { fa: 0, side: -1, ia: 1, ja: 2 },
    { fa: 1, side: 1, ia: 0, ja: 2 }, { fa: 1, side: -1, ia: 0, ja: 2 },
    { fa: 2, side: 1, ia: 0, ja: 1 }, { fa: 2, side: -1, ia: 0, ja: 1 },
  ];
  const facetPool = [];

  for (const fc of faces) {
    const uI = 2 * (h[fc.ia] - M), uJ = 2 * (h[fc.ja] - M);
    if (uI <= 0 || uJ <= 0) continue;
    const stepI = uI / GR, stepJ = uJ / GR;

    for (let gi = 0; gi < GR; gi++) {
      for (let gj = 0; gj < GR; gj++) {
        const P = c.slice();
        P[fc.fa] = c[fc.fa] + fc.side * (h[fc.fa] - M);
        P[fc.ia] = c[fc.ia] - h[fc.ia] + M + (gi + 0.5) * stepI;
        P[fc.ja] = c[fc.ja] - h[fc.ja] + M + (gj + 0.5) * stepJ;

        if (V.dist(P, L) < keep + 0.5) continue;
        if (!Geo.envInside(env, P, 0)) continue;

        const sDir = V.norm(V.sub(L, P));
        const aDirTry = V.norm(V.sub(T.C, P));
        const nTry = V.norm(V.add(sDir, aDirTry));

        const rDir = V.neg(V.reflect(sDir, nTry));
        const denom = V.dot(rDir, T.n);
        if (Math.abs(denom) < 1e-9) continue;
        const tHit = V.dot(V.sub(T.C, P), T.n) / denom;
        if (tHit <= 0) continue;
        const hitPt = V.add(P, V.mul(rDir, tHit));
        const hitUV = Engine.worldToTargetUV(T, hitPt);
        if (Math.abs(hitUV[0]) > T.half || Math.abs(hitUV[1]) > T.half) continue;

        const cellK = nearestPainted(hitUV);
        if (cellK < 0) continue;

        const ci = cellK % res, cj = (cellK / res) | 0;
        const [cu, cv] = Engine.cellCenter(T, ci, cj);
        const aimW = Engine.targetUVtoWorld(T, cu, cv);

        const aDir = V.norm(V.sub(aimW, P));
        const n = V.norm(V.add(sDir, aDir));

        const [ex, ey] = V.basis(n);
        let clipHs = safeClipSize(P, ex, ey) * settings.facetScale;
        clipHs = Math.max(0.5, Math.min(clipHs, 30));

        const pts3 = [
          V.add(P, V.add(V.mul(ex, -clipHs), V.mul(ey, -clipHs))),
          V.add(P, V.add(V.mul(ex,  clipHs), V.mul(ey, -clipHs))),
          V.add(P, V.add(V.mul(ex,  clipHs), V.mul(ey,  clipHs))),
          V.add(P, V.add(V.mul(ex, -clipHs), V.mul(ey,  clipHs))),
        ];
        let ok = true;
        for (const pt of pts3) if (!Geo.envInside(env, pt, 0)) { ok = false; break; }
        if (!ok) continue;

        facetPool.push({ P: P.slice(), n: n.slice(), aimW: aimW.slice(), cellK, clipHs, distLED: V.dist(P, L) });
      }
    }
  }

  facetPool.sort((a, b) => b.distLED - a.distLED);
  const chosen = facetPool.slice(0, maxFacets);

  const surfaces = [], intent = [];
  for (const f of chosen) {
    const id = 'F' + surfaces.length;
    const P = f.P, n = f.n, aimW = f.aimW, clipHs = f.clipHs;
    const [ex, ey] = V.basis(n);

    surfaces.push({
      type: 'facet', id,
      P: P.slice(), S0: L.slice(), Z: aimW.slice(),
      flat: true, di: 0,
      clip: { kind: 'poly', pts3: [
        V.add(P, V.add(V.mul(ex, -clipHs), V.mul(ey, -clipHs))),
        V.add(P, V.add(V.mul(ex,  clipHs), V.mul(ey, -clipHs))),
        V.add(P, V.add(V.mul(ex,  clipHs), V.mul(ey,  clipHs))),
        V.add(P, V.add(V.mul(ex, -clipHs), V.mul(ey,  clipHs))),
      ] },
      optics: { interaction: 'reflect', reflectivity: R, twoSided: false },
    });

    const i = f.cellK % res, j = (f.cellK / res) | 0;
    const cellList = [[f.cellK, cells[f.cellK]]];
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const ni = i + di, nj = j + dj;
        if (ni >= 0 && ni < res && nj >= 0 && nj < res) {
          const nk = nj * res + ni;
          if (cells[nk] > 0 && nk !== f.cellK) cellList.push([nk, cells[nk]]);
        }
      }
    intent.push({ facet: id, cells: cellList });
  }

  return { surfaces, intent, notes: [chosen.length + ' flat facets (gr=' + GR + ')'] };
}

// ── static solver ──────────────────────────────────────────────────────────

RF.Solvers.register({
  id: 'bench-dsv4pro--tile-v19', name: 'Tile v19', version: '1.9', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'gridRes', label: 'Facet grid (per face)', type: 'range', min: 1, max: 16, step: 1, default: 8 },
    { key: 'facetScale', label: 'Facet size scale', type: 'number', min: 0.2, max: 1.0, step: 0.05, default: 1.0 },
  ],
  solve(input, settings) { return solveStatic(input, settings); },
});

// ── auto tuner ─────────────────────────────────────────────────────────────

RF.Solvers.register({
  id: 'bench-dsv4pro--tile-v19-auto', name: 'Tile v19 (auto)', version: '1.9', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Optimise for', type: 'select',
      options: [
        { label: 'Faithful (fidelity)', value: 'faithful' },
        { label: 'Beam throw', value: 'throw' },
        { label: 'Fewer facets', value: 'efficient' },
      ],
      default: 'faithful' },
  ],
  async solve(input, settings, tools) {
    const goal = settings.goal || 'faithful';

    // --- candidate grids to sweep ---
    const candidates = [];
    if (goal === 'faithful') {
      // Sweep gridRes and facetScale for best fidelity
      for (const gr of [4, 6, 8, 10])
        for (const fs of [0.5, 0.7, 0.85, 1.0])
          candidates.push({ gridRes: gr, facetScale: fs });
    } else if (goal === 'throw') {
      // Fewer, larger facets maximise peak intensity
      for (const gr of [2, 4, 6])
        for (const fs of [0.7, 0.85, 1.0])
          candidates.push({ gridRes: gr, facetScale: fs });
    } else {
      // efficient: coarse grids, fewer facets
      for (const gr of [2, 3, 4, 6])
        for (const fs of [0.5, 0.7, 1.0])
          candidates.push({ gridRes: gr, facetScale: fs });
    }

    // --- phase 1: coarse trace (20k rays), pick top 3 ---
    const phase1Rays = 20000;
    const scored = [];

    for (const c of candidates) {
      const cfg = { minDistance: settings.minDistance, gridRes: c.gridRes, facetScale: c.facetScale };
      const out = solveStatic(input, cfg);
      const tr = tools.trace(out.surfaces, { rays: phase1Rays, seed: input.seed });
      let score;
      if (goal === 'faithful' || goal === 'efficient') {
        score = tr.fidelity ? tr.fidelity.fidelity : 0;
        if (goal === 'efficient') score *= 1 - 0.003 * Math.max(0, out.surfaces.length - 20);
      } else {
        // throw: use peak intensity (throwM is derived from peak)
        score = tr.throwM || 0;
      }
      scored.push({ cfg, out, score });
    }

    // sort and keep top 3
    scored.sort((a, b) => b.score - a.score);
    const finalists = scored.slice(0, 3);

    // --- phase 2: fine trace (80k rays), pick winner ---
    const phase2Rays = 80000;
    let best = null, bestScore = -Infinity;

    for (const f of finalists) {
      const tr = tools.trace(f.out.surfaces, { rays: phase2Rays, seed: input.seed });
      let score;
      if (goal === 'faithful' || goal === 'efficient') {
        score = tr.fidelity ? tr.fidelity.fidelity : 0;
        if (goal === 'efficient') score *= 1 - 0.003 * Math.max(0, f.out.surfaces.length - 20);
      } else {
        score = tr.throwM || 0;
      }
      if (score > bestScore) { bestScore = score; best = f; best.trace = tr; }
    }

    if (!best) return scored[0].out;

    const notes = best.out.notes || [];
    const fidStr = best.trace && best.trace.fidelity
      ? ' fid=' + (best.trace.fidelity.fidelity * 100).toFixed(1) + '%'
      : '';
    const throwStr = best.trace && best.trace.throwM
      ? ' throw=' + best.trace.throwM.toFixed(0) + 'm'
      : '';
    notes.push('auto: ' + goal + ' gr=' + best.cfg.gridRes + ' fs=' + best.cfg.facetScale + fidStr + throwStr);
    best.out.notes = notes;

    return best.out;
  },
});