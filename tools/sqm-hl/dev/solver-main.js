/* solver-main.js — registration, settings, quality presets, notes.  The solver proper is RF.SqmPipe (pipeline.js). */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V;
  const ID = 'sqm-hl', VERSION = '0.1';

  // quality presets: what each tier spends (directions, correction rounds, polish sweeps, verification traces)
  const QUALITY = {
    fast:   { NA: 110, NAcoarse: 50, iters: 4, sweeps: 3, traces: 0, traceRays: 0 },
    normal: { NA: 150, NAcoarse: 60, iters: 6, sweeps: 5, traces: 1, traceRays: 1000000 },
    best:   { NA: 220, NAcoarse: 80, iters: 10, sweeps: 8, traces: 2, traceRays: 2000000 },
  };
  // [key, label, type, default, extra] — tier 1 first (constraints, quality, the beam's goals), then tier 2 (everything the algorithm decides by itself; adv: true)
  const SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'quality', label: 'Quality (fast ≈ 10 s, normal ≈ 20 s, best ≈ 45 s for 100 facets; Node timings)', type: 'select', default: 'normal', options: [{ value: 'fast', label: 'fast' }, { value: 'normal', label: 'normal' }, { value: 'best', label: 'best' }] },
    { key: 'facets', label: 'Facets to use (0 = the whole budget). ~16 gives a nominal beam, 40–50 starts to pass, 100 is the sweet spot, above ~300 is slow', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'peakCap', label: 'Peak intensity the ideal beam may ask for, cd (default 80,000; reasonable 20,000–200,000; the étendue of the source and the dish decide what is reachable)', type: 'number', min: 100, step: 1000, default: 80000 },
    { key: 'washCap', label: 'Foreground wash level the left-over light may fill, cd (default 12,000; reasonable 2,000–30,000)', type: 'number', min: 0, step: 500, default: 12000 },
    { key: 'margin', label: 'Design margin on every floor and ceiling, × (default 1.2 = 20 %; reasonable 1.05–1.6; 1 = design to the limit)', type: 'number', min: 1, step: 0.05, default: 1.2 },
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
    { key: 'wBand', label: 'Polish: weight of floor/ceiling violations (default 8)', type: 'number', min: 0, step: 0.5, default: 8, adv: true },
    { key: 'wEdge', label: 'Polish: weight of tracking the ideal cut-off shape (default 3)', type: 'number', min: 0, step: 0.1, default: 3, adv: true },
    { key: 'wPaint', label: 'Paint mode: weight of tracking the painting in the polish (default 1.5)', type: 'number', min: 0, step: 0.1, default: 1.5, adv: true },
    { key: 'wTrack', label: 'Polish: weight of tracking the ideal beam elsewhere (default 0.03)', type: 'number', min: 0, step: 0.01, default: 0.03, adv: true },
    { key: 'traces', label: 'Verification traces at the end (−1 = by quality; each ≤ 2 M rays; the report quotes a loose verdict: value ± 1σ inside the limit)', type: 'number', min: -1, step: 1, default: -1, adv: true },
    { key: 'traceRays', label: 'Rays per verification trace (−1 = by quality)', type: 'number', min: -1, step: 100000, default: -1, adv: true },
  ];

  const loose = (r) => { if (!isFinite(r.value) || !(r.bound > 0 || r.unit === 'deg')) return 'unsure'; const sd = r.sd || 0; const ok = r.isMin ? r.value - sd >= r.bound : r.value + sd <= r.bound, bad = r.isMin ? r.value < r.bound / 10 : r.value > r.bound * 10; return bad ? 'fail' : ok ? 'pass' : 'near'; };

  function solve(input, set, tools) {
    const q = QUALITY[set.quality] || QUALITY.normal, S = {};
    for (const k of ['NA', 'iters', 'sweeps', 'traces', 'traceRays']) S[k] = set[k] >= 0 && set[k] !== undefined && !(set[k] === -1) ? set[k] : q[k];
    Object.assign(S, { N: set.facets > 0 ? set.facets : 0, peakCap: set.peakCap, washCap: set.washCap, margin: set.margin, dimFrac: set.dimFrac, dimTile: set.dimTile, dimFill: set.dimFill, mainFill: set.mainFill, softAll: set.softAll, slack: set.slack,
      gd: set.cutG, gTarget: set.gTarget, maxShift: set.trustDeg, wBand: set.wBand, wEdge: set.wEdge, wTrack: set.wTrack, wPaint: set.wPaint, gamma: set.gamma, NAcoarse: Math.max(40, Math.round(S.NA * 0.4)), minDistance: set.minDistance });
    const prog = (f, s) => { if (tools && tools.progress) tools.progress(f, s); };
    S.progress = prog; S.preview = tools && tools.preview && !tools.preview.none ? tools.preview : null; S.budgetMs = tools && tools.budget && isFinite(tools.budget.ms) ? tools.budget.ms : 120000;
    const t0 = Date.now(), out = RF.SqmPipe.solve(input, S, tools), P = out.P, notes = [];
    const surfaces = out.surfaces.map((f) => { const g = { type: 'facet', id: f.id, P: f.P, S0: f.S0, Z: f.Z, flat: false, di: f.di, clip: f.clip, optics: f.optics }; if (f.vg) { g.vg = f.vg; g.ax = f.ax; } return g; });
    const m = out.best.m; if (P.isPaint) notes.push('paint mode: no beam specification, the target is the painting (the plane is modelled as seen from the source; tilted planes are approximated)'); notes.push(`${surfaces.length} facets of one continuous surface (${P.A.length} cells + ${P.Ad.length} dim units); the dish covers ${out.cover.toFixed(0)} of the LED's ${out.Mtot.toFixed(0)} lm, the beam asks for ${P.des.flux.toFixed(0)} lm in the window`);
    if (!P.isPaint) notes.push(`model (noise-free) verdict: ${m.ev.verdict} ${JSON.stringify(m.ev.n)}, worst margin ${m.worst.toFixed(2)} decades` + (m.ev.rows.filter((r) => r.verdict !== 'pass').length ? ' — ' + m.ev.rows.filter((r) => r.verdict !== 'pass').map((r) => `${r.name} ${(+r.value).toPrecision(3)} ${r.isMin ? '≥' : '≤'} ${(+r.bound).toPrecision(3)}`).join('; ') : ''));
    if (out.trace) { const tr = out.trace.spec; notes.push(`traced at ${(out.trace.rays / 1e6).toFixed(1)} M rays: ${tr.n.pass} pass · ${tr.n.fail} fail · ${tr.n.unsure} unsure (loose bar: value ± 1σ inside the limit → ${out.trace.loose.pass} pass · ${out.trace.loose.near} near · ${out.trace.loose.fail} off)`); }
    for (const n of P.notes) notes.push(n);
    notes.push(`time ${((Date.now() - t0) / 1000).toFixed(1)} s` + (out.timing ? ' (' + out.timing + ')' : ''));
    return { surfaces, notes, extras: { model: { verdict: m.ev.verdict, n: m.ev.n } } };
  }
  RF.Solvers.register({ id: ID, name: 'SQM headlamp (continuous reflector)', version: VERSION, modes: ['paint'], settings: SETTINGS, solve });
  RF.SqmSolver = { solve, SETTINGS, QUALITY, loose };
})();
