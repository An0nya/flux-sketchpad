/* Reflector v3 — static facet solver: flat mirror facets, one per painted cluster.
 *
 * Approach
 * --------
 * The painting is rasterised into connected clusters of painted cells; within a cluster the paint
 * has one intensity level per facet (we emit one facet per cluster, at the cluster's mean level).
 * Each cluster gets a flat mirror facet on the source->aim axis.  A flat mirror at source-distance r
 * aiming at distance L delivers flux Phi*R*s^2/(4*r^2) onto a spot whose apparent diameter is
 * D = s*L/r (s = source size), i.e. illuminance E = Phi*R/(pi*L^2).
 *
 * Static: no ray tracing inside solve().  Deterministic.  Facets are flat mirrors (normal = the
 * source->aim unit vector), so the geometry is exact and clearance-safe.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const V = RF.V, Eng = RF.Engine;

  const MARGIN = 2;         // mm of extra clearance beyond the effective keep-out

  RF.Solvers.register({
    id: 'bench-flint-r2--reflector-v3', name: 'Reflector v3 (static flat clusters)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    ],
    solve(input, settings) {
      const env = input.envelope || { center: [0, 0, 0], half: [50, 50, 50] };
      const src = input.source;
      const keep = Math.max((env.keepOut || 0), settings.minDistance || 0);
      const R = (input.limits && input.limits.reflectivity != null) ? input.limits.reflectivity : 0.9;
      const sources = (input.sources && input.sources.length) ? input.sources : [src];
      let Phi = 0; for (const s of sources) Phi += s.power || 0;
      const s = (src.kind === 'planar')
        ? (src.shape === 'disc' ? src.radius : Math.min(src.w, src.h) / 2)
        : (src.shape === 'cylinder' ? Math.min(src.radius, src.length / 2) : src.radius);
      const T = Eng.targetFrame(input.target);
      const paint = input.paint.cells, pres = input.paint.res || input.target.res;
      const nc = pres * pres;
      const mask = new Float64Array(nc);
      for (let k = 0; k < nc; k++) mask[k] = (paint[k] || 0) > 0 ? 1 : 0;

      const comp = new Int32Array(nc).fill(-1);
      const clusters = [];
      for (let k = 0; k < nc; k++) {
        if (mask[k] < 0.5 || comp[k] >= 0) continue;
        const id = clusters.length;
        const cells = [];
        const st = [k]; comp[k] = id;
        while (st.length) {
          const c = st.pop();
          cells.push(c);
          const i = c % pres, j = (c / pres) | 0;
          for (let di2 = -1; di2 <= 1; di2++) for (let dj = -1; dj <= 1; dj++) {
            if (!di2 && !dj) continue;
            const a = i + di2, b = j + dj;
            if (a < 0 || b < 0 || a >= pres || b >= pres) continue;
            const n = b * pres + a;
            if (mask[n] > 0.5 && comp[n] < 0) { comp[n] = id; st.push(n); }
          }
        }
        clusters.push(cells);
      }

      const order = clusters.map((cells, i) => ({ i, cells }));
      order.sort((a, b) => {
        const wa = a.cells.reduce((t, c) => t + (paint[c] || 0), 0) / a.cells.length;
        const wb = b.cells.reduce((t, c) => t + (paint[c] || 0), 0) / b.cells.length;
        return wb - wa;
      });
      const maxF = (input.limits && input.limits.maxFacets) ? Math.max(1, input.limits.maxFacets) : 100;
      const surfaces = [], intent = [], notes = [];
      for (const cl of order.slice(0, maxF)) {
        const cells = cl.cells;
        const pos = [];
        let mx = 0, my = 0, mz = 0, wsum = 0, cnt = 0;
        for (const c of cells) {
          const i = c % pres, j = (c / pres) | 0;
          const uv = Eng.cellCenter(T, i, j);
          const w = Eng.targetUVtoWorld(T, uv[0], uv[1]);
          pos.push(w);
          mx += w[0]; my += w[1]; mz += w[2]; wsum += (paint[c] || 0); cnt++;
        }
        const aim = [mx / cnt, my / cnt, mz / cnt];
        const L = V.len(V.sub(aim, src.pos));
        let maxr2 = 0;
        for (const p of pos) { const d = V.len(V.sub(p, aim)); if (d > maxr2) maxr2 = d; }
        const D = 2 * maxr2;
        const E = (Phi * R) / (Math.PI * L * L);
        if (!(E > 0) || !(D > 0) || !(L > 0)) continue;
        const r = (D / s) * Math.sqrt((4 * Phi * R) / (Math.PI * E * D * D));
        const h = D / 2;
        const u = V.norm(V.sub(aim, src.pos));
        const rr = Math.max(r, keep + MARGIN);
        const P = [src.pos[0] + u[0] * rr, src.pos[1] + u[1] * rr, src.pos[2] + u[2] * rr];
        const Z = [src.pos[0] + u[0] * L, src.pos[1] + u[1] * L, src.pos[2] + u[2] * L];
        const id = 'F' + (surfaces.length);
        surfaces.push({
          type: 'plane', id, P, n: u.slice(),
          clip: { kind: 'rect', hx: h, hy: h },
          optics: { interaction: 'reflect', reflectivity: R, twoSided: false },
        });
        intent.push({ facet: id, cells: cells.map((c) => [c, paint[c] || 0]) });
        notes.push('cluster ' + cl.i + ': ' + cells.length + ' cells, L=' + L.toFixed(1) + ', D=' + D.toFixed(1) + ', E=' + E.toExponential(2) + 'lx');
      }
      return { surfaces, intent, notes };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
