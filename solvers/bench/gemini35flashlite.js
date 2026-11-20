(function() {
  const solveStatic = (input, settings) => {
    const V = RF.V, Geo = RF.Geo, Engine = RF.Engine;
    const S = input.source.pos;
    const keep = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0);
    const maxFacets = input.limits.maxFacets;
    const targetFacets = Math.min(maxFacets, settings.facets || 100);
    const reflectivity = input.limits.reflectivity;

    const paint = input.paint;
    const T = Engine.targetFrame(input.target);
    const res = paint.res;
    const cells = paint.cells;

    const paintedCells = [];
    let totalWeight = 0;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const idx = j * res + i;
        const w = cells[idx];
        if (w > 0) {
          paintedCells.push({ i, j, w });
          totalWeight += w;
        }
      }
    }

    const surfaces = [];
    const intent = [];
    const notes = [];

    if (paintedCells.length === 0 || totalWeight === 0) {
      notes.push('No painted cells found.');
      return { surfaces, intent, notes };
    }

    const nDir = Math.max(targetFacets * 4, 400);
    const dirs = [];
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < nDir; i++) {
      const y = 1 - (i / (nDir - 1)) * 2;
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;
      dirs.push(V.norm([x, y, z]));
    }

    const buffer = 0.2;
    let paintedIdx = 0;
    for (let i = 0; i < dirs.length && surfaces.length < targetFacets; i++) {
      const dirNorm = dirs[i];
      const interval = Geo.envInterval(input.envelope, S, dirNorm);
      const tin = interval[0], tout = interval[1];
      const safetyMargin = 0.5;
      const lo = Math.max(tin, keep + safetyMargin, 0.1);
      const hi = tout - safetyMargin;
      if (!(hi > lo)) continue;

      const r = lo + 0.3 * (hi - lo);
      const P = V.madd(S, dirNorm, r);

      const hx = 0.6;
      const hy = 0.6;

      const dV = V.norm(V.sub(P, S));
      const targetCell = paintedCells[paintedIdx % paintedCells.length];
      paintedIdx++;

      const [u, v] = Engine.cellCenter(T, targetCell.i, targetCell.j);
      const Z = Engine.targetUVtoWorld(T, u, v);

      const aV = V.norm(V.sub(Z, P));
      const nV = V.norm(V.add(dV, aV));
      let uV = V.cross(nV, [0, 0, 1]);
      if (V.len(uV) < 0.01) uV = V.cross(nV, [0, 1, 0]);
      uV = V.norm(uV);
      const vV = V.norm(V.cross(nV, uV));

      const corners = [
        V.add(P, V.add(V.mul(uV, -hx), V.mul(vV, -hy))),
        V.add(P, V.add(V.mul(uV, hx), V.mul(vV, -hy))),
        V.add(P, V.add(V.mul(uV, hx), V.mul(vV, hy))),
        V.add(P, V.add(V.mul(uV, -hx), V.mul(vV, hy)))
      ];

      let valid = Geo.envInside(input.envelope, P, -buffer);
      for (const q of corners) {
        if (!Geo.envInside(input.envelope, q, -buffer)) { valid = false; break; }
        if (V.dist(q, S) < keep + safetyMargin) { valid = false; break; }
      }
      if (!valid) continue;

      const id = 'F' + surfaces.length;

      surfaces.push({
        type: 'facet',
        id,
        group: 'A',
        P,
        S0: S,
        Z,
        flat: true,
        di: null,
        clip: { kind: 'rect', hx, hy },
        optics: { interaction: 'reflect', reflectivity, twoSided: false }
      });

      intent.push({
        facet: id,
        cells: [[targetCell.j * res + targetCell.i, targetCell.w]]
      });
    }

    notes.push(`Placed ${surfaces.length} clean facets.`);
    return { surfaces, intent, notes };
  };

  RF.Solvers.register({
    id: 'bench-gemini35flashlite--paint-solver-v2',
    name: 'Paint Solver v2',
    version: '2.3',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'facets', label: 'Facet count', type: 'number', min: 10, max: 400, step: 10, default: 100 },
    ],
    solve(input, settings, tools) {
      return solveStatic(input, settings);
    }
  });

  RF.Solvers.register({
    id: 'bench-gemini35flashlite--paint-solver-v2-auto',
    name: 'Paint Solver v2 Tuner (Auto)',
    version: '1.0',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful', options: [{ value: 'faithful', label: 'Faithful' }, { value: 'throw', label: 'Throw / Peak' }, { value: 'efficient', label: 'Efficient' }] },
      { key: 'facets', label: 'Facet count', type: 'number', min: 10, max: 400, step: 10, default: 100 },
    ],
    async solve(input, settings, tools) {
      const facetCounts = [Math.max(20, Math.round((settings.facets || 100) * 0.7)), settings.facets || 100, Math.min(input.limits.maxFacets, Math.round((settings.facets || 100) * 1.3))];
      let bestOut = null;
      let bestScore = -Infinity;

      for (const fCount of facetCounts) {
        if (fCount > input.limits.maxFacets) continue;
        const candidateSettings = Object.assign({}, settings, { facets: fCount });
        const out = solveStatic(input, candidateSettings);
        if (!out.surfaces.length) continue;

        let score = 0;
        if (tools && tools.trace) {
          try {
            const tr = tools.trace(out.surfaces, { rays: 150000, seed: input.seed, attribution: true });
            if (settings.goal === 'throw') {
              score = tr.peakCd || 0;
            } else if (settings.goal === 'efficient') {
              score = (tr.energy && tr.energy.delivered) || (tr.fidelity && tr.fidelity.fidelity) || 0;
            } else {
              score = (tr.fidelity && tr.fidelity.fidelity) || 0;
            }
          } catch (e) {
            score = 0;
          }
        } else {
          score = out.surfaces.length;
        }

        if (score > bestScore) {
          bestScore = score;
          bestOut = out;
        }
      }

      if (!bestOut) {
        bestOut = solveStatic(input, settings);
      }
      bestOut.notes = (bestOut.notes || []).concat([`Auto tuner selected best candidate for goal '${settings.goal}' (score: ${bestScore.toFixed(3)})`]);
      return bestOut;
    }
  });
})();
