/* solver-spoke.js — the default solver ("spoke v1") through the solver interface.  A thin adapter over
 * modeA.js (spokes of tailored micro-facet curves, equal-flux facets, orientation-preserving zone
 * partition, per-zone curvature).  Its settings are stored in scene.modeA (see Solvers.settingsOf). */
(function (root) {
  'use strict';
  const RF = root.RF;
  RF.Solvers.register({
    id: 'spoke', name: 'Spoke (default)', version: '1.1', modes: ['paint'],
    settings: [
      { key: 'budget', label: 'Facet budget', type: 'range', min: 1, max: 2000, step: 1, default: 48, help: 'How many facets you are willing to make.' },
      { key: 'facetType', label: 'Facets', type: 'select', options: [{ value: 'curved', label: 'curved' }, { value: 'flat', label: 'flat' }], default: 'curved' },
      { key: 'reflectivity', label: 'Reflectivity', type: 'number', min: 0, max: 1, step: 0.01, default: 0.9 },
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'Keep facets at least this far from the LED: farther facets paint sharper images, nearer ones catch more light in tight corners.' },
    ],
    solve(input, s) {
      const scene = { source: input.source, target: input.target, envelope: input.envelope,
        modeA: { paint: input.paint.cells, budget: s.budget, facetType: s.facetType, reflectivity: s.reflectivity, minDistance: s.minDistance } };
      const g = RF.ModeA.generate(scene);
      return { surfaces: g.surfaces, intent: g.intent, notes: g.report.warnings || [], extras: g.report };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
