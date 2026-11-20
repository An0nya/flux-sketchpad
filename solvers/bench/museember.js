/* Shell-tiling paint solver.
 * Facets are placed on the envelope boundary in the LED emission cone (direction tiling),
 * each curved to image the LED onto its assigned target spot. Spots are assigned greedily
 * against the painting using an analytic spot model (no ray tracing).
 */
const SHELL_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'thetaMax', label: 'Max cone angle (deg)', type: 'range', min: 30, max: 90, step: 1, default: 84 },
    { key: 'fill', label: 'Facet fill factor', type: 'range', min: 0.4, max: 1.0, step: 0.05, default: 0.92 },
    { key: 'gapWeight', label: 'Gap penalty weight', type: 'range', min: 0, max: 4, step: 0.1, default: 2.0 },
    { key: 'spotScale', label: 'Spot size scale (assignment)', type: 'range', min: 0.5, max: 2.5, step: 0.05, default: 1.0 },
    { key: 'desiredBlur', label: 'Desired blur (x spot width)', type: 'range', min: 0, max: 1.5, step: 0.1, default: 0.0 },
    { key: 'oversample', label: 'Candidate oversample', type: 'range', min: 1, max: 5, step: 1, default: 3 },
    { key: 'spotFill', label: 'Target spot fill factor', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1.9 },
    { key: 'defocus', label: 'Defocus to reach target spot', type: 'checkbox', default: true },
    { key: 'upstreamOnly', label: 'Facets on upstream wall only', type: 'checkbox', default: true },
    { key: 'minIntensity', label: 'Min LED intensity (x peak)', type: 'range', min: 0, max: 0.5, step: 0.02, default: 0.08 },
    { key: 'passes', label: 'Refinement passes', type: 'range', min: 0, max: 6, step: 1, default: 3 },
    { key: 'maxDefocus', label: 'Max defocus blur (x image size)', type: 'range', min: 0, max: 6, step: 0.25, default: 3.0 },
  ];
function buildShell(input, settings) {
    const V = RF.V;
    const src = input.source, env = input.envelope, target = input.target;
    const maxFacets = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const sources = (input.sources && input.sources.length ? input.sources : [src]).map(s => s.pos);
    const S = src.pos.slice();
    const T = RF.Engine.designFrame(target);
    const R = input.paint.res, paint = input.paint.cells;
    const cellSize = 2 * T.half / R;
    const cellArea = cellSize * cellSize;
    const notes = [];

    const fr = RF.Source.frame(src);
    const thetaLimDeg = Math.min(settings.thetaMax, RF.Source.thetaMax(src) * 180 / Math.PI);
    const thetaLim = thetaLimDeg * Math.PI / 180;
    const cosLim = Math.cos(thetaLim);
    const I0 = RF.Source.intensity(src, 0.001) || 1;
    const totInt = RF.Source.totalIntegral(src) || 1;
    const ledArea = RF.Source.emittingArea(src) || 1;
    const planar = src.kind === 'planar';
    const targetDir = V.norm(V.sub(T.C, S));

    // ---- paint statistics -> target spot diameter
    const nz = [];
    let sumPaint0 = 0;
    for (let k = 0; k < paint.length; k++) { if (paint[k] > 0) { nz.push(paint[k]); sumPaint0 += paint[k]; } }
    nz.sort((a, b) => a - b);
    const pMed = nz.length ? nz[nz.length >> 1] : 1;
    const aEquiv = sumPaint0 / Math.max(pMed, 1e-9) * cellArea;   // area at median level
    const dDes = settings.spotFill * Math.sqrt(Math.max(aEquiv, cellArea) / Math.max(1, maxFacets));
    notes.push('pMed ' + pMed.toFixed(3) + ' aEquiv ' + aEquiv.toFixed(0) + ' dDes ' + dDes.toFixed(1) + 'mm');

    // ---- candidate generation
    let useFaceGrid = settings.upstreamOnly;   // ray-cast grid over the upstream envelope surface (any shape)
    const M = Math.max(maxFacets, Math.round(maxFacets * settings.oversample));
    const golden = Math.PI * (3 - Math.sqrt(5));
    const cands = [];
    const outwardNormal = (Q) => {
      const c = env.center, h = env.half, d = [Q[0]-c[0], Q[1]-c[1], Q[2]-c[2]];
      if (env.shape === 'box') {
        let ax = 0, best = -1;
        for (let i = 0; i < 3; i++) { const v = Math.abs(d[i]/h[i]); if (v > best) { best = v; ax = i; } }
        const n = [0,0,0]; n[ax] = d[ax] >= 0 ? 1 : -1; return n;
      }
      if (env.shape === 'ellipsoid') return V.norm([d[0]/(h[0]*h[0]), d[1]/(h[1]*h[1]), d[2]/(h[2]*h[2])]);
      const ax = env.axis === undefined ? 2 : env.axis;
      if (Math.abs(d[ax]/h[ax]) > 0.999) { const n=[0,0,0]; n[ax]=d[ax]>=0?1:-1; return n; }
      const i=(ax+1)%3, j=(ax+2)%3, n=[0,0,0]; n[i]=d[i]/(h[i]*h[i]); n[j]=d[j]/(h[j]*h[j]); return V.norm(n);
    };
    const makeCand = (Q) => {
      const sv = V.sub(Q, S); const r = V.len(sv); if (!(r > keep + 4)) return;
      const u = V.mul(sv, 1 / r);
      const cosT = Math.max(-1, Math.min(1, V.dot(u, fr.a)));
      const theta = Math.acos(cosT);
      const Irel = RF.Source.intensity(src, theta);
      if (!(Irel > settings.minIntensity * I0)) return;
      const nOut = outwardNormal(Q);
      const upDot = V.dot(nOut, targetDir);
      if (upDot > 0.55) return;
      const upstream = upDot < -0.35;
      const aC = V.norm(V.sub(T.C, Q));
      const sh = V.mul(u, -1);   // facet -> source
      const bis = V.add(sh, aC); const bl = V.len(bis); if (!(bl > 1e-9)) return;
      const nrm = V.mul(bis, 1 / bl);
      const cosInc = V.dot(nrm, sh);   // projected-area factor toward the LED
      if (cosInc < 0.22) return;
      const projA = ledArea * (planar ? Math.max(0.05, cosT) : 1);
      const Dc = V.dist(Q, T.C);
      const spotArea = projA * (Dc / r) * (Dc / r) / Math.max(0.25, Math.abs(V.dot(aC, T.n)));
      const dImg = Math.sqrt(Math.max(spotArea, 1e-9));
      const dEff = settings.defocus ? Math.min(Math.max(dImg, dDes), dImg * (1 + settings.maxDefocus)) : dImg;
      const brightness = Irel * cosInc / (dEff * dEff);
      cands.push({ u, Q, r, cosT, Irel, cosInc, spotArea, brightness, Dc, theta, upstream, nOut });
    };
    if (useFaceGrid) {
      // ray-cast grid over the upstream envelope surface: rays along targetDir from far upstream
      const [ea, eb] = V.basis(targetDir);
      const projExt = (e) => 2 * (env.half[0] * Math.abs(e[0]) + env.half[1] * Math.abs(e[1]) + env.half[2] * Math.abs(e[2]));
      const extA = projExt(ea), extB = projExt(eb);
      const totGrid = Math.round(maxFacets * 1.35);
      const n1 = Math.max(2, Math.round(Math.sqrt(totGrid * extA / Math.max(extB, 1e-9))));
      const n2 = Math.max(2, Math.round(totGrid / n1));
      const Dbig = 3 * Math.max(...env.half) + 10;
      for (let a = 0; a < n1; a++) for (let b = 0; b < n2; b++) {
        const oa = (a + 0.5) / n1 * extA - extA / 2, ob = (b + 0.5) / n2 * extB - extB / 2;
        const O = V.add(env.center, V.add(V.add(V.mul(ea, oa), V.mul(eb, ob)), V.mul(targetDir, -Dbig)));
        const interval = RF.Geo.envInterval(env, O, targetDir);
        if (!(interval[0] >= 0)) continue;
        const Q = V.add(O, V.mul(targetDir, interval[0]));
        const before = cands.length; makeCand(Q);
        if (cands.length > before) { cands[cands.length - 1].ga = a; cands[cands.length - 1].gb = b; }
      }
      notes.push('upstream grid ' + n1 + 'x' + n2);
    } else {
      for (let i = 0; i < M; i++) {
        const cosT = 1 - (1 - cosLim) * (i + 0.5) / M;
        const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
        const phi = i * golden;
        const u = V.add(V.mul(fr.a, cosT), V.mul(V.add(V.mul(fr.u, Math.cos(phi)), V.mul(fr.v, Math.sin(phi))), sinT));
        const interval = RF.Geo.envInterval(env, S, u);
        if (!(interval[1] > 0)) continue;
        makeCand(V.add(S, V.mul(u, interval[1])));
      }
    }
    if (useFaceGrid && cands.length < Math.max(10, maxFacets * 0.35)) {
      notes.push('upstream candidates too few (' + cands.length + '): adding direction candidates');
      useFaceGrid = false;
      for (let i = 0; i < M; i++) {
        const cosT = 1 - (1 - cosLim) * (i + 0.5) / M;
        const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
        const phi = i * golden;
        const u = V.add(V.mul(fr.a, cosT), V.mul(V.add(V.mul(fr.u, Math.cos(phi)), V.mul(fr.v, Math.sin(phi))), sinT));
        const interval = RF.Geo.envInterval(env, S, u);
        if (!(interval[1] > 0)) continue;
        makeCand(V.add(S, V.mul(u, interval[1])));
      }
    }
    notes.push('candidates ' + cands.length + ' / ' + M);

    // ---- greedy selection by brightness with angular separation
    if (settings.upstreamOnly) {
      const up = cands.filter(c => c.upstream);
      if (up.length >= maxFacets) { notes.push('upstream pool ' + up.length); cands.splice(0, cands.length, ...up); }
      else notes.push('upstream pool only ' + up.length + ' < ' + maxFacets + ': using all walls');
    }
    cands.sort((a, b) => b.brightness - a.brightness);
    const omega = 2 * Math.PI * (1 - cosLim);
    const minSep = Math.sqrt(omega / maxFacets);
    if (useFaceGrid && cands.length >= 10) {
      const A = [...new Set(cands.map(c => c.ga))].sort((x, y) => x - y);
      const B = [...new Set(cands.map(c => c.gb))].sort((x, y) => x - y);
      const na = Math.max(1, Math.min(A.length, Math.round(Math.sqrt(maxFacets * A.length / Math.max(1, B.length)))));
      const nb = Math.max(1, Math.min(B.length, Math.round(maxFacets / Math.max(1, na))));
      const pick = (arr, n) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(arr[Math.round(i * (arr.length - 1) / Math.max(1, n - 1))]); return s; };
      const pA = pick(A, na), pB = pick(B, nb);
      var selected = cands.filter(c => pA.has(c.ga) && pB.has(c.gb));
      notes.push('face subsample ' + na + 'x' + nb + ' -> ' + selected.length);
    } else {
    // spatial separation threshold: largest that still yields >= maxFacets points (greedy by brightness, then truncate)
    const nnList = [];
    for (const c of cands) { let nn = Infinity; for (const o of cands) if (o !== c) nn = Math.min(nn, V.dist(c.Q, o.Q)); if (isFinite(nn)) nnList.push(nn); }
    nnList.sort((a, b) => a - b);
    const nnMed = nnList.length ? nnList[nnList.length >> 1] : 1;
    const greedy = (thr) => { const sel = []; for (const c of cands) { let ok = true; for (const s of sel) if (V.dist(c.Q, s.Q) < thr) { ok = false; break; } if (ok) sel.push(c); } return sel; };
    selected = []; let bestScore = Infinity;
    for (const f of [3.2, 2.6, 2.1, 1.7, 1.4, 1.15, 1.0, 0.85, 0.7, 0.55, 0.4, 0.25]) {
      const sel = greedy(nnMed * f);
      const score = Math.abs(sel.length - maxFacets) + (sel.length > maxFacets ? 1000 : 0);
      if (score < bestScore) { bestScore = score; selected = sel; }
    }
    if (selected.length > maxFacets) selected = selected.slice(0, maxFacets);
    }
    if (!selected.length) { notes.push('no candidates'); return { surfaces: [], intent: [], notes }; }

    // facet half-sides from nearest-neighbour spacing
    for (const c of selected) {
      let nn = Infinity;
      for (const o of selected) if (o !== c) nn = Math.min(nn, V.dist(c.Q, o.Q));
      if (!isFinite(nn)) nn = c.r * minSep;
      c.half0 = Math.max(0.8, 0.5 * nn * settings.fill);
      c.area = 4 * c.half0 * c.half0;
      c.flux = (src.power || 0) * (c.Irel / totInt) * (c.area * c.cosInc / (c.r * c.r)) * refl;
      c.dImg = Math.sqrt(Math.max(c.spotArea, 1e-9));
      c.dEff = settings.defocus ? Math.min(Math.max(c.dImg, dDes), c.dImg * (1 + settings.maxDefocus)) : c.dImg;
      c.spotCells = Math.max(1, (c.dEff * c.dEff) / cellArea);
      c.w = Math.max(1, Math.round(Math.sqrt(c.spotCells) * settings.spotScale));
      c.spotCells = c.w * c.w;   // quantized square spot: model area matches footprint exactly
      c.dEffQ = c.w * cellSize;
      c.eCell = c.flux / c.spotCells;
    }

    // ---- desired delivered energy per paint cell
    let sumPaint = 0; for (let k = 0; k < paint.length; k++) sumPaint += paint[k];
    let totFlux = 0; for (const c of selected) totFlux += c.flux;
    let desired = new Float64Array(R * R);
    if (settings.desiredBlur > 0.01 && RF.Photometry && RF.Photometry.boxBlur) {
      const avgW = Math.max(1, selected.reduce((s, c) => s + c.w, 0) / selected.length);
      desired = RF.Photometry.boxBlur(paint, R, Math.max(0.5, avgW * settings.desiredBlur));
      let sd = 0; for (let k = 0; k < desired.length; k++) sd += desired[k];
      if (sd > 0) for (let k = 0; k < desired.length; k++) desired[k] *= (totFlux / sd);
    } else if (sumPaint > 0) {
      for (let k = 0; k < paint.length; k++) desired[k] = paint[k] * totFlux / sumPaint;
    }

    // ---- greedy aim assignment (brightest facets first)
    const delivered = new Float64Array(R * R);
    const order = selected.slice().sort((a, b) => b.eCell - a.eCell);
    const paintedIdx = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (paint[j * R + i] > 0) paintedIdx.push([i, j]);
    const wtArr = new Float64Array(R * R);
    for (let k = 0; k < R * R; k++) wtArr[k] = paint[k] > 0 ? 1 : settings.gapWeight;
    const I1 = new Float64Array((R + 1) * (R + 1)), Iw = new Float64Array((R + 1) * (R + 1));
    const addFoot = (c, sign) => {
      if (!c.aimIJ) return;
      const w = c.w, hw = Math.floor(w / 2), e = c.eCell, [ci, cj] = c.aimIJ;
      for (let jj = cj - hw; jj <= cj - hw + w - 1; jj++) {
        if (jj < 0 || jj >= R) continue;
        for (let ii = ci - hw; ii <= ci - hw + w - 1; ii++) {
          if (ii < 0 || ii >= R) continue;
          delivered[jj * R + ii] += sign * e;
        }
      }
    };
    const bestAim = (c) => {
      const w = c.w, hw = Math.floor(w / 2), e = c.eCell;
      for (let j = 0; j <= R; j++) { I1[j * (R + 1)] = 0; Iw[j * (R + 1)] = 0; }
      for (let i = 0; i <= R; i++) { I1[i] = 0; Iw[i] = 0; }
      for (let j = 0; j < R; j++) {
        let s1 = 0, sw = 0;
        for (let i = 0; i < R; i++) {
          const k = j * R + i, wt = wtArr[k];
          s1 += wt * (desired[k] - delivered[k]); sw += wt;
          I1[(j + 1) * (R + 1) + i + 1] = I1[j * (R + 1) + i + 1] + s1;
          Iw[(j + 1) * (R + 1) + i + 1] = Iw[j * (R + 1) + i + 1] + sw;
        }
      }
      const boxSum = (I, i0, j0, i1, j1) => I[j1 * (R + 1) + i1] - I[j0 * (R + 1) + i1] - I[j1 * (R + 1) + i0] + I[j0 * (R + 1) + i0];
      let best = -Infinity, bestIJ = null;
      for (const [i, j] of paintedIdx) {
        const i0 = Math.max(0, i - hw), j0 = Math.max(0, j - hw), i1 = Math.min(R, i - hw + w), j1 = Math.min(R, j - hw + w);
        const gain = 2 * e * boxSum(I1, i0, j0, i1, j1) - e * e * boxSum(Iw, i0, j0, i1, j1);
        if (gain > best) { best = gain; bestIJ = [i, j]; }
      }
      if (!bestIJ) { let bi = 0; for (let k = 0; k < paint.length; k++) if (paint[k] > paint[bi]) bi = k; bestIJ = [bi % R, (bi / R) | 0]; }
      return bestIJ;
    };
    for (const c of order) { c.aimIJ = bestAim(c); addFoot(c, 1); }
    for (let p = 0; p < (settings.passes | 0); p++) {
      for (const c of order) { addFoot(c, -1); c.aimIJ = bestAim(c); addFoot(c, 1); }
    }
    for (const c of selected) {
      c.intentCells = [];
      if (!c.aimIJ) continue;
      const w = c.w, hw = Math.floor(w / 2), [ci, cj] = c.aimIJ;
      for (let jj = cj - hw; jj <= cj - hw + w - 1; jj++) {
        if (jj < 0 || jj >= R) continue;
        for (let ii = ci - hw; ii <= ci - hw + w - 1; ii++) {
          if (ii < 0 || ii >= R) continue;
          c.intentCells.push([jj * R + ii, c.eCell]);
        }
      }
    }

    // ---- build surfaces (shrink/inset until inside envelope & clearance)
    const surfaces = [], intent = [];
    const envC = env.center;
    const inside = (p) => RF.Geo.envInside(env, p, 0);
    for (const c of selected) {
      const [ci, cj] = c.aimIJ;
      const uv = RF.Engine.cellCenter(T, ci, cj);
      const Z = RF.Engine.targetUVtoWorld(T, uv[0], uv[1]);
      const inward = c.nOut ? V.mul(c.nOut, -1) : V.norm(V.sub(envC, c.Q));
      let placed = false;
      for (let attempt = 0; attempt < 7 && !placed; attempt++) {
        const half = c.half0 * Math.pow(0.72, attempt);
        const inset = half * 1.4 + 1.5 + attempt * 0.5;
        const P = V.add(c.Q, V.mul(inward, inset));
        const sh = V.norm(V.sub(S, P)); const ah = V.norm(V.sub(Z, P));
        const bis = V.add(sh, ah); if (V.len(bis) < 1e-9) continue;
        const n = V.norm(bis);
        const [e1, e2] = V.basis(n);
        const corners = [];
        for (const [a, b] of [[1,1],[1,-1],[-1,-1],[-1,1]])
          corners.push(V.add(P, V.add(V.mul(e1, a * half), V.mul(e2, b * half))));
        if (!corners.every(inside)) continue;
        if (!inside(P)) continue;
        let badClear = false;
        for (const sp of sources) {
          for (const p of corners.concat([P])) if (V.dist(p, sp) < keep * (1 - 1e-6)) { badClear = true; break; }
        }
        if (badClear) continue;
        const id = 'F' + surfaces.length;
        const Dd = V.dist(P, Z);
        let di = Dd;
        if (settings.defocus && c.dEffQ > c.dImg) {
          const blur = c.dEffQ - c.dImg, W = Math.max(2 * half, 1e-6);
          di = Math.max(15, Dd / (1 + blur / W));
        }
        surfaces.push({ type: 'facet', id, group: 'A', P, S0: S.slice(), Z, di, flat: false,
          clip: { kind: 'poly', pts3: corners },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } });
        intent.push({ facet: id, cells: c.intentCells });
        placed = true;
      }
      if (!placed) intent.push({ facet: null, cells: c.intentCells || [] });
      if (surfaces.length >= maxFacets) break;
    }
    notes.push('placed ' + surfaces.length + ' facets; totFlux est ' + totFlux.toFixed(1) + ' lm of ' + (src.power || 0));
    return { surfaces, intent, notes };
}

RF.Solvers.register({
  id: 'bench-museember--shell-paint', name: 'Shell paint', version: '1.0', modes: ['paint'],
  settings: SHELL_SETTINGS,
  solve(input, settings) { return buildShell(input, settings); },
});

/* Optional tuner (-auto): traces a small pool of static-solver settings with a
 * fixed seed (common random numbers) and returns the best for the chosen goal.
 * It does not change the static solver above. */
RF.Solvers.register({
  id: 'bench-museember--shell-paint-auto', name: 'Shell paint (auto-tuned)', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  async solve(input, settings, tools) {
    const base = {};
    for (const f of SHELL_SETTINGS) base[f.key] = f.default;
    base.minDistance = settings.minDistance || 0;
    const goal = settings.goal || 'faithful';
    const pool = [
      {},
      { spotFill: 1.6 },
      { spotFill: 2.2 },
      { gapWeight: 1.0 },
      { gapWeight: 3.0 },
      { fill: 0.80 },
      { fill: 1.00 },
      { defocus: false },
      { upstreamOnly: false },
      { spotFill: 1.3, fill: 1.00 },
    ];
    let raysPer = 200000;
    if (tools && tools.budget && tools.budget.rays && isFinite(tools.budget.rays)) {
      raysPer = Math.max(20000, Math.min(raysPer, Math.floor(tools.budget.rays / pool.length)));
    }
    const seed = (input.seed | 0) || 7;   // same seed for every candidate: differences are geometry, not noise
    const results = [];
    for (const over of pool) {
      const st = Object.assign({}, base, over);
      const out = buildShell(input, st);
      let m = { fid: 0, onPaint: 0, peakCd: 0, throwM: 0, lm: 0 };
      if (tools && typeof tools.trace === 'function' && out.surfaces.length) {
        try {
          const tr = await tools.trace(out.surfaces, { rays: raysPer, seed });
          if (tr && tr.fidelity) { m.fid = tr.fidelity.fidelity || 0; m.onPaint = tr.fidelity.onPaint || 0; }
          m.peakCd = (tr && tr.peakCd) || 0; m.throwM = (tr && tr.throwM) || 0; m.lm = (tr && tr.lmOnTarget) || 0;
        } catch (e) { /* candidate failed to trace: keep zero metrics */ }
      }
      results.push({ st, out, m });
      if (tools && typeof tools.preview === 'function') tools.preview(out.surfaces, { label: 'candidate ' + results.length + '/' + pool.length });
    }
    const maxPeak = Math.max.apply(null, results.map(r => r.m.peakCd).concat([1e-9]));
    const maxOn = Math.max.apply(null, results.map(r => r.m.onPaint).concat([1e-9]));
    const scoreOf = (r) => {
      const fid = r.m.fid, on = r.m.onPaint, pk = r.m.peakCd;
      if (goal === 'throw') return 0.50 * (pk / maxPeak) + 0.25 * (on / maxOn) + 0.25 * fid;
      if (goal === 'efficient') return fid * Math.min(1, on / 0.04) + 0.25 * (0.7 * (on / maxOn) + 0.3 * (pk / maxPeak));
      return fid * Math.min(1, on / 0.04);   // faithful: fidelity, discounted if almost no light lands on paint
    };
    let best = results[0], bestScore = -Infinity;
    for (const r of results) { const s = scoreOf(r); if (s > bestScore) { bestScore = s; best = r; } }
    const notes = (best.out.notes || []).concat([
      'auto goal=' + goal + ' rays/candidate=' + raysPer + ' seed=' + seed,
      'auto picked ' + JSON.stringify(best.st) + ' score=' + bestScore.toFixed(4) +
        ' fid=' + best.m.fid.toFixed(3) + ' onPaint=' + best.m.onPaint.toFixed(3) + ' peakCd=' + Math.round(best.m.peakCd),
      'auto candidates: ' + results.map(r => r.m.fid.toFixed(2) + '/' + r.m.onPaint.toFixed(2)).join(' '),
    ]);
    return { surfaces: best.out.surfaces, intent: best.out.intent, notes };
  },
});
