/* solver-host.js — the page side of loaded solvers.  One worker holds every loaded solver; the page
 * registers a PROXY for each (same id, name, settings schema) whose solve() posts to the worker, so the
 * rest of the app — sidebar, verify, reports — can't tell a loaded solver from a built-in one, while
 * the loaded code itself never runs on the page.  Sources persist per browser (localStorage) so a
 * reload keeps them.  Budget: the worker is terminated (and restarted, sources reloaded) on overrun. */
(function (root) {
  'use strict';
  const RF = root.RF;
  const KEY = 'flux/solvers', BUDGET = { ms: 60000, rays: 2e7 };
  let worker = null, sources = [], srcIds = [], pending = null, cancel = null;   // srcIds[i] = the solver ids sources[i] registered
  function spawn() {
    worker = new Worker('js/solve-worker.js');
    worker.onmessage = (e) => { if (pending) pending(e.data); };
    // a worker that crashes (e.g. an environment file throwing on load) must fail the request, not hang it
    worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); const why = 'solver worker crashed: ' + ((e && e.message) || 'unknown error'); worker = null; if (cancel) cancel(why); };
  }
  function ask(msg, onProgress, ms) {
    if (!worker) spawn();
    return new Promise((resolve, reject) => {
      const timer = ms ? setTimeout(() => { pending = null; cancel = null; if (worker) worker.terminate(); worker = null; reload(); reject(new Error('solver ran over its ' + Math.round(ms / 1000) + ' s budget and was stopped')); }, ms) : 0;
      cancel = (why) => { clearTimeout(timer); pending = null; cancel = null; reject(new Error(why)); };   // forget() mid-solve
      pending = (d) => {
        if (d.type === 'progress') { if (onProgress) onProgress(d.pct); return; }
        clearTimeout(timer); pending = null; cancel = null;
        if (d.type === 'error') reject(new Error(d.message)); else resolve(d);
      };
      worker.postMessage(msg);
    });
  }
  function proxy(def) {
    RF.Solvers.register(Object.assign({}, def, {
      loaded: true,
      solve(input, settings, tools) {
        const scene = tools.scene;                  // the host passes the problem scene for trace()
        return ask({ type: 'solve', id: def.id, input, settings, scene, budget: BUDGET }, tools.progress, BUDGET.ms).then((d) => d.output);
      },
    }));
  }
  async function load(src) {
    const d = await ask({ type: 'load', src });
    for (const def of d.defs) proxy(def);
    // a new version replaces the old one: drop earlier sources that registered any of the same ids
    const mine = new Set(d.defs.map((x) => x.id)), keep = [], keepIds = [];
    sources.forEach((s, i) => { if (!(srcIds[i] || []).some((id) => mine.has(id))) { keep.push(s); keepIds.push(srcIds[i]); } });
    sources = keep.concat(src); srcIds = keepIds.concat([[...mine]]); save();
    return d.defs;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(sources)); } catch (e) { /* ignore */ } }
  async function reload() {                        // after a restart: reload every saved source quietly
    const all = sources; sources = []; srcIds = [];
    for (const src of all) { try { await load(src); } catch (e) { /* a source that no longer loads is dropped */ } }
  }
  async function restore() { try { sources = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { sources = []; } await reload(); }
  function forget() { if (cancel) cancel('the loaded solvers were forgotten'); sources = []; srcIds = []; save(); if (worker) { worker.terminate(); worker = null; } for (const d of RF.Solvers.list()) if (d.loaded) RF.Solvers.unregister(d.id); }
  RF.SolverHost = { load, restore, forget, BUDGET };
})(typeof globalThis !== 'undefined' ? globalThis : this);
