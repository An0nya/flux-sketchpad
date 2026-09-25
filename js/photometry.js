/* photometry.js — flashlight-style numbers for a finished (or running) trace.  Pure: scene, prepared
 * scene P and trace context in, plain numbers out (tests/photometry.js runs it headless).
 *
 * Units: source power is taken as lumens, lengths in mm, intensity in cd, illuminance in lx.
 *
 * The ceilings come from the brightness theorem: a passive mirror can't make the LED look brighter,
 * only bigger.  So toward a direction u, a surface can add at most  R · L · A⊥  candela, where L is the
 * LED's luminance as seen from that surface (cd/mm²), R its reflectivity and A⊥ its area projected
 * onto the plane facing u.  Summed over surfaces this is an upper bound (projections may overlap, and
 * every point would have to show the LED at once).
 *   design ceiling   — Σ over this design's reflecting surfaces, toward the target centre
 *   envelope ceiling — the envelope box's silhouette toward the target, at the best R and L in play:
 *                      no design inside this envelope can beat it
 * Throw follows ANSI FL1: the distance where the peak falls to 0.25 lx, 2·√cd metres.            */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;

  // LED luminance (cd/mm²) seen from direction d (unit, pointing away from the LED)
  function luminance(src, d) {
    const A = RF.Source.emittingArea(src);
    if (!(A > 0)) return Infinity;                                  // point source: unbounded
    const fr = RF.Source.frame(src), c = Math.max(-1, Math.min(1, V.dot(d, fr.a)));
    const I = src.power * RF.Source.intensity(src, Math.acos(c)) / RF.Source.totalIntegral(src);
    return I / (src.kind === 'planar' ? A * Math.max(1e-9, c) : A);
  }
  function polyArea(pts) {                                          // area vector of a planar polygon
    let a = [0, 0, 0];
    for (let i = 1; i + 1 < pts.length; i++) a = V.add(a, V.cross(V.sub(pts[i], pts[0]), V.sub(pts[i + 1], pts[0])));
    return V.mul(a, 0.5);
  }
  // per reflecting surface: area, area projected toward `toward(k, centroid)`, luminance it sees, R
  function surfaceTable(P, src, toward) {
    const G = P.G, D = G.D, S = RF.Geo.STRIDE, out = [];
    for (let k = 0; k < G.n; k++) {
      if (D[k * S + 28] !== 0) continue;                            // reflectors only
      let area = 0, cen = [0, 0, 0], polys = RF.Geo.outline(G, k), vecs = [];
      for (const poly of polys) { const a = polyArea(poly), m = V.len(a); area += m; vecs.push([a, poly]); cen = V.add(cen, V.mul(poly.reduce((s, q) => V.add(s, q), [0, 0, 0]), m / poly.length)); }
      if (!(area > 0)) continue;
      cen = V.mul(cen, 1 / area);
      const u = toward(k, cen);
      let proj = 0; for (const [a] of vecs) proj += Math.abs(V.dot(a, u));
      const L = luminance(src, V.norm(V.sub(cen, src.pos))), R = D[k * S + 29];
      out.push({ k, id: G.metas[k].id, area, proj, L, R, cen, ceil: R * L * proj });
    }
    return out;
  }
  // box silhouette area toward unit u
  function boxProj(half, u) { const [x, y, z] = half.map((h) => 2 * h); return Math.abs(u[0]) * y * z + Math.abs(u[1]) * x * z + Math.abs(u[2]) * x * y; }
  const frac = (ctx) => Math.max(1e-300, ctx.next / Math.max(1, ctx.N));   // share of the run traced so far (grids)
  const fracH = (ctx) => Math.max(1e-300, RF.Engine.hitCoverage(ctx) / Math.max(1, ctx.N));   // …covered by recorded hits
  const cellM2 = (P) => (2 * P.T.half / P.res) ** 2 * 1e-6;

  // a grid of energies (sim cells) → peak candela, from a robust percentile, with its ray count
  function peakCd(P, ctx, vals, q, srcPos, fromHits) {
    const lit = []; for (let i = 0; i < vals.length; i++) if (vals[i] > 0) lit.push(vals[i]);
    lit.sort((a, b) => a - b);
    const e = RF.Engine.pctl(lit, q === undefined ? 0.995 : q), e0 = P.power / Math.max(1, ctx.N);
    const dist = V.dist(P.T.C, srcPos) / 1000;
    return { cd: e / (fromHits ? fracH(ctx) : frac(ctx)) / cellM2(P) * dist * dist, rays: e / e0, lit: lit.length };
  }

  function fixture(scene, P, ctx) {
    const src = scene.source, T = P.T, u = V.norm(V.sub(T.C, src.pos));
    const tab = surfaceTable(P, src, () => u);
    const design = tab.reduce((s, t) => s + t.ceil, 0), area = tab.reduce((s, t) => s + t.area, 0), proj = tab.reduce((s, t) => s + t.proj, 0);
    const Rmax = tab.reduce((m, t) => Math.max(m, t.R), 0) || (scene.modeA && scene.modeA.reflectivity) || 0.9;
    const Lmax = tab.length ? tab.reduce((m, t) => Math.max(m, t.L), 0) : luminance(src, RF.Source.frame(src).a);
    const envProj = boxProj(scene.envelope.half, u), envelope = Rmax * Lmax * envProj;
    const g = RF.Engine.gridTotal(ctx), pk = peakCd(P, ctx, g, 0.995, src.pos);
    const E = ctx.E, lm = (E.direct + E.reflected) / Math.max(1e-300, E.emitted) * src.power;
    const out = {
      luminance: luminance(src, RF.Source.frame(src).a), reflectorArea: area, apertureProj: proj,
      peakCd: pk.cd, peakRays: pk.rays, peakNoise: pk.rays > 0 ? 1 / Math.sqrt(pk.rays) : 1,
      designCeiling: design, envelopeCeiling: envelope, envelopeProj: envProj,
      ofDesign: design > 0 ? pk.cd / design : null, ofEnvelope: envelope > 0 && isFinite(envelope) ? pk.cd / envelope : null,
      throwM: 2 * Math.sqrt(pk.cd), lmOnTarget: lm,
    };
    // delivered ÷ intended per painted cell, normalised so the mean is 1 (Mode A); percentiles only
    if (scene.mode === 'A' && scene.modeA.paint.some((w) => w > 0)) {
      const rp = scene.target.res, Gp = RF.Engine.toPaintGrid(g, P.res, rp), r = [];
      for (let k = 0; k < rp * rp; k++) if (scene.modeA.paint[k] > 0) r.push(Gp[k] / scene.modeA.paint[k]);
      const m = r.reduce((s, x) => s + x, 0) / r.length; r.sort((a, b) => a - b);
      out.ratio = m > 0 ? { p5: RF.Engine.pctl(r, 0.05) / m, p50: RF.Engine.pctl(r, 0.5) / m, p95: RF.Engine.pctl(r, 0.95) / m, mean: m } : null;
    }
    return out;
  }

  // one reflecting surface: its own ceiling toward its aim, and what it measurably did (vals = its landed grid)
  function facet(scene, P, ctx, id, vals, loss) {
    const surf = P.surfaces.find((s) => s.id === id), src = scene.source;
    const tab = surfaceTable(P, src, (k, cen) => (surf && surf.Z ? V.norm(V.sub(surf.Z, surf.P)) : V.norm(V.sub(P.T.C, cen))));
    const t = tab.find((x) => x.id === id); if (!t) return null;
    const pk = peakCd(P, ctx, vals, 0.995, src.pos, true), p90 = peakCd(P, ctx, vals, 0.9, src.pos, true), e0 = src.power / Math.max(1, ctx.N);
    let landed = 0; for (let i = 0; i < vals.length; i++) landed += vals[i];
    const out = {
      id, area: t.area, proj: t.proj, luminance: t.L, R: t.R, ceilingCd: t.ceil, peakCd: pk.cd, p90Cd: p90.cd, peakRays: pk.rays,
      ofCeiling: t.ceil > 0 ? pk.cd / t.ceil : null, distance: V.dist(t.cen, src.pos),
      lmLanded: landed / fracH(ctx),
    };
    if (loss) {
      out.lmCaught = loss.caught * e0 / frac(ctx);
      out.lmCone = (loss.caught + loss.shadowed) * e0 / frac(ctx);   // what its cone of the LED holds (= it alone would catch)
      out.fluxShare = loss.caught / Math.max(1, ctx.next);
      out.shadowed = loss.shadowed / Math.max(1, loss.caught + loss.shadowed);
      out.blocked = loss.fate.blocked / Math.max(1, loss.caught);
    }
    return out;
  }

  // a set of target spots: light landing there, mean illuminance, delivered ÷ intended (Mode A, relative to
  // the whole design's mean ratio: 1 = as painted), and the per-direction ceiling toward the first spot
  function spots(scene, P, ctx, items, landedE, fix) {
    const area = items.reduce((s, q) => s + Math.PI * q.r * q.r, 0) * 1e-6;
    const out = { lm: landedE / fracH(ctx), lux: area > 0 ? landedE / fracH(ctx) / area : 0 };
    if (scene.mode === 'A' && fix && fix.ratio) {
      const rp = scene.target.res, T = RF.Engine.targetFrame(scene.target), cw = 2 * T.half / rp, g = RF.Engine.toPaintGrid(RF.Engine.gridTotal(ctx), P.res, rp);
      let sg = 0, sp = 0;
      for (let j = 0; j < rp; j++) for (let i = 0; i < rp; i++) {
        const cu = -T.half + (i + 0.5) * cw, cv = -T.half + (j + 0.5) * cw;
        if (items.some((q) => (cu - q.u) ** 2 + (cv - q.v) ** 2 <= q.r * q.r)) { sg += g[j * rp + i]; sp += scene.modeA.paint[j * rp + i]; }
      }
      out.ratio = sp > 0 ? sg / sp / fix.ratio.mean : null;       // null: nothing painted here
    }
    const q = items[0], w = RF.Engine.targetUVtoWorld(RF.Engine.targetFrame(scene.target), q.u, q.v), src = scene.source;
    const tab = surfaceTable(P, src, (k, cen) => V.norm(V.sub(w, cen)));
    out.ceilingCd = tab.reduce((s, t) => s + t.ceil, 0);
    return out;
  }

  RF.Photometry = { luminance, fixture, facet, spots, boxProj };
})(typeof globalThis !== 'undefined' ? globalThis : this);
