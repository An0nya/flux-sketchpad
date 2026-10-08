/* optic.js — what a ray meets after its reflection: the shield (an absorbing sheet near the focus) and the lens, as ONE function for the forward model.
 *   RF.P3.makePost(D) → (x, y, z, dx, dy, dz) => { p: [x, y, z], d: [dx, dy, dz], T } | null (absorbed)
 * D = { lens: { L, O: [x, y, z] (entry vertex; axis +x), T (transmission of both faces) } | null,
 *       shield: { xc, cy, yF, edge: [[y, z], …] (ascending y; the sheet covers z ≤ edge), zb (bottom), W (half width) } | null }.
 * Shield sheet: x = xc + ½ cy (y − yF)².  A ray that crosses it inside the covered region is absorbed.
 * Lens: a ray whose path never comes within the aperture radius of the lens axis between its front vertex and its exit plane passes by (stray light, unchanged);
 *   one that does is traced through both faces exactly; a miss of the faces or a TIR there is absorbed (the engine's ground edge / lost ray). */
(function () {
  'use strict';
  const RF = globalThis.RF, P3 = RF.P3 = RF.P3 || {};
  function edgeZ(edge, y) {
    const n = edge.length; if (y <= edge[0][0]) return edge[0][1]; if (y >= edge[n - 1][0]) return edge[n - 1][1];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (edge[m][0] <= y) lo = m; else hi = m; }
    const u = (y - edge[lo][0]) / Math.max(1e-12, edge[hi][0] - edge[lo][0]); return edge[lo][1] + u * (edge[hi][1] - edge[lo][1]);
  }
  function makePost(D) {
    const sh = D.shield, ln = D.lens, cap = D.cap, barrel = !!D.barrel;      // cap: { c, r } an absorbing disc ⟂ x (direct-light cap); barrel: rays that miss the lens are absorbed (the lens holder)
    const shieldHit = (x, y, z, dx, dy, dz) => {
      // x + t dx = xc + ½ cy (y + t dy − yF)²
      const q = y - sh.yF; let ts;
      if (Math.abs(sh.cy) < 1e-9) { if (Math.abs(dx) < 1e-12) return false; ts = [(sh.xc - x) / dx]; }
      else { const A = 0.5 * sh.cy * dy * dy, B = sh.cy * q * dy - dx, C = 0.5 * sh.cy * q * q - (x - sh.xc);
        if (Math.abs(A) < 1e-14) ts = [-C / B]; else { const Dd = B * B - 4 * A * C; if (Dd < 0) return false; const s = Math.sqrt(Dd); ts = [(-B - s) / (2 * A), (-B + s) / (2 * A)]; } }
      for (const t of ts) {
        if (!(t > 1e-9)) continue; const yy = y + t * dy, zz = z + t * dz; if (Math.abs(yy - sh.yF) > sh.W) continue;
        if (zz <= edgeZ(sh.edge, yy) && zz >= sh.zb && !(sh.holes && sh.holes.some((h) => Math.abs(yy - h.y) <= h.r && Math.abs(zz - h.z) <= h.r))) return true;      // holes: square windows for the sign points
      }
      return false;
    };
    const st = D.stats || null, add = (k, w) => { if (st) st[k] = (st[k] || 0) + (w || 0); };
    return (x, y, z, dx, dy, dz, w) => {
      if (cap && Math.abs(dx) > 1e-12) { const t = (cap.c[0] - x) / dx; if (t > 1e-9) { const yy = y + t * dy - cap.c[1], zz = z + t * dz - cap.c[2]; if (yy * yy + zz * zz <= cap.r * cap.r) { add('cap', w); return null; } } }
      if (sh && shieldHit(x, y, z, dx, dy, dz)) { add('shield', w); return null; }
      if (!ln) return { p: [x, y, z], d: [dx, dy, dz], T: 1 };
      const L = ln.L, O = ln.O, pz = x - O[0], pu = y - O[1], pv = z - O[2], a = L.a, zin = Math.min(0, L.sag0), zout = L.t;
      // portion of the ray inside the lens slab z ∈ [zin, zout]; its closest approach to the axis there
      let t0 = 0, t1 = Infinity;
      if (Math.abs(dx) < 1e-12) { if (pz < zin || pz > zout) { if (barrel) { add('barrel', w); return null; } add('passBy', w); return { p: [x, y, z], d: [dx, dy, dz], T: 1 }; } }
      else { const ta = (zin - pz) / dx, tb = (zout - pz) / dx; t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.max(t0, Math.max(ta, tb)); if (t1 <= 0 || t0 > t1) { if (barrel) { add('barrel', w); return null; } add('passBy', w); return { p: [x, y, z], d: [dx, dy, dz], T: 1 }; } }
      // r² (t) = |(pu, pv) + t (dy, dz)|² on [t0, t1]
      const dd = dy * dy + dz * dz; let tm = dd > 1e-14 ? -(pu * dy + pv * dz) / dd : t0; tm = Math.max(t0, Math.min(t1, tm));
      const ru = pu + tm * dy, rv = pv + tm * dz; if (ru * ru + rv * rv >= a * a) { if (barrel) { add('barrel', w); return null; } add('passBy', w); return { p: [x, y, z], d: [dx, dy, dz], T: 1 }; }
      const r = P3.traceLens(L, [pz, pu, pv], [dx, dy, dz]); if (!r) { add('lensLost', w); return null; }
      add('through', w);
      return { p: [r.p[0] + O[0], r.p[1] + O[1], r.p[2] + O[2]], d: r.d, T: ln.T };
    };
  }
  P3.makePost = makePost; P3.edgeZ = edgeZ;
})();
