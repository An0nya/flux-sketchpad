/* main.js — the solver: spec → ideal beam → candidate lens/focus layouts → cells over the whole emission sphere → aims → facets + shield + lens → model verdict → best layout. */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {}, T = RF.SqmTarget, D2R = Math.PI / 180;
  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused (the depth map picks distances)' },
    { key: 'lensShape', label: 'Lens: auto (the best traced design wins) · flat-in (flat face toward the reflector, convex conic out: the production projector lens) · curve-in (conic toward the reflector, exact on axis) · biconvex', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'flat-in', label: 'flat side to the reflector' }, { value: 'curve-in', label: 'curved side to the reflector (stigmatic)' }, { value: 'biconvex', label: 'biconvex' }], default: 'auto' },
    { key: 'ior', label: 'Lens index (1.49 acrylic, 1.59 polycarbonate)', type: 'number', min: 1.3, max: 2, step: 0.01, default: 1.59 },
    { key: 'facets', label: 'Facets to use (0 = the whole budget, at most 300)', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'shield', label: 'Shield (auto: on when the spec has a cut-off)', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'off', label: 'off' }], default: 'auto', adv: true },
    { key: 'shieldCurved', label: 'Curved shield (follows the field curvature)', type: 'checkbox', default: true, adv: true },
    { key: 'shieldDefocus', label: 'Shield axial offset (mm, + = toward the lens, −1 = auto)', type: 'number', min: -1, max: 4, step: 0.05, default: -1, adv: true },
    { key: 'spread', label: 'Widest lens-path aim, ± degrees', type: 'number', min: 2, max: 40, step: 1, default: 25, adv: true },
    { key: 'edgeDrop', label: 'Image centres below the cut-off (°)', type: 'number', min: 0, max: 3, step: 0.05, default: 0.4, adv: true },
    { key: 'depthPenalty', label: 'Depth-map stiffness (penalty for leaving the base path length)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.35, adv: true },
    { key: 'fluxFrac', label: 'Share of the lens-path flux the ideal beam may ask for', type: 'number', min: 0.2, max: 1.2, step: 0.01, default: 0.85, adv: true },
    { key: 'focal', label: 'Lens focal length (mm, 0 = search)', type: 'number', min: 0, max: 150, step: 1, default: 0, adv: true },
    { key: 'aperture', label: 'Lens aperture radius (mm, 0 = search)', type: 'number', min: 0, max: 100, step: 0.5, default: 0, adv: true },
    { key: 'bypass', label: 'Lens-bypass facets (auto: facets beside the lens use the light the lens path cannot; off: a sealed projector, all light leaves through the lens)', type: 'select', options: [{ value: 'auto', label: 'auto' }, { value: 'off', label: 'off (sealed)' }], default: 'auto' },
    { key: 'endFocus', label: 'Emitter-end focus (Liou 2009): a lens-path facet may take an emitter END as its first focus, so its image hangs on one side of the aim — images can sit on the cut-off line and the shield throws less light away (finalists only)', type: 'checkbox', default: true },
    { key: 'bypassReach', label: 'Largest angle from the LED axis (°) at which lens-feasible light may be given to bypass facets instead (60 = only what the lens path cannot use; ~100 = the whole equator band goes to big far mirrors: sharper images, more lumens and peak, less of a projector)', type: 'number', min: 0, max: 180, step: 5, default: 60, adv: true },
    { key: 'reflector', label: 'Reflector: facets (aimed ellipsoid patches) or one continuous ellipsoid (the classic projector cup; a single facet of the budget)', type: 'select', options: [{ value: 'facets', label: 'facets' }, { value: 'ellipsoid', label: 'one continuous ellipsoid' }], default: 'facets' },
    { key: 'shieldEff', label: 'Share of the lens-path flux that survives the shield (sizes the ideal beam)', type: 'number', min: 0.3, max: 1, step: 0.01, default: 0.8, adv: true },
    { key: 'lam', label: 'Placement waste penalty (0 = fill anywhere, 1 = never overshoot)', type: 'number', min: 0, max: 2, step: 0.05, default: 0.5, adv: true },
    { key: 'bypassMinEff', label: 'A bypass cell is dropped when less than this share of its light survives the lens/shield on a nominal aim', type: 'number', min: 0, max: 1, step: 0.05, default: 0.4, adv: true },
    { key: 'polishRounds', label: 'Aim polish rounds (refresh footprints, slide the facets against the spec; 0 = off)', type: 'number', min: 0, max: 10, step: 1, default: 1 },
    { key: 'polishSweeps', label: 'Sweeps per polish round (each sweep tries four step sizes)', type: 'number', min: 1, max: 6, step: 1, default: 3, adv: true },
    { key: 'wBand', label: 'Polish weight of floor / ceiling violations', type: 'number', min: 0, step: 10, default: 150, adv: true },
    { key: 'wTrack', label: 'Polish weight of following the ideal beam', type: 'number', min: 0, step: 0.01, default: 0.03, adv: true },
    { key: 'decalGain', label: 'Decal flux margin over a sign-point floor', type: 'number', min: 0.5, max: 6, step: 0.1, default: 1.5, adv: true },
    { key: 'edgeTrust', label: 'How far (pixels of 0.1°) a facet that forms the cut-off edge may move in the polish', type: 'number', min: 0, max: 40, step: 1, default: 3, adv: true },
    { key: 'edgeSearch', label: 'Search the shield edge height (left / right) against the model', type: 'checkbox', default: true, adv: true },
    { key: 'finalists', label: 'Layouts that get the full treatment (edge search, polish)', type: 'number', min: 1, max: 6, step: 1, default: 3, adv: true },
    { key: 'verify', label: 'Let the engine (one 1 M-ray spec trace each) pick between the two best layouts', type: 'checkbox', default: true, adv: true },
    { key: 'keepTop', label: 'Layouts evaluated in full (the best by the cheap proxy)', type: 'number', min: 1, max: 40, step: 1, default: 6, adv: true },
    { key: 'verbose', label: 'Log progress to the console', type: 'checkbox', default: false, adv: true },
  ];

  function candidates(P, s) {
    const out = [], E = P.E, S0 = P.Lp, n = s.ior, shapes = s.lensShape === 'auto' ? ['flat-in', 'curve-in', 'biconvex'] : [s.lensShape === 'biconvex' ? 'biconvex' : s.lensShape];
    const fList = s.focal > 0 ? [s.focal] : [10, 13, 17, 21, 26, 33, 42, 54], hEnv = Math.min((E.ymax - E.ymin) / 2, (E.zmax - E.zmin) / 2) - 0.8;
    const variants = [];
    for (const sh of shapes) {
      if (sh === 'flat-in') for (const k of [-0.5, -0.8, -1.2]) variants.push({ kind: 'flat-in', k, beta: 0 });
      else if (sh === 'curve-in') variants.push({ kind: 'curve-in', k: -n * n, beta: 0 });
      else for (const k of [-1.6, -1]) variants.push({ kind: 'bi', k, beta: 0.7 });
    }
    const clampTo = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    for (const f of fList) for (const af of s.aperture > 0 ? [0] : [1, 0.75, 0.55]) {
      const a = s.aperture > 0 ? s.aperture : Math.min(0.9 * f, hEnv) * af; if (a < 3) continue;
      // the lens axis: through the LED's height where the lens fits there, else as close as it fits; also the middle and both ends of the envelope's height (a box with the LED on the floor)
      const yA = clampTo(S0[1], E.ymin + a + 0.8, E.ymax - a - 0.8), zs = [clampTo(S0[2], E.zmin + a + 0.8, E.zmax - a - 0.8), E.zmin + a + 0.8, (E.zmin + E.zmax) / 2, E.zmax - a - 0.8].filter((z, k, arr) => arr.findIndex((q) => Math.abs(q - z) < 0.5) === k);
      for (const v of variants) for (const back of [0, 6]) for (const zA of zs) out.push(Object.assign({ n, f, a, back, yA, zA }, v));
    }
    return out;
  }
  const lensMerit = (L) => { let sum = 0, w = 0; for (let i = 0; i <= 8; i++) { const m = L.map[i]; sum += m ? Math.min(m.blur, 8) + 8 * (1 - m.pass) : 8; w++; } return sum / w; };

  async function solve(input, s0, tools) {
    if (!input.spec) return { surfaces: [], notes: ['projector-v3 designs from a beam specification: switch to Spec mode (paint mode is not built yet; Fill & fix, SQM or Auto handle paint).'] };
    const S = Object.assign({}, P3.DEFAULTS, s0), notes = [], P = P3.problem(input, S, tools); const s = Object.assign({ depthPenalty: 0.35 }, s0);
    const budgetMs = tools && tools.budget && isFinite(tools.budget.ms) && tools.budget.ms > 0 ? tools.budget.ms : 120000, el = () => Date.now() - P.t0;      // the host's solve time limit; what is not finished by then is lost
    const Kmax = Math.min(P.maxF, s.facets > 0 ? s.facets : 300);
    const D = P3.dirs(P, S.nDirs); P.lap(`directions: ${D.n}, ${D.tot.toFixed(0)} lm`);
    // 1. layouts by the cheap proxy
    const cands = candidates(P, s), lays = [];
    for (const c of cands) { const lay = P3.placeLens(P, c); if (!lay) continue; const pk = P3.pickLb(P, lay, D, s); lay.Lb = pk.Lb; lay.proxy = pk.proxy / (1 + lensMerit(lay.L) / 3); lays.push(lay); }
    lays.sort((a, b) => b.proxy - a.proxy); P.lap(`layouts: ${lays.length} of ${cands.length}` + (S.verbose ? '; rejected: ' + Object.entries(P.why || {}).map(([k, v]) => k + ' ×' + v).join(', ') : ''));
    if (S.verbose) for (const l of lays.slice(0, 40)) P.lap(`  proxy ${l.proxy.toFixed(3)} ${l.c.kind} k ${l.c.k.toFixed(2)} f ${l.f} a ${l.a.toFixed(1)} back ${l.c.back} D ${l.D.toFixed(0)} tanMax ${l.tanMax.toFixed(2)} merit ${lensMerit(l.L).toFixed(2)}`);
    // diversify: the best layout of each focal length first (the proxy likes long focal lengths; the model decides), then the rest by proxy
    const seen = new Set(), pick = []; for (const l of lays) { if (!seen.has(l.f)) { seen.add(l.f); pick.push(l); } } for (const l of lays) if (!pick.includes(l)) pick.push(l);
    if (!lays.length) return { surfaces: [], notes: ['projector-v3: no lens layout fits this envelope / LED position (' + Object.entries(P.why || {}).map(([k, v]) => k + ' ×' + v).join(', ') + ')'] };
    // 2. full designs for the best few
    const results = [];
    let slowest = 0;
    for (const lay of pick.slice(0, s.keepTop)) {
      if (results.length && el() + 1.3 * slowest > 0.4 * budgetMs) { notes.push(`time governor: ${results.length} of ${Math.min(pick.length, s.keepTop)} layouts evaluated`); break; }
      const t1 = el(), r = design(P, lay, D, s, Kmax); slowest = Math.max(slowest, el() - t1); if (!r) continue; results.push(r);
      if (results.length === 1 && tools && tools.preview) tools.preview(r.surfaces, { label: 'first draft', needs: { bounces: 3 } });      // display only
      P.lap(`  ${lay.c.kind} k ${lay.c.k.toFixed(2)} f ${lay.f} a ${lay.a.toFixed(1)} back ${lay.c.back}: proxy ${lay.proxy.toFixed(3)} → model ${r.m.hard} fails, ${r.m.lm.toFixed(0)} lm, score ${r.m.score.toFixed(1)}, ${r.nL}+${r.nD} facets`);
    }
    if (!results.length) return { surfaces: [], notes: ['projector-v3: no layout produced a design'] };
    results.sort((a, b) => b.m.score - a.m.score);
    const fin = []; let slowF = 0; for (const r of results.slice(0, s.finalists)) { if (fin.length && el() + 1.3 * slowF > 0.8 * budgetMs) { notes.push(`time governor: ${fin.length} finalist(s)`); break; } const tF = el(), rf = design(P, r.lay, D, s, Kmax, true); slowF = Math.max(slowF, el() - tF); if (rf) { fin.push(rf); P.lap(`  FINAL ${r.lay.c.kind} k ${r.lay.c.k.toFixed(2)} f ${r.lay.f} a ${r.lay.a.toFixed(1)}: model ${rf.m.hard} fails, ${rf.m.lm.toFixed(0)} lm, score ${rf.m.score.toFixed(1)}`); } }
    for (const r of fin) results.unshift(r); results.sort((a, b) => b.m.score - a.m.score);
    // the model does not see direct / stray light: the engine breaks ties between the best finalists (one guided 1 M-ray spec trace each, ~3 s)
    if (s.verify && tools && typeof tools.trace === 'function' && fin.length > 1 && el() < 0.8 * budgetMs) {
      const top = results.slice(0, 2);
      for (const r of top) { try { const t = await tools.trace(r.surfaces, { rays: 1e6, spec: true, bounces: 3, seed: 11 }); r.tr = t && t.spec ? t.spec : null; } catch (e) { r.tr = null; } }
      if (top.every((r) => r.tr)) { top.sort((a, b) => (a.tr.n.fail - b.tr.n.fail) || (b.tr.score - a.tr.score)); results.splice(results.indexOf(top[0]), 1); results.unshift(top[0]); notes.push('engine check of the two best (1 M rays): ' + top.map((r) => `f ${r.lay.f} → ${r.tr.n.fail} fail / ${r.tr.n.unsure} unsure, score ${r.tr.score.toFixed(3)}`).join('; ')); }
    }
    const best = results[0], lay = best.lay;
    for (const r of results.slice(0, 5)) notes.push(`candidate ${r.lay.c.kind} k ${r.lay.c.k.toFixed(2)} f ${r.lay.f} Ø${(2 * r.lay.a).toFixed(0)}: model ${r.m.hard} fail / ${r.m.ev.n.unsure} unsure, ${r.m.lm.toFixed(0)} lm, ${r.facets.length} facets`);
    notes.push(`chosen: lens ${lay.c.kind} k ${lay.c.k.toFixed(2)} f ${lay.f} mm Ø${(2 * lay.a).toFixed(1)} t ${lay.L.t.toFixed(1)}, focus ${lay.D.toFixed(0)} mm ahead of the LED; ${best.nL} lens-path (${best.nEnd || 0} on an emitter end) + ${best.nD} bypass facets (${best.nDecal} decals) at ${best.depthRange}; ideal beam asks ${best.des.flux.toFixed(0)} lm (lens path can give ${best.availL.toFixed(0)}, bypass ${best.availD.toFixed(0)})`);
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
    const h0 = 0, v0 = top(0) - 3, I0 = P3.imgPoint(P, lay, h0, v0, 0), postL = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: null });
    const shield0 = P3.shieldFor(P, lay, s), postFull0 = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: shield0 });
    const cL = [], fpL = [], ends = full && s.endFocus ? P3.sourceEnds(P) : [], S0s = [null].concat(ends);       // alternatives per cell: the LED centre, then each emitter end
    for (const c of cellsL) {
      const alts = []; for (const S0 of S0s) { const f = P3.facetOf(P, lay, c, I0, 'tmp', S0); const fp = f ? P3.footOf(P, f, postL, G, 16) : null; alts.push(fp); }
      if (!alts[0]) continue; cL.push(c); fpL.push(alts.map((x, a) => (x ? Object.assign(x, { s0: S0s[a], alt: a }) : null)).filter(Boolean));
    }
    const cD = [], fpD = [];
    for (const c of cellsD) { const f = P3.facetDirect(P, lay, c, 0, -3, 'tmp'); if (!f) { P.lap('      bypass cell dropped: no polygon'); continue; } const fp = P3.footOf(P, f, postFull0, G, 16); if (!fp || fp.flux < s.bypassMinEff * P.refl * c.fit) { P.lap(`      bypass cell dropped: ${fp ? 'efficiency ' + (fp.flux / (P.refl * c.fit)).toFixed(2) : 'no footprint'}`); continue; } cD.push(c); fpD.push(fp); }
    if (!cL.length) return null;
    if (s.reflector === 'ellipsoid') return designEllipsoid(P, lay, s, cL, full);
    const availL = fpL.reduce((x, f) => x + f[0].flux, 0), availD = fpD.reduce((x, f) => x + f.flux, 0);
    const des = T.design({ spec: P.spec, g: P.g, B: P.B, fluxTarget: s.fluxFrac * (s.shieldEff * availL + availD), peakCap: P.S.peakCap, washCap: P.S.washCap, gd: P.S.gd, guard: 0, guardLift: 0, cut: P.cut || null, road: { gamma: 0.8 } });
    // the shield edge follows the ideal beam's plateau edge (its cut-off line shifted down by the edge search's dTop), not the bare line
    const dTop = (des.edge && des.edge.dTop) || 0, shield1 = P3.shieldFor(P, lay, s, dTop), postFull = P3.makePost({ lens: { L: lay.L, O: lay.O, T: 0.96 * 0.96 }, shield: shield1 });
    // lens-path placement: the shield mask, the lens field, the aperture
    const resid = P3.coarse(P, des.T, G), mask = new Float64Array(G.nh * G.nv);
    for (let j = 0; j < G.nv; j++) { const v = G.v0 + (j + 0.5) * G.step; for (let i = 0; i < G.nh; i++) { const h = G.h0 + (i + 0.5) * G.step; mask[j * G.nh + i] = (P.cut && s.shield !== 'off' ? clamp((top(h) - dTop - v) / G.step + 0.5, 0, 1) : 1) * (Math.abs(h) <= s.spread && v >= -20 ? 1 : 0); } }
    const aimOf = (fp, h, v) => [h - (fp.hc - h0), v - (fp.vc - v0)];
    const lensI = (aim) => P3.imgPoint(P, lay, aim[0], Math.min(aim[1], top(aim[0]) - 0.05), 0);
    const orderL = cL.map((_, k) => k).sort((a, b) => fpL[b][0].sh * fpL[b][0].sv - fpL[a][0].sh * fpL[a][0].sv);
    const plL = P3.greedy(G, fpL, resid, mask, { order: orderL, lam: s.lam, top: 40, allowed: (h, v, fp, k) => { const a = aimOf(fp, h, v); return Math.abs(a[0]) <= s.spread && P3.entersLens(lay, cL[k].P, lensI(a)); } });
    const recL = plL.filter((r) => r.h !== null).map((r) => ({ k: r.k, alt: r.alt, aim: aimOf(fpL[r.k][r.alt], r.h, r.v) }));
    const lensFacet = (rec, id) => P3.facetOf(P, lay, cL[rec.k], lensI(rec.aim), id, fpL[rec.k][rec.alt].s0);
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
    if (full && P.cut && s.shield !== 'off' && s.edgeSearch) {
      const score = (sh) => { const fs = buildAll(), m = P3.evaluate(P, lay, sh, fs, 16); return { m, sc: m.score + 0.0005 * m.lm }; };
      let bestR = { v: dTop, ...score(shield1) }; for (const dR of [dTop + 0.15, dTop + 0.3, dTop + 0.5, dTop + 0.75, dTop + 1.0, dTop - 0.15]) { const r = score(P3.shieldFor(P, lay, s, { L: dTop, R: dR })); if (r.sc > bestR.sc) bestR = { v: dR, ...r }; }
      let bestL = { v: dTop, sc: bestR.sc }; for (const dL of [dTop + 0.1, dTop + 0.2, dTop + 0.35, dTop - 0.1]) { const r = score(P3.shieldFor(P, lay, s, { L: dL, R: bestR.v })); if (r.sc > bestL.sc) bestL = { v: dL, sc: r.sc }; }
      shield = P3.shieldFor(P, lay, s, { L: bestL.v, R: bestR.v }); edgeNote = `edge shift L ${bestL.v.toFixed(2)}° R ${bestR.v.toFixed(2)}°`; P.lap('    ' + edgeNote);
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
    const facets = best.facets, nL = facets.filter((f) => f.cls === 'L').length, nD = facets.length - nL;
    if (!facets.length) return null;
    const rr = facets.map((f) => V.dist(f.P, P.Lp));
    return { lay, cellsL: cL, cellsD: cD, facets, nL, nD, nDecal: recDec.length, nEnd: facets.filter((f) => f.cls === 'L' && V.dist(f.S0, P.Lp) > 0.01).length, shield, des, m: best.m, stats: best.stats, availL, availD, surfaces: P3.surfacesOf(P, lay, shield, facets, s), depthRange: `${Math.min(...rr).toFixed(0)}–${Math.max(...rr).toFixed(0)} mm (median ${rr.slice().sort((x, y) => x - y)[rr.length >> 1].toFixed(0)}) from the LED` };
  }

  RF.Solvers.register({ id: 'projector-v3', name: 'Projector module v3 (experimental)', version: '0.1', modes: ['paint'], settings: SETTINGS, solve });
})();
