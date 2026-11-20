/* facetpaint — a STATIC paint solver: it designs faceted reflector geometry directly from the
 * painting (no tracing inside solve()).
 *
 * Approach:
 *   1. Painted cells are split into M balanced regions by recursive weighted-median bisection
 *      (one region per facet, equal paint weight each).
 *   2. Each region gets one curved facet: an ellipsoid patch (foci LED → region centre, image
 *      distance di = P→Z), so it images the LED onto the region centre.  Measured on this engine:
 *      the LED image diameter is ≈ s·D/r (s = LED size, D = facet→target, r = LED→facet) plus a
 *      wide faint halo that shrinks fast as the facet grows relative to r (h/r ≳ 0.3: halo ~10%).
 *   3. Facet positions come from a deterministic "visible shell": the farthest pool point per LED
 *      direction bin (no facet directly behind another ⇒ little mutual shadowing, and as far from
 *      the LED — as sharp — as each direction allows).  A beam-corridor penalty keeps facets out
 *      of each other's reflected beams.
 *   4. Per-facet flux is fitted to the (blurred) paint by a capped multiplicative (EM-like) fit
 *      against an analytic flux model (LED intensity integrated over each facet's solid angle,
 *      occlusion-derated) — still no tracing.
 *   5. Areas follow from the fitted flux; a brightness ladder scales the fit up as long as the
 *      shape holds (the scorer refits the absolute exposure, so uniform overshoot is free).
 */
const SETTINGS = [
  { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
  { key: 'spotScale', label: 'Spot size × region (×)', type: 'range', min: 0.8, max: 2.5, step: 0.1, default: 1.2 },
  { key: 'kernelX', label: 'Blob size × sharpest possible', type: 'range', min: 1, max: 8, step: 0.5, default: 4.5 },
  { key: 'maxFacetHalf', label: 'Max facet half-size (mm)', type: 'number', min: 2, step: 1, default: 6 },
  { key: 'maxFrac', label: 'Max share of LED flux caught', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.7 },
  { key: 'shellA', label: 'Shell azimuth bins', type: 'range', min: 4, max: 48, step: 1, default: 24 },
  { key: 'shellE', label: 'Shell elevation bins', type: 'range', min: 3, max: 24, step: 1, default: 12 },
];

// The static design pipeline, shared by the plain solver and the -auto tuner below.
function buildDesign(input, settings) {
    const V = RF.V, EN = RF.Engine, SO = RF.Source, env = input.envelope;
    const notes = [];
    // distance from point q to segment [a, b]
    const segDist = (q, a, b) => {
      const ab = V.sub(b, a), l2 = V.dot(ab, ab);
      if (l2 < 1e-18) return V.dist(q, a);
      const t = Math.max(0, Math.min(1, V.dot(V.sub(q, a), ab) / l2));
      return V.dist(q, V.add(a, V.mul(ab, t)));
    };
    const srcs = (input.sources && input.sources.length ? input.sources : [input.source]).filter((s) => s && s.power > 0);
    const Ptot = srcs.reduce((a, s) => a + s.power, 0);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const refl = input.limits.reflectivity;
    const R = input.paint.res, paint = input.paint.cells;
    const T = EN.targetFrame(input.target);
    const cell = 2 * T.half / R;
    const toWorld = (u, v) => EN.targetUVtoWorld(T, u, v);
    // flux-weighted mean source position (aim reference)
    const S0 = (() => { let p = [0, 0, 0], w = 0; for (const s of srcs) { p = V.add(p, V.mul(s.pos, s.power)); w += s.power; } return w > 0 ? V.mul(p, 1 / w) : [0, 0, 0]; })();
    function ledSize(s) {
      return s.kind === 'planar' ? (s.shape === 'disc' ? 2 * s.radius : Math.min(s.w, s.h))
        : s.kind === 'volume' ? (s.shape === 'cylinder' ? Math.min(2 * s.radius, s.length) : 2 * s.radius)
        : 2 * (s.radius || 1);
    }
    function insideMargin(e, p, m) {
      const d = [p[0] - e.center[0], p[1] - e.center[1], p[2] - e.center[2]], h = e.half, sh = e.shape || 'box';
      if (sh === 'box') return Math.abs(d[0]) <= h[0] - m && Math.abs(d[1]) <= h[1] - m && Math.abs(d[2]) <= h[2] - m;
      if (sh === 'ellipsoid') { let q = 0; for (let a = 0; a < 3; a++) q += (d[a] / Math.max(1e-9, h[a] - m)) ** 2; return q <= 1; }
      const ax = e.axis === undefined ? 2 : e.axis, i = (ax + 1) % 3, j2 = (ax + 2) % 3;
      return Math.abs(d[ax]) <= h[ax] - m && (d[i] / Math.max(1e-9, h[i] - m)) ** 2 + (d[j2] / Math.max(1e-9, h[j2] - m)) ** 2 <= 1;
    }

    // ---------------- painted cells
    const cells = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = paint[j * R + i];
      if (w > 0) { const [cu, cv] = EN.cellCenter(T, i, j); cells.push({ i, j, k: j * R + i, ix: i + 0.5, iy: j + 0.5, w, Z: toWorld(cu, cv) }); }
    }
    if (!cells.length) return { surfaces: [], intent: [], notes: ['nothing painted — nothing placed'] };

    const s0 = Math.min(...srcs.map(ledSize));

    const kernelX = settings.kernelX || 2;
    const ker0 = RF.Photometry.achievableKernel({ source: input.source, target: input.target, envelope: env });
    const kernelMM0 = ker0.cells > 0 ? Math.max(1e-6, ker0.mm) : 0;

    // ---------------- 1) position pool inside the envelope, outside the clearance
    const margin = 2.0;
    const pool = [];
    {
      const c = env.center, h = env.half, shape = env.shape || 'box';
      const n = Math.max(8, Math.min(18, Math.round(Math.cbrt(6000))));
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let d = 0; d < n; d++) {
        const p = [c[0] + (2 * (a + 0.5) / n - 1) * h[0], c[1] + (2 * (b + 0.5) / n - 1) * h[1], c[2] + (2 * (d + 0.5) / n - 1) * h[2]];
        if (!insideMargin(env, p, margin)) continue;
        let ok = true;
        for (const s of srcs) {
          const dv = V.sub(p, s.pos), r = V.len(dv);
          if (r < keep + 8) { ok = false; break; }        // a facet needs room for its patch + sag
          const fr = SO.frame(s), ct = V.dot(dv, fr.a) / r;
          if (SO.intensity(s, Math.acos(Math.max(-1, Math.min(1, ct)))) < 0.2) { ok = false; break; }   // grazing directions carry too little light
        }
        if (ok) pool.push(p);
      }
      if (!pool.length) for (const s of srcs) pool.push(V.add(s.pos, V.mul(SO.frame(s).a, keep + margin + 2)));
      pool.sort((p, q) => V.dist(p, S0) - V.dist(q, S0));
    }

    // ---------------- 2) visible shell: FARTHEST pool point per LED direction bin.  One facet per
    // direction ⇒ no facet sits directly behind another from the LED's point of view, and every
    // facet is as far from the LED (→ as sharp an LED image) as its direction allows.
    const shell = [], shellBin = [];
    {
      const fr = SO.frame(srcs[0]);
      const NA = settings.shellA | 0, NE = settings.shellE | 0;
      const best = new Map(), near = new Map();
      for (let pi = 0; pi < pool.length; pi++) {
        const d = V.sub(pool[pi], S0), r = V.len(d);
        const dh = V.mul(d, 1 / r);
        const el = Math.acos(Math.max(-1, Math.min(1, V.dot(dh, fr.a))));
        const azv = V.cross(fr.a, dh);
        const az = Math.atan2(V.dot(azv, fr.v), V.dot(azv, fr.u));
        const key = Math.floor((az / (2 * Math.PI) + 0.5) * NA) * 1000 + Math.floor(el / Math.PI * NE);
        const cur = best.get(key);
        if (cur === undefined || r > cur[0]) best.set(key, [r, pi]);
        const curN = near.get(key);
        if (curN === undefined || r < curN[0]) near.set(key, [r, pi]);
      }
      for (const [b, pi] of best.values()) { shell.push(pool[pi]); shellBin.push(b); }
      // second radial layer: the nearest usable point per bin (close facets make big, faint-edged
      // images — they serve regions that need coverage more than sharpness)
      for (const [b, pi] of near.values()) {
        if (best.has(b) && best.get(b)[1] === pi) continue;
        shell.push(pool[pi]); shellBin.push(b + 500000);
      }
      shell.sort((p, q) => V.dist(p, S0) - V.dist(q, S0));
    }
    // max patch half-size that fits at point p aiming at Z (envelope margin, sag, LED clearance)
    const maxHalfAt = (p, Z) => {
      const in_ = V.norm(V.sub(S0, p)), out_ = V.norm(V.sub(Z, p));
      const n = V.norm(V.add(in_, out_));
      const [e1, e2] = V.basis(n);
      const rr = V.dist(p, S0), di = Math.max(1e-6, V.dist(p, Z));
      const sagK = 1 / rr + 1 / di;
      let hh = settings.maxFacetHalf;
      for (let tries = 0; tries < 14; tries++) {
        const sag = hh * hh * sagK / 2, m = margin + sag;
        let ok = true;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const q = V.add(p, V.add(V.mul(e1, a * hh), V.mul(e2, b * hh)));
          if (!insideMargin(env, q, m)) { ok = false; break; }
          for (const s2 of srcs) if (V.dist(q, s2.pos) < keep + sag + 0.5) { ok = false; break; }
          if (!ok) break;
        }
        if (ok) for (const s2 of srcs) {
          const d = V.sub(s2.pos, p);
          const x = Math.max(-hh, Math.min(hh, V.dot(d, e1))), y = Math.max(-hh, Math.min(hh, V.dot(d, e2)));
          const cp = V.add(p, V.add(V.mul(e1, x), V.mul(e2, y)));
          if (V.dist(cp, s2.pos) < keep + 0.3) { ok = false; break; }
        }
        if (ok) return hh;
        hh *= 0.8;
      }
      return 0;
    };

    // only shell points where a patch can actually fit host a facet — count them first, so the
    // number of regions matches the facets that will exist (no dark, orphaned regions)
    const usable = [];
    for (const p of shell) if (maxHalfAt(p, T.C) >= 1.8) usable.push(p);
    // keep only points whose LED distance gives the blob size we asked for (kernelX × sharpest
    // image); widen the band if too few survive
    // blob size must also COVER the paint: total image area ≥ ~1.3 × painted area, so grow the
    // blobs (and the distance band) until coverage is plausible
    let shell2 = usable, kxUse = kernelX;
    {
      const paintedN = cells.length, cellMM = cell;
      for (const kx of [kernelX, kernelX * 1.6, kernelX * 2.5, kernelX * 4]) {
        const rM = kernelMM0 > 0 ? (s0 * V.dist(T.C, S0)) / (kx * kernelMM0) : 0;
        let f2 = usable;
        if (rM > 0) {
          for (let w = 0; w < 3; w++) {
            const lo = rM * (0.75 - 0.35 * w), hi = rM * (1.6 + 0.7 * w);
            const g2 = usable.filter((p) => { const rr = V.dist(p, S0); return rr >= lo && rr <= hi; });
            if (g2.length >= 8) { f2 = g2; break; }
            if (g2.length > f2.length) f2 = g2;
          }
        }
        // coverage from the blob sizes the band ACTUALLY delivers
        let cov = 0;
        for (const p of f2) { const rr = Math.max(1e-6, V.dist(p, S0)); cov += Math.PI * ((s0 * V.dist(T.C, S0) / rr / 2) / cellMM) ** 2; }
        cov /= paintedN;
        shell2 = f2; kxUse = kx;
        if (cov >= 1.3 || kx === kernelX * 4) break;
      }
    }
    const M = Math.max(1, Math.min(input.limits.maxFacets | 0, cells.length, shell2.length));

    // coverage check: if the facets' sharpest images cannot cover the paint (small envelope far
    // from a small LED), fall back to FLAT facets whose patch width sets the beam width
    // ((s + 2h)·D/r) — blurry, but every painted cell gets light, and fidelity is scale-free.
    let flatMode = false, hFlat = 3;
    {
      let cov = 0;
      for (const p of shell2) { const rr = Math.max(1e-6, V.dist(p, S0)); cov += Math.PI * ((s0 * V.dist(T.C, S0) / rr / 2) / cell) ** 2; }
      cov /= Math.max(1, cells.length);
      if (cov < 1.2) {
        flatMode = true;
        const blobTarget = 2 * cell * Math.sqrt((1.4 * cells.length) / (Math.PI * Math.max(1, shell2.length)));
        let rMed = shell2.map((p) => V.dist(p, S0)).sort((a, b) => a - b);
        rMed = rMed.length ? rMed[(rMed.length - 1) >> 1] : 50;
        hFlat = Math.max(2.5, Math.min(settings.maxFacetHalf, (blobTarget * rMed / Math.max(1e-6, V.dist(T.C, S0)) - s0) / 2));
      }
    }

    // ---------------- 3) balanced weighted bisection into M regions
    const wsum = (arr) => { let s = 0; for (const c of arr) s += c.w; return s; };
    const regions = [];
    {
      const open = [cells];
      while (open.length < M) {
        open.sort((a, b) => b.length - a.length || wsum(b) - wsum(a));
        const g = open.shift();
        if (g.length < 2) { open.push(g); break; }
        let mu = 0, mv = 0, W = 0;
        for (const c of g) { mu += c.ix * c.w; mv += c.iy * c.w; W += c.w; }
        mu /= W; mv /= W;
        let su = 0, sv = 0;
        for (const c of g) { su += c.w * (c.ix - mu) ** 2; sv += c.w * (c.iy - mv) ** 2; }
        const axU = su >= sv;
        g.sort((a, b) => (axU ? a.ix - b.ix : a.iy - b.iy) || a.k - b.k);
        const half = W / 2; let acc = 0, idx = 0;
        while (idx < g.length - 1 && acc + g[idx].w < half) { acc += g[idx].w; idx++; }
        const a = g.slice(0, idx + 1), b = g.slice(idx + 1);
        if (!a.length || !b.length) { open.push(g); break; }
        open.push(a, b);
      }
      regions.push(...open);
    }
    const reg = regions.map((arr, ri) => {
      let W = 0, cu = 0, cv = 0;
      for (const c of arr) { W += c.w; cu += c.ix * c.w; cv += c.iy * c.w; }
      cu /= W; cv /= W;
      let rad = 0;
      for (const c of arr) rad = Math.max(rad, Math.hypot(c.ix - cu, c.iy - cv));
      return { ri, arr, W, cu, cv, rad, Z: toWorld(-T.half + cu * cell, -T.half + cv * cell), extent: Math.max(rad, cell) * 2 * settings.spotScale };
    });

    for (const r of reg) {
      r.D = V.dist(r.Z, S0);
      const rK = kernelMM0 > 0 ? (s0 * r.D) / (kxUse * kernelMM0) : 0;
      r.rDes = Math.max(keep + 2, rK > 0 ? rK : (s0 * r.D) / r.extent);
    }

    // ---------------- 4) assign positions (widest region first: it wants the closest, fattest light)
    const order = reg.slice().sort((a, b) => b.extent - a.extent);
    const used = new Set(), usedBins = new Set();
    for (const r of order) {
      let cand = [];
      for (let pi = 0; pi < shell2.length; pi++) {
        if (used.has(pi)) continue;
        const rr = V.dist(shell2[pi], S0);
        if (rr < 0.7 * r.rDes) continue;                            // too close: the LED image blurs far past the kernel
        if (maxHalfAt(shell2[pi], r.Z) < 1.8) continue;             // a patch must fit there
        cand.push([Math.abs(rr - r.rDes) / Math.max(1, r.rDes), pi]);
      }
      cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const K = Math.min(cand.length, 12);
      let best = -1, bestScore = -Infinity;
      for (let ci = 0; ci < K; ci++) {
        const pi = cand[ci][1], p = shell2[pi];
        let md = Infinity;
        for (const o of order) { if (o === r || o.pi === undefined || o.pi < 0) continue; md = Math.min(md, V.dist(p, shell2[o.pi])); }
        if (!isFinite(md)) md = 1e6;
        // beam-corridor penalty: another facet inside this facet's LED line or its reflected beam
        // will block part of the light
        let corr = 0;
        const beamR = Math.max(settings.maxFacetHalf, 0.5 * s0 * V.dist(p, r.Z) / Math.max(1, V.dist(p, S0)));
        for (const o of order) {
          if (o === r || o.pi === undefined || o.pi < 0) continue;
          const q = shell2[o.pi];
          if (segDist(q, S0, p) < 1.2 * settings.maxFacetHalf) corr += 1;   // in our LED cone
          if (segDist(q, p, r.Z) < beamR) corr += 1;                        // in our reflected beam
          if (segDist(p, q, o.Z) < 1.2 * settings.maxFacetHalf) corr += 1;  // our P inside o's beam
        }
        const score = md * 0.3 - 3 * corr - 2 * cand[ci][0] - 1e-6 * cand[ci][1];
        if (score > bestScore) { bestScore = score; best = pi; }
      }
      r.pi = best;
      used.add(best);
      if (best >= 0) usedBins.add(shellBin[best]);
    }
    for (const r of reg) {
      r.P = r.pi >= 0 ? shell2[r.pi] : V.add(S0, [keep + 10, 0, keep + 10]);
      r.r = V.dist(r.P, S0);
      r.di = Math.max(1e-6, V.dist(r.P, r.Z));
      const in_ = V.norm(V.sub(S0, r.P)), out_ = V.norm(V.sub(r.Z, r.P));
      r.n = V.norm(V.add(in_, out_));
    }

    // ---------------- 5) analytic flux per unit mirror area (lm per mm²), occlusion-derated
    function srcPoints(s, fr) {
      const out = [], N = 3;
      if (s.kind === 'planar') {
        if (s.shape === 'disc') {
          for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
            const x = (2 * (a + 0.5) / N - 1) * s.radius, y = (2 * (b + 0.5) / N - 1) * s.radius;
            if (x * x + y * y <= s.radius * s.radius) out.push([V.add(V.add(s.pos, V.mul(fr.u, x)), V.mul(fr.v, y)), 4 / (Math.PI * N * N)]);
          }
        } else {
          for (let a = 0; a < N; a++) for (let b = 0; b < N; b++)
            out.push([V.add(V.add(s.pos, V.mul(fr.u, (2 * (a + 0.5) / N - 1) * s.w / 2)), V.mul(fr.v, (2 * (b + 0.5) / N - 1) * s.h / 2)), 1 / (N * N)]);
        }
      } else if (s.kind === 'volume') {
        const n = 4;
        if (s.shape === 'cylinder') {
          for (let a = 0; a < n; a++) for (let b = 0; b < 2; b++) {
            const ang = 2 * Math.PI * (a + 0.5) / n, z = (b + 0.5) * s.length - s.length / 2;
            out.push([V.add(V.add(s.pos, V.mul(fr.a, z)), V.mul(V.norm(V.add(V.mul(fr.u, Math.cos(ang)), V.mul(fr.v, Math.sin(ang)))), s.radius)), 1 / (2 * n)]);
          }
        } else {
          for (let a = 0; a < n; a++) out.push([V.add(s.pos, V.mul(V.norm([Math.sin(2.4 * a), Math.cos(2.4 * a), Math.sin(1.3 * a)]), s.radius * 0.6)), 1 / n]);
        }
      } else out.push([s.pos, 1]);
      return out;
    }
    for (const r of reg) {
      let f = 0;
      for (const s of srcs) {
        const area = SO.emittingArea(s), integ = SO.totalIntegral(s), fr = SO.frame(s);
        if (!(area > 0) || !(integ > 0)) continue;
        for (const [q, wq] of srcPoints(s, fr)) {
          const d = V.sub(r.P, q), rr = V.len(d);
          if (rr < keep * 0.5) continue;
          const dh = V.mul(d, 1 / rr);
          const I = SO.intensity(s, Math.acos(Math.max(-1, Math.min(1, V.dot(dh, fr.a)))));
          const ca = -V.dot(dh, r.n);
          if (I <= 0 || ca <= 0) continue;
          f += (s.power / (area * integ)) * I * ca / (rr * rr) * wq;
        }
      }
      r.fPA0 = f * refl;
    }
    // occlusion derating: the LED-side angular overlap with each other facet's projected disc, and
    // the blocker sitting inside the converging beam this facet sends toward its image.
    const hProv = Math.min(settings.maxFacetHalf, 10);
    for (let j = 0; j < M; j++) {
      const r = reg[j];
      let vis = 1;
      for (let m = 0; m < M; m++) {
        if (m === j) continue;
        const q = reg[m].P;
        const dj = V.sub(r.P, S0), rj = V.len(dj), dm = V.dist(q, S0);
        if (dm < rj) {
          const phi = V.angle(V.mul(dj, 1 / rj), V.mul(V.sub(q, S0), 1 / dm));
          const caj = Math.max(0.15, Math.abs(V.dot(V.norm(V.sub(S0, r.P)), r.n)));
          const cam = Math.max(0.15, Math.abs(V.dot(V.norm(V.sub(S0, q)), reg[m].n)));
          const aj = (hProv * caj) / rj, am = (hProv * cam) / dm;
          const fr = Math.max(0, Math.min(1, (aj + am - phi) / (2 * Math.max(1e-9, aj))));
          vis *= 1 - fr;
        }
        const D = V.dist(r.P, r.Z);
        const along = V.dot(V.sub(q, r.P), V.norm(V.sub(r.Z, r.P)));
        if (along > 0 && along < D) {
          const hb = hProv * (1 - along / D) + (r.di / r.r * s0 / 2) * (along / D);   // beam radius there
          const off = segDist(q, r.P, r.Z);
          const fr = Math.max(0, Math.min(1, (hProv + hb - off) / (2 * Math.max(hProv, hb))));
          vis *= 1 - 0.5 * fr;
        }
      }
      r.fPA = r.fPA0 * vis;
    }

    // ---------------- 6) fit per-facet flux to the (blurred) paint
    const nC = R * R;
    // footprint: facet j's image ≈ a disc of radius (magnification × LED size)/2 at Z_j
    const kerMM = (() => { const arr = reg.map((r) => r.di / r.r * s0).sort((a, b) => a - b); return arr.length ? arr[(arr.length - 1) >> 1] : cell; })();
    const kerCells = Math.max(1.5, kerMM / cell);
    // fit target: the paint blurred by the SCORER's kernel (RF.Photometry.achievableKernel) — a
    // design that reproduces that blur passes every painted cell and keeps every gap at its allowance
    const t = RF.Photometry.boxBlur(Float64Array.from(paint), R, Math.max(1.5, ker0.cells));
    const F = [];
    for (const r of reg) {
      const rc = Math.max(0.6, (flatMode ? (s0 + 2 * hFlat) / 2 : r.di / r.r * s0 / 2) / cell);
      const col = new Float64Array(nC);
      const i0 = Math.max(0, Math.floor(r.cu - rc - 1)), i1 = Math.min(R - 1, Math.ceil(r.cu + rc + 1));
      const j0 = Math.max(0, Math.floor(r.cv - rc - 1)), j1 = Math.min(R - 1, Math.ceil(r.cv + rc + 1));
      let s = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i + 0.5 - r.cu, j + 0.5 - r.cv) / rc;
        if (d < 1) { const w = d < 0.85 ? 1 : 1 - (d - 0.85) / 0.15; col[j * R + i] = w; s += w; }
      }
      if (s <= 0) { col[Math.max(0, Math.min(nC - 1, Math.round(r.cv) * R + Math.round(r.cu)))] = 1; s = 1; }
      for (let k = 0; k < nC; k++) col[k] /= s;
      F.push(col);
    }
    // neighbour spacing (patches must not collide)
    const minGap = reg.map(() => Infinity);
    for (let a = 0; a < M; a++) for (let b = a + 1; b < M; b++) {
      const d = V.dist(reg[a].P, reg[b].P);
      minGap[a] = Math.min(minGap[a], d); minGap[b] = Math.min(minGap[b], d);
    }
    const Amax = reg.map((r, j) => {
      const hA = 0.8 * (r.di / r.r * s0 / 2) + 4;             // aberration-ish cap
      const hB = Math.max(2, 0.55 * minGap[j]);               // don't collide with neighbours
      const h = Math.max(1.5, Math.min(settings.maxFacetHalf, hA, hB));
      return 4 * h * h;
    });
    const cnt = new Float64Array(nC);
    for (let j = 0; j < M; j++) { const col = F[j]; for (let k = 0; k < nC; k++) cnt[k] += col[k]; }
    const PhiCap = reg.map((r, j) => Amax[j] * r.fPA);          // lm each facet could deliver
    // drop negligible-capacity facets (they can never pay for their patch; their cells are
    // covered by the wide overlapping images of the stronger facets)
    let live = reg.slice(), Flive = F.slice(), ML = M;
    {
      let sum = 0; for (const c of PhiCap) sum += c;
      const keepIdx = [];
      for (let j = 0; j < M; j++) if (PhiCap[j] >= 0.02 * sum || keepIdx.length < 0.7 * M) keepIdx.push(j);
      if (keepIdx.length && keepIdx.length < M) {
        live = keepIdx.map((j) => reg[j]); Flive = keepIdx.map((j) => F[j]); ML = live.length;
        for (let j = 0; j < ML; j++) live[j].capL = PhiCap[keepIdx[j]];
      } else for (let j = 0; j < M; j++) live[j].capL = PhiCap[j];
    }

    // ---- capacity-respecting per-cell allocation: the budget T is spread ∝ each facet's
    // per-cell demand share; each round, cells still short (their covering facets hit capacity)
    // hand their deficit to overlapping facets that still have slack.
    const demRaw = live.map((r, j) => {
      let d = 0; const col = Flive[j];
      for (let k = 0; k < nC; k++) if (cnt[k] > 0) d += t[k] * col[k] / cnt[k];
      return d;
    });
    let dsum = 0; for (const d of demRaw) dsum += d;
    const alloc = (T) => {
      let dem = demRaw.map((d) => (T * d) / dsum);
      let Phi = dem.map((d, j) => Math.min(d, live[j].capL));
      for (let pass = 0; pass < 4; pass++) {
        const E = new Float64Array(nC);
        for (let j = 0; j < ML; j++) { const col = Flive[j], p = Phi[j]; if (p > 0) for (let k = 0; k < nC; k++) E[k] += p * col[k]; }
        const add = new Array(ML).fill(0);
        let any = 0;
        for (let j = 0; j < ML; j++) {
          const col = Flive[j];
          for (let k = 0; k < nC; k++) {
            const def = Math.max(0, (T * t[k]) / dsum - E[k]);
            if (def > 0 && cnt[k] > 0) { add[j] += def * col[k] / cnt[k]; any = 1; }
          }
        }
        if (!any) break;
        dem = Phi.map((p, j) => p + add[j]);
        Phi = dem.map((d, j) => Math.min(d, live[j].capL));
      }
      return Phi;
    };
    const shapeQ = (phis) => {
      const E = new Float64Array(nC);
      for (let j = 0; j < ML; j++) { const col = Flive[j], p = phis[j]; if (p > 0) for (let k = 0; k < nC; k++) E[k] += p * col[k]; }
      let et = 0, e2 = 0;
      for (let k = 0; k < nC; k++) { et += E[k] * t[k]; e2 += E[k] * E[k]; }
      const al = e2 > 0 ? et / e2 : 1;
      let q = 0;
      for (let k = 0; k < nC; k++) if (t[k] > 0) q += Math.min(al * E[k], t[k]) / Math.max(al * E[k], t[k]);
      return q;
    };
    const Tcap = settings.maxFrac * Ptot;
    let bestT = 0, bestQT = -1, PhiOut = null;
    for (let li = 0; li <= 18; li++) {
      const T = Tcap * Math.pow(0.55, 18 - li);
      const phis = alloc(T);
      const q = shapeQ(phis);
      if (q > bestQT) bestQT = q;
      if (q >= 0.85 * bestQT || li === 18) { bestT = T; PhiOut = phis; }   // brightest scale that keeps a decent shape
      else break;
    }
    const A = PhiOut.map((p, j) => p / (live[j].fPA > 0 ? live[j].fPA : 1e-300));
    let caught = PhiOut.reduce((a, b) => a + b, 0);
    // ---------------- 7) emit facets
    const surfaces = [], intent = [];
    const byRegion = new Map();   // region ri -> surface id
    for (let j = 0; j < ML; j++) {
      const r = live[j], hHalf = Math.max(0.8, Math.sqrt(A[j]) / 2);
      const [e1, e2] = V.basis(r.n);
      // fit the patch: shrink until corners respect envelope margin + sag and the clearance
      const sagK = 1 / r.r + 1 / r.di;
      let hh = hHalf;
      for (let tries = 0; tries < 14; tries++) {
        const sag = hh * hh * sagK / 2, m = margin + sag;
        let ok = true;
        for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const q = V.add(r.P, V.add(V.mul(e1, a * hh), V.mul(e2, b * hh)));
          if (!insideMargin(env, q, m)) { ok = false; break; }
          for (const s of srcs) if (V.dist(q, s.pos) < keep + sag + 0.5) { ok = false; break; }
          if (!ok) break;
        }
        // closest point of the patch to each LED (2D clamp on the tangent plane)
        if (ok) for (const s of srcs) {
          const d = V.sub(s.pos, r.P);
          const x = Math.max(-hh, Math.min(hh, V.dot(d, e1))), y = Math.max(-hh, Math.min(hh, V.dot(d, e2)));
          const cp = V.add(r.P, V.add(V.mul(e1, x), V.mul(e2, y)));
          if (V.dist(cp, s.pos) < keep + 0.3) { ok = false; break; }
        }
        if (ok) break;
        hh *= 0.8;
      }
      if (hh < 0.7) { intent.push({ facet: null, cells: r.arr.map((c) => [c.k, c.w]) }); continue; }
      const id = 'F' + j;
      const pts3 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
        V.add(r.P, V.add(V.mul(e1, a * hh), V.mul(e2, b * hh))));
      surfaces.push({ type: 'facet', id, group: 'A', P: r.P, S0, Z: r.Z, di: flatMode ? null : r.di, flat: flatMode, clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } });
      byRegion.set(r.ri, id);
      intent.push({ facet: id, cells: r.arr.map((c) => [c.k, c.w]) });
    }
    // dead regions: hand their cells to the nearest live region's intent (their light comes from
    // the overlapping images of the live facets)
    for (const r of reg) {
      if (!r.dead) continue;
      let best = null, bd = Infinity;
      for (const q of live) { const d = Math.hypot(q.cu - r.cu, q.cv - r.cv); if (d < bd) { bd = d; best = q; } }
      if (best) {
        const it = intent.find((x) => x.facet === byRegion.get(best.ri));
        if (it) for (const c of r.arr) it.cells.push([c.k, c.w]);
      }
    }

  notes.push(M + ' facets over ' + cells.length + ' painted cells · image Ø≈' + kerMM.toFixed(0) + ' mm (' + kerCells.toFixed(1) + ' cells) · flux fit ' + (100 * caught / Ptot).toFixed(0) + '% of LED');
  return { surfaces, intent, notes };
}

RF.Solvers.register({
  id: 'bench-glm53flash-relace--facetpaint', name: 'Facet paint (static tail design)', version: '0.4', modes: ['paint'],
  settings: SETTINGS,
  solve(input, settings) { return buildDesign(input, settings); },
});

/* facetpaint-auto — the optional tuner: it runs the SAME static pipeline for a small grid of knob
 * settings, traces each candidate (allowed for a solver whose id ends in -auto; same seed every
 * call, so differences between candidates are geometry, not noise) and returns the geometry whose
 * trace best serves the selected goal:
 *   faithful  — the best paint fidelity;
 *   throw     — the farthest beam (peak cd) among candidates with at least 80 % of the best fidelity;
 *   efficient — the most light delivered onto the paint among candidates with at least 80 % of the
 *               best fidelity.
 */
RF.Solvers.register({
  id: 'bench-glm53flash-relace--facetpaint-auto', name: 'Facet paint (auto-tuned)', version: '0.4', modes: ['paint'],
  settings: SETTINGS.concat([
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
    { key: 'rays', label: 'Rays per candidate', type: 'range', min: 50000, max: 1000000, step: 50000, default: 200000 },
  ]),
  solve(input, settings, tools) {
    const grid = [];
    for (const kx of [3, 4.5, 6, 8]) for (const mf of [0.5, 0.7]) grid.push({ kernelX: kx, maxFrac: mf });
    const cands = [];
    for (const g of grid) {
      const st = Object.assign({}, settings, g);
      let out;
      try { out = buildDesign(input, st); } catch (e) { continue; }
      if (!out.surfaces || !out.surfaces.length) continue;
      let tr = null;
      try { tr = tools && tools.trace ? tools.trace(out.surfaces, { rays: settings.rays | 0 || 200000 }) : null; } catch (e) { tr = null; }
      if (!tr || !tr.fidelity) continue;
      cands.push({
        st, out,
        fid: tr.fidelity.fidelity || 0,
        onPaint: (tr.fidelity.onPaint) || 0,
        peak: tr.peakCd || 0,
        throwM: tr.throwM || 0,
      });
      if (tools && tools.progress) tools.progress(0.1 + 0.9 * cands.length / grid.length);
      if (tools && tools.preview) tools.preview(out.surfaces, { label: 'candidate ' + cands.length + '/' + grid.length, trace: tr });
    }
    if (!cands.length) return buildDesign(input, settings);
    const bestF = Math.max.apply(null, cands.map((c) => c.fid));
    let pool = cands.filter((c) => c.fid >= 0.8 * bestF);
    if (!pool.length) pool = cands;
    let pick;
    if (settings.goal === 'throw') pick = pool.reduce((a, b) => (b.throwM > a.throwM ? b : a));
    else if (settings.goal === 'efficient') pick = pool.reduce((a, b) => (b.onPaint > a.onPaint ? b : a));
    else pick = cands.reduce((a, b) => (b.fid > a.fid ? b : a));
    const notes = ['auto: goal ' + settings.goal + ' · ' + cands.length + ' candidates traced at ' + (settings.rays | 0) + ' rays',
      'picked kernelX ' + pick.st.kernelX + ', maxFrac ' + pick.st.maxFrac +
      ' (fidelity ' + (100 * pick.fid).toFixed(1) + '%, onPaint ' + (100 * pick.onPaint).toFixed(1) + '%, peak ' + Math.round(pick.peak) + ' cd, throw ' + Math.round(pick.throwM) + ' m)'];
    return { surfaces: pick.out.surfaces, intent: pick.out.intent, notes: notes.concat(pick.out.notes || []) };
  },
});
