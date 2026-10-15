/* Separate from the solver worker: comparison never interrupts a solve. */
'use strict';
importScripts('solver-env.js'); importScripts(...self.RF_SOLVER_ENV.map((f) => f + '.js'));
importScripts('state.js', 'compare.js');
self.onmessage = (e) => {
  try { self.postMessage({ result: self.RF.Compare.run(e.data.a, e.data.b, Object.assign({}, e.data.options, { maps: true })) }); }
  catch (err) { self.postMessage({ error: String(err.message || err) }); }
};
