/* Flux Paint Solver — static geometric algorithm
 *
 * Approach:
 * 1. Analyze the painted target to find lit regions using grid-based clustering.
 * 2. Generate candidate facet positions on a spherical shell in the LED's emission
 *    hemisphere, biased toward the target direction.
 *    All facets at same distance from LED → no self-shadowing from distance differences.
 * 3. Greedily place facets for each cluster, choosing candidates that:
 *    - Reflect toward the cluster centroid
 *    - Have good angular separation from already-placed facets (avoid shadowing)
 *    - Fit within the envelope and LED clearance
 * 4. Set curvature to focus the LED image at the target point.
 * 5. Deterministic: same input always produces same output.
 */
RF.Solvers.register({
  id: 'bench-nemotron3ultra--geom-paint', name: 'Geometric Paint Solver', version: '0.19.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'clusterSize', label: 'Target cluster size (cells)', type: 'number', min: 1, max: 20, step: 0.5, default: 6 },
    { key: 'facetSizeFrac', label: 'Facet size fraction of ideal', type: 'range', min: 0.2, max: 2.0, step: 0.05, default: 0.2 },
    { key: 'maxFacetSize', label: 'Max facet radius (mm)', type: 'number', min: 1, max: 100, step: 1, default: 15 },
    { key: 'curvatureMode', label: 'Curvature', type: 'select', options: ['sharp', 'soft', 'collimated', 'flat'], default: 'soft' },
    { key: 'shellDistance', label: 'Facet shell distance fraction of envelope', type: 'range', min: 0.3, max: 1.0, step: 0.05, default: 1.0 },
    { key: 'candidateCount', label: 'Candidate positions on shell', type: 'number', min: 50, max: 500, step: 10, default: 500 },
    { key: 'minClusterRadius', label: 'Min cluster radius (cells)', type: 'number', min: 0.5, max: 5, step: 0.5, default: 2 },
    { key: 'angularSeparation', label: 'Min angular separation from placed facets (deg)', type: 'number', min: 0, max: 30, step: 1, default: 20 },
    { key: 'emissionBias', label: 'Bias candidates toward emission axis (0-1)', type: 'range', min: 0, max: 1, step: 0.1, default: 0.5 },
  ],
  solve(input, settings, tools) {
    const V = RF.V;
    const U = RF.U;
    const Geo = RF.Geo;

    // ---------- helpers ----------
    const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

    // Check if a facet of given half-extents fits at position P with normal n aiming at Z
    function checkFacetFit(P, n, Z, hx, hy, envelope, S0, effectiveMinDist) {
      const ref = V.inPlane(n, Z);
      const ex = V.norm(V.sub(ref, V.mul(n, V.dot(ref, n))));
      const ey = V.cross(n, ex);
      const pts3 = [
        V.add(P, V.add(V.mul(ex, -hx), V.mul(ey, -hy))),
        V.add(P, V.add(V.mul(ex, hx), V.mul(ey, -hy))),
        V.add(P, V.add(V.mul(ex, hx), V.mul(ey, hy))),
        V.add(P, V.add(V.mul(ex, -hx), V.mul(ey, hy))),
      ];
      for (const pt of pts3) {
        if (!Geo.envInside(envelope, pt, 1e-6) || V.dist(pt, S0) < effectiveMinDist) {
          return false;
        }
      }
      return true;
    }

    // Find max facet half-extent (square) that fits at P with normal n aiming at Z
    function findMaxFacetSize(P, n, Z, envelope, S0, effectiveMinDist, maxFacetSize) {
      let lo = 0, hi = maxFacetSize;
      for (let iter = 0; iter < 12; iter++) {
        const mid = (lo + hi) / 2;
        if (checkFacetFit(P, n, Z, mid, mid, envelope, S0, effectiveMinDist)) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      return lo;
    }

    // ---------- read problem ----------
    const source = input.source;
    const envelope = input.envelope;
    const target = input.target;
    const paint = input.paint.cells;
    const paintRes = input.paint.res;
    const maxFacets = input.limits.maxFacets;
    const reflectivity = input.limits.reflectivity;
    const seed = input.seed | 0;

    // LED properties
    const S0 = source.pos;
    const ledAxis = V.norm(source.axis);
    const ledSize = source.shape === 'disc'
      ? 2 * source.radius
      : Math.min(source.w, source.h);

    // Target frame
    const T = RF.Engine.targetFrame(target);
    const cellSize = 2 * T.half / paintRes;
    const targetDistance = target.distance;

    // Effective minimum distance from LED (hard constraint)
    const effectiveMinDist = Math.max(envelope.keepOut || 0, settings.minDistance || 0);

    // Envelope bounds
    const envC = envelope.center, envH = envelope.half;

    // Deterministic RNG from seed
    let rngState = seed;
    const rand = () => {
      rngState = (rngState + 0x6D2B79F5) | 0;
      let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // ---------- find painted clusters using regular grid ----------
    const clusterSize = settings.clusterSize;
    const clusters = [];
    const clusterMap = new Map();

    for (let j = 0; j < paintRes; j++) {
      for (let i = 0; i < paintRes; i++) {
        const w = paint[j * paintRes + i];
        if (w <= 0) continue;

        const u = -T.half + (i + 0.5) * cellSize;
        const v = -T.half + (j + 0.5) * cellSize;

        const cx = Math.floor((u + T.half) / (clusterSize * cellSize));
        const cy = Math.floor((v + T.half) / (clusterSize * cellSize));
        const key = `${cx},${cy}`;

        let idx = clusterMap.get(key);
        if (idx === undefined) {
          idx = clusters.length;
          clusterMap.set(key, idx);
          clusters.push({
            cx, cy,
            sumU: 0, sumV: 0, sumW: 0,
            members: [],
            minU: u, maxU: u, minV: v, maxV: v,
          });
        }

        const cl = clusters[idx];
        cl.sumU += u * w;
        cl.sumV += v * w;
        cl.sumW += w;
        cl.members.push({ i, j, u, v, w });
        cl.minU = Math.min(cl.minU, u);
        cl.maxU = Math.max(cl.maxU, u);
        cl.minV = Math.min(cl.minV, v);
        cl.maxV = Math.max(cl.maxV, v);
      }
    }

    for (const cl of clusters) {
      cl.u = cl.sumU / cl.sumW;
      cl.v = cl.sumV / cl.sumW;
      cl.weight = cl.sumW;
      cl.radius = Math.max(
        (cl.maxU - cl.minU) / 2,
        (cl.maxV - cl.minV) / 2
      );
      cl.radius = Math.max(cl.radius, settings.minClusterRadius * cellSize);
    }

    clusters.sort((a, b) => b.weight - a.weight);
    const selectedClusters = clusters.slice(0, maxFacets);
    const numFacets = selectedClusters.length;

    if (numFacets === 0) {
      return { surfaces: [], intent: [], notes: ['No painted cells'] };
    }

    // ---------- generate candidate facet positions on a spherical shell ----------
    // All facets at same distance from LED → no self-shadowing from distance differences
    // Shell is in the LED's emission hemisphere, biased toward target
    const candidates = [];
    const numCandidates = settings.candidateCount;

    // Target direction from LED
    const toTargetCenter = V.norm(V.sub(T.C, S0));
    // LED emission axis (already declared above as ledAxis)

    // Shell distance: fraction of envelope size, but at least minDist
    const envRadius = Math.min(envH[0], envH[1], envH[2]);
    const shellDist = Math.max(effectiveMinDist, envRadius * settings.shellDistance);

    // Bias direction: blend between LED axis and target direction
    const biasDir = V.norm(V.add(
      V.mul(ledAxis, settings.emissionBias),
      V.mul(V.norm(V.sub(T.C, S0)), 1 - settings.emissionBias)
    ));

    // Fibonacci sphere sampling on hemisphere (emission side, cos > 0 from axis)
    for (let c = 0; c < numCandidates; c++) {
      const phi = 2 * Math.PI * c / numCandidates;
      // cosTheta from 0 to 1: hemisphere toward biasDir
      const cosTheta = (c + 0.5) / numCandidates; // 0 to 1
      const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);

      // Local coordinates: z-axis = biasDir
      const localDir = [
        sinTheta * Math.cos(phi),
        sinTheta * Math.sin(phi),
        cosTheta
      ];

      // Transform to world: z -> biasDir
      const [u, v] = V.basis(biasDir);
      const worldDir = V.add(
        V.add(V.mul(u, localDir[0]), V.mul(v, localDir[1])),
        V.mul(biasDir, localDir[2])
      );

      // Ensure in emission hemisphere (axisCos > 0)
      const axisCos = V.dot(worldDir, ledAxis);
      if (axisCos <= 0) continue;

      const P = V.add(S0, V.mul(worldDir, shellDist));

      // Check envelope
      if (!Geo.envInside(envelope, P, 1e-6)) continue;

      // Check LED clearance
      if (V.dist(P, S0) < effectiveMinDist) continue;

      // Margin from envelope walls
      const margin = Math.min(
        (envH[0] - Math.abs(P[0] - envC[0])) / envH[0],
        (envH[1] - Math.abs(P[1] - envC[1])) / envH[1],
        (envH[2] - Math.abs(P[2] - envC[2])) / envH[2]
      );

      candidates.push({ P, d: shellDist, axisCos, biasScore: V.dot(worldDir, V.norm(V.sub(T.C, S0))), margin, fromLED: worldDir });
    }

    // Sort by axisCos (more on-axis) then biasScore then margin
    candidates.sort((a, b) => {
      const sa = a.axisCos * 0.5 + a.biasScore * 0.3 + a.margin * 0.2;
      const sb = b.axisCos * 0.5 + b.biasScore * 0.3 + b.margin * 0.2;
      return sb - sa;
    });

    // Limit candidates
    const maxCandidates = Math.min(300, candidates.length);
    const topCandidates = candidates.slice(0, maxCandidates);

    // ---------- place facets for each cluster ----------
    const surfaces = [];
    const intent = [];
    const notes = [];
    const usedCandidates = new Set();
    const placedFacets = []; // { P, n, fromLED }

    const totalPaint = clusters.reduce((s, c) => s + c.weight, 0);
    const minSepAngle = settings.angularSeparation * Math.PI / 180;

    for (let ci = 0; ci < numFacets; ci++) {
      const cl = selectedClusters[ci];
      const Z = RF.Engine.targetUVtoWorld(T, cl.u, cl.v);

      // Find best candidate for this cluster
      let bestIdx = -1, bestP = null, bestN = null, bestScore = -Infinity;

      for (let cIdx = 0; cIdx < topCandidates.length; cIdx++) {
        if (usedCandidates.has(cIdx)) continue;

        const cand = topCandidates[cIdx];
        const P = cand.P;

        // Compute normal for reflection S0 -> P -> Z
        const d_in = V.norm(V.sub(P, S0));
        const d_out = V.norm(V.sub(Z, P));
        const n = V.norm(V.sub(d_out, d_in));

        // Must face LED
        if (V.dot(n, d_in) >= 0) continue;

        // Check reflection quality
        const reflected = V.reflect(d_in, n);
        const aimQuality = V.dot(reflected, d_out);

        if (aimQuality < 0.6) continue;

        // Quick check: can a minimal facet (2mm) fit here?
        if (!checkFacetFit(P, n, Z, 2, 2, envelope, S0, effectiveMinDist)) continue;

        // Check angular separation from already-placed facets
        let tooClose = false;
        for (const pf of placedFacets) {
          const angle = Math.acos(clamp(V.dot(cand.fromLED, pf.fromLED), -1, 1));
          if (angle < minSepAngle) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        // Score: aim quality + axisCos + biasScore
        const score = aimQuality * 0.6 + cand.axisCos * 0.2 + cand.biasScore * 0.2;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = cIdx;
          bestP = P;
          bestN = n;
        }
      }

      // Fallback: lower threshold, ignore angular separation
      if (bestIdx < 0) {
        for (let cIdx = 0; cIdx < topCandidates.length; cIdx++) {
          if (usedCandidates.has(cIdx)) continue;
          const cand = topCandidates[cIdx];
          const P = cand.P;
          const d_in = V.norm(V.sub(P, S0));
          const d_out = V.norm(V.sub(Z, P));
          const n = V.norm(V.sub(d_out, d_in));
          if (V.dot(n, d_in) >= 0) continue;
          const reflected = V.reflect(d_in, n);
          const aimQuality = V.dot(reflected, d_out);
          if (aimQuality < 0.3) continue;
          if (!checkFacetFit(P, n, Z, 2, 2, envelope, S0, effectiveMinDist)) continue;
          const score = aimQuality;
          if (score > bestScore) {
            bestScore = score;
            bestIdx = cIdx;
            bestP = P;
            bestN = n;
          }
        }
      }

      if (bestIdx < 0) {
        notes.push(`Cluster ${ci}: no valid facet position`);
        continue;
      }

      usedCandidates.add(bestIdx);

      // Recompute for chosen candidate
      const d_in = V.norm(V.sub(bestP, S0));
      const d_out = V.norm(V.sub(Z, bestP));
      const n = V.norm(V.sub(d_out, d_in));

      const r = V.dist(bestP, S0);
      if (!isFinite(r) || r < effectiveMinDist) {
        notes.push(`Cluster ${ci}: invalid r=${r}`);
        continue;
      }

      // ---------- determine facet size ----------
      const fluxShare = cl.weight / totalPaint;
      if (!isFinite(fluxShare) || fluxShare <= 0) {
        notes.push(`Cluster ${ci}: invalid fluxShare=${fluxShare}`);
        continue;
      }
      const solidAngle = fluxShare * Math.PI;
      let facetArea = solidAngle * r * r;
      if (!isFinite(facetArea) || facetArea <= 0) {
        notes.push(`Cluster ${ci}: invalid facetArea1=${facetArea}`);
        continue;
      }

      // Also consider the angular size of the cluster at the target
      const clusterAngularSize = 2 * cl.radius * cellSize / targetDistance;
      const idealFacetArea = clusterAngularSize * clusterAngularSize * targetDistance * targetDistance / 4;

      // Use the smaller of flux-based and cluster-size-based area, but don't go below flux-based
      facetArea = Math.max(facetArea, idealFacetArea * 0.5);
      facetArea = Math.min(facetArea, idealFacetArea * 3);
      if (!isFinite(facetArea) || facetArea <= 0) {
        notes.push(`Cluster ${ci}: invalid facetArea2=${facetArea}`);
        continue;
      }

      // Find max facet size that fits at this position
      const maxFit = findMaxFacetSize(bestP, n, Z, envelope, S0, effectiveMinDist, settings.maxFacetSize);
      if (!isFinite(maxFit) || maxFit < 0) {
        notes.push(`Cluster ${ci}: invalid maxFit=${maxFit}`);
        continue;
      }
      const maxArea = Math.PI * maxFit * maxFit;
      facetArea = Math.min(facetArea, maxArea);
      facetArea = Math.max(facetArea, 1);
      if (!isFinite(facetArea) || facetArea <= 0) {
        notes.push(`Cluster ${ci}: invalid facetArea3=${facetArea}`);
        continue;
      }

      const facetRadius = Math.sqrt(facetArea / Math.PI);
      if (!isFinite(facetRadius) || facetRadius <= 0) {
        notes.push(`Cluster ${ci}: invalid facetRadius=${facetRadius}`);
        continue;
      }
      const hx = Math.min(facetRadius * settings.facetSizeFrac, maxFit);
      const hy = hx; // square facets for simplicity and robustness
      if (!isFinite(hx) || hx <= 0) {
        notes.push(`Cluster ${ci}: invalid hx=${hx}`);
        continue;
      }

      // ---------- determine curvature ----------
      let di = null;
      let flat = false;

      const distToTarget = V.dist(bestP, Z);

      if (settings.curvatureMode === 'collimated') {
        di = Infinity;
      } else if (settings.curvatureMode === 'flat') {
        flat = true;
      } else {
        // Sharp: focus exactly at target point
        di = distToTarget;
        const imageSize = ledSize * (di / r);
        const desiredSize = 2 * cl.radius * cellSize;
        if (settings.curvatureMode === 'soft' && imageSize > desiredSize * 1.2) {
          di = distToTarget * 0.5;
        }
      }

      // ---------- create facet clip polygon ----------
      const ref2 = V.inPlane(n, Z);
      const ex2 = V.norm(V.sub(ref2, V.mul(n, V.dot(ref2, n))));
      const ey2 = V.cross(n, ex2);

      const pts3 = [
        V.add(bestP, V.add(V.mul(ex2, -hx), V.mul(ey2, -hy))),
        V.add(bestP, V.add(V.mul(ex2, hx), V.mul(ey2, -hy))),
        V.add(bestP, V.add(V.mul(ex2, hx), V.mul(ey2, hy))),
        V.add(bestP, V.add(V.mul(ex2, -hx), V.mul(ey2, hy))),
      ];

      // Final verification (should pass by construction)
      let clipValid = true;
      for (const pt of pts3) {
        if (!Geo.envInside(envelope, pt, 1e-6) || V.dist(pt, S0) < effectiveMinDist - 1e-6) {
          clipValid = false; break;
        }
      }
      if (!clipValid) {
        if (ci < 3) {
          notes.push(`Cluster ${ci}: clip validation FAILED - checking corners:`);
          for (let pi = 0; pi < 4; pi++) {
            const pt = pts3[pi];
            const inEnv = Geo.envInside(envelope, pt, 1e-6);
            const dist = V.dist(pt, S0);
            notes.push(`  corner ${pi}: inEnv=${inEnv}, dist=${dist.toFixed(2)}, minDist=${effectiveMinDist}`);
          }
        }
        continue;
      }

      const id = `F${surfaces.length}`;
      surfaces.push({
        type: 'facet',
        id,
        group: 'A',
        P: bestP,
        S0: S0,
        Z: Z,
        di: di,
        flat: flat,
        clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity: reflectivity, twoSided: false },
      });

      // Record placed facet for angular separation
      placedFacets.push({ P: bestP, n, fromLED: V.norm(V.sub(bestP, S0)) });

      const cells = cl.members.map(m => [m.j * paintRes + m.i, m.w]);
      intent.push({ facet: id, cells });
    }

    notes.push(`Placed ${surfaces.length}/${numFacets} facets from ${clusters.length} clusters (${candidates.length} candidates)`);

    return { surfaces, intent, notes };
  },
});