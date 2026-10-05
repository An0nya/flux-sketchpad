/* solver-host.js — the page side of worker solvers.  One worker holds every solver that isn't built into the page:
 * the BUNDLED model solvers (solvers/index.json, fetched at boot, never stored) and the user's LOADED files
 * (persisted per browser in localStorage).  The page registers a PROXY for each (same id, name, settings schema)
 * whose solve() posts to the worker, so the rest of the app — sidebar, verify, reports — can't tell a worker
 * solver from a built-in one, while that code never runs on the page.
 * One solve at a time.  abort() stops it by terminating the worker (the only way to stop running JS); the worker
 * is then rebuilt from the same sources, and the next solve waits for that (`ready`).  Budget overrun = abort.
 * A stopped solve rejects with { aborted: true, kind }: kind 'timeout' (over BUDGET.ms), 'crash' (the worker died),
 * 'user' / 'replaced' / 'forgotten' (whatever the caller passed to abort()).  tools.preview (when the page passes one)
 * receives the worker's throttled preview messages (SOLVER_API.md § "Watching a solve").  */
(function (root) {
  'use strict';
  const RF = root.RF;
  const KEY = 'flux/solvers', BUDGET = { ms: 120000, rays: 5e7 };
  // the user's time limit (Simulation → Solve time limit, remembered per browser): a property of the machine, not the scene
  let userMs = 0; try { userMs = +localStorage.getItem('flux/solveLimitMs') || 0; } catch (e) { /* default */ }
  const limitMs = () => testMs || userMs || BUDGET.ms;
  const setLimit = (ms) => { userMs = Math.max(0, +ms || 0); try { localStorage.setItem('flux/solveLimitMs', String(userMs)); } catch (e) { /* ignore */ } };
  let worker = null, sources = [], srcIds = [], bundled = [], pending = null, cancel = null, ready = Promise.resolve(), live = null, testMs = 0, loading = typeof Worker !== "undefined";   // true from page load until restore() has the bundled solvers in
  // sources[i] = a loaded file's text, srcIds[i] = the ids it registered;  bundled = [{ src, meta }] from solvers/
  function spawn() {
    worker = new Worker('js/solve-worker.js');
    worker.onmessage = (e) => { if (pending) pending(e.data); };
    // a worker that crashes (e.g. an environment file throwing on load) must fail the request, not hang it
    worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); const why = 'solver worker crashed: ' + ((e && e.message) || 'unknown error'); worker = null; if (cancel) cancel(why, 'crash'); };
  }
  function ask(msg, onProgress, ms, onPreview) {
    if (!worker) spawn();
    return new Promise((resolve, reject) => {
      const timer = ms ? setTimeout(() => abort('ran over its ' + Math.round(ms / 1000) + ' s budget and was stopped', 'timeout'), ms) : 0;
      cancel = (why, kind) => { clearTimeout(timer); pending = null; cancel = null; live = null; reject(Object.assign(new Error(why), { aborted: true, kind: kind || 'stopped', budgetMs: ms })); };
      pending = (d) => {
        if (d.type === 'progress') { if (onProgress) onProgress(d.pct, d.stage); return; }
        if (d.type === 'preview') { if (onPreview) { try { onPreview(d); } catch (e) { /* display only */ } } return; }
        clearTimeout(timer); pending = null; cancel = null; live = null;
        if (d.type === 'error') reject(new Error(d.message)); else resolve(d);
      };
      worker.postMessage(msg);
    });
  }
  // Stop the running solve (if any).  Returns true if one was running.
  // kind: 'user' | 'replaced' | 'forgotten' | 'timeout' (the error carries it, so the page can tell a nag from a notice)
  function abort(why, kind) {
    if (!cancel) return false;
    const c = cancel;
    if (worker) worker.terminate(); worker = null;
    c(why || 'stopped', kind);
    ready = reload();
    return true;
  }
  const busy = () => live;                          // { id, name, t0 } of the running solve, or null
  function proxy(def, meta) {
    RF.Solvers.register(Object.assign({}, def, {
      loaded: !meta, bundled: meta || null, worker: true,
      solve(input, settings, tools) {
        const scene = tools.scene;                  // the host passes the problem scene for trace()
        return ready.then(() => {
          live = { id: def.id, name: def.name, t0: performance.now() };
          const ms = limitMs(), onPreview = typeof tools.preview === 'function' && !tools.preview.none ? tools.preview : null;   // no preview callback ⇒ the worker sends none
          return ask({ type: 'solve', id: def.id, input, settings, scene, budget: Object.assign({}, BUDGET, { ms }), preview: !!onPreview }, tools.progress, ms, onPreview);
        }).then((d) => d.output);
      },
    }));
  }
  async function loadInto(src, meta) {
    const d = await ask({ type: 'load', src });
    for (const def of d.defs) proxy(def, meta);
    return d.defs;
  }
  async function load(src) {
    await ready;
    const defs = await loadInto(src, null);
    // a new version replaces the old one: drop earlier sources that registered any of the same ids
    const mine = new Set(defs.map((x) => x.id)), keep = [], keepIds = [];
    sources.forEach((s, i) => { if (!(srcIds[i] || []).some((id) => mine.has(id))) { keep.push(s); keepIds.push(srcIds[i]); } });
    sources = keep.concat(src); srcIds = keepIds.concat([[...mine]]); save();
    return defs;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(sources)); } catch (e) { /* ignore */ } }
  async function reload() {                        // after a restart: bundled first, then every loaded source (a later id wins)
    const all = sources; sources = []; srcIds = [];
    for (const b of bundled) { try { await loadInto(b.src, b.meta); } catch (e) { /* skip */ } }
    for (const src of all) {
      try { const defs = await loadInto(src, null); sources.push(src); srcIds.push(defs.map((x) => x.id)); } catch (e) { /* a source that no longer loads is dropped */ }
    }
  }
  // the model solvers shipped with the app: solvers/index.json lists them with who wrote them and when
  async function bundle() {
    let list = []; try { list = await (await fetch('solvers/index.json')).json(); } catch (e) { return; }
    for (const m of list) {
      try {
        const src = await (await fetch('solvers/' + m.file)).text(), meta = { model: m.model, run: m.run, file: m.file, note: m.note || '' };
        await loadInto(src, meta); bundled.push({ src, meta });
      } catch (e) { /* a missing file is skipped */ }
    }
  }
  async function restore() {
    let saved = []; try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { saved = []; }
    loading = true;
    ready = (async () => { await bundle(); for (const src of saved) { try { const defs = await loadInto(src, null); sources.push(src); srcIds.push(defs.map((x) => x.id)); } catch (e) { /* dropped */ } } save(); })();
    try { await ready; } finally { loading = false; }
  }
  function forget() {                              // unload the user's files; the bundled solvers stay
    abort('the loaded solvers were forgotten', 'forgotten');
    sources = []; srcIds = []; save();
    for (const d of RF.Solvers.list()) if (d.loaded) RF.Solvers.unregister(d.id);
    if (worker) { worker.terminate(); worker = null; }
    ready = reload();
  }
  // test hook: run the next solves with a shorter time budget (ms; 0 = back to BUDGET.ms).  BUDGET itself never changes.
  const testBudget = (ms) => { testMs = Math.max(0, +ms || 0); };
  RF.SolverHost = { load, restore, forget, abort, busy, loading: () => loading, BUDGET, testBudget, limitMs, setLimit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
