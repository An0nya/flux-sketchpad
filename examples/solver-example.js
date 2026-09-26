/* solver-example.js — a template for a self-contained solver.  Load it from Reference & debug → Solver
 * → "Load solver file…".  It runs in a Web Worker: no DOM, no page access; the engine is available as
 * RF.* (RF.V vectors, RF.Geo, RF.Engine, RF.Solver helpers, RF.ModeA the default solver's core).
 *
 * This one reuses the default solver, then spends ONE cheap trace on a feedback pass: facets whose light
 * mostly misses the target are dropped (a real, if crude, use of tools.trace + per-facet attribution). */
RF.Solvers.register({
  id: 'example-feedback', name: 'Example: spoke + 1 feedback pass', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'budget', label: 'Facet budget', type: 'range', min: 1, max: 500, step: 1, default: 100 },
    { key: 'minOnTarget', label: 'Drop facets landing under', type: 'number', min: 0, max: 1, step: 0.05, default: 0.3, help: 'share of a facet’s caught light that must land' },
    { key: 'feedback', label: 'Feedback pass', type: 'checkbox', default: true },
  ],
  solve(input, s, tools) {
    const scene = { source: input.source, target: input.target, envelope: input.envelope,
      modeA: { paint: input.paint.cells, budget: s.budget, facetType: 'curved', reflectivity: 0.9 } };
    const g = RF.ModeA.generate(scene);
    tools.progress(0.5);
    let surfaces = g.surfaces, intent = g.intent, notes = [];
    if (s.feedback && surfaces.length) {
      const t = tools.trace(surfaces, { rays: 20000, attribution: true });   // same seed every call: common random numbers
      const perRay = input.source.power / 20000, caught = {};
      // expected light per facet ≈ its flux share; landed = what attribution says reached the target
      for (const f of surfaces) caught[f.id] = (f.info && f.info.flux || 0) * input.source.power * 0.9;
      const keep = new Set(surfaces.filter((f) => !(caught[f.id] > 5 * perRay) || (t.perFacet[f.id] || 0) >= s.minOnTarget * caught[f.id]).map((f) => f.id));
      notes.push('feedback: dropped ' + (surfaces.length - keep.size) + ' facet(s) landing under ' + Math.round(100 * s.minOnTarget) + '% (trace noise ±' + Math.round(100 * t.noise) + '%/cell)');
      surfaces = surfaces.filter((f) => keep.has(f.id));
      intent = intent.map((it) => (it.facet && !keep.has(it.facet) ? { facet: null, cells: it.cells } : it));
    }
    tools.progress(1);
    return { surfaces, intent, notes };
  },
});
