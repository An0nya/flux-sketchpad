/* Reflective solver for Flux — paints the target with focused mirror facets.
 *
 * Approach: place facets on a plane at fixed x (perpendicular to the throw axis), offset from the
 * LED, spread in y-z. Because every facet sits at the same x, their reflected beams (all heading
 * roughly +x toward the target) never cross, so facets do not block one another. Each facet aims
 * at a target cell (a sub-region of the painted bbox), is focused (di = |Z-P|) so it paints a sharp
 * top-hat image of the LED there, and is sized in proportion to the paint weight at its aim cell
 * (image brightness ∝ facet area for a focused facet). A focused facet at distance r from the LED
 * paints an image about (target_dist / r)·LED_size wide; far facets paint smaller (sharper) images.
 *
 * The plane side (dx sign) and the illuminated y-z region are chosen from the LED axis so the facets
 * face the light. Static: solve() computes geometry directly, no ray tracing.
 */
RF.Solvers.register({
  id: 'bench-glm52--flux', name: 'Flux reflector solver', version: '0.3', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'dx', label: 'Facet plane x-offset (mm)', type: 'range', min: -40, max: 40, step: 1, default: 15 },
    { key: 'gap', label: 'Facet fill (× cell)', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.9 },
    { key: 'areaBase', label: 'Area base (× cell²)', type: 'range', min: 0.1, max: 1.5, step: 0.05, default: 0.7 },
    { key: 'areaExp', label: 'Area exponent (paint^)', type: 'range', min: 0.3, max: 2, step: 0.1, default: 1 },
  ],
  solve(input, settings) {
    const V = RF.V, U = RF.U;
    const env = input.envelope, src = input.source, L = src.pos;
    const maxFacets = input.limits.maxFacets, refl = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = RF.Engine.targetFrame(input.target);
    const paint = input.paint.cells, R = input.paint.res;
    const notes = [], surfaces = [], intent = [];

    // ---- 1. facet plane: fixed x = L[0] + dx, perpendicular to throw. No x-spread ⇒ no blocking.
    //    Choose dx sign so the plane is on the side the LED faces (catches light), and not between
    //    LED and target when the LED faces the target (would block direct light).
    const a = V.norm(src.axis || [0, 0, 1]);
    // The plane must be on the side the LED illuminates: (P-L)·a > 0 for P on the plane.
    // For P = L + (dx,0,0), that means dx·a[0] > 0. If a[0] is significant, flip dx to match its sign.
    let dx = settings.dx;
    const AT0 = 0.2;
    if (Math.abs(a[0]) > AT0 && Math.sign(dx) !== Math.sign(a[0]) && dx !== 0) {
      dx = -dx; notes.push('dx flipped to ' + dx + ' to face LED axis a[0]=' + a[0].toFixed(2));
    }
    const fx = L[0] + dx;
    const xLo = env.center[0] - env.half[0], xHi = env.center[0] + env.half[0];
    if (fx < xLo - 0.5 || fx > xHi + 0.5) { notes.push('facet plane x=' + fx.toFixed(1) + ' outside envelope; clamping'); }

    // ---- 2. illuminated region on the plane: a point (fx,py,pz) is lit if (P-L)·a > 0.
    //    Restrict the y-z grid to the lit region so facets face the light. Only apply when the
    //    axis component is significant (> 0.15 ≈ 8.6°); tiny components would amplify the offset.
    const yLoE = env.center[1] - env.half[1], yHiE = env.center[1] + env.half[1];
    const zLoE = env.center[2] - env.half[2], zHiE = env.center[2] + env.half[2];
    const c0 = (fx - L[0]) * a[0];
    let y0 = yLoE, y1 = yHiE, z0 = zLoE, z1 = zHiE;
    const AT = 0.15;
    if (Math.abs(a[1]) > AT) { const yCrit = L[1] - c0 / a[1]; if (a[1] > 0) y0 = Math.max(y0, yCrit); else y1 = Math.min(y1, yCrit); }
    if (Math.abs(a[2]) > AT) { const zCrit = L[2] - c0 / a[2]; if (a[2] > 0) z0 = Math.max(z0, zCrit); else z1 = Math.min(z1, zCrit); }
    if (y1 - y0 < 2 || z1 - z0 < 2) { notes.push('illuminated region too small; using full extent'); y0 = yLoE; y1 = yHiE; z0 = zLoE; z1 = zHiE; }

    // ---- 3. painted region bbox (paint cell indices)
    let iMin = R, iMax = -1, jMin = R, jMax = -1, nPaint = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      if (paint[j * R + i] > 0) { nPaint++; if (i < iMin) iMin = i; if (i > iMax) iMax = i; if (j < jMin) jMin = j; if (j > jMax) jMax = j; }
    }
    if (nPaint === 0) { notes.push('empty paint'); return { surfaces, intent, notes }; }

    // ---- 4. grid of facets: Ny × Nz over the painted bbox, aspect-matched (y→u, z→v)
    const bw = iMax - iMin + 1, bh = jMax - jMin + 1, aspect = bw / bh;
    let Ny = Math.round(Math.sqrt(maxFacets * aspect)), Nz = Math.round(Ny / aspect);
    while (Ny * Nz > maxFacets) { if (Ny >= Nz) Ny--; else Nz--; }
    while ((Ny + 1) * Nz <= maxFacets && Ny < bw) Ny++;
    while (Ny * (Nz + 1) <= maxFacets && Nz < bh) Nz++;

    // ---- 5. per-grid-cell paint weight and weighted-centroid aim
    const gw = new Array(Ny * Nz).fill(0), gu = new Array(Ny * Nz).fill(0), gv = new Array(Ny * Nz).fill(0);
    for (let j = jMin; j <= jMax; j++) for (let i = iMin; i <= iMax; i++) {
      const w = paint[j * R + i]; if (w <= 0) continue;
      const gy = Math.min(Ny - 1, Math.floor((i - iMin) / bw * Ny));
      const gz = Math.min(Nz - 1, Math.floor((j - jMin) / bh * Nz));
      const g = gz * Ny + gy;
      const [u, v] = RF.Engine.cellCenter(T, i, j);
      gw[g] += w; gu[g] += w * u; gv[g] += w * v;
    }
    for (let g = 0; g < Ny * Nz; g++) {
      if (gw[g] > 0) { gu[g] /= gw[g]; gv[g] /= gw[g]; }
      else {
        const gy = g % Ny, gz = (g / Ny) | 0;
        gu[g] = RF.Engine.cellCenter(T, iMin + Math.floor((gy + 0.5) / Ny * bw), jMin + Math.floor((gz + 0.5) / Nz * bh))[0];
        gv[g] = RF.Engine.cellCenter(T, iMin + Math.floor((gy + 0.5) / Ny * bw), jMin + Math.floor((gz + 0.5) / Nz * bh))[1];
      }
    }
    const meanW = gw.reduce((s, x) => s + x, 0) / (Ny * Nz);

    // ---- 6. place facets
    // Inset the grid from the envelope boundary: curved facets sag beyond P.  Half a cell is enough
    // for most tilts; per-facet outline check (below) catches the rest.
    let dy = (y1 - y0) / Ny, dz = (z1 - z0) / Nz, cellSide = Math.min(dy, dz);
    const margin = cellSide * 0.5;
    y0 += margin; y1 -= margin; z0 += margin; z1 -= margin;
    dy = (y1 - y0) / Ny; dz = (z1 - z0) / Nz; cellSide = Math.min(dy, dz);
    const baseArea = settings.areaBase * cellSide * cellSide, gap = settings.gap, exp = settings.areaExp;
    let placed = 0;
    for (let gz = 0; gz < Nz; gz++) for (let gy = 0; gy < Ny; gy++) {
      const g = gz * Ny + gy;
      if (gw[g] <= 0) continue;            // skip gap sub-regions (gaps stay dark)
      if (placed >= maxFacets) break;
      const py = y0 + (gy + 0.5) * dy, pz = z0 + (gz + 0.5) * dz;
      const P = [fx, py, pz];
      if (V.dist(P, L) < keep + 0.5) continue;
      if (!RF.Geo.envInside(env, P, 0.01)) continue;
      const Z = RF.Engine.targetUVtoWorld(T, gu[g], gv[g]);
      const wRel = gw[g] / Math.max(1e-9, meanW);
      let area = baseArea * Math.pow(wRel, exp);
      area = Math.min(area, cellSide * cellSide * gap * gap);
      // Shrink the facet until its curved outline stays inside the envelope (curved facets sag).
      // Only needed near the boundary: if P is > cellSide from any wall, the sag can't reach it.
      const nearBoundary = (Math.abs(py - yLoE) < cellSide || Math.abs(py - yHiE) < cellSide ||
                            Math.abs(pz - zLoE) < cellSide || Math.abs(pz - zHiE) < cellSide ||
                            Math.abs(fx - xLo) < cellSide || Math.abs(fx - xHi) < cellSide);
      let side = Math.sqrt(area), hw = side / 2, hh = side / 2;
      if (nearBoundary) {
        let tries = 0;
        while (tries < 6) {
          const p = (a2, b2) => [fx, py + a2, pz + b2];
          const pts3 = [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)];
          const tmp = { type: 'facet', id: 't', group: 'A', P: P.slice(), S0: L.slice(), Z: Z.slice(), di: V.dist(Z, P), flat: false, clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
          const G = RF.Geo.compile([tmp]);
          let outside = false;
          for (const poly of RF.Geo.outline(G, 0)) for (const pt of poly) if (!RF.Geo.envInside(env, pt, 1e-6 * Math.max(...env.half))) { outside = true; break; }
          if (!outside) break;
          hw *= 0.75; hh *= 0.75; tries++;
        }
      }
      const p = (a2, b2) => [fx, py + a2, pz + b2];
      const pts3 = [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)];
      const di = V.dist(Z, P);
      const id = 'F' + placed;
      surfaces.push({ type: 'facet', id, group: 'A', P: P.slice(), S0: L.slice(), Z: Z.slice(), di, flat: false,
        clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } });
      const ai = Math.max(0, Math.min(R - 1, Math.round((gu[g] + T.half) / (2 * T.half) * R - 0.5)));
      const aj = Math.max(0, Math.min(R - 1, Math.round((gv[g] + T.half) / (2 * T.half) * R - 0.5)));
      const cells = [];
      for (let dj = -1; dj <= 1; dj++) for (let di2 = -1; di2 <= 1; di2++) {
        const ci = ai + di2, cj = aj + dj; if (ci < 0 || cj < 0 || ci >= R || cj >= R) continue;
        cells.push([cj * R + ci, (di2 === 0 && dj === 0) ? 1 : 0.25]);
      }
      intent.push({ facet: id, cells });
      placed++;
    }
    notes.push(placed + ' facets on plane x=' + fx.toFixed(1) + ', grid ' + Ny + '×' + Nz + ', paint cells ' + nPaint + ', lit y[' + y0.toFixed(0) + ',' + y1.toFixed(0) + '] z[' + z0.toFixed(0) + ',' + z1.toFixed(0) + ']');
    return { surfaces, intent, notes };
  },
});

/* ────────────────────────────────────────────────────────────────────────────
 * Tuner (flux-auto): traces candidate settings for the static solver and picks the best for a goal.
 * Exempt from the no-trace-in-solve rule (id ends in -auto). Same seed every call → differences
 * between candidates are geometry, not noise. Goals: faithful (max fidelity), throw (max peak cd),
 * efficient (max fidelity × onPaint + facet savings).
 * ──────────────────────────────────────────────────────────────────────────── */
RF.Solvers.register({
  id: 'bench-glm52--flux-auto', name: 'Flux reflector solver (auto-tuned)', version: '0.3', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const minDist = settings.minDistance || 0;
    const goal = settings.goal || 'faithful';
    const maxF = input.limits.maxFacets;
    const staticDef = RF.Solvers.get('bench-glm52--flux');
    const notes = [];

    // Candidate grid: the most impactful knobs (dx controls sharpness/coverage, areaBase controls
    // brightness/spill). gap=0.9 and areaExp=1 are robust; these vary the trade-offs around them.
    const candidates = [
      { dx: 15, gap: 0.9, areaBase: 0.7, areaExp: 1 },   // default
      { dx: 10, gap: 0.9, areaBase: 0.7, areaExp: 1 },   // closer: more coverage, blurrier
      { dx: 20, gap: 0.9, areaBase: 0.7, areaExp: 1 },   // farther: sharper, less coverage
      { dx: 15, gap: 0.9, areaBase: 0.5, areaExp: 1 },   // smaller facets: less spill
      { dx: 15, gap: 0.9, areaBase: 1.0, areaExp: 1 },   // larger facets: more light
      { dx: 15, gap: 1.0, areaBase: 1.0, areaExp: 1 },   // max light (for throw)
      { dx: 15, gap: 0.9, areaBase: 0.7, areaExp: 1.5 }, // more contrast
    ];

    let best = null, bestScore = -Infinity, bestOut = null;
    const RAYS = 250000;

    for (const c of candidates) {
      const tag = 'dx' + c.dx + '/ab' + c.areaBase + '/ae' + c.areaExp + '/g' + c.gap;
      try {
        const out = staticDef.solve(input, Object.assign({ minDistance: minDist }, c));
        if (!out.surfaces || out.surfaces.length === 0) { notes.push(tag + ': 0 facets'); continue; }
        const tr = tools.trace(out.surfaces, { rays: RAYS });
        if (!tr || !tr.fidelity) { notes.push(tag + ': no fidelity'); continue; }
        const fid = tr.fidelity.fidelity || 0, onPaint = tr.fidelity.onPaint || 0, peak = tr.peakCd || 0;
        let score;
        if (goal === 'throw') score = peak;
        else if (goal === 'efficient') score = fid * onPaint + 0.02 * (1 - out.surfaces.length / maxF);
        else score = fid;
        notes.push(tag + ': fid=' + (fid * 100).toFixed(1) + '% onP=' + (onPaint * 100).toFixed(1) + '% peak=' + peak.toFixed(0) + ' →' + score.toFixed(4));
        if (score > bestScore) { bestScore = score; best = c; bestOut = out; }
      } catch (e) { notes.push(tag + ': ' + (e.message || String(e)).slice(0, 80)); }
    }

    if (!bestOut) {
      notes.push('all candidates failed; using default');
      bestOut = staticDef.solve(input, { minDistance: minDist, dx: 15, gap: 0.9, areaBase: 0.7, areaExp: 1 });
      best = { dx: 15, areaBase: 0.7 };
    }
    notes.unshift('goal=' + goal + ', best dx=' + best.dx + ' ab=' + best.areaBase + ' ae=' + best.areaExp + ' g=' + best.gap + ' score=' + bestScore.toFixed(4));
    return { surfaces: bestOut.surfaces, intent: bestOut.intent, notes };
  },
});
