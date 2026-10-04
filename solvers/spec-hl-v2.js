/* Spec headlamp v2 — a solver that designs to a beam SPECIFICATION (Spec mode), not to a painting.
 *
 * Pass the regulation first, make it a good beam second.  Everything is done in the far field, in (H, V) degrees, the way
 * the goniometer and the app's judge (RF.Spec.evaluate) see the lamp:
 *
 *  1. SPEC → BANDS.  Every constraint in input.spec becomes a per-pixel band [lo, hi] (cd) on a 0.1° grid, tightened by a
 *     safety margin (so Monte-Carlo noise doesn't turn a pass into "unsure"); the cut-off scans (gradient, linearity)
 *     become explicit edge terms on the model field, measured as the judge measures them (knee of log E, G, inflections).
 *  2. SHELL + UNITS.  The LED's emission is split into units of equal flux, each a mirror patch on a shell that keeps
 *     reflected light from hitting other patches (adapted from Fill & fix).  A unit's flux and place are fixed; its AIM
 *     (H, V) and its SHAPE (two-curvature: spread along H and along V, in degrees) are what the solver chooses.
 *  3. FOOTPRINTS.  The far-field pattern of each (unit, shape) is traced exactly (the real quadric, sampled LED, sampled
 *     aperture) once, then placed anywhere by translation in angle.
 *  4. FIT.  A seeded greedy + annealing search places every unit's aim and shape so that the summed footprints stay inside
 *     the bands (compliance: the primary cost) and then follow the secondary goal: the painting, and spec rows of weight
 *     below 1 (best effort, never at the cost of a full-weight row).
 *  5. EMIT two-curvature facets, run the host's verify, pull in or drop whatever it flags.
 * Deterministic for (input, settings).                                                                                  */
(function () {
  'use strict';
  const RF = globalThis.RF;
  const V = RF.V;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------- small deterministic helpers
  function rng(seed) { let s = seed | 0 || 1; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

  // ---------------------------------------------------------------- 0. the problem
  // Reads input.spec (or, without one, makes an empty spec: the solver then follows the painting alone).
  function readProblem(input, S) {
    const src = input.source, env = input.envelope, Lp = src.pos.slice();
    const spec = input.spec || { items: [], conv: 'A', kernel: 0.15, step: 0.1, window: [-10, 10, -5, 5], aim: { mode: 'design', line: -0.57 }, measure: { distance: Infinity }, traffic: 'RHT' };
    const conv = spec.conv || 'A', gs = S.grid;
    const win = spec.window || [-10, 10, -5, 5];
    const nh = Math.max(1, Math.round((win[1] - win[0]) / gs)), nv = Math.max(1, Math.round((win[3] - win[2]) / gs));
    const G = { gs, h0: win[0], v0: win[2], nh, nv, conv, n: nh * nv };
    G.omega = new Float64Array(G.n);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) G.omega[j * nh + i] = RF.FarField.binOmega(G.h0 + i * gs, G.h0 + (i + 1) * gs, G.v0 + j * gs, G.v0 + (j + 1) * gs, conv);
    G.hOf = (i) => G.h0 + (i + 0.5) * gs; G.vOf = (j) => G.v0 + (j + 0.5) * gs;
    G.iOf = (h) => Math.floor((h - G.h0) / gs); G.jOf = (v) => Math.floor((v - G.v0) / gs);
    G.inside = (i, j) => i >= 0 && j >= 0 && i < nh && j < nv;
    return { src, env, Lp, spec, conv, G, limits: input.limits, refl: input.limits.reflectivity, N0: Math.max(1, input.limits.maxFacets | 0), input };
  }

  // ---------------------------------------------------------------- direction helpers (the lamp frame: forward +x, right −y, up +z)
  const dirHV = (h, v, conv) => RF.FarField.dirOf(h, v, conv);
  const hvDir = (d, conv) => RF.FarField.hvOf(d, conv);

  // ---------------------------------------------------------------- LED sample points (as seen from a point P)
  // Quasi-random points on the emitter (Halton, rotated per facet so lattice artefacts do not line up across units); weights sum to 1.
  function ledPoints(src, P, n, shift) {
    const fr = RF.Source.frame(src), p = src.pos, out = [];
    const at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    const hs = (k, b) => (halton(k + 1, b) + shift * 0.6180339887) % 1;
    if (src.kind === 'point') return [{ x: p.slice(), w: 1 }];
    const d = V.norm(V.sub(P, p));
    for (let k = 0; k < n; k++) {
      const a = hs(k, 2), b = hs(k, 3), c = hs(k, 5);
      if (src.kind === 'planar') {
        if (src.shape === 'disc') { const r = src.radius * Math.sqrt(a), t = 2 * Math.PI * b; out.push({ x: at(r * Math.cos(t), r * Math.sin(t), 0), w: 1 }); }
        else out.push({ x: at((a - 0.5) * src.w, (b - 0.5) * src.h, 0), w: 1 });
      } else if (src.shape === 'cylinder') {
        const t = 2 * Math.PI * a, h = (b - 0.5) * src.length, nr = V.add(V.mul(fr.u, Math.cos(t)), V.mul(fr.v, Math.sin(t)));
        if (src.emission === 'surface') { const cs = V.dot(nr, d); if (cs <= 0) continue; out.push({ x: V.add(at(0, 0, h), V.mul(nr, src.radius)), w: cs }); }
        else { const rr = src.radius * Math.sqrt(c); out.push({ x: V.add(at(0, 0, h), V.mul(nr, rr)), w: 1 }); }
      } else {                                           // sphere
        const ct = 1 - 2 * a, st = Math.sqrt(Math.max(0, 1 - ct * ct)), t = 2 * Math.PI * b, r = src.radius * Math.cbrt(c);
        const q = [r * st * Math.cos(t), r * st * Math.sin(t), r * ct];
        if (src.emission === 'surface') { const nn = V.norm(q), cs = V.dot(nn, d); if (cs <= 0) continue; out.push({ x: V.add(p, V.mul(nn, src.radius)), w: cs }); }
        else out.push({ x: V.add(p, q), w: 1 });
      }
    }
    if (!out.length) out.push({ x: p.slice(), w: 1 });
    const W = out.reduce((s, q) => s + q.w, 0); for (const q of out) q.w /= W;
    return out;
  }

  // ---------------------------------------------------------------- 1. shell and units (adapted from Fill & fix)
  // Beam axis B: where the spec wants its light (weighted centre of the minimums), else straight ahead and a little down.
  function beamAxis(P) {
    let sw = 0, sh = 0, sv = 0;
    for (const it of P.spec.items) {
      if (!(it.min > 0) || it.kind === 'gradient' || it.kind === 'linearity' || it.kind === 'imax') continue;
      const pts = it.poly ? it.poly : it.pts ? it.pts : it.h !== undefined ? [[it.h, it.v]] : [];
      if (!pts.length) continue;
      const w = Math.log10(1 + it.min) * (it.w > 0 ? it.w : 1) / pts.length;
      for (const [h, v] of pts) { sw += w; sh += w * h; sv += w * v; }
    }
    const h = sw > 0 ? clamp(sh / sw, -8, 8) : 0, v = sw > 0 ? clamp(sv / sw, -4, 2) : -1;
    return { h, v, dir: dirHV(h, v, P.conv) };
  }

  function buildShell(P, S, notes) {
    const { src, env, Lp } = P, fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src);
    const B = P.B.dir, [e1, e2] = V.basis(B);
    const NA = S.gridA | 0, NP = S.gridP | 0, refl = P.refl;
    const rmin = Math.max(env.keepOut || 0, S.minDistance || 0) + RF.Source.boundingRadius(src) * 0.5 + S.wall;
    const ledSize = src.kind === 'point' ? 0.01 : src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h)) : src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius;
    const rNeed = Math.max(1, ledSize / Math.tan(S.finest * D2R));       // distance at which the LED image is `finest` degrees wide
    const dOm = 4 * Math.PI / (NA * NP);
    const cells = [];                                                    // cells[p][a]
    for (let q = 0; q < NP; q++) {
      const phi = (q + 0.5) / NP * 2 * Math.PI, row = [];
      for (let a = 0; a < NA; a++) {
        const ca = 1 - 2 * (a + 0.5) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca));
        const u = V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa));
        const th = Math.acos(clamp(V.dot(u, fr.a), -1, 1)), I = RF.Source.intensity(src, th);
        const iv = RF.Geo.envInterval(env, Lp, u), rEnv = iv && iv[1] > Math.max(0, iv[0]) ? iv[1] - S.wall : -1;
        row.push({ u, phi, alpha: Math.acos(ca), ca, sa, flux: src.power * I / Itot * dOm, rEnv });
      }
      cells.push(row);
    }
    const value = (r) => Math.pow(Math.min(1, r / rNeed), S.sharp);
    const fEnv = (c) => c.rEnv * (1 - c.ca) / 2, rOf = (f, c) => 2 * f / Math.max(1e-9, 1 - c.ca);
    function chain(row, a0, rm) {
      const fs = new Float64Array(NA).fill(-1); let fP = Infinity, util = 0;
      for (let a = a0; a < NA; a++) {
        const c = row[a]; if (!(c.flux > 0) || c.rEnv < rm || c.sa < 1e-6) continue;
        const f = Math.min(fEnv(c), fP * (1 - S.step)), r = rOf(f, c);
        if (r < rm) continue;
        fs[a] = f; fP = f; util += c.flux * value(r);
      }
      return { fs, util };
    }
    const covered = []; let fluxAll = 0, fluxCov = 0;
    for (let q = 0; q < NP; q++) {
      const row = cells[q]; let best = null;
      for (let a0 = 0; a0 < NA; a0++) { if (!(row[a0].flux > 0) || row[a0].rEnv < rmin) continue; const c = chain(row, a0, rmin); if (!best || c.util > best.util + 1e-12) best = Object.assign(c, { a0 }); }
      for (let a = 0; a < NA; a++) fluxAll += row[a].flux;
      if (!best) continue;
      for (let a = 0; a < NA; a++) if (best.fs[a] > 0) { covered.push({ q, a, f: best.fs[a], r: rOf(best.fs[a], row[a]), flux: row[a].flux, c: row[a] }); fluxCov += row[a].flux; }
    }
    if (!covered.length) return null;
    notes.push('shell covers ' + (100 * fluxCov / Math.max(1e-12, fluxAll)).toFixed(0) + '% of the LED\'s light; radii ' + Math.min(...covered.map((x) => x.r)).toFixed(1) + '–' + Math.max(...covered.map((x) => x.r)).toFixed(1) + ' mm');
    // tiles: k-d split into ≤ N groups of equal weight = flux × (r / r_med)^κ (κ > 0: more, smaller, sharper units far from the LED)
    const N = Math.min(P.N0, Math.max(1, Math.floor(covered.length / 2)));
    const rMed = (() => { const s = covered.slice().sort((a, b) => a.r - b.r); let acc = 0; for (const c of s) { acc += c.flux; if (acc >= fluxCov / 2) return c.r; } return s[s.length - 1].r; })();
    for (const c of covered) c.wt = c.flux * Math.pow(c.r / rMed, S.detail);
    const tiles = [];
    (function split(cs, n) {
      if (n <= 1 || cs.length <= 1) { tiles.push(cs); return; }
      let q0 = Infinity, q1 = -Infinity, a0 = Infinity, a1 = -Infinity, sa = 0, fw = 0;
      for (const c of cs) { q0 = Math.min(q0, c.q); q1 = Math.max(q1, c.q); a0 = Math.min(a0, c.a); a1 = Math.max(a1, c.a); sa += c.c.sa * c.wt; fw += c.wt; }
      const msa = Math.max(0.05, sa / fw), extP = (q1 - q0 + 1) * (2 * Math.PI / NP) * msa, extA = (a1 - a0 + 1) * 2 / (NA * msa);
      const key = extP >= extA ? (c) => c.q : (c) => c.a;
      const s = cs.slice().sort((x, y) => key(x) - key(y) || x.q - y.q || x.a - y.a), nL = Math.floor(n / 2), want = fw * nL / n;
      let acc = 0, k = 0; while (k < s.length - 1 && acc + s[k].wt <= want) { acc += s[k].wt; k++; }
      k = clamp(k, 1, s.length - 1);
      split(s.slice(0, k), nL); split(s.slice(k), n - nL);
    })(covered, N);
    const units = tiles.filter((t) => t.length).map((t, idx) => {
      let u = [0, 0, 0], fl = 0;
      for (const c of t) { u = V.add(u, V.mul(c.c.u, c.flux)); fl += c.flux; }
      u = V.norm(u);
      const byF = t.slice().sort((a, b) => a.f - b.f); let accF = 0, f = byF[0].f; for (const c of byF) { accF += c.flux; if (accF >= fl / 2) { f = c.f; break; } }
      const dirs = [];
      for (const c of t) for (const [dq, da] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const phi = (c.q + dq) / NP * 2 * Math.PI, ca = 1 - 2 * (c.a + da) / NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca));
        dirs.push(V.add(V.mul(B, ca), V.mul(V.add(V.mul(e1, Math.cos(phi)), V.mul(e2, Math.sin(phi))), sa)));
      }
      return { idx, u, f, flux: fl * refl, fluxRaw: fl, dirs, cells: t };
    });
    // rear tile's focal length may not exceed the front one's along a meridian (no sawtooth)
    { const owner = new Map(); units.forEach((f, i) => { for (const c of f.cells) owner.set(c.q * NA + c.a, i); });
      const pairs = new Set();
      for (const [key, i] of owner) { const q = Math.floor(key / NA), a = key % NA; for (let b = a + 1; b < NA; b++) { const j = owner.get(q * NA + b); if (j === undefined) continue; if (j !== i) pairs.add(i + ',' + j); break; } }
      const P2 = [...pairs].map((x) => x.split(',').map(Number));
      for (let it = 0; it < 50; it++) { let ch = false; for (const [i, j] of P2) { const lim = units[i].f * (1 - S.step); if (units[j].f > lim) { units[j].f = lim; ch = true; } } if (!ch) break; }
      for (const f of units) { const ca = V.dot(f.u, B); f.r = 2 * f.f / Math.max(1e-9, 1 - ca); f.P = V.add(Lp, V.mul(f.u, f.r)); } }
    for (const f of units) if (f.r < rmin) f.dead = true;
    // OWNERSHIP.  A built facet is the convex hull of its tile's corner directions, so it catches more than its own cells (the
    // hull of an annular-sector tile bulges: +33 % measured).  Whatever lies in a hull is caught by the NEAREST facet along
    // the ray (the engine takes the first hit), so every cell of the sphere goes to the nearest unit whose hull cone holds it,
    // and a unit's flux is what it will really intercept.
    { const live = units.filter((f) => !f.dead);
      for (const f of live) {
        const [b1, b2] = V.basis(f.u); f.gb = [b1, b2];
        const hd = hullDirs(f); let cm = 1; const q = [];
        for (const d of hd) { const c = V.dot(d, f.u); cm = Math.min(cm, c); q.push([V.dot(d, b1) / Math.max(c, 0.05), V.dot(d, b2) / Math.max(c, 0.05)]); }
        f.cosMax = cm - 1e-9; f.hq = q;
        const sh = V.norm(V.sub(Lp, f.P)); f.nRef = V.norm(V.add(sh, B)); f.dRef = V.dot(V.sub(f.P, Lp), f.nRef);
        f.own = [];
      }
      const inside = (q, x, y) => { for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-12) return false; } return true; };
      for (let qi = 0; qi < NP; qi++) for (let a = 0; a < NA; a++) {
        const c = cells[qi][a]; if (!(c.flux > 0)) continue;
        let best = null, bt = Infinity;
        for (const f of live) {
          const cu = V.dot(c.u, f.u); if (cu < f.cosMax) continue;
          if (!inside(f.hq, V.dot(c.u, f.gb[0]) / cu, V.dot(c.u, f.gb[1]) / cu)) continue;
          const den = V.dot(c.u, f.nRef); if (!(Math.abs(den) > 1e-9)) continue;
          const t = f.dRef / den; if (t > 0 && t < bt) { bt = t; best = f; }
        }
        if (best) best.own.push({ q: qi, a, flux: c.flux, c });
      }
      for (const f of live) { if (!f.own.length) { f.dead = true; continue; } f.cells = f.own; f.fluxRaw = f.own.reduce((sx, c) => sx + c.flux, 0); f.flux = f.fluxRaw * refl; } }
    return { units, fluxAll, fluxCov, rmin, rNeed, ledSize, shell: { B, e1, e2, NA, NP } };
  }

  // tile cone ∩ the plane through f.P with normal n → convex hull (world points).  Hull directions found once per unit.
  function hullDirs(f) {
    if (f.hd) return f.hd;
    const [b1, b2] = V.basis(f.u), q = [];
    for (const d of f.dirs) { const c = V.dot(d, f.u); if (c < 0.05) return (f.hd = f.dirs); q.push([V.dot(d, b1) / c, V.dot(d, b2) / c]); }
    const idx = q.map((_, i) => i).sort((a, b) => q[a][0] - q[b][0] || q[a][1] - q[b][1]), cr = (o, a, b) => (q[a][0] - q[o][0]) * (q[b][1] - q[o][1]) - (q[a][1] - q[o][1]) * (q[b][0] - q[o][0]);
    const lo = [], hi = [];
    for (const i of idx) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], i) <= 0) lo.pop(); lo.push(i); }
    for (let k = idx.length - 1; k >= 0; k--) { const i = idx[k]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], i) <= 0) hi.pop(); hi.push(i); }
    const h = lo.slice(0, -1).concat(hi.slice(0, -1));
    return (f.hd = h.length >= 3 ? h.map((i) => f.dirs[i]) : f.dirs);
  }
  function outline(P, f, n) {
    const Lp = P.Lp, pts = [], slice = (dirs) => { for (const d of dirs) { const den = V.dot(d, n); if (Math.abs(den) <= 1e-9) return false; const t = V.dot(V.sub(f.P, Lp), n) / den; if (!(t > 0 && t < 3 * f.r)) return false; pts.push(V.add(Lp, V.mul(d, t))); } return true; };
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

  // ---------------------------------------------------------------- 2. shapes (two-curvature) and the exact footprint tracer
  // A shape is the pair (βh, βv) of aperture spreads in degrees (rms): 0 = collimating (the sharpest the LED allows), larger =
  // a weaker (flatter, then convex) mirror along that axis.  Output vergence along a beam axis: W = 1/D − β/σ, σ = the unit's
  // aperture rms along that axis (mm); the aperture term then spreads the beam by β (uniform over the outline, so ±√3 β).
  const AXH = [0, -1, 0];                                    // the lamp's "right" in the world: the two-curvature axis ax
  function aimFrame(P, f, dAim) {                            // normal, beam axes for unit f aimed along dAim (a world direction)
    const sh = V.norm(V.sub(P.Lp, f.P)), n = V.norm(V.add(sh, dAim));
    let b1 = V.sub(AXH, V.mul(dAim, V.dot(AXH, dAim))); if (V.len(b1) < 1e-9) b1 = V.basis(dAim)[0]; b1 = V.norm(b1);
    return { n, b1, b2: V.cross(dAim, b1) };
  }
  // aperture rms (mm) along the unit's beam axes when aimed along dAim: from the outline hull on the tangent plane
  function apertureRms(P, f, dAim) {
    const fr = aimFrame(P, f, dAim), hull = outline(P, f, fr.n); if (!hull) return null;
    let c = [0, 0, 0]; for (const p of hull) c = V.add(c, p); c = V.mul(c, 1 / hull.length);
    // uniform over the polygon: sample its bounding grid
    const [x, y] = V.basis(fr.n), p2 = hull.map((p) => [V.dot(V.sub(p, f.P), x), V.dot(V.sub(p, f.P), y)]);
    let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity; for (const p of p2) { xl = Math.min(xl, p[0]); xh = Math.max(xh, p[0]); yl = Math.min(yl, p[1]); yh = Math.max(yh, p[1]); }
    const inside = (px, py) => { for (let i = 0; i < p2.length; i++) { const a = p2[i], b = p2[(i + 1) % p2.length]; if ((b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]) < 0) return false; } return true; };
    let n = 0, s1 = 0, s2 = 0, m1 = 0, m2 = 0; const pts = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      const px = xl + (i + 0.5) / 12 * (xh - xl), py = yl + (j + 0.5) / 12 * (yh - yl); if (!inside(px, py)) continue;
      const h = V.add(V.mul(x, px), V.mul(y, py)), hp = V.sub(h, V.mul(dAim, V.dot(h, dAim)));
      const a = V.dot(hp, fr.b1), b = V.dot(hp, fr.b2); pts.push([a, b]); m1 += a; m2 += b; n++;
    }
    if (!n) return null; m1 /= n; m2 /= n;
    for (const [a, b] of pts) { s1 += (a - m1) ** 2; s2 += (b - m2) ** 2; }
    return { s1: Math.sqrt(s1 / n) || 1e-6, s2: Math.sqrt(s2 / n) || 1e-6, fr };
  }


  // The exact far-field footprint of unit f aimed at (ah, av) degrees with shape (βh, βv): the facet's real quadric, the
  // tile's own direction cells as aperture samples (jittered, weighted by the source's intensity), a quasi-random sample of
  // the LED reflected there with the real normal.  Result: sparse pattern in cd (per pixel offset from the aim pixel) for
  // the unit's whole flux; place it anywhere by translation.  `opt`: { nAp, nLed, aimPixel: [ai, aj] }.
  const D_FAR = 25000;
  const SC = { acc: new Float64Array(0), cnt: new Float32Array(0), mark: new Uint8Array(0), touched: new Int32Array(0), R: -1 };
  function scratch(R) {
    if (SC.R !== R) { const w = 2 * R + 1; SC.acc = new Float64Array(w * w); SC.cnt = new Float32Array(w * w); SC.mark = new Uint8Array(w * w); SC.touched = new Int32Array(w * w); SC.R = R; }
    return SC;
  }
  function facetOf(P, f, aimHV, shape, k) {
    const d = dirHV(aimHV[0], aimHV[1], P.conv), ap = apertureRms(P, f, d); if (!ap) return null;
    const W1 = 1 / D_FAR - shape[0] * D2R / ap.s1, W2 = 1 / D_FAR - shape[1] * D2R / ap.s2;
    const Z = V.madd(f.P, d, D_FAR), q = RF.Geo.facetQuadric2(f.P, P.Lp, Z, [W1, W2], AXH);
    return { d, ap, W: [W1, W2], Z, q };
  }
  // one quasi-random point on the emitter, from three uniforms (and the weight of that point: surface emitters are cosine-weighted)
  function ledAt(src, fr, P, a, b, c) {
    const p = src.pos, at = (cu, cv, ca) => [p[0] + cu * fr.u[0] + cv * fr.v[0] + ca * fr.a[0], p[1] + cu * fr.u[1] + cv * fr.v[1] + ca * fr.a[1], p[2] + cu * fr.u[2] + cv * fr.v[2] + ca * fr.a[2]];
    if (src.kind === 'point') return { x: p.slice(), w: 1 };
    if (src.kind === 'planar') {
      if (src.shape === 'disc') { const r = src.radius * Math.sqrt(a), t = 2 * Math.PI * b; return { x: at(r * Math.cos(t), r * Math.sin(t), 0), w: 1 }; }
      return { x: at((a - 0.5) * src.w, (b - 0.5) * src.h, 0), w: 1 };
    }
    const d = V.norm(V.sub(P, p));
    if (src.shape === 'cylinder') {
      const t = 2 * Math.PI * a, h = (b - 0.5) * src.length, nr = V.add(V.mul(fr.u, Math.cos(t)), V.mul(fr.v, Math.sin(t)));
      if (src.emission === 'surface') return { x: V.add(at(0, 0, h), V.mul(nr, src.radius)), w: Math.max(0, V.dot(nr, d)) };
      return { x: V.add(at(0, 0, h), V.mul(nr, src.radius * Math.sqrt(c))), w: 1 };
    }
    const ct = 1 - 2 * a, st = Math.sqrt(Math.max(0, 1 - ct * ct)), t = 2 * Math.PI * b, r = src.radius * Math.cbrt(c), q = [r * st * Math.cos(t), r * st * Math.sin(t), r * ct];
    if (src.emission === 'surface') { const nn = V.norm(q); return { x: V.add(p, V.mul(nn, src.radius)), w: Math.max(0, V.dot(nn, d)) }; }
    return { x: V.add(p, q), w: 1 };
  }
  // sparse pattern (cd per pixel offset from the aim pixel) from the scratch accumulators (energy, ray weight) of nt touched pixels
  function finishPattern(sc, nt, R, shape, gs, omega, opt) {
    const w = 2 * R + 1;
    // ADAPTIVE SMOOTHING.  Pixels that few samples reached (the tails, which decide the dim rows) are replaced by the mean of a box
    // grown until it holds enough samples; the box only grows along the axes the shape spreads light over (its aperture term), so the
    // sharp vertical edge of a wide-and-short pattern stays sharp.
    let i0m = 1e9, i1m = -1e9, j0m = 1e9, j1m = -1e9;
    for (let t = 0; t < nt; t++) { const kk = sc.touched[t], j = Math.floor(kk / w), i = kk - j * w; if (i < i0m) i0m = i; if (i > i1m) i1m = i; if (j < j0m) j0m = j; if (j > j1m) j1m = j; }
    const keep = []; let kept = 0, sI = 0, sJ = 0, pk = 0;
    if (nt > 0) {
      const rxMax = Math.max(1, Math.min(12, Math.floor(0.4 * Math.hypot(shape[0], 0.3) / gs) + 1)), ryMax = Math.min(12, Math.floor(0.4 * shape[1] / gs));
      const pad = rxMax + 1, bw = i1m - i0m + 1 + 2 * pad, bh = j1m - j0m + 1 + 2 * pad, W1 = bw + 1;
      const IE = new Float64Array(W1 * (bh + 1)), IC = new Float64Array(W1 * (bh + 1)), E0 = new Float64Array(bw * bh), C0 = new Float64Array(bw * bh);
      for (let t = 0; t < nt; t++) { const kk = sc.touched[t], j = Math.floor(kk / w), i = kk - j * w, q = (j - j0m + pad) * bw + (i - i0m + pad); E0[q] = sc.acc[kk]; C0[q] = sc.cnt[kk]; sc.acc[kk] = 0; sc.cnt[kk] = 0; sc.mark[kk] = 0; }
      for (let y = 0; y < bh; y++) { let re = 0, rc = 0; for (let x = 0; x < bw; x++) { re += E0[y * bw + x]; rc += C0[y * bw + x]; IE[(y + 1) * W1 + x + 1] = IE[y * W1 + x + 1] + re; IC[(y + 1) * W1 + x + 1] = IC[y * W1 + x + 1] + rc; } }
      const bx = (I, x0, y0, x1, y1) => I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
      const need = opt.minCount || 24, own = opt.ownCount || 8, out = new Float64Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const q = y * bw + x; let v = E0[q];
        if (C0[q] < own && bx(IC, Math.max(0, x - rxMax), Math.max(0, y - ryMax), Math.min(bw - 1, x + rxMax), Math.min(bh - 1, y + ryMax)) > 0) {
          for (let r = 1; r <= rxMax; r++) {
            const rx = r, ry = ryMax === 0 ? 0 : Math.min(ryMax, Math.round(r * ryMax / rxMax));
            const x0 = Math.max(0, x - rx), x1 = Math.min(bw - 1, x + rx), y0 = Math.max(0, y - ry), y1 = Math.min(bh - 1, y + ry);
            const c = bx(IC, x0, y0, x1, y1);
            if (c >= need || r === rxMax) { v = c > 0 ? bx(IE, x0, y0, x1, y1) / ((x1 - x0 + 1) * (y1 - y0 + 1)) : 0; break; }
          }
        }
        out[q] = v; if (v > pk) pk = v;
      }
      const cut = pk * (opt.trunc === undefined ? 2e-4 : opt.trunc);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const v = out[y * bw + x]; if (v >= cut && v > 0) { const i = x + i0m - pad - R, j = y + j0m - pad - R; keep.push([i, j, v]); kept += v; sI += i * v; sJ += j * v; } }
    }
    const n = keep.length, di = new Int16Array(n), dj = new Int16Array(n), val = new Float32Array(n);
    for (let t = 0; t < n; t++) { di[t] = keep[t][0]; dj[t] = keep[t][1]; val[t] = keep[t][2] / omega; }
    return { di, dj, val, lm: kept, cen: kept > 0 ? [sI / kept * gs, sJ / kept * gs] : [0, 0], omega, n };
  }

  // Halton tables (one per dimension, shared): the per-unit shift is added at use
  const HT = [];
  function haltonTable(d, n) { let t = HT[d]; if (!t || t.length < n) { t = new Float64Array(n); for (let i = 0; i < n; i++) t[i] = halton(i + 1, [2, 3, 5, 7, 11, 13][d]); HT[d] = t; } return t; }
  const SMP = { n: 0 };
  function traceUnit(P, f, aimHV, shape, opt) {
    opt = opt || {};
    const fo = facetOf(P, f, aimHV, shape); if (!fo) return null;
    const G = P.G, gs = G.gs, conv = G.conv, src = P.src, fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src), refl = P.refl;
    const Lp = P.Lp, A = fo.q.A, bq = fo.q.b, FP = f.P, sh = P.shell;
    const R = opt.R || 220, sc = scratch(R), w = 2 * R + 1;
    const ai = opt.aimPixel ? opt.aimPixel[0] : G.iOf(aimHV[0]), aj = opt.aimPixel ? opt.aimPixel[1] : G.jOf(aimHV[1]);
    const href = G.hOf(ai), vref = G.vOf(aj), omega = G.omega[clamp(aj, 0, G.nv - 1) * G.nh + clamp(ai, 0, G.nh - 1)];
    const nS = opt.n || 24000, cellsN = f.cells.length, dOm = 4 * Math.PI / (sh.NA * sh.NP);
    // joint quasi-random sampling of (aperture cell, jitter in the cell, LED point): every sample carries the same share of the
    // unit's flux, so a collimating shape (aperture irrelevant, only the LED point matters) is as smooth as a defocused one
    const cum = new Float64Array(cellsN + 1); for (let i = 0; i < cellsN; i++) cum[i + 1] = cum[i] + f.cells[i].flux;
    const tot0 = cum[cellsN], r0 = rng(0x9E3779B1 ^ (f.idx * 7919)), sh0 = [r0(), r0(), r0(), r0(), r0(), r0()];
    const T0 = haltonTable(0, nS), T1 = haltonTable(1, nS), T2 = haltonTable(2, nS), T3 = haltonTable(3, nS), T4 = haltonTable(4, nS), T5 = haltonTable(5, nS);
    const wrap = (x) => x - Math.floor(x);
    // quadric along a ray from the LED centre: (x + t d)ᵀA(x + t d) + b·(x + t d) = 0, x = LED − facet centre
    const x0 = Lp[0] - FP[0], y0 = Lp[1] - FP[1], z0 = Lp[2] - FP[2];
    const Ax0 = A[0] * x0 + A[1] * y0 + A[2] * z0, Ax1 = A[3] * x0 + A[4] * y0 + A[5] * z0, Ax2 = A[6] * x0 + A[7] * y0 + A[8] * z0;
    const cq = x0 * Ax0 + y0 * Ax1 + z0 * Ax2 + bq[0] * x0 + bq[1] * y0 + bq[2] * z0;
    const B0 = sh.B[0], B1 = sh.B[1], B2 = sh.B[2], e10 = sh.e1[0], e11 = sh.e1[1], e12 = sh.e1[2], e20 = sh.e2[0], e21 = sh.e2[1], e22 = sh.e2[2];
    const planarRect = src.kind === 'planar' && src.shape !== 'disc', planarDisc = src.kind === 'planar' && src.shape === 'disc', lamb = src.dist === 'lambertian' && !(src.kind === 'volume' && src.emission === 'surface');
    const ax0 = fr.a[0], ax1 = fr.a[1], ax2 = fr.a[2], sp = src.pos, ufr = fr.u, vfr = fr.v;
    // pass 1: sample the aperture directions and the LED points
    if (SMP.n < nS) { for (const k of ['dx', 'dy', 'dz', 'sx', 'sy', 'sz', 'wt']) SMP[k] = new Float64Array(nS); SMP.n = nS; }
    const dxs = SMP.dx, dys = SMP.dy, dzs = SMP.dz, sxs = SMP.sx, sys = SMP.sy, szs = SMP.sz, wts = SMP.wt, tqs = SMP.tq || (SMP.tq = new Float64Array(nS));
    if (SMP.tq.length < nS) SMP.tq = new Float64Array(nS);
    const tq = SMP.tq; let wsum = 0;
    const cellI0 = f.cellI0 || (f.cellI0 = f.cells.map((c) => Math.max(1e-12, RF.Solver.intensityToward(src, fr, c.c.u))));
    for (let i = 0; i < nS; i++) {
      const uc = wrap(T0[i] + sh0[0]) * tot0;
      let lo = 0, hi = cellsN; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= uc) lo = m; else hi = m; }
      const c = f.cells[lo], x1 = wrap(T1[i] + sh0[1]), x2 = wrap(T2[i] + sh0[2]);
      const phi = (c.q + x1) / sh.NP * 2 * Math.PI, ca = 1 - 2 * (c.a + x2) / sh.NA, sa = Math.sqrt(Math.max(0, 1 - ca * ca)), cp = Math.cos(phi) * sa, sp2 = Math.sin(phi) * sa;
      const dx = B0 * ca + e10 * cp + e20 * sp2, dy = B1 * ca + e11 * cp + e21 * sp2, dz = B2 * ca + e12 * cp + e22 * sp2;
      dxs[i] = dx; dys[i] = dy; dzs[i] = dz;
      // intersection with the real quadric: the root nearest the facet's distance
      const a2 = dx * (A[0] * dx + A[1] * dy + A[2] * dz) + dy * (A[3] * dx + A[4] * dy + A[5] * dz) + dz * (A[6] * dx + A[7] * dy + A[8] * dz);
      const b1 = 2 * (Ax0 * dx + Ax1 * dy + Ax2 * dz) + bq[0] * dx + bq[1] * dy + bq[2] * dz;
      let t = -1;
      if (Math.abs(a2) < 1e-18) { if (b1 !== 0) { const r = -cq / b1; if (r > 0) t = r; } }
      else { const disc = b1 * b1 - 4 * a2 * cq; if (disc >= 0) { const q = -0.5 * (b1 + (b1 >= 0 ? Math.sqrt(disc) : -Math.sqrt(disc))), r1 = q / a2, r2 = q !== 0 ? cq / q : r1; const d1 = r1 > 0 ? Math.abs(r1 - f.r) : Infinity, d2 = r2 > 0 ? Math.abs(r2 - f.r) : Infinity; if (d1 < Infinity || d2 < Infinity) t = d1 <= d2 ? r1 : r2; } }
      tq[i] = t;
      // intensity here relative to the cell centre (the cell's flux is that of its centre)
      let wI = 1;
      if (lamb) { const cs = dx * ax0 + dy * ax1 + dz * ax2; wI = Math.max(0, cs) / cellI0[lo]; } else wI = RF.Solver.intensityToward(src, fr, [dx, dy, dz]) / cellI0[lo];
      // the LED point
      const a = wrap(T3[i] + sh0[3]), b = wrap(T4[i] + sh0[4]), cc = wrap(T5[i] + sh0[5]);
      let px, py, pz, wl = 1;
      if (planarRect) { const cu = (a - 0.5) * src.w, cv = (b - 0.5) * src.h; px = sp[0] + cu * ufr[0] + cv * vfr[0]; py = sp[1] + cu * ufr[1] + cv * vfr[1]; pz = sp[2] + cu * ufr[2] + cv * vfr[2]; }
      else if (planarDisc) { const r = src.radius * Math.sqrt(a), th = 2 * Math.PI * b, cu = r * Math.cos(th), cv = r * Math.sin(th); px = sp[0] + cu * ufr[0] + cv * vfr[0]; py = sp[1] + cu * ufr[1] + cv * vfr[1]; pz = sp[2] + cu * ufr[2] + cv * vfr[2]; }
      else { const L = ledAt(src, fr, FP, a, b, cc); px = L.x[0]; py = L.x[1]; pz = L.x[2]; wl = L.w; }
      sxs[i] = px; sys[i] = py; szs[i] = pz; wts[i] = wl * wI; wsum += wts[i];
    }
    // pass 2: reflect at the real normal, bin by direction
    let nt = 0, lost = 0, tot = 0;
    const eUnit = f.fluxRaw * refl, eS = eUnit / Math.max(1e-12, wsum);
    for (let i = 0; i < nS; i++) {
      const e = eS * wts[i], t = tq[i];
      if (t < 0) { lost += e; continue; }
      const du0 = dxs[i], du1 = dys[i], du2 = dzs[i], p0 = Lp[0] + du0 * t, p1 = Lp[1] + du1 * t, p2 = Lp[2] + du2 * t, xx = p0 - FP[0], yy = p1 - FP[1], zz = p2 - FP[2];
      const gx = 2 * (A[0] * xx + A[1] * yy + A[2] * zz) + bq[0], gy = 2 * (A[3] * xx + A[4] * yy + A[5] * zz) + bq[1], gz = 2 * (A[6] * xx + A[7] * yy + A[8] * zz) + bq[2];
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz), nx = gx / gl, ny = gy / gl, nz = gz / gl;
      let dx = p0 - sxs[i], dy = p1 - sys[i], dz = p2 - szs[i]; const dl = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= dl; dy /= dl; dz /= dl;
      const dn = 2 * (dx * nx + dy * ny + dz * nz), rx = dx - dn * nx, ry = dy - dn * ny, rz = dz - dn * nz;
      const a = rx, b = -ry, cc = rz; let H, Vv;
      if (conv === 'B') { H = Math.asin(clamp(b, -1, 1)) * R2D; Vv = Math.atan2(cc, a) * R2D; }
      else if (conv === 'S') { if (!(a > 0)) { lost += e; continue; } H = Math.atan(b / a) * R2D; Vv = Math.atan(cc / a) * R2D; }
      else { H = Math.atan2(b, a) * R2D; Vv = Math.asin(clamp(cc, -1, 1)) * R2D; }
      const gxp = (H - href) / gs, gyp = (Vv - vref) / gs, i0 = Math.floor(gxp), j0 = Math.floor(gyp), fx = gxp - i0, fy = gyp - j0;
      tot += e;
      if (i0 < -R || j0 < -R || i0 >= R || j0 >= R) { lost += e; continue; }
      const base = (j0 + R) * w + (i0 + R);
      const w0 = (1 - fx) * (1 - fy), w1 = fx * (1 - fy), w2 = (1 - fx) * fy, w3 = fx * fy;
      let kk = base; if (!sc.mark[kk]) { sc.mark[kk] = 1; sc.touched[nt++] = kk; } sc.acc[kk] += e * w0; sc.cnt[kk] += w0;
      kk = base + 1; if (!sc.mark[kk]) { sc.mark[kk] = 1; sc.touched[nt++] = kk; } sc.acc[kk] += e * w1; sc.cnt[kk] += w1;
      kk = base + w; if (!sc.mark[kk]) { sc.mark[kk] = 1; sc.touched[nt++] = kk; } sc.acc[kk] += e * w2; sc.cnt[kk] += w2;
      kk = base + w + 1; if (!sc.mark[kk]) { sc.mark[kk] = 1; sc.touched[nt++] = kk; } sc.acc[kk] += e * w3; sc.cnt[kk] += w3;
    }
    const fp = finishPattern(sc, nt, R, shape, gs, omega, opt);
    return Object.assign(fp, { lost, tot, fo });
  }

  // The built facet for unit f aimed at (ah, av) with shape (βh, βv); `k` pulls it toward the LED along its own direction (≤ 1).
  // The outline goes on the REAL surface: each hull vertex's direction from the LED is intersected with the facet's quadric.
  function emitFacet(P, f, aimHV, shape, k) {
    k = k || 1;
    const g = k === 1 ? f : Object.assign({}, f, { P: V.add(P.Lp, V.mul(f.u, f.r * k)), r: f.r * k, hd: f.hd });
    const fo = facetOf(P, g, aimHV, shape); if (!fo) return null;
    const hull = outline(P, g, fo.q.n); if (!hull) return null;
    const pts = [];
    for (const h of hull) {
      const d = V.norm(V.sub(h, P.Lp)), roots = RF.Geo.quadricRay(fo.q.A, fo.q.b, g.P, P.Lp, d).filter((t) => t > 0);
      if (!roots.length) return null;
      const t = roots.reduce((m, x) => (Math.abs(x - V.dist(h, P.Lp)) < Math.abs(m - V.dist(h, P.Lp)) ? x : m), roots[0]);
      pts.push(V.add(P.Lp, V.mul(d, t)));
    }
    return { type: 'facet', id: 'S' + f.idx, P: g.P, S0: P.Lp.slice(), Z: fo.Z, flat: false, vg: fo.W, ax: AXH.slice(), di: fo.W[0] + fo.W[1] > 0 ? 2 / (fo.W[0] + fo.W[1]) : 1e9,
      clip: { kind: 'poly', pts3: pts }, optics: { interaction: 'reflect', reflectivity: P.refl } };
  }


  // ---------------------------------------------------------------- 3. the spec as bands on the far-field grid
  // lo / hi (cd) per pixel, tightened by the safety margin; wc = weight of the hard band at the pixel.  Rows that depend on
  // another reading (Zone I < 2 × 50R, HV ≥ 0.8 Imax) are kept in `rel` and refreshed from the model field as it moves.
  function buildBands(P, S) {
    const G = P.G, n = G.n, items = P.spec.items, k = P.spec.kernel > 0 ? P.spec.kernel : 0.15;
    const lo = new Float32Array(n), hi = new Float32Array(n).fill(1e30), wc = new Float32Array(n), flo = new Float32Array(n);   // flo: the plain minimum (no margin)
    const rows = [], rel = [], edge = { cols: [], line: P.spec.aim && P.spec.aim.line !== undefined ? P.spec.aim.line : -0.57, mode: (P.spec.aim && P.spec.aim.mode) || 'design' };
    const pxIn = (poly) => {
      let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [h, v] of poly) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const out = [];
      for (let j = Math.max(0, G.jOf(v0)); j <= Math.min(G.nv - 1, G.jOf(v1)); j++) for (let i = Math.max(0, G.iOf(h0)); i <= Math.min(G.nh - 1, G.iOf(h1)); i++) if (RF.Spec.inPoly(poly, G.hOf(i), G.vOf(j))) out.push(j * G.nh + i);
      return out;
    };
    const pxAt = (h, v) => {
      const out = [], r = Math.max(k, G.gs / 2) - 1e-9, i0 = G.iOf(h - r), i1 = G.iOf(h + r), j0 = G.jOf(v - r), j1 = G.jOf(v + r);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (G.inside(i, j)) out.push(j * G.nh + i);
      if (!out.length) { const i = G.iOf(h), j = G.jOf(v); if (G.inside(i, j)) out.push(j * G.nh + i); }
      return out;
    };
    // MARGIN on a bound, from the measurement noise it will be judged with.  A reading over the photocell's box holds n = v Ω_k N_eff / P rays
    // (N_eff = the rays the judge will use, more where it guides them to dim places), so σ/v = 1/√n.  A minimum passes when v − zσ ≥ bound,
    // a maximum when v + zσ ≤ bound; z = 2, and 2 + √(2 ln n_ind) for a zone's extreme (the judge's own rule).  Solve for v by iteration.
    // `safety` multiplies on top; rows of weight below softBelow get a light margin.
    const omK = 4 * k * k * D2R * D2R, Pw = P.src.power;
    const nEff = (v) => S.designRays * (1 + S.guideGain * clamp((4000 - v) / 4000, 0, 1));
    const sigRel = (v) => Math.min(0.9, Math.sqrt(Pw / (nEff(v) * Math.max(v, 1) * omK)));
    const mFor = (it, bound, nInd) => {
      if (!(bound > 0)) return 1;
      const z = 2 + (nInd > 1 ? Math.sqrt(2 * Math.log(nInd)) : 0), isMin = bound === it.min && it.min > 0 && !(bound === it.max);
      let v = bound; for (let q = 0; q < 12; q++) { const sg = z * sigRel(v); v = isMin ? bound / Math.max(0.3, 1 - sg) : bound / (1 + sg); }
      const m = (isMin ? v / bound : bound / v) * S.margin;
      return (it.w > 0 ? it.w : 1) < S.softBelow ? 1 + (m - 1) * 0.35 : Math.min(m, S.maxMargin);
    };
    const apply = (px, it, mn, mx) => {
      const w = (it.w > 0 ? it.w : 1) * (S.softBelow > (it.w > 0 ? it.w : 1) ? S.softWeight : 1), wp = w * Math.pow(Math.max(1, px.length), -0.75);
      const nInd = it.kind === 'zone' ? Math.max(1, px.length * Math.min(1, (G.gs / (2 * k)) ** 2)) : 1;
      const mLo = mn > 0 ? mFor(Object.assign({}, it, { min: mn, max: 0 }), mn, nInd) : 1, mHi = mx > 0 ? mFor(Object.assign({}, it, { min: 0, max: mx }), mx, nInd) : 1;
      for (const p of px) {
        if (mn > 0) { lo[p] = Math.max(lo[p], mn * mLo); flo[p] = Math.max(flo[p], mn); }
        if (mx > 0) hi[p] = Math.min(hi[p], mx / mHi);
        if (mn > 0 || mx > 0) wc[p] = Math.max(wc[p], wp);
      }
      rows.push({ name: it.name, kind: it.kind, px, min: mn, max: mx, w, mLo, mHi });
    };
    let linMax = 0, linRef = null, gradH = null, Gmin = 0, Gmax = Infinity, v0g = -1.5, v1g = 0.5, hsAll = [];
    for (const it of items) {
      if (it.kind === 'point') { const px = pxAt(it.h, it.v); apply(px, it, it.min || 0, it.max || 0); if (it.minRel || it.maxRel) rel.push({ it, px, minRel: it.minRel, maxRel: it.maxRel }); }
      else if (it.kind === 'zone') { const px = pxIn(it.poly); apply(px, it, it.min || 0, it.max || 0); if (it.minRel || it.maxRel) rel.push({ it, px, minRel: it.minRel, maxRel: it.maxRel }); }
      else if (it.kind === 'sum') { const per = it.min > 0 ? it.min / it.pts.length : 0; for (const [h, v] of it.pts) apply(pxAt(h, v), Object.assign({}, it, { name: it.name }), per, 0); }
      else if (it.kind === 'imax') {
        if (it.max > 0) for (let p = 0; p < n; p++) { hi[p] = Math.min(hi[p], it.max / mFor(Object.assign({}, it, { min: 0 }), it.max, 1)); wc[p] = Math.max(wc[p], 0.02); }
        if (it.min > 0) { const hv = items.find((x) => x.kind === 'point' && x.h === 0 && x.v === 0) || { h: 0, v: 0 }; apply(pxAt(hv.h, hv.v), it, it.min, 0); }
        if (it.minRel || it.maxRel) rel.push({ it, px: [], minRel: it.minRel, maxRel: it.maxRel });
      } else if (it.kind === 'gradient') { gradH = it.h; Gmin = it.min || 0; Gmax = it.max > 0 ? it.max : Infinity; v0g = it.v0; v1g = it.v1; hsAll.push(it.h); }
      else if (it.kind === 'linearity') { linMax = it.max > 0 ? it.max : 0.2; linRef = it.ref || null; v0g = Math.min(v0g, it.v0); v1g = Math.max(v1g, it.v1); for (const h of it.hs) hsAll.push(h); }
    }
    // implicit glare ceiling: a beam with a cut-off shouldn't throw light above it just because no row forbids that spot (the
    // regulation boxes in zone III and a few points; a design that parks hot images right outside them passes and dazzles).
    // Cap = the median of the spec's own ceilings above the horizon (R112: 625 cd), on every pixel > 0.9° above the cut-off that
    // no row bounds yet.  The own side's cut-off rises (ECE 15°, US ≈ a 1° step).
    if (S.glare !== 0 && (edge.mode === 'cutoff' || items.some((x) => x.kind === 'gradient'))) {
      const ups = []; for (const it of items) if (it.max > 0 && (it.kind === 'zone' || it.kind === 'point')) { const pts = it.poly || [[it.h, it.v]]; const cv = pts.reduce((a, q) => a + q[1], 0) / pts.length; if (cv > 0.2) ups.push(it.max); }
      ups.sort((a, b) => a - b);
      const cap = S.glare > 0 ? S.glare : ups.length ? ups[Math.floor(ups.length / 2)] : 625, own = P.spec.traffic === 'LHT' ? -1 : 1, us = /^fmvss/.test(P.spec.preset || '');
      let nCap = 0; const idx = [];
      for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
        const p = j * G.nh + i; if (hi[p] < 1e29) continue;
        const h = own * G.hOf(i), cut = h <= 0 ? edge.line : us ? Math.min(edge.line + 1.4 * h, 1.0) : Math.min(edge.line + h * 0.2679, 1.0);
        if (G.vOf(j) > cut + 0.9) idx.push(p);
      }
      const wp = S.glareWeight * Math.pow(Math.max(1, idx.length), -0.75);
      for (const p of idx) { hi[p] = cap / S.margin; wc[p] = Math.max(wc[p], wp); nCap++; }
      edge.glare = { cap, n: nCap };
    }
    // dynamic bounds that depend on a measured value (Zone I < 2 × 50R, HV ≥ 0.8 Imax): px of the target item, refPx of the reference
    for (const r of rel) {
      const spec = r.minRel || r.maxRel;
      if (spec.ref === 'Imax') r.refPx = null;
      else { const ref = items.find((x) => x.name === spec.ref && x.kind === 'point'); r.refPx = ref ? pxAt(ref.h, ref.v) : []; r.refMin = ref && ref.min > 0 ? ref.min : 0; }
      r.px = r.it.kind === 'imax' ? [] : r.px;
      if (spec.ref === 'Imax' && r.it.name === 'HV') r.px = r.px;                 // the HV pixels get lo = 0.8 × the model's peak
    }
    // edge columns: the scan columns the judge reads (gradient h, linearity hs) and a few between, so the cut-off is one straight line
    if (hsAll.length) {
      const hlo = Math.min(...hsAll) - S.edgePad, hhi = Math.max(...hsAll) + S.edgePad, hs = new Set();
      for (const h of hsAll) hs.add(+h.toFixed(3));
      for (let h = Math.ceil(hlo / 0.5) * 0.5; h <= hhi + 1e-9; h += 0.5) if (!hsAll.some((x) => Math.abs(x - h) < 0.2)) hs.add(+h.toFixed(3));
      const jLo = Math.max(0, G.jOf(v0g)), jHi = Math.min(G.nv - 1, G.jOf(v1g));
      for (const h of [...hs].sort((a, b) => a - b)) {
        const ic = G.iOf(h); if (ic - 2 < 0 || ic + 2 >= G.nh) continue;
        const above = []; for (let j = Math.max(jLo, G.jOf(edge.line + S.skirtFrom)); j <= jHi; j++) for (let di = -2; di <= 2; di++) above.push(j * G.nh + ic + di);
        edge.cols.push({ h, ic, jLo, jHi, jW0: Math.max(0, G.jOf(edge.line - (P.spec.aim && P.spec.aim.scan > 0 ? P.spec.aim.scan : 3))), above, isGrad: gradH !== null && Math.abs(h - gradH) < 1e-6, isLin: hsAll.some((x) => Math.abs(x - h) < 1e-6) });
      }
    }
    // ROBUST AIM.  The judge's cut-off steps are read from a box of kh × kv; a reading holds n = F Ω N_eff / P rays.  Steps count only where a reading
    // is ≥ 2 % of the scan's brightest, so a dim gate (few rays per reading) lets noise steps compete with the real knee and move the whole lamp.
    // Ask for the gate to hold ≥ 1/σg² rays (σg = relative noise at the gate) and the knee to sit a few times above it.
    { const stepJ = P.spec.step || 0.1, kv = Math.max(stepJ / 2, 0.035) * 0.99, omG = (2 * 0.25 * D2R) * (2 * kv * D2R), Pw2 = P.src.power, n0 = 1 / (S.gateSigma * S.gateSigma);
      let F = 500; for (let q = 0; q < 12; q++) F = n0 * Pw2 / (S.designRays * (1 + S.guideGain * clamp((4000 - F) / 4000, 0, 1)) * omG);
      edge.gateMin = F; edge.topMin = F / 0.02; edge.kneeMin = S.kneeGate * F; }
    Object.assign(edge, { Gmin, Gmax, linMax, linRef, gradH });
    return { lo, hi, wc, flo, rows, rel, edge };
  }

  // ---------------------------------------------------------------- the model field and its cost
  function makeModel(P, S, B, units) {
    const G = P.G, nh = G.nh, nv = G.nv, n = G.n, lo = B.lo, hi = B.hi, wc = B.wc, edge = B.edge;
    const F = new Float64Array(n), F0 = new Float64Array(n), cp = new Float64Array(n);       // F0: light that does not meet a mirror; cp: cost of each pixel as it stands
    const tg = new Float32Array(n), ws = new Float32Array(n);
    const boost = new Float32Array(n).fill(1);
    let eps = 1, edgeCost = 0, edgeInfo = null, scaleSec = 1;
    const tol = S.tol;
    const st = units.map(() => ({ on: false, ai: 0, aj: 0, sh: 0, K: null }));
    let offW = null, offTotal = 0;                                         // a unit left out costs offCost × its share of the light: light has value
    function setOffWeights(w) { offW = w; offTotal = 0; for (let u = 0; u < units.length; u++) if (!st[u].on) offTotal += offW[u]; }
    function setOn(u, on) { if (st[u].on === on) return; st[u].on = on; if (offW) offTotal += on ? -offW[u] : offW[u]; }
    function pc(p, f) {
      let c = 0;
      const l = lo[p];
      if (l > 0 && f < l) { const d = (l - f) / l; c = wc[p] * boost[p] * d * d; }
      else { const h = hi[p]; if (f > h) { const d = (f - h) / h; c = wc[p] * boost[p] * d * d; } }
      const w = ws[p];
      if (w > 0) { const e = Math.abs(Math.log((f + eps) / (tg[p] * scaleSec + eps))) - tol; if (e > 0) c += w * e * e; }
      return c;
    }
    const live = (p) => wc[p] > 0 || ws[p] > 0, SCREEN_N = S.screenN || 1200;
    function refreshCp() { let c = 0; for (let p = 0; p < n; p++) { cp[p] = live(p) ? pc(p, F[p]) : 0; c += cp[p]; } return c; }
    // ---- edge terms: the judge's cut-off scan on the model field.  Two scans per column, as the judge does them: the AIM scan (±aimScan about the
    // line, brightest of that range sets the 2 % gate: finds the knee the whole lamp is moved by) and the ROW scan (v0…v1 of the gradient /
    // linearity rows: its own, usually lower, brightest sets its gate: G and the inflection heights for linearity).
    const cols = edge.cols, ec = cols.map((c) => ({ Fc: new Float64Array(c.jHi - c.jW0 + 1), Gv: new Float64Array(Math.max(1, c.jHi - c.jW0)), knee: NaN, kneeAim: NaN, Gm: 0, top: 0, topW: 0 }));
    function scanKnee(Fc, Gv, r0, r1, gateTop, gs0, vOfRow) {            // steepest gated step over rows r0…r1: { gm, kr, knee }
      let gm = -1, kr = -1; const floor = 0.02 * gateTop;
      for (let r = r0; r < r1; r++) {
        const a = Fc[r], b = Fc[r + 1];
        if (!(a > 0 && b > 0) || a < floor) { Gv[r] = -1; continue; }
        const g = Math.log10(a / b); Gv[r] = g;
        if (g > gm) { gm = g; kr = r; }
      }
      let knee = NaN;
      if (kr >= 0) {
        let d = 0;
        if (kr > r0 && kr + 1 < r1 && Gv[kr - 1] >= 0 && Gv[kr + 1] >= 0) { const g0 = Gv[kr - 1], g1 = Gv[kr], g2 = Gv[kr + 1], den = g0 - 2 * g1 + g2; if (den < -1e-9) d = clamp(0.5 * (g0 - g2) / den, -0.5, 0.5); }
        knee = vOfRow(kr) + 0.5 * gs0 + d * gs0;
      }
      return { gm, kr, knee };
    }
    const TERMS = { top: 0, G: 0, knee: 0, plateau: 0, tail: 0, aim: 0, lin: 0, straight: 0, none: 0 };
    function edgeEval() {
      let cost = 0; const info = []; for (const k in TERMS) TERMS[k] = 0;
      for (let q = 0; q < cols.length; q++) {
        const c = cols[q], e = ec[q], mW = c.jHi - c.jW0 + 1, r0 = c.jLo - c.jW0;
        let topW = 0, top = 0;
        for (let r = 0; r < mW; r++) { const o = (c.jW0 + r) * nh + c.ic; const f = (F[o - 2] + F[o - 1] + F[o] + F[o + 1] + F[o + 2]) * 0.2; e.Fc[r] = f; if (f > topW) topW = f; if (r >= r0 && f > top) top = f; }
        const vRow = (r) => G.vOf(c.jW0 + r);
        // the row scan
        const sr = scanKnee(e.Fc, e.Gv, r0, mW - 1, top, G.gs, vRow), gm = sr.gm, kr = sr.kr, knee = sr.knee;
        e.knee = knee; e.Gm = gm; e.top = top; e.topW = topW;
        info.push({ h: c.h, G: gm, knee, fk: kr >= 0 && topW > 0 ? e.Fc[kr] / topW : 0, top, topW });
        const wcol = c.isGrad ? 1 : 0.5, c0cost = cost;
        e.kneeRow = kr >= 0 ? c.jW0 + kr : -1; e.cost = 0;
        if (!(gm >= 0) || !(knee === knee)) { cost += 4 * wcol; e.cost = 4 * wcol; TERMS.none += 4 * wcol; continue; }
        if (edge.Gmax < Infinity) { const x = Math.max(0, gm - edge.Gmax * S.gHi) / 0.1; cost += wcol * x * x; TERMS.G += wcol * x * x; }
        if (edge.Gmin > 0) { const x = Math.max(0, edge.Gmin * S.gLo - gm) / 0.1; cost += wcol * x * x; TERMS.G += wcol * x * x; }
        // the steepest step must sit high on the edge, not out in the dim tail (a reading there holds a few dozen rays: G and the knee are
        // shot noise), and the column must have reached most of its brightness inside the scan window (else the gate drops under the skirt)
        { const fkAbs = e.Fc[kr], kneeNeed = Math.max(S.kneeFrac * topW, edge.kneeMin || 0), x = Math.max(0, kneeNeed - fkAbs) / Math.max(1e-9, 0.05 * topW); cost += wcol * x * x; TERMS.knee += wcol * x * x;
          if (c.isGrad || c.isLin) { const tp = Math.max(0, 1 - topW / Math.max(1, edge.topMin || 1)) / 0.2; cost += 0.5 * wcol * tp * tp; TERMS.top += 0.5 * wcol * tp * tp; }
          const y = Math.max(0, S.plateau - top / Math.max(1e-9, topW)) / 0.1; cost += 0.7 * wcol * y * y; TERMS.plateau += 0.7 * wcol * y * y;
          for (let r = kr + 1; r + 1 < mW; r++) { const g = e.Gv[r]; if (g > 0) { const z = Math.max(0, g - S.tailG * gm) / 0.1; cost += 0.3 * wcol * z * z; TERMS.tail += 0.3 * wcol * z * z; } } }
        // the aim scan: where the judge will find the knee (its brightest, over the wider range, sets the gate)
        if (c.isGrad && edge.mode === 'cutoff') {
          const sa = scanKnee(e.Fc, e.Gv, 0, mW - 1, topW, G.gs, vRow); e.kneeAim = sa.knee;
          if (sa.knee === sa.knee) { const x = (sa.knee - edge.line - S.kneeBias) / 0.05; cost += 1.5 * x * x; TERMS.aim += 1.5 * x * x; } else { cost += 4; TERMS.aim += 4; }
          // (scanKnee overwrote Gv with the aim scan's values: restore the row scan's for the tail test above on the next column — they are per column, so nothing to do)
          info[info.length - 1].kneeAim = sa.knee;
        }
        e.cost = cost - c0cost;
      }
      if (edge.linMax > 0) {
        const lin = []; for (let q = 0; q < cols.length; q++) if (cols[q].isLin && ec[q].knee === ec[q].knee) lin.push(ec[q].knee);
        const all = []; for (let q = 0; q < cols.length; q++) if (ec[q].knee === ec[q].knee) all.push(ec[q].knee);
        if (lin.length >= 2) {
          const mid = lin[Math.floor(lin.length / 2)];
          const spread = edge.linRef === 'centre' ? Math.max(...lin.map((x) => Math.abs(x - mid))) : Math.max(...lin) - Math.min(...lin);
          const x = Math.max(0, spread - 0.4 * edge.linMax) / 0.1; cost += 2 * x * x; TERMS.lin += 2 * x * x;
        }
        if (all.length >= 3) { const mean = all.reduce((a, b) => a + b, 0) / all.length; let v = 0; for (const x of all) v += (x - mean) ** 2; cost += 0.5 * (v / all.length) / 0.01; TERMS.straight += 0.5 * (v / all.length) / 0.01; }
      }
      edgeInfo = info; return cost * S.edgeWeight;
    }
    function recomputeAll() {
      F.set(F0);
      for (let u = 0; u < units.length; u++) { const s = st[u]; if (!s.on || !s.K) continue; const K = s.K; for (let t = 0; t < K.n; t++) { const i = s.ai + K.di[t], j = s.aj + K.dj[t]; if (i >= 0 && i < nh && j >= 0 && j < nv) F[j * nh + i] += K.val[t]; } }
      refreshCp(); edgeCost = edgeEval();
    }
    // read-only: the change in pixel cost if pattern K were added at (ai, aj)
    // (a wide pattern is screened on every s-th entry, the change scaled by s: the few best candidates are then re-evaluated exactly)
    function deltaAdd(K, ai, aj) {
      let d = 0, di = K.di, dj = K.dj, val = K.val, m = K.n, sc = 1;
      if (m > SCREEN_N) {
        if (!K.scr) { const st = Math.ceil(m / SCREEN_N), n2 = Math.ceil(m / st); K.scr = { di: new Int16Array(n2), dj: new Int16Array(n2), val: new Float32Array(n2), n: n2, st }; for (let t = 0, q = 0; t < m; t += st, q++) { K.scr.di[q] = K.di[t]; K.scr.dj[q] = K.dj[t]; K.scr.val[q] = K.val[t]; } }
        di = K.scr.di; dj = K.scr.dj; val = K.scr.val; m = K.scr.n; sc = K.scr.st;
      }
      for (let t = 0; t < m; t++) {
        const i = ai + di[t], j = aj + dj[t]; if (i < 0 || i >= nh || j < 0 || j >= nv) continue;
        const p = j * nh + i; if (!(wc[p] > 0 || ws[p] > 0)) continue;
        d += pc(p, F[p] + val[t]) - cp[p];
      }
      return d * sc;
    }
    // a move = remove one pattern, add another; F is changed in place, the touched pixels remembered so it can be undone
    const stamp = new Int32Array(n), tl = new Int32Array(n), oldF = new Float64Array(n); let gen = 0, nT = 0;
    function begin() { gen++; nT = 0; }
    function touch(p) { if (stamp[p] !== gen) { stamp[p] = gen; tl[nT] = p; oldF[nT] = F[p]; nT++; } }
    function addMut(K, ai, aj, sgn) {
      const di = K.di, dj = K.dj, val = K.val, m = K.n;
      for (let t = 0; t < m; t++) { const i = ai + di[t], j = aj + dj[t]; if (i < 0 || i >= nh || j < 0 || j >= nv) continue; const p = j * nh + i; touch(p); const f = F[p] + sgn * val[t]; F[p] = f < 0 ? 0 : f; }
    }
    function moveDelta() { let d = 0; for (let t = 0; t < nT; t++) { const p = tl[t]; if (wc[p] > 0 || ws[p] > 0) d += pc(p, F[p]) - cp[p]; } return d; }
    function commit() { for (let t = 0; t < nT; t++) { const p = tl[t]; cp[p] = wc[p] > 0 || ws[p] > 0 ? pc(p, F[p]) : 0; } }
    function revert() { for (let t = 0; t < nT; t++) F[tl[t]] = oldF[t]; }
    function pixelCostAll() { let c = 0; for (let p = 0; p < n; p++) c += cp[p]; return c; }
    function total() { return pixelCostAll() + edgeCost + offTotal; }
    return { F, F0, tg, ws, lo, hi, wc, boost, st, setOn, setOffWeights, get offTotal() { return offTotal; }, offW: (u) => (offW ? offW[u] : 0), pc, deltaAdd, begin, addMut, moveDelta, commit, revert, recomputeAll, refreshCp, total, pixelCostAll, edgeEval, ec, cp,
      get edgeCost() { return edgeCost; }, set edgeCost(v) { edgeCost = v; }, get edgeInfo() { return edgeInfo; }, get terms() { return Object.assign({}, TERMS, { _w: S.edgeWeight }); }, setEps(e) { eps = e; }, setScale(sc) { scaleSec = sc; }, get scale() { return scaleSec; } };
  }

  // ---------------------------------------------------------------- 4. light that never meets a mirror, and the secondary goal
  // F0: the LED's own emission through directions no unit owns (it leaves as built), in cd on the pixel grid.
  function directField(P, shell, units) {
    const G = P.G, src = P.src, fr = RF.Source.frame(src), Itot = RF.Source.totalIntegral(src), F0 = new Float64Array(G.n);
    const { B, e1, e2, NA, NP } = shell, owned = new Uint8Array(NA * NP);
    for (const f of units) if (!f.dead) for (const c of f.cells) owned[c.q * NA + c.a] = 1;
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const d = dirHV(G.hOf(i), G.vOf(j), G.conv), ca = V.dot(d, B);
      let phi = Math.atan2(V.dot(d, e2), V.dot(d, e1)); if (phi < 0) phi += 2 * Math.PI;
      const a = Math.min(NA - 1, Math.floor((1 - ca) / 2 * NA)), q = Math.min(NP - 1, Math.floor(phi / (2 * Math.PI) * NP));
      if (owned[q * NA + a]) continue;
      F0[j * G.nh + i] = src.power * RF.Solver.intensityToward(src, fr, d) / Itot;
    }
    return F0;
  }
  // The painting (Spec mode hands solvers the working paint: floors at minimums, holes at maximums, the user's painting in
  // between, as relative illuminance on the 25 m plane).  Back to intensity by direction: I ∝ E · L² / cos θ.  The absolute
  // level is whatever the pinned floor pixels say (I* ≥ floor, with equality where the painting asks for less); otherwise 1.
  function secondaryTarget(P, S, bands) {
    const G = P.G, input = P.input, pc = input.paint && input.paint.cells, tg = new Float32Array(G.n), ws = new Float32Array(G.n);
    if (!pc || !pc.length || !(S.paintWeight > 0)) return { tg, ws, n: 0 };
    const T = RF.Engine.designFrame(input.target), res = input.paint.res || T.res, Lp = P.Lp;
    let mx = 0;
    for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) {
      const d = dirHV(G.hOf(i), G.vOf(j), G.conv), den = V.dot(d, T.n); if (!(Math.abs(den) > 1e-9)) continue;
      const t = V.dot(V.sub(T.C, Lp), T.n) / den; if (!(t > 0)) continue;
      const X = V.add(Lp, V.mul(d, t)), uv = RF.Engine.worldToTargetUV(T, X);
      const iu = Math.floor((uv[0] + T.half) / (2 * T.half) * res), iv = Math.floor((uv[1] + T.half) / (2 * T.half) * res);
      if (iu < 0 || iv < 0 || iu >= res || iv >= res) continue;
      const E = pc[iv * res + iu]; if (!(E > 0)) continue;
      const L = V.dist(X, Lp), x = E * L * L / Math.abs(den); tg[j * G.nh + i] = x; if (x > mx) mx = x;
    }
    if (!(mx > 0)) return { tg, ws, n: 0 };
    let c = 0;                                                       // absolute scale from pinned floors
    for (let p = 0; p < G.n; p++) if (tg[p] > 0 && bands.flo[p] > 0) c = Math.max(c, bands.flo[p] / tg[p]);
    if (!(c > 0)) c = 1;
    let n = 0, wsum = 0;
    for (let p = 0; p < G.n; p++) { if (tg[p] < 0.03 * mx) { tg[p] = 0; continue; } tg[p] *= c; n++; }
    const tmax = mx * c;
    for (let p = 0; p < G.n; p++) if (tg[p] > 0) { ws[p] = 0.25 + 0.75 * Math.sqrt(tg[p] / tmax); wsum += ws[p]; }
    for (let p = 0; p < G.n; p++) if (ws[p] > 0) ws[p] *= S.paintWeight / wsum;
    return { tg, ws, n, tmax };
  }



  // ---------------------------------------------------------------- 5. the judge, on the model field (noise-free)
  function modelGrid(P, F, step) {
    const G = P.G, gs = G.gs, nh = Math.max(1, Math.round((G.nh * gs) / step)), nv = Math.max(1, Math.round((G.nv * gs) / step));
    const E = new Float64Array(nh * nv), Om = new Float64Array(nh * nv);
    const at = (h, v) => {                                           // bilinear in cd between pixel centres
      const x = (h - G.h0) / gs - 0.5, y = (v - G.v0) / gs - 0.5, i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0;
      const g = (i, j) => (i < 0 || j < 0 || i >= G.nh || j >= G.nv ? 0 : F[j * G.nh + i]);
      return (1 - fx) * (1 - fy) * g(i0, j0) + fx * (1 - fy) * g(i0 + 1, j0) + (1 - fx) * fy * g(i0, j0 + 1) + fx * fy * g(i0 + 1, j0 + 1);
    };
    let lm = 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) {
      const h0 = G.h0 + i * step, v0 = G.v0 + j * step, om = RF.FarField.binOmega(h0, h0 + step, v0, v0 + step, G.conv);
      Om[j * nh + i] = om; E[j * nh + i] = (step === gs ? F[j * G.nh + i] : at(h0 + step / 2, v0 + step / 2)) * om; lm += E[j * nh + i];
    }
    const sat = (a) => { const W = nh + 1, S2 = new Float64Array(W * (nv + 1)); for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += a[j * nh + i]; S2[(j + 1) * W + i + 1] = S2[j * W + i + 1] + row; } } return S2; };
    const E2 = new Float64Array(nh * nv);
    return { E, E2, Om, nh, nv, h0: G.h0, v0: G.v0, step, h1: G.h0 + nh * step, v1: G.v0 + nv * step, conv: G.conv, distance: P.spec.measure && isFinite(P.spec.measure.distance) ? P.spec.measure.distance : Infinity, centre: P.Lp.slice(),
      lmWindow: lm, lmExit: lm, rays: 1e9, coverage: 1, N: 1e9, streamed: true, eRay: 0, sat: { E: sat(E), E2: sat(E2), Om: sat(Om) } };
  }
  function judgeModel(P, F) {
    if (!P.spec.items.length) return null;
    const a = P.spec.aim || {}, box = a.box ? Object.assign({}, a.box) : null;
    const md = { items: P.spec.items, traffic: 'RHT', conv: P.conv, kernel: P.spec.kernel, step: P.spec.step || 0.1, aimMode: a.mode || 'design', aimLine: a.line, aimScan: a.scan, aimBox: box && P.spec.traffic === 'LHT' ? { left: box.right, right: box.left, up: box.up, down: box.down } : box, itemReaim: a.itemReaim || 0, aimTol: 0 };
    return RF.Spec.evaluate(modelGrid(P, F, Math.max(0.05, md.step)), md);
  }

  // ---------------------------------------------------------------- 6. the fit: greedy placement, then annealing
  const SHAPES_H = [0, 0.4, 1, 2, 3.5, 6, 10], SHAPES_V = [0, 0.12, 0.3, 0.7, 1.5, 3.5];
  function fit(P, S, B, sec, units, notes, tools) {
    const prog = (f, stage) => { if (tools && tools.progress) tools.progress(f, stage); };
    const G = P.G, nh = G.nh, nv = G.nv, gs = G.gs, rand = rng(S.seed * 7919 + 17);
    const live = units.filter((u) => !u.dead), N = live.length;
    const NSH = SHAPES_H.length * SHAPES_V.length, shapeOf = (k) => [SHAPES_H[Math.floor(k / SHAPES_V.length)], SHAPES_V[k % SHAPES_V.length]];
    const shIdx = (lh, lv) => lh * SHAPES_V.length + lv;
    // pattern cache (reference aim = the beam axis pixel; patterns are then moved by translation)
    const ai0 = clamp(G.iOf(P.B.h), 0, nh - 1), aj0 = clamp(G.jOf(P.B.v), 0, nv - 1), cache = new Map();
    let traced = 0;
    const kernelOf = (u, sh) => {
      const key = u * 64 + sh; let K = cache.get(key);
      if (K === undefined) { K = traceUnit(P, live[u], [G.hOf(ai0), G.vOf(aj0)], shapeOf(sh), { n: S.kn, aimPixel: [ai0, aj0] }); cache.set(key, K || null); traced++; }
      return K;
    };
    const model = makeModel(P, S, B, live);
    model.F0.set(directField(P, P.shell, units)); model.tg.set(sec.tg); model.ws.set(sec.ws);
    model.setEps(Math.max(5, 0.01 * (sec.tmax || 1000)));
    const st = model.st;
    { const fl = live.map((f) => f.flux), mean = fl.reduce((a, b) => a + b, 0) / Math.max(1, fl.length); model.setOffWeights(fl.map((x) => S.offCost * x / Math.max(1e-9, mean))); }
    // where aims may go
    const aH0 = G.h0 + 1, aH1 = G.h0 + nh * gs - 1, aV0 = G.v0 + 1, aV1 = G.v0 + nv * gs - 1;
    const lim = (h, v) => [clamp(h, Math.max(aH0, P.B.h - S.maxAimH), Math.min(aH1, P.B.h + S.maxAimH)), clamp(v, Math.max(aV0, P.B.v - S.maxAimV), Math.min(aV1, P.B.v + S.maxAimV))];
    const pixOf = (h, v) => [clamp(G.iOf(h), 0, nh - 1), clamp(G.jOf(v), 0, nv - 1)];
    // places where light harms nothing (no band, no painting): somewhere to put a unit whose image can't help anywhere else
    const freePx = []; { for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { const p = j * nh + i; if (B.wc[p] === 0 && sec.ws[p] === 0 && Math.abs(G.hOf(i) - P.B.h) <= S.maxAimH && Math.abs(G.vOf(j) - P.B.v) <= S.maxAimV && G.vOf(j) < B.edge.line - 0.5 + (B.edge.mode === 'cutoff' ? 0 : 99)) freePx.push(p); } }
    const freeAim = () => { if (!S.dump || !freePx.length) return null; const p = freePx[Math.floor(rand() * freePx.length)], i = p % nh, j = (p - i) / nh; return [G.hOf(i), G.vOf(j)]; };
    // ---- deficit-driven aim sampling
    const demand = new Float32Array(G.n);
    const setDemand = () => { for (let p = 0; p < G.n; p++) demand[p] = Math.max(B.lo[p], model.tg[p] * model.scale); };
    let cum = new Float64Array(G.n + 1);
    const setNeed = () => { let a = 0; for (let p = 0; p < G.n; p++) { const d = demand[p]; if (d > 0) { const x = (d - model.F[p]) / d; if (x > 0) a += x * (B.wc[p] > 0 ? 1 : 0.3); } cum[p + 1] = a; } return a; };
    const drawPix = (tot) => { const x = rand() * tot; let lo = 0, hi = G.n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= x) lo = m; else hi = m; } return lo; };
    // EDGE ANCHORING.  Light under the cut-off comes from patterns whose top edge is set on the line: the vertical marginal of a pattern
    // falls to 40 % of its maximum at row `top40` above the aim row; aiming it at line − top40 puts that edge on the line (the knee).
    const kneeOff = (K) => {
      if (K.top40 !== undefined) return K.top40;
      const rows = new Map(); let mx = 0, jmin = 1e9, jmax = -1e9;
      for (let t = 0; t < K.n; t++) { const j = K.dj[t]; rows.set(j, (rows.get(j) || 0) + K.val[t]); if (j < jmin) jmin = j; if (j > jmax) jmax = j; }
      for (const v of rows.values()) if (v > mx) mx = v;
      let top = null; for (let j = jmax; j >= jmin; j--) { const v = rows.get(j) || 0; if (v >= 0.4 * mx) { const vn = rows.get(j + 1) || 0; top = j + (v - 0.4 * mx) / Math.max(1e-9, v - vn); break; } }
      return (K.top40 = top === null ? 0 : top);
    };
    // CEILINGS.  Above some row a column is capped (the cut-off / glare ceiling / zone III): a pattern aimed so its upper tail pokes over that
    // row leaks.  ceilV[i] = the first capped row above −3° in column i; a candidate aim is lowered until its pattern's upper 5 % point sits under it.
    const ceilV = new Float64Array(nh).fill(Infinity);
    for (let i = 0; i < nh; i++) for (let j = Math.max(0, G.jOf(-3)); j < nv; j++) { const p = j * nh + i; if (B.wc[p] > 0 && B.hi[p] < S.ceilLevel) { ceilV[i] = G.v0 + j * gs; break; } }
    const top05 = (K) => {
      if (K.top05 !== undefined) return K.top05;
      const rows = new Map(); let mx = 0, jmin = 1e9, jmax = -1e9;
      for (let t = 0; t < K.n; t++) { const j = K.dj[t]; rows.set(j, (rows.get(j) || 0) + K.val[t]); if (j < jmin) jmin = j; if (j > jmax) jmax = j; }
      for (const v of rows.values()) if (v > mx) mx = v;
      let top = 0; for (let j = jmax; j >= jmin; j--) if ((rows.get(j) || 0) >= 0.05 * mx) { top = j + 1; break; }
      return (K.top05 = top);
    };
    const ceilClamp = (K, h, v) => { const c = ceilV[clamp(G.iOf(h), 0, nh - 1)]; if (c === Infinity || !K || !(rand() < S.ceilFrac)) return v; return Math.min(v, c - top05(K) * gs - 0.05); };
    const edgeCols = B.edge.cols, hasEdge = edgeCols.length > 0 && B.edge.mode !== 'design';
    const edgeH0 = hasEdge ? Math.min(...edgeCols.map((c) => c.h)) - 4 : 0, edgeH1 = hasEdge ? Math.max(...edgeCols.map((c) => c.h)) + 1.5 : 0;
    const anchoredAim = (K) => {                                                  // a random place along the cut-off with the pattern's top edge on the line
      const h = edgeH0 + rand() * (edgeH1 - edgeH0), v = B.edge.line - (kneeOff(K) + (rand() - 0.5) * 2.0) * gs - S.kneeBias;
      return lim(h, v);
    };
    // of the few best candidates by pixel cost, the one that is best once the cut-off terms are counted (a temporary placement per candidate)
    const pickWithEdge = (cands) => {
      if (cands.length === 1 || !(B.edge.cols.length)) return cands[0];
      const e0 = model.edgeCost; let bestC = null;
      for (const c of cands) { model.begin(); model.addMut(c.K, c.ai, c.aj, 1); const dp = model.moveDelta(), e1 = model.edgeEval(); model.revert(); const tot = dp + (e1 - e0); if (!bestC || tot < bestC.tot) bestC = Object.assign({ tot }, c); }
      return bestC;
    };
    // ---- greedy placement
    prog(0.12, 'placing');
    const tStart = Date.now();
    setDemand();
    const order = live.map((u, i) => i).sort((a, b) => live[a].r - live[b].r || a - b);
    const ARCH = [shIdx(0, 0), shIdx(2, 1), shIdx(4, 1), shIdx(4, 3), shIdx(5, 4), shIdx(6, 5)];
    model.recomputeAll();
    let done = 0;
    for (const u of order) {
      const tot = setNeed();
      let best = null; const top = [];
      const keepTop = (c) => { if (top.length < 3 || c.d < top[top.length - 1].d) { top.push(c); top.sort((a, b) => a.d - b.d); if (top.length > 3) top.pop(); } };
      const shapes = ARCH.slice(); for (let q = shapes.length - 1; q > 0; q--) { const j = Math.floor(rand() * (q + 1)); [shapes[q], shapes[j]] = [shapes[j], shapes[q]]; }
      for (const sh of shapes.slice(0, S.initShapes)) {
        const K = kernelOf(u, sh); if (!K || !K.n) continue;
        for (let c = 0; c < S.initAims; c++) {
          let h, v;
          const fa = c % 5 === 4 ? freeAim() : null;
          if (fa) { h = fa[0]; v = fa[1]; }
          else if (hasEdge && shapeOf(sh)[1] <= 0.35 && rand() < S.anchorFrac) { [h, v] = anchoredAim(K); }
          else if (tot > 0 && rand() < 0.8) { const p = drawPix(tot), i = p % nh, j = (p - i) / nh; h = G.hOf(i) + (rand() - 0.5) * gs; v = G.vOf(j) + (rand() - 0.5) * gs; }
          else { h = P.B.h + (rand() - 0.5) * 2 * S.maxAimH * 0.5; v = P.B.v + (rand() - 0.5) * 2 * S.maxAimV * 0.5; }
          v = ceilClamp(K, h, v); [h, v] = lim(h, v); const [ai, aj] = pixOf(h, v);
          const d = model.deltaAdd(K, ai, aj);
          keepTop({ d, sh, ai, aj, K });
        }
      }
      if (top.length) { best = pickWithEdge(top); }
      if (best) { model.setOn(u, true); st[u].ai = best.ai; st[u].aj = best.aj; st[u].sh = best.sh; st[u].K = best.K; model.begin(); model.addMut(best.K, best.ai, best.aj, 1); model.commit(); }
      if (++done % 10 === 0) prog(0.12 + 0.3 * done / N, 'placing ' + done + '/' + N);
    }
    model.recomputeAll();
    const c0 = model.total();
    notes.push('greedy: cost ' + c0.toFixed(2) + ', ' + traced + ' patterns traced, ' + (Date.now() - tStart) + ' ms');
    // ---- annealing
    const sweeps = S.sweeps, mv = S.moves, snapshot = () => st.map((s) => ({ on: s.on, ai: s.ai, aj: s.aj, sh: s.sh }));
    let best = { cost: model.total(), snap: snapshot() }, cur = best.cost;
    const T0 = S.temp * Math.max(1e-3, c0 / Math.max(1, N)), rate = (sweeps > 1 ? 1 / (sweeps - 1) : 1);
    let acc = 0, tries = 0;
    const refreshDynamic = () => {
      // relative bounds follow the model: Zone I < 2 × 50R, HV ≥ 0.8 Imax
      for (const r of B.rel) {
        const spec = r.minRel || r.maxRel; let ref;
        if (spec.ref === 'Imax') { let m = 0; for (let p = 0; p < G.n; p++) if (model.F[p] > m) m = model.F[p]; ref = m; }
        else { let sx = 0; for (const p of r.refPx) sx += model.F[p]; ref = r.refPx.length ? sx / r.refPx.length : 0; if (r.refMin > 0) ref = Math.max(ref, r.refMin); }
        if (!(ref > 0)) continue;
        const m = S.margin;
        for (const p of r.px) { if (r.maxRel) B.hi[p] = Math.min(B.hi[p] < 1e29 ? B.hi[p] : 1e30, r.maxRel.factor * ref / m); if (r.minRel) B.lo[p] = Math.max(B.lo[p], r.minRel.factor * ref * m); }
        if (r.it.kind === 'zone' || r.it.kind === 'point') for (const p of r.px) if (B.wc[p] === 0) B.wc[p] = 0.5;
      }
      // the judge reads the cut-off only where a reading is ≥ 2 % of the scan's brightest; a skirt above that level makes its noise steps
      // compete with the real edge (a spurious knee moves the whole lamp, G picks up a noise maximum).  Keep it under the gate.
      if (S.skirt > 0) for (let q = 0; q < B.edge.cols.length; q++) {
        const c = B.edge.cols[q], top = model.ec[q] && model.ec[q].top; if (!(top > 0)) continue;
        const cap = S.skirt * 0.02 * top;
        for (const p of c.above) { if (cap < B.hi[p]) B.hi[p] = cap; if (B.wc[p] < 0.3) B.wc[p] = 0.3; }
      }
    };
    const refitScale = () => {                                     // secondary level: the log-domain least-squares fit of F to the painting
      let sw = 0, sx = 0; for (let p = 0; p < G.n; p++) if (model.ws[p] > 0 && model.F[p] > 0) { sw += model.ws[p]; sx += model.ws[p] * (Math.log(model.F[p] + 1e-9) - Math.log(model.tg[p])); }
      if (sw > 0) model.setScale(clamp(Math.exp(sx / sw) / 1, 0.25, 4) * 1);
    };
    // dynamic relative rows start from the greedy field
    const relBase = { lo: Float32Array.from(B.lo), hi: Float32Array.from(B.hi) };
    const resetRel = () => { B.lo.set(relBase.lo); B.hi.set(relBase.hi); refreshDynamic(); };
    resetRel(); refitScale(); model.recomputeAll(); cur = model.total(); best = { cost: cur, snap: snapshot() };
    function runSweeps(nSw, tempFac, sigMax, shapeMoves, label, p0, p1, anchor) {
      const rate2 = nSw > 1 ? 1 / (nSw - 1) : 1, T0b = tempFac * Math.max(1e-3, c0 / Math.max(1, N));
      for (let sw = 0; sw < nSw; sw++) {
        const frac = sw * rate2, T = T0b * Math.pow(1 - frac, 2), sig = 0.08 + sigMax * Math.pow(1 - frac, 1.5);
        const ord = order.slice(); for (let q = ord.length - 1; q > 0; q--) { const j = Math.floor(rand() * (q + 1)); [ord[q], ord[j]] = [ord[j], ord[q]]; }
        const tot = setNeed();
        for (const u of ord) {
          const s = st[u];
          if (!s.on) {                                                   // a unit that is out: try bringing it in somewhere it helps (or harms nothing)
            if (!shapeMoves || !s.K) continue;
            const fa = rand() < 0.5 ? freeAim() : null, q = fa ? lim(fa[0], fa[1]) : tot > 0 ? (() => { const p = drawPix(tot), i = p % nh, j = (p - i) / nh; return lim(G.hOf(i), G.vOf(j)); })() : null;
            if (!q) continue; const [ai, aj] = pixOf(q[0], q[1]), e0 = model.edgeCost;
            model.begin(); model.addMut(s.K, ai, aj, 1); let d = model.moveDelta(); const e1 = model.edgeEval(); d += e1 - e0 - model.offW(u);
            if (d <= 0) { model.commit(); model.setOn(u, true); s.ai = ai; s.aj = aj; model.edgeCost = e1; cur += d; acc++; } else model.revert();
            tries++; continue;
          }
          for (let m = 0; m < mv; m++) {
            let nAi = s.ai, nAj = s.aj, nSh = s.sh; const r = rand();
            if (S.useOff && shapeMoves && r > 0.97) {                                // leave this unit out
              const e0 = model.edgeCost; model.begin(); model.addMut(s.K, s.ai, s.aj, -1); let d = model.moveDelta(); const e1 = model.edgeEval(); d += e1 - e0 + model.offW(u);
              tries++; if (d < 0 || (T > 0 && rand() < Math.exp(-d / T))) { model.commit(); model.setOn(u, false); model.edgeCost = e1; cur += d; acc++; break; } else { model.revert(); continue; }
            }
            if (shapeMoves && r > 0.94) { const fa = freeAim(); if (fa) { const q = lim(fa[0], fa[1]); [nAi, nAj] = pixOf(q[0], q[1]); } }
            else if (r < 0.55 || (!shapeMoves && r < 0.9)) { const h = G.hOf(s.ai) + (rand() - 0.5) * 2 * sig, v = G.vOf(s.aj) + (rand() - 0.5) * 2 * sig * 0.6; const q = lim(h, v); [nAi, nAj] = pixOf(q[0], q[1]); }
            else if (r < 0.8 && shapeMoves) { const lh = Math.floor(s.sh / SHAPES_V.length), lv = s.sh % SHAPES_V.length; let nlh = lh, nlv = lv; if (rand() < 0.5) nlh = clamp(lh + (rand() < 0.5 ? -1 : 1), 0, SHAPES_H.length - 1); else nlv = clamp(lv + (rand() < 0.5 ? -1 : 1), 0, SHAPES_V.length - 1); nSh = shIdx(nlh, nlv); }
            else if (r < 0.86 && hasEdge && shapeMoves && s.K && shapeOf(s.sh)[1] <= 0.35) { const q = anchoredAim(s.K); [nAi, nAj] = pixOf(q[0], q[1]); }
            else if (r < 0.92 && tot > 0 && shapeMoves) { const p = drawPix(tot), i = p % nh, j = (p - i) / nh, q = lim(G.hOf(i), ceilClamp(s.K, G.hOf(i), G.vOf(j))); [nAi, nAj] = pixOf(q[0], q[1]); }
            else if (shapeMoves) { const lh = Math.floor(s.sh / SHAPES_V.length), lv = s.sh % SHAPES_V.length, h = G.hOf(s.ai) + (rand() - 0.5) * sig, v = G.vOf(s.aj) + (rand() - 0.5) * sig * 0.5, q = lim(h, v); [nAi, nAj] = pixOf(q[0], q[1]); nSh = shIdx(clamp(lh + Math.round((rand() - 0.5) * 2), 0, SHAPES_H.length - 1), clamp(lv + Math.round((rand() - 0.5) * 2), 0, SHAPES_V.length - 1)); }
            else { const h = G.hOf(s.ai) + (rand() - 0.5) * 2 * sig, v = G.vOf(s.aj) + (rand() - 0.5) * 2 * sig * 0.6; const q = lim(h, v); [nAi, nAj] = pixOf(q[0], q[1]); }
            if (anchor > 0 && s.K && s.K.ai !== undefined) { nAi = clamp(nAi, s.K.ai - anchor, s.K.ai + anchor); nAj = clamp(nAj, s.K.aj - anchor, s.K.aj + anchor); }
            if (nAi === s.ai && nAj === s.aj && nSh === s.sh) continue;
            const Kn = nSh === s.sh ? s.K : kernelOf(u, nSh); if (!Kn || !Kn.n) continue;
            tries++;
            const e0 = model.edgeCost;
            model.begin(); model.addMut(s.K, s.ai, s.aj, -1); model.addMut(Kn, nAi, nAj, 1);
            let d = model.moveDelta();
            const e1 = model.edgeEval(); d += e1 - e0;
            if (d <= 0 || (T > 0 && rand() < Math.exp(-d / T))) { model.commit(); s.ai = nAi; s.aj = nAj; s.sh = nSh; s.K = Kn; model.edgeCost = e1; cur += d; acc++; }
            else model.revert();
          }
        }
        refitScale(); resetRel(); model.recomputeAll(); cur = model.total();
        if (S.boost > 0) for (let p = 0; p < G.n; p++) { if (B.wc[p] <= 0) continue; const f = model.F[p], l = B.lo[p], h = B.hi[p]; const bad = (l > 0 && f < l * 0.97) || f > h * 1.03; model.boost[p] = bad ? Math.min(12, model.boost[p] * (1 + S.boost)) : Math.max(1, model.boost[p] * 0.92); }
        if (S.boost > 0) { model.recomputeAll(); cur = model.total(); }
        if (cur < best.cost * 0.9999 || sw === 0) best = { cost: cur, snap: snapshot() };
        if (sw % 3 === 0) prog(p0 + (p1 - p0) * (sw + 1) / nSw, label + ' ' + (sw + 1) + '/' + nSw + ' · cost ' + cur.toFixed(2));
      }
    }
    const tAn = Date.now();
    runSweeps(sweeps, S.temp, S.step0, true, 'annealing', 0.45, 0.70);
    const msAn = Date.now() - tAn;
    // restore the best state seen, then LARGE-NEIGHBOURHOOD repair: take the worst violation, remove the units that light it most and place
    // them again with the greedy candidate search (aims drawn from where light is missing, shapes from a menu); keep it only if the total falls
    best.snap.forEach((q, u) => { const s = st[u]; model.setOn(u, q.on); s.ai = q.ai; s.aj = q.aj; s.sh = q.sh; s.K = q.on ? (s.K && s.K.n && s.shK === q.sh ? s.K : kernelOf(u, q.sh)) : s.K; s.shK = q.sh; });
    for (let p = 0; p < G.n; p++) model.boost[p] = 1;
    resetRel(); model.recomputeAll();
    const kval = (K, di, dj) => { if (!K.map) { K.map = new Map(); for (let t = 0; t < K.n; t++) K.map.set(K.dj[t] * 4096 + K.di[t], K.val[t]); } return K.map.get(dj * 4096 + di) || 0; };
    let lnsAcc = 0, lnsTry = 0;
    const lns = (rounds) => {
      for (let r = 0; r < rounds; r++) {
        let pw = -1, cw = 1e-9; for (let p = 0; p < G.n; p++) if (model.cp[p] > cw) { cw = model.cp[p]; pw = p; }
        // when the cut-off terms outweigh the pixel violations, work on the worst edge column (the pixel at its knee) instead
        const ecs = model.ec; let qw = -1, ew = 0; for (let q = 0; q < ecs.length; q++) if (ecs[q].cost > ew) { ew = ecs[q].cost; qw = q; }
        if (qw >= 0 && ew * S.edgeWeight > cw && ecs[qw].kneeRow >= 0 && rand() < 0.7) pw = ecs[qw].kneeRow * nh + B.edge.cols[qw].ic;
        if (pw < 0) break;
        const pi = pw % nh, pj = (pw - pi) / nh, contrib = [];
        for (let u = 0; u < N; u++) { const s = st[u]; if (!s.on || !s.K) continue; const v = kval(s.K, pi - s.ai, pj - s.aj); if (v > 0) contrib.push([u, v]); }
        // the units that matter most to this pixel: for a shortfall the ones that give least (a better place for them), for an excess the ones that give most
        const need = model.lo[pw] > 0 && model.F[pw] < model.lo[pw];
        contrib.sort((a, b) => (need ? a[1] - b[1] : b[1] - a[1]));
        const pick = contrib.slice(0, 1 + Math.floor(rand() * 2)).map((x) => x[0]);
        if (!pick.length) { model.boost[pw] = Math.min(12, model.boost[pw] * 1.5); continue; }
        lnsTry++;
        const cost0 = model.total(), old = pick.map((u) => ({ u, ai: st[u].ai, aj: st[u].aj, sh: st[u].sh, K: st[u].K }));
        model.begin(); for (const o of old) model.addMut(o.K, o.ai, o.aj, -1); model.commit(); for (const o of old) model.setOn(o.u, false);
        const nw = [];
        for (const o of old) {
          const tot = setNeed(); let bestC = null; const topL = [];
          const sh0 = o.sh, lh0 = Math.floor(sh0 / SHAPES_V.length), lv0 = sh0 % SHAPES_V.length;
          const menu = [...new Set([sh0, shIdx(clamp(lh0 + 1, 0, SHAPES_H.length - 1), lv0), shIdx(clamp(lh0 - 1, 0, SHAPES_H.length - 1), lv0), shIdx(lh0, clamp(lv0 + 1, 0, SHAPES_V.length - 1)), shIdx(lh0, clamp(lv0 - 1, 0, SHAPES_V.length - 1)), ARCH[Math.floor(rand() * ARCH.length)], ARCH[Math.floor(rand() * ARCH.length)]])];
          for (const sh of menu) {
            const K = kernelOf(o.u, sh); if (!K || !K.n) continue;
            for (let c = 0; c < S.lnsAims; c++) {
              let h, v;
              const fa = c % 6 === 5 ? freeAim() : null;
              if (c === 0) { h = G.hOf(o.ai); v = G.vOf(o.aj); }
              else if (fa) { h = fa[0]; v = fa[1]; }
              else if (hasEdge && shapeOf(sh)[1] <= 0.35 && rand() < S.anchorFrac) { [h, v] = anchoredAim(K); }
              else if (tot > 0 && rand() < 0.6) { const p = drawPix(tot), i = p % nh, j = (p - i) / nh; h = G.hOf(i) + (rand() - 0.5) * gs; v = G.vOf(j) + (rand() - 0.5) * gs; }
              else { h = G.hOf(o.ai) + (rand() - 0.5) * 3; v = G.vOf(o.aj) + (rand() - 0.5) * 2; }
              v = ceilClamp(K, h, v); [h, v] = lim(h, v); const [ai, aj] = pixOf(h, v), d = model.deltaAdd(K, ai, aj);
              if (topL.length < 3 || d < topL[topL.length - 1].d) { topL.push({ d, sh, ai, aj, K }); topL.sort((a, b) => a.d - b.d); if (topL.length > 3) topL.pop(); }
            }
          }
          if (topL.length) bestC = pickWithEdge(topL);
          const b = bestC || { sh: o.sh, ai: o.ai, aj: o.aj, K: o.K };
          model.begin(); model.addMut(b.K, b.ai, b.aj, 1); model.commit();
          const s = st[o.u]; model.setOn(o.u, true); s.ai = b.ai; s.aj = b.aj; s.sh = b.sh; s.K = b.K; nw.push(b);
        }
        model.edgeCost = model.edgeEval();
        if (model.total() < cost0 - 1e-9) lnsAcc++;
        else {
          model.begin(); for (const o of old) { const s = st[o.u]; model.addMut(s.K, s.ai, s.aj, -1); } model.commit();
          model.begin(); for (const o of old) { const s = st[o.u]; model.setOn(o.u, true); s.ai = o.ai; s.aj = o.aj; s.sh = o.sh; s.K = o.K; model.addMut(o.K, o.ai, o.aj, 1); } model.commit();
          model.edgeCost = model.edgeEval(); model.boost[pw] = Math.min(12, model.boost[pw] * 1.3);
        }
        if (r % 20 === 0) { for (let p = 0; p < G.n; p++) if (model.boost[p] > 1) model.boost[p] = Math.max(1, model.boost[p] * 0.9); model.recomputeAll(); }
      }
    };
    const tLns = Date.now();
    if (S.lnsRounds > 0) { prog(0.7, 'repairing'); lns(S.lnsRounds); for (let p = 0; p < G.n; p++) model.boost[p] = 1; resetRel(); model.recomputeAll(); best = { cost: model.total(), snap: snapshot() }; cur = best.cost; }
    const msLns = Date.now() - tLns;
    const cAnneal = model.total();
    // PRECISION PASS: every unit's pattern re-traced at the aim it ended up with, with many more samples (the faint tails that decide the
    // dim rows are under one sample per pixel at the search's sample count), then a short low-temperature polish of aims alone.
    let polished = false;
    if (S.knFinal > 0 && S.polishSweeps > 0) {
      prog(0.77, 'precision pass');
      for (let u = 0; u < N; u++) { const s = st[u]; if (!s.on) continue; const K = traceUnit(P, live[u], [G.hOf(s.ai), G.vOf(s.aj)], shapeOf(s.sh), { n: S.knFinal, aimPixel: [s.ai, s.aj] }); if (K && K.n) { K.ai = s.ai; K.aj = s.aj; s.K = K; } }
      model.recomputeAll(); best = { cost: model.total(), snap: snapshot() }; cur = best.cost;
      for (let p = 0; p < G.n; p++) model.boost[p] = 1;
      runSweeps(S.polishSweeps, 0, S.polishStep, false, 'polishing', 0.78, 0.86, 0);
      best.snap.forEach((q, u) => { const s = st[u]; model.setOn(u, q.on); s.ai = q.ai; s.aj = q.aj; s.sh = q.sh; });
      // restored aims may differ from the polish end: rebuild the exact patterns where the aim moved (cheap: same shape), then the field
      for (let u = 0; u < N; u++) { const s = st[u]; if (!s.on) continue; if (!s.K || s.K.ai !== s.ai || s.K.aj !== s.aj) { const K = traceUnit(P, live[u], [G.hOf(s.ai), G.vOf(s.aj)], shapeOf(s.sh), { n: S.knFinal, aimPixel: [s.ai, s.aj] }); if (K && K.n) { K.ai = s.ai; K.aj = s.aj; s.K = K; } } }
      for (let p = 0; p < G.n; p++) model.boost[p] = 1;
      resetRel(); model.recomputeAll(); polished = true;
    }
    notes.push('anneal: ' + tries + ' moves, ' + (100 * acc / Math.max(1, tries)).toFixed(0) + '% accepted, repair ' + lnsAcc + '/' + lnsTry + '; cost ' + c0.toFixed(2) + ' → ' + cAnneal.toFixed(2) + (polished ? ' → ' + model.total().toFixed(2) + ' after the precision pass' : '') + ' (pixels ' + model.pixelCostAll().toFixed(2) + ', cut-off ' + model.edgeCost.toFixed(2) + '); ' + traced + ' patterns traced');
    // polish the aims alone with the patterns as they stand (the calibration rounds call this with patterns taken from a real trace),
    // each unit kept within `anchor` pixels of where its pattern was measured; the best state seen is restored
    const polish = (nSw, sig, anchor, label) => {
      for (let p = 0; p < G.n; p++) model.boost[p] = 1;
      resetRel(); model.recomputeAll(); best = { cost: model.total(), snap: snapshot() }; cur = best.cost; const c1 = cur;
      runSweeps(nSw, 0, sig, false, label || 'polishing', 0.8, 0.9, anchor);
      best.snap.forEach((q, u) => { const s = st[u]; model.setOn(u, q.on); s.ai = q.ai; s.aj = q.aj; s.sh = q.sh; });
      for (let p = 0; p < G.n; p++) model.boost[p] = 1;
      resetRel(); model.recomputeAll(); return { before: c1, after: model.total() };
    };
    const repair = (rounds) => {            // large-neighbourhood repair on the patterns as they stand (measured ones stay; re-placed units use model patterns)
      for (let p = 0; p < G.n; p++) model.boost[p] = 1;
      resetRel(); model.recomputeAll(); const c1 = model.total();
      lns(rounds);
      for (let p = 0; p < G.n; p++) model.boost[p] = 1;
      resetRel(); model.recomputeAll(); return { before: c1, after: model.total() };
    };
    return { model, live, st, kernelOf, shapeOf, traced, polish, repair, G };
  }



  // ---------------------------------------------------------------- calibration: patterns from the real engine
  // One trace of the BUILT design with the first surface each ray met recorded: the exit directions of the rays that first hit facet k are
  // exactly facet k's pattern in this design, with the neighbours' shadowing, the real shared aperture, blocking and pulled facets all in.
  // `items`: [{ u, surfIdx, ai, aj, shape }]; returns the sparse patterns, placed relative to each unit's own aim pixel.
  function patternsFromTrace(P, S, surfaces, items, N) {
    const G = P.G, gs = G.gs, conv = G.conv, input = P.input;
    const sc = { source: input.source, target: input.target, envelope: input.envelope, sim: { bounces: 1, floor: 0.01, seed: (S.seed | 0) + 7, res: 50, autoRes: false, rays: N } };
    const E = RF.Engine, PP = E.prepare(sc, surfaces); PP.recordExit = true; PP.exitCap = N; PP.recordHits = true; PP.hitCap = 1;
    const c = E.runSync(PP, N, 0), ex = c.ex, rayK = c.rayK;
    const unitOfSurf = new Int32Array(surfaces.length + 1).fill(-1); items.forEach((it, q) => { unitOfSurf[it.surfIdx + 1] = q; });
    const cnt = new Int32Array(items.length + 1);
    for (let r = 0; r < ex.n; r++) { if (ex.b[r] < 1) continue; const q = unitOfSurf[rayK[ex.i[r]]]; if (q >= 0) cnt[q + 1]++; }
    for (let q = 0; q < items.length; q++) cnt[q + 1] += cnt[q];
    const fill = cnt.slice(), idx = new Int32Array(cnt[items.length]);
    for (let r = 0; r < ex.n; r++) { if (ex.b[r] < 1) continue; const q = unitOfSurf[rayK[ex.i[r]]]; if (q >= 0) idx[fill[q]++] = r; }
    const R = 220, w = 2 * R + 1, sc2 = scratch(R), out = new Array(items.length).fill(null);
    let direct = 0;
    for (let r = 0; r < ex.n; r++) if (ex.b[r] === 0) direct += ex.e[r];
    for (let q = 0; q < items.length; q++) {
      const it = items[q], href = G.hOf(it.ai), vref = G.vOf(it.aj), omega = G.omega[clamp(it.aj, 0, G.nv - 1) * G.nh + clamp(it.ai, 0, G.nh - 1)];
      let nt = 0, lm = 0;
      for (let t = cnt[q]; t < cnt[q + 1]; t++) {
        const r = idx[t], o3 = 3 * r, a = ex.d[o3], b = -ex.d[o3 + 1], cc = ex.d[o3 + 2], e = ex.e[r];
        let H, Vv;
        if (conv === 'B') { H = Math.asin(clamp(b, -1, 1)) * R2D; Vv = Math.atan2(cc, a) * R2D; } else if (conv === 'S') { if (!(a > 0)) continue; H = Math.atan(b / a) * R2D; Vv = Math.atan(cc / a) * R2D; } else { H = Math.atan2(b, a) * R2D; Vv = Math.asin(clamp(cc, -1, 1)) * R2D; }
        const gx = (H - href) / gs, gy = (Vv - vref) / gs, i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
        lm += e; if (i0 < -R || j0 < -R || i0 >= R || j0 >= R) continue;
        const base = (j0 + R) * w + (i0 + R), ws4 = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], of4 = [0, 1, w, w + 1];
        for (let m = 0; m < 4; m++) { const kk = base + of4[m]; if (!sc2.mark[kk]) { sc2.mark[kk] = 1; sc2.touched[nt++] = kk; } sc2.acc[kk] += e * ws4[m]; sc2.cnt[kk] += ws4[m]; }
      }
      const K = finishPattern(sc2, nt, R, it.shape, gs, omega, { minCount: 20, ownCount: 10 });
      K.ai = it.ai; K.aj = it.aj; K.rays = cnt[q + 1] - cnt[q]; out[q] = K;
    }
    return { patterns: out, direct, N: c.N, blocked: c.occ.out1 > 0 ? c.occ.blocked / c.occ.out1 : 0 };
  }

  // ---------------------------------------------------------------- 7. emit, verify, register
  const QUALITY = {
    fast: { kn: 8000, sweeps: 14, moves: 5, initShapes: 3, initAims: 24, lnsRounds: 40, lnsAims: 16, calRounds: 1, calRays: 1000000 },
    normal: { kn: 12000, sweeps: 30, moves: 6, initShapes: 4, initAims: 32, lnsRounds: 80, lnsAims: 20, calRounds: 2, calRays: 1500000 },
    best: { kn: 20000, sweeps: 60, moves: 8, initShapes: 5, initAims: 48, lnsRounds: 200, lnsAims: 40, calRounds: 3, calRays: 3000000 },
  };
  function resolve(S0) {
    const S = Object.assign({}, S0), Q = QUALITY[S.quality] || QUALITY.normal;
    for (const k of Object.keys(Q)) if (S[k] === undefined || S[k] === -1) S[k] = Q[k];
    S.margin = 1 + clamp(S.safety === undefined ? 10 : S.safety, 0, 100) / 100;
    if (S.paintWeight === undefined) S.paintWeight = 0.05;
    if (S.minDistance === undefined) S.minDistance = 0;
    return S;
  }
  const BASE = { guideGain: 1, gateSigma: 0.15, kneeGate: 3, ceilFrac: 0, ceilLevel: 2500, dump: false, useOff: false, maxMargin: 4, offCost: 1, calLns: 0, anchorFrac: 0.4, kneeFrac: 0.20, plateau: 0.6, tailG: 0.55, knFinal: 0, anchorPx: 3, polishSweeps: 8, polishStep: 0.25, skirt: 0.7, skirtFrom: 0.45, grid: 0.1, gridA: 120, gridP: 96, wall: 0.3, finest: 1.5, sharp: 1.5, detail: 0.75, step: 0.01, softBelow: 1, softWeight: 0.15, edgePad: 1.0, tol: 0.15, edgeWeight: 3, gHi: 0.58, gLo: 1.2, designRays: 8e6, kneeBias: 0, maxAimH: 25, maxAimV: 12, glare: -1, glareWeight: 0.3, boost: 0.5, temp: 0.01, step0: 1.0 };
  // facets for the units' current aims and shapes, pulled toward the LED where the host's verify flags them
  function buildSurfaces(P, S, R, notes) {
    const G = P.G, out = [], byId = new Map();
    R.live.forEach((f, u) => {
      const s = R.st[u]; if (!s.on) return;
      const aim = [G.hOf(s.ai), G.vOf(s.aj)], shape = R.shapeOf(s.sh), surf = emitFacet(P, f, aim, shape, 1);
      if (surf) { out.push(surf); byId.set(surf.id, { f, aim, shape, u, s }); }
    });
    const input = P.input, sceneV = { source: input.source, envelope: input.envelope, target: input.target, modeA: { budget: P.N0 } }, pull = new Map();
    let surfaces = out;
    for (let pass = 0; pass < 9; pass++) {
      const v = RF.Solvers.verify(sceneV, { surfaces }), bad = new Set(v.violations.envelope.concat(v.violations.keepOut));
      if (!bad.size) break;
      surfaces = surfaces.map((x) => {
        if (!bad.has(x.id)) return x;
        const b = byId.get(x.id), k = (pull.get(x.id) || 1) * 0.94; pull.set(x.id, k);
        return pass < 8 ? emitFacet(P, b.f, b.aim, b.shape, k) : null;
      }).filter(Boolean);
    }
    if (notes && pull.size) notes.push(pull.size + ' facet(s) pulled toward the LED to fit the envelope');
    const items = surfaces.map((x, k) => { const b = byId.get(x.id); return { u: b.u, surfIdx: k, ai: b.s.ai, aj: b.s.aj, shape: b.shape }; });
    return { surfaces, items };
  }
  function solveOnce(input, S0, tools) {
    const S = resolve(Object.assign({}, BASE, S0, globalThis.__SPEC_HL_OVERRIDE || {})), prog = (f, st) => { if (tools && tools.progress) tools.progress(f, st); };
    S.seed = (input.seed | 0) + (S0.seedOffset | 0) * 1009; S.debug = !!globalThis.__SPEC_HL_DEBUG;
    const notes = [], t0 = Date.now();
    const P = readProblem(input, S); P.B = beamAxis(P);
    prog(0.02, 'shell');
    const sh = buildShell(P, S, notes);
    if (!sh) return { surfaces: [], notes: ['no direction from the LED can hold a mirror inside the envelope'] };
    P.shell = sh.shell;
    if (!P.spec.items.length) notes.push('no spec rows (not Spec mode): following the painting alone');
    const B = buildBands(P, S), sec = secondaryTarget(P, S, B);
    notes.push('bands: ' + B.rows.length + ' rows' + (B.edge.glare ? ', glare ceiling ' + Math.round(B.edge.glare.cap) + ' cd above the cut-off' : '') + '; ' + (sec.n ? 'painting: ' + sec.n + ' cells as the secondary goal' : 'no painting'));
    const tFit = Date.now();
    const R = fit(P, S, B, sec, sh.units, notes, tools);
    const msFit = Date.now() - tFit;
    // ---- calibration: patterns from real traces of the built design, then a polish of the aims on them
    let built = buildSurfaces(P, S, R, null), cal = [];
    for (let round = 0; round < S.calRounds; round++) {
      prog(0.88 + 0.08 * round / Math.max(1, S.calRounds), 'calibrating ' + (round + 1) + '/' + S.calRounds);
      const tc = Date.now();
      const T = patternsFromTrace(P, S, built.surfaces, built.items, S.calRays), msTrace = Date.now() - tc;
      const kept = new Set();
      built.items.forEach((it, q) => { const K = T.patterns[q]; if (K && K.n) { R.st[it.u].K = K; kept.add(it.u); } });
      for (let u = 0; u < R.st.length; u++) if (R.st[u].on && !kept.has(u)) { R.model.setOn(u, false); R.st[u].K = null; }
      let pol = R.polish(S.polishSweeps, S.polishStep, S.anchorPx, 'polishing');
      if (S.calLns > 0 && round < S.calRounds - 1) { const rp = R.repair(S.calLns); pol = { before: pol.before, after: rp.after }; }
      cal.push('round ' + (round + 1) + ': measured patterns → cost ' + pol.before.toFixed(2) + ' → ' + pol.after.toFixed(2) + ' (blocked ' + (100 * T.blocked).toFixed(1) + '%; trace ' + msTrace + ' ms, polish ' + (Date.now() - tc - msTrace) + ' ms)');
      built = buildSurfaces(P, S, R, round === S.calRounds - 1 ? notes : null);
    }
    for (const c of cal) notes.push('calibration ' + c);
    prog(0.97, 'emit');
    const surfaces = built.surfaces;
    const ev = judgeModel(P, R.model.F);
    let pk = 0; for (const x of R.model.F) pk = Math.max(pk, x);
    if (ev) { const fails = ev.rows.filter((r) => r.verdict !== 'pass').map((r) => r.name); notes.push('model verdict ' + ev.verdict + ' (' + ev.n.pass + ' pass / ' + ev.n.fail + ' fail), worst margin ' + ev.worst.toFixed(2) + ' decades' + (fails.length ? ': ' + [...new Set(fails)].join(', ') : '') + '; predicted peak ' + Math.round(pk) + ' cd'); }
    notes.push(surfaces.length + ' facets in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s (fit ' + (msFit / 1000).toFixed(1) + ' s); ' + R.traced + ' footprints traced');
    prog(1, 'done');
    const G = P.G, res = { surfaces, notes, pred: { verdict: ev && ev.verdict, n: ev && ev.n, peak: pk } };
    if (S.debug) res.debug = { F: Array.from(R.model.F), G: { nh: G.nh, nv: G.nv, h0: G.h0, v0: G.v0, gs: G.gs }, units: R.live.map((f, u) => ({ id: 'S' + f.idx, r: f.r, flux: f.flux, on: R.st[u].on, aim: [G.hOf(R.st[u].ai), G.vOf(R.st[u].aj)], shape: R.shapeOf(R.st[u].sh) })) };
    return res;
  }
  RF.Solvers.register({
    id: 'spec-hl-v2', name: 'Spec headlamp v2', version: '2.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'quality', label: 'Quality', type: 'select', default: 'normal', options: [{ value: 'fast', label: 'fast' }, { value: 'normal', label: 'normal' }, { value: 'best', label: 'best' }],
        help: 'How many footprints are traced and how long the fit searches.' },
      { key: 'safety', label: 'Extra safety margin on every row (%)', type: 'number', min: 0, max: 100, step: 5, default: 10,
        help: 'Every row is designed to pass with the margin its own measurement noise needs at the ray count below (a dim row needs far more than a bright one); this adds a flat extra on top.' },
      { key: 'designRays', label: 'Design for a trace of (rays)', type: 'number', min: 5e5, max: 5e7, step: 5e5, default: 8e6,
        help: 'How many rays the judge will trace (guided). More rays = narrower noise = less margin to build in.' },
      { key: 'paintWeight', label: 'Painting as secondary goal (weight)', type: 'number', min: 0, max: 5, step: 0.01, default: 0.05,
        help: 'How hard to pull toward the painted shape once the spec passes. 0 = ignore the painting. The spec always wins.' },
      { key: 'softBelow', adv: true, label: 'Rows below this weight are secondary', type: 'number', min: 0, max: 10, step: 0.1, default: 1, help: 'Spec rows (yours or the preset’s) with weight under this are best effort.' },
      { key: 'seedOffset', adv: true, label: 'Seed offset', type: 'number', min: 0, max: 99, step: 1, default: 0 },
    ],
    solve(input, settings, tools) { return solveOnce(input, Object.assign({}, settings, { seed: undefined }), tools); },
  });

  RF.__specHL2 = { fit, judgeModel, modelGrid, directField, secondaryTarget, buildBands, makeModel, emitFacet, traceUnit, facetOf, readProblem, buildShell, ledPoints, beamAxis, outline, apertureRms, aimFrame, dirHV, hvDir, rng, halton };
  Object.assign(RF.__specHL2, { resolve, BASE, solveOnce, patternsFromTrace, buildSurfaces });
  // (the rest of the file is added below)
})();
