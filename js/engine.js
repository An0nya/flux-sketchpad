/* engine.js — the simulation engine: Monte-Carlo ray tracer with occlusion (nearest hit via a
 * BVH), per-interaction-type dispatch (reflect / refract+TIR / absorb), bounce cap, energy floor,
 * separate direct / reflected accumulators, full energy bookkeeping, progressive (time-sliced)
 * accumulation, and a single-ray probe that runs through the *same* per-ray code path.
 *
 * Determinism: ray i draws its random numbers from a stream seeded by (seed, i) only, and rays are
 * always accumulated in index order, so chunked/progressive runs are bit-identical to one-shot
 * runs.  The platform's unseeded RNG is never used.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V, Geo } = RF;
  const STRIDE = Geo.STRIDE;
  const HIT = Geo.HIT;

  // ---------------------------------------------------------------- target plane pose
  /* The throw axis is world +x.  The plane centre sits at (distance, 0, 0); its lit side faces
   * back toward the fixture (normal −x).  u = "right" and v = "up" as seen from the fixture, so
   * the heatmap is drawn as the lit face looks from the lamp.  tiltY yaws about v, tiltX pitches
   * about u.                                                                                  */
  function targetFrame(t) {
    let n = [-1, 0, 0], tu = [0, -1, 0], tv = [0, 0, 1];
    const ay = (t.tiltY || 0) * Math.PI / 180, ax = (t.tiltX || 0) * Math.PI / 180;
    if (ay) { n = V.rotate(n, tv, ay); tu = V.rotate(tu, tv, ay); }
    if (ax) { n = V.rotate(n, tu, ax); tv = V.rotate(tv, tu, ax); }
    const C = [t.distance, 0, 0];
    return { C, n, tu, tv, half: t.size / 2, res: t.res | 0 };
  }
  function aimPoint(t) { return t.linked !== false ? [t.distance, 0, 0] : t.aim.slice(); }
  // Design plane: where zones and stamps are defined and aimed.  Linked (default): the
  // target plane itself.  Unlinked: the target plane's orientation, centred on the aim point — so
  // moving the target plane afterwards shows the design out of focus instead of re-aiming it.
  function designFrame(t) { const T = targetFrame(t); if (t.linked === false) T.C = t.aim.slice(); return T; }
  // target-plane (u,v) ↔ world
  function targetUVtoWorld(T, u, v) { return V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v))); }
  function worldToTargetUV(T, p) { const d = V.sub(p, T.C); return [V.dot(d, T.tu), V.dot(d, T.tv)]; }
  function cellCenter(T, i, j) { const s = 2 * T.half / T.res; return [-T.half + (i + 0.5) * s, -T.half + (j + 0.5) * s]; }

  // ---------------------------------------------------------------- prepare
  function prepare(scene, surfaces) {
    const G = Geo.compile(surfaces);
    const T = targetFrame(scene.target);
    const S = RF.Source.makeSampler(scene.source);
    const env = scene.envelope;
    // Length scale for relative epsilons: size of the optics + source + envelope.  Never an
    // absolute constant — geometric optics has no intrinsic length scale.
    let scale = 0;
    if (G.n) scale = Math.max(G.hi[0] - G.lo[0], G.hi[1] - G.lo[1], G.hi[2] - G.lo[2]);
    scale = Math.max(scale, RF.Source.boundingRadius(scene.source) * 2, Math.max(...env.half) * 2);
    for (let i = 0; i < 3; i++) scale = Math.max(scale, Math.abs(scene.source.pos[i]));
    const sim = scene.sim;
    const P = {
      G, T, S, scale, eps: 1e-9 * scale,
      cap: Math.max(1, Math.min(8, sim.bounces | 0)),
      floor: Math.max(0, sim.floor),
      seed: sim.seed | 0,
      power: scene.source.power,
      res: T.res,
      surfaces,
    };
    P.res = simRes(scene, P);
    return P;
  }
  // Simulation grid N×N — independent of the paint grid (target.res).  Auto: a 4,000-ray pilot on a
  // coarse 24×24 grid measures the on-target fraction and the lit-area fraction, then picks N for
  // ~50 rays per lit cell (±14% shot noise).  Deterministic (same seed), and never uses a previous run.
  const AUTO_RAYS_PER_CELL = 50;
  function simRes(scene, P) {
    const sim = scene.sim, clamp = (n) => Math.max(10, Math.min(1000, Math.round(n)));
    if (!sim.autoRes) return clamp(sim.res || P.T.res);
    const Pp = Object.assign({}, P, { res: 24 }), c = runSync(Pp, 4000);
    const on = (c.E.direct + c.E.reflected) / (c.E.emitted || 1);
    let lit = 0; for (let i = 0; i < 576; i++) if (c.gridD[i] + c.gridR[i] > 0) lit++;
    if (!(on > 0) || !lit) return clamp(P.T.res);
    const n = Math.sqrt((sim.rays * on) / (AUTO_RAYS_PER_CELL * (lit / 576)));
    return clamp(Math.round(n / 10) * 10);
  }

  function newCtx(P, N, pathLimit) {
    const cells = P.res * P.res;
    return {
      P, N, next: 0,
      gridD: new Float64Array(cells), gridR: new Float64Array(cells),
      // raw lit-side hits (u, v, energy) for the ray-hits view; only when the caller asks (P.recordHits).
      // Per hit, also: hitK = 1 + the surface the ray met FIRST (0 = direct from the source), hitB = bounces.
      // First, not last: a facet's flux share is what it takes from the source, so that is whose light it is.
      hits: P.recordHits ? new Float32Array(3 * Math.min(N, P.hitCap || 2e6)) : null, nHits: 0, hitCap: Math.min(N, P.hitCap || 2e6),   // P.hitCap: tests only
      hitK: P.recordHits ? new (P.G.n < 65535 ? Uint16Array : Uint32Array)(Math.min(N, P.hitCap || 2e6)) : null,
      hitB: P.recordHits ? new Uint8Array(Math.min(N, P.hitCap || 2e6)) : null,
      // per hit: which ray it was (so it can be retraced); per ray: 1 + first surface met (0 = none)
      hitI: P.recordHits ? new Uint32Array(Math.min(N, P.hitCap || 2e6)) : null,
      rayK: P.recordHits ? new (P.G.n < 65535 ? Uint16Array : Uint32Array)(N) : null, curI: 0,
      E: { emitted: 0, direct: 0, reflected: 0, absorbed: 0, backface: 0, interfaceLoss: 0, escaped: 0, targetBack: 0, truncated: 0, intercepted: 0, reHit: 0, tir: 0 },
      surfIn: new Float64Array(Math.max(1, P.G.n)),
      // occlusion: light that left one surface and then ended on another without landing (blocked), per first surface
      occ: { blocked: 0, blockedK: new Float64Array(Math.max(1, P.G.n)), out1: 0, out1K: new Float64Array(Math.max(1, P.G.n)), shadow: null },   // out1 = light leaving the first surface
      // exit rays (P.recordExit): every ray's LAST straight leg (origin, unit direction, energy, bounces) once it is
      // past the optics — it ended on the target plane (either face) or escaped.  That leg is what a goniometer sees
      // (far field, js/farfield.js) and what a plane at ANY distance would catch, without retracing.  One per ray at
      // most, in ray order; capped like hits (exitCoverage says which rays are covered).
      ex: P.recordExit ? newExit(Math.min(N, P.exitCap || 2e6)) : null,
      // far-field streams (P.ffStreams = [grid opts]): exit legs binned by direction / screen position as they happen — the
      // same grids FarField.build makes from stored exits, without storing them, so a run can have any number of rays
      ff: P.ffStreams && P.ffStreams.length ? P.ffStreams.map((o) => RF.FarField.newStream(o)) : null,
      // guided emission (P.guideLearn): which emission directions land where in the first stream, coarsely — what a guided
      // Refine needs to send more rays toward the dim parts of the window (buildGuide)
      gl: P.guideLearn && P.ffStreams && P.ffStreams.length ? newLearn(P.ffStreams[0]) : null, curB: 0,
      paths: [], pathLimit: pathLimit === undefined ? 240 : pathLimit,
      elapsed: 0, done: N === 0,
    };
  }

  // ---- guided emission
  // Emission bins: GA × GB cells of the two direction uniforms (x3, x4) — equal probability under the source's own
  // distribution.  A guide is a probability per bin; ray i of a guided segment draws its bin from it and carries the
  // weight (1 / NB) / q (unbiased: every expectation is unchanged, only where the rays go changes).
  const GA = 32, GB = 32, NB = GA * GB, GCELL = 0.5;
  let LASTB = 0;
  function newLearn(o) {
    const S = RF.FarField.newStream(o), kc = Math.max(1, Math.round(GCELL / S.step)), nci = Math.ceil(S.nh / kc), ncj = Math.ceil(S.nv / kc);
    return { kc, nci, ncj, NC: nci * ncj, nh: S.nh, H: new Float32Array(NB * nci * ncj), Hn: new Float32Array(NB) };
  }
  function learnAdd(gl, b, m) { const i = m % gl.nh, j = (m - i) / gl.nh; gl.H[b * gl.NC + Math.floor(j / gl.kc) * gl.nci + Math.floor(i / gl.kc)] += 1; }
  /* A guide from a run so far: emission bins whose rays land where the window is DIM get more rays.  Importance of a
   * coarse cell = 1 / max(I, floor) (rays per solid angle evened out, so the relative noise is too); a bin's value = the
   * mean importance of its rays (0 for rays that left the window); q = α / NB + (1 − α) × value share — the α part keeps
   * every bin possible and caps the weight at 1 / α.  null when the run learned nothing.                              */
  function buildGuide(ctx, alpha) {
    const gl = ctx.gl, S = ctx.ff && ctx.ff[0]; if (!gl || !S) return null;
    alpha = alpha === undefined ? 0.3 : alpha;
    const Ec = new Float64Array(gl.NC), Oc = new Float64Array(gl.NC);
    for (let j = 0; j < S.nv; j++) for (let i = 0; i < S.nh; i++) {
      const c = Math.floor(j / gl.kc) * gl.nci + Math.floor(i / gl.kc);
      Ec[c] += S.E[j * S.nh + i]; Oc[c] += RF.FarField.binOmega(S.h0 + i * S.step, S.h0 + (i + 1) * S.step, S.v0 + j * S.step, S.v0 + (j + 1) * S.step, S.conv);
    }
    let pk = 0; const I = new Float64Array(gl.NC); for (let c = 0; c < gl.NC; c++) { I[c] = Oc[c] > 0 ? Ec[c] / Oc[c] : 0; if (I[c] > pk) pk = I[c]; }
    if (!(pk > 0)) return null;
    const floor = 5e-4 * pk, imp = I.map((x) => 1 / Math.max(x, floor));
    const v = new Float64Array(NB); let sv = 0, seen = 0;
    for (let b = 0; b < NB; b++) { if (!(gl.Hn[b] > 0)) continue; let a = 0; const o = b * gl.NC; for (let c = 0; c < gl.NC; c++) if (gl.H[o + c]) a += gl.H[o + c] * imp[c]; v[b] = a / gl.Hn[b]; sv += v[b]; seen++; }
    if (!(sv > 0)) return null;
    const mean = sv / seen; for (let b = 0; b < NB; b++) if (!(gl.Hn[b] > 0)) { v[b] = mean; sv += mean; }
    const q = new Float64Array(NB), cdf = new Float64Array(NB + 1);
    for (let b = 0; b < NB; b++) { q[b] = alpha / NB + (1 - alpha) * v[b] / sv; cdf[b + 1] = cdf[b] + q[b]; }
    for (let b = 0; b <= NB; b++) cdf[b] /= cdf[NB];
    for (let b = 0; b < NB; b++) q[b] = cdf[b + 1] - cdf[b];
    let wMax = 0; for (let b = 0; b < NB; b++) wMax = Math.max(wMax, 1 / (NB * q[b]));
    return { q, cdf, wMax, alpha };
  }

  function newExit(cap) { return { o: new Float32Array(3 * cap), d: new Float32Array(3 * cap), e: new Float32Array(cap), b: new Uint8Array(cap), i: new Uint32Array(cap), n: 0, cap }; }
  function recExit(ctx, ox, oy, oz, dx, dy, dz, E, bounces) {
    const x = ctx.ex; if (x.n >= x.cap) return;
    const n = x.n++, q = 3 * n;
    x.o[q] = ox; x.o[q + 1] = oy; x.o[q + 2] = oz; x.d[q] = dx; x.d[q + 1] = dy; x.d[q + 2] = dz; x.e[n] = E; x.b[n] = bounces > 255 ? 255 : bounces; x.i[n] = ctx.curI;
  }
  // rays whose exit legs are all recorded (as hitCoverage): scale exit sums by THIS, not ctx.next
  function exitCoverage(ctx) {
    const x = ctx.ex; if (!x) return 0;
    return x.n < x.cap ? ctx.next : x.i[x.n - 1] + 1;   // each ray records at most once, so every ray up to the last recorded one is complete
  }

  /* ---------------------------------------------------------------- one ray, all bounces
   * ctx receives accumulation; probe (optional) receives a list of events for single-ray
   * previews and unit checks.  Returns nothing; everything is accounted in ctx.E.          */
  const nrm = new Float64Array(3);
  const stack = new Int32Array(128);
  function traceOne(P, ctx, ox, oy, oz, dx, dy, dz, E, rec, probe) {
    const G = P.G, D = G.D, poly = G.poly, bvh = G.bvh, T = P.T, eps = P.eps;
    const bmin = bvh.bmin, bmax = bvh.bmax, left = bvh.left, right = bvh.right, bstart = bvh.start, bcount = bvh.count, items = bvh.items;
    const e0 = E, floorE = E * P.floor;
    const tn0 = T.n[0], tn1 = T.n[1], tn2 = T.n[2];
    let bounces = 0, tmin = eps, firstK = -1;
    for (;;) {
      // ---- nearest surface (occlusion: only the nearest hit along the ray counts)
      let tBest = Infinity, kBest = -1, hx = 0, hy = 0, hz = 0;
      if (G.n > 0) {
        const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
        let sp = 0; stack[sp++] = 0;
        while (sp > 0) {
          const nd = stack[--sp], b3 = 3 * nd;
          let t1 = (bmin[b3] - ox) * ix, t2 = (bmax[b3] - ox) * ix;
          let tn = t1 < t2 ? t1 : t2, tf = t1 < t2 ? t2 : t1;
          t1 = (bmin[b3 + 1] - oy) * iy; t2 = (bmax[b3 + 1] - oy) * iy;
          tn = Math.max(tn, t1 < t2 ? t1 : t2); tf = Math.min(tf, t1 < t2 ? t2 : t1);
          t1 = (bmin[b3 + 2] - oz) * iz; t2 = (bmax[b3 + 2] - oz) * iz;
          tn = Math.max(tn, t1 < t2 ? t1 : t2); tf = Math.min(tf, t1 < t2 ? t2 : t1);
          if (!(tf >= tn) || tf < tmin || tn > tBest) continue;       // NaN-safe
          if (left[nd] < 0) {
            const s0 = bstart[nd], s1 = s0 + bcount[nd];
            for (let s = s0; s < s1; s++) {
              const k = items[s];
              const t = Geo.intersect(D, poly, k, ox, oy, oz, dx, dy, dz, tmin, tBest);
              if (t >= 0 && (t < tBest || (t === tBest && D[k * STRIDE + 35] < D[kBest * STRIDE + 35]))) {
                tBest = t; kBest = k; hx = HIT[0]; hy = HIT[1]; hz = HIT[2];
              }
            }
          } else { stack[sp++] = left[nd]; stack[sp++] = right[nd]; }
        }
      }
      // ---- target plane (a finite rectangle; it also occludes)
      const den = dx * tn0 + dy * tn1 + dz * tn2;
      if (den !== 0) {
        const t = ((T.C[0] - ox) * tn0 + (T.C[1] - oy) * tn1 + (T.C[2] - oz) * tn2) / den;
        if (t > tmin && t < tBest) {
          const px = ox + t * dx - T.C[0], py = oy + t * dy - T.C[1], pz = oz + t * dz - T.C[2];
          const u = px * T.tu[0] + py * T.tu[1] + pz * T.tu[2], v = px * T.tv[0] + py * T.tv[1] + pz * T.tv[2];
          if (Math.abs(u) <= T.half && Math.abs(v) <= T.half) {
            if (rec) rec.push(ox + t * dx, oy + t * dy, oz + t * dz);
            if (ctx.ex) recExit(ctx, ox, oy, oz, dx, dy, dz, E, bounces);
            if (ctx.ff) { const m0 = RF.FarField.binExit(ctx.ff[0], ox, oy, oz, dx, dy, dz, E); for (let k = 1; k < ctx.ff.length; k++) RF.FarField.binExit(ctx.ff[k], ox, oy, oz, dx, dy, dz, E); if (ctx.gl && m0 >= 0) learnAdd(ctx.gl, ctx.curB, m0); }
            if (den < 0) {                         // lit side
              const r = P.res;
              let iu = Math.floor((u + T.half) / (2 * T.half) * r), iv = Math.floor((v + T.half) / (2 * T.half) * r);
              if (iu >= r) iu = r - 1; if (iv >= r) iv = r - 1;
              const cell = iv * r + iu;
              if (ctx.hits && ctx.nHits < ctx.hitCap) { const h = ctx.nHits++, q = 3 * h; ctx.hits[q] = u; ctx.hits[q + 1] = v; ctx.hits[q + 2] = E; ctx.hitK[h] = firstK + 1; ctx.hitB[h] = bounces; ctx.hitI[h] = ctx.curI; }
              if (bounces === 0) { ctx.gridD[cell] += E; ctx.E.direct += E; } else { ctx.gridR[cell] += E; ctx.E.reflected += E; }
              if (probe) probe.push({ type: 'target', t, u, v, cell, point: [ox + t * dx, oy + t * dy, oz + t * dz], E });
              if (rec) rec.end = bounces === 0 ? 'direct' : 'target';
            } else {
              ctx.E.targetBack += E;
              if (probe) probe.push({ type: 'targetBack', t, u, v });
              if (rec) rec.end = 'back';
            }
            return;
          }
        }
      }
      if (kBest < 0) {
        ctx.E.escaped += E;
        if (ctx.ex) recExit(ctx, ox, oy, oz, dx, dy, dz, E, bounces);
        if (ctx.ff) { const m0 = RF.FarField.binExit(ctx.ff[0], ox, oy, oz, dx, dy, dz, E); for (let k = 1; k < ctx.ff.length; k++) RF.FarField.binExit(ctx.ff[k], ox, oy, oz, dx, dy, dz, E); if (ctx.gl && m0 >= 0) learnAdd(ctx.gl, ctx.curB, m0); }
        if (rec) { const L = P.scale * 1.5; rec.push(ox + L * dx, oy + L * dy, oz + L * dz); rec.end = 'escape'; }
        if (probe) probe.push({ type: 'escape', dir: [dx, dy, dz] });
        return;
      }
      // ---- surface interaction
      const wx = ox + tBest * dx, wy = oy + tBest * dy, wz = oz + tBest * dz;
      if (rec) rec.push(wx, wy, wz);
      if (bounces === 0) { ctx.E.intercepted += e0; firstK = kBest; if (ctx.rayK) ctx.rayK[ctx.curI] = kBest + 1; } else ctx.E.reHit += E;
      ctx.surfIn[kBest] += E;
      if (bounces >= P.cap) {                      // blocked here: bounce budget exhausted
        ctx.E.truncated += E;
        if (bounces >= 1) { ctx.occ.blocked += E; ctx.occ.blockedK[firstK] += E; }
        if (probe) probe.push({ type: 'cap', k: kBest, point: [wx, wy, wz] });
        if (rec) rec.end = 'cap';
        return;
      }
      bounces++;
      Geo.frontNormal(D, kBest, hx, hy, hz, nrm);
      const nx = nrm[0], ny = nrm[1], nz = nrm[2];
      const cosI = dx * nx + dy * ny + dz * nz;    // < 0: arriving at the front face
      const ko = kBest * STRIDE, inter = D[ko + 28];
      const ev = probe ? { type: '', k: kBest, point: [wx, wy, wz], normal: [nx, ny, nz], front: cosI < 0, dIn: [dx, dy, dz] } : null;
      if (inter === 2) {                           // absorb
        ctx.E.absorbed += E; if (bounces >= 1) { ctx.occ.blocked += E; ctx.occ.blockedK[firstK] += E; } if (ev) { ev.type = 'absorb'; probe.push(ev); } if (rec) rec.end = 'absorb';
        return;
      }
      if (inter === 0) {                           // reflect
        if (cosI > 0 && D[ko + 32] === 0) {        // back face of a one-sided mirror absorbs
          ctx.E.backface += E; if (bounces >= 1) { ctx.occ.blocked += E; ctx.occ.blockedK[firstK] += E; } if (ev) { ev.type = 'backface'; probe.push(ev); } if (rec) rec.end = 'absorb';
          return;
        }
        const R = D[ko + 29];
        ctx.E.absorbed += E * (1 - R); E *= R;
        const k2 = 2 * cosI;
        dx -= k2 * nx; dy -= k2 * ny; dz -= k2 * nz;
        if (ev) ev.type = 'reflect';
      } else {                                     // refract (Snell) or TIR
        let n1, n2, mx, my, mz, ci;
        if (cosI < 0) { n1 = 1; n2 = D[ko + 30]; mx = nx; my = ny; mz = nz; ci = -cosI; }
        else { n1 = D[ko + 30]; n2 = 1; mx = -nx; my = -ny; mz = -nz; ci = cosI; }
        const eta = n1 / n2, k = 1 - eta * eta * (1 - ci * ci);
        if (k < 0) {                               // no real solution: total internal reflection
          dx += 2 * ci * mx; dy += 2 * ci * my; dz += 2 * ci * mz;
          ctx.E.tir += E;
          if (ev) ev.type = 'tir';
        } else {
          const Tf = D[ko + 31];
          ctx.E.interfaceLoss += E * (1 - Tf); E *= Tf;
          const ct = Math.sqrt(k), f = eta * ci - ct;
          dx = eta * dx + f * mx; dy = eta * dy + f * my; dz = eta * dz + f * mz;
          if (ev) ev.type = 'refract';
        }
      }
      if (bounces === 1) { ctx.occ.out1 += E; ctx.occ.out1K[kBest] += E; }
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      if (ev) { ev.dOut = [dx, dy, dz]; ev.E = E; probe.push(ev); }
      if (E < floorE) { ctx.E.truncated += E; if (rec) rec.end = 'floor'; return; }
      // continue from the exact hit point; the relative tmin skips the self-intersection root
      // (nudging the origin along the normal would bias every downstream landing point)
      ox = wx; oy = wy; oz = wz;
      tmin = eps;
    }
  }

  // ---------------------------------------------------------------- batches
  const O = new Float64Array(3), Dd = new Float64Array(3), XR = new Float64Array(5);
  // ray i's origin and direction: mulberry32 over the counter-based stream for (seed, i)
  function sampleRayI(P, i, o, d) {
    let s = RF.rng.streamSeed(P.seed, i);
    const x = XR;
    for (let j = 0; j < 5; j++) {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      x[j] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    let w = 1;
    const gs = P.guides;
    if (gs) for (let k = gs.length - 1; k >= 0; k--) {
      const g = gs[k]; if (i < g.from || i >= g.to) continue;
      const c = g.cdf, u = x[3]; let lo = 0, hi = NB;            // the bin from the guide's cdf, the rest of x3 within it
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= u) lo = m; else hi = m; }
      const f = Math.min(1 - 1e-12, Math.max(0, (u - c[lo]) / Math.max(1e-300, c[lo + 1] - c[lo]))), a = Math.floor(lo / GB), bb = lo - a * GB;
      x[3] = (a + f) / GA; x[4] = (bb + x[4]) / GB; w = 1 / (NB * g.q[lo]);
      break;
    }
    LASTB = Math.min(GA - 1, Math.floor(x[3] * GA)) * GB + Math.min(GB - 1, Math.floor(x[4] * GB));
    RF.Source.sampleRay(P.S, x[0], x[1], x[2], x[3], x[4], o, d);
    return w;                                         // the ray's weight (1 unless a guide drew it)
  }
  function traceRange(ctx, i0, i1) {
    const P = ctx.P, e0 = P.power / ctx.N;
    for (let i = i0; i < i1; i++) {
      const w = sampleRayI(P, i, O, Dd), e = e0 * w;
      ctx.curI = i; ctx.curB = LASTB;
      if (ctx.gl) ctx.gl.Hn[LASTB]++;
      ctx.E.emitted += e;
      let rec = null;
      if (i < ctx.pathLimit) { rec = [O[0], O[1], O[2]]; rec.end = ''; }
      traceOne(P, ctx, O[0], O[1], O[2], Dd[0], Dd[1], Dd[2], e, rec, null);
      if (rec) ctx.paths.push(rec);
    }
  }

  // Advance a run by up to budgetMs of wall time (progressive).  Returns true when finished.
  function step(ctx, budgetMs) {
    if (ctx.done) return true;
    const t0 = RF.U.now();
    const CH = 512;
    while (ctx.next < ctx.N) {
      const i1 = Math.min(ctx.N, ctx.next + CH);
      traceRange(ctx, ctx.next, i1);
      ctx.next = i1;
      if (RF.U.now() - t0 >= budgetMs) break;
    }
    ctx.elapsed += RF.U.now() - t0;
    ctx.done = ctx.next >= ctx.N;
    return ctx.done;
  }

  function runSync(P, N, pathLimit) {
    const ctx = newCtx(P, N, pathLimit === undefined ? 0 : pathLimit);
    const t0 = RF.U.now();
    traceRange(ctx, 0, N);
    ctx.next = N; ctx.done = true;
    ctx.elapsed = RF.U.now() - t0;
    return ctx;
  }

  /* Extend a run to N2 rays (Refine).  Ray i's stream depends only on (seed, i), so tracing rays N … N2 − 1 on top gives
   * exactly the N2-ray run — once everything already accumulated is rescaled to the smaller per-ray energy (P.power / N2).
   * Returns a NEW context (so caches keyed by the context see a new run) that takes over the old one's buffers; the old
   * one must not be used afterwards.  Lists recorded per hit / exit grow to their caps.                          */
  function extend(ctx, N2, guide) {
    N2 = Math.floor(N2);
    if (!(N2 > ctx.N)) return ctx;
    if (guide) ctx.P.guides = (ctx.P.guides || []).concat([{ from: ctx.N, to: N2, q: guide.q, cdf: guide.cdf, wMin: 1 / (NB * Math.max(...guide.q)) }]);   // rays N … N2 − 1 follow it (retrace too: it reads P)
    const P = ctx.P, f = ctx.N / N2, c = Object.assign({}, ctx, { N: N2, done: false });
    const mul = (a, n) => { for (let i = 0; i < (n === undefined ? a.length : n); i++) a[i] *= f; };
    mul(c.gridD); mul(c.gridR); mul(c.surfIn);
    c.E = {}; for (const k of Object.keys(ctx.E)) c.E[k] = ctx.E[k] * f;
    c.occ = Object.assign({}, ctx.occ, { blocked: ctx.occ.blocked * f, out1: ctx.occ.out1 * f, shadow: null }); mul(c.occ.blockedK); mul(c.occ.out1K);
    if (c.hits) {
      for (let h = 0; h < c.nHits; h++) c.hits[3 * h + 2] *= f;
      const cap = Math.min(N2, P.hitCap || 2e6);
      if (cap > c.hitCap) {
        const grow = (a, k) => { const b = new a.constructor(k * cap); b.set(a.subarray(0, k * c.nHits)); return b; };
        c.hits = grow(c.hits, 3); c.hitK = grow(c.hitK, 1); c.hitB = grow(c.hitB, 1); c.hitI = grow(c.hitI, 1); c.hitCap = cap;
      }
    }
    if (c.rayK) { const r = new c.rayK.constructor(N2); r.set(c.rayK); c.rayK = r; }
    if (c.ex) {
      const x = c.ex; mul(x.e, x.n);
      const cap = Math.min(N2, P.exitCap || 2e6);
      if (cap > x.cap && x.n < x.cap) {    // a list that already overflowed stays as it is (its coverage stops at its last ray)
        const y = newExit(cap); y.o.set(x.o.subarray(0, 3 * x.n)); y.d.set(x.d.subarray(0, 3 * x.n)); y.e.set(x.e.subarray(0, x.n)); y.b.set(x.b.subarray(0, x.n)); y.i.set(x.i.subarray(0, x.n)); y.n = x.n; c.ex = y;
      }
    }
    if (c.ff) for (const S of c.ff) RF.FarField.scaleStream(S, f);
    return c;
  }

  // Re-run ray i of a trace exactly (same stream, same code path) for drawing: its polyline, how it
  // ended, and the surfaces it touched in order.
  function retrace(P, i) {
    // one scratch context per prepared scene: retracing thousands of rays must not allocate grids each time
    const ctx = P._rctx || (P._rctx = newCtx(Object.assign({}, P, { recordHits: false, recordExit: false }), 1, 0)), o = new Float64Array(3), d = new Float64Array(3);
    sampleRayI(P, i, o, d);
    const rec = [o[0], o[1], o[2]]; rec.end = ''; const ev = [];
    traceOne(P, ctx, o[0], o[1], o[2], d[0], d[1], d[2], 1, rec, ev);
    rec.ks = ev.filter((e) => e.k !== undefined).map((e) => e.k);
    return rec;
  }

  // Where facet k's light went, measured from a finished trace (needs P.recordHits).  Solver-agnostic.
  //   caught : rays whose first surface is k (rays = their indices)
  //   fate   : each caught ray retraced exactly → landed / blocked (by the last surface it met) / escaped / other
  //   shadowed: rays another surface caught first whose straight line from the LED also crosses k
  // Identity (tests/attribution.js): k traced ALONE catches exactly caught + shadowed rays.
  function facetLosses(P, ctx, k, rays) {
    const G = P.G, metas = G.metas;
    const out = { caught: rays.length, shadowed: 0, fate: { landed: 0, blocked: 0, escaped: 0, other: 0 }, block: new Map(), shadow: new Map(), shadowSegs: [] };
    for (const i of rays) {
      const p = retrace(P, i), ks = p.ks;
      if (p.end === 'target') out.fate.landed++;
      else if ((p.end === 'cap' || p.end === 'absorb') && ks.length > 1) { out.fate.blocked++; const id = metas[ks[ks.length - 1]].id; out.block.set(id, (out.block.get(id) || 0) + 1); }
      else if (p.end === 'escape') out.fate.escaped++;
      else out.fate.other++;
    }
    const o = new Float64Array(3), d = new Float64Array(3);
    for (let i = 0; i < ctx.next; i++) {
      const fk = ctx.rayK[i]; if (fk === 0 || fk === k + 1) continue;
      sampleRayI(P, i, o, d);
      const t = Geo.intersect(G.D, G.poly, k, o[0], o[1], o[2], d[0], d[1], d[2], P.eps, Infinity);
      if (!(t >= 0)) continue;
      out.shadowed++; const id = metas[fk - 1].id; out.shadow.set(id, (out.shadow.get(id) || 0) + 1);
      out.shadowSegs.push([o[0], o[1], o[2], o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]]);
    }
    const top = (m, of) => [...m].filter(([, v]) => v >= Math.max(2, 0.01 * of)).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    out.shadowers = top(out.shadow, out.caught + out.shadowed); out.blockers = top(out.block, out.caught);
    return out;
  }

  // Fixture-wide shadowing (one extra pass over a finished trace, needs P.recordHits): for every ray
  // whose first surface reflects or absorbs, every OTHER surface its straight line from the LED also
  // crosses has lost that ray to the first one.  Refracting first surfaces are skipped (light goes on
  // through a lens; that's a multi-hop path, not a shadow).  Cached on the context.
  //   shadowK[k] = rays surface k lost · shadowed = Σ lost ÷ Σ (caught + lost) · overlap = share of caught
  //   rays whose line crosses ≥ 1 more surface
  function occlusion(P, ctx) {
    if (ctx.occ.shadow && ctx.occ.shadow.n === ctx.next) return ctx.occ.shadow;
    const G = P.G, D = G.D, bvh = G.bvh, n = Math.max(1, G.n), shadowK = new Float64Array(n), caughtK = new Float64Array(n);   // ray WEIGHTS (1 each unless a guided Refine drew them)
    const { bmin, bmax, left, right, start, count, items } = bvh, st = new Int32Array(128), o = new Float64Array(3), d = new Float64Array(3);
    let lost = 0, overl = 0, caught = 0;
    for (let i = 0; i < ctx.next; i++) {
      const fk = ctx.rayK[i] - 1; if (fk < 0) continue;
      const w = sampleRayI(P, i, o, d);
      caughtK[fk] += w; caught += w;
      if (D[fk * STRIDE + 28] === 1) continue;
      const ox = o[0], oy = o[1], oz = o[2], dx = d[0], dy = d[1], dz = d[2], ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
      let sp = 0, any = false; st[sp++] = 0;
      while (sp > 0) {
        const nd = st[--sp], b3 = 3 * nd;
        let t1 = (bmin[b3] - ox) * ix, t2 = (bmax[b3] - ox) * ix, tn = Math.min(t1, t2), tf = Math.max(t1, t2);
        t1 = (bmin[b3 + 1] - oy) * iy; t2 = (bmax[b3 + 1] - oy) * iy; tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
        t1 = (bmin[b3 + 2] - oz) * iz; t2 = (bmax[b3 + 2] - oz) * iz; tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
        if (!(tf >= tn) || tf < P.eps) continue;
        if (left[nd] < 0) {
          for (let q = start[nd], q1 = q + count[nd]; q < q1; q++) {
            const k = items[q]; if (k === fk) continue;
            if (Geo.intersect(D, G.poly, k, ox, oy, oz, dx, dy, dz, P.eps, Infinity) >= 0) { shadowK[k] += w; lost += w; any = true; }
          }
        } else { st[sp++] = left[nd]; st[sp++] = right[nd]; }
      }
      if (any) overl += w;
    }
    const metas = G.metas, worst = [];
    for (let k = 0; k < G.n; k++) if (shadowK[k]) worst.push({ id: metas[k].id, lost: shadowK[k] / (shadowK[k] + caughtK[k]) });
    worst.sort((a, b) => b.lost - a.lost);
    ctx.occ.shadow = { n: ctx.next, shadowK, caughtK, shadowed: caught + lost > 0 ? lost / (caught + lost) : 0, overlap: caught > 0 ? overl / caught : 0, worst: worst.slice(0, 5) };
    return ctx.occ.shadow;
  }

  // Single ray through the same code path; returns the event list.
  function probeRay(P, o, d, E) {
    const ctx = newCtx(Object.assign({}, P, { recordExit: false }), 1, 0);
    const ev = [];
    const dn = V.norm(d);
    traceOne(P, ctx, o[0], o[1], o[2], dn[0], dn[1], dn[2], E || 1, null, ev);
    return { events: ev, ctx };
  }

  // ---------------------------------------------------------------- statistics (raw grid only)
  // Evaluation follows lighting practice: U₀ = E_min / E_avg over the TASK AREA (EN 12464-1), with
  // E_min taken as the 5th percentile (the strict minimum of many noisy cells is a noise spike).
  //   Mode A (paint given): task area = painted cells; E = sim ÷ paint per paint cell (sim cells are
  //     summed into paint cells first), so a multi-level painting delivered exactly scores 1.
  //   otherwise: task area = sim cells ≥ BEAM_EDGE × robust peak (the beam footprint).
  // The beam task area (not the painted one) loses a one-cell border zone (erode) before U₀.  Robust peak = 99.5th pct of lit cells.  Noise ceiling = 1 − 1.645/√(rays per task cell):
  // what perfectly even light would score at this sampling.  Coverage (IES beam/field): Mode A = share of
  // painted cells delivering ≥50% / ≥10% of the mean sim÷paint; otherwise the target share ≥50% / ≥10% of peak.
  const BEAM_EDGE = 0.10;               // field edge (IES: field = 10% of peak) — also bounds the U₀ task area in B/C
  const BEAM_HALF = 0.50;               // beam edge (IES: beam = 50% of peak)
  // Border zone (as EN 12464 excludes one along walls): drop task cells with a 4-neighbour outside the
  // task area — partially-covered edge cells otherwise dominate the 5th percentile and U₀ measures
  // edge sharpness, not evenness.  Falls back to the full area if erosion would empty it.
  function erode(mask, r) {
    const out = new Uint8Array(mask.length); let n = 0;
    for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) {
      const k = j * r + i; if (!mask[k]) continue;
      if (i > 0 && i < r - 1 && j > 0 && j < r - 1 && mask[k - 1] && mask[k + 1] && mask[k - r] && mask[k + r]) { out[k] = 1; n++; }
    }
    return n ? out : mask;
  }
  // Move a sim grid (rs²) onto the paint grid (rp²), conserving energy: each sim cell's energy is split
  // over the paint cells it overlaps, by overlap area.  Works both ways (sim finer OR coarser than paint);
  // a nearest-centre mapping leaves paint cells empty whenever sim is coarser.
  function toPaintGrid(g, rs, rp) {
    const G = new Float64Array(rp * rp), f = rp / rs;          // paint cells per sim cell (1-D)
    const span = (i) => { const a = i * f, b = (i + 1) * f, out = []; for (let k = Math.floor(a); k < Math.min(rp, Math.ceil(b - 1e-12)); k++) out.push([k, (Math.min(b, k + 1) - Math.max(a, k)) / f]); return out; };
    const S = []; for (let i = 0; i < rs; i++) S.push(span(i));
    for (let j = 0; j < rs; j++) for (let i = 0; i < rs; i++) {
      const e = g[j * rs + i]; if (!e) continue;
      for (const [pj, wj] of S[j]) for (const [pi, wi] of S[i]) G[pj * rp + pi] += e * wj * wi;
    }
    return G;
  }
  const pctl = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] : 0;
  function evaluate(ctx, paint, paintRes) {
    const P = ctx.P, rs = P.res, n = rs * rs, g = new Float64Array(n);
    for (let i = 0; i < n; i++) g[i] = ctx.gridD[i] + ctx.gridR[i];
    const e0 = (P.power / (ctx.N || 1)) || 1;                    // energy one ray carries at emission
    const litS = []; for (let i = 0; i < n; i++) if (g[i] > 0) litS.push(g[i]); litS.sort((a, b) => a - b);
    const peakRobust = pctl(litS, 0.995), peakMax = litS.length ? litS[litS.length - 1] : 0;
    let vals, cellsE, basis, coverage, coverageField, areaCells;
    if (paint && paintRes && paint.some((w) => w > 0)) {
      const rp = paintRes, G = toPaintGrid(g, rs, rp);
      vals = []; cellsE = [];
      // no border zone here: the painted edge is part of the job (a dim edge cell is real under-delivery),
      // and eroding a 1–2-cell-wide painting would leave almost nothing to score
      for (let k = 0; k < rp * rp; k++) if (paint[k] > 0) { vals.push(G[k] / paint[k]); cellsE.push(G[k]); }
      basis = 'paint'; areaCells = vals.length;
      const m = vals.reduce((s, x) => s + x, 0) / vals.length;
      // coverage on ALL painted cells (not the eroded U₀ area): share delivering ≥50% (beam) / ≥10% (field) of the mean ratio
      const all = []; for (let k = 0; k < rp * rp; k++) if (paint[k] > 0) all.push(G[k] / paint[k]);
      const ma = all.reduce((s, x) => s + x, 0) / all.length;
      coverage = ma > 0 ? all.filter((x) => x >= BEAM_HALF * ma).length / all.length : 0;
      coverageField = ma > 0 ? all.filter((x) => x >= BEAM_EDGE * ma).length / all.length : 0;
    } else {
      const edge = BEAM_EDGE * peakRobust;
      const beam = Uint8Array.from(g, (x) => (x > 0 && x >= edge ? 1 : 0)); let nb = 0; for (let i = 0; i < n; i++) nb += beam[i];
      const inner = erode(beam, rs);
      vals = []; for (let i = 0; i < n; i++) if (inner[i]) vals.push(g[i]);
      let nh = 0; for (let i = 0; i < n; i++) if (g[i] >= BEAM_HALF * peakRobust && g[i] > 0) nh++;
      cellsE = vals; basis = 'beam'; areaCells = vals.length; coverage = nh / n; coverageField = nb / n;
    }
    const sv = vals.slice().sort((a, b) => a - b), mean = sv.length ? sv.reduce((s, x) => s + x, 0) / sv.length : 0;
    const raysPerCell = cellsE.length ? cellsE.reduce((s, x) => s + x, 0) / cellsE.length / e0 : 0;
    return {
      basis, areaCells, coverage, coverageField,
      uniformity: mean > 0 ? pctl(sv, 0.05) / mean : 0,
      noiseCeiling: raysPerCell > 0 ? Math.max(0, 1 - 1.645 / Math.sqrt(raysPerCell)) : 0,
      raysPerCell, peakRobust, peakMax,
    };
  }
  function stats(ctx, opts) {
    const P = ctx.P, n = P.res * P.res, g = ctx.gridD, h = ctx.gridR;
    let lit = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++) { const e = g[i] + h[i]; if (e > 0) { lit++; sum += e; sum2 += e * e; } }
    const mu = lit ? sum / lit : 0;
    const sd = lit ? Math.sqrt(Math.max(0, sum2 / lit - mu * mu)) : 0;
    const E = ctx.E, em = E.emitted || 1;
    const accounted = E.direct + E.reflected + E.absorbed + E.backface + E.interfaceLoss + E.escaped + E.targetBack + E.truncated;
    return {
      rays: ctx.next, surfaces: P.G.n,
      litCells: lit, cells: n,
      uniformityOld: lit ? 1 - sd / mu : 0,                   // 1 − σ/μ over lit cells (kept for reference; ray-count dependent)
      effIntercepted: E.intercepted / em,
      effViaSurface: E.reflected / em,
      effDirect: E.direct / em,
      timeMs: ctx.elapsed,
      energy: Object.assign({}, E),
      conservationError: (accounted - E.emitted) / em,
      selfShadow: E.intercepted > 0 ? E.reHit / E.intercepted : 0,   // (legacy name) share of intercepted light that re-hits a surface
      // occlusion, solver-readable: blocked = left one surface, ended on another without landing (share of
      // the light surfaces caught); shadowed = light a surface's cone lost to another surface in front of it
      // (only after the trace finishes and only with recorded hits — null otherwise)
      occlusion: occlusionStats(ctx),
      ...evaluate(ctx, opts && opts.paint, opts && opts.paintRes),
    };
  }
  function occlusionStats(ctx) {
    const P = ctx.P, E = ctx.E, metas = P.G.metas, o = ctx.occ;
    const worstB = []; for (let k = 0; k < P.G.n; k++) if (o.blockedK[k] > 0) worstB.push({ id: metas[k].id, lost: o.blockedK[k] / o.out1K[k] });
    worstB.sort((a, b) => b.lost - a.lost);
    const sh = ctx.done && ctx.rayK ? occlusion(P, ctx) : null;
    return {
      blocked: o.out1 > 0 ? o.blocked / o.out1 : 0, blockedWorst: worstB.slice(0, 5),
      shadowed: sh ? sh.shadowed : null, overlap: sh ? sh.overlap : null, shadowedWorst: sh ? sh.worst : [],
    };
  }
  // Rays whose hits are all in the hit list.  Hits are recorded in ray order up to hitCap, so past the cap
  // only the first rays are covered: anything summed from hits must scale by THIS, not by ctx.next.
  function hitCoverage(ctx) {
    if (!ctx.hits) return 0;
    return ctx.nHits < ctx.hitCap ? ctx.next : ctx.hitI[ctx.nHits - 1];   // the last ray may be partly recorded: drop it
  }
  function gridTotal(ctx) {
    const n = ctx.gridD.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = ctx.gridD[i] + ctx.gridR[i];
    return out;
  }
  function gridHash(ctx) { return RF.hash.f64([ctx.gridD, ctx.gridR]); }

  RF.Engine = {
    targetFrame, designFrame, aimPoint, targetUVtoWorld, worldToTargetUV, cellCenter,
    prepare, newCtx, extend, buildGuide, traceRange, step, runSync, probeRay, retrace, rayAt: sampleRayI, facetLosses, occlusion, hitCoverage, exitCoverage, stats, evaluate, toPaintGrid, gridTotal, gridHash, BEAM_EDGE, pctl,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
