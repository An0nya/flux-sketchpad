/* Flux solver: "tile" v10
 *
 * Static solver: places facets on a YZ plane behind the LED. Plane distance
 * controls image size (closer = bigger spots = better coverage; further = sharper edges).
 *
 * Tuner (tile-auto): searches gridRes × imageCells to optimise for a goal.
 */

// ---- shared solve logic (mutates nothing outside) ----
function tileSolve(input, settings) {
    const V = RF.V, Geo = RF.Geo, E = RF.Engine, Src = RF.Source;
    const { source, envelope, target, paint, limits } = input;
    const keep = Math.max(envelope.keepOut || 0, settings.minDistance || 0);
    const maxN = limits.maxFacets || 100;
    const gridRes = Math.max(2, Math.min(14, settings.gridRes || 10));
    const imageCells = Math.max(0.5, Math.min(15, settings.imageCells || 3));

    const T = E.targetFrame(target);
    const paintRes = paint.res;
    const paintCells = paint.cells;
    const L = source.pos;
    const srcAxis = Src.frame(source).a;

    const env = envelope;
    const cx = env.center[0], cy = env.center[1], cz = env.center[2];
    const hx = env.half[0], hy = env.half[1], hz = env.half[2];

    // ----- determine facet plane -----
    // Place a YZ plane behind the LED (at x = L[0] - r).
    // Choose r to give the desired image size on target.
    // image size = srcSize × D / r
    const srcSize = Math.max(source.w || 1, source.h || 1, source.radius * 2 || 1);
    const cellSize = target.size / target.res;
    const D = target.distance;
    const desiredR = srcSize * D / (imageCells * cellSize);
    const tiltMargin = 3;

    const maxBackX = cx - hx; // envelope back wall
    const depthAvailable = L[0] - maxBackX; // how far behind LED we can go
    const rMin = keep + 1;
    const rMax = Math.max(rMin + 1, depthAvailable - tiltMargin);
    const planeR = Math.max(rMin, Math.min(rMax, desiredR));
    const planeX = L[0] - planeR;
    const actualImageCells = srcSize * D / (planeR * cellSize);

    // YZ extent at this x inside the envelope
    const yMin = cy - hy + tiltMargin, yMax = cy + hy - tiltMargin;
    const zMin = Math.max(cz - hz + tiltMargin, L[2] + keep + 0.5);
    const zMax = cz + hz - tiltMargin;
    const faceW = yMax - yMin;
    const faceH = zMax - zMin;

    if (faceW < 2 || faceH < 2) {
      return { surfaces: [], intent: [], notes: ['no room on plane at x=' + planeX.toFixed(1)] };
    }

    const planeOrigin = [planeX, yMin, zMin];
    const planeUAxis = [0, faceW, 0];
    const planeVAxis = [0, 0, faceH];
    const faceName = 'back';

    // ----- paint analysis -----
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    let totalWeight = 0;
    const paintedCells = [];
    for (let j = 0; j < paintRes; j++) {
      for (let i = 0; i < paintRes; i++) {
        const w = paintCells[j * paintRes + i];
        if (w > 0) {
          const [u, v] = E.cellCenter(T, i, j);
          uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
          vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
          totalWeight += w;
          paintedCells.push({ i, j, u, v, w });
        }
      }
    }
    if (!(totalWeight > 0)) {
      return { surfaces: [], intent: [], notes: ['no paint on target'] };
    }

    const pad = 0.05 * Math.max(uMax - uMin, vMax - vMin, 1);
    uMin -= pad; uMax += pad; vMin -= pad; vMax += pad;

    // ----- tiles -----
    const nPRows = Math.max(1, Math.round(Math.sqrt(maxN * (vMax - vMin) / ((uMax - uMin) || 1))));
    const nPCols = Math.max(1, Math.round(maxN / nPRows));
    const pdu = (uMax - uMin) / nPCols;
    const pdv = (vMax - vMin) / nPRows;

    const tiles = [];
    for (let row = 0; row < nPRows; row++) {
      for (let col = 0; col < nPCols; col++) {
        if (tiles.length >= maxN) break;
        const u0 = uMin + col * pdu, u1 = u0 + pdu;
        const v0 = vMin + row * pdv, v1 = v0 + pdv;
        let wSum = 0, uSum = 0, vSum = 0;
        for (const pc of paintedCells) {
          if (pc.u >= u0 && pc.u < u1 && pc.v >= v0 && pc.v < v1) {
            wSum += pc.w; uSum += pc.u * pc.w; vSum += pc.v * pc.w;
          }
        }
        if (wSum > 0) {
          tiles.push({ u0, u1, v0, v1, aimU: uSum / wSum, aimV: vSum / wSum, weight: wSum, row, col });
        }
      }
    }
    tiles.sort((a, b) => b.weight - a.weight);

    // ----- grid -----
    const aspect = faceH / Math.max(1, faceW);
    let nCols = Math.max(1, Math.round(gridRes / Math.sqrt(aspect)));
    let nRows = Math.max(1, Math.round(gridRes * Math.sqrt(aspect)));
    while (nCols * nRows > maxN) {
      if (nCols > nRows) nCols--; else nRows--;
    }
    const cellU = faceW / nCols;
    const cellV = faceH / nRows;

    // ----- place facets -----
    const surfaces = [];
    const intent = [];
    const notes = [];

    const useTiles = tiles.slice(0, maxN);

    for (let ti = 0; ti < useTiles.length; ti++) {
      const t = useTiles[ti];
      const gridRow = Math.floor(ti / nCols);
      const gridCol = ti % nCols;
      if (gridRow >= nRows) break;

      const fracU = (gridCol + 0.5) / nCols;
      const fracV = (gridRow + 0.5) / nRows;
      const P = V.add(planeOrigin, V.add(
        V.mul(planeUAxis, fracU),
        V.mul(planeVAxis, fracV)
      ));

      if (V.dist(P, L) < keep + 0.1) continue;
      if (!Geo.envInside(envelope, P, -0.01)) continue;

      const toP = V.norm(V.sub(P, L));
      if (V.dot(toP, srcAxis) < 0.02) continue;

      const Z = E.targetUVtoWorld(T, t.aimU, t.aimV);
      const toZ = V.norm(V.sub(Z, P));
      const n = V.norm(V.sub(toZ, toP));
      if (V.dot(n, V.neg(toP)) < 0.05) continue;

      // Facet clip: fill cell with gap
      const gapFrac = 0.1;
      const hxFacet = cellU * (1 - gapFrac) / 2;
      const hyFacet = cellV * (1 - gapFrac) / 2;

      const ex = V.inPlane(n);
      const ey = V.cross(n, ex);
      const corners = [
        V.add(P, V.add(V.mul(ex, -hxFacet), V.mul(ey, -hyFacet))),
        V.add(P, V.add(V.mul(ex,  hxFacet), V.mul(ey, -hyFacet))),
        V.add(P, V.add(V.mul(ex,  hxFacet), V.mul(ey,  hyFacet))),
        V.add(P, V.add(V.mul(ex, -hxFacet), V.mul(ey,  hyFacet))),
      ];

      let allOk = true;
      for (const pt of corners) {
        if (!Geo.envInside(envelope, pt, 0)) { allOk = false; break; }
        if (V.dist(pt, L) < keep) { allOk = false; break; }
      }

      let pts3 = corners;
      if (!allOk) {
        let found = false;
        for (const sf of [0.65, 0.45, 0.3]) {
          const hx2 = cellU * (1 - gapFrac) * sf / 2;
          const hy2 = cellV * (1 - gapFrac) * sf / 2;
          const c2 = [
            V.add(P, V.add(V.mul(ex, -hx2), V.mul(ey, -hy2))),
            V.add(P, V.add(V.mul(ex,  hx2), V.mul(ey, -hy2))),
            V.add(P, V.add(V.mul(ex,  hx2), V.mul(ey,  hy2))),
            V.add(P, V.add(V.mul(ex, -hx2), V.mul(ey,  hy2))),
          ];
          let ok = true;
          for (const pt of c2) {
            if (!Geo.envInside(envelope, pt, 0) || V.dist(pt, L) < keep) { ok = false; break; }
          }
          if (ok) { pts3 = c2; found = true; break; }
        }
        if (!found) continue;
      }

      const id = 'F' + surfaces.length;
      const distToAim = V.dist(P, Z);
      const di = distToAim; // sharp focus at target

      surfaces.push({
        type: 'facet', id,
        P, S0: L, Z, flat: false,
        di: di > 1 ? di : null,
        clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity: limits.reflectivity, twoSided: false },
      });

      const cells = [];
      for (const pc of paintedCells) {
        if (pc.u >= t.u0 && pc.u < t.u1 && pc.v >= t.v0 && pc.v < t.v1) {
          cells.push([pc.j * paintRes + pc.i, pc.w]);
        }
      }
      intent.push({ facet: id, cells });
    }

    notes.push(surfaces.length + ' facets on back plane, r=' + planeR.toFixed(1) + 'mm, ~' + actualImageCells.toFixed(1) + ' cell images');
    notes.push('grid ' + nCols + '×' + nRows + ', cell ' + cellU.toFixed(1) + '×' + cellV.toFixed(1) + 'mm');
    return { surfaces, intent, notes };
}

// ---- static solver ----
RF.Solvers.register({
  id: 'bench-dsv4pro-r2--tile', name: 'Tile v10 (variable depth)', version: '0.10',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'gridRes', label: 'Facets per side', type: 'range', min: 2, max: 14, step: 1, default: 10 },
    { key: 'imageCells', label: 'Target image size (cells)', type: 'range', min: 1, max: 15, step: 0.5, default: 3 },
  ],
  solve(input, settings) { return tileSolve(input, settings); },
});

// ---- tuner (auto) ----
RF.Solvers.register({
  id: 'bench-dsv4pro-r2--tile-auto', name: 'Tile tuner', version: '0.10',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: [
      { value: 'faithful', label: 'Faithful' },
      { value: 'throw', label: 'Throw' },
      { value: 'efficient', label: 'Efficient' },
    ], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const goal = settings.goal || 'faithful';
    const seed = input.seed;
    const traceRays = 20000;

    // Candidate settings to try
    const candidates = [];
    for (const gr of [6, 8, 10, 12]) {
      for (const ic of [1.5, 2.5, 4]) {
        candidates.push({ gridRes: gr, imageCells: ic });
      }
    }
    // Always include the static defaults
    candidates.push({ gridRes: 10, imageCells: 3 });

    // Remove duplicates
    const seen = new Set();
    const unique = [];
    for (const c of candidates) {
      const k = c.gridRes + '/' + c.imageCells;
      if (!seen.has(k)) { seen.add(k); unique.push(c); }
    }

    let best = null;
    let bestScore = -Infinity;
    const notes = [];

    for (const cand of unique) {
      const s = { minDistance: settings.minDistance || 0, gridRes: cand.gridRes, imageCells: cand.imageCells };
      const result = tileSolve(input, s);
      if (!result.surfaces.length) continue;

      const tr = tools.trace(result.surfaces, result.intent, { rays: traceRays, seed });
      if (!tr || !tr.fidelity) continue;

      const f = tr.fidelity.fidelity;
      const within = tr.fidelity.within;
      const gapsDark = tr.fidelity.gapsDark;
      const onPaint = tr.fidelity.onPaint;
      const peakCd = tr.peakCd || 0;
      const light = Math.min(1, onPaint / 0.013); // rough: 0.013 = 10% of reference onPaint
      const F = f * light;

      let score;
      switch (goal) {
        case 'throw':
          // Maximise peak intensity (proxy: peakCd), with a floor on fidelity
          score = Math.log10(Math.max(1, peakCd)) + 0.2 * f;
          break;
        case 'efficient':
          // Balance: fidelity × light delivered
          score = F + 0.1 * Math.log10(Math.max(1, peakCd));
          break;
        case 'faithful':
        default:
          score = F;
          break;
      }

      if (score > bestScore) {
        bestScore = score;
        best = { result, settings: s, trace: tr };
      }
    }

    if (!best) {
      return { surfaces: [], intent: [], notes: ['tuner: no valid candidates'] };
    }

    const tr = best.trace;
    notes.push('tuner goal=' + goal + ', best gridRes=' + best.settings.gridRes + ' imageCells=' + best.settings.imageCells);
    notes.push('fidelity=' + (tr.fidelity.fidelity * 100).toFixed(1) + '% within=' + (tr.fidelity.within * 100).toFixed(1) + '% gapsDark=' + (tr.fidelity.gapsDark * 100).toFixed(1) + '%');
    notes.push('onPaint=' + (tr.fidelity.onPaint * 100).toFixed(1) + '% peak=' + tr.peakCd.toFixed(0) + ' cd');
    best.result.notes = notes;
    return best.result;
  },
});