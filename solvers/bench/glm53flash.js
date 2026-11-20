/* solvers/solver.js — "flux-paint": a STATIC paint-matching facet solver (no tracing in solve()).
 *
 * Approach (see NOTES.md):
 *  1. Tile the LED's emission solid angle with up to maxFacets facets: candidate directions on a
 *     golden-spiral grid, filtered by the envelope (exit distance), the emission cone and the
 *     scatter angle to the target; a greedy angular-packing picks ~maxFacets of them, sized so each
 *     subtends the same solid angle Ω at the LED (equal flux share).  Facets sit as far from the LED
 *     as the envelope allows (sharp images: blob ≈ s·D/r) and are shrunk until they fit the envelope
 *     and the LED clearance.
 *  2. Split the painted cells among the facets so that each facet receives paint weight proportional
 *     to the flux it collects: a BSP that recurses over (cells, facets), cutting the longer axis at
 *     the cumulative-weight position matching the facet group's flux fraction.  Connected paint
 *     components are separated first so one facet never has to paint two disjoint strokes.
 *  3. Each facet is an exact ellipsoidal facet (foci: LED, image point): it aims at its patch's
 *     weight centroid; if the patch is larger than the sharp LED image (s·D/r) it defocuses
 *     (image distance < D) to spread its flux over the patch.
 *
 * Deterministic: no Math.random, stable tie-breaks by index.
 */
const FLUX_PAINT = {
  id: 'bench-glm53flash--flux-paint',
  name: 'Flux paint (static BSP)',
  version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'blobK', label: 'Blob size factor', type: 'range', min: 0.8, max: 1.8, step: 0.05, default: 0.9, help: 'LED image size = factor × LED size × D/r' },
    { key: 'sepK', label: 'Facet packing separation', type: 'range', min: 0.7, max: 1.3, step: 0.05, default: 0.9, help: 'centre spacing vs sum of angular radii' },
    { key: 'scatterMax', label: 'Max scatter angle (deg)', type: 'range', min: 80, max: 150, step: 5, default: 140, help: 'max angle between to-LED and to-target at a facet' },
    { key: 'focusEff', label: 'Defocus effectiveness', type: 'range', min: 0.1, max: 1.2, step: 0.05, default: 0.25, help: 'how fast defocus spreads the blob' },
    { key: 'pruneVis', label: 'Prune facets below visibility', type: 'range', min: 0, max: 0.5, step: 0.05, default: 0, help: 'drop facets whose beam is mostly blocked (frees their path for others)' },
    { key: 'minR', label: 'Min shell radius (× max)', type: 'range', min: 0, max: 0.95, step: 0.05, default: 0, help: 'only place facets at least this far from the LED (sharper blobs, less flux)' },
    { key: 'edgeBoost', label: 'Paint-edge flux boost', type: 'range', min: 0, max: 2, step: 0.05, default: 0, help: 'boost fringe-cell weights (redistributes flux from interior)' },
    { key: 'aimShift', label: 'Fringe aim outward shift', type: 'range', min: 0, max: 1, step: 0.05, default: 0, help: 'push fringe patches\' blob tops outward so they cover boundary cells' },
    { key: 'focusPull', label: 'Pull aims to paint centre', type: 'range', min: 0, max: 1, step: 0.05, default: 0, help: 'goal=throw lever: overlap all blobs at the centroid (peak intensity up, pattern fidelity down)' },
    { key: 'coverK', label: 'Blob-top coverage of patch', type: 'range', min: 1, max: 2, step: 0.05, default: 1.7, help: 'defocus until the blob flat top is coverK × patch size (uniform patch brightness)' },
    { key: 'packOrder', label: 'Packing preference', type: 'select', default: 'flux', options: [
      { value: 'omega', label: 'small facets first' },
      { value: 'inten', label: 'bright directions first' },
      { value: 'flux', label: 'big facets first' } ] },
  ],

  solve(input, settings) {
    const V = RF.V;
    const env = input.envelope;
    const lim = input.limits || {};
    const maxF = Math.max(1, lim.maxFacets | 0);
    const refl = lim.reflectivity !== undefined ? lim.reflectivity : 0.9;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = RF.Engine.targetFrame(input.target);
    const res = input.paint.res | 0;
    const paint = input.paint.cells;
    const notes = [];

    // ---- sources: primary = first (largest power first for robustness of sizing)
    const srcsAll = (input.sources && input.sources.length ? input.sources : [input.source])
      .filter((s) => s && s.enabled !== false && s.power > 0);
    if (!srcsAll.length) return { surfaces: [], intent: [], notes: ['no sources'] };
    const Ptot = srcsAll.reduce((a, s) => a + s.power, 0);
    const srcs = srcsAll.slice().sort((a, b) => b.power - a.power);
    const S0 = srcs[0].pos.slice();

    // ---- painted cells in target-plane coords
    const half = T.half, cellW = 2 * half / res;
    const cells = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = paint[j * res + i];
      if (!(w > 0)) continue;
      const u = -half + (i + 0.5) * cellW, v = -half + (j + 0.5) * cellW;
      cells.push({ idx: j * res + i, i, j, u, v, w });
    }
    if (!cells.length) return { surfaces: [], intent: [], notes: ['paint is empty'] };

    // ---- boundary-distance weights: fringe cells see fewer blob tops (no patches beyond
    // the paint edge), so they need boosted flux to reach band brightness
    if (settings.edgeBoost > 0) {
      let cur = new Uint8Array(res * res);
      for (let k = 0; k < res * res; k++) cur[k] = paint[k] > 0 ? 1 : 0;
      const dist = new Uint8Array(res * res);
      let d = 0;
      while (d < 6 && cur.some((x) => x)) {
        const nx = cur.slice();
        for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
          const k = j * res + i;
          if (!cur[k]) continue;
          let all = true;
          if (i === 0 || i === res - 1 || j === 0 || j === res - 1) all = false;
          else if (!cur[k - 1] || !cur[k + 1] || !cur[k - res] || !cur[k + res]) all = false;
          if (!all) nx[k] = 0;
        }
        d++;
        for (let k = 0; k < res * res; k++) if (cur[k]) dist[k] = d;
        cur = nx;
      }
      for (const c of cells) if (dist[c.idx] === 1) c.w *= 1 + settings.edgeBoost;
    }
    // paint centroid (for outward aim-shift direction / goal=throw aim pull)
    const Zpaint = (() => { let su = 0, sv = 0, sw = 0; for (const c of cells) { su += c.w * c.u; sv += c.w * c.v; sw += c.w; } return { u: su / sw, v: sv / sw }; })();
    const ZcWorld = V.add(T.C, V.add(V.mul(T.tu, Zpaint.u), V.mul(T.tv, Zpaint.v)));
    const fringeOf = (cs2) => {
      const out = [];
      for (const c of cs2) {
        const { i, j } = c;
        let edge = false;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const i2 = i + di, j2 = j + dj;
          if (i2 < 0 || j2 < 0 || i2 >= res || j2 >= res || !(paint[j2 * res + i2] > 0)) { edge = true; break; }
        }
        if (edge) out.push(c);
      }
      return out;
    };

    const Wtot = cells.reduce((a, c) => a + c.w, 0);
    const Zc = T.C.slice();   // target centre (aim estimate)

    // ---- candidate directions on the emission solid angle (golden spiral)
    const planar = srcs[0].kind === 'planar';
    const spanZ = planar ? 1 : 2;
    const M = Math.min(2400, Math.max(360, maxF * 16));
    const fr0 = RF.Source.frame(srcs[0]);
    // scene-adaptive scatter cap: extreme scatter degrades blob quality (coma/tails); allow it
    // only when the design is blur-dominated anyway (kernel ≈ LED image size ≫ a paint cell).
    // kproxy ≈ the SHARPEST blob the shell can make, in paint cells (r = farthest envelope point)
    const sbar0 = Math.sqrt(RF.Source.emittingArea(srcs[0]));
    let rFar = 5;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const c = [env.center[0] + sx * env.half[0], env.center[1] + sy * env.half[1], env.center[2] + sz * env.half[2]];
      const d = V.dist(c, S0);
      if (d > rFar) rFar = d;
    }
    const kproxy = settings.blobK * sbar0 * V.len(T.C) / (cellW * rFar);
    const scatCap = Math.min(settings.scatterMax, kproxy < 1.2 ? 125 : 140) * Math.PI / 180;
    const dOmega = spanZ * 2 * Math.PI / M;
    const cands = [];
    for (let k = 0; k < M; k++) {
      const z = 1 - spanZ * (k + 0.5) / M;
      const rr = Math.sqrt(Math.max(0, 1 - z * z)), ph = k * 2.399963229728653;
      const dl = [rr * Math.cos(ph), rr * Math.sin(ph), z];
      const dir = [
        dl[0] * fr0.u[0] + dl[1] * fr0.v[0] + dl[2] * fr0.a[0],
        dl[0] * fr0.u[1] + dl[1] * fr0.v[1] + dl[2] * fr0.a[1],
        dl[0] * fr0.u[2] + dl[1] * fr0.v[2] + dl[2] * fr0.a[2]];
      // flux density over emitters (relative, per sr): Σ share·I_e(θ)
      let fd = 0, ok = true;
      for (const s of srcs) {
        const th = Math.acos(Math.max(-1, Math.min(1, dir[0] * fr_a(s)[0] + dir[1] * fr_a(s)[1] + dir[2] * fr_a(s)[2])));
        if (th > RF.Source.thetaMax(s) - 0.02) { ok = false; break; }
        fd += (s.power / Ptot) * RF.Source.intensity(s, th);
      }
      if (!ok || fd < 0.08) continue;
      const iv = RF.Geo.envInterval(env, S0, dir);
      const rMax = iv[1];
      if (!(rMax > keep + 2.5)) continue;
      // scatter estimate via target centre
      const Pe = V.madd(S0, dir, rMax * 0.9);
      const ae = V.norm(V.sub(Zc, Pe));
      const scat = Math.acos(Math.max(-1, Math.min(1, -(dir[0] * ae[0] + dir[1] * ae[1] + dir[2] * ae[2]))));
      if (scat > scatCap) continue;
      cands.push({ dir, fd, rMax, k });
    }
    if (!cands.length) return { surfaces: [], intent: [], notes: ['no usable directions in the envelope'] };
    cands.sort((a, b) => (b.fd - a.fd) || (a.k - b.k));
    const OmegaTot = dOmega * cands.length * (M / (spanZ * M)) * (planar ? 1 : 1); // ~ solid angle sampled

    // ---- angular packing.  Each facet's solid angle is chosen ∝ blobArea / I(θ) ("constant
    // radiance blobs"): flux ∝ blob area ⇒ every facet delivers the same intensity per blob area,
    // so coverage multiplicity follows the paint weight and near/far facets mix cleanly.
    const rhoOf = (Om) => Math.acos(Math.max(-1, Math.min(1, 1 - Om / (2 * Math.PI))));
    const sepK = settings.sepK;
    const sbar = Math.sqrt(RF.Source.emittingArea(srcs[0]));
    const Dtyp = V.len(T.C);
    for (const c of cands) {
      c.m2 = (settings.blobK * sbar * Dtyp / c.rMax) ** 2;   // blob area proxy (envelope exit r)
      c.oFax = c.m2 / Math.max(0.08, c.fd);                  // Ω_f = C · m² / I
    }
    { // optional sharpness bias: drop near directions (big blurry blobs)
      let rMaxAll = 0;
      for (const c of cands) rMaxAll = Math.max(rMaxAll, c.rMax);
      const rMin = settings.minR * rMaxAll;
      for (let i = cands.length - 1; i >= 0; i--) if (cands[i].rMax < rMin) cands.splice(i, 1);
      if (!cands.length) return { surfaces: [], intent: [], notes: ['no directions pass minR'] };
    }
    const order = cands.slice().sort((a, b) =>
      settings.packOrder === 'inten' ? (b.fd - a.fd) || (a.oFax - b.oFax) || (a.k - b.k)
      : settings.packOrder === 'flux' ? (b.m2 - a.m2) || (a.k - b.k)
      : (a.oFax - b.oFax) || (b.fd - a.fd) || (a.k - b.k));
    function greedy(C) {
      for (const c of order) { c.rho = rhoOf(C * c.oFax); }
      const acc = [];
      for (const c of order) {
        if (acc.length >= maxF) break;
        let ok = true;
        for (const a of acc) {
          const sep = sepK * (c.rho + a.rho);
          if (c.dir[0] * a.dir[0] + c.dir[1] * a.dir[1] + c.dir[2] * a.dir[2] > Math.cos(sep)) { ok = false; break; }
        }
        if (ok) acc.push(c);
      }
      return acc;
    }
    let lo = 1e-10, hi = null, best = null;
    { // bracket C on a geometric ladder: hi = first C too big to fill the budget
      let c0 = 1e-10;
      for (let it = 0; it < 30; it++) {
        if (greedy(c0).length < maxF) { hi = c0; break; }
        c0 *= 8;
      }
      if (hi === null) hi = c0; else lo = hi / 8;
    }
    for (let it = 0; it < 9; it++) {
      const mid = Math.sqrt(lo * hi);
      const acc = greedy(mid);
      if (acc.length >= maxF) { lo = mid; best = { C: mid, acc }; }
      else { hi = mid; if (!best || acc.length > best.acc.length) best = { C: mid, acc }; }
      if (hi / lo < 1.04) break;
    }
    if (!best || !best.acc.length) return { surfaces: [], intent: [], notes: ['packing failed'] };
    const chosen = best.acc.slice(0, maxF);

    // ---- sagged outline check: the verifier tests outline points ON the quadric surface (the
    // ellipsoid sags toward its interior side, which can poke back out through the envelope wall
    // even when the tangent-plane corners fit).  Mirror the verifier: 4 subdivisions per edge,
    // sagged onto the surface.
    const tol = 1e-6 * Math.max(...env.half);
    function sagAt(P, S0p, Z, di, e1, e2, n, x, y) {
      const fq = RF.Geo.facetQuadric(P, S0p, Z, di);
      const A = fq.A, b = fq.b;
      const Ax = [A[0] * e1[0] + A[1] * e1[1] + A[2] * e1[2], A[3] * e1[0] + A[4] * e1[1] + A[5] * e1[2], A[6] * e1[0] + A[7] * e1[1] + A[8] * e1[2]];
      const Ay = [A[0] * e2[0] + A[1] * e2[1] + A[2] * e2[2], A[3] * e2[0] + A[4] * e2[1] + A[5] * e2[2], A[6] * e2[0] + A[7] * e2[1] + A[8] * e2[2]];
      const Az = [A[0] * n[0] + A[1] * n[1] + A[2] * n[2], A[3] * n[0] + A[4] * n[1] + A[5] * n[2], A[6] * n[0] + A[7] * n[1] + A[8] * n[2]];
      const be = V.dot(b, e1), bf = V.dot(b, e2), bz = V.dot(b, n);
      const q2 = V.dot(Az, n);
      const q1 = 2 * (x * V.dot(Ax, n) + y * V.dot(Ay, n)) + bz;
      const q0 = x * x * V.dot(Ax, e1) + 2 * x * y * V.dot(Ax, e2) + y * y * V.dot(Ay, e2) + x * be + y * bf;
      if (Math.abs(q2) < 1e-12) return Math.abs(q1) > 1e-12 ? -q0 / q1 : 0;
      const disc = q1 * q1 - 4 * q2 * q0;
      if (disc < 0) return 0;
      const sq = Math.sqrt(disc);
      const r1 = (-q1 - sq) / (2 * q2), r2 = (-q1 + sq) / (2 * q2);
      return Math.abs(r1) <= Math.abs(r2) ? r1 : r2;
    }
    // outline points of a square clip (4 subdiv per edge, as the verifier draws them), sagged
    function outlinePts(P, e1, e2, n, h) {
      const loc = [];
      for (let e = 0; e < 4; e++) {
        const a = [[-h, -h], [h, -h], [h, h], [-h, h]][e], b2 = [[h, -h], [h, h], [-h, h], [-h, -h]][e];
        for (let s = 0; s < 4; s++) loc.push([a[0] + (b2[0] - a[0]) * s / 4, a[1] + (b2[1] - a[1]) * s / 4]);
      }
      return loc.map((q) => { const z = sagAt(P, S0, Zq, DIq, e1, e2, n, q[0], q[1]);
        return [P[0] + q[0] * e1[0] + q[1] * e2[0] + z * n[0], P[1] + q[0] * e1[1] + q[1] * e2[1] + z * n[1], P[2] + q[0] * e1[2] + q[1] * e2[2] + z * n[2]]; });
    }
    let Zq = Zc, DIq = null;   // aim/image used by outlinePts (set per facet)
    function checkFit(P, e1, e2, n, h) {
      const pts = outlinePts(P, e1, e2, n, h);
      for (const p of pts) {
        if (!RF.Geo.envInside(env, p, tol)) return false;
        for (const s of srcs) if (V.dist(p, s.pos) < keep * 1.02) return false;
      }
      return true;
    }

    // ---- build facets: position as far out as possible, shrink until it fits
    const facets = [];
    for (const c of chosen) {
      const OmW = best.C * c.oFax;
      let r = c.rMax - 0.05 * c.rMax - 0.3;
      let built = null;
      for (let it = 0; it < 14 && r > keep + 0.4; it++) {
        const P = V.madd(S0, c.dir, r);
        const ae = V.norm(V.sub(Zc, P));
        const sh = V.mul(c.dir, -1);
        const n = V.norm(V.add(sh, ae));
        const cospsi = Math.max(0.05, Math.abs(n[0] * sh[0] + n[1] * sh[1] + n[2] * sh[2]));
        let h = 0.5 * r * Math.sqrt(OmW / cospsi);
        h = Math.min(h, 0.42 * r);
        if (h < 0.6) break;
        const [e1, e2] = V.basis(n);
        Zq = Zc; DIq = 0.1 * Dtyp;   // conservative: strongest expected defocus
        if (checkFit(P, e1, e2, n, h)) { built = { P, n, e1, e2, h, r, cospsi, dir: c.dir, fd: c.fd, OmW }; break; }
        r *= 0.955;
      }
      if (built) facets.push(built);
    }
    if (!facets.length) return { surfaces: [], intent: [], notes: ['no facet fits the envelope'] };
    facets.forEach((f, i) => { f.ix = i; });

    // ---- connected components of the paint (8-neighbourhood)
    const comp = new Int32Array(res * res).fill(-1);
    const comps = [];
    for (const c of cells) {
      if (comp[c.idx] >= 0) continue;
      const id = comps.length, stack = [c.idx], list = [];
      comp[c.idx] = id;
      while (stack.length) {
        const k = stack.pop(), i = k % res, j = (k / res) | 0;
        list.push(k);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i2 = i + di, j2 = j + dj;
          if (i2 < 0 || j2 < 0 || i2 >= res || j2 >= res) continue;
          const k2 = j2 * res + i2;
          if (comp[k2] < 0 && paint[k2] > 0) { comp[k2] = id; stack.push(k2); }
        }
      }
      comps.push({ id, cells: list, w: list.reduce((a, k) => a + paint[k], 0), deficit: 0 });
    }
    comps.sort((a, b) => (b.w - a.w) || (a.id - b.id));
    const cellByIdx = new Map(cells.map((c) => [c.idx, c]));

    // ---- one design pass: weights (∝ collected flux × visibility) → BSP → aims → surfaces
    function runPass(visMap) {
      for (const f of facets) {
        // visibility of THIS facet's beam (measured on the previous pass); facets that could not
        // be built in a previous pass get ~0 (they are out of the design)
        const vis = visMap ? (visMap.has(f) ? 0.05 + 0.95 * visMap.get(f) : 0.02) : 1;
        const w = f.fd * 4 * f.h * f.h * f.cospsi / (f.r * f.r) * vis;
        f.wgt = isFinite(w) && w > 0 ? w : 0;
      }
      const Ftot = facets.reduce((a, f) => a + f.wgt, 0) || 1;
      facets.sort((a, b) => (b.wgt - a.wgt) || (a.ix - b.ix));
      // allocate facets to components ∝ their weight deficit
      for (const cp of comps) cp.deficit = cp.w / Wtot * Ftot;
      const byComp = new Map(comps.map((cp) => [cp.id, []]));
      for (const f of facets) {
        let bc = comps[0];
        for (const cp of comps) if (cp.deficit > bc.deficit) bc = cp;
        byComp.get(bc.id).push(f);
        bc.deficit -= f.wgt;
      }
      // BSP: split (cells, facets) so weight ∝ flux; leaves = one facet each
      const leaves = [], dbg = [];
      function bsp(cs, fs) {
        if (!fs.length) return;
        if (!cs.length) { for (const f of fs) leaves.push({ facet: f, cells: [] }); return; }
        if (cs.length < fs.length) {
          // more facets than cells: one cell each (weight-matched), park the rest
          const cs2 = cs.slice().sort((a, b) => (b.w - a.w) || (a.idx - b.idx));
          const fs2 = fs.slice().sort((a, b) => (b.wgt - a.wgt) || (a.ix - b.ix));
          for (let i = 0; i < fs2.length; i++) leaves.push({ facet: fs2[i], cells: i < cs2.length ? [cs2[i]] : [] });
          return;
        }
        if (fs.length === 1) {
          leaves.push({ facet: fs[0], cells: cs });
          return;
        }
        let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
        for (const c of cs) { if (c.u < umin) umin = c.u; if (c.u > umax) umax = c.u; if (c.v < vmin) vmin = c.v; if (c.v > vmax) vmax = c.v; }
        const axis = (umax - umin) >= (vmax - vmin) ? 'u' : 'v';
        const other = axis === 'u' ? 'v' : 'u';
        cs = cs.slice().sort((a, b) => (a[axis] - b[axis]) || (a[other] - b[other]) || (a.idx - b.idx));
        const W = cs.reduce((a, c) => a + c.w, 0);
        const Ft = fs.reduce((a, f) => a + f.wgt, 0);
      if (!(Ft > 0) || !(W > 0)) {   // no usable flux or weight on this side: park the facets
        for (const f of fs) leaves.push({ facet: f, cells: [] });
        return;
      }
        // facet split: prefix of the flux-sorted list with flux fraction closest to 1/2
        let acc = 0, bi = 1, bd = Infinity;
        for (let i = 0; i < fs.length - 1; i++) {
          acc += fs[i].wgt;
          const dev = Math.abs(acc / Ft - 0.5);
          if (dev < bd) { bd = dev; bi = i + 1; }
        }
        const alpha = fs.slice(0, bi).reduce((a, f) => a + f.wgt, 0) / Ft;
        // cell cut at cumulative weight fraction alpha
        let cw = 0, bj = 1, bdev = Infinity;
        for (let j = 0; j < cs.length - 1; j++) {
          cw += cs[j].w;
          const dev = Math.abs(cw / W - alpha);
          if (dev < bdev) { bdev = dev; bj = j + 1; }
        }
        bsp(cs.slice(0, bj), fs.slice(0, bi));
        bsp(cs.slice(bj), fs.slice(bi));
      }
      for (const cp of comps) bsp(cp.cells.map((k) => cellByIdx.get(k)), byComp.get(cp.id) || []);
      // finalize: aim at patch weight centroid, focus for patch size
      const surfaces = [], intent = [], aims = [];
      let used = 0;
      let dropNoCells = 0, dropFit = 0, dropD = 0;
      for (const leaf of leaves) {
        const f = leaf.facet, cs = leaf.cells;
        if (!cs.length) { dropNoCells++; continue; }
        let wsum = 0, uc = 0, vc = 0;
        for (const c of cs) { wsum += c.w; uc += c.u * c.w; vc += c.v * c.w; }
        uc /= wsum; vc /= wsum;
        let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
        for (const c of cs) { if (c.u < umin) umin = c.u; if (c.u > umax) umax = c.u; if (c.v < vmin) vmin = c.v; if (c.v > vmax) vmax = c.v; }
        let Z = V.add(T.C, V.add(V.mul(T.tu, uc), V.mul(T.tv, vc)));
        // fringe patches: push the blob top outward so its flat core covers the boundary cells
        if (settings.aimShift !== 0) {
          const fr = fringeOf(cs);
          if (fr.length) {
            let ox = 0, oy = 0;
            for (const c of fr) {
              const l = Math.hypot(c.u - Zpaint.u, c.v - Zpaint.v) || 1;
              ox += (c.u - Zpaint.u) / l; oy += (c.v - Zpaint.v) / l;
            }
            const ol = Math.hypot(ox, oy) || 1;
            const msh = settings.aimShift * settings.blobK * sbar * V.dist(Z, f.P) / f.r;
            Z = V.add(Z, V.add(V.mul(T.tu, msh * ox / ol), V.mul(T.tv, msh * oy / ol)));
          }
        }
        if (settings.focusPull > 0) {
          // goal=throw lever: pull the aim toward the paint centroid so blob tops overlap there
          Z = V.add(Z, V.mul(V.sub(ZcWorld, Z), settings.focusPull));
        }
        const P = f.P;
        const D = V.dist(Z, P);
        if (!(D > 1)) { dropD++; continue; }
        const ah = V.mul(V.sub(Z, P), 1 / D);
        const sh = V.mul(f.dir, -1);
        const n = V.norm(V.add(sh, ah));
        const cospsi = Math.max(0.05, V.dot(n, sh));
        const m = settings.blobK * sbar * D / f.r;
        const p = Math.sqrt(cs.length) * cellW;
        const [e1, e2] = V.basis(n);
        let h = Math.min(0.5 * f.r * Math.sqrt(f.OmW / cospsi), 0.42 * f.r);
        let di = D;
        // fit: sagged outline inside envelope + clear of the LED, for the REAL quadric (with defocus)
        for (let it = 0; it < 12; it++) {
          // defocus so the blob's flat TOP (≈0.85 × b20) covers the patch: uniform patch brightness
          const want = settings.coverK * p;
          const bNeed = 2.04 * Math.sqrt(Math.max(0, want * want - m * m));
          di = D / (1 + bNeed / (settings.focusEff * 2 * h));
          di = Math.max(0.1 * D, Math.min(D, di));
          Zq = Z; DIq = di;
          if (checkFit(P, e1, e2, n, h) || h < 0.6) break;
          h *= 0.88;
        }
        if (h < 0.6) { dropFit++; continue; }
        const pts3 = [];
        for (let q = 0; q < 4; q++) {
          const sx = q === 1 || q === 2 ? 1 : -1, sy = q >= 2 ? 1 : -1;
          pts3.push([P[0] + sx * h * e1[0] + sy * h * e2[0], P[1] + sx * h * e1[1] + sy * h * e2[1], P[2] + sx * h * e1[2] + sy * h * e2[2]]);
        }
        const id = 'F' + used;
        surfaces.push({
          type: 'facet', id, group: 'A', P: P.slice(), S0: S0.slice(), Z, di, flat: false,
          clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl },
        });
        intent.push({ facet: id, cells: cs.map((c) => [c.idx, 1]) });
        aims.push({ f, id, Z, D, P, n, e1, e2, h, di, umin, umax, vmin, vmax, cells: cs });
        used++;
      }
      return { surfaces, intent, aims, used, dropNoCells, dropFit, dropD };
    }

    // ---- static beam visibility: can the facet's outgoing cone reach its patch unblocked?
    // (pure geometry on compiled surfaces — no ray tracing of the scene)
    function measureVis(pass) {
      let G = null;
      try { G = RF.Geo.compile(pass.surfaces); } catch (e) { return null; }
      const vis = new Map();
      const OFF = [-0.55, 0, 0.55];
      for (let si = 0; si < pass.aims.length; si++) {
        const a = pass.aims[si];
        const img = V.madd(a.P, V.norm(V.sub(a.Z, a.P)), a.di);   // image point I = P + di·â
        let clear = 0, tot = 0;
        for (const oa of OFF) for (const ob of OFF) {
          const Q = [a.P[0] + (oa * a.e1[0] + ob * a.e2[0]) * a.h, a.P[1] + (oa * a.e1[1] + ob * a.e2[1]) * a.h, a.P[2] + (oa * a.e1[2] + ob * a.e2[2]) * a.h];
          // aim at 3 spread points across the patch
          for (const [tu2, tv2] of [[0, 0], [0.5, 0], [0, 0.5]]) {
            const tx = (a.umin + tu2 * (a.umax - a.umin) + a.umax) / 2, ty = (a.vmin + tv2 * (a.vmax - a.vmin) + a.vmax) / 2;
            const Tpt = V.add(T.C, V.add(V.mul(T.tu, tx), V.mul(T.tv, ty)));
            const d = V.norm(V.sub(Tpt, Q));
            const dmax = V.dist(Tpt, Q) * 0.985;
            let blocked = false;
            for (let k2 = 0; k2 < pass.surfaces.length && !blocked; k2++) {
              if (k2 === si) continue;
              const t = RF.Geo.intersect(G.D, G.poly, k2, Q[0], Q[1], Q[2], d[0], d[1], d[2], 1e-7, dmax);
              if (t >= 0) blocked = true;
            }
            if (!blocked) clear++;
            tot++;
          }
        }
        vis.set(a.f, clear / Math.max(1, tot));
      }
      return vis;
    }

    // ---- passes: blind weights, then visibility-weighted refinements; heavily blocked
    // facets are pruned (their light is lost anyway and they only block others)
    let pass = runPass(null);
    for (let it = 0; it < 3; it++) {
      const vis = measureVis(pass);
      if (!vis) break;
      const smooth = new Map();
      for (const [f, v] of vis) smooth.set(f, 0.05 + 0.95 * v);
      if (settings.pruneVis > 0 && it < 2) {
        const kept = facets.filter((f) => !vis.has(f) || vis.get(f) >= settings.pruneVis);
        if (kept.length < facets.length && kept.length >= Math.max(4, maxF * 0.3)) {
          facets.length = 0;
          for (const f of kept) facets.push(f);
        }
      }
      pass = runPass(smooth);
    }
    const { surfaces, intent, used } = pass;
    notes.push('drops: no-cells ' + pass.dropNoCells + ', no-fit ' + pass.dropFit + ', bad-D ' + pass.dropD);

    // ---- diagnostics
    const rs = facets.map((f) => f.r).sort((a, b) => a - b);
    const vis = measureVis(pass);
    let vlo = 1, vavg = 0;
    if (vis) { const vs = [...vis.values()].sort((a, b) => a - b); vlo = vs[0]; vavg = vs.reduce((a, b) => a + b, 0) / vs.length; }
    notes.push('beam visibility min/avg ' + (vlo * 100).toFixed(0) + '%/' + (vavg * 100).toFixed(0) + '%');
    notes.push(used + ' placed of ' + facets.length + ' built (cap ' + maxF + '), Ω ' + (best.C * 1e6).toFixed(2) + 'e-6·m²/I, r ' +
      rs[0].toFixed(0) + '–' + rs[rs.length - 1].toFixed(0) + ' mm');
    notes.push('blob side ' + (settings.blobK * sbar * Dtyp / rs[rs.length - 1]).toFixed(0) + '–' +
      (settings.blobK * sbar * Dtyp / rs[0]).toFixed(0) + ' mm (cell ' + cellW.toFixed(1) + ' mm), kernel ' +
      RF.Photometry.achievableKernel({ source: srcs[0], envelope: env, target: input.target }).cells.toFixed(1) + ' cells');
    return { surfaces, intent, notes };

    function fr_a(s) { return RF.Source.frame(s).a; }
  },
};
RF.Solvers.register(FLUX_PAINT);

// ---- auto-tuned variant (task step 3): picks the static solver's settings for a goal by
// evaluating candidates with the REAL tracer (allowed for ids ending in -auto).  Same fixed
// seed for every candidate trace, so ranking differences are geometry, not sampling noise.
const AUTO_TRACE_RAYS = 400000, AUTO_SEED = 20260117;

RF.Solvers.register({
  id: 'bench-glm53flash--flux-paint-auto',
  name: 'Flux paint (auto-tuned)',
  version: '0.1',
  modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Optimization goal', type: 'select', default: 'faithful', options: [
      { value: 'faithful', label: 'faithful: best pattern fidelity' },
      { value: 'throw', label: 'throw: peak beam intensity' },
      { value: 'efficient', label: 'efficient: most light on the paint' } ] },
  ],

  solve(input, settings, tools) {
    const base = {};
    for (const s of FLUX_PAINT.settings) base[s.key] = s.default;
    base.minDistance = settings.minDistance;
    const goal = settings.goal;
    // small candidate grids around the measured landscape (NOTES.md); the first entry is always
    // the shipped static defaults, so the tuner can only improve on them
    const grids = {
      faithful: [
        {}, { coverK: 1.55 }, { coverK: 1.85 }, { blobK: 0.95 }, { blobK: 0.85 },
        { focusEff: 0.35 }, { sepK: 0.95 }, { packOrder: 'omega' },
      ],
      throw: [
        { coverK: 1, blobK: 0.85, packOrder: 'inten' },
        { coverK: 1, blobK: 0.85, packOrder: 'inten', focusPull: 0.35 },
        { coverK: 1, blobK: 0.85, packOrder: 'inten', focusPull: 0.6 },
        { coverK: 1, blobK: 0.85, packOrder: 'inten', focusPull: 0.85 },
        { coverK: 1, blobK: 0.85, packOrder: 'inten', focusPull: 0.6, minR: 0.4 },
        { coverK: 1.2, blobK: 0.9, packOrder: 'inten', focusPull: 0.6, pruneVis: 0.15 },
        { coverK: 1.7, focusPull: 0.6 },
        { coverK: 1, blobK: 0.8, packOrder: 'flux', focusPull: 0.7 },
      ],
      efficient: [
        {}, { scatterMax: 150 }, { sepK: 0.8 }, { sepK: 0.85 }, { coverK: 1.2 },
        { blobK: 0.85, coverK: 1.2 },
      ],
    };
    const grid = grids[goal] || grids.faithful;
    const fmt = (v) => goal === 'throw' ? Math.round(v).toLocaleString() + ' cd' : (100 * v).toFixed(1) + '%';
    const label = (cand) => { const d = []; for (const k of Object.keys(cand)) if (cand[k] !== base[k]) d.push(k + '=' + cand[k]); return d.length ? d.join(' ') : 'defaults'; };
    const notes = ['goal ' + goal + ': ' + grid.length + ' candidates × ' + (AUTO_TRACE_RAYS / 1000) + 'k rays, seed ' + AUTO_SEED];
    let best = null;
    for (const cand of grid) {
      const s2 = Object.assign({}, base, cand);
      let out;
      try { out = FLUX_PAINT.solve(input, s2); } catch (e) { notes.push(label(cand) + ': solve failed (' + e.message + ')'); continue; }
      if (!out || !out.surfaces || !out.surfaces.length) { notes.push(label(cand) + ': no surfaces'); continue; }
      let tr;
      try { tr = tools.trace(out.surfaces, { rays: AUTO_TRACE_RAYS, seed: AUTO_SEED }); } catch (e) {
        notes.push('trace budget exhausted (' + (best ? 'keeping best so far' : 'no evaluation yet') + ')');
        break;
      }
      const obj = goal === 'throw' ? tr.peakCd : goal === 'efficient' ? tr.fidelity.onPaint : tr.fidelity.fidelity;
      if (!(obj > -Infinity)) { notes.push(label(cand) + ': unreadable score'); continue; }
      notes.push(label(cand) + ' → ' + fmt(obj) + (best && obj <= best.obj ? '' : '  ← best'));
      if (!best || obj > best.obj) best = { obj, out, s2: cand };
    }
    if (!best) {
      notes.push('no candidate evaluated — returning untraced static defaults');
      return FLUX_PAINT.solve(input, base);
    }
    notes.push('picked: ' + label(best.s2) + ' → ' + fmt(best.obj));
    return { surfaces: best.out.surfaces, intent: best.out.intent, notes };
  },
});
