/*
 * Flux reflector solver: place a sparse, source-facing aperture of curved mirror tiles,
 * then distribute their image foci over the painted irradiance map.
 *
 * This is deliberately a static design pass. It never traces or scores its own geometry.
 */
RF.Solvers.register({
  id: 'bench-gpt6luna-flex-max--paint-aperture', name: 'Paint aperture (static)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'tileFill', label: 'Tile aperture fill', type: 'range', min: 0.55, max: 1, step: 0.05, default: 1 },
    { key: 'sharpness', label: 'Range bias (0 = catch, 1 = far / sharp)', type: 'range', min: 0, max: 1, step: 0.1, default: 0 },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, env = input.envelope;
    const src = input.source, sources = input.sources && input.sources.length ? input.sources : [src];
    const target = input.target, paint = input.paint || {}, res = paint.res | 0;
    const maxFacets = Math.max(0, (input.limits && input.limits.maxFacets) | 0);
    const reflectivity = input.limits && isFinite(input.limits.reflectivity) ? input.limits.reflectivity : 0.9;
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const fill = Math.max(0.55, Math.min(1, +settings.tileFill || 0.9));
    const sharp = Math.max(0, Math.min(1, +settings.sharpness || 0));
    const surfaces = [], intent = [], notes = [];
    const paintCells = paint.cells || [];
    if (!maxFacets || !res || paintCells.length !== res * res || !paintCells.some((x) => x > 0 && isFinite(x))) {
      return { surfaces, intent, notes: ['No painted cells or no facet budget.'] };
    }

    const T = RF.Engine.targetFrame(target);
    const toWorld = (u, v) => V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v)));
    const d = V.norm(V.sub(T.C, src.pos));
    if (V.len(d) < 1e-9) d.splice(0, 3, 1, 0, 0);
    let U = V.inPlane(d, T.tu);
    if (V.len(U) < 1e-8) U = V.basis(d)[0];
    const W = V.norm(V.cross(d, U));
    const C = env.center, H = env.half;
    const minHalf = Math.max(1e-6, Math.min(H[0], H[1], H[2]));

    // Support value of the envelope in the throw direction. A plane just inside that support
    // gives the outgoing rays a clear way to the target and keeps all facets in one aperture layer.
    let support;
    if (env.shape === 'ellipsoid') support = Math.hypot(d[0] * H[0], d[1] * H[1], d[2] * H[2]);
    else if (env.shape === 'cylinder') {
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      support = Math.abs(d[ax]) * H[ax] + Math.hypot(d[i] * H[i], d[j] * H[j]);
    } else support = Math.abs(d[0]) * H[0] + Math.abs(d[1]) * H[1] + Math.abs(d[2]) * H[2];
    const inset = Math.max(0.75, Math.min(8, 0.15 * minHalf));
    const planeT = support - inset;

    // Conservative signed clearance from the centre point to the envelope boundary. This lets
    // the whole curved tile (not just its centre) be kept inside a convex envelope.
    function envelopeMargin(p) {
      const q = V.sub(p, C);
      if (env.shape === 'box') return Math.min(H[0] - Math.abs(q[0]), H[1] - Math.abs(q[1]), H[2] - Math.abs(q[2]));
      if (env.shape === 'ellipsoid') {
        const rr = Math.sqrt((q[0] / H[0]) ** 2 + (q[1] / H[1]) ** 2 + (q[2] / H[2]) ** 2);
        return minHalf * (1 - rr);
      }
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      const radial = Math.sqrt((q[i] / H[i]) ** 2 + (q[j] / H[j]) ** 2);
      return Math.min(H[ax] - Math.abs(q[ax]), Math.min(H[i], H[j]) * (1 - radial));
    }

    // Project the envelope's bounding box into the aperture plane. The exact shape is tested below.
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const q = [sx * H[0], sy * H[1], sz * H[2]];
      const uu = V.dot(q, U), vv = V.dot(q, W);
      u0 = Math.min(u0, uu); u1 = Math.max(u1, uu); v0 = Math.min(v0, vv); v1 = Math.max(v1, vv);
    }
    const placeAt = (u, v) => V.add(C, V.add(V.mul(d, planeT), V.add(V.mul(U, u), V.mul(W, v))));

    // Estimate the usable cross-section and a characteristic tile pitch.
    let insideN = 0, samplesN = 32;
    for (let j = 0; j < samplesN; j++) for (let i = 0; i < samplesN; i++) {
      const u = u0 + (i + 0.5) * (u1 - u0) / samplesN;
      const v = v0 + (j + 0.5) * (v1 - v0) / samplesN;
      if (Geo.envInside(env, placeAt(u, v), 0)) insideN++;
    }
    const apertureArea = Math.max(1e-6, (u1 - u0) * (v1 - v0) * insideN / (samplesN * samplesN));
    const basePitch = Math.sqrt(apertureArea / Math.max(1, maxFacets));
    const provisionalR = Math.max(0.2, Math.min(0.45 * basePitch, 0.15 * minHalf));

    function dirAndNormal(P, Z) {
      const sh = V.norm(V.sub(src.pos, P));
      const ah = V.norm(V.sub(Z, P));
      const sum = V.add(sh, ah), sl = V.len(sum);
      if (!(sl > 1e-8)) return null;
      const n = V.mul(sum, 1 / sl);
      const cIn = Math.max(0, V.dot(n, sh));
      const cOut = Math.max(0, V.dot(n, ah));
      return { sh, ah, n, cIn, cOut };
    }

    function sourceStrength(s, P) {
      const ray = V.norm(V.sub(P, s.pos));
      const axis = V.norm(s.axis || src.axis || [0, 0, 1]);
      const ct = Math.max(-1, Math.min(1, V.dot(ray, axis)));
      const I = RF.Source.intensity(s, Math.acos(ct));
      return I > 0 && isFinite(I) ? I : 0;
    }

    // A dense, deterministic candidate lattice. Greedy spacing later turns it into a Poisson-like
    // aperture. The score transitions from inverse-square capture (nearer, at sharpness 0) toward
    // distance / a smaller LED image (farther, at sharpness 1); the middle removes most of the range bias.
    const fineStep = Math.max(0.35, basePitch * 0.42);
    const nu = Math.max(2, Math.min(160, Math.ceil((u1 - u0) / fineStep)));
    const nv = Math.max(2, Math.min(160, Math.ceil((v1 - v0) / fineStep)));
    const candidates = [];
    let maxR = 0;
    const distanceExponent = 4 * sharp - 2;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = u0 + (i + 0.5) * (u1 - u0) / nu;
      const v = v0 + (j + 0.5) * (v1 - v0) / nv;
      const P = placeAt(u, v);
      if (!Geo.envInside(env, P, -1e-7)) continue;
      const locMargin = envelopeMargin(P);
      if (!(locMargin > 0)) continue;
      const Zc = T.C;
      const aim = dirAndNormal(P, Zc);
      if (!aim || !(aim.cIn > 1e-5) || !(aim.cOut > 1e-5)) continue;
      let strength = 0;
      for (const s of sources) strength += Math.max(0, s.power || 0) * sourceStrength(s, P);
      if (!(strength > 0)) continue;
      const r = V.dist(P, src.pos);
      if (!(r > keep + provisionalR)) continue;
      let safeRadius = locMargin;
      for (const s of sources) safeRadius = Math.min(safeRadius, V.dist(P, s.pos) - keep);
      if (!(safeRadius > 0.2)) continue;
      const lum = RF.Photometry.luminance(src, V.norm(V.sub(P, src.pos)));
      const targetCos = Math.max(1e-4, Math.abs(V.dot(aim.ah, T.n)));
      const bright = (isFinite(lum) && lum > 0 ? lum : strength / Math.max(1e-12, r * r)) * aim.cOut * targetCos;
      const score = strength * aim.cIn;
      candidates.push({ u, v, P, r, strength, bright, score, safeRadius, aim });
      maxR = Math.max(maxR, r);
    }

    if (!candidates.length) {
      return { surfaces, intent, notes: ['No source-facing aperture positions fit the envelope and clearance.'] };
    }
    // Normalize distance so settings have scale-independent meaning. The exponent spans capture
    // efficiency (r^-2) to far-field sharpness (r^+2).
    for (const c of candidates) c.score *= Math.pow(c.r / Math.max(1e-9, maxR), distanceExponent);
    candidates.sort((a, b) => b.score - a.score || a.u - b.u || a.v - b.v);

    // Select spatially separated positions. If the emission cone leaves only a small usable part
    // of the aperture, relax the pitch gradually rather than placing mirrors on top of one another.
    const wanted = Math.min(maxFacets, candidates.length);
    let chosen = [], sep = Math.max(0.3, 0.82 * Math.sqrt(apertureArea / Math.max(1, wanted)));
    for (let round = 0; round < 8; round++) {
      chosen = [];
      const sep2 = sep * sep;
      for (const c of candidates) {
        let ok = true;
        for (const q of chosen) {
          const du = c.u - q.u, dv = c.v - q.v;
          if (du * du + dv * dv < sep2) { ok = false; break; }
        }
        if (ok) chosen.push(c);
        if (chosen.length >= wanted) break;
      }
      if (chosen.length >= wanted || sep <= 0.32 * basePitch) break;
      sep *= 0.82;
    }
    if (!chosen.length) return { surfaces, intent, notes: ['No separated aperture positions remained.'] };

    // Equalize the first-order peak brightness of the little images by area: a lower-radiance view
    // gets a somewhat larger tile, while a bright view gets a smaller one. The clearance and packing
    // bounds always win over this preference.
    const sortedBright = chosen.map((c) => c.bright).filter((x) => x > 0).sort((a, b) => a - b);
    const brightRef = sortedBright.length ? sortedBright[sortedBright.length >> 1] : 1;
    const nearest = chosen.map((c, i) => {
      let m = Infinity;
      for (let j = 0; j < chosen.length; j++) if (j !== i) m = Math.min(m, Math.hypot(c.u - chosen[j].u, c.v - chosen[j].v));
      return isFinite(m) ? m : sep;
    });

    // Equal-mass spatial partitioning. A random paint-weighted cloud leaves holes with a 100-tile
    // cap, especially when the smallest LED image is only a few paint cells wide. Recursively split
    // the target into compact regions with equal paint mass, then use one focus at each region's
    // weighted centroid. The resulting low-discrepancy focus density follows the painted irradiance.
    const stride = res + 1, prefix = new Float64Array(stride * stride);
    let paintTotal = 0;
    for (let j = 0; j < res; j++) {
      let row = 0;
      for (let i = 0; i < res; i++) {
        const w = +paintCells[j * res + i];
        if (w > 0 && isFinite(w)) { row += w; paintTotal += w; }
        prefix[(j + 1) * stride + i + 1] = prefix[j * stride + i + 1] + row;
      }
    }
    const rectMass = (x0, y0, x1, y1) => prefix[y1 * stride + x1] - prefix[y0 * stride + x1] - prefix[y1 * stride + x0] + prefix[y0 * stride + x0];
    const cw = 2 * T.half / res, aims = [], rng = new RF.rng.Rng((input.seed | 0) ^ 0x4a17c9d3);
    const pushCentres = (x0, y0, x1, y1, count, mass) => {
      let sw = 0, su = 0, sv = 0, best = Infinity, bi = -1, bj = -1;
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
        const w = +paintCells[j * res + i]; if (!(w > 0) || !isFinite(w)) continue;
        const uv = RF.Engine.cellCenter(T, i, j);
        sw += w; su += w * uv[0]; sv += w * uv[1];
      }
      const cu = sw > 0 ? su / sw : 0, cv = sw > 0 ? sv / sw : 0;
      for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
        const w = +paintCells[j * res + i]; if (!(w > 0) || !isFinite(w)) continue;
        const uv = RF.Engine.cellCenter(T, i, j), dd = (uv[0] - cu) ** 2 + (uv[1] - cv) ** 2;
        if (dd < best) { best = dd; bi = i; bj = j; }
      }
      if (bi < 0) { bi = Math.floor(res / 2); bj = Math.floor(res / 2); }
      const base = RF.Engine.cellCenter(T, bi, bj);
      const aimU = base[0] + Math.max(-0.4 * cw, Math.min(0.4 * cw, cu - base[0]));
      const aimV = base[1] + Math.max(-0.4 * cw, Math.min(0.4 * cw, cv - base[1]));
      for (let k = 0; k < count; k++) aims.push({ u: aimU, v: aimV, cell: bj * res + bi, mass: mass / Math.max(1, count) });
    };
    const splitRegion = (x0, y0, x1, y1, count, mass) => {
      if (count <= 1 || !(mass > 0)) { pushCentres(x0, y0, x1, y1, count, mass); return; }
      const axes = (x1 - x0) >= (y1 - y0) ? ['x', 'y'] : ['y', 'x'];
      let best = null;
      for (const axis of axes) {
        const lo = axis === 'x' ? x0 + 1 : y0 + 1, hi = axis === 'x' ? x1 : y1;
        for (let cut = lo; cut < hi; cut++) {
          const leftMass = axis === 'x' ? rectMass(x0, y0, cut, y1) : rectMass(x0, y0, x1, cut);
          const epsMass = Math.max(Number.MIN_VALUE, mass * 1e-12);
          if (!(leftMass > epsMass) || !(leftMass < mass - epsMass)) continue;
          const leftCount = Math.max(1, Math.min(count - 1, Math.round(count * leftMass / mass)));
          const rightCount = count - leftCount, rightMass = mass - leftMass;
          const imbalance = Math.abs(Math.log((leftMass / leftCount) / (rightMass / rightCount)));
          const geom = Math.abs(leftCount / count - (axis === 'x' ? (cut - x0) / (x1 - x0) : (cut - y0) / (y1 - y0)));
          const cost = imbalance + 0.025 * geom;
          if (!best || cost < best.cost) best = { axis, cut, leftMass, leftCount, cost };
        }
        if (best && best.cost < 1e-8) break;
      }
      if (!best) { pushCentres(x0, y0, x1, y1, count, mass); return; }
      if (best.axis === 'x') {
        splitRegion(x0, y0, best.cut, y1, best.leftCount, best.leftMass);
        splitRegion(best.cut, y0, x1, y1, count - best.leftCount, mass - best.leftMass);
      } else {
        splitRegion(x0, y0, x1, best.cut, best.leftCount, best.leftMass);
        splitRegion(x0, best.cut, x1, y1, count - best.leftCount, mass - best.leftMass);
      }
    };
    splitRegion(0, 0, res, res, chosen.length, paintTotal);
    // Shuffle the deterministic spatial partition before pairing foci with aperture sites.
    for (let i = aims.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const q = aims[i]; aims[i] = aims[j]; aims[j] = q; }

    for (let k = 0; k < chosen.length; k++) {
      const c = chosen[k], aimPoint = aims[k];
      const cell = aimPoint.cell;
      const ju = (rng.next() - 0.5) * 0.35 * cw, jv = (rng.next() - 0.5) * 0.35 * cw;
      const Z = toWorld(aimPoint.u + ju, aimPoint.v + jv);
      const aim = dirAndNormal(c.P, Z);
      if (!aim) continue;
      const di = V.dist(Z, c.P);
      if (!(di > 0)) continue;
      const sizeBalance = Math.sqrt(Math.max(0.45, Math.min(1.8, brightRef / Math.max(1e-300, c.bright))));
      const hPack = Math.min(0.46 * nearest[k], 0.48 * c.safeRadius);
      let h = Math.min(0.46 * nearest[k] * fill * sizeBalance, hPack);
      if (!(h > 0.15)) continue;
      const id = 'P' + String(k + 1).padStart(3, '0');
      const surface = {
        type: 'facet', id, P: c.P, S0: src.pos, Z, di, flat: false,
        clip: { kind: 'rect', hx: h, hy: h, ref: U },
        optics: { interaction: 'reflect', reflectivity, twoSided: false },
      };

      // Conservative hard-limit verification on a 5×5 sample of the actual curved patch. The
      // centre-ball checks above cover the unsampled interior for both convex envelope and LED keep-out.
      let valid = true, G, maxSag = 0;
      try { G = Geo.compile([surface]); } catch (_) { continue; }
      const ex = V.inPlane(aim.n, U), ey = V.cross(aim.n, ex);
      for (let yy = 0; yy <= 4 && valid; yy++) for (let xx = 0; xx <= 4; xx++) {
        const x = -h + 0.5 * h * xx, y = -h + 0.5 * h * yy;
        const sag = Geo.localSag(G.D, 0, x, y);
        if (!isFinite(sag)) { valid = false; break; }
        maxSag = Math.max(maxSag, Math.abs(sag));
        const q = V.add(c.P, V.add(V.mul(ex, x), V.add(V.mul(ey, y), V.mul(aim.n, sag))));
        if (!Geo.envInside(env, q, -1e-8)) { valid = false; break; }
        for (const s of sources) if (V.dist(q, s.pos) < keep - 1e-6) { valid = false; break; }
      }
      if (!valid) continue;
      // Also guarantee the clearance for points between samples, including curved sag.
      const radius = Math.sqrt(2 * h * h + maxSag * maxSag);
      for (const s of sources) if (V.dist(c.P, s.pos) - radius < keep - 1e-6) valid = false;
      if (!valid) continue;

      surfaces.push(surface);
      intent.push({ facet: id, cells: [[cell, +paintCells[cell]]] });
    }

    notes.push(surfaces.length + ' curved tiles; equal-paint-mass focus layout; aperture inset ' + inset.toFixed(1) + ' mm.');
    if (surfaces.length < chosen.length) notes.push('Some selected tiles were omitted by geometry / clearance checks.');
    return { surfaces, intent, notes };
  },
});

// Optional tuner. It runs the static geometry planner several times, then uses common-random-number
// traces to select among those candidates. Keep this separate: the static solver above never traces.
RF.Solvers.register({
  id: 'bench-gpt6luna-flex-max--paint-aperture-auto', name: 'Paint aperture (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Tuning goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  async solve(input, settings, tools) {
    const staticDef = RF.Solvers.get('bench-gpt6luna-flex-max--paint-aperture');
    if (!staticDef) throw new Error('paint-aperture-auto requires paint-aperture to be registered first');
    const goal = ['faithful', 'throw', 'efficient'].includes(settings.goal) ? settings.goal : 'faithful';
    const candidates = [
      { tileFill: 1, sharpness: 0 },
      { tileFill: 0.8, sharpness: 0 },
      { tileFill: 1, sharpness: 0.5 },
      { tileFill: 1, sharpness: 1 },
    ];
    const budgetRays = tools && tools.budget && isFinite(tools.budget.rays) ? Math.max(1, tools.budget.rays) : 800000;
    const rays = Math.max(1, Math.min(200000, Math.floor(budgetRays / candidates.length)));
    const trials = [];
    for (let i = 0; i < candidates.length; i++) {
      const choice = candidates[i], s = { minDistance: settings.minDistance || 0, ...choice };
      const output = staticDef.solve(input, s, tools);
      let tr = null;
      if (tools && typeof tools.trace === 'function') {
        try { tr = tools.trace(output.surfaces, { rays, seed: input.seed }); } catch (_) { /* Keep the static fallback if a host exhausts its trace budget. */ }
      }
      const f = tr && tr.fidelity;
      trials.push({
        choice, output, trace: tr,
        fidelity: f && isFinite(f.fidelity) ? f.fidelity : 0,
        onPaint: f && isFinite(f.onPaint) ? f.onPaint : 0,
        throwM: tr && isFinite(tr.throwM) ? tr.throwM : (tr && isFinite(tr.peakCd) ? 2 * Math.sqrt(Math.max(0, tr.peakCd)) : 0),
      });
      if (tools && tools.progress) tools.progress((i + 1) / candidates.length);
    }

    const bestFidelity = Math.max(...trials.map((t) => t.fidelity));
    let pool = trials;
    if (goal !== 'faithful') {
      // Keep fidelity first: performance goals may trade at most 0.10 F1 for more throw or light.
      const nearBest = trials.filter((t) => t.fidelity >= bestFidelity - 0.10);
      if (nearBest.length) pool = nearBest;
    }
    let winner = pool[0];
    for (const t of pool.slice(1)) {
      const a = goal === 'throw' ? t.throwM : goal === 'efficient' ? t.onPaint : t.fidelity;
      const b = goal === 'throw' ? winner.throwM : goal === 'efficient' ? winner.onPaint : winner.fidelity;
      if (a > b || (a === b && t.fidelity > winner.fidelity)) winner = t;
    }
    const notes = Array.isArray(winner.output.notes) ? winner.output.notes.slice() : (winner.output.notes ? [String(winner.output.notes)] : []);
    notes.push('Auto goal ' + goal + ': selected tileFill=' + winner.choice.tileFill + ', sharpness=' + winner.choice.sharpness +
      ' from ' + trials.length + ' candidates (' + rays + ' rays each); F1=' + (100 * winner.fidelity).toFixed(1) + '%.');
    return Object.assign({}, winner.output, { notes });
  },
});
