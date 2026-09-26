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


  // ---------------------------------------------------------------- paint fidelity
  // The smallest LED image any facet in this envelope can paint on the target, in paint cells (square
  // kernel).  Étendue: a mirror at distance r from the LED sends a beam at least (LED size / r) wide,
  // whatever its curvature.  Conservative on purpose (a smaller kernel only makes scoring stricter):
  // the LED's SMALLER side, foreshortened (× cos θ) for a planar LED, over envelope points within
  // CONE_DEG of the LED axis (a Lambertian LED puts ~75% of its light inside 60°).
  const CONE_DEG = 60;
  function envelopeSamples(env) {
    const c = env.center, h = env.half, out = [], n = 24;
    if (env.shape === 'box') {
      for (let ax = 0; ax < 3; ax++) for (const sd of [-1, 1]) for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) {
        const d = [0, 0, 0], i = (ax + 1) % 3, j = (ax + 2) % 3; d[ax] = sd * h[ax]; d[i] = (2 * a / n - 1) * h[i]; d[j] = (2 * b / n - 1) * h[j];
        out.push([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
      }
    } else if (env.shape === 'ellipsoid') {
      const N = 2000, g = Math.PI * (3 - Math.sqrt(5));
      for (let k = 0; k < N; k++) { const z = 1 - 2 * (k + 0.5) / N, r = Math.sqrt(1 - z * z), t = g * k; out.push([c[0] + h[0] * r * Math.cos(t), c[1] + h[1] * r * Math.sin(t), c[2] + h[2] * z]); }
    } else {                                                    // cylinder along env.axis
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      for (let a = 0; a <= n; a++) for (let k = 0; k < 72; k++) {
        const t = 2 * Math.PI * k / 72, d = [0, 0, 0]; d[ax] = (2 * a / n - 1) * h[ax]; d[i] = h[i] * Math.cos(t); d[j] = h[j] * Math.sin(t);
        out.push([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
      }
    }
    return out;
  }
  function ledMinSize(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h);
    if (src.shape === 'cylinder') return Math.min(2 * src.radius, src.length);
    return 2 * src.radius;
  }
  function achievableKernel(scene) {
    const src = scene.source, p = src.pos, a = RF.Source.frame(src).a, planar = src.kind === 'planar', s0 = ledMinSize(src);
    const cosMax = Math.cos(CONE_DEG * Math.PI / 180), cell = scene.target.size / scene.target.res;
    let best = Infinity, rAt = 0;
    for (const q of envelopeSamples(scene.envelope)) {
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], r = Math.hypot(d[0], d[1], d[2]); if (!(r > 1e-9)) continue;
      const ct = (d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / r; if (ct < cosMax) continue;
      const img = scene.target.distance * s0 * (planar ? ct : 1) / r;
      if (img < best) { best = img; rAt = r; }
    }
    if (!isFinite(best)) return { cells: 0, mm: 0, r: 0 };      // no envelope inside the cone: no concession
    return { cells: best / cell, mm: best, r: rAt };
  }
  // separable box blur with a fractional width (w cells, centred); energy leaving the grid is lost
  function boxBlur(src, R, w) {
    if (!(w > 1e-6)) return Float64Array.from(src);
    const h = w / 2, pass = (g, alongX) => {
      const out = new Float64Array(R * R);
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
        const c = alongX ? i : j, a0 = c + 0.5 - h, b0 = c + 0.5 + h; let s = 0;
        for (let q = Math.floor(a0); q < Math.ceil(b0); q++) { if (q < 0 || q >= R) continue; s += (Math.min(b0, q + 1) - Math.max(a0, q)) * (alongX ? g[j * R + q] : g[q * R + i]); }
        out[j * R + i] = s / w;
      }
      return out;
    };
    return pass(pass(src, true), false);
  }

  // Paint fidelity (Mode A).  Scale: the design's light on the paint, spread as painted ("same total").
  // A painted cell PASSES if what it got is within TOL of the raw paint OR of the paint blurred by the
  // smallest LED image (blur can only lower the bar, and only on painted cells: unpainted light is spill,
  // always counted raw).  Ratio percentiles are against the raw paint.  noiseCeiling: the pass share a
  // perfect design would show at this ray count (shot noise alone), to read `within` against.
  // GAP_RAMP: a gap cell's credit reaches 0 at 0.3 × a typical painted cell ABOVE its allowance.  Calibrated 2026-09-26
  // against eye rankings of 7 designs on 2 scenes (1.0 ranked a smear over Astra; 0.3 is the gentlest that agrees).
  const TOL = [0.8, 1.25], GAP_PAD = 2, DARK = 0.1, GAP_RAMP = 0.3;   // ×/÷1.25 (symmetric in log) · gap band = blur kernel + 2 cells · 'dark' = under 10% of a typical painted cell
  const Phi = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2); return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y); };
  function fidelity(scene, P, ctx) {
    const paint = scene.modeA && scene.modeA.paint; if (!paint || !paint.some((w) => w > 0)) return null;
    const R = scene.target.res, G = RF.Engine.toPaintGrid(RF.Engine.gridTotal(ctx), P.res, R), n = R * R;
    let sG = 0, sGp = 0, sp = 0; for (let k = 0; k < n; k++) { sG += G[k]; if (paint[k] > 0) { sGp += G[k]; sp += paint[k]; } }
    const ker = achievableKernel(scene), B = boxBlur(paint, R, ker.cells), band = boxBlur(paint, R, Math.max(2, ker.cells));
    // the scale ("exposure") that passes the most cells: cell k passes for sc in [g/(TOL1·max ref), g/(TOL0·min ref)]
    // (refs per unit scale: paint, blurred paint).  Absolute level is efficiency's job, so fidelity takes the best one.
    const ev = [];
    for (let k = 0; k < n; k++) if (paint[k] > 0 && G[k] > 0) { const lo = Math.min(paint[k], B[k]), hi = Math.max(paint[k], B[k]); ev.push([G[k] / (TOL[1] * hi), 1], [G[k] / (TOL[0] * Math.max(1e-300, lo)), -1]); }
    ev.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    let run = 0, bestN = -1, sc = sGp / sp;
    for (let e = 0; e < ev.length; e++) { run += ev[e][1]; if (ev[e][1] > 0 && run > bestN) { bestN = run; sc = ev[e + 1] ? Math.sqrt(ev[e][0] * ev[e + 1][0]) : ev[e][0]; } }   // geometric midpoint of the best range
    const dark0 = !(sGp > 0) || !(sc > 0);                    // no light on the paint at all: nothing is 'within'
    const e0 = (P.power / (ctx.N || 1)) || 1, pp = (i, j) => i >= 0 && j >= 0 && i < R && j < R && paint[j * R + i] > 0;
    const cnt = { all: [0, 0, 0, 0], interior: [0, 0, 0, 0], edge: [0, 0, 0, 0] };   // [pass, under, over, cells]
    let rawPass = 0, noise = 0, near = 0; const ratios = [];
    const verdict = new Int8Array(n).fill(-1), ratioAt = new Float32Array(n);   // per cell: -1 unpainted (or a dark gap) · 0 within · 1 under · 2 over · 3 lit gap
    for (let k = 0; k < n; k++) {
      if (!(paint[k] > 0)) { if (band[k] > 0) near += G[k]; continue; }
      const i = k % R, j = (k / R) | 0; let edge = false;
      for (let a = -1; a <= 1 && !edge; a++) for (let b = -1; b <= 1; b++) if (!pp(i + a, j + b)) { edge = true; break; }
      const rr = sc * paint[k], rb = sc * B[k], lo = TOL[0] * Math.min(rr, rb), hi = TOL[1] * Math.max(rr, rb), g = G[k];
      const cls = dark0 ? 1 : g < lo ? 1 : g > hi ? 2 : 0; verdict[k] = cls; ratioAt[k] = rr > 0 ? g / rr : 0;
      for (const c of [cnt.all, edge ? cnt.edge : cnt.interior]) { c[cls]++; c[3]++; }
      if (!dark0 && g >= TOL[0] * rr && g <= TOL[1] * rr) rawPass++;
      ratios.push(sc > 0 ? g / rr : 0);
      const m = rr / e0; noise += m > 0 ? Phi((TOL[1] - 1) * Math.sqrt(m)) - Phi((TOL[0] - 1) * Math.sqrt(m)) : 0;
    }
    ratios.sort((a, b) => a - b);
    // "the dark stays dark": unpainted cells within (blur kernel + GAP_PAD) cells of the paint (the gaps between strokes,
    // the zone above a cutoff) must stay under max(1.25 × the blurred paint there, DARK × a typical painted cell), at the
    // same fitted scale.  A flood passes every painted cell and fails every gap, so it can no longer rank first.
    const rb = Math.ceil(ker.cells) + GAP_PAD, dil = (src, alongX) => { const out = new Uint8Array(n);
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { if (!src[j * R + i]) continue; const c = alongX ? i : j;
        for (let q = Math.max(0, c - rb); q <= Math.min(R - 1, c + rb); q++) out[alongX ? j * R + q : q * R + i] = 1; } return out; };
    const near2 = dil(dil(paint.map((w) => (w > 0 ? 1 : 0)), true), false);
    // Each gap cell earns credit on a ramp: 1 at or under its allowance, falling linearly to 0 when it carries a full
    // 0.3 × a typical painted cell ABOVE the allowance (GAP_RAMP).  A flood scores 0, a faint halo 1, a smear partial.
    let gapN = 0, gapCredit = 0, gapStrict = 0; const typ = sp / cnt.all[3];
    for (let k = 0; k < n; k++) if (near2[k] && !(paint[k] > 0)) {
      gapN++; const allow = sc * Math.max(TOL[1] * B[k], DARK * typ), over = G[k] - allow;
      if (over <= 0) { gapCredit++; gapStrict++; } else { gapCredit += Math.max(0, 1 - over / (GAP_RAMP * sc * typ)); verdict[k] = 3; }
    }
    const withinPainted = cnt.all[0] / cnt.all[3], dark = gapN ? gapCredit / gapN : 1;
    const share = (c) => c[3] ? { within: c[0] / c[3], under: c[1] / c[3], over: c[2] / c[3], cells: c[3] } : null, em = ctx.E.emitted || 1;
    return {
      // THE headline: the F1 score (harmonic mean) of painted-right and gaps-dark, so it is near 0 if EITHER half is.
      // (A 50/50 average gave a flood and a pitch-black design 50% each.)
      fidelity: gapN ? (withinPainted + dark > 0 ? 2 * withinPainted * dark / (withinPainted + dark) : 0) : withinPainted,
      gapsDark: dark, gapsDarkStrict: gapN ? gapStrict / gapN : 1, gapCells: gapN, gapBand: rb,
      tol: TOL, kernel: ker, ...share(cnt.all), withinRaw: rawPass / cnt.all[3], interior: share(cnt.interior), edge: share(cnt.edge),
      ratio: { p5: RF.Engine.pctl(ratios, 0.05), p25: RF.Engine.pctl(ratios, 0.25), p50: RF.Engine.pctl(ratios, 0.5), p75: RF.Engine.pctl(ratios, 0.75), p95: RF.Engine.pctl(ratios, 0.95) },
      onPaint: sGp / em, onTarget: sG / em, spill: sG > 0 ? 1 - sGp / sG : 0, spillNear: sG > 0 ? near / sG : 0,
      verdict, ratioAt, G, scale: sc, raysPerCell: sc / e0 * (sp / cnt.all[3]), noiseCeiling: dark0 ? null : noise / cnt.all[3], fidelityNoiseCeiling: dark0 ? null : gapN ? 2 * (noise / cnt.all[3]) / (noise / cnt.all[3] + 1) : noise / cnt.all[3],   // null: nothing lit, no ceiling to state
    };
  }

  RF.Photometry = { luminance, fixture, facet, spots, boxProj, fidelity, achievableKernel, boxBlur, FID_TOL: TOL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
