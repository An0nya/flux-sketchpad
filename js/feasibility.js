/* feasibility.js — when the request is impossible, say which physical limit binds and by how
 * much.  Four limits, each reduced to a ratio  (what the request needs) / (what physics allows);
 * ratio > 1 means violated, and the largest ratio is the BINDING constraint.
 *
 *  1. Minimum feature size — a tile is at least the magnified source image (tile model J_S Σ_S J_Sᵀ).
 *  2. Étendue — (emitter area × projected emission solid angle of the captured light) cannot shrink.
 *     The beam leaving the envelope aperture must fill ≥ E/A_exit steradians.
 *  3. Interceptable flux — the envelope caps the fraction of lamp output the optic can catch.
 *  4. Facet budget / self-shadowing — N tiles quantise the pattern at ~√(A/N) cells; occlusion
 *     loses light the trace measures directly.
 * All estimates are first-order (stated in the UI); the ray trace is the ground truth.          */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V, Geo } = RF;
  const D2R = Math.PI / 180, SQ12 = Math.sqrt(12);

  // 8-neighbour chamfer distance (cells) from each mask cell to the nearest non-mask cell.
  function distanceInside(mask, res) {
    const INF = 1e9, d = new Float64Array(res * res), s2 = Math.SQRT2;
    for (let i = 0; i < res * res; i++) d[i] = mask[i] ? INF : 0;
    const at = (i, j) => (i < 0 || j < 0 || i >= res || j >= res ? 0 : d[j * res + i]);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const k = j * res + i; if (!mask[k]) continue;
      d[k] = Math.min(d[k], at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + s2, at(i + 1, j - 1) + s2);
    }
    for (let j = res - 1; j >= 0; j--) for (let i = res - 1; i >= 0; i--) {
      const k = j * res + i; if (!mask[k]) continue;
      d[k] = Math.min(d[k], at(i + 1, j) + 1, at(i, j + 1) + 1, at(i + 1, j + 1) + s2, at(i - 1, j + 1) + s2);
    }
    return d;
  }
  function components(mask, res) {
    const lab = new Int32Array(res * res).fill(-1), comps = [];
    for (let k = 0; k < res * res; k++) {
      if (!mask[k] || lab[k] >= 0) continue;
      const id = comps.length, list = [k]; lab[k] = id;
      for (let q = 0; q < list.length; q++) {
        const c = list[q], i = c % res, j = (c / res) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= res || b >= res) continue;
          const n = b * res + a; if (mask[n] && lab[n] < 0) { lab[n] = id; list.push(n); }
        }
      }
      comps.push(list);
    }
    return comps;
  }
  // Finest feature of a mask: min over components of the largest inscribed width (2d − 1 cells);
  // also enclosed holes (unpainted regions not touching the border).
  function finestFeature(mask, res) {
    let finest = Infinity, where = '';
    const din = distanceInside(mask, res);
    for (const c of components(mask, res)) { const w = 2 * Math.max(...c.map((k) => din[k])) - 1; if (w < finest) { finest = w; where = 'lit feature'; } }
    const inv = mask.map((m) => (m ? 0 : 1));
    const dout = distanceInside(inv, res);
    for (const c of components(inv, res)) {
      if (c.some((k) => { const i = k % res, j = (k / res) | 0; return i === 0 || j === 0 || i === res - 1 || j === res - 1; })) continue;
      const w = 2 * Math.max(...c.map((k) => dout[k])) - 1; if (w < finest) { finest = w; where = 'dark gap'; }
    }
    return { width: finest, where };
  }

  function projectedArea(env, d) {
    const h = env.half, a = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])];
    if (env.shape === 'box') return 4 * (a[0] * h[1] * h[2] + a[1] * h[0] * h[2] + a[2] * h[0] * h[1]);
    if (env.shape === 'ellipsoid') return Math.PI * Math.hypot(h[1] * h[2] * a[0], h[0] * h[2] * a[1], h[0] * h[1] * a[2]);
    const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
    const ew = Math.hypot(h[i] * d[j], h[j] * d[i]) / Math.max(1e-12, Math.hypot(d[i], d[j]));
    return Math.PI * h[i] * h[j] * a[ax] + 2 * h[ax] * 2 * ew * Math.sqrt(Math.max(0, 1 - a[ax] * a[ax]));
  }

  // Fraction of source flux that could meet the envelope at all (directions with room)
  function reachableFlux(scene) {
    const src = scene.source, fr = RF.Source.frame(src);
    const Itot = RF.Source.totalIntegral(src);
    const tm = RF.Source.thetaMax(src);
    let f = 0; const NT = 90, NP = 72;
    for (let a = 0; a < NT; a++) {
      const th = (a + 0.5) / NT * tm, I = RF.Source.intensity(src, th);
      if (!(I > 0)) continue;
      for (let b = 0; b < NP; b++) {
        const ph = (b + 0.5) / NP * 360;
        if (RF.ModeB.room(scene, RF.ModeB.srcDir(fr, th / D2R, ph))) f += I * Math.sin(th) * (tm / NT) * (2 * Math.PI / NP);
      }
    }
    return f / Itot;
  }
  // Étendue of the source's emission (area × projected solid angle), for the captured fraction.
  function sourceEtendue(src, frac) {
    const A = RF.Source.emittingArea(src);
    if (!(A > 0)) return 0;
    // projected solid angle holding 95% of the flux
    const tm = RF.Source.thetaMax(src), N = 2000, Itot = RF.Source.totalIntegral(src);
    let acc = 0, th95 = tm;
    for (let i = 0; i < N; i++) { const t = (i + 0.5) / N * tm; acc += RF.Source.intensity(src, t) * Math.sin(t) * 2 * Math.PI * tm / N; if (acc >= 0.95 * Itot) { th95 = t; break; } }
    const omegaProj = src.kind === 'planar' ? Math.PI * Math.sin(th95) ** 2 : 2 * Math.PI * (1 - Math.cos(th95));
    return A * omegaProj * Math.min(1, Math.max(0, frac));
  }

  /* analyze(scene, {designReport, stats}) → { items, binding, summary } */
  function analyze(scene, ctx) {
    ctx = ctx || {};
    const items = [];
    if (!RF.Solver) return { items, binding: false, summary: 'Physical-limits check unavailable in this build (it uses the built-in solver\u2019s tile model).' };   // e.g. a benchmark workspace
    const info = RF.Solver.paintInfo(scene), T = info.T, res = T.res, cell = 2 * T.half / res;
    const src = scene.source, S = src.pos;
    const srcSize = RF.Source.extentSize(src);
    const mode = scene.mode;
    const hasPaint = info.n > 0 && mode === 'A';
    const Zc = hasPaint ? RF.Engine.targetUVtoWorld(T, info.cu, info.cv) : RF.Engine.aimPoint(scene.target);
    const dT = V.dist(S, Zc);
    const facets = (scene.groups.A.surfaces || []).concat(scene.groups.B.surfaces || []).filter((f) => f.type === 'facet');

    // ---- 1. minimum feature size
    let bestW = Infinity, typW = NaN;
    const widths = [];
    for (const f of facets) {
      const m = RF.Solver.tileModel(T, src, { P: f.P, S0: f.S0, Z: f.Z, flat: false, di: V.dist(f.P, f.Z), apCov: [0, 0, 0] });
      if (m.ok) widths.push(m.sigmaS * SQ12 / cell);
    }
    if (widths.length) { widths.sort((a, b) => a - b); bestW = widths[0]; typW = widths[widths.length >> 1]; }
    else {
      // no design yet: best case = farthest envelope point, far-field magnification
      const env = scene.envelope; let rFar = 0;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) rFar = Math.max(rFar, V.dist(S, [env.center[0] + sx * env.half[0], env.center[1] + sy * env.half[1], env.center[2] + sz * env.half[2]]));
      bestW = srcSize * dT / Math.max(rFar, 1e-300) / cell;
    }
    if (hasPaint) {
      const mask = scene.modeA.paint.map((w) => (w > 0 ? 1 : 0));
      const mx = Math.max(...scene.modeA.paint);
      const f1 = finestFeature(mask, res);
      const f2 = finestFeature(scene.modeA.paint.map((w) => (w >= 0.5 * mx && w > 0 ? 1 : 0)), res);
      const fine = f2.width < f1.width ? Object.assign(f2, { where: f2.where + ' (bright level)' }) : f1;
      const ratio = srcSize > 0 ? bestW / fine.width : 0;
      items.push({
        key: 'feature', title: 'Minimum feature size', ratio,
        text: srcSize > 0
          ? 'Minimum achievable feature ≈ ' + bestW.toFixed(2) + ' cells (source image through the best facet' + (widths.length ? '; median facet ' + typW.toFixed(2) + ' cells' : ', envelope best case') + '). Finest painted ' + fine.where + ': ' + fine.width.toFixed(1) + ' cells.'
          : 'Point source: tiles can be arbitrarily sharp (no source-size limit).',
      });
    } else if (mode === 'B' && ctx.stampReports) {
      const cl = ctx.stampReports.filter((r) => r.clamped);
      items.push({ key: 'feature', title: 'Minimum feature size', ratio: cl.length ? 1.0001 : bestW > 0 ? 0 : 0,
        text: cl.length ? cl.length + ' stamp(s) clamped by their source image: ' + cl.map((r) => r.reasons[0]).join(' ') : 'All stamps are at or above their minimum tile (best facet ' + (isFinite(bestW) ? bestW.toFixed(2) : '—') + ' cells).' });
    }

    // ---- 2. étendue
    const fromDesign = !!(ctx.designReport && ctx.designReport.capturedFraction !== undefined);
    const Fcap = fromDesign ? ctx.designReport.capturedFraction : reachableFlux(scene);
    const Esrc = sourceEtendue(src, Fcap);
    const dir = V.norm(V.sub(Zc, S));
    const Aexit = projectedArea(scene.envelope, dir);
    if (hasPaint) {
      const litArea = info.n * cell * cell * Math.abs(V.dot(T.n, dir));
      const omegaP = litArea / (dT * dT);
      const Ebeam = Aexit * omegaP;
      const ratio = Ebeam > 0 ? Esrc / Ebeam : Infinity;
      const minCells = Esrc / Aexit * dT * dT / (cell * cell);
      items.push({
        key: 'etendue', title: 'Étendue', ratio,
        text: Esrc > 0
          ? 'Captured light has étendue ' + RF.U.fmt(Esrc, 3) + ' mm²·sr; the envelope aperture (' + RF.U.fmt(Aexit, 0) + ' mm²) must spread it over ≥ ' + RF.U.fmt(Esrc / Aexit, 3) + ' sr ⇒ a pattern of ≥ ' + minCells.toFixed(1) + ' cells. Painted: ' + info.n + ' cells.'
          : 'Point source: zero étendue, never binding.',
      });
    }

    // ---- 3. interceptable flux
    const R = scene.modeA.reflectivity;
    const req = (scene.modeA.requiredFlux || 0) / 100;
    const deliverable = Fcap * R;
    items.push({
      key: 'flux', title: 'Interceptable flux', ratio: req > 0 ? req / Math.max(1e-12, deliverable) : 0,
      text: (fromDesign ? 'The current design catches ' : 'Upper bound (every emitted direction that meets the envelope): the optic could catch ') + (Fcap * 100).toFixed(1) + '% of the lamp (×' + R + ' reflectivity ⇒ ≤ ' + (deliverable * 100).toFixed(1) + '% redirected).' +
        (req > 0 ? ' Requested: ' + (req * 100).toFixed(1) + '% into the pattern.' : ' No absolute level requested (shape only).'),
    });

    // ---- 4. facet budget & self-shadowing
    if (hasPaint) {
      const N = Math.max(1, facets.filter((f) => f.group === 'A').length || scene.modeA.budget);
      const q = Math.sqrt(info.n / N);
      const mask = scene.modeA.paint.map((w) => (w > 0 ? 1 : 0));
      const fine = finestFeature(mask, res).width;
      const occ = ctx.stats ? ctx.stats.occlusion : null, pc = (x) => (x * 100).toFixed(1) + '%';
      items.push({
        key: 'budget', title: 'Facet budget & occlusion', ratio: q / fine,
        text: N + ' tiles over ' + info.n + ' painted cells quantise the pattern at ≈ ' + q.toFixed(1) + ' cells per tile (finest lit feature ' + fine.toFixed(0) + ' cells).' +
          (occ ? ' Blocked: ' + pc(occ.blocked) + ' of reflected light runs into another surface' + (occ.blockedWorst.length ? ' (worst ' + occ.blockedWorst.slice(0, 2).map((w) => w.id + ' ' + pc(w.lost)).join(', ') + ')' : '') + '.' +
            (occ.shadowed !== null ? ' Shadowed: ' + pc(occ.shadowed) + ' of facets\u2019 source cones is caught by another surface first.' : '') : ''),
      });
    }

    let binding = null, worst = 1;
    for (const it of items) { it.violated = it.ratio > 1; if (it.ratio > worst) { worst = it.ratio; binding = it.key; } }
    const b = items.find((i) => i.key === binding);
    const summary = b ? 'Binding: ' + b.title + ' — exceeded ×' + b.ratio.toFixed(2) + '.' : 'No physical limit binds (first-order check).';
    return { items, binding, summary };
  }

  RF.Feasibility = { analyze, finestFeature, distanceInside, reachableFlux, sourceEtendue, projectedArea };
})(typeof globalThis !== 'undefined' ? globalThis : this);
