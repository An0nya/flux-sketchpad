/* solve-worker.js — runs loaded (untrusted) solvers off the page.  It has the engine but no DOM, so a
 * solver here can't touch the page, the grader or the tracer the host scores it with.
 *   → { type: 'load', src }                         ← { type: 'loaded', defs: [{ id, name, version, modes, settings }] } | { type: 'error' }
 *   → { type: 'solve', id, input, settings, scene, budget }  ← { type: 'progress', pct } … { type: 'done', output } | { type: 'error' } */
'use strict';
importScripts('solver-env.js'); importScripts(...self.RF_SOLVER_ENV.map((f) => f + '.js'));   // the same list the runner and scorer use
const RF = self.RF;
const meta = (d) => ({ id: d.id, name: d.name, version: d.version, modes: d.modes, settings: d.settings });
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const before = new Set(RF.Solvers.list().map((d) => d.id));
      importScripts(URL.createObjectURL(new Blob([m.src], { type: 'text/javascript' })));
      const defs = RF.Solvers.list().filter((d) => !before.has(d.id)).map(meta);
      if (!defs.length) throw new Error('the file did not call RF.Solvers.register(...)');
      self.postMessage({ type: 'loaded', defs });
    } else if (m.type === 'solve') {
      const def = RF.Solvers.get(m.id); if (!def) throw new Error('solver ' + m.id + ' is not loaded in the worker');
      let raysUsed = 0;
      const tools = {
        progress: (pct) => self.postMessage({ type: 'progress', pct: +pct || 0 }),
        budget: m.budget,
        trace: (surfaces, o) => { const n = Math.max(1, (o && o.rays) | 0 || 20000); raysUsed += n; if (raysUsed > m.budget.rays) throw new Error('ray budget exhausted (' + m.budget.rays.toLocaleString() + ')'); return RF.Solvers.trace(m.scene, surfaces, o); },
      };
      const output = await def.solve(m.input, m.settings, tools);
      self.postMessage({ type: 'done', output, raysUsed });
    }
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
