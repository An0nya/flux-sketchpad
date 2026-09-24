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
      // raw lit-side hits (u, v, energy) for the ray-hits view; only when the caller asks (P.recordHits)
      hits: P.recordHits ? new Float32Array(3 * Math.min(N, 2e6)) : null, nHits: 0, hitCap: Math.min(N, 2e6),
      E: { emitted: 0, direct: 0, reflected: 0, absorbed: 0, backface: 0, interfaceLoss: 0, escaped: 0, targetBack: 0, truncated: 0, intercepted: 0, reHit: 0, tir: 0 },
      surfIn: new Float64Array(Math.max(1, P.G.n)),
      paths: [], pathLimit: pathLimit === undefined ? 240 : pathLimit,
      elapsed: 0, done: N === 0,
    };
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
    let bounces = 0, tmin = eps;
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
            if (den < 0) {                         // lit side
              const r = P.res;
              let iu = Math.floor((u + T.half) / (2 * T.half) * r), iv = Math.floor((v + T.half) / (2 * T.half) * r);
              if (iu >= r) iu = r - 1; if (iv >= r) iv = r - 1;
              const cell = iv * r + iu;
              if (ctx.hits && ctx.nHits < ctx.hitCap) { const q = 3 * ctx.nHits++; ctx.hits[q] = u; ctx.hits[q + 1] = v; ctx.hits[q + 2] = E; }
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
        if (rec) { const L = P.scale * 1.5; rec.push(ox + L * dx, oy + L * dy, oz + L * dz); rec.end = 'escape'; }
        if (probe) probe.push({ type: 'escape', dir: [dx, dy, dz] });
        return;
      }
      // ---- surface interaction
      const wx = ox + tBest * dx, wy = oy + tBest * dy, wz = oz + tBest * dz;
      if (rec) rec.push(wx, wy, wz);
      if (bounces === 0) ctx.E.intercepted += e0; else ctx.E.reHit += E;
      ctx.surfIn[kBest] += E;
      if (bounces >= P.cap) {                      // blocked here: bounce budget exhausted
        ctx.E.truncated += E;
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
        ctx.E.absorbed += E; if (ev) { ev.type = 'absorb'; probe.push(ev); } if (rec) rec.end = 'absorb';
        return;
      }
      if (inter === 0) {                           // reflect
        if (cosI > 0 && D[ko + 32] === 0) {        // back face of a one-sided mirror absorbs
          ctx.E.backface += E; if (ev) { ev.type = 'backface'; probe.push(ev); } if (rec) rec.end = 'absorb';
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
  function traceRange(ctx, i0, i1) {
    const P = ctx.P, S = P.S, e0 = P.power / ctx.N;
    for (let i = i0; i < i1; i++) {
      // inline mulberry32 over the counter-based stream for ray i
      let s = RF.rng.streamSeed(P.seed, i);
      const x = XR;
      for (let j = 0; j < 5; j++) {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        x[j] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }
      RF.Source.sampleRay(S, x[0], x[1], x[2], x[3], x[4], O, Dd);
      ctx.E.emitted += e0;
      let rec = null;
      if (i < ctx.pathLimit) { rec = [O[0], O[1], O[2]]; rec.end = ''; }
      traceOne(P, ctx, O[0], O[1], O[2], Dd[0], Dd[1], Dd[2], e0, rec, null);
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

  // Single ray through the same code path; returns the event list.
  function probeRay(P, o, d, E) {
    const ctx = newCtx(P, 1, 0);
    const ev = [];
    const dn = V.norm(d);
    traceOne(P, ctx, o[0], o[1], o[2], dn[0], dn[1], dn[2], E || 1, null, ev);
    return { events: ev, ctx };
  }

  // ---------------------------------------------------------------- statistics (raw grid only)
  function stats(ctx) {
    const P = ctx.P, n = P.res * P.res, g = ctx.gridD, h = ctx.gridR;
    let lit = 0, sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++) { const e = g[i] + h[i]; if (e > 0) { lit++; sum += e; sum2 += e * e; } }
    const mu = lit ? sum / lit : 0;
    const sd = lit ? Math.sqrt(Math.max(0, sum2 / lit - mu * mu)) : 0;
    const E = ctx.E, em = E.emitted || 1;
    const accounted = E.direct + E.reflected + E.absorbed + E.backface + E.interfaceLoss + E.escaped + E.targetBack + E.truncated;
    return {
      rays: ctx.next, surfaces: P.G.n,
      coverage: lit / n, litCells: lit, cells: n,
      uniformity: lit ? 1 - sd / mu : 0,
      effIntercepted: E.intercepted / em,
      effViaSurface: E.reflected / em,
      effDirect: E.direct / em,
      timeMs: ctx.elapsed,
      energy: Object.assign({}, E),
      conservationError: (accounted - E.emitted) / em,
      selfShadow: E.intercepted > 0 ? E.reHit / E.intercepted : 0,
    };
  }
  function gridTotal(ctx) {
    const n = ctx.gridD.length, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = ctx.gridD[i] + ctx.gridR[i];
    return out;
  }
  function gridHash(ctx) { return RF.hash.f64([ctx.gridD, ctx.gridR]); }

  RF.Engine = {
    targetFrame, designFrame, aimPoint, targetUVtoWorld, worldToTargetUV, cellCenter,
    prepare, newCtx, traceRange, step, runSync, probeRay, stats, gridTotal, gridHash,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
