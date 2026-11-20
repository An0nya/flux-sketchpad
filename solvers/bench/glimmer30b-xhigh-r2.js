RF.Solvers.register({
  id: 'bench-glimmer30b-xhigh-r2--my-solver',
  name: 'My solver',
  version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'planeOffset', label: 'Plane offset', type: 'range', min: 0.2, max: 0.9, step: 0.01, default: 0.6 },
    { key: 'facetSizeFactor', label: 'Facet size factor', type: 'range', min: 0.2, max: 0.8, step: 0.01, default: 0.5 },
  ],
  solve(input, settings, tools) {
    const V = RF.V;
    const Engine = RF.Engine;
    const sourcePos = input.source.pos.slice();
    const env = input.envelope;
    const target = input.target;
    const paint = input.paint;
    const res = paint.res;
    const cells = paint.cells;
    const maxFacets = input.limits.maxFacets;
    const reflectivity = input.limits.reflectivity;
    const minDistEff = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = Engine.targetFrame(target);
    const halfT = T.half;
    const cellSize = 2 * halfT / res;

    const cx = env.center[0], cy = env.center[1], cz = env.center[2];
    const hx = env.half[0], hy = env.half[1], hz = env.half[2];
    const xMinEnv = cx - hx, xMaxEnv = cx + hx;
    const yMin = cy - hy, yMax = cy + hy;
    const zMin = cz - hz, zMax = cz + hz;

    let xMin = sourcePos[0] + minDistEff + 1e-3;
    let xMax = xMaxEnv - 1e-3;
    if (xMin >= xMax) { xMin = sourcePos[0] + minDistEff + 1e-3; xMax = sourcePos[0] + minDistEff + 50; }
    const offset = Math.max(0.2, Math.min(0.9, settings.planeOffset ?? 0.6));
    const xPlane = xMin + (xMax - xMin) * offset;

    const items = [];
    for (let idx = 0; idx < cells.length; idx++) {
      const w = cells[idx];
      if (w > 1e-6) {
        const i = idx % res;
        const j = (idx / res) | 0;
        items.push({ idx, w, i, j });
      }
    }
    items.sort((a, b) => b.w - a.w || a.idx - b.idx);
    const take = Math.min(maxFacets, items.length);
    const surfaces = [];
    const intent = [];

    const baseSize = Math.min(yMax - yMin, zMax - zMin) * 0.02;
    const sizeFactor = settings.facetSizeFactor ?? 0.5;
    const s = baseSize * sizeFactor;
    const halfS = s * 0.5;

    for (let k = 0; k < take; k++) {
      const it = items[k];
      const u = -halfT + (it.i + 0.5) * cellSize;
      const v = -halfT + (it.j + 0.5) * cellSize;
      const y = yMin + (u + halfT) / (2 * halfT) * (yMax - yMin);
      const z = zMin + (v + halfT) / (2 * halfT) * (zMax - zMin);
      const P = [xPlane, y, z];
      if (V.dist(P, sourcePos) < minDistEff - 1e-6) continue;
      const Z = Engine.targetUVtoWorld(T, u, v);
      const di = V.dist(P, Z);
      const pts3 = [
        [xPlane, y - halfS, z - halfS],
        [xPlane, y + halfS, z - halfS],
        [xPlane, y + halfS, z + halfS],
        [xPlane, y - halfS, z + halfS],
      ];
      const id = 'F' + k;
      surfaces.push({
        type: 'facet',
        id,
        P,
        S0: sourcePos,
        Z,
        di,
        flat: false,
        clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity, twoSided: false }
      });
      intent.push({ facet: id, cells: [[it.idx, it.w]] });
    }

    return { surfaces, intent, notes: [`placed ${surfaces.length} facets on plane x=${xPlane.toFixed(2)}`] };
  }
});
