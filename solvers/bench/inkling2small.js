/* Flux solver — "Faceted paint" (static, no ray tracing)
 *
 * Design (see solvers/NOTES.md):
 *   1. Demand = the paint.  Aims are quantile samples of the gamma-weighted paint CDF — equal flux per
 *      aim.  Equal-flux spots with aims distributed ∝ paint make delivered intensity ∝ paint density:
 *      the painting convolved with the LED's étendue kernel (spot ≈ LED·D/r).
 *   2. Facet positions: a regular equal-area Fibonacci lattice (generated on the full sphere, keep the
 *      cap ∩ LED emission range), each pushed to the envelope shell; shell radius limited by an
 *      adaptive rule (spot ≈ spotFactor × aim spacing) and the wall.
 *   3. Aim field ⇒ exact quadric ellipsoid foci LED → aim: the LED's image lands ON the target plane
 *      (di = |P−aim|), i.e. the smallest image geometry allows.  di is the image distance in mm.
 *   4. Equal mass F per facet: Ω = F/(I·cosI) subject to a per-facet neighbour-overlap cap
 *      (π·(0.46·minAngularDistance)², discs fit between lattice neighbours).  The envelope wall and the
 *      effective LED keep (max(envelope.keepOut, minDistance)) are honoured by exact-outline fit tests
 *      (compile + RF.Geo.outline + envInside, same code path as the verifier) — a facet that cannot fit
 *      is dropped.  No rays are traced anywhere.
 *   5. Deterministic: every quantity is closed-form; no randomness.  Order-fixed loops, fixed grids.
 */
function solveStatic(input, settings) {
    const V = RF.V, E = RF.Engine;
    const src = input.source, env = input.envelope, tgt = input.target;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const paint = input.paint.cells, R = input.paint.res, nCells = R * R;
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity;
    const notes = [];
    const S = src.pos.slice();
    const Fr = E.targetFrame(tgt);

    // ---- 1) demand: quantile samples of the (gamma-weighted) paint CDF
    const w = new Float64Array(nCells);
    let totW = 0;
    const gamma = Math.max(0.05, +settings.aimGamma || 1);
    for (let k = 0; k < nCells; k++) { const p = paint[k] > 0 ? Math.pow(paint[k], gamma) : 0; w[k] = p; totW += p; }
    if (!(totW > 0)) { notes.push('paint is empty: no facets placed'); return { surfaces: [], intent: [], notes }; }
    const aimsW = [];  // [aim, weight] for pairing decisions
    {
      // Row weights nearly identical?  Then a row-major walk can alias with the grid (aim stride ≈ res).
      // Use a Morton (Z-order) walk instead, which is non-aliased for uniform paints; otherwise row-major.
      const rowSum = new Float64Array(R);
      for (let j = 0; j < R; j++) { let r = 0; for (let i = 0; i < R; i++) r += w[j * R + i]; rowSum[j] = r; }
      let rowMin = Infinity, rowMax = 0; for (let j = 0; j < R; j++) { if (rowSum[j] > 0) { rowMin = Math.min(rowMin, rowSum[j]); rowMax = Math.max(rowMax, rowSum[j]); } }
      const uniformRows = rowMax > 0 && rowMax < 1.25 * rowMin;
      const mortonWalk = uniformRows;
      const order = [];
      if (mortonWalk) {
        const bits = Math.ceil(Math.log2(Math.max(2, R)));
        const morton = (i, j) => { let key = 0; for (let b = 0; b < bits; b++) key |= (((i >> b) & 1) << (2 * b)) | (((j >> b) & 1) << (2 * b + 1)); return key >>> 0; };
        for (let k = 0; k < nCells; k++) if (w[k] > 0) order.push(k);
        order.sort((a, b) => morton(a % R, (a / R) | 0) - morton(b % R, (b / R) | 0));
      } else {
        for (let k = 0; k < nCells; k++) if (w[k] > 0) order.push(k);
      }
      let acc = 0, p = 0;
      for (let s = 0; s < maxF; s++) {
        const q = (s + 0.5) * totW / maxF;
        while (p < order.length - 1 && acc + w[order[p]] <= q) { acc += w[order[p]]; p++; }
        const k = order[p], i = k % R, j = (k / R) | 0, uv = E.cellCenter(Fr, i, j);
        aimsW.push([E.targetUVtoWorld(Fr, uv[0], uv[1]), paint[j * R + i]]);
      }
    }
    const aims = aimsW.map((a) => a[0]);

    // ---- 2) direction lattice: REGULAR equal-area Fibonacci lattice on the emission cap (min angular spacing),
    //        flux equalised afterwards by facet size, never bycrowding directions.
    const fr = RF.Source.frame(src);
    const planar = src.kind === 'planar';
    const absCap = planar ? 90 : 180;
    const absMaxI = Math.max(1e-9, (() => { let m = 0; for (let d = 0; d <= absCap; d += 2) m = Math.max(m, RF.Source.intensity(src, d * Math.PI / 180)); return m; })());
    // natural cap: cut where the LED effectively stops emitting (4% of axis intensity), or the user's cap.
    // A full-range (quasi-)isotropic source (intensity never below half of max anywhere) is covered entirely.
    let flatAll = true;
    for (let d = 0; d <= absCap; d += 10) if (!(RF.Source.intensity(src, d * Math.PI / 180) > 0.5 * absMaxI)) { flatAll = false; break; }
    let naturalCap = absCap;
    for (let d = absCap; d >= 0; d -= 1) { if (RF.Source.intensity(src, d * Math.PI / 180) > 0.04 * absMaxI) { naturalCap = Math.min(absCap, d); break; } }
    let thetaCap = (flatAll ? absCap : Math.min(+settings.thetaCap || 65, naturalCap)) * Math.PI / 180;
    if (!(thetaCap > 0.05)) thetaCap = 0.05;
    const fullSphere = thetaCap >= Math.PI * 0.999;
    const fill = Math.max(0.05, Math.min(0.99, +settings.fill || 0.9));
    const omCap = fullSphere ? 4 * Math.PI : 2 * Math.PI * (1 - Math.cos(thetaCap));
    const cosMin = fullSphere ? -1 : Math.cos(thetaCap);
    const dirs = [];
    {
      const ga = Math.PI * (3 - Math.sqrt(5));
      const f = fullSphere ? 1 : (1 - cosMin) / 2;                 // cap share of the hemisphere... of the sphere
      const nTot = Math.ceil(maxF / Math.max(1e-6, f)) + 8;
      const cand = [];
      for (let k = 0; k < nTot; k++) {
        const t = (k + 0.5) / nTot;
        const z = 1 - 2 * t;
        if (z < cosMin - 1e-9) continue;                            // outside the emission cap
        const rr = Math.sqrt(Math.max(0, 1 - z * z)), phi = k * ga;
        cand.push([z, rr, phi]);
      }
      // thin the kept set to exactly maxF (even index stride keeps the spacing)
      const stride = cand.length / maxF;
      for (let k = 0; k < maxF; k++) {
        const c = cand[Math.min(cand.length - 1, Math.floor((k + 0.5) * stride))];
        const z = c[0], rr = c[1], phi = c[2];
        dirs.push(V.norm(V.add(V.add(V.mul(fr.u, rr * Math.cos(phi)), V.mul(fr.v, rr * Math.sin(phi))), V.mul(fr.a, z))));
      }
      // if the cap was wider than expected (containment rounding), vm.top up from the candidate list
      while (dirs.length < maxF) dirs.push(dirs[dirs.length - 1] || V.norm(fr.a));
    }
    // ---- aim↔direction pairing (capability-ordered)
    if (settings.pairing !== 'inorder') {
      const caps = [];
      // rank aims by weight
      const aimIdx = [...Array(maxF).keys()].sort((a, b) => aimsW[b][1] - aimsW[a][1]);
      for (let k = 0; k < maxF; k++) {
        const om = dirs[k], aim = aimsW[k][0];
        const iv = RF.Geo.envInterval(env, S, om);
        const r = Math.max(1, iv[1] - 2);
        const P = V.add(S, V.mul(om, r));
        const sh = V.norm(V.sub(S, P)), ah = V.norm(V.sub(aim, P));
        const cosI = Math.max(0.18, Math.abs(V.dot(V.norm(V.add(sh, ah)), sh)));
        const th = Math.acos(Math.max(-1, Math.min(1, V.dot(om, fr.a))));
        caps.push(Math.max(1e-9, RF.Source.intensity(src, th)) * cosI);
      }
      const dirIdx = [...Array(maxF).keys()].sort((a, b) => (settings.pairing === 'flatten' ? caps[a] - caps[b] : caps[b] - caps[a]));
      const paired = new Array(maxF);
      for (let i = 0; i < maxF; i++) paired[dirIdx[i]] = aimsW[aimIdx[i]][0];
      for (let k = 0; k < maxF; k++) aims[k] = paired[k];
    }

    // nearest-neighbour distance per direction (for sizing caps)
    const minAng = new Float64Array(maxF).fill(Math.PI);
    for (let i = 0; i < maxF; i++) for (let j = i + 1; j < maxF; j++) {
      const c = Math.max(-1, Math.min(1, V.dot(dirs[i], dirs[j])));
      const a = Math.acos(c); if (a < minAng[i]) minAng[i] = a; if (a < minAng[j]) minAng[j] = a;
    }

    // ---- 3) per facet: shell position, aim pairing, ellipsoid, equal-flux sizing, exact fit
    const surfaces = [], intent = [];
    const ledHalf = src.kind === 'planar' ? (src.shape === 'disc' ? src.radius : Math.min(src.w, src.h) / 2)
      : (src.shape === 'cylinder' ? Math.min(src.radius, src.length / 2) : src.radius);

    // first pass: equal-mass F from estimated incidence cosines
    const cosIest = [], Ints = [];
    for (let k = 0; k < maxF; k++) {
      const om = dirs[k], aim = aims[k];
      const iv = RF.Geo.envInterval(env, S, om);
      const r = Math.max(1, iv[1] - 2);
      const P = V.add(S, V.mul(om, r));
      const sh = V.norm(V.sub(S, P)), ah = V.norm(V.sub(aim, P));
      cosIest.push(Math.max(0.18, Math.abs(V.dot(V.norm(V.add(sh, ah)), sh))));
      const th = Math.acos(Math.max(-1, Math.min(1, V.dot(om, fr.a))));
      Ints.push(Math.max(1e-9, RF.Source.intensity(src, th)));
    }
    const intFloor = 0.05 * absMaxI;                      // never let a zero-intensity direction blow up the normalisation
    for (let k = 0; k < maxF; k++) Ints[k] = Math.max(intFloor, Ints[k]);
    let invSum = 0; for (let k = 0; k < maxF; k++) invSum += 1 / (Ints[k] * cosIest[k]);
    const F = fill * omCap / Math.max(1e-12, invSum);

    // adaptive shell radius: spot ≈ spotFactor × aim spacing (painted area per goal facet)
    let rAuto = Infinity;
    {
      const cellW = 2 * Fr.half / Fr.res;
      let pc = 0;
      for (let k = 0; k < nCells; k++) if (paint[k] > 0) pc++;
      const areaPaint = pc * cellW * cellW;
      const spacing = Math.sqrt(areaPaint / maxF);
      const spotT = Math.max(1, +settings.spotFactor || 2.4);
      const ledMin = Math.max(0.5, ledHalf * 2);
      rAuto = ledMin * tgt.distance / (spotT * Math.max(1, spacing));
    }

    // fixed-point shell distance solve (pre-pass, shared with tryPlace's structure)
    function omEstOf(k, Int, cosI) {
      const omN = Math.PI * (0.46 * minAng[k]) * (0.46 * minAng[k]);   // fits between lattice neighbours
      return Math.min(F / (Int * cosI), omN);
    }


    for (let k = 0; k < maxF; k++) {
      const om = dirs[k], aim = aims[k];
      const iv = RF.Geo.envInterval(env, S, om);
      if (!(iv[1] > 0)) continue;
      // radius: as large as the target spot-vs-spacing rule wants, capped by the envelope wall
      let r = Math.min(iv[1], rAuto) - 1.0;
      if (!(r > 0)) continue;
      for (let it = 0; it < 5; it++) {
        const P0 = V.add(S, V.mul(om, r));
        const sh = V.norm(V.sub(S, P0)), ah = V.norm(V.sub(aim, P0));
        const cosI = Math.max(0.18, Math.abs(V.dot(V.norm(V.add(sh, ah)), sh)));
        const th = Math.acos(Math.max(-1, Math.min(1, V.dot(om, fr.a))));
        const Int = Math.max(1e-9, RF.Source.intensity(src, th));
        const omE = omEstOf(k, Int, cosI);
        const h = Math.sqrt(omE * r * r / Math.PI);
        const rN = Math.max(keep + 1.2, Math.min(iv[1], rAuto) - h - 1.0);
        if (Math.abs(rN - r) < 0.05) { r = rN; break; }
        r = Math.max(keep + 1, rN);
      }
      if (!(r > 0)) continue;
      const P = V.add(S, V.mul(om, r));
      const assembled = tryPlace(P, om, aim, k);
      if (!assembled) continue;
      surfaces.push(assembled.facet); intent.push(assembled.intent);
    }

    function tryPlace(P0, om, aim, k) {
      const D = V.dist(P0, aim);
      const sh = V.norm(V.sub(S, P0)), ah = V.norm(V.sub(aim, P0));
      const n = V.norm(V.add(sh, ah));
      const cosI = Math.max(0.18, Math.abs(V.dot(n, sh)));
      const th = Math.acos(Math.max(-1, Math.min(1, V.dot(om, fr.a))));
      const Int = Math.max(1e-9, RF.Source.intensity(src, th));
      const om0 = omEstOf(k, Int, cosI);
      let A = om0 * V.dist(P0, S) ** 2;
      let h = Math.sqrt(A / Math.PI);
      if (!(h >= 0.5)) return null;                      // degenerate: skip rather than emit a zero-size mirror
      for (let fit = 0; fit < 6; fit++) {
        const sag = h * h / (2 * Math.max(1e-6, V.dist(P0, S) * D / (V.dist(P0, S) + D)));
        const dS = V.dist(P0, S);
        const keepNeed = keep + sag + 0.5;
        if (dS < keepNeed) return null;                       // shell already inside the keep: drop
        const facet = {
          type: 'facet', id: 'F' + surfaces.length, group: 'A', P: P0.slice(), S0: S.slice(), Z: aim.slice(), di: D,
          clip: { kind: 'disc', r: h },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
        };
        if (facetFits(facet)) {
          return { facet, intent: { facet: facet.id, cells: intentCells(paint, R, Fr, aim, D, ledHalf, tgt) } };
        }
        h *= 0.8;
        if (h < 0.5) return null;
      }
      return null;
    }
    function facetFits(facet) {
      let G;
      try { G = RF.Geo.compile([facet]); } catch (e) { return false; }
      const tol = 1e-6 * Math.max.apply(null, env.half);
      for (const poly of RF.Geo.outline(G, 0)) {
        for (const p of poly) if (!RF.Geo.envInside(env, p, tol)) return false;
        // keep-out: outline + interior fan against the real surface, like the verifier
        for (const p of poly) if (V.dist(p, S) < keep * (1 - 1e-6)) return false;
        const c = poly.reduce((a, q) => V.add(a, q), [0, 0, 0]); const cen = V.mul(c, 1 / poly.length);
        const M = 3;
        for (let i = 0; i < poly.length; i++) {
          const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
          for (let a = 0; a <= M; a++) for (let b = 0; a + b <= M; b++) {
            const q = V.add(cen, V.add(V.mul(V.sub(p1, cen), a / M), V.mul(V.sub(p2, cen), b / M)));
            const dq = V.norm(V.sub(q, S));
            const t = RF.Geo.intersect(G.D, G.poly, 0, S[0], S[1], S[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
            if (t >= 0 && t < keep * (1 - 1e-6)) return false;
          }
        }
      }
      return true;
    }
    function intentCells(paint, R, Fr, aimWorld, D, ledHalf, tgt) {
      const uv = E.worldToTargetUV(Fr, aimWorld);
      const cell = 2 * Fr.half / Fr.res;
      const spotR = Math.max(ledHalf * tgt.distance / Math.max(1, D), cell * 0.75);
      const cells = [];
      const ci = Math.round((uv[0] + Fr.half) / cell - 0.5), cj = Math.round((uv[1] + Fr.half) / cell - 0.5);
      const cr = Math.min(R, Math.ceil(spotR / cell));
      for (let j = Math.max(0, cj - cr); j <= Math.min(R - 1, cj + cr); j++)
        for (let i = Math.max(0, ci - cr); i <= Math.min(R - 1, ci + cr); i++) {
          const wgt = paint[j * R + i]; if (!(wgt > 0)) continue;
          cells.push([j * R + i, wgt]);
          if (cells.length >= 48) return cells;
        }
      return cells;
    }

    notes.push(surfaces.length + ' facets · cap ' + (thetaCap * 180 / Math.PI).toFixed(0) + '° · fill ' + fill.toFixed(2) + ' · aim γ ' + gamma.toFixed(2));
    notes.push('equal-flux aims sampled from the paint CDF; ellipsoids focus the LED onto the target (di = |P−aim|); exact-outline envelope/clearance fit');
    return { surfaces, intent, notes };
}

/* ============================================================================
 * Second solver: `facetpaint-auto` — the Step-3 auto-tuner.
 * It may call tools.trace inside solve() (a solver id ending in `-auto` is exempt
 * from the no-tracing rule).  Every candidate is traced with the SAME seed, so
 * candidates differ by geometry, not by dice (common random numbers).
 * Deterministic for (input, settings, seed): the candidate grid is fixed, the
 * seed is fixed, the first maximum wins.  Same hard constraints as static:
 * envelope, LED clearance, facet budget — enforced inside solveStatic itself.
 * ========================================================================== */
const TUNE_RAYS = 500000;
const CAND = {
  faithful: [   // maximize fidelity (the painting's F1)
    { thetaCap: 65, fill: 0.90, aimGamma: 0.90, spotFactor: 2.4, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.90, aimGamma: 0.75, spotFactor: 2.4, pairing: 'inorder' },
    { thetaCap: 58, fill: 0.90, aimGamma: 0.90, spotFactor: 2.4, pairing: 'inorder' },
    { thetaCap: 70, fill: 0.90, aimGamma: 0.90, spotFactor: 2.4, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.95, aimGamma: 0.90, spotFactor: 2.0, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.90, aimGamma: 0.90, spotFactor: 2.8, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.85, aimGamma: 0.75, spotFactor: 2.2, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.90, aimGamma: 1.15, spotFactor: 2.4, pairing: 'inorder' },
  ],
  throw: [      // maximize throw distance (2*sqrt(peak cd)): sharper, slightly more composed images
    { thetaCap: 65, fill: 0.90, aimGamma: 0.90, spotFactor: 2.4, pairing: 'inorder' },
    { thetaCap: 70, fill: 0.90, aimGamma: 1.00, spotFactor: 2.6, pairing: 'inorder' },
    { thetaCap: 70, fill: 0.90, aimGamma: 1.00, spotFactor: 3.0, pairing: 'inorder' },
    { thetaCap: 75, fill: 0.90, aimGamma: 1.00, spotFactor: 3.2, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.90, aimGamma: 1.00, spotFactor: 3.0, pairing: 'inorder' },
    { thetaCap: 75, fill: 0.90, aimGamma: 0.90, spotFactor: 2.8, pairing: 'inorder' },
    { thetaCap: 70, fill: 0.95, aimGamma: 1.00, spotFactor: 2.4, pairing: 'inorder' },
  ],
  efficient: [  // maximize lumens on the painting — a paint-friendly use of photons, never a flood
    { thetaCap: 65, fill: 0.90, aimGamma: 0.90, spotFactor: 2.4, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.90, aimGamma: 0.90, spotFactor: 2.0, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.85, aimGamma: 0.75, spotFactor: 2.0, pairing: 'inorder' },
    { thetaCap: 58, fill: 0.90, aimGamma: 0.90, spotFactor: 2.4, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.90, aimGamma: 1.00, spotFactor: 1.8, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.95, aimGamma: 1.00, spotFactor: 2.2, pairing: 'inorder' },
    { thetaCap: 65, fill: 0.90, aimGamma: 0.75, spotFactor: 2.4, pairing: 'inorder' },
  ],
};
function solveAuto(input, settings, tools) {
  const goal = CAND[settings.goal] ? settings.goal : 'faithful';
  const cand = CAND[goal];
  const seed = (input.seed | 0) || 1;                 // same seed for every candidate: differences are geometry
  let baseOut = null, baseMetric = -Infinity, baseFidelity = -Infinity;   // candidate 0 is the static default: the safe floor
  let best = null, bestMetric = -Infinity;
  for (let ci = 0; ci < cand.length; ci++) {
    const c = cand[ci];
    let out;
    try { out = solveStatic(input, Object.assign({}, settings, c)); } catch (e) { continue; }
    let tr = null;
    try { tr = tools && typeof tools.trace === 'function' ? tools.trace(out.surfaces, { rays: TUNE_RAYS, seed }) : null; } catch (e) { tr = null; }
    if (!tr) { if (ci === 0) baseOut = out; continue; }
    let metric;
    if (goal === 'faithful') metric = tr.fidelity && isFinite(tr.fidelity.fidelity) ? tr.fidelity.fidelity : -Infinity;
    else if (goal === 'throw') {
      const fFidelity = tr.fidelity && isFinite(tr.fidelity.fidelity) ? tr.fidelity.fidelity : 0;
      const floor = isFinite(baseFidelity) && baseFidelity > -Infinity ? baseFidelity : 0;
      metric = (isFinite(tr.throwM) && fFidelity >= floor) ? tr.throwM : -Infinity;
    }
    else {
      const f = tr.fidelity || {};
      const fFidelity = f.fidelity, fOnPaint = f.onPaint;
      const floor = isFinite(baseFidelity) && baseFidelity > -Infinity ? baseFidelity : 0.4;
      metric = isFinite(fFidelity) && isFinite(fOnPaint)
        ? (fFidelity >= floor ? fOnPaint : -Infinity)                  // floods & fidelity-killers are not efficient designs
        : -Infinity;
    }
    if (ci === 0) { baseOut = out; baseMetric = metric; baseFidelity = tr.fidelity && isFinite(tr.fidelity.fidelity) ? tr.fidelity.fidelity : baseMetric; continue; }
    if (metric > bestMetric) { bestMetric = metric; best = { c, out }; }
  }
  // adopt a non-default candidate only if it beats the static default by a noise-safe margin
  // (same seed per candidate keeps the metric differences dominated by geometry, not dice)
  const margin = goal === 'throw' ? 0 : goal === 'faithful' ? 0.02 : 0.002;
  let chosen;
  if (best && bestMetric > baseMetric + margin) chosen = best;
  else chosen = baseOut ? { c: null, out: baseOut } : best || { c: null, out: solveStatic(input, settings) };
  chosen.out.notes = (chosen.out.notes || []).concat(['facetpaint-auto: goal=' + goal + ' · ' + (chosen.c ? 'candidate ' + JSON.stringify(chosen.c) + ' · metric ' + bestMetric.toFixed(3) : 'static default (kept)')]);
  return chosen.out;
}

RF.Solvers.register({
  id: 'bench-inkling2small--facetpaint', name: 'Facet Paint (static)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'thetaCap', label: 'Emission cap (deg from axis)', type: 'range', min: 25, max: 90, step: 1, default: 65 },
    { key: 'fill', label: 'Fraction of the emission cap tiled by facets', type: 'range', min: 0.35, max: 0.99, step: 0.01, default: 0.9 },
    { key: 'aimGamma', label: 'Aim density exponent (1 = exact paint, <1 flatter)', type: 'range', min: 0.4, max: 1.6, step: 0.05, default: 0.9 },
    { key: 'pairing', label: 'Aim↔direction pairing', type: 'select', options: [{ value: 'inorder', label: 'in order' }, { value: 'flatten', label: 'flatten delivery' }, { value: 'fluxin', label: 'strength↔bright' }], default: 'inorder' },
    { key: 'spotFactor', label: 'Target spot ÷ aim spacing (smaller ⇒ softer, more overlap)', type: 'range', min: 1.0, max: 6.0, step: 0.1, default: 2.4 },
  ],
  solve(input, settings) { return solveStatic(input, settings); },
});

RF.Solvers.register({
  id: 'bench-inkling2small--facetpaint-auto', name: 'Facet Paint (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: [
      { value: 'faithful', label: 'faithful — match the painting' },
      { value: 'throw', label: 'throw — maximise throw distance' },
      { value: 'efficient', label: 'efficient — lumens on the paint' },
    ], default: 'faithful' },
  ],
  solve(input, settings, tools) { return solveAuto(input, settings, tools); },
});
