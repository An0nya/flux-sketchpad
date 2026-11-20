/* facet-sheet — a static freeform faceted-reflector solver.
 *
 * Idea: put every facet on one common ELLIPSOID of revolution whose foci are the LED (S) and the
 * target centre (Zc).  Rays from S converge to the far focus, so a reflected ray can never re-hit the
 * shell (no self-blocking, no shadowing of the LED by other facets), and the shell is easy to keep
 * inside any convex envelope.  Each facet is then given its own aim point near Zc on the painted
 * target; the facet normal is the bisector, its curvature the exact ellipsoid imaging S onto that aim.
 *
 * The spot a facet paints is ~ LED size * (target distance / facet distance) — fixed by geometry, not
 * by the facet curvature.  Aims are therefore distributed over the painting with a density proportional
 * to the paint value, so overlapping spots reproduce the paint convolved with that unavoidable kernel.
 * A light unsharp-mask on the aim density, a small inward inset of the aim field and a deterministic
 * stratification keep edges crisp and local brightness even.
 */
(function () {
  'use strict';
  const RF = globalThis.RF;
  const V = RF.V;

  function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // smallest side of the LED (the source-image scale)
  function ledSize(src) {
    let s;
    if (src.kind === 'planar') s = src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h);
    else if (src.shape === 'cylinder') s = Math.min(2 * src.radius, src.length);
    else s = 2 * src.radius;
    return isFinite(s) && s > 0 ? s : 2;
  }

  const STATIC_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'facetSize', label: 'Facet width (mm)', type: 'range', min: 2, max: 12, step: 0.5, default: 6 },
    { key: 'aimInset', label: 'Aim field inset', type: 'range', min: 0.7, max: 1, step: 0.01, default: 0.92 },
    { key: 'sharpness', label: 'Aim sharpen', type: 'range', min: 0, max: 1.5, step: 0.05, default: 0.8 },
    { key: 'fill', label: 'Facet packing', type: 'range', min: 0.6, max: 0.98, step: 0.01, default: 0.88 },
  ];

  // The static algorithm: everything below is pure geometry, no rays are traced.
  function build(input, settings) {
    const S = input.source.pos, env = input.envelope, T = RF.Engine.targetFrame(input.target);
    const R = input.paint.res, paint = input.paint.cells, cw = 2 * T.half / R;
    const Zc = [T.C[0], T.C[1], T.C[2]];
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const a0 = Math.max(1, (settings.facetSize || 6) / 2);
    const notes = [];
    const fr = RF.Source.frame(input.source);
    const thetaMax = RF.Source.thetaMax(input.source), cosCap = Math.cos(thetaMax);

    let maxP = 0, painting = false;
    for (let k = 0; k < paint.length; k++) { const w = paint[k] || 0; if (w > maxP) maxP = w; if (w > 0) painting = true; }
    if (!painting) return { surfaces: [], intent: [], notes: ['nothing painted'] };

    // ---- candidate directions over the emitted cone (uniform in solid angle)
    const NC = 5000, cand = [];
    let rMax = 0;
    for (let i = 1; i <= NC; i++) {
      const cz = clamp(cosCap + (1 - cosCap) * halton(i, 2), -1, 1);
      const st = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = 2 * Math.PI * halton(i, 3);
      const d = V.add(V.add(V.mul(fr.u, st * Math.cos(ph)), V.mul(fr.v, st * Math.sin(ph))), V.mul(fr.a, cz));
      const to = RF.Geo.envInterval(env, S, d)[1];
      if (!(to > 0) || !isFinite(to)) continue;
      if (to > rMax) rMax = to;
      cand.push({ d, to });
    }
    if (!(rMax > 0)) { rMax = 10; cand.push({ d: fr.a.slice(), to: 10 }); }

    const inset = a0 * 1.7 + 0.9, pitch = 2 * a0 * clamp(settings.fill || 0.88, 0.4, 0.99);
    const rFloor = keep + a0 * 1.55 + 0.3;
    const tol = -2e-3;

    const approxNormal = (P) => V.norm(V.add(V.norm(V.sub(S, P)), V.norm(V.sub(Zc, P))));
    function cornersOf(P, n, a) {
      const ex = V.inPlane(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]), ey = V.cross(n, ex);
      return { ex, ey, pts: [[-a, -a], [a, -a], [a, a], [-a, a], [0, 0], [0, a], [0, -a], [a, 0], [-a, 0]].map(([x, y]) => V.add(P, V.add(V.mul(ex, x), V.mul(ey, y)))) };
    }
    function patchInside(P, n, a) { for (const q of cornersOf(P, n, a).pts) if (!RF.Geo.envInside(env, q, tol)) return false; return true; }

    // ---- choose the shell: an ellipsoid of foci S, Zc with back radius rb
    const D = Math.max(1e-6, V.dist(Zc, S)), toDir = V.norm(V.sub(Zc, S));
    const rDesired = Math.max(1, ledSize(input.source)) * D / (3.5 * cw);   // distance for a ~3.5-cell spot
    let rb = Math.min(0.28 * rMax, rDesired / 2);
    rb = clamp(rb, Math.max(2, (keep + a0 * 1.55) / 2), 0.6 * rMax);

    const placeShell = (rbv) => {
      const L0 = 2 * rbv + D, L0s = L0 * L0 - D * D, out = [];
      for (const c of cand) {
        if (out.length >= maxF) break;
        const ca = V.dot(c.d, toDir);
        const rE = L0s / (2 * (L0 - D * ca));
        const r = Math.min(rE, c.to - inset);
        if (!(r >= Math.max(rFloor, 0.65 * rE))) continue;
        const P = V.add(S, V.mul(c.d, r));
        if (!patchInside(P, approxNormal(P), a0)) continue;
        let ok = true;
        for (const q of out) if (V.dist(q.P, P) < pitch) { ok = false; break; }
        if (!ok) continue;
        out.push({ P, r });
      }
      return out;
    };
    // stay close to the tuned shell radius, but step aside if it cannot host enough facets
    const factors = [1, 0.8, 1.2, 0.65, 1.5, 2.0, 0.5];
    let chosen = [];
    for (const f of factors) {
      const rbv = clamp(rb * f, Math.max(2, (keep + a0 * 1.55) / 2), 0.62 * rMax);
      chosen = placeShell(rbv);
      if (chosen.length >= Math.max(1, Math.ceil(0.9 * maxF))) { rb = rbv; break; }
      if (chosen.length > 0 && f === factors[factors.length - 1]) rb = rbv;
    }
    chosen = chosen.slice(0, maxF);
    const M = chosen.length;
    notes.push('reach ' + rMax.toFixed(0) + ' mm, shell rb ' + rb.toFixed(1) + ' mm, ' + M + ' facets');
    if (!M) return { surfaces: [], intent: [], notes };

    // ---- aim density: paint, gently unsharp-masked by the spot width
    let rMed = chosen.map((c) => c.r).sort((a, b) => a - b)[M >> 1] || rMax;
    let wCells = clamp(2 * D / (rMed * cw), 0.6, 40);
    const blur = RF.Photometry.boxBlur(paint, R, wCells);
    const sh = clamp(settings.sharpness === undefined ? 0.8 : settings.sharpness, 0, 2);
    const density = paint.map((p, k) => (p > 0 ? Math.max(1e-9, p + sh * (p - blur[k])) : 0));

    // ---- stratified aim sampling: counts proportional to paint mass, even in 2-D
    const K = clamp(Math.round(3.6 * Math.sqrt(M)), 6, 48);
    const W = new Array(K * K).fill(0), members = new Array(K * K);
    for (let s = 0; s < K * K; s++) members[s] = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = density[j * R + i]; if (!(w > 0)) continue;
      const si = Math.min(K - 1, Math.floor(i * K / R)), sj = Math.min(K - 1, Math.floor(j * K / R));
      W[sj * K + si] += w; members[sj * K + si].push([i, j, w]);
    }
    const Wtot = W.reduce((s, x) => s + x, 0);
    if (!(Wtot > 0)) return { surfaces: [], intent: [], notes: notes.concat('aim density empty') };
    const cum = []; let acc = 0; for (let s = 0; s < K * K; s++) { acc += W[s]; cum.push(acc); }
    const insetA = clamp(settings.aimInset === undefined ? 0.92 : settings.aimInset, 0.5, 1);
    const seed = (input.seed | 0) || 1;
    const aims = [];
    for (let q = 0; q < M; q++) {
      const t = ((q + 0.5 + 0.6 * (halton(q + 1 + seed, 11) - 0.5)) / M) * Wtot;
      let lo = 0, hi = K * K - 1;
      while (lo < hi) { const md = (lo + hi) >> 1; if (cum[md] < t) lo = md + 1; else hi = md; }
      let s = lo;
      if (!members[s].length) {
        let a = s, b = s;
        while (a > 0 && !members[a].length) a--;
        while (b < K * K - 1 && !members[b].length) b++;
        s = members[a].length ? a : b;
      }
      const list = members[s], cdf = []; let a2 = 0;
      for (const m of list) { a2 += m[2]; cdf.push(a2); }
      const tq = halton(q + 1 + seed, 13) * a2;
      let li = 0, hi2 = cdf.length - 1;
      while (li < hi2) { const md = (li + hi2) >> 1; if (cdf[md] < tq) li = md + 1; else hi2 = md; }
      const m = list[li];
      const uu = insetA * (-T.half + (m[0] + 0.15 + 0.7 * halton(q + 1 + seed, 2)) * cw);
      const vv = insetA * (-T.half + (m[1] + 0.15 + 0.7 * halton(q + 1 + seed, 3)) * cw);
      aims.push([uu, vv]);
    }

    // ---- deterministic pairing (shuffle aims among facets so facet flux is not correlated with aim)
    const perm = [];
    for (let i = 0; i < M; i++) perm.push(i);
    let st = (seed * 2654435761) | 0;
    const rnd = () => { st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = M - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp; }

    // ---- build facets
    const surfaces = [], intent = [];
    for (let f = 0; f < M; f++) {
      const P = chosen[perm[f]].P, aim = aims[f];
      const Z = RF.Engine.targetUVtoWorld(T, aim[0], aim[1]);
      const di = V.dist(P, Z);
      if (!(di > 0)) continue;
      const n = V.norm(V.add(V.norm(V.sub(S, P)), V.norm(V.sub(Z, P))));
      let a = a0, cc = cornersOf(P, n, a);
      for (let t = 0; t < 10 && !patchInside(P, n, a); t++) { a *= 0.9; cc = cornersOf(P, n, a); }
      if (a < a0 * 0.35) continue;                       // a sliver: not worth a facet
      const pts3 = [[-a, -a], [a, -a], [a, a], [-a, a]].map(([x, y]) => V.add(P, V.add(V.mul(cc.ex, x), V.mul(cc.ey, y))));
      const id = 'F' + f;
      surfaces.push({ type: 'facet', id, P, S0: S, Z, di, flat: false, clip: { kind: 'poly', pts3, ref: cc.ex },
        optics: { interaction: 'reflect', reflectivity: input.limits.reflectivity, twoSided: false } });
      const ii = clamp(Math.floor((aim[0] + T.half) / cw), 0, R - 1), jj = clamp(Math.floor((aim[1] + T.half) / cw), 0, R - 1);
      intent.push({ facet: id, cells: [[jj * R + ii, 1]] });
    }
    return { surfaces, intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-particle1-r2--facet-sheet', name: 'Facet sheet (static)', version: '1.0', modes: ['paint'],
    settings: STATIC_SETTINGS,
    solve: build,
  });

  /* Optional tuner: same static geometry, but it traces a few candidate settings and keeps the best for
   * the chosen goal.  All candidates are traced with the SAME seed, so differences are geometry, not dice.
   * It never changes the user's limits: candidates only vary the static solver's own knobs. */
  RF.Solvers.register({
    id: 'bench-particle1-r2--facet-sheet-auto', name: 'Facet sheet (auto-tuned)', version: '1.0', modes: ['paint'],
    settings: STATIC_SETTINGS.concat([
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful',
        options: [{ value: 'faithful', label: 'Faithful (match the paint)' }, { value: 'throw', label: 'Throw (peak intensity)' }, { value: 'efficient', label: 'Efficient (light per facet)' }] },
      { key: 'effort', label: 'Candidates', type: 'range', min: 3, max: 9, step: 1, default: 6 },
    ]),
    solve(input, settings, tools) {
      const base = {};
      for (const f of STATIC_SETTINGS) base[f.key] = settings[f.key] !== undefined ? settings[f.key] : f.default;
      // a deterministic ladder of candidates around the tuned defaults
      const variants = [
        {},
        { facetSize: 5 },
        { facetSize: 7.5 },
        { aimInset: 0.86 },
        { aimInset: 0.98 },
        { sharpness: 0.35 },
        { sharpness: 1.25 },
        { fill: 0.76 },
        { fill: 0.95 },
      ].slice(0, Math.max(1, Math.min(variants_count(settings), 9)));
      const cands = variants.map((v) => Object.assign({}, base, v));
      const canTrace = tools && typeof tools.trace === 'function';
      if (!canTrace) return build(input, base);

      const budgetRays = tools.budget && isFinite(tools.budget.rays) ? tools.budget.rays : 5e7;
      const rays = Math.max(20000, Math.min(100000, Math.floor(budgetRays / (cands.length + 2))));
      const seed = input.seed | 0;
      const rows = [];
      for (let i = 0; i < cands.length; i++) {
        let out;
        try { out = build(input, cands[i]); } catch (e) { continue; }
        if (!out.surfaces.length) continue;
        let tr;
        try { tr = tools.trace(out.surfaces, { rays, seed }); } catch (e) { continue; }
        const fd = tr && tr.fidelity;
        if (!fd) continue;
        rows.push({ out, cand: cands[i], fid: fd.fidelity, within: fd.within, gaps: fd.gapsDark,
          onPaint: fd.onPaint, peak: tr.peakCd || 0 });
      }
      if (!rows.length) return build(input, base);
      let bestFid = 0;
      for (const r of rows) if (r.fid > bestFid) bestFid = r.fid;
      const goal = settings.goal || 'faithful';
      let pick = rows[0], best = -Infinity;
      for (const r of rows) {
        // don't trade away a good beam for a metric
        const keep = r.fid >= 0.85 * bestFid;
        let sc;
        if (goal === 'throw') sc = keep ? r.peak : -Infinity;
        else if (goal === 'efficient') sc = keep ? r.onPaint : -Infinity;
        else sc = r.fid;
        if (sc > best + 1e-15) { best = sc; pick = r; }
      }
      const note = 'auto: goal ' + goal + ' picked ' + JSON.stringify({
        facetSize: pick.cand.facetSize, aimInset: pick.cand.aimInset, sharpness: pick.cand.sharpness, fill: pick.cand.fill }) +
        ' (fid ' + (pick.fid * 100).toFixed(1) + '%, onPaint ' + (pick.onPaint * 100).toFixed(1) + '%)';
      return { surfaces: pick.out.surfaces, intent: pick.out.intent, notes: (pick.out.notes || []).concat(note) };
    },
  });

  function variants_count(settings) { const e = settings && settings.effort; return isFinite(e) ? Math.round(e) : 6; }
})();
