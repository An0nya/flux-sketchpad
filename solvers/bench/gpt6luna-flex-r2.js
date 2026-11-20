/* Static paint-to-facet reflector design. */
RF.Solvers.register({
  id: 'bench-gpt6luna-flex-r2--paint-static', name: 'Paint Static', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'apertureScale', label: 'Facet aperture scale', type: 'range', min: 0.35, max: 0.9, step: 0.05, default: 0.5 },
  ],
  solve(input, settings) {
    const V = RF.V, G = RF.Geo, E = RF.Engine;
    const env = input.envelope, src = input.source, S = src.pos;
    const sources = (input.sources && input.sources.length ? input.sources : [src]).map(s => s.pos);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const cap = Math.max(0, input.limits.maxFacets | 0), paint = input.paint;
    if (!cap || !paint) return { surfaces: [], intent: [], notes: ['No facet budget or paint.'] };
    const T = E.designFrame(input.target), N = paint.res | 0, vals = paint.cells || [];
    const positive = [];
    let total = 0;
    for (let k = 0; k < Math.min(vals.length, N * N); k++) {
      const w = Math.max(0, +vals[k] || 0);
      if (w > 0) { total += w; positive.push({ k, w, c: total }); }
    }
    if (!positive.length) return { surfaces: [], intent: [], notes: ['The painting is empty.'] };

    // Tile the six inner faces of the envelope. A small margin keeps the complete mirror surface
    // (including ellipsoid sag) inside the hard envelope. Tiles are disjoint, so they do not
    // shadow one another on a face.
    const c = env.center, h = env.half, faces = []; let inset;
    for (let ax = 0; ax < 3; ax++) for (const side of [-1, 1]) {
      const a = (ax + 1) % 3, b = (ax + 2) % 3;
      const la = 2 * h[a] * 0.94, lb = 2 * h[b] * 0.94;
      faces.push({ ax, side, a, b, la, lb, area: la * lb });
    }
    const totalArea = faces.reduce((s, f) => s + f.area, 0);
    const sideLen = Math.sqrt(totalArea / Math.max(1, cap)) * Math.max(0.35, Math.min(0.9, settings.apertureScale || 0.62));
    inset = Math.max(4, sideLen * 1.05);
    let tiles = [];
    for (const f of faces) {
      const nx = Math.max(1, Math.floor(f.la / sideLen)), ny = Math.max(1, Math.floor(f.lb / sideLen));
      const sx = f.la / nx, sy = f.lb / ny;
      for (let ix = 0; ix < nx; ix++) for (let iy = 0; iy < ny; iy++) {
        const P = c.slice(); P[f.ax] += f.side * (h[f.ax] - inset);
        P[f.a] += -f.la / 2 + (ix + 0.5) * sx;
        P[f.b] += -f.lb / 2 + (iy + 0.5) * sy;
        let hx = Math.min(sx, sy) * 0.46;
        if (!G.envInside(env, P, 1e-9)) continue;
        const fq = G.facetQuadric(P, S, [input.target.distance, 0, 0], null);
        const [ex, ey] = V.basis(fq.n, [0, 0, 1]);
        // Test the actual tangent-plane clip, not the envelope face's coordinate rectangle.
        const fits = (radius) => {
          if (sources.some(pos => V.dist(P, pos) < keep + Math.SQRT2 * radius + 0.5)) return false;
          for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
            const xx = (a / 2 - 1) * radius, yy = (b / 2 - 1) * radius;
            const q = V.add(P, V.add(V.mul(ex, xx), V.mul(ey, yy)));
            if (!G.envInside(env, q, -1e-7) || sources.some(pos => V.dist(q, pos) < keep + 0.25)) return false;
          }
          return true;
        };
        while (hx > 0.25 && !fits(hx)) hx *= 0.8;
        if (hx <= 0.25 || !fits(hx)) continue;
        tiles.push({ P, hx, f, ix, iy });
      }
    }
    // Curved-envelope face samples are already filtered at their actual clip corners above.
    // Trim excess grid sites evenly across the envelope, retaining broad angular coverage.
    if (tiles.length > cap) {
      const chosen = [];
      for (let i = 0; i < cap; i++) chosen.push(tiles[Math.floor((i + 0.5) * tiles.length / cap)]);
      tiles = chosen;
    }

    const surfaces = [], intent = [], count = Math.min(cap, tiles.length);
    for (let i = 0; i < count; i++) {
      const tile = tiles[i];
      // Midpoint-stratified inverse CDF: equal-aperture facets approximate the painted map
      // without randomness or a paint-resolution-dependent facet count.
      const q = (i + 0.5) * total / count;
      let lo = 0, hi = positive.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (positive[m].c < q) lo = m + 1; else hi = m; }
      const cell = positive[lo].k, x = cell % N, y = Math.floor(cell / N);
      const [u, v] = E.cellCenter(T, x, y);
      const Z = E.targetUVtoWorld(T, u, v), aimD = V.dist(tile.P, Z);
      const id = 'F' + surfaces.length;
      const fq = G.facetQuadric(tile.P, S, Z, aimD), frame = V.basis(fq.n, [0, 0, 1]);
      let aperture = tile.hx;
      const fitsSurface = (r) => {
        const A = fq.A, b = fq.b, n = fq.n;
        const mv = (v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
        const quad = (x, y) => {
          const w = V.add(V.mul(frame[0], x), V.mul(frame[1], y));
          const Aw = mv(w), An = mv(n);
          let C = V.dot(w, Aw) + V.dot(b, w);
          const B = 2 * V.dot(n, Aw) + V.dot(b, n);
          const Q = V.dot(n, An);
          let z = 0;
          if (Math.abs(Q) < 1e-12) { if (Math.abs(B) > 1e-12) z = -C / B; }
          else { const d = B * B - 4 * Q * C; if (d < 0) return null; const root = Math.sqrt(d), z1 = (-B + root) / (2 * Q), z2 = (-B - root) / (2 * Q); z = Math.abs(z1) < Math.abs(z2) ? z1 : z2; }
          return V.add(tile.P, V.add(w, V.mul(n, z)));
        };
        for (let a = 0; a <= 6; a++) for (let b0 = 0; b0 <= 6; b0++) {
          const p = quad((a / 3 - 1) * r, (b0 / 3 - 1) * r);
          if (!p || !G.envInside(env, p, -1e-7) || sources.some(pos => V.dist(p, pos) < keep + 0.2)) return false;
        }
        return true;
      };
      while (aperture > 0.3 && !fitsSurface(aperture)) aperture *= 0.82;
      if (aperture <= 0.3 || !fitsSurface(aperture)) continue;
      const surface = {
        type: 'facet', id, P: tile.P, S0: S.slice(), Z, flat: false, di: aimD,
        clip: { kind: 'rect', hx: aperture, hy: aperture, ref: [0, 0, 1] },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false },
      };
      surfaces.push(surface);
      intent.push({ facet: id, cells: [[cell, positive[lo].w / Math.max(1e-12, total) * count]] });
    }
    return { surfaces, intent, notes: [`Placed ${surfaces.length} curved facets; deterministic weighted paint quantiles over a tiled envelope.`] };
  },
});

// Optional tuning wrapper. This id suffix permits trace-guided selection; the static solver above
// remains independently usable and never traces.
RF.Solvers.register({
  id: 'bench-gpt6luna-flex-r2--paint-static-auto', name: 'Paint Static (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Tuning goal', type: 'select', options: [
      { label: 'Faithful', value: 'faithful' },
      { label: 'Throw', value: 'throw' },
      { label: 'Efficient', value: 'efficient' },
    ], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-gpt6luna-flex-r2--paint-static');
    if (!base || !tools || typeof tools.trace !== 'function') {
      return base.solve(input, { minDistance: settings.minDistance || 0, apertureScale: 0.5 }, tools);
    }
    const goal = settings.goal || 'faithful';
    const scales = [0.4, 0.5, 0.65, 0.8];
    const candidates = [];
    for (const apertureScale of scales) {
      const out = base.solve(input, { minDistance: settings.minDistance || 0, apertureScale }, tools);
      const trace = tools.trace(out.surfaces, { rays: 100000, seed: input.seed });
      const f = trace.fidelity || {};
      candidates.push({ out, apertureScale, fidelity: f.fidelity || 0, onPaint: f.onPaint || 0, peak: trace.ofCeiling || 0 });
    }
    let best;
    if (goal === 'throw') {
      best = candidates.reduce((a, b) => b.onPaint > a.onPaint ? b : a);
    } else if (goal === 'efficient') {
      const peakMax = Math.max(1e-9, ...candidates.map(c => c.peak));
      const lightMax = Math.max(1e-9, ...candidates.map(c => c.onPaint));
      const utility = c => {
        const gate = Math.max(0, Math.min(1, (c.fidelity - 0.5) / 0.25));
        return c.fidelity + gate * 0.5 * (0.7 * c.onPaint / lightMax + 0.3 * c.peak / peakMax);
      };
      best = candidates.reduce((a, b) => utility(b) > utility(a) ? b : a);
    } else {
      best = candidates.reduce((a, b) => b.fidelity > a.fidelity ? b : a);
    }
    best.out.notes = (best.out.notes || []).concat([`Auto goal ${goal}: selected apertureScale ${best.apertureScale} from ${scales.join(', ')} (100k-ray static candidates).`]);
    return best.out;
  },
});
