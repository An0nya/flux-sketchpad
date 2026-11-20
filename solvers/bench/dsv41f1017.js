/* Paint solver: a static target partition -> faceted ellipsoid reflector.
 *
 * The painting is split into equal-flux leaves (recursive median bisection).  Each leaf gets one
 * small mirror patch on a virtual dome around the LED; the patch is aimed at the leaf centroid and
 * its curvature focuses the LED there.  The patch size is matched to the leaf's angular size, so
 * the image is about as large as the leaf (never smaller than the LED allows).  Loosely based on
 * the fact that a mirror preserves étendue: a facet can make the LED look bigger, not brighter.
 */
RF.Solvers.register({
  id: 'bench-dsv41f1017--paint-facets', name: 'Paint facets (static partition)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facets', label: 'Fraction of the facet budget used', type: 'range', min: 0.05, max: 1, step: 0.05, default: 1 },
    { key: 'reach', label: 'Facet distance / wall distance', type: 'range', min: 0.3, max: 0.995, step: 0.005, default: 0.9 },
    { key: 'patch', label: 'Patch scale (0 = auto)', type: 'range', min: 0, max: 8, step: 0.05, default: 0 },
    { key: 'spread', label: 'Source-direction spread', type: 'range', min: 0.2, max: 24, step: 0.05, default: 20 },
    { key: 'focus', label: 'Curvature (1 = focus at aim)', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
    { key: 'levels', label: 'Paint level bins', type: 'range', min: 1, max: 16, step: 1, default: 1 },
    { key: 'baseAngle', label: 'Base facet tilt (deg; -1 = auto)', type: 'number', min: -1, max: 85, step: 1, default: -1 },
    { key: 'baseAz', label: 'Base azimuth (deg; 999 = auto)', type: 'number', min: -180, max: 999, step: 5, default: 999 },
    { key: 'patchMode', label: 'Patch footprint', type: 'select', options: [{ value: 'leaf', label: 'per leaf' }, { value: 'global', label: 'uniform (global max)' }], default: 'global' },
    { key: 'shield', label: 'Block direct light on the target', type: 'checkbox', default: true },
    { key: 'mapMode', label: 'Facet placement map', type: 'select', options: [{ value: 'target', label: 'follow the painting' }, { value: 'index', label: 'sunflower spread' }], default: 'index' },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, E = RF.Engine, Src = RF.Source;
    const L = input.source.pos, axis = V.norm(input.source.axis || [0, 0, 1]);
    const env = input.envelope, T = E.targetFrame(input.target);
    const paint = input.paint.cells, R = input.paint.res, cw = 2 * T.half / R;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const emitterPts = (input.sources && input.sources.length ? input.sources : [input.source]).map((x) => x.pos);
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const K = Math.max(1, Math.min(maxF, Math.round(maxF * settings.facets)));
    const refl = input.limits.reflectivity;

    // ---------------- painted cells and their target-plane coordinates
    const cells = [];
    for (let k = 0; k < paint.length; k++) {
      const w = +paint[k]; if (!(w > 0)) continue;
      const i = k % R, j = (k / R) | 0, uv = E.cellCenter(T, i, j);
      cells.push({ k, w, u: uv[0], v: uv[1] });
    }
    if (!cells.length) return { surfaces: [], intent: [], notes: ['nothing painted'] };

    // ---------------- partition: first by paint level, then into equal-flux leaves
    // (a leaf crossing a level boundary would be painted at the average of the two, so the bright
    //  side would be dim and the dim side bright: keep levels apart).
    const massOf = (a) => a.reduce((s, c) => s + c.w, 0);
    const pmax = cells.reduce((m, c) => Math.max(m, c.w), 0);
    const B = Math.max(1, Math.round(settings.levels));
    const bins = new Map();
    for (const c of cells) { const q = Math.min(B - 1, Math.max(0, Math.floor(c.w / pmax * B))); let a = bins.get(q); if (!a) bins.set(q, (a = [])); a.push(c); }
    const binList = [...bins.entries()].map(([q, a]) => ({ q, cells: a, mass: massOf(a) })).sort((a, b) => a.q - b.q);
    const totalMass = binList.reduce((s, b) => s + b.mass, 0);
    // allocate facets in proportion to each level's flux, at least one where it can be split
    let alloc = binList.map((b) => Math.max(1, Math.floor(K * b.mass / totalMass)));
    while (alloc.reduce((s, x) => s + x, 0) > K) { let i = 0; for (let j = 1; j < alloc.length; j++) if (alloc[j] > alloc[i]) i = j; alloc[i]--; }
    while (alloc.reduce((s, x) => s + x, 0) < K) { let i = 0; let bestNeed = -1; for (let j = 0; j < alloc.length; j++) { const need = binList[j].mass / alloc[j]; if (need > bestNeed) { bestNeed = need; i = j; } } alloc[i]++; }
    let leaves = [];
    const range = (a, key) => { let lo = Infinity, hi = -Infinity; for (const c of a) { if (c[key] < lo) lo = c[key]; if (c[key] > hi) hi = c[key]; } return [lo, hi]; };
    const splitLeaf = (leaf) => {
      const a = leaf.cells, ru = range(a, 'u'), rv = range(a, 'v');
      const key = (ru[1] - ru[0]) >= (rv[1] - rv[0]) ? 'u' : 'v';
      const sorted = a.slice().sort((p, q) => p[key] - q[key]);
      const half = leaf.mass / 2; let acc = 0, cut = 0;
      for (; cut < sorted.length - 1; cut++) { acc += sorted[cut].w; if (acc >= half) break; }
      cut = Math.max(1, Math.min(sorted.length - 1, cut + 1));
      const l1 = sorted.slice(0, cut), l2 = sorted.slice(cut);
      return [{ cells: l1, mass: massOf(l1) }, { cells: l2, mass: massOf(l2) }];
    };
    for (let b = 0; b < binList.length; b++) leaves.push(...splitTo(binList[b], alloc[b]));
    function splitTo(leaf, n) {
      let ls = [{ cells: leaf.cells, mass: leaf.mass }];
      while (ls.length < n && ls.some((l) => l.cells.length > 1)) {
        ls.sort((a, b) => b.mass - a.mass || b.cells.length - a.cells.length);
        const i = ls.findIndex((l) => l.cells.length > 1), l = ls.splice(i, 1)[0];
        ls.push(...splitLeaf(l));
      }
      return ls;
    }

    // ---------------- choose a base reflection direction that catches LED light and has room
    const v0 = V.norm(V.sub(T.C, L));
    let w = V.sub(v0, V.mul(axis, V.dot(v0, axis)));
    if (V.len(w) < 1e-6) w = V.basis(axis)[0]; w = V.norm(w);
    const envT = (u) => { const iv = Geo.envInterval(env, L, u); return iv[1] > 0 ? iv[1] : 0; };
    // The best place to catch light is straight in front of the LED.  If the target is far enough
    // off the emission axis that mirror can reflect toward it, use the axis itself; otherwise tilt
    // out of the direct beam until the reflection geometry works (and the target is not flooded).
    const ledMin = input.source.kind === 'planar' ? (input.source.shape === 'disc' ? 2 * input.source.radius : Math.min(input.source.w, input.source.h)) : (input.source.shape === 'cylinder' ? Math.min(2 * input.source.radius, input.source.length) : 2 * input.source.radius);
    const Dt = Math.max(1, V.dist(T.C, L));
    const planar = input.source.kind === 'planar';
    let best = null;
    const consider = (u) => {
      const r = envT(u); if (!(r > keep + 1e-6)) return;
      const ct = Math.max(0, V.dot(u, axis)); if (ct < 0.04) return;
      const ang = Math.acos(Math.max(-1, Math.min(1, V.dot(u, v0)))); if (ang < 12 * Math.PI / 180) return;
      const img = Dt * ledMin * (planar ? ct : 1) / r;       // smallest image this distance can paint
      const score = img / (0.35 + 0.65 * Math.sqrt(ct));     // image size, tempered by how much light it catches
      if (!best || score < best.score) best = { u, r, score, img, ct };
    };
    const axisAngle = Math.acos(Math.max(-1, Math.min(1, V.dot(axis, v0))));
    if (settings.baseAngle >= 0) {
      const a = settings.baseAngle * Math.PI / 180, z = (settings.baseAz === 999 ? 0 : settings.baseAz) * Math.PI / 180;
      const side = V.add(V.mul(w, Math.cos(z)), V.mul(V.cross(axis, w), Math.sin(z)));
      consider(V.norm(V.add(V.mul(axis, Math.cos(a)), V.mul(side, Math.sin(a)))));
    } else if (axisAngle > 20 * Math.PI / 180 && envT(axis) > keep + 1) {
      // straight in front of the LED catches the most light; it works whenever the target is not
      // nearly on the emission axis
      consider(axis);
    } else {
      for (let th = 30; th <= 80; th += 5) for (let az = -180; az < 180; az += 15) {
        const a = th * Math.PI / 180, z = az * Math.PI / 180;
        const side = V.add(V.mul(w, Math.cos(z)), V.mul(V.cross(axis, w), Math.sin(z)));
        consider(V.norm(V.add(V.mul(axis, Math.cos(a)), V.mul(side, Math.sin(a)))));
      }
    }
    if (!best) return { surfaces: [], intent: [], notes: ['no facet direction fits the envelope and clearance'] };
    const ub = best.u;
    // tangent basis about ub: map target u to e1 and target v to e2
    let e1 = V.sub(T.tu, V.mul(ub, V.dot(T.tu, ub))); if (V.len(e1) < 1e-6) e1 = V.basis(ub)[0]; e1 = V.norm(e1);
    let e2 = V.cross(ub, e1); if (V.dot(e2, T.tv) < 0) e2 = V.mul(e2, -1);

    // ---------------- build one facet per leaf
    const surfaces = [], intent = [], notes = [];
    // source-direction gain: target offsets map to equal angular offsets, but the whole source fan is
    // capped (a near target can otherwise wrap it several times around the LED)
    let maxTU = 1e-9, maxTV = 1e-9;
    for (const c of cells) { maxTU = Math.max(maxTU, Math.abs(c.u)); maxTV = Math.max(maxTV, Math.abs(c.v)); }
    const tgtMaxAng = Math.hypot(maxTU, maxTV) / Math.max(1, V.dist(T.C, L));
    const maxSrcAng = Math.min(1.15, Math.max(0.12, settings.spread * tgtMaxAng));
    const offScale = Math.min(settings.spread, 1.15 / Math.max(1e-9, tgtMaxAng));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const nLeaves = leaves.length;
    // Largest leaf footprint: when patches are uniform, every facet paints about this footprint and
    // the brighter levels get more overlapping facets instead of smaller (dimmer) ones.
    let gHu = 0, gHv = 0;
    for (const leaf of leaves) {
      let m = 0, cu = 0, cv = 0; for (const c of leaf.cells) { m += c.w; cu += c.w * c.u; cv += c.w * c.v; }
      if (!(m > 0)) continue; cu /= m; cv /= m;
      for (const c of leaf.cells) { gHu = Math.max(gHu, Math.abs(c.u - cu)); gHv = Math.max(gHv, Math.abs(c.v - cv)); }
    }
    gHu = Math.max(gHu, cw / 2); gHv = Math.max(gHv, cw / 2);
    // Uniform footprint: one square of the average painted area per facet (the image-size floor
    // and the painted area per facet are both respected by taking the larger of the two).
    const ker = RF.Photometry.achievableKernel({ source: input.source, envelope: env, target: input.target });
    const avgSide = Math.sqrt(cells.length * cw * cw / Math.max(1, K));
    const foot = Math.max(avgSide, ker.mm || 0);
    gHu = gHv = foot / 2;
    const patchUse = settings.patch > 0 ? settings.patch : Math.max(1, Math.min(3, 1 + 1.0 * (ker.mm || 0) / Math.max(1e-6, avgSide)));
    const shrink = 0.94;
    let bad = 0;
    leaves.forEach((leaf, li) => {
      const a = leaf.cells;
      let m = 0, cu = 0, cv = 0;
      for (const c of a) { m += c.w; cu += c.w * c.u; cv += c.w * c.v; }
      if (!(m > 0)) return;
      cu /= m; cv /= m;
      const W = V.add(T.C, V.add(V.mul(T.tu, cu), V.mul(T.tv, cv)));
      // extents of the leaf on the target plane (half width / height)
      let hu = 0, hv = 0;
      for (const c of a) { hu = Math.max(hu, Math.abs(c.u - cu)); hv = Math.max(hv, Math.abs(c.v - cv)); }
      hu = Math.max(hu, cw / 2); hv = Math.max(hv, cw / 2);
      if (settings.patchMode === 'global') { hu = gHu; hv = gHv; }

      // source direction for this leaf: target-plane offset maps to an equal angular offset about ub
      const d0 = Math.max(1e-6, V.dist(W, L));
      let tx, ty;
      if (settings.mapMode === 'index') {
        const rr = maxSrcAng * Math.sqrt((li + 0.5) / Math.max(1, nLeaves)), ph = li * golden;
        tx = rr * Math.cos(ph); ty = rr * Math.sin(ph);
      } else { tx = offScale * cu / d0; ty = offScale * cv / d0; }
      let u = V.norm(V.add(ub, V.add(V.mul(e1, tx), V.mul(e2, ty))));
      if (V.dot(u, axis) < 0.03) u = ub;
      // a facet looking straight at the target would be cut by the direct-light shield (and catches
      // very little LED light anyway): leave that direction to the shield
      const directCone = Math.atan(Math.hypot(T.half, T.half) / Math.max(1, V.dist(T.C, L)));
      if (settings.shield && Math.acos(Math.max(-1, Math.min(1, V.dot(u, v0)))) < directCone + 0.04) { bad++; return; }
      const iv = Geo.envInterval(env, L, u), wall = iv[1];
      if (!(wall > keep + 0.5)) { bad++; return; }
      const r = Math.max(keep + 1e-3, Math.min(wall * settings.reach, wall - 0.35));
      const P = V.add(L, V.mul(u, r));

      // patch axes in the mirror tangent plane, aligned with the target's u/v
      const sh = V.norm(V.sub(L, P)), ah = V.norm(V.sub(W, P));
      let n = V.add(sh, ah); if (V.len(n) < 1e-9) return; n = V.norm(n);
      let ex = V.sub(T.tu, V.mul(n, V.dot(T.tu, n))); if (V.len(ex) < 1e-6) ex = V.basis(n)[0]; ex = V.norm(ex);
      const ey = V.norm(V.cross(n, ex));
      const dW = Math.max(1e-6, V.dist(W, P));
      const ps = patchUse;
      // physical half sizes that make a patch of this angular size (projected at the target)
      // A focused facet's image is source-limited; its brightness grows with its physical area.
      // Correct the area for the facet-to-target distance and the incidence angle so that every
      // leaf delivers the same intensity for the same leaf mass (levels then come from density).
      const cosInc = Math.max(0.15, Math.abs(V.dot(u, n)));
      const corr = (dW / Dt) / Math.sqrt(cosInc);
      let hx = Math.max(1e-4, r * (hu / dW) * ps * corr), hy = Math.max(1e-4, r * (hv / dW) * ps * corr);
      // Build the real surface and test its sampled outline (including the curved sag) against the
      // envelope and every emitter's clearance; shrink the patch until it genuinely fits.
      const id = 'F' + li;
      const di = settings.focus > 1e-6 ? dW / settings.focus : null;
      let surf = null;
      for (let it = 0; it < 12; it++) {
        const pts3 = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => V.add(P, V.add(V.mul(ex, x), V.mul(ey, y))));
        surf = { type: 'facet', id, group: 'A', P, S0: L.slice(), Z: W.slice(), di,
          clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
        let ok = true;
        for (const ep of emitterPts) if (V.dist(P, ep) < keep * (1 + 1e-6)) { ok = false; break; }
        if (ok) try {
          const GG = Geo.compile([surf]);
          for (const poly of Geo.outline(GG, 0)) for (const q of poly) {
            if (!Geo.envInside(env, q, -1e-6)) { ok = false; break; }
            for (const ep of emitterPts) if (V.dist(q, ep) < keep * (1 + 1e-6)) { ok = false; break; }
            if (!ok) break;
          }
        } catch (e) { ok = false; }
        if (ok) break;
        hx *= 0.78; hy *= 0.78;
        if (Math.max(hx, hy) < 2e-4) { surf = null; break; }
      }
      if (!surf) { bad++; return; }
      surfaces.push(surf);
      intent.push({ facet: id, cells: a.map((c) => [c.k, c.w / m]) });
    });
    // ---------------- direct-light shield
    // A planar LED that faces the target pours light straight past the reflector.  A tiny absorbing
    // disc on the LED's target side stops exactly the cone the target plane subtends; the reflecting
    // facets are all well outside that cone, so their light is not touched.
    if (settings.shield && surfaces.length) {
      const halfDiag = Math.hypot(T.half, T.half), s0 = Math.max(keep + 0.25, keep * 1.02 + 0.2);
      const rr = s0 * halfDiag / Math.max(1, V.dist(T.C, L)) * 1.15;
      const inward = V.norm(V.sub(env.center, L));
      let ex = V.inPlane(v0, T.tu), ey = V.cross(v0, ex);
      let placedShield = false;
      // first the ideal disc centred on the target cone; if the envelope clips it (an LED close to a
      // wall), slide it toward the envelope interior and keep the largest part that still fits.
      for (const shift of [0, 0.15, 0.3, 0.5, 0.75, 1, 1.4, 1.9, 2.5]) {
        const SP = V.add(V.add(L, V.mul(v0, s0)), V.mul(inward, shift));
        const pts = [];
        const nseg = 16; for (let i = 0; i < nseg; i++) { const a = 2 * Math.PI * i / nseg; pts.push(V.add(SP, V.add(V.mul(ex, rr * Math.cos(a)), V.mul(ey, rr * Math.sin(a))))); }
        const clear = (q) => Geo.envInside(env, q, -1e-4) && emitterPts.every((ep) => V.dist(q, ep) >= keep * (1 + 1e-6));
        if (!pts.every(clear) || !clear(SP)) continue;
        let blocks = false;
        for (const f of surfaces) {
          const d = V.norm(V.sub(f.Z, f.P)), den = V.dot(d, v0);
          if (Math.abs(den) < 1e-9) continue;
          const t = V.dot(V.sub(SP, f.P), v0) / den;
          if (t > 0 && t < V.dist(f.Z, f.P)) {
            const q = V.add(f.P, V.mul(d, t));
            if (V.dist(q, SP) < rr + 0.05) { blocks = true; break; }
          }
        }
        if (blocks) continue;
        surfaces.push({ type: 'plane', id: 'SHD', group: 'A', P: SP, n: v0.slice(), clip: { kind: 'poly', pts3: pts }, optics: { interaction: 'absorb' } });
        placedShield = true;
        if (shift > 0) notes.push('direct-light shield shifted ' + shift.toFixed(2) + ' mm into the envelope');
        break;
      }
      if (!placedShield) notes.push('direct-light shield skipped (no room or it would cut a reflected path)');
    }
    notes.push(K + ' leaves, ' + surfaces.length + ' facets, base direction ' + ub.map((x) => x.toFixed(2)).join(',') + ' (image ~' + best.img.toFixed(1) + ' mm)' + (bad ? ', ' + bad + ' leaves had no room' : ''));
    return { surfaces, intent, notes };
  },
});

/* ------------------------------------------------------------------------------------------------
 * Optional tuner: paint-facets-auto
 *
 * It runs the static solver above on a small deterministic set of settings, traces each candidate
 * with the SAME seed (common random numbers), and returns the best one for the user's goal.  Only
 * this solver is allowed to trace inside solve(); the static solver never does.
 * ---------------------------------------------------------------------------------------------- */
(function () {
  const baseDef = RF.Solvers.get('bench-dsv41f1017--paint-facets');
  if (!baseDef) return;
  const base = RF.Solvers.defaults(baseDef);
  // one-knob-at-a-time candidates around the tuned defaults
  const VARIANTS = [
    {},
    { patch: 1.0 },
    { patch: 1.4 },
    { patch: 2.0 },
    { patch: 2.8 },
    { reach: 0.985 },
    { reach: 0.78 },
    { focus: 0.65 },
    { levels: 4 },
    { spread: 3 },
    { mapMode: 'target' },
    { shield: false },
    { facets: 0.7 },
  ];
  const clamp01 = (x) => Math.max(0, Math.min(1, +x || 0));
  function scoreOf(goal, tr) {
    const fd = tr.fidelity || {};
    const f = clamp01(fd.fidelity);
    const on = clamp01(fd.onPaint);
    const onN = Math.min(1, on / 0.02);
    if (goal === 'throw') {
      // intensity first, but do not let a bright smear beat a beam that still resembles the paint
      const peak = Math.max(1, tr.peakCd || 1);
      return Math.log10(peak) + 2.0 * f + 0.25 * onN;
    }
    if (goal === 'efficient') {
      // light delivered to the painted cells (not just somewhere on the target)
      return 20 * on + f + 0.002 * Math.log10(Math.max(1, tr.peakCd || 1));
    }
    // faithful: the headline F1, with a small tie-break for actually delivering light
    return f + 0.05 * onN;
  }
  RF.Solvers.register({
    id: 'bench-dsv41f1017--paint-facets-auto', name: 'Paint facets auto-tune', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: [
        { value: 'faithful', label: 'Faithful to the painting' },
        { value: 'throw', label: 'Throw / peak intensity' },
        { value: 'efficient', label: 'Light on the painting' },
      ], default: 'faithful' },
    ],
    solve(input, settings, tools) {
      const goal = settings.goal || 'faithful';
      const seed = (input.seed | 0) || 12345;
      const quickRays = 50000, finalRays = 160000;
      const cfgs = [], seen = new Set();
      for (const v of VARIANTS) {
        const s = Object.assign({}, base, { minDistance: settings.minDistance || 0 }, v);
        const key = JSON.stringify(s);
        if (!seen.has(key)) { seen.add(key); cfgs.push(s); }
      }
      const results = [];
      let fallback = null;
      for (const s of cfgs) {
        let out = null;
        try { out = baseDef.solve(input, s, tools); } catch (e) { continue; }
        if (!out || !Array.isArray(out.surfaces) || !out.surfaces.length) { if (!fallback) fallback = out; continue; }
        if (!fallback) fallback = out;
        let tr = null;
        try { tr = tools.trace(out.surfaces, { rays: quickRays, seed }); } catch (e) { break; }
        if (!tr || !tr.fidelity) continue;
        results.push({ out, tr, s, score: scoreOf(goal, tr) });
      }
      results.sort((a, b) => b.score - a.score);
      // Re-trace the finalists at a higher ray count; same seed, so the ranking is not a dice roll.
      let best = results[0] || null;
      const top = results.slice(0, Math.min(3, results.length));
      for (const r of top) {
        try {
          const tr = tools.trace(r.out.surfaces, { rays: finalRays, seed });
          if (tr && tr.fidelity) { r.tr = tr; r.score = scoreOf(goal, tr); }
        } catch (e) { break; }
      }
      top.sort((a, b) => b.score - a.score);
      if (top[0]) best = top[0];
      if (!best) return fallback || { surfaces: [], intent: [], notes: ['auto: no candidate could be evaluated'] };
      const tr = best.tr, fd = tr.fidelity || {};
      const note = 'auto/' + goal + ': ' + results.length + ' candidates, picked ' +
        Object.keys(best.s || {}).filter((k) => k !== 'minDistance' && base[k] !== best.s[k]).map((k) => k + '=' + best.s[k]).join(' ') +
        ' (' + (100 * (fd.fidelity || 0)).toFixed(1) + '% fid, onPaint ' + (100 * (fd.onPaint || 0)).toFixed(2) + '%, peak ' + Math.round(tr.peakCd || 0) + ' cd)';
      return { surfaces: best.out.surfaces, intent: best.out.intent, notes: [note].concat((best.out.notes || []).slice(0, 2)) };
    },
  });
})();
