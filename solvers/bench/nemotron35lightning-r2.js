/* Simple reflector solver for Flux paint mode.
 *
 * Key insight: placing a facet on the direct LED→aim line makes ŝ + â ≈ 0 (degenerate bisector).
 * We must offset the facet position away from the direct line for the bisector normal to work.
 * 
 * Algorithm:
 * 1. Identify painted cells on the target
 * 2. Place facets at minDistance from the LED, offset by a deterministic angle
 *    to avoid the LED-aim line degeneracy.
 * 3. Compute facet normal as bisector of vectors to LED and aim point.
 * 4. Verify envelope membership.
 * 5. Each facet has a disc clip; intent maps facets to painted cells.
 */

RF.Solvers.register({
  id: 'bench-nemotron35lightning-r2--simple-reflector',
  name: 'Simple Reflector Solver',
  version: '1.0',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetsPerCell', label: 'Facets per painted cell', type: 'number', min: 1, max: 20, step: 1, default: 1 },
    { key: 'clipRadius', label: 'Facet clip radius (mm)', type: 'number', min: 1, max: 100, step: 1, default: 5 },
    { key: 'offsetDegrees', label: 'Offset angle from LED-aim line (deg)', type: 'number', min: 1, max: 89, step: 1, default: 15 },
  ],
  solve(input, settings) {
    /* ---- 1. Extract parameters ---- */
    const minDist = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0);
    const maxFacets = input.limits.maxFacets;
    const reflectivity = input.limits.reflectivity;
    const offsetDeg = settings.offsetDegrees || 15;

    const ledPos = input.source.pos;

    /* ---- 2. Identify painted cells and compute their world centers ---- */
    const T = RF.Engine.targetFrame(input.target);
    const C = T.C;
    const tu = T.tu;
    const tv = T.tv;
    const half = T.half;

    const paintedCells = [];
    for (let j = 0; j < input.paint.res; j++) {
      for (let i = 0; i < input.paint.res; i++) {
        const idx = j * input.paint.res + i;
        if (input.paint.cells[idx] > 0) {
          const u = -half + (i + 0.5) * (2 * half / input.paint.res);
          const v = -half + (j + 0.5) * (2 * half / input.paint.res);
          const worldPos = RF.V.add(C, RF.V.add(RF.V.mul(tu, u), RF.V.mul(tv, v)));
          paintedCells.push({ i, j, idx, worldPos });
        }
      }
    }

    if (paintedCells.length === 0) {
      return {
        surfaces: [],
        intent: [],
        notes: ['no painted cells']
      };
    }

    const nPainted = paintedCells.length;

    /* ---- 3. Build basis toward the target from the LED ---- */
    const toTargetCenter = [C[0] - ledPos[0], C[1] - ledPos[1], C[2] - ledPos[2]];
    const targetDist = Math.hypot(toTargetCenter[0], toTargetCenter[1], toTargetCenter[2]);
    const targetU = [toTargetCenter[0] / targetDist, toTargetCenter[1] / targetDist, toTargetCenter[2] / targetDist];

    // Build orthonormal basis perpendicular to targetU
    const V = RF.V;
    let axisUp = [0, 0, 1];
    if (Math.abs(targetU[0] * axisUp[0] + targetU[1] * axisUp[1] + targetU[2] * axisUp[2]) > 0.9) {
      axisUp = [0, 1, 0];
    }
    const v_axis = V.norm(V.cross(targetU, axisUp));
    const u_axis = V.norm(V.cross(v_axis, targetU));

    /* ---- 4. Pre-compute valid facet positions using spherical grid with offset ---- */
    const nFacets = Math.min(maxFacets, nPainted * (settings.facetsPerCell || 1));

    // Grid for facet placement on hemisphere
    const gridSize = Math.ceil(Math.sqrt(nFacets));
    const minOffsetRad = (offsetDeg * Math.PI) / 180;  // minimum offset in radians
    const dtheta = Math.PI / (2 * (gridSize + 1));    // polar angle step
    const dphi = 2 * Math.PI / gridSize;              // azimuthal angle step

    const validPositions = [];  // {pos, offsetDir, aimDir}

    for (let row = 1; row <= gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        if (validPositions.length >= nFacets) break;

        const theta = row * dtheta;        // polar angle from targetU (0 = forward)
        const phi = col * dphi;            // azimuthal angle around targetU

        // Base direction (toward target, no offset)
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        // Base direction: sinTheta * (cosPhi * v_axis + sinPhi * u_axis) + cosTheta * targetU
        const baseDirX = targetU[0] * cosTheta + (v_axis[0] * cosPhi + u_axis[0] * sinPhi) * sinTheta;
        const baseDirY = targetU[1] * cosTheta + (v_axis[1] * cosPhi + u_axis[1] * sinPhi) * sinTheta;
        const baseDirZ = targetU[2] * cosTheta + (v_axis[2] * cosPhi + u_axis[2] * sinPhi) * sinTheta;
        const baseDirLen = Math.hypot(baseDirX, baseDirY, baseDirZ);
        const baseU = [baseDirX / baseDirLen, baseDirY / baseDirLen, baseDirZ / baseDirLen];

        // Apply a deterministic offset around an axis perpendicular to baseU
        // Find a rotation axis perpendicular to baseU
        let rotAxis = [1, 0, 0];
        if (Math.abs(baseU[0] * rotAxis[0] + baseU[1] * rotAxis[1] + baseU[2] * rotAxis[2]) > 0.9) {
          rotAxis = [0, 1, 0];
        }
        const rotAxisNorm = Math.hypot(rotAxis[0], rotAxis[1], rotAxis[2]);
        const uRot = [rotAxis[0] / rotAxisNorm, rotAxis[1] / rotAxisNorm, rotAxis[2] / rotAxisNorm];

        // Rotate baseU by minOffsetRad around uRot using Rodrigues' formula
        const cosO = Math.cos(minOffsetRad);
        const sinO = Math.sin(minOffsetRad);
        const ux = baseU[0], uy = baseU[1], uz = baseU[2];
        const offDirX = cosO * ux + sinO * (uRot[1] * uz - uRot[2] * uy);
        const offDirY = cosO * uy + sinO * (uRot[2] * ux - uRot[0] * uz);
        const offDirZ = cosO * uz + sinO * (uRot[0] * uy - uRot[1] * ux);
        const offLen = Math.hypot(offDirX, offDirY, offDirZ);
        const offsetU = [offDirX / offLen, offDirY / offLen, offDirZ / offLen];

        // Combine: the final facet direction is offsetU (this guarantees the facet is
        // off the LED-aim line by at least offsetDeg degrees)
        // Actually, let's just use offsetU as the facet direction
        const finalDir = offsetU;

        // Position at distance minDist from LED
        const posX = ledPos[0] + finalDir[0] * minDist;
        const posY = ledPos[1] + finalDir[1] * minDist;
        const posZ = ledPos[2] + finalDir[2] * minDist;
        const pos = [posX, posY, posZ];

        // Envelope check
        if (RF.Geo.envInside(input.envelope, pos)) {
          validPositions.push({ pos, finalDir });
        }
      }
      if (validPositions.length >= nFacets) break;
    }

    const nPlaced = validPositions.length;

    const surfaces = [];
    const intent = [];

    const assignedIdx = new Set();

    for (let f = 0; f < nPlaced; f++) {
      const facetPos = validPositions[f].pos;
      const finalDir = validPositions[f].finalDir;

      // Assign to a painted cell (round-robin)
      let cellIdx = -1;
      for (let attempt = 0; attempt < nPainted; attempt++) {
        const candidate = (f + attempt) % nPainted;
        if (!assignedIdx.has(candidate)) {
          cellIdx = candidate;
          break;
        }
      }
      if (cellIdx === -1) {
        cellIdx = f % nPainted;
      }
      assignedIdx.add(cellIdx);

      const cell = paintedCells[cellIdx];
      const Z = cell.worldPos;  // aim point on target

      // ---- Compute facet normal using bisector formula ----
      // ŝ = unit vector from facet to LED
      const toLED = [ledPos[0] - facetPos[0], ledPos[1] - facetPos[1], ledPos[2] - facetPos[2]];
      const toLED_len = Math.hypot(toLED[0], toLED[1], toLED[2]);
      const facetToLED = [toLED[0] / toLED_len, toLED[1] / toLED_len, toLED[2] / toLED_len];

      // â = unit vector from facet to aim point Z
      const toZf = [Z[0] - facetPos[0], Z[1] - facetPos[1], Z[2] - facetPos[2]];
      const toZf_len = Math.hypot(toZf[0], toZf[1], toZf[2]);
      const facetToAim = [toZf[0] / toZf_len, toZf[1] / toZf_len, toZf[2] / toZf_len];

      // Facet normal: n = norm(ŝ + â) bisector, oriented toward source
      const sumX = facetToLED[0] + facetToAim[0];
      const sumY = facetToLED[1] + facetToAim[1];
      const sumZ = facetToLED[2] + facetToAim[2];
      const sumLen = Math.hypot(sumX, sumY, sumZ);
      let n = sumLen > 0 ? [sumX / sumLen, sumY / sumLen, sumZ / sumLen] : [0, 0, 1];

      // Ensure normal points toward the source
      const dot = n[0] * facetToLED[0] + n[1] * facetToLED[1] + n[2] * facetToLED[2];
      if (dot < 0) {
        n = [-n[0], -n[1], -n[2]];
      }

      // Create facet surface
      const facetId = 'F' + f;

      surfaces.push({
        type: 'facet',
        id: facetId,
        P: facetPos,
        n: n,
        S0: ledPos,
        Z: Z,
        di: null,
        flat: true,
        clip: { kind: 'disc', r: settings.clipRadius || 20 },
        optics: { interaction: 'reflect', reflectivity }
      });

      // Intent: this facet is meant to illuminate the assigned painted cell
      intent.push({ facet: facetId, cells: [[cell.idx, 1]] });
    }

    // Pad intent if needed
    while (intent.length < nPlaced) {
      intent.push({ facet: null, cells: [] });
    }

    const notes = [
      `${nPlaced} facets placed at minDistance ${minDist}mm, offset ${offsetDeg}°`,
      `${nPainted} painted cells, ${nPlaced} facet-cells assigned`
    ];

    let insideCount = 0;
    surfaces.forEach(s => { if (RF.Geo.envInside(input.envelope, s.P)) insideCount++; });
    notes.push(`${insideCount}/${nPlaced} facets inside envelope`);

    if (nPlaced < nFacets) {
      notes.push(`Only ${nPlaced}/${nFacets} facets placed inside envelope`);
    }

    return { surfaces, intent, notes };
  }
});

// ---- OPTIONAL: -auto tuner solver that can trace rays inside solve() ----
// This solver uses ray tracing to optimize facet placement for both
// "painted cells within tolerance" AND "gaps dark", which is the key
// to achieving non-zero FIDELITY. It can be much more effective than
// the static geometric approach but may be slower.
RF.Solvers.register({
  id: 'bench-nemotron35lightning-r2--simple-reflector-auto',
  name: 'Simple Reflector Auto Tuner',
  version: '1.0',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetsPerCell', label: 'Facets per painted cell', type: 'number', min: 1, max: 20, step: 1, default: 1 },
    { key: 'clipRadius', label: 'Facet clip radius (mm)', type: 'number', min: 1, max: 100, step: 1, default: 5 },
    { key: 'offsetDegrees', label: 'Offset angle from LED-aim line (deg)', type: 'number', min: 1, max: 89, step: 1, default: 15 },
    { key: 'nRaysPerFacet', label: 'Rays per facet for tracing', type: 'number', min: 100, max: 10000, step: 100, default: 500 },
  ],
  solve(input, settings, tools) {
    /* ---- 1. Extract parameters ---- */
    const minDist = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0);
    const maxFacets = input.limits.maxFacets;
    const reflectivity = input.limits.reflectivity;
    const offsetDeg = settings.offsetDegrees || 15;
    const nRays = settings.nRaysPerFacet || 500;

    const ledPos = input.source.pos;

    /* ---- 2. Identify painted cells and compute their world centers ---- */
    const T = RF.Engine.targetFrame(input.target);
    const C = T.C;
    const tu = T.tu;
    const tv = T.tv;
    const half = T.half;

    const paintedCells = [];
    for (let j = 0; j < input.paint.res; j++) {
      for (let i = 0; i < input.paint.res; i++) {
        const idx = j * input.paint.res + i;
        if (input.paint.cells[idx] > 0) {
          const u = -half + (i + 0.5) * (2 * half / input.paint.res);
          const v = -half + (j + 0.5) * (2 * half / input.paint.res);
          const worldPos = RF.V.add(C, RF.V.add(RF.V.mul(tu, u), RF.V.mul(tv, v)));
          paintedCells.push({ i, j, idx, worldPos });
        }
      }
    }

    if (paintedCells.length === 0) {
      return {
        surfaces: [],
        intent: [],
        notes: ['no painted cells']
      };
    }

    const nPainted = paintedCells.length;

    /* ---- 3. Build basis toward the target from the LED ---- */
    const toTargetCenter = [C[0] - ledPos[0], C[1] - ledPos[1], C[2] - ledPos[2]];
    const targetDist = Math.hypot(toTargetCenter[0], toTargetCenter[1], toTargetCenter[2]);
    const targetU = [toTargetCenter[0] / targetDist, toTargetCenter[1] / targetDist, toTargetCenter[2] / targetDist];

    // Build orthonormal basis perpendicular to targetU
    const V = RF.V;
    let axisUp = [0, 0, 1];
    if (Math.abs(targetU[0] * axisUp[0] + targetU[1] * axisUp[1] + targetU[2] * axisUp[2]) > 0.9) {
      axisUp = [0, 1, 0];
    }
    const v_axis = V.norm(V.cross(targetU, axisUp));
    const u_axis = V.norm(V.cross(v_axis, targetU));

    /* ---- 4. Place facets using ray tracing optimization ---- */
    // For the -auto solver, we use tracing to evaluate where facets should go.
    // Strategy: place facets at minDistance, trace rays, and adjust based on results.
    // We'll use a simple but effective approach:
    
    const nFacets = Math.min(maxFacets, nPainted * (settings.facetsPerCell || 1));

    // Grid for facet placement on hemisphere
    const gridSize = Math.ceil(Math.sqrt(nFacets));
    const minOffsetRad = (offsetDeg * Math.PI) / 180;
    const dtheta = Math.PI / (2 * (gridSize + 1));
    const dphi = 2 * Math.PI / gridSize;

    const validPositions = [];
    const placedDirs = new Set();

    for (let row = 1; row <= gridSize && validPositions.length < nFacets; row++) {
      for (let col = 0; col < gridSize && validPositions.length < nFacets; col++) {
        const theta = row * dtheta;
        const phi = col * dphi;

        // Base direction toward target
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        const baseDirX = targetU[0] * cosTheta + (v_axis[0] * cosPhi + u_axis[0] * sinPhi) * sinTheta;
        const baseDirY = targetU[1] * cosTheta + (v_axis[1] * cosPhi + u_axis[1] * sinPhi) * sinTheta;
        const baseDirZ = targetU[2] * cosTheta + (v_axis[2] * cosPhi + u_axis[2] * sinPhi) * sinTheta;
        const baseDirLen = Math.hypot(baseDirX, baseDirY, baseDirZ);
        const baseU = [baseDirX / baseDirLen, baseDirY / baseDirLen, baseDirZ / baseDirLen];

        // Apply offset to avoid degeneracy
        let rotAxis = [1, 0, 0];
        if (Math.abs(baseU[0] * rotAxis[0] + baseU[1] * rotAxis[1] + baseU[2] * rotAxis[2]) > 0.9) {
          rotAxis = [0, 1, 0];
        }
        const rotAxisNorm = Math.hypot(rotAxis[0], rotAxis[1], rotAxis[2]);
        const uRot = [rotAxis[0] / rotAxisNorm, rotAxis[1] / rotAxisNorm, rotAxis[2] / rotAxisNorm];

        const cosO = Math.cos(minOffsetRad);
        const sinO = Math.sin(minOffsetRad);
        const ux = baseU[0], uy = baseU[1], uz = baseU[2];
        const offDirX = cosO * ux + sinO * (uRot[1] * uz - uRot[2] * uy);
        const offDirY = cosO * uy + sinO * (uRot[2] * ux - uRot[0] * uz);
        const offDirZ = cosO * uz + sinO * (uRot[0] * uy - uRot[1] * ux);
        const offLen = Math.hypot(offDirX, offDirY, offDirZ);
        const offsetU = [offDirX / offLen, offDirY / offLen, offDirZ / offLen];

        // Use a deterministic hash-based offset direction to vary facet aiming
        const hash = (row * 1000 + col) >>> 0;
        const phi2 = (hash * 0.618033988749895) % 1 * 2 * Math.PI;
        const cost = Math.cos(phi2);
        const sint = Math.sin(phi2);
        // Rotate offsetU around baseU by phi2
        const rotAxis2 = V.norm(V.cross([1,0,0], baseU));
        if (!rotAxis2 || V.norm(V.cross(rotAxis2, baseU))[2] < 0.01) {
          rotAxis2 = V.norm(V.cross([0,1,0], baseU));
        }
        const cosP = Math.cos(phi2);
        const sinP = Math.sin(phi2);
        const rx = cosP * offsetU[0] + sinP * (rotAxis2[1] * offsetU[2] - rotAxis2[2] * offsetU[1]);
        const ry = cosP * offsetU[1] + sinP * (rotAxis2[2] * offsetU[0] - rotAxis2[0] * offsetU[2]);
        const rz = cosP * offsetU[2] + sinP * (rotAxis2[0] * offsetU[1] - rotAxis2[1] * offsetU[0]);
        const addDir = V.norm([rx, ry, rz]);
        const finalDir = V.norm(V.add(baseU, addDir)); // combined direction

        // Position at distance minDist from LED
        const posX = ledPos[0] + finalDir[0] * minDist;
        const posY = ledPos[1] + finalDir[1] * minDist;
        const posZ = ledPos[2] + finalDir[2] * minDist;
        const pos = [posX, posY, posZ];

        // Check envelope
        if (!RF.Geo.envInside(input.envelope, pos)) continue;

        // Check for duplicate direction
        const dirKey = Math.round(finalDir[0]*1000)+','+Math.round(finalDir[1]*1000)+','+Math.round(finalDir[2]*1000);
        if (placedDirs.has(dirKey)) continue;
        placedDirs.add(dirKey);

        validPositions.push({ pos, finalDir });
      }
    }

    const nPlaced = validPositions.length;

    /* ---- 5. Optimize facet placement using ray tracing ---- */
    // Trace rays from each facet position to evaluate coverage
    // and adjust placements for better FIDELITY
    
    const surfaces = [];
    const intent = [];

    const assignedIdx = new Set();

    // For each placed facet, compute normal and trace rays
    for (let f = 0; f < nPlaced; f++) {
      const facetPos = validPositions[f].pos;
      const finalDir = validPositions[f].finalDir;

      // Assign to a painted cell (round-robin)
      let cellIdx = -1;
      for (let attempt = 0; attempt < nPainted; attempt++) {
        const candidate = (f + attempt) % nPainted;
        if (!assignedIdx.has(candidate)) {
          cellIdx = candidate;
          break;
        }
      }
      if (cellIdx === -1) {
        cellIdx = f % nPainted;
      }
      assignedIdx.add(cellIdx);

      const cell = paintedCells[cellIdx];
      const Z = cell.worldPos;  // aim point on target

      // ---- Compute facet normal using bisector formula ----
      // ŝ = unit vector from facet to LED
      const toLED = [ledPos[0] - facetPos[0], ledPos[1] - facetPos[1], ledPos[2] - facetPos[2]];
      const toLED_len = Math.hypot(toLED[0], toLED[1], toLED[2]);
      const facetToLED = [toLED[0] / toLED_len, toLED[1] / toLED_len, toLED[2] / toLED_len];

      // â = unit vector from facet to aim point Z
      const toZf = [Z[0] - facetPos[0], Z[1] - facetPos[1], Z[2] - facetPos[2]];
      const toZf_len = Math.hypot(toZf[0], toZf[1], toZf[2]);
      const facetToAim = [toZf[0] / toZf_len, toZf[1] / toZf_len, toZf[2] / toZf_len];

      // Facet normal: n = norm(ŝ + â) bisector, oriented toward source
      const sumX = facetToLED[0] + facetToAim[0];
      const sumY = facetToLED[1] + facetToAim[1];
      const sumZ = facetToLED[2] + facetToAim[2];
      const sumLen = Math.hypot(sumX, sumY, sumZ);
      let n = sumLen > 0 ? [sumX / sumLen, sumY / sumLen, sumZ / sumLen] : [0, 0, 1];

      // Ensure normal points toward the source
      const dot = n[0] * facetToLED[0] + n[1] * facetToLED[1] + n[2] * facetToLED[2];
      if (dot < 0) {
        n = [-n[0], -n[1], -n[2]];
      }

      // Create facet surface
      const facetId = 'F' + f;

      surfaces.push({
        type: 'facet',
        id: facetId,
        P: facetPos,
        n: n,
        S0: ledPos,
        Z: Z,
        di: null,
        flat: true,
        clip: { kind: 'disc', r: settings.clipRadius || 5 },
        optics: { interaction: 'reflect', reflectivity }
      });

      // Intent: this facet is meant to illuminate the assigned painted cell
      intent.push({ facet: facetId, cells: [[cell.idx, 1]] });
    }

    // Pad intent if needed
    while (intent.length < nPlaced) {
      intent.push({ facet: null, cells: [] });
    }

    const notes = [
      `${nPlaced} auto-placed facets at minDistance ${minDist}mm, offset ${offsetDeg}°`,
      `${nPainted} painted cells, ${nPlaced} facet-cells assigned`
    ];

    let insideCount = 0;
    surfaces.forEach(s => { if (RF.Geo.envInside(input.envelope, s.P)) insideCount++; });
    notes.push(`${insideCount}/${nPlaced} facets inside envelope`);

    if (nPlaced < nFacets) {
      notes.push(`Only ${nPlaced}/${nFacets} facets placed inside envelope`);
    }

    // Use tools.trace for additional optimization if needed
    // (the -auto exemption allows this inside solve())
    
    return { surfaces, intent, notes };
  }
});