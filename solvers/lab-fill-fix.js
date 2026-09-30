/* Fill & fix — a paint solver built around two-curvature facets (Flux solver lab, 2026-09-29).
 *
 * 1. SHELL.  Where can a mirror sit so that no facet's reflected light hits another?  Light leaves every facet roughly
 *    along the beam axis B (LED → target).  Measure each direction from the LED by its angle α to B and its azimuth φ
 *    around B; a facet at radius r in that direction sits at height ρ = r·sinα above the axis.  Along one meridian
 *    (fixed φ), ρ must shrink going backward (larger α), with a margin for light heading to off-axis target points.
 *    A paraboloid with the LED at its focus is one such surface; here every meridian instead hugs the envelope wall
 *    wherever the rule allows, so a lopsided envelope gets used on its roomy side.  Covering one more forward
 *    direction caps every facet behind it, so each meridian picks its front cutoff by flux × sharpness.
 * 2. TILES.  The covered directions are split into ≤ budget tiles of equal flux (a k-d split on an equal-area map);
 *    each tile becomes one facet at the shell's radius, outlined by its own cone of directions (so facets tile the
 *    LED's view: no shadowing).  A facet keeps its whole tile: all captured light is used, never trimmed away.
 * 3. FOOTPRINT MODEL.  A facet paints the LED's image (chief-ray reflection of LED sample points: its size is set by
 *    the facet's distance, not chosen) convolved with its own outline scaled by m = 1 − D·v per axis, where v is the
 *    vergence (1/image distance) along that axis.  Two-curvature facets choose v separately along the target's
 *    horizontal and vertical: a wide, short patch for a wash or a cutoff, a sharp one for a hotspot.
 * 4. FILL THEN FIX.  Matching pursuit with fixed mass: facets are placed blurriest-first (nearest the LED), each at
 *    the aim and shape that most reduces a weighted squared error against the paint (painted cells ±relative, gaps
 *    near the paint want dark).  Broad near facets lay the wash; sharp far facets arrive last and take the edges and
 *    the hotspot.  A fast box model (integral images) ranks every aim × shape; the best few are evaluated exactly.
 *    Then sweeps: lift each facet out and re-place it.  The target level is refitted to what actually lands.
 * 5. EMIT ellipsoid-based two-curvature facets; run the app's verify; shrink or drop anything it flags.
 * No tracing: everything is geometry.  Deterministic for (input, settings).                                          */
(function () {
  'use strict';
  const V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ------------------------------------------------------------------ source samples (points that emit toward P)
  function ledSamples(src, P, n) {
    const fr = RF.Source.frame(src), out = [], p = src.pos;
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const g = (i) => (i + 0.5) / n - 0.5;
    if (src.kind === 'point') return [{ x: p.slice(), w: 1 }];
    if (src.kind === 'planar') {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        if (src.shape === 'disc') { const x = g(i) * 2, y = g(j) * 2; if (x * x + y * y > 1) continue; out.push({ x: at(x * src.radius, y * src.radius, 0), w: 1 }); }
        else out.push({ x: at(g(i) * src.w, g(j) * src.h, 0), w: 1 });
      }
    } else if (src.shape === 'cylinder') {
      const d = V.norm(V.sub(P, p)), surf = src.emission === 'surface';
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const a = (i + 0.5) / n * 2 * Math.PI, h = g(j) * src.length, nr = V.add(V.mul(fr.u, Math.cos(a)), V.mul(fr.v, Math.sin(a)));
        if (surf) { const c = V.dot(nr, d); if (c <= 0) continue; out.push({ x: V.add(at(0, 0, h), V.mul(nr, src.radius)), w: c }); }
        else { const rr = src.radius * Math.sqrt((j * 7 % n + 0.5) / n); out.push({ x: V.add(at(0, 0, h), V.mul(nr, rr)), w: 1 }); }
      }
    } else {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = g(i) * 2, y = g(j) * 2; if (x * x + y * y > 1) continue; out.push({ x: V.add(p, V.add(V.mul(fr.u, x * src.radius), V.mul(fr.v, y * src.radius))), w: 1 }); }
    }
    const W = out.reduce((s, q) => s + q.w, 0); for (const q of out) q.w /= W;
    return out;
  }

  // ------------------------------------------------------------------ the solve
  function solveOnce(input, S, tools) {
    const prog = (f, stage) => { if (tools && tools.progress) tools.progress(f, stage); };
    const src = input.source, env = input.envelope, Lp = src.pos, R = input.paint.res, paint = input.paint.cells;
    const T = RF.Engine.designFrame(input.target), cell = 2 * T.half / R, N0 = Math.max(1, input.limits.maxFacets | 0), refl = input.limits.reflectivity;
    const notes = [];
    let psum = 0, pmax = 0, pc = 0, bb = [R, R, -1, -1];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const w = paint[j * R + i]; if (w > 0) { psum += w; pc++; pmax = Math.max(pmax, w); bb = [Math.min(bb[0], i), Math.min(bb[1], j), Math.max(bb[2], i), Math.max(bb[3], j)]; } }
    if (!pc) return { surfaces: [], intent: [], notes: ['nothing painted'] };
    const uvOf = (i, j) => RF.Engine.cellCenter(T, i, j), world = (u, v) => V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v)));
    const cu = (bb[0] + bb[2] + 1) / 2, cv = (bb[1] + bb[3] + 1) / 2, cen = world(-T.half + cu * cell, -T.half + cv * cell);
    const B = V.norm(V.sub(cen, Lp)), [e1, e2] = V.basis(B), Dist = V.dist(cen, Lp);
    const extent = Math.max(bb[2] - bb[0] + 1, bb[3] - bb[1] + 1) * cell / 2, tanBeta = extent / Dist;

    // ---- 1. shell
    prog(0.02, 'shell');
    const NA = S.gridA | 0, NP = S.gridP | 0, fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src);
    const rmin = Math.max(env.keepOut || 0, S.minDistance || 0) + RF.Source.boundingRadius(src) * 0.5 + S.margin;
    const ledSize = src.kind === 'point' ? 0.01 : src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h)) : src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius;
    const rNeed = Math.max(1, ledSize * Dist / Math.max(cell, S.feature * cell));
    const dOm = 4 * Math.PI / (NA * NP);                  // equal-area cells: cosα uniform in [-1, 1]
    const G = [];                                          // G[p][a] = { u, phi, alpha, flux, rEnv }
    for (let q = 0; q < NP; q++) {
      const phi = (q + 0.5) / NP * 2 * Math.PI, row = [];
      for (let a = 0; a < NA; a++) {
        const ca = 1 - 2 * (a + 0.5) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca));
        const u = V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa));
        const th = Math.acos(clamp(V.dot(u, fr.a), -1, 1)), I = RF.Source.intensity(src, th);
        const iv = RF.Geo.envInterval(env, Lp, u), rEnv = iv && iv[1] > Math.max(0, iv[0]) ? iv[1] - S.margin : -1;
        row.push({ u, phi, alpha: Math.acos(ca), ca, sa, flux: src.power * I / Itot * dOm, rEnv });
      }
      G.push(row);
    }
    const value = (r) => Math.pow(Math.min(1, r / rNeed), S.sharp);
    // Each direction sits on a paraboloid with the LED at its focus and axis B: r = 2f / (1 − cosα).  Its surface
    // normal there is the bisector of "back to the LED" and B, i.e. exactly a facet aimed down the beam, so facets
    // lie flush with it (no sawtooth; hugging a flat wall with tilted facets blocked 42% of the light, measured).
    // Along a meridian f may only shrink going backward: then ρ = 2f·cot(α/2) shrinks too and nothing blocks.
    const fEnv = (c) => c.rEnv * (1 - c.ca) / 2, rOf = (f, c) => 2 * f / Math.max(1e-9, 1 - c.ca);
    function chain(row, a0, rmin) {                        // focal lengths along one meridian with the front cutoff at a0
      const fs = new Float64Array(NA).fill(-1); let fP = Infinity, util = 0;
      for (let a = a0; a < NA; a++) {
        const c = row[a]; if (!(c.flux > 0) || c.rEnv < rmin || c.sa < 1e-6) continue;
        const f = Math.min(fEnv(c), fP * (1 - S.step)), r = rOf(f, c);
        if (r < rmin) continue;
        fs[a] = f; fP = f; util += c.flux * value(r);
      }
      return { fs, util };
    }
    function shell(rmin) {
      const covered = []; let fluxAll = 0, fluxCov = 0;
      for (let q = 0; q < NP; q++) {
        const row = G[q]; let best = null;
        for (let a0 = 0; a0 < NA; a0++) { if (!(row[a0].flux > 0) || row[a0].rEnv < rmin) continue; const c = chain(row, a0, rmin); if (!best || c.util > best.util + 1e-12) best = Object.assign(c, { a0 }); }
        for (let a = 0; a < NA; a++) fluxAll += row[a].flux;
        if (!best) continue;
        for (let a = 0; a < NA; a++) if (best.fs[a] > 0) { covered.push({ q, a, f: best.fs[a], r: rOf(best.fs[a], row[a]), flux: row[a].flux, c: row[a] }); fluxCov += row[a].flux; }
      }
      return { covered, fluxAll, fluxCov };
    }
    const { covered, fluxAll, fluxCov } = shell(rmin);
    if (S.minDistance > 0 && S.minDistance > (env.keepOut || 0)) {      // what the Min facet distance costs THIS solver
      const free = shell(Math.max(env.keepOut || 0, 0) + RF.Source.boundingRadius(src) * 0.5 + S.margin), a = fluxCov / fluxAll, b = free.fluxCov / free.fluxAll;
      if (b - a >= 0.05) notes.push('⚠ Min facet distance ' + S.minDistance + ' mm: mirrors reach ' + Math.round(100 * a) + '% of the LED\'s light (' + Math.round(100 * b) + '% at 0)');
    }
    if (!covered.length) return { surfaces: [], intent: [], notes: ['no direction from the LED can hold a mirror inside the envelope'] };
    notes.push('shell covers ' + (100 * fluxCov / Math.max(1e-12, fluxAll)).toFixed(0) + '% of the LED\'s light; radii ' + Math.min(...covered.map((x) => x.r)).toFixed(1) + '–' + Math.max(...covered.map((x) => x.r)).toFixed(1) + ' mm (sharp at ≥ ' + rNeed.toFixed(0) + ' mm)');

    // ---- 2. tiles: k-d split of covered cells in (φ, cosα) into N groups of equal WEIGHT = flux × (r / r_med)^κ.
    // κ = 0 splits by light alone.  Fine paint wants many small sharp (far) facets and few big blurry (near) ones, so
    // κ grows with the share of paint that is narrower than a typical LED image (auto), up to 2.
    prog(0.08, 'tiles');
    const N = Math.min(N0, Math.max(1, Math.floor(covered.length / 2)));
    const rMed = (() => { const s = covered.slice().sort((a, b) => a.r - b.r); let acc = 0; for (const c of s) { acc += c.flux; if (acc >= fluxCov / 2) return c.r; } return s[s.length - 1].r; })();
    const imgMed = ledSize * Dist / rMed / cell;              // LED image of a median facet, in cells
    let kappa = S.detail;
    { // local stroke width of each painted cell = 2 × (Chebyshev distance to the nearest unpainted cell) − 1
      const dIn = new Int32Array(R * R); for (let k = 0; k < R * R; k++) dIn[k] = paint[k] > 0 ? 1 << 20 : 0;
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const k = j * R + i; if (!dIn[k]) continue; let m = Math.min(i, j, R - 1 - i, R - 1 - j) + 1; if (i > 0) m = Math.min(m, dIn[k - 1] + 1); if (j > 0) m = Math.min(m, dIn[k - R] + 1, i > 0 ? dIn[k - R - 1] + 1 : m, i < R - 1 ? dIn[k - R + 1] + 1 : m); dIn[k] = m; }
      for (let j = R - 1; j >= 0; j--) for (let i = R - 1; i >= 0; i--) { const k = j * R + i; if (!dIn[k]) continue; let m = dIn[k]; if (i < R - 1) m = Math.min(m, dIn[k + 1] + 1); if (j < R - 1) m = Math.min(m, dIn[k + R] + 1, i < R - 1 ? dIn[k + R + 1] + 1 : m, i > 0 ? dIn[k + R - 1] + 1 : m); dIn[k] = m; }
      let fine = 0; for (let k = 0; k < R * R; k++) if (paint[k] > 0 && 2 * dIn[k] - 1 < imgMed) fine += paint[k];
      if (kappa < 0) kappa = 2 * fine / psum;
      notes.push('fine detail: ' + Math.round(100 * fine / psum) + '% of the paint is narrower than a median LED image (' + imgMed.toFixed(1) + ' cells) → κ ' + kappa.toFixed(2));
    }
    for (const c of covered) c.wt = c.flux * Math.pow(c.r / rMed, kappa);
    const tiles = [];
    (function split(cells, n) {
      if (n <= 1 || cells.length <= 1) { tiles.push(cells); return; }
      let q0 = Infinity, q1 = -Infinity, a0 = Infinity, a1 = -Infinity, sa = 0, fw = 0;
      for (const c of cells) { q0 = Math.min(q0, c.q); q1 = Math.max(q1, c.q); a0 = Math.min(a0, c.a); a1 = Math.max(a1, c.a); sa += c.c.sa * c.wt; fw += c.wt; }
      // angular extents: along φ ≈ Δφ·sinα, along α ≈ Δα (cosα cells are ~2/(NA·sinα) rad tall)
      const msa = Math.max(0.05, sa / fw), extP = (q1 - q0 + 1) * (2 * Math.PI / NP) * msa, extA = (a1 - a0 + 1) * 2 / (NA * msa);
      const key = extP >= extA ? (c) => c.q : (c) => c.a;
      const s = cells.slice().sort((x, y) => key(x) - key(y) || x.q - y.q || x.a - y.a), nL = Math.floor(n / 2), want = fw * nL / n;
      let acc = 0, k = 0; while (k < s.length - 1 && acc + s[k].wt <= want) { acc += s[k].wt; k++; }
      k = clamp(k, 1, s.length - 1);
      split(s.slice(0, k), nL); split(s.slice(k), n - nL);
    })(covered, N);

    // facet geometry per tile: P at the flux-weighted direction and radius; outline = the tile's direction cone cut by
    // the facet's tangent plane (computed per aim later, since the plane's normal follows the aim)
    const facets = tiles.filter((t) => t.length).map((t, idx) => {
      let u = [0, 0, 0], fl = 0;
      for (const c of t) { u = V.add(u, V.mul(c.c.u, c.flux)); fl += c.flux; }
      u = V.norm(u);
      // the tile's focal length: the flux-weighted median of its cells' (the minimum would be set by its rear-most
      // corner and collapse big tiles onto the LED); corners that then poke out get pulled in at emit
      const byF = t.slice().sort((a, b) => a.f - b.f); let accF = 0, f = byF[0].f; for (const c of byF) { accF += c.flux; if (accF >= fl / 2) { f = c.f; break; } }
      const dirs = [];                                     // every covered cell's 4 corners in (φ, cosα); hull taken in the plane
      for (const c of t) for (const [dq, da] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const phi = (c.q + dq) / NP * 2 * Math.PI, ca = 1 - 2 * (c.a + da) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca));
        dirs.push(V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa)));
      }
      return { idx, u, f, flux: fl * refl, dirs, cells: t };
    });
    // tiles meeting along a meridian: the rear one's focal length may not exceed the front one's (lower rear tiles
    // until every pair holds; only lowering, so it converges)
    { const owner = new Map(); facets.forEach((f, i) => { for (const c of f.cells) owner.set(c.q * NA + c.a, i); });
      const pairs = new Set();
      for (const [key, i] of owner) { const q = Math.floor(key / NA), a = key % NA; for (let b = a + 1; b < NA; b++) { const j = owner.get(q * NA + b); if (j === undefined) continue; if (j !== i) pairs.add(i + ',' + j); break; } }
      const P2 = [...pairs].map((x) => x.split(',').map(Number));
      for (let it = 0; it < 50; it++) { let ch = false; for (const [i, j] of P2) { const lim = facets[i].f * (1 - S.step); if (facets[j].f > lim) { facets[j].f = lim; ch = true; } } if (!ch) break; }
      for (const f of facets) { const ca = V.dot(f.u, B); f.r = 2 * f.f / Math.max(1e-9, 1 - ca); f.P = V.add(Lp, V.mul(f.u, f.r)); } }
    const tooNear = facets.filter((f) => f.r < rmin); for (const f of tooNear) f.dead = true;

    // ---- 3. footprint model
    const NS = S.ledSamples | 0, NAp = Math.max(S.apSamples | 0, N < 40 ? 10 : 0);   // big facets (few of them) need a finer aperture
    function planeHit(P, d) { const den = V.dot(d, T.n); if (Math.abs(den) < 1e-12) return null; const t = V.dot(V.sub(T.C, P), T.n) / den; return t > 0 ? V.add(P, V.mul(d, t)) : null; }
    const uvW = (X) => { const d = V.sub(X, T.C); return [V.dot(d, T.tu), V.dot(d, T.tv)]; };
    // A tile's border directions, found once: seen from the LED, every plane slice of the tile's cone is a central
    // projection of the same directions, which keeps the hull's corners the hull's corners (as long as every one lands
    // in front of the plane).  So outline() can slice these few instead of all of the tile's cells' corners (with few
    // facets that was thousands of points on every aim tried: 60% of a 5-facet solve).  Hull taken in the gnomonic
    // plane around the tile's centre; a tile reaching near 90° off its centre keeps every direction.
    function hullDirs(f) {
      if (f.hd) return f.hd;
      const [e1, e2] = V.basis(f.u), q = [];
      for (const d of f.dirs) { const c = V.dot(d, f.u); if (c < 0.05) return (f.hd = f.dirs); q.push([V.dot(d, e1) / c, V.dot(d, e2) / c]); }
      const idx = q.map((_, i) => i).sort((a, b) => q[a][0] - q[b][0] || q[a][1] - q[b][1]), cr = (o, a, b) => (q[a][0] - q[o][0]) * (q[b][1] - q[o][1]) - (q[a][1] - q[o][1]) * (q[b][0] - q[o][0]);
      const lo = [], hi = [];
      for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
      for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
      const h = lo.slice(0, -1).concat(hi.slice(0, -1));
      return (f.hd = h.length >= 3 ? h.map((i) => f.dirs[i]) : f.dirs);
    }
    function outline(f, n) {                               // tile cone ∩ plane through P with normal n → convex hull (world pts)
      const pts = [], slice = (dirs) => { for (const d of dirs) { const den = V.dot(d, n); if (Math.abs(den) <= 1e-9) return false; const t = V.dot(V.sub(f.P, Lp), n) / den; if (!(t > 0 && t < 3 * f.r)) return false; pts.push(V.add(Lp, V.mul(d, t))); } return true; };
      if (!slice(hullDirs(f))) { pts.length = 0; for (const d of f.dirs) { const den = V.dot(d, n); if (Math.abs(den) <= 1e-9) continue; const t = V.dot(V.sub(f.P, Lp), n) / den; if (t > 0 && t < 3 * f.r) pts.push(V.add(Lp, V.mul(d, t))); } }
      if (pts.length < 3) return null;
      const [x, y] = V.basis(n), p2 = pts.map((p) => [V.dot(V.sub(p, f.P), x), V.dot(V.sub(p, f.P), y)]);
      const idx = p2.map((_, i) => i).sort((a, b) => p2[a][0] - p2[b][0] || p2[a][1] - p2[b][1]), cross = (o, a, b) => (p2[a][0] - p2[o][0]) * (p2[b][1] - p2[o][1]) - (p2[a][1] - p2[o][1]) * (p2[b][0] - p2[o][0]);
      const lo = [], hi = [];
      for (const i of idx) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
      for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
      const h = lo.slice(0, -1).concat(hi.slice(0, -1));
      return h.length >= 3 ? h.map((i) => pts[i]) : null;
    }
    // everything about facet f aimed at target point (u, v): LED image offsets, aperture beam coords, beam→target map
    function optics(f, au, av) {
      const Z = world(au, av), sh = V.norm(V.sub(Lp, f.P)), ah = V.norm(V.sub(Z, f.P)), n = V.norm(V.add(sh, ah)), D = V.dist(Z, f.P);
      const led = [];
      for (const s of f.leds) { const d = V.norm(V.sub(f.P, s.x)), dr = V.sub(d, V.mul(n, 2 * V.dot(d, n))), X = planeHit(f.P, dr); if (X) { const w = uvW(X); led.push([w[0] - au, w[1] - av, s.w]); } }
      const poly = outline(f, n); if (!poly) { if (globalThis.FFDBG) console.log("no outline", f.idx, f.dirs.length, f.r); return null; }
      let b1 = V.sub(T.tu, V.mul(ah, V.dot(T.tu, ah))); if (V.len(b1) < 1e-9) b1 = V.basis(ah)[0]; b1 = V.norm(b1); const b2 = V.cross(ah, b1);
      // aperture samples: a grid over the outline's bbox, kept inside (convex), beam coords h1, h2
      const [x, y] = V.basis(n), p2 = poly.map((p) => [V.dot(V.sub(p, f.P), x), V.dot(V.sub(p, f.P), y)]);
      const inside = (px, py) => { for (let i = 0; i < p2.length; i++) { const a = p2[i], b = p2[(i + 1) % p2.length]; if ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) < 0) return false; } return true; };
      let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity; for (const p of p2) { xl = Math.min(xl, p[0]); xh = Math.max(xh, p[0]); yl = Math.min(yl, p[1]); yh = Math.max(yh, p[1]); }
      const ap = [];
      for (let i = 0; i < NAp; i++) for (let j = 0; j < NAp; j++) {
        const px = xl + (i + 0.5) / NAp * (xh - xl), py = yl + (j + 0.5) / NAp * (yh - yl); if (!inside(px, py)) continue;
        const h = V.add(V.mul(x, px), V.mul(y, py)), hp = V.sub(h, V.mul(ah, V.dot(h, ah)));
        ap.push([V.dot(hp, b1), V.dot(hp, b2)]);
      }
      if (!ap.length) ap.push([0, 0]);
      // beam-transverse unit steps → target-plane (u, v) steps (oblique projection along â)
      const proj = (b) => { const Y = V.add(Z, b), t = V.dot(V.sub(T.C, Y), T.n) / V.dot(ah, T.n), X = V.add(Y, V.mul(ah, t)); const w = uvW(X); return [w[0] - au, w[1] - av]; };
      const M1 = proj(b1), M2 = proj(b2);
      return { Z, D, n, led, ap, M1, M2, poly, b1 };
    }
    // footprint of facet f with optics o and aperture magnifications (m1, m2): splat LED × aperture samples onto the
    // paint grid (bilinear), total = f.flux.  Returns sparse { idx: Int32Array, val: Float64Array }.
    const acc = new Float64Array(R * R), touched = new Int32Array(R * R), mark = new Uint8Array(R * R);
    function footprint(f, o, au, av, m1, m2) {
      let nt = 0; const ns = o.led.length * o.ap.length, w0 = f.flux / Math.max(1, o.ap.length);
      for (const [lu, lv, lw] of o.led) for (const [h1, h2] of o.ap) {
        const du = lu + o.M1[0] * h1 * m1 + o.M2[0] * h2 * m2, dv = lv + o.M1[1] * h1 * m1 + o.M2[1] * h2 * m2;
        const gx = (au + du + T.half) / cell - 0.5, gy = (av + dv + T.half) / cell - 0.5, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, w = w0 * lw;
        for (const [ox, oy, ww] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
          const X = ix + ox, Y = iy + oy; if (X < 0 || Y < 0 || X >= R || Y >= R || ww <= 0) continue;
          const k = Y * R + X; if (!mark[k]) { mark[k] = 1; touched[nt++] = k; } acc[k] += w * ww;
        }
      }
      const idx = new Int32Array(nt), val = new Float64Array(nt);
      for (let t = 0; t < nt; t++) { const k = touched[t]; idx[t] = k; val[t] = acc[k]; acc[k] = 0; mark[k] = 0; }
      return { idx, val, ns };
    }
    // EXACT geometric footprint (no Monte Carlo): the facet's real quadric for this aim and these magnifications; each
    // aperture sample is one of the tile's own direction cells (weighted by its flux), hit on the real surface; each
    // LED sample is reflected there with the real normal and carried to the target plane.  The first-order model
    // above misses aberration, which dominates big facets (16-facet scenes: predicted 73%, traced 53%).
    // fill < 1 = a DIMMED facet: its outline shrunk about the tile's centre direction by √fill (it catches `fill` of
    // its light; the rest passes it by).  Only offered when the Dim knob allows it.
    function footprintExact(f, au, av, m1, m2, fill) {
      const Z = world(au, av), D = V.dist(Z, f.P), q = RF.Geo.facetQuadric2(f.P, Lp, Z, [(1 - m1) / D, (1 - m2) / D], T.tu), A = q.A, bq = q.b;
      fill = fill === undefined ? 1 : fill; const sq = Math.sqrt(fill);
      let nt = 0; const w0 = fill / f.fluxRaw;
      for (const ac0 of f.apDirs) {
        const ac = fill < 1 ? { u: V.norm(V.add(f.u, V.mul(V.sub(ac0.u, f.u), sq))), flux: ac0.flux } : ac0;
        const roots = RF.Geo.quadricRay(A, bq, f.P, Lp, ac.u); let t = -1;
        for (const x of roots) if (x > 0 && (t < 0 || Math.abs(x - f.r) < Math.abs(t - f.r))) t = x;
        if (t < 0) continue;
        const p = V.add(Lp, V.mul(ac.u, t)), x = V.sub(p, f.P);
        const gx = 2 * (A[0] * x[0] + A[1] * x[1] + A[2] * x[2]) + bq[0], gy = 2 * (A[3] * x[0] + A[4] * x[1] + A[5] * x[2]) + bq[1], gz = 2 * (A[6] * x[0] + A[7] * x[1] + A[8] * x[2]) + bq[2];
        const gl = Math.hypot(gx, gy, gz), nx = gx / gl, ny = gy / gl, nz = gz / gl;
        for (const s of f.leds) {
          let dx = p[0] - s.x[0], dy = p[1] - s.x[1], dz = p[2] - s.x[2]; const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
          const dn = 2 * (dx * nx + dy * ny + dz * nz), rx = dx - dn * nx, ry = dy - dn * ny, rz = dz - dn * nz;
          const den = rx * T.n[0] + ry * T.n[1] + rz * T.n[2]; if (Math.abs(den) < 1e-12) continue;
          const tt = ((T.C[0] - p[0]) * T.n[0] + (T.C[1] - p[1]) * T.n[1] + (T.C[2] - p[2]) * T.n[2]) / den; if (!(tt > 0)) continue;
          const X0 = p[0] + rx * tt - T.C[0], X1 = p[1] + ry * tt - T.C[1], X2 = p[2] + rz * tt - T.C[2];
          const uu = X0 * T.tu[0] + X1 * T.tu[1] + X2 * T.tu[2], vv = X0 * T.tv[0] + X1 * T.tv[1] + X2 * T.tv[2];
          const gxx = (uu + T.half) / cell - 0.5, gyy = (vv + T.half) / cell - 0.5, ix = Math.floor(gxx), iy = Math.floor(gyy), fx = gxx - ix, fy = gyy - iy, w = ac.flux * s.w * w0 * f.flux;
          if (ix < -1 || iy < -1 || ix >= R || iy >= R) continue;
          if (ix >= 0 && iy >= 0) { const k = iy * R + ix; if (!mark[k]) { mark[k] = 1; touched[nt++] = k; } acc[k] += w * (1 - fx) * (1 - fy); }
          if (ix + 1 < R && iy >= 0) { const k = iy * R + ix + 1; if (!mark[k]) { mark[k] = 1; touched[nt++] = k; } acc[k] += w * fx * (1 - fy); }
          if (ix >= 0 && iy + 1 < R) { const k = (iy + 1) * R + ix; if (!mark[k]) { mark[k] = 1; touched[nt++] = k; } acc[k] += w * (1 - fx) * fy; }
          if (ix + 1 < R && iy + 1 < R) { const k = (iy + 1) * R + ix + 1; if (!mark[k]) { mark[k] = 1; touched[nt++] = k; } acc[k] += w * fx * fy; }
        }
      }
      const idx = new Int32Array(nt), val = new Float64Array(nt);
      for (let t2 = 0; t2 < nt; t2++) { const k = touched[t2]; idx[t2] = k; val[t2] = acc[k]; acc[k] = 0; mark[k] = 0; }
      return { idx, val };
    }
    // second moments (target mm²) of the LED image and of the aperture term at m = 1, per axis — for the box model
    function moments(o) {
      let su = 0, sv = 0, suu = 0, svv = 0, W = 0;
      for (const [lu, lv, lw] of o.led) { su += lu * lw; sv += lv * lw; suu += lu * lu * lw; svv += lv * lv * lw; W += lw; }
      const lu2 = Math.max(0, suu / W - (su / W) ** 2), lv2 = Math.max(0, svv / W - (sv / W) ** 2);
      let a1 = 0, a2 = 0; for (const [h1, h2] of o.ap) { a1 += h1 * h1; a2 += h2 * h2; } a1 /= o.ap.length; a2 /= o.ap.length;
      // aperture term along target u / v at m = 1: axis 1 maps through M1, axis 2 through M2
      const au2 = a1 * o.M1[0] ** 2 + a2 * o.M2[0] ** 2, av2 = a1 * o.M1[1] ** 2 + a2 * o.M2[1] ** 2;
      return { lu2, lv2, au2, av2, a1: Math.sqrt(a1), a2: Math.sqrt(a2) };
    }

    // ---- target field and weights (mirrors the app's fidelity: painted ±relative, gaps near the paint dark)
    prog(0.12, 'footprints');
    const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target }).cells || 0, band = Math.ceil(ker + 2);
    const isGap = new Uint8Array(R * R);
    { const dist = new Int32Array(R * R).fill(1 << 20);   // Chebyshev distance to paint (two-pass)
      for (let k = 0; k < R * R; k++) if (paint[k] > 0) dist[k] = 0;
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { const k = j * R + i; if (i > 0) dist[k] = Math.min(dist[k], dist[k - 1] + 1); if (j > 0) { dist[k] = Math.min(dist[k], dist[k - R] + 1); if (i > 0) dist[k] = Math.min(dist[k], dist[k - R - 1] + 1); if (i < R - 1) dist[k] = Math.min(dist[k], dist[k - R + 1] + 1); } }
      for (let j = R - 1; j >= 0; j--) for (let i = R - 1; i >= 0; i--) { const k = j * R + i; if (i < R - 1) dist[k] = Math.min(dist[k], dist[k + 1] + 1); if (j < R - 1) { dist[k] = Math.min(dist[k], dist[k + R] + 1); if (i < R - 1) dist[k] = Math.min(dist[k], dist[k + R + 1] + 1); if (i > 0) dist[k] = Math.min(dist[k], dist[k + R - 1] + 1); } }
      for (let k = 0; k < R * R; k++) isGap[k] = paint[k] <= 0 && dist[k] <= band ? 1 : 0; }
    let gapN = 0; for (let k = 0; k < R * R; k++) gapN += isGap[k];
    const mass = facets.reduce((s, f) => s + f.flux, 0), typical = psum / pc;
    let scale = mass * S.util / psum;                       // target light per unit paint
    const W = new Float64Array(R * R), C = new Float64Array(R * R), F = new Float64Array(R * R), boost = new Float64Array(R * R).fill(1);
    let gw = S.gapWeight * pc / Math.max(1, gapN);            // both halves of the F1 count about equally (rebalanced per sweep)
    function setTarget() {
      for (let k = 0; k < R * R; k++) {
        const w = paint[k] * scale; W[k] = w;
        C[k] = (paint[k] > 0 ? 1 / (w * w) : isGap[k] ? gw / ((typical * scale) ** 2) : S.farWeight / ((typical * scale) ** 2)) * boost[k];
      }
    }
    setTarget();

    // per-facet optics at the paint's centre (for ordering and the box model); LED samples per facet
    for (const f of facets) {
      f.leds = ledSamples(src, f.P, NS);
      { const st = Math.max(1, Math.floor(f.cells.length / S.apCells)); f.apDirs = []; let tot = 0;   // every st-th cell, carrying the flux of the ones it stands for
        for (let i = 0; i < f.cells.length; i += st) { let fl = 0; for (let j = i; j < Math.min(f.cells.length, i + st); j++) fl += f.cells[j].flux; f.apDirs.push({ u: f.cells[i].c.u, flux: fl }); tot += fl; }
        f.fluxRaw = tot; }
      if (f.dead) continue;
      const o = optics(f, -T.half + cu * cell, -T.half + cv * cell); f.o0 = o;
      if (!o) { f.dead = true; continue; }
      f.mom = moments(o);
      f.ledArea = Math.sqrt((f.mom.lu2 + 1e-9) * (f.mom.lv2 + 1e-9));
    }
    // fit each facet to the envelope BEFORE planning (aimed at the paint's centre, focused): pull it toward the LED
    // along its own direction until the host's verify accepts it, so the plan is made with the geometry that ships
    // (planning first and pulling at the end moved 16-facet designs by up to 43% after the fact).
    { const sceneV = { source: src, envelope: env, target: input.target, modeA: { budget: N0 } }, au0 = -T.half + cu * cell, av0 = -T.half + cv * cell;
      for (const f of facets) {
        if (f.dead) continue;
        for (let it = 0; it < 14; it++) {
          const Z = world(au0, av0), D = V.dist(Z, f.P), n = V.norm(V.add(V.norm(V.sub(Lp, f.P)), V.norm(V.sub(Z, f.P)))), hull = outline(f, n);
          const q = hull && RF.Geo.facetQuadric2(f.P, Lp, Z, [1 / D, 1 / D], T.tu), pts = [];
          if (hull) for (const h of hull) { const d = V.norm(V.sub(h, Lp)), ro = RF.Geo.quadricRay(q.A, q.b, f.P, Lp, d).filter((t) => t > 0); if (ro.length) pts.push(V.add(Lp, V.mul(d, ro.reduce((m, x) => (Math.abs(x - f.r) < Math.abs(m - f.r) ? x : m), ro[0])))); }
          const ok = pts.length >= 3 && (() => { const v = RF.Solvers.verify(sceneV, { surfaces: [{ type: 'facet', id: 'x', P: f.P, S0: Lp, Z, flat: false, vg: [1 / D, 1 / D], ax: T.tu, clip: { kind: 'poly', pts3: pts } }] }); return !v.errors.length && !v.violations.envelope.length && !v.violations.keepOut.length; })();
          if (ok) break;
          f.r *= 0.94; f.P = V.add(Lp, V.mul(f.u, f.r));
          if (f.r < rmin) { f.dead = true; break; }
        }
        if (!f.dead) { f.leds = ledSamples(src, f.P, NS); const o = optics(f, au0, av0); if (!o) f.dead = true; else { f.o0 = o; f.mom = moments(o); f.ledArea = Math.sqrt((f.mom.lu2 + 1e-9) * (f.mom.lv2 + 1e-9)); } }
      } }
    const live = facets.filter((f) => !f.dead);
    // shape menu: aperture-term widths per axis (in cells), from 0 (focused) up to the painting's size
    const span = Math.max(bb[2] - bb[0] + 1, bb[3] - bb[1] + 1);
    const WID = [0, 1, 2, 3, 5, 8, 12, 18, 27, 40, 60, 90, 135].filter((w) => w <= span * 1.2);
    // magnification that gives aperture-term width w (cells, 2·√3·σ box-equivalent) along axis k
    const mFor = (f, w, k) => { const s = k === 1 ? Math.sqrt(f.mom.au2) : Math.sqrt(f.mom.av2); return s > 1e-9 ? w * cell / (2 * Math.sqrt(3) * s) : 0; };

    // ---- integral images of c·(F−W) and c for the box search
    const IA = new Float64Array((R + 1) * (R + 1)), IC = new Float64Array((R + 1) * (R + 1));
    function integrals() {
      for (let j = 0; j < R; j++) { let ra = 0, rc = 0; for (let i = 0; i < R; i++) { const k = j * R + i; ra += C[k] * (F[k] - W[k]); rc += C[k]; IA[(j + 1) * (R + 1) + i + 1] = IA[j * (R + 1) + i + 1] + ra; IC[(j + 1) * (R + 1) + i + 1] = IC[j * (R + 1) + i + 1] + rc; } }
    }
    const box = (I, x0, y0, x1, y1) => I[y1 * (R + 1) + x1] - I[y0 * (R + 1) + x1] - I[y1 * (R + 1) + x0] + I[y0 * (R + 1) + x0];
    const dE = (fp) => { let d = 0; for (let t = 0; t < fp.idx.length; t++) { const k = fp.idx[t], f = fp.val[t]; d += C[k] * (2 * (F[k] - W[k]) * f + f * f); } return d; };
    const add = (fp, s) => { for (let t = 0; t < fp.idx.length; t++) F[fp.idx[t]] += s * fp.val[t]; };

    // candidate search for one facet: box model over every aim × shape, then exact evaluation of the best few
    const twoCurv = S.shapes === 'two';
    let polishLevels = S.polish;                           // full polish on the last sweep only (see below)
    function place(f, shapeWin, near) {
      integrals();
      const lw = Math.sqrt(12 * f.mom.lu2) / cell, lh = Math.sqrt(12 * f.mom.lv2) / cell, cand = [];
      const K = S.topK | 0, stride = near ? 1 : Math.max(1, Math.round(span / S.aimGrid));
      // a sweep re-places a facet near where it was (window grows with its footprint); the first pass searches everywhere
      let ib = bb; if (near) { const w = Math.ceil(4 + 1.5 * Math.max(lw, lh, WID[near.a], WID[near.b])), ci = Math.round((near.au + T.half) / cell - 0.5), cj = Math.round((near.av + T.half) / cell - 0.5); ib = [Math.max(bb[0], ci - w), Math.max(bb[1], cj - w), Math.min(bb[2], ci + w), Math.min(bb[3], cj + w)]; }
      for (let a = 0; a < WID.length; a++) for (let b = 0; b < WID.length; b++) {
        if (!twoCurv && a !== b) continue;
        if (shapeWin && (Math.abs(a - shapeWin[0]) > 2 || Math.abs(b - shapeWin[1]) > 2)) continue;
        const bw = Math.max(1, Math.round(Math.hypot(WID[a], lw))), bh = Math.max(1, Math.round(Math.hypot(WID[b], lh))), fb = f.flux / (bw * bh);
        const hw = bw >> 1, hh = bh >> 1, R1 = R + 1, farC = fb * fb * S.farWeight / ((typical * scale) ** 2), f2 = 2 * fb, fsq = fb * fb;
        let worst = cand.length < K ? Infinity : cand[cand.length - 1].d;
        for (let j = ib[1]; j <= ib[3]; j += stride) {
          let y0 = j - hh; if (y0 < 0) y0 = 0; else if (y0 > R) y0 = R; let y1 = y0 + bh; if (y1 > R) y1 = R;
          const r0 = y0 * R1, r1 = y1 * R1;
          for (let i = ib[0]; i <= ib[2]; i += stride) {
            let x0 = i - hw; if (x0 < 0) x0 = 0; else if (x0 > R) x0 = R; let x1 = x0 + bw; if (x1 > R) x1 = R;
            const sa = IA[r1 + x1] - IA[r0 + x1] - IA[r1 + x0] + IA[r0 + x0], sc = IC[r1 + x1] - IC[r0 + x1] - IC[r1 + x0] + IC[r0 + x0];
            const d = f2 * sa + fsq * sc + (bw * bh - (x1 - x0) * (y1 - y0)) * farC;      // light off the grid counts as spill
            if (d < worst) { cand.push({ d, i, j, a, b }); cand.sort((p, q) => p.d - q.d); if (cand.length > K) cand.pop(); worst = cand.length < K ? Infinity : cand[cand.length - 1].d; }
          }
        }
      }
      let best = null;
      const SUB = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5], [-0.5, 0], [0, -0.5]];
      for (let ci = 0; ci < cand.length; ci++) for (const [oi, oj] of S.subcell && ci < 2 ? SUB : [[0, 0]]) {   // half-cell phases for the top two only
        const c = cand[ci];
        const [au, av] = uvOf(c.i + oi, c.j + oj), o = optics(f, au, av); if (!o) continue;
        const mm = moments(o), m1 = WID[c.a] ? WID[c.a] * cell / (2 * Math.sqrt(3) * Math.max(1e-9, Math.sqrt(mm.au2))) : 0, m2 = WID[c.b] ? WID[c.b] * cell / (2 * Math.sqrt(3) * Math.max(1e-9, Math.sqrt(mm.av2))) : 0;
        // box axes are target u/v; the aperture axes are b1 ≈ u, b2 ≈ v, so m1 widens u and m2 widens v
        const fp = S.exact ? footprintExact(f, au, av, m1, m2) : footprint(f, o, au, av, m1, m2), d = dE(fp);
        if (!best || d < best.d) best = { d, fp, au, av, m1, m2, a: c.a, b: c.b, o, fill: 1 };
      }
      if (best && polishLevels > 0) polish(f, best, polishLevels);
      return best;
    }
    // continuous refinement of the winner: pattern search on aim (u, v) and the two magnifications, halving steps
    function polish(f, best, levels) {
      const tryAt = (au, av, m1, m2, fill) => { const o = optics(f, au, av); if (!o) return null; const fp = S.exact ? footprintExact(f, au, av, m1, m2, fill) : footprint(f, o, au, av, m1, m2); return { d: dE(fp), fp, au, av, m1, m2, a: best.a, b: best.b, o, fill }; };
      let st = 0.5 * cell, sm = 0.3;
      for (let lvl = 0; lvl < levels; lvl++, st /= 2, sm /= 2) {
        let moved = true;
        for (let it = 0; it < 6 && moved; it++) {
          moved = false;
          const opts = [[st, 0, 1, 1], [-st, 0, 1, 1], [0, st, 1, 1], [0, -st, 1, 1], [0, 0, 1 + sm, 1], [0, 0, 1 / (1 + sm), 1], [0, 0, 1, 1 + sm], [0, 0, 1, 1 / (1 + sm)]];
          if (S.dim > 0 && S.exact) for (const kf of [1 - sm, 1 / (1 - sm)]) {       // dimming, within the allowed range
            const fl = clamp(best.fill * kf, 1 - S.dim, 1); if (Math.abs(fl - best.fill) < 1e-6) continue;
            const c = tryAt(best.au, best.av, best.m1, best.m2, fl); if (c && c.d < best.d - 1e-12) { Object.assign(best, c); moved = true; }
          }
          for (const [du, dv, k1, k2] of opts) {
            const m1 = best.m1 > 1e-6 ? best.m1 * k1 : k1 > 1 ? 0.2 : 0, m2 = best.m2 > 1e-6 ? best.m2 * k2 : k2 > 1 ? 0.2 : 0;
            if ((k1 !== 1 || k2 !== 1) && !twoCurv && Math.abs(m1 - m2) > 1e-9 && !(k1 !== 1 && k2 !== 1)) continue;
            const c = tryAt(best.au + du, best.av + dv, m1, twoCurv ? m2 : m1, best.fill);
            if (c && c.d < best.d - 1e-12) { Object.assign(best, c); moved = true; }
          }
        }
      }
    }

    // ---- 4. fill then fix
    const order = live.slice().sort((a, b) => b.ledArea - a.ledArea || a.idx - b.idx);
    polishLevels = Math.min(1, S.polish);
    let done = 0;
    for (const f of order) {
      const p = place(f, null); if (p && (p.d < 0 || S.useAll)) { f.pl = p; add(p.fp, 1); }
      if (++done % 8 === 0) prog(0.15 + 0.35 * done / order.length, 'fill ' + done + '/' + order.length);
    }
    function refit() {                                       // match the target level to what lands on the paint
      let a = 0, b = 0; for (let k = 0; k < R * R; k++) if (paint[k] > 0) { a += C[k] * F[k] * paint[k]; b += C[k] * paint[k] * paint[k]; }
      if (a > 0 && b > 0) { scale = a / b; setTarget(); }
    }
    // the app's own fidelity on the PREDICTED field (no rays): what the sweeps are judged by, and which cells fail
    const fake = { source: src, envelope: env, target: input.target, modeA: { paint } };
    const predScore = () => { const fd = RF.Photometry.fidelity(fake, { res: R, power: 1 }, { gridD: F, gridR: new Float64Array(R * R), E: { emitted: 1 }, N: 1e12, next: 1e12 }); return fd; };
    const snap = () => order.map((f) => f.pl);
    let best = { fd: predScore(), pl: snap() };
    for (let sw = 0; sw < S.sweeps; sw++) {
      // boosting: cells the metric fails weigh more next sweep, cells it passes relax (iteratively reweighted fit)
      // the headline is an F1 (harmonic mean) of painted-right and gaps-dark: it pays to keep them level, so the gap
      // weight follows whichever half lags in the predicted field (a fixed weight left the ring at 79 / 97)
      { const fd0 = predScore(); if (fd0) { const lag = fd0.gapsDark - fd0.within; if (lag > 0.02) gw *= 0.6; else if (lag < -0.02) gw *= 1.5; } }
      if (S.boost > 0 && best.fd) { const vd = predScore().verdict; for (let k = 0; k < R * R; k++) { if (vd[k] > 0) boost[k] = Math.min(8, boost[k] * (1 + S.boost)); else if (vd[k] === 0) boost[k] = Math.max(0.35, boost[k] * 0.9); } }
      refit(); let nDone = 0; polishLevels = sw === S.sweeps - 1 ? S.polish : Math.min(1, S.polish);
      for (const f of order) {                             // lift each facet out and re-place it (or leave it out, if it only hurts)
        if (f.pl) add(f.pl.fp, -1);
        const p = place(f, sw < S.sweeps - 1 || !f.pl ? null : [f.pl.a, f.pl.b], sw > 0 && f.pl ? f.pl : null);
        if (++nDone % 8 === 0) prog(0.5 + 0.4 * (sw + nDone / order.length) / Math.max(1, S.sweeps), 'fix sweep ' + (sw + 1) + '/' + S.sweeps + ' · ' + nDone + '/' + order.length);
        f.pl = p && (p.d < 0 || S.useAll) ? p : null;
        if (f.pl) add(f.pl.fp, 1);
      }
      const fd = predScore(); if (fd && (!best.fd || fd.fidelity > best.fd.fidelity)) best = { fd, pl: snap() };
      prog(0.5 + 0.4 * (sw + 1) / Math.max(1, S.sweeps), 'fix sweep ' + (sw + 1) + '/' + S.sweeps + (fd ? ' · predicted ' + Math.round(100 * fd.fidelity) + '%' : ''));
    }
    order.forEach((f, i) => { f.pl = best.pl[i]; });
    if (best.fd) notes.push('predicted fidelity ' + (100 * best.fd.fidelity).toFixed(1) + '% (the model\'s own field, scored by the app)');

    // ---- 5. emit.  The outline goes on the REAL surface: each hull vertex's direction from the LED is intersected
    // with the facet's own quadric, so the mirror catches its tile's cone (a flat-plane outline caught 0.45–1.7× its
    // share, measured).  A facet the host's verify flags is pulled toward the LED (same cone, same light, a bit
    // blurrier) rather than shrunk; after 8 pulls it is dropped.
    prog(0.92, 'emit + verify');
    function build(f, k) {
      const pl = f.pl, P = V.add(Lp, V.mul(f.u, f.r * k)), Z = pl.o.Z, D = V.dist(Z, P), v1 = (1 - pl.m1) / D, v2 = (1 - pl.m2) / D;
      const sh = V.norm(V.sub(Lp, P)), n = V.norm(V.add(sh, V.norm(V.sub(Z, P))));
      const g = Object.assign({}, f, { P }), hull = outline(g, n); if (!hull) return null;
      const q = RF.Geo.facetQuadric2(P, Lp, Z, [v1, v2], T.tu), pts = [];
      const sq = Math.sqrt(pl.fill === undefined ? 1 : pl.fill);
      for (const h of hull) {
        const d = V.norm(V.add(f.u, V.mul(V.sub(V.norm(V.sub(h, Lp)), f.u), sq))), roots = RF.Geo.quadricRay(q.A, q.b, P, Lp, d).filter((t) => t > 0);
        if (!roots.length) return null;
        const t = roots.reduce((m, x) => (Math.abs(x - V.dist(h, Lp)) < Math.abs(m - V.dist(h, Lp)) ? x : m), roots[0]);   // the sheet near the flat estimate
        pts.push(V.add(Lp, V.mul(d, t)));
      }
      return { type: 'facet', id: 'F' + f.idx, P, S0: Lp.slice(), Z, flat: false, vg: [v1, v2], ax: T.tu.slice(), di: v1 + v2 > 0 ? 2 / (v1 + v2) : 1e9,
        clip: { kind: 'poly', pts3: pts }, optics: { interaction: 'reflect', reflectivity: refl } };
    }
    const scene = { source: src, envelope: env, target: input.target, modeA: { budget: N0 } }, pull = new Map();
    let surfaces = order.filter((f) => f.pl).map((f) => build(f, 1)).filter(Boolean);
    for (let pass = 0; pass < 9; pass++) {
      const v = RF.Solvers.verify(scene, { surfaces }), bad = new Set(v.violations.envelope.concat(v.violations.keepOut));
      if (!bad.size) break;
      surfaces = surfaces.map((s) => {
        if (!bad.has(s.id)) return s;
        const f = order.find((x) => 'F' + x.idx === s.id), k = (pull.get(s.id) || 1) * 0.94; pull.set(s.id, k);
        return pass < 8 ? build(f, k) : null;
      }).filter(Boolean);
    }
    if (pull.size) notes.push(pull.size + ' facet(s) pulled toward the LED to fit (' + [...pull.values()].map((k) => Math.round(100 * (1 - k)) + '%').join(', ') + ')');
    const intent = [];
    for (const f of order) {
      if (!f.pl) continue;
      let pk = 0; for (const x of f.pl.fp.val) pk = Math.max(pk, x);
      const cells = []; for (let t = 0; t < f.pl.fp.idx.length; t++) if (f.pl.fp.val[t] > 0.05 * pk) cells.push([f.pl.fp.idx[t], +(f.pl.fp.val[t] / f.flux).toFixed(5)]);
      intent.push({ facet: 'F' + f.idx, cells });
    }
    const ids = new Set(surfaces.map((s) => s.id));
    notes.push(surfaces.length + ' facets; two-curvature ' + (twoCurv ? 'on' : 'off') + '; LED image ' + (Math.sqrt(12 * order[order.length - 1].mom.lu2) / cell).toFixed(1) + '–' + (Math.sqrt(12 * order[0].mom.lu2) / cell).toFixed(1) + ' cells wide (far–near)');
    prog(1, 'done');
    let onP = 0; for (let k = 0; k < R * R; k++) if (paint[k] > 0) onP += F[k];
    const out = { surfaces, intent: intent.filter((it) => ids.has(it.facet)), notes, pred: { fid: best.fd ? best.fd.fidelity : 0, onPaint: onP / src.power } };
    if (S.debug) out.debug = { R, cell, scale, F: Array.from(F), W: Array.from(W), facets: order.filter((f) => f.pl && ids.has('F' + f.idx)).map((f) => ({ id: 'F' + f.idx, r: f.r, flux: f.flux, m: [f.pl.m1, f.pl.m2], aim: [f.pl.au, f.pl.av], idx: Array.from(f.pl.fp.idx), val: Array.from(f.pl.fp.val) })) };
    return out;
  }

  // Shell search (no rays): dish-fit's lesson — the best reflector size depends on the painting, and the model's own
  // predicted field, scored with the app's fidelity, is a good enough judge.  Quick solves (1 sweep, light polish) for
  // a few shell settings; the winner (predicted fidelity + light × lightWeight) gets the full solve.
  // Priority × Quality → the expert knobs they stand for (an expert knob set by hand wins)
  const PRIORITY = { sharp: { lightWeight: 0, useAll: false, dim: 0, shells: [1, 2, 3.5, 5] }, balanced: { lightWeight: 0.25, useAll: false, dim: 0, shells: [0, 0.5, 1, 2, 3.5] }, light: { lightWeight: 1, useAll: true, dim: 0, shells: [0, 0.3, 0.7, 1.2] } };
  const QUALITY = { fast: { search: false, sweeps: 2, polish: 1, apCells: 32, ledSamples: 5, topK: 4, exact: true }, normal: { search: true, sweeps: 3, polish: 2, apCells: 48, ledSamples: 6, topK: 6, exact: true }, best: { search: true, sweeps: 5, polish: 3, apCells: 64, ledSamples: 7, topK: 8, exact: true } };
  function resolve(S0) {
    const S = Object.assign({}, S0), P = PRIORITY[S.priority] || PRIORITY.balanced, Q = QUALITY[S.quality] || QUALITY.normal;
    const pick = (k, auto) => { if (S[k] === -1 || S[k] === 'auto' || S[k] === undefined) S[k] = auto; else if (S[k] === 'on') S[k] = true; else if (S[k] === 'off') S[k] = false; };
    pick('lightWeight', P.lightWeight); pick('useAll', P.useAll); pick('dim', P.dim); pick('search', Q.search); pick('sweeps', Q.sweeps); pick('polish', Q.polish);
    pick('apCells', Q.apCells); pick('ledSamples', Q.ledSamples); pick('topK', Q.topK); pick('exact', Q.exact);
    S.shells = S.sharp >= 0 ? [S.sharp] : P.shells; if (S.sharp < 0) S.sharp = P.shells[Math.floor(P.shells.length / 2)];
    return S;
  }
  function solve(input, S0, tools) {
    const S = S0.__resolved ? S0 : Object.assign(resolve(S0), { __resolved: true });
    if (!S.search || S.shells.length < 2) return solveOnce(input, S, tools);
    const prog = (f, st) => { if (tools && tools.progress) tools.progress(f, st); };
    const opts = S.shells, res = [];
    opts.forEach((sh, i) => {
      const quick = Object.assign({}, S, { sharp: sh, sweeps: 1, polish: 1, search: false });
      const out = solveOnce(input, quick, { progress: (f, st) => prog(0.5 * (i + f) / opts.length, 'shell ' + (i + 1) + '/' + opts.length + ' · ' + (st || '')) });
      res.push({ sh, v: out.pred.fid + S.lightWeight * out.pred.onPaint, pred: out.pred });
    });
    res.sort((a, b) => b.v - a.v || a.sh - b.sh);
    const out = solveOnce(input, Object.assign({}, S, { sharp: res[0].sh, search: false }), { progress: (f, st) => prog(0.5 + 0.5 * f, 'final · ' + (st || '')) });
    out.notes.unshift('shell search (predicted fidelity / light on paint): ' + res.map((r) => 'sharp ' + r.sh + ': ' + (100 * r.pred.fid).toFixed(1) + '% / ' + (100 * r.pred.onPaint).toFixed(0) + '%').join(' · ') + ' → sharp ' + res[0].sh);
    return out;
  }

  RF.Solvers.register({
    id: 'fill-fix', name: 'Fill & fix', version: '0.3', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'priority', label: 'Priority', type: 'select', default: 'balanced', options: [{ value: 'sharp', label: 'sharpest' }, { value: 'balanced', label: 'balanced' }, { value: 'light', label: 'most light' }],
        help: 'Sharpest: the best match to the paint, even if some light is let go. Most light: capture and use as much of the LED as possible, at some cost in sharpness.' },
      { key: 'shapes', label: 'Facet shapes', type: 'select', default: 'two', options: [{ value: 'two', label: 'two-curvature (wide/short patches)' }, { value: 'round', label: 'one curvature' }],
        help: 'Two-curvature facets focus differently across and along: wide, short patches for washes and cutoffs.' },
      { key: 'quality', label: 'Quality', type: 'select', default: 'normal', options: [{ value: 'fast', label: 'fast (~3 s)' }, { value: 'normal', label: 'normal' }, { value: 'best', label: 'best (~20 s)' }] },
      // expert knobs: −1 / 'auto' = set by Priority and Quality
      { key: 'sharp', adv: true, label: 'Shell: sharpness vs light (−1 auto)', type: 'number', min: -1, max: 5, step: 0.1, default: -1 },
      { key: 'search', adv: true, label: 'Shell search by predicted score', type: 'select', default: 'auto', options: ['auto', 'on', 'off'] },
      { key: 'lightWeight', adv: true, label: 'Light on paint worth, vs fidelity (−1 auto)', type: 'number', min: -1, max: 3, step: 0.05, default: -1 },
      { key: 'detail', adv: true, label: 'Facets toward sharp directions κ (−1 from the paint)', type: 'number', min: -1, max: 4, step: 0.1, default: -1 },
      { key: 'feature', adv: true, label: 'Finest detail (cells)', type: 'number', min: 1, max: 20, step: 0.5, default: 3 },
      { key: 'sweeps', adv: true, label: 'Fix sweeps (−1 auto)', type: 'number', min: -1, max: 12, step: 1, default: -1 },
      { key: 'polish', adv: true, label: 'Continuous refinement levels (−1 auto)', type: 'number', min: -1, max: 5, step: 1, default: -1 },
      { key: 'boost', adv: true, label: 'Boost failing cells per sweep', type: 'number', min: 0, max: 2, step: 0.1, default: 0.6 },
      { key: 'gapWeight', adv: true, label: 'Keep gaps dark (weight)', type: 'number', min: 0, max: 10, step: 0.1, default: 1 },
      { key: 'farWeight', adv: true, label: 'Stray light elsewhere (weight)', type: 'number', min: 0, max: 10, step: 0.01, default: 0.05 },
      { key: 'util', adv: true, label: 'Target level (share of captured light)', type: 'number', min: 0.3, max: 1.5, step: 0.05, default: 0.9 },
      { key: 'dim', adv: true, label: 'May dim facets by up to (share; −1 auto)', type: 'number', min: -1, max: 0.9, step: 0.05, default: -1, help: 'A dimmed facet is shrunk and lets part of its light go. Gives fine brightness control at edges, at a cost in light.' },
      { key: 'useAll', adv: true, label: 'Place facets that only hurt', type: 'select', default: 'auto', options: ['auto', 'on', 'off'] },
      { key: 'step', adv: true, label: 'Focal step between rows (share)', type: 'number', min: 0, max: 0.2, step: 0.005, default: 0.01 },
      { key: 'margin', adv: true, label: 'Wall / gap margin (mm)', type: 'number', min: 0, max: 5, step: 0.05, default: 0.3 },
      { key: 'exact', adv: true, label: 'Exact footprints', type: 'select', default: 'auto', options: ['auto', 'on', 'off'] },
      { key: 'apCells', adv: true, label: 'Aperture samples per facet (−1 auto)', type: 'number', min: -1, max: 400, step: 4, default: -1 },
      { key: 'ledSamples', adv: true, label: 'LED samples per side (−1 auto)', type: 'number', min: -1, max: 16, step: 1, default: -1 },
      { key: 'apSamples', adv: true, label: 'Aperture samples per side (fast model)', type: 'number', min: 2, max: 16, step: 1, default: 6 },
      { key: 'topK', adv: true, label: 'Exact checks per facet (−1 auto)', type: 'number', min: -1, max: 40, step: 1, default: -1 },
      { key: 'aimGrid', adv: true, label: 'Aim search grid (per side)', type: 'number', min: 10, max: 400, step: 10, default: 40 },
      { key: 'subcell', adv: true, label: 'Half-cell aims', type: 'checkbox', default: true },
      { key: 'gridA', adv: true, label: 'Shell grid (polar)', type: 'number', min: 20, max: 400, step: 10, default: 120 },
      { key: 'gridP', adv: true, label: 'Shell grid (azimuth)', type: 'number', min: 12, max: 360, step: 6, default: 96 },
    ],
    solve,
  });
})();
