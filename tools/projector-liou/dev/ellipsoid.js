/* ellipsoid.js — the reference rung: ONE ellipsoid of revolution (foci: the LED and the lens focus) as the whole reflector, the classic projector cup.
 *   RF.P3.ellipsoidCap(P, lay) → { surface (one engine `rev` conic, counted as one facet), r1, Lc } or null
 * The path length Lc is the layout's base length (lay.Lb); the cup runs from the vertex behind the LED out to the largest radius whose every point is allowed
 * (inside the envelope, behind the focus, within the lens cone, not grazing, outside the LED clearance).                                                  */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, P3 = RF.P3 = RF.P3 || {};
  function ellipsoidCap(P, lay, o) {
    o = o || {}; const S = P.Lp, F = lay.F, u = V.sub(F, S), Dd = V.len(u), W = V.mul(u, 1 / Dd), Lc = o.Lc || lay.Lb, ae = Lc / 2, c = Dd / 2, e = Dd / Lc, k = -e * e;
    if (!(Lc > Dd + 0.5)) return null;
    const R = (Lc * Lc - Dd * Dd) / (2 * Lc), O = V.sub(S, V.mul(W, ae - c)), [e1, e2] = V.basis(W), E = P.E, keep = P.keep, k1 = 1 + k;
    const zOf = (r) => (R - Math.sqrt(Math.max(0, R * R - k1 * r * r))) / k1, ok = (r) => {
      for (let a = 0; a < 16; a++) {
        const t = a * Math.PI / 8, z = zOf(r), X = V.add(O, V.add(V.mul(W, z), V.add(V.mul(e1, r * Math.cos(t)), V.mul(e2, r * Math.sin(t))))), w = V.sub(F, X), lw = V.len(w), d = V.norm(V.sub(X, S));
        if (!E.inside(X, 0.3) || V.dist(X, S) <= keep + 1 || w[0] < 1 || Math.hypot(w[1], w[2]) / w[0] > lay.tanMax || V.dot(d, w) / lw > 0.81) return false;
      }
      return true;
    };
    let r1 = 0; const rmax = Math.sqrt(R * R / k1) * 0.999 * (k1 > 0 ? 1 : 1e9); for (let r = 1; r < Math.min(rmax, 400); r += 0.5) { if (!ok(r)) break; r1 = r; }
    if (r1 < 3) return null;
    return { r1, Lc, R, k, O, W, surface: { type: 'rev', id: 'p3_ellipsoid', O, W, ref: e1, seg: { kind: 'conic', zv: 0, R, k, r0: 0, r1 }, front: -1, optics: { interaction: 'reflect', reflectivity: P.refl } } };
  }
  P3.ellipsoidCap = ellipsoidCap;
})();
