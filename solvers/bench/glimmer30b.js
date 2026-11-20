RF.Solvers.register({
  id: 'bench-glimmer30b--simple-grid',
  name: 'Simple grid reflector',
  version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetSize', label: 'Facet half-size (mm)', type: 'number', min: 0.05, max: 25, step: 0.05, default: 0.4 },
  ],
  solve(input, settings, tools) {
    const V = RF.V;
    const sourcePos = input.source.pos.slice();
    const env = input.envelope;
    const target = input.target;
    const paint = input.paint;
    const limits = input.limits;
    const res = target.res;
    const half = target.size / 2;
    const cellSize = target.size / res;

    const effectiveMin = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const maxFacets = limits.maxFacets;
    const reflectivity = limits.reflectivity;
    const facetHalf = settings.facetSize || 0.7;

    const c = env.center;
    const h = env.half;
    const eps = 1e-9;

    function rayBoxInterval(dir) {
      let tMin = -Infinity;
      let tMax = Infinity;
      for (let a = 0; a < 3; a++) {
        const d = dir[a];
        if (Math.abs(d) < eps) {
          if (Math.abs(sourcePos[a] - c[a]) > h[a] + eps) return null;
          continue;
        }
        const t1 = (c[a] - h[a] - sourcePos[a]) / d;
        const t2 = (c[a] + h[a] - sourcePos[a]) / d;
        const tEnter = Math.min(t1, t2);
        const tExit = Math.max(t1, t2);
        tMin = Math.max(tMin, tEnter);
        tMax = Math.min(tMax, tExit);
        if (tMin > tMax) return null;
      }
      return [tMin, tMax];
    }

    const candidates = [];
    const totalCells = res * res;
    for (let idx = 0; idx < totalCells; idx++) {
      const val = paint.cells[idx];
      if (val <= 0) continue;
      const i = idx % res;
      const j = Math.floor(idx / res);
      const u = -half + (i + 0.5) * cellSize;
      const v = -half + (j + 0.5) * cellSize;
      const Z = [target.distance, -u, v];
      const dir = [Z[0] - sourcePos[0], Z[1] - sourcePos[1], Z[2] - sourcePos[2]];
      const len = V.len(dir);
      if (len < eps) continue;
      const interval = rayBoxInterval(dir);
      if (!interval) continue;
      let [tEnter, tExit] = interval;
      tEnter = Math.max(tEnter, 0);
      tExit = Math.min(tExit, 1);
      if (tExit <= tEnter) continue;
      const tMinDist = effectiveMin / len;
      let t = tEnter + 0.3 * (tExit - tEnter);
      if (t < tMinDist) t = tMinDist;
      if (t > tExit) continue;
      const P = [
        sourcePos[0] + dir[0] * t,
        sourcePos[1] + dir[1] * t,
        sourcePos[2] + dir[2] * t
      ];
      if (Math.abs(P[0] - c[0]) > h[0] + eps ||
          Math.abs(P[1] - c[1]) > h[1] + eps ||
          Math.abs(P[2] - c[2]) > h[2] + eps) continue;
      if (V.dist(P, sourcePos) < effectiveMin - 1e-3) continue;
      candidates.push({ P, Z, val, idx, t });
    }

    candidates.sort((a, b) => b.val - a.val);
    const surfaces = [];
    const intent = [];
    let placed = 0;
    for (const cand of candidates) {
      if (placed >= maxFacets) break;
      const P = cand.P;
      const Z = cand.Z;
      const sh = V.norm(V.sub(sourcePos, P));
      const ah = V.norm(V.sub(Z, P));
      const n = V.norm(V.add(sh, ah));

      const basis = V.basis(n);
      const uVec = basis[0];
      const vVec = basis[1];
      const halfS = facetHalf;
      const p0 = V.add(P, V.add(V.mul(uVec, halfS), V.mul(vVec, halfS)));
      const p1 = V.add(P, V.add(V.mul(uVec, halfS), V.mul(vVec, -halfS)));
      const p2 = V.add(P, V.add(V.mul(uVec, -halfS), V.mul(vVec, -halfS)));
      const p3 = V.add(P, V.add(V.mul(uVec, -halfS), V.mul(vVec, halfS)));
      const id = 'F' + placed;
      const di = V.dist(P, Z);
      surfaces.push({
        type: 'facet',
        id,
        P,
        S0: sourcePos.slice(),
        Z,
        di,
        flat: false,
        clip: { kind: 'poly', pts3: [p0, p1, p2, p3] },
        optics: { interaction: 'reflect', reflectivity, twoSided: false }
      });
      intent.push({ facet: id, cells: [[cand.idx, cand.val]] });
      placed++;
    }

    const notes = [];
    notes.push(`Placed ${placed} facets, facet half-size ${facetHalf} mm`);
    return { surfaces, intent, notes };
  }
});
