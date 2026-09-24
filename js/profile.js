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

  // Bounces a preset needs to work as intended (raised visibly by the UI, never silently)
  function bouncesNeeded(mc) {
    if (mc.interaction === 'refract') return 2;
    if (mc.preset && mc.preset.kind === 'cpc') return 4;
    return 1;
  }

  RF.Profile = { axisFrame, presetProfile, build, resample, bouncesNeeded };
})(typeof globalThis !== 'undefined' ? globalThis : this);
