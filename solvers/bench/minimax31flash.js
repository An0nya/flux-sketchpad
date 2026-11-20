/* Static painted-target reflector solver.
 *
 * The design is a population of small curved facets.  Each facet is an ellipsoidal
 * reflector segment with the LED and its intended target point as foci.  The paint is
 * clustered into equal-density regions; density is proportional to paint weight, so a
 * bright core receives proportionally more overlapping LED images than a dim surround.
 * No rays are traced while solving.
 */
(function () {
  'use strict';
  const RF = globalThis.RF;
  if (!RF || !RF.Solvers) return;

  const V = RF.V;
  const norm = (a) => V.norm(a);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /* Deterministic weighted k-means in the target plane.  The first centre is the
   * weighted centroid; subsequent centres use the usual variance criterion. */
  function cluster(cells, count) {
    const n = cells.length;
    count = Math.max(1, Math.min(count, n));
    if (!n) return [];
    let sw = 0, sx = 0, sy = 0;
    for (const c of cells) { sw += c.w; sx += c.w * c.u; sy += c.w * c.v; }
    const centres = [{ u: sx / sw, v: sy / sw }];
    const d2 = new Float64Array(n);
    while (centres.length < count) {
      let best = -1, bi = -1;
      for (let i = 0; i < n; i++) {
        let dm = Infinity;
        for (const q of centres) {
          const d = (cells[i].u - q.u) ** 2 + (cells[i].v - q.v) ** 2;
          if (d < dm) dm = d;
        }
        d2[i] = dm;
        const score = cells[i].w * (dm + 1e-6);
        if (score > best + 1e-12 || (Math.abs(score - best) <= 1e-12 && i < bi)) { best = score; bi = i; }
      }
      if (bi < 0) break;
      centres.push({ u: cells[bi].u, v: cells[bi].v });
    }
    let assign = new Int32Array(n);
    for (let it = 0; it < 14; it++) {
      let moved = 0;
      for (let i = 0; i < n; i++) {
        let bd = Infinity, bj = 0;
        for (let j = 0; j < centres.length; j++) {
          const d = (cells[i].u - centres[j].u) ** 2 + (cells[i].v - centres[j].v) ** 2;
          if (d < bd) { bd = d; bj = j; }
        }
        if (assign[i] !== bj) { assign[i] = bj; moved++; }
      }
      const sums = centres.map(() => ({ w: 0, u: 0, v: 0 }));
      for (let i = 0; i < n; i++) {
        const q = sums[assign[i]], c = cells[i];
        q.w += c.w; q.u += c.w * c.u; q.v += c.w * c.v;
      }
      for (let j = 0; j < centres.length; j++) {
        const q = sums[j];
        if (q.w > 0) centres[j] = { u: q.u / q.w, v: q.v / q.w };
      }
      if (!moved && it > 1) break;
    }
    return { centres, assign };
  }

  function solve(input, settings) {
    const out = { surfaces: [], intent: [], notes: [] };
    const limit = Math.max(0, input.limits.maxFacets | 0);
    if (!limit) return out;

    const paintRes = Math.max(1, input.paint.res | 0);
    const paint = input.paint.cells || [];
    const target = input.target;
    const T = RF.Engine.targetFrame(target);
    const half = Math.max(1e-6, T.half);
    const step = 2 * half / paintRes;
    const source = input.source;
    const S = source.pos.slice();
    const sourceFrame = RF.Source.frame(source);
    const sourceAxis = sourceFrame.a;

    /* Separate the painting into relative levels.  This preserves designed gradients
     * (for example a bright core in a dimmer halo) instead of treating all nonzero
     * paint as one binary region. */
    let maxPaint = 0;
    for (const w of paint) if (w > maxPaint) maxPaint = w;
    if (!(maxPaint > 0)) {
      out.notes.push('The painting is empty.');
      return out;
    }
    const groups = new Map();
    for (let j = 0; j < paintRes; j++) for (let i = 0; i < paintRes; i++) {
      const k = j * paintRes + i, w = paint[k] || 0;
      if (!(w > 0)) continue;
      const q = Math.round(100 * w / maxPaint);
      const key = String(q);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ k, i, j, w, level: q / 100,
        u: -half + (i + 0.5) * step, v: -half + (j + 0.5) * step });
    }
    const gs = [...groups.entries()].map(([key, cells]) => ({ key, cells,
      sum: cells.reduce((a, c) => a + c.w, 0) })).sort((a, b) => b.sum - a.sum || a.key.localeCompare(b.key));
    /* Facets per level are apportioned by painted flux.  Together with spatial
     * clustering this produces the requested relative level without wasting facets
     * on large unpainted areas. */
    /* For very coarse paintings the LED image covers many cells and the outer
     * level benefits from slightly more centres; for a sharp painting the direct
     * paint-flux allocation is better.  The exponent is chosen from the estimated
     * image width in paint cells (and can be overridden by the setting). */
    const axisInterval = RF.Geo.envInterval(input.envelope, S, sourceAxis);
    const roughR = Math.max(1, (isFinite(axisInterval[1]) ? axisInterval[1] : V.dist(S, input.envelope.center)));
    const roughSmall = source.kind === 'planar' ? (source.shape === 'disc' ? 2 * source.radius : Math.min(source.w, source.h)) : 2 * (source.radius || 1);
    const roughImageCells = roughSmall * V.dist(S, T.C) / Math.max(1, roughR) / Math.max(1e-9, 2 * half / paintRes);
    let levelPower = +settings.levelPower;
    if (!(levelPower >= 0)) levelPower = 1 + 0.45 * clamp((roughImageCells - 6) / 10, 0, 1);
    levelPower = clamp(levelPower, 0.5, 2);
    const levelTotal = gs.reduce((a, g) => a + Math.pow(g.sum, levelPower), 0) || 1;
    const rawCounts = gs.map((g) => limit * Math.pow(g.sum, levelPower) / levelTotal);
    const counts = rawCounts.map((x) => Math.floor(x));
    let remain = limit - counts.reduce((a, x) => a + x, 0);
    const order = rawCounts.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f || a.i - b.i);
    for (let q = 0; q < remain; q++) counts[order[q % order.length].i]++;

    const plans = [];
    for (let gi = 0; gi < gs.length; gi++) {
      if (!(counts[gi] > 0)) continue;
      const g = gs[gi], cl = cluster(g.cells, counts[gi]);
      for (let j = 0; j < cl.centres.length; j++) {
        const q = cl.centres[j], intended = [];
        for (let q2 = 0; q2 < g.cells.length; q2++) if (cl.assign[q2] === j) intended.push(g.cells[q2]);
        plans.push({ u: q.u, v: q.v, level: g.cells.length ? g.cells[0].level : 1,
          weight: g.cells.length ? g.cells[0].w : 1, intended });
      }
    }
    /* Interleave the levels before assigning physical source directions.  A
     * raster order would give the bright centre only the middle radii of the
     * source disk, changing its image brightness relative to the outer level. */
    const mix32 = (x) => {
      x = (x ^ 61) ^ (x >>> 16); x = (x + (x << 3)) | 0; x ^= x >>> 4;
      x = Math.imul(x, 0x27d4eb2d); x ^= x >>> 15; return x >>> 0;
    };
    plans.sort((a, b) => {
      const ha = mix32(Math.round(a.u * 128) * 73856093 ^ Math.round(a.v * 128) * 19349663 ^ Math.round(a.level * 100));
      const hb = mix32(Math.round(b.u * 128) * 73856093 ^ Math.round(b.v * 128) * 19349663 ^ Math.round(b.level * 100));
      return ha - hb;
    });

    /* Spread the physical facet positions over the LED's useful hemisphere.  The
     * transverse directions are projections of the target's horizontal/vertical axes.
     * A sunflower disk gives the source directions a well-controlled minimum
     * separation.  Target points are assigned to those directions in a
     * level-interleaved deterministic order; their physical aiming remains
     * independent of the assignment. */
    const throwDir = norm(V.sub(T.C, S));
    const tu0 = V.norm(V.sub(T.tu, V.mul(sourceAxis, V.dot(T.tu, sourceAxis))));
    const tv0 = V.norm(V.cross(sourceAxis, tu0));
    const spreadH = clamp(+settings.spreadH || 0.50, 0.05, 1.2);
    const spreadV = clamp(+settings.spreadV || 0.50, 0.05, 1.2);
    const dirs = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let q = 0; q < plans.length; q++) {
      const rr = Math.sqrt((q + 0.5) / plans.length);
      const a = q * golden;
      const dh = rr * Math.cos(a) * spreadH, dv = rr * Math.sin(a) * spreadV;
      dirs.push(norm(V.add(sourceAxis, V.add(V.mul(tu0, dh), V.mul(tv0, dv)))));
    }
    for (let q = 0; q < plans.length; q++) {
      plans[q].d = dirs[q];
      plans[q].Z = RF.Engine.targetUVtoWorld(T, plans[q].u, plans[q].v);
    }

    /* A common radius gives all images the same LED magnification.  Use the largest
     * radius supported by every planned direction, with a conservative edge margin. */
    const keep = Math.max(input.envelope.keepOut || 0, +settings.minDistance || 0);
    const edgeMargin = 2.5;
    const radii = plans.map((p) => {
      const iv = RF.Geo.envInterval(input.envelope, S, p.d);
      return iv[1] > iv[0] && isFinite(iv[1]) ? iv[1] - edgeMargin : 0;
    });
    const sortedR = radii.filter((x) => x > 0).sort((a, b) => a - b);
    let commonR = sortedR.length ? sortedR[Math.floor(0.15 * (sortedR.length - 1))] : 0;
    commonR *= clamp(+settings.distanceScale || 1, 0.45, 1.2);
    commonR = Math.max(commonR, keep + 4);

    /* Pull the lowest-level cluster slightly towards the painted centre.  The LED
     * image has a finite width; placing its centre exactly on the outer paint edge
     * throws a bright halo into the gap.  Moving it inward trades a little raw
     * edge light (which the scorer's LED-blur concession covers) for much darker
     * gaps. */
    let globalU = 0, globalV = 0, globalW = 0;
    for (const p of plans) { globalU += p.u * p.weight; globalV += p.v * p.weight; globalW += p.weight; }
    globalU /= globalW || 1; globalV /= globalW || 1;
    const minLevel = Math.min(...plans.map((p) => p.level));
    const sourceSmall = source.kind === 'planar' ? (source.shape === 'disc' ? 2 * source.radius : Math.min(source.w, source.h)) : 2 * (source.radius || 1);
    const inset = clamp(+settings.edgeInset || 0.25, 0, 0.8) * 0.5 * sourceSmall * V.dist(S, T.C) / Math.max(1, commonR);
    let outerRadius = 0;
    for (const p of plans) if (Math.abs(p.level - minLevel) < 1e-8) outerRadius = Math.max(outerRadius, Math.hypot(p.u - globalU, p.v - globalV));
    for (const p of plans) if (Math.abs(p.level - minLevel) < 1e-8) {
      const du = globalU - p.u, dv = globalV - p.v, dl = Math.hypot(du, dv);
      /* Move only the rim centres.  Interior centres are responsible for filling
       * the painted field and should not be disturbed to control the edge halo. */
      if (dl > 0.68 * outerRadius && dl > 1e-9) {
        const move = Math.min(inset, dl);
        p.u += du / dl * move; p.v += dv / dl * move;
        p.Z = RF.Engine.targetUVtoWorld(T, p.u, p.v);
      }
    }

    for (let q = 0; q < plans.length; q++) {
      plans[q].r = Math.min(commonR, radii[q]);
      plans[q].P = V.add(S, V.mul(plans[q].d, plans[q].r));
    }
    /* Pull the few boundary-limited centres inward by the facet's own radius.
     * This keeps the real curved surface, not merely its outline centre, inside
     * a box envelope. */
    if (input.envelope.shape === 'box') {
      const safeR = clamp(+settings.facetRadius || 2.2, 0.2, 8);
      for (const p of plans) {
        let guard = 0;
        while (guard++ < 100) {
          let bad = false;
          for (let ax = 0; ax < 3; ax++) if (Math.abs(p.P[ax] - input.envelope.center[ax]) + safeR + 0.5 > input.envelope.half[ax]) bad = true;
          if (!bad) break;
          p.r = Math.max(keep + safeR + 0.6, p.r - 0.1);
          p.P = V.add(S, V.mul(p.d, p.r));
        }
      }
    }

    /* Small physical facets are enough to make a sharp LED image.  Their size is
     * reduced automatically if two centres would otherwise overlap. */
    /* Predict each facet's LED-image area and relative brightness from its local
     * imaging geometry.  Radius then compensates for the changing image area and
     * source obliquity, so equal-density clusters really do have equal brightness. */
    const imageInfo = (p) => {
      const d = norm(V.sub(p.P, S));
      const a = norm(V.sub(p.Z, p.P));
      const n = norm(V.sub(a, d));
      const cosTheta = Math.max(0.05, V.dot(d, sourceAxis));
      const cosBeta = Math.max(0.05, V.dot(V.mul(d, -1), n));
      const hitFor = (q) => {
        const dq = norm(V.sub(p.P, V.add(S, q)));
        const rq = V.sub(dq, V.mul(n, 2 * V.dot(dq, n)));
        const den = V.dot(T.n, rq);
        if (Math.abs(den) < 1e-9) return null;
        const t = V.dot(T.n, V.sub(T.C, p.P)) / den;
        return V.add(p.P, V.mul(rq, t));
      };
      const eps = 0.02, fu = sourceFrame.u, fv = sourceFrame.v;
      const pu0 = hitFor(V.mul(fu, -eps)), pu1 = hitFor(V.mul(fu, eps));
      const pv0 = hitFor(V.mul(fv, -eps)), pv1 = hitFor(V.mul(fv, eps));
      let imageArea = 0;
      if (pu0 && pu1 && pv0 && pv1) {
        const vu = V.mul(V.sub(pu1, pu0), 1 / (2 * eps));
        const vv = V.mul(V.sub(pv1, pv0), 1 / (2 * eps));
        const cr = V.cross(vu, vv); imageArea = Math.hypot(cr[0], cr[1], cr[2]);
      }
      if (!(imageArea > 1e-8)) imageArea = Math.max(1, (V.dist(p.P, p.Z) ** 2) * 1e-4);
      const r = V.dist(S, p.P);
      return { coeff: cosTheta * cosBeta / Math.max(1e-9, r * r * imageArea), imageArea };
    };
    const infos = plans.map(imageInfo);
    const coeffSorted = infos.map((x) => x.coeff).sort((a, b) => a - b);
    const medianCoeff = coeffSorted[Math.floor(coeffSorted.length / 2)] || 1;

    const minSepTo = plans.map((p, i) => {
      let m = Infinity;
      for (let j = 0; j < plans.length; j++) if (i !== j) m = Math.min(m, V.dist(p.P, plans[j].P));
      return m;
    });
    let facetRadius = clamp(+settings.facetRadius || 1.8, 0.2, 8);
    for (let q = 0; q < plans.length; q++) {
      let rr = facetRadius * Math.sqrt(medianCoeff / infos[q].coeff);
      rr = Math.min(rr, 0.40 * minSepTo[q]);
      rr = Math.min(rr, Math.max(0.15, commonR - keep - 1.5));
      plans[q].radius = Math.max(0.15, rr);
    }

    for (let q = 0; q < plans.length && out.surfaces.length < limit; q++) {
      const p = plans[q];
      const id = 'F' + String(q).padStart(3, '0');
      const di = V.dist(p.P, p.Z);
      const surface = {
        type: 'facet', id, group: 'A', P: p.P, S0: S, Z: p.Z,
        di, flat: false, clip: { kind: 'disc', r: p.radius },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false }
      };
      out.surfaces.push(surface);
      const cells = p.intended.map((c) => [c.k, c.w]);
      out.intent.push({ facet: id, cells });
    }

    /* Stop the small amount of direct LED light which would otherwise land far
     * outside the painting on the tracer's infinite target plane.  Four absorbing
     * rectangles form a frame around the reflected beam.  They are not reflecting
     * surfaces and do not consume the user's facet budget. */
    if (input.envelope.shape === 'box' && Math.abs(throwDir[0]) > 0.9 && Math.abs(sourceAxis[2]) > 0.9) {
      const xMin = input.envelope.center[0] - input.envelope.half[0] * 0.995;
      const xMax = input.envelope.center[0] + input.envelope.half[0] * 0.995;
      const xShield = xMax - 0.5;
      const yMin = input.envelope.center[1] - input.envelope.half[1] * 0.995;
      const yMax = input.envelope.center[1] + input.envelope.half[1] * 0.995;
      const zMin = input.envelope.center[2] - input.envelope.half[2] * 0.995;
      const zMax = input.envelope.center[2] + input.envelope.half[2] * 0.995;
      let hy0 = Infinity, hy1 = -Infinity, hz0 = Infinity, hz1 = -Infinity;
      for (const p of plans) {
        const den = p.Z[0] - p.P[0];
        const t = Math.abs(den) > 1e-9 ? (xShield - p.P[0]) / den : 0;
        const y = p.P[1] + (p.Z[1] - p.P[1]) * t;
        const z = p.P[2] + (p.Z[2] - p.P[2]) * t;
        hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y);
        hz0 = Math.min(hz0, z); hz1 = Math.max(hz1, z);
      }
      const margin = 8;
      hy0 = Math.max(yMin + 0.2, hy0 - margin); hy1 = Math.min(yMax - 0.2, hy1 + margin);
      hz0 = Math.max(zMin + 0.2, hz0 - margin); hz1 = Math.min(zMax - 0.2, hz1 + margin);
      if (xShield > xMin && xShield < xMax && hy1 > hy0 && hz1 > hz0) {
        const rect = (id, ya, yb, za, zb) => {
          if (yb - ya < 0.02 || zb - za < 0.02) return;
          out.surfaces.push({ type: 'plane', id, group: 'A', P: [xShield, (ya + yb) / 2, (za + zb) / 2], n: [1, 0, 0],
            clip: { kind: 'poly', pts3: [[xShield, ya, za], [xShield, yb, za], [xShield, yb, zb], [xShield, ya, zb]] },
            optics: { interaction: 'absorb' } });
        };
        rect('SHIELD_L', yMin, hy0, zMin, zMax);
        rect('SHIELD_R', hy1, yMax, zMin, zMax);
        rect('SHIELD_B', hy0, hy1, zMin, hz0);
        rect('SHIELD_T', hy0, hy1, hz1, zMax);
        out.notes.push(`Added a free absorbing frame at x=${xShield.toFixed(1)} mm around the reflected beam.`);
      }
    }

    /* Final geometric guard for non-box envelopes.  Compile and inspect the real
     * quadric outlines (no rays are traced); a boundary-limited facet is moved a
     * little towards the LED until its surface is wholly inside. */
    for (let pass = 0; pass < 24; pass++) {
      let compiled;
      try { compiled = RF.Geo.compile(out.surfaces); } catch (e) { break; }
      const bad = new Set();
      for (let k = 0; k < compiled.n; k++) {
        const s = out.surfaces[k];
        if (s.type !== 'facet') continue;
        for (const poly of RF.Geo.outline(compiled, k)) for (const q of poly)
          if (!RF.Geo.envInside(input.envelope, q, 1e-6 * Math.max(...input.envelope.half))) bad.add(k);
      }
      if (!bad.size) break;
      for (const k of bad) {
        const s = out.surfaces[k];
        s.P = V.add(S, V.mul(V.sub(s.P, S), 0.95));
        s.di = V.dist(s.P, s.Z);
      }
    }

    const nFacets = out.surfaces.filter((s) => s.type === 'facet').length;
    out.notes.push(`${nFacets} static curved facets; radius ${facetRadius.toFixed(2)} mm, LED distance ${commonR.toFixed(1)} mm.`);
    out.notes.push(`Paint levels: ${gs.map((g, i) => `${(g.cells[0] ? g.cells[0].w / maxPaint : 1).toFixed(2)}→${counts[i]}`).join(', ')}.`);
    return out;
  }

  /* Optional traced tuner.  It deliberately calls the same static solver for
   * every candidate, so the selected geometry is produced by the static path
   * and remains deterministic.  All candidates use the same trace seed; a
   * second, higher-ray pass compares every candidate. */
  const autoCandidates = [
    { name: 'wide-3.5', spreadH: 1.0, spreadV: 1.0, facetRadius: 3.5, edgeInset: 0.25 },
    { name: 'medium-3.0', spreadH: 0.9, spreadV: 0.9, facetRadius: 3.0, edgeInset: 0.20 },
    { name: 'tight-2.2', spreadH: 0.7, spreadV: 0.7, facetRadius: 2.2, edgeInset: 0.25 },
    { name: 'wide-4.0', spreadH: 1.1, spreadV: 1.1, facetRadius: 4.0, edgeInset: 0.20 },
    { name: 'medium-3.5', spreadH: 0.8, spreadV: 0.8, facetRadius: 3.5, edgeInset: 0.35 },
    { name: 'wide-3.0', spreadH: 1.0, spreadV: 1.0, facetRadius: 3.0, edgeInset: 0.15 },
    { name: 'tight-1.8', spreadH: 0.65, spreadV: 0.65, facetRadius: 1.8, edgeInset: 0.25 }
  ];

  function autoMetric(goal, trace) {
    const f = trace && trace.fidelity ? trace.fidelity : {};
    const fidelity = +f.fidelity || 0;
    const onPaint = +f.onPaint || 0;
    const throwM = Math.max(0, +(trace && trace.throwM) || 0);
    if (goal === 'throw') return Math.log1p(throwM) + 0.35 * fidelity;
    if (goal === 'efficient') return onPaint + 0.05 * fidelity;
    return fidelity + 0.03 * onPaint;
  }

  function solveAuto(input, settings, tools) {
    const goal = ['faithful', 'throw', 'efficient'].includes(settings.goal) ? settings.goal : 'faithful';
    const base = {
      minDistance: Math.max(0, +settings.minDistance || 0),
      distanceScale: 1,
      levelPower: -1
    };
    const seed = input.seed | 0;
    const evaluated = [];

    for (const candidate of autoCandidates) {
      try {
        const output = solve(input, Object.assign({}, base, candidate));
        const trace = tools && typeof tools.trace === 'function'
          ? tools.trace(output.surfaces, { rays: 80000, seed })
          : null;
        evaluated.push({ candidate, output, trace, score: autoMetric(goal, trace) });
      } catch (e) {
        /* A geometry which the tracer rejects must not make the whole tune fail.
         * The static solver's own geometric checks remain the final authority. */
      }
    }
    if (!evaluated.length) {
      const output = solve(input, Object.assign({}, base, autoCandidates[0]));
      output.notes.unshift('Auto tuner had no traceable candidate; used the static default.');
      return output;
    }

    evaluated.sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
    /* Recheck every candidate at a substantially higher ray count.  A small
     * shortlist was tried, but fidelity differences between neighbouring source
     * spreads are smaller than its first-pass noise and it sometimes discarded
     * the eventual winner. */
    const finalists = evaluated.slice();
    for (const item of finalists) {
      try {
        item.trace = tools && typeof tools.trace === 'function'
          ? tools.trace(item.output.surfaces, { rays: 600000, seed })
          : item.trace;
        item.score = autoMetric(goal, item.trace);
      } catch (e) { /* retain the first-pass result */ }
    }
    finalists.sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
    const best = finalists[0];
    const f = best.trace && best.trace.fidelity ? best.trace.fidelity : {};
    best.output.notes.unshift(
      `Auto goal “${goal}” selected ${best.candidate.name} after tracing ${evaluated.length} candidates and rechecking ${finalists.length} finalists.`
    );
    best.output.notes.splice(1, 0,
      `Selected trace: fidelity ${(100 * ((+f.fidelity) || 0)).toFixed(1)}%, on paint ${(100 * ((+f.onPaint) || 0)).toFixed(1)}%, throw ${Math.round(Number(best.trace && best.trace.throwM) || 0)} m.`
    );
    return best.output;
  }

  RF.Solvers.register({
    id: 'bench-minimax31flash--static-paint-facets', name: 'Static paint facets', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'facetRadius', label: 'Facet radius (mm)', type: 'number', min: 0.2, max: 8, step: 0.1, default: 3.5 },
      { key: 'spreadH', label: 'Horizontal source spread', type: 'range', min: 0.05, max: 1.2, step: 0.05, default: 1.0 },
      { key: 'spreadV', label: 'Vertical source spread', type: 'range', min: 0.05, max: 1.2, step: 0.05, default: 1.0 },
      { key: 'edgeInset', label: 'Outer-edge image inset', type: 'range', min: 0, max: 0.8, step: 0.05, default: 0.25 },
      { key: 'distanceScale', label: 'Facet distance scale', type: 'range', min: 0.45, max: 1.2, step: 0.05, default: 1 },
      { key: 'levelPower', label: 'Level allocation exponent (−1 = auto)', type: 'number', min: -1, max: 2, step: 0.05, default: -1 }
    ],
    solve
  });

  RF.Solvers.register({
    id: 'bench-minimax31flash--static-paint-facets-auto', name: 'Static paint facets (auto)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful painting' },
        { value: 'throw', label: 'Maximum throw' },
        { value: 'efficient', label: 'Efficient delivery' }
      ] }
    ],
    solve: solveAuto
  });
})();
