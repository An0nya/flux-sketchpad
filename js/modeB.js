/* modeB.js — Mode B: inverse stamping.  The user places a tile (position + scale) on the target
 * map; we solve backward for the one facet that paints it.
 *
 *   • direction from the source (the 2nd 2D picker, or auto) + distance along it → position P
 *   • bisector of (P→source, P→tile centre) → normal (so the centre ray lands on the stamp)
 *   • requested tile size → facet SIZE (flat facet) or CURVATURE (curved facet, fixed aperture),
 *     via the first-order tile model, which uses the emitter's real extent;
 *   • auto direction ranks candidate directions by the source's ACTUAL angular distribution.
 * Distance is auto: as far out as the envelope allows (a farther facet sees a smaller source, so
 * it can paint smaller tiles), inside the envelope and outside the keep-out.
 * If a tile scale is unachievable the range is clamped and the reason is reported.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V, Geo, Solver } = RF;
  const D2R = Math.PI / 180, SQ12 = Math.sqrt(12);

  function srcDir(fr, thDeg, phDeg) {
    const t = thDeg * D2R, p = phDeg * D2R, s = Math.sin(t);
    return V.norm([Math.cos(t) * fr.a[0] + s * (Math.cos(p) * fr.u[0] + Math.sin(p) * fr.v[0]),
                   Math.cos(t) * fr.a[1] + s * (Math.cos(p) * fr.u[1] + Math.sin(p) * fr.v[1]),
                   Math.cos(t) * fr.a[2] + s * (Math.cos(p) * fr.u[2] + Math.sin(p) * fr.v[2])]);
  }
  function keepOut(scene) { return Math.max(scene.envelope.keepOut || 0, (scene.modeB && scene.modeB.minDistance) || 0, 1.5 * RF.Source.boundingRadius(scene.source)); }

  // Room along a direction: [rLo, rHi] distances inside the envelope and outside the keep-out.
  function room(scene, dir) {
    const S = scene.source.pos, [tin, tout] = Geo.envInterval(scene.envelope, S, dir);
    const lo = Math.max(tin, keepOut(scene), 0), hi = tout;
    return hi > lo ? [lo, hi] : null;
  }

  // Information for the direction picker at (θ, φ) in the source frame.
  function dirInfo(scene, thDeg, phDeg) {
    const src = scene.source, fr = RF.Source.frame(src), dir = srcDir(fr, thDeg, phDeg);
    const I = RF.Source.intensity(src, thDeg * D2R);
    const rm = room(scene, dir);
    return { dir, I, room: rm };
  }

  function facetCorners(P, ex, ey, h) {
    return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => V.add(P, V.add(V.mul(ex, x), V.mul(ey, y))));
  }

  // Is the segment from o along d (length L) blocked by an existing surface?
  function blocked(occ, o, d, L) {
    const ev = RF.Engine.probeRay(occ, o, d, 1).events[0];
    return !!(ev && ev.point && ev.type !== 'target' && ev.type !== 'targetBack' && V.dist(ev.point, o) < L);
  }
  /* Solve one stamp.  occupied: [{dir, halfAngle}] of earlier stamps (auto avoids them).
   * occ: compiled scene of the OTHER surfaces — auto never picks a direction whose light is
   * already intercepted by them, or whose reflected chief ray they would block.             */
  function solveStamp(scene, st, occupied, occ) {
    const src = scene.source, S = src.pos, fr = RF.Source.frame(src);
    const T = RF.Engine.designFrame(scene.target);
    const cell = 2 * T.half / T.res;
    const Z = RF.Engine.targetUVtoWorld(T, st.u, st.v);
    const out = { id: st.id, ok: false, reasons: [] };
    const tm = RF.Source.thetaMax(src) / D2R;

    // ---- direction
    let th = st.th, ph = st.ph;
    if (st.dirMode !== 'manual') {
      let best = null;
      for (let t = 2; t < Math.min(tm, 178); t += 3) {
        const nph = Math.max(6, Math.round(120 * Math.sin(t * D2R)));
        for (let k = 0; k < nph; k++) {
          const p = k * 360 / nph, dir = srcDir(fr, t, p);
          const I = RF.Source.intensity(src, t * D2R);
          if (!(I > 0)) continue;
          const rm = room(scene, dir);
          if (!rm) continue;
          const r = rm[0] + 0.85 * (rm[1] - rm[0]);
          const P = V.madd(S, dir, r);
          // incidence: facets needing grazing incidence present almost no area — skip > 75°
          const inc = 0.5 * V.angle(V.neg(dir), V.sub(Z, P));
          if (inc > 75 * D2R) continue;
          if (occupied.some((o) => V.angle(o.dir, dir) < o.half + 4 * D2R)) continue;
          if (occ && (blocked(occ, S, dir, r) || blocked(occ, P, V.sub(Z, P), V.dist(P, Z)))) continue;
          // does the reflected chief ray reach the target unobstructed by the envelope's own
          // bulk?  (cheap proxy: its path must not re-enter the keep-out sphere)
          const score = I * Math.cos(inc) * (1 + 0.15 * r / (rm[1] || 1));
          if (!best || score > best.score + 1e-12) best = { score, t, p };
        }
      }
      if (!best) { out.reasons.push('No free direction from the source has room inside the envelope.'); return out; }
      th = best.t; ph = best.p;
    }
    const dir = srcDir(fr, th, ph);
    out.th = th; out.ph = ph; out.dir = dir;
    const I = RF.Source.intensity(src, th * D2R);
    if (!(I > 0)) { out.reasons.push('The source emits nothing toward this direction (θ = ' + th.toFixed(1) + '° from its axis).'); return out; }
    const rm = room(scene, dir);
    if (!rm) { out.reasons.push('No room inside the envelope along this direction.'); return out; }

    const flat = st.facetType === 'flat';
    const sigT = Math.max(1e-9, st.scale) / SQ12;
    const srcSize = RF.Source.extentSize(src);
    // Evaluate positions from far to near.  The slider range is the union over positions; the
    // solve takes the FARTHEST position that reaches the requested scale (sharpest source image).
    const cands = [];
    for (let f = 0.97; f >= 0.05; f -= 0.04) {
      const r = rm[0] + f * (rm[1] - rm[0]);
      const P = V.madd(S, dir, r);
      const fq = Geo.facetQuadric(P, S, Z, null);
      const inc = V.angle(fq.n, V.sub(S, P));
      if (inc > 85 * D2R) { out.reasons.push('Grazing incidence (' + (inc / D2R).toFixed(0) + '°): this direction cannot reach the stamp.'); return out; }
      let fr0 = Solver.facetFrame(fq, null);
      const m1 = Solver.tileModel(T, src, { P, S0: S, Z, flat: true, apCov: [1 / 3, 0, 1 / 3] });
      if (!m1.ok) continue;
      // align the facet's x axis with the in-plane direction that maps onto target u
      const J = m1.JA, det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
      const ref = Math.abs(det) > 0 ? V.norm(V.add(V.mul(fr0.ex, J[1][1] / det), V.mul(fr0.ey, -J[1][0] / det))) : fr0.ex;
      fr0 = Solver.facetFrame(fq, ref);
      const fits = (hh) => facetCorners(P, fr0.ex, fr0.ey, hh).every((q) => Geo.envInside(scene.envelope, q, 1e-9) && V.dist(q, S) >= keepOut(scene));
      let hMax = r * 0.5; while (hMax > r * 1e-4 && !fits(hMax)) hMax *= 0.9;
      if (!fits(hMax)) continue;
      const mU = Solver.tileModel(T, src, { P, S0: S, Z, flat: true, apCov: [1 / 3, 0, 1 / 3], ref });
      cands.push({ r, P, ref, hMax, sA1: mU.sigmaA, sS: mU.sigmaS });
    }
    if (!cands.length) { out.reasons.push(m1Miss(scene) || 'No facet of useful size fits the envelope along this direction.'); return out; }
    let pick = null, scaleMin = Infinity, scaleMax = 0, clampedWhy = null, h, di = null, sigma;
    if (flat) {
      // tile² = h²·σA1² + σS²  →  h = sqrt(σT² − σS²)/σA1   (per position)
      for (const c of cands) { c.min = SQ12 * c.sS * 1.02; c.max = SQ12 * Math.sqrt(c.hMax * c.hMax * c.sA1 * c.sA1 + c.sS * c.sS); scaleMin = Math.min(scaleMin, c.min); scaleMax = Math.max(scaleMax, c.max); }
      pick = cands.find((c) => st.scale >= c.min && st.scale <= c.max);
      let s = sigT;
      if (!pick) {
        if (st.scale < scaleMin) { pick = cands.reduce((a, c) => (c.min < a.min ? c : a)); s = pick.min / SQ12; clampedWhy = 'min'; }
        else { pick = cands.reduce((a, c) => (c.max > a.max ? c : a)); s = pick.max / SQ12; clampedWhy = 'max'; }
      }
      h = Math.sqrt(Math.max(0, s * s - pick.sS * pick.sS)) / pick.sA1;
      sigma = Math.sqrt(h * h * pick.sA1 * pick.sA1 + pick.sS * pick.sS);
    } else {
      // farthest position where the requested aperture fits; else the one allowing the largest
      const tanA = Math.tan(Math.max(0.2, st.apDeg || 6) * D2R);
      pick = cands.find((c) => c.hMax >= c.r * tanA) || cands.reduce((a, c) => (Math.min(c.hMax, c.r * tanA) > Math.min(a.hMax, a.r * tanA) ? c : a));
      h = Math.min(pick.hMax, pick.r * tanA);
      if (h < pick.r * tanA * 0.999) out.reasons.push('Facet aperture limited to ' + h.toFixed(1) + ' mm by the envelope along this direction.');
      const sv = Solver.solveVergence(T, src, { P: pick.P, S0: S, Z, apCov: [h * h / 3, 0, h * h / 3], ref: pick.ref }, sigT);
      if (!sv.ok) { out.reasons.push('Curvature solve failed for this stamp.'); return out; }
      scaleMin = SQ12 * sv.sigmaMin * 1.001; scaleMax = Math.max(scaleMin, 2 * T.half);
      di = sv.di; sigma = sv.sigma;
      if (sv.clamped) clampedWhy = 'min';
    }
    const { r, P, ref } = pick;
    const surface = {
      type: 'facet', id: 'B' + st.id, group: 'B', P, S0: S.slice(), Z, flat, di: flat ? null : di,
      clip: { kind: 'rect', hx: h, hy: h, ref }, optics: { interaction: 'reflect', reflectivity: st.reflectivity || 0.9, twoSided: false },
      info: { stamp: st.id },
    };
    // flux the facet intercepts, from the source's ACTUAL angular distribution: integrate I over
    // the facet's solid angle (sampled on a 9×9 grid over the facet aperture)
    const frF = Solver.facetFrame(Geo.facetQuadric(P, S, Z, null), ref), Itot = RF.Source.totalIntegral(src);
    let fl = 0; const NQ = 9;
    for (let a = 0; a < NQ; a++) for (let b = 0; b < NQ; b++) {
      const x = ((a + 0.5) / NQ - 0.5) * 2 * h, y = ((b + 0.5) / NQ - 0.5) * 2 * h;
      const q = V.add(P, V.add(V.mul(frF.ex, x), V.mul(frF.ey, y))), d = V.sub(q, S), r2 = V.dot(d, d), dn = V.norm(d);
      const cosF = Math.abs(V.dot(dn, V.cross(frF.ex, frF.ey)));
      fl += RF.Source.intensity(src, V.angle(dn, fr.a)) * cosF / r2 * (2 * h / NQ) ** 2;
    }
    Object.assign(out, {
      fluxFraction: fl / Itot,
      ok: true, surface, r, P, h, sigma, tileWidth: sigma * SQ12, scaleMin, scaleMax, clamped: clampedWhy,
      minCells: scaleMin / cell, maxCells: scaleMax / cell, magnification: V.dist(P, Z) / r, halfAngle: Math.atan(h * Math.SQRT2 / r),
    });
    if (clampedWhy === 'min') out.reasons.push('Tile clamped to its minimum ' + (scaleMin / cell).toFixed(2) + ' cells: the image of the ' + RF.U.fmt(srcSize, 2) + ' mm source through a facet ' + r.toFixed(1) + ' mm away (m ≈ ' + out.magnification.toFixed(1) + ').');
    if (clampedWhy === 'max') out.reasons.push('Tile clamped to its maximum ' + (scaleMax / cell).toFixed(1) + ' cells: a larger flat facet does not fit the envelope along this direction.');
    return out;
  }
  function m1Miss() { return 'From this direction the reflected ray cannot reach the lit side of the target inside the envelope.'; }

  // Build all stamps in order; later auto stamps avoid earlier facets' directions.
  function build(scene) {
    const occupied = [], surfaces = [], reports = [];
    const others = [];
    for (const k of Object.keys(scene.groups)) if (k !== 'B' && scene.groups[k].enabled) others.push(...scene.groups[k].surfaces);
    const occ = others.length ? RF.Engine.prepare(scene, others) : null;
    for (const st of scene.modeB.stamps) {
      const rep = solveStamp(scene, st, occupied, occ);
      if (rep.ok && occ && st.dirMode === 'manual' && blocked(occ, scene.source.pos, rep.dir, rep.r)) rep.reasons.push('This direction is already intercepted by other surfaces in the scene — the facet will be in their shadow.');
      reports.push(rep);
      if (rep.ok) { surfaces.push(rep.surface); occupied.push({ dir: rep.dir, half: rep.halfAngle }); st.th = rep.th; st.ph = rep.ph; }
    }
    return { surfaces, reports };
  }

  let counter = 1;
  function newStamp(scene, u, v, scale) {
    const ids = new Set(scene.modeB.stamps.map((s) => s.id));
    let id; do { id = 'st' + (counter++); } while (ids.has(id));
    return { id, u, v, scale: scale || scene.modeB.defaultScale, dirMode: 'auto', th: 45, ph: 0, facetType: scene.modeB.facetType, apDeg: 10 };
  }

  RF.ModeB = { srcDir, room, dirInfo, solveStamp, build, newStamp, keepOut };
})(typeof globalThis !== 'undefined' ? globalThis : this);
