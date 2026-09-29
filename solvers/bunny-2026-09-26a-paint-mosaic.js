/* Bundled model solver: space-bunny-alpha, Flux solver benchmark run 2026-09-26 (workspace work-space-bunny-alpha-flux-solver-20260926-0433).
 * Copied verbatim from that run's solvers/solver.js (sha256 03ead9991ebd…), wrapped in a function scope so several
 * bundled files can share one worker.
 * Not edited otherwise: bugs and all, it is the record of what the model wrote. */
(function () {
/* paint-mosaic — a static reflector solver: reproduce the painting with a mosaic of facets.
 *
 * WHAT THE OPTICS ACTUALLY DO (measured on this engine, and it is the whole design):
 *
 *  · A facet reflects an IMAGE of the LED.  Its aim decides where that image lands, and its SIZE
 *    is s·di/r — the source's size s, magnified by the image distance di over the facet distance r.
 *    Choosing di = the distance to the aim point therefore lands the image on the aim point, and
 *    its size shrinks only with r.  Curvature is not a free knob for sharpness: with di = ∞ a facet
 *    collimates and the spot is the APERTURE's projection, 2ρ·(D+r)/r, which for any useful facet is
 *    far larger than the LED's image.  Measured on the `default` scene, one flat facet of radius
 *    12 mm at r = 50 mm spread its light over the whole 500 mm target (rms 142 mm), while the same
 *    facet curved onto the target made a 41 mm spot (rms 12 mm, as predicted).  So: curved, always.
 *  · Flux: a facet at P catches Φ = I(θ)·Ω with Ω = A·cosι/r², I(θ) the LED's radiant intensity
 *    towards it (RF.Source.intensity), cosι the incidence cosine = sin(∠/2) for a facet turning the
 *    ray by ∠, r = |P − LED|.  Spread over the image (area ∝ (s·di/r)²) that gives
 *        illuminance on the target   E = (I(θ)/A_led) · A · merit / (D+r)²,
 *        merit = I(θ)/I(0) · sin(∠/2)
 *    so a facet's AREA is its brightness, its merit says how expensive that area is, and the LED's
 *    size and the curvature drop out.  (The 10⁶ between mm² and m² is in Cconst; it cancels
 *    everywhere except the absolute brightness, which the app fits for itself.)
 *
 * THE DESIGN.  A painting is a mosaic — one facet per blob.  Facets sit on a shell around the LED,
 * spread so their angular footprints do not overlap (then none shadows another) and so that no
 * facet stands where another's ray leaves the shell, each aimed at one cell of a lattice over the
 * painting whose spacing matches the image the shell can paint.  Since the target is far and small,
 * any facet can paint any cell at nearly the same price, so the pairing is free and the best
 * directions are spent on the brightest paint.  The AMPLITUDES come from one non-negative least
 * squares fit of the sum of those (known) image kernels to the painting, bounded by the mirror each
 * facet has room for; the brightness scale is a low quantile of what the room allows, so a handful
 * of facets clip and the rest keep the freedom the fit needs to lay the painting flat.
 *
 * The one real trade-off — a far shell gives a sharp image but little room for mirror, a near one
 * gives light but a blur — is settled by scoring a handful of static candidates with the app's own
 * rules on the analytic model field.  No search over rays: closed-form geometry and one small
 * linear fit per candidate, milliseconds in total, and the same output for the same input.
 */
RF.Solvers.register({
  id: 'paint-mosaic', name: 'Paint mosaic (static)', version: '2.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'useFacets', label: 'Facets used (share of cap)', type: 'range', min: 0.1, max: 1, step: 0.05, default: 1 },
    { key: 'spread', label: 'Facet spread (× tight packing)', type: 'range', min: 0.4, max: 1.6, step: 0.05, default: 1 },
    { key: 'gapW', label: 'Keep the gaps dark (weight)', type: 'range', min: 0, max: 20, step: 0.5, default: 1 },
    { key: 'fillQ', label: 'Room used (low quantile)', type: 'range', min: 0.02, max: 1, step: 0.02, default: 0.2 },
    { key: 'scans', label: 'Shell radii tried', type: 'range', min: 1, max: 10, step: 1, default: 7 },
    { key: 'reach', label: 'Envelope reach used (× max)', type: 'range', min: 0.3, max: 1, step: 0.05, default: 1 },
    { key: 'meritK', label: 'Weakest direction kept (× best)', type: 'range', min: 0.05, max: 0.9, step: 0.05, default: 0.25 },
    { key: 'roomK', label: 'Cramped directions dropped (× roomiest)', type: 'range', min: 0.05, max: 0.9, step: 0.05, default: 0.4 },
    { key: 'tilt', label: 'Weak facets widened (× merit tilt)', type: 'range', min: 0, max: 2, step: 0.1, default: 0 },
    { key: 'edge', label: 'Image edge softness (× half-width)', type: 'range', min: 0, max: 0.6, step: 0.05, default: 0.6 },
    { key: 'blockFree', label: 'Let facet rays cross others (faster, dirtier)', type: 'checkbox', default: false },
    { key: 'curved', label: 'Curved facets (focus on the target)', type: 'checkbox', default: true },
    { key: 'iters', label: 'Fit iterations', type: 'range', min: 40, max: 1200, step: 20, default: 250 },
  ],

  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo, E = RF.Engine, Src = RF.Source;
    const src = input.source, env = input.envelope, tgt = input.target;
    const R = Math.max(2, tgt.res | 0), paint = input.paint.cells, NC = R * R;
    const cell = tgt.size / R;                          // mm per paint cell
    const T = E.designFrame(tgt);                      // the painting lives in the design frame
    const L = src.pos.slice();
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const Rf = input.limits.reflectivity;
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const notes = [];
    const o = {
      useFacets: Math.max(0.05, Math.min(1, +settings.useFacets)), spread: +settings.spread,
      reach: Math.max(0.2, Math.min(1, +settings.reach)),
      meritScan: [Math.max(0.04, Math.min(0.95, +settings.meritK))],
      roomK: Math.max(0.02, Math.min(0.95, +settings.roomK)), tilt: Math.max(0, +settings.tilt), edge: Math.max(0, Math.min(0.6, +settings.edge)),
      gapW: +settings.gapW, fillQ: Math.max(0.02, Math.min(1, +settings.fillQ)), scans: Math.max(1, +settings.scans | 0),
      curved: !!settings.curved, iters: +settings.iters, blockFree: !!settings.blockFree,
    };
    const nWant = Math.max(1, Math.min(maxF, Math.round(maxF * o.useFacets)));
    const Dt = tgt.distance;

    /* cells within `rad` of a painted cell (separable, so cheap) */
    function dilate(p, R2, rad) {
      const t = new Uint8Array(R2 * R2);
      for (let j = 0; j < R2; j++) for (let i = 0; i < R2; i++) {
        if (!(p[j * R2 + i] > 0)) continue;
        for (let q = Math.max(0, i - rad); q <= Math.min(R2 - 1, i + rad); q++) t[j * R2 + q] = 1;
      }
      const out = new Uint8Array(R2 * R2);
      for (let j = 0; j < R2; j++) for (let i = 0; i < R2; i++) {
        if (!t[j * R2 + i]) continue;
        for (let q = Math.max(0, j - rad); q <= Math.min(R2 - 1, j + rad); q++) out[q * R2 + i] = 1;
      }
      return out;
    }

    // ---------------------------------------------------------------- the painting
    let sum = 0, np = 0;
    for (let k = 0; k < NC; k++) { const w = +paint[k] || 0; if (w > 0) { sum += w; np++; } }
    if (!np) { notes.push('no painted cells: nothing to aim at'); return { surfaces: [], intent: [], notes }; }
    const typ = sum / np;                              // "a typical painted cell"
    const cellV = (i) => -T.half + (i + 0.5) * cell;
    let i0 = R, i1 = -1, j0 = R, j1 = -1;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (paint[j * R + i] > 0) {
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    const u0 = cellV(i0) - cell / 2, u1 = cellV(i1) + cell / 2, v0 = cellV(j0) - cell / 2, v1 = cellV(j1) + cell / 2;
    const spanU = Math.max(cell, u1 - u0), spanV = Math.max(cell, v1 - v0);
    const areaT = np * cell * cell;                    // mm² of painting

    // ---------------------------------------------------------------- the LED
    const Aem = Src.emittingArea(src);
    const sGeo = Aem > 0 ? Math.sqrt(Aem) : 0;         // geometric size: sets the image size
    const Iref = Math.max(1e-12, Src.intensity(src, 0));
    const Itot = Math.max(1e-12, Src.totalIntegral(src));
    const Cconst = Aem > 0 ? Iref / Aem : 1;           // cd/mm²; a point source has no ceiling
    const fr = Src.frame(src), aL = fr.a, uL = fr.u, vL = fr.v;
    const cosMax = src.kind === 'planar' ? Math.cos(89.5 * Math.PI / 180) : -1;   // planar: front hemisphere
    const a0 = V.norm(V.sub(T.C, L));                 // the design's mean aim direction

    // ---------------------------------------------------------------- envelope helpers
    /* How big a mirror of normal n fits at p.  A disc only reaches out along the axes it is not
     * normal to, so a facet lying flat against a wall has all the room it needs even if the point is
     * a hair off that wall — which is exactly the case for a lamp mounted on one.  (For a box this
     * is exact; for the curved envelopes it is a conservative proxy, and discRoom() has the last
     * word before anything is placed.) */
    const inradius = (p, n) => {
      const d = [p[0] - env.center[0], p[1] - env.center[1], p[2] - env.center[2]];
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      if (env.shape === 'box' && n) {
        let m = Infinity;
        for (let a = 0; a < 3; a++) { const s = Math.sqrt(Math.max(1e-6, 1 - n[a] * n[a])); m = Math.min(m, (env.half[a] - Math.abs(d[a])) / s); }
        return Math.max(0, m);
      }
      if (env.shape === 'ellipsoid') { const q = Math.hypot(d[0] / env.half[0], d[1] / env.half[1], d[2] / env.half[2]); return Math.max(0, (1 - q) * Math.min(...env.half)); }
      const q = Math.hypot(d[i] / env.half[i], d[j] / env.half[j]);
      return Math.max(0, Math.min(env.half[ax] - Math.abs(d[ax]), (1 - q) * Math.min(env.half[i], env.half[j])));
    };
    const envTol = -0.012;                             // 1.2 % margin inside the envelope
    const RIM = 16;
    const rimOf = (n) => {                             // unit vectors of a disc rim, ⊥ n
      const e = V.inPlane(n, T.tv), g = V.cross(n, e), out = [];
      for (let k = 0; k < RIM; k++) { const a = 2 * Math.PI * k / RIM; out.push([Math.cos(a) * e[0] + Math.sin(a) * g[0], Math.cos(a) * e[1] + Math.sin(a) * g[1], Math.cos(a) * e[2] + Math.sin(a) * g[2]]); }
      return out;
    };
    function discRoom(P, n) {                           // the largest disc of normal n that fits
      const rim = rimOf(n), cs = 1 / Math.cos(Math.PI / RIM);
      const ok = (rho) => {
        for (let k = 0; k < RIM; k++) {
          const r = rim[k], cs2 = rho * cs;
          if (!Geo.envInside(env, [P[0] + r[0] * cs2, P[1] + r[1] * cs2, P[2] + r[2] * cs2], envTol)) return false;
          const q = [P[0] + r[0] * rho, P[1] + r[1] * rho, P[2] + r[2] * rho];
          if (Math.hypot(q[0] - L[0], q[1] - L[1], q[2] - L[2]) < keep * (1 + 2e-3) + 1e-6) return false;
        }
        return true;
      };
      if (!ok(0)) return 0;
      let lo = 0, hi = Math.max(...env.half) * 4;
      if (!ok(hi)) { let a = hi, found = false; for (let i = 0; i < 22; i++) { a *= 0.5; if (ok(a)) { hi = a; found = true; break; } } if (!found) return 0; }
      for (let i = 0; i < 20; i++) { const m = 0.5 * (lo + hi); if (ok(m)) lo = m; else hi = m; }
      return lo;
    }
    const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    const cosI = (d, a) => Math.sqrt(Math.max(0, (1 - (d[0] * a[0] + d[1] * a[1] + d[2] * a[2])) / 2));   // sin(turn/2)

    // ---------------------------------------------------------------- the LED's cone, sampled
    const NDIR = 1000;
    const dirs = [];
    for (let i = 0; i < NDIR; i++) {
      const uu = (i + 0.5) / NDIR, ct = 1 - uu * (1 - cosMax), st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const t = Math.PI * (3 - Math.sqrt(5)) * i, cu = st * Math.cos(t), cv = st * Math.sin(t);
      const d = [cu * uL[0] + cv * vL[0] + ct * aL[0], cu * uL[1] + cv * vL[1] + ct * aL[1], cu * uL[2] + cv * vL[2] + ct * aL[2]];
      const iv = Geo.envInterval(env, L, d);
      if (!(iv[1] > 0)) continue;
      const th = Math.acos(Math.max(-1, Math.min(1, d[0] * aL[0] + d[1] * aL[1] + d[2] * aL[2])));
      const Irel = Src.intensity(src, th) / Iref;
      if (!(Irel > 2e-3)) continue;
      dirs.push({ d, Irel, rHi: iv[1], rLo: Math.max(0, iv[0]) });
    }
    if (!dirs.length) { notes.push('the LED faces away from the envelope: no facet can see it'); return { surfaces: [], intent: [], notes }; }
    let rTop = 0; for (const c of dirs) rTop = Math.max(rTop, c.rHi);
    dirs.sort((p, q) => (q.Irel - p.Irel) || (p.d[0] - q.d[0]) || (p.d[1] - q.d[1]) || (p.d[2] - q.d[2]));

    // ---------------------------------------------------------------- one candidate design
    /* One candidate design, parameterised by the shell radius (how far the facets sit from the
     * LED).  That one number is the whole trade-off: a facet's image of the LED — the sharpness of
     * the pattern — shrinks with distance, but the room the envelope leaves for mirror grows with
     * it, and a facet's area is what makes it bright.  Facets are seated at this radius where the
     * envelope allows, and the lattice of cells is matched to the image they paint, so the mosaic
     * tiles flat and the painting decides the amplitudes. */
    function build(rShell, mK) {
      // 1. seat every direction: the farthest point out of the envelope that still leaves room for a
      //    small mirror.  Directions that run out of envelope are seated just inside it.
      for (const c of dirs) {
        c.m0 = c.Irel * cosI(c.d, a0);
        c.nHat = nrm(c.d[0] - a0[0], c.d[1] - a0[1], c.d[2] - a0[2]);   // the normal this facet will have
        const hi = Math.min(rShell, c.rHi) * 0.999, lo0 = Math.max(c.rLo, keep * 1.02);
        const roomAt = (r) => 0.8 * inradius([L[0] + c.d[0] * r, L[1] + c.d[1] * r, L[2] + c.d[2] * r], c.nHat);
        const slack = (r) => roomAt(r) - 0.4;
        let r = -1, best = -1e9, bestR = lo0;
        if (hi > lo0) {
          if (slack(hi) >= 0) r = hi;
          else for (let i = 0; i <= 16; i++) {
            const q = lo0 * Math.pow(hi / lo0, i / 16), sl = slack(q);
            if (sl >= 0 && q > r) r = q;
            if (sl > best) { best = sl; bestR = q; }
          }
          if (r < 0) r = bestR;
        }
        c.seatR = r > keep * 1.02 ? r : -1;
        c.room0 = c.seatR > 0 ? Math.max(0, roomAt(c.seatR)) : 0;
        c.score = c.m0 * c.room0 * c.room0;             // room for mirror × merit
      }
      const cmpDir = (p, q2) => (q2.score - p.score) || (p.d[0] - q2.d[0]) || (p.d[1] - q2.d[1]) || (p.d[2] - q2.d[2]);
      dirs.sort(cmpDir);
      let mMax = 0;
      for (const c of dirs) if (c.room0 > 1e-6 && c.m0 > mMax) mMax = c.m0;
      let roomMax = 0;
      for (const c of dirs) if (c.room0 > roomMax) roomMax = c.room0;
      const good = dirs.filter((c) => c.room0 >= Math.max(0.35, o.roomK * roomMax) && c.m0 >= mK * mMax);
      if (good.length < 2) return null;
      good.sort(cmpDir);
      // 2. the image this shell paints, and the lattice of cells that matches it
      let rSum = 0;
      for (const c of good) rSum += c.seatR;
      const rEff = rSum / good.length;                   // the facets are seated at their own radius
      const wGuess = Math.max(0.7, sGeo * Dt / rEff / cell);
      const nPat = Math.max(1, Math.round(spanU * spanV / Math.pow(wGuess * cell, 2)));
      const nCap = Math.max(1, Math.min(nWant, nPat, good.length));
      // 3. spread: pick nCap directions whose angular footprints do not overlap, so that no facet
      //    shadows another — and (if we must) leave clear the direction where a ray leaving the
      //    shell crosses it again, at the mirrored direction.
      let chosen = [], sep = 0, mul = o.spread;
      const mirror = (d) => { const k = 2 * (d[0] * a0[0] + d[1] * a0[1] + d[2] * a0[2]); return [d[0] - k * a0[0], d[1] - k * a0[1], d[2] - k * a0[2]]; };
      for (const c of good) c.mirror = mirror(c.d);
      for (const avoid of (o.blockFree ? [false, true] : [true])) {
        chosen = []; mul = o.spread;
        for (let tries = 0; tries < 8; tries++) {
          sep = 2 * Math.sqrt(2 / nCap) * mul;
          const cs = Math.cos(Math.min(3.0, sep)), ch = [];
          for (const c of good) {
            const mx = c.mirror;
            let ok = true;
            for (let i = 0; i < ch.length; i++) {
              const q2 = ch[i];
              if (c.d[0] * q2.d[0] + c.d[1] * q2.d[1] + c.d[2] * q2.d[2] > cs) { ok = false; break; }
              if (avoid && q2.d[0] * mx[0] + q2.d[1] * mx[1] + q2.d[2] * mx[2] > cs) { ok = false; break; }
            }
            if (ok) ch.push(c);
          }
          chosen = ch;
          if (ch.length >= nCap) break;
          mul *= 0.85;
        }
        if (chosen.length >= nCap) break;
      }
      if (chosen.length > nCap) chosen.length = nCap;
      const nAvail = chosen.length;
      if (!nAvail) return null;
      /* 4. the lattice of cells.  One site per facet, spread over the painting, and never further
       * apart than the image each facet paints — a gap between the blobs would show as a dark
       * hole.  If the envelope cannot seat as many facets as the painting needs, the mosaic is
       * simply coarser than the pattern asks for. */
      const g = Math.max(wGuess, Math.sqrt(spanU * spanV / nAvail), 0.3 * cell);
      const nu = Math.max(1, Math.round(spanU / g)), nv = Math.max(1, Math.round(spanV / g));
      const ou = u0 + 0.5 * (spanU - nu * g), ov = v0 + 0.5 * (spanV - nv * g);
      const cellAt = [];
      for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
        const u = ou + a * g, v = ov + b * g;
        if (u < u0 - 0.5 * g || u > u1 + 0.5 * g || v < v0 - 0.5 * g || v > v1 + 0.5 * g) continue;
        const ii = Math.min(R - 1, Math.max(0, Math.floor((u + T.half) / cell))), jj = Math.min(R - 1, Math.max(0, Math.floor((v + T.half) / cell)));
        cellAt.push({ u, v, w: paint[jj * R + ii] || 0 });
      }
      if (!cellAt.length || cellAt.length > maxF) return null;
      let sites;
      if (cellAt.length <= nAvail) { sites = cellAt; for (let k = sites.length; k < nAvail; k++) chosen.pop(); }
      else {                                   // keep a spread subset: stride along a boustrophedon
        const stride = cellAt.length / nAvail, out = [];
        for (let k = 0; k < nAvail; k++) out.push(cellAt[Math.min(cellAt.length - 1, Math.floor(k * stride))]);
        sites = out;
      }
      const nS = sites.length;
      if (!nS) return null;
      // 5. pair them: the brightest paint gets the best directions.  Any pairing costs about the
      //    same — the target is far and small, so every facet's aim is nearly the same direction.
      const si = sites.map((q2, i) => i).sort((a, b) => (sites[b].w - sites[a].w) || (a - b));
      const seats = [];
      for (let k = 0; k < sites.length; k++) {
        const c = chosen[Math.min(k, chosen.length - 1)], i = si[k];
        seats.push({ c, i, r: c.seatR, site: i, P: [L[0] + c.d[0] * c.seatR, L[1] + c.d[1] * c.seatR, L[2] + c.d[2] * c.seatR], sh: [-c.d[0], -c.d[1], -c.d[2]], n: null });
      }
      // 6. aim, normal, room, merit, kernel width, illuminance cap
      for (const st of seats) {
        const s = sites[st.i], W = E.targetUVtoWorld(T, s.u, s.v);
        const a = V.norm(V.sub(W, st.P));
        st.n = nrm(st.sh[0] + a[0], st.sh[1] + a[1], st.sh[2] + a[2]);
        st.room = Math.min(discRoom(st.P, st.n), st.r * Math.sin(Math.min(1.2, sep * 0.5)));
        st.merit = st.c.Irel * cosI(st.c.d, a);
        st.share = st.r * Math.sin(Math.min(1.2, sep * 0.5));
        st.D = V.dist(st.P, W);
        s.ci = seats.indexOf(st); s.r = st.r;
        s.b = st.room > 0 ? Math.PI * st.room * st.room * Cconst * st.merit / (st.D * st.D) : 0;
        s.ok = st.room > 1e-6 && st.merit > 1e-6;
        s.hw = Math.max(0.35, 0.5 * sGeo * st.D / st.r / cell);   // the image: size s·di/r at di = the aim
      }
      /* A weak facet (a grazing mirror, or far off the LED's axis) needs a bigger patch to reach
       * the same illuminance, or its cell comes out dim.  So give the weak ones a wider share of
       * the cone and the strong ones a narrower one: the mosaic stays flat, and the total mirror
       * the light can hand out barely changes (mean m² / mean m²  of the shares). */
      let mBar = 0;
      for (const st of seats) mBar += st.merit;
      mBar = Math.max(1e-6, mBar / seats.length);
      for (const st of seats) st.cap = Math.min(st.room, st.share * Math.pow(mBar / Math.max(1e-6, st.merit), o.tilt));
      let cap2 = 0, rBar = 0;
      for (const st of seats) { cap2 += st.cap * st.cap; rBar += st.r; }
      rBar /= seats.length;
      const budgetA = nS * Math.pow(rBar * Math.sin(Math.min(1.2, sep * 0.5)), 2);
      const capK = cap2 > budgetA ? Math.sqrt(budgetA / cap2) : 1;
      for (const st of seats) {
        st.room = Math.min(st.room, st.cap * capK);
        const s = sites[st.i];
        s.b = st.room > 0 ? Math.PI * st.room * st.room * Cconst * st.merit / (st.D * st.D) : 0;
        s.ok = st.room > 1e-6 && st.merit > 1e-6;
      }
      return { rShell, rEff, sites, seats, g, wGuess, nS: sites.length, sep, spanU, spanV };
    }

    // ---------------------------------------------------------------- kernels and the fit
    /* The model operator: the field each facet paints is the LED's image, a box of half-width hw
     * cells about the cell it aims at.  The fit is a non-negative least squares with upper bounds
     * (the room), solved by projected FISTA — a few hundred iterations of a sparse scatter. */
    function fit(des, kerMin) {
      const sites = des.sites, nS = sites.length;
      const idx = [], wt = [];
      for (let i = 0; i < nS; i++) {
        const s = sites[i], hw = s.hw, ci = [], cw = [];
        const a0i = (s.u + T.half) / cell - 0.5, b0i = (s.v + T.half) / cell - 0.5;
        for (let b = Math.floor(b0i - hw) - 1; b <= Math.ceil(b0i + hw) + 1; b++) {
          if (b < 0 || b >= R) continue;
          const wy = (b <= b0i - hw) ? 1 : (b >= b0i + hw) ? 1 : (b < b0i ? b0i - b : b - b0i + 1);
          if (wy <= 0) continue;
          for (let a = Math.floor(a0i - hw) - 1; a <= Math.ceil(a0i + hw) + 1; a++) {
            if (a < 0 || a >= R) continue;
            let wx = (a <= a0i - hw) ? 1 : (a >= a0i + hw) ? 1 : (a < a0i ? a0i - a : a - a0i + 1);
            if (wx <= 0) continue;
            let wy2 = wy;
            if (o.edge > 0.01) {
              /* The LED's image is a flat-topped patch with a soft edge (the mirror sees the source
               * at a slight angle across it, and a wide aperture spills a little past it).  A flat
               * kernel makes the fit believe the mosaic is smoother than it is and lays the
               * amplitudes too high; a peaked one is just as wrong.  A trapezoid is the honest
               * shape — measured on a single facet, the profile is flat to ±15 % inside and gone
               * within about a cell of the edge. */
              const e = o.edge * hw, kx = Math.max(0, Math.min(1, (hw + e - Math.abs(a + 0.5 - a0i)) / (2 * e)));
              const ky = Math.max(0, Math.min(1, (hw + e - Math.abs(b + 0.5 - b0i)) / (2 * e)));
              const k = kx * ky;
              wx *= k; wy2 *= k;
            }
            ci.push(b * R + a); cw.push(wx * wy2);
          }
        }
        idx.push(Int32Array.from(ci)); wt.push(Float64Array.from(cw));
      }
      const ker = (i) => idx[i];
      const G = new Float64Array(NC), res = new Float64Array(NC), gr = new Float64Array(nS), g2 = new Float64Array(nS);
      const x = new Float64Array(nS), y = new Float64Array(nS), xPrev = new Float64Array(nS), bnd = new Float64Array(nS);
      const apply = (xx, out) => { out.fill(0); for (let i = 0; i < nS; i++) { const t = xx[i]; if (!t) continue; const k = ker(i), w = wt[i]; for (let q = 0; q < k.length; q++) out[k[q]] += t * w[q]; } };
      const applyT = (yy, out) => { for (let i = 0; i < nS; i++) { const k = ker(i), w = wt[i]; let s = 0; for (let q = 0; q < k.length; q++) s += yy[k[q]] * w[q]; out[i] = s; } };
      // objective: painted cells match the paint, gap cells stay under half their allowance
      const B = RF.Photometry.boxBlur(Float64Array.from(paint, (x2) => (x2 > 0 ? x2 : 0)), R, Math.max(2, kerMin));
      const P = paint;
      const dil = Math.ceil(kerMin) + 2, near = dilate(paint, R, dil);
      const isP = new Uint8Array(NC), isG = new Uint8Array(NC);
      const rhs = new Float64Array(NC), wts = new Float64Array(NC);
      for (let k = 0; k < NC; k++) {
        if (paint[k] > 0) { isP[k] = 1; rhs[k] = P[k]; wts[k] = 1; continue; }
        if (near[k]) { isG[k] = 1; rhs[k] = 0.5 * Math.max(1.25 * B[k], 0.1 * typ); wts[k] = o.gapW; }
      }
      // Lipschitz bound: power iteration on Mᵀ W M
      let lam = 0;
      {
        const v = new Float64Array(nS).fill(1 / Math.sqrt(nS));
        for (let it = 0; it < 10; it++) {
          apply(v, G); for (let k = 0; k < NC; k++) if (wts[k]) G[k] *= wts[k];
          applyT(G, g2);
          let s = 0; for (let i = 0; i < nS; i++) s += g2[i] * v[i];
          lam = s; const nn = Math.sqrt(s) || 1; for (let i = 0; i < nS; i++) v[i] = g2[i] / nn;
        }
      }
      const step = (lam > 1e-12 ? 1 / lam : 1) * 1.02;
      const run = (useBound, sc) => {
        for (let i = 0; i < nS; i++) bnd[i] = (useBound && sites[i].ok) ? Math.max(1e-12, sites[i].b / sc) : Infinity;
        let t = 1, tk = 1;
        for (let i = 0; i < nS; i++) { x[i] = Math.max(0, Math.min(bnd[i], x[i])); y[i] = x[i]; }
        for (let it = 0; it < o.iters; it++) {
          apply(y, G);
          for (let k = 0; k < NC; k++) res[k] = wts[k] * (G[k] - rhs[k]);
          applyT(res, gr);
          for (let i = 0; i < nS; i++) { const xn = Math.max(0, Math.min(bnd[i], y[i] - step * gr[i])); xPrev[i] = x[i]; x[i] = xn; }
          const tn = (1 + Math.sqrt(1 + 4 * t * t)) / 2; tk = (t - 1) / tn;
          for (let i = 0; i < nS; i++) y[i] = Math.max(0, Math.min(bnd[i], x[i] + tk * (x[i] - xPrev[i])));
          t = tn;
        }
        let s = 0; for (let k = 0; k < NC; k++) { const d2 = G[k] - rhs[k]; s += wts[k] * d2 * d2; }
        return s;
      };
      x.fill(0);
      run(false, 1);

      /* The brightness scale: fill the room the design has, spread over the painting the way the fit
       * wants it.  A water-filling rule, not the worst site: one cramped facet must not dim the
       * whole design, and the sites that do not fit are simply clipped and left to their
       * neighbours. */
      /* The brightness scale.  If the scale is set by the AVERAGE capacity, nearly every facet
       * saturates and the field is decided by how much room each facet happens to have — a lumpy
       * painting.  Set it by a LOW quantile instead: a few facets clip, the rest keep the freedom
       * the fit needs to lay the painting down flat, and the mosaic is smooth. */
      const ratio = [];
      for (let i = 0; i < nS; i++) if (x[i] > 1e-7 && sites[i].b > 0) ratio.push(sites[i].b / x[i]);
      let sc = 1;
      if (ratio.length) {
        ratio.sort((a, b) => a - b);
        sc = ratio[Math.min(ratio.length - 1, Math.max(0, Math.round(o.fillQ * (ratio.length - 1))))];
        if (!(sc > 0)) sc = 1;
      }
      run(true, sc);
      return { x, sc, G, idx, wt, apply };
    }

    // ---------------------------------------------------------------- scoring a candidate, analytically
    /* The same rules the app scores with, on the model field: best overall exposure, painted cells
     * within ×/÷1.25 (edge cells may match the paint blurred by the smallest LED image), gap cells
     * under their allowance.  Plus the light the design actually collects, in closed form. */
    function score(des, f, kerMin) {
      const { x, sc } = f, sites = des.sites, nS = sites.length;
      const G = f.G;
      const ker = RF.Photometry.boxBlur(Float64Array.from(paint, (z) => (z > 0 ? z : 0)), R, Math.max(2, des.wGuess));
      const dil = Math.ceil(kerMin) + 2, nearM = dilate(paint, R, dil);
      // the best exposure
      let best = null;
      const gmean = (() => { let s = 0, n = 0; for (let k = 0; k < NC; k++) if (paint[k] > 0) { s += G[k] / paint[k]; n++; } return n ? s / n : 0; })();
      if (gmean > 0) for (let q = -14; q <= 6; q++) {
        const s = gmean * Math.pow(1.35, q);
        let pass = 0, np = 0;
        for (let k = 0; k < NC; k++) {
          if (!(paint[k] > 0)) continue; np++;
          const rr = s * paint[k], rb = s * ker[k];
          if (G[k] >= 0.8 * Math.min(rr, rb) && G[k] <= 1.25 * Math.max(rr, rb)) pass++;
        }
        if (!best || pass > best.pass) best = { pass, np, s };
      }
      if (!best) return { S: -1 };
      const within = best.np ? best.pass / best.np : 0;
      // gap credit, on the same exposure
      let gN = 0, gC = 0;
      const sc0 = best.s;
      for (let k = 0; k < NC; k++) {
        if (paint[k] > 0 || !nearM[k]) continue;
        gN++;
        const allow = sc0 * Math.max(1.25 * ker[k], 0.1 * typ), over = G[k] - allow;
        gC += over <= 0 ? 1 : Math.max(0, 1 - over / (0.3 * sc0 * typ));
      }
      const dark = gN ? gC / gN : 1;
      const F = gN ? 2 * within * dark / (within + dark) : within;
      // the light: each facet's share of the LED, and how much of it lands on paint
      let onPaint = 0, all = 0, peak = 0, area = 0;
      for (let i = 0; i < nS; i++) {
        if (!(x[i] > 1e-9) || !sites[i].ok) continue;
        const st = des.seats[sites[i].ci];
        const A = Math.min(Math.PI * st.room * st.room, sc * x[i] * st.D * st.D / (Cconst * st.merit));
        const fl = st.c.Irel * A * st.merit / (st.r * st.r) / Itot;         // share of the LED
        const k = f.idx[i], w = f.wt[i];
        let pin = 0, tot = 0;
        for (let q = 0; q < k.length; q++) { tot += w[q]; if (paint[k[q]] > 0) pin += w[q]; }
        all += fl; onPaint += fl * (tot > 0 ? pin / tot : 0); area += A;
      }
      // peak, in cd, from the model field
      const distm = V.dist(T.C, L) / 1000, cellm2 = (2 * T.half / R) * (2 * T.half / R) * 1e-6;
      let pk = 0;
      for (let k = 0; k < NC; k++) if (paint[k] > 0 && G[k] * sc0 > pk) pk = G[k] * sc0;
      const peakCd = pk * cellm2 * distm * distm;
      return { F, within, dark, onPaint, all, peakCd, area, sc, nPlaced: nS };
    }

    // ---------------------------------------------------------------- the search over shell radii
    /* Two knobs decide everything, and they pull against each other:
     *   the shell radius  — farther = a smaller image of the LED (a sharper painting) but less
     *                       room for mirror, and fewer directions the envelope can seat;
     *   the merit floor   — how weak a direction may be and still get a facet.  A weak direction
     *                       (grazing mirror, or far off the LED's axis) catches less light, and one
     *                       such facet in a cell it shares with strong ones makes that cell dim:
     *                       the mosaic is flat only if the facets are of comparable strength.
     * So: scan both, and let the model score choose. */
    const cands = [];
    // the smallest LED image this envelope can paint anywhere: the concession the app's fidelity
    // gives a cell at a painted edge, and what our own model of the pattern is measured against
    const kerMin = Math.max(0.4, sGeo * Dt / Math.max(1, rTop) / cell);
    const rLo = Math.max(keep * 1.05, 0.18 * rTop);
    const mKs = o.meritScan;
    for (let mi = 0; mi < mKs.length; mi++) {
      for (let i = 0; i < o.scans; i++) {
        const rShell = rLo * Math.pow(rTop / rLo, i / Math.max(1, o.scans - 1));
        const des = build(rShell, mKs[mi]);
        if (!des) continue;
        const f = fit(des, kerMin);
        cands.push({ des, f, mK: mKs[mi], s: score(des, f, kerMin) });
      }
    }
    if (!cands.length) { notes.push('no usable facet position found'); return { surfaces: [], intent: [], notes }; }
    /* Rank the candidates with the app's own score shape, but on ABSOLUTE marks rather than marks
     * relative to the best candidate: otherwise the choice would depend on which other candidates
     * happened to be in the scan, and the scan would be unable to compare like with like.
     * light = 1 once a tenth of the LED's light is on the paint (the gate the app applies);
     * the efficiency term rewards up to ~a quarter of the LED on the paint. */
    const ON_PAINT_FULL = 0.03, ON_PAINT_MAX = 0.15;
    let bestC = null, bestS = -1;
    for (const c of cands) {
      const F = c.s.F, on = c.s.onPaint;
      const light = Math.min(1, on / ON_PAINT_FULL);
      const g = Math.max(0, Math.min(1, (F - 0.5) / 0.25));
      const X = Math.min(1, on / ON_PAINT_MAX);
      // a small preference for the finer mosaic among near-ties: the model's fidelity is a
      // noisy stand-in for the traced one, and a design with more facets painting the picture is the
      // safer bet when two candidates look alike
      const S = F * light + 0.5 * g * X + 0.04 * Math.min(1, c.des.nS / maxF);
      c.S = S;
      if (S > bestS) { bestS = S; bestC = c; }
    }
    const des = bestC.des, f = bestC.f, sc = f.sc, sites = des.sites;
    // ---------------------------------------------------------------- emit
    const surfaces = [], intent = [];
    let placed = 0, area = 0, rsum = 0;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i], st = des.seats[s.ci];
      if (!(f.x[i] > 1e-7) || !s.ok) { intent.push({ facet: null, cells: [] }); continue; }
      const A = Math.min(Math.PI * st.room * st.room, sc * f.x[i] * st.D * st.D / (Cconst * st.merit));
      const rho = Math.sqrt(Math.max(0, A / Math.PI)) * 0.995;
      if (!(rho > 1e-4) || !Geo.envInside(env, st.P, envTol)) { intent.push({ facet: null, cells: [] }); continue; }
      const rim = rimOf(st.n), pts3 = [];
      for (let k = 0; k < RIM; k++) pts3.push([st.P[0] + rim[k][0] * rho, st.P[1] + rim[k][1] * rho, st.P[2] + rim[k][2] * rho]);
      const W = E.targetUVtoWorld(T, s.u, s.v);
      const id = 'M' + i;
      surfaces.push({
        type: 'facet', id, group: 'A', P: st.P.slice(), S0: L.slice(), Z: W,
        flat: !o.curved, di: o.curved ? st.D : 0,
        clip: { kind: 'poly', pts3 },
        optics: { interaction: 'reflect', reflectivity: Rf, twoSided: false },
      });
      const k2 = f.idx[i], cells = [];
      for (let q = 0; q < k2.length; q++) if (f.wt[q] > 0) cells.push([k2[q], f.wt[q] * f.x[i]]);
      intent.push({ facet: id, cells });
      placed++; area += A; rsum += st.r;
    }
    notes.push(placed + ' facets (cap ' + maxF + '), shell ' + des.rShell.toFixed(0) + ' mm, facet radius ' + (area / Math.max(1, placed) / Math.PI > 0 ? Math.sqrt(area / Math.max(1, placed) / Math.PI) : 0).toFixed(1) + ' mm at ' +
      (rsum / Math.max(1, placed)).toFixed(0) + ' mm of ' + rTop.toFixed(0) + ' mm reach, lattice ' + (des.g / cell).toFixed(1) +
      ' cells, LED image ' + (0.5 * sGeo * (Dt + rsum / Math.max(1, placed)) / (rsum / Math.max(1, placed)) / cell).toFixed(1) +
      ' cells, mirror ' + area.toFixed(0) + ' mm², on paint ' + (100 * bestC.s.onPaint).toFixed(1) + '% of the LED' +
      ' [model fidelity ' + (100 * bestC.s.F).toFixed(0) + '% = ' + (100 * bestC.s.within).toFixed(0) + '/' + (100 * bestC.s.dark).toFixed(0) + ']');
    if (cands.length > 1) notes.push('candidates: ' + cands.map((c) => c.des.rShell.toFixed(0) + '/' + c.mK.toFixed(2) + '→F' + (100 * c.s.F).toFixed(0) + '%/p' + (100 * c.s.onPaint).toFixed(1) + '%/S' + c.S.toFixed(2)).join('  '));
    return { surfaces, intent, notes };
  },
});
})();
