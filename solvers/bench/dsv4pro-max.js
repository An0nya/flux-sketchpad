/* solver.js — static reflector solver + auto-tuner for Flux
 *
 * Shared core: buildSolution(input, settings) → { surfaces, intent, notes }
 *   - Places curved (ellipsoid) facets on the back (-x) face of a shrunk envelope.
 *   - Balanced greedy assignment distributes facets across painted cells.
 *
 * Static solver (id: 'tile'): deterministic, no tracing.
 * Auto tuner   (id: 'tile-auto'): traces candidates to pick best settings for a goal.
 */

// ── Shared solver core ──────────────────────────────────────────────────────

function buildSolution(input, settings) {
  const V = RF.V;
  const env = input.envelope;
  const S0 = input.source.pos;
  const target = input.target;
  const paint = input.paint;
  const maxFacets = input.limits.maxFacets;
  const reflectivity = input.limits.reflectivity;
  const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
  const shrink = settings.shrink || 0.80;
  const cellSpread = settings.cellSpread || 1.0;

  const C = env.center;
  const H = env.half;
  const T = RF.Engine.targetFrame(target);
  const res = target.res;
  const cellSize = 2 * T.half / res;

  const sH = H.map(h => h * shrink);
  const faceX = C[0] - sH[0];
  const uLen = 2 * sH[1];
  const vLen = 2 * sH[2];
  const u0 = C[1] - sH[1];
  const v0 = C[2] - sH[2];
  const inN = [1, 0, 0];

  const cellCenters = [];
  const cellWeight = new Float64Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const idx = j * res + i;
      const w = paint.cells[idx] || 0;
      cellWeight[idx] = w;
      if (w > 0) {
        const u = -T.half + (i + 0.5) * cellSize;
        const v = -T.half + (j + 0.5) * cellSize;
        const Z = V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v)));
        cellCenters.push({ i, j, idx, w, Z });
      }
    }
  }
  const totalW = cellCenters.reduce((s, c) => s + c.w, 0);

  const aspect = uLen / Math.max(1, vLen);
  const nv = Math.max(2, Math.round(Math.sqrt(maxFacets * 2 / aspect)));
  const nu = Math.max(2, Math.round(maxFacets * 2 / nv));
  const du = uLen / nu;
  const dv = vLen / nv;

  const positionOptions = [];

  for (let iu = 0; iu < nu; iu++) {
    for (let iv = 0; iv < nv; iv++) {
      const P = C.slice();
      P[0] = faceX;
      P[1] = u0 + (iu + 0.5) * du;
      P[2] = v0 + (iv + 0.5) * dv;

      if (V.dist(P, S0) < keep + 0.5) continue;

      const toSrc = V.sub(P, S0);
      const distToSrc = V.len(toSrc);
      if (distToSrc < 0.5) continue;
      const iDir = V.mul(toSrc, 1 / distToSrc);

      const m = Math.min(du, dv) * 0.05;
      const cu0 = u0 + iu * du + m;
      const cu1 = u0 + (iu + 1) * du - m;
      const cv0 = v0 + iv * dv + m;
      const cv1 = v0 + (iv + 1) * dv - m;
      if (cu1 <= cu0 || cv1 <= cv0) continue;

      const corners = [
        [faceX, cu0, cv0], [faceX, cu1, cv0],
        [faceX, cu1, cv1], [faceX, cu0, cv1]
      ];

      const options = [];

      for (const cc of cellCenters) {
        const oDir = V.norm(V.sub(cc.Z, P));
        const bisector = V.norm(V.add(iDir, oDir));
        const align = V.dot(bisector, inN);
        if (align < 0.15) continue;

        let allInside = true;
        for (const c3 of corners) {
          const d = V.dot(bisector, V.sub(c3, P));
          const proj = V.sub(c3, V.mul(bisector, d));
          for (let ax = 0; ax < 3; ax++) {
            if (Math.abs(proj[ax] - env.center[ax]) > env.half[ax] - 0.05) {
              allInside = false;
              break;
            }
          }
          if (!allInside) break;
        }
        if (!allInside) continue;

        const score = align * (1 + 5 / Math.max(5, distToSrc));
        options.push({ cellIdx: cc.idx, Z: cc.Z, w: cc.w, score });
      }

      if (options.length > 0) {
        options.sort((a, b) => b.score - a.score);
        positionOptions.push({ P, distToSrc, corners, options });
      }
    }
  }

  const assigned = new Float64Array(res * res);
  const quota = new Float64Array(res * res);
  for (const cc of cellCenters) {
    quota[cc.idx] = Math.max(0.5, (cc.w / totalW) * maxFacets);
  }

  positionOptions.sort((a, b) => b.options[0].score - a.options[0].score);
  const selected = [];

  for (const po of positionOptions) {
    if (selected.length >= maxFacets) break;

    let bestOpt = null, bestNeed = -Infinity;
    for (const opt of po.options) {
      const need = quota[opt.cellIdx] - assigned[opt.cellIdx];
      const combined = need * 10 + opt.score * 0.1;
      if (combined > bestNeed) {
        bestNeed = combined;
        bestOpt = opt;
      }
    }

    if (bestOpt && bestNeed > -1) {
      assigned[bestOpt.cellIdx]++;
      selected.push({
        P: po.P, Z: bestOpt.Z, distToSrc: po.distToSrc,
        cellIdx: bestOpt.cellIdx, corners: po.corners,
      });
    }
  }

  const surfaces = [];
  const intent = [];

  for (let k = 0; k < selected.length; k++) {
    const c = selected[k];
    const id = 'F' + k;

    surfaces.push({
      type: 'facet',
      id,
      P: c.P,
      S0,
      Z: c.Z,
      di: V.dist(c.P, c.Z) * cellSpread,
      clip: { kind: 'poly', pts3: c.corners },
      optics: { interaction: 'reflect', reflectivity, twoSided: false },
    });

    intent.push({ facet: id, cells: [[c.cellIdx, 1]] });
  }

  const uniqueCells = new Set(selected.map(c => c.cellIdx)).size;
  const meanDist = selected.reduce((s, c) => s + c.distToSrc, 0) / Math.max(1, selected.length);

  const notes = [
    selected.length + ' facets covering ' + uniqueCells + ' unique cells',
    'grid: ' + nu + '×' + nv + ', face: ' + uLen.toFixed(0) + '×' + vLen.toFixed(0) + ' mm',
    'shrink: ' + shrink + ', spread: ' + cellSpread + ', mean dist: ' + meanDist.toFixed(0) + ' mm',
  ];

  return { surfaces, intent, notes };
}

// ── Static solver ───────────────────────────────────────────────────────────

RF.Solvers.register({
  id: 'bench-dsv4pro-max--tile', name: 'Tile reflector', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'shrink', label: 'Inner box scale', type: 'range', min: 0.6, max: 0.95, step: 0.01, default: 0.80 },
    { key: 'cellSpread', label: 'Focus spread', type: 'range', min: 0.2, max: 2.0, step: 0.1, default: 1.0 },
  ],
  solve(input, settings) {
    return buildSolution(input, settings);
  },
});

// ── Auto tuner ──────────────────────────────────────────────────────────────

RF.Solvers.register({
  id: 'bench-dsv4pro-max--tile-auto', name: 'Tile tuner', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Optimise for', type: 'select',
      choices: [
        { value: 'faithful', label: 'Faithful (fidelity)' },
        { value: 'throw',   label: 'Throw (peak intensity)' },
        { value: 'efficient', label: 'Efficient (fidelity per facet)' },
      ],
      default: 'faithful',
    },
  ],
  async solve(input, settings, tools) {
    const goal = settings.goal || 'faithful';
    const traceSeed = input.seed || 42;

    // Search space: 3×3 = 9 candidates
    const shrinks = [0.73, 0.77, 0.81];
    const spreads = [0.7, 1.0, 1.3];
    const fastRays = 50000;

    let bestScore = -Infinity;
    let bestResult = null;
    const candidates = [];

    for (const shrink of shrinks) {
      for (const cellSpread of spreads) {
        const sub = buildSolution(input, { minDistance: settings.minDistance, shrink, cellSpread });
        candidates.push({ sub, shrink, cellSpread });
      }
    }

    for (const c of candidates) {
      const trace = await tools.trace(c.sub.surfaces, {
        rays: fastRays, seed: traceSeed, attribution: false, occlusion: false,
      });

      let score;
      switch (goal) {
        case 'faithful':
          score = trace.fidelity.fidelity;
          break;
        case 'throw':
          score = trace.peakCd;
          break;
        case 'efficient':
          score = trace.fidelity.fidelity - 0.05 * (c.sub.surfaces.length / Math.max(1, input.limits.maxFacets));
          break;
        default:
          score = trace.fidelity.fidelity;
      }

      c.trace = trace;
      c.score = score;

      if (score > bestScore) {
        bestScore = score;
        bestResult = c;
      }
    }

    // Rebuild at final resolution with best settings
    const final = buildSolution(input, {
      minDistance: settings.minDistance,
      shrink: bestResult.shrink,
      cellSpread: bestResult.cellSpread,
    });

    final.notes.push(
      'auto-tuned for ' + goal + ' (shr ' + bestResult.shrink.toFixed(2) +
      ', sp ' + bestResult.cellSpread.toFixed(1) +
      ', score ' + bestScore.toFixed(4) + ')',
      'candidates: ' + shrinks.join('/') + ' shrink × ' + spreads.join('/') + ' spread @ ' + fastRays + ' rays'
    );

    return final;
  },
});