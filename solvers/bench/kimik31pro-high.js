/* Flux paint solver — deterministic equal-flux / equal-paint facet tiling.
 * Static geometry only: no engine trace, probe, or optimisation against a traced result. */
(function () {
  'use strict';
  const V = RF.V, Geo = RF.Geo;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const add = V.add, sub = V.sub, mul = V.mul, dot = V.dot;

  // Split the painted cells into spatially compact groups of (nearly) equal integrated paint.
  function paintGroups(input, wanted) {
    const R = input.paint.res, p = input.paint.cells, T = RF.Engine.designFrame(input.target);
    const uv = new Array(R * R), mass = new Float64Array(R * R);
    const cells = [];
    let total = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i, w = Math.max(0, +p[k] || 0);
      if (!(w > 0)) continue;
      uv[k] = RF.Engine.cellCenter(T, i, j); mass[k] = w; total += w; cells.push(k);
    }
    if (!cells.length) return { groups: [], T, uv, mass, total: 0 };
    const lists = [cells];
    while (lists.length < wanted) {
      let pick = -1, best = 0;
      // Splitting the largest-mass splittable group keeps all facet fluxes alike.
      for (let n = 0; n < lists.length; n++) {
        if (lists[n].length < 2) continue;
        let m = 0, spread = 0;
        for (const k of lists[n]) { m += mass[k]; const q = uv[k]; spread = Math.max(spread, Math.abs(q[0]), Math.abs(q[1])); }
        const score = m * (1 + 1e-6 * spread);
        if (score > best) { best = score; pick = n; }
      }
      if (pick < 0) break;
      const a = lists[pick];
      let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity], cov = [0, 0], sw = 0, mean = [0, 0];
      for (const k of a) {
        const q = uv[k], w = mass[k]; sw += w; mean[0] += w * q[0]; mean[1] += w * q[1];
        for (let d = 0; d < 2; d++) { lo[d] = Math.min(lo[d], q[d]); hi[d] = Math.max(hi[d], q[d]); }
      }
      mean = mul(mean, 1 / Math.max(1e-300, sw));
      for (const k of a) { const q = sub(uv[k], mean); cov[0] += mass[k] * q[0] * q[0]; cov[1] += mass[k] * q[1] * q[1]; }
      const ax = (hi[1] - lo[1] > hi[0] - lo[0] || (hi[1] - lo[1] === hi[0] - lo[0] && cov[1] > cov[0])) ? 1 : 0;
      const sorted = a.slice().sort((x, y) => uv[x][ax] - uv[y][ax] || uv[x][1 - ax] - uv[y][1 - ax] || x - y);
      let acc = 0, cut = 1;
      for (let i = 0; i < sorted.length - 1; i++) { acc += mass[sorted[i]]; if (acc >= sw * 0.5) { cut = i + 1; break; } }
      cut = clamp(cut, 1, sorted.length - 1);
      lists.splice(pick, 1, sorted.slice(0, cut), sorted.slice(cut));
    }
    const groups = lists.map((list) => {
      let sw = 0, c = [0, 0];
      for (const k of list) { sw += mass[k]; c = add(c, mul(uv[k], mass[k])); }
      c = mul(c, 1 / Math.max(1e-300, sw));
      let C = [0, 0, 0];                             // uu, uv, vv
      for (const k of list) { const q = sub(uv[k], c), w = mass[k]; C[0] += w * q[0] * q[0]; C[1] += w * q[0] * q[1]; C[2] += w * q[1] * q[1]; }
      C = C.map((x) => x / Math.max(1e-300, sw));
      return { list, mass: sw, uv: c, Z: RF.Engine.targetUVtoWorld(T, c[0], c[1]), C };
    });
    return { groups, T, uv, mass, total };
  }

  // Low-discrepancy directions drawn from the source's real angular distribution, followed by
  // deterministic vector k-means. Each direction cell therefore represents about the same LED flux.
  function directionCells(src, env, T, N, keep) {
    const S = src.pos, sampler = RF.Source.makeSampler(src), o = [0, 0, 0], d = [0, 0, 0];
    const M = Math.max(500, Math.min(1800, N * 14)), pool = [];
    const golden = 0.6180339887498949;
    for (let i = 0; i < M; i++) {
      RF.Source.sampleRay(sampler, 0.5, 0.5, 0.5, (i + 0.5) / M, (i * golden + 0.37) % 1, o, d);
      const u = V.norm(d), iv = Geo.envInterval(env, S, u), hi = iv[1] - Math.max(1e-5, iv[1] * 0.004);
      const lo = Math.max(0, iv[0], keep + Math.max(0.08, keep * 0.015));
      if (!(hi > lo + 0.1)) continue;
      // A facet at this direction must be able to send its chief ray to the lit face of the target.
      const r = lo + 0.88 * (hi - lo), P = add(S, mul(u, r)), a = V.norm(sub(T.C, P));
      if (!(dot(a, T.n) < -1e-6)) continue;
      const n = V.norm(sub(a, u)), ci = -dot(u, n);
      if (ci < 0.10) continue;
      pool.push({ u, lo, hi });
    }
    if (!pool.length) return [];
    const K = Math.min(N, pool.length), centers = [];
    let first = 0;
    for (let i = 1; i < pool.length; i++) if (pool[i].hi - pool[i].lo > pool[first].hi - pool[first].lo) first = i;
    centers.push(pool[first].u.slice());
    const near = new Float64Array(pool.length).fill(Infinity);
    for (let k = 1; k < K; k++) {
      let bi = 0, bv = -1;
      for (let i = 0; i < pool.length; i++) {
        const q = pool[i].u, c = centers[centers.length - 1];
        near[i] = Math.min(near[i], 2 - 2 * dot(q, c));
        if (near[i] > bv) { bv = near[i]; bi = i; }
      }
      centers.push(pool[bi].u.slice());
    }
    const assign = new Int32Array(pool.length);
    for (let it = 0; it < 7; it++) {
      const sum = centers.map(() => [0, 0, 0]), cnt = new Int32Array(K);
      for (let i = 0; i < pool.length; i++) {
        let b = 0, bd = -Infinity;
        for (let k = 0; k < K; k++) { const x = dot(pool[i].u, centers[k]); if (x > bd) { bd = x; b = k; } }
        assign[i] = b; cnt[b]++; sum[b] = add(sum[b], pool[i].u);
      }
      for (let k = 0; k < K; k++) if (cnt[k]) centers[k] = V.norm(sum[k]);
    }
    const out = centers.map((u, k) => {
      let count = 0, room = null;
      for (let i = 0; i < pool.length; i++) if (assign[i] === k) { count++; room = pool[i]; }
      // Means of valid directions are normally valid too. If an envelope corner makes one invalid,
      // use the closest actual sample instead of emitting an impossible facet.
      let iv = Geo.envInterval(env, S, u), hi = iv[1] - Math.max(1e-5, iv[1] * 0.004), lo = Math.max(0, iv[0], keep + Math.max(0.08, keep * 0.015));
      if (!(hi > lo + 0.1) && room) { u = room.u.slice(); lo = room.lo; hi = room.hi; }
      return { u, lo, hi, count };
    }).filter((q) => q.hi > q.lo + 0.1);
    for (let k = 0; k < out.length; k++) {
      let n1 = Infinity, n2 = Infinity;
      for (let j = 0; j < out.length; j++) if (j !== k) {
        const ds = 2 - 2 * dot(out[k].u, out[j].u);
        if (ds < n1) { n2 = n1; n1 = ds; } else if (ds < n2) n2 = ds;
      }
      out[k].spacing = Math.sqrt(isFinite(n2) ? 0.5 * (n1 + n2) : n1) || 0.15;
    }
    return out;
  }

  // Monotonic widest-axis pairing keeps the reflector's direction-to-paint map orderly without
  // an O(N^3) assignment problem. It is deterministic for every facet cap.
  function assignTargets(dirs, groups) {
    function pair(ds, gs) {
      if (!ds.length) return;
      if (gs.length === 1) { for (const d of ds) d.group = gs[0]; return; }
      if (ds.length === 1) { ds[0].group = gs.reduce((a, b) => a.mass > b.mass ? a : b); return; }
      const axis = (arr, get) => {
        let mn = [Infinity, Infinity], mx = [-Infinity, -Infinity];
        for (const q of arr) { const p = get(q); for (let k = 0; k < 2; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } }
        return mx[1] - mn[1] > mx[0] - mn[0] ? 1 : 0;
      };
      const ad = axis(ds, (q) => q.tc), ag = axis(gs, (q) => q.uv);
      const D = ds.slice().sort((a, b) => a.tc[ad] - b.tc[ad] || a.tc[1 - ad] - b.tc[1 - ad]);
      const G = gs.slice().sort((a, b) => a.uv[ag] - b.uv[ag] || a.uv[1 - ag] - b.uv[1 - ag]);
      const n = Math.min(D.length, G.length), d0 = Math.floor((D.length - n) / 2), g0 = Math.floor((G.length - n) / 2);
      for (let i = 0; i < n; i++) D[d0 + i].group = G[g0 + i];
      for (let i = 0; i < d0; i++) D[i].group = G[0];
      for (let i = d0 + n; i < D.length; i++) D[i].group = G[G.length - 1];
    }
    const n = Math.min(dirs.length, groups.length), dd = dirs.slice(0, n), gg = groups.slice(0, n);
    pair(dd, gg);
    return dd;
  }

  // Differential first-order tile model. It uses only the analytic quadric and the law of reflection.
  function tileModel(f, src, T, h) {
    const P = f.P, S = f.S0, Z = f.Z, D = V.dist(P, Z), flat = !!f.flat;
    const fq = Geo.facetQuadric(P, S, Z, flat ? null : f.di), n = fq.n;
    const ex = V.inPlane(n, f.clip.ref), ey = V.cross(n, ex), A = fq.A, b = fq.b;
    const Q = RF.M3.congruent(A, ex, ey, n), L = [dot(b, ex), dot(b, ey), dot(b, n)];
    function point(x, y) {
      let z = 0;
      if (!flat) {
        const aa = Q[8], bb = 2 * (Q[2] * x + Q[5] * y) + L[2];
        const cc = Q[0] * x * x + Q[4] * y * y + 2 * Q[1] * x * y + L[0] * x + L[1] * y;
        const roots = RF.U.quadRoots(aa, bb, cc); if (!roots.length) return null;
        z = Math.abs(roots[0]) < Math.abs(roots[roots.length - 1]) ? roots[0] : roots[roots.length - 1];
      }
      const X = add(P, add(mul(ex, x), add(mul(ey, y), mul(n, z))));
      let nn = n;
      if (!flat) {
        const gx = 2 * (Q[0] * x + Q[1] * y + Q[2] * z) + L[0], gy = 2 * (Q[1] * x + Q[4] * y + Q[5] * z) + L[1], gz = 2 * (Q[2] * x + Q[5] * y + Q[8] * z) + L[2];
        nn = V.norm(add(mul(ex, gx), add(mul(ey, gy), mul(n, gz))));
      }
      const inc = V.norm(sub(X, S)), out = V.reflect(inc, nn), den = dot(out, T.n);
      if (!(Math.abs(den) > 1e-12)) return null;
      const t = dot(sub(T.C, X), T.n) / den; if (!(t > 0)) return null;
      const H = add(X, mul(out, t)), q = sub(H, T.C);
      return [dot(q, T.tu), dot(q, T.tv)];
    }
    const stepA = clamp(h * 0.01, 0.003, 0.04), J = [[0, 0], [0, 0]];
    for (let a = 0; a < 2; a++) {
      const xp = a ? 0 : stepA, yp = a ? stepA : 0;
      const p = point(xp, yp), m = point(-xp, -yp); if (!p || !m) return null;
      J[0][a] = (p[0] - m[0]) / (2 * stepA); J[1][a] = (p[1] - m[1]) / (2 * stepA);
    }
    const stepS = Math.max(0.005, RF.Source.extentSize(src) * 0.01), JS = [[0, 0, 0], [0, 0, 0]];
    // Source derivatives at the centre need only the fixed centre normal, not a new quadric.
    const centreNormal = n;
    function sourcePoint(sp) {
      const inc = V.norm(sub(P, sp)), out = V.reflect(inc, centreNormal), den = dot(out, T.n);
      const t = dot(sub(T.C, P), T.n) / den, H = add(P, mul(out, t)), q = sub(H, T.C);
      return [dot(q, T.tu), dot(q, T.tv)];
    }
    for (let a = 0; a < 3; a++) {
      const e = [0, 0, 0]; e[a] = stepS;
      const p = sourcePoint(add(S, e)), m = sourcePoint(sub(S, e));
      JS[0][a] = (p[0] - m[0]) / (2 * stepS); JS[1][a] = (p[1] - m[1]) / (2 * stepS);
    }
    const Cs = RF.Source.extentCov(src);
    let sourceVar = 0;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) sourceVar += JS[a][i] * Cs[3 * i + j] * JS[b][j] * (a === b ? 0.5 : 0);
    const trJ = J[0][0] * J[0][0] + J[0][1] * J[0][1] + J[1][0] * J[1][0] + J[1][1] * J[1][1];
    return { sourceVar, trJ, variance: sourceVar + h * h * trJ / 6 };
  }

  function chooseCurvature(f, src, T, h, targetVar) {
    const D = V.dist(f.P, f.Z);
    f.flat = false; f.di = D;
    let best = tileModel(f, src, T, h); if (!best) { f.flat = true; f.di = null; return; }
    if (!(targetVar > best.variance * 1.002)) return;
    let hi = 1, lo = 0.035, loModel = null;
    // Defocus before the target: aperture spread rises monotonically over the useful range.
    for (const x of [0.94, 0.84, 0.70, 0.55, 0.40, 0.27, 0.17, 0.09, 0.035]) {
      f.di = D * x; const m = tileModel(f, src, T, h); if (!m) continue;
      if (m.variance >= targetVar) { lo = x; loModel = m; break; }
      hi = x; best = m;
    }
    if (!loModel) { f.di = D * lo; return; }
    for (let it = 0; it < 11; it++) {
      const x = Math.sqrt(lo * hi); f.di = D * x;
      const m = tileModel(f, src, T, h); if (!m) break;
      if (m.variance > targetVar) lo = x; else hi = x;
    }
    f.di = D * Math.sqrt(lo * hi);
  }

  function fits(f, env, keep) {
    let G;
    try { G = Geo.compile([f]); } catch (e) { return false; }
    for (const poly of Geo.outline(G, 0)) for (const p of poly) {
      if (!Geo.envInside(env, p, -1e-7)) return false;
      if (V.dist(p, f.S0) < keep + 1e-4) return false;
    }
    if (!Geo.envInside(env, f.P, -1e-7) || V.dist(f.P, f.S0) < keep + 1e-4) return false;
    // Outline checks alone miss a curved patch dipping into the clearance between its edges.
    // Evaluate the actual local quadric on an interior grid, not the tangent-plane chord.
    const D = G.D, fr = G.metas[0].frame;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const x = (i / 2 - 1) * f.clip.hx, y = (j / 2 - 1) * f.clip.hy;
      let z = 0; if (!f.flat) { z = Geo.localSag(D, 0, x, y); if (!isFinite(z)) return false; }
      const p = add(f.P, add(mul(fr.ex, x), add(mul(fr.ey, y), mul(fr.ez, z))));
      if (!Geo.envInside(env, p, -1e-7) || V.dist(p, f.S0) < keep + 1e-4) return false;
    }
    return true;
  }

  function solve(input, settings) {
    const src = input.source, env = input.envelope, S = src.pos;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0), refl = input.limits.reflectivity;
    const maxN = Math.max(0, input.limits.maxFacets | 0);
    let painted = paintGroups(input, maxN);
    if (!painted.groups.length || !maxN) return { surfaces: [], intent: [], notes: ['No painted cells (or a zero facet limit): no facets placed.'] };
    let N = Math.min(maxN, painted.groups.length), groups = painted.groups.slice(0, N), T = painted.T;
    const kernel = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target });
    const classification = RF.Modes.classify(input.paint.cells, input.paint.res, Math.max(1, kernel.cells));
    let spreadFactor = 1;
    if (classification.kind === 'text') spreadFactor = 0.55;
    else if (classification.kind === 'cutoff') spreadFactor = 0.70;
    else if (classification.kind === 'photo') spreadFactor = 0.80;
    else if (classification.kind === 'wash') spreadFactor = classification.features.coverage > 0.6 ? 1.45 : classification.features.coverage < 0.2 ? 0.75 : 1;
    const effectiveSpread = settings.spread * spreadFactor;
    const needsSharp = classification.kind === 'text' || classification.kind === 'cutoff' || (classification.kind === 'wash' && classification.features.coverage < 0.2);
    const radiusSetting = needsSharp ? Math.max(settings.radius, 0.97) : settings.radius;
    const useStrict = settings.shellStrict && !needsSharp;
    let dirs = directionCells(src, env, T, N, keep);
    if (!dirs.length) return { surfaces: [], intent: groups.map((g) => ({ facet: null, cells: g.list.map((k) => [k, painted.mass[k]]) })), notes: ['No source direction has room for a reflecting facet.'] };
    const axis = V.norm(sub(T.C, S)), basis = V.basis(axis);
    for (const d of dirs) d.tc = [dot(d.u, basis[0]), dot(d.u, basis[1])];
    dirs = assignTargets(dirs, groups);
    // A common paraboloid is the non-blocking shell for rays aimed near the target axis.
    // Its size comes from the distribution of envelope-limited radii.
    let shellP = Infinity;
    if (settings.shell === 'paraboloid') {
      const ps = [];
      for (const d of dirs) {
        const g = 1 - dot(d.u, axis), rWall = d.lo + radiusSetting * (d.hi - d.lo);
        if (g > 0.015) ps.push(rWall * g);
      }
      ps.sort((a, b) => a - b);
      // Do not let one tight forward ray collapse the whole dish. Half the cells follow the
      // paraboloid exactly; the rest stop at their envelope-limited radius.
      if (ps.length) shellP = ps[Math.floor(settings.shellQ * (ps.length - 1))];
    }
    if (useStrict && N >= 32 && settings.shell === 'paraboloid' && isFinite(shellP)) {
      const strict = dirs.filter((d) => {
        const rWall = d.lo + radiusSetting * (d.hi - d.lo), r = shellP / Math.max(0.015, 1 - dot(d.u, axis));
        return r >= d.lo && r <= rWall;
      });
      if (strict.length >= 4 && strict.length < dirs.length) {
        dirs = strict; N = dirs.length; painted = paintGroups(input, N); groups = painted.groups.slice(0, N); T = painted.T;
        for (const d of dirs) { delete d.group; let n1 = Infinity, n2 = Infinity; for (const q of dirs) if (q !== d) { const ds = 2 - 2 * dot(d.u, q.u); if (ds < n1) { n2 = n1; n1 = ds; } else if (ds < n2) n2 = ds; } d.spacing = Math.sqrt(isFinite(n2) ? 0.5 * (n1 + n2) : n1) || 0.15; }
        dirs = assignTargets(dirs, groups);
      }
    }
    const meanMass = groups.reduce((a, g) => a + g.mass, 0) / groups.length;
    // Calibrate each facet's caught flux with the small-cone photometric integral. On the
    // diagnostic scene this predicts traced caught flux/mass with only a few percent error.
    const sourceAxis = RF.Source.frame(src).a;
    for (const d of dirs) {
      const g = d.group; if (!g) continue;
      const rWall = d.lo + radiusSetting * (d.hi - d.lo);
      let r = rWall;
      if (settings.shell === 'paraboloid' && isFinite(shellP)) r = clamp(shellP / Math.max(0.015, 1 - dot(d.u, axis)), d.lo, rWall);
      const P = add(S, mul(d.u, r)), a = V.norm(sub(g.Z, P)), n = V.norm(sub(a, d.u)), ci = Math.max(0.08, -dot(d.u, n));
      let h = r * d.spacing * settings.packing * 0.5 / Math.sqrt(ci);
      h *= Math.pow(g.mass / Math.max(1e-300, meanMass), 0.5 * settings.balance);
      h = clamp(h, r * 0.006, r * 0.32);
      const intensity = Math.max(1e-12, RF.Source.intensity(src, V.angle(d.u, sourceAxis)));
      d.plan = { r, h, cone: intensity * ci * (h / r) * (h / r) / Math.max(1e-300, g.mass) };
    }
    const cones = dirs.filter((d) => d.plan).map((d) => d.plan.cone).sort((a, b) => a - b);
    const coneMid = cones.length ? cones[cones.length >> 1] : 1;
    for (const d of dirs) if (d.plan) d.plan.h *= clamp(Math.pow(coneMid / d.plan.cone, 0.5 * settings.fluxBalance), 0.35, 3);
    const surfaces = [], intent = [], notes = [], usedGroups = new Set();
    let shrunk = 0, radialRepairs = 0, rejected = 0;
    for (let k = 0; k < dirs.length; k++) {
      const d = dirs[k], g = d.group; if (!g) continue;
      let r = d.plan.r;
      let P = add(S, mul(d.u, r));
      let D = V.dist(P, g.Z), a = V.norm(sub(g.Z, P));
      if (!(D > 0 && dot(a, T.n) < -1e-8)) continue;
      const n = V.norm(sub(a, d.u)), ci = -dot(d.u, n); if (ci < 0.075) continue;
      const id = 'F' + k;
      let h = d.plan.h;
      const ref = Math.abs(dot(n, T.tu)) < 0.97 ? T.tu : T.tv;
      const f = { type: 'facet', id, group: 'A', P, S0: S.slice(), Z: g.Z.slice(), flat: false, di: D,
        clip: { kind: 'rect', hx: h, hy: h, ref }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
      const cell = 2 * T.half / input.paint.res;
      const targetVar = effectiveSpread * effectiveSpread * (0.5 * (g.C[0] + g.C[2]) + cell * cell / 12);
      chooseCurvature(f, src, T, h, targetVar);
      let good = fits(f, env, keep), trials = 0;
      while (!good && trials++ < 24 && h > r * 0.001) {
        if (r * 0.90 > d.lo) {
          // Scale the WHOLE little reflector about the LED. Its direction cone, and therefore
          // its caught flux, stays intact; shrinking only h would make this patch artificially dim.
          r *= 0.90; h *= 0.90; P = add(S, mul(d.u, r)); f.P = P; D = V.dist(P, g.Z); radialRepairs++;
        } else {
          h *= 0.78; shrunk++;
        }
        f.clip.hx = f.clip.hy = h;
        chooseCurvature(f, src, T, h, targetVar); good = fits(f, env, keep);
      }
      if (!good) { rejected++; continue; }
      const af = V.norm(sub(g.Z, P)), nf = V.norm(sub(af, d.u)), ciFinal = Math.max(0, -dot(d.u, nf));
      const finalCone = Math.max(1e-12, RF.Source.intensity(src, V.angle(d.u, sourceAxis))) * ciFinal * (h / r) * (h / r) / Math.max(1e-300, g.mass);
      // A tiny facet beside an extended LED is not a useful projector: aberration can send its
      // image many cells away. Likewise, do not retain a facet whose fit repair destroyed its cone.
      if (finalCone < 0.15 * coneMid || (r < 4 * RF.Source.extentSize(src) && finalCone < 0.5 * coneMid)) { rejected++; continue; }
      surfaces.push(f); usedGroups.add(g);
      intent.push({ facet: id, cells: g.list.map((q) => [q, painted.mass[q]]) });
    }
    // Any paint groups left without a direction remain explicit unplaced intent.
    for (const g of groups) if (!usedGroups.has(g)) intent.push({ facet: null, cells: g.list.map((q) => [q, painted.mass[q]]) });
    notes.push(surfaces.length + ' static facets: ' + classification.kind + ' paint, spread ×' + effectiveSpread.toFixed(2) + '; ' + rejected + ' weak/unusable rejected; ' + radialRepairs + ' radial repairs, ' + shrunk + ' aperture-only reductions.');
    return { surfaces, intent, notes };
  }

  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'spread', label: 'Target patch spread', type: 'range', min: 0.6, max: 2, step: 0.05, default: 1.4 },
    { key: 'packing', label: 'Source aperture packing', type: 'range', min: 0.35, max: 1.2, step: 0.05, default: 0.7 },
    { key: 'radius', label: 'Radial position in available room', type: 'range', min: 0.2, max: 0.97, step: 0.01, default: 0.88 },
    { key: 'shell', label: 'Facet layout shell', type: 'select', default: 'paraboloid', options: [{ value: 'paraboloid', label: 'Non-blocking paraboloid' }, { value: 'wall', label: 'Envelope-hugging radii' }] },
    { key: 'shellQ', label: 'Paraboloid size percentile', type: 'range', min: 0.1, max: 0.8, step: 0.05, default: 0.5 },
    { key: 'shellStrict', label: 'Only directions fitting the common shell', type: 'checkbox', default: true },
    { key: 'balance', label: 'Aperture response to paint mass', type: 'range', min: 0, max: 1, step: 0.1, default: 1 },
    { key: 'fluxBalance', label: 'Static per-facet flux equalisation', type: 'range', min: 0, max: 1, step: 0.1, default: 1 },
  ];
  const defaultSettings = () => Object.fromEntries(SETTINGS.map((f) => [f.key, f.default]));

  RF.Solvers.register({
    id: 'bench-kimik31pro-high--static-tiles', name: 'Static covariance tiles', version: '0.6', modes: ['paint'], settings: SETTINGS, solve,
  });

  // Optional trace tuner. The static solver above remains the first registration and never calls
  // this code. Every candidate is made by the same static algorithm; only its declared knobs differ.
  function solveAuto(input, settings, tools) {
    const base = Object.assign(defaultSettings(), { minDistance: settings.minDistance });
    const variations = [
      {},
      { packing: 0.55 }, { packing: 0.85 }, { packing: 1.00 }, { packing: 1.20 },
      { spread: 1.10 }, { spread: 1.70 },
      { shellStrict: false }, { radius: 0.97 },
      { shellQ: 0.35 }, { shellQ: 0.65 }, { fluxBalance: 0.65 },
    ];
    const candidates = variations.map((v, index) => {
      const set = Object.assign({}, base, v), out = solve(input, set);
      return { index, set, out, rays: 0, F: 0, onPaint: 0, peak: 0 };
    });
    const seed = input.seed | 0, coarseRays = 80000, fineRays = 400000;
    let traced = 0;
    const rayLimit = tools && tools.budget && isFinite(tools.budget.rays) ? Math.max(0, tools.budget.rays) : 2e7;
    function measure(c, rays) {
      if (traced + rays > rayLimit) return;
      const tr = tools.trace(c.out.surfaces, { rays, seed });
      traced += rays; c.rays += rays;
      const f = tr.fidelity;
      c.F = f && isFinite(f.fidelity) ? f.fidelity : 0;
      c.onPaint = f && isFinite(f.onPaint) ? f.onPaint : 0;
      c.peak = isFinite(tr.peakCd) ? tr.peakCd : 0;
      c.within = f ? f.within : 0; c.gaps = f ? f.gapsDark : 0;
    }
    for (const c of candidates) { measure(c, coarseRays); if (tools.progress) tools.progress(0.6 * (c.index + 1) / candidates.length, 'candidate ' + (c.index + 1) + '/' + candidates.length); }
    const bestCoarseF = Math.max(...candidates.map((c) => c.F));
    let shortlist;
    if (settings.goal === 'throw') {
      shortlist = candidates.filter((c) => c.F >= Math.max(0.35, bestCoarseF - 0.14)).sort((a, b) => b.peak - a.peak || b.F - a.F || a.index - b.index).slice(0, 3);
    } else if (settings.goal === 'efficient') {
      shortlist = candidates.filter((c) => c.F >= Math.max(0.40, bestCoarseF - 0.10)).sort((a, b) => b.onPaint - a.onPaint || b.F - a.F || a.index - b.index).slice(0, 3);
    } else {
      shortlist = candidates.slice().sort((a, b) => b.F - a.F || b.onPaint - a.onPaint || a.index - b.index).slice(0, 3);
    }
    if (!shortlist.some((c) => c.index === 0)) shortlist.push(candidates[0]);
    for (let i = 0; i < shortlist.length; i++) { measure(shortlist[i], fineRays); if (tools.progress) tools.progress(0.6 + 0.35 * (i + 1) / shortlist.length, 'refine ' + (i + 1) + '/' + shortlist.length); }
    const bestF = Math.max(...shortlist.map((c) => c.F));
    let pool;
    if (settings.goal === 'throw') {
      pool = shortlist.filter((c) => c.F >= Math.max(0.45, bestF - 0.10));
      pool.sort((a, b) => b.peak - a.peak || b.F - a.F || a.index - b.index);
    } else if (settings.goal === 'efficient') {
      pool = shortlist.filter((c) => c.F >= Math.max(0.50, bestF - 0.05));
      pool.sort((a, b) => b.onPaint - a.onPaint || b.F - a.F || a.index - b.index);
    } else {
      pool = shortlist.slice();
      pool.sort((a, b) => (b.F + 0.01 * Math.min(1, b.onPaint / 0.15)) - (a.F + 0.01 * Math.min(1, a.onPaint / 0.15)) || b.onPaint - a.onPaint || a.index - b.index);
    }
    // An empty gate can only arise from numerical/noise edge cases; candidate zero is always safe.
    const best = pool.length && pool[0].rays ? pool[0] : candidates[0];
    const out = best.out;
    out.notes = (out.notes || []).concat(['auto ' + settings.goal + ': candidate ' + best.index + ', F ' + best.F.toFixed(3) + ', on-paint ' + best.onPaint.toFixed(3) + ', peak ' + Math.round(best.peak) + ' cd; ' + (traced / 1e6).toFixed(2) + 'M common-seed tuner rays.',
      'auto settings: ' + JSON.stringify(best.set)]);
    if (tools.progress) tools.progress(1, 'done');
    return out;
  }

  RF.Solvers.register({
    id: 'bench-kimik31pro-high--static-tiles-auto', name: 'Static covariance tiles (trace tuner)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', default: 'faithful', options: [
        { value: 'faithful', label: 'Faithful painting' }, { value: 'throw', label: 'Peak / throw with a fidelity floor' }, { value: 'efficient', label: 'Light on paint with a fidelity floor' },
      ] },
    ],
    solve: solveAuto,
  });
})();
