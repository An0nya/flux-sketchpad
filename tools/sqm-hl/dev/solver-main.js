/* solver-main.js — registration, settings, quality presets, notes.  The solver proper is RF.SqmPipe (pipeline.js). */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;
  const DISH = RF.SqmVariant === 'dish';      // the second solver built from the same sources: the base shell of the reflector is a setting (shell.js)
  const IDEAL = RF.SqmVariant === 'ideal';    // the third: the ideal beam shaped from the ideal-beam goals (ideal.js)
  const ID = DISH ? 'sqm-hl-dish' : IDEAL ? 'sqm-hl-ideal' : 'sqm-hl', VERSION = DISH ? '0.1' : IDEAL ? '0.1' : '0.2';

  // quality presets: what each tier spends (directions, correction rounds, polish sweeps, verification traces)
  const QUALITY = {
    fast:   { NA: 110, NAcoarse: 50, iters: 4, sweeps: 3, search: 1, naEval: 40, shellRank: 1, traces: 0, traceRays: 0 },
    normal: { NA: 150, NAcoarse: 60, iters: 6, sweeps: 5, search: 4, naEval: 100, shellRank: 2, traces: 1, traceRays: 1000000 },
    best:   { NA: 220, NAcoarse: 80, iters: 10, sweeps: 8, search: 8, naEval: 150, shellRank: 3, traces: 2, traceRays: 2000000 },
  };
  // [key, label, type, default, extra] — tier 1 first (constraints, quality, the beam's goals), then tier 2 (everything the algorithm decides by itself; adv: true)
  const SHELL1 = [
    { key: 'shell', label: 'Base shell the facets sit on: auto = the model compares the shells ticked below and the natural SQM surface (the natural surface wins unless a shell clearly beats it); natural = one continuous surface; fit = the conic closest to the natural surface (fewest steps); paraboloid / sphere / conic / plane = a prescribed shape with its focus at the LED, as big as fits the envelope; wall = hug the envelope', type: 'select', default: 'auto', options: [{ value: 'auto', label: 'auto' }, { value: 'natural', label: 'natural SQM surface' }, { value: 'fit', label: 'conic fitted to the natural surface' }, { value: 'paraboloid', label: 'paraboloid' }, { value: 'sphere', label: 'sphere about the LED' }, { value: 'conic', label: 'conic (eccentricity below)' }, { value: 'plane', label: 'flat plate behind the LED' }, { value: 'wall', label: 'envelope wall' }] },
    { key: 'shellMix', label: 'How far from the natural surface toward the shell (0 = natural, 1 = the shell; in between the facets sit part of the way, so the steps between neighbours shrink)', type: 'number', min: 0, max: 1, step: 0.05, default: 1 },
    { key: 'shellMaxStep', label: 'Largest step between neighbouring facets, mm, that auto accepts (95 % of the edges under this; default 1 keeps the surface edge to edge for the most part; 0 = no limit; a forced shell is only reported)', type: 'number', min: 0, step: 0.1, default: 1 },
  ], SHELL2 = [
    { key: 'shellP', label: 'Shell size p, mm (0 = the biggest that fits: paraboloid focal length = p / 2, sphere radius = p, plane distance = p)', type: 'number', min: 0, step: 1, default: 0, adv: true },
    { key: 'shellE', label: 'Eccentricity of the conic shell (0 = sphere, < 1 ellipsoid, 1 = paraboloid, > 1 hyperboloid; the LED is at a focus)', type: 'number', min: 0, max: 5, step: 0.05, default: 1, adv: true },
    { key: 'shellAxis', label: 'Shell axis: auto = the beam direction tilted by whatever lets the biggest shell fit, beam = the beam direction, manual = the tilts below', type: 'select', default: 'auto', options: [{ value: 'auto', label: 'auto' }, { value: 'beam', label: 'beam direction' }, { value: 'manual', label: 'manual' }], adv: true },
    { key: 'shellTiltV', label: 'Manual axis tilt up, degrees (shell axis = manual)', type: 'number', min: -90, max: 90, step: 1, default: 0, adv: true },
    { key: 'shellTiltH', label: 'Manual axis tilt to the right, degrees (shell axis = manual)', type: 'number', min: -90, max: 90, step: 1, default: 0, adv: true },
    { key: 'shellFill', label: 'Share of the light whose facets must fit inside the envelope when the shell size is chosen (default 0.97; the rest are held at the wall and counted in the report)', type: 'number', min: 0.5, max: 1, step: 0.01, default: 0.97, adv: true },
    { key: 'shellDecals', label: 'The dim glow units sit on the shell too (1) or stay where the natural surface has them (0)', type: 'number', min: 0, max: 1, step: 1, default: 1, adv: true },
    { key: 'shellTol', label: 'auto takes a shell when its model score is at least the natural surface\'s minus this (score: one hard fail ≈ 3; default 0.5 = a shell within the noise of the natural surface wins; negative = a shell must beat the natural surface by that much)', type: 'number', min: -5, max: 5, step: 0.1, default: 0.5, adv: true },
    { key: 'shellRank', label: 'Correction rounds of the short search that compares shells (−1 = by quality: fast 1, normal 2, best 3; with 1 a forced shell is not compared with the natural surface; the comparison is noisy: designs end on the edge of passing, so one row either way is not evidence)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'tryFit', label: 'auto tries the fitted conic', type: 'checkbox', default: true, adv: true },
    { key: 'tryParaboloid', label: 'auto tries a paraboloid', type: 'checkbox', default: true, adv: true },
    { key: 'trySphere', label: 'auto tries a sphere about the LED', type: 'checkbox', default: false, adv: true },
    { key: 'tryConic', label: 'auto tries the conic with the eccentricity above', type: 'checkbox', default: false, adv: true },
    { key: 'tryPlane', label: 'auto tries a flat plate behind the LED', type: 'checkbox', default: false, adv: true },
    { key: 'tryWall', label: 'auto tries the envelope wall (the deepest dish the envelope allows)', type: 'checkbox', default: true, adv: true },
  ];
  const SETTINGS_ALL = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'quality', label: 'Quality (fast ≈ 10 s, normal ≈ 35 s, best ≈ 65 s for 100 facets; measured in Node on a Mac mini M4, the browser worker is about as fast; the solve timer in the scene, default 120 s, cuts a run short)', type: 'select', default: 'normal', options: [{ value: 'fast', label: 'fast' }, { value: 'normal', label: 'normal' }, { value: 'best', label: 'best' }] },
    { key: 'facets', label: 'Facets to use (0 = the whole budget). ~16 gives a nominal beam, 40–50 starts to pass, 100 is the sweet spot, above ~300 is slow', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'peakCap', label: 'Peak intensity the ideal beam may ask for, cd (default 300,000; reasonable 50,000–600,000; the ideal beam is a pull toward brighter road light, the source and the dish decide what is reachable; far above ~600,000 it asks for more light than the source has)', type: 'number', min: 100, step: 1000, default: 300000 },
    { key: 'fluxFrac', label: 'Share of the light the dish can reach that the beam may use (default 0.7; reasonable 0.3–0.95; more = brighter beam and a bigger dish, less = a dimmer beam with more margin on the glare rows)', type: 'number', min: 0.02, max: 1, step: 0.01, default: 0.7 },
    { key: 'washCap', label: 'Foreground wash level the left-over light may fill, cd (default 12,000; reasonable 2,000–30,000)', type: 'number', min: 0, step: 500, default: 12000 },
    { key: 'margin', label: 'Design margin on every CEILING, × (default 1.2 = 20 % under the limit; reasonable 1.05–1.6; 1 = design to the limit)', type: 'number', min: 1, step: 0.05, default: 1.2 },
    { key: 'floorMargin', label: 'Design margin on every FLOOR, × (default 1.2; raise it if the rows come out dim: images spread over their cells, so the beam is dimmer than the ideal; reasonable 1.1–2)', type: 'number', min: 1, step: 0.05, default: 1.2 },
    { key: 'dimFrac', label: 'Largest share of the facets the dim glow units may take (default 0.2; reasonable 0–0.35)', type: 'number', min: 0, step: 0.01, default: 0.2 },
    { key: 'gamma', label: 'Road uniformity: illuminance falls as distance^−γ (default 0.8; 0 = even, 1 = typical halogen, reasonable 0–1.5)', type: 'number', min: 0, step: 0.05, default: 0.8, adv: true },
    { key: 'cutG', label: 'Cut-off sharpness the ideal beam is built with, log10 per 0.1° (default 0.34; the real edge comes out softer; the spec decides the allowed window)', type: 'number', min: 0.02, step: 0.01, default: 0.34, adv: true },
    { key: 'gTarget', label: 'Cut-off sharpness the corrections steer the real edge to (default 0.28)', type: 'number', min: 0.02, step: 0.01, default: 0.28, adv: true },
    { key: 'NA', label: 'Direction grid, polar bands (−1 = by quality; 150 → ~45,000 directions; cost grows with its square)', type: 'number', min: -1, step: 10, default: -1, adv: true },
    { key: 'iters', label: 'Correction rounds (−1 = by quality)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'sweeps', label: 'Aim polish sweeps per round (−1 = by quality)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'trustDeg', label: 'Largest aim tilt the polish may make in one round, degrees (default 0.6; a 0.4° tilt moves a 7 mm facet edge 0.02 mm)', type: 'number', min: 0, step: 0.05, default: 0.6, adv: true },
    { key: 'mainFill', label: 'Main images spread to this × their cell (default 1.5; fills the gaps between neighbours)', type: 'number', min: 0, step: 0.05, default: 1.5, adv: true },
    { key: 'dimFill', label: 'Dim glow images spread to this × their cell (default 1.35)', type: 'number', min: 0, step: 0.05, default: 1.35, adv: true },
    { key: 'softAll', label: 'Extra blur on every image, degrees 1σ (default 0.22; removes seams between tiles)', type: 'number', min: 0, step: 0.01, default: 0.22, adv: true },
    { key: 'dimTile', label: 'Dim region area per glow unit, deg² (default 10)', type: 'number', min: 0.5, step: 0.5, default: 10, adv: true },
    { key: 'slack', label: 'Light the dish covers vs what the ideal beam needs, × (default 1; more = a smaller dish, blurrier images)', type: 'number', min: 0.5, step: 0.05, default: 1, adv: true },
    { key: 'wBand', label: 'Polish: weight of floor/ceiling violations (default 150; rows count alike, not by area)', type: 'number', min: 0, step: 5, default: 150, adv: true },
    { key: 'wEdge', label: 'Polish: weight of tracking the ideal cut-off shape (default 3)', type: 'number', min: 0, step: 0.1, default: 3, adv: true },
    { key: 'leftLift', label: 'How far above the cut-off line the beam may reach on the oncoming side beyond ±4° from the axis, ° (default 0; range 0–0.6; lights the left road edge farther out; the judged cut-off columns at 1.5–3.5° stay on the line)', type: 'number', min: 0, max: 2, step: 0.02, default: 0, adv: true },
    { key: 'rightLift', label: 'How far above the cut-off line the beam may reach on the road side, ° (default 0 = the classic 15° ECE / US line; range 0–0.9; the spec reads the cut-off only on the oncoming side, so a higher road side could light the far right edge; 0.42 was tested and gave no gain once the aim guard was on)', type: 'number', min: 0, max: 2, step: 0.02, default: 0, adv: true },
    { key: 'rightSlope', label: 'Slope of the road-side cut-off up to that lift, ° per ° (default 1.0 = 45°; classic ECE 0.27)', type: 'number', min: 0.1, max: 5, step: 0.05, default: 1.0, adv: true },
    { key: 'guardLift', label: 'The aim guard starts this many degrees above where the cut-off tail has fallen to the guard level (default 0; range 0–1)', type: 'number', min: 0, max: 5, step: 0.05, default: 0, adv: true },
    { key: 'resBoost', label: 'Cell density boost above the foreground wash: more, smaller cells where the beam has structure (default 1 = off; range 1–10)', type: 'number', min: 1, max: 50, step: 0.5, default: 1, adv: true },
    { key: 'resV', label: 'Vertical angle in degrees above which the cell density boost applies (default -1.75)', type: 'number', min: -30, max: 10, step: 0.05, default: -1.75, adv: true },
    { key: 'naEval', label: 'Aperture samples per facet in the solver\'s own far-field model (−1 = by quality: fast 40, normal 100, best 150; reasonable 24–250; too few makes the model\'s cut-off look sharper than the real one and the polish then softens the real edge)', type: 'number', min: -1, max: 2000, step: 1, default: -1, adv: true },
    { key: 'push', label: 'Dish fill: push every facet outward along its rays by this share of the room the envelope leaves it (default 0 = the natural SQM surface, one continuous piece; 1 = as far as the envelope allows; the surface then has small steps between facets and the LED images shrink)', type: 'number', min: 0, max: 1, step: 0.05, default: 0, adv: true },
    { key: 'naFinal', label: 'Aperture samples per facet when the finished candidates are judged against each other (default 250; reasonable 100–600; 0 = same as the loop)', type: 'number', min: 0, max: 4000, step: 10, default: 250, adv: true },
    { key: 'alignGain', label: 'How hard the corrections pull the cut-off to one height in every scan column (default 0.8; 0 = off; range 0–3; helps the linearity row)', type: 'number', min: 0, max: 3, step: 0.1, default: 0.8, adv: true },
    { key: 'padH', label: 'Extra width in degrees on each side that the beam is designed over beyond the spec\'s window (default 0; range 0–20; 4 was tested and did not help; the left road edge 15 m ahead is 15.8° off axis, outside a ±15° window)', type: 'number', min: 0, max: 40, step: 0.5, default: 0, adv: true },
    { key: 'aimGuard', label: 'Glow allowed above the cut-off in the judge\'s aim columns, as a fraction of the column maximum (default 0.011; range 0–0.05; the stock cut-off finder ignores steps below 2 % of the column maximum, so noise in a glow near that level can move the aim by up to a degree; 0 = off)', type: 'number', min: 0, max: 0.2, step: 0.001, default: 0.011, adv: true },
    { key: 'guardCarry', label: 'Aim guard, two passes: 1 = the ideal beam is rebuilt with the caps of the first pass already in place, so its edge is tuned with them (default 1; measured better on the ECE scenes), 0 = the caps are only applied at the end', type: 'number', min: 0, max: 1, step: 1, default: 1, adv: true },
    { key: 'seedGain', label: 'Dim glow units carry this × the floor they must reach (default 1.6; higher keeps floors safe but lifts the glow toward the judge\'s 2 % gate)', type: 'number', min: 0.5, step: 0.1, default: 1.6, adv: true },
    { key: 'wPaint', label: 'Paint mode: weight of tracking the painting in the polish (default 1.5)', type: 'number', min: 0, step: 0.1, default: 1.5, adv: true },
    { key: 'wTrack', label: 'Polish: weight of tracking the ideal beam elsewhere (default 0.03)', type: 'number', min: 0, step: 0.01, default: 0.03, adv: true },
    { key: 'search', label: 'Shaping candidates to try (−1 = by quality; each is a full polish on the same surface, the best by the noise-free model wins; max 10)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'traces', label: 'Verification traces at the end (−1 = by quality; each ≤ 2 M rays; the report quotes a loose verdict: value ± 1σ inside the limit)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'traceRays', label: 'Rays per verification trace (−1 = by quality)', type: 'number', min: -1, step: 100000, default: -1, adv: true },
  ];
  // the dish solver: the shell group right after the facet count (tier 1), its parameters at the end of tier 2
  // the ideal variant: how the goals shape the ideal beam (the goals themselves are the Spec tab's "Ideal beam" knobs)
  const IDEAL1 = [
    { key: 'overshoot', label: 'Hotspot overshoot, degrees: the ideal beam puts the hotspot top this far above the goal, because the built reflector lands it lower (default 0.55, the loss measured on three test scenes, 10-09; 0 = measure it: solve once at 0.55, read the loss on the model, solve again at that overshoot; doubles the time)', type: 'number', min: 0, max: 1.5, step: 0.05, default: 0.55 },
    { key: 'leftover', label: 'Light the road cannot use: hotspot = widen the hotspot to ±5°, then brighten it, then the foreground up to the goals\' cap; uncollected = plain SQM\'s foreground (capped at the goals\' share) and the rest left uncollected', type: 'select', default: 'hotspot', options: [{ value: 'hotspot', label: 'into the hotspot' }, { value: 'uncollected', label: 'uncollected (like plain SQM)' }] },
    { key: 'hotGain', label: 'How much brighter than the road plateau the hotspot may get with left-over light (× its level; default 4 ≈ no cap: the spec\'s ceilings stop it first; a low cap leaves light uncollected and the dish shrinks)', type: 'number', min: 1, max: 8, step: 0.1, default: 4, adv: true },
  ];
  const SETTINGS = IDEAL ? (() => { const i = SETTINGS_ALL.findIndex((f) => f.key === 'washCap') + 1; return SETTINGS_ALL.slice(0, i).concat(IDEAL1, SETTINGS_ALL.slice(i)); })() : !DISH ? SETTINGS_ALL : (() => { const i = SETTINGS_ALL.findIndex((f) => f.key === 'facets') + 1, out = SETTINGS_ALL.slice(0, i).concat(SHELL1, SETTINGS_ALL.slice(i)); return out.concat(SHELL2); })();

  const loose = (r) => { if (!isFinite(r.value) || !(r.bound > 0 || r.unit === 'deg')) return 'unsure'; const sd = r.sd || 0; const ok = r.isMin ? r.value - sd >= r.bound : r.value + sd <= r.bound, bad = r.isMin ? r.value < r.bound / 10 : r.value > r.bound * 10; return bad ? 'fail' : ok ? 'pass' : 'near'; };

  function solve(input, set, tools) {
    const q = QUALITY[set.quality] || QUALITY.normal, S = {};
    for (const k of ['NA', 'iters', 'sweeps', 'search', 'naEval', 'traces', 'traceRays']) S[k] = set[k] >= 0 && set[k] !== undefined && !(set[k] === -1) ? set[k] : q[k];
    Object.assign(S, { N: set.facets > 0 ? set.facets : 0, peakCap: set.peakCap, fluxFrac: set.fluxFrac, washCap: set.washCap, margin: set.margin, floorMargin: set.floorMargin, dimFrac: set.dimFrac, dimTile: set.dimTile, dimFill: set.dimFill, mainFill: set.mainFill, softAll: set.softAll, slack: set.slack,
      gd: set.cutG, gTarget: set.gTarget, maxShift: set.trustDeg, wBand: set.wBand, wEdge: set.wEdge, wTrack: set.wTrack, wPaint: set.wPaint, seedGain: set.seedGain, aimGuard: set.aimGuard, guardCarry: set.guardCarry, padH: set.padH, alignGain: set.alignGain, naFinal: set.naFinal, push: set.push, guardLift: set.guardLift, resBoost: set.resBoost, resV: set.resV, rightLift: set.rightLift, leftLift: set.leftLift, rightSlope: set.rightSlope, gamma: set.gamma, NAcoarse: Math.max(40, Math.round(S.NA * 0.4)), minDistance: set.minDistance });
    if (DISH) { const tries = ['fit', 'paraboloid', 'sphere', 'conic', 'plane', 'wall'].filter((k) => set['try' + k[0].toUpperCase() + k.slice(1)]); Object.assign(S, { shell: set.shell, shellMix: set.shellMix, shellMaxStep: set.shellMaxStep, shellP: set.shellP, shellE: set.shellE, shellAxis: set.shellAxis, shellTiltV: set.shellTiltV, shellTiltH: set.shellTiltH, shellFill: set.shellFill, shellDecals: set.shellDecals, shellRank: set.shellRank >= 1 ? set.shellRank : q.shellRank, shellTol: set.shellTol, shellTry: tries.join(',') }); }
    if (IDEAL) Object.assign(S, { overshoot: set.overshoot, leftover: set.leftover, hotGain: set.hotGain });
    const prog = (f, s) => { if (tools && tools.progress) tools.progress(f, s); };
    S.progress = prog; S.preview = tools && tools.preview && !tools.preview.none ? tools.preview : null; S.budgetMs = tools && tools.budget && isFinite(tools.budget.ms) ? tools.budget.ms : 120000;
    const t0 = Date.now(), out = RF.SqmPipe.solve(input, S, tools), P = out.P, notes = [];
    const surfaces = out.surfaces.map((f) => { const g = { type: 'facet', id: f.id, P: f.P, S0: f.S0, Z: f.Z, flat: false, di: f.di, clip: f.clip, optics: f.optics }; if (f.vg) { g.vg = f.vg; g.ax = f.ax; } return g; });
    const m = out.final || out.best.m; if (P.isPaint) notes.push('paint mode: no beam specification, the target is the painting (the plane is modelled as seen from the source; tilted planes are approximated)'); notes.push(`${surfaces.length} facets of one continuous surface (${P.A.length} cells + ${P.Ad.length} dim units); the dish covers ${out.cover.toFixed(0)} of the LED's ${out.Mtot.toFixed(0)} lm, the beam asks for ${P.des.flux.toFixed(0)} lm in the window`);
    if (!P.isPaint) notes.push(`model (noise-free) verdict on the finished design: ${m.ev.verdict} ${JSON.stringify(m.ev.n)}, worst margin ${m.worst.toFixed(2)} decades` + (m.ev.rows.filter((r) => r.verdict !== 'pass').length ? ' — ' + m.ev.rows.filter((r) => r.verdict !== 'pass').map((r) => `${r.name} ${(+r.value).toPrecision(3)} ${r.isMin ? '≥' : '≤'} ${(+r.bound).toPrecision(3)}`).join('; ') : ''));
    if (out.trace) { const tr = out.trace.spec; notes.push(`traced at ${(out.trace.rays / 1e6).toFixed(1)} M rays, read at the model's aim (${out.trace.aim.map((x) => x.toFixed(2)).join(', ')}°): ${tr.n.pass} pass · ${tr.n.fail} fail · ${tr.n.unsure} unsure by the stock rule; loose bar (value ± 1σ inside the limit): ${out.trace.loose.pass} pass · ${out.trace.loose.near} near · ${out.trace.loose.fail} off`); }
    if (out.ideal) { const L = RF.SqmIdeal.line, d = out.ideal.d; notes.push(`ideal-beam goals on the ideal beam T*: ${L(out.ideal.rT)}; on the finished model: ${L(out.ideal.rM)}`); notes.push(`ideal beam: hotspot ${Math.round(d.Lh * d.level)} cd (road level ${Math.round(d.Lh)} × ${d.level.toFixed(2)}), left-over light ${d.mode === 'uncollected' ? 'left uncollected' : d.s <= 0 ? (d.s < 0 ? 'none (the goal shapes alone are over budget; hotspot dimmed)' : 'none') : d.s <= 1 ? 'widened the hotspot ' + Math.round(100 * d.s) + ' % of the way to ±5°' : 'widened the hotspot to ±5° and brightened it'}; foreground ${Math.round(100 * d.fgShare)} % of T*'s lumens; overshoot ${out.ideal.over.toFixed(2)}°` + (d.relCaps && d.relCaps.length ? '; relative ceilings from T* itself: ' + d.relCaps.map((c) => `${c.name} ≤ ${c.cap} cd (${c.ref} = ${c.at})`).join(', ') : '')); }
    for (const n of P.notes) notes.push(n);
    notes.push(`time ${((Date.now() - t0) / 1000).toFixed(1)} s` + (out.timing ? ' (' + out.timing + ')' : ''));
    return { surfaces, notes, extras: { model: { verdict: m.ev.verdict, n: m.ev.n }, shell: P.shellReport || null } };
  }
  RF.Solvers.register({ id: ID, name: DISH ? 'SQM headlamp, any base shell (arbitrary dish)' : IDEAL ? 'SQM headlamp, ideal beam (shaped by the ideal-beam goals)' : 'SQM headlamp (continuous reflector)', version: VERSION, modes: ['paint'], settings: SETTINGS, solve });
  RF.SqmSolver = { solve, SETTINGS, QUALITY, loose };
})();
