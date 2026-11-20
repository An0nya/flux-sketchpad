/* Flux solver — V3.
 * Place facets on the hemisphere BEHIND the LED (d·throwDir ≤ 0): the envelope walls facing away
 * from the target. Each facet faces the LED and reflects toward an aim point on the target. Because
 * every facet is on the −throw side, reflected beams diverge toward +throw and do not cross other
 * facets (no blocking). Facets are pushed to the envelope wall in each direction (max distance =
 * sharpest LED image) and the patch is shrunk so all corners stay inside the envelope.
 *
 * Aim points are sampled from the painted cells by weight (more facets → brighter painted regions),
 * with each facet a curved ellipsoid focusing the LED image onto its aim point. */
RF.Solvers.register({
  id: 'bench-glm52-r2--flux', name: 'Flux solver', version: '0.3', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'radius', label: 'Facet radius (mm, 0=push to wall)', type: 'number', min: 0, step: 1, default: 0 },
    { key: 'blockLim', label: 'Max d·throw (exclude +throw)', type: 'range', min: -0.6, max: 0.3, step: 0.05, default: 0.0 },
    { key: 'brightBias', label: 'Bias toward LED axis (0=uniform)', type: 'range', min: 0, max: 4, step: 0.5, default: 0 },
    { key: 'facetScale', label: 'Facet patch scale (×auto)', type: 'range', min: 0.3, max: 2.0, step: 0.05, default: 1.0 },
    { key: 'sizeByWeight', label: 'Size facets by paint weight', type: 'checkbox', default: true },
    { key: 'uniformAims', label: 'Uniform aim grid (else weighted)', type: 'checkbox', default: false },
    { key: 'targetBlur', label: 'Target image cells (0=auto)', type: 'range', min: 0, max: 20, step: 0.5, default: 5 },
    { key: 'cone', label: 'Cone around LED axis (0=off)', type: 'range', min: 0, max: 180, step: 5, default: 0 },
    { key: 'aimShrink', label: 'Shrink aims (0=auto)', type: 'range', min: 0, max: 1, step: 0.05, default: 0 },
  ],
  solve(input, settings, tools) {
    const V = RF.V, G = RF.Geo, E = RF.Engine, Src = RF.Source;
    const L = input.source.pos.slice();
    const src = input.source;
    const env = input.envelope;
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const T = E.targetFrame(input.target);
    const paint = input.paint.cells, res = input.paint.res;
    const maxF = input.limits.maxFacets, refl = input.limits.reflectivity;

    const throwDir = V.norm(V.sub(T.C, L));
    const ledAxis = V.norm(src.axis);
    const [uAx, vAx] = V.basis(ledAxis);

    // ---- painted cells → aim points (world), weighted
    const aims = []; let totalW = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const k = j * res + i, w = paint[k];
      if (w > 0) {
        const [cu, cv] = E.cellCenter(T, i, j);
        aims.push({ p: E.targetUVtoWorld(T, cu, cv), w, i, j });
        totalW += w;
      }
    }
    if (!aims.length || maxF <= 0) return { surfaces: [], intent: [], notes: ['no paint or no budget'] };

    // ---- N aim points: uniform grid over painted cells (coverage) or weighted sample (level match)
    const N = Math.max(1, maxF);
    const aimSample = [];
    if (settings.uniformAims) {
      // evenly stride through painted cells in row-major order
      const stride = aims.length / N;
      for (let s = 0; s < N; s++) {
        const a = aims[Math.min(aims.length - 1, Math.floor(s * stride))];
        const cw = 2 * T.half / res;
        const cu = -T.half + (a.i + 0.5 + (((s * 0.61803398875) % 1) - 0.5) * 0.6) * cw;
        const cv = -T.half + (a.j + 0.5 + (((s * 0.38196601125) % 1) - 0.5) * 0.6) * cw;
        aimSample.push({ p: E.targetUVtoWorld(T, cu, cv), w: a.w });
      }
    } else {
      const cum = []; let acc = 0;
      for (const a of aims) { acc += a.w; cum.push(acc); }
      for (let s = 0; s < N; s++) {
        const target = totalW * (s + 0.5) / N;
        let lo = 0, hi = cum.length - 1;
        while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < target) lo = m + 1; else hi = m; }
        const a = aims[lo];
        const cw = 2 * T.half / res;
        const cu = -T.half + (a.i + 0.5 + (((s * 0.61803398875) % 1) - 0.5) * 0.7) * cw;
        const cv = -T.half + (a.j + 0.5 + (((s * 0.38196601125) % 1) - 0.5) * 0.7) * cw;
        aimSample.push({ p: E.targetUVtoWorld(T, cu, cv), w: a.w });
      }
    }

    // shrink aims toward paint centroid to reduce edge spill (images bleed ~blur/2 past aims)
    // Adaptive: large paints shrink more (less edge relative to area); small paints barely shrink.
    let aimShrink = settings.aimShrink;
    if (aimShrink <= 0) aimShrink = Math.max(0.85, Math.min(1.0, 1.0 - (aims.length - 200) / 3000));
    if (aimShrink < 1.0) {
      const cen = [0, 0, 0];
      for (const a of aimSample) { cen[0] += a.p[0]; cen[1] += a.p[1]; cen[2] += a.p[2]; }
      for (let k = 0; k < 3; k++) cen[k] /= aimSample.length;
      for (const a of aimSample) {
        for (let k = 0; k < 3; k++) a.p[k] = cen[k] + aimShrink * (a.p[k] - cen[k]);
      }
    }

    // ---- facet directions: Fibonacci on the hemisphere d·throwDir ≤ blockLim,
    // biased toward the LED axis (bright) via a power-law on the hemisphere coordinate.
    const blockLim = settings.blockLim;
    const bias = settings.brightBias;
    const dirs = [];
    const GA = Math.PI * (3 - Math.sqrt(5));
    // sample on the full sphere, keep the −throw hemisphere; oversample then take the best N by brightness
    const cand = [];
    const over = Math.max(2, Math.ceil(N * 4 / 50)) * 50;
    for (let i = 0; i < over * 6; i++) {
      const z = 1 - 2 * (i + 0.5) / (over * 6);          // full sphere Fibonacci
      const r = Math.sqrt(Math.max(0, 1 - z * z));
      const phi = (i * GA) % (2 * Math.PI);
      const d = [r * Math.cos(phi), r * Math.sin(phi), z];   // world frame (will rotate)
      // rotate so +z → ledAxis
      const dl = V.norm(V.add(V.mul(ledAxis, z), V.add(V.mul(uAx, r * Math.cos(phi)), V.mul(vAx, r * Math.sin(phi)))));
      const dt = V.dot(dl, throwDir);
      if (dt > blockLim) continue;
      const bright = Math.max(0, V.dot(dl, ledAxis));      // Lambertian cos
      if (bright <= 1e-3) continue;
      // optional cone around LED axis (cluster facets for small paints)
      if (settings.cone > 0 && settings.cone < 180) {
        const ang = Math.acos(Math.max(-1, Math.min(1, bright)));
        if (ang > settings.cone * Math.PI / 180) continue;
      }
      cand.push({ d: dl, bright, idx: i });
    }
    // Sort by brightness^bias (deterministic). bias 0 = pure brightness rank (cluster near axis);
    // the top fraction is taken and subsampled by Fibonacci index for angular spread.
    cand.sort((a, b) => Math.pow(b.bright, bias) - Math.pow(a.bright, bias));
    const pool = cand.slice(0, Math.max(N, Math.ceil(cand.length * 0.6)));
    const chosen = [];
    if (pool.length <= N) chosen.push(...pool);
    else {
      const step = pool.length / N;
      for (let s = 0; s < N; s++) chosen.push(pool[Math.floor(s * step)]);
    }

    // resolve radius + envelope for each chosen direction
    const envTol = 1e-4 * Math.max(...env.half);
    // target image size on the target: match paint area per facet (so N facets cover the paint)
    const cellMm = input.target.size / res;
    const paintCells = aims.length;
    let targetImgMm;
    if (settings.targetBlur > 0) targetImgMm = settings.targetBlur * cellMm;
    else {
      // adaptive: image diameter for ~5× coverage (each cell gets ~5 facet-images of light)
      const autoCells = 2 * Math.sqrt(5 * Math.max(1, paintCells) / (N * Math.PI));
      targetImgMm = Math.max(2, Math.min(10, autoCells)) * cellMm;
    }
    const ledSize = src.shape === 'disc' ? 2 * src.radius : Math.min(src.w || 2, src.h || 2);
    const D = input.target.distance;
    const blurR = D * ledSize / Math.max(1, targetImgMm);   // R giving that image size (image = ledSize×D/R)
    for (const c of chosen) {
      const d = c.d;
      let R;
      if (settings.radius > 0) R = Math.max(keep + 1, settings.radius);
      else {
        const iv = G.envInterval(env, L, d); const wallR = iv[1] * 0.8;
        R = Math.max(keep + 1, Math.min(wallR, blurR));   // closer R → bigger image (blur)
      }
      if (!(R > keep + 0.5)) continue;
      const P = V.add(L, V.mul(d, R));
      if (!G.envInside(env, P, envTol)) continue;
      dirs.push({ d, P, R, bright: c.bright });
    }

    const nUse = Math.min(dirs.length, aimSample.length, N);
    if (nUse === 0) return { surfaces: [], intent: [], notes: ['no valid facet positions'] };

    // ---- pair facets with aims by BRIGHTNESS (bright facet → bright aim) so sizes stay moderate,
    // then size each facet ∝ √(paintWeight / brightness) so delivered flux ∝ paint level.
    const fIdx = dirs.slice(0, nUse).map((o, i) => ({ i, b: o.bright })).sort((a, b) => b.b - a.b);
    const aIdx = aimSample.slice(0, nUse).map((o, i) => ({ i, w: o.w })).sort((a, b) => b.w - a.w);
    // raw size factor ∝ √(w / brightness)
    const raw = fIdx.map((f, s) => Math.sqrt((aIdx[s].w + 1e-6) / Math.max(1e-3, f.b)));
    const meanRaw = raw.reduce((x, y) => x + y, 0) / raw.length;
    const baseSide = Math.sqrt(2 * Math.PI / nUse);   // × R gives mean patch side

    const surfaces = [], intent = [];
    // adaptive patch scale: small paints need smaller patches (less shadowing); large paints can use
    // bigger patches (more light).  Base 0.45 (no-overlap) + up to 0.45 from paint area; user scale multiplies.
    const adaptBase = 0.45 + Math.min(0.45, paintCells / 1000 * 0.45);
    const patchScale = adaptBase * settings.facetScale;
    const sizeByW = settings.sizeByWeight;
    for (let s = 0; s < nUse; s++) {
      const f = dirs[fIdx[s].i], Q = aimSample[aIdx[s].i].p, w = aimSample[aIdx[s].i].w;
      const P = f.P, R = f.R;
      const sh = V.norm(V.sub(L, P)), ah = V.norm(V.sub(Q, P));
      const n = V.norm(V.add(sh, ah));
      const ex = V.inPlane(n, null), ey = V.cross(n, ex);
      let side = baseSide * R * patchScale;
      if (sizeByW) side *= (raw[s] / meanRaw);
      // shrink until corners AND edge midpoints fit the envelope; skip if it never fits
      let hs = side / 2, ok = false;
      const corner = (a, b) => V.add(P, V.add(V.mul(ex, a * hs), V.mul(ey, b * hs)));
      const fits = () => {
        const cs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(0, -1), corner(0, 1), corner(-1, 0), corner(1, 0)];
        return cs.every((c) => G.envInside(env, c, 0));
      };
      for (let attempt = 0; attempt < 40; attempt++) {
        if (fits()) { ok = true; break; }
        hs *= 0.85; side *= 0.85;
        if (hs < 0.2) break;
      }
      if (!ok) continue;
      const pts3 = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const di = V.dist(Q, P);   // sharp focus at the aim point (narrow beam, low blocking)
      const id = 'F' + s;
      surfaces.push({ type: 'facet', id, group: 'A', P, S0: L, Z: Q, di, flat: false,
        clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } });
      const [uA, vA] = E.worldToTargetUV(T, Q);
      const ii = Math.max(0, Math.min(res - 1, Math.floor((uA + T.half) / (2 * T.half) * res)));
      const jj = Math.max(0, Math.min(res - 1, Math.floor((vA + T.half) / (2 * T.half) * res)));
      intent.push({ facet: id, cells: [[jj * res + ii, 1]] });
    }
    return { surfaces, intent, notes: [nUse + ' facets, blockLim ' + blockLim + ', R~' + Math.round(dirs[0].R) + 'mm'] };
  },
});

/* Flux tuner (flux-auto): traces candidate settings for the static solver and picks the best for the goal.
 * Exempt from the no-tracing rule (id ends in -auto). Same seed every call → differences are geometry, not noise. */
RF.Solvers.register({
  id: 'bench-glm52-r2--flux-auto', name: 'Flux tuner', version: '0.1', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
  ],
  solve(input, settings, tools) {
    const base = RF.Solvers.get('bench-glm52-r2--flux');
    if (!base) return { surfaces: [], intent: [], notes: ['static solver not found'] };
    const bd = RF.Solvers.defaults(base);
    const minD = settings.minDistance || 0;
    const goal = settings.goal || 'faithful';

    // candidate grid: facetScale × targetBlur (aimShrink stays auto=0)
    const fss = goal === 'throw' ? [1.0, 1.2, 1.4] : [0.7, 0.9, 1.1];
    const tbs = goal === 'throw' ? [2, 3, 5] : [3, 5, 7];
    const RAYS = 200000;
    let best = null, bestScore = -1, bestCfg = '';
    let tried = 0;
    for (const fs of fss) for (const tb of tbs) {
      const s = Object.assign({}, bd, { minDistance: minD, facetScale: fs, targetBlur: tb, aimShrink: 0 });
      let out;
      try { out = base.solve(input, s, tools); } catch (e) { continue; }
      if (!out.surfaces || !out.surfaces.length) continue;
      tried++;
      if (tools.progress) tools.progress(tried / (fss.length * tbs.length));
      let tr;
      try { tr = tools.trace(out.surfaces, { rays: RAYS, seed: input.seed }); } catch (e) { continue; }
      const score = goalScore(tr, goal);
      if (score > bestScore) { bestScore = score; best = out; bestCfg = 'fs=' + fs + ' tb=' + tb; }
    }
    if (!best) { // fallback: static defaults
      try { return base.solve(input, Object.assign({}, bd, { minDistance: minD }), tools); }
      catch (e) { return { surfaces: [], intent: [], notes: ['all candidates failed'] }; }
    }
    return { surfaces: best.surfaces, intent: best.intent,
      notes: ['tuned ' + goal + ': ' + bestCfg + ' (score ' + bestScore.toFixed(3) + ' @ ' + RAYS / 1000 + 'k rays, ' + tried + ' tried)'] };
  },
});

function goalScore(tr, goal) {
  if (!tr || !tr.fidelity) return -1;
  const f = tr.fidelity;
  if (goal === 'throw') return tr.peakCd || 0;
  if (goal === 'efficient') return (f.fidelity || 0) * Math.max(0, 1 - (tr.blocked || 0) - (tr.shadowed || 0));
  return f.fidelity || 0; // faithful
}
