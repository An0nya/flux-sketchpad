/* solver-main.js — registration, settings, quality presets, notes.  The solver proper is RF.SqmPipe (pipeline.js). */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;
  const ID = 'sqm-hl', VERSION = '0.2';

  // quality presets: what each tier spends (directions, correction rounds, polish sweeps, verification traces)
  const QUALITY = {
    fast:   { NA: 110, NAcoarse: 50, iters: 4, sweeps: 3, search: 1, naEval: 40, traces: 0, traceRays: 0 },
    normal: { NA: 150, NAcoarse: 60, iters: 6, sweeps: 5, search: 4, naEval: 100, traces: 1, traceRays: 1000000 },
    best:   { NA: 220, NAcoarse: 80, iters: 10, sweeps: 8, search: 8, naEval: 150, traces: 2, traceRays: 2000000 },
  };
  // [key, label, type, default, extra] — tier 1 first (constraints, quality, the beam's goals), then tier 2 (everything the algorithm decides by itself; adv: true)
  const SETTINGS = [
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

  const loose = (r) => { if (!isFinite(r.value) || !(r.bound > 0 || r.unit === 'deg')) return 'unsure'; const sd = r.sd || 0; const ok = r.isMin ? r.value - sd >= r.bound : r.value + sd <= r.bound, bad = r.isMin ? r.value < r.bound / 10 : r.value > r.bound * 10; return bad ? 'fail' : ok ? 'pass' : 'near'; };

  function solve(input, set, tools) {
    const q = QUALITY[set.quality] || QUALITY.normal, S = {};
    for (const k of ['NA', 'iters', 'sweeps', 'search', 'naEval', 'traces', 'traceRays']) S[k] = set[k] >= 0 && set[k] !== undefined && !(set[k] === -1) ? set[k] : q[k];
    Object.assign(S, { N: set.facets > 0 ? set.facets : 0, peakCap: set.peakCap, fluxFrac: set.fluxFrac, washCap: set.washCap, margin: set.margin, floorMargin: set.floorMargin, dimFrac: set.dimFrac, dimTile: set.dimTile, dimFill: set.dimFill, mainFill: set.mainFill, softAll: set.softAll, slack: set.slack,
      gd: set.cutG, gTarget: set.gTarget, maxShift: set.trustDeg, wBand: set.wBand, wEdge: set.wEdge, wTrack: set.wTrack, wPaint: set.wPaint, seedGain: set.seedGain, aimGuard: set.aimGuard, guardCarry: set.guardCarry, padH: set.padH, alignGain: set.alignGain, naFinal: set.naFinal, push: set.push, guardLift: set.guardLift, resBoost: set.resBoost, resV: set.resV, rightLift: set.rightLift, leftLift: set.leftLift, rightSlope: set.rightSlope, gamma: set.gamma, NAcoarse: Math.max(40, Math.round(S.NA * 0.4)), minDistance: set.minDistance });
    const prog = (f, s) => { if (tools && tools.progress) tools.progress(f, s); };
    S.progress = prog; S.preview = tools && tools.preview && !tools.preview.none ? tools.preview : null; S.budgetMs = tools && tools.budget && isFinite(tools.budget.ms) ? tools.budget.ms : 120000;
    const t0 = Date.now(), out = RF.SqmPipe.solve(input, S, tools), P = out.P, notes = [];
    const surfaces = out.surfaces.map((f) => { const g = { type: 'facet', id: f.id, P: f.P, S0: f.S0, Z: f.Z, flat: false, di: f.di, clip: f.clip, optics: f.optics }; if (f.vg) { g.vg = f.vg; g.ax = f.ax; } return g; });
    const m = out.final || out.best.m; if (P.isPaint) notes.push('paint mode: no beam specification, the target is the painting (the plane is modelled as seen from the source; tilted planes are approximated)'); notes.push(`${surfaces.length} facets of one continuous surface (${P.A.length} cells + ${P.Ad.length} dim units); the dish covers ${out.cover.toFixed(0)} of the LED's ${out.Mtot.toFixed(0)} lm, the beam asks for ${P.des.flux.toFixed(0)} lm in the window`);
    if (!P.isPaint) notes.push(`model (noise-free) verdict on the finished design: ${m.ev.verdict} ${JSON.stringify(m.ev.n)}, worst margin ${m.worst.toFixed(2)} decades` + (m.ev.rows.filter((r) => r.verdict !== 'pass').length ? ' — ' + m.ev.rows.filter((r) => r.verdict !== 'pass').map((r) => `${r.name} ${(+r.value).toPrecision(3)} ${r.isMin ? '≥' : '≤'} ${(+r.bound).toPrecision(3)}`).join('; ') : ''));
    if (out.trace) { const tr = out.trace.spec; notes.push(`traced at ${(out.trace.rays / 1e6).toFixed(1)} M rays, read at the model's aim (${out.trace.aim.map((x) => x.toFixed(2)).join(', ')}°): ${tr.n.pass} pass · ${tr.n.fail} fail · ${tr.n.unsure} unsure by the stock rule; loose bar (value ± 1σ inside the limit): ${out.trace.loose.pass} pass · ${out.trace.loose.near} near · ${out.trace.loose.fail} off`); }
    for (const n of P.notes) notes.push(n);
    notes.push(`time ${((Date.now() - t0) / 1000).toFixed(1)} s` + (out.timing ? ' (' + out.timing + ')' : ''));
    return { surfaces, notes, extras: { model: { verdict: m.ev.verdict, n: m.ev.n } } };
  }
  RF.Solvers.register({ id: ID, name: 'SQM headlamp (continuous reflector)', version: VERSION, modes: ['paint'], settings: SETTINGS, solve });
  RF.SqmSolver = { solve, SETTINGS, QUALITY, loose };
})();
