/* solver.js — faceted reflector from a painted target.
 *
 * Two solvers are registered:
 *   blob       — static solver (no tracing inside solve)
 *   blob-auto  — tuner that traces candidates and picks the best settings for a goal
 *
 * Approach (shared build function):
 *  1. Cluster the paint into N patches (weighted k-means on the target plane).
 *  2. For each patch, choose a facet direction d_k (from the LED) on a cone around the LED axis,
 *     filtered to the target-facing hemisphere so reflected rays don't block each other.
 *  3. Place ALL facets on a single sphere (rhoFix = min envelope distance over the cone) — smooth,
 *     star-shaped from the LED, no shadowing, no envelope violations.
 *  4. Each facet is an ellipsoid with foci (LED, patch centroid Q_k); it images the LED onto Q_k.
 *  5. The clip polygon is the facet's Voronoi cell in gnomonic coords, mapped to 3D on the sphere,
 *     then clipped to the envelope box.
 */

// Core static solver — shared by both registrations.
function build(input, settings) {
  const V = RF.V, Geo = RF.Geo, Eng = RF.Engine, Src = RF.Source;
  const src = input.source, S0 = src.pos.slice();
  const fr = Src.frame(src);
  const env = input.envelope;
  const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
  const T = Eng.targetFrame(input.target);
  const paint = input.paint.cells, R = input.paint.res;
  const maxFacets = input.limits.maxFacets, refl = input.limits.reflectivity;
  const cellSize = 2 * T.half / R;
  const D2R = Math.PI / 180;

    // ---- painted cells
    const cells = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const w = paint[j * R + i];
      if (w > 0) cells.push({ i, j, w, u: -T.half + (i + 0.5) * cellSize, v: -T.half + (j + 0.5) * cellSize });
    }
    if (!cells.length) return { surfaces: [], intent: [], notes: ['no paint'] };
    const N = Math.min(maxFacets, cells.length);

    // ---- weighted k-means on (u,v), weight = paint value
    const patches = kmeans(cells, N, 14);
    for (const p of patches) {
      p.Q = Eng.targetUVtoWorld(T, p.u, p.v);
      p.uQ = V.norm(V.sub(p.Q, S0)); p.D = V.dist(p.Q, S0);
    }

    // ---- facet directions: cone around the LED axis, filtered to the target-facing side.
    // The LED axis is ~perpendicular to the target direction, giving ~45° reflection angles.
    // Keeping only target-facing directions (d·targetDir > 0) avoids placing facets behind the LED
    // whose reflected rays would block facets in front.
    const targetDir = V.norm(V.sub(T.C, S0));
    const allDirs = coneDirs(N * 3, fr.a, settings.coneDeg * D2R);
    const dirs = allDirs.filter(d => V.dot(d, targetDir) > -0.02);

    // ---- single sphere radius: min rho0 over all filtered dirs, so ALL facets are on one sphere.
    // A sphere is smooth (no kinks → no envelope violations) and star-shaped from the LED.
    let rhoFix = settings.rho0;
    for (const d of dirs) { const iv = Geo.envInterval(env, S0, d); rhoFix = Math.min(rhoFix, iv[1] - settings.margin); }
    if (!(rhoFix > keep + 0.5)) rhoFix = keep + 0.5;
    const rhoOf = (d) => rhoFix;

    // ---- assign patches to directions: greedy by best dot (uQ · d)
    // sort patches by v desc; for each, pick the unused direction with max d·uQ
    patches.sort((p, q) => q.v - p.v || p.u - q.u);
    const used = new Array(dirs.length).fill(false);
    const facets = [];
    for (let k = 0; k < patches.length && facets.length < maxFacets; k++) {
      const p = patches[k];
      let bi = -1, bs = -Infinity;
      for (let i = 0; i < dirs.length; i++) {
        if (used[i]) continue;
        const d = dirs[i];
        const s = V.dot(d, p.uQ);
        if (s > bs) { bs = s; bi = i; }
      }
      if (bi < 0) break;
      const d = dirs[bi];
      const rho = rhoOf(d);
      if (!(rho > 0)) continue;
      const P = V.add(S0, V.mul(d, rho));
      const ah = V.norm(V.sub(p.Q, P));
      const cosI = Math.sqrt(Math.max(0, (1 - V.dot(d, ah)) / 2));
      if (cosI < 0.12) continue;
      facets.push({ p, d, P, rho, di: V.dist(p.Q, P), dirIdx: bi });
      used[bi] = true;
    }

    // ---- build Voronoi cells on the sphere of directions, map to 3D on the star-shaped surface
    const surfaces = [], intent = [], notes = [];
    for (let fi = 0; fi < facets.length; fi++) {
      const f = facets[fi];
      const pts3 = voronoiClip(dirs, f.dirIdx, rhoOf, S0, keep, env);
      if (!pts3 || pts3.length < 3) continue;
      surfaces.push({ type: 'facet', id: 'F' + fi, P: f.P.slice(), S0: S0.slice(), Z: f.p.Q.slice(), di: f.di, flat: false,
        clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } });
      intent.push({ facet: 'F' + fi, cells: [[f.p.cell, 1]] });
    }
    notes.push(facets.length + ' facets, rho0=' + settings.rho0 + 'mm');
    return { surfaces, intent, notes };

    // ===================== helpers =====================
    function kmeans(cells, K, iters) {
      const ord = cells.slice().sort((a, b) => a.v - b.v || a.u - b.u);
      const cs = [];
      let acc = 0, target = ord.reduce((s, c) => s + c.w, 0) / K, cur = { u: 0, v: 0, W: 0, cells: [] };
      for (const c of ord) {
        cur.u += c.w * c.u; cur.v += c.w * c.v; cur.W += c.w; cur.cells.push(c); acc += c.w;
        if (acc >= target * (cs.length + 0.5) && cs.length < K) { cs.push({ u: cur.u / cur.W, v: cur.v / cur.W, W: cur.W, cells: cur.cells }); cur = { u: 0, v: 0, W: 0, cells: [] }; }
      }
      if (cur.W > 0 && cs.length < K) cs.push({ u: cur.u / cur.W, v: cur.v / cur.W, W: cur.W, cells: cur.cells });
      while (cs.length < K && cs.length > 1) {
        let bi = 0; for (let i = 1; i < cs.length; i++) if (cs[i].W > cs[bi].W) bi = i;
        const big = cs[bi], half = big.W / 2, a = { u: 0, v: 0, W: 0, cells: [] }, b = { u: 0, v: 0, W: 0, cells: [] };
        for (const c of big.cells.sort((x, y) => x.v - y.v || x.u - y.u)) { const g = (a.W < half ? a : b); g.u += c.w * c.u; g.v += c.w * c.v; g.W += c.w; g.cells.push(c); }
        if (a.W > 0) { a.u /= a.W; a.v /= a.W; } if (b.W > 0) { b.u /= b.W; b.v /= b.W; }
        cs.splice(bi, 1, a, b);
      }
      const own = new Int32Array(cells.length);
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < cells.length; i++) { let bj = 0, bd = Infinity; for (let j = 0; j < cs.length; j++) { const du = cells[i].u - cs[j].u, dv = cells[i].v - cs[j].v, dd = du * du + dv * dv; if (dd < bd) { bd = dd; bj = j; } } own[i] = bj; }
        for (const c of cs) { c.u = 0; c.v = 0; c.W = 0; c.cells = []; }
        for (let i = 0; i < cells.length; i++) { const c = cs[own[i]]; c.u += cells[i].w * cells[i].u; c.v += cells[i].w * cells[i].v; c.W += cells[i].w; c.cells.push(cells[i]); }
        for (const c of cs) if (c.W > 0) { c.u /= c.W; c.v /= c.W; }
        for (let j = cs.length - 1; j >= 0; j--) if (cs[j].W <= 0) cs.splice(j, 1);
      }
      for (const c of cs) { let bi = -1, bd = Infinity; for (const cc of c.cells) { const du = cc.u - c.u, dv = cc.v - c.v, dd = du * du + dv * dv; if (dd < bd) { bd = dd; bi = cc.j * R + cc.i; } } c.cell = bi; }
      return cs;
    }

    function coneDirs(n, axis, halfAng) {
      // Fibonacci sphere points within halfAng of `axis`, spread evenly across the cone.
      // Generate many, filter to the cone, then stride-sample to get n.
      const ga = Math.PI * (3 - Math.sqrt(5));
      const cosMax = Math.cos(halfAng);
      const total = Math.max(n * 30, 2000);
      const inCone = [];
      for (let k = 0; k < total; k++) {
        const z = 1 - 2 * (k + 0.5) / total;
        if (z < cosMax * 0.98) continue;
        const r = Math.sqrt(Math.max(0, 1 - z * z)), t = ga * k;
        inCone.push(realign([r * Math.cos(t), r * Math.sin(t), z], [0, 0, 1], axis));
      }
      if (inCone.length <= n) return inCone;
      // stride-sample to spread evenly
      const out = [], step = inCone.length / n;
      for (let i = 0; i < n; i++) out.push(inCone[Math.floor(i * step)]);
      return out;
    }
    function realign(p, zRef, axis) {
      const a = V.norm(axis), z = V.norm(zRef), dot = V.dot(z, a);
      if (dot > 0.9999) return p.slice();
      if (dot < -0.9999) return [-p[0], -p[1], p[2]];
      const ax = V.norm(V.cross(z, a));
      return V.rotate(p, ax, Math.acos(dot));
    }

    // Voronoi cell of dirs[j] in gnomonic coords about dirs[j], mapped to 3D on a SPHERE of radius rho(c).
    // Using the center's rho for all vertices keeps the surface smooth (no kinks).  Then clip to the box.
    function voronoiClip(dirs, j, rhoOf, S0, keep, env) {
      const c = dirs[j];
      const rhoC = rhoOf(c);
      if (!(rhoC > 0)) return null;
      const [e1, e2] = V.basis(c);
      const B = 3.0;  // large enough to contain the full Voronoi cell; clipping reduces it
      let poly = [[-B, -B], [B, -B], [B, B], [-B, B]];
      for (let m = 0; m < dirs.length && poly.length >= 3; m++) {
        if (m === j) continue;
        const q = dirs[m];
        poly = clipHalf(poly, V.dot(e1, q), V.dot(e2, q), 1 - V.dot(c, q));
      }
      if (poly.length < 3) return null;
      let pts3 = [];
      for (const [x, y] of poly) {
        const d = V.norm([c[0] + x * e1[0] + y * e2[0], c[1] + x * e1[1] + y * e2[1], c[2] + x * e1[2] + y * e2[2]]);
        pts3.push(V.add(S0, V.mul(d, rhoC)));
      }
      pts3 = clipPoly3DBox(pts3, env, 0.3);
      if (!pts3 || pts3.length < 3) return null;
      return pts3;
    }
    // Clip a convex 3D polygon to a box (env). Each face: n·(p - facepoint) <= 0.
    function clipPoly3DBox(pts, env, pad) {
      const c = env.center, h = env.half, tol = pad || 0;
      const faces = [
        { n: [1, 0, 0], p: [c[0] + h[0] - tol, c[1], c[2]] },
        { n: [-1, 0, 0], p: [c[0] - h[0] + tol, c[1], c[2]] },
        { n: [0, 1, 0], p: [c[0], c[1] + h[1] - tol, c[2]] },
        { n: [0, -1, 0], p: [c[0], c[1] - h[1] + tol, c[2]] },
        { n: [0, 0, 1], p: [c[0], c[1], c[2] + h[2] - tol] },
        { n: [0, 0, -1], p: [c[0], c[1], c[2] - h[2] + tol] },
      ];
      let poly = pts.slice();
      for (const f of faces) {
        if (poly.length < 3) return null;
        const out = [];
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i], q = poly[(i + 1) % poly.length];
          const dp = V.dot(f.n, V.sub(p, f.p)), dq = V.dot(f.n, V.sub(q, f.p));
          if (dp <= 0) out.push(p);
          if ((dp < 0) !== (dq < 0)) { const t = dp / (dp - dq); out.push(V.lerp(p, q, t)); }
        }
        poly = out;
      }
      return poly.length >= 3 ? poly : null;
    }
    function clipHalf(poly, a, b, c) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const dp = a * p[0] + b * p[1] - c, dq = a * q[0] + b * q[1] - c;
        if (dp <= 0) out.push(p);
        if ((dp < 0) !== (dq < 0)) { const t = dp / (dp - dq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
      }
      return out;
    }
  }   // end build

// ===================== static solver =====================
RF.Solvers.register({
  id: 'bench-glm52-max--blob', name: 'Blob reflector', version: '0.3', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'coneDeg', label: 'Cone half-angle (deg)', type: 'range', min: 10, max: 80, step: 1, default: 55 },
    { key: 'rho0', label: 'Facet distance (mm)', type: 'range', min: 5, max: 120, step: 1, default: 50 },
    { key: 'margin', label: 'Wall margin (mm)', type: 'range', min: 0, max: 10, step: 0.5, default: 1.5 },
  ],
  solve(input, settings, tools) {
    return build(input, settings);
  },
});

// ===================== tuner (may trace inside solve) =====================
RF.Solvers.register({
  id: 'bench-glm52-max--blob-auto', name: 'Blob reflector (auto)', version: '0.3', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    // Candidate cone angles to sweep.  Same seed → common random numbers → fair comparison.
    const candidates = [
      { coneDeg: 35, rho0: 50, margin: 1.5 },
      { coneDeg: 45, rho0: 50, margin: 1.5 },
      { coneDeg: 55, rho0: 50, margin: 1.5 },
      { coneDeg: 65, rho0: 50, margin: 1.5 },
    ];
    const seed = input.seed || 0;
    // Rays per trace: enough to distinguish candidates, within budget.
    const raysPerTrace = Math.min(80000, Math.floor((tools.budget && tools.budget.rays || 2e6) / (candidates.length + 1)));
    let best = null, bestScore = -Infinity, bestInfo = '';
    for (const cand of candidates) {
      const s = Object.assign({ minDistance: settings.minDistance || 0 }, cand);
      const out = build(input, s);
      if (!out.surfaces.length) continue;
      // verify: skip candidates with hard-constraint violations (envelope, clearance)
      const f = RF.Solvers.verify(tools.scene, out);
      if (f.errors.length || f.violations.envelope.length || f.violations.keepOut.length) continue;
      let tr;
      try { tr = tools.trace(out.surfaces, { rays: raysPerTrace, seed }); }
      catch (e) { continue; }   // budget exhausted or trace error → skip
      const score = scoreGoal(tr, settings.goal);
      if (score > bestScore) { bestScore = score; best = out; bestInfo = 'coneDeg=' + cand.coneDeg + ' score=' + score.toFixed(4); }
    }
    // fallback: the default static settings (coneDeg 55), verified
    if (!best) {
      best = build(input, { minDistance: settings.minDistance || 0, coneDeg: 55, rho0: 50, margin: 1.5 });
      bestInfo = 'fallback';
    }
    best.notes = (best.notes || []).concat(['tuned: ' + bestInfo + ' goal=' + settings.goal]);
    return best;

    function scoreGoal(tr, goal) {
      if (!tr) return -Infinity;
      const fid = tr.fidelity ? tr.fidelity.fidelity : 0;
      const onPaint = tr.fidelity ? tr.fidelity.onPaint : 0;
      const peak = tr.peakCd || 0;
      if (goal === 'throw') return peak;
      if (goal === 'efficient') return onPaint * (fid > 0.2 ? 1 : 0.1);  // light delivery, gated by fidelity
      return fid;  // faithful
    }
  },
});
