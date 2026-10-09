/* main.js (projector-liou: the SCREENLESS branch of projector-v3) — the solver: spec → ideal beam → candidate lens/focus layouts → cells over the whole emission sphere → aims → facets + shield + lens → model verdict → best layout. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, D2R = Math.PI / 180;
  const SETTINGS = [
    { key: 'effort', label: 'Effort: quick (one lens, one path length, model only) · normal (lens + path search, engine check of the best three) · thorough (wider search)', type: 'select', options: [{ value: 'quick', label: 'quick' }, { value: 'normal', label: 'normal' }, { value: 'thorough', label: 'thorough' }], default: 'normal' },
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused (the depth map picks distances)' },
    { key: 'lensShape', label: 'Lens: auto (the best traced design wins) · flat-in (flat face toward the reflector, convex conic out: the production projector lens) · curve-in (conic toward the reflector, exact on axis) · biconvex', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'flat-in', label: 'flat side to the reflector' }, { value: 'curve-in', label: 'curved side to the reflector (stigmatic)' }, { value: 'biconvex', label: 'biconvex' }], default: 'flat-in', adv: true },
    { key: 'ior', label: 'Lens index (1.49 acrylic, 1.59 polycarbonate)', type: 'number', min: 1.3, max: 2, step: 0.01, default: 1.59, adv: true },
    { key: 'facets', label: 'Facets to use (0 = the whole budget, at most 300)', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'surface', label: 'Reflector: stepped facets (each facet its own focus point and aim, on one base cup) · continuous (Liou: smooth fields over a regular mesh, fitted to the stepped design)', type: 'select', options: [{ value: 'stepped', label: 'stepped facets' }, { value: 'continuous', label: 'continuous (Liou)' }], default: 'stepped' },
    { key: 'contV', label: 'Continuous: vertical aims — snap (Liou: each patch as high as it can go without leaking, smoothed) or fit (follow the stepped design)', type: 'select', options: [{ value: 'snap', label: 'snap (Liou)' }, { value: 'fit', label: 'fit the stepped design' }], default: 'snap', adv: true },
    { key: 'contRings', label: 'Continuous: rings from rim to vertex', type: 'number', min: 2, max: 20, step: 1, default: 6, adv: true },
    { key: 'contSectors', label: 'Continuous: sectors around the axis', type: 'number', min: 4, max: 64, step: 1, default: 24, adv: true },
    { key: 'contM', label: 'Continuous: Fourier order around the axis (smoothness: lower = smoother)', type: 'number', min: 0, max: 8, step: 1, default: 4, adv: true },
    { key: 'contN', label: 'Continuous: polynomial order rim → vertex (0–2)', type: 'number', min: 0, max: 2, step: 1, default: 2, adv: true },
    { key: 'shield', label: 'Shield: off (screenless: every facet image is placed under the cut-off, Liou 2009) · cleanup (the same placement + a shield on that line that trims the tails and the direct light; raise the leak share to trade shield loss for candela at the line) · auto (v3: images centred under the line, the shield cuts them)', type: 'select', options: [{ value: 'off', label: 'off (screenless)' }, { value: 'cleanup', label: 'cleanup' }, { value: 'auto', label: 'auto (v3)' }], default: 'off' },
    { key: 'slitDeg', label: 'Shield windows for the sign points: half-size in degrees (0 = none); the beam\'s own tails reach the points through them', type: 'number', min: 0, max: 3, step: 0.1, default: 0.6, adv: true },
    { key: 'slitSize', label: 'Shield windows: fixed (the half-size above) · model (the model shrinks each window to a candela goal; unreliable) · perforate (the engine sets each window\'s open share: vertical slits, so the patch keeps its size and only dims)', type: 'select', options: [{ value: 'fixed', label: 'fixed' }, { value: 'auto', label: 'model' }, { value: 'perforate', label: 'perforate (engine)' }], default: 'perforate', adv: true },
    { key: 'perfPitch', label: 'Perforated window slit pitch (mm)', type: 'number', min: 0.02, max: 0.5, step: 0.01, default: 0.1, hidden: true },
    { key: 'perfForce', label: 'Keep the perforated windows even when the engine verdict does not improve (bench)', type: 'checkbox', default: false, hidden: true },
    { key: 'perfPhi0', label: 'Perforated windows: starting open share (the engine corrects it in two rounds)', type: 'number', min: 0.02, max: 1, step: 0.01, default: 0.25, hidden: true },
    { key: 'perfRays', label: 'Rays per engine trace when sizing perforated windows', type: 'number', min: 5e5, max: 2e7, step: 5e5, default: 3e6, hidden: true },
    { key: 'wallHug', label: 'Let a cell sit on the envelope wall instead of the base ellipsoid (v3 behaviour; off = one continuous base cup, no shrunken facets)', type: 'checkbox', default: false, hidden: true },
    { key: 'overlap', label: 'Facet overlap: each lens-path facet grows this much past its cell (1 = exact cells; > 1 closes the slits an extended emitter sees between stepped neighbours)', type: 'number', min: 1, max: 2, step: 0.05, default: 1, adv: true },
    { key: 'edgeSharp', label: 'Edge pass: facets whose sharpest image is at most this tall (rms °) are placed first, scored on the band under the line (0 = off)', type: 'number', min: 0, max: 5, step: 0.1, default: 1.5, adv: true },
    { key: 'edgeBand', label: 'Edge pass: height of the band under the line (°)', type: 'number', min: 0.3, max: 5, step: 0.1, default: 1.5, adv: true },
    { key: 'leak', label: 'Screenless: share of a facet\'s light that may land above the cut-off line', type: 'number', min: 0, max: 0.5, step: 0.005, default: 0.01 },
    { key: 'edgeMargin', label: 'Screenless: images sit this far below the cut-off line (°)', type: 'number', min: -1, max: 2, step: 0.05, default: 0, adv: true },
    { key: 'refine', label: 'Screenless: rounds of re-tracing each placed facet at its real aim and sliding it under the line (0 = trust the nominal footprints)', type: 'number', min: 0, max: 6, step: 1, default: 3, adv: true },
    { key: 'cap', label: 'Direct-light cap: a small absorbing disc ahead of the emitter that hides the lens from it (direct light leaves the lens far out of focus, above the cut-off too)', type: 'select', options: [{ value: 'off', label: 'off' }, { value: 'bulb', label: 'the bulb’s own (H1 cap, H7/H11 black top, from the preset)' }, { value: 'on', label: 'on (sized to hide the lens)' }], default: 'bulb' },
    { key: 'capGap', label: 'Cap distance ahead of the emitter front (mm): farther = a bigger disc that hides a narrower cone of the emitter', type: 'number', min: 1, max: 60, step: 1, default: 10, adv: true },
    { key: 'barrel', label: 'Lens holder: an absorbing tube from the bowl to the lens (light that misses the lens is stopped, as in every real projector module)', type: 'checkbox', default: true, adv: true },
    { key: 'along', label: 'First-focus points per side along each emitter axis (Liou\'s moving focus: 1 = the ends only)', type: 'number', min: 1, max: 6, step: 1, default: 3, adv: true },
    { key: 'pathScan', label: 'Base ellipsoid path length, mm beyond the focus distance (Sonnet\'s v4 bench: the lever; a list = try each)', type: 'select', options: ['effort', '16,24,32', '8,16,24,32,40', '16', '24', '32', 'proxy'].map((v) => ({ value: v, label: v === 'proxy' ? 'v3 proxy picks' : v === 'effort' ? 'from Effort' : v })), default: 'effort', adv: true },
    { key: 'fillLens', label: 'Lens fills the envelope (the largest aperture that fits)', type: 'checkbox', default: true, adv: true },
    { key: 'screenlessEff', label: 'Share of the lens-path flux the ideal beam may count on without a shield', type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.9, hidden: true },
    { key: 'shieldCurved', label: 'Curved shield (follows the field curvature)', type: 'checkbox', default: true, hidden: true },
    { key: 'shieldFold', label: 'Shield fold (mm, + = toward the lens, 0 = flat): below its edge the shield bends off the focal surface, so the sign-point windows sit out of focus and their light spreads; the edge stays sharp', type: 'number', min: -4, max: 4, step: 0.25, default: 0, adv: true },
    { key: 'foldSlope', label: 'Fold band slope (mm off focus per mm below the edge; above ~1 it clips the beam under the cut-off)', type: 'number', min: 0.1, max: 2, step: 0.05, default: 1, hidden: true },
    { key: 'shieldDefocus', label: 'Shield axial offset (mm, + = toward the lens, −1 = auto)', type: 'number', min: -1, max: 4, step: 0.05, default: -1, adv: true },
    { key: 'spread', label: 'Widest lens-path aim, ± degrees', type: 'number', min: 2, max: 40, step: 1, default: 25, adv: true },
    { key: 'edgeDrop', label: 'Image centres below the cut-off (°)', type: 'number', min: 0, max: 3, step: 0.05, default: 0.4, hidden: true },
    { key: 'depthPenalty', label: 'Depth-map stiffness (penalty for leaving the base path length)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.35, hidden: true },
    { key: 'fluxFrac', label: 'Share of the lens-path flux the ideal beam may ask for', type: 'number', min: 0.2, max: 1.2, step: 0.01, default: 0.85, adv: true },
    { key: 'focal', label: 'Lens focal length (mm, 0 = search; Effort sets the search)', type: 'number', min: 0, max: 150, step: 1, default: 0, adv: true },
    { key: 'aperture', label: 'Lens aperture radius (mm, 0 = search)', type: 'number', min: 0, max: 100, step: 0.5, default: 0, adv: true },
    { key: 'bypass', label: 'Lens-bypass facets (auto: facets beside the lens use the light the lens path cannot; off: a sealed projector, all light leaves through the lens)', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'off', label: 'off (sealed)' }], default: 'off', adv: true },
    { key: 'endFocus', label: 'Moving first focus (Liou 2009): a lens-path facet may take a point along the emitter (out to an end) as its first focus, so its image hangs on one side of its aim and can sit right under the cut-off', type: 'checkbox', default: true, adv: true },
    { key: 'bypassReach', label: 'Largest angle from the LED axis (°) at which lens-feasible light may be given to bypass facets instead (60 = only what the lens path cannot use; ~100 = the whole equator band goes to big far mirrors: sharper images, more lumens and peak, less of a projector)', type: 'number', min: 0, max: 180, step: 5, default: 60, adv: true },
    { key: 'reflector', label: 'Reflector: facets (aimed ellipsoid patches) or one continuous ellipsoid (the classic projector cup; a single facet of the budget)', type: 'select', options: [{ value: 'facets', label: 'facets' }, { value: 'ellipsoid', label: 'one continuous ellipsoid' }], default: 'facets', hidden: true },
    { key: 'shieldEff', label: 'Share of the lens-path flux that survives the shield (sizes the ideal beam)', type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.8, hidden: true },
    { key: 'lam', label: 'Placement waste penalty (0 = fill anywhere, 1 = never overshoot)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.5, hidden: true },
    { key: 'bypassMinEff', label: 'A bypass cell is dropped when less than this share of its light survives the lens/shield on a nominal aim', type: 'number', min: 0, max: 1, step: 0.05, default: 0.4, hidden: true },
    { key: 'polishRounds', label: 'Aim polish rounds (v3\'s polish; it does not know the screenless rule, so 0 = off by default)', type: 'number', min: 0, max: 10, step: 1, default: 0, hidden: true },
    { key: 'polishSweeps', label: 'Sweeps per polish round (each sweep tries four step sizes)', type: 'number', min: 1, max: 6, step: 1, default: 3, hidden: true },
    { key: 'wBand', label: 'Polish weight of floor / ceiling violations', type: 'number', min: 0, step: 10, default: 150, hidden: true },
    { key: 'wTrack', label: 'Polish weight of following the ideal beam', type: 'number', min: 0, step: 0.01, default: 0.03, hidden: true },
    { key: 'decalGain', label: 'Decal flux margin over a sign-point floor', type: 'number', min: 0.5, max: 6, step: 0.1, default: 1.5, hidden: true },
    { key: 'edgeTrust', label: 'How far (pixels of 0.1°) a facet that forms the cut-off edge may move in the polish', type: 'number', min: 0, max: 40, step: 1, default: 3, hidden: true },
    { key: 'edgeSearch', label: 'Search the shield edge height (left / right) against the model', type: 'checkbox', default: true, hidden: true },
    { key: 'finalists', label: 'Layouts that get the full treatment (edge search, polish)', type: 'number', min: 1, max: 6, step: 1, default: 3, hidden: true },
    { key: 'verify', label: 'Let the engine (one 1 M-ray spec trace each) pick between the two best layouts', type: 'checkbox', default: true, hidden: true },
    { key: 'keepTop', label: 'Layouts evaluated in full (the best by the cheap proxy)', type: 'number', min: 1, max: 40, step: 1, default: 6, hidden: true },
    { key: 'verbose', label: 'Log progress to the console', type: 'checkbox', default: false, hidden: true },
  ];

  function candidates(P, s) {
    const out = [], E = P.E, S0 = P.Lp, n = s.ior, shapes = s.lensShape === 'auto' ? ['flat-in', 'curve-in', 'biconvex'] : [s.lensShape === 'biconvex' ? 'biconvex' : s.lensShape];
    const fList = s.focal > 0 ? [s.focal] : s.focalList || [42, 54, 64, 74, 84], hEnv = Math.min((E.ymax - E.ymin) / 2, (E.zmax - E.zmin) / 2) - 0.8;
    const variants = [];
    for (const sh of shapes) {
      if (sh === 'flat-in') for (const k of [-0.5, -0.8])      // k −1.2 dropped: the model and the engine disagreed badly on it (10-08: model 3 fails, engine 8–14)
        variants.push({ kind: 'flat-in', k, beta: 0 });
      else if (sh === 'curve-in') variants.push({ kind: 'curve-in', k: -n * n, beta: 0 });
      else for (const k of [-1.6, -1]) variants.push({ kind: 'bi', k, beta: 0.7 });
    }
    const clampTo = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    for (const f of fList) for (const af of s.aperture > 0 ? [0] : s.fillLens ? [1] : [1, 0.75, 0.55]) {
      const a = s.aperture > 0 ? s.aperture : (s.fillLens ? hEnv : Math.min(0.9 * f, hEnv)) * af; if (a < 3) continue;
      // the lens axis: through the LED's height where the lens fits there, else as close as it fits; also the middle and both ends of the envelope's height (a box with the LED on the floor)
      const yA = clampTo(S0[1], E.ymin + a + 0.8, E.ymax - a - 0.8), zs = [clampTo(S0[2], E.zmin + a + 0.8, E.zmax - a - 0.8), E.zmin + a + 0.8, (E.zmin + E.zmax) / 2, E.zmax - a - 0.8].filter((z, k, arr) => arr.findIndex((q) => Math.abs(q - z) < 0.5) === k);
      for (const v of variants) for (const back of [0, 6]) for (const zA of zs) out.push(Object.assign({ n, f, a, back, yA, zA }, v));
    }
    return out;
  }
  const lensMerit = (L) => { let sum = 0, w = 0; for (let i = 0; i <= 8; i++) { const m = L.map[i]; sum += m ? Math.min(m.blur, 8) + 8 * (1 - m.pass) : 8; w++; } return sum / w; };

  async function solve(input, s0, tools) {
    if (!input.spec) return { surfaces: [], notes: ['projector-liou designs from a beam specification: switch to Spec mode (paint mode is not built yet; Fill & fix, SQM or Auto handle paint).'] };
    const S = Object.assign({}, P3.DEFAULTS, s0), notes = [], P = P3.problem(input, S, tools); const s = Object.assign({ depthPenalty: 0.35 }, s0);
    // Effort sets the search size (keepTop, finalists, engine check, path lengths, focal list); the hidden knobs stay overridable from the bench
    const EFF = { quick: { keepTop: 2, finalists: 1, verify: false, paths: '24', focals: [54] }, normal: { keepTop: 6, finalists: 3, verify: true, paths: '16,24,32' }, thorough: { keepTop: 12, finalists: 4, verify: true, paths: '8,16,24,32,40' } }[s.effort] || null;
    if (EFF) { s.keepTop = EFF.keepTop; s.finalists = EFF.finalists; s.verify = EFF.verify; if (s.pathScan === 'effort') s.pathScan = EFF.paths; s.focalList = EFF.focals || null; }
    else if (s.pathScan === 'effort') s.pathScan = '16,24,32';
    const budgetMs = tools && tools.budget && isFinite(tools.budget.ms) && tools.budget.ms > 0 ? tools.budget.ms : 120000, el = () => Date.now() - P.t0;      // the host's solve time limit; what is not finished by then is lost
    const Kmax = Math.min(P.maxF, s.facets > 0 ? s.facets : 300);
    const D = P3.dirs(P, S.nDirs); P.lap(`directions: ${D.n}, ${D.tot.toFixed(0)} lm`);
    // 1. layouts by the cheap proxy
    const cands = candidates(P, s), lays = [];
    const offs = String(s.pathScan || '').split(',').map(Number).filter((x) => x > 0);
    for (const c of cands) { const lay0 = P3.placeLens(P, c); if (!lay0) continue; const pk = P3.pickLb(P, lay0, D, s);
      for (const x of offs.length ? offs : [null]) { const lay = Object.assign({}, lay0, { Lb: x ? lay0.D + x : pk.Lb, pathX: x }); lay.proxy = pk.proxy / (1 + lensMerit(lay.L) / 3); lays.push(lay); } }
    lays.sort((a, b) => b.proxy - a.proxy); P.lap(`layouts: ${lays.length} of ${cands.length}` + (S.verbose ? '; rejected: ' + Object.entries(P.why || {}).map(([k, v]) => k + ' ×' + v).join(', ') : ''));
    if (S.verbose) for (const l of lays.slice(0, 40)) P.lap(`  proxy ${l.proxy.toFixed(3)} ${l.c.kind} k ${l.c.k.toFixed(2)} f ${l.f} a ${l.a.toFixed(1)} back ${l.c.back} D ${l.D.toFixed(0)} tanMax ${l.tanMax.toFixed(2)} merit ${lensMerit(l.L).toFixed(2)}`);
    // diversify: the best layout of each focal length first (the proxy likes long focal lengths; the model decides), then the rest by proxy
    const seen = new Set(), pick = []; for (const l of lays) { const key = l.f + '|' + l.pathX; if (!seen.has(key)) { seen.add(key); pick.push(l); } } for (const l of lays) if (!pick.includes(l)) pick.push(l);
    if (!lays.length) return { surfaces: [], notes: ['projector-liou: no lens layout fits this envelope / LED position (' + Object.entries(P.why || {}).map(([k, v]) => k + ' ×' + v).join(', ') + ')'] };
    // 2. full designs for the best few
    const results = [];
    let slowest = 0;
    for (const lay of pick.slice(0, s.keepTop)) {
      if (results.length && el() + 1.3 * slowest > 0.4 * budgetMs) { notes.push(`time governor: ${results.length} of ${Math.min(pick.length, s.keepTop)} layouts evaluated`); break; }
      const t1 = el(), r = design(P, lay, D, s, Kmax); slowest = Math.max(slowest, el() - t1); if (!r) continue; results.push(r);
      if (results.length === 1 && tools && tools.preview) tools.preview(r.surfaces, { label: 'first draft', needs: { bounces: 3 } });      // display only
      P.lap(`  ${lay.c.kind} k ${lay.c.k.toFixed(2)} f ${lay.f} a ${lay.a.toFixed(1)} back ${lay.c.back}: proxy ${lay.proxy.toFixed(3)} → model ${r.m.hard} fails, ${r.m.lm.toFixed(0)} lm, score ${r.m.score.toFixed(1)}, ${r.nL}+${r.nD} facets`);
    }
    if (!results.length) return { surfaces: [], notes: ['projector-liou: no layout produced a design'] };
    results.sort((a, b) => b.m.score - a.m.score);
    const fin = []; let slowF = 0; for (const r of results.slice(0, s.finalists)) { if (fin.length && el() + 1.3 * slowF > 0.8 * budgetMs) { notes.push(`time governor: ${fin.length} finalist(s)`); break; } const tF = el(), rf = design(P, r.lay, D, s, Kmax, true); slowF = Math.max(slowF, el() - tF); if (rf) { fin.push(rf); P.lap(`  FINAL ${r.lay.c.kind} k ${r.lay.c.k.toFixed(2)} f ${r.lay.f} a ${r.lay.a.toFixed(1)}: model ${rf.m.hard} fails, ${rf.m.lm.toFixed(0)} lm, score ${rf.m.score.toFixed(1)}`); } }
    for (const r of fin) results.unshift(r); results.sort((a, b) => b.m.score - a.m.score);
    // the model does not see direct / stray light: the engine picks among the best finalists (one guided 2 M-ray spec trace each, ~6 s).
    // Order (Anya 10-09): expected fails (Σ P(fail), ties within 0.5) → road reach √(farL·farR) (5 lx, farthest point; ties
    // within 5 %: balance beats one long side) → lumens in the window. Judged before window sizing: the windows are a compliance fix.
    if (s.verify && tools && typeof tools.trace === 'function' && fin.length >= 1 && results.length > 1 && el() < 0.8 * budgetMs) {
      const top = results.slice(0, 3);      // three, not two: the two best were often the same lens
      for (const r of top) { try { const t = await tools.trace(r.surfaces, { rays: 2e6, spec: true, road: true, bounces: 3, seed: 11 }); r.tr = t && t.spec ? Object.assign({}, t.spec, { road: t.road || null, lm: t.spec.lmWindow }) : null; } catch (e) { r.tr = null; } }
      if (top.every((r) => r.tr)) {
        const ef = (t) => isFinite(t.expFails) ? t.expFails : t.n.fail, reach = (t) => t.road ? Math.sqrt(t.road.farLeft * t.road.farRight) : 0, lm = (t) => t.lm || 0;
        const cmp = (a, b) => { const x = a.tr, y = b.tr;
          if (Math.abs(ef(x) - ef(y)) > 0.5) return ef(x) - ef(y);
          const rx = reach(x), ry = reach(y); if (Math.abs(rx - ry) > 0.05 * Math.max(rx, ry)) return ry - rx;
          return lm(y) - lm(x); };
        top.sort(cmp); results.splice(results.indexOf(top[0]), 1); results.unshift(top[0]);
        notes.push('engine pick of the best three (2 M rays; expected fails → reach √(L·R) → lumens): ' + top.map((r) => { const t = r.tr, rd = t.road;
          return `f ${r.lay.f} → ${ef(t).toFixed(2)} exp. fails (${t.n.fail} fail / ${t.n.unsure} unsure), reach ${rd ? `R ${rd.farRight} / L ${rd.farLeft} m (IIHS ${rd.right} / ${rd.left})` : '?'}, ${lm(t).toFixed(0)} lm`; }).join('; '));
      }
    }
    const best = results[0], lay = best.lay;
    // perforated windows sized by the ENGINE (s.slitSize 'perforate'): window light is linear in its open share phi and each window lands on its own sign point,
    // so two traces (all open / all shut, same rays) give each window's own contribution at its point: phi = min(1, goal / contribution, room under any zone
    // maximum the point sits in / its patch peak); a third trace checks it, kept only if the engine verdict improves.  goal = 2 × the point's share of its minimum.
    if (s.slitSize === 'perforate' && best.shield && best.shield.holes && best.shield.holes.length && tools && typeof tools.trace === 'function') {
      const sh0 = best.shield, zones = P.spec.items.filter((x) => x.kind === 'zone' && x.max > 0), N = s.perfRays > 0 ? s.perfRays : 3e6;
      const goalOf = (hl) => 2 * hl.it.min / (hl.it.kind === 'sum' ? hl.it.pts.length : 1);
      const capOf = (hl) => { const w = s.slitDeg; let c = Infinity; for (const z of zones) if ([[0, 0], [-w, -w], [w, -w], [-w, w], [w, w]].some(([a, b]) => RF.Spec.inPoly(z.poly, hl.pt[0] + a, hl.pt[1] + b))) c = Math.min(c, 0.6 * z.max); return c; };      // the window's patch, not only its point
      const probe = sh0.holes.map((hl) => [hl.pt[0], hl.pt[1], 0.6]);
      const run = async (phis, frozen) => { const sh = Object.assign({}, sh0, { holes: sh0.holes.map((h, i) => Object.assign({}, h, { phi: phis[i] })) }); let t = null; try { t = await tools.trace(P3.surfacesOf(P, best.lay, sh, best.facets, s), { rays: N, spec: true, bounces: 3, seed: 11, probe, frozen }); } catch (e) { t = null; } return { sh, t: t && t.spec }; };
      const rank = (t) => [t.n.fail, t.n.unsure, -t.score], better = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
      // start every window at phi0 (Anya: a default open share, measured near where it will end up — fully open windows move the judge's aim); shut at that
      // aim; per-unit-phi contribution c; phi1 from c; a second round re-reads each window at phi1 (same aim) and corrects; the free-aim trace of phi2 decides.
      const phi0 = s.perfPhi0 > 0 ? s.perfPhi0 : 0.25, nH = sh0.holes.length;
      const open = await run(sh0.holes.map(() => phi0)), F = open.t && open.t.frozen, shut = F ? await run(sh0.holes.map(() => 0), F) : { t: null };
      if (open.t && shut.t && open.t.probe && shut.t.probe) {
        const size = (cur, rd) => sh0.holes.map((hl, i) => {
          const ps = shut.t.probe[i], c = cur[i] > 0.01 ? (rd.probe[i].cd - ps.cd) / cur[i] : 0, nat = Math.max(0, ps.cd), need = goalOf(hl) - nat, room = capOf(hl) - nat;
          if (!(c > 0)) return cur[i];      // no measurable light through it (shot noise): leave it — opening it blind put 8R 4U's patch into Zone III
          return Math.max(0, Math.min(1, Math.max(0, need) / c, isFinite(room) ? Math.max(0, room) / c : 1));
        });
        const phi1 = size(sh0.holes.map(() => phi0), open.t), r1 = await run(phi1, F), phis = r1.t && r1.t.probe ? size(phi1, r1.t) : phi1;
        const fin2 = await run(phis), keep = fin2.t && (s.perfForce || better(fin2.t, open.t)), bad = (t) => t ? t.rows.filter((r) => r.verdict !== 'pass').map((r) => `${r.name} ${(+r.value).toPrecision(3)}`).join(', ') : '?';
        notes.push(`perforated windows (engine, ${(N / 1e6).toFixed(0)} M rays, φ0 ${phi0}, aims ${[open, shut, r1, fin2].map((r) => r.t ? '[' + r.t.shift.map((x) => x.toFixed(2)) + ']' : '?').join(' ')}): ` + sh0.holes.map((hl, i) => `${hl.pt[0]}/${hl.pt[1]} φ ${phi1[i].toFixed(2)}→${phis[i].toFixed(2)}`).join(', ') +
          ` · φ0 ${open.t.n.fail}f/${open.t.n.unsure}u → sized ${fin2.t ? fin2.t.n.fail + 'f/' + fin2.t.n.unsure + 'u' : '?'}` + (keep ? ' (kept)' : ' (not better: φ0 kept)') + ` | φ0: ${bad(open.t)} | sized: ${bad(fin2.t)}`);
        const use = keep ? fin2.sh : open.sh; best.shield = use; best.surfaces = P3.surfacesOf(P, best.lay, use, best.facets, s);
      }
    }
    for (const r of results.slice(0, 5)) notes.push(`candidate ${r.lay.c.kind} k ${r.lay.c.k.toFixed(2)} f ${r.lay.f} Ø${(2 * r.lay.a).toFixed(0)}: model ${r.m.hard} fail / ${r.m.ev.n.unsure} unsure, ${r.m.lm.toFixed(0)} lm, ${r.facets.length} facets`);
    notes.push(`chosen: lens ${lay.c.kind} k ${lay.c.k.toFixed(2)} f ${lay.f} mm Ø${(2 * lay.a).toFixed(1)} t ${lay.L.t.toFixed(1)}, focus ${lay.D.toFixed(0)} mm ahead of the LED, base path +${(lay.Lb - lay.D).toFixed(0)} mm; ${best.leakNote || ''} ${best.nL} lens-path (${best.nEnd || 0} on an emitter end) + ${best.nD} bypass facets (${best.nDecal} decals) at ${best.depthRange}; ideal beam asks ${best.des.flux.toFixed(0)} lm (lens path can give ${best.availL.toFixed(0)}, bypass ${best.availD.toFixed(0)})`);
    notes.push('model loss ledger (lm leaving the facets): ' + Object.entries(best.stats).map(([k, v]) => k + ' ' + v.toFixed(0)).join(', '));
    notes.push(`model verdict: ${best.m.ev.verdict} ${JSON.stringify(best.m.ev.n)}, ${best.m.lm.toFixed(0)} lm in window (reflections only; direct and stray light are not in the model)`);
    return { surfaces: best.surfaces, notes, needs: { bounces: 3 + (s.fresnel ? 2 : 0) } };
  }

  // the reference rung: ONE ellipsoid of revolution as the whole reflector (patches on the same ellipsoid, aimed at the focus, stand in for it in the model)
  function designEllipsoid(P, lay, s, cells, full) {
    const cap = P3.ellipsoidCap(P, lay); if (!cap) return null;
    const rad = (X) => { const w = V.sub(X, cap.O), z = V.dot(w, cap.W); return Math.hypot(w[0] - z * cap.W[0], w[1] - z * cap.W[1], w[2] - z * cap.W[2]); };
    const facets = []; cells.forEach((c, k) => { if (rad(c.P) > cap.r1 * 0.995) return; const f = P3.facetOf(P, lay, c, lay.F, 'p3_f' + k); if (f) { f.cls = 'L'; facets.push(f); } });
    if (!facets.length) return null;
    let shield = P3.shieldFor(P, lay, s, 0), edge = { L: 0, R: 0 };
    const score = (sh) => { const m = P3.evaluate(P, lay, sh, facets, 16); return { m, sc: m.score }; };
    if (full && P.cut && s.shield !== 'off' && s.edgeSearch) {
      let bR = { v: 0, sc: score(shield).sc }; for (const dR of [0.15, 0.3, 0.5, 0.75, 1.0, -0.15]) { const r = score(P3.shieldFor(P, lay, s, { L: 0, R: dR })); if (r.sc > bR.sc) bR = { v: dR, sc: r.sc }; }
      let bL = { v: 0, sc: bR.sc }; for (const dL of [0.1, 0.2, 0.35, -0.1]) { const r = score(P3.shieldFor(P, lay, s, { L: dL, R: bR.v })); if (r.sc > bL.sc) bL = { v: dL, sc: r.sc }; }
      edge = { L: bL.v, R: bR.v }; shield = P3.shieldFor(P, lay, s, edge);
    }
    const stats = {}, m = P3.evaluate(P, lay, shield, facets, 24, stats);
    return { lay, facets, nL: 1, nD: 0, nDecal: 0, shield, des: { flux: 0 }, m, stats, availL: 0, availD: 0, surfaces: P3.surfacesOf(P, lay, shield, [cap.surface], s), depthRange: `one ellipsoid, path length ${cap.Lc.toFixed(0)} mm, rim radius ${cap.r1.toFixed(0)} mm (${facets.length} model patches)` };
  }

  // one full design for one layout
  function design(P, lay, D, s, Kmax, full) {
    const G = P.gridA, GB = P.gridB, top = P.cut ? P.cut.top : () => 5, clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    P.overlap = s.overlap;
    lay.cap = s.cap === 'on' ? P3.capFor(P, lay, s) : s.cap === 'bulb' ? P3.bulbCap(P) : null; lay.barrel = !!s.barrel;
    const okL = new Uint8Array(D.n); let fluxL = 0;
    const dkAll = s.bypass === 'off' || s.reflector === 'ellipsoid' || !(s.bypassReach > 60) ? null : P3.directOk(P, lay, D, s, null);      // directions that COULD go to a bypass facet
    for (let i = 0; i < D.n; i++) if (D.w[i] > 0 && D.rEnv[i] > P.keep + 1.5 && P3.depthChoice(P, lay, P3.dirAt(D, i), D.rEnv[i], null, lay.Lb, true, s)) {
      if (dkAll && dkAll.ok[i] && Math.acos(Math.max(-1, Math.min(1, D.u[3 * i]))) / D2R <= s.bypassReach) continue;      // reassigned to the bypass class
      okL[i] = 1; fluxL += D.w[i];
    }
    const dk = s.bypass === 'off' || s.reflector === 'ellipsoid' ? null : P3.directOk(P, lay, D, s, okL); let KD = 0, Kdec = 0;
    const seeds0 = []; if (dk && P.cut) for (const it of P.spec.items) { const pts = it.kind === 'point' ? [[it.h, it.v]] : it.kind === 'sum' ? it.pts : null; if (!pts || !(it.min > 0)) continue; for (const [h, v] of pts) if (v > top(h) + 0.3) seeds0.push(1); }
    if (dk && dk.flux > 0.03 * D.tot) { Kdec = Math.min(seeds0.length, Math.floor(Kmax * 0.15)); KD = clamp(Math.round((Kmax - Kdec) * dk.flux / (dk.flux + fluxL) * 0.5), 3, Math.floor(Kmax * 0.4)) + Kdec; }
    const cenL = P3.kmeansSphere(D, okL, Kmax - KD, 14, 2), cenD = KD ? P3.kmeansSphere(D, dk.ok, KD, 14, 2) : [];
    const cellsL = P3.makeCells(P, lay, D, okL, Kmax - KD, s, cenL, cenD), cellsD = KD ? P3.makeCellsDirect(P, lay, D, dk, KD, s, cenD, cenL) : [];
    if (P.S.verbose) { const bins = new Array(12).fill(0).map(() => [0, 0, 0]); for (let i = 0; i < D.n; i++) { const th = Math.acos(Math.max(-1, Math.min(1, D.u[3 * i]))) / D2R, b = Math.min(11, Math.floor(th / 15)); bins[b][okL[i] ? 0 : dk && dk.ok[i] ? 1 : 2] += D.w[i]; } P.lap('    flux by angle from the axis (15° bins), lens-path / bypass-eligible / unused lm: ' + bins.map((b, k) => `${k * 15}°:${b.map((x) => x.toFixed(0)).join('/')}`).join('  ')); }
    P.lap(`    lens-feasible ${fluxL.toFixed(0)} lm, bypass-eligible ${dk ? dk.flux.toFixed(0) : 0} lm → KD ${KD}; cells L ${cellsL.length} D ${cellsD.length}`);
    if (!cellsL.length) return null;
    // footprints at a nominal aim (translation-invariant shapes); lens-path ones unshielded (the shield is applied as a mask in the placement)
    const h0 = 0, v0 = top(0) - 3, I0 = P3.imgPoint(P, lay, h0, v0, 0), postL = P3.makePost({ cap: lay.cap, barrel: lay.barrel, lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: null });
    const shield0 = P3.shieldFor(P, lay, s), postFull0 = P3.makePost({ cap: lay.cap, barrel: lay.barrel, lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: shield0 });
    const cL = [], fpL = [], ends = s.endFocus ? P3.emitterPoints(P, s.along) : [], S0s = [null].concat(ends);       // alternatives per cell: the LED centre, then each emitter end
    for (const c of cellsL) {
      const alts = []; for (const S0 of S0s) { const f = P3.facetOf(P, lay, c, I0, 'tmp', S0); const fp = f ? P3.footOf(P, f, postL, G, 16) : null; alts.push(fp); }
      if (!alts[0]) continue; cL.push(c); fpL.push(alts.map((x, a) => (x ? Object.assign(x, { s0: S0s[a], alt: a }) : null)).filter(Boolean));
    }
    const cD = [], fpD = [];
    for (const c of cellsD) { const f = P3.facetDirect(P, lay, c, 0, -3, 'tmp'); if (!f) { P.lap('      bypass cell dropped: no polygon'); continue; } const fp = P3.footOf(P, f, postFull0, G, 16); if (!fp || fp.flux < s.bypassMinEff * P.refl * c.fit) { P.lap(`      bypass cell dropped: ${fp ? 'efficiency ' + (fp.flux / (P.refl * c.fit)).toFixed(2) : 'no footprint'}`); continue; } cD.push(c); fpD.push(fp); }
    if (!cL.length) return null;
    if (s.reflector === 'ellipsoid') return designEllipsoid(P, lay, s, cL, full);
    const availL = fpL.reduce((x, f) => x + f[0].flux, 0), availD = fpD.reduce((x, f) => x + f.flux, 0);
    const eff = s.shield === 'auto' ? s.shieldEff : s.screenlessEff, des = T.design({ spec: P.spec, g: P.g, B: P.B, fluxTarget: s.fluxFrac * (eff * availL + availD), peakCap: P.S.peakCap, washCap: P.S.washCap, gd: P.S.gd, guard: 0, guardLift: 0, cut: P.cut || null, road: { gamma: 0.8 } });
    // the shield edge follows the ideal beam's plateau edge (its cut-off line shifted down by the edge search's dTop), not the bare line
    const dTop = (des.edge && des.edge.dTop) || 0, shield1 = P3.shieldFor(P, lay, s, dTop), postFull = P3.makePost({ cap: lay.cap, barrel: lay.barrel, lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: shield1 });
    // lens-path placement: the shield mask, the lens field, the aperture
    let resid = P3.coarse(P, des.T, G), recL = [], edgePl = []; const mask = new Float64Array(G.nh * G.nv);
    for (let j = 0; j < G.nv; j++) { const v = G.v0 + (j + 0.5) * G.step; for (let i = 0; i < G.nh; i++) { const h = G.h0 + (i + 0.5) * G.step; mask[j * G.nh + i] = (P.cut && s.shield !== 'off' ? clamp((top(h) - dTop - v) / G.step + 0.5, 0, 1) : 1) * (Math.abs(h) <= s.spread && v >= -20 ? 1 : 0); } }
    const aimOf = (fp, h, v) => [h - (fp.hc - h0), v - (fp.vc - v0)];
    const lensI = (aim) => P3.imgPoint(P, lay, aim[0], Math.min(aim[1], top(aim[0]) - 0.05), 0);
    const orderL = cL.map((_, k) => k).sort((a, b) => fpL[b][0].sh * fpL[b][0].sv - fpL[a][0].sh * fpL[a][0].sv);
    if (P.S.verbose) { const sv = fpL.map((alts) => Math.min(...alts.map((f) => f.sv))).sort((x, y) => x - y), fl = fpL.map((alts) => alts[0].flux), q = (t) => sv[Math.min(sv.length - 1, Math.floor(t * sv.length))].toFixed(2);
      P.lap(`    sharpest-alternative vertical rms (°): min ${q(0)} p10 ${q(0.1)} p25 ${q(0.25)} p50 ${q(0.5)} p75 ${q(0.75)} max ${q(0.999)}; facets ${sv.length}, flux ${fl.reduce((x, y) => x + y, 0).toFixed(0)} lm`);
      const bins = [0.5, 1, 1.5, 2, 3, 5, 99]; let lo = 0; P.lap('    lm by sharpest vertical rms: ' + bins.map((hi) => { let f = 0; fpL.forEach((alts) => { const m = Math.min(...alts.map((x) => x.sv)); if (m >= lo && m < hi) f += alts[0].flux; }); const r = `${lo}–${hi}°: ${f.toFixed(0)}`; lo = hi; return r; }).join('  ')); }
    const lensOk = (h, v, fp, k) => { const a = aimOf(fp, h, v); return Math.abs(a[0]) <= s.spread && P3.entersLens(lay, cL[k].P, lensI(a)); };
    // screenless: a footprint may sit only where at most s.leak of its light lands above the cut-off line (minus s.edgeMargin); a spot that leaks slides DOWN to the highest row that does not
    const hOfI = (i) => G.h0 + (i + 0.5) * G.step, vOfJ = (j) => G.v0 + (j + 0.5) * G.step, topJ = new Float64Array(G.nh);
    const leakAt = (fp, ci, cj) => { let L = 0; for (let q = 0; q < fp.n; q++) { const i = ci + fp.di[q]; if (i < 0 || i >= G.nh) continue; if (vOfJ(cj + fp.dj[q]) > topJ[i]) L += fp.val[q]; } return L; };
    const snap = s.shield !== 'auto' && P.cut ? (ci, cj, fp, k) => {
      const tol = s.leak * fp.flux; let j = cj;
      if (leakAt(fp, ci, cj) > tol) { let lo = cj - 300, hi = cj; if (leakAt(fp, ci, lo) > tol) return null; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (leakAt(fp, ci, m) > tol) hi = m; else lo = m; } j = lo; }
      return lensOk(hOfI(ci), vOfJ(j), fp, k) ? j : null;
    } : null;
    // one placement for a line shifted down by eL (oncoming side) / eR (own side) degrees: the spec's cut-off rule is a generous stand-in on the own side (the FMVSS line rises to
    // +1° by ~1R, yet 0.5U 1R–3R is capped at 2700 cd), so the edge heights are searched against the model below, like v3's shield edge
    const place = (eL, eR) => {
      for (let i = 0; i < G.nh; i++) { const h = hOfI(i); topJ[i] = top(h) - s.edgeMargin - (h * (P.cut ? P.cut.own : 1) > 0 ? eR : eL); }
      resid = P3.coarse(P, des.T, G);
      // edge pass: the sharpest facets first, scored only on the light they put in the band just under the line (where R112's 75R/50R and the hotspot live); the rest after, big images first
      let first = [];
      if (snap && s.edgeSharp > 0) {
        const svOf = (k) => Math.min(...fpL[k].map((f) => f.sv)), band = new Float64Array(G.nh * G.nv);
        for (let j = 0; j < G.nv; j++) { const v = vOfJ(j); for (let i = 0; i < G.nh; i++) band[j * G.nh + i] = v <= topJ[i] && v >= topJ[i] - s.edgeBand ? mask[j * G.nh + i] : 0; }
        first = orderL.filter((k) => svOf(k) <= s.edgeSharp).sort((a, b) => svOf(a) - svOf(b));
        if (first.length) edgePl = P3.greedy(G, fpL, resid, band, { order: first, lam: s.lam, top: 40, allowed: lensOk, snap, subMask: mask });
      }
      const rest = orderL.filter((k) => !first.includes(k));
      const plL = (first.length ? edgePl : []).concat(P3.greedy(G, fpL, resid, mask, { order: rest, lam: s.lam, top: 40, allowed: lensOk, snap }));
      recL = plL.filter((r) => r.h !== null).map((r) => ({ k: r.k, alt: r.alt, aim: aimOf(fpL[r.k][r.alt], r.h, r.v) }));
      if (snap) refine();
    };
    // the placement used each facet's footprint at ONE nominal aim; a facet near the vertex (magnification ~8, images ~12° rms) changes shape with the aim, so re-trace every placed facet
    // at its real aim and slide it down by its REAL footprint until it leaks ≤ s.leak; a facet that cannot (or whose light then misses the lens) is dropped: its light goes back out of the bowl
    const refine = () => {
      for (let it = 0; it < s.refine; it++) {
        let moved = 0, dropped = 0;
        recL = recL.filter((rec) => {
          const f = lensFacet(rec, 'tmp'), fp = f ? P3.footOf(P, f, postL, G, 16) : null; if (!fp) { dropped++; return false; }
          const tol = s.leak * fp.flux, ci = fp.ri, cj = fp.rj; if (leakAt(fp, ci, cj) <= tol) return true;
          let lo = cj - 300, hi = cj; if (leakAt(fp, ci, lo) > tol) { dropped++; return false; }
          while (hi - lo > 1) { const m = (lo + hi) >> 1; if (leakAt(fp, ci, m) > tol) hi = m; else lo = m; }
          const aim = [rec.aim[0], rec.aim[1] + (lo - cj) * G.step];
          if (!P3.entersLens(lay, cL[rec.k].P, lensI(aim))) { dropped++; return false; }
          rec.aim = aim; moved++; return true;
        });
        if (P.S.verbose) P.lap(`      refine ${it}: ${moved} moved down, ${dropped} dropped, ${recL.length} left`);
        if (!moved) break;
      }
    };
    const lensFacet = (rec, id) => P3.facetOf(P, lay, cL[rec.k], lensI(rec.aim), id, fpL[rec.k][rec.alt].s0);
    place(0, 0);
    // bypass: decals for the floors above the cut-off (small facets: flux ∝ area), then the rest of the cells by greedy placement of Gaussian footprints of several widths
    const widths = [0, 1.5, 3, 5], recD = [], recDec = [], D2 = D2R * D2R;
    if (cD.length) {
      const seeds = []; if (P.cut) for (const it of P.spec.items) { const pts = it.kind === 'point' ? [[it.h, it.v]] : it.kind === 'sum' ? it.pts : null; if (!pts || !(it.min > 0)) continue; for (const [h, v] of pts) if (v > top(h) + 0.3) seeds.push({ h, v, lo: it.kind === 'sum' ? it.min / it.pts.length : it.min }); }
      const byFlux = cD.map((_, k) => k).sort((a, b) => fpD[a].flux - fpD[b].flux), used = new Set();
      for (const sd of seeds) { if (used.size >= cD.length - 1) break; const k = byFlux.find((x) => !used.has(x)); used.add(k); const fp = fpD[k], need = s.decalGain * sd.lo * 2 * Math.PI * fp.sh * fp.sv * D2; recDec.push({ k, aim: [sd.h, sd.v], w: 0, scale: Math.min(1, need / fp.flux) }); }
      const resB = new Float64Array(GB.nh * GB.nv), defB = new Float64Array(GB.nh * GB.nv), kk = Math.round(GB.step / G.step), bA0 = P3.aggBands(P, G, des.T);
      // the lens path's delivered field so far = ideal beam − residual; the floors it leaves unmet (per 0.5° bin) are the bypass facets' FIRST job
      for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) { const p = j * G.nh + i, q = Math.min(GB.nv - 1, (j / kk) | 0) * GB.nh + Math.min(GB.nh - 1, (i / kk) | 0); resB[q] += resid[p]; const T = bA0.T[p] * G.om[p], got = T - resid[p], need = bA0.lo[p] * G.om[p]; if (need > got) defB[q] += need - got; }
      const rest = cD.map((_, k) => k).filter((k) => !used.has(k)), altsD = fpD.map((fp) => widths.map((w) => P3.gaussFoot(GB, fp.flux, Math.sqrt(fp.sh * fp.sh + w * w), Math.sqrt(fp.sv * fp.sv + w * w))));
      const nFirst = Math.min(rest.length, Math.max(2, Math.round(rest.length * 0.5))), first = rest.slice().sort((a, b) => fpD[a].flux - fpD[b].flux).slice(0, nFirst), later = rest.filter((k) => !first.includes(k));
      const plD1 = P3.greedy(GB, altsD, defB, null, { order: first, lam: 0.2, top: 40 });          // small facets first: dim floors need modest flux
      for (const r of plD1) if (r.h !== null && r.delivered > 0) { recD.push({ k: r.k, aim: [r.h, r.v], w: r.alt, scale: 1 }); for (let q = 0; q < resB.length; q++) { } }
      const placed = new Set(recD.map((r) => r.k)); for (const k of first) if (!placed.has(k)) later.push(k);
      const plD = P3.greedy(GB, altsD, resB, null, { order: later.sort((a, b) => fpD[b].flux - fpD[a].flux), lam: s.lam, top: 40 });
      for (const r of plD) if (r.h !== null) recD.push({ k: r.k, aim: [r.h, r.v], w: r.alt, scale: 1 });
    }
    const dFacet = (rec, id) => P3.facetDirect(P, lay, cD[rec.k], rec.aim[0], rec.aim[1], id, widths[rec.w] > 0 ? [widths[rec.w] ** 2, 0, widths[rec.w] ** 2] : null, rec.scale);
    const buildAll = () => { const out = []; let n = 0; for (const rec of recL) { const f = lensFacet(rec, 'p3_f' + n++); if (f) { f.cls = 'L'; out.push(f); } } n = 0; for (const rec of recD.concat(recDec)) { const f = dFacet(rec, 'p3_d' + n++); if (f) { f.cls = 'D'; out.push(f); } } return out; };

    // the shield edge's height is tuned against the model: images are far wider than the ideal beam's edge blur, so the realised edge sits where the shield cuts them
    let shield = shield1, edgeNote = '';
    const cleanShield = (eL, eR) => (s.shield === 'cleanup' ? P3.shieldFor(P, lay, s, { L: eL + s.edgeMargin, R: eR + s.edgeMargin }) : null);
    if (s.shield === 'cleanup') shield = cleanShield(0, 0); else if (s.shield === 'off') shield = null;
    if (full && P.cut && s.shield !== 'auto' && s.edgeSearch) {
      const score = (eL, eR) => { place(eL, eR); const m = P3.evaluate(P, lay, cleanShield(eL, eR), buildAll(), 16); return m.score + 0.0005 * m.lm; };
      let bR = { v: 0, sc: score(0, 0) }; for (const eR of [0.25, 0.5, 0.8, 1.2, 1.6, 2.0]) { const sc = score(0, eR); if (sc > bR.sc) bR = { v: eR, sc }; }
      let bL = { v: 0, sc: bR.sc }; for (const eL of [0.15, 0.3]) { const sc = score(eL, bR.v); if (sc > bL.sc) bL = { v: eL, sc }; }
      place(bL.v, bR.v); shield = cleanShield(bL.v, bR.v); edgeNote = `screenless line shift L ${bL.v}° R ${bR.v}°`; P.lap('    ' + edgeNote);
    }
    if (full && P.cut && s.shield === 'auto' && s.edgeSearch) {
      const score = (sh) => { const fs = buildAll(), m = P3.evaluate(P, lay, sh, fs, 16); return { m, sc: m.score + 0.0005 * m.lm }; };
      let bestR = { v: dTop, ...score(shield1) }; for (const dR of [dTop + 0.15, dTop + 0.3, dTop + 0.5, dTop + 0.75, dTop + 1.0, dTop - 0.15]) { const r = score(P3.shieldFor(P, lay, s, { L: dTop, R: dR })); if (r.sc > bestR.sc) bestR = { v: dR, ...r }; }
      let bestL = { v: dTop, sc: bestR.sc }; for (const dL of [dTop + 0.1, dTop + 0.2, dTop + 0.35, dTop - 0.1]) { const r = score(P3.shieldFor(P, lay, s, { L: dL, R: bestR.v })); if (r.sc > bestL.sc) bestL = { v: dL, sc: r.sc }; }
      shield = P3.shieldFor(P, lay, s, { L: bestL.v, R: bestR.v }); edgeNote = `edge shift L ${bestL.v.toFixed(2)}° R ${bestR.v.toFixed(2)}°`; P.lap('    ' + edgeNote);
    }
    // sign-point windows sized by the model (s.slitSize 'auto'): the light through a hole ∝ its area, so r ← r·√(goal / I), 3 rounds; goal = 2 × the point's share of its
    // minimum, capped at 0.4 × any zone maximum the point sits in (R112: Points 1–6 are INSIDE Zone III, ≤ 625 cd — a full-size window put kcd there).  Kept only if the score improves.
    if (full && shield && shield.holes && shield.holes.length && s.slitSize === 'auto') {
      const md = T.mdOf(P.spec), kk = md.kernel > 0 ? md.kernel : 0.15, zones = P.spec.items.filter((x) => x.kind === 'zone' && x.max > 0), rMin = lay.f * Math.tan(0.02 * D2R);
      const goalOf = (hl) => { const it = hl.it, n = it.kind === 'sum' ? it.pts.length : 1; let g = 2 * it.min / n; for (const z of zones) if (RF.Spec.inPoly(z.poly, hl.pt[0], hl.pt[1])) g = Math.min(g, 0.4 * z.max); return g; };
      const evalSh = (sh) => { const m = P3.evaluate(P, lay, sh, buildAll(), 16); return { m, sc: m.score + 0.0005 * m.lm }; };
      const peakNear = (m, h, v) => { const sf = m.ev.shift || [0, 0]; let mx = 0; for (let dh = -0.5; dh <= 0.501; dh += 0.1) for (let dv = -0.5; dv <= 0.501; dv += 0.1) { const r = RF.FarField.intensityAt(m.gj, h + sf[0] + dh, v + sf[1] + dv, kk); if (r.cd > mx) mx = r.cd; } return mx; };
      let cur = shield, e = evalSh(shield); const e0 = e; let best = { sh: shield, sc: e.sc, m: e.m }; const trail = [];
      for (let round = 0; round < 3; round++) {
        const holes = cur.holes.map((hl) => { const I = peakNear(e.m, hl.pt[0], hl.pt[1]), g = goalOf(hl), r = I > 0 ? Math.min(hl.r0, hl.r * Math.sqrt(g / I)) : hl.r0; return Object.assign({}, hl, { r }); }).filter((hl) => hl.r >= rMin);
        cur = Object.assign({}, cur, { holes }); e = evalSh(cur); trail.push(`${holes.length} holes r ${holes.map((hl) => (Math.atan(hl.r / lay.f) / D2R).toFixed(2)).join('/')}° → ${e.m.hard}f/${e.m.ev.n.unsure}u`);
        if (e.sc > best.sc) best = { sh: cur, sc: e.sc, m: e.m };
      }
      if (P.S.verbose) P.lap(`    window sizing: ${e0.m.hard}f/${e0.m.ev.n.unsure}u → ` + trail.join(' · ') + (best.sh === shield ? ' (kept full size)' : ''));
      shield = best.sh;
    }
    // polish rounds: refresh every footprint at its current aim, slide the L facets (shield mask) and the bypass facets against the spec's floors and ceilings, rebuild; keep the best by the model
    const wmul = new Float64Array(P.g.n).fill(1); let bandA = P3.aggBands(P, G, des.T, wmul), bandB = P3.aggBands(P, GB, des.T, wmul); let pk = 0; for (const x of des.T) if (x > pk) pk = x;
    const popt = { wBand: s.wBand, wTrack: s.wTrack, tref: Math.max(200, 0.03 * pk), sweeps: s.polishSweeps };
    let best = null; const log = [];
    const rounds = full ? s.polishRounds : 0;
    for (let round = 0; round <= rounds; round++) {
      const facets = buildAll(), stats = {}, m = P3.evaluate(P, lay, shield, facets, 24, stats); log.push(`${m.hard}f/${m.ev.n.unsure}u ${m.lm.toFixed(0)}lm`); if (P.S.verbose) P.lap(`      round ${round} fails: ` + m.ev.rows.filter((r) => r.verdict === 'fail').map((r) => `${r.name} ${(+r.value).toPrecision(3)}${r.isMin ? '<' : '>'}${(+r.bound).toPrecision(3)}`).join(' | '));
      if (!best || m.score > best.m.score) best = { facets, m, stats };
      if (round === rounds) break;
      // the judge's verdict feeds back: every failing / unsure row weighs more in the next round (rows with a pixel set; the cut-off rows are protected by holding edge facets near their place)
      for (const r of m.ev.rows) if (r.verdict !== 'pass') { const br = P.B.rows.find((x) => x.name === r.name && x.px); if (br) for (const q of br.px) wmul[q] = Math.min(64, wmul[q] * 4); }
      bandA = P3.aggBands(P, G, des.T, wmul); bandB = P3.aggBands(P, GB, des.T, wmul);
      // ---- L polish
      const fps = recL.map((rec) => { const f = lensFacet(rec, 'tmp'); const fp = f ? P3.footOf(P, f, postL, G, 16) : null; if (fp) rec.dl = [fp.hc - rec.aim[0], fp.vc - rec.aim[1]]; return fp; });
      const posL = fps.map((fp) => (fp ? [fp.ri, fp.rj] : null)), kb = Math.round(GB.step / G.step);
      const EDB = new Float64Array(GB.nh * GB.nv); for (const rec of recD) { const fp = P3.gaussFoot(GB, fpD[rec.k].flux, Math.sqrt(fpD[rec.k].sh ** 2 + widths[rec.w] ** 2), Math.sqrt(fpD[rec.k].sv ** 2 + widths[rec.w] ** 2)), c = P3.pixOf(GB, rec.aim[0], rec.aim[1]); for (let q = 0; q < fp.n; q++) { const i = c[0] + fp.di[q], j = c[1] + fp.dj[q]; if (i >= 0 && j >= 0 && i < GB.nh && j < GB.nv) EDB[j * GB.nh + i] += fp.val[q]; } }
      const EDA = new Float64Array(G.nh * G.nv); for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) EDA[j * G.nh + i] = EDB[Math.min(GB.nv - 1, (j / kb) | 0) * GB.nh + Math.min(GB.nh - 1, (i / kb) | 0)] / (kb * kb);
      const r1 = P3.polish(G, fps, posL, mask, bandA, EDA, Object.assign({ steps: [8, 4, 2, 1], trust: 40, trustOf: (k) => { const rec = recL[k], fp = fps[k], h = fp.hc, v = fp.vc, e = top(h) - dTop; return Math.abs(v - e) < 2 * fp.sv + 0.5 ? s.edgeTrust : 40; }, allowed: (ci, cj, k) => { const rec = recL[k], h = G.h0 + (ci + 0.5) * G.step - rec.dl[0], v = G.v0 + (cj + 0.5) * G.step - rec.dl[1]; return Math.abs(h) <= s.spread && P3.entersLens(lay, cL[rec.k].P, lensI([h, v])); } }, popt));
      if (P.S.verbose) P.lap(`      L polish: cost ${r1.before.toFixed(0)} → ${r1.after.toFixed(0)}, ${r1.moves} moves of ${recL.length}`);
      recL.forEach((rec, i) => { if (posL[i]) rec.aim = [G.h0 + (posL[i][0] + 0.5) * G.step - rec.dl[0], G.v0 + (posL[i][1] + 0.5) * G.step - rec.dl[1]]; });
      // ---- bypass polish (the lens path's field, aggregated, is fixed)
      if (recD.length) {
        const EL = new Float64Array(GB.nh * GB.nv), fl = (() => { const E = new Float64Array(G.nh * G.nv); recL.forEach((rec, i) => { const fp = fps[i]; if (!fp || !posL[i]) return; for (let q = 0; q < fp.n; q++) { const ii = posL[i][0] + fp.di[q], jj = posL[i][1] + fp.dj[q]; if (ii >= 0 && jj >= 0 && ii < G.nh && jj < G.nv) E[jj * G.nh + ii] += fp.val[q] * mask[jj * G.nh + ii]; } }); return E; })();
        for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) EL[Math.min(GB.nv - 1, (j / kb) | 0) * GB.nh + Math.min(GB.nh - 1, (i / kb) | 0)] += fl[j * G.nh + i];
        const altsD = recD.map((rec) => widths.map((w) => P3.gaussFoot(GB, fpD[rec.k].flux, Math.sqrt(fpD[rec.k].sh ** 2 + w * w), Math.sqrt(fpD[rec.k].sv ** 2 + w * w)))), posD = recD.map((rec) => { const c = P3.pixOf(GB, rec.aim[0], rec.aim[1]); return [c[0], c[1], rec.w]; });
        const r2 = P3.polish(GB, altsD, posD, null, bandB, EL, Object.assign({ steps: [4, 2, 1], trust: 30 }, popt, { wTrack: s.wTrack }));
        if (P.S.verbose) P.lap(`      D polish: cost ${r2.before.toFixed(0)} → ${r2.after.toFixed(0)}, ${r2.moves} moves of ${recD.length}`);
        recD.forEach((rec, i) => { rec.aim = [GB.h0 + (posD[i][0] + 0.5) * GB.step, GB.v0 + (posD[i][1] + 0.5) * GB.step]; rec.w = posD[i][2]; });
      }
    }
    P.lap(`    polish rounds (model fails/unsure, lm): ${log.join(' → ')}`);
    let contNote = '';
    if (s.surface === 'continuous') {
      const s2 = Object.assign({}, s); while (s2.contRings * s2.contSectors > Kmax && s2.contSectors > 4) s2.contSectors--;
      const cont = P3.continuousSurface(P, lay, s2, { cL, fpL, recL, lensI, leakAt, postL, G, top });
      if (cont && cont.facets.length) {
        const stats = {}, m = P3.evaluate(P, lay, shield, cont.facets, 24, stats), f = cont.fit;
        contNote = `continuous surface: ${f.patches} patches (${s2.contRings} × ${s2.contSectors}, ${f.dropped} dropped), ${f.terms} terms per field fitted to ${f.samples} stepped facets: rms t ${f.rmsT.toFixed(2)}, h ${f.rmsH.toFixed(1)}°, v ${f.rmsV.toFixed(1)}°; integrated surface: normal mismatch ${f.normalMismatch.toFixed(2)}° rms;${f.snapNote ? ' ' + f.snapNote + ';' : ''} light above the line ${(100 * f.leakShare).toFixed(1)} %; model ${m.hard} fails / ${m.lm.toFixed(0)} lm (stepped: ${best.m.hard} / ${best.m.lm.toFixed(0)})`;
        P.lap('    ' + contNote); best = { facets: cont.facets, m, stats };
      } else contNote = 'continuous surface: no patches (kept the stepped design)';
    }
    const facets = best.facets, nL = facets.filter((f) => f.cls === 'L').length, nD = facets.length - nL;
    if (P.S.verbose) { P.polyStats = []; P.polyWhy = {}; buildAll(); P.lap('    polygon vertex rejections (first try of each pull-in step): ' + JSON.stringify(P.polyWhy)); P.polyWhy = null; const r = P.polyStats.slice().sort((x, y) => x - y), q = (t) => (r[Math.min(r.length - 1, Math.floor(t * r.length))] || 0).toFixed(2); P.polyStats = null;
      P.lap(`    facet polygon area kept vs its cell (gnomonic): min ${q(0)} p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)} max ${q(0.999)} (n ${r.length})`); }
    // diagnostic (verbose): how much of each placed facet's REAL model footprint lands above the cut-off line (the placement used a footprint at a nominal aim)
    let leakNote = '';
    if (P.cut && best.m.fld && best.m.fld.fps) {
      const g = P.grid, rows = []; let tot = 0, totF = 0;
      best.m.fld.fps.forEach((fp, j) => { let L = 0; for (let q = 0; q < fp.idx.length; q++) { const i = fp.idx[q] % g.nh, jj = (fp.idx[q] / g.nh) | 0, h = g.h0 + (i + 0.5) * g.step, v = g.v0 + (jj + 0.5) * g.step; if (v > top(h) - (s.edgeMargin || 0)) L += fp.val[q]; } tot += L; totF += fp.flux; rows.push({ j, L, fl: fp.flux, f: facets[j], hc: fp.hc, vc: fp.vc, sv: Math.sqrt(Math.max(0, fp.cov[2])) }); });
      rows.sort((a, b) => b.L - a.L); leakNote = `model light above the cut-off: ${tot.toFixed(1)} of ${totF.toFixed(0)} lm (${(100 * tot / Math.max(1e-9, totF)).toFixed(1)} %), ${rows.filter((r) => r.L > 0.02 * r.fl).length} facets over 2 %`;
      P.lap('    ' + leakNote);
      if (P.S.verbose) for (const r of rows.slice(0, 8)) P.lap(`      leak ${r.L.toFixed(2)} lm (${(100 * r.L / Math.max(1e-9, r.fl)).toFixed(0)} % of ${r.fl.toFixed(1)}) facet ${r.f.id} at ${V.dist(r.f.P, P.Lp).toFixed(0)} mm, focus offset ${V.dist(r.f.S0, P.Lp).toFixed(1)} mm, centroid (${r.hc.toFixed(1)}, ${r.vc.toFixed(1)}) rms v ${r.sv.toFixed(1)}°`);
    }
    if (!facets.length) return null;
    const rr = facets.map((f) => V.dist(f.P, P.Lp));
    return { leakNote: (contNote ? contNote + '; ' : '') + leakNote, lay, cellsL: cL, cellsD: cD, facets, nL, nD, nDecal: recDec.length, nEnd: facets.filter((f) => f.cls === 'L' && V.dist(f.S0, P.Lp) > 0.01).length, shield, des, m: best.m, stats: best.stats, availL, availD, surfaces: P3.surfacesOf(P, lay, shield, facets, s), depthRange: `${Math.min(...rr).toFixed(0)}–${Math.max(...rr).toFixed(0)} mm (median ${rr.slice().sort((x, y) => x - y)[rr.length >> 1].toFixed(0)}) from the LED` };
  }

  RF.Solvers.register({ id: 'projector-liou', name: 'Projector, screenless (Liou branch of v3, experimental)', version: '0.1', modes: ['paint'], settings: SETTINGS, solve });
})();
