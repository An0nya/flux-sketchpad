/* Static paint solver v2: curved (ellipsoid) facets on a diagonal collector plane.
 * Plane normal n0 = bisector of (direction LED->target) and (LED axis reversed),
 * i.e. average facet normal.  Facets on that plane: outgoing rays lift off the plane
 * (ah . n0 > 0) and incoming rays arrive from the front, so neighbours do not block.
 * Each facet is an ellipsoid facet (di = dist to aim) so its spot is the LED image.
 * Aims: systematic sampling of paint cumulative weight (density proportional to paint).
 */
RF.Solvers.register({
  id: 'bench-museember-r2--paint-static', name: 'Paint static (diagonal plane)', version: '0.2', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'thetaMax', label: 'Max angle from LED axis (deg)', type: 'number', min: 10, max: 89, step: 1, default: 65 },
    { key: 'facetFill', label: 'Facet fill vs neighbour spacing', type: 'range', min: 0.3, max: 1.0, step: 0.05, default: 1.0 },
    { key: 'cMin', label: 'Min bisector cos', type: 'range', min: 0.05, max: 0.9, step: 0.05, default: 0.25 },
    { key: 'planeDist', label: 'Collector plane distance (mm, 0=auto)', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'spotCells', label: 'Desired spot size (paint cells)', type: 'range', min: 0, max: 12, step: 0.25, default: 5 },
    { key: 'shield', label: 'Block direct light with exit shield', type: 'checkbox', default: true },
    { key: 'fluxSolve', label: 'Solve facet fluxes by NNLS deconvolution', type: 'checkbox', default: false },
    { key: 'gapWeight', label: 'Gap cell weight in flux solve', type: 'range', min: 0, max: 2, step: 0.1, default: 0.6 },
    { key: 'inset', label: 'Inset from envelope wall (mm)', type: 'number', min: 0, step: 0.5, default: 1.5 },
  ],
  solve(input, settings) {
    const V = RF.V, Geo = RF.Geo;
    const src = input.source, S = src.pos.slice();
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const rho = input.limits.reflectivity;
    const keep = Math.max(input.envelope.keepOut || 0, settings.minDistance || 0);
    const thetaMax = (settings.thetaMax || 65) * Math.PI / 180;
    const fill = settings.facetFill != null ? settings.facetFill : 0.9;
    const cMin = settings.cMin != null ? settings.cMin : 0.25;
    const inset = settings.inset != null ? settings.inset : 1.5;
    const T = RF.Engine.targetFrame(input.target);
    const R = input.paint.res, paint = input.paint.cells;
    const cellW = 2 * T.half / R;
    const notes = [];

    const fr = RF.Source.frame(src), ax = fr.a;
    const ah0 = V.norm(V.sub(T.C, S));            // LED -> target centre
    let n0 = V.norm(V.add(V.mul(ax, -1), ah0));   // bisector: sh_avg = -ax
    if (V.len(n0) < 1e-6) { n0 = V.basis(ah0)[0]; }
    const e1 = V.basis(n0)[0], e2 = V.basis(n0)[1];
    // plane basis from V.basis(n0) is orthonormal; e1/e2 as above (basis returns [u,v])

    function usable(P) {
      const dvec = V.sub(P, S), r = V.len(dvec);
      if (r < keep + 2) return null;
      if (!Geo.envInside(input.envelope, P, -0.002)) return null;
      const dir = V.mul(dvec, 1 / r);
      const cosT = V.dot(dir, ax), theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
      if (theta > thetaMax) return null;
      let inten = 1; try { inten = RF.Source.intensity(src, theta); } catch (e) { inten = Math.max(0, cosT); }
      if (!(inten > 0.015)) return null;
      const sh = V.mul(dir, -1), ah = V.norm(V.sub(T.C, P));
      const ns = V.add(sh, ah); if (V.len(ns) < 1e-6) return null;
      const n = V.norm(ns), c = V.dot(n, sh);
      if (c < cMin) return null;
      // outgoing must lift off collector plane, incoming must arrive from front
      if (V.dot(ah, n0) < 0.15) return null;
      if (V.dot(V.mul(dir, -1), n0) < 0.0) return null;
      return { P, r, theta, inten, c, n };
    }

    // ---- choose plane distance D (plane point = S - n0*D)
    const diag = Math.hypot(...input.envelope.half) * 2 + 20;
    let bestD = 30, bestScore = -1;
    const Ds = [];
    if (settings.planeDist > 0) Ds.push(settings.planeDist);
    else for (let D = 8; D <= 140; D += 4) Ds.push(D);
    for (const D of Ds) {
      const Q = V.add(S, V.mul(n0, -D));
      let score = 0, cnt = 0;
      for (let X = -diag; X <= diag; X += 6) for (let Y = -diag; Y <= diag; Y += 6) {
        const P = V.add(Q, V.add(V.mul(e1, X), V.mul(e2, Y)));
        const u = usable(P);
        if (u) { cnt++; score += u.inten * u.c * Math.min(1.4, u.r / 50); }
      }
      // prefer larger D (sharper spots) among near-best scores
      const adj = score * (0.7 + 0.3 * Math.min(1, D / 70));
      if (adj > bestScore) { bestScore = adj; bestD = D; }
      if (settings.planeDist > 0) break;
    }
    const D = bestD, Q = V.add(S, V.mul(n0, -D));
    notes.push('plane D=' + D.toFixed(0) + ' n0=' + n0.map(x => x.toFixed(2)).join(','));

    // estimate usable area with fine grid
    let fineCnt = 0;
    for (let X = -diag; X <= diag; X += 3) for (let Y = -diag; Y <= diag; Y += 3) {
      if (usable(V.add(Q, V.add(V.mul(e1, X), V.mul(e2, Y))))) fineCnt++;
    }
    const areaUse = fineCnt * 9;
    let spacing = areaUse > 0 ? Math.sqrt(areaUse / maxF) : 8;
    spacing = Math.max(2.5, spacing);
    notes.push('usable area~' + areaUse.toFixed(0) + ' spacing ' + spacing.toFixed(1));

    // grid facets, centred on usable centroid for symmetry
    let pts = [];
    for (let X = -diag; X <= diag; X += spacing) for (let Y = -diag; Y <= diag; Y += spacing) {
      const P = V.add(Q, V.add(V.mul(e1, X), V.mul(e2, Y)));
      const u = usable(P);
      if (u) pts.push(u);
    }
    // if too many, thin by keeping every point but they are on a grid -> already spaced; if still >maxF, increase spacing implicitly by FPS in plane
    if (pts.length > maxF) {
      // farthest point sampling in 3D (deterministic)
      const sel = [0]; const minD = pts.map(p => V.dist(p.P, pts[0].P));
      while (sel.length < maxF) {
        let bi = -1, bv = -1;
        for (let i = 0; i < pts.length; i++) if (minD[i] > bv) { bv = minD[i]; bi = i; }
        if (bi < 0 || bv <= 0) break;
        sel.push(bi);
        for (let i = 0; i < pts.length; i++) minD[i] = Math.min(minD[i], V.dist(pts[i].P, pts[bi].P));
      }
      pts = sel.map(i => pts[i]);
    }
    notes.push('grid pts ' + pts.length);
    if (!pts.length) return { surfaces: [], intent: [], notes };

    for (let i = 0; i < pts.length; i++) {
      let nd = Infinity;
      for (let j = 0; j < pts.length; j++) if (j !== i) nd = Math.min(nd, V.dist(pts[i].P, pts[j].P));
      pts[i].nd = isFinite(nd) ? nd : spacing;
    }

    const ledSize = RF.Source.extentSize(src) || 1;
    const spotDes = (settings.spotCells || 0) * cellW;
    let aims = [], fluxSolve = !!settings.fluxSolve;
    // facet max patch (envelope-aware) and capture factors, computed with ah0 normal approx
    for (let i = 0; i < pts.length; i++) {
      let h = fill * pts[i].nd * 0.5 / Math.SQRT2;
      for (let it = 0; it < 10; it++) {
        const sh = V.norm(V.sub(S, pts[i].P)), ah = V.norm(V.sub(T.C, pts[i].P));
        const n = V.norm(V.add(sh, ah)), b = V.basis(n);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => V.add(pts[i].P, V.add(V.mul(b[0], sx * h), V.mul(b[1], sy * h))));
        if (corners.every(p => Geo.envInside(input.envelope, p, -0.001))) break;
        h *= 0.85;
      }
      pts[i].hMax = h;
      const sh = V.norm(V.sub(S, pts[i].P)), ah = V.norm(V.sub(T.C, pts[i].P));
      pts[i].cA = V.dot(V.norm(V.add(sh, ah)), sh);
      let ti = 1; try { ti = RF.Source.intensity(src, pts[i].theta); } catch (e) {}
      pts[i].fluxPerArea = rho * (src.power * ti / Math.max(1e-9, RF.Source.totalIntegral(src))) * pts[i].cA / (pts[i].r * pts[i].r); // lm per mm2 patch area
      pts[i].fluxMax = pts[i].fluxPerArea * (2 * h) * (2 * h);
    }
    if (fluxSolve) {
      // grid aims over paint support
      let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity, nPaint = 0;
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if ((paint[j * R + i] || 0) > 0) { nPaint++; const [u, v] = RF.Engine.cellCenter(T, i, j); uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v); }
      if (!nPaint) return { surfaces: [], intent: [], notes: ['no paint'] };
      let step = Math.sqrt(((uMax - uMin + cellW) * (vMax - vMin + cellW)) / pts.length);
      for (let iter = 0; iter < 6; iter++) {
        aims = [];
        for (let u = uMin - cellW * 0.5; u <= uMax + cellW * 0.5; u += step) for (let v = vMin - cellW * 0.5; v <= vMax + cellW * 0.5; v += step) {
          const i = Math.floor((u + T.half) / cellW), j = Math.floor((v + T.half) / cellW);
          if (i < 0 || j < 0 || i >= R || j >= R) continue;
          const w = paint[j * R + i] || 0; if (w > 0) aims.push({ u, v, cell: j * R + i, w });
        }
        if (!aims.length) break;
        step *= Math.sqrt(aims.length / pts.length);
        if (Math.abs(aims.length - pts.length) <= Math.max(2, pts.length * 0.05)) break;
      }
      if (aims.length > pts.length) { aims.sort((a, b) => (a.v - b.v) || (a.u - b.u)); const st = aims.length / pts.length, th = []; for (let i = 0; i < pts.length; i++) th.push(aims[Math.floor(i * st)]); aims = th; }
      // pair facets to aims by fluxMax (small cap -> dim aim) to help NNLS stay within caps
      const oF = pts.map((p, i) => i).sort((a, b) => pts[a].fluxMax - pts[b].fluxMax);
      const oA = aims.map((a, i) => i).sort((a, b) => aims[a].w - aims[b].w);
      const paired = new Array(pts.length);
      for (let k = 0; k < Math.min(oF.length, oA.length); k++) paired[oF[k]] = aims[oA[k]];
      aims = paired;
      // desired spot width per facet: max(natural, spotDes, aim step*1.0)
      const aimStep = step;
      for (let i = 0; i < pts.length; i++) {
        const Dt = V.dist(pts[i].P, RF.Engine.targetUVtoWorld(T, aims[i].u, aims[i].v));
        pts[i].Dt = Dt; pts[i].Snat = ledSize * Dt / pts[i].r;
        pts[i].Sdes = Math.max(pts[i].Snat, spotDes, aimStep * 1.05);
        pts[i].sigma = Math.max(1e-6, pts[i].Sdes / 3.464); // box width -> gaussian sigma (S/sqrt12, *? use /3.464 for std)
      }
      // cells involved: paint cells + gap cells within 3 sigma of any aim (approx: dilate by max radius in cells)
      const Rcell = Math.ceil(Math.max(...pts.map(p => p.sigma)) * 3 / cellW) + 1;
      const cellIdx = new Int32Array(R * R).fill(-1); const cellList = []; // local index -> global cell, weight, desired
      const wGap = settings.gapWeight != null ? settings.gapWeight : 0.6;
      // mark paint and near cells via aims' neighbourhood
      const near = new Uint8Array(R * R);
      for (const a of aims) { const ci = a.cell % R, cj = (a.cell / R) | 0; for (let dj = -Rcell; dj <= Rcell; dj++) for (let di = -Rcell; di <= Rcell; di++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < R && jj < R) near[jj * R + ii] = 1; } }
      // also include all paint cells (in case an aim is far)
      for (let k = 0; k < R * R; k++) if ((paint[k] || 0) > 0) near[k] = 1;
      for (let k = 0; k < R * R; k++) if (near[k]) { cellIdx[k] = cellList.length; cellList.push(k); }
      const nC = cellList.length;
      const des = new Float64Array(nC), wt = new Float64Array(nC);
      let totDesFlux = 0;
      for (let q = 0; q < nC; q++) { const k = cellList[q]; des[q] = paint[k] || 0; wt[q] = (paint[k] > 0) ? 1 : wGap; }
      // scale desired so total flux matches available (0.9 * sum fluxMax, but not exceeding paint-weighted need)
      const sumMax = pts.reduce((s, p) => s + p.fluxMax, 0);
      const sumDesW = des.reduce((s, x) => s + x, 0) * cellW * cellW; // desired flux = scale_E * sumDesW ; E_des = scale_E * paint, flux = E * area
      const scaleE = sumDesW > 0 ? (0.9 * sumMax) / sumDesW : 0;
      for (let q = 0; q < nC; q++) des[q] *= scaleE;
      // sparse kernel per facet
      const kernels = [];
      for (let i = 0; i < pts.length; i++) {
        const a = aims[i], sig = pts[i].sigma, rad = Math.ceil(sig * 3 / cellW) + 1;
        const ci = Math.floor((a.u + T.half) / cellW), cj = Math.floor((a.v + T.half) / cellW);
        const list = [];
        for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
          const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= R || jj >= R) continue;
          const q = cellIdx[jj * R + ii]; if (q < 0) continue;
          const [cu, cv] = RF.Engine.cellCenter(T, ii, jj);
          const du = cu - a.u, dv = cv - a.v, d2 = du * du + dv * dv;
          if (d2 > 9 * sig * sig) continue;
          list.push([q, Math.exp(-d2 / (2 * sig * sig)) / (2 * Math.PI * sig * sig)]);
        }
        kernels.push(list);
      }
      let flux = pts.map(p => Math.min(p.fluxMax, 0.5 * p.fluxMax + 0.5 * (sumMax / pts.length)));
      // actually start at fluxMax * 0.7 to be near feasible
      flux = pts.map(p => 0.7 * p.fluxMax);
      const pred = new Float64Array(nC);
      const denom = new Float64Array(pts.length);
      for (let i = 0; i < pts.length; i++) denom[i] = kernels[i].reduce((s, [q, kv]) => s + kv * wt[q], 0) + 1e-30;
      for (let it = 0; it < 60; it++) {
        pred.fill(0);
        for (let i = 0; i < pts.length; i++) { const f = flux[i]; if (!f) continue; for (const [q, kv] of kernels[i]) pred[q] += f * kv; }
        for (let i = 0; i < pts.length; i++) {
          let num = 0; for (const [q, kv] of kernels[i]) { const pr = pred[q] + 1e-30; num += kv * wt[q] * (des[q] / pr); }
          let nf = flux[i] * num / denom[i];
          if (!isFinite(nf)) nf = flux[i];
          flux[i] = Math.max(0, Math.min(pts[i].fluxMax, nf));
        }
      }
      for (let i = 0; i < pts.length; i++) pts[i].flux = flux[i];
      notes.push('fluxSolve aims ' + aims.length + ' cells ' + nC + ' scaleE ' + scaleE.toFixed(5));
    } else {
      // ---- aims by paint cumulative (legacy)
      const cum = new Float64Array(R * R + 1); let tot = 0;
      for (let k = 0; k < R * R; k++) { tot += Math.max(0, paint[k] || 0); cum[k + 1] = tot; }
      if (tot > 0) {
        let ptr = 0;
        for (let m = 0; m < pts.length; m++) {
          const q = (m + 0.5) / pts.length * tot;
          while (ptr < R * R && cum[ptr + 1] < q) ptr++;
          const cell = Math.min(R * R - 1, ptr);
          const i = cell % R, j = (cell / R) | 0;
          const uv = RF.Engine.cellCenter(T, i, j);
          const h1 = (((cell * 2654435761) >>> 0) % 1000) / 1000, h2 = (((cell * 40503 + 12345) >>> 0) % 1000) / 1000;
          aims.push({ u: uv[0] + (h1 - 0.5) * cellW * 0.5, v: uv[1] + (h2 - 0.5) * cellW * 0.5, cell });
        }
      }
      const rng = new RF.rng.Rng((input.seed | 0) ^ 0x9e3779b9);
      for (let i = aims.length - 1; i > 0; i--) { const j = (rng.next() * (i + 1)) | 0; const t = aims[i]; aims[i] = aims[j]; aims[j] = t; }
    }

    const surfaces = [], intent = [];
    for (let idx = 0; idx < pts.length; idx++) {
      const f = pts[idx], aim = aims[idx] || { u: 0, v: 0, cell: 0 };
      const Z = RF.Engine.targetUVtoWorld(T, aim.u, aim.v);
      let P = f.P.slice();
      let h = f.hMax || (fill * f.nd * 0.5 / Math.SQRT2);
      if (fluxSolve && f.flux != null && f.fluxPerArea > 0) {
        const Aneed = f.flux / f.fluxPerArea;
        h = Math.min(h, Math.sqrt(Math.max(0.01, Aneed)) / 2);
        h = Math.max(h, 0.25);
      }
      let ok = false, pts3 = null;
      for (let iter = 0; iter < 16; iter++) {
        const sh = V.norm(V.sub(S, P)), ah = V.norm(V.sub(Z, P));
        let n = V.norm(V.add(sh, ah));
        const basis = V.basis(n), ex = basis[0], ey = basis[1];
        pts3 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => V.add(P, V.add(V.mul(ex, sx * h), V.mul(ey, sy * h))));
        ok = pts3.every(p => Geo.envInside(input.envelope, p, -0.001)) && pts3.every(p => V.dist(p, S) >= keep * (1 - 1e-6));
        if (ok) break;
        if (iter < 8) h *= 0.85;
        else { P = V.add(P, V.mul(V.norm(V.sub(S, P)), 1.0)); h *= 0.9; }
      }
      if (!ok && pts3.some(p => !Geo.envInside(input.envelope, p, 0))) { notes.push('facet ' + idx + ' dropped envelope'); continue; }
      const id = 'F' + idx;
      let di = V.dist(P, Z);
      const Sdes = fluxSolve && f.Sdes ? f.Sdes : spotDes;
      if (Sdes > 0) {
        const Snat = ledSize * di / f.r;
        if (Sdes > Snat * 1.1) {
          const B = Sdes - Snat, W = Math.max(0.5, 2 * h);
          di = Math.max(5, di / (1 + B / W));
        }
      }
      surfaces.push({ type: 'facet', id, P, S0: S.slice(), Z, di, flat: false,
        clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: rho, twoSided: false } });
      intent.push({ facet: id, cells: [[aim.cell, 1]] });
    }
    notes.push('placed ' + surfaces.length + ' / ' + maxF);
    // ---- exit shield to block direct light: plane perp to ah0 at envelope exit along ah0
    if (settings.shield && surfaces.length) {
      try {
        const iv = Geo.envInterval(input.envelope, S, ah0);
        const Dexit = iv[1] - 1.0;
        const keepHard = input.envelope.keepOut || 0;
        if (Dexit > keepHard + 3) {
          const E0 = V.add(S, V.mul(ah0, Dexit));
          const sb = V.basis(ah0), se1 = sb[0], se2 = sb[1];
          const toPlane = (W) => { const d = V.sub(W, S); const dt = V.dot(d, ah0); if (dt <= 1e-6) return null; const t = Dexit / dt; const P = V.add(S, V.mul(d, t)); const rel = V.sub(P, E0); return [V.dot(rel, se1), V.dot(rel, se2), P]; };
          // direct footprint: sample target points that actually emit toward the exit plane
          let dlo = [Infinity, Infinity], dhi = [-Infinity, -Infinity];
          for (let gu = 0; gu <= 16; gu++) for (let gv = 0; gv <= 16; gv++) {
            const cu = -T.half + (gu / 16) * 2 * T.half, cv = -T.half + (gv / 16) * 2 * T.half;
            const W = RF.Engine.targetUVtoWorld(T, cu, cv);
            const dv = V.sub(W, S), rr = V.len(dv), dir = V.mul(dv, 1 / rr);
            const cosT = V.dot(dir, ax); if (cosT <= 0.02) continue;
            const iv2 = Geo.envInterval(input.envelope, S, dir); if (!(iv2[1] > 0)) continue;
            const exitP = V.add(S, V.mul(dir, iv2[1]));
            if (Math.abs(V.dot(V.sub(exitP, E0), ah0)) > 2.5) continue;  // exits another face
            const rel = V.sub(exitP, E0); const p = [V.dot(rel, se1), V.dot(rel, se2)];
            dlo[0] = Math.min(dlo[0], p[0]); dlo[1] = Math.min(dlo[1], p[1]); dhi[0] = Math.max(dhi[0], p[0]); dhi[1] = Math.max(dhi[1], p[1]);
          }
          if (!isFinite(dlo[0])) { notes.push('shield: no direct footprint'); return { surfaces, intent, notes }; }
          // reflected exit points
          const rpts = [];
          for (const s of surfaces) { const p = toPlane(s.Z); if (!p) continue; const d2 = V.sub(s.Z, s.P); const denom = V.dot(d2, ah0); if (Math.abs(denom) < 1e-9) continue; const t = (Dexit - V.dot(V.sub(s.P, S), ah0)) / denom; if (t < 0 || t > 1) continue; const P = V.add(s.P, V.mul(d2, t)); const rel = V.sub(P, E0); rpts.push([V.dot(rel, se1), V.dot(rel, se2)]); }
          // expand direct box a little, but clamp to avoid reflected points if they are offset to one side
          const m = 1.5;
          let lo = [dlo[0] - m, dlo[1] - m], hi = [dhi[0] + m, dhi[1] + m];
          const inside = rpts.filter(p => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1]).length;
          notes.push('shield direct box ' + lo.map(x => x.toFixed(1)) + ' ' + hi.map(x => x.toFixed(1)) + ' reflected inside ' + inside + '/' + rpts.length);
          if (inside <= rpts.length * 0.25) {
            let corners = null;
            for (let shrink = 0; shrink < 8; shrink++) {
              corners = [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]].map(([a, b]) => V.add(E0, V.add(V.mul(se1, a), V.mul(se2, b))));
              if (corners.every(p => Geo.envInside(input.envelope, p, -0.001)) && corners.every(p => V.dist(p, S) >= keepHard)) break;
              const c0 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; lo = [c0[0] + (lo[0] - c0[0]) * 0.8, c0[1] + (lo[1] - c0[1]) * 0.8]; hi = [c0[0] + (hi[0] - c0[0]) * 0.8, c0[1] + (hi[1] - c0[1]) * 0.8]; corners = null;
            }
            if (corners) {
              surfaces.push({ type: 'plane', id: 'SHIELD', P: E0.slice(), n: V.mul(ah0, -1), clip: { kind: 'poly', pts3: corners }, optics: { interaction: 'absorb', reflectivity: 0, twoSided: true } });
              notes.push('shield placed');
            } else notes.push('shield corners outside envelope/keepout');
          }
        }
      } catch (e) { notes.push('shield failed ' + e.message); }
    }
    return { surfaces, intent, notes };
  },
});
/* Optional tuner: tries a few static settings, traces each with the same seed, picks best per goal. */
RF.Solvers.register({
  id: 'bench-museember-r2--paint-static-auto', name: 'Paint static (auto tuner)', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  async solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-museember-r2--paint-static');
    const defs = RF.Solvers.defaults(base);
    const candidates = [
      {},
      { spotCells: 3 },
      { spotCells: 7 },
      { spotCells: 10 },
      { facetFill: 0.7 },
      { thetaMax: 55 },
    ];
    let best = null;
    const goal = settings.goal || 'faithful';
    for (let ci = 0; ci < candidates.length; ci++) {
      const candSettings = Object.assign({}, defs, candidates[ci], { minDistance: settings.minDistance || 0 });
      let out;
      try { out = base.solve(input, candSettings, tools); } catch (e) { continue; }
      if (!out || !out.surfaces || !out.surfaces.length) continue;
      let score = -1, fid = null;
      try {
        const tr = tools.trace(out.surfaces, { rays: 300000, seed: input.seed | 0 });
        fid = tr.fidelity;
        if (fid) {
          if (goal === 'throw') score = fid.fidelity * (0.6 + 0.4 * Math.min(2, (fid.onPaint || 0) / 0.08));
          else if (goal === 'efficient') score = fid.fidelity * (0.7 + 0.3 * Math.min(2, (fid.onPaint || 0) / 0.08)) + 0.1 * Math.min(1, (tr.peakCd || 0) / 50000);
          else score = fid.fidelity;
        }
      } catch (e) { score = -1; }
      if (tools.preview) { try { tools.preview(out.surfaces, { label: 'candidate ' + (ci + 1) + '/' + candidates.length }); } catch (e) {} }
      if (score > (best ? best.score : -1)) best = { out, score, ci, fid };
    }
    if (!best) { const out = base.solve(input, Object.assign({}, defs, { minDistance: settings.minDistance || 0 }), tools); return { surfaces: out.surfaces, intent: out.intent, notes: (out.notes || []).concat(['tuner: no traced candidate, used defaults']) }; }
    best.out.notes = (best.out.notes || []).concat(['tuner goal=' + goal + ' picked candidate ' + best.ci + ' score ' + best.score.toFixed(3) + (best.fid ? ' fidelity ' + best.fid.fidelity.toFixed(3) : '')]);
    return best.out;
  },
});
