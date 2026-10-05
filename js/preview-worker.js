/* preview-worker.js — traces a solver's preview candidates for display (SOLVER_API.md § "Watching a solve").
 * A preview that arrives without a grid (most solvers send geometry only) is traced here, off the page and outside the
 * solver's own worker, so it costs the solve nothing but a core.  Display only: nothing it computes reaches a result.
 *   → { id, scene, surfaces, rays, bounces, ff: { fine, wide, k } | null }
 *   ← { type: 'traced', id, grid (Float32), res, rays, ms, fidelity?, ff?: [{ cd (Float32), nh, nv, h0, v0, h1, v1, step }] }
 *   ← { type: 'error', id, error }
 * The page sends only the newest candidate (latest wins), so this worker never queues more than one. */
'use strict';
importScripts('solver-env.js'); importScripts(...self.RF_SOLVER_ENV.map((f) => f + '.js'));
const RF = self.RF;
self.onmessage = (e) => {
  const m = e.data, t0 = performance.now();
  try {
    const sc = Object.assign({}, m.scene, { sim: Object.assign({}, m.scene.sim, m.bounces > 0 ? { bounces: Math.max(m.scene.sim.bounces | 0, Math.min(16, Math.round(m.bounces))) } : {}) });
    const P = RF.Engine.prepare(sc, m.surfaces);
    if (m.ff) P.ffStreams = [m.ff.fine, m.ff.wide];
    const c = RF.Engine.runSync(P, m.rays, 0);
    const grid = Float32Array.from(RF.Engine.gridTotal(c)), out = { type: 'traced', id: m.id, grid, res: P.res, rays: m.rays }, transfer = [grid.buffer];
    const paint = sc.modeA && sc.modeA.paint;
    if (paint && sc.mode !== 'D' && RF.Photometry && RF.Photometry.fidelity) {
      try { const f = RF.Photometry.fidelity(sc, P, c); if (f) out.fidelity = { fidelity: f.fidelity }; } catch (err) { /* no score, still a picture */ }
    }
    if (m.ff) {
      out.ff = P.ffStreams.map((o) => {
        const G = RF.FarField.build(c, o), cd = Float32Array.from(RF.FarField.map(G, m.ff.k).cd); transfer.push(cd.buffer);
        return { cd, nh: G.nh, nv: G.nv, h0: G.h0, v0: G.v0, h1: G.h1, v1: G.v1, step: G.step, distance: G.distance };
      });
    }
    out.ms = Math.round(performance.now() - t0);
    self.postMessage(out, transfer);
  } catch (err) { self.postMessage({ type: 'error', id: m.id, error: String(err && err.message || err) }); }
};
