/* Bundled model solver: Nemotron Ultra, Flux solver benchmark run 2026-09-26 (workspace work-nemotron-ultra-flux-solver-20260926-0436).
 * Copied verbatim from that run's solvers/solver.js (sha256 4a544bf7c521…), wrapped in a function scope so several
 * bundled files can share one worker; id renamed 'paint-solver' → 'paint-solver-nemotron-a' (it collided with a later run).
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
// Flux Paint Solver — static algorithm for faceted reflector design
// Reads a painted target pattern and computes mirror facets to reproduce it.
// No ray tracing inside solve() — pure geometric algorithm.

RF.Solvers.register({
  id: 'paint-solver-nemotron-a',
  name: 'Paint Solver (static)',
  version: '2.3',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetSizeMult', label: 'Facet size multiplier', type: 'range', min: 0.5, max: 3.0, step: 0.1, default: 1.0, help: 'Multiplier for auto-computed facet size' },
    { key: 'curvatureMult', label: 'Curvature multiplier', type: 'range', min: 0.2, max: 3.0, step: 0.1, default: 1.0, help: 'Multiplier for auto-computed curvature' },
    { key: 'gridDensity', label: 'Grid density', type: 'range', min: 1, max: 10, step: 1, default: 5, help: 'How many facet rows/cols per painted feature' },
    { key: 'edgeBoost', label: 'Edge boost', type: 'range', min: 0, max: 5, step: 0.1, default: 0.5, help: 'Extra facets along painted edges' },
    { key: 'faceSelection', label: 'Face selection', type: 'select', options: ['auto', 'maxFlux', 'targetAligned'], default: 'auto', help: 'How to choose primary envelope face' },
    { key: 'faceGrid', label: 'Face grid resolution', type: 'range', min: 4, max: 30, step: 1, default: 16, help: 'Grid resolution on the envelope face for facet placement search' },
    { key: 'inwardOffset', label: 'Inward offset (mm)', type: 'range', min: 0, max: 10, step: 0.1, default: 2.0, help: 'Offset facet center inside envelope to allow for sag' },
    { key: 'overlapMargin', label: 'Overlap margin (mm)', type: 'range', min: 0, max: 10, step: 0.5, default: 2.0, help: 'Extra spacing between facets to prevent overlap' },
  ],

  solve(input, settings) {
    const V = RF.V;
    const Geo = RF.Geo;
    const Engine = RF.Engine;
    const Source = RF.Source;

    const { source, envelope, target, paint, limits, seed } = input;
    const { maxFacets, reflectivity } = limits;
    const minDist = Math.max(envelope.keepOut || 0, settings.minDistance || 0);

    // ---- 0. Compute scene-adaptive parameters ----
    // Auto curvature: weak curvature to reduce blocking, based on spot-to-cell ratio
    // spot = LED_size * distToTarget / r (independent of curvature for fixed target plane)
    // Weak curvature (curvature << 1) makes facets act like collimators, reducing overlap at target
    const targetCellSize = target.size / target.res;
    const LED_size = Math.max(source.w || 0, source.h || 0, source.radius * 2 || 0);
    const LED_pos = source.pos;
    const envCenter = envelope.center;
    const r_est = V.dist(LED_pos, envCenter);
    const distToTarget_est = target.distance;
    
    // Base curvature: weak to reduce overlap at target
    const autoCurvature = (targetCellSize * r_est) / (LED_size * distToTarget_est);
    const curvature = Math.max(0.02, Math.min(0.5, autoCurvature * (settings.curvatureMult || 1.0)));
    
    // Auto facet size: ~2-3x the focal spot diameter
    const spotSize = LED_size * distToTarget_est / r_est; // spot at target (independent of curvature)
    const autoFacetSize = Math.min(spotSize * 2.5, targetCellSize * 8, 60); // cap at 8x target cell or 60mm
    const facetSize = autoFacetSize * (settings.facetSizeMult || 1.0);

    // ---- 1. Analyze the paint pattern ----
    const res = paint.res;
    const cells = paint.cells;
    let paintedCells = [];
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    let totalPaint = 0;

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const w = cells[j * res + i];
        if (w > 0) {
          paintedCells.push({ i, j, w });
          totalPaint += w;
          minU = Math.min(minU, i);
          maxU = Math.max(maxU, i);
          minV = Math.min(minV, j);
          maxV = Math.max(maxV, j);
        }
      }
    }

    if (paintedCells.length === 0) {
      return { surfaces: [], intent: [], notes: ['No painted cells found'] };
    }

    // Target frame
    const T = Engine.targetFrame(target);
    const paintToWorld = (i, j) => {
      const [u, v] = Engine.cellCenter(T, i, j);
      return Engine.targetUVtoWorld(T, u, v);
    };

    // ---- 2. Build envelope faces with flux capture score ----
    const faces = [];
    const S0 = source.pos;
    const envHalf = envelope.half;
    const LED_axis = V.norm(source.axis);

    if (envelope.shape === 'box') {
      const faceDefs = [
        { axis: 0, side: 1, uAxis: 1, vAxis: 2, uSign: -1, vSign: 1, name: '+X' },
        { axis: 0, side: -1, uAxis: 1, vAxis: 2, uSign: -1, vSign: 1, name: '-X' },
        { axis: 1, side: 1, uAxis: 0, vAxis: 2, uSign: 1, vSign: 1, name: '+Y' },
        { axis: 1, side: -1, uAxis: 0, vAxis: 2, uSign: 1, vSign: 1, name: '-Y' },
        { axis: 2, side: 1, uAxis: 0, vAxis: 1, uSign: 1, vSign: -1, name: '+Z' },
        { axis: 2, side: -1, uAxis: 0, vAxis: 1, uSign: 1, vSign: -1, name: '-Z' },
      ];

      for (const fd of faceDefs) {
        const center = envCenter.slice();
        center[fd.axis] += fd.side * envHalf[fd.axis];
        const normal = [0, 0, 0];
        normal[fd.axis] = -fd.side;
        const u = [0, 0, 0]; u[fd.uAxis] = fd.uSign;
        const v = [0, 0, 0]; v[fd.vAxis] = fd.vSign;
        const halfU = envHalf[fd.uAxis];
        const halfV = envHalf[fd.vAxis];

        const d = V.dot(V.sub(S0, center), normal);
        if (d <= 0) continue;

        const S0prime = V.sub(S0, V.mul(normal, 2 * d));
        const fluxAlignment = Math.max(0, -V.dot(normal, LED_axis));
        faces.push({ center, normal, u, v, halfU, halfV, d, S0prime, area: 4 * halfU * halfV, fluxAlignment, name: fd.name });
      }
    } else if (envelope.shape === 'ellipsoid') {
      for (let axis = 0; axis < 3; axis++) {
        for (const side of [-1, 1]) {
          const center = envCenter.slice();
          center[axis] += side * envHalf[axis];
          const normal = [0, 0, 0]; normal[axis] = -side;
          const uAxis = (axis + 1) % 3;
          const vAxis = (axis + 2) % 3;
          const u = [0, 0, 0]; u[uAxis] = 1;
          const v = [0, 0, 0]; v[vAxis] = 1;
          const halfU = envHalf[uAxis];
          const halfV = envHalf[vAxis];
          const d = V.dot(V.sub(S0, center), normal);
          if (d <= 0) continue;
          const S0prime = V.sub(S0, V.mul(normal, 2 * d));
          const fluxAlignment = Math.max(0, -V.dot(normal, LED_axis));
          faces.push({ center, normal, u, v, halfU, halfV, d, S0prime, area: 4 * halfU * halfV, fluxAlignment, name: `axis${axis}${side>0?'+':'-'}` });
        }
      }
    } else {
      const axis = envelope.axis === undefined ? 2 : envelope.axis;
      const uAxis = (axis + 1) % 3;
      const vAxis = (axis + 2) % 3;
      for (const side of [-1, 1]) {
        const center = envCenter.slice();
        center[axis] += side * envHalf[axis];
        const normal = [0, 0, 0]; normal[axis] = -side;
        const u = [0, 0, 0]; u[uAxis] = 1;
        const v = [0, 0, 0]; v[vAxis] = 1;
        const halfU = envHalf[uAxis];
        const halfV = envHalf[vAxis];
        const d = V.dot(V.sub(S0, center), normal);
        if (d <= 0) continue;
        const S0prime = V.sub(S0, V.mul(normal, 2 * d));
        const fluxAlignment = Math.max(0, -V.dot(normal, LED_axis));
        faces.push({ center, normal, u, v, halfU, halfV, d, S0prime, area: Math.PI * halfU * halfV, fluxAlignment, name: `cap${side>0?'+':'-'}` });
      }
    }

    // Select primary face
    faces.sort((a, b) => {
      if (Math.abs(b.fluxAlignment - a.fluxAlignment) > 0.1) return b.fluxAlignment - a.fluxAlignment;
      return a.d - b.d;
    });

    const primaryFace = faces[0];
    if (!primaryFace) {
      return { surfaces: [], intent: [], notes: ['No valid envelope faces found'] };
    }

    // ---- 3. Build face grid with overlap tracking ----
    const targetDist = target.distance;
    const targetSize = target.size;
    const face = primaryFace;

    const faceGridN = settings.faceGrid || 16;
    const stepU = 2 * face.halfU * 0.9 / faceGridN;
    const stepV = 2 * face.halfV * 0.9 / faceGridN;
    const startU = -face.halfU * 0.9 + stepU * 0.5;
    const startV = -face.halfV * 0.9 + stepV * 0.5;

    const faceGrid = [];
    const gridIndex = new Map();
    for (let iu = 0; iu < faceGridN; iu++) {
      for (let iv = 0; iv < faceGridN; iv++) {
        const u = startU + iu * stepU;
        const v = startV + iv * stepV;
        const Pface = V.add(face.center, V.add(V.mul(face.u, u), V.mul(face.v, v)));
        const P = V.add(Pface, V.mul(face.normal, settings.inwardOffset || 2.0));
        if (V.dist(P, source.pos) >= minDist && Geo.envInside(envelope, P, 1e-6)) {
          const idx = faceGrid.length;
          faceGrid.push({ P, Pface, u, v, iu, iv, used: false, blocked: false });
          gridIndex.set(`${iu},${iv}`, idx);
        }
      }
    }

    const maxFacetRadiusEstimate = (facetSize || 24) * 0.5;
    const neighborRadiusGrid = Math.ceil((maxFacetRadiusEstimate * 2 + (settings.overlapMargin || 2.0)) / Math.min(stepU, stepV)) + 1;
    const neighborOffsets = [];
    for (let du = -neighborRadiusGrid; du <= neighborRadiusGrid; du++) {
      for (let dv = -neighborRadiusGrid; dv <= neighborRadiusGrid; dv++) {
        if (du === 0 && dv === 0) continue;
        const dist = Math.sqrt(du * du * stepU * stepU + dv * dv * stepV * stepV);
        if (dist <= maxFacetRadiusEstimate * 2 + (settings.overlapMargin || 2.0)) {
          neighborOffsets.push({ du, dv, dist });
        }
      }
    }

    const surfaces = [];
    const intent = [];
    let facetId = 0;

    paintedCells.sort((a, b) => b.w - a.w);

    function validateFacet(idx, Z, weight, baseSizeMult = 1.0) {
      const fg = faceGrid[idx];
      if (fg.used || fg.blocked) return null;
      const P = fg.P;

      const sv = V.sub(source.pos, P);
      const sh = V.mul(sv, 1 / V.len(sv));
      const ah = V.norm(V.sub(Z, P));
      const n = V.norm(V.add(sh, ah));

      const baseSize = (facetSize || 24) * baseSizeMult;
      const fluxFraction = weight / totalPaint;
      const distToLED = V.dist(P, source.pos);
      const distScale = Math.sqrt(Math.max(0.3, distToLED / (face.d * 2)));
      const sizeScale = Math.sqrt(Math.max(0.1, Math.min(5.0, fluxFraction * faceGridN * faceGridN * 0.5))) * distScale;
      let facetRadius = baseSize * sizeScale * 0.5;

      const beamDir = V.norm(V.sub(Z, P));
      const tToTarget = (targetDist - P[0]) / beamDir[0];
      const distToTarget = tToTarget > 0 ? tToTarget : V.dist(P, Z);
      const di = curvature * distToTarget;

      // Validate: sample disc boundary in facet's tangent plane
      const backDir = V.mul(face.normal, -1);
      let ex = V.sub(backDir, V.mul(n, V.dot(backDir, n)));
      if (V.len(ex) < 0.1) ex = V.sub(face.u, V.mul(n, V.dot(face.u, n)));
      ex = V.norm(ex);
      const ey = V.cross(n, ex);

      let valid = false;
      let finalRadius = 0;
      for (let shrink = 1; shrink <= 8; shrink++) {
        const r = facetRadius / shrink;
        const numSamples = 16;
        let ok = true;
        for (let s = 0; s < numSamples; s++) {
          const ang = (s / numSamples) * 2 * Math.PI;
          const lx = r * Math.cos(ang);
          const ly = r * Math.sin(ang);
          const pt = V.add(P, V.add(V.mul(ex, lx), V.mul(ey, ly)));
          if (!Geo.envInside(envelope, pt, 1e-6)) { ok = false; break; }
          if (V.dist(pt, source.pos) < minDist + 1) { ok = false; break; }
        }
        if (ok) {
          valid = true;
          finalRadius = r;
          break;
        }
      }
      if (!valid) return null;

      return { radius: finalRadius, n, di, ex, ey, P, score: weight * finalRadius * finalRadius / (distToLED * distToLED) };
    }

    function blockNeighbors(idx, radius) {
      const fg = faceGrid[idx];
      const blockDist = radius * 2 + (settings.overlapMargin || 2.0);
      for (const { du, dv, dist } of neighborOffsets) {
        if (dist > blockDist) continue;
        const niu = fg.iu + du;
        const niv = fg.iv + dv;
        const nIdx = gridIndex.get(`${niu},${niv}`);
        if (nIdx !== undefined) {
          faceGrid[nIdx].blocked = true;
        }
      }
    }

    // ---- 4. Main grid placement ----
    for (const pc of paintedCells) {
      if (surfaces.length >= maxFacets) break;

      const Z = paintToWorld(pc.i, pc.j);
      const weight = pc.w;

      let bestIdx = -1, bestResult = null;
      for (let idx = 0; idx < faceGrid.length; idx++) {
        const result = validateFacet(idx, Z, weight, 1.0);
        if (result && result.score > (bestResult ? bestResult.score : -Infinity)) {
          bestResult = result;
          bestIdx = idx;
        }
      }

      if (bestIdx >= 0 && bestResult) {
        const fg = faceGrid[bestIdx];
        fg.used = true;
        blockNeighbors(bestIdx, bestResult.radius);

        const id = `F${facetId++}`;
        surfaces.push({
          type: 'facet',
          id,
          group: 'A',
          P: fg.P,
          S0: source.pos.slice(),
          Z,
          flat: false,
          di: bestResult.di,
          clip: { kind: 'disc', r: bestResult.radius, ref: V.mul(face.normal, -1) },
          optics: { interaction: 'reflect', reflectivity, twoSided: false },
        });

        const intentCells = [];
        const intentRadius = Math.max(1, Math.ceil(bestResult.radius / targetSize * res * 2));
        for (let dj = -intentRadius; dj <= intentRadius; dj++) {
          for (let di = -intentRadius; di <= intentRadius; di++) {
            const ni = pc.i + di, nj = pc.j + dj;
            if (ni >= 0 && ni < res && nj >= 0 && nj < res) {
              const w = cells[nj * res + ni];
              if (w > 0) intentCells.push([nj * res + ni, w]);
            }
          }
        }
        if (intentCells.length > 0) {
          intent.push({ facet: id, cells: intentCells });
        }
      }
    }

    // ---- 5. Edge boost ----
    if (settings.edgeBoost > 0 && surfaces.length < maxFacets) {
      const edgeCells = [];
      for (const pc of paintedCells) {
        let isEdge = false;
        for (let di = -1; di <= 1 && !isEdge; di++) {
          for (let dj = -1; dj <= 1; dj++) {
            if (di === 0 && dj === 0) continue;
            const ni = pc.i + di, nj = pc.j + dj;
            if (ni < 0 || ni >= res || nj < 0 || nj >= res || cells[nj * res + ni] <= 0) {
              isEdge = true; break;
            }
          }
        }
        if (isEdge) edgeCells.push(pc);
      }

      const edgeBudget = Math.min(maxFacets - surfaces.length, Math.ceil(edgeCells.length * settings.edgeBoost));
      for (let ei = 0; ei < edgeBudget && ei < edgeCells.length; ei++) {
        const pc = edgeCells[ei];
        const Z = paintToWorld(pc.i, pc.j);

        let bestIdx = -1, bestResult = null;
        for (let idx = 0; idx < faceGrid.length; idx++) {
          const result = validateFacet(idx, Z, pc.w, 0.6);
          if (result && result.score > (bestResult ? bestResult.score : -Infinity)) {
            bestResult = result;
            bestIdx = idx;
          }
        }

        if (bestIdx >= 0 && bestResult) {
          const fg = faceGrid[bestIdx];
          fg.used = true;
          blockNeighbors(bestIdx, bestResult.radius);

          const id = `F${facetId++}`;
          surfaces.push({
            type: 'facet', id, group: 'A', P: fg.P, S0: source.pos.slice(), Z,
            flat: false, di: bestResult.di,
            clip: { kind: 'disc', r: bestResult.radius, ref: V.mul(face.normal, -1) },
            optics: { interaction: 'reflect', reflectivity, twoSided: false },
          });
          intent.push({ facet: id, cells: [[pc.j * res + pc.i, pc.w]] });
        }
      }
    }

    // ---- 6. Infill ----
    if (surfaces.length < maxFacets) {
      const ci = Math.round((minU + maxU) / 2);
      const cj = Math.round((minV + maxV) / 2);
      const Zcenter = paintToWorld(ci, cj);

      for (let idx = 0; idx < faceGrid.length && surfaces.length < maxFacets; idx++) {
        const result = validateFacet(idx, Zcenter, 1.0, 1.0);
        if (!result) continue;

        const fg = faceGrid[idx];
        fg.used = true;
        blockNeighbors(idx, result.radius);

        const id = `F${facetId++}`;
        surfaces.push({
          type: 'facet', id, group: 'A', P: fg.P, S0: source.pos.slice(), Z: Zcenter,
          flat: false, di: result.di,
          clip: { kind: 'disc', r: result.radius, ref: V.mul(face.normal, -1) },
          optics: { interaction: 'reflect', reflectivity, twoSided: false },
        });
      }
    }

    const notes = [
      `Primary face: ${primaryFace.name} (fluxAlign=${primaryFace.fluxAlignment.toFixed(2)}, d=${primaryFace.d.toFixed(1)}mm)`,
      `Auto curvature: ${curvature.toFixed(3)} (mult=${settings.curvatureMult})`,
      `Auto facet size: ${facetSize.toFixed(1)}mm (mult=${settings.facetSizeMult})`,
      `Spot estimate: ${(LED_size * target.distance / V.dist(source.pos, envCenter)).toFixed(1)}mm, target cell: ${(target.size / target.res).toFixed(1)}mm`,
      `Face grid: ${faceGrid.length} valid positions`,
      `Placed ${surfaces.length} facets on ${primaryFace.name} face`,
      `Paint: ${paintedCells.length}/${res*res} cells, weight ${totalPaint.toFixed(1)}`,
      `Min LED distance: ${minDist}mm`,
    ];

    return { surfaces, intent, notes };
  },
});
})();
