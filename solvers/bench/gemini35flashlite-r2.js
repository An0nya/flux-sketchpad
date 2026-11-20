/* Static Paint Solver v6 — Grid Hemisphere Reflector */
RF.Solvers.register({
  id: 'bench-gemini35flashlite-r2--paint-solver-v6',
  name: 'Paint Solver v6',
  version: '6.0',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facets', label: 'Facets (0 = max budget)', type: 'number', min: 0, max: 400, step: 1, default: 0 },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, Engine = RF.Engine;
    const Lp = input.source.pos;
    const sourceAxis = input.source.axis || [1, 0, 0];
    const keep = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0);
    const maxFacets = input.limits.maxFacets || 100;
    const targetFacets = settings.facets > 0 ? Math.min(settings.facets, maxFacets) : maxFacets;
    const paint = input.paint;
    const res = paint.res;
    const cells = paint.cells;

    // Collect all painted cells with weight > 0.05
    const painted = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        const w = cells[k];
        if (w > 0.05) {
          painted.push({ i, j, w });
        }
      }
    }

    const surfaces = [];
    const intent = [];
    const notes = [];

    if (painted.length === 0) {
      notes.push('No paint found.');
      return { surfaces, intent, notes };
    }

    // Target frame
    const T = Engine.targetFrame(input);
    const env = input.envelope;

    // Generate facet grid on front hemisphere
    const [e1, e2] = V.basis(sourceAxis);
    const nSteps = Math.round(Math.sqrt(targetFacets * 1.5));
    
    let facetCount = 0;
    for (let ai = 0; ai < nSteps && facetCount < targetFacets; ai++) {
      const theta = (ai + 0.5) / nSteps * Math.PI * 0.45; // 0 to ~80 degrees from axis
      const cosTh = Math.cos(theta), sinTh = Math.sin(theta);
      const nPhi = Math.max(4, Math.round(nSteps * 2 * sinTh));
      
      for (let aj = 0; aj < nPhi && facetCount < targetFacets; aj++) {
        const phi = (aj + 0.5) / nPhi * 2 * Math.PI;
        
        // Direction from LED
        const u = V.add(
          V.mul(sourceAxis, cosTh),
          V.add(V.mul(e1, sinTh * Math.cos(phi)), V.mul(e2, sinTh * Math.sin(phi)))
        );
        const uNorm = V.norm(u);

        const iv = Geo.envInterval(env, Lp, uNorm);
        if (!iv || !(iv[1] > Math.max(0, iv[0]))) continue;

        const rMin = Math.max(keep + 0.5, iv[0] + 0.3);
        const rMax = iv[1] - 0.3;
        if (!(rMax > rMin)) continue;

        const dist = rMin + 0.5 * (rMax - rMin);
        const P = V.add(Lp, V.mul(uNorm, dist));

        if (!Geo.envInside(env, P, -1e-5) || V.dist(P, Lp) < keep) continue;

        // Pick a target painted cell based on angular mapping or weight
        const pCellIdx = (facetCount * 7) % painted.length;
        const pCell = painted[pCellIdx];

        const s = 2 * T.half / T.res;
        const uCoord = -T.half + (pCell.i + 0.5) * s;
        const vCoord = -T.half + (pCell.j + 0.5) * s;
        const Z = V.add(T.C, V.add(V.mul(T.tu, uCoord), V.mul(T.tv, vCoord)));

        const id = 'F' + surfaces.length;
        const di = V.dist(P, Z);

        const n = V.norm(V.add(V.norm(V.sub(Lp, P)), V.norm(V.sub(Z, P))));
        const [tex, tey] = V.basis(n);
        const halfSize = 5.0;
        const pts3 = [
          V.add(P, V.add(V.mul(tex, -halfSize), V.mul(tey, -halfSize))),
          V.add(P, V.add(V.mul(tex, halfSize), V.mul(tey, -halfSize))),
          V.add(P, V.add(V.mul(tex, halfSize), V.mul(tey, halfSize))),
          V.add(P, V.add(V.mul(tex, -halfSize), V.mul(tey, halfSize))),
        ];

        // Verify all pts3 inside envelope
        let allInside = true;
        for (const pt of pts3) {
          if (!Geo.envInside(env, pt, -1e-5)) {
            allInside = false;
            break;
          }
        }
        if (!allInside) continue;

        surfaces.push({
          type: 'facet',
          id,
          P,
          S0: Lp.slice(),
          Z,
          flat: false,
          di,
          clip: { kind: 'poly', pts3 },
          optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false }
        });

        intent.push({ facet: id, cells: [[pCell.j * res + pCell.i, pCell.w]] });
        facetCount++;
      }
    }

    notes.push(`Placed ${surfaces.length} grid hemisphere facets.`);
    return { surfaces, intent, notes };
  }
});
