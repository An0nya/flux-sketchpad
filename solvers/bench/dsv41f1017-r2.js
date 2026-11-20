/* faceted-reflector solver, v0.1
 *
 * Static design:
 *   - cover the usable part of the LED's emission directions with a quasi-uniform (Fibonacci)
 *     set of directions, placing each patch as far out in the envelope as its spot size allows
 *     (far patches see a smaller LED, so they can paint a smaller image);
 *   - give every direction a mirror patch focused on one target cell.  Target cells are chosen
 *     from the painting by a low-discrepancy inverse-CDF draw, so the density of images on the
 *     target follows the painted level without random clumping;
 *   - each patch is an exact ellipsoid with foci at the LED and its target point, so the patch
 *     aperture focuses instead of smearing.  A small deliberate defocus (auto spot size) gives
 *     the N images enough overlap to cover the painted area smoothly;
 *   - use the back half of the target plane when the emitter puts light there: those reflected
 *     rays leave toward the target without crossing the front of the dish (much less blocking).
 *     When the emitter faces the target, keep the forward directions and only cut the singular
 *     cone around the target direction.
 *
 * All geometry choices are made without tracing.  No tools.trace is used here.
 */
RF.Solvers.register({
  id: 'bench-dsv41f1017-r2--facet-paint', name: 'Facet paint (static)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'coverage', label: 'Direction coverage', type: 'range', min: 0.35, max: 1, step: 0.01, default: 1 },
    { key: 'patchScale', label: 'Patch size', type: 'range', min: 0.20, max: 1.10, step: 0.01, default: 0.95 },
    { key: 'imageCells', label: 'Min spot diameter (paint cells, 0 = auto)', type: 'range', min: 0, max: 10, step: 0.1, default: 0 },
    { key: 'edgeKeepOut', label: 'Front cut from target (°, −1 = auto)', type: 'range', min: -1, max: 100, step: 1, default: -1 },
    { key: 'contrast', label: 'Paint contrast', type: 'range', min: 0.6, max: 2, step: 0.05, default: 1.25 },
    { key: 'inset', label: 'Envelope inset (× patch radius)', type: 'range', min: 1, max: 3, step: 0.05, default: 1.55 },
  ],
  solve(input, settings) {
    const V = RF.V, S = RF.Source, E = RF.Engine;
    const src = input.source, L = src.pos, env = input.envelope, lim = input.limits;
    const srcPositions = (input.sources && input.sources.length ? input.sources : [src]).map((q) => q.pos);
    const maxF = Math.max(1, lim.maxFacets | 0), Rmirror = lim.reflectivity;
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const paint = input.paint.cells, pr = input.paint.res | 0;
    const T = E.targetFrame(input.target), dTarget = E.designFrame ? E.designFrame(input.target) : T;
    const fr = S.frame(src), axis = fr.a;
    const notes = [];
    const surfaces = [], intent = [];

    // ---- deterministic low-discrepancy sampling of painted target cells (one sample per facet).
    // Rosenblatt inversion of the painting's 2-D mass: u picks the column by its painted mass, v picks the
    // row inside that column.  A low-discrepancy (R2) (u,v) sequence therefore lays the facet images out
    // evenly in proportion to the painting instead of clumping like independent random draws.
    const ccol = new Float64Array(pr);
    const rows = new Array(pr), crows = new Array(pr);
    const gamma = Math.max(0.1, +settings.contrast || 1);
    let total = 0;
    for (let i = 0; i < pr; i++) {
      let w = 0; rows[i] = []; crows[i] = [];
      for (let j = 0; j < pr; j++) { const p0 = paint[j * pr + i], q = p0 > 0 ? Math.pow(p0, gamma) : 0; if (q > 0) { w += q; rows[i].push(j); crows[i].push(w); } }
      total += w; ccol[i] = total;
    }
    if (!(total > 0)) return { surfaces: [], intent: [], notes: ['empty painting'] };
    const invCdf = (cum, target) => {
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const pickCell = (u, v) => {
      const uu = Math.min(1 - 1e-12, Math.max(1e-12, u));
      const i = invCdf(ccol, uu * total);
      const list = rows[i], cw = crows[i];
      if (!list.length) return -1;
      const vv = Math.min(1 - 1e-12, Math.max(1e-12, v));
      const j = list[invCdf(cw, vv * cw[cw.length - 1])];
      return j * pr + i;
    };
    const R2A = 0.7548776662466927, R2B = 0.5698402909980532;   // 1/golden and 1/plastic constant
    const cellPoint = (k) => {
      const i = k % pr, j = (k / pr) | 0, uv = E.cellCenter(T, i, j);
      return E.targetUVtoWorld(dTarget, uv[0], uv[1]);
    };

    // ---- emission cap: cover directions the LED actually emits into
    let tm = Math.PI / 2;
    if (src.dist === 'cone') tm = Math.min(Math.PI, Math.max(0.02, (src.halfAngle || 60) * Math.PI / 180));
    else if (src.dist === 'gaussian') tm = Math.min(Math.PI, (src.sigma || 30) * Math.PI / 180 * 3.2);
    else if (src.kind === 'volume') tm = Math.PI;
    if (src.kind === 'planar') tm = Math.min(tm, Math.PI / 2);
    if (!(tm > 0.02)) tm = Math.PI / 2;

    // smallest side of the emitter (the same size the fidelity kernel uses)
    let ledMin = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h))
      : (src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius);
    const cellMM = 2 * T.half / Math.max(1, pr);
    const nPainted = rows.reduce((a, r) => a + r.length, 0);
    // Auto spot size: enough overlap that the images cover the painted area, scaled by how much of the
    // target is painted.  A sparse painting gets small spots (gaps stay dark); a broad one gets larger,
    // smoother ones.  A user-set value overrides it.
    const autoCells = Math.min(5.5, Math.max(4.2, Math.sqrt(4 * (nPainted / maxF) * 9 / Math.PI)));
    const wantDiam = Math.max(0.25, (+settings.imageCells > 0 ? +settings.imageCells : autoCells)) * cellMM;
    // A facet at distance R paints the LED about D·s0/R across (D = target distance).
    const rForImage = Math.max(0, (input.target.distance || V.dist(T.C, L)) * ledMin / Math.max(1e-9, wantDiam));
    const [bu, bv] = V.basis(axis);
    const ga = Math.PI * (3 - Math.sqrt(5));

    // approximate target centre direction, to reject the singular directions that point at the target
    const aimCentre = V.norm(V.sub(T.C, L));

    // Candidate directions: a fine Fibonacci cap, then keep only directions that are usable (not aimed at the
    // target, exit through the envelope) and thin them evenly to the facet budget.  Thinning evenly, rather than
    // taking the first ones, keeps full angular coverage when a front cut or an awkward envelope rejects some.
    const Ncand = Math.max(300, 5 * maxF);
    const capOmega = 2 * Math.PI * (1 - Math.cos(tm));
    const cands = [];
    let powerAll = 0, powerBack = 0;
    const cosBack = Math.cos(100 * Math.PI / 180);
    for (let n = 0; n < Ncand; n++) {
      const z = 1 - (n + 0.5) / Ncand * (1 - Math.cos(tm));
      const st = Math.sqrt(Math.max(0, 1 - z * z)), ph = n * ga;
      const d = V.norm(V.add(V.mul(axis, z), V.add(V.mul(bu, st * Math.cos(ph)), V.mul(bv, st * Math.sin(ph)))));
      const th = Math.acos(Math.max(-1, Math.min(1, V.dot(d, axis))));
      const I = RF.Source.intensity(src, th);
      powerAll += I;
      const ca = V.dot(d, aimCentre);
      if (ca <= cosBack) powerBack += I;
      const iv = RF.Geo.envInterval(env, L, d), tout = iv[1];
      if (!(tout > keep + 1e-6)) continue;
      cands.push({ d, tout, I, ca });
    }
    // Auto front cut: if the LED puts enough light behind the target plane, use that (back) half — its rays
    // leave toward the target without crossing the front of the dish.  If the LED faces the target there is no
    // useful back half, so keep the forward directions and only remove the singular cone around the target.
    const axisToTarget = Math.abs(V.dot(axis, aimCentre));
    let cutDeg = +settings.edgeKeepOut;
    if (!(cutDeg >= 0)) cutDeg = axisToTarget < 0.5 && powerBack > 0.05 * powerAll ? 100 : 35;
    const cosCut = Math.cos(cutDeg * Math.PI / 180);
    const usable = cands.filter((c) => c.I > 0 && c.ca <= cosCut);
    const accepted = usable.length ? usable : cands.filter((c) => c.I > 0);
    let chosen = accepted;
    if (accepted.length > maxF) {
      chosen = [];
      for (let k = 0; k < maxF; k++) chosen.push(accepted[Math.round(k * (accepted.length - 1) / Math.max(1, maxF - 1))]);
    }
    // angular footprint per facet: the accepted cap mass divided by the facets actually placed
    const omega = capOmega * (accepted.length / Math.max(1, Ncand)) / Math.max(1, chosen.length);
    for (let n = 0; n < chosen.length; n++) {
      const d = chosen[n].d, tout = chosen[n].tout;
      const ck = pickCell((n * R2A) % 1, (n * R2B) % 1);
      if (ck < 0) continue;
      const Z = cellPoint(ck), ah = V.norm(V.sub(Z, L));
      const nd = V.dot(d, ah);
      if (nd > cosCut) continue;                               // singular case, for the exact aim
      // patch angular footprint = omega, projected area = omega R^2 / |n.d|.
      // R is solved so that the patch stays inset from the envelope by `inset` patch radii.
      const cosF = Math.max(0.18, Math.abs(V.dot(V.norm(V.add(V.neg(d), ah)), d)));
      const f = Math.sqrt(omega / (Math.PI * cosF));
      const inset = Math.max(1, +settings.inset || 1.55);
      const Rmax = (tout - 0.25) / (1 + inset * f);
      if (!(Rmax > keep + 0.3)) continue;
      let R = Math.min(Rmax, Math.max(rForImage, keep + 0.5));
      if (!(R > 0)) continue;
      let rr = 0, P = null, nn = null, ex = null, ey = null, pts3 = null, diVal = 0, ok = false;
      for (let trial = 0; trial < 24; trial++) {
        rr = f * R * (+settings.patchScale || 1) * (+settings.coverage || 1);
        if (!(rr > 0.05)) break;
        P = V.add(L, V.mul(d, R));
        nn = V.norm(V.add(V.neg(d), V.norm(V.sub(Z, P))));
        [ex, ey] = V.basis(nn);
        pts3 = [];
        for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; pts3.push(V.add(P, V.add(V.mul(ex, rr * Math.cos(a)), V.mul(ey, rr * Math.sin(a))))); }
        // If the emitter is so small (or the clearance so large) that even this R cannot give the wanted
        // natural LED image, add a controlled defocus: move the second focus nearer than the target point.
        // The normal at P is unchanged, so the beam still points at Z; only the spot is enlarged.
        const Dt = V.dist(P, Z), natDiam = Dt * Math.abs(ledMin) / Math.max(1e-9, R);
        diVal = Dt;
        if (natDiam < 0.35 * wantDiam) {
          const extraR = Math.max(0, 0.5 * (wantDiam - natDiam));
          diVal = Dt / (1 + extraR / Math.max(1e-6, rr));
          diVal = Math.max(1e-3, Math.min(Dt, diVal));
        }
        // use the same envelope predicate as the host, with a small negative tolerance: stay strictly inside.
        // The plane corners are checked first; then the real curved surface (an ellipsoid near its focus can sag
        // several millimetres outside the chord plane).
        ok = R - rr > keep * 0.995 && pts3.every((q) => RF.Geo.envInside(env, q, -1e-5));
        if (ok) {
          const cand = {
            type: 'facet', id: 'T', P, S0: L, Z, di: diVal, flat: false,
            clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: Rmirror, twoSided: false },
          };
          try {
            const C = RF.Geo.compile([cand]);
            ok = RF.Geo.outline(C, 0).every((poly) => poly.every((q) => RF.Geo.envInside(env, q, -1e-5)
              && srcPositions.every((sp) => V.dist(q, sp) >= keep * (1 + 1e-6) + 0.02)));
          } catch (e) { ok = false; }
        }
        if (ok) break;
        R *= 0.90;
      }
      if (!ok) continue;
      // a hexagonal aperture in the local plane (convex, so the polygon clip is exact)
      const id = 'F' + surfaces.length;
      surfaces.push({
        type: 'facet', id, P, S0: L, Z, di: diVal, flat: false,
        clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity: Rmirror, twoSided: false },
      });
      intent.push({ facet: id, cells: [[ck, 1]] });
    }

    notes.push(surfaces.length + ' focused facets; ' + rows.reduce((a, r) => a + r.length, 0) + ' painted cells; cap ' + (tm * 180 / Math.PI).toFixed(0) + '°');
    if (surfaces.length === 0) notes.push('no usable emission direction');
    return { surfaces, intent, notes };
  },
});

/* Optional tuner.  It calls the static solver above for a short list of geometry settings, traces each
 * candidate with the SAME seed (so differences are geometry, not dice), and returns the candidate that
 * best matches the selected goal.  Only an id ending in -auto is allowed to trace inside solve(). */
RF.Solvers.register({
  id: 'bench-dsv41f1017-r2--facet-paint-auto', name: 'Facet paint (auto)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: [
      { value: 'faithful', label: 'Faithful painting' },
      { value: 'throw', label: 'Throw / peak intensity' },
      { value: 'efficient', label: 'Light on the painting' },
    ], default: 'faithful' },
    { key: 'traceRays', label: 'Rays per candidate', type: 'range', min: 20000, max: 300000, step: 10000, default: 160000 },
  ],
  solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-dsv41f1017-r2--facet-paint');
    if (!base || !tools || typeof tools.trace !== 'function') {
      return base ? base.solve(input, settings, tools) : { surfaces: [], intent: [], notes: ['static solver not loaded'] };
    }
    const goal = ['faithful', 'throw', 'efficient'].includes(settings.goal) ? settings.goal : 'faithful';
    const N = Math.max(20000, Math.min(300000, Math.round(+settings.traceRays || 160000)));
    const baseSet = Object.assign({}, RF.Solvers.defaults(base), { minDistance: +settings.minDistance || 0 });
    // A compact, deterministic set of candidates.  The static solver supplies the actual geometry.
    const common = [
      {},
      { contrast: 1.15 }, { contrast: 1.35 },
      { patchScale: 1.0 }, { patchScale: 1.05 },
      { imageCells: 4.5 }, { imageCells: 5.5 },
    ];
    const extra = goal === 'faithful' ? [
      { edgeKeepOut: 100 }, { edgeKeepOut: 105 },
      { edgeKeepOut: 95, contrast: 1.2 },
      { edgeKeepOut: 100, contrast: 1.2, patchScale: 1.0 },
      { edgeKeepOut: -1, imageCells: 5.5 },
    ] : [
      { edgeKeepOut: 35 }, { edgeKeepOut: 55 }, { edgeKeepOut: 75 },
      { edgeKeepOut: 55, patchScale: 1.05 },
      { edgeKeepOut: 75, contrast: 1.2 },
      { edgeKeepOut: 35, patchScale: 1.05, imageCells: 4.5 },
    ];
    const rows = [];
    for (const delta of common.concat(extra)) {
      const st = Object.assign({}, baseSet, delta);
      let out = null;
      try { out = base.solve(input, st, {}); } catch (e) { continue; }
      if (!out || !out.surfaces || !out.surfaces.length) continue;
      let tr = null;
      try { tr = tools.trace(out.surfaces, { rays: N, seed: input.seed | 0 }); } catch (e) { tr = null; }
      const fd = tr && tr.fidelity ? tr.fidelity : null;
      rows.push({
        out, tr, settings: st, delta,
        F: fd ? (+fd.fidelity || 0) : 0,
        onPaint: fd ? (+fd.onPaint || 0) : 0,
        peak: tr ? (+tr.peakCd || 0) : 0,
        throwM: tr ? (+tr.throwM || 0) : 0,
      });
    }
    if (!rows.length) return base.solve(input, baseSet, tools);
    const maxF = Math.max(...rows.map((r) => r.F)) || 1;
    const maxPeak = Math.max(...rows.map((r) => r.peak)) || 1;
    const maxOn = Math.max(...rows.map((r) => r.onPaint)) || 1;
    let best = rows[0], bestScore = -Infinity;
    const wF = goal === 'throw' ? 0.60 : goal === 'efficient' ? 0.78 : 1;
    const wM = goal === 'throw' ? 0.40 : goal === 'efficient' ? 0.22 : 0;
    for (const r of rows) {
      const score = wF * (r.F / maxF) + wM * (goal === 'throw' ? r.peak / maxPeak : goal === 'efficient' ? r.onPaint / maxOn : 0);
      if (score > bestScore + 1e-12) { best = r; bestScore = score; }
    }
    // The default candidate is the static solver's tuned baseline.  For the faithful goal, only leave it
    // for a candidate that beats it by more than the candidate trace's noise; otherwise the tuner would
    // sometimes replace the baseline with a noisy near-tie and lose fidelity at the full ray count.
    const baseRow = rows.find((r) => Object.keys(r.delta).length === 0);
    if (goal === 'faithful' && baseRow && best.F <= baseRow.F + 0.008) best = baseRow;
    const result = best.out;
    const changed = Object.keys(best.settings).filter((k) => k !== 'minDistance' && best.settings[k] !== baseSet[k])
      .map((k) => k + '=' + best.settings[k]).join(', ');
    result.notes = (result.notes || []).concat([
      'auto picked ' + goal + (changed ? ' · ' + changed : ' · defaults') +
      ' · F ' + (100 * best.F).toFixed(1) + '% · on paint ' + (100 * best.onPaint).toFixed(1) +
      '% · peak ' + Math.round(best.peak) + ' cd',
    ]);
    if (tools.preview) {
      try { tools.preview(result.surfaces, { label: 'auto · ' + goal, note: 'F ' + (100 * best.F).toFixed(1) + '%', trace: best.tr, needs: result.needs }); } catch (e) { /* display only */ }
    }
    return result;
  },
});
