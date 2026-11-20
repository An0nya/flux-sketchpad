/* Reflector solver.
 * Approach: place facets on the wall of the envelope that faces the target (the +x wall, since
 * the target is at +x). Facets there don't shadow each other from the LED (all at the same x) and
 * their reflected beams exit cleanly toward the target — 0% blocked vs 43–69% on other walls.
 * Aim one facet per uniform-grid cell over the painted bounding box (maximises coverage when
 * maxFacets << painted cells). Size by paint weight with an adaptive exponent wp that depends
 * on the blur ratio (kernel/spacing): blurry scenes (kernel > spacing) need weight scaling to
 * dim the over-lit centre; sharp scenes (kernel < spacing) use uniform area. Wall positions are
 * chosen to match the image size to the aim spacing, reducing overlap. */
RF.Solvers.register({
  id: 'bench-glm52-r3--reflector-v1', name: 'Reflector v1', version: '0.5', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'baseArea', label: 'Base facet area (mm²)', type: 'range', min: 5, max: 300, step: 1, default: 15 },
    { key: 'brightnessCorrect', label: 'Brightness correction', type: 'checkbox', default: false },
    { key: 'wallMargin', label: 'Wall margin (mm)', type: 'range', min: 0, max: 10, step: 0.5, default: 2 },
  ],
  solve(input, settings) {
    const V = RF.V, E = RF.Engine, G = RF.Geo;
    const src = input.source, env = input.envelope, tgt = input.target, paint = input.paint;
    const S = src.pos, a = V.norm(src.axis), T = E.targetFrame(tgt);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const R = paint.res, cellW = tgt.size / R, half = tgt.size / 2;
    const maxFacets = input.limits.maxFacets, refl = input.limits.reflectivity;

    // painted cells (row-major, v up)
    const painted = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = paint.cells[j * R + i];
      if (w > 0) painted.push({ i, j, u: -half + (i + 0.5) * cellW, v: -half + (j + 0.5) * cellW, w, cell: j * R + i });
    }
    if (!painted.length) return { surfaces: [], intent: [], notes: ['no painted cells'] };

    // aim points: a uniform grid over the painted bounding box, snapped to nearest painted cell.
    // Uniform spread maximizes coverage (important when maxFacets << painted cells). Facet size
    // is scaled by paint weight so bright cells get bigger facets (more light).
    const N = Math.min(maxFacets, painted.length);
    const pus = painted.map((p) => p.u), pvs = painted.map((p) => p.v);
    const bu0 = Math.min(...pus), bu1 = Math.max(...pus), bv0 = Math.min(...pvs), bv1 = Math.max(...pvs);
    const ar = (bu1 - bu0) / Math.max(1, bv1 - bv0);
    let ny = Math.max(1, Math.round(Math.sqrt(N / ar))), nx = Math.max(1, Math.round(N / ny));
    while (nx * ny > N) { if (nx > ny) nx--; else ny--; }
    const aims = [];
    for (let gi = 0; gi < nx; gi++) for (let gj = 0; gj < ny; gj++) {
      const u = bu0 + (bu1 - bu0) * (gi + 0.5) / nx;
      const v = bv0 + (bv1 - bv0) * (gj + 0.5) / ny;
      let best = null, bd = Infinity;
      for (const p of painted) { const d = (p.u - u) ** 2 + (p.v - v) ** 2; if (d < bd) { bd = d; best = p; } }
      if (best) aims.push({ u: best.u, v: best.v, w: best.w, cell: best.cell });
    }
    const Na = aims.length;
    const cx0 = painted.reduce((s, p) => s + p.u, 0) / painted.length;
    const cy0 = painted.reduce((s, p) => s + p.v, 0) / painted.length;

    // the wall facing the target: the +x wall (target at +x). Find its x and the y,z extent.
    // For a box envelope, +x wall is at x = center[0] + half[0].
    const c = env.center, h = env.half;
    const wallX = c[0] + h[0] - settings.wallMargin;
    const wallY0 = c[1] - h[1] + settings.wallMargin, wallY1 = c[1] + h[1] - settings.wallMargin;
    const wallZ0 = c[2] - h[2] + settings.wallMargin, wallZ1 = c[2] + h[2] - settings.wallMargin;
    // check the wall is on the target side of the LED
    if (wallX <= S[0] + keep) {
      // envelope doesn't extend past the LED toward the target: fall back to envelope-boundary placement
      return fallbackBoundary(input, settings, painted, aims, S, a, env, tgt, T, keep, R, maxFacets, refl);
    }

    // place facets on a grid on the +x wall, covering the area within the LED's emission cone.
    // The wall position and the aim are independent: any wall spot can aim at any target point.
    // Pair grid positions with aims by index (both sorted by angle for a rough match).
    const envTol = 1e-6 * Math.max(...env.half);
    function fitRad(P, n, radWant) {
      const ex = V.inPlane(n, null), ey = V.cross(n, ex);
      const test = (rad) => {
        for (let s = 0; s < 16; s++) {
          const ang = s * Math.PI / 8;
          const q = V.add(P, V.add(V.mul(ex, rad * Math.cos(ang)), V.mul(ey, rad * Math.sin(ang))));
          if (!G.envInside(env, q, envTol)) return false;
          if (keep > 0 && V.dist(q, S) < keep * (1 + 1e-6)) return false;
        }
        return true;
      };
      if (!test(0)) return 0;
      let lo = 0, hi = radWant;
      if (!test(hi)) { for (let i = 0; i < 18; i++) { const mid = 0.5 * (lo + hi); if (test(mid)) lo = mid; else hi = mid; } return lo; }
      return hi;
    }
    function outlineOk(surf, rad) {
      const s = Object.assign({}, surf, { clip: { kind: 'disc', r: rad } });
      try {
        const C = G.compile([s]);
        for (const poly of G.outline(C, 0)) for (const q of poly) {
          if (!G.envInside(env, q, envTol)) return false;
          if (keep > 0 && V.dist(q, S) < keep * (1 - 1e-6)) return false;
        }
        return true;
      } catch (e) { return false; }
    }

    // generate wall positions on a grid, filtered to the LED emission cone (cosθ > cosMax).
    // Prefer positions whose image size matches the aim spacing (sqrt(painted/N) cells):
    // too-sharp images under-cover, too-blurry images overlap and over-light the centre.
    const cosMax = Math.cos(60 * Math.PI / 180);
    const cell = tgt.size / R;
    const spacing = Math.sqrt(painted.length / Na) * cell;
    const D = tgt.distance;
    const wallPositions = [];
    const gN = Math.ceil(Math.sqrt(Na * 2));
    for (let i = 0; i < gN; i++) for (let j = 0; j < gN; j++) {
      const wy = wallY0 + (wallY1 - wallY0) * (i + 0.5) / gN;
      const wz = wallZ0 + (wallZ1 - wallZ0) * (j + 0.5) / gN;
      const P = [wallX, wy, wz];
      const dir = V.norm(V.sub(P, S));
      const ct = V.dot(dir, a);
      if (ct < cosMax) continue;   // outside emission cone
      if (V.dist(P, S) < keep + 0.5) continue;
      const img = D * 2 * ct / V.dist(P, S) / cell;
      P.img = img;
      P.imgErr = Math.abs(img - spacing / cell);
      wallPositions.push(P);
    }
    // adaptive weight exponent: when images are blurry (kernel > spacing), overlap piles up in
    // the centre; scaling area by weight dims the centre and brightens edges. When images are
    // sharp (kernel < spacing), uniform area is best (each facet lights its own cell).
    const minImg = wallPositions.length ? Math.min(...wallPositions.map((p) => p.img)) : spacing / cell;
    const wp = Math.max(0, Math.min(0.85, (minImg / (spacing / cell) - 0.6) / 1.15));

    // sort both aims and positions by angle around the LED axis for a rough pairing
    const [u0, v0] = V.basis(a);
    for (const aim of aims) aim.ang = Math.atan2(aim.v - cy0, aim.u - cx0);
    aims.sort((x, y) => x.ang - y.ang);
    // keep the Na positions with image size closest to the target spacing, then sort by angle
    wallPositions.sort((x, y) => x.imgErr - y.imgErr);
    const kept = wallPositions.slice(0, Na);
    for (const P of kept) { const rel = V.sub(P, S); P.ang = Math.atan2(V.dot(rel, v0), V.dot(rel, u0)); }
    kept.sort((x, y) => x.ang - y.ang);
    wallPositions.length = 0;
    wallPositions.push(...kept);

    // size facets by the cluster's total paint weight (total light needed): area ∝ w_total.
    const medW = aims.map((x) => x.w).sort((x, y) => x - y)[Math.floor(aims.length / 2)] || 1;

    const surfaces = [], intent = [], notes = [];
    let placed = 0, droppedFit = 0;
    for (let k = 0; k < Na; k++) {
      const aim = aims[k];
      const P0 = wallPositions[Math.floor(k * wallPositions.length / Na)];
      if (!P0) { droppedFit++; continue; }
      const Z = E.targetUVtoWorld(T, aim.u, aim.v);
      const di = tgt.distance;
      // brightness correction: E ∝ A·cos(θ_inc)/(D²·s²·cos²(θ_axis))
      // pull P back along -x (into the envelope) so the tilted disc fits.
      // estimate n at P0, then pull back by radWant·|ex[0]| + margin.
      let P = P0.slice();
      const n0 = V.norm(V.add(V.norm(V.sub(S, P)), V.norm(V.sub(Z, P))));
      const ex0 = V.inPlane(n0, null);
      let geom = 1;
      if (settings.brightnessCorrect) {
        const sh = V.norm(V.sub(S, P));
        const cosInc = Math.max(0.1, V.dot(sh, n0));
        const cosAxis = Math.max(0.05, V.dot(V.norm(V.sub(P, S)), a));
        geom = cosAxis * cosAxis / cosInc;
      }
      const area = settings.baseArea * Math.pow(aim.w, wp) / Math.pow(medW, wp) * geom;
      const radWant = Math.sqrt(area / Math.PI);
      // pull back along -x so the disc (extending +x by radWant·|ex0[0]|) fits behind the wall
      const pull = radWant * Math.abs(ex0[0]) + 2.0;
      P = [P0[0] - pull, P0[1], P0[2]];
      if (P[0] < c[0] - h[0] + 1) { droppedFit++; continue; }   // pulled out the back
      const r = V.dist(P, S);
      if (r < keep + 0.5) { droppedFit++; continue; }
      const n = V.norm(V.add(V.norm(V.sub(S, P)), V.norm(V.sub(Z, P))));
      let rad = fitRad(P, n, radWant);
      if (rad < 0.5) { droppedFit++; continue; }
      const id = 'F' + placed;
      const surf = { type: 'facet', id, group: 'A', P, S0: S, Z, di, flat: false,
        clip: { kind: 'disc', r: rad },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
      if (!outlineOk(surf, rad)) {
        let lo = 0, hi = rad;
        for (let i = 0; i < 20; i++) { const mid = 0.5 * (lo + hi); if (outlineOk(surf, mid)) lo = mid; else hi = mid; }
        rad = lo; surf.clip.r = rad;
      }
      if (rad < 0.3) { droppedFit++; continue; }
      surfaces.push(surf);
      intent.push({ facet: id, cells: [[aim.cell, 1]] });
      placed++;
    }

    notes.push(placed + ' facets on +x wall (grid aims, adaptive weight exponent, image-size-matched positions)' + (droppedFit ? ' (' + droppedFit + ' dropped for fit)' : ''));
    return { surfaces, intent, notes };

    // ---- fallback: envelope-boundary placement (when the +x wall is behind the LED)
    function fallbackBoundary(input, settings, painted, aims, S, a, env, tgt, T, keep, R, maxFacets, refl) {
      const maxAng = 60 * Math.PI / 180, cosMax = Math.cos(maxAng);
      const [u0, v0] = V.basis(a);
      const positions = [];
      const NA = 16, NB = 32;
      for (let ia = 0; ia < NA; ia++) for (let ib = 0; ib < NB; ib++) {
        const ct = 1 - (ia + 0.5) / NA * (1 - cosMax);
        const st = Math.sqrt(1 - ct * ct), ph = 2 * Math.PI * (ib + 0.5) / NB;
        const dir = V.norm([ct * a[0] + st * Math.cos(ph) * u0[0] + st * Math.sin(ph) * v0[0],
                            ct * a[1] + st * Math.cos(ph) * u0[1] + st * Math.sin(ph) * v0[1],
                            ct * a[2] + st * Math.cos(ph) * u0[2] + st * Math.sin(ph) * v0[2]]);
        const iv = G.envInterval(env, S, dir);
        if (!(iv[1] > 0)) continue;
        const projU = V.dot(dir, u0), projV = V.dot(dir, v0);
        positions.push({ dir, tBnd: iv[1], ang: Math.atan2(projV, projU), ct });
      }
      positions.sort((x, y) => x.ang - y.ang);
      const envTol = 1e-6 * Math.max(...env.half);
      const ws = aims.map((x) => x.w).sort((x, y) => x - y);
      const medW = ws[Math.floor(ws.length / 2)] || 1;
      const surfaces = [], intent = [], notes = [];
      let placed = 0, droppedFit = 0;
      for (let pi = 0; pi < positions.length && placed < aims.length; pi++) {
        const pos = positions[Math.floor(pi * positions.length / aims.length)];
        const aim = aims[placed];
        const Z = E.targetUVtoWorld(T, aim.u, aim.v);
        const di = tgt.distance;
        const area = settings.baseArea * aim.w / medW;
        const radWant = Math.sqrt(area / Math.PI);
        const pull = radWant + 2.0;
        const P = V.add(S, V.mul(pos.dir, pos.tBnd - pull));
        const r = V.dist(P, S);
        if (r < keep + 0.5) { droppedFit++; continue; }
        const n = V.norm(V.add(V.norm(V.sub(S, P)), V.norm(V.sub(Z, P))));
        const ex = V.inPlane(n, null), ey = V.cross(n, ex);
        const test = (rad) => { for (let s = 0; s < 16; s++) { const ang = s * Math.PI / 8; const q = V.add(P, V.add(V.mul(ex, rad * Math.cos(ang)), V.mul(ey, rad * Math.sin(ang)))); if (!G.envInside(env, q, envTol)) return false; if (keep > 0 && V.dist(q, S) < keep * (1 + 1e-6)) return false; } return true; };
        if (!test(0)) { droppedFit++; continue; }
        let lo = 0, hi = radWant, rad;
        if (test(hi)) rad = hi; else { for (let i = 0; i < 18; i++) { const mid = 0.5 * (lo + hi); if (test(mid)) lo = mid; else hi = mid; } rad = lo; }
        if (rad < 0.5) { droppedFit++; continue; }
        const id = 'F' + placed;
        surfaces.push({ type: 'facet', id, group: 'A', P, S0: S, Z, di, flat: false, clip: { kind: 'disc', r: rad }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } });
        intent.push({ facet: id, cells: [[aim.cell, 1]] });
        placed++;
      }
      notes.push(placed + ' facets (fallback boundary)' + (droppedFit ? ' (' + droppedFit + ' dropped)' : ''));
      return { surfaces, intent, notes };
    }
  },
});

/* Auto-tuned solver: traces candidates with the real engine to pick the static solver's settings
 * for a goal. Exempt from the no-trace rule (id ends in -auto). Same seed every call so candidates
 * differ by geometry, not noise. */
RF.Solvers.register({
  id: 'bench-glm52-r3--reflector-v1-auto', name: 'Reflector v1 (auto-tuned)', version: '0.5', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const stat = RF.Solvers.get('bench-glm52-r3--reflector-v1');
    const goal = settings.goal || 'faithful';
    const base = { minDistance: settings.minDistance, brightnessCorrect: false };
    // no static solver or no tracing (e.g. app static path): fall back to good defaults
    if (!stat || !tools || typeof tools.trace !== 'function') {
      const out = stat ? stat.solve(input, Object.assign({}, base, { baseArea: 15, wallMargin: 2 })) : { surfaces: [], intent: [], notes: [] };
      out.notes = (out.notes || []).concat(['auto: no tracing available, using defaults']);
      return out;
    }
    const seed = input.seed;
    // candidate grids per goal: baseArea values (wallMargin fixed at 2 except throw tries 0)
    const grid = {
      faithful:  [10, 13, 16, 20, 25],
      throw:     [40, 50, 60, 75],
      efficient: [5, 8, 10, 13, 16],
    }[goal];
    const margins = goal === 'throw' ? [0, 2] : [2];
    const rayBudget = tools.budget && tools.budget.rays ? tools.budget.rays : 2e7;
    const raysPer = Math.min(300000, Math.max(100000, Math.floor(rayBudget / (grid.length * margins.length * 2))));
    const score = (tr) => {
      const fid = tr.fidelity ? tr.fidelity.fidelity : 0;
      const peak = tr.peakCd || 0;
      const spill = tr.fidelity ? tr.fidelity.spill : 0;
      const onPaint = tr.fidelity ? tr.fidelity.onPaint : 0;
      if (goal === 'throw') return peak;
      if (goal === 'efficient') return fid * (1 - (tr.blocked || 0)) * (1 - (tr.shadowed || 0));
      return fid; // faithful
    };
    let best = null, bestScore = -Infinity, tried = [];
    for (const A of grid) for (const wm of margins) {
      const cs = Object.assign({}, base, { baseArea: A, wallMargin: wm });
      let out;
      try { out = stat.solve(input, cs); } catch (e) { tried.push('A=' + A + ' W=' + wm + ' ERR'); continue; }
      if (!out.surfaces.length) { tried.push('A=' + A + ' W=' + wm + ' no facets'); continue; }
      let tr;
      try { tr = tools.trace(out.surfaces, { rays: raysPer, seed, occlusion: goal === 'efficient' }); } catch (e) { tried.push('A=' + A + ' W=' + wm + ' trace-ERR'); continue; }
      const s = score(tr);
      tried.push('A=' + A + ' W=' + wm + ' s=' + s.toFixed(3) + ' fid=' + ((tr.fidelity && tr.fidelity.fidelity) || 0).toFixed(2) + ' peak=' + Math.round(tr.peakCd || 0));
      if (s > bestScore) { bestScore = s; best = { out, cs }; }
      if (tools.preview) tools.preview(out.surfaces, { label: 'candidate A=' + A, trace: tr });
    }
    if (!best) {
      const out = stat ? stat.solve(input, Object.assign({}, base, { baseArea: 15, wallMargin: 2 })) : { surfaces: [], intent: [], notes: [] };
      out.notes = (out.notes || []).concat(['auto: no candidate succeeded, using defaults']);
      return out;
    }
    // fine step around the best baseArea (±2 steps)
    const A0 = best.cs.baseArea;
    for (const dA of [-3, 3]) {
      const A = Math.max(5, A0 + dA);
      const cs = Object.assign({}, base, { baseArea: A, wallMargin: best.cs.wallMargin });
      let out;
      try { out = stat.solve(input, cs); } catch (e) { continue; }
      if (!out.surfaces.length) continue;
      let tr;
      try { tr = tools.trace(out.surfaces, { rays: Math.min(400000, raysPer + 100000), seed, occlusion: goal === 'efficient' }); } catch (e) { continue; }
      const s = score(tr);
      tried.push('A=' + A + ' W=' + best.cs.wallMargin + ' s=' + s.toFixed(3) + ' (fine)');
      if (s > bestScore) { bestScore = s; best = { out, cs }; }
    }
    const notes = ['auto: goal=' + goal + ', picked baseArea=' + best.cs.baseArea + ' wallMargin=' + best.cs.wallMargin + ' (score=' + bestScore.toFixed(3) + ')'];
    notes.push(tried.join('  ·  '));
    return { surfaces: best.out.surfaces, intent: best.out.intent, notes };
  },
});
