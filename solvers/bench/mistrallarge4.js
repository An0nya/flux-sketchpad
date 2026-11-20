/* solvers/solver.js — "facet painter": a static (no-tracing) reflector solver for paint mode.
 *
 * Idea (all geometry is computed directly from the input; no rays are traced):
 *   A mirror facet at distance r from the LED, aimed at target point Z, focuses the LED image onto the
 *   target (exact ellipsoid with foci S0 and Z, i.e. facet with di = |Z-P|).  Its caught flux is
 *   Φ = R·I(θ)·cosβ·A/r² and its spot on the target is the LED image, size ≈ (L/r)·(LED extent),
 *   independent of A.  So position sets sharpness, area sets brightness, aim sets placement.
 *
 *   The scorer forgives exactly the blur of the smallest possible LED image (RF.Photometry.achievableKernel),
 *   so the working target is B = boxBlur(paint, kernel).  We place N = maxFacets facets on the envelope,
 *   give them aims with density ∝ B (weighted k-means over target cells), solve per-facet areas by
 *   capped non-negative least squares so the delivered field ≈ κ·B, and emit the facets.
 */
(function () {
'use strict';
const V = RF.V, U = RF.U, Geo = RF.Geo, Phot = RF.Photometry;

// ---- small local helpers -------------------------------------------------

function qform(A, e, f) {           // e^T A f with A row-major 3x3
  let t = 0;
  for (let i = 0; i < 3; i++) for (let m = 0; m < 3; m++) t += e[i] * A[3 * i + m] * f[m];
  return t;
}
// Sag of the facet quadric (relative to P) at local (x, y) in the facet plane: root z of x^T A x + b·x = 0 nearest 0.
function sagAt(A, b, e1, e2, n, x, y) {
  const p = [x * e1[0] + y * e2[0], x * e1[1] + y * e2[1], x * e1[2] + y * e2[2]];
  const a = qform(A, n, n);
  const bq = 2 * qform(A, p, n) + V.dot(b, n);
  const c = qform(A, p, p) + V.dot(b, p);
  const r = U.quadRoots(a, bq, c);
  if (!r.length) return NaN;
  let best = r[0];
  for (let i = 1; i < r.length; i++) if (Math.abs(r[i]) < Math.abs(best)) best = r[i];
  return best;
}

// Does a disc patch (centre P, normal n, radius rho, curved per Q) stay inside the envelope and
// outside the clearance of every emitter?  Samples the rim (with sag) plus the centre.
function patchFits(env, Slist, keep, P, Q, e1, e2, n, rho, envTol, clrTol) {
  const NR = 12;
  for (let j = 0; j <= NR; j++) {
    const a = 2 * Math.PI * j / NR;
    const x = rho * Math.cos(a), y = rho * Math.sin(a);
    const z = sagAt(Q.A, Q.b, e1, e2, n, x, y);
    if (!isFinite(z)) return false;
    const pt = V.add(P, V.add(V.mul(e1, x), V.add(V.mul(e2, y), V.mul(n, z))));
    if (!Geo.envInside(env, pt, -envTol)) return false;
    for (let s = 0; s < Slist.length; s++) if (V.dist(pt, Slist[s]) < keep + clrTol) return false;
  }
  const z0 = sagAt(Q.A, Q.b, e1, e2, n, 0, 0);
  const c = V.add(P, V.mul(n, isFinite(z0) ? z0 : 0));
  if (!Geo.envInside(env, c, -envTol)) return false;
  for (let s = 0; s < Slist.length; s++) if (V.dist(c, Slist[s]) < keep + clrTol) return false;
  return true;
}

// Largest disc radius at P (aim Z, quadric Q) that still fits; 0 if even a small patch does not.
function maxRho(env, Slist, keep, P, Q, envTol, clrTol, hi0) {
  const n = Q.n, b = V.basis(n), e1 = b[0], e2 = V.cross(n, e1);
  const fits = (rho) => patchFits(env, Slist, keep, P, Q, e1, e2, n, rho, envTol, clrTol);
  if (!fits(0.05)) return 0;
  let lo = 0.05, hi = Math.max(hi0 || 0, 1);
  if (!fits(hi)) {
    for (let it = 0; it < 12; it++) { const mid = 0.5 * (lo + hi); if (fits(mid)) lo = mid; else hi = mid; }
    return lo;
  }
  for (let k = 0; k < 3 && hi < 1e4; k++) { hi *= 2; if (!fits(hi)) { hi /= 2; break; } lo = hi; }
  for (let it = 0; it < 11; it++) { const mid = 0.5 * (lo + hi); if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}

// Effective spot radius: (trimmed) max distance of the landing points from their centroid.
function spotRadius(uv) {
  if (!uv || uv.length < 3) return 0;
  let cu = 0, cv = 0; for (const p of uv) { cu += p[0]; cv += p[1]; }
  cu /= uv.length; cv /= uv.length;
  const d = uv.map((p) => Math.hypot(p[0] - cu, p[1] - cv)).sort((a, b) => a - b);
  return d[Math.floor(0.97 * (d.length - 1))];
}

// Aperture sample points on the facet surface: centre + two rings (dense enough that the convex hull
// of the landing points is the true spot outline).
function aperturePoints(P, Q, e1, e2, n, rho) {
  const pts = [P.slice()];
  for (const [rr, cnt] of [[0.4, 8], [0.75, 16], [1, 24]]) {
    for (let i = 0; i < cnt; i++) {
      const a = 2 * Math.PI * (i + 0.5 * (rr < 1 ? 1 : 0)) / cnt;
      const x = rho * rr * Math.cos(a), y = rho * rr * Math.sin(a);
      const z = sagAt(Q.A, Q.b, e1, e2, n, x, y);
      pts.push(V.add(P, V.add(V.mul(e1, x), V.add(V.mul(e2, y), V.mul(n, isFinite(z) ? z : 0)))));
    }
  }
  return pts;
}

// Landing points (target u,v) of rays from the LED samples through the aperture points — an exact
// geometric spot of the facet, no Monte Carlo.  S itself is added to the samples (its rays image to Z).
function spotUV(P, Q, e1, e2, n, rho, spts, T, S) {
  const aps = aperturePoints(P, Q, e1, e2, n, rho);
  const all = spts.concat([S]);
  const uv = [];
  for (const M of aps) {
    const x = V.sub(M, P);
    const g = [
      2 * (Q.A[0] * x[0] + Q.A[1] * x[1] + Q.A[2] * x[2]) + Q.b[0],
      2 * (Q.A[3] * x[0] + Q.A[4] * x[1] + Q.A[5] * x[2]) + Q.b[1],
      2 * (Q.A[6] * x[0] + Q.A[7] * x[1] + Q.A[8] * x[2]) + Q.b[2]];
    let nh = V.norm(g);
    if (V.dot(nh, V.sub(S, M)) < 0) nh = V.mul(nh, -1);
    for (const q of all) {
      const din = V.norm(V.sub(M, q));
      const dn = V.dot(din, nh);
      if (dn > -1e-9) continue;
      const r = V.sub(din, V.mul(nh, 2 * dn));
      const den = V.dot(r, T.n);
      if (Math.abs(den) < 1e-12) continue;
      const t = V.dot(V.sub(T.C, M), T.n) / den;
      if (!(t > 0.5)) continue;
      uv.push(RF.Engine.worldToTargetUV(T, V.add(M, V.mul(r, t))));
    }
  }
  return uv;
}

// Does the ray M + t d (0 < t < tmax) pass through facet fac's disc?  (fac = {P, n, e1, e2, rho})
function discHit(fac, M, d, tmax) {
  const den = V.dot(d, fac.n);
  if (Math.abs(den) < 1e-12) return false;
  const t = V.dot(V.sub(fac.P, M), fac.n) / den;
  if (!(t > 0.01 && t < tmax)) return false;
  const X = V.add(M, V.mul(d, t));
  const x = V.dot(V.sub(X, fac.P), fac.e1), y = V.dot(V.sub(X, fac.P), fac.e2);
  return x * x + y * y <= fac.rho * fac.rho;
}

// A few sample rays of the facet's output beam (aperture points toward the aim, jittered a little).
function beamRays(P, Q, e1, e2, n, rho, Z, spotR, T) {
  const aps = aperturePoints(P, Q, e1, e2, n, rho);
  const tgts = [Z];
  for (const su of [-1, 0, 1]) for (const sv of [-1, 0, 1]) {
    if (su === 0 && sv === 0) continue;
    tgts.push(V.add(Z, V.add(V.mul(T.tu, su * spotR * 0.6), V.mul(T.tv, sv * spotR * 0.6))));
  }
  const rays = [];
  for (const mi of [0, 1, 3, 5, 7, 9]) for (const Zt of tgts) {
    const d = V.norm(V.sub(Zt, aps[mi]));
    rays.push({ M: aps[mi], d, tmax: V.dist(aps[mi], Zt) * 1.02 + 1 });
  }
  return rays;
}

// Convex hull (monotone chain, CCW) of 2D points.
function hull2(pts) {
  const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
function inHull(h, x, y) {
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < -1e-9) return false;
  }
  return true;
}

// Sample points on the (apparent) emitter: rect corners / disc rim / volume extremes.
function sourceSamples(src) {
  const fr = RF.Source.frame(src), p = src.pos;
  const at = (cu, cv, ca) => V.add(p, V.add(V.mul(fr.u, cu), V.add(V.mul(fr.v, cv), V.mul(fr.a, ca))));
  const pts = [];
  if (src.kind === 'planar') {
    if (src.shape === 'disc') {
      for (let i = 0; i < 8; i++) { const a = 2 * Math.PI * i / 8; pts.push(at(src.radius * Math.cos(a), src.radius * Math.sin(a), 0)); }
      pts.push(at(0, 0, 0));
    } else {
      const w = (src.w || 0) / 2, h = (src.h || 0) / 2;
      for (const [cu, cv] of [[-w, -h], [w, -h], [w, h], [-w, h], [0, -h], [w, 0], [0, h], [-w, 0], [0, 0]]) pts.push(at(cu, cv, 0));
    }
  } else if (src.shape === 'cylinder') {
    for (const s of [-1, 1]) for (let i = 0; i < 8; i++) { const a = 2 * Math.PI * i / 8; pts.push(at(src.radius * Math.cos(a), src.radius * Math.sin(a), s * (src.length || 0) / 2)); }
  } else {
    for (let i = 0; i < 8; i++) {
      const z = 1 - 2 * (i + 0.5) / 8, r = Math.sqrt(Math.max(0, 1 - z * z)), a = 2 * Math.PI * ((i * 0.6180339887498949) % 1);
      pts.push([p[0] + src.radius * r * Math.cos(a), p[1] + src.radius * r * Math.sin(a), p[2] + src.radius * z]);
    }
  }
  return pts;
}

// ---------------------------------------------------------------- solver --

// The static solver core, shared by the two registrations below.
const PAINTER_SETTINGS = [
  { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'Shared paint control: facets stay at least this far from the LED.' },
  { key: 'push', label: 'Radial push toward the envelope', type: 'range', min: 0.3, max: 0.98, step: 0.02, default: 0.78 },
  { key: 'size', label: 'Max facet radius (mm)', type: 'range', min: 1, max: 14, step: 0.5, default: 3 },
  { key: 'pack', label: 'Facet spacing (x touching)', type: 'range', min: 1.0, max: 2.0, step: 0.02, default: 1.04 },
  { key: 'sharp', label: 'Sharpness preference (r weight)', type: 'range', min: 0, max: 6, step: 0.1, default: 3.0 },
  { key: 'level', label: 'Fraction of max capacity to ask for', type: 'range', min: 0.05, max: 1, step: 0.05, default: 0.7 },
  { key: 'fit', label: 'Area fit iterations', type: 'range', min: 5, max: 400, step: 5, default: 200 },
];

function paintSolve(input, settings, tools) {
  const src = input.source, env = input.envelope, tgt = input.target;
  const paint = input.paint, R = paint.res | 0, cells = paint.cells;
  const Slist = (input.sources && input.sources.length ? input.sources : [src]).map((s) => s.pos);
  const S = Slist[0];
  const refl = input.limits.reflectivity;
  const Nmax = Math.max(1, input.limits.maxFacets | 0);
  const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
  const T = RF.Engine.targetFrame(tgt);
  const half = T.half, cell = 2 * half / R, cellArea = cell * cell;
  const n = R * R;
  const notes = [];
  const rng = new RF.rng.Rng((input.seed | 0) ^ 0x5f3a1b2d);
  const envTol = 0.02 + 1e-6 * Math.max(env.half[0], env.half[1], env.half[2]);
  const clrTol = 0.02;
  const fr = RF.Source.frame(src), ax = fr.a;
  const pw = src.power || 0, totI = RF.Source.totalIntegral(src) || 1;

  let sp = 0; for (let k = 0; k < n; k++) sp += cells[k];
  if (!(sp > 0) || R < 2) return { surfaces: [], intent: [], notes: ['paint is empty — nothing to aim at'] };

  // -- working target: the paint blurred by the smallest achievable LED image (scorer's concession)
  const ker = Phot.achievableKernel({ source: src, envelope: env, target: tgt });
  const B = Phot.boxBlur(Float64Array.from(cells), R, ker.cells);
  let sB = 0; for (let k = 0; k < n; k++) sB += B[k];
  notes.push('kernel ' + ker.cells.toFixed(2) + ' cells, paint mass ' + sp.toFixed(1) + ', blurred ' + sB.toFixed(1));

  // -- analytic direct light on the target (to subtract from what the mirrors must deliver)
  const direct = new Float64Array(n);
  let sDir = 0;
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const u = -half + (i + 0.5) * cell, v = -half + (j + 0.5) * cell;
    const X = RF.Engine.targetUVtoWorld(T, u, v);
    const d = V.sub(X, S), dist = V.len(d); if (!(dist > 1e-9)) continue;
    const dir = V.mul(d, 1 / dist);
    const cs = V.dot(dir, ax);
    if (src.kind === 'planar' && cs <= 0) continue;
    const I = pw * RF.Source.intensity(src, Math.acos(U.clamp(cs, -1, 1))) / totI;
    if (!(I > 0)) continue;
    const ct = -V.dot(dir, T.n);                     // lit side of the target faces the lamp (−x)
    if (ct <= 0) continue;
    direct[j * R + i] = I * ct * cellArea / (dist * dist);
    sDir += direct[j * R + i];
  }
  if (sDir > 0) notes.push('direct light on target: ' + sDir.toFixed(3) + ' lm');

  // -- candidate facet positions on the envelope
  const tdir = V.norm(V.sub(T.C, S));
  const Z0 = T.C;                                     // reference aim (target centre) for sizing
  // Working spot radius: big enough that N facet spots cover the paint (N*pi*rho^2 >= ~1.6 * painted
  // cells), but never below ~the kernel (the scorer forgives that blur anyway).  Spot radius ~ (L/r)*s/2,
  // so this picks the radial range the facets should live in.
  let nP = 0; for (let k = 0; k < n; k++) if (cells[k] > 0) nP++;
  const NL = Math.min(Nmax, 240);
  const rhoB = Math.max(ker.cells * 0.45, Math.sqrt(1.6 * Math.max(1, nP) / (Math.PI * NL)));   // cells
  const sApp = src.kind === 'planar' ? Math.min(src.w || 1e9, src.h || 1e9) : 2 * (src.radius || 1);
  const L = V.dist(T.C, S);
  const rReq = L * sApp / (2 * Math.max(0.5, rhoB) * cell);   // mm: spot radius ~ rhoB cells there
  const cap = src.kind === 'planar' ? Math.PI / 2 : Math.PI;
  const cosCap = Math.cos(Math.min(cap, Math.PI - 1e-6));
  const M = Math.min(560, Math.max(200, Nmax * 4));
  const push = U.clamp(+settings.push || 0.78, 0.05, 0.999);
  const sharp = +settings.sharp || 0;
  const cands = [];
  for (let k = 0; k < M; k++) {
    const ct = cosCap + (1 - cosCap) * (k + 0.5) / M;  // uniform in cos(theta) over the emitting cap
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const ph = 2 * Math.PI * ((k * 0.6180339887498949) % 1);
    const d = V.norm(V.add(V.add(V.mul(fr.u, st * Math.cos(ph)), V.mul(fr.v, st * Math.sin(ph))), V.mul(ax, ct)));
    const I = pw * RF.Source.intensity(src, Math.acos(U.clamp(ct, -1, 1))) / totI;
    if (!(I > 0)) continue;
    const iv = Geo.envInterval(env, S, d);
    const lo = Math.max(iv[0], keep), hi = iv[1];
    if (!(hi > lo + 1.0)) continue;
    const r = lo + push * (hi - lo);
    if (!(r > keep + 0.5)) continue;
    const P = V.add(S, V.mul(d, r));
    const Q = Geo.facetQuadric(P, S, Z0, V.dist(P, Z0));
    const bb = V.basis(Q.n), e1 = bb[0], e2 = V.cross(Q.n, e1);
    const rhoMax = maxRho(env, Slist, keep, P, Q, envTol, clrTol, 0.25 * (hi - lo));
    if (!(rhoMax > 0.4)) continue;
    const rho = Math.min(rhoMax, U.clamp(+settings.size || 4, 0.5, 50));   // working radius: small facets pack & stay sharp
    const sh = V.norm(V.sub(S, P));
    const ah = V.norm(V.sub(Z0, P));
    const cosB = V.dot(V.norm(V.add(sh, ah)), sh);    // cos of incidence = cos(half angle)
    if (!(cosB > 0.2)) continue;
    const A0 = Math.PI * rho * rho;
    const nearPen = r >= rReq ? 1 : Math.pow(r / rReq, 3);   // too-near facets make spots too big to cover
    const score = I * cosB * A0 * Math.pow(r, sharp - 2) * nearPen;
    const spotR = V.dist(P, Z0) / r * (src.kind === 'planar' ? Math.min(src.w || 1e9, src.h || 1e9) : 2 * (src.radius || 1)) * 0.5;
    cands.push({ P, d, r, rho, rhoMax, A0, I, cosB, score, Q, e1, e2, n: Q.n, spotR, rays: null });
  }
  if (!cands.length) return { surfaces: [], intent: [], notes: ['no facet position fits the envelope + clearance'] };
  cands.sort((a, b) => b.score - a.score);

  // -- greedy pick with spacing (also prevents mutual shadowing / overlap) and beam blocking
  const pack = Math.max(1.0, +settings.pack || 1.04);
  const N = Math.min(Nmax, cands.length);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= N) break;
    let ok = true;
    for (const q of picked) {
      if (V.dist(c.P, q.P) < pack * (c.rho + q.rho)) { ok = false; break; }
    }
    if (!ok) continue;
    // blocking: c's beam must not be cut by picked facets, and c must not cut theirs
    if (!c.rays) c.rays = beamRays(c.P, c.Q, c.e1, c.e2, c.n, c.rho * 0.8, Z0, c.spotR, T);
    for (const q of picked) {
      let blocked = 0;
      for (const ry of c.rays) if (discHit(q, ry.M, ry.d, ry.tmax)) blocked++;
      if (blocked > 0.25 * c.rays.length) { ok = false; break; }
      let cut = 0;
      for (const ry of q.rays) if (discHit(c, ry.M, ry.d, ry.tmax)) cut++;
      if (cut > 0.25 * q.rays.length) { ok = false; break; }
    }
    if (ok) { c.rays = c.rays; picked.push(c); for (const q of picked) if (!q.rays) q.rays = beamRays(q.P, q.Q, q.e1, q.e2, q.n, q.rho * 0.8, Z0, q.spotR, T); }
  }
  notes.push('candidates ' + cands.length + ' -> placed ' + picked.length + ' positions');

  // -- aims: weighted k-means over PAINTED target cells, weight = B (aim density ∝ blurred paint)
  const act = [];
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const k = j * R + i;
    if (cells[k] > 0 && B[k] > 0) act.push([-half + (i + 0.5) * cell, -half + (j + 0.5) * cell, B[k]]);
  }
  const cum = new Float64Array(act.length);
  let wTot = 0;
  for (let k = 0; k < act.length; k++) { wTot += act[k][2]; cum[k] = wTot; }
  const NA = picked.length;
  const ctr = [];
  for (let k = 0; k < NA; k++) {
    let x = rng.next() * wTot, lo = 0, hi = act.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
    ctr.push([act[lo][0] + (rng.next() - 0.5) * cell, act[lo][1] + (rng.next() - 0.5) * cell]);
  }
  // downsample the cell list if huge (keeps Lloyd fast)
  let list = act;
  if (act.length > 4000) {
    list = [];
    for (let k = 0; k < 4000; k++) {
      let x = rng.next() * wTot, lo = 0, hi = act.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; }
      list.push(act[lo]);
    }
  }
  const cw = new Float64Array(NA);
  for (let it = 0; it < 12; it++) {
    const sx = new Float64Array(NA), sy = new Float64Array(NA), sw = new Float64Array(NA);
    for (const c of list) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < NA; k++) { const du = c[0] - ctr[k][0], dv = c[1] - ctr[k][1], dd = du * du + dv * dv; if (dd < bd) { bd = dd; bi = k; } }
      sx[bi] += c[0] * c[2]; sy[bi] += c[1] * c[2]; sw[bi] += c[2];
    }
    for (let k = 0; k < NA; k++) {
      if (sw[k] > 0) ctr[k] = [sx[k] / sw[k], sy[k] / sw[k]];
      else { let x = rng.next() * wTot, lo = 0, hi = act.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } ctr[k] = [act[lo][0], act[lo][1]]; }
      cw[k] = sw[k];
    }
  }

  // -- pair aims to positions: biggest clusters to most capable facets
  const orderA = ctr.map((c, k) => k).sort((a, b) => cw[b] - cw[a]);
  const orderF = picked.map((c, k) => k).sort((a, b) => (picked[b].I * picked[b].cosB * picked[b].A0) - (picked[a].I * picked[a].cosB * picked[a].A0));
  const facets = [];
  for (let k = 0; k < NA; k++) {
    const c = picked[orderF[k]], aim = ctr[orderA[k]];
    const Z = RF.Engine.targetUVtoWorld(T, U.clamp(aim[0], -half, half), U.clamp(aim[1], -half, half));
    facets.push({ P: c.P, r: c.r, I: c.I, cosB: c.cosB, Z, di: V.dist(c.P, Z), rhoSel: c.rho });
  }

  // -- per-facet focus/defocus, max radius with the real aim, quadric frame, analytic spot.
  // fitSpot(f, rho) picks di (defocus widens the spot when the paint needs covering) and returns
  // the rasterised spot for a facet of radius rho; it also (re)computes rhoMax/capA.
  const spts = sourceSamples(src);
  // Gap-band size relative to the paint decides how big the spots may be: if the paint fills the target
  // (little band), big overlapping spots are free; if the paint is a small island, spots must stay tight.
  let nBand = 0;
  { const rb = Math.ceil(ker.cells) + 2;
    const dil = (src2, alongX) => { const out = new Uint8Array(n);
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { if (!src2[j * R + i]) continue; const c = alongX ? i : j;
        for (let q = Math.max(0, c - rb); q <= Math.min(R - 1, c + rb); q++) out[alongX ? j * R + q : q * R + i] = 1; }
      return out; };
    const pm = new Uint8Array(n); for (let k = 0; k < n; k++) if (cells[k] > 0) pm[k] = 1;
    const band = dil(dil(pm, true), false);
    for (let k = 0; k < n; k++) if (band[k] && !pm[k]) nBand++; }
  const bandRatio = nBand / Math.max(1, nP);
  const covF = 3.5 + 6 * U.clamp(0.6 - bandRatio, 0, 0.6) / 0.6;
  // Spot radius needed so that N spots cover the paint.
  const rbCells = Math.ceil(ker.cells) + 2;                       // gap band width (cells)
  let Rneed = Math.sqrt(covF * Math.max(1, nP) / (Math.PI * NL)) * cell;   // mm
  Rneed = Math.min(Rneed, Math.max(ker.cells * 0.5 * cell, (rbCells - 0.5) * cell));   // never wider than the band
  const sizeCap = U.clamp(Math.max(+settings.size || 3, 0.35 * Rneed), 0.5, 16);
  function fitSpot(f, rho) {
    const Lf = V.dist(f.P, f.Z);
    const geom = Lf * sApp * 0.5 / (2 * f.r);            // rough geometric spot radius (mm)
    let di = Lf;
    if (Rneed > geom + 0.3) {
      for (let it = 0; it < 7; it++) {                   // coverage-limited: defocus until the spot reaches Rneed
        const Q = Geo.facetQuadric(f.P, S, f.Z, di);
        const bb = V.basis(Q.n);
        const uv = spotUV(f.P, Q, bb[0], V.cross(Q.n, bb[0]), Q.n, rho, spts, T, S);
        const rad = spotRadius(uv);
        if (rad > 0 && Math.abs(rad - Rneed) < 0.06 * Rneed + 0.2) break;
        di = U.clamp(di * Math.pow(Math.max(0.2, rad / Rneed), 1.6), Lf / 60, Lf);
      }
    }
    f.di = di; f.geom = geom;
    const Q = Geo.facetQuadric(f.P, S, f.Z, di);
    const bb = V.basis(Q.n); f.n = Q.n; f.e1 = bb[0]; f.e2 = V.cross(Q.n, bb[0]); f.Q = Q;
    const rm = maxRho(env, Slist, keep, f.P, Q, envTol, clrTol, f.rhoSel);
    f.rhoMax = Math.max(0, Math.min(rm, f.rhoSel, sizeCap));
    f.capA = Math.PI * f.rhoMax * f.rhoMax;
    return rasterPoly(spotUV(f.P, Q, f.e1, f.e2, f.n, U.clamp(rho, 0.3, f.rhoMax), spts, T, S), R, half, cell);
  }
  for (const f of facets) f.fp = fitSpot(f, Math.min(f.rhoSel, sizeCap));

  // -- capped NNLS: choose areas A_k so that sum_k A_k*refl*I_k*cosB_k/r_k^2*p_k(c) + direct ≈ kappa*B.
  // kappa is deliberately below the total capacity: at full capacity the caps bind and distort the
  // shape; the scorer fits the overall scale itself, so only the SHAPE of the delivered field matters.
  const iters = Math.max(5, +settings.fit | 0);
  const level = U.clamp(+settings.level || 0.35, 0.02, 1);
  const u = facets.map((f) => f.I * f.cosB / (f.r * f.r));
  const capSum = facets.reduce((s, f, k) => s + f.capA * refl * u[k], 0);
  const kappa = level * (capSum + sDir) / (sB || 1);
  const t = new Float64Array(n);
  const wgt = new Float64Array(n);                 // fit cares about cells where the blurred paint lives
  { // gap band = paint dilated by ceil(kernel)+2 cells: there the allowance is only 0.1 x typical
    const rb = Math.ceil(ker.cells) + 2;
    const dil = (src, alongX) => { const out = new Uint8Array(n);
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) { if (!src[j * R + i]) continue; const c = alongX ? i : j;
        for (let q = Math.max(0, c - rb); q <= Math.min(R - 1, c + rb); q++) out[alongX ? j * R + q : q * R + i] = 1; }
      return out; };
    const pm = new Uint8Array(n); let nP = 0;
    for (let k = 0; k < n; k++) if (cells[k] > 0) { pm[k] = 1; nP++; }
    const band = dil(dil(pm, true), false);
    const typ = sp / Math.max(1, nP);
    for (let k = 0; k < n; k++) {
      if (B[k] > 0) { wgt[k] = 1; t[k] = Math.max(0, kappa * B[k] - direct[k]); }
      else if (band[k]) { wgt[k] = 3; t[k] = 0.05 * kappa * typ; }   // stay well under the 0.1 x typ allowance
      else { wgt[k] = 0.02; t[k] = 0; }
    }
  }
  function nnls(round) {
    const coef = facets.map((f, k) => {
      const cs = [], base = refl * u[k];
      for (const [c, w] of f.fp) if (w > 1e-4) cs.push([c, base * w]);
      return cs;
    });
    const num = facets.map((f, k) => { let s = 0; for (const [c, w] of coef[k]) s += w * t[c] * wgt[c]; return s; });
    const A = facets.map((f) => f.capA * 0.5);
    const pred = new Float64Array(n);
    for (let k = 0; k < facets.length; k++) { const Ak = A[k]; for (const [c, w] of coef[k]) pred[c] += Ak * w; }
    for (let it = 0; it < iters; it++) {
      for (let k = 0; k < facets.length; k++) {          // Gauss-Seidel: update pred as we go
        let den = 0; for (const [c, w] of coef[k]) den += w * pred[c] * wgt[c];
        let Anew = 0;
        if (den > 0 && num[k] > 0) Anew = U.clamp(A[k] * num[k] / den, 0, facets[k].capA);
        const d = Anew - A[k];
        if (d !== 0) { A[k] = Anew; for (const [c, w] of coef[k]) pred[c] += d * w; }
      }
    }
    return { A, pred };
  }
  let fit = nnls(0);
  // second round: recalibrate focus and spots with the areas the fit actually chose, then refit
  for (let k = 0; k < facets.length; k++) {
    const f = facets[k];
    const rho = Math.sqrt(Math.max(0, fit.A[k]) / Math.PI);
    f.fp = fitSpot(f, U.clamp(rho, 0.3, Math.min(f.rhoSel, sizeCap)));
  }
  fit = nnls(1);
  const A = fit.A, pred = fit.pred;

  // -- emit surfaces
  const surfaces = [], intent = [];
  let used = 0, caught = 0, onPaint = 0, totPow = pw;
  { // how well did the area fit reproduce its own target? (solver-side sanity check)
    let sp2 = 0, st2 = 0;
    for (let k = 0; k < n; k++) if (cells[k] > 0) { sp2 += pred[k]; st2 += t[k]; }
    notes.push('area fit delivered ' + (100 * sp2 / (st2 || 1)).toFixed(0) + '% of its target, spot radius target ' + Rneed.toFixed(1) + 'mm');
  }
  for (let k = 0; k < facets.length; k++) {
    const f = facets[k];
    const rho = Math.sqrt(Math.max(0, A[k]) / Math.PI);
    if (!(rho > 0.25)) continue;
    const rr = Math.min(rho, f.rhoMax * 0.995);
    if (!(rr > 0.2)) continue;
    const id = 'f' + k;
    surfaces.push({
      type: 'facet', id, P: f.P.slice(), S0: S.slice(), Z: f.Z.slice(),
      flat: false, di: f.di,
      clip: { kind: 'disc', r: rr },
      optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
    });
    const cellsOut = [];
    let caughtHere = 0, onP = 0;
    for (const [c, w] of f.fp) {
      cellsOut.push([c, +w.toFixed(4)]);
      caughtHere += refl * u[k] * Math.PI * rr * rr * w;
      if (cells[c] > 0) onP += refl * u[k] * Math.PI * rr * rr * w;
    }
    intent.push({ facet: id, cells: cellsOut });
    used++; caught += caughtHere; onPaint += onP;
  }
  notes.push('facets ' + used + ', caught ' + caught.toFixed(1) + ' lm of ' + totPow.toFixed(1) + ' (' + (100 * caught / totPow).toFixed(1) + '%), est onPaint ' + (100 * onPaint / totPow).toFixed(1) + '%');

  // -- final safety: make sure no two discs overlap in 3D (they were spaced by rhoSel already)
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < surfaces.length; i++) for (let j = i + 1; j < surfaces.length; j++) {
      const ri = surfaces[i].clip.r, rj = surfaces[j].clip.r;
      const dd = V.dist(surfaces[i].P, surfaces[j].P);
      if (dd < ri + rj - 1e-9) {
        const s = 0.995 * dd / (ri + rj);
        surfaces[i].clip.r *= s; surfaces[j].clip.r *= s;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { surfaces, intent, notes, extras: { kappa } };
}

RF.Solvers.register({
  id: 'bench-mistrallarge4--facet-painter',
  name: 'Facet painter (static)',
  version: '1.0',
  modes: ['paint'],
  settings: PAINTER_SETTINGS,
  solve: (input, settings, tools) => paintSolve(input, settings, tools),
});

// Footprint = average of (uniform over the spot hull) and (landing-point density): the true spot has a
// bright core (the LED image) inside a softer skirt, so neither alone is right.
function blendRaster(uv, R, half, cell) {
  const a = rasterPoly(uv, R, half, cell), b = rasterPoints(uv, R, half);
  const m = new Map();
  for (const [c, w] of a) m.set(c, w * 0.5);
  for (const [c, w] of b) m.set(c, (m.get(c) || 0) + w * 0.5);
  const res = [];
  for (const [c, w] of m) res.push([c, w]);
  return res;
}

// Splat a cloud of landing points (target u,v) into the paint grid, bilinearly, uniform weights.
// Returns [[cellIndex, weight]] with sum(weight) = fraction of points landing on the grid.
function rasterPoints(uv, R, half) {
  const out = new Map();
  if (!uv.length) return [];
  for (const p of uv) {
    const gx = (p[0] + half) / (2 * half) * R - 0.5, gy = (p[1] + half) / (2 * half) * R - 0.5;
    const i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
    for (const [di, dj, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || i >= R || j < 0 || j >= R) continue;
      const c = j * R + i;
      out.set(c, (out.get(c) || 0) + w);
    }
  }
  const res = [];
  const inv = 1 / uv.length;
  for (const [c, w] of out) res.push([c, w * inv]);
  return res;
}

// Rasterise a convex polygon given in target (u,v) into the paint grid: subsample grid inside the
// hull, bilinear splat.  Returns [[cellIndex, weight]] with sum(weight) = fraction landing on the grid.
function rasterPoly(uv, R, half, cell) {
  const h = hull2(uv);
  if (h.length < 3) return [];
  let minu = Infinity, maxu = -Infinity, minv = Infinity, maxv = -Infinity;
  for (const p of h) { minu = Math.min(minu, p[0]); maxu = Math.max(maxu, p[0]); minv = Math.min(minv, p[1]); maxv = Math.max(maxv, p[1]); }
  const area = Math.abs(polyArea(h));
  const ns = U.clamp(Math.ceil(Math.sqrt(Math.max(1, area / (cell * cell)))), 3, 20);
  const out = new Map();
  let cnt = 0;
  for (let a = 0; a < ns; a++) for (let b = 0; b < ns; b++) {
    const u = minu + (a + 0.5) / ns * (maxu - minu);
    const v = minv + (b + 0.5) / ns * (maxv - minv);
    if (!inHull(h, u, v)) continue;
    cnt++;
    const gx = (u + half) / (2 * half) * R - 0.5, gy = (v + half) / (2 * half) * R - 0.5;
    const i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
    for (const [di, dj, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || i >= R || j < 0 || j >= R) continue;
      const c = j * R + i;
      out.set(c, (out.get(c) || 0) + w);
    }
  }
  if (!cnt) return [];
  const res = [];
  for (const [c, w] of out) res.push([c, w / cnt]);
  return res;
}
function polyArea(h) {
  let a = 0;
  for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// ---------------------------------------------------------------- tuner --
// Optional tuner (id ends in -auto, so it may call tools.trace inside solve()): it runs the static solver
// above on a small fixed pool of setting variants, traces every candidate with the SAME seed (so differences
// are geometry, not dice), and returns the candidate that best serves the selected goal:
//   faithful  — highest fidelity (F1 of painted-within x gaps-dark)
//   throw     — longest throw (m) among candidates whose fidelity is within 90% of the best
//   efficient — highest fidelity x onPaint (the score's light term) — bright and well-aimed
// Everything is decided up front from the budgets (no wall-clock branching), so the output is deterministic.

const AUTO_POOL = [
  { tag: 'defaults' },
  { tag: 'sharp2', sharp: 2 },
  { tag: 'sharp4', sharp: 4 },
  { tag: 'level.85', level: 0.85 },
  { tag: 'level.5', level: 0.5 },
  { tag: 'size2.5', size: 2.5 },
  { tag: 'size4', size: 4 },
  { tag: 'push.9', push: 0.9 },
  { tag: 'near', push: 0.66, sharp: 2, level: 0.8 },
  { tag: 'far', push: 0.95, sharp: 5, level: 0.9, size: 4 },
  { tag: 'wide', size: 5, level: 0.95 },
  { tag: 'combo', sharp: 4, level: 0.85, size: 3.5, push: 0.85 },
];
const AUTO_BASE = { push: 0.78, size: 3, pack: 1.04, sharp: 3, level: 0.7, fit: 200 };

RF.Solvers.register({
  id: 'bench-mistrallarge4--facet-painter-auto',
  name: 'Facet painter (auto-tuned)',
  version: '1.0',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'Shared paint control: facets stay at least this far from the LED.' },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful', help: 'What the tuner optimises when picking the static solver\'s settings for this scene.' },
    { key: 'variants', label: 'Candidates traced', type: 'range', min: 3, max: 12, step: 1, default: 12, help: 'How many setting variants are solved and traced (same seed for every trace).' },
    { key: 'probeRays', label: 'Trace rays per candidate', type: 'range', min: 100000, max: 2000000, step: 100000, default: 400000, help: 'Rays per comparison trace; the seed is identical for every candidate, so differences between candidates are geometry, not noise.' },
  ],
  async solve(input, settings, tools) {
    const goal = settings.goal || 'faithful';
    const base = Object.assign({}, AUTO_BASE, { minDistance: +settings.minDistance || 0 });
    const canTrace = tools && typeof tools.trace === 'function';
    if (!canTrace) return paintSolve(input, base, tools);          // no host tracing: just use the defaults

    // deterministic plan: how many candidates, how many rays each (from the host budget, never the clock)
    let pool = AUTO_POOL.slice(0, Math.max(3, Math.min(AUTO_POOL.length, +settings.variants | 0 || AUTO_POOL.length)));
    let perRays = Math.max(100000, Math.min(2000000, +settings.probeRays || 400000));
    const br = tools.budget && isFinite(tools.budget.rays) ? tools.budget.rays : Infinity;
    if (isFinite(br)) perRays = Math.max(100000, Math.min(perRays, Math.floor(br * 0.5 / pool.length)));
    const seed = (input.seed | 0) ^ 0x9e3779b9;                    // same seed for every candidate trace

    const rows = [];
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      const st = Object.assign({}, base, cand);
      let out = null;
      try { out = paintSolve(input, st, tools); } catch (e) { rows.push({ tag: cand.tag, st, err: 'solve: ' + String(e && e.message || e).slice(0, 50) }); continue; }
      if (!out.surfaces || !out.surfaces.length) { rows.push({ tag: cand.tag, st, err: 'no surfaces' }); continue; }
      let tr = null;
      try { tr = tools.trace(out.surfaces, { rays: perRays, seed }); } catch (e) { rows.push({ tag: cand.tag, st, out, err: 'trace: ' + String(e && e.message || e).slice(0, 50) }); continue; }
      const f = (tr && tr.fidelity) || {};
      rows.push({
        tag: cand.tag, st, out,
        fid: +f.fidelity || 0, within: +f.within || 0, gaps: +f.gapsDark || 0, onPaint: +f.onPaint || 0,
        throwM: +(tr && tr.throwM) || 0, peakCd: +(tr && tr.peakCd) || 0, blocked: +(tr && tr.blocked) || 0,
      });
      if (tools.progress) try { tools.progress((i + 1) / pool.length); } catch (e) {}
    }
    const ok = rows.filter((r) => !r.err && r.out);
    let pick = null;
    if (ok.length) {
      const maxFid = Math.max(...ok.map((r) => r.fid));
      if (goal === 'throw') {
        const q = ok.filter((r) => r.fid >= 0.9 * maxFid);
        pick = (q.length ? q : ok).reduce((a, b) => (b.throwM > a.throwM ? b : a));
      } else if (goal === 'efficient') {
        pick = ok.reduce((a, b) => (b.fid * b.onPaint > a.fid * a.onPaint ? b : a));
      } else {
        pick = ok.reduce((a, b) => (b.fid > a.fid || (b.fid === a.fid && b.onPaint > a.onPaint) ? b : a));
      }
    }
    if (!pick) {                                                  // nothing traced cleanly: fall back to defaults
      const out = paintSolve(input, base, tools);
      return Object.assign({}, out, { notes: ['auto: no candidate traced cleanly — fell back to defaults'].concat(out.notes || []) });
    }
    const fmt = (x, d) => (x || 0).toFixed(d === undefined ? 3 : d);
    const notes = ['auto goal=' + goal + ': picked ' + pick.tag + ' ' + JSON.stringify(pick.st) +
      ' — fid ' + fmt(pick.fid) + ' (within ' + fmt(pick.within) + ', gaps ' + fmt(pick.gaps) + '), onPaint ' + fmt(pick.onPaint) +
      ', throw ' + fmt(pick.throwM, 0) + ' m, peak ' + fmt(pick.peakCd, 0) + ' cd  [' + ok.length + '/' + pool.length + ' candidates, ' + perRays + ' rays each, seed ' + seed + ']']
      .concat(rows.map((r) => '  ' + r.tag + (r.err ? ' ERR ' + r.err : ': fid ' + fmt(r.fid) + ' onPaint ' + fmt(r.onPaint) + ' throw ' + fmt(r.throwM, 0) + 'm peak ' + fmt(r.peakCd, 0))));
    return Object.assign({}, pick.out, { notes: notes.concat(pick.out.notes || []) });
  },
});

})();
