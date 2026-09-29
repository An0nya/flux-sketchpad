/* Bundled model solver: Nemotron Ultra, Flux solver benchmark run 2026-09-26 (workspace work-nemotron-ultra-flux-solver-20260926-0547).
 * Copied verbatim from that run's solvers/solver.js (sha256 30ae44890301…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
/* Flux Paint Solver — static algorithm: 2D clustering with per-scene X clamping and shadow reduction.
 * No ray tracing inside solve(). */
RF.Solvers.register({
  id: 'paint-solver', name: 'Paint Solver', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetType', label: 'Facet type', type: 'select', options: ['flat', 'curved'], default: 'flat' },
    { key: 'gridDensity', label: 'Facet grid density', type: 'range', min: 3, max: 20, step: 1, default: 12 },
    { key: 'curvatureGain', label: 'Curvature gain (di / targetDist)', type: 'range', min: 0.1, max: 2, step: 0.1, default: 0.5 },
    { key: 'facetSize', label: 'Facet size in Y (mm)', type: 'range', min: 5, max: 60, step: 1, default: 22 },
    { key: 'facetDepth', label: 'Facet size in Z (mm)', type: 'range', min: 2, max: 30, step: 1, default: 10 },
    { key: 'xPosition', label: 'Facet X position (mm)', type: 'number', min: -50, max: 50, step: 1, default: 10 },
    { key: 'margin', label: 'Envelope margin (mm)', type: 'number', min: 1, max: 20, step: 0.5, default: 4 },
    { key: 'weightThreshold', label: 'Paint weight threshold for clustering', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.5 },
    { key: 'reduceShadowing', label: 'Reduce shadowing by aligning Z', type: 'checkbox', default: true },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, Engine = RF.Engine, Source = RF.Source;
    const { limits, source, envelope, target, paint, seed } = input;
    const maxFacets = limits.maxFacets;
    const reflectivity = limits.reflectivity;
    const keepOut = Math.max(envelope.keepOut || 0, settings.minDistance || 0);

    // Target frame and paint grid
    const T = Engine.targetFrame(target);
    const paintRes = paint.res;
    const paintCells = paint.cells;
    const half = T.half;

    // LED position and emission direction
    const S0 = source.pos;
    const srcFrame = Source.frame(source);
    const ledAxis = srcFrame.a;

    // Collect painted cells
    const painted = [];
    for (let j = 0; j < paintRes; j++) for (let i = 0; i < paintRes; i++) {
      const w = paintCells[j * paintRes + i];
      if (w > 0) {
        const [u, v] = Engine.cellCenter(T, i, j);
        const Z = Engine.targetUVtoWorld(T, u, v);
        const cellIdx = j * paintRes + i;
        painted.push({ i, j, u, v, w, Z, cellIdx });
      }
    }
    if (!painted.length) return { surfaces: [], intent: [], notes: ['No painted cells'] };

    // Cluster painted cells (2D grid with inner/outer rings)
    const clusters = new Map();
    const density = Math.min(settings.gridDensity, Math.ceil(Math.sqrt(maxFacets)));

    for (const p of painted) {
      const ring = p.w > settings.weightThreshold ? 'inner' : 'outer';
      const ci = Math.floor((p.u + half) / (2 * half) * density);
      const cj = Math.floor((p.v + half) / (2 * half) * density);
      const key = `${ring},${ci},${cj}`;
      if (!clusters.has(key)) clusters.set(key, { cells: [], weightSum: 0, uSum: 0, vSum: 0 });
      const c = clusters.get(key);
      c.cells.push(p);
      c.weightSum += p.w;
      c.uSum += p.u * p.w;
      c.vSum += p.v * p.w;
    }

    const sortedClusters = [...clusters.values()].sort((a, b) => b.weightSum - a.weightSum).slice(0, maxFacets);

    // Envelope bounds
    const envC = envelope.center, envH = envelope.half;
    const envMin = [envC[0] - envH[0], envC[1] - envH[1], envC[2] - envH[2]];
    const envMax = [envC[0] + envH[0], envC[1] + envH[1], envC[2] + envH[2]];
    const margin = settings.margin;

    // Target direction from LED
    const targetDir = V.norm(V.sub(T.C, S0));
    const forwardX = targetDir[0] > 0 ? 1 : -1;
    const forwardMin = Math.max(envMin[0] + margin, S0[0] + forwardX * keepOut);
    const forwardMax = envMax[0] - margin;
    let px = forwardMin > forwardMax ? forwardMin : Math.max(forwardMin, Math.min(forwardMax, settings.xPosition));

    // Determine LED dominant axis for shadow reduction
    const ledAxisAbs = [Math.abs(ledAxis[0]), Math.abs(ledAxis[1]), Math.abs(ledAxis[2])];
    const dominantAxis = ledAxisAbs[0] > ledAxisAbs[1] ? (ledAxisAbs[0] > ledAxisAbs[2] ? 0 : 2) : (ledAxisAbs[1] > ledAxisAbs[2] ? 1 : 2);

    const surfaces = [];
    const intent = [];
    const notes = [];

    for (let ci = 0; ci < sortedClusters.length; ci++) {
      const cluster = sortedClusters[ci];
      const uCent = cluster.uSum / cluster.weightSum;
      const vCent = cluster.vSum / cluster.weightSum;

      // Map target UV to envelope YZ
      let py = -uCent / half * envH[1] + envC[1];
      let pz = vCent / half * envH[2] + envC[2];

      // If reducing shadowing, align the dominant axis coordinate
      if (settings.reduceShadowing) {
        if (dominantAxis === 1) py = envC[1];
        else if (dominantAxis === 2) pz = envC[2];
        else py = envC[1];
      }

      // Clamp with margin
      py = Math.max(envMin[1] + margin, Math.min(envMax[1] - margin, py));
      pz = Math.max(envMin[2] + margin, Math.min(envMax[2] - margin, pz));

      const P = [px, py, pz];

      if (!Geo.envInside(envelope, P) || V.dist(P, S0) < keepOut) {
        notes.push(`Cluster ${ci}: position invalid, skipping`);
        continue;
      }

      // Aim point
      const Z = Engine.targetUVtoWorld(T, uCent, vCent);

      // Create facet
      const targetDist = V.dist(P, Z);
      const di = settings.facetType === 'curved' ? settings.curvatureGain * targetDist : null;
      const id = `F${ci}`;

      // Local frame
      const sh = V.norm(V.sub(S0, P));
      const ah = V.norm(V.sub(Z, P));
      const n = V.norm(V.add(sh, ah));
      const ex = V.inPlane(n, [0, 1, 0]), ey = V.cross(n, ex);

      // Rectangular clip - adaptive sizing
      let hx = settings.facetSize;
      let hy = settings.facetDepth;
      let fits = false;
      for (let attempt = 0; attempt < 15 && (hx > 1 || hy > 1); attempt++) {
        const pts3 = [
          V.add(P, V.add(V.mul(ex, -hx), V.mul(ey, -hy))),
          V.add(P, V.add(V.mul(ex, hx), V.mul(ey, -hy))),
          V.add(P, V.add(V.mul(ex, hx), V.mul(ey, hy))),
          V.add(P, V.add(V.mul(ex, -hx), V.mul(ey, hy))),
        ];
        let allInside = true;
        for (const pt of pts3) if (!Geo.envInside(envelope, pt)) { allInside = false; break; }
        if (allInside) { fits = true; break; }
        let maxXOut = 0, maxYOut = 0, maxZOut = 0;
        for (const pt of pts3) {
          maxXOut = Math.max(maxXOut, envMin[0] - pt[0], pt[0] - envMax[0]);
          maxYOut = Math.max(maxYOut, envMin[1] - pt[1], pt[1] - envMax[1]);
          maxZOut = Math.max(maxZOut, envMin[2] - pt[2], pt[2] - envMax[2]);
        }
        const exX = Math.abs(ex[0]), eyX = Math.abs(ey[0]);
        const exY = Math.abs(ex[1]), eyY = Math.abs(ey[1]);
        const exZ = Math.abs(ex[2]), eyZ = Math.abs(ey[2]);
        const hxContrib = hx * Math.max(exX, exY, exZ);
        const hyContrib = hy * Math.max(eyX, eyY, eyZ);
        const total = hxContrib + hyContrib;
        if (total > 0) {
          hx = Math.max(1, hx * (1 - 0.2 * hxContrib / total));
          hy = Math.max(1, hy * (1 - 0.2 * hyContrib / total));
        } else {
          hx *= 0.8; hy *= 0.8;
        }
      }
      if (!fits || hx < 2 || hy < 1) {
        notes.push(`Facet ${id}: cannot fit (hx=${hx.toFixed(1)}, hy=${hy.toFixed(1)}), skipping`);
        continue;
      }

      // LED clearance
      let nearestDist = V.dist(P, S0);
      if (di && isFinite(di)) {
        const sag = Math.max(hx, hy) * Math.max(hx, hy) / (2 * Math.abs(di));
        nearestDist = Math.min(nearestDist, V.dist(P, S0) - sag);
      }
      if (nearestDist < keepOut - 0.5) {
        notes.push(`Facet ${id} too close to LED, skipped`);
        continue;
      }

      const pts3 = [
        V.add(P, V.add(V.mul(ex, -hx), V.mul(ey, -hy))),
        V.add(P, V.add(V.mul(ex, hx), V.mul(ey, -hy))),
        V.add(P, V.add(V.mul(ex, hx), V.mul(ey, hy))),
        V.add(P, V.add(V.mul(ex, -hx), V.mul(ey, hy))),
      ];

      surfaces.push({
        type: 'facet', id, group: 'A', P, S0, Z, flat: di === null, di,
        clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity, twoSided: false }
      });

      intent.push({ facet: id, cells: cluster.cells.map((c) => [c.cellIdx, c.w]) });
      notes.push(`Facet ${id}: P=[${P.map(x => x.toFixed(1)).join(', ')}] Z=[${Z.map(x => x.toFixed(1)).join(', ')}] hx=${hx.toFixed(1)} hy=${hy.toFixed(1)}`);
    }

    notes.unshift(`Placed ${surfaces.length} facets from ${sortedClusters.length} clusters`);
    return { surfaces, intent, notes };
  },
});
})();
