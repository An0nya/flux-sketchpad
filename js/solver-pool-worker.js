/* solver-pool-worker.js — one worker of a solver's task pool (js/solver-pool.js), started from the solve worker.  Same RF as the solve worker. */
'use strict';
importScripts('solver-env.js'); importScripts(...self.RF_SOLVER_ENV.map((f) => f + '.js')); importScripts('solver-pool.js');
const handle = self.RF.SolverPool.workerHandler((src) => importScripts(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))), (o) => self.postMessage(o));
self.onmessage = (e) => handle(e.data);
