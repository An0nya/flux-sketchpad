(function (root) {
  'use strict';
  const RF = root.RF;
  const V = RF.V;
  const Geo = RF.Geo;
  const U = RF.U;

  /* ================================================================ shared
   * static geometry builder.  No tracing: pure computation from the scene.
   * Used by both the 'reflector' solver and the 'reflector-auto' tuner.      */
  function ledMinSize(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? 2 * src.radius : Math.min(src.w || 0, src.h || 0);
    if (src.shape === 'cylinder') return Math.min(2 * src.radius, src.length || 0);
    return 2 * src.radius;
  }

  function facetCorners(P, n, L) {
    const ex = V.inPlane(n, null);
    const ey = V.cross(n, ex);
    const h = L / 2;
    const out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      out.push(V.add(V.add(P, V.mul(ex, sx * h)), V.mul(ey, sy * h)));
    }
    return out;
  }

  // Build reflector geometry for (input, settings).  Returns { surfaces, intent, notes }.
  function build(input, settings) {
    const src = input.source;
    const S = src.pos.slice();
    const saxis = V.norm(RF.Source.frame(src).a);
    const env = input.envelope;
    const T = RF.Engine.targetFrame(input.target);
    const res = input.paint.res | 0;
    const cells = input.paint.cells;
    const cell = 2 * T.half / res;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const maxFacets = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity || 0.9;
    const s0 = ledMinSize(src);
    const tileReq = Math.max(5, settings.tile || 55);
    const areaK = Math.max(1, settings.areaK || 100);
    const gridStep = Math.max(5, settings.gridStep || 14);

    const surfaces = [];
    const intent = [];
    const notes = [];

    const painted = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = cells[j * res + i];
      if (!(w > 0)) continue;
      const uv = RF.Engine.cellCenter(T, i, j);
      painted.push({ i, j, u: uv[0], v: uv[1], w });
    }
    if (painted.length === 0) { notes.push('no painted cells'); return { surfaces, intent, notes }; }

    // Facet positions: 2D grid in the plane through the LED perpendicular to throw
    // (x = S.x).  Reflected beams leave toward +x from this same plane, so a beam can
    // never hit another facet -> no downstream blocking/shadowing between facets.
    const sApprox = V.dist(T.C, S);
    const yMin = env.center[1] - env.half[1], yMax = env.center[1] + env.half[1];
    const zMin = env.center[2] - env.half[2], zMax = env.center[2] + env.half[2];
    const rMin = sApprox * s0 / (2.0 * tileReq);   // spot <= 2 x tile
    const rMaxWant = sApprox * s0 / (0.5 * tileReq); // spot >= 0.5 x tile
    const facetList = [];
    for (let y = yMin; y <= yMax; y += gridStep) {
      for (let z = zMin; z <= zMax; z += gridStep) {
        const P = [S[0], y, z];
        if (!Geo.envInside(env, P, 1e-6)) continue;
        const r = V.dist(P, S);
        if (!(r >= keep && r >= rMin && r <= rMaxWant)) continue;
        const d = V.norm(V.sub(P, S));
        if (V.dot(d, saxis) <= 0) continue;          // LED forward hemisphere
        const spot = sApprox * s0 / r;
        facetList.push({ P, d, r, spot });
      }
    }
    // keep nearest facet per LED-ray direction (avoid incoming shadowing), then spatial
    // separation so same-plane facet rects do not overlap.
    facetList.sort((a, b) => a.r - b.r);
    const byDir = [];
    for (const fl of facetList) {
      let clash = false;
      for (const k of byDir) if (V.dot(fl.d, k.d) > 0.999) { clash = true; break; }
      if (!clash) byDir.push(fl);
    }
    byDir.sort((a, b) => V.dot(b.d, saxis) - V.dot(a.d, saxis));
    const kept = [];
    const minDist = Math.max(gridStep * 0.9, 8);
    for (const fl of byDir) {
      let clash = false;
      for (const k of kept) if (V.dist(fl.P, k.P) < minDist) { clash = true; break; }
      if (!clash) kept.push(fl);
    }

    const paintedMask = new Uint8Array(res * res);
    const paintedWeight = new Float64Array(res * res);
    for (const p of painted) { paintedMask[p.j * res + p.i] = 1; paintedWeight[p.j * res + p.i] = p.w; }
    const covered = new Uint8Array(res * res);
    let placed = 0;

    // Greedy: each facet paints one square tile matched to its spot; aim at the uncovered
    // painted cell whose spot-square maximizes newly-lit paint while minimizing spill.
    for (const fl of kept) {
      if (placed >= maxFacets) break;
      const { P, d, r, spot } = fl;
      const nCell = Math.max(1, Math.round(spot / (2 * cell)));
      if (nCell > 40) continue;
      let best = null;
      for (const p of painted) {
        const i = p.i, j = p.j;
        const i0 = i - nCell, i1 = i + nCell, j0 = j - nCell, j1 = j + nCell;
        if (i0 < 0 || i1 >= res || j0 < 0 || j1 >= res) continue;
        let uncoveredW = 0, unpainted = 0;
        for (let jj = j0; jj <= j1; jj++) {
          const row = jj * res;
          for (let ii = i0; ii <= i1; ii++) {
            const k = row + ii;
            if (paintedMask[k]) { if (!covered[k]) uncoveredW += paintedWeight[k]; }
            else unpainted++;
          }
        }
        if (uncoveredW <= 0) continue;
        const score = uncoveredW - 0.25 * unpainted;
        if (!best || score > best.score) best = { score, i, j, uncoveredW };
      }
      if (!best) continue;
      const { i, j } = best;
      const aimU = -T.half + (i + 0.5) * cell;
      const aimV = -T.half + (j + 0.5) * cell;
      const Zc = V.add(T.C, V.add(V.mul(T.tu, aimU), V.mul(T.tv, aimV)));
      const sh = V.norm(V.sub(S, P));
      const ah = V.norm(V.sub(Zc, P));
      const n = V.norm(V.add(sh, ah));
      if (!(V.len(n) > 1e-9)) continue;
      const cosLed = Math.max(0, V.dot(d, saxis));
      const cosAlpha = Math.max(-1, Math.min(1, V.dot(d, ah)));
      const sinAlphaHalf = Math.sqrt(Math.max(0, (1 - cosAlpha) / 2));
      const denom = Math.max(1e-6, cosLed * sinAlphaHalf);
      let A = areaK * best.uncoveredW / denom;
      const Amax = 0.25 * r * r;              // keep facet small vs distance (sharpness)
      A = Math.min(Math.max(A, 4), Amax);
      const L = Math.sqrt(A);
      let Lfit = L, okFit = false;
      for (let s = 0; s < 8; s++) {
        const corners = facetCorners(P, n, Lfit);
        let ok = true;
        for (const c of corners) if (!Geo.envInside(env, c, 1e-4)) { ok = false; break; }
        if (ok) { okFit = true; break; }
        Lfit *= 0.6;
      }
      if (!okFit || Lfit < 1.5) continue;
      const di = V.dist(Zc, P);
      const id = 'F' + placed;
      surfaces.push({
        type: 'facet', id, group: 'A', P, S0: S, Z: Zc, flat: false, di,
        clip: { kind: 'rect', hx: Lfit / 2, hy: Lfit / 2 },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      });
      const nCi = nCell;
      const itCells = [];
      for (let jj = j - nCi; jj <= j + nCi; jj++) {
        if (jj < 0 || jj >= res) continue;
        const row = jj * res;
        for (let ii = i - nCi; ii <= i + nCi; ii++) {
          if (ii < 0 || ii >= res) continue;
          const k = row + ii;
          if (paintedMask[k]) { itCells.push([k, paintedWeight[k]]); covered[k] = 1; }
        }
      }
      intent.push({ facet: id, cells: itCells });
      placed++;
    }

    notes.push(placed + ' facets, tile ' + U.fmt(tileReq) + ' mm');
    return { surfaces, intent, notes };
  }

  /* ================================================================ static solver */
  RF.Solvers.register({
    id: 'bench-nemotron35supervl--reflector', name: 'Reflector (static paint solver)', version: '8.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'tile', label: 'Target tile size (mm)', type: 'number', min: 5, step: 1, default: 55 },
      { key: 'areaK', label: 'Facet area scale (mm^2)', type: 'number', min: 1, max: 20000, step: 10, default: 100 },
      { key: 'gridStep', label: 'Facet grid step (mm)', type: 'number', min: 5, step: 1, default: 14 },
    ],
    solve(input, settings) {
      return build(input, settings);
    },
  });

  /* ================================================================ auto tuner
   * Picks static-solver settings per scene by tracing candidates.  Allowed to trace
   * because the id ends in '-auto'.  Same seed every call -> candidates differ by
   * geometry, not noise.  Respects the same hard constraints via build().          */
  RF.Solvers.register({
    id: 'bench-nemotron35supervl--reflector-auto', name: 'Reflector auto-tuner', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select',
        options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
    ],
    solve(input, settings, tools) {
      const seed = input.seed | 0;
      const goal = settings.goal || 'faithful';
      const baseMinD = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0);

      // Candidate settings grid (coarse, scene-independent; build() adapts to scale).
      const tiles = [40, 70, 100];
      const areaKs = [80, 140];
      const gridSteps = [12, 18];
      const minDs = [0, 8];

      const traceRays = 80000;          // per candidate; ~24 candidates -> ~2 M rays
      let best = null;                  // { score, settings, geo }

      function scoreGoal(tr) {
        const f = tr.fidelity && tr.fidelity.fidelity ? tr.fidelity.fidelity : 0;
        const onPaint = tr.fidelity && tr.fidelity.onPaint ? tr.fidelity.onPaint : 0;
        const peak = tr.peakCd || 0;
        if (goal === 'throw') {
          // a bright spot with no paint coverage is not a valid beam
          if (f < 0.05) return -1;
          return peak;
        }
        if (goal === 'efficient') return onPaint;
        return f;                       // faithful: maximise traced fidelity
      }

      for (const tile of tiles) {
        for (const areaK of areaKs) {
          for (const gs of gridSteps) {
            for (const md of minDs) {
              const s = { minDistance: baseMinD + md, tile, areaK, gridStep: gs };
              const geo = build(input, s);
              if (!geo.surfaces || !geo.surfaces.length) continue;
              const tr = tools.trace(geo.surfaces, { rays: traceRays, seed });
              const sc = scoreGoal(tr);
              if (!best || sc > best.score) best = { score: sc, settings: s, geo, tr };
            }
          }
        }
      }

      // Refinement round around the best candidate (finer steps, more rays).
      if (best) {
        const b = best.settings;
        const refTiles = [Math.max(20, Math.round(b.tile * 0.75)), b.tile, Math.round(b.tile * 1.33)];
        const refAreaK = [Math.max(10, Math.round(b.areaK * 0.75)), b.areaK, Math.round(b.areaK * 1.33)];
        const refGs = [Math.max(6, b.gridStep - 6), b.gridStep, b.gridStep + 6];
        const refMds = [b.minDistance, b.minDistance === 0 ? 6 : 0];
        for (const tile of refTiles) {
          for (const areaK of refAreaK) {
            for (const gs of refGs) {
              for (const md of refMds) {
                if (tile === b.tile && areaK === b.areaK && gs === b.gridStep && md === b.minDistance) continue;
                const s = { minDistance: md, tile, areaK, gridStep: gs };
                const geo = build(input, s);
                if (!geo.surfaces || !geo.surfaces.length) continue;
                const tr = tools.trace(geo.surfaces, { rays: 100000, seed });
                const sc = scoreGoal(tr);
                if (sc > best.score) best = { score: sc, settings: s, geo, tr };
              }
            }
          }
        }
      }

      if (!best) {
        // fallback: static defaults
        return build(input, { minDistance: baseMinD, tile: 55, areaK: 100, gridStep: 14 });
      }

      best.geo.notes = (best.geo.notes || []).concat(
        'auto goal=' + goal + ' score=' + U.fmt(best.score) +
        ' tile=' + best.settings.tile + ' areaK=' + best.settings.areaK +
        ' gridStep=' + best.settings.gridStep + ' minDistance=' + best.settings.minDistance);
      return best.geo;
    },
  });
})(this);
