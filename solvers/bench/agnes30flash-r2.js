/* solver.js — static "aimed facet" solver.
 *
 * Place curved facets (ellipsoid mirrors, foci at the LED and the aim point) at
 * interior points of the envelope, in the LED's forward cone.  Each facet focuses
 * the LED's image onto a chosen target cell.  Facets are spread over a 3D grid to
 * minimize mutual shadowing.  The grid is sized so the total catch flux delivers
 * a chosen fraction of the LED's power onto the painted cells.
 *
 *   1. Build a 3D grid of candidate points inside the envelope, in the LED's
 *      forward cone, clear of the LED.
 *   2. For each painted cell, find the grid point with the highest catch flux
 *      that can aim at the cell.  Assign grid points to cells greedily (LPT).
 *   3. Size facets so the total delivered flux ≈ fraction × LED power.
 *   4. Place one facet per grid point (no stacking → minimal shadowing).
 */
(function (root) {
  'use strict';
  const RF = root.RF, V = RF.V, U = RF.U;

  function solve(input, settings, tools) {
    const env = input.envelope, src = input.source, T = input.target;
    const LED = RF.Source.apparent ? RF.Source.apparent(src) : src;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const Rr = input.limits.reflectivity;
    const LEDp = LED.pos;

    const Tf = RF.Engine.targetFrame(T);
    const R = input.paint.res, paint = input.paint.cells;
    const cellMm = 2 * Tf.half / R;
    const cellCenter = (k) => {
      const i = k % R, j = (k / R) | 0;
      const [u, v] = RF.Engine.cellCenter(Tf, i, j);
      return RF.Engine.targetUVtoWorld(Tf, u, v);
    };
    const pcells = [];
    for (let k = 0; k < R * R; k++) if (paint[k] > 0) pcells.push(k);
    if (!pcells.length) return { surfaces: [], intent: [], notes: ['no painted cells'] };
    // interior cells: all 8 neighbors are also painted (to avoid spilling into gaps)
    const isInterior = (k) => {
      const i = k % R, j = (k / R) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= R || nj >= R) return false;
        if (paint[nj * R + ni] === 0) return false;
      }
      return true;
    };
    const ipcells = pcells.filter(isInterior);
    const effCells = ipcells.length > pcells.length * 0.1 ? ipcells : pcells; // use interior if enough
    const alloc = new Array(R * R).fill(0);
    const cellOrder = effCells.slice().sort((a, b) => paint[b] - paint[a]);

    // ---- LED helpers
    const sf = RF.Source.frame(LED);
    const ledAxis = sf.a;
    const lumOf = (d) => {
      const A = RF.Source.emittingArea(LED);
      if (!(A > 0)) return 1e12;
      if (LED.kind === 'volume' && LED.emission === 'surface') return LED.power / RF.Source.totalIntegral(LED);
      const c = Math.max(-1, Math.min(1, d[0] * ledAxis[0] + d[1] * ledAxis[1] + d[2] * ledAxis[2]));
      return LED.power * RF.Source.intensity(LED, Math.acos(c)) / RF.Source.totalIntegral(LED) / (LED.kind === 'planar' ? A * Math.max(1e-9, c) : A);
    };
    const catchFactor = (P) => {
      const d = V.sub(P, LEDp), r = V.len(d);
      if (r < 1e-6) return 0;
      const dNorm = V.mul(d, 1 / r);
      const cosA = V.dot(dNorm, ledAxis);
      if (cosA < 0.1) return 0;
      return lumOf(dNorm) / (r * r);
    };

    // ---- 3D grid of candidate points
    const nGrid = 6;
    const cands = [];
    const h = env.half;
    for (let ix = 0; ix < nGrid; ix++) {
      for (let iy = 0; iy < nGrid; iy++) {
        for (let iz = 0; iz < nGrid; iz++) {
          const P = [
            env.center[0] + (ix / (nGrid - 1) - 0.5) * 2 * h[0] * 0.9,
            env.center[1] + (iy / (nGrid - 1) - 0.5) * 2 * h[1] * 0.9,
            env.center[2] + (iz / (nGrid - 1) - 0.5) * 2 * h[2] * 0.9,
          ];
          if (!RF.Geo.envInside(env, P, 0.01)) continue;
          if (V.dist(P, LEDp) < keep + 0.5) continue;
          const cf = catchFactor(P);
          if (cf < 1e-30) continue;
          cands.push({ P, cf, dLed: V.dist(P, LEDp) });
        }
      }
    }
    if (!cands.length) return { surfaces: [], intent: [], notes: ['no valid candidate points in the forward cone'] };
    cands.sort((a, b) => b.cf - a.cf);

    // ---- allocate budget to cells (LPT by weight)
    if (effCells.length <= maxF) {
      for (const k of effCells) alloc[k] = 1;
      const rem = maxF - effCells.length;
      for (let r = 0; r < rem; r++) alloc[cellOrder[r % cellOrder.length]]++;
    } else {
      const bins = new Array(cellOrder.length).fill(0);
      const bw = new Array(cellOrder.length).fill(0);
      for (const k of cellOrder) {
        let bi = 0;
        for (let i = 1; i < cellOrder.length; i++) if (bw[i] < bw[bi] - 1e-12) bi = i;
        bins[bi]++; bw[bi] += paint[k]; alloc[cellOrder[bi]] = bins[bi];
      }
    }

    // ---- assign candidates to cells (greedy: best cf, no reuse)
    const assign = new Map();
    const used = new Set();
    for (const k of cellOrder) {
      const n = alloc[k]; if (!(n > 0)) continue;
      const X = cellCenter(k);
      const chosen = [];
      for (let qi = 0; qi < cands.length && chosen.length < n; qi++) {
        if (used.has(qi)) continue;
        const P = cands[qi].P;
        const sDir = V.norm(V.sub(LEDp, P)), aDir = V.norm(V.sub(X, P));
        const n2 = V.norm(V.add(sDir, aDir));
        if (n2[0] * (LEDp[0] - P[0]) + n2[1] * (LEDp[1] - P[1]) + n2[2] * (LEDp[2] - P[2]) < 0) continue;
        chosen.push(qi);
        used.add(qi);
      }
      if (chosen.length) assign.set(k, chosen);
    }

    // ---- facet size
    const fCatch = settings.fraction != null ? settings.fraction : 0.3;
    const totalCf = [...assign.values()].reduce((a, arr) => a + arr.reduce((s, qi) => s + cands[qi].cf, 0), 0);
    let Aall = totalCf > 0 ? (fCatch * LED.power) / (Rr * totalCf) : 0;
    let rFacet = Math.sqrt(Aall / Math.PI);
    // ---- build
    const surfaces = [], intent = [], notes = [];
    let placed = 0;
    for (const k of effCells) {
      const arr = assign.get(k);
      if (!arr || !arr.length) continue;
      const n = arr.length;
      const X = cellCenter(k);
      for (const qi of arr) {
        if (placed >= maxF) break;
        const P = cands[qi].P;
        const di = V.dist(X, P);
        const sDir = V.norm(V.sub(LEDp, P)), aDir = V.norm(V.sub(X, P));
        const nrm = V.norm(V.add(sDir, aDir));
        // shrink clip to stay inside the envelope and outside the keepOut sphere
        let rClip = Math.min(rFacet, Math.max(0.3, (cands[qi].dLed - keep - 0.3) * 0.4));
        // also: keep the clip inside the envelope (distance to nearest face)
        const dFaces = [
          P[0] - (env.center[0] - env.half[0]), (env.center[0] + env.half[0]) - P[0],
          P[1] - (env.center[1] - env.half[1]), (env.center[1] + env.half[1]) - P[1],
          P[2] - (env.center[2] - env.half[2]), (env.center[2] + env.half[2]) - P[2],
        ];
        const dFace = Math.min(...dFaces);
        rClip = Math.min(rClip, Math.max(0.3, dFace * 0.7));
        surfaces.push({
          type: 'facet', id: 'F' + placed, group: 'A',
          P: P.slice(), S0: LEDp.slice(), Z: X, di,
          clip: { kind: 'disc', r: rClip, ref: aDir },
          optics: { interaction: 'reflect', reflectivity: Rr, twoSided: false },
        });
        intent.push({ facet: 'F' + placed, cells: [[k, paint[k] / n]] });
        placed++;
      }
    }
    if (placed < maxF) notes.push('placed ' + placed + '/' + maxF + ' of ' + cands.length + ' candidates');
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-agnes30flash-r2--aimed-facets', name: 'Aimed curved facets (static)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'fraction', label: 'Share of LED flux to deliver to paint (0–1)', type: 'number', min: 0.05, max: 1, step: 0.05, default: 0.2 },
    ],
    solve,
  });

  // ---- auto tuner: picks the best fraction for a given goal by tracing a few candidates
  function solveAuto(input, settings, tools) {
    const goal = settings.goal || 'faithful';
    const base = Object.assign({}, settings, { minDistance: settings.minDistance || 0 });
    // candidate fractions to try (small → large; each gives a different facet size)
    const fractions = [0.1, 0.15, 0.2, 0.3, 0.4];
    const seed = (input.seed != null ? input.seed : 0) | 0;
    // respect the host's ray budget: spend it evenly over the candidates
    const rayBudget = (tools.budget && tools.budget.rays) || 2000000;
    const rays = Math.max(50000, Math.min(300000, Math.floor(rayBudget / fractions.length / 2)));
    let best = null, bestScore = -1, lastOut = null;
    for (const fr of fractions) {
      const s = Object.assign({}, base, { fraction: fr });
      let out;
      try { out = solve(input, s, tools); } catch (e) { continue; }
      if (!out.surfaces.length) continue;
      // trace this candidate
      let t;
      try { t = tools.trace(out.surfaces, { rays, seed }); } catch (e) { continue; }
      if (!t || !t.fidelity) continue;
      const F = t.fidelity;
      // score depends on the goal
      let score;
      if (goal === 'faithful') {
        // maximize fidelity (F1 of within and gapsDark), with a small onPaint term
        score = F.fidelity + 0.1 * (F.onPaint || 0);
      } else if (goal === 'throw') {
        // maximize throw (distance where the beam is still bright)
        score = (F.fidelity > 0.1 ? F.fidelity : 0) + 0.5 * Math.min(1, (t.throwM || 0) / 200);
      } else { // efficient
        // maximize onPaint (delivery efficiency) while keeping fidelity reasonable
        score = (F.onPaint || 0) + 0.5 * Math.min(1, F.fidelity);
      }
      if (score > bestScore) { bestScore = score; best = fr; lastOut = out; }
      if (tools.preview) tools.preview(out.surfaces, { label: 'frac=' + fr, trace: t });
    }
    if (!best || !lastOut) {
      // fallback: use the static default
      lastOut = solve(input, Object.assign({}, base, { fraction: 0.2 }), tools);
    } else {
      // re-build with the best fraction (deterministic, no trace)
      lastOut = solve(input, Object.assign({}, base, { fraction: best }), tools);
    }
    lastOut.notes = (lastOut.notes || []).concat(['auto: best fraction=' + best + ' goal=' + goal + ' score=' + bestScore.toFixed(3)]);
    return lastOut;
  }

  RF.Solvers.register({
    id: 'bench-agnes30flash-r2--aimed-facets-auto', name: 'Aimed curved facets (tuned)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', options: [
        { value: 'faithful', label: 'Faithful (match the painting)' },
        { value: 'throw', label: 'Throw (reach far)' },
        { value: 'efficient', label: 'Efficient (max on-paint delivery)' },
      ], default: 'faithful' },
    ],
    solve: solveAuto,
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
