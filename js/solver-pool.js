/* solver-pool.js — a small pool of workers for a solver's independent work (opt-in; SOLVER_API.md § "Parallel tasks").
 * A solver declares `tasks: { name(input, arg, ctx) → result }` next to solve(): pure functions of (input, arg), with
 * ctx = { trace(surfaces, o) } (the host's own trace).  solve() asks tools.pool.map('name', [arg…]) and gets the results
 * IN ORDER, whatever the number of workers and whichever worker finished first, so the answer is the same for 0, 1 or 8
 * workers.  size 0 = no workers: the tasks run in the caller (what a host without a pool does too).
 * The pool is host-agnostic: create({ size, spawn }) where spawn() → { post(msg), onmessage = fn(data), onerror = fn(msg), terminate() }.
 * The worker end (workerHandler) is the same for the browser (js/solver-pool-worker.js) and Node (tools/pool-worker-node.js).
 * Workers are created on the first map(), run a dynamic queue (an idle worker takes the next task: efficiency cores finish later,
 * performance cores take more), and close() ends them.  A worker that dies fails the map (the solve then fails like any crash).    */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {});
  // ---- caller end
  function create(o) {
    const size = Math.max(0, Math.min(16, o.size | 0)), workers = [];
    let started = null, seq = 0, closed = false;
    const pending = new Map();           // rid → { resolve, reject }
    function start() {
      if (started) return started;
      const ps = [];
      for (let i = 0; i < size; i++) {
        const w = o.spawn(), rec = { w, busy: false, ready: null };
        w.onmessage = (d) => { const r = pending.get(d.rid); if (!r) return; pending.delete(d.rid); if (d.error) r.reject(new Error(d.error)); else r.resolve(d); };
        w.onerror = (m) => { for (const [k, r] of pending) { pending.delete(k); r.reject(new Error('pool worker failed: ' + m)); } };
        rec.ready = ask(rec, { type: 'init', id: o.id, srcs: o.srcs || [], scene: o.scene, input: o.input });
        workers.push(rec); ps.push(rec.ready);
      }
      return (started = Promise.all(ps));
    }
    function ask(rec, msg) { return new Promise((resolve, reject) => { const rid = ++seq; pending.set(rid, { resolve, reject }); rec.w.post(Object.assign({ rid }, msg)); }); }
    async function map(name, args) {
      if (closed) throw new Error('pool is closed');
      if (!size) return inline(name, args);
      await start();
      const out = new Array(args.length); let next = 0, failed = null;
      await Promise.all(workers.map(async (rec) => {
        while (!failed && next < args.length) {
          const i = next++;
          try { const d = await ask(rec, { type: 'task', name, arg: args[i] }); out[i] = d.result; if (o.onRays && d.rays > 0) o.onRays(d.rays); } catch (e) { failed = e; }
        }
      }));
      if (failed) throw failed;
      return out;
    }
    // no workers: run here, with the caller's own trace.  Same result: tasks are pure.
    async function inline(name, args) { const out = []; for (const a of args) out.push(await o.run(name, a)); return out; }
    function close() { closed = true; for (const r of workers) { try { r.w.terminate(); } catch (e) { /* gone */ } } workers.length = 0; pending.clear(); }
    return { size, map, close };
  }
  // ---- worker end: feed it each message; it replies through post(obj)
  // loadSrc(text) evaluates a solver file (registers it); RF is the worker's own (solver-env) RF
  function workerHandler(loadSrc, post) {
    let def = null, ctx = null, input = null, rays = 0;
    return function (m) {
      try {
        if (m.type === 'init') {
          for (const s of m.srcs) loadSrc(s);
          def = RF.Solvers.get(m.id); if (!def || !def.tasks) throw new Error('solver ' + m.id + ' has no tasks');
          input = m.input; ctx = { trace: (surfaces, o) => { rays += Math.max(1, (o && o.rays) | 0 || 20000); return RF.Solvers.trace(m.scene, surfaces, o); } };
          post({ rid: m.rid, ok: true });
        } else if (m.type === 'task') {
          rays = 0; const f = def.tasks[m.name]; if (!f) throw new Error('solver ' + def.id + ' has no task ' + m.name);
          const result = f(RF.U.deepCopy(input), m.arg, ctx);
          post({ rid: m.rid, result, rays });
        }
      } catch (e) { post({ rid: m.rid, error: String((e && e.message) || e) }); }
    };
  }
  RF.SolverPool = { create, workerHandler };
})(typeof globalThis !== 'undefined' ? globalThis : this);
