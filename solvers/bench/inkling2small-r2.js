/* Flux paint-mode solver — "wall-face grid".
 *
 * Static algorithm (no tracing inside solve()):
 *  1. Read the painted target, split it into K ≈ maxFacets equal-weight clusters by weighted
 *     k-means. Each cluster's weight-centroid (world point on the target plane) is its facet's aim.
 *  2. Analyse the envelope's faces (for a box: the six axis-aligned faces). Compute how much of the
 *     LED's flux lands on each face by sampling. Keep the faces that catch light.
 *  3. Allocate K facets over the kept faces proportional to the flux each face catches, and lay out
 *     a near-square grid of rectangles on each face. Facets are rectangles clipped inside their
 *     face, so they are all safely inside the envelope.
 *  4. Pair faces' cells to aims: strongest-fluxed cell to the heaviest painted cluster.
 *  5. Each facet is aimed at its cluster (bisector of LED→facet and facet→aim); curvature is solved
 *     so the LED image on the target lands on a chosen spot radius (small by default: sharper).
 *
 * See NOTES.md for what was tried and measured.
 */
RF.Solvers.register({
  id: 'bench-inkling2small-r2--paint-facets', name: 'Paint facets (static tiler)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'coverGain', label: 'Aperture vs grid fit', type: 'range', min: 0.55, max: 1.2, step: 0.05, default: 0.65, help: '>1 facets overlap their grid slot (they shrink to fit so no gaps either way); try ~0.65' },
    { key: 'spotGain', label: 'Spot radius vs cluster RMS', type: 'range', min: 0.6, max: 3.0, step: 0.1, default: 1.0, help: 'larger spots smooth the beam; smaller spots sharpen edges (less spill)' },
  ],
  solve(input, settings) {
    const V = RF.V, T = RF.Engine.targetFrame(input.target);
    const env = input.envelope, src = input.source, srcPos = src.pos, L0 = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const maxFacets = Math.max(1, input.limits.maxFacets | 0);
    const paint = input.paint, res = paint.res, cells = paint.cells;
    const axis = V.norm(src.axis);
    const half = T.half, cellMM = 2 * half / res;
    const notes = [];

    const sub = V.sub, add = V.add, mul = V.mul, dot = V.dot, nrm = V.norm, cross = V.cross, len = V.len, dist = V.dist;

    // ------------------------------------------------------------ 1. weighted k-means on painted cells
    let totW = 0; const pts = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const w = cells[j * res + i];
      if (w > 0) { pts.push({ i, j, w, x: i + 0.5, y: j + 0.5 }); totW += w; }
    }
    if (!pts.length || totW <= 0) { notes.push('paint is empty: nothing to light'); return { surfaces: [], intent: [], notes }; }
    const K = Math.min(maxFacets, pts.length);
    let mx = 0, my = 0; for (const p of pts) { mx += p.x * p.w; my += p.y * p.w; } mx /= totW; my /= totW;
    // deterministic seeding: spread K seeds by max-min distance, weight-boosted
    const seeds = [pts.reduce((a, b) => (b.w > a.w ? b : a))];
    const d2 = new Float64Array(pts.length).fill(Infinity);
    while (seeds.length < K) {
      let bestScore = -1, bi = 0;
      for (let p = 0; p < pts.length; p++) {
        const dx = pts[p].x - seeds[seeds.length - 1].x, dy = pts[p].y - seeds[seeds.length - 1].y;
        const dd = dx * dx + dy * dy; if (dd < d2[p]) d2[p] = dd;
      }
      for (let p = 0; p < pts.length; p++) { const sc = d2[p] * pts[p].w; if (sc > bestScore) { bestScore = sc; bi = p; } }
      seeds.push(pts[bi]);
    }
    let Cx = seeds.map((s) => ({ x: s.x, y: s.y }));
    let assign = new Int32Array(pts.length);
    for (let iter = 0; iter < 40; iter++) {
      let moved = 0;
      for (let p = 0; p < pts.length; p++) {
        let bd = Infinity, bk = 0;
        for (let k = 0; k < K; k++) { const dx = pts[p].x - Cx[k].x, dy = pts[p].y - Cx[k].y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; bk = k; } }
        if (assign[p] !== bk) { assign[p] = bk; moved++; }
      }
      const sx = new Float64Array(K), sy = new Float64Array(K), sw = new Float64Array(K);
      for (let p = 0; p < pts.length; p++) { const k = assign[p]; sx[k] += pts[p].x * pts[p].w; sy[k] += pts[p].y * pts[p].w; sw[k] += pts[p].w; }
      for (let k = 0; k < K; k++) if (sw[k] > 0) { Cx[k].x = sx[k] / sw[k]; Cx[k].y = sy[k] / sw[k]; }
      else { // empty cluster: reseed at the most misassigned cell
        let bi = 0, be = -1;
        for (let p = 0; p < pts.length; p++) { const k = assign[p], dx = pts[p].x - Cx[k].x, dy = pts[p].y - Cx[k].y, e = (dx * dx + dy * dy) * pts[p].w; if (e > be) { be = e; bi = p; } }
        Cx[k] = { x: pts[bi].x, y: pts[bi].y };
      }
      if (!moved) break;
    }
    const clusters = [];
    for (let k = 0; k < K; k++) clusters.push({ w: 0, cx: Cx[k].x, cy: Cx[k].y, cells: [] });
    for (let p = 0; p < pts.length; p++) { const k = assign[p]; clusters[k].w += pts[p].w; clusters[k].cells.push(p); }
    for (const c of clusters) {
      if (!c.cells.length) continue;
      let sx = 0, sy = 0, sw = 0;
      for (const p of c.cells) { sx += pts[p].x * pts[p].w; sy += pts[p].y * pts[p].w; sw += pts[p].w; }
      c.cx = sx / sw; c.cy = sy / sw; c.w = sw;
      let s2 = 0; for (const p of c.cells) s2 += (pts[p].x - c.cx) ** 2 + (pts[p].y - c.cy) ** 2;
      c.rms = Math.sqrt(s2 / c.cells.length) * cellMM;
    }
    const live = clusters.filter((c) => c.cells.length);
    notes.push(K + ' clusters over ' + pts.length + ' painted cells (tot weight ' + totW.toFixed(1) + ')');

    // ------------------------------------------------------------ 2. face analysis of the envelope
    const inten = (u) => RF.Source.intensity(src, Math.acos(Math.max(-1, Math.min(1, dot(u, axis)))));
    const iMax = Math.max(1e-9, inten(axis));
    // candidate faces: box → 6 axis-aligned faces; ellipsoid/cylinder → treated as one box-like shell fallback below
    const faces = [];
    if (env.shape === 'box') {
      const c = env.center, h = env.half;
      for (let ax = 0; ax < 3; ax++) for (const side of [-1, 1]) {
        const n = [0, 0, 0]; n[ax] = side;
        const i = (ax + 1) % 3, j = (ax + 2) % 3;
        const area = 4 * h[i] * h[j];
        // sample the face, compute incoming flux
        const NS = 10;
        let S = 0;
        for (let a = 0; a <= NS; a++) for (let b = 0; b <= NS; b++) {
          const p = [c[0], c[1], c[2]]; p[ax] += side * h[ax]; p[i] += (2 * a / NS - 1) * h[i]; p[j] += (2 * b / NS - 1) * h[j];
          const d = V.sub(p, srcPos); const r = len(d); if (r < 1e-6) continue;
          const u = mul(d, 1 / r);
          const w = inten(u) * Math.abs(dot(n, u)) / (r * r);
          S += w;
        }
        faces.push({ kind: 'box', ax, side, n, area, flux: S / ((NS + 1) * (NS + 1)), c, h });
      }
    }
    const dirT = V.norm(sub(T.C, srcPos));
    const totFlux = faces.reduce((s, f) => s + f.flux, 0);
    // exclude faces that nearly face the target — their facets would block the outgoing beams
    const kept = faces.filter((f) => f.flux > 0.02 * (totFlux / Math.max(1, faces.length)));
    notes.push('faces kept: ' + kept.map((f) => f.n.join(',')).join(' | '));

    // ------------------------------------------------- non-box envelopes: spherical shell fallback
    function envIntervalSafe(S, d) {
      const c = env.center, h = env.half;
      const o = [S[0]-c[0], S[1]-c[1], S[2]-c[2]];
      if (env.shape === 'box') {
        let tin = -Infinity, tout = Infinity;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(d[i]) < 1e-12) { if (Math.abs(o[i]) > h[i]) return [Infinity, -Infinity]; continue; }
          let t1 = (-h[i]-o[i])/d[i], t2 = (h[i]-o[i])/d[i];
          if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
          tin = Math.max(tin, t1); tout = Math.min(tout, t2);
        }
        return [tin, tout];
      }
      const isCyl = env.shape === 'cylinder';
      const ax = isCyl ? (env.axis === undefined ? 2 : env.axis) : -1;
      const iA = (ax + 1) % 3, jA = (ax + 2) % 3;
      let tin = -Infinity, tout = Infinity;
      if (ax >= 0) {
        if (Math.abs(d[ax]) < 1e-12) { if (Math.abs(o[ax]) > h[ax]) return [Infinity, -Infinity]; }
        else { let t1 = (-h[ax]-o[ax])/d[ax], t2 = (h[ax]-o[ax])/d[ax]; if (t1 > t2) { const q = t1; t1 = t2; t2 = q; } tin = Math.max(tin, t1); tout = Math.min(tout, t2); }
      }
      const axes = ax >= 0 ? [iA, jA] : [0, 1, 2];
      let A = 0, B = 0, C = -1;
      for (const a of axes) { A += (d[a]/h[a])**2; B += 2*o[a]*d[a]/(h[a]*h[a]); C += (o[a]/h[a])**2; }
      if (A < 1e-12) { if (C >= 0) return [Infinity, -Infinity]; return [tin, tout]; }
      const B2 = B*B - 4*A*C;
      if (B2 < 0) return [Infinity, -Infinity];
      const r = Math.sqrt(B2);
      let t1 = (-B - r)/(2*A), t2 = (-B + r)/(2*A);
      if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
      return [Math.max(tin, t1), Math.min(tout, t2)];
    }

    const shellCells = [];
    if (env.shape !== 'box') {
      // non-box fallback: spherical shell of facets around the LED
      // find the smallest distance from LED to the envelope along any direction; shell sits inside
      const NSH = 512, u0n = V.basis(axis)[0], v0n = V.basis(axis)[1];
      let minT = Infinity;
      for (let k = 0; k < NSH; k++) {
        const z = 1 - 2 * (k + 0.5) / NSH, r = Math.sqrt(Math.max(0, 1 - z * z)), ph = k * Math.PI * (3 - Math.sqrt(5));
        const u = add(mul(axis, z), add(mul(u0n, r * Math.cos(ph)), mul(v0n, r * Math.sin(ph))));
        const ti = envIntervalSafe(srcPos, u);
        if (ti[1] > 1e-6 && ti[1] < minT) minT = ti[1];
      }
      const K = live.length;
      const steps = Math.max(2, Math.round(Math.sqrt(K * 1.5)));
      const cosLo = src.kind === 'planar' ? 0 : -1, cosSpan = 1 - cosLo, dCos = cosSpan / steps;
      // compute cells per ring proportional to ring solid angle (sinT), summing to K
      const rawW = [];
      let sumW = 0;
      for (let ring = 0; ring < steps; ring++) {
        const cm = (1 - (ring + 0.5) * dCos);
        const sinT = Math.sin(Math.acos(Math.max(-1, Math.min(1, cm))));
        const w = Math.max(0.25, sinT);
        rawW.push(w); sumW += w;
      }
      const counts = rawW.map((w) => Math.max(1, Math.round(K * w / sumW)));
      // trim or pad to K exactly
      let sumN = counts.reduce((a, b) => a + b, 0);
      while (sumN > K) { let mi = -1, mv = 0; for (let i = 0; i < counts.length; i++) if (counts[i] > mv) { mv = counts[i]; mi = i; } counts[mi]--; sumN--; }
      for (let k = 0; sumN < K; k++, sumN++) counts[k % counts.length]++;
      for (let ring = 0; ring < steps; ring++) {
        const c0 = 1 - ring * dCos, c1 = Math.max(cosLo, 1 - (ring + 1) * dCos);
        const cm = (c0 + c1) / 2, sinT = Math.sin(Math.acos(cm));
        const n = counts[ring];
        for (let j = 0; j < n; j++) {
          const phi = (j + 0.5) * 2 * Math.PI / n;
          const u = add(mul(axis, cm), add(mul(u0n, sinT * Math.cos(phi)), mul(v0n, sinT * Math.sin(phi))));
          const I = inten(u);
          const dir = envIntervalSafe(srcPos, u);
          const R = (dir[1] > 1e-6 ? dir[1] : 0) * 0.93;   // sit just inside the envelope along this direction
          shellCells.push({ u, I, Rin: R });
        }
      }
      if (shellCells.length > K) shellCells.length = K;
    }
    if (!kept.length && !shellCells.length) { notes.push('no face catches light: emitting away from the envelope'); return { surfaces: [], intent: [], notes }; }

    // allocate facets per kept face proportional to flux
    const totalFluxKept = kept.reduce((s, f) => s + f.flux, 0);
    const target = live.length;
    const alloc = [];
    for (const f of kept) {
      const share = f.flux / totalFluxKept;
      alloc.push({ f, n: Math.max(1, Math.floor(target * share)) });
    }
    // distribute the remainder deterministically by flux
    let assigned = alloc.reduce((s, a) => s + a.n, 0);
    const faceOrder = alloc.map((a, i) => i).sort((p, q) => alloc[q].f.flux - alloc[p].f.flux);
    let rem = Math.min(target - assigned, faceOrder.length);
    for (let k = 0; k < rem; k++) alloc[faceOrder[k]].n++;
    // trim to target if needed
    while (alloc.reduce((s, a) => s + a.n, 0) > target) {
      const a = alloc.reduce((best, x) => (x.n > best.n ? x : best));
      a.n--;
    }

    // build near-square cell rectangles per face
    const cellsDOME = [];
    // assign shell cells first if the envelope isn't a box (or no face was kept)
    if (shellCells.length) {
      for (const cl of shellCells) {
        // octagonal facet polygon on the shell
        const P = add(srcPos, mul(cl.u, cl.Rin || 12));
        const radius = 3.6;
        const u0v = V.basis(cl.u)[0], v0v = V.basis(cl.u)[1];
        const pts = [];
        for (let q = 0; q < 8; q++) { const a = (q + 0.5) * 2 * Math.PI / 8; pts.push(add(add(P, mul(u0v, radius * Math.cos(a))), mul(v0v, radius * Math.sin(a)))); }
        cellsDOME.push({ u: cl.u, I: cl.I, P, pts, face: { n: cl.u.slice() }, rectN: null, cellArea: Math.PI * radius * radius, tile: radius });
      }
    }
    for (const { f, n } of alloc) {
      if (n <= 0) continue;
      // n cells laid in a grid with aspect close to the face's aspect
      const i = (f.ax + 1) % 3, j = (f.ax + 2) % 3;
      const li = 2 * f.h[i], lj = 2 * f.h[j];
      const aspect = li / lj;
      let ny = Math.max(1, Math.round(Math.sqrt(n / aspect))), nx = Math.ceil(n / ny);
      while (nx * ny > n) { if (nx >= ny && nx > 1) nx--; else if (ny > 1) ny--; else nx--; }
      while (nx * ny < n) nx++;
      const cellW = li / nx, cellH = lj / ny;
      for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
        const P = [f.c[0], f.c[1], f.c[2]]; P[f.ax] += f.side * f.h[f.ax];
        P[i] += -f.h[i] + (a + 0.5) * cellW; P[j] += -f.h[j] + (b + 0.5) * cellH;
        const halfW = cellW / 2 * settings.coverGain, halfH = cellH / 2 * settings.coverGain;
        const corner = (da, db) => { const q = P.slice(); q[i] += da; q[j] += db; return q; };
        const pts = [corner(-halfW, -halfH), corner(halfW, -halfH), corner(halfW, halfH), corner(-halfW, halfH)];
        const uC = nrm(sub(P, srcPos)), I = inten(uC);
        cellsDOME.push({ u: uC, I, P, pts, face: f, rectN: [i, j], cellArea: cellW * cellH, tile: Math.min(cellW, cellH) / 2 });
      }
    }

    // match cells <-> clusters: strongest-fluxed cell to the heaviest cluster
    const secSorted = cellsDOME.slice().sort((a, b) => b.I - a.I);
    const clSorted = live.slice().sort((a, b) => b.w - a.w);
    const pairs = [];
    for (let k = 0; k < Math.min(clSorted.length, secSorted.length); k++) pairs.push({ sec: secSorted[k], cl: clSorted[k] });

    // ------------------------------------------------------------ 3. build facets
    const surfaces = [], intent = [];
    let order = 0;
    const axisUp = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const _8 = 8;

    for (const pr of pairs) {
      const sec = pr.sec, cl = pr.cl;
      const S0 = srcPos.slice();
      const Z = add(T.C, add(mul(T.tu, -half + cl.cx * cellMM), mul(T.tv, -half + cl.cy * cellMM)));
      // pull direction: the face's inward normal (toward the envelope's interior)
      const faceN = sec.face.n;
      // geometry first: effective source radius for spot-size math
      const cosV = src.kind === 'planar' ? Math.abs(dot(V.norm(sub(sec.P, S0)), axis)) : 1;
      const aHalf = Math.min(src.w || 1, src.h || 1) * Math.max(0.25, cosV) / 2;
      const aEff = Math.max(0.05, aHalf);
      // precompute aim geometry at a trial point
      const nTrue = V.norm(add(V.norm(sub(S0, sec.P)), V.norm(sub(Z, sec.P))));
      // rectangle polygon in the facet plane
      let e1 = cross(nTrue, axisUp); if (len(e1) < 1e-6) e1 = cross(nTrue, [1, 0, 0]); e1 = V.norm(e1);
      const e2 = V.norm(cross(nTrue, e1));
      let P = sec.P.slice();
      let pts3 = sec.pts;
      // pull the facet centre inward until the compiled outline fits the envelope and clears the LED
      for (let attempt = 0; attempt < 12; attempt++) {
        const backoff = attempt === 0 ? 0.4 : 0.4 + attempt * 0.6;
        P = add(sec.P, mul(faceN, -backoff));
        const dLed = dist(S0, P), L = dist(Z, P);
        if (!(L > 1 && dLed > keep)) continue;
        const ptsF = pts3.map((q) => add(P, mul(sub(q, sec.P), 1)));
        const rhoEff = Math.sqrt(Math.max(0.5, (ptsF.length ? rectArea2D(ptsF, P, e1, e2) : 0.5)) / Math.PI);
        const diStar = Math.sqrt(Math.max(1e-9, L * rhoEff * dLed / aEff));
        const minSpot = Math.max(0.5, 2 * Math.sqrt(Math.max(1e-9, L * rhoEff * aEff / dLed)) - rhoEff);
        const desired = Math.min(80, Math.max(minSpot, cl.rms * settings.spotGain));
        const spotAt = (di) => (isFinite(di) ? di / dLed * aEff + (L - di) * rhoEff / di : rhoEff + L * aEff / dLed);
        let di = diStar;
        if (desired > minSpot * 1.02) {
          let lo = diStar, hi = 1e12;
          for (let it = 0; it < 60; it++) { const mid = Math.sqrt(lo * hi); if (spotAt(mid) < desired) lo = mid; else hi = mid; }
          di = hi;
          if (spotAt(di) > desired * 1.5) di = 1e308;
        }
        const facet = { type: 'facet', id: 'tmp', P, S0, Z, flat: !(di > 0), di, clip: { kind: 'poly', pts3: ptsF }, optics: { interaction: 'reflect', reflectivity: L0 } };
        let outlinePts = null;
        try { const comp = RF.Geo.compile([facet]); outlinePts = RF.Geo.outline(comp, 0).flat(); } catch (e) { outlinePts = ptsF; }
        let ok = true;
        for (const q of outlinePts) if (!RF.Geo.envInside(env, q, 0)) { ok = false; break; }
        if (ok && keep > 0) for (const q of outlinePts) if (dist(q, srcPos) < keep * (1 - 1e-6)) { ok = false; break; }
        if (ok) {
          const id = 'F' + (order++);
          facet.id = id;
          surfaces.push(facet);
          intent.push({ facet: id, cells: cl.cells.map((p) => [pts[p].j * res + pts[p].i, pts[p].w]) });
          break;
        }
        attempt++;
      }
    }

    notes.push(surfaces.length + ' facets placed');
    return { surfaces, intent, notes };
  },
});

// ------------------------------------------------- paint-facets-auto: the tuner wraps paint-facets
// It does not change the static design at all; it only probes a small, fixed candidate set with
// tools.trace (a deterministic common seed) and returns the candidate that scores best for the chosen
// goal.  The static solver is always kept intact — the tuner only *calls* it for geometries.
RF.Solvers.register({
  id: 'bench-inkling2small-r2--paint-facets-auto', name: 'Paint facets (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'coverGain', label: 'Aperture vs grid fit', type: 'range', min: 0.55, max: 1.2, step: 0.05, default: 0.65, help: 'baseline starting point; the tuner may pick a different value' },
    { key: 'spotGain', label: 'Spot radius vs cluster RMS', type: 'range', min: 0.6, max: 3.0, step: 0.1, default: 1.0 },
    // task-required setting: pick the beam goal
    { key: 'goal', label: 'Goal', type: 'select', default: 'faithful', options: [
      { value: 'faithful', label: 'Faithful — maximise paint fidelity (F1)' },
      { value: 'throw', label: 'Throw — maximise peak intensity (throw distance)' },
      { value: 'efficient', label: 'Efficient — maximise light on painted cells' },
    ] },
  ],
  async solve(input, settings, tools) {
    const staticDef = RF.Solvers.get('bench-inkling2small-r2--paint-facets');
    if (!staticDef) throw new Error('paint-facets base solver not registered');
    const goal = settings.goal || 'faithful';
    // candidate sets — fixed, deterministic, small enough to finish inside the time limit
    const candidates = [];
    const add = (coverGain, spotGain, tag) => candidates.push({ minDistance: settings.minDistance, coverGain, spotGain, tag });
    if (goal === 'faithful') {
      add(0.55, 0.8, 'sharp-narrow'); add(0.55, 1.3, 'sharp-wide'); add(0.65, 0.8, 'default-narrow'); add(0.65, 1.0, 'default'); add(0.65, 1.3, 'default-wide'); add(0.78, 0.8, 'wide-narrow'); add(0.78, 1.0, 'wide'); add(1.0, 0.8, 'full');
    } else if (goal === 'throw') {
      // peak intensity rewards sharper spots on the central plateau
      add(0.55, 0.6, 'sharp1'); add(0.55, 0.8, 'sharp2'); add(0.65, 0.8, 'base-sharp'); add(0.65, 1.0, 'base'); add(0.78, 0.8, 'wide-sharp'); add(0.85, 1.0, 'wide'); add(1.0, 0.8, 'full-sharp');
    } else { // efficient
      // on-paint light rewards wider coverage and moderate blur
      add(0.55, 1.0, 'inner'); add(0.65, 1.0, 'default'); add(0.78, 0.8, 'root'); add(0.78, 1.3, 'large'); add(1.0, 1.0, 'full'); add(1.0, 1.3, 'full-wide');
    }
    // dummy tools for the static solve: any trace there throws (it is a static algorithm)
    const dummyTools = { progress() {}, preview() {}, budget: { rays: 2e7, ms: 1e9 }, trace() { throw new Error('paint-facets is static — trace refused'); } };
    const metric = (r) => {
      if (!r) return -Infinity;
      try {
        if (goal === 'faithful') return (r.fidelity && r.fidelity.fidelity) || -Infinity;
        if (goal === 'throw') return r.peakCd || -Infinity;
        return (r.fidelity && r.fidelity.onPaint) || -Infinity;
      } catch (e) { return -Infinity; }
    };
    let best = { score: -Infinity, out: null, desc: '' };
    const notes = [];
    for (const cand of candidates) {
      const inp = { ...input, limits: { ...input.limits } };
      const out = staticDef.solve(inp, { minDistance: cand.minDistance, coverGain: cand.coverGain, spotGain: cand.spotGain }, dummyTools);
      if (!out || !Array.isArray(out.surfaces) || !out.surfaces.length) continue;
      const rayCount = 150000;
      const td = (() => { try { return tools.trace(out.surfaces, { rays: rayCount }); } catch (e) { return null; } })();
      const score = metric(td);
      notes.push(cand.tag + ' F=' + (td && td.fidelity && td.fidelity.fidelity != null ? (100 * td.fidelity.fidelity).toFixed(1) + '%' : '—') + ' peak ' + (td && td.peakCd ? Math.round(td.peakCd) : '—') + ' lmOnTarget=' + (td && td.lmOnTarget ? Math.round(td.lmOnTarget) : '—') + ' onPaint=' + (td && td.fidelity && td.fidelity.onPaint != null ? (100 * td.fidelity.onPaint).toFixed(1) + '%' : '—') + (score === best.score ? '*' : ''));
      if (score > best.score) best = { score, out, desc: cand.tag };
    }
    if (!best.out) {
      // nothing scored — just return the static default
      const out = RF.Solvers.get('bench-inkling2small-r2--paint-facets').solve(input, { minDistance: settings.minDistance, coverGain: settings.coverGain, spotGain: settings.spotGain }, dummyTools);
      return { ...out, notes: (out.notes || []).concat(['tuner: static default (no candidate scored)']) };
    }
    notes.push('tuner selected ' + best.desc + ' (goal=' + goal + ')');
    return { ...best.out, notes: (best.out.notes || []).concat(notes) };
  },
});


function rectArea2D(pts, P, ex, ey) {
  let a = 0;
  const proj = (q) => { const d = [q[0] - P[0], q[1] - P[1], q[2] - P[2]]; return [d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2], d[0] * ey[0] + d[1] * ey[1] + d[2] * ey[2]]; };
  const loc = pts.map(proj);
  for (let i = 0; i < loc.length; i++) { const p = loc[i], q = loc[(i + 1) % loc.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}
