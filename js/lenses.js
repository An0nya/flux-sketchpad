/* lenses.js — refractive presets, fully parametrised, built from the same exact quadric primitives:
 *   plano-convex, biconvex (spherical caps), TIR collimator (numerically tailored profile), and a
 *   Fresnel lens with N rings (annular prism facets = revolved line segments tagged `refract`).
 * Glass is on the BACK side of every refracting surface (front = air side).  Edges and mounting
 * flanges are `absorb` (a ground edge / holder; not traced as glass — stated in the README).
 * Lenses sit on an axis through the source (toward the aim point by default) at distance d.   */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const D2R = Math.PI / 180;

  function glass(p) { return { interaction: 'refract', reflectivity: 0.9, ior: p.ior, fresnelT: p.fresnelT, twoSided: false }; }
  const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };

  function defaults(kind) {
    const base = { ior: 1.49, fresnelT: 0.96, axisMode: 'aim', auto: true };
    if (kind === 'planoconvex') return Object.assign(base, { f: 40, a: 15, edge: 1 });
    if (kind === 'biconvex') return Object.assign(base, { f: 40, a: 15, edge: 1 });
    if (kind === 'tir') return Object.assign(base, { A: 20, rc: 4, hc: 5, thMax: 88 });
    if (kind === 'fresnel') return Object.assign(base, { f: 40, a: 30, rings: 12, tb: 1.5 });
    return base;
  }

  // Build surfaces in axial (r, z) coordinates; `seg(...)` helpers add rev surfaces.
  function builder(O, W, ref, gid) {
    const out = []; let k = 0;
    return {
      out,
      line(r0, z0, r1, z1, front, optics) { out.push({ type: 'rev', id: gid + '_' + (k++), group: 'L', O, W, ref, seg: { kind: 'line', z0, r0: Math.max(0, r0), z1, r1: Math.max(0, r1) }, front, optics }); },
      arc(zc, R, za, zb, rmax, front, optics) { out.push({ type: 'rev', id: gid + '_' + (k++), group: 'L', O, W, ref, seg: { kind: 'arc', zc, R, z0: za, z1: zb, rmax }, front, optics }); },
      poly(pts, front, optics) { for (let i = 0; i + 1 < pts.length; i++) this.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], front, optics); },
    };
  }

  function build(scene, L) {
    const p = L.params, fr = RF.Profile.axisFrame(scene, p.axisMode || 'aim');
    const B = builder(fr.O, fr.W, fr.e1, 'L' + L.id);
    const n = p.ior, info = {};
    if (L.kind === 'planoconvex') {
      // flat face toward the source; R = (n−1)f exactly (flat first surface ⇒ no thickness term)
      const R = (n - 1) * p.f, a = Math.min(p.a, 0.98 * R);
      const s = R - Math.sqrt(R * R - a * a), t = s + p.edge;
      const d = p.auto ? p.f - t / n : p.d;                 // source at the front focal point
      B.line(0, d, a, d, -1, glass(p));                      // flat face (front = −z, toward source)
      B.arc(d + t - R, R, d + t - s, d + t, a, 1, glass(p)); // convex cap (front = outward)
      B.line(a, d, a, d + t - s, 1, ABSORB);                 // ground edge
      Object.assign(info, { R, t, d, sag: s });
    } else if (L.kind === 'biconvex') {
      // symmetric R1 = −R2 = R; thick lens: 1/f = (n−1)(2/R − (n−1)t/(nR²)); iterate t(R)
      let R = 2 * (n - 1) * p.f, t = 0;
      for (let it = 0; it < 30; it++) {
        const a = Math.min(p.a, 0.98 * R), s = R - Math.sqrt(R * R - a * a);
        t = 2 * s + p.edge;
        const A = (n - 1) * t / n, disc = 4 - 4 * A / (p.f * (n - 1));
        if (disc <= 0) break;
        R = 2 * A / (2 - Math.sqrt(disc));
      }
      const a = Math.min(p.a, 0.98 * R), s = R - Math.sqrt(R * R - a * a);
      const h1 = p.f * (n - 1) * t / (n * R);                // front principal plane behind vertex 1
      const d = p.auto ? p.f - h1 : p.d;
      B.arc(d + R, R, d, d + s, a, 1, glass(p));             // front cap, centre beyond the lens
      B.arc(d + t - R, R, d + t - s, d + t, a, 1, glass(p)); // back cap
      B.line(a, d + s, a, d + t - s, 1, ABSORB);
      Object.assign(info, { R, t, d });
    } else if (L.kind === 'fresnel') {
      // Flat back face toward the source at distance d; N annular prisms on the far side.  Each
      // ring's slope makes the ray from the source through the ring centre leave parallel to the
      // axis (vector Snell at the flat face, then solve the exit normal ∝ n·d₁ − ẑ).
      const N = Math.max(1, p.rings | 0), a = p.a, tb = p.tb, d = p.auto ? p.f : p.d;
      const pts = []; let prevLow = null;
      for (let i = 0; i < N; i++) {
        const r0 = a * i / N, r1 = a * (i + 1) / N, rm = 0.5 * (r0 + r1);
        let rf = rm;                                          // entry radius on the flat face
        let sin1 = 0, cos1 = 1;
        for (let it = 0; it < 20; it++) {
          const th0 = Math.atan2(rf, d); sin1 = Math.sin(th0) / n; cos1 = Math.sqrt(1 - sin1 * sin1);
          rf = rm - tb * sin1 / cos1;
        }
        const Nr = n * sin1, Nz = n * cos1 - 1, slope = -Nr / Nz;   // dz/dr of the prism face
        const h = Math.abs(slope) * (r1 - r0);
        pts.push([r0, d + tb + h]);                           // ring top (riser top for i > 0)
        prevLow = [r1, d + tb];
        pts.push(prevLow);
      }
      B.poly(pts, 1, glass(p));                               // prisms + risers (front = air side)
      B.line(a, d + tb, a, d, 1, ABSORB);                     // edge
      B.line(0, d, a, d, -1, glass(p));                       // flat back face (front toward source)
      Object.assign(info, { d, rings: N, ringWidth: a / N });
    } else if (L.kind === 'tir') {
      // TIR collimator.  Central dome: Cartesian surface √(r²+z²) − n·z = const collimates the
      // on-axis point source into glass.  Side rays enter the cylindrical cavity wall, refract, and
      // meet an outer surface integrated so its normal ∝ (d_glass − ẑ): TIR sends them along +z.
      const rc = p.rc, hc = p.hc, K = hc * (1 - n);
      const dome = (r) => (-n * K + Math.sqrt(K * K + (n * n - 1) * r * r)) / (n * n - 1);
      const zTopCav = dome(rc), th1 = Math.atan2(rc, zTopCav), thMax = Math.min(89, p.thMax) * D2R;
      const Wp = (th) => [rc, rc / Math.tan(th)];
      const dg = (th) => { const cz = Math.cos(th) / n; return [Math.sqrt(1 - cz * cz), cz]; };
      const Nout = (th) => { const g = dg(th); const v = [g[0], g[1] - 1]; const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
      // dL/dθ = −(W' + L·dg')·N / (dg·N) — linear in L; integrate homogeneous + particular (RK4)
      const steps = 400;
      function integrate(L0) {
        const pts = []; let L = L0;
        const f = (th, Lv) => {
          const e = 1e-6, W1 = Wp(th + e), W0 = Wp(th - e), g1 = dg(th + e), g0 = dg(th - e), N = Nout(th), g = dg(th);
          const Wd = [(W1[0] - W0[0]) / (2 * e), (W1[1] - W0[1]) / (2 * e)], gd = [(g1[0] - g0[0]) / (2 * e), (g1[1] - g0[1]) / (2 * e)];
          return -((Wd[0] + Lv * gd[0]) * N[0] + (Wd[1] + Lv * gd[1]) * N[1]) / (g[0] * N[0] + g[1] * N[1]);
        };
        const h = (th1 - thMax) / steps;                    // integrate from thMax down to th1
        let th = thMax;
        for (let i = 0; i <= steps; i++) {
          const W = Wp(th), g = dg(th);
          pts.push([W[0] + L * g[0], W[1] + L * g[1], th]);
          if (i === steps) break;
          const k1 = f(th, L), k2 = f(th + h / 2, L + h * k1 / 2), k3 = f(th + h / 2, L + h * k2 / 2), k4 = f(th + h, L + h * k3);
          L += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6; th += h;
        }
        return pts;
      }
      // choose L0 so the outer rim reaches radius A (the rim radius is affine in L0)
      const rA = integrate(0.5 * rc), rB = integrate(1.5 * rc);
      const ra = rA[rA.length - 1][0], rb = rB[rB.length - 1][0];
      const L0 = 0.5 * rc + (p.A - ra) * (rc / Math.max(1e-12, rb - ra));
      const outer = integrate(Math.max(0.05 * rc, L0));
      const zTop = Math.max(...outer.map((q) => q[1]), zTopCav + 0.5);
      const rTop = outer[outer.length - 1][0];
      // TIR check along the outer profile
      let tirOk = 0;
      for (const q of outer) { const g = dg(q[2]), N = Nout(q[2]); if (Math.acos(Math.abs(g[0] * N[0] + g[1] * N[1])) > Math.asin(1 / n)) tirOk++; }
      const zb = Wp(thMax)[1];
      const domePts = []; for (let i = 0; i <= 16; i++) { const r = rc * i / 16; domePts.push([r, dome(r)]); }
      B.poly(domePts, -1, glass(p));                          // dome: air below (toward source)
      B.line(rc, zb, rc, zTopCav, 1, glass(p));               // cavity wall: air toward the axis
      B.poly(RF.Profile.resample(outer.map((q) => [q[0], q[1]]), 48), -1, glass(p));   // outer TIR surface (48 rings): air outside
      if (zTop > outer[outer.length - 1][1] + 1e-9) B.line(rTop, outer[outer.length - 1][1], rTop, zTop, -1, glass(p));
      B.line(0, zTop, rTop, zTop, 1, glass(p));               // flat exit face
      B.line(rc, zb, outer[0][0], outer[0][1], -1, ABSORB);   // mounting flange
      Object.assign(info, { rTop, zTop, tirFraction: tirOk / outer.length, domeEdge: zTopCav, theta1: th1 / D2R });
    }
    return { surfaces: B.out, info };
  }

  function buildAll(scene) {
    const out = [], infos = {};
    for (const L of scene.lenses) { const b = build(scene, L); out.push(...b.surfaces); infos[L.id] = b.info; }
    return { surfaces: out, infos };
  }
  const bouncesNeeded = (kind) => (kind === 'tir' ? 3 : 2);

  RF.Lenses = { defaults, build, buildAll, bouncesNeeded };
})(typeof globalThis !== 'undefined' ? globalThis : this);
