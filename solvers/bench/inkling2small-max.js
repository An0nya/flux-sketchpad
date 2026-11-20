/* Paint Spots — a static paint-matched facet array, single-plane edition.
 *
 * Idea
 * ----
 * Each facet images the LED onto the target plane: with the image formed ON the target (an ellipsoid with the
 * LED and the aim point as foci), the painted spot size is set by geometry alone:  spot ≈ di × LED size / r,
 * where r = dist(LED, facet) and di = dist(facet, aim).  The facet's own size changes only how much flux it
 * catches (its solid angle as seen from the LED).  The design reduces to:
 *
 *   1. Positioning: ONE plane over the LED, sloping down-forward at ~30° (the "reflector roof", not a
 *      reflector bowl).  Every ray descends slower than the plane descends, so rays leave the plane's
 *      half-space forever — no facet can ever be struck by another's beam (by geometry, not by search).
 *      The panel runs from the envelope's back-top corner; rows below the LED's elevation floor are dropped
 *      (`frontClip`): they see the LED near edge-on and eclipse the rows above them.
 *   2. Aim distribution: sample aim points on the target plane with density ∝ paint weight (equal-weight
 *      bins along a snake scan).  With flux per facet roughly equalised, delivered flux per unit paint area
 *      ∝ the paint — the law of the target.  `edgeErode` pulls aims in from the paint edge (blur has tails).
 *   3. Facet flux: each facet's catch (I(θ) × cosβ × A / dist²) rescaled toward the median catch; the spot
 *      radius is set by the local facet spacing (fill ratio `facetFill`), clamped by the sag of its ellipsoid.
 *
 * No rays are traced here.  Determinism: no RNG — fixed quantile binning, fixed lattice, sorted assignments.
 */
RF.Solvers.register({
  id: 'bench-inkling2small-max--paint-spots', name: 'Paint Spots (static paint-matched facet array)', version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetFill', label: 'Facet radius ÷ spacing', type: 'range', min: 0.2, max: 0.6, step: 0.05, default: 0.42 },
    { key: 'edgeErode', label: 'Pull aim density in from paint edge (cells)', type: 'range', min: 0, max: 8, step: 0.5, default: 0 },
    { key: 'panelLean', label: 'Panel slope below horizontal (deg)', type: 'range', min: 10, max: 60, step: 1, default: 30 },
    { key: 'frontClip', label: 'Stop the panel where its elevation from the LED drops to (deg)', type: 'range', min: 0, max: 45, step: 1, default: 30 },
    { key: 'panelFill', label: 'Rect fill of the panel cells', type: 'range', min: 0.5, max: 0.97, step: 0.05, default: 0.85 },
  ],
  solve(input, settings, tools) {
    const V = RF.V, Geo = RF.Geo, Eng = RF.Engine;
    const env = input.envelope, lim = input.limits, src = input.source;
    const emitters = (input.sources && input.sources.length) ? input.sources : [src];
    // Design focus: the primary source (multi-emitter: power-weighted centroid)
    let pw = 0, cen = [0, 0, 0];
    for (const s of emitters) { const w = Math.max(0, s.power || 0); pw += w; cen[0] += w * s.pos[0]; cen[1] += w * s.pos[1]; cen[2] += w * s.pos[2]; }
    const L = pw > 0 ? [cen[0] / pw, cen[1] / pw, cen[2] / pw] : src.pos.slice();
    const totalPower = emitters.reduce((s, x) => s + Math.max(0, x.power || 0), 0);

    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const notes = [];

    // ---- target frame & paint ------------------------------------------------------
    const target = input.target, T = Eng.targetFrame(target);
    const paint = input.paint || { res: 0, cells: [] }, Rp = paint.res | 0, cells = paint.cells || [];
    const nCells = Rp * Rp;
    const cellWorld = (k) => {
      const i = k % Rp, j = (k / Rp) | 0, uv = Eng.cellCenter(T, i, j);
      return Eng.targetUVtoWorld(T, uv[0], uv[1]);
    };
    const painted = [];
    let paintWeight = 0;
    for (let k = 0; k < nCells; k++) { const w = cells[k] || 0; if (w > 0) { painted.push([k, w]); paintWeight += w; } }
    if (!painted.length || !(totalPower > 0)) {
      notes.push('empty paint or no power: nothing placed');
      return { surfaces: [], intent: [], notes };
    }
    const cellSize = (2 * T.half) / Rp;

    // distance from every cell to the nearest unpainted cell (chamfer, two passes) — for aim erosion
    const DT = new Float32Array(nCells).fill(1e9);
    for (let k = 0; k < nCells; k++) if (!(cells[k] > 0)) DT[k] = 0;
    const c1 = Math.SQRT2, pass = (fwd) => {
      for (let j = 0; j < Rp; j++) for (let ii = 0; ii < Rp; ii++) {
        const i = fwd ? ii : Rp - 1 - ii, k = j * Rp + i;
        const relax = (i2, j2, d) => { if (i2 < 0 || j2 < 0 || i2 >= Rp || j2 >= Rp) return; const q = j2 * Rp + i2; if (DT[q] + d < DT[k]) DT[k] = DT[q] + d; };
        relax(i - 1, j, 1); relax(i, j - 1, 1); relax(i - 1, j - 1, c1); relax(i + 1, j - 1, c1);
      }
    };
    pass(true); pass(false);

    // ---- facet positions on ONE tilted PANEL over the LED ---------------------------
    // A single plane hanging from the beam-extreme side of the envelope, facing back along the
    // LED axis and tilted toward the aim.  Every ray transits open space and exits through bare
    // envelope faces — no facet is ever struck by another's beam.  Facets are RECTANGLES filling
    // the panel: full aperture, nothing escaping between cells.
    const axis = V.norm(src.axis || [0, 0, 1]);
    const [u0, v0] = V.basis(axis);
    const aimGuess = (() => {   // rough aim direction (the paint's centroid), for frame construction
      let s = [0, 0, 0]; for (const [k, w] of painted) { const z = cellWorld(k); s[0] += w * (z[0] - L[0]); s[1] += w * (z[1] - L[1]); s[2] += w * (z[2] - L[2]); }
      return V.norm(s);
    })();
    // perp = the aim direction projected perpendicular to the beam (the panel's "vertical" plane direction)
    let perp = V.sub(aimGuess, V.mul(axis, V.dot(aimGuess, axis)));
    if (V.len(perp) < 0.15) { perp = V.cross(axis, [0, 0, 1]); if (V.len(perp) < 0.15) perp = V.cross(axis, [0, 1, 0]); }
    perp = V.norm(perp);
    let e2 = V.cross(axis, perp);
    if (V.len(e2) < 1e-6) e2 = V.cross([0, 0, 1], perp);
    e2 = V.norm(e2);
    const lean = (settings.panelLean === undefined ? 30 : settings.panelLean) * Math.PI / 180;   // panel tilt, deg
    const sC = Math.cos(lean), sS = Math.sin(lean);
    const slopeDir = V.norm(V.sub(V.mul(perp, sC), V.mul(axis, sS)));   // descends back into the beam
    // anchor: the extreme of the envelope in the beam direction (inset a touch), pulled inside if needed
    let axisT = Geo.envInterval(env, L, axis)[1];
    if (!isFinite(axisT) || axisT <= 1) axisT = Math.max(env.half[0], env.half[1], env.half[2]) * 0.8;
    const maxFacets = Math.max(1, lim.maxFacets | 0);
    const axisDom = (() => { let bi = 0, bd = -1; for (let a = 0; a < 3; a++) { const d = Math.abs(axis[a]); if (d > bd) { bd = d; bi = a; } } return bi; })();
    let anchor;
    if (env.shape === 'box') {
      anchor = env.center.slice();
      for (let a = 0; a < 3; a++) {
        if (Math.abs(aimGuess[a]) > 0.35) anchor[a] = env.center[a] - Math.sign(aimGuess[a]) * env.half[a] * 0.94;
        else if (a === axisDom) anchor[a] = env.center[a] + Math.sign(axis[a] || 1) * env.half[a] * 0.94;
      }
    } else {
      anchor = V.add(L, V.mul(axis, axisT * 0.92));
    }
    const rectFits = (C, L1, L2) => {
      for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
        const s = (i / 6 - 0.5) * Math.max(0, L1 - 1.2), t = (j / 6 - 0.5) * Math.max(0, L2 - 1.2);
        if (!Geo.envInside(env, V.add(C, V.add(V.mul(slopeDir, s), V.mul(e2, t))), 0)) return false;
      }
      return true;
    };
    for (let it = 0; it < 24 && !rectFits(anchor, 2.5, 2.5); it++) anchor = V.lerp(anchor, L, 0.25);
    let L2 = 2;
    for (let it = 0; it < 30; it++) { const Ln = L2 * 1.22; if (rectFits(anchor, 2, Ln)) L2 = Ln; }
    let L1 = 2;
    for (let it = 0; it < 30; it++) { const Ln = L1 * 1.22; const Cm = V.add(anchor, V.mul(slopeDir, Ln / 2)); if (rectFits(Cm, Ln, L2)) L1 = Ln; }
    const panelC = V.add(anchor, V.mul(slopeDir, L1 / 2));
    const proj = [];
    {
      const nRows = Math.max(1, Math.round(Math.sqrt(maxFacets * (L1 / Math.max(1e-9, L2)))));
      const nCols = Math.max(1, Math.floor(maxFacets / nRows));
      const fill = Math.max(0.4, Math.min(0.97, settings.panelFill === undefined ? 0.85 : settings.panelFill));
      const cell1 = L1 / nRows, cell2 = L2 / nCols;
      const hx = cell1 / 2 * fill, hy = cell2 / 2 * fill;
      const forwardOnly = src.kind === 'planar';   // a planar die emits into one hemisphere
      // elevation relative to the LED axis, for trimming near-horizontal rows (only meaningful for near-up axes)
      const elevMin = (settings.frontClip === undefined ? 30 : settings.frontClip) * Math.PI / 180;
      const axisZ = Math.abs(axis[2]) > 0.7;   // elevation clip only for near-vertical axes (it measures height)
      for (let i = 0; i < nRows; i++) {
        for (let j = 0; j < nCols; j++) {
          const s = (i + 0.5) / nRows * L1 - L1 / 2, t = (j + 0.5) / nCols * L2 - L2 / 2;
          const P = V.add(panelC, V.add(V.mul(slopeDir, s), V.mul(e2, t)));
          if (!Geo.envInside(env, P, 0)) continue;
          if (V.dist(P, L) < keep + 1.5) continue;
          if (forwardOnly && V.dot(V.sub(P, L), axis) < 1) continue;   // behind the die: dark
          if (axisZ) {
            const elev = Math.asin(Math.min(1, Math.max(-1, V.dot(V.norm(V.sub(P, L)), axis))));
            if (elev < elevMin) continue;   // drop near-horizontal edge-on rows (they eclipse the rows above them)
          }
          proj.push({ u: V.norm(V.sub(P, L)), t: V.dist(P, L), P, hx, hy, ref: e2.slice(), cell1, cell2 });
        }
      }
    }
    const N = proj.length;
    if (!N) { notes.push('no usable bowl fits the envelope'); return { surfaces: [], intent: [], notes }; }


    // ---- aim points: equal-weight bins along a snake scan, density ∝ paint -----------
    const er = Math.max(0, settings.edgeErode || 0);
    const qOf = (k, w) => er > 0 ? w * Math.max(0.12, Math.min(1, DT[k] / er)) : w;
    // snake order over rows (v up), splitting into N consecutive bins of equal total weight
    const order = [];
    for (let j = 0; j < Rp; j++) {
      if ((j & 1) === 0) {
        for (let i = 0; i < Rp; i++) if (cells[j * Rp + i] > 0) order.push(j * Rp + i);
      } else {
        for (let i = Rp - 1; i >= 0; i--) if (cells[j * Rp + i] > 0) order.push(j * Rp + i);
      }
    }
    let qTotal = 0; for (const k of order) qTotal += qOf(k, cells[k]);
    const aims = [];
    {
      let bin = 0, acc = 0, sum = [0, 0, 0], sweight = 0, seen = 0;
      const per = qTotal / N;
      for (const k of order) {
        const q = qOf(k, cells[k]), z = cellWorld(k);
        sum[0] += q * z[0]; sum[1] += q * z[1]; sum[2] += q * z[2]; sweight += q; seen++; acc += q;
        if (acc >= per * (bin + 1) && aims.length < N - 1) {
          aims.push([sum[0] / sweight, sum[1] / sweight, sum[2] / sweight]);
          bin++; sum = [0, 0, 0]; sweight = 0;
        }
      }
      if (sweight > 0 || seen) aims.push([sum[0] / (sweight || 1), sum[1] / (sweight || 1), sum[2] / (sweight || 1)]);
      while (aims.length < N) aims.push(aims[aims.length - 1].slice());   // (only for trivial paint)
    }

    // ---- facet sizes: spacing-limited discs; catch equalised; sag-aware envelope fit ---------
    const sagK = (P, Z, di) => {
      const fq = Geo.facetQuadric(P, L, Z, di);
      const A = fq.A;                                  // |b| = 1, b ≈ ∓n → sag z ≈ xᵀAx
      let v = [1, 2, 3], lam = 1;
      for (let it = 0; it < 16; it++) {
        const w = [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
        const l = Math.hypot(w[0], w[1], w[2]) || 1e-12; v = [w[0] / l, w[1] / l, w[2] / l]; lam = l;
      }
      return Math.abs(lam);
    };
    const facetNormalAt = (P, Z) => V.norm(V.add(V.norm(V.sub(L, P)), V.norm(V.sub(Z, P))));
    const minChord = new Float64Array(N).fill(Infinity);
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
      const d = V.dist(proj[a].P, proj[b].P);
      if (d < minChord[a]) minChord[a] = d;
      if (d < minChord[b]) minChord[b] = d;
    }
    const fill = Math.max(0.2, Math.min(0.6, settings.facetFill || 0.42));
    const peakI = RF.Source.intensity(src, 0);
    const catchOf = (k, r) => {
      const P = proj[k].P, u = V.norm(V.sub(P, L));
      const cosT = Math.max(1e-3, V.dot(u, axis));
      const I = RF.Source.intensity(src, Math.acos(Math.min(1, cosT)));
      const Zg = aims[k % aims.length];
      const cosB = Math.max(0.08, V.dot(facetNormalAt(P, Zg), V.norm(V.sub(L, P))));
      const d = Math.max(1, V.dist(P, L));
      return I * cosB * Math.PI * r * r / (d * d);
    };
    const radii = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const Zg = aims[k % aims.length];
      const cosT = Math.max(1e-3, V.dot(proj[k].u, axis));
      const I = RF.Source.intensity(src, Math.acos(Math.min(1, cosT)));
      const Pp = proj[k].P;
      const cosB = Math.max(0.08, V.dot(facetNormalAt(Pp, Zg), V.norm(V.sub(L, Pp))));
      const chord = isFinite(minChord[k]) ? minChord[k] : 30;
      let r = fill * chord * Math.sqrt(Math.min(4, peakI / Math.max(1e-3, I * cosB)) * 0.5 + 0.5);
      r = Math.min(0.48 * chord, Math.min(60, r));
      r = Math.max(1.2, r);
      radii[k] = r;
    }
    {   // median rescale; clamp to neighbours and to the envelope
      const cs = [];
      for (let k = 0; k < N; k++) cs.push(catchOf(k, radii[k]));
      const sorted = cs.slice().sort((p, q) => p - q), med = sorted[sorted.length >> 1] || 1;
      if (med > 0) for (let k = 0; k < N; k++) {
        const s = Math.sqrt(med / (cs[k] || med));
        radii[k] = Math.min(0.48 * (isFinite(minChord[k]) ? minChord[k] : 30), Math.max(1.2, radii[k] * s));
      }
    }
    // sag + envelope fit: shrink the radius until the disc stays inside
    for (let k = 0; k < N; k++) {
      const Zg = aims[k % aims.length], P = proj[k].P;
      const nF = facetNormalAt(P, Zg);
      const di = Math.max(1, V.dist(P, Zg));
      for (let it = 0; it < 6; it++) {
        const sag = radii[k] * radii[k] * sagK(P, Zg, di);
        let ok = true;
        if (env.shape === 'box') {
          for (let a = 0; a < 3 && ok; a++) {
            const sA = Math.sqrt(Math.max(1e-9, 1 - nF[a] * nF[a]));
            const need = radii[k] * sA + sag + 0.3;
            if (Math.abs(P[a] - env.center[a]) + need > env.half[a]) ok = false;
          }
        } else ok = true;   // outline backstop handles it
        if (ok) break;
        radii[k] *= 0.72;
      }
    }

    // pair facets with aims: anti-height pairing (which aims at which is near-neutral for quality)
    {
      const iU = [...Array(N).keys()].sort((a, b) => proj[b].P[2] - proj[a].P[2]);
      const iA = [...Array(N).keys()].sort((a, b) => engCellUV(T, aims[a])[1] - engCellUV(T, aims[b])[1]);
      const aimOf = new Array(N);
      for (let k = 0; k < N; k++) aimOf[iU[k]] = aims[iA[k]];
      proj.forEach((p, i) => { p.aim = aimOf[i]; });
    }

    // ---- build surfaces --------------------------------------------------------------
    const surfaces = [], intent = [];
    const ref = lim.reflectivity, maxIntent = 80;
    const aimOf = proj.map((p) => p.aim);
    for (let k = 0; k < N; k++) {
      const P = proj[k].P, Z = aimOf[k];
      const di = Math.max(1, V.dist(P, Z));
      const id = 'F' + k;
      if (!(radii[k] >= 0.3)) { intent.push({ facet: null, cells: [] }); continue; }   // no room: unplaced
      surfaces.push({
        type: 'facet', id, group: 'A', P, S0: L.slice(), Z, di,
        clip: { kind: 'disc', r: radii[k] },
        optics: { interaction: 'reflect', reflectivity: ref, twoSided: false },
      });
      // intent: painted cells within ~half the LED image of the aim, weighted by overlap
      const rLed = Math.max(src.w !== undefined && src.h !== undefined ? Math.max(src.w, src.h) : (2 * (src.radius || 1)), 1);
      const rSpot = Math.max(di * rLed / Math.max(1, V.dist(P, L)) / 2, 1.5 * cellSize, 1.6 * radii[k]);
      const zA = Z, reach2 = rSpot * rSpot, cellsOut = [];
      // cells near the aim: scan the bounding box in paint coordinates
      const uv0 = engCellUV(T, zA);
      if (uv0) {
        const ci = Math.round((uv0[0] + T.half) / cellSize - 0.5), cj = Math.round((uv0[1] + T.half) / cellSize - 0.5);
        const cr = Math.ceil(rSpot / cellSize);
        for (let j = Math.max(0, cj - cr); j <= Math.min(Rp - 1, cj + cr); j++) for (let i = Math.max(0, ci - cr); i <= Math.min(Rp - 1, ci + cr); i++) {
          const kk = j * Rp + i, w = cells[kk]; if (!(w > 0)) continue;
          const uv = Eng.cellCenter(T, i, j);
          const du = uv[0] - uv0[0], dv = uv[1] - uv0[1], d2 = du * du + dv * dv;
          if (d2 > reach2) continue;
          cellsOut.push([kk, w * Math.max(0, 1 - d2 / reach2)]);
        }
      }
      cellsOut.sort((a, b) => b[1] - a[1]);
      intent.push({ facet: id, cells: cellsOut.slice(0, maxIntent) });
    }

    // ---- safety: compile & shrink/drop every surface that breaks the envelope or the LED clearance
    let fixed = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      let G = null; try { G = Geo.compile(surfaces); } catch (e) { G = null; }
      if (!G) { notes.push('compile failed'); return { surfaces: [], intent: [], notes }; }
      const bad = [];
      for (let k = 0; k < surfaces.length; k++) {
        if (!surfaces[k]) continue;
        let ok = true;
        for (const poly of Geo.outline(G, k)) for (const p of poly) {
          if (!Geo.envInside(env, p, 1e-6 * Math.max(...env.half))) { ok = false; break; }
          if (keep > 0 && V.dist(p, src.pos) < keep * (1 - 1e-6)) { ok = false; break; }
        }
        if (!ok) bad.push(k);
      }
      if (!bad.length) break;
      for (const k of bad) { const cl = surfaces[k].clip; if (cl.kind === 'rect') { cl.hx *= 0.7; cl.hy *= 0.7; } else if (cl.r !== undefined) cl.r *= 0.7; }
      fixed += bad.length;
      if (attempt === 3) for (const k of bad) { const vid = surfaces[k].id, si = intent.findIndex((x) => x.facet === vid); surfaces[k] = null; if (si >= 0) intent[si] = { facet: null, cells: intent[si].cells }; }
    }
    const outSurfaces = surfaces.filter((s) => s);
    const outIntent = intent.filter((x, i) => surfaces[i] !== null || x.facet === null);

    notes.push(outSurfaces.length + ' facets, aim density ∝ paint, image focused on target (étendue-limited spot).');
    if (fixed) notes.push(fixed + ' facet(s) shrunk to fit the envelope / LED clearance.');

    return { surfaces: outSurfaces, intent: outIntent, notes };
  },
});

/* Paint Spots (auto) — picks the best static design for the user's goal by tracing candidates with a fixed seed.
 * Only the candidate's settings differ; the seed is identical, so differences are geometry, not noise.
 * Exempt from the "no tracing inside solve()" rule by its -auto id.
 */
RF.Solvers.register({
  id: 'bench-inkling2small-max--paint-spots-auto', name: 'Paint Spots (auto-tuned)', version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-inkling2small-max--paint-spots');
    const defBase = base.settings.reduce((o, f) => { o[f.key] = f.default; return o; }, {});
    const goal = settings.goal || 'faithful';
    // candidate settings around the tuned defaults (same seed every candidate)
    const candidates = [
      Object.assign({}, defBase, { minDistance: settings.minDistance || 0, panelLean: 30, frontClip: 30, panelFill: 0.85 }),
      Object.assign({}, defBase, { minDistance: settings.minDistance || 0, panelLean: 36, frontClip: 24, panelFill: 0.85 }),
      Object.assign({}, defBase, { minDistance: settings.minDistance || 0, panelLean: 24, frontClip: 34, panelFill: 0.85 }),
      Object.assign({}, defBase, { minDistance: settings.minDistance || 0, panelLean: 34, frontClip: 30, panelFill: 0.85 }),
    ];
    let best = null, bestScore = -Infinity, bestLabel = '';
    for (const cand of candidates) {
      const out = base.solve(input, cand, tools);
      const res = tools.trace(out.surfaces, { rays: 250000, seed: input.seed });
      let s = 0;
      if (goal === 'throw') s = (res.peakCd || 0);
      else if (goal === 'efficient') s = (res.fidelity && res.fidelity.onPaint) || 0;
      else s = (res.fidelity && res.fidelity.fidelity) || 0;
      if (s > bestScore) { bestScore = s; best = out; bestLabel = JSON.stringify(cand); }
    }
    const notes = (best.notes || []).slice();
    notes.push('auto (' + goal + '): picked ' + bestLabel);
    return { surfaces: best.surfaces, intent: best.intent, notes };
  },
});

function engCellUV(Tf, world) {
  return [Tf.tu[0] * (world[0] - Tf.C[0]) + Tf.tu[1] * (world[1] - Tf.C[1]) + Tf.tu[2] * (world[2] - Tf.C[2]),
          Tf.tv[0] * (world[0] - Tf.C[0]) + Tf.tv[1] * (world[1] - Tf.C[1]) + Tf.tv[2] * (world[2] - Tf.C[2])];
}
