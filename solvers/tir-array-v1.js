/* tir-array-v1.js — TIR collimator array (matrix / ADB-style), experimental.
 *
 * One TIR collimator per emitter (input.sources).  Each is a "unit":
 *   body  — ported from js/lenses.js 'tir': Cartesian dome (exact hyperboloid of the point source) for the central
 *           cone, cylindrical cavity wall, RK4-integrated outer TIR profile, absorbing flange.  rc, hc are raised to
 *           clear each LED's keep-out.
 *   aim   — the whole body is tilted about its LED so its axis points at the (weighted) centre of the part of the
 *           target the unit is given (limited to maxTilt; prisms do the rest).
 *   spread — the flat exit face is replaced by a grid of flat prism cells (plane, refract).  Each cell deflects its
 *           share of the collimated beam (vector Snell: outward normal ∝ n·W − d_out) to the centre of an
 *           equal-flux region of the unit's paint (recursive bisection of the paint against the cells' fluxes, the
 *           fluxes predicted from the collimator's θ → exit-radius map and a Lambertian LED).  Spread = the paint.
 *   share — the paint is cut into contiguous horizontal slices, one per unit, each holding flux ∝ the emitter's power
 *           (left emitter → left slice, so axes diverge); 'shared' gives every unit the whole paint.
 * Fit: aperture A per unit shrinks to the emitter pitch, the envelope, and so units never touch (axis segments
 * kept ≥ rTop_i + rTop_j apart).  No reflecting facets: the facet budget is untouched.  needs.bounces = 4.
 */
(function () {
  'use strict';
  const RF = globalThis.RF;
  const D2R = Math.PI / 180;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => mul(a, 1 / (len(a) || 1));
  const perp = (w) => norm(cross(w, Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]));

  // ---- the TIR collimator profile in (r, z), LED at the origin, axis +z (port of lenses.js 'tir')
  function profile(n, rc, hc, A, thMaxDeg) {
    const K = hc * (1 - n);
    const dome = (r) => (-n * K + Math.sqrt(K * K + (n * n - 1) * r * r)) / (n * n - 1);
    const zTopCav = dome(rc), th1 = Math.atan2(rc, zTopCav), thMax = Math.min(89, thMaxDeg) * D2R;
    const Wp = (th) => [rc, rc / Math.tan(th)];
    const dg = (th) => { const cz = Math.cos(th) / n; return [Math.sqrt(1 - cz * cz), cz]; };
    const Nout = (th) => { const g = dg(th); const v = [g[0], g[1] - 1]; const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
    const steps = 400;
    function integrate(L0) {
      const pts = []; let L = L0;
      const f = (th, Lv) => {
        const e = 1e-6, W1 = Wp(th + e), W0 = Wp(th - e), g1 = dg(th + e), g0 = dg(th - e), N = Nout(th), g = dg(th);
        const Wd = [(W1[0] - W0[0]) / (2 * e), (W1[1] - W0[1]) / (2 * e)], gd = [(g1[0] - g0[0]) / (2 * e), (g1[1] - g0[1]) / (2 * e)];
        return -((Wd[0] + Lv * gd[0]) * N[0] + (Wd[1] + Lv * gd[1]) * N[1]) / (g[0] * N[0] + g[1] * N[1]);
      };
      const h = (th1 - thMax) / steps; let th = thMax;
      for (let i = 0; i <= steps; i++) {
        const W = Wp(th), g = dg(th);
        pts.push([W[0] + L * g[0], W[1] + L * g[1], th]);
        if (i === steps) break;
        const k1 = f(th, L), k2 = f(th + h / 2, L + h * k1 / 2), k3 = f(th + h / 2, L + h * k2 / 2), k4 = f(th + h, L + h * k3);
        L += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6; th += h;
      }
      return pts;
    }
    const rA = integrate(0.5 * rc), rB = integrate(1.5 * rc);
    const ra = rA[rA.length - 1][0], rb = rB[rB.length - 1][0];
    const L0 = 0.5 * rc + (A - ra) * (rc / Math.max(1e-12, rb - ra));
    const outer = integrate(Math.max(0.05 * rc, L0));
    const zLast = outer[outer.length - 1][1];
    const zTop = Math.max(zLast, ...outer.map((q) => q[1]), zTopCav + 0.5) + 0.5;   // +0.5: room for the prism cells
    const rTop = outer[outer.length - 1][0];
    return { dome, zTopCav, th1, thMax, outer, zTop, rTop, zb: Wp(thMax)[1], zLast };
  }

  // exit-face flux map: Lambertian point source, θ → exit radius (dome: where the ray meets the dome; TIR: the profile)
  function exitSamples(pf, n) {
    const out = [], NT = 600, NP = 48;
    const domeR = (th) => { let lo = 0, hi = pf.outer.length ? 1e3 : 1; hi = 50; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (Math.atan2(m, pf.dome(m)) < th) lo = m; else hi = m; } return lo; };
    const outerR = (th) => { const o = pf.outer; for (let i = 0; i + 1 < o.length; i++) { const a = o[i], b = o[i + 1]; if ((th - a[2]) * (th - b[2]) <= 0) { const t = (th - a[2]) / ((b[2] - a[2]) || 1); return a[0] + t * (b[0] - a[0]); } } return o[o.length - 1][0]; };
    for (let i = 0; i < NT; i++) {
      const th = (i + 0.5) / NT * pf.thMax, w = Math.sin(th) * Math.cos(th);
      const r = th < pf.th1 ? domeR(th) : outerR(th);
      for (let j = 0; j < NP; j++) { const ph = (j + 0.5) / NP * 2 * Math.PI; out.push([r * Math.cos(ph), r * Math.sin(ph), w]); }
    }
    return out;
  }

  function clipPoly(poly, clipper) {                 // Sutherland–Hodgman, convex clipper (CCW)
    let out = poly;
    for (let i = 0; i < clipper.length && out.length; i++) {
      const a = clipper[i], b = clipper[(i + 1) % clipper.length], inp = out; out = [];
      const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
      }
    }
    return out;
  }
  const polyArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

  // recursive bisection: assign each exit cell (flux f) the weighted centre of an equal-flux region of paint points
  function bisect(cells, pts, outAim) {
    if (!cells.length) return;
    const W = pts.reduce((s, p) => s + p.w, 0);
    if (cells.length === 1 || pts.length <= 1) {
      let u = 0, v = 0; for (const p of pts) { u += p.u * p.w; v += p.v * p.w; }
      const c = W > 0 ? [u / W, v / W] : (pts[0] ? [pts[0].u, pts[0].v] : [0, 0]);
      for (const cl of cells) outAim.set(cl, { uv: c, pts });
      return;
    }
    // split cells spatially (along their longer extent) so neighbouring cells take neighbouring regions
    const ex = (k) => Math.max(...cells.map((c) => c.xy[k])) - Math.min(...cells.map((c) => c.xy[k]));
    const ck = ex(0) >= ex(1) ? 0 : 1;
    const cs = cells.slice().sort((a, b) => a.xy[ck] - b.xy[ck] || a.idx - b.idx);
    const half = cs.length >> 1, c1 = cs.slice(0, half), c2 = cs.slice(half);
    const F1 = c1.reduce((s, c) => s + c.f, 0), F2 = c2.reduce((s, c) => s + c.f, 0), frac = F1 / Math.max(1e-30, F1 + F2);
    const pu = Math.max(...pts.map((p) => p.u)) - Math.min(...pts.map((p) => p.u)), pv = Math.max(...pts.map((p) => p.v)) - Math.min(...pts.map((p) => p.v));
    const pk = pu >= pv ? 'u' : 'v';
    const ps = pts.slice().sort((a, b) => a[pk] - b[pk] || a.i - b.i);
    let acc = 0, cut = 0; const target = frac * W;
    for (; cut < ps.length; cut++) { if (acc + ps[cut].w / 2 > target) break; acc += ps[cut].w; }
    cut = Math.max(1, Math.min(ps.length - 1, cut));
    // cells sorted along x pair with paint sorted along u (or v): keep orientation consistent (exit-face x ↔ target u)
    bisect(c1, ps.slice(0, cut), outAim); bisect(c2, ps.slice(cut), outAim);
  }

  RF.Solvers.register({
    id: 'tir-array-v1', name: 'TIR collimator array (experimental)', version: '0.1',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0, help: 'unused: no reflecting facets' },
      { key: 'aperture', label: 'Max collimator radius A (mm)', type: 'number', min: 6, max: 60, step: 1, default: 18 },
      { key: 'ior', label: 'Glass index', type: 'number', min: 1.3, max: 1.9, step: 0.01, default: 1.49 },
      { key: 'cell', label: 'Exit prism cell (mm)', type: 'number', min: 0.8, max: 10, step: 0.1, default: 2.2 },
      { key: 'maxTilt', label: 'Max body tilt (°)', type: 'number', min: 0, max: 30, step: 1, default: 12 },
      { key: 'split', label: 'Flux share', type: 'select', options: [{ value: 'slices', label: 'slices (one region per unit)' }, { value: 'shared', label: 'shared (every unit: whole paint)' }], default: 'slices' },
    ],
    solve(input, settings) {
      const n = settings.ior, env = input.envelope, keep = env.keepOut || 0;
      const srcs = (input.sources && input.sources.length ? input.sources : [input.source]);
      const notes = [];
      // ---- paint → directions (target u = right, v = up)
      const T = RF.Engine.targetFrame(Object.assign({}, input.target, { res: input.paint.res }));
      const res = input.paint.res, cells = input.paint.cells, pts = [];
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const w = cells[j * res + i]; if (!(w > 0)) continue;
        const uv = RF.Engine.cellCenter(T, i, j); pts.push({ i: j * res + i, u: uv[0], v: uv[1], w });
      }
      if (!pts.length) return { surfaces: [], intent: [], notes: ['empty paint: nothing to aim at'] };
      const world = (u, v) => add(T.C, add(mul(T.tu, u), mul(T.tv, v)));
      // ---- units: order by the emitter's position along the target's u axis (left → right), slices by power share
      const units = srcs.map((s, k) => ({ k, src: s, pos: s.pos.slice(), u0: dot(s.pos, T.tu), P: s.power || 1 }))
        .sort((a, b) => a.u0 - b.u0 || a.k - b.k);
      const Ptot = units.reduce((s, x) => s + x.P, 0);
      if (settings.split === 'shared' || units.length === 1) for (const un of units) un.pts = pts;
      else {
        const ps = pts.slice().sort((a, b) => a.u - b.u || a.v - b.v), W = ps.reduce((s, p) => s + p.w, 0);
        let c = 0, acc = 0;
        for (let q = 0; q < units.length; q++) {
          const goal = W * units.slice(0, q + 1).reduce((s, x) => s + x.P, 0) / Ptot, part = [];
          while (c < ps.length && (q === units.length - 1 || acc + ps[c].w / 2 <= goal)) { acc += ps[c].w; part.push(ps[c++]); }
          units[q].pts = part.length ? part : [ps[Math.min(c, ps.length - 1)]];
        }
      }
      // ---- aim: body axis toward the slice's weighted centre, tilt limited relative to the emitter axis
      for (const un of units) {
        let u = 0, v = 0, w = 0; for (const p of un.pts) { u += p.u * p.w; v += p.v * p.w; w += p.w; }
        const want = norm(sub(world(u / w, v / w), un.pos)), ax = norm(un.src.axis || [1, 0, 0]);
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(want, ax)))), lim = settings.maxTilt * D2R;
        un.W = ang <= lim ? want : norm(add(mul(ax, Math.cos(lim)), mul(norm(sub(want, mul(ax, dot(want, ax)))), Math.sin(lim))));
        un.tilt = Math.min(ang, lim) / D2R;
      }
      // ---- pitch, envelope and mutual clearance fit: shrink A per unit
      const rc = Math.max(4, keep + 0.6), hc = Math.max(5, keep + 0.8);
      let pitch = Infinity;
      for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) pitch = Math.min(pitch, len(sub(units[a].pos, units[b].pos)));
      for (const un of units) un.A = Math.max(rc + 1.5, Math.min(settings.aperture, isFinite(pitch) ? pitch / 2 - 0.6 : Infinity));
      const frame = (un) => { const ex = perp(un.W), ey = cross(un.W, ex); return { ex, ey }; };
      const toW = (un, r, z, ph) => { const f = frame(un); return add(un.pos, add(add(mul(f.ex, r * Math.cos(ph)), mul(f.ey, r * Math.sin(ph))), mul(un.W, z))); };
      const fits = (un) => {
        const pf = un.pf, pr = [[pf.rTop, pf.zTop], [pf.outer[0][0], pf.outer[0][1]], [pf.rTop, pf.zLast]];
        for (let q = 0; q < pf.outer.length; q += 40) pr.push([pf.outer[q][0], pf.outer[q][1]]);
        for (const [r, z] of pr) for (let m = 0; m < 16; m++) if (!RF.Geo.envInside(env, toW(un, r, z, m * Math.PI / 8), 1e-6)) return false;
        return true;
      };
      for (const un of units) for (let it = 0; it < 40; it++) { un.pf = profile(n, rc, hc, un.A, 88); if (fits(un) || un.A <= rc + 1.5) break; un.A *= 0.93; }
      const segDist = (a, b) => { let m = Infinity; for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) m = Math.min(m, len(sub(add(a.pos, mul(a.W, a.pf.zTop * i / 12)), add(b.pos, mul(b.W, b.pf.zTop * j / 12))))); return m; };
      for (let it = 0; it < 40; it++) {
        let bad = false;
        for (let a = 0; a < units.length; a++) for (let b = a + 1; b < units.length; b++) {
          const A = units[a], B = units[b];
          if (segDist(A, B) < A.pf.rTop + B.pf.rTop + 0.4) { bad = true; for (const U of [A, B]) if (U.A > rc + 1.5) { U.A *= 0.95; U.pf = profile(n, rc, hc, U.A, 88); } }
        }
        if (!bad) break;
      }
      // ---- build
      const surfaces = [], intent = [];
      const glass = { interaction: 'refract', reflectivity: 0.9, ior: n, fresnelT: 0.96, twoSided: false };
      const ABSORB = { interaction: 'absorb', reflectivity: 0, ior: 1, fresnelT: 1, twoSided: true };
      units.forEach((un, ui) => {
        const pf = un.pf, gid = 'T' + ui, f = frame(un); let kk = 0;
        const rev = (seg, front, optics) => surfaces.push({ type: 'rev', id: gid + '_' + (kk++), group: 'L', O: un.pos.slice(), W: un.W.slice(), ref: f.ex, seg, front, optics });
        const line = (r0, z0, r1, z1, front, optics) => rev({ kind: 'line', r0: Math.max(0, r0), z0, r1: Math.max(0, r1), z1 }, front, optics);
        for (let i = 0; i < 20; i++) { const r0 = rc * i / 20, r1 = rc * (i + 1) / 20; line(r0, pf.dome(r0), r1, pf.dome(r1), -1, glass); }
        line(rc, pf.zb, rc, pf.zTopCav, 1, glass);
        const o = pf.outer, M = 48;
        for (let i = 0; i < M; i++) { const a = o[Math.round(i * (o.length - 1) / M)], b = o[Math.round((i + 1) * (o.length - 1) / M)]; line(a[0], a[1], b[0], b[1], -1, glass); }
        if (pf.zTop > pf.zLast + 1e-9) line(pf.rTop, pf.zLast, pf.rTop, pf.zTop, -1, glass);
        line(rc, pf.zb, o[0][0], o[0][1], -1, ABSORB);
        // exit prism cells
        const R = pf.rTop * 0.9995, circ = []; for (let m = 0; m < 48; m++) circ.push([R * Math.cos(m * Math.PI / 24), R * Math.sin(m * Math.PI / 24)]);
        const cs = Math.min(settings.cell, pf.rTop / 1.5), N = Math.ceil(R / cs), exitCells = [];
        for (let a = -N; a < N; a++) for (let b = -N; b < N; b++) {
          const sq = [[a * cs, b * cs], [(a + 1) * cs, b * cs], [(a + 1) * cs, (b + 1) * cs], [a * cs, (b + 1) * cs]];
          const pg = clipPoly(sq, circ), ar = pg.length >= 3 ? polyArea(pg) : 0;
          if (ar < 0.02 * cs * cs) continue;
          let cx = 0, cy = 0; for (const p of pg) { cx += p[0]; cy += p[1]; } cx /= pg.length; cy /= pg.length;
          exitCells.push({ idx: exitCells.length, poly: pg, xy: [cx, cy], f: 0, a, b });
        }
        // predicted flux per cell
        const lookup = new Map(exitCells.map((c) => [c.a + ',' + c.b, c]));
        for (const s of exitSamples(pf, n)) { const c = lookup.get(Math.floor(s[0] / cs) + ',' + Math.floor(s[1] / cs)); if (c) c.f += s[2]; }
        const lit = exitCells.filter((c) => c.f > 0), Fsum = lit.reduce((s, c) => s + c.f, 0);
        for (const c of lit) c.f /= Fsum;
        // orient exit-face (x, y) like the target (u, v) so the bisection keeps neighbours together
        const ux = dot(f.ex, T.tu), uy = dot(f.ey, T.tu);
        for (const c of exitCells) { const x = c.xy[0], y = c.xy[1]; c.xy = [x * ux + y * uy, -x * uy + y * ux]; }
        const aims = new Map(); bisect(lit, un.pts, aims);
        for (const c of exitCells) {
          const A = aims.get(c), local = c.poly;
          const lc = local.reduce((s, p) => [s[0] + p[0] / local.length, s[1] + p[1] / local.length], [0, 0]);
          const P = add(un.pos, add(add(mul(f.ex, lc[0]), mul(f.ey, lc[1])), mul(un.W, pf.zTop)));
          const dOut = A ? norm(sub(world(A.uv[0], A.uv[1]), P)) : un.W;
          let N = norm(sub(mul(un.W, n), dOut));              // outward (air-side) normal: n·d_in − d_out
          const Nx = dot(N, f.ex), Ny = dot(N, f.ey), Nz = dot(N, un.W);
          if (Nz < 0.2) N = un.W;
          const pts3 = local.map((p) => { const z = Nz >= 0.2 ? pf.zTop - ((p[0] - lc[0]) * Nx + (p[1] - lc[1]) * Ny) / Nz : pf.zTop; return add(un.pos, add(add(mul(f.ex, p[0]), mul(f.ey, p[1])), mul(un.W, z))); });
          const id = gid + '_x' + c.idx;
          surfaces.push({ type: 'plane', id, group: 'L', P, n: N, clip: { kind: 'poly', pts3 }, optics: glass });
          if (A) intent.push({ facet: id, cells: A.pts.map((p) => [p.i, p.w]) });
        }
        un.cells = exitCells.length;
      });
      notes.push(units.length + ' TIR unit' + (units.length > 1 ? 's' : '') + ' (one per emitter), ' + settings.split + ' flux share; rc ' + rc.toFixed(1) + ' mm, hc ' + hc.toFixed(1) + ' mm (LED clearance ' + keep + ' mm)');
      for (const un of units) notes.push('unit ' + (un.src.id || 'e' + un.k) + ': A ' + un.A.toFixed(1) + ' mm (rim ' + un.pf.rTop.toFixed(1) + '), height ' + un.pf.zTop.toFixed(1) + ' mm, tilt ' + un.tilt.toFixed(1) + '°, ' + un.cells + ' exit prisms, ' + un.pts.length + ' paint cells');
      if (units.length === 1) notes.push('one emitter = one unit: its exit prisms spread the collimated beam over the whole paint. Add emitters (scene.emitters) for more units, each lighting its own slice.');
      return { surfaces, intent, notes, needs: { bounces: 4 } };
    },
  });
})();
