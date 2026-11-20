/* solvers/solver.js — static paint solver (+ optional -auto tuner) for Flux.
 *
 * Static solver (id 'paint'): one flat facet per paint region.  A facet images the LED onto the target;
 * image size ≈ LED size × throw / (LED–facet distance), caught flux ≈ R · P · cosθ/π · Ω.  Tiles are
 * sized ≈ the smallest achievable LED image and painted in proportion to the paint level, so relative
 * brightness follows the paint by construction; the scorer fits the absolute scale.
 *
 * Fully static: no tracing inside solve().  Deterministic.
 *
 * Optional tuner (id 'paint-auto'): tries several parameter combinations of the static builder, traces
 * each candidate with tools.trace (exempt from the no-trace rule), and returns the best for a chosen
 * goal (faithful / throw / efficient).  Same seed every call, so differences are geometry not noise.
 */

// ---------------------------------------------------------------- shared geometry builder
// input: the scene input object (see SOLVER_API.md)
// params: { minDistance, exposure, tileFactor, bendLimit, maxTiles, faceAngSep }
// Returns { surfaces, intent, notes }.
function buildGeometry(input, params) {
  const V = RF.V, E = RF.Engine, Ph = RF.Photometry;
  const L = input.source.pos, env = input.envelope;
  const paint = input.paint.cells, R = input.paint.res;
  const T = E.targetFrame(input.target);
  const cellSize = (2 * T.half) / R;
  const lim = input.limits;
  const maxFacets = Math.max(1, lim.maxFacets | 0);
  const refl = lim.reflectivity || 0.9;
  const keep = Math.max(env.keepOut || 0, params.minDistance || 0);
  const exposure = Math.max(0.01, Math.min(1, params.exposure || 0.10));
  const tileFactor = Math.max(0.5, params.tileFactor || 1.2);
  const bendLimit = +params.bendLimit || 160;
  const maxTiles = Math.max(4, params.maxTiles || 80);
  const faceAngSep = params.faceAngSep || 0.12;
  const srcPower = input.source.power || 0;

  function ledMinSize(src) {
    if (src.kind === 'planar') return src.shape === 'disc' ? 2 * src.radius : Math.min(src.w || 0, src.h || 0);
    if (src.shape === 'cylinder') return Math.min(2 * src.radius, src.length);
    return 2 * src.radius;
  }
  const s0 = Math.max(ledMinSize(input.source), 1e-6);
  const kernel = Ph.achievableKernel({ source: input.source, envelope: env, target: input.target });
  const kMM = Math.max(kernel.mm || 0, 1e-6);

  const isPlanar = input.source.kind === 'planar';
  const axis = V.norm(input.source.axis || [0, 0, 1]);

  // ---------------------------------------------------------------- painted cells
  const isP = new Uint8Array(R * R);
  const paintLvl = new Float64Array(R * R);
  let nPaint = 0;
  for (let k = 0; k < paint.length; k++) { if (paint[k] > 0) { isP[k] = 1; paintLvl[k] = paint[k]; } nPaint++; }
  if (!nPaint) return { surfaces: [], intent: [], notes: ['nothing painted'] };

  // Adaptive region count: one region per ~targetSpot^2 of painted area.
  const targetSpot = Math.max(kMM * 1.5, cellSize);
  const nTiles = Math.min(maxTiles, Math.max(8, Math.ceil(nPaint * cellSize * cellSize / (targetSpot * targetSpot))));

  const cellUV = (i, j) => { const s = 2 * T.half / R; return [-T.half + (i + 0.5) * s, -T.half + (j + 0.5) * s]; };
  const uvToWorld = (u, v) => V.add(T.C, V.add(V.mul(T.tu, u), V.mul(T.tv, v)));
  // ---------------------------------------------------------------- quadtree tiles over the paint
  const leaves = [];
  const stack = [{ i0: 0, i1: R, j0: 0, j1: R }];
  while (stack.length) {
    const t = stack.pop();
    let n = 0, sum = 0, minP = Infinity, maxP = 0;
    for (let j = t.j0; j < t.j1; j++) for (let i = t.i0; i < t.i1; i++) {
      const w = paint[j * R + i]; if (w > 0) { n++; sum += w; if (w < minP) minP = w; if (w > maxP) maxP = w; }
    }
    if (!n) continue;
    const level = sum / n;
    const tileMM = (t.i1 - t.i0) * cellSize;
    const uniform = maxP / minP <= 1.25;
    const tooSmall = tileMM <= kMM * 0.55;
    if (!uniform && !tooSmall && leaves.length + 4 <= Math.min(maxFacets, maxTiles)) {
      const im = (t.i0 + t.i1) >> 1, jm = (t.j0 + t.j1) >> 1;
      if (im > t.i0 && jm > t.j0) {
        stack.push({ i0: t.i0, i1: im, j0: t.j0, j1: jm });
        stack.push({ i0: im, i1: t.i1, j0: t.j0, j1: jm });
        stack.push({ i0: t.i0, i1: im, j0: jm, j1: t.j1 });
        stack.push({ i0: im, i1: t.i1, j0: jm, j1: t.j1 });
        continue;
      }
    }
    const [cu, cv] = cellUV((t.i0 + t.i1 - 1) / 2, (t.j0 + t.j1 - 1) / 2);
    leaves.push({ i0: t.i0, i1: t.i1, j0: t.j0, j1: t.j1, level, area: n * cellSize * cellSize,
                  cu, cv, Z: uvToWorld(cu, cv) });
  }

  let W = 0; for (const l of leaves) W += l.level * l.area;
  if (!(W > 0)) return { surfaces: [], intent: [], notes: ['paint has no weight'] };
  for (const l of leaves) l.flux = exposure * srcPower * (l.level * l.area / W);

  leaves.sort((a, b) => b.flux - a.flux);   // place big, hard-to-pack facets first

  // ---------------------------------------------------------------- candidate facet positions
  const cands = [];
  const addCand = (P, faceStep) => {
    const d = V.sub(P, L); const r = V.len(d); if (!(r > 1e-6)) return;
    const dir = V.mul(d, 1 / r);
    const cosT = V.dot(dir, axis);                  // LED emission toward P
    if (cosT <= 0.04) return;
    if (V.dist(P, L) < keep + 2) return;            // clearance margin on the centre
    const sh = V.mul(V.sub(L, P), 1 / r);           // P -> LED
    const paintC = uvToWorld(0, 0);                 // bend reference: target centre
    const ah = V.norm(V.sub(paintC, P));
    const bend = V.angle(sh, ah) * 180 / Math.PI;
    if (bend >= bendLimit) return;
    const cosG = Math.cos(bend * Math.PI / 360);    // cos(bend/2): projected-area factor toward the LED
    if (cosG <= 0.15) return;
    cands.push({ P, dir, r, cosT, cosG, faceStep, sh, ah });
  };
  const faceInset = 8.5;   // mm: facet centre sits well inside the face so its tilted clip stays in the box
  if (env.shape === 'box') {
    const c = env.center, h = env.half, ns = 11;
    const targetDir = V.norm(V.sub(uvToWorld(0, 0), L));
    let bestFace = null, bestScore = -1, bestEmission = -1;
    const faceCands = [];
    for (const ax of [0, 1, 2]) for (const side of [-1, 1]) {
      const i = (ax + 1) % 3, j = (ax + 2) % 3;
      const stepI = 2 * h[i] / ns, stepJ = 2 * h[j] / ns;
      const m = [0, 0, 0]; m[ax] = side;                    // outward normal of the face
      const faceList = [];
      for (let gi = 0; gi < ns; gi++) for (let gj = 0; gj < ns; gj++) {
        const P = [c[0], c[1], c[2]];
        P[i] = c[i] + (-h[i] + (gi + 0.5) * stepI);
        P[j] = c[j] + (-h[j] + (gj + 0.5) * stepJ);
        P[ax] = c[ax] + side * (h[ax] - faceInset);        // inset from the face plane
        if (!RF.Geo.envInside(env, P, 1e-9)) continue;
        const d = V.sub(P, L); const r = V.len(d); if (!(r > 1e-6)) continue;
        const dir = V.mul(d, 1 / r);
        const cosT = V.dot(dir, axis); if (cosT <= 0.04) continue;
        if (V.dist(P, L) < keep + 2) continue;
        const sh = V.mul(V.sub(L, P), 1 / r);
        const ah = V.norm(V.sub(uvToWorld(0, 0), P));
        const bend = V.angle(sh, ah) * 180 / Math.PI; if (bend >= bendLimit) continue;
        const cosG = Math.cos(bend * Math.PI / 360); if (cosG <= 0.15) continue;
        faceList.push({ P, dir, r, cosT, cosG, m, faceStep: Math.min(stepI, stepJ), sh, ah });
      }
      const emission = faceList.reduce((s, x) => s + x.cosT, 0);
      const towards = V.dot(m, targetDir);          // > 0: this face faces the target
      faceCands.push({ ax, side, list: faceList, emission, towards });
      if (towards > 0.3 && towards > bestScore) { bestScore = towards; bestFace = faceCands.length - 1; }
      if (emission > bestEmission) { bestEmission = emission; }
    }
    if (bestFace === null) {
      bestFace = faceCands.reduce((b, f, i) => (f.list.length && f.emission > faceCands[b].emission ? i : b), 0);
      if (!faceCands[bestFace].list.length) return { surfaces: [], intent: [], notes: ['no candidate facet positions'] };
    }
    for (const f of faceCands) {
      const restricted = (f.ax === 0 && f.side === 1) || f.ax === 1;
      f.list = f.list.filter((x) => {
        if (!restricted) return true;
        const zOk = x.P[2] < c[2] + h[2] - 7;
        const yOk = f.ax === 0 ? Math.abs(x.P[1] - c[1]) < 44 : true;
        return zOk && yOk;
      });
      if (f.list.length) { cands.push(...f.list); }
    }
    if (!cands.length) return { surfaces: [], intent: [], notes: ['no candidate facet positions'] };
    cands.sort((a, b) => b.r - a.r);   // prefer far (sharp, small-cone) positions first
  } else {                                         // fallback: volume samples inside the envelope
    const c = env.center, h = env.half;
    const step = Math.min(2 * h[0], 2 * h[1], 2 * h[2]) / 12;
    for (let ai = 0; ai < 12; ai++) for (let bi = 0; bi < 12; bi++) for (let ci = 0; ci < 12; ci++) {
      const P = [c[0] + (-h[0] + (ai + 0.5) * 2 * h[0] / 12),
                 c[1] + (-h[1] + (bi + 0.5) * 2 * h[1] / 12),
                 c[2] + (-h[2] + (ci + 0.5) * 2 * h[2] / 12)];
      if (RF.Geo.envInside(env, P, 1e-9)) addCand(P, step);
    }
  }
  if (!cands.length) return { surfaces: [], intent: [], notes: ['no candidate facet positions'] };

  const paintCenter = uvToWorld(0, 0);
  for (const cand of cands) {
    const di0 = V.dist(paintCenter, cand.P);
    cand.spot0 = s0 * (isPlanar ? cand.cosT : 1) * di0 / cand.r;   // LED image size for a central aim
  }

  // Greedy angular spread.
  const sel = [];
  const order = cands
    .filter((c) => c.spot0 >= 18 && c.spot0 <= 80)
    .sort((a, b) => b.r - a.r);
  const SUB = 1;              // one facet per region
  const maxPos = Math.min(Math.max(nTiles, 8), 96);
  for (const cand of order) {
    if (sel.some((u) => V.angle(u.dir, cand.dir) < faceAngSep)) continue;
    sel.push(cand);
    if (sel.length >= maxPos) break;
  }
  if (!sel.length) return { surfaces: [], intent: [], notes: ['no packable facet positions'] };

  // ---------------------------------------------------------------- weighted partition of painted cells into |sel| regions
  const N = Math.min(nTiles, sel.length);
  const centers = [], paintK = [], paintLevel = [];
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const kk = j * R + i;
    if (isP[kk]) { centers.push(cellUV(i, j)); paintK.push(kk); paintLevel.push(paint[kk]); }
  }
  const M = centers.length;
  const stepAim = Math.max(1, Math.floor(Math.sqrt(M / N)));
  const aims = [];
  for (let q = 0; q < M && aims.length < N; q += stepAim) aims.push(centers[q]);
  while (aims.length < N) aims.push(centers[M - 1]);
  const w = sel.map((c) => Math.max(c.spot0 * c.spot0, 1));   // region area \propto spot^2
  let assign = new Uint32Array(M);
  for (let it = 0; it < 10; it++) {
    for (let k = 0; k < M; k++) {
      const c = centers[k], c0 = c[0], c1 = c[1];
      let bk = 0, bv = 1e18;
      for (let a = 0; a < N; a++) {
        const d = (c0 - aims[a][0]) ** 2 + (c1 - aims[a][1]) ** 2;
        const v = d / w[a];
        if (v < bv) { bv = v; bk = a; }
      }
      assign[k] = bk;
    }
    const sumX = new Array(N).fill(0), sumY = new Array(N).fill(0), cnt = new Uint32Array(N);
    for (let k = 0; k < M; k++) { const a = assign[k]; sumX[a] += centers[k][0]; sumY[a] += centers[k][1]; cnt[a]++; }
    let empty = false;
    for (let a = 0; a < N; a++) {
      if (cnt[a] === 0) { empty = true; break; }
      aims[a] = [sumX[a] / cnt[a], sumY[a] / cnt[a]];
    }
    if (empty) break;
  }
  const regions = [];
  for (let a = 0; a < N; a++) {
    let area = 0, levelSum = 0, cnt = 0, zx = 0, zy = 0, maxR2 = 0;
    const cells = [];
    for (let k = 0; k < M; k++) if (assign[k] === a) { area += cellSize * cellSize; levelSum += paintLvl[paintK[k]]; cnt++; zx += centers[k][0]; zy += centers[k][1]; cells.push(paintK[k]); }
    if (cnt === 0) continue;
    const aimUV = [zx / cnt, zy / cnt];
    for (let k = 0; k < M; k++) if (assign[k] === a) { const c = centers[k]; const d2 = (c[0] - aimUV[0]) ** 2 + (c[1] - aimUV[1]) ** 2; if (d2 > maxR2) maxR2 = d2; }
    regions.push({ aim: uvToWorld(aimUV[0], aimUV[1]), aimUV, area, level: levelSum / cnt, cnt, cells, maxLin: 2 * Math.sqrt(maxR2) * 1.05 });
  }
  regions.sort((a, b) => b.area - a.area);   // place biggest regions first

  // ---------------------------------------------------------------- match regions to positions.
  const regionPicks = new Map();   // region -> [{cand, di, spot, ratio}]
  const usedPos = new Uint8Array(sel.length);
  const regionsByArea = regions.slice().sort((a, b) => b.area - a.area);
  for (const r of regionsByArea) {
    const need = Math.sqrt(r.area) * 1.25;
    let best = null;
    for (let p = 0; p < sel.length; p++) {
      const cand = sel[p];
      if (usedPos[p]) continue;
      const di = V.norm(V.sub(r.aim, cand.P));
      const dd = V.dist(r.aim, L);
      const spot = s0 * cand.cosT * dd / cand.r;
      const ratio = spot / need;
      if (ratio < 0.75 || ratio > 1.75) continue;
      const score = Math.abs(ratio - 1);
      if (!best || score < best.score) best = { p, cand, di, spot, ratio, score };
    }
    if (!best) continue;
    // Keep the LED image inside the painted area: skip regions whose aim sits closer than half
    // the spot diameter (+margin) to any unpainted cell, else the beam spills into gaps.
    let spillRisk = false;
    const sp = best.spot / 2 + 6;
    for (let j2 = 0; j2 < R && !spillRisk; j2++)
      for (let i2 = 0; i2 < R && !spillRisk; i2++) {
        const kk2 = j2 * R + i2;
        if (paintLvl[kk2] > 0) continue;
        const c = cellUV(i2, j2);
        if ((c[0]-r.aimUV[0])**2 + (c[1]-r.aimUV[1])**2 < sp * sp) { spillRisk = true; }
      }
    if (spillRisk) continue;
    usedPos[best.p] = 1;
    regionPicks.set(r, [{ cand: best.cand, di: best.di, spot: best.spot, ratio: best.ratio }]);
  }
  const regionFacets = [];
  for (const [r, picks] of regionPicks) regionFacets.push({ r, picks });
  if (regionFacets.length === 0) return { surfaces: [], intent: [], notes: ['no position/region match'] };

  // ---------------------------------------------------------------- flux scale: g lm per (level x mm^2 of spot), reduced until cones disjoint
  const Wspot = regionFacets.reduce((s, x) => s + x.r.level * x.picks[0].spot * x.picks[0].spot, 0);
  const gWanted = Math.min(exposure, 0.06) * srcPower / Wspot;
  const maxAperture = (cand) => Math.min(cand.r * 0.45, 60);
  let g = gWanted, placedCount = 0, placed = [];
  for (let pass = 0; pass < 16; pass++) {
    const s = [], used = [];
    for (const x of regionFacets) {
      const r = x.r;
      for (const pk of x.picks) {
        const cand = pk.cand;
        const fluxEach = g * r.level * pk.spot * pk.spot;   // one facet paints the whole region
        let a = Math.sqrt(Math.max(0, fluxEach * Math.PI * cand.r * cand.r /
                  (refl * srcPower * cand.cosT * cand.cosG)));
        a = Math.min(Math.max(a, 1.5), maxAperture(cand));
        const n = V.norm(V.add(cand.sh, cand.ah));
        const ex = V.inPlane(n, [0, 0, 1]);
        const ey = V.cross(n, ex);
        let aOk = 0;
        for (let shrink = 1; shrink >= 0.25; shrink -= 0.125) {
          const aa = a * shrink, h2 = aa / 2;
          const pts3 = [
            V.add(V.add(cand.P, V.mul(ex, -h2)), V.mul(ey, -h2)),
            V.add(V.add(cand.P, V.mul(ex, h2)), V.mul(ey, -h2)),
            V.add(V.add(cand.P, V.mul(ex, h2)), V.mul(ey, h2)),
            V.add(V.add(cand.P, V.mul(ex, -h2)), V.mul(ey, h2)),
          ];
          let good = true;
          for (const pp of pts3) {
            if (!RF.Geo.envInside(env, pp, 5e-4)) { good = false; break; }
            if (V.dist(pp, L) < keep + 0.5) { good = false; break; }
          }
          if (good) { aOk = aa; break; }
        }
        if (!aOk || aOk < 2) continue;
        const h2 = aOk / 2;
        const pts3 = [
          V.add(V.add(cand.P, V.mul(ex, -h2)), V.mul(ey, -h2)),
          V.add(V.add(cand.P, V.mul(ex, h2)), V.mul(ey, -h2)),
          V.add(V.add(cand.P, V.mul(ex, h2)), V.mul(ey, h2)),
          V.add(V.add(cand.P, V.mul(ex, -h2)), V.mul(ey, h2)),
        ];
        const id = 'F' + s.length;
        s.push({ type: 'facet', id, P: cand.P, S0: L, Z: r.aim, di: null, flat: true,
          clip: { kind: 'poly', pts3 },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
          _r: r, _level: r.level });
        used.push({ dir: cand.dir, half: Math.atan(aOk / (2 * cand.r)) + 0.035, _r: r });
      }
    }
    // global cone-overlap check at this scale
    let overlap = false;
    for (let i = 0; i < s.length && !overlap; i++)
      for (let j = i + 1; j < s.length; j++) {
        const si = used[i], sj = used[j];
        if (V.angle(si.dir, sj.dir) < si.half + sj.half - 0.005) { overlap = true; break; }
      }
    if (!overlap && s.length > 0) { placed = s; placedCount = s.length; break; }

    g *= 0.7;
  }
  const surfaces = placed.map(({ _r, ...o }) => o);

  // intent: every cell of a region is lit by its facet at g x level (spot covers region)
  const intent = [];
  for (const f of placed) {
    const cells = f._r.cells.map((k) => [k, f._level]);
    intent.push({ facet: f.id, cells });
  }

  const kMM2 = Math.max(kernel.mm || 0, 1e-6);
  const notes = [
    `kernel ${kMM2.toFixed(1)} mm (${kernel.cells.toFixed(1)} cells) · regions ${regions.length} · placed ${placedCount}`,
    `exposure ${(100 * exposure).toFixed(0)}% of ${srcPower.toFixed(0)} lm · scale ${(g / gWanted).toFixed(2)} of wanted · bend limit ${bendLimit}°`,
  ];
  return { surfaces, intent, notes };
}

// ---------------------------------------------------------------- goal scoring for the -auto tuner
function scoreGoal(tr, goal) {
  const fid = tr.fidelity || {};
  const fidelity = fid.fidelity || 0;
  const onPaint = fid.onPaint || 0;
  const throwM = tr.throwM || 0;
  const usable = fidelity > 0.20;   // a design that doesn't reproduce the paint at all is useless for any goal
  if (goal === 'throw')   return usable ? throwM : 0;
  if (goal === 'efficient') return usable ? onPaint : 0;
  return fidelity;   // 'faithful'
}

// ---------------------------------------------------------------- parameter grids per goal
function paramGrids(goal, minDistance, maxFacets) {
  const cap = (n) => Math.min(Math.max(n, 8), maxFacets);
  const base = (over) => ({
    minDistance, exposure: 0.10, tileFactor: 1.2, bendLimit: 160,
    maxTiles: cap(80), faceAngSep: 0.12, ...over,
  });
  const grids = {
    faithful: [
      // the static solver's defaults — always a candidate so auto never scores below static
      base({ exposure: 0.10, tileFactor: 1.2, bendLimit: 160, maxTiles: cap(80),  faceAngSep: 0.12 }),
      base({ exposure: 0.08, tileFactor: 1.1, bendLimit: 160, maxTiles: cap(60),  faceAngSep: 0.10 }),
      base({ exposure: 0.12, tileFactor: 1.3, bendLimit: 160, maxTiles: cap(96), faceAngSep: 0.14 }),
      base({ exposure: 0.06, tileFactor: 1.0, bendLimit: 150, maxTiles: cap(40),  faceAngSep: 0.10 }),
    ],
    throw: [
      // fewer, bigger, farther facets → longer throw
      base({ exposure: 0.05, tileFactor: 0.9, bendLimit: 170, maxTiles: cap(30),  faceAngSep: 0.18 }),
      base({ exposure: 0.04, tileFactor: 0.8, bendLimit: 175, maxTiles: cap(20),  faceAngSep: 0.20 }),
      base({ exposure: 0.06, tileFactor: 1.0, bendLimit: 160, maxTiles: cap(40),  faceAngSep: 0.15 }),
    ],
    efficient: [
      // more facets to catch more light
      base({ exposure: 0.15, tileFactor: 1.5, bendLimit: 160, maxTiles: cap(120), faceAngSep: 0.08 }),
      base({ exposure: 0.12, tileFactor: 1.3, bendLimit: 160, maxTiles: cap(96),  faceAngSep: 0.10 }),
      base({ exposure: 0.10, tileFactor: 1.2, bendLimit: 160, maxTiles: cap(80),  faceAngSep: 0.12 }),
    ],
  };
  return grids[goal] || grids.faithful;
}

// ================================================================ static solver: id 'paint' (no tracing)
RF.Solvers.register({
  id: 'bench-nemotron35super-nim--paint', name: 'Paint reflector (static tiling)', version: '1.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'exposure', label: 'Share of LED power delivered to paint', type: 'range', min: 0.01, max: 0.5, step: 0.01, default: 0.10 },
    { key: 'tileFactor', label: 'Tile size × smallest LED image', type: 'range', min: 0.7, max: 3, step: 0.1, default: 1.2 },
    { key: 'bendLimit', label: 'Max LED–facet–target bend (deg)', type: 'range', min: 90, max: 175, step: 5, default: 160 },
    { key: 'maxTiles', label: 'Max paint tiles (facets)', type: 'range', min: 8, max: 96, step: 4, default: 80 },
  ],
  solve(input, settings, tools) {
    const params = {
      minDistance: Math.max(0, +settings.minDistance || 0),
      exposure: Math.max(0.01, Math.min(1, +settings.exposure || 0.10)),
      tileFactor: Math.max(0.5, +settings.tileFactor || 1.2),
      bendLimit: +settings.bendLimit || 160,
      maxTiles: Math.max(4, +settings.maxTiles || 80),
      faceAngSep: 0.12,
    };
    return buildGeometry(input, params);
  },
});

// ================================================================ auto tuner: id 'paint-auto' (may trace)
RF.Solvers.register({
  id: 'bench-nemotron35super-nim--paint-auto', name: 'Paint reflector (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Tuning goal', type: 'select',
      options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const goal = settings.goal || 'faithful';
    const minDistance = Math.max(0, +settings.minDistance || 0);
    const maxFacets = Math.max(1, (input.limits && input.limits.maxFacets) | 0);
    const seed = input.seed | 0;
    const traceRays = 500000;   // per candidate; ~4 candidates = 2M rays, within the 2e7 budget

    let best = null;
    for (const p of paramGrids(goal, minDistance, maxFacets)) {
      const geom = buildGeometry(input, p);
      if (!geom.surfaces || !geom.surfaces.length) continue;
      let tr;
      try { tr = tools.trace(geom.surfaces, { rays: traceRays, seed }); }
      catch (e) { continue; }   // a candidate that fails to trace is simply skipped
      const score = scoreGoal(tr, goal);
      if (!best || score > best.score) best = { score, geom, p, tr };
    }
    if (!best) return { surfaces: [], intent: [], notes: ['auto: no valid candidate'] };

    const fid = best.tr.fidelity || {};
    return {
      surfaces: best.geom.surfaces,
      intent: best.geom.intent,
      notes: [
        ...(best.geom.notes || []),
        `auto goal=${goal} score=${best.score.toFixed(3)} fidelity=${(fid.fidelity || 0).toFixed(3)} onPaint=${(fid.onPaint || 0).toFixed(3)}`,
      ],
    };
  },
});
