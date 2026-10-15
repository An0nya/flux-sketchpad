/* solve-worker.js — runs loaded (untrusted) solvers off the page.  It has the engine but no DOM, so a
 * solver here can't touch the page, the grader or the tracer the host scores it with.
 * Every request carries a `rid`; every reply echoes it.
 *   → { type: 'load', src }                         ← { type: 'loaded', defs: [{ id, name, version, modes, settings }] } | { type: 'error' }
 *   → { type: 'solve', id, input, settings, scene, budget, preview }  ← { type: 'progress', pct } … { type: 'preview', … } … { type: 'done', output } | { type: 'error' }
 * Previews (tools.preview, SOLVER_API.md § "Watching a solve"): display-only snapshots of what the solver is trying, sent
 * only when the host asked (preview: true), at most one per PREVIEW_MS (the latest held one goes out when the window has
 * passed: on the next preview / progress / trace call, or just before 'done'). */
'use strict';
importScripts('solver-env.js'); importScripts(...self.RF_SOLVER_ENV.map((f) => f + '.js'));   // the same list the runner and scorer use
importScripts('solver-pool.js');
const RF = self.RF;
const srcOf = {};   // solver id → the source text it was loaded from (a pool worker loads the same text); the built-in solvers have none
const meta = (d) => ({ id: d.id, name: d.name, version: d.version, modes: d.modes, settings: d.settings, declaresLimits: d.declaresLimits });
const BUILTIN = new Set(RF.Solvers.list().map((d) => d.id));
const PREVIEW_MS = 250;
// a preview as it crosses to the page: a copy of the surfaces taken when it is SENT, one grid as Float32, and only a
// summary of a trace result (fidelity, spec counts), never its per-cell arrays
function previewMsg(surfaces, info, n) {
  info = info || {}; const tr = info.trace || null, grid = info.grid || (tr && tr.grid), res = info.res || (tr && tr.res);
  const fd = info.fidelity || (tr && tr.fidelity), sp = info.spec || (tr && tr.spec), m = { type: 'preview', n, surfaces: structuredClone(surfaces) };
  if (info.label !== undefined) m.label = String(info.label).slice(0, 60);
  if (info.note !== undefined) m.note = String(info.note).slice(0, 160);
  if (info.needs && info.needs.bounces > 0) m.needs = { bounces: +info.needs.bounces };
  if (grid && res > 0 && grid.length === res * res) { m.grid = Float32Array.from(grid); m.res = res | 0; }
  if (fd && isFinite(fd.fidelity)) m.fidelity = { fidelity: fd.fidelity, within: fd.within, gapsDark: fd.gapsDark };
  if (sp && sp.n) m.spec = { verdict: sp.verdict, n: { pass: sp.n.pass | 0, fail: sp.n.fail | 0, unsure: sp.n.unsure | 0 } };
  return m;
}
self.onmessage = async (e) => {
  const m = e.data, send = (o, tr) => { o.rid = m.rid; self.postMessage(o, tr || []); };   // every reply echoes the request's rid (the host matches replies to requests by it)
  try {
    if (m.type === 'load') {
      // record what THIS file registers (loading a new version of an already-loaded id replaces it);
      // the built-in solvers can't be replaced
      const ids = [], reg = RF.Solvers.register;
      RF.Solvers.register = (def) => { if (def && BUILTIN.has(def.id)) throw new Error("'" + def.id + "' is a built-in solver id: pick another"); const id = reg(def); ids.push(id); return id; };
      try { importScripts(URL.createObjectURL(new Blob([m.src], { type: 'text/javascript' }))); } finally { RF.Solvers.register = reg; }
      for (const id of ids) srcOf[id] = m.src;
      const defs = [...new Set(ids)].map((id) => meta(RF.Solvers.get(id)));
      if (!defs.length) throw new Error('the file did not call RF.Solvers.register(...)');
      send({ type: 'loaded', defs });
    } else if (m.type === 'solve') {
      const def = RF.Solvers.get(m.id); if (!def) throw new Error('solver ' + m.id + ' is not loaded in the worker');
      // held = the latest preview call not sent yet, as REFERENCES (a dropped call costs nothing); it is copied when sent
      let raysUsed = 0, held = null, lastAt = -1e9, nPrev = 0, traceMs = 0, nTrace = 0, nGpu = 0;   // traceMs / nTrace: time inside tools.trace / traceAsync (reported in 'done', for the benchmarks); nGpu: how many of them ran on the GPU
      const spend = (o) => { const n = Math.max(1, (o && o.rays) | 0 || 20000); raysUsed += n; if (raysUsed > m.budget.rays) throw new Error('ray budget exhausted (' + m.budget.rays.toLocaleString() + ')'); };
      if (m.gpu && !RF.GpuTrace) importScripts('gpu-trace.js');
      if (RF.GpuTrace) RF.GpuTrace.enable(!!m.gpu);   // the device itself starts at the first traceAsync (below): a solve that never asks for the GPU never wakes it.  No WebGPU here → traceAsync runs on the CPU
      let gpuInit = null; const gpuReady = () => (m.gpu && RF.GpuTrace ? (gpuInit || (gpuInit = RF.GpuTrace.init().catch(() => {}))) : null);
      const post = () => {
        const h = held; held = null; let p; try { p = previewMsg(h.surfaces, h.info, h.n); } catch (e) { return; }   // a malformed preview is dropped
        lastAt = performance.now(); send(p, p.grid ? [p.grid.buffer] : []);
      };
      const flush = () => { if (held && performance.now() - lastAt >= PREVIEW_MS) post(); };
      // tools.pool (SOLVER_API.md § "Parallel tasks"): only when the host asked for threads and this solver declares tasks; workers start on the first map()
      let pool = null;
      const inlineRun = (name, a) => def.tasks[name](m.input, a, { trace: (surfaces, o) => { spend(o); return RF.Solvers.trace(m.scene, surfaces, o); } });
      const poolOf = () => {
        if (!(m.pool > 0) || !def.tasks || typeof Worker === 'undefined') return undefined;
        pool = RF.SolverPool.create({ size: m.pool, id: m.id, srcs: srcOf[m.id] ? [srcOf[m.id]] : [], scene: m.scene, input: m.input, run: inlineRun, onRays: (n) => spend({ rays: n }),
          spawn: () => { const w = new Worker('solver-pool-worker.js'), h = { post: (x) => w.postMessage(x), terminate: () => w.terminate(), onmessage: null, onerror: null }; w.onmessage = (e) => h.onmessage && h.onmessage(e.data); w.onerror = (e) => h.onerror && h.onerror(e.message || 'error'); return h; } });
        return pool;
      };
      const tools = {
        progress: (pct, stage) => { flush(); send({ type: 'progress', pct: +pct || 0, stage: stage ? String(stage).slice(0, 80) : undefined }); },
        budget: m.budget,
        pool: poolOf(),
        trace: (surfaces, o) => { flush(); spend(o); const t = performance.now(); try { return RF.Solvers.trace(m.scene, surfaces, o); } finally { traceMs += performance.now() - t; nTrace++; } },
        // the same trace, possibly on the GPU (the user's Simulation → GPU trace): same rays, f32 (res.gpu says which ran)
        traceAsync: async (surfaces, o) => { flush(); spend(o); const t = performance.now(); try { await gpuReady(); const r = await RF.Solvers.traceAsync(m.scene, surfaces, o); if (r && r.gpu) nGpu++; return r; } finally { traceMs += performance.now() - t; nTrace++; } },
        // display only: never throws into the solver, never changes what it computes
        preview: (surfaces, info) => {
          if (!m.preview) return;
          if (!Array.isArray(surfaces)) return;      // nothing to draw: the held one stays
          held = { surfaces, info, n: ++nPrev }; flush();
        },
      };
      let output; try { output = await def.solve(m.input, m.settings, tools); } finally { if (pool) pool.close(); }
      if (held) post();                              // the latest candidate always reaches the page before the result
      send({ type: 'done', output, raysUsed, previews: nPrev, traceMs: Math.round(traceMs), traces: nTrace, gpuTraces: nGpu });
    }
  } catch (err) { send({ type: 'error', message: String(err && err.message || err) }); }
};
