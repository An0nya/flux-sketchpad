/* Faceted paint solver (static, no tracing).
 *
 * Facets are placed on the envelope face behind the LED as seen along the
 * throw direction (that plane is used so beams leaving facets toward the
 * target cannot hit other facets: blocked light is ~0), or, when that face
 * cannot be illuminated / is not a box face, on a spherical shell around
 * the LED in the emitted directions.  A curved (ellipsoid) facet images the
 * LED centre onto its aim point, so each facet paints one spot: the LED
 * image, size ~ LED * (facet->target)/(LED->facet); farther facets paint
 * smaller spots.  When spots would be too small for the paint to be covered
 * smoothly, the back plane is moved (part-way) toward the LED, enlarging
 * spots and captured solid angle.  Aim points are chosen by a weighted
 * greedy packing whose spacing is proportional to 1/sqrt(paint) (aim
 * density proportional to paint level; where spacing is capped, facet area
 * carries the level instead), so the spot convolution approximates the
 * paint blurred by one spot (which the fidelity score allows).  Facet area
 * is set from the site's required strength and its incidence cosine.
 */
RF.Solvers.register({
  id: 'bench-museember-max--faceted-paint', name: 'Faceted paint (shell + weighted aim packing)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'shellQ', label: 'Shell radius percentile', type: 'range', min: 0, max: 0.98, step: 0.01, default: 0.45 },
    { key: 'cover', label: 'Aim spacing cap (x spot)', type: 'range', min: 0.5, max: 2, step: 0.05, default: 1.0 },
    { key: 'spotFac', label: 'Max spot vs minimum kernel spot', type: 'range', min: 1, max: 4, step: 0.1, default: 1.8 },
    { key: 'backShift', label: 'Max back plane shift toward LED (mm)', type: 'range', min: 0, max: 60, step: 1, default: 35 },
    { key: 'aimScale', label: 'Aim spacing scale', type: 'range', min: 0.4, max: 2, step: 0.05, default: 1 },
    { key: 'fill', label: 'Facet fill vs tile spacing', type: 'range', min: 0.4, max: 1.3, step: 0.05, default: 0.8 },
    { key: 'intThresh', label: 'Emission intensity threshold', type: 'range', min: 0, max: 0.5, step: 0.01, default: 0.04 },
  ],
  solve(input, settings) {
    const V = RF.V, U = RF.U;
    const src = input.source, S = src.pos.slice();
    const srcAx = RF.Source.frame(src).a;
    const env = input.envelope;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity;
    const paintRes = input.paint.res | 0, paint = input.paint.cells;
    const T = RF.Engine.designFrame(input.target);
    const cellMm = (2 * T.half) / Math.max(1, paintRes);
    const notes = [];

    // ---- paint statistics
    let pmax = 0, psum = 0, pcnt = 0, uc = 0, vc = 0;
    let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
    for (let j = 0; j < paintRes; j++) for (let i = 0; i < paintRes; i++) {
      const p = paint[j * paintRes + i]; if (!(p > 0)) continue;
      pmax = Math.max(pmax, p); psum += p; pcnt++;
      const uv = RF.Engine.cellCenter(T, i, j);
      uc += p * uv[0]; vc += p * uv[1];
      umin = Math.min(umin, uv[0]); umax = Math.max(umax, uv[0]);
      vmin = Math.min(vmin, uv[1]); vmax = Math.max(vmax, uv[1]);
    }
    if (!pcnt || !(psum > 0)) return { surfaces: [], intent: [], notes: ['no painted cells'] };
    uc /= psum; vc /= psum;
    const Zc = RF.Engine.targetUVtoWorld(T, uc, vc);
    const tt = V.norm(V.sub(Zc, S)); // approx direction to paint centroid, as seen from LED

    // ---- candidate facet positions.
    // Preferred (box envelopes): the envelope face behind the LED as seen along the
    // throw direction (tt).  Every facet then sits in (nearly) one plane and every
    // beam leaves that plane toward the target, so beams cannot hit other facets
    // (>=~0 blocking) and rays from the LED cannot be shadowed by a facet on the
    // same plane unless their patches overlap there, which tiling prevents.
    // Fallback (non-box, or a back face the LED cannot illuminate): a spherical
    // shell around the LED at a radius the envelope allows in many directions.
    const ledEff0 = RF.Source.extentSize(src) || 1;
    let kerMm = 0;
    try { const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: input.target }); kerMm = ker && ker.mm > 0 ? ker.mm : 0; } catch (e) { kerMm = 0; }
    const Lapprox = Math.max(30, V.dist(S, Zc));
    const pts = [];
    let R0 = 0, usedWall = false;
    const wallPts = () => {
      if (env.shape !== 'box') return null;
      // choose the face whose inward normal best aligns with tt
      let best = null;
      for (let ax = 0; ax < 3; ax++) for (const side of [-1, 1]) {
        const inward = [0, 0, 0]; inward[ax] = -side;
        const align = V.dot(tt, inward);
        if (!best || align > best.align) best = { ax, side, inward, align };
      }
      if (!best || best.align < 0.25) return null;
      const ax = best.ax, i1 = (ax + 1) % 3, i2 = (ax + 2) % 3;
      const faceCoord = env.center[ax] + best.side * env.half[ax];
      const faceArea = (2 * env.half[i1]) * (2 * env.half[i2]);
      const stepW = Math.max(2.5, Math.sqrt(faceArea / Math.max(1, maxF)) * 0.55);
      const inset = Math.min(4, Math.max(1.5, stepW * 0.45));
      const raw = [];
      let iref = 0;
      const totInt = Math.max(1e-9, RF.Source.totalIntegral(src));
      let capture = 0;
      for (let a = env.center[i1] - env.half[i1] + stepW / 2; a <= env.center[i1] + env.half[i1] - stepW / 4; a += stepW)
        for (let b = env.center[i2] - env.half[i2] + stepW / 2; b <= env.center[i2] + env.half[i2] - stepW / 4; b += stepW) {
          const P = [0, 0, 0]; P[ax] = faceCoord; P[i1] = a; P[i2] = b;
          for (let q = 0; q < 3; q++) P[q] += best.inward[q] * inset;
          const dv = V.sub(P, S), r = V.len(dv); if (!(r > 1e-9)) continue;
          const d = V.mul(dv, 1 / r);
          const theta = Math.acos(U.clamp(V.dot(d, srcAx), -1, 1));
          const inten = RF.Source.intensity(src, theta); if (!(inten > 0)) continue;
          if (inten > iref) iref = inten;
          const cosIn = Math.sqrt(Math.max(0, (1 - V.dot(d, tt)) / 2));
          // flux this tile would catch if fully tiled (fraction of emission)
          capture += inten * (stepW * stepW * cosIn / (r * r)) / totInt;
          raw.push({ P, d, inten, r, cosIn, stepW });
        }
      if (!(iref > 0)) return null;
      for (const c of raw) c.ir = c.inten / iref;
      const spotAllow = kerMm > 0 ? kerMm * (settings.spotFac || 1.8) : Infinity;
      const filt = (ith, cith, sacc) => raw.filter((c) => c.ir >= ith && c.cosIn >= cith && c.r >= keep + 1.5 && ledEff0 * Lapprox / c.r <= spotAllow * sacc);
      let list = filt(settings.intThresh || 0.04, 0.30, 1);
      if (list.length < maxF) list = filt(0.015, 0.22, 1.6);
      if (list.length < 0.4 * maxF) list = filt(0.0, 0.15, 2.2);
      return { list, capture, stepW, inward: best.inward };
    };
    {
      const w = wallPts();
      if (w && w.list.length >= Math.min(maxF, 10) && w.capture > 0.025) {
        usedWall = true;
        let rmax = 0; for (const c of w.list) rmax = Math.max(rmax, c.r);
        for (const c of w.list) pts.push({ P: c.P, d: c.d, ir: c.ir, cosIn: c.cosIn, shiftVec: w.inward, v: Math.sqrt(Math.max(0, c.ir)) * (0.35 + 0.65 * c.cosIn) * (0.65 + 0.35 * Math.min(1, c.r / Math.max(1, rmax))) });
        notes.push('back wall: capture est ' + (100 * w.capture).toFixed(1) + '%, ' + pts.length + ' candidates');
      }
    }
    if (!usedWall) {
      // ---- candidate directions (Fibonacci sphere) for a spherical shell
      const M = 2600, cands = [];
      for (let k = 0; k < M; k++) {
        const z = 1 - (2 * k + 1) / M;
        const rr = Math.sqrt(Math.max(0, 1 - z * z)), ph = k * 2.399963229728653;
        const d = [rr * Math.cos(ph), rr * Math.sin(ph), z];
        const theta = Math.acos(U.clamp(V.dot(d, srcAx), -1, 1));
        const inten = RF.Source.intensity(src, theta);
        if (!(inten > 0)) continue;
        const iv = RF.Geo.envInterval(env, S, d);
        if (!iv || !(iv[1] > 0)) continue;
        const cosIn = Math.sqrt(Math.max(0, (1 - V.dot(d, tt)) / 2));
        if (cosIn < 0.30) continue;
        cands.push({ d, inten, tout: iv[1], tin: iv[0], cosIn });
      }
      if (!cands.length) return { surfaces: [], intent: [], notes: ['no feasible directions'] };
      let iref = 0; for (const c of cands) iref = Math.max(iref, c.inten);
      for (const c of cands) c.ir = c.inten / iref;
      const feas = cands.filter((c) => c.ir >= (settings.intThresh || 0));
      const base = feas.length ? feas : cands;
      const sorted = base.slice().sort((a, b) => a.tout - b.tout);
      const wfun = (c) => Math.sqrt(Math.max(1e-6, c.ir)) * c.cosIn;
      let wtot = 0; for (const c of sorted) wtot += wfun(c);
      let acc = 0; R0 = sorted[sorted.length - 1].tout;
      for (const c of sorted) { acc += wfun(c); if (acc / wtot >= (settings.shellQ || 0.45)) { R0 = c.tout; break; } }
      const countAt = (R) => base.filter((c) => R >= c.tin && R <= c.tout - 1 && R >= keep + 1).length;
      let guard = 0;
      while (countAt(R0) < maxF && R0 > keep + 2 && guard++ < 40) R0 *= 0.94;
      if (R0 < keep + 0.5) R0 = keep + 2;
      for (const c of base) {
        if (!(R0 >= c.tin && R0 <= c.tout - 1)) continue;
        pts.push({ P: V.add(S, V.mul(c.d, R0)), d: c.d, ir: c.ir, cosIn: c.cosIn, v: Math.sqrt(Math.max(0, c.ir)) * (0.35 + 0.65 * c.cosIn) });
      }
      if (!pts.length) return { surfaces: [], intent: [], notes: ['no shell candidates'] };
      notes.push('shell R=' + R0.toFixed(1) + 'mm, ' + pts.length + ' candidate directions');
    }

    // ---- greedy spread selection of facet positions
    const sel = [];
    {
      let best = -1, bv = -1;
      pts.forEach((p, i) => { if (p.v > bv) { bv = p.v; best = i; } });
      sel.push(best);
      const dmin = pts.map((p, i) => i === best ? 0 : V.dist(p.P, pts[best].P));
      const used = new Array(pts.length).fill(false); used[best] = true;
      while (sel.length < maxF) {
        let bi = -1, bs = -1;
        for (let i = 0; i < pts.length; i++) {
          if (used[i] || !isFinite(dmin[i])) continue;
          const s = dmin[i] * (0.4 + 0.6 * pts[i].v);
          if (s > bs) { bs = s; bi = i; }
        }
        if (bi < 0) break;
        used[bi] = true; sel.push(bi);
        for (let i = 0; i < pts.length; i++) if (!used[i]) {
          const dd = V.dist(pts[i].P, pts[bi].P);
          if (dd < dmin[i]) dmin[i] = dd;
        }
      }
    }
    const facets0 = sel.map((i) => pts[i]);
    const nF = facets0.length;
    // neighbour spacing
    for (let i = 0; i < nF; i++) {
      let m = Infinity;
      for (let j = 0; j < nF; j++) if (j !== i) m = Math.min(m, V.dist(facets0[i].P, facets0[j].P));
      facets0[i].tile = isFinite(m) ? m : 10;
    }
    const tiles = facets0.map((f) => f.tile).sort((a, b) => a - b);
    const tileMed = tiles[Math.floor(tiles.length / 2)] || 10;

    // ---- aim sites: weighted greedy packing on the target
    const ledEff = ledEff0;
    const rList = facets0.map((f) => V.dist(f.P, S)).sort((a, b) => a - b);
    const rMed = rList[Math.floor(rList.length / 2)] || R0 || 30;
    const L0 = Math.max(50, V.dist(facets0[0] ? facets0[0].P : S, Zc));
    let spot0 = ledEff * L0 / Math.max(5, rMed);
    // If the wall spots are too small for the paint to be covered smoothly
    // (few spots overlap any point), move the back plane toward the LED:
    // spots grow (~L/r), captured solid angle grows, and the plane stays at
    // least ~45% of its original distance behind the LED (crossing the LED
    // plane makes facets shadow each other).
    {
      const meanPn = (psum / pcnt) / pmax;
      const sTyp = Math.sqrt(Math.max(1, (psum / pmax) * cellMm * cellMm) / Math.max(1, nF)) / Math.sqrt(Math.max(0.08, meanPn));
      // How wide may spots be before the spot-blurred paint stops matching the
      // (raw / minimum-kernel-blurred) paint?  Compute that statically for a
      // ladder of widths; smooth paints allow much wider (smoother) spots.
      const spotNeed = sTyp * 1.30;
      if (spot0 < spotNeed * 0.97 && facets0.some((f) => f.shiftVec)) {
        const backDists = facets0.filter((f) => f.shiftVec).map((f) => -V.dot(V.sub(f.P, S), tt)).sort((a, b) => a - b);
        const backDist = backDists[Math.floor(backDists.length / 2)];
        if (backDist > 4) {
          const spotDesired = Math.min(spotNeed, spot0 * 3.5);
          const targetR = ledEff * L0 / Math.max(5, spotDesired);
          const trans2 = Math.max(0, rMed * rMed - backDist * backDist);
          const backTarget = targetR * targetR > trans2 ? Math.sqrt(targetR * targetR - trans2) : 0.35 * backDist;
          let delta = Math.max(0, backDist - backTarget);
          delta = Math.min(delta, settings.backShift || 0, 0.55 * backDist);
          if (delta > 0.5) {
            for (const f of facets0) if (f.shiftVec) { const Pn = V.add(f.P, V.mul(f.shiftVec, delta)); if (V.dist(Pn, S) >= keep + 2) f.P = Pn; }
            const rList2 = facets0.map((f) => V.dist(f.P, S)).sort((a, b) => a - b);
            const rMed2 = rList2[Math.floor(rList2.length / 2)];
            notes.push('back plane shift ' + delta.toFixed(1) + 'mm, spot ' + spot0.toFixed(1) + '->' + (ledEff * L0 / Math.max(5, rMed2)).toFixed(1) + 'mm');
            spot0 = ledEff * L0 / Math.max(5, rMed2);
          }
        }
      }
    }
    const effArea = (psum / pmax) * cellMm * cellMm;
    let s0 = Math.sqrt(Math.max(1, effArea) / Math.max(1, nF)) * (settings.aimScale || 1);
    s0 = Math.max(s0, cellMm * 0.7);
    const step = Math.max(cellMm * 0.5, Math.min(s0 / 3, Math.max(cellMm, spot0 / 4)));
    const sCover = Math.max(cellMm * 1.2, (settings.cover || 1) * spot0);
    const sites = [];
    {
      const cand = [];
      for (let v = vmin; v <= vmax + 1e-9; v += step) for (let u = umin; u <= umax + 1e-9; u += step) {
        const ii = U.clamp(Math.floor((u + T.half) / (2 * T.half) * paintRes), 0, paintRes - 1);
        const jj = U.clamp(Math.floor((v + T.half) / (2 * T.half) * paintRes), 0, paintRes - 1);
        const p = paint[jj * paintRes + ii];
        if (!(p > 0)) continue;
        const pn = p / pmax, sp = Math.min(s0 / Math.sqrt(Math.max(0.04, pn)), sCover);
        cand.push({ u, v, pn, sp, qdes: U.clamp(pn * Math.pow(sp / s0, 2), 0.06, 1.25), cell: jj * paintRes + ii });
      }
      if (cand.length) {
        let bi = 0, bs = -1;
        cand.forEach((c, i) => { const s = c.pn - 1e-6 * Math.hypot(c.u - uc, c.v - vc); if (s > bs) { bs = s; bi = i; } });
        const chosen = new Array(cand.length).fill(false);
        const dmin = new Float64Array(cand.length).fill(Infinity);
        const pick = (i) => { chosen[i] = true; sites.push(cand[i]); for (let q = 0; q < cand.length; q++) if (!chosen[q]) { const dd = Math.hypot(cand[q].u - cand[i].u, cand[q].v - cand[i].v); if (dd < dmin[q]) dmin[q] = dd; } };
        pick(bi);
        while (sites.length < nF) {
          let b2 = -1, bsc = -1;
          for (let i = 0; i < cand.length; i++) {
            if (chosen[i] || !isFinite(dmin[i])) continue;
            const sc = dmin[i] / cand[i].sp;
            if (sc > bsc) { bsc = sc; b2 = i; }
          }
          if (b2 < 0) break;
          pick(b2);
        }
      }
    }
    // (Patch strengths deliberately keep the spacing law's absolute scale:
    // renormalising them to a median was tried and hurt low-count scenes.)
    notes.push('aim sites ' + sites.length + ', s0=' + s0.toFixed(1) + 'mm spot0=' + spot0.toFixed(1) + 'mm step=' + step.toFixed(1));
    // deterministic shuffle of sites so facet position / aim pairs are not systematically correlated
    {
      const rng = new RF.rng.Rng((input.seed | 0) ^ 0x5bd1e995);
      for (let i = sites.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = sites[i]; sites[i] = sites[j]; sites[j] = t; }
    }

    // ---- build facets
    const surfaces = [], intent = [];
    const fill = settings.fill || 0.95;
    for (let k = 0; k < Math.min(nF, sites.length); k++) {
      const f = facets0[k], site = sites[k];
      let P = f.P.slice();
      const Z = RF.Engine.targetUVtoWorld(T, site.u, site.v);
      let placed = false, hx = 5, hy = 5, L = 0;
      for (let attempt = 0; attempt < 30 && !placed; attempt++) {
        const sh = V.norm(V.sub(S, P)), ah = V.norm(V.sub(Z, P));
        const cosIn = Math.sqrt(Math.max(0, (1 + V.dot(sh, ah)) / 2));
        if (cosIn < 0.12) break;
        L = V.dist(P, Z);
        // patch size: (area * cosIn) proportional to this site's required strength:
        // qrel = pn * (sp/s0)^2 is 1 when spacing follows the density law, and <1
        // when spacing was capped at sCover (dim areas then use smaller facets).
        const qrel = site.qdes !== undefined ? site.qdes : U.clamp(site.pn * Math.pow(site.sp / Math.max(1e-9, s0), 2), 0.06, 1.25);
        let area = Math.pow(tileMed * fill, 2) * (0.72 / Math.max(0.15, cosIn)) * qrel;
        let side = Math.sqrt(area);
        side = Math.min(side, f.tile * 1.02);
        side = Math.max(1.8, side);
        hx = side / 2; hy = side / 2;
        // shrink until corners are inside envelope and outside clearance
        let ok = true;
        for (let shrink = 0; shrink < 12; shrink++) {
          const n = V.norm(V.add(sh, ah));
          const ex = V.inPlane(n, T.tu), ey = V.cross(n, ex);
          ok = true;
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const corner = V.add(P, V.add(V.mul(ex, sx * hx), V.mul(ey, sy * hy)));
            if (!RF.Geo.envInside(env, corner, -0.0005) || V.dist(corner, S) < keep + 0.25) { ok = false; break; }
          }
          if (ok) break;
          hx *= 0.78; hy *= 0.78;
        }
        if (ok && V.dist(P, S) >= keep + 0.25 && RF.Geo.envInside(env, P, -0.0005)) { placed = true; break; }
        // move the centre a little toward the LED and retry
        const dir = V.norm(V.sub(P, S));
        P = V.sub(P, V.mul(dir, Math.max(1, f.tile * 0.12)));
      }
      if (!placed) continue;
      const id = 'F' + surfaces.length;
      surfaces.push({ type: 'facet', id, group: 'A', P, S0: S.slice(), Z: Z.slice(), flat: false, di: L,
        clip: { kind: 'rect', hx, hy, ref: T.tu.slice() },
        optics: { interaction: 'reflect', reflectivity: refl } });
      // intent: cells within one spot of the aim
      const cells = [];
      {
        const spot = ledEff * L / Math.max(5, V.dist(P, S));
        const iu0 = Math.max(0, Math.floor((site.u - spot / 2 + T.half) / cellMm)), iu1 = Math.min(paintRes - 1, Math.floor((site.u + spot / 2 + T.half) / cellMm));
        const iv0 = Math.max(0, Math.floor((site.v - spot / 2 + T.half) / cellMm)), iv1 = Math.min(paintRes - 1, Math.floor((site.v + spot / 2 + T.half) / cellMm));
        for (let j = iv0; j <= iv1; j++) for (let i = iu0; i <= iu1; i++) { const c = j * paintRes + i; if (paint[c] > 0) cells.push([c, paint[c]]); }
        if (!cells.length) cells.push([site.cell, 1]);
        if (cells.length > 400) cells.length = 400;
      }
      intent.push({ facet: id, cells });
    }
    notes.push(surfaces.length + ' facets placed');
    return { surfaces, intent, notes };
  },
});

/* Optional tuner (separate solver, scored separately): tries a handful of static
 * settings, traces each with the same seed, and returns the best for the goal.
 * A solver whose id ends in -auto may trace inside solve(). */
RF.Solvers.register({
  id: 'bench-museember-max--faceted-paint-auto', name: 'Faceted paint (auto-tuner)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-museember-max--faceted-paint');
    const mk = (over) => RF.Solvers.sanitize(base, Object.assign(RF.Solvers.defaults(base), { minDistance: settings.minDistance || 0 }, over || {}));
    const variants = [
      {},
      { fill: 0.65 }, { fill: 0.95 },
      { cover: 0.65 }, { cover: 1.0 },
      { aimScale: 0.85 }, { aimScale: 1.15 },
      { backShift: 0 }, { spotFac: 2.6 }, { shellQ: 0.3 },
    ];
    let bestOut = null, bestScore = -Infinity, bestNote = '';
    const goal = settings.goal || 'faithful';
    for (let v = 0; v < variants.length; v++) {
      const st = mk(variants[v]);
      let out;
      try { out = base.solve(JSON.parse(JSON.stringify(input)), st, tools); } catch (e) { continue; }
      if (!out || !out.surfaces || !out.surfaces.length) continue;
      let score;
      try {
        const tr = tools.trace(out.surfaces, { rays: 120000, seed: 90210 });
        const fid = tr.fidelity;
        if (!fid) continue;
        const F = fid.fidelity || 0;
        if (goal === 'throw') score = F * Math.pow(Math.max(1, tr.peakCd || 1) / 1000, 0.25);
        else if (goal === 'efficient') score = F * (0.8 + Math.min(1, fid.onPaint || 0) + 0.3 * Math.min(1, (tr.peakCd || 0) / 20000));
        else score = F;
        bestNote = 'variant ' + v + ' F=' + F.toFixed(3) + ' onPaint=' + (fid.onPaint || 0).toFixed(3) + ' peakCd=' + Math.round(tr.peakCd || 0);
      } catch (e) { continue; }
      if (score > bestScore) { bestScore = score; bestOut = out; bestOut.notes = (out.notes || []).concat(['auto: chose ' + bestNote + ' (goal ' + goal + ')']); }
    }
    if (!bestOut) bestOut = base.solve(JSON.parse(JSON.stringify(input)), mk({}), tools);
    return bestOut;
  },
});
