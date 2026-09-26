/* solver-env.js — the files a solver can rely on, in load order.  ONE list, used by the browser worker
 * (js/solve-worker.js), the headless runner (tools/run-solver.js) and the benchmark scorer, so a solver
 * sees the same RF everywhere.  Everything a solver may use must be in here — nothing with a DOM. */
(function (root) { root.RF_SOLVER_ENV = ['core', 'geometry', 'source', 'engine', 'solver', 'modeA', 'photometry', 'solvers', 'solver-spoke']; })(typeof globalThis !== 'undefined' ? globalThis : this);
