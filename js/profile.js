/* profile.js — Mode C: draw a 2D cross-section and sweep it.
 *
 * Profile points are (r, z) in a frame whose ORIGIN IS THE SOURCE POSITION (so every preset
 * respects the configured source) and whose z axis is chosen by axisMode: toward the aim point
 * (default), along the source's emission axis, or a world axis.
 *   revolve (default): each segment → an exact surface of revolution (cone frustum / cylinder /
 *     annulus quadric) — smooth in azimuth; optional azimuthal faceting into flat quads.
 *   extrude: each segment → a flat strip of length L perpendicular to the profile plane (trough).
 * Front side = the LEFT normal of the drawn direction (point i → i+1).  "Flip facing" swaps it;
 * "Reverse axis" turns the sweep around; "Mirror" adds the mirrored copy (z → −z for revolve,
 * r → −r for extrude).  A profile can be tagged reflect / refract / absorb.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const D2R = Math.PI / 180;

  function axisFrame(scene, mode) {
    const S = scene.source.pos;
    let W;
    switch (mode) {
      case 'source': W = V.norm(scene.source.axis); break;
      case 'x': W = [1, 0, 0]; break;
      case 'y': W = [0, 1, 0]; break;
      case 'z': W = [0, 0, 1]; break;
      default: W = V.norm(V.sub(RF.Engine.aimPoint(scene.target), S));
    }
    // reference ⊥ W for extrusion planes: prefer world z (or x when W ∥ z)
    const ref = V.inPlane(W, Math.abs(W[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0]);
    return { O: S.slice(), W, e1: ref, e2: V.cross(W, ref) };
  }

  // ---------------------------------------------------------------- presets → profile points
  function presetProfile(p, scene) {
    const n = Math.max(2, p.n | 0), out = [];
    if (p.kind === 'parabola') {
      // focus at the source, opening toward +z: ρ(ψ) = 2f/(1+cosψ), ψ from −z.  Sampled uniformly in
      // ψ (equal angular steps as seen from the focus) up to the rim radius.
      const f = p.f, R = p.rim;
      const psiRim = 2 * Math.atan(R / (2 * f));          // r = 2f tan(ψ/2)
      for (let i = 0; i <= n; i++) { const psi = psiRim * i / n, rho = 2 * f / (1 + Math.cos(psi)); out.push([rho * Math.sin(psi), -rho * Math.cos(psi)]); }
    } else if (p.kind === 'ellipse') {
      // foci at the source and at +d on the axis; vertex f behind the source.
      const f = p.f, d = p.depth, a2 = 2 * f + d, R = p.rim;
      for (let i = 0; i <= n; i++) {
        const psi = Math.PI * 0.95 * i / n, rho = (a2 * a2 - d * d) / (2 * a2 + 2 * d * Math.cos(psi));
        const r = rho * Math.sin(psi); if (r > R && i > 0) break;
        out.push([r, -rho * Math.cos(psi)]);
      }
    } else if (p.kind === 'cpc') {
      // Compound parabolic concentrator used as a collimator: small aperture a1 at the source,
      // acceptance half-angle θ.  Right wall = parabola with focus at the opposite rim (−a1, 0) and
      // axis tilted by θ; f = a1(1 + sinθ); length L = (a1 + a2)/tanθ, a2 = a1/sinθ.
      const th = Math.max(2, Math.min(80, p.theta)) * D2R, a1 = p.a1 || 2;
      const f = a1 * (1 + Math.sin(th)), a2 = a1 / Math.sin(th), L = (a1 + a2) / Math.tan(th);
      const F = [-a1, 0], b0 = Math.PI / 2 - th;
      for (let i = 0; i <= 4 * n; i++) {
        const g = i / (4 * n) * (Math.PI / 2 + th), beta = g + b0, rho = 2 * f / (1 + Math.cos(beta));
        const x = F[0] + rho * Math.cos(g), z = F[1] + rho * Math.sin(g);
        if (z > L) { out.push([a2, L]); break; }
        out.push([x, z]);
      }
      // thin to n segments evenly in arc length
      return resample(out, n);
    } else if (p.kind === 'cone') {
      const R = p.rim, d = p.depth, th = p.theta * D2R;
      out.push([p.a1 || 2, -d * 0.2]); out.push([R, -d * 0.2 + (R - (p.a1 || 2)) / Math.tan(Math.max(0.05, th))]);
    } else if (p.kind === 'sphere') {
      // spherical cap centred on the source: retro-reflects light back through the source
      const R = p.rim, span = Math.max(10, Math.min(170, p.theta)) * D2R;
      for (let i = 0; i <= n; i++) { const a = span * i / n; out.push([R * Math.sin(a), -R * Math.cos(a)]); }
    } else if (p.kind === 'flat') {
      out.push([0, -p.f]); out.push([p.rim, -p.f]);
    }
    return out;
  }
  function resample(pts, n) {
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const out = [], tot = L[L.length - 1];
    for (let k = 0; k <= n; k++) {
      const s = tot * k / n; let i = 1; while (i < L.length - 1 && L[i] < s) i++;
      const t = (s - L[i - 1]) / Math.max(1e-300, L[i] - L[i - 1]);
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
    }
    return out;
  }

  // ---------------------------------------------------------------- sweep
  function optics(mc) {
    return { interaction: mc.interaction, reflectivity: mc.reflectivity, ior: mc.ior, fresnelT: mc.fresnelT, twoSided: false };
  }
  function build(scene) {
    if (shellOn(scene.modeC)) return shellBuild(scene);
    const mc = scene.modeC, pts0 = (mc.profile || []).map((p) => [p[0], p[1]]);
    const out = [];
    if (pts0.length < 2) return { surfaces: out, report: { ok: false, error: 'Profile needs at least two points.' } };
    const fr = axisFrame(scene, mc.axisMode);
    const W = mc.reverseAxis ? V.neg(fr.W) : fr.W;
    const e1 = fr.e1, e2 = mc.reverseAxis ? V.neg(fr.e2) : fr.e2;
    // Facing: the left normal of the drawn direction by default (the inside of a cup drawn from
    // its vertex outward).  A CLOSED refracting profile (both ends on the axis, or first = last)
    // bounds a solid: glass goes inside it automatically, so the front (air side) faces out.
    let auto = 1;
    const closed = pts0.length > 2 && ((Math.abs(pts0[0][0]) < 1e-9 && Math.abs(pts0[pts0.length - 1][0]) < 1e-9) ||
      Math.hypot(pts0[0][0] - pts0[pts0.length - 1][0], pts0[0][1] - pts0[pts0.length - 1][1]) < 1e-9);
    if (mc.interaction === 'refract' && closed) {
      let A2 = 0; const q = pts0.concat([[0, pts0[pts0.length - 1][1]], [0, pts0[0][1]]]);
      for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; A2 += a[0] * b[1] - b[0] * a[1]; }
      auto = A2 > 0 ? -1 : 1;                        // CCW ⇒ interior on the left ⇒ front on the right
    }
    const front = (mc.flipFacing ? -1 : 1) * auto;
    const copies = [{ pts: pts0, front }];
    if (mc.mirror) {
      if (mc.sweep === 'revolve') copies.push({ pts: pts0.map(([r, z]) => [r, -z]), front: -front });   // z → −z flips handedness
      else copies.push({ pts: pts0.map(([r, z]) => [-r, z]), front: -front });
    }
    let idx = 0;
    for (const c of copies) {
      for (let i = 0; i + 1 < c.pts.length; i++) {
        let [r0, z0] = c.pts[i], [r1, z1] = c.pts[i + 1];
        if (Math.hypot(r1 - r0, z1 - z0) <= 1e-9 * (Math.abs(r0) + Math.abs(z0) + Math.abs(r1) + Math.abs(z1) + 1e-300)) continue;
        const id = 'C' + (idx++);
        if (mc.sweep === 'revolve') {
          r0 = Math.max(0, r0); r1 = Math.max(0, r1);
          if (mc.azSegments > 2) {
            const N = mc.azSegments | 0;
            for (let a = 0; a < N; a++) {
              const pa = 2 * Math.PI * a / N, pb = 2 * Math.PI * (a + 1) / N;
              const at = (r, z, p) => V.add(fr.O, V.add(V.mul(W, z), V.add(V.mul(e1, r * Math.cos(p)), V.mul(e2, r * Math.sin(p)))));
              const q = [at(r0, z0, pa), at(r0, z0, pb), at(r1, z1, pb), at(r1, z1, pa)].filter((p, k, arr) => k === 0 || V.dist(p, arr[k - 1]) > 1e-12);
              if (q.length < 3) continue;
              // left normal in (r,z) at mid azimuth → world
              const pm = 0.5 * (pa + pb), er = V.add(V.mul(e1, Math.cos(pm)), V.mul(e2, Math.sin(pm)));
              const nl = V.norm(V.add(V.mul(er, -(z1 - z0)), V.mul(W, r1 - r0)));
              const P = V.mul(q.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / q.length);
              // chordal plane normal (exact for the planar trapezoid), oriented like the left normal
              let n = V.norm(V.cross(V.sub(q[1], q[0]), V.sub(q[q.length - 1], q[0])));
              if (V.dot(n, nl) < 0) n = V.neg(n);
              if (c.front < 0) n = V.neg(n);
              out.push({ type: 'plane', id: id + '_' + a, group: 'C', P, n, clip: { kind: 'poly', pts3: q }, optics: optics(mc) });
            }
          } else {
            out.push({ type: 'rev', id, group: 'C', O: fr.O, W, ref: e1, seg: { kind: 'line', z0, r0, z1, r1 }, front: c.front, optics: optics(mc) });
          }
        } else {
          const at = (x, z) => V.add(fr.O, V.add(V.mul(W, z), V.mul(e1, x)));
          const p0 = at(r0, z0), p1 = at(r1, z1), P = V.mul(V.add(p0, p1), 0.5);
          const t = V.norm(V.sub(p1, p0));
          // left normal of (dx, dz) in the (e1, W) plane: (−dz, dx)
          let n = V.norm(V.add(V.mul(e1, -(z1 - z0)), V.mul(W, r1 - r0)));
          if (c.front < 0) n = V.neg(n);
          out.push({ type: 'plane', id, group: 'C', P, n, clip: { kind: 'rect', hx: V.dist(p0, p1) / 2, hy: mc.extrudeLength / 2, ref: t }, optics: optics(mc) });
        }
      }
    }
    return { surfaces: out, report: { ok: out.length > 0, segments: out.length } };
  }

  // ---------------------------------------------------------------- curve objects (the Profile editor's curve mode)
  // A curve is the profile as a CHAIN: nodes [[r,z],…] joined by segments, each segment a quadratic Bézier
  // (= a parabolic arc, the conic the vector editors use) described by one number, bulge[i] = sagitta / chord
  // (signed, + toward the left normal of the drawn direction; 0 = straight).  The engine never sees it: the
  // sweep still reads modeC.profile, which the editor rewrites as curveFlatten(curve).  Because a straight chain
  // is just bulge 0, any old point profile converts losslessly (curveFromPoints), and a profile with no
  // modeC.curve (every old scene) is untouched.  modeC.curve is trusted only while it still flattens to modeC.profile
  // (curveLive), so a preset or a point edit that rewrites the profile silently retires it.
  function segGeom(a, b, k) {
    const dr = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dr, dz) || 1e-12;
    const n = [-dz / L, dr / L], M = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { L, n, M, mid: [M[0] + n[0] * k * L, M[1] + n[1] * k * L], ctrl: [M[0] + n[0] * 2 * k * L, M[1] + n[1] * 2 * k * L] };
  }
  function kFromMid(a, b, m) { const g = segGeom(a, b, 0); return ((m[0] - g.M[0]) * g.n[0] + (m[1] - g.M[1]) * g.n[1]) / g.L; }
  function segPoints(a, b, k) {                                   // a..b inclusive, uniform in the Bézier parameter
    if (!k) return [[a[0], a[1]], [b[0], b[1]]];
    const c = segGeom(a, b, k).ctrl, N = Math.max(4, Math.min(32, Math.ceil(Math.abs(k) * 60))), out = [];
    for (let i = 0; i <= N; i++) { const t = i / N, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); }
    out[0] = [a[0], a[1]]; out[N] = [b[0], b[1]];
    return out;
  }
  function curveFlatten(cv) {
    const out = [];
    for (let i = 0; i + 1 < cv.nodes.length; i++) { const sp = segPoints(cv.nodes[i], cv.nodes[i + 1], cv.bulge[i] || 0); if (i) sp.shift(); for (const p of sp) out.push(p); }
    return out;
  }
  function curveFromPoints(pts) { return { nodes: pts.map((p) => [p[0], p[1]]), bulge: pts.slice(1).map(() => 0) }; }
  function curveLive(mc) {
    const cv = mc.curve;
    if (!cv || !Array.isArray(cv.nodes) || !Array.isArray(cv.bulge) || cv.nodes.length < 2 || cv.bulge.length !== cv.nodes.length - 1) return null;
    const f = curveFlatten(cv), p = mc.profile;
    if (f.length !== p.length) return null;
    for (let i = 0; i < f.length; i++) if (Math.abs(f[i][0] - p[i][0]) > 1e-9 || Math.abs(f[i][1] - p[i][1]) > 1e-9) return null;
    return cv;
  }
  // Split segment i at its parametric midpoint (de Casteljau).  Each half is re-fitted as a symmetric arc (bulge only), so the
  // shape is kept to a fraction of a percent of the chord, not exactly.
  function curveSplit(cv, i) {
    const a = cv.nodes[i], b = cv.nodes[i + 1], g = segGeom(a, b, cv.bulge[i] || 0);
    const q0 = [(a[0] + g.ctrl[0]) / 2, (a[1] + g.ctrl[1]) / 2], q1 = [(g.ctrl[0] + b[0]) / 2, (g.ctrl[1] + b[1]) / 2], s = g.mid;
    const k0 = (cv.bulge[i] || 0) ? kFromCtrl(a, s, q0) : 0, k1 = (cv.bulge[i] || 0) ? kFromCtrl(s, b, q1) : 0;
    const nodes = cv.nodes.map((p) => p.slice()), bulge = cv.bulge.slice();
    nodes.splice(i + 1, 0, [s[0], s[1]]); bulge.splice(i, 1, k0, k1);
    return { nodes, bulge };
  }
  function kFromCtrl(a, b, c) { const g = segGeom(a, b, 0); return ((c[0] - g.M[0]) * g.n[0] + (c[1] - g.M[1]) * g.n[1]) / (2 * g.L); }
  // Drop node i; the two segments around it become one straight segment.
  function curveDeleteNode(cv, i) {
    const nodes = cv.nodes.map((p) => p.slice()), bulge = cv.bulge.slice();
    nodes.splice(i, 1);
    if (i === 0) bulge.splice(0, 1); else if (i === cv.nodes.length - 1) bulge.splice(i - 1, 1); else bulge.splice(i - 1, 2, 0);
    return { nodes, bulge };
  }


  // ---------------------------------------------------------------- facet shell (F5)
  // modeC.shell = { on, R, k, zv, r1, nRad, nAng, cells: { "ring:sector": { dv, dTheta, dPhi } } }  (sparse; absent = a plain profile).
  // The shell is ONE conic of revolution about the profile axis, x²+y²+(1+k)(z−zv)² = 2R(z−zv) out to radius r1 (z measured from the source,
  // like profile points), cut into nRad rings (equal in r) × nAng sectors.  Every cell is one `quad` surface that carries the EXACT conic
  // (its quadric re-expressed in the cell's own frame at the cell centre, so a default cell is the same sheet as a `rev` conic zone, for any
  // R, k, zv: no foci needed).  Per-cell offsets from the shell, all 0 = on the shell:
  //   dTheta, dPhi (deg)  turn the cell's REFLECTED direction outward from the axis / toward +azimuth (the normal turns by half), by tilting the cell's frame
  //   dv (1/m)            adds focusing power: the reflected beam's vergence changes by dv (+ converge, − diverge), split across the two
  //                       principal directions by the Coddington relations, as facetQuadric2 does for facets
  // modeC.profile stays the shell's own cross-section (shellProfile), so a build without this field still draws the plain cup.
  // A shell is live only for a reflecting, un-mirrored, un-flipped revolve; otherwise the profile builds as usual.
  const SHELL_OVERLAP = 0.06;                  // each cell's clip polygon is grown by this fraction of the cell on its interior edges: the polygons are
                                               // straight-edged and projected on different tangent planes, so touching ones leave slivers; overlap on the same sheet is harmless
  function shellOn(mc) {
    const s = mc.shell;
    return !!(s && s.on && mc.sweep === 'revolve' && mc.interaction === 'reflect' && !mc.mirror && !mc.flipFacing && s.R > 0 && s.r1 > 0 && s.nRad >= 1 && s.nAng >= 3);
  }
  // the shell conic that a preset describes (null: that preset is not a single conic of revolution about the source)
  function shellFromPreset(p) {
    if (p.kind === 'parabola') return { R: 2 * p.f, k: -1, zv: -p.f, r1: p.rim };
    if (p.kind === 'ellipse') { const a = p.f + p.depth / 2, c = p.depth / 2, b = Math.sqrt(a * a - c * c); return { R: b * b / a, k: -(c * c) / (a * a), zv: -p.f, r1: Math.min(p.rim, 0.98 * b) }; }
    if (p.kind === 'sphere') return { R: p.rim, k: 0, zv: -p.rim, r1: p.rim * Math.sin(Math.min(89, Math.max(10, p.theta)) * D2R) };
    return null;
  }
  const shellKey = (i, a) => i + ':' + a;
  function shellProfile(s, n) {                  // the cross-section as profile points (r, z)
    const out = [], N = Math.max(2, n | 0);
    const reach = 1 + s.k > 0 ? 0.9999 * s.R / Math.sqrt(1 + s.k) : Infinity;                  // a closed conic ends there (the build reports a rim beyond it)
    for (let i = 0; i <= N; i++) { const r = Math.min(s.r1 * i / N, reach); out.push([r, s.zv + RF.Geo.conicSag(s.R, s.k, r)]); }
    return out;
  }
  function shellBuild(scene) {
    const mc = scene.modeC, sh = mc.shell, out = [];
    const nR = sh.nRad | 0, nA = sh.nAng | 0, R = sh.R, k = sh.k || 0, k1 = 1 + k, zv = sh.zv, r1 = sh.r1, sag = (r) => RF.Geo.conicSag(R, k, r);
    if (!isFinite(sag(r1))) return { surfaces: out, report: { ok: false, error: 'The shell conic does not reach its rim radius (r too large for R, k).' } };
    const fr = axisFrame(scene, mc.axisMode), W = mc.reverseAxis ? V.neg(fr.W) : fr.W, e1 = fr.e1, e2 = mc.reverseAxis ? V.neg(fr.e2) : fr.e2;
    const dirW = (v) => V.add(V.mul(e1, v[0]), V.add(V.mul(e2, v[1]), V.mul(W, v[2]))), ptW = (v) => V.add(fr.O, dirW(v));   // axis frame → world
    const on = (r, ph) => [r * Math.cos(ph), r * Math.sin(ph), zv + sag(r)];
    const dot = V.dot, cross = V.cross, norm = V.norm, add = V.add, sub = V.sub, mul = V.mul;
    for (let i = 0; i < nR; i++) {
      const ra = r1 * i / nR, rb = r1 * (i + 1) / nR, rm = (ra + rb) / 2;
      for (let a = 0; a < nA; a++) {
        const pa = 2 * Math.PI * a / nA, pb = 2 * Math.PI * (a + 1) / nA, pm = (pa + pb) / 2;
        const Pc = on(rm, pm), g = [2 * Pc[0], 2 * Pc[1], 2 * k1 * (Pc[2] - zv) - 2 * R];
        const sgn = dot(g, Pc) > 0 ? -1 : 1;                                        // the front faces the source (the origin)
        const n0 = mul(norm(g), sgn), ex0 = norm([Math.cos(pm), Math.sin(pm), -2 * rm / g[2]]), d = norm(Pc);
        const cfg = sh.cells && sh.cells[shellKey(i, a)] || {}, dTh = +cfg.dTheta || 0, dPh = +cfg.dPhi || 0, dv = (+cfg.dv || 0) / 1000;
        // exact conic in the cell frame E0 = [ex0, ey0, n0]: u = E0ᵀ(x − Pc).  F(x) = xᵀQ0x + g·x + F(Pc) with Q0 = diag(1, 1, k1)
        const E = [ex0, cross(n0, ex0), n0], Q0 = [1, 1, k1], q = (p, r) => E[p][0] * Q0[0] * E[r][0] + E[p][1] * Q0[1] * E[r][1] + E[p][2] * Q0[2] * E[r][2];
        const f = -1 / dot(n0, g);                                                  // normalise so the local gradient is (0, 0, −1)
        let n = n0, ex = ex0;
        if (dTh || dPh) {
          const a0 = sub(d, mul(n0, 2 * dot(d, n0)));                              // the shell's own reflected direction
          let tW = [Math.cos(pm), Math.sin(pm), 0]; tW = sub(tW, mul(a0, dot(tW, a0))); tW = V.len(tW) > 1e-6 ? norm(tW) : [0, 0, 1];   // tW: outward from the axis, square to the beam
          let tP = [-Math.sin(pm), Math.cos(pm), 0]; tP = sub(tP, add(mul(a0, dot(tP, a0)), mul(tW, dot(tP, tW)))); tP = V.len(tP) > 1e-6 ? norm(tP) : cross(a0, tW);
          const a1 = norm(add(a0, add(mul(tW, Math.tan(dTh * D2R)), mul(tP, Math.tan(dPh * D2R))))); n = norm(sub(a1, d));
          const ax = cross(n0, n), sA = V.len(ax), cA = dot(n0, n);                // rotate the frame n0 → n (Rodrigues)
          if (sA > 1e-12) { const u = mul(ax, 1 / sA); ex = add(add(mul(ex0, cA), mul(cross(u, ex0), sA)), mul(u, dot(u, ex0) * (1 - cA))); }
        }
        const A = [f * q(0, 0), f * q(1, 1), f * q(2, 2), f * q(0, 1), f * q(0, 2), f * q(1, 2)], b = [f * dot(E[0], g), f * dot(E[1], g), -1];
        if (dv) { const c = Math.max(1e-3, -dot(d, n)); A[0] += c * dv / 4; A[1] += dv / (4 * c); }   // sag z = uᵀAu: curvature K = 2A, so ΔK = c·dv/2 (in the plane of incidence), dv/(2c) across it
        const Pw = ptW(Pc);
        const ov = SHELL_OVERLAP, qa = pa - ov * (pb - pa), qb = pb + ov * (pb - pa), sa = i > 0 ? ra - ov * (rb - ra) : ra, sb = i < nR - 1 ? rb + ov * (rb - ra) : rb;   // grown on the interior edges only: the rim and the axis stay exact
        const rim = []; if (i === nR - 1) for (let j = 1, m = Math.ceil((qb - qa) / (3 * D2R)); j < m; j++) rim.push(on(sb, qb - (qb - qa) * j / m));   // the rim edge is convex: follow the true circle, not its chord
        let corners = [on(sa, qa), on(sa, qb), on(sb, qb), ...rim, on(sb, qa)].map(ptW);
        corners = corners.filter((p, j, arr) => V.dist(p, arr[(j + arr.length - 1) % arr.length]) > 1e-9);
        if (corners.length < 3) continue;
        out.push({ type: 'quad', id: 'S' + i + '_' + a, group: 'C', P: Pw, n: dirW(n), ref: dirW(ex), quadric: { A, b }, clip: { kind: 'poly', pts3: corners }, front: 1, optics: optics(mc) });
      }
    }
    return { surfaces: out, report: { ok: out.length > 0, segments: out.length, shell: true, cells: out.length } };
  }

  // Bounces a preset needs to work as intended (raised visibly by the UI, never silently)
  function bouncesNeeded(mc) {
    if (mc.interaction === 'refract') return 2;
    if (mc.preset && mc.preset.kind === 'cpc') return 4;
    return 1;
  }

  RF.Profile = { axisFrame, presetProfile, build, resample, bouncesNeeded, segGeom, segPoints, kFromMid, curveFlatten, curveFromPoints, curveLive, curveSplit, curveDeleteNode, shellOn, shellFromPreset, shellProfile, shellKey, shellBuild };
})(typeof globalThis !== 'undefined' ? globalThis : this);
