/* Bundled model solver: GPT-6 Luna (Codex), Flux solver benchmark run 2026-09-26 (workspace work-luna6-codex-flux-solver-20260926-0446).
 * Copied verbatim from that run's solvers/solver.js (sha256 06a5067defda…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
/* A deterministic, static paint solver.
 *
 * It places a sparse field of curved facets on an inset cap near the far end of the
 * emitter's forward envelope.  Paint is reduced to weighted target points, then each
 * facet is aimed at one point and sized in proportion to its share of the paint and
 * the light available at its physical location.  No ray tracing is used here.
 */
RF.Solvers.register({
  id: 'cap-paint', name: 'Cap paint solver', version: '0.2', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'aperture', label: 'Facet aperture', type: 'range', min: 0.15, max: 0.45, step: 0.01, default: 0.45 },
    { key: 'capBlend', label: 'Cap direction blend', type: 'range', min: 0, max: 1, step: 0.05, default: 1 },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, src = input.source, env = input.envelope;
    const S = src.pos, T = RF.Engine.designFrame(input.target), paint = input.paint.cells;
    const budget = Math.max(0, input.limits.maxFacets | 0);
    const clearance = Math.max(env.keepOut || 0, settings.minDistance || 0);
    if (!budget || !paint || !paint.some((w) => w > 0)) return { surfaces: [], notes: ['No facet budget or no painted cells.'] };

    const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const dot = V.dot, norm = V.norm, sub = V.sub, mul = V.mul, add = V.add;
    const unit = (x) => norm(x);
    const cross = V.cross;
    const minHalf = Math.max(1e-6, Math.min(...env.half));
    const srcFrame = RF.Source.frame(src), srcAxis = srcFrame.a;

    // Compress very large paint grids to a 160×160 weighted grid.  At the facet cap,
    // retaining every original pixel would not add useful aiming resolution.
    const R = input.paint.res | 0, workR = Math.min(R, 160), block = R / workR;
    const accum = new Float64Array(workR * workR), sumU = new Float64Array(workR * workR), sumV = new Float64Array(workR * workR);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = +paint[j * R + i];
      if (!(w > 0) || !isFinite(w)) continue;
      const bi = Math.min(workR - 1, Math.floor(i / block)), bj = Math.min(workR - 1, Math.floor(j / block)), k = bj * workR + bi;
      const uv = RF.Engine.cellCenter(T, i, j);
      accum[k] += w; sumU[k] += w * uv[0]; sumV[k] += w * uv[1];
    }
    const points = [];
    for (let k = 0; k < accum.length; k++) if (accum[k] > 0) points.push({
      i: k % workR, j: (k / workR) | 0, u: sumU[k] / accum[k], v: sumV[k] / accum[k], w: accum[k],
    });
    if (!points.length) return { surfaces: [], notes: ['No painted cells with positive weight.'] };

    const support = (d) => {
      const h = env.half;
      if (env.shape === 'ellipsoid') return Math.hypot(h[0] * d[0], h[1] * d[1], h[2] * d[2]);
      if (env.shape === 'cylinder') {
        const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
        return Math.abs(d[ax]) * h[ax] + Math.hypot(d[i] * h[i], d[j] * h[j]);
      }
      return Math.abs(d[0]) * h[0] + Math.abs(d[1]) * h[1] + Math.abs(d[2]) * h[2];
    };
    const targetCenter = RF.Engine.targetUVtoWorld(T, 0, 0);
    const targetAxis = unit(sub(targetCenter, S));
    const blend = clamp(+settings.capBlend || 0, 0, 1);
    let shellAxis = unit(add(mul(srcAxis, 1 - blend), mul(targetAxis, blend)));
    if (V.len(shellAxis) < 1e-8) shellAxis = srcAxis;
    const shellU = V.basis(shellAxis)[0], shellV = cross(shellAxis, shellU);
    const ru = support(shellU), rv = support(shellV), cap = support(shellAxis);
    const want = Math.min(budget, points.length);
    const nominalPitch = Math.sqrt(Math.max(1e-9, 4 * ru * rv / Math.max(1, want)));
    const depth0 = clamp(Math.max(0.32 * minHalf, 0.42 * nominalPitch), 0.5, 0.68 * minHalf);

    // Candidate mirrors occupy a regular grid in a plane perpendicular to the LED axis.
    // A larger pool lets the greedy spacing pass avoid corners outside a round envelope.
    function candidatesAt(depth) {
      const poolN = Math.max(96, want * 6), ratio = ru / Math.max(1e-9, rv);
      const cols = Math.max(1, Math.ceil(Math.sqrt(poolN * ratio))), rows = Math.max(1, Math.ceil(poolN / cols));
      const pitchU = 2 * ru / cols, pitchV = 2 * rv / rows, out = [];
      const center = env.center;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = -ru + (i + 0.5) * pitchU, b = -rv + (j + 0.5) * pitchV;
        const P = add(center, add(mul(shellAxis, cap - depth), add(mul(shellU, a), mul(shellV, b))));
        if (!Geo.envInside(env, P, -1e-7)) continue;
        const rvec = sub(P, S), r = V.len(rvec);
        if (!(r > clearance + 0.12 * Math.hypot(pitchU, pitchV))) continue;
        const toward = mul(rvec, 1 / r), theta = Math.acos(clamp(dot(toward, srcAxis), -1, 1));
        const intensity = RF.Source.intensity(src, theta);
        if (!(intensity > 1e-10)) continue;
        const sh = unit(sub(S, P)), ah = unit(sub(targetCenter, P)), n = unit(add(sh, ah));
        const incidence = dot(sh, n);
        if (!(incidence > 0.04) || dot(ah, T.n) >= -1e-4) continue;
        const gain = intensity * incidence / (r * r);
        out.push({ P, a, b, gain, r, pitchU, pitchV });
      }
      return { out, pitchU, pitchV };
    }
    let pool = [], chosen = [], chosenPoolCount = 0, chosenPitchU = 0, chosenPitchV = 0;
    for (const f of [1, 1.35, 1.8, 2.4]) {
      const q = candidatesAt(Math.min(0.9 * minHalf, depth0 * f));
      const localChosen = [];
      pool = q.out;
      if (pool.length) {
        const K = Math.min(want, pool.length), used = new Uint8Array(pool.length), near2 = new Float64Array(pool.length).fill(Infinity);
        let qMax = Math.max(...pool.map((p) => p.gain));
        for (let n = 0; n < K; n++) {
          let best = -1, bestScore = -1;
          for (let k = 0; k < pool.length; k++) if (!used[k]) {
            const score = n === 0 ? pool[k].gain / qMax : near2[k] * Math.sqrt(pool[k].gain / qMax);
            if (score > bestScore) { best = k; bestScore = score; }
          }
          if (best < 0) break;
          used[best] = 1; localChosen.push(pool[best]);
          for (let k = 0; k < pool.length; k++) if (!used[k]) {
            const dx = pool[k].a - pool[best].a, dy = pool[k].b - pool[best].b;
            near2[k] = Math.min(near2[k], dx * dx + dy * dy);
          }
        }
      }
      if (localChosen.length > chosen.length) { chosen = localChosen; chosenPoolCount = pool.length; chosenPitchU = q.pitchU; chosenPitchV = q.pitchV; }
      if (localChosen.length >= want) { chosen = localChosen; chosenPoolCount = pool.length; chosenPitchU = q.pitchU; chosenPitchV = q.pitchV; break; }
    }
    const K = Math.min(want, chosen.length);
    if (!K) return { surfaces: [], notes: ['No forward-facing cap positions satisfy the source, envelope, and clearance.'] };

    // Deterministic weighted Morton quantiles seed the target aims.  Weighted Lloyd
    // refinement keeps the number of facets proportional to painted energy, including
    // multi-level paintings, while giving each facet a compact patch of intent.
    const spread = (x) => {
      x &= 0xffff; x = (x | (x << 8)) & 0x00ff00ff; x = (x | (x << 4)) & 0x0f0f0f0f;
      x = (x | (x << 2)) & 0x33333333; x = (x | (x << 1)) & 0x55555555; return x >>> 0;
    };
    const ordered = points.slice().sort((a, b) => ((spread(a.i) | (spread(a.j) << 1)) >>> 0) - ((spread(b.i) | (spread(b.j) << 1)) >>> 0));
    const totalW = ordered.reduce((s, p) => s + p.w, 0), centers = [];
    let oi = 0, cw = ordered[0].w;
    for (let c = 0; c < K; c++) {
      const threshold = (c + 0.5) * totalW / K;
      while (oi < ordered.length - 1 && cw < threshold) { oi++; cw += ordered[oi].w; }
      centers.push({ u: ordered[oi].u, v: ordered[oi].v });
    }
    const masses = new Float64Array(K), sumsU = new Float64Array(K), sumsV = new Float64Array(K);
    for (let iter = 0; iter < 10; iter++) {
      masses.fill(0); sumsU.fill(0); sumsV.fill(0);
      for (let i = 0; i < points.length; i++) {
        const p = points[i]; let best = 0, bd = Infinity;
        for (let c = 0; c < K; c++) { const du = p.u - centers[c].u, dv = p.v - centers[c].v, d = du * du + dv * dv; if (d < bd) { bd = d; best = c; } }
        masses[best] += p.w; sumsU[best] += p.w * p.u; sumsV[best] += p.w * p.v;
      }
      for (let c = 0; c < K; c++) if (masses[c] > 0) centers[c] = { u: sumsU[c] / masses[c], v: sumsV[c] / masses[c] };
    }

    const clusters = Array.from({ length: K }, (_, c) => ({ u: centers[c].u, v: centers[c].v, mass: masses[c] }));
    const apertures = Math.max(0.15, +settings.aperture || 0.38), raw = [];
    for (let c = 0; c < K; c++) {
      const P = chosen[c].P, Z = RF.Engine.targetUVtoWorld(T, clusters[c].u, clusters[c].v);
      const sh = unit(sub(S, P)), ah = unit(sub(Z, P)), n = unit(add(sh, ah));
      const incidence = dot(sh, n), r = V.dist(P, S), toward = unit(sub(P, S));
      const intensity = RF.Source.intensity(src, Math.acos(clamp(dot(toward, srcAxis), -1, 1)));
      const gain = Math.max(1e-20, intensity * incidence / (r * r));
      let nearest = Infinity;
      for (let q = 0; q < K; q++) if (q !== c) nearest = Math.min(nearest, Math.hypot(chosen[q].a - chosen[c].a, chosen[q].b - chosen[c].b));
      if (!isFinite(nearest)) nearest = Math.hypot(chosenPitchU, chosenPitchV) * Math.sqrt(Math.max(1, chosenPoolCount));
      const areaPitch = Math.sqrt(Math.max(1e-9, (4 * ru * rv * chosenPoolCount / Math.max(1, want * 6)) / K));
      const pitch = Math.max(1e-3, Math.min(nearest, 1.5 * areaPitch));
      raw.push({ P, Z, n, mass: Math.max(1e-10, clusters[c].mass), gain, pitch, c });
    }
    const ratios = raw.map((q) => Math.sqrt(q.mass / q.gain) / q.pitch).sort((a, b) => a - b);
    const mid = ratios[(ratios.length / 2) | 0] || 1;
    const scale = (apertures / Math.SQRT2) / mid;
    const surfaces = [];
    for (const q of raw) {
      const base = Math.sqrt(q.mass / q.gain) * scale;
      const hMax = Math.min(0.42 * q.pitch / Math.SQRT2, 0.46 * q.pitch);
      let h = clamp(base, 0.045 * q.pitch, hMax);
      let ex = V.inPlane(q.n, shellU);
      if (V.len(ex) < 1e-8) ex = V.inPlane(q.n, shellV);
      const ey = unit(cross(q.n, ex));
      const mkSurface = (half) => ({
        type: 'facet', id: 'F' + q.c, group: 'A', P: q.P, S0: S.slice(), Z: q.Z,
        di: V.dist(q.P, q.Z), flat: false,
        clip: { kind: 'poly', ref: ex, pts3: [
          add(q.P, add(mul(ex, -half), mul(ey, -half))), add(q.P, add(mul(ex, half), mul(ey, -half))),
          add(q.P, add(mul(ex, half), mul(ey, half))), add(q.P, add(mul(ex, -half), mul(ey, half))),
        ] },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false },
      });
      let surface = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const trial = mkSurface(h), G = Geo.compile([trial]), m = G.metas[0].frame, okMargin = Math.max(0.003, 0.015 * q.pitch);
        let safe = true;
        for (let iy = 0; iy <= 8 && safe; iy++) for (let ix = 0; ix <= 8 && safe; ix++) {
          const x = (2 * ix / 8 - 1) * h, y = (2 * iy / 8 - 1) * h;
          const z = trial.flat ? 0 : Geo.localSag(G.D, 0, x, y);
          if (!isFinite(z)) { safe = false; break; }
          const p = add(q.P, add(mul(m.ex, x), add(mul(m.ey, y), mul(m.ez, z))));
          if (!Geo.envInside(env, p, -1e-6) || V.dist(p, S) < clearance + okMargin) { safe = false; break; }
        }
        if (safe) { surface = trial; break; }
        h *= 0.78;
        if (h < 0.015 * q.pitch) break;
      }
      if (surface) surfaces.push(surface);
    }
    return { surfaces, notes: [
      'Weighted target clustering with curved ellipsoid facets; ' + surfaces.length + ' of ' + K + ' placed.',
      'Cap inset ' + (cap - dot(sub(chosen[0].P, env.center), shellAxis)).toFixed(1) + ' mm; effective LED clearance ' + clearance.toFixed(1) + ' mm.',
    ] };
  },
});
})();
