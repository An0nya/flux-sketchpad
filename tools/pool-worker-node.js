// Node end of the solver task pool (js/solver-pool.js): worker_threads that load the same js/ files as a solve worker.
//   const { spawner } = require('./pool-worker-node.js'); const spawn = spawner();   → pass as create({ size, spawn, … })
// (the page's end is js/solver-pool-worker.js).  Used by tests/bench and tools/flux.js.
'use strict';
const path = require('path'), { Worker } = require('worker_threads');
const ROOT = path.join(__dirname, '..');
const CODE = `
const { parentPort, workerData } = require('worker_threads'), fs = require('fs'), path = require('path'), vm = require('vm');
const js = (f) => { const p = path.join(workerData.root, 'js', f + '.js'); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); };
js('solver-env'); for (const f of globalThis.RF_SOLVER_ENV) js(f); js('solver-pool');
const handle = globalThis.RF.SolverPool.workerHandler((src) => vm.runInThisContext(src), (o) => parentPort.postMessage(o));
parentPort.on('message', handle);`;
function spawner() {
  return () => {
    const w = new Worker(CODE, { eval: true, workerData: { root: ROOT } }), h = { post: (m) => w.postMessage(m), terminate: () => w.terminate(), onmessage: null, onerror: null };
    w.on('message', (d) => h.onmessage && h.onmessage(d)); w.on('error', (e) => h.onerror && h.onerror(String(e && e.message || e)));
    return h;
  };
}
module.exports = { spawner };
