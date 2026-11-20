/* Static paint solver: analytic facets, no ray tracing inside solve().
 *
 * Idea: each painted tile gets one mirror.  Mirrors are placed on a shell at the envelope wall, in
 * patches that tile the LED's emission directions: a patch's solid angle fixes the flux it catches.
 * The facet's curvature (two vergences) makes the LED image on the target the size of its tile,
 * and the aim puts it at the tile's centroid.  Everything is closed form.
 */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, U = RF.U;
  const clamp = U.clamp;

  // ---- clustering of painted cells ---------------------------------------------------------------
  function levelsOf(paint) {
    const set = new Set();
    for (const w of paint) if (w > 0) set.add(w);
    const a = [...set].sort((x, y) => x - y);
    // merge levels less than 8% apart: they are indistinguishable at the scoring tolerance
    const out = [];
    for (const w of a) { if (out.length && w / out[out.length - 1] < 1.08) continue; out.push(w); }
    if (out.length > 4) {                         // a continuous painting: quantise into four log bands
      const lo = Math.log(out[0]), hi = Math.log(out[out.length - 1]);
      const q = [];
      for (let k = 0; k < 4; k++) q.push(Math.exp(lo + (hi - lo) * (k + 0.5) / 4));
      return q;
    }
    return out;
  }

  function splitBucket(cells, R, count, out) {
    if (count <= 1 || cells.length <= 1) { out.push(cells); return out; }
    // split along whichever axis spans the most cells, at the weighted median
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity, sw = 0;
    for (const c of cells) { const i = c.k % R, j = (c.k / R) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); sw += c.w; }
    const alongI = (i1 - i0) >= (j1 - j0);
    const sorted = cells.slice().sort((a, b) => (alongI ? a.k % R - b.k % R : ((a.k / R) | 0) - ((b.k / R) | 0)) || a.k - b.k);
    // Split by cell count (not by light): a tile must stay spatially compact even when a few
    // bright cells carry most of its weight.  Flux is assigned later from the tile's total weight.
    const best = Math.max(1, Math.floor(sorted.length / 2));
    let acc = 0; for (let q = 0; q < best; q++) acc += sorted[q].w;
    const na = Math.max(1, Math.min(count - 1, Math.round(count * best / sorted.length)));
    splitBucket(sorted.slice(0, best), R, na, out);
    splitBucket(sorted.slice(best), R, count - na, out);
    return out;
  }
  function accAt(sorted, n, total) { let s = 0; for (let i = 0; i < n; i++) s += sorted[i].w; return total > 0 ? s / total : n / sorted.length; }

  function tilesOf(paint, R, N, exponent) {
    const distinct = new Set();
    for (const w of paint) if (w > 0) distinct.add(w);
    const continuous = distinct.size > 8;      // a smooth painting: cluster by position, not by level
    const levels = continuous ? [1] : levelsOf(paint);
    const buckets = levels.map(() => []);
    let total = 0;
    for (let k = 0; k < paint.length; k++) if (paint[k] > 0) {
      const w = paint[k]; let bi = 0;
      if (!continuous) while (bi < levels.length - 1 && Math.abs(Math.log(w) - Math.log(levels[bi])) > Math.abs(Math.log(w) - Math.log(levels[bi + 1]))) bi++;
      buckets[bi].push({ k, w }); total += w;
    }
    const ew = levels.map((lv, b) => Math.pow(buckets[b].reduce((s, c) => s + c.w, 0), exponent));
    const ewsum = ew.reduce((a, b) => a + b, 0) || 1;
    let alloc = levels.map((lv, b) => clamp(Math.round(N * ew[b] / ewsum), 0, buckets[b].length));
    let sum = alloc.reduce((a, b) => a + b, 0);
    // hand out the remainder to the buckets with the largest unfinished share
    while (sum < N) {
      let bi = -1, best = -1;
      for (let b = 0; b < buckets.length; b++) {
        if (alloc[b] >= buckets[b].length) continue;
        const q = Math.pow(buckets[b].reduce((s, c) => s + c.w, 0), exponent) / (alloc[b] + 1);
        if (q > best) { best = q; bi = b; }
      }
      if (bi < 0) break;
      alloc[bi]++; sum++;
    }
    const tiles = [];
    for (let b = 0; b < buckets.length; b++) if (buckets[b].length && alloc[b] > 0)
      for (const cells of splitBucket(buckets[b], R, alloc[b], [])) tiles.push(makeTile(cells, R));
    return tiles;
  }

  function makeTile(cells, R) {
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity, sw = 0, ui = 0, vj = 0, m20 = 0, m02 = 0, m11 = 0;
    for (const c of cells) {
      const i = c.k % R, j = (c.k / R) | 0;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      sw += c.w; ui += i * c.w; vj += j * c.w; m20 += i * i * c.w; m02 += j * j * c.w; m11 += i * j * c.w;
    }
    const ci = ui / sw, cj = vj / sw;
    const cxx = Math.max(0, m20 / sw - ci * ci), cyy = Math.max(0, m02 / sw - cj * cj), cxy = m11 / sw - ci * cj;
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const vx = Math.sqrt(Math.max(0, cxx * ca * ca + 2 * cxy * ca * sa + cyy * sa * sa));
    const vy = Math.sqrt(Math.max(0, cxx * sa * sa - 2 * cxy * ca * sa + cyy * ca * ca));
    return { cells, weight: sw, i0, i1, j0, j1, i: ci, j: cj, w: i1 - i0 + 1, h: j1 - j0 + 1,
      axis: [ca, sa], wu: 2 * vx + 1, wv: 2 * vy + 1 };
  }

  // ---- patching the LED's emission directions ---------------------------------------------------
  function splitPatch(p, count, out) {
    if (count <= 1) { out.push(p); return out; }
    // p: {p0,p1 (azimuth), z0,z1, w (weight)}; split at the weighted median along the longer side
    const dphi = (p.p1 - p.p0) * Math.sqrt(Math.max(0.02, 1 - ((p.z0 + p.z1) / 2) ** 2));
    const dz = p.z1 - p.z0;
    let q;
    if (dphi >= dz) {
      const mid = (p.p0 + p.p1) / 2;
      q = { p0: p.p0, p1: mid, z0: p.z0, z1: p.z1, w: p.w / 2 };
      const r = { p0: mid, p1: p.p1, z0: p.z0, z1: p.z1, w: p.w / 2 };
      splitPatch(q, Math.ceil(count / 2), out); splitPatch(r, Math.floor(count / 2), out);
    } else {
      const mid = (p.z0 + p.z1) / 2;
      const a = { p0: p.p0, p1: p.p1, z0: p.z0, z1: mid, w: p.w / 2 };
      const b = { p0: p.p0, p1: p.p1, z0: mid, z1: p.z1, w: p.w / 2 };
      splitPatch(a, Math.ceil(count / 2), out); splitPatch(b, Math.floor(count / 2), out);
    }
    return out;
  }

  // projected extent of the LED along a world unit vector b
  function ledExtent(src, b) {
    if (src.shape === 'disc' || src.kind === 'cylinder') return src.shape === 'disc' ? 2 * (src.radius || 1) : Math.min(2 * (src.radius || 1), src.length || 2 * (src.radius || 1));
    const fr = RF.Source.frame(src), u = fr.u, v = fr.v;
    return Math.abs(V.dot(b, u)) * (src.w || 1) + Math.abs(V.dot(b, v)) * (src.h || 1);
  }

  // Check the REAL (curved) surface of a candidate against the envelope and every LED clearance.
  function surfaceFits(env, sources, s, keep) {
    let G;
    try { G = RF.Geo.compile([s]); } catch (e) { return false; }
    for (const poly of RF.Geo.outline(G, 0)) for (const q of poly) {
      if (!RF.Geo.envInside(env, q, -1e-5)) return false;
      for (const S of sources) if (V.dist(q, S) < keep + 0.5) return false;
    }
    return true;
  }

  function facetFor(tile, patch, ctx) {
    const { env, src, targetFrame, cell, keep, reflectivity, settings } = ctx;
    const w = ctx.w, e1 = ctx.e1, e2 = ctx.e2;
    const phi = (patch.p0 + patch.p1) / 2, zz = (patch.z0 + patch.z1) / 2;
    const sr = Math.sqrt(Math.max(1e-6, 1 - zz * zz));
    const d = V.norm(V.add(V.mul(w, zz), V.add(V.mul(e1, sr * Math.cos(phi)), V.mul(e2, sr * Math.sin(phi)))));
    const cosLed = V.dot(d, ctx.axis);
    if (!(cosLed > 0.02)) return null;
    if (V.dot(d, ctx.targetDir) > settings.maxForward) return null;
    const uc = -targetFrame.half + (tile.i + 0.5) * cell, vc = -targetFrame.half + (tile.j + 0.5) * cell;
    const Z = RF.Engine.targetUVtoWorld(targetFrame, uc, vc);
    const inter = RF.Geo.envInterval(env, src.pos, d);
    const tout = inter[1];
    if (!isFinite(tout) || tout <= 0) return null;
    const eh = V.norm(V.add(V.mul(e1, -Math.sin(phi)), V.mul(e2, Math.cos(phi))));
    const ez = V.norm(V.sub(d, V.mul(w, zz)));
    const apScale = (ctx.apertureScale || 1) * (ctx.fillScale || 1);
    const dphi = Math.max(0.01, (patch.p1 - patch.p0) * sr) * settings.spread * apScale;
    const dz = Math.max(0.01, (patch.z1 - patch.z0) / Math.max(0.05, sr)) * settings.spread * apScale;
    const inset = settings.inset;
    let hu = 1, hv = 1, P = null, uDir = null, vDir = null, n = null, r = 0;
    // Solve r = tout − aperture diagonal − inset with the aperture subtending exactly the patch.
    for (let it = 0; it < 6; it++) {
      r = Math.max(keep + 0.5, tout - Math.hypot(hu, hv) - inset);
      P = V.add(src.pos, V.mul(d, r));
      const aim = V.norm(V.sub(Z, P));
      n = V.norm(V.add(V.mul(d, -1), aim));
      if (-V.dot(d, n) < 0.12) return null;
      const proj = (e) => { const q = V.sub(e, V.mul(n, V.dot(e, n))); const l = V.len(q); return l > 1e-6 ? [V.mul(q, 1 / l), l] : [V.norm(V.basis(n)[0]), 1e-3]; };
      const a = proj(eh), b = proj(ez); uDir = a[0]; vDir = b[0];
      const nhu = r * dphi / (2 * Math.max(0.15, a[1]));
      const nhv = r * dz / (2 * Math.max(0.15, b[1]));
      const cap = Math.max(0.2, (tout - keep - inset - 1) / 2);
      const f = Math.min(1, cap / Math.max(1e-6, Math.hypot(nhu, nhv)));
      hu = nhu * f; hv = nhv * f;
    }
    r = tout - Math.hypot(hu, hv) - inset;
    if (!(r > keep + 0.5)) return null;
    P = V.add(src.pos, V.mul(d, r));
    const corners = (a, b) => [V.add(P, V.add(V.mul(uDir, a), V.mul(vDir, b))), V.add(P, V.add(V.mul(uDir, a), V.mul(vDir, -b))),
                               V.add(P, V.add(V.mul(uDir, -a), V.mul(vDir, -b))), V.add(P, V.add(V.mul(uDir, -a), V.mul(vDir, b)))];
    const L = V.dist(Z, P);
    const ax2 = tile.axis || [1, 0];
    const bu = V.add(V.mul(targetFrame.tu, ax2[0]), V.mul(targetFrame.tv, ax2[1]));
    const bv = V.add(V.mul(targetFrame.tu, -ax2[1]), V.mul(targetFrame.tv, ax2[0]));
    const cellW = cell * (tile.wu || tile.w), cellH = cell * (tile.wv || tile.h);
    const width = (b) => 2 * (hu * Math.abs(V.dot(b, uDir)) + hv * Math.abs(V.dot(b, vDir)));
    const au = width(bu), av = width(bv);
    const s0u = ledExtent(src, bu) * L / r, s0v = ledExtent(src, bv) * L / r;
    const ku = clamp((cellW - s0u) / Math.max(1e-6, au), 0, settings.maxK) * settings.blurGain;
    const kv = clamp((cellH - s0v) / Math.max(1e-6, av), 0, settings.maxK) * settings.blurGain;
    const diU = L / (1 + ku), diV = L / (1 + kv);
    const build = (a, b) => ({ type: 'facet', id: 'F' + ctx.index, P, S0: src.pos.slice(), Z, flat: false,
      vg: [1 / diU, 1 / diV], ax: bu.slice(),
      clip: { kind: 'poly', pts3: corners(a, b), ref: uDir.slice() },
      optics: { interaction: 'reflect', reflectivity } });
    let s = build(hu, hv);
    for (let it = 0; it < 10 && !surfaceFits(env, ctx.sources, s, keep); it++) { hu *= 0.9; hv *= 0.9; s = build(hu, hv); }
    if (hu < 0.2 || hv < 0.2 || !surfaceFits(env, ctx.sources, s, keep)) return null;
    const intent = { facet: s.id, cells: tile.cells.map((c) => [c.k, c.w]) };
    const cosIncEnd = -V.dot(d, V.norm(V.add(V.mul(d, -1), V.norm(V.sub(Z, P)))));
    const radius = Math.max(...s.clip.pts3.map((q) => V.dist(q, P)));
    return { s, intent, tile, patch, d, r, radius, cosInc: cosIncEnd, area: 4 * hu * hv,
      flux: cosLed * cosIncEnd * 4 * hu * hv / (Math.PI * r * r) };
  }

  const STATIC_ID = RF.Solvers.register({
    id: 'bench-hy4flash-max-r2--static-paint', name: 'Static analytic paint solver', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'autoCone', label: 'Choose the direction cone from the LED image size', type: 'checkbox', default: true },
      { key: 'coneDeg', label: 'Direction cone half-angle (deg, when auto is off)', type: 'number', min: 10, max: 120, step: 1, default: 80 },
      { key: 'blurGain', label: 'Image width gain', type: 'number', min: 0.5, max: 2, step: 0.05, default: 1.05 },
      { key: 'spread', label: 'Facet aperture fill', type: 'number', min: 0.3, max: 1.5, step: 0.05, default: 1 },
      { key: 'maxK', label: 'Maximum defocus', type: 'number', min: 1, step: 1, default: 30 },
      { key: 'inset', label: 'Wall inset (mm)', type: 'number', min: 0.2, step: 0.2, default: 1.5 },
      { key: 'blockDirect', label: 'Block direct light toward the target (absorbing part, free)', type: 'checkbox', default: false },
      { key: 'maxForward', label: 'Largest component of a facet direction toward the target', type: 'number', min: -0.5, max: 1, step: 0.1, default: 1 },
      { key: 'oversample', label: 'Direction patches per tile', type: 'number', min: 1, max: 4, step: 0.25, default: 1 },
      { key: 'autoWeights', label: 'Choose brightness weighting from the LED image size', type: 'checkbox', default: true },
      { key: 'weightExponent', label: 'How facet counts follow paint brightness (1 = proportional to light)', type: 'number', min: 0, max: 2, step: 0.1, default: 1 },
    ],
    solve(input, settings) {
      const src = input.source, env = input.envelope, R = input.paint.res, paint = input.paint.cells;
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
      const T = RF.Engine.targetFrame(input.target), cell = 2 * T.half / R;
      const axis = V.norm(src.axis || [0, 0, 1]), tdir = V.norm(V.sub(T.C, src.pos));
      let w = V.add(axis, tdir); if (V.len(w) < 0.2) w = axis.slice(); w = V.norm(w);
      const e1 = V.norm(V.sub(axis, V.mul(w, V.dot(axis, w))));
      const e2 = V.cross(w, e1);
      // Sparse paintings (rings, strokes) need smaller apertures: a rectangular image the size of a
      // tile's bounding box would flood the hole between its arms.
      let i0 = R, i1 = 0, j0 = R, j1 = 0, np = 0;
      for (let k = 0; k < paint.length; k++) if (paint[k] > 0) { const i = k % R, j = (k / R) | 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); np++; }
      const fill = np / Math.max(1, (i1 - i0 + 1) * (j1 - j0 + 1));
      const fillScale = fill < 0.7 ? clamp(0.55 + 0.6 * fill, 0.55, 1) : 1;
      const ker = (settings.autoCone || settings.autoWeights) ? RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target }) : null;
      let coneDeg = settings.coneDeg || 80;
      if (settings.autoCone && ker) coneDeg = clamp(45 + 7 * (ker.cells - 0.6), 40, 90);
      const theta = clamp(coneDeg * Math.PI / 180, 0.1, Math.PI * 0.49);
      const weightExp = (settings.autoWeights && ker) ? clamp(0.3 + 0.14 * (ker.cells - 0.6), 0.3, 1.1) : settings.weightExponent;
      const tiles = tilesOf(paint, R, input.limits.maxFacets, weightExp);
      if (!tiles.length) return { surfaces: [], intent: [{ facet: null, cells: [] }], notes: ['no painted cells'] };
      const patches = splitPatch({ p0: 0, p1: 2 * Math.PI, z0: Math.cos(theta), z1: 1, w: 1 }, Math.ceil(tiles.length * settings.oversample), []);
      const sources = (input.sources && input.sources.length ? input.sources : [src]).map((q) => q.pos);
      const ctx = { env, src, sources, targetFrame: T, cell, keep, reflectivity: input.limits.reflectivity, settings,
        targetDir: tdir, axis, w, e1, e2, zlo: Math.cos(theta), zhi: 1, index: 0, fillScale };
      // Build each patch once with a nominal tile to measure the flux it actually catches.  Pair the
      // strongest patches with the heaviest tiles, then rebuild with the real tile (the curvature changes).
      ctx.fillScale = 1;
      const nominal = makeTile([{ k: 0, w: 1 }], R);
      const probes = patches.map((p, i) => ({ i, f: facetFor(nominal, p, ctx) })).filter((x) => x.f);
      probes.sort((a, b) => b.f.flux - a.f.flux);
      const order = tiles.map((t, i) => i).sort((a, b) => tiles[b].weight - tiles[a].weight);
      // A facet is rejected if its centre sits in the outgoing beam of a facet already placed (or vice
      // versa): such pairs are the main source of blocked light in a statically tiled envelope.
      const crosses = (a, b) => {
        const ray = V.norm(V.sub(a.s.Z, a.s.P)), rel = V.sub(b.s.P, a.s.P), t = V.dot(rel, ray);
        if (t <= 0 || t >= V.dist(a.s.Z, a.s.P)) return false;
        const lat = V.len(V.sub(rel, V.mul(ray, t)));
        return t < 200 && lat < a.radius * 0.5 + b.radius * 0.5;
      };
      const wsum = order.reduce((s, i) => s + tiles[i].weight, 0);
      const fsum = probes.reduce((s, p) => s + p.f.flux, 0);
      const surfaces = [], intent = [], notes = [];
      ctx.fillScale = fillScale;
      const candidates = probes.slice();
      const placed = [];
      let used = 0, flux = 0;
      for (const ti of order) {
        const tile = tiles[ti], want = wsum > 0 ? fsum * tile.weight / wsum * fillScale * fillScale : 0;
        let f = null, chosen = -1, bestScore = 1e9;
        for (let attempt = 0; attempt < Math.min(candidates.length, 16); attempt++) {
          const cand = candidates[attempt], probed = cand.f.flux;
          ctx.apertureScale = want > 0 ? clamp(Math.sqrt(want / Math.max(1e-9, probed)), 0.25, 3) : 1;
          ctx.index = used + 1;
          let g = facetFor(tile, patches[cand.i], ctx);
          if (!g) continue;
          const again = clamp(ctx.apertureScale * Math.sqrt(want / Math.max(1e-9, g.flux)), 0.25, 3);
          if (Math.abs(again / ctx.apertureScale - 1) > 0.03) { ctx.apertureScale = again; g = facetFor(tile, patches[cand.i], ctx); }
          if (!g) continue;
          const score = placed.reduce((s, p) => s + (crosses(p, g) || crosses(g, p) ? 1 : 0), 0);
          if (score < bestScore) { bestScore = score; f = g; chosen = attempt; }
          if (score === 0) break;
        }
        if (!f) { intent.push({ facet: null, cells: tile.cells.map((c) => [c.k, c.w]) }); continue; }
        candidates.splice(chosen, 1); placed.push(f);
        surfaces.push(f.s); intent.push(f.intent); used++; flux += f.flux;
      }
      ctx.apertureScale = 1;
      // An absorbing platelet just in front of the LED catches the narrow cone of rays that would
      // otherwise shoot straight at the target (it is not a reflecting surface, so it is free).
      if (settings.blockDirect) {
        const dist = Math.max(keep + 2, 8);
        const half = Math.atan(T.half / Math.max(1, V.dist(T.C, src.pos))) + 0.1;
        const sz = dist * Math.tan(half);
        const c = V.add(src.pos, V.mul(tdir, dist));
        const [ex, ey] = V.basis(tdir);
        const shape = (a) => [V.add(c, V.add(V.mul(ex, a), V.mul(ey, a))), V.add(c, V.add(V.mul(ex, a), V.mul(ey, -a))),
                              V.add(c, V.add(V.mul(ex, -a), V.mul(ey, -a))), V.add(c, V.add(V.mul(ex, -a), V.mul(ey, a)))];
        let a = sz, pts = shape(a);
        for (let it = 0; it < 12 && !pts.every((q) => RF.Geo.envInside(env, q, -1e-5) && sources.every((S) => V.dist(q, S) >= keep + 0.5)); it++) { a *= 0.9; pts = shape(a); }
        if (a > 0.2 && pts.every((q) => RF.Geo.envInside(env, q, -1e-5)))
          surfaces.push({ type: 'plane', id: 'direct-shield', P: c, n: tdir.slice(), clip: { kind: 'poly', pts3: pts },
            optics: { interaction: 'absorb' } });
      }
      notes.push(used + ' facets on the envelope; ' + tiles.length + ' painted tiles; analytic flux share ' + (flux * 100).toFixed(1) + '%');
      return { surfaces, intent, notes };
    },
  });

  // ------------------------------------------------------------------------------------------------
  // Optional tuner.  The static solver above is the only design engine; this wrapper tries six of
  // its static settings with the SAME trace seed and keeps the one that best suits the goal.
  const STATIC_DEF = RF.Solvers.get(STATIC_ID);
  const staticSolve = STATIC_DEF.solve;
  const CANDIDATES = [
    { name: 'auto', set: { autoCone: true, autoWeights: true } },
    { name: 'sharp', set: { autoCone: false, coneDeg: 45, autoWeights: false, weightExponent: 0.3 } },
    { name: 'mid-sharp', set: { autoCone: false, coneDeg: 55, autoWeights: false, weightExponent: 0.5 } },
    { name: 'mid', set: { autoCone: false, coneDeg: 70, autoWeights: false, weightExponent: 0.8 } },
    { name: 'wide', set: { autoCone: false, coneDeg: 80, autoWeights: false, weightExponent: 1 } },
    { name: 'soft', set: { autoCone: false, coneDeg: 60, autoWeights: false, weightExponent: 0.6, blurGain: 1.2 } },
  ];
  const TUNE_SEED = 12345;

  function autoSolve(input, settings, tools) {
    const base = RF.Solvers.defaults(STATIC_DEF);
    const goal = settings.goal || 'faithful';
    const rays = clamp(settings.traceRays || 80000, 20000, 300000);
    const canTrace = tools && typeof tools.trace === 'function';
    const results = [];
    let fallback = null;
    for (let i = 0; i < CANDIDATES.length; i++) {
      const c = CANDIDATES[i];
      const set = Object.assign({}, base, c.set, { minDistance: settings.minDistance || 0 });
      let out;
      try { out = staticSolve(RF.U.deepCopy(input), set, tools); } catch (e) { continue; }
      if (!fallback) fallback = out;
      if (!out.surfaces.length || !canTrace) continue;
      let tr;
      try { tr = tools.trace(out.surfaces, { rays, seed: TUNE_SEED }); } catch (e) { continue; }
      const fd = tr.fidelity || {};
      results.push({ out, name: c.name, fid: fd.fidelity || 0, onPaint: fd.onPaint || 0,
        spill: fd.spill === undefined ? 1 : fd.spill, peak: tr.peakCd || 0,
        placed: out.surfaces.filter((s) => (s.optics && s.optics.interaction || 'reflect') === 'reflect').length });
    }
    if (!results.length) {
      if (!fallback) return { surfaces: [], intent: [{ facet: null, cells: [] }], notes: ['no paintable cells'] };
      fallback.notes = (fallback.notes || []).concat('tuner: tracing unavailable, used the default static settings');
      return fallback;
    }
    const mx = (key) => Math.max(1e-12, ...results.map((r) => r[key]));
    const maxOn = mx('onPaint'), maxPeak = mx('peak'), maxFid = mx('fid');
    const value = (r) => {
      const on = r.onPaint / maxOn, pk = Math.log(1 + r.peak) / Math.log(1 + maxPeak);
      // Every goal keeps fidelity in the objective: it is the harmonic half of the headline score.
      if (goal === 'throw') return 0.35 * (r.fid / maxFid) + 0.35 * on + 0.30 * pk;
      if (goal === 'efficient') return r.fid + 0.10 * on - 0.10 * r.spill + 0.10 * (1 - r.placed / Math.max(1, input.limits.maxFacets));
      return r.fid + 0.15 * on - 0.05 * r.spill;
    };
    let best = results[0], bestV = -Infinity;
    for (const r of results) { const v = value(r); if (v > bestV) { bestV = v; best = r; } }
    best.out.notes = (best.out.notes || []).concat(
      'tuner goal ' + goal + ': chose ' + best.name + ' of ' + results.length + ' candidates (' + rays + ' rays, seed ' + TUNE_SEED + ')',
      'candidates: ' + results.map((r) => r.name + ' F=' + r.fid.toFixed(2) + ' on=' + r.onPaint.toFixed(3) + ' peak=' + Math.round(r.peak)).join(' | '));
    return best.out;
  }

  RF.Solvers.register({
    id: 'bench-hy4flash-max-r2--static-paint-auto', name: 'Static analytic paint solver (tuned)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful', options: [{ value: 'faithful', label: 'faithful' }, { value: 'throw', label: 'throw' }, { value: 'efficient', label: 'efficient' }] },
      { key: 'traceRays', label: 'Rays per tuning trace', type: 'number', min: 20000, step: 10000, default: 80000 },
    ],
    solve: autoSolve,
  });
})();
