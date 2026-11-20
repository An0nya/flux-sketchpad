/* Static painted-target reflector design.
 *
 * The solver builds a small forward model, not a ray search: an ellipsoidal facet images samples of the
 * extended LED onto the design plane, differential solid angle gives its caught flux, and a non-negative
 * allocation matches the painting.  Only after that allocation are facet apertures converted to geometry.
 */
(function () {
  'use strict';
  const V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const dot = V.dot, add = V.add, sub = V.sub, mul = V.mul;

  function aimClusters(input, count) {
    const R = input.paint.res | 0, paint = input.paint.cells, T = RF.Engine.designFrame(input.target);
    const pts = [];
    let maxW = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = +paint[j * R + i] || 0;
      if (!(w > 0)) continue;
      const uv = RF.Engine.cellCenter(T, i, j);
      pts.push({ u: uv[0], v: uv[1], w, cell: j * R + i });
      if (w > maxW) maxW = w;
    }
    if (!pts.length) return { T, aims: [], painted: pts };
    const n = Math.min(count, pts.length), chosen = [], used = new Set();
    let first = 0, best = -1;
    const mean = pts.reduce((a, p) => [a[0] + p.u * p.w, a[1] + p.v * p.w], [0, 0]);
    const sw = pts.reduce((a, p) => a + p.w, 0) || 1;
    mean[0] /= sw; mean[1] /= sw;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = (p.u - mean[0]) ** 2 + (p.v - mean[1]) ** 2 - 1e-9 * p.w;
      if (q > best) { best = q; first = k; }
    }
    chosen.push([pts[first].u, pts[first].v]); used.add(first);
    while (chosen.length < n) {
      let pick = -1; best = -1;
      for (let k = 0; k < pts.length; k++) {
        if (used.has(k)) continue;
        const p = pts[k];
        let d2 = Infinity;
        for (const c of chosen) d2 = Math.min(d2, (p.u - c[0]) ** 2 + (p.v - c[1]) ** 2);
        const score = d2 * (0.3 + 0.7 * p.w / (maxW || 1));
        if (score > best) { best = score; pick = k; }
      }
      if (pick < 0) break;
      chosen.push([pts[pick].u, pts[pick].v]); used.add(pick);
    }
    for (let pass = 0; pass < 12; pass++) {
      const sum = chosen.map(() => [0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        for (let k = 0; k < chosen.length; k++) {
          const c = chosen[k], d = (p.u - c[0]) ** 2 + (p.v - c[1]) ** 2;
          if (d < bd) { bd = d; bi = k; }
        }
        sum[bi][0] += p.u * p.w; sum[bi][1] += p.v * p.w; sum[bi][2] += p.w;
      }
      for (let k = 0; k < chosen.length; k++) if (sum[k][2] > 0) {
        chosen[k][0] = sum[k][0] / sum[k][2]; chosen[k][1] = sum[k][1] / sum[k][2];
      }
    }
    const aims = chosen.map((c) => {
      let cell = pts[0].cell, bd = Infinity;
      for (const p of pts) {
        const d = (p.u - c[0]) ** 2 + (p.v - c[1]) ** 2;
        if (d < bd) { bd = d; cell = p.cell; }
      }
      return { u: c[0], v: c[1], cell, Z: add(T.C, add(mul(T.tu, c[0]), mul(T.tv, c[1]))) };
    });
    return { T, aims, painted: pts };
  }

  // Hungarian assignment, minimising the reflection cost.  It avoids the poor final pairings of a greedy pass.
  function assignment(cost) {
    const n = cost.length, u = new Float64Array(n + 1), v = new Float64Array(n + 1);
    const p = new Int32Array(n + 1), way = new Int32Array(n + 1), ans = new Int32Array(n);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      const minv = new Float64Array(n + 1); minv.fill(Infinity);
      const used = new Uint8Array(n + 1);
      let j0 = 0;
      do {
        used[j0] = 1;
        const i0 = p[j0];
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= n; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
    return ans;
  }

  function directionSites(input, aims, wanted, settings, src, totalI) {
    const S = src.pos, env = input.envelope, keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const target = aims.length ? aims : [{ Z: [input.target.distance, 0, 0] }];
    const reps = [];
    const stride = Math.max(1, Math.ceil(target.length / 28));
    for (let k = 0; k < target.length; k += stride) reps.push(target[k].Z);
    const raw = [], count = Math.max(5000, Math.min(12000, wanted * 40));
    let rMax = 0, iMax = 1e-12;
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let k = 0; k < count; k++) {
      const z = 1 - 2 * (k + 0.5) / count, rr = Math.sqrt(Math.max(0, 1 - z * z)), a = k * ga;
      const d = [rr * Math.cos(a), rr * Math.sin(a), z];
      const theta = Math.acos(clamp(dot(d, V.norm(src.axis)), -1, 1));
      const inten = RF.Source.intensity(src, theta);
      if (!(inten > 1e-8)) continue;
      const iv = RF.Geo.envInterval(env, S, d), rExit = iv[1];
      if (!(isFinite(rExit) && rExit > Math.max(keep + 1e-3, 1e-6))) continue;
      raw.push({ d, rExit, inten }); rMax = Math.max(rMax, rExit); iMax = Math.max(iMax, inten);
    }
    if (!raw.length) return [];
    let inset = settings.inset;
    if (settings.autoInset) {
      const cell = input.target.size / Math.max(1, input.paint.res | 0);
      const led = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h)) :
        (src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius || RF.Source.extentSize(src) || 1);
      const magnification = Math.abs(input.target.distance) * Math.max(1e-9, led) / Math.max(1e-9, rMax * cell);
      inset = clamp(0.88 + 0.04 * Math.max(0, 4 - magnification), 0.88, 0.96);
    }
    let candidates = [];
    const shellFractions = [settings.shell, Math.min(settings.shell, 0.55), 0.3, 0];
    for (const shell of shellFractions) {
      candidates = [];
      for (const q of raw) {
        if (q.rExit < shell * rMax) continue;
        const r = q.rExit * inset, P = add(S, mul(q.d, r));
        if (r <= keep + 1e-5) continue;
        let bestOut = -Infinity, bestCost = Infinity;
        for (const Z of reps) {
          const ah = V.norm(sub(Z, P)), out = dot(q.d, ah), c = Math.sqrt(Math.max(0, (1 - out) / 2));
          const cost = (out - settings.outward - 0.12) ** 2 + 8 * Math.max(0, 0.38 - c) ** 2 + (out < settings.outward ? 10 : 0);
          if (cost < bestCost) { bestCost = cost; bestOut = out; }
        }
        const cBest = Math.sqrt(Math.max(0, (1 - bestOut) / 2));
        if (cBest < 0.29 || bestOut < settings.outward || bestOut > 0.7) continue;
        const radial = q.rExit / rMax, inten = q.inten / iMax, geom = Math.exp(-Math.pow((bestOut - settings.outward - 0.12) / 0.5, 2));
        candidates.push(Object.assign(q, { r, P, quality: 0.22 + 0.36 * radial * radial + 0.25 * inten + 0.17 * geom }));
      }
      if (candidates.length >= wanted || shell === 0) break;
    }
    if (candidates.length <= wanted) return candidates;
    const selected = [], remaining = candidates.slice();
    let first = 0;
    for (let k = 1; k < remaining.length; k++) if (remaining[k].quality > remaining[first].quality) first = k;
    selected.push(remaining.splice(first, 1)[0]);
    while (selected.length < wanted && remaining.length) {
      let pick = 0, best = -1;
      for (let k = 0; k < remaining.length; k++) {
        const q = remaining[k];
        let sep = Infinity;
        for (const s of selected) sep = Math.min(sep, Math.max(0, 1 - dot(q.d, s.d)));
        const score = (0.025 + sep) * Math.pow(q.quality, 1.7);
        if (score > best) { best = score; pick = k; }
      }
      selected.push(remaining.splice(pick, 1)[0]);
    }
    return selected;
  }

  function cappedNormalise(w, cap) {
    let lo = 0, hi = 1;
    const sumAt = (x) => w.reduce((s, q, k) => s + Math.min(cap[k], Math.max(0, q * x)), 0);
    while (sumAt(hi) < 1 && hi < 1e100) hi *= 2;
    for (let it = 0; it < 42; it++) {
      const m = (lo + hi) / 2;
      if (sumAt(m) < 1) lo = m; else hi = m;
    }
    return w.map((q, k) => Math.min(cap[k], Math.max(0, q * hi)));
  }

  function makeKernel(g, src, T, R) {
    const P = g.P, n = g.n, C = T.C, half = T.half, cell = 2 * half / R;
    const mapPoint = (Q) => {
      const din = V.norm(sub(P, Q)), ci = dot(din, n), out = V.norm(sub(din, mul(n, 2 * ci)));
      const den = dot(out, T.n), t = dot(sub(C, P), T.n) / den;
      if (!(t > 0) || !isFinite(t)) return null;
      const H = add(P, mul(out, t)), d = sub(H, C);
      return [dot(d, T.tu), dot(d, T.tv)];
    };
    const fr = RF.Source.frame(src), samples = [];
    if (src.kind === 'point') samples.push(src.pos.slice());
    else if (src.kind === 'planar' && src.shape !== 'disc') {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((q) => mapPoint(add(src.pos, add(mul(fr.u, q[0] * src.w / 2), mul(fr.v, q[1] * src.h / 2)))));
      let du = 0, dv = 0;
      for (const a of corners) if (a) for (const b of corners) if (b) { du = Math.max(du, Math.abs(a[0] - b[0])); dv = Math.max(dv, Math.abs(a[1] - b[1])); }
      const nu = clamp(Math.ceil(1.6 * du / cell) + 1, 3, 17), nv = clamp(Math.ceil(1.6 * dv / cell) + 1, 3, 17);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const x = ((i + 0.5) / nu - 0.5) * src.w, y = ((j + 0.5) / nv - 0.5) * src.h;
        samples.push(add(src.pos, add(mul(fr.u, x), mul(fr.v, y))));
      }
    } else {
      const N = src.kind === 'planar' ? 72 : 81, radius = src.radius || Math.max(src.w || 0, src.h || 0) / 2 || 0.5;
      for (let k = 0; k < N; k++) {
        const r = radius * Math.sqrt((k + 0.5) / N), a = k * Math.PI * (3 - Math.sqrt(5));
        let Q = add(src.pos, add(mul(fr.u, r * Math.cos(a)), mul(fr.v, r * Math.sin(a))));
        if (src.kind === 'volume') Q = add(Q, mul(fr.a, ((k % 5) - 2) * (src.length || 0) / 5));
        samples.push(Q);
      }
    }
    const bins = new Map();
    const wt = 1 / samples.length;
    for (const Q of samples) {
      const uv = mapPoint(Q); if (!uv) continue;
      const x = (uv[0] + half) / cell - 0.5, y = (uv[1] + half) / cell - 0.5;
      const i0 = Math.floor(x), j0 = Math.floor(y), fx = x - i0, fy = y - j0;
      for (let dj = 0; dj <= 1; dj++) for (let di = 0; di <= 1; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= R || j >= R) continue;
        const w = wt * (di ? fx : 1 - fx) * (dj ? fy : 1 - fy);
        if (!(w > 0)) continue;
        const k = j * R + i; bins.set(k, (bins.get(k) || 0) + w);
      }
    }
    const idx = Int32Array.from(bins.keys()), val = Float64Array.from(bins.values());
    let sum = 0; for (const x of val) sum += x;
    return { idx, val, sum };
  }

  function directShield(input, src, T) {
    // Exact convex shadow of the finite die and target on a plane just outside the LED clearance.  Using
    // the die's actual orientation matters in a shallow envelope: an isotropic padded shield can be twice as tall.
    const S = src.pos, env = input.envelope, C = T.C, forward = V.norm(sub(C, S));
    const hardKeep = env.keepOut || 0, fr = RF.Source.frame(src), emitters = [];
    if (src.kind === 'planar' && src.shape !== 'disc') {
      for (const q of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) emitters.push(add(S, add(mul(fr.u, q[0] * src.w / 2), mul(fr.v, q[1] * src.h / 2))));
    } else {
      const radius = RF.Source.boundingRadius(src);
      for (let k = 0; k < 8; k++) emitters.push(add(S, add(mul(fr.u, radius * Math.cos(k * Math.PI / 4)), mul(fr.v, radius * Math.sin(k * Math.PI / 4)))));
      if (src.kind === 'volume') emitters.push(add(S, mul(fr.a, radius)), add(S, mul(fr.a, -radius)));
      else emitters.push(S.slice());
    }
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map((q) => add(C, add(mul(T.tu, q[0] * T.half), mul(T.tv, q[1] * T.half))));
    const d0 = Math.max(hardKeep + 0.01, RF.Source.boundingRadius(src) + 0.01, 0.05);
    const ex = V.inPlane(forward, T.tu), ey = V.cross(forward, ex);
    for (let attempt = 0; attempt < 6; attempt++) {
      const dist = d0 * (1 + 0.08 * attempt), P = add(S, mul(forward, dist)), pts = [];
      let ok = true;
      for (const A of emitters) for (const B of corners) {
        const dir = sub(B, A), co = dot(dir, forward), t = (dist - dot(sub(A, S), forward)) / co;
        if (!(co > 1e-8) || !(t > 0)) { ok = false; break; }
        const H = add(A, mul(dir, t)), d = sub(H, P);
        pts.push([dot(d, ex), dot(d, ey)]);
      }
      if (!ok) break;
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], hi = [];
      for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let k = pts.length - 1; k >= 0; k--) { const p = pts[k]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
      const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
      for (const shrink of [1, 0.95, 0.85, 0.7, 0.5]) {
        const pts3 = hull.map((p) => add(P, add(mul(ex, p[0] * 1.002 * shrink), mul(ey, p[1] * 1.002 * shrink))));
        if (pts3.length >= 3 && pts3.every((p) => RF.Geo.envInside(env, p, 0) && V.dist(p, S) >= hardKeep + 1e-5)) {
          return { type: 'plane', id: 'DIRECT', group: 'A', P, n: forward, clip: { kind: 'poly', pts3 },
            optics: { interaction: 'absorb', reflectivity: input.limits.reflectivity, twoSided: true } };
        }
      }
    }
    return null;
  }

  function solve(input, settings) {
    const src = input.source, S = src.pos, env = input.envelope;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0), R = input.paint.res | 0;
    const maxFacets = Math.max(0, input.limits.maxFacets | 0), workFacets = Math.min(160, maxFacets), refl = input.limits.reflectivity;
    const surfaces = [], intent = [], notes = [];
    if (!maxFacets || !R) return { surfaces, intent, notes: ['no facets requested'] };
    const clustered = aimClusters(input, workFacets), T = clustered.T;
    if (!clustered.aims.length) return { surfaces, intent, notes: ['painting is empty'] };
    const totalI = RF.Source.totalIntegral(src);
    let sites = directionSites(input, clustered.aims, workFacets, settings, src, totalI);
    if (!sites.length) return { surfaces, intent, notes: ['no legal emitting directions reach the envelope'] };
    const n = Math.min(sites.length, clustered.aims.length);
    sites = sites.slice(0, n);
    const aims = n === clustered.aims.length ? clustered.aims : aimClusters(input, n).aims;
    for (const g of sites) {
      g.sep = Infinity;
      for (const h of sites) if (h !== g) g.sep = Math.min(g.sep, Math.sqrt(Math.max(0, 2 - 2 * dot(g.d, h.d))));
      if (!isFinite(g.sep)) g.sep = 0.5;
      g.approxR = g.r * settings.packing * g.sep * 0.55;
    }
    const cost = sites.map((g) => aims.map((a) => {
      const ah = V.norm(sub(a.Z, g.P)), out = dot(g.d, ah), c = Math.sqrt(Math.max(0, (1 - out) / 2));
      let blocked = 0;
      if (settings.blockPenalty > 0) for (const h of sites) if (h !== g) {
        const w = sub(h.P, g.P), t = dot(w, ah);
        if (!(t > 0)) continue;
        const rr = Math.max(1e-8, h.approxR + 0.2 * g.approxR), perp2 = Math.max(0, dot(w, w) - t * t);
        if (perp2 < rr * rr) blocked += 1 - perp2 / (rr * rr);
      }
      return (out - settings.outward - 0.12) ** 2 + 10 * Math.max(0, 0.37 - c) ** 2 + (out < settings.outward ? 100 : 0) + (c < 0.25 ? 100 : 0) + settings.blockPenalty * blocked;
    }));
    const pairs = assignment(cost), geoms = [];
    const polyN = 8, polyArea = polyN / 2 * Math.sin(2 * Math.PI / polyN);
    for (let k = 0; k < n; k++) {
      const g = sites[k], a = aims[pairs[k]], ah = V.norm(sub(a.Z, g.P));
      const sh = mul(g.d, -1), nv = add(sh, ah), nl = V.len(nv);
      if (!(nl > 1e-8)) continue;
      const nrm = mul(nv, 1 / nl), c = -dot(g.d, nrm), out = dot(g.d, ah);
      if (!(c > 0.27) || out < settings.outward || out > 0.74) continue;
      const sep = g.sep, ex = V.inPlane(nrm, T.tu), ey = V.cross(nrm, ex);
      let cap = g.r * settings.packing * sep * c;
      cap = Math.min(cap, Math.max(0, 0.65 * (g.r - keep - 1e-4)));
      for (let q = 0; q < polyN; q++) {
        const ang = (q + 0.5) * 2 * Math.PI / polyN, e = add(mul(ex, Math.cos(ang)), mul(ey, Math.sin(ang)));
        const iv = RF.Geo.envInterval(env, g.P, e);
        if (iv[1] > 0 && isFinite(iv[1])) cap = Math.min(cap, 0.86 * iv[1]);
      }
      const theta = Math.acos(clamp(dot(g.d, V.norm(src.axis)), -1, 1));
      const inten = RF.Source.intensity(src, theta), qcoef = inten / totalI * c / (g.r * g.r);
      if (!(cap > 1e-5) || !(qcoef > 0)) continue;
      const areaCap = polyArea * cap * cap, qmax = qcoef * areaCap;
      geoms.push(Object.assign(g, { aim: a, Z: a.Z, n: nrm, ex, ey, c, out, cap, qcoef, qmax }));
    }
    if (!geoms.length) return { surfaces, intent, notes: ['no facet site has a legal reflection and aperture'] };

    const kernels = [], live = [];
    for (const g of geoms) {
      const ker = makeKernel(g, src, T, R);
      if (!(ker.sum > 1e-7)) continue;
      kernels.push(ker); live.push(g);
    }
    if (!live.length) return { surfaces, intent, notes: ['none of the facet images reaches the target'] };
    const paint = input.paint.cells;
    let ps = 0; for (let k = 0; k < paint.length; k++) ps += Math.max(0, +paint[k] || 0);
    const target = Float64Array.from(paint, (x) => Math.max(0, +x || 0) / (ps || 1));
    let qsum = 0; for (const g of live) qsum += g.qmax;
    const capShare = live.map((g) => g.qmax / qsum);
    let flux = capShare.slice();
    const weightCap = capShare.map((x) => Math.max(1e-12, settings.maxWeight * x));
    const pred = new Float64Array(R * R);
    for (let pass = 0; pass < settings.iterations; pass++) {
      pred.fill(0);
      for (let j = 0; j < live.length; j++) {
        const ker = kernels[j], f = flux[j];
        for (let q = 0; q < ker.idx.length; q++) pred[ker.idx[q]] += f * ker.val[q];
      }
      const next = new Float64Array(live.length);
      for (let j = 0; j < live.length; j++) {
        const ker = kernels[j];
        let num = 0;
        for (let q = 0; q < ker.idx.length; q++) {
          const k = ker.idx[q];
          if (target[k] > 0) num += ker.val[q] * target[k] / Math.max(1e-14, pred[k]);
        }
        next[j] = flux[j] * num / Math.max(1e-14, ker.sum);
      }
      let ns = 0; for (const x of next) ns += x;
      if (!(ns > 0)) break;
      for (let j = 0; j < next.length; j++) next[j] /= ns;
      flux = cappedNormalise(Array.from(next), weightCap);
    }
    let lambda = Infinity;
    for (let j = 0; j < live.length; j++) if (flux[j] > 1e-8) lambda = Math.min(lambda, live[j].qmax / flux[j]);
    if (!isFinite(lambda) || !(lambda > 0)) { flux = capShare.slice(); lambda = qsum; }

    let dropped = 0, predictedCaught = 0;
    for (let j = 0; j < live.length; j++) {
      const g = live[j], f = flux[j];
      if (!(f > 1e-7)) { dropped++; continue; }
      const caught = lambda * f, area = caught / g.qcoef;
      let rad = Math.sqrt(area / polyArea), surf = null;
      if (!(rad > 1e-5)) { dropped++; continue; }
      rad = Math.min(rad, g.cap);
      for (let attempt = 0; attempt < 14; attempt++) {
        const pts3 = [];
        for (let q = 0; q < polyN; q++) {
          const a = (q + 0.5) * 2 * Math.PI / polyN;
          pts3.push(add(g.P, add(mul(g.ex, rad * Math.cos(a)), mul(g.ey, rad * Math.sin(a)))));
        }
        const candidate = { type: 'facet', id: 'F' + surfaces.length, group: 'A', P: g.P, S0: S.slice(), Z: g.Z,
          flat: false, di: V.dist(g.P, g.Z), clip: { kind: 'poly', pts3 },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
        try {
          const C = RF.Geo.compile([candidate]);
          let ok = true;
          for (const poly of RF.Geo.outline(C, 0)) for (const p of poly) {
            let clearanceBad = V.dist(p, S) < keep * (1 + 1e-5) + 1e-6;
            for (const other of input.sources || []) if (V.dist(p, other.pos) < keep * (1 + 1e-5) + 1e-6) clearanceBad = true;
            if (!RF.Geo.envInside(env, p, 0) || clearanceBad) { ok = false; break; }
          }
          if (ok) { surf = candidate; break; }
        } catch (e) { /* shrink a numerically awkward patch below */ }
        rad *= 0.82;
        if (rad < 1e-5) break;
      }
      if (!surf) { dropped++; continue; }
      surfaces.push(surf); intent.push({ facet: surf.id, cells: [[g.aim.cell, f]] });
      predictedCaught += g.qcoef * polyArea * rad * rad;
    }
    const shields = [];
    for (const emitter of input.sources && input.sources.length ? input.sources : [src]) {
      const shield = directShield(input, emitter, RF.Engine.targetFrame(input.target));
      if (shield) {
        const all = input.sources && input.sources.length ? input.sources : [src];
        const clear = shield.clip.pts3.every((p) => all.every((other) => V.dist(p, other.pos) >= (env.keepOut || 0) + 1e-5));
        if (clear) { shield.id = 'DIRECT' + shields.length; shields.push(shield); surfaces.push(shield); }
      }
    }
    if (!shields.length) notes.push('no legal direct-light shield fits');
    notes.push(live.length + ' model facets; placed ' + (surfaces.length - shields.length) + ', omitted ' + dropped + '; predicted caught flux ' + (100 * predictedCaught).toFixed(2) + '% before reflectivity');
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-kimik31pro-r2--static-inverse', name: 'Static inverse facets', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'shell', label: 'Preferred outer shell (fraction)', type: 'range', min: 0.35, max: 0.95, step: 0.05, default: 0.7 },
      { key: 'inset', label: 'Facet centre along envelope ray', type: 'range', min: 0.75, max: 0.98, step: 0.01, default: 0.88 },
      { key: 'autoInset', label: 'Adapt inset to LED image size', type: 'checkbox', default: true },
      { key: 'packing', label: 'Angular aperture packing', type: 'range', min: 0.25, max: 0.48, step: 0.01, default: 0.48 },
      { key: 'iterations', label: 'Static allocation iterations', type: 'range', min: 5, max: 100, step: 5, default: 30 },
      { key: 'maxWeight', label: 'Maximum relative facet weight', type: 'range', min: 1, max: 12, step: 0.2, default: 2 },
      { key: 'outward', label: 'Minimum outward reflected direction', type: 'range', min: -0.8, max: 0.35, step: 0.05, default: -0.8 },
      { key: 'blockPenalty', label: 'Static beam-clearance penalty', type: 'range', min: 0, max: 12, step: 1, default: 5 },
    ],
    solve,
  });

  /* Optional trace tuner.  The static entry above remains independent and is still the first/default registration.
   * Every candidate is produced by that same static algorithm; tracing only chooses among its parameter sets. */
  RF.Solvers.register({
    id: 'bench-kimik31pro-r2--static-inverse-auto', name: 'Static inverse facets (auto)', version: '1.0', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful painting' }, { value: 'throw', label: 'Throw / peak' }, { value: 'efficient', label: 'Light on paint' },
      ] },
    ],
    solve(input, settings, tools) {
      const staticDef = RF.Solvers.get('bench-kimik31pro-r2--static-inverse'), baseSettings = RF.Solvers.defaults(staticDef);
      baseSettings.minDistance = settings.minDistance;
      const base = RF.Solvers.sanitize(staticDef, baseSettings);
      const baseOut = solve(input, base, tools);
      if (typeof tools.trace !== 'function') return baseOut;

      const variants = [
        {},
        { maxWeight: 1.4 },
        { maxWeight: 3 },
        { autoInset: false, inset: 0.84 },
        { autoInset: false, inset: 0.88, maxWeight: 1.4 },
        { autoInset: false, inset: 0.88 },
        { autoInset: false, inset: 0.88, maxWeight: 3 },
        { autoInset: false, inset: 0.92 },
        { autoInset: false, inset: 0.92, maxWeight: 3 },
        { autoInset: false, inset: 0.96 },
        { autoInset: false, inset: 0.96, maxWeight: 3 },
        { autoInset: false, inset: 0.96, maxWeight: 4 },
        { autoInset: false, inset: 0.9, blockPenalty: 10 },
        { autoInset: false, inset: 0.9, packing: 0.44 },
        { autoInset: false, inset: 0.96, blockPenalty: 10 },
      ];
      // Large caps only reduce the candidate count: geometry and tracing are more expensive, while the added
      // candidates mainly resolve fine painting detail that is already limited by the LED image.
      if ((input.limits.maxFacets | 0) > 160) variants.splice(7);
      const budgetRays = tools.budget && isFinite(tools.budget.rays) ? Math.max(0, tools.budget.rays) : 4e6;
      const pilotRays = Math.max(10000, Math.min(80000, Math.floor(budgetRays / 40)));
      const refineRays = Math.max(pilotRays, Math.min(400000, Math.floor(budgetRays / 8)));
      let used = 0;
      const goal = settings.goal || 'faithful';
      const objective = (tr) => {
        const f = tr && tr.fidelity;
        if (!f || !(f.fidelity > 0)) return -Infinity;
        if (goal === 'throw') return (tr.throwM || 0) * clamp((f.fidelity - 0.35) / 0.25, 0.02, 1);
        if (goal === 'efficient') return (f.onPaint || 0) * clamp((f.fidelity - 0.35) / 0.25, 0.02, 1);
        return f.fidelity;
      };
      const brief = (c) => ({ inset: c.settings.autoInset ? 'auto' : c.settings.inset, weight: c.settings.maxWeight,
        packing: c.settings.packing, clearance: c.settings.blockPenalty });
      const evaluate = (c, rays) => {
        if (used + rays > budgetRays * 0.75) return false;
        const out = c.index === 0 ? baseOut : solve(input, c.settings, tools);
        let tr;
        try { tr = tools.trace(out.surfaces, { rays, seed: input.seed, paint: input.paint.cells }); }
        catch (e) { return false; }
        used += rays; c.out = out; c.trace = tr; c.rays = rays; c.value = objective(tr);
        return true;
      };
      const candidates = variants.map((v, index) => ({
        index, settings: RF.Solvers.sanitize(staticDef, Object.assign({}, base, v)), out: null, trace: null, value: -Infinity,
      }));
      const piloted = [];
      for (const c of candidates) if (evaluate(c, pilotRays) && isFinite(c.value)) piloted.push(c);
      if (!piloted.length) return baseOut;
      piloted.sort((a, b) => b.value - a.value || a.index - b.index);
      const refine = piloted.slice(0, 3);
      if (!refine.includes(candidates[0]) && isFinite(candidates[0].value)) refine.push(candidates[0]);
      const refined = [];
      for (const c of refine) if (evaluate(c, refineRays) && isFinite(c.value)) refined.push(c);
      const pool = refined.length ? refined : piloted;
      pool.sort((a, b) => b.value - a.value || a.index - b.index);
      const best = pool[0], out = best.out || baseOut;
      out.notes = (out.notes || []).concat(['auto ' + goal + ': ' + JSON.stringify(brief(best)) + '; ' + best.rays + ' rays, fidelity ' +
        (100 * best.trace.fidelity.fidelity).toFixed(1) + '%, on paint ' + (100 * best.trace.fidelity.onPaint).toFixed(2) + '%; ' + used + ' tuner rays']);
      if (tools.preview) tools.preview(out.surfaces, { label: 'auto ' + goal, trace: best.trace });
      return out;
    },
  });
})();
