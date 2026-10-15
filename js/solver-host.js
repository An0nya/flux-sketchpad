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
  // Simulation → Advanced → Solver threads: workers a solver may use for its independent tasks (tools.pool; 0 = none, the default).  Per browser, like the time limit.
  // Keep solving in the background: a tab behind another tab is demoted by the OS to slow cores (measured 4-5x slower); an inaudible tone keeps it at full speed.
  const pref = (k) => { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } };
  let threads = Math.max(0, Math.min(16, pref('flux/solverThreads'))), keepOn = !!pref('flux/solveKeepAwake'), awake = null;
  const setPref = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } };
  const setThreads = (n) => { threads = Math.max(0, Math.min(16, n | 0)); setPref('flux/solverThreads', threads); };
  const setKeepAwake = (on) => { keepOn = !!on; setPref('flux/solveKeepAwake', keepOn ? 1 : 0); };
  function wake(on) {                               // start / stop the tone while a solve runs (needs the browser to allow audio: after a click, it does)
    try {
      if (!on) { if (awake) { awake.close(); awake = null; } return; }
      if (!keepOn || awake || typeof AudioContext === 'undefined') return;
      const ac = awake = new AudioContext(), o = ac.createOscillator(), g = ac.createGain(); g.gain.value = 0.00001; o.connect(g); g.connect(ac.destination); o.start(); ac.resume();
    } catch (e) { awake = null; }
  }
  const limitMs = () => testMs || userMs || BUDGET.ms;
  const setLimit = (ms) => { userMs = Math.max(0, +ms || 0); try { localStorage.setItem('flux/solveLimitMs', String(userMs)); } catch (e) { /* ignore */ } };
  let worker = null, sources = [], srcIds = [], bundled = [], ready = Promise.resolve(), live = null, testMs = 0, lastStats = null, loading = typeof Worker !== "undefined";   // true from page load until restore() has the bundled solvers in
  // sources[i] = a loaded file's text, srcIds[i] = the ids it registered;  bundled = [{ src, meta }] from solvers/
  // Requests: every message to the worker carries rid = ++seq and the worker echoes it on every reply, so replies find their request
  // however many are out.  reqs: rid → { onMsg, reject, timer }.  Stopping anything means killing the worker, which fails every request
  // in flight (the one that was targeted with its own kind, the rest 'restarted'), then ONE rebuild (reload() is single-flight).
  let seq = 0, gen = 0, reloading = null;           // gen counts worker kills: a rebuild that sees it change starts over on the fresh worker
  const reqs = new Map();
  function spawn() {
    const w = worker = new Worker('js/solve-worker.js');
    w.onmessage = (e) => { const r = w === worker && e.data && reqs.get(e.data.rid); if (r) r.onMsg(e.data); };   // no known rid (or a killed worker): ignored
    // a worker that crashes (e.g. an environment file throwing on load) must fail the requests, not hang them, and be rebuilt
    w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); if (w === worker) restart(0, 'solver worker crashed: ' + ((e && e.message) || 'unknown error'), 'crash', 'crash'); };
  }
  // kill the worker, fail every request (rid → why/kind, the others othersKind), rebuild it
  function restart(rid, why, kind, othersKind) {
    const rs = [...reqs]; reqs.clear(); if (live && !live.cancel) live = null; gen++;   // (a solve still waiting for a rebuild stays stoppable)
    if (worker) worker.terminate(); worker = null;
    for (const [id, r] of rs) r.reject(id === rid ? why : (kind === 'crash' ? why : 'the solver worker was restarted'), id === rid ? kind : othersKind);
    ready = reload();
  }
  // a request to the worker; no waiting for `ready` (the rebuild itself uses this) — callers outside it go through whenReady()
  function ask(msg, onProgress, ms, onPreview) {
    if (!worker) spawn();
    const rid = ++seq;
    const p = new Promise((resolve, reject) => {
      const timer = ms ? setTimeout(() => restart(rid, 'ran over its ' + Math.round(ms / 1000) + ' s budget and was stopped', 'timeout', 'restarted'), ms) : 0;
      const done = () => { clearTimeout(timer); reqs.delete(rid); if (live && live.rid === rid) live = null; };
      reqs.set(rid, {
        timer,
        reject: (why, kind) => { done(); reject(Object.assign(new Error(why), { aborted: true, kind: kind || 'stopped', budgetMs: ms })); },
        onMsg: (d) => {
          if (d.type === 'progress') { if (onProgress) onProgress(d.pct, d.stage); return; }
          if (d.type === 'preview') { if (onPreview) { try { onPreview(d); } catch (e) { /* display only */ } } return; }
          done(); if (d.type === 'error') reject(new Error(d.message)); else resolve(d);
        },
      });
      worker.postMessage(Object.assign({ rid }, msg));
    });
    p.rid = rid; return p;
  }
  // wait until no rebuild is running or queued (a stop while waiting starts another: look again), so nothing is posted to a worker without its solvers
  async function whenReady() { let r; do { r = ready; await r; } while (r !== ready); }
  // Stop the running solve (if any).  Returns true if one was running.  Loads and rebuilds are not solves: they are not stopped here.
  // kind: 'user' | 'replaced' | 'forgotten' | 'timeout' (the error carries it, so the page can tell a nag from a notice)
  function abort(why, kind) {
    if (!live) return false;
    if (live.cancel) { const j = live; live = null; j.cancel(why || 'stopped', kind); j.cancel = null; return true; }   // still waiting for the rebuild: nothing to kill
    restart(live.rid, why || 'stopped', kind, 'restarted');
    return true;
  }
  const busy = () => live;                          // { id, name, t0 } of the running solve, or null
  function proxy(def, meta, src) {
    RF.Solvers.register(Object.assign({}, def, {
      loaded: !meta, bundled: meta || null, worker: true, cacheSource: src,
      solve(input, settings, tools) {
        const scene = tools.scene;                  // the host passes the problem scene for trace()
        const j = live = { id: def.id, name: def.name, t0: performance.now(), rid: 0, cancel: null };   // j.cancel: stop it before it has been sent (it is waiting for a rebuild)
        return new Promise((resolve, reject) => {
          j.cancel = (why, kind) => reject(Object.assign(new Error(why), { aborted: true, kind: kind || 'stopped' }));
          whenReady().then(() => {
            if (!j.cancel) return;                      // stopped while it waited
            j.cancel = null;
            const ms = limitMs(), onPreview = typeof tools.preview === 'function' && !tools.preview.none ? tools.preview : null;   // no preview callback ⇒ the worker sends none
            const p = ask({ type: 'solve', id: def.id, input, settings, scene, budget: Object.assign({}, BUDGET, { ms }), preview: !!onPreview, gpu: !!(RF.GpuTrace && RF.GpuTrace.userChoice() === true), pool: threads }, tools.progress, ms, onPreview);
            wake(true); const off = () => wake(false); p.then(off, off);
            j.rid = p.rid; p.then(resolve, reject);
          });
        }).then((d) => { lastStats = { traceMs: d.traceMs, traces: d.traces, raysUsed: d.raysUsed, ms: performance.now() - j.t0 }; return d.output; });
      },
    }));
  }
  async function loadInto(src, meta) {
    const d = await ask({ type: 'load', src });
    for (const def of d.defs) proxy(def, meta, src);
    return d.defs;
  }
  async function load(src) {
    let defs;
    for (;;) {                                      // a solve stopping (timeout / Stop) while this waits in the worker's queue restarts the worker: ask again on the new one
      await whenReady();
      try { defs = await loadInto(src, null); break; } catch (e) { if (!(e && e.aborted && e.kind === 'restarted')) throw e; }
    }
    // a new version replaces the old one: drop earlier sources that registered any of the same ids
    const mine = new Set(defs.map((x) => x.id)), keep = [], keepIds = [];
    sources.forEach((s, i) => { if (!(srcIds[i] || []).some((id) => mine.has(id))) { keep.push(s); keepIds.push(srcIds[i]); } });
    sources = keep.concat(src); srcIds = keepIds.concat([[...mine]]); save();
    return defs;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(sources)); } catch (e) { /* ignore */ } }
  // after a restart: bundled first, then every loaded source (a later id wins).  Single-flight: a call while one is running gets the same
  // promise.  A kill during it (gen changes) starts it over on the fresh worker; a source that crashes the worker is dropped.
  const again = () => Object.assign(new Error('rebuild restarted'), { aborted: true, kind: 'restarted' });
  async function loadSources(g) {                  // g = gen when the rebuild started; throws (aborted) if the worker was killed since
    for (const src of sources.slice()) {
      try { const defs = await loadInto(src, null), k = sources.indexOf(src); if (k >= 0) srcIds[k] = defs.map((x) => x.id); }
      catch (e) { const k = sources.indexOf(src); if (k >= 0 && !(e && e.aborted && e.kind === 'restarted')) { sources.splice(k, 1); srcIds.splice(k, 1); } if (e && e.aborted) throw e; }   // a source that no longer loads is dropped (a crash then needs a fresh worker)
      if (g !== gen) throw again();
    }
  }
  function reload() {
    if (reloading) return reloading;
    const run = async () => {
      for (let tries = 0; tries < 5; tries++) {
        const g = gen;
        try {
          for (const b of bundled.slice()) { try { await loadInto(b.src, b.meta); } catch (e) { if (e && e.aborted) throw e; } if (g !== gen) throw again(); }
          await loadSources(g);
          reloading = null; return;                     // no await since the gen check: a kill from here on starts a new reload
        } catch (e) { if (e && !e.aborted) throw e; }  // killed mid-rebuild (or a crashing source dropped): go again
      }
      reloading = null;
    };
    const p = reloading = Promise.resolve().then(run).catch(() => { if (reloading === p) reloading = null; /* never leave `ready` rejected */ });
    return p;
  }
  // the model solvers shipped with the app: solvers/index.json lists them with who wrote them and when
  async function bundle() {
    let list = []; try { list = await (await fetch('solvers/index.json')).json(); } catch (e) {
      // over file:// (or with the folder missing) none of the bundled solvers can load: say so once, visibly
      const fb = RF.Solvers.get(RF.Solvers.DEFAULT_ID), ui = RF.UI;
      if (ui && ui.store) ui.store.notice('The bundled solvers did not load: they need the page served over http (for example python3 tests/serve.py 8000, then open http://localhost:8000), not opened as a file. Until then solves use the built-in ' + (fb ? fb.name : 'fallback') + ' solver.');
      return;
    }
    for (const m of list) {
      try {
        const src = await (await fetch('solvers/' + m.file)).text(), meta = { model: m.model, run: m.run, file: m.file, note: m.note || '', group: m.group || null, groups: m.groups || null };      // group: default | benchmark | legacy (the dropdown's sections)
        await loadInto(src, meta); bundled.push({ src, meta });
      } catch (e) { /* a missing file is skipped */ }
    }
  }
  async function restore() {
    let saved = []; try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { saved = null; }
    if (!Array.isArray(saved)) { console.warn('flux/solvers in localStorage is not a list of solver files: ignored and rebuilt'); saved = []; }
    if (saved.some((s) => typeof s !== 'string')) { console.warn('flux/solvers in localStorage had entries that are not solver files: dropped'); saved = saved.filter((s) => typeof s === 'string'); }
    loading = true;
    ready = (async () => {
      const g = gen; await bundle(); sources = saved; srcIds = saved.map(() => []);
      try { if (g === gen) await loadSources(g); } catch (e) { if (!(e && e.aborted)) throw e; }
      if (g !== gen) await whenReady();             // the worker was killed while loading: its rebuild (now `ready`) redoes this
      save();
    })();
    try { await ready; } finally { loading = false; }
  }
  function forget() {                              // unload the user's files; the bundled solvers stay
    sources = []; srcIds = []; save();
    for (const d of RF.Solvers.list()) if (d.loaded) RF.Solvers.unregister(d.id);
    if (live && live.cancel) abort('the loaded solvers were forgotten', 'forgotten');
    restart(live ? live.rid : 0, 'the loaded solvers were forgotten', 'forgotten', 'restarted');   // a fresh worker without the loaded solvers (and ends a running solve)
  }
  // test hook: run the next solves with a shorter time budget (ms; 0 = back to BUDGET.ms).  BUDGET itself never changes.
  const testBudget = (ms) => { testMs = Math.max(0, +ms || 0); };
  RF.SolverHost = { threads: () => threads, setThreads, keepAwake: () => keepOn, setKeepAwake, lastStats: () => lastStats, load, restore, forget, abort, busy, loading: () => loading, BUDGET, testBudget, limitMs, setLimit };
})(typeof globalThis !== 'undefined' ? globalThis : this);
