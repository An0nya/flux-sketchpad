/* solvers/solver.js — "tiler": a STATIC paint solver for Flux (mode A).
 *
 * Idea (see solvers/NOTES.md): every facet is the exact ellipsoid with foci S0 = LED and I = its aim
 * point Z on the target, so it images the LED stigmatically onto Z.  Its aperture (disc radius) then
 * controls only the flux it catches, and its distance r = |P−LED| only the image size (LED × di/r).
 * All facets sit on ONE carrier plane inside the envelope, so no facet can shadow or block another
 * (a straight line meets a plane once, and a reflected ray leaves the plane at once).  Aims are placed
 * with density ∝ paint (weighted k-means), and a small deterministic non-negative least squares fits
 * each facet's flux to the paint blurred by the smallest LED image the envelope allows
 * (`RF.Photometry.achievableKernel`) — the pattern the scorer accepts as the physics limit.  Apertures
 * are A_i = Φ_i / g_i (g = catchable flux per mm²), globally scaled so the discs tile the plane without
 * overlapping.  No rays are traced anywhere: everything is closed-form geometry.
 */
// ---- the static solver's knobs (shared by both registrations below) ----------
const TILER_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'coneDeg', label: 'LED cone used (deg off axis)', type: 'range', min: 25, max: 89, step: 1, default: 78 },
    { key: 'sharp', label: 'Placement weight r^sharp (sharpness over flux; negative = wider spots)', type: 'range', min: -4, max: 6, step: 0.25, default: 2 },
        { key: 'fill', label: 'Aperture fill of the local cap', type: 'range', min: 0.2, max: 0.95, step: 0.05, default: 0.85 },
    { key: 'spotScale', label: 'Spot model scale (analytic image size ×)', type: 'range', min: 0.4, max: 3, step: 0.05, default: 1 },
    { key: 'targetBlur', label: 'Flux-fit target: blur paint by kernel + this × own spot (1 = achievable, 0 = kernel)', type: 'range', min: 0, max: 2, step: 0.1, default: 0 },
    { key: 'minAv', label: 'Min reflected-ray clearance over the carrier plane (blocking)', type: 'range', min: 0.05, max: 0.8, step: 0.05, default: 0.12 },
    { key: 'pack', label: 'Aperture radius = this × neighbour spacing (smaller = less blocking, less flux)', type: 'range', min: 0.15, max: 0.6, step: 0.05, default: 0.55 },
    { key: 'shield', label: 'Absorb the LED\'s direct light to the target (free shield patch)', type: 'range', min: 0, max: 1, step: 1, default: 1 },
    { key: 'gapWeight', label: 'Gap penalty weight in the flux fit', type: 'range', min: 0, max: 20, step: 0.5, default: 4 },
    { key: 'nnlsIters', label: 'Flux fit iterations', type: 'range', min: 10, max: 200, step: 10, default: 60 },
    { key: 'ridge', label: 'Flux fit ridge (anti-ringing, ×mean diag)', type: 'range', min: 0, max: 2, step: 0.05, default: 0 },
    { key: 'planeSharp', label: 'Carrier plane: score = rMed^p · √aperture area (sharper vs brighter)', type: 'range', min: 0.5, max: 4, step: 0.25, default: 1 },
];

// The static algorithm (no tracing anywhere).  Both solvers below call it.
function solveTiler(input, settings) {
    const V = RF.V, Geo = RF.Geo, Src = RF.Source, Eng = RF.Engine, Phot = RF.Photometry, U = RF.U;
    const src = input.source || {};
    const S = (src.pos || [0, 0, 0]).slice();
    const sources = (input.sources && input.sources.length ? input.sources : [src]);
    const env = input.envelope || {};
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const T = Eng.targetFrame(input.target || { distance: 1000, size: 1000, res: 50, tiltX: 0, tiltY: 0 });
    const R = Math.max(1, (input.paint && input.paint.res) | 0), paint = (input.paint && input.paint.cells) || [];
    const maxF = Math.max(0, (input.limits && input.limits.maxFacets) | 0);
    const refl = +(input.limits && input.limits.reflectivity !== undefined ? input.limits.reflectivity : 0.9);
    const coneDeg = U.clamp(+settings.coneDeg || 78, 5, 89);
    const sharp = +settings.sharp;
    const fill = U.clamp(+settings.fill || 0.85, 0.05, 1);
    const spotS = +settings.spotScale || 1, gapW = +settings.gapWeight, iters = Math.max(5, +settings.nnlsIters || 60);
    const notes = [];
    const cellW = 2 * T.half / R;

    // ---- painted cells -------------------------------------------------
    const cells = []; let Wp = 0;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i, w = +paint[k];
      if (!(w > 0)) continue;
      const c = Eng.cellCenter(T, i, j);
      cells.push({ k, i, j, u: c[0], v: c[1], w }); Wp += w;
    }
    if (!cells.length || maxF <= 0) return { surfaces: [], intent: [], notes: ['nothing painted, or no facet budget'] };
    const N = Math.min(maxF, cells.length, 1000);

    // ---- emitters ------------------------------------------------------
    const emitters = sources.map((e) => ({
      e, f: Src.frame(e), T: Math.max(1e-12, Src.totalIntegral(e)), p: +e.power || 0,
      cut: Math.min(U.rad(coneDeg), Math.max(U.rad(5), Src.thetaMax(e) - U.rad(1.5))),
    }));
    function inCone(Q) {
      for (const c of emitters) {
        const d = V.sub(Q, c.e.pos), r = V.len(d); if (r < 1e-9) return false;
        const u = V.mul(d, 1 / r);
        if (Math.acos(U.clamp(V.dot(u, c.f.a), -1, 1)) > c.cut) return false;
      }
      return true;
    }
    // catchable flux per mm² of facet area at Q aiming at Z (lm/mm²)
    function gOf(Q, Z) {
      let g = 0;
      for (const c of emitters) {
        const d = V.sub(Q, c.e.pos), r = V.len(d); if (r < 1e-9) continue;
        const u = V.mul(d, 1 / r);
        const th = Math.acos(U.clamp(V.dot(u, c.f.a), -1, 1));
        if (th > c.cut) return 0;
        const ah = V.norm(V.sub(Z, Q));
        const beta = Math.acos(U.clamp(V.dot(u, ah), -1, 1));
        const s = Math.sin(beta / 2);                 // |n·u|: projected area toward the LED
        if (s < 1e-4) continue;
        g += c.p * (Src.intensity(c.e, th) / c.T) * s / (r * r);
      }
      return g;
    }

    // ---- envelope helpers ----------------------------------------------
    function insideMargin(p, m) {
      const c = env.center, h = env.half, d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      if (env.shape === 'box') return Math.abs(d[0]) <= h[0] - m && Math.abs(d[1]) <= h[1] - m && Math.abs(d[2]) <= h[2] - m;
      if (env.shape === 'ellipsoid') { let s = 0; for (let i = 0; i < 3; i++) { const q = d[i] / Math.max(1e-9, h[i] - m); s += q * q; } return s <= 1; }
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      return Math.abs(d[ax]) <= h[ax] - m && (d[i] / Math.max(1e-9, h[i] - m)) ** 2 + (d[j] / Math.max(1e-9, h[j] - m)) ** 2 <= 1;
    }
    // largest margin m with insideMargin(p, m) true (distance to the envelope boundary, approx)
    function envMargin(p) {
      let lo = 0, hi = Math.max(...env.half) * 2;
      if (insideMargin(p, hi)) return hi;
      for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (insideMargin(p, m)) lo = m; else hi = m; }
      return lo;
    }
    // support of the envelope in direction v, measured from S
    function envSupport(v) {
      const c = env.center, h = env.half, o = [c[0] - S[0], c[1] - S[1], c[2] - S[2]];
      const base = o[0] * v[0] + o[1] * v[1] + o[2] * v[2];
      if (env.shape === 'box') return base + Math.abs(v[0]) * h[0] + Math.abs(v[1]) * h[1] + Math.abs(v[2]) * h[2];
      if (env.shape === 'ellipsoid') return base + Math.sqrt((h[0] * v[0]) ** 2 + (h[1] * v[1]) ** 2 + (h[2] * v[2]) ** 2);
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      return base + Math.abs(v[ax]) * h[ax] + Math.sqrt((h[i] * v[i]) ** 2 + (h[j] * v[j]) ** 2);
    }

    // ---- carrier plane: scan directions × levels, score = t·√area·illumination
    const fr0 = Src.frame(src);
    const tdir = V.norm(V.sub(T.C, S));
    let pu = 0, pv = 0; for (const c of cells) { pu += c.u * c.w; pv += c.v * c.w; } pu /= Wp; pv /= Wp;
    const pdir = V.norm(V.sub(Eng.targetUVtoWorld(T, pu, pv), S));
    const dirs = [];
    for (let a = 0; a < 3; a++) { const v = [0, 0, 0]; v[a] = 1; dirs.push(v, [-v[0], -v[1], -v[2]]); }
    dirs.push(fr0.a.slice());
    for (const base of [pdir, tdir]) for (const b of [0.3, 0.5, 0.8, 1.5, 3]) dirs.push(V.norm(V.add(fr0.a, V.mul(base, b))));
    for (const b of [0.3, 0.6, 1.2]) dirs.push(V.norm(V.add(pdir, V.mul(fr0.a, b))));
    let best = null;
    for (const v of dirs) {
      const il = V.dot(v, fr0.a);
      if (!(il > 0.08)) continue;
      if (V.dot(v, pdir) < 0.28 && V.dot(v, pdir) < 0.9 * il) continue;   // must face the paint, else neighbours block
      const sup = envSupport(v);
      if (!(sup > keep + 1.2)) continue;
      for (let lv = 0; lv < 10; lv++) {
        const t = keep + 0.8 + (sup - keep - 2.6) * (0.12 + 0.88 * lv / 9);   // levels from 12% to the depth minus disc room
        const F = V.add(S, V.mul(v, t));
        const bs = V.basis(v), e1 = bs[0], e2 = bs[1];
        const c = env.center, h = env.half;
        let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const q = [c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]], d = V.sub(q, F);
          const a = V.dot(d, e1), b = V.dot(d, e2);
          if (a < lo0) lo0 = a; if (a > hi0) hi0 = a; if (b < lo1) lo1 = b; if (b > hi1) hi1 = b;
        }
        const span = Math.max(hi0 - lo0, hi1 - lo1, 1), hs = span / 22;
        let cnt = 0, rSum = 0;
        for (let a = lo0; a <= hi0 + 1e-9; a += hs) for (let b = lo1; b <= hi1 + 1e-9; b += hs) {
          const Q = V.add(F, V.add(V.mul(e1, a), V.mul(e2, b)));
          if (!insideMargin(Q, 2.2)) continue;
          if (V.dist(Q, S) < keep + 0.7) continue;
          if (!inCone(Q)) continue;
          cnt++; rSum += V.dist(Q, S);
        }
        const area = cnt * hs * hs;
        if (area < 4 * N) continue;
        const rMed = rSum / cnt;
        // aperture the plane can carry: discs capped by the neighbour spacing and by the plane's
        // margin to the envelope (sup - t), which is what limits the facet radius
        const dSp = Math.sqrt(area / N);
        const capR = Math.max(0.3, Math.min((+settings.pack || 0.55) * dSp, sup - t - 0.15));
        const apArea = N * Math.PI * capR * capR;
        // sharper images come from larger r (image = LED size × throw / r), flux from the aperture area
        const score = Math.pow(rMed, +settings.planeSharp || 1) * Math.sqrt(apArea) * Math.pow(il, 0.7);
        if (!best || score > best.score) best = { v, t, score, area, rMed, e1, e2, F, hs: span / 22 };
      }
    }
    if (!best) return { surfaces: [], intent: [], notes: ['no carrier plane with room outside the LED clearance'] };
    const planeV = best.v;
    notes.push('carrier plane n=(' + best.v.map((x) => x.toFixed(2)).join(',') + ') t=' + best.t.toFixed(1) + ' rMed=' + (best.rMed||0).toFixed(1) + ' area~' + best.area.toFixed(0) + 'mm²');

    // ---- fine grid of candidate facet positions on the plane -----------
    const F = best.F, e1 = best.e1, e2 = best.e2;
    {
      const c = env.center, h = env.half;
      let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const q = [c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]], d = V.sub(q, F);
        const a = V.dot(d, e1), b = V.dot(d, e2);
        if (a < lo0) lo0 = a; if (a > hi0) hi0 = a; if (b < lo1) lo1 = b; if (b > hi1) hi1 = b;
      }
      best.lo0 = lo0; best.hi0 = hi0; best.lo1 = lo1; best.hi1 = hi1;
    }
    let hs = U.clamp(Math.sqrt((best.hi0 - best.lo0) * (best.hi1 - best.lo1) / (6 * N)), 0.4, Math.max(best.hi0 - best.lo0, best.hi1 - best.lo1) / 12);
    let pts = [];
    for (let pass = 0; pass < 5; pass++) {
      pts = [];
      for (let a = best.lo0; a <= best.hi0 + 1e-9; a += hs) for (let b = best.lo1; b <= best.hi1 + 1e-9; b += hs) {
        const Q = V.add(F, V.add(V.mul(e1, a), V.mul(e2, b)));
        if (!insideMargin(Q, 2.2)) continue;
        if (V.dist(Q, S) < keep + 0.7) continue;
        if (!inCone(Q)) continue;
        pts.push(Q);
      }
      if (pts.length >= 4 * N || hs <= 0.45) break;
      hs /= 2;
    }
    if (pts.length < 3) return { surfaces: [], intent: [], notes: ['carrier plane too small'] };
    // placement weight: flux per area × r^sharp
    const wq = pts.map((Q) => {
      let g = gOf(Q, T.C), r = 0;
      for (const c of emitters) r = Math.max(r, V.dist(Q, c.e.pos));
      return g * Math.pow(Math.max(1e-9, r), sharp);
    });
    let wmax = 0; for (const w of wq) wmax = Math.max(wmax, w);
    const cand = pts.map((_, i) => i);
    const wpow = sharp / 8;
    const chosen = [cand.reduce((a, b) => (wq[a] >= wq[b] ? a : b))];
    for (let step = 1; step < N; step++) {
      let bi = -1, bs = -1;
      for (const i of cand) {
        if (chosen.indexOf(i) >= 0) continue;
        let d = Infinity;
        for (const j of chosen) { const d2 = V.dist(pts[i], pts[j]); if (d2 < d) d = d2; }
        const sc = d * Math.pow(Math.max(1e-12, wq[i] / wmax), wpow);
        if (sc > bs) { bs = sc; bi = i; }
      }
      if (bi < 0) break;
      chosen.push(bi);
    }
    const pos = chosen.map((i) => pts[i]);
    const nF = Math.min(N, pos.length);
    if (nF < 1) return { surfaces: [], intent: [], notes: ['too few facet positions'] };
    notes.push(nF + ' facet positions (plane grid ' + pts.length + ')');

    // ---- aims: weighted k-means over the painted cells ------------------
    function makeAims(n) {
      let pts = cells;
      if (cells.length > 4000) {
        const g = Math.ceil(Math.sqrt(cells.length / 4000)), map = new Map();
        for (const c of cells) {
          const key = Math.round(c.u / (cellW * g)) * 100000 + Math.round(c.v / (cellW * g));
          let m = map.get(key); if (!m) { m = { u: 0, v: 0, w: 0 }; map.set(key, m); }
          m.u += c.u * c.w; m.v += c.v * c.w; m.w += c.w;
        }
        pts = [...map.values()].map((m) => ({ u: m.u / m.w, v: m.v / m.w, w: m.w }));
      }
      const tot = pts.reduce((s, p) => s + p.w, 0) || 1;
      const sord = pts.slice().sort((a, b) => (a.v - b.v) || (a.u - b.u));
      const centers = []; let acc = 0;
      for (const p of sord) { acc += p.w; while (centers.length < n - 1 && acc >= tot * (centers.length + 1) / n) centers.push({ u: p.u, v: p.v }); }
      while (centers.length < n) centers.push({ u: sord[sord.length - 1].u, v: sord[sord.length - 1].v });
      for (let it = 0; it < 14; it++) {
        const sum = centers.map(() => [0, 0, 0]);
        for (const p of pts) {
          let bi = 0, bd = Infinity;
          for (let i = 0; i < centers.length; i++) { const dx = p.u - centers[i].u, dy = p.v - centers[i].v, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; } }
          const s = sum[bi]; s[0] += p.u * p.w; s[1] += p.v * p.w; s[2] += p.w;
        }
        for (let i = 0; i < centers.length; i++) if (sum[i][2] > 0) centers[i] = { u: sum[i][0] / sum[i][2], v: sum[i][1] / sum[i][2], w: sum[i][2] };
      }
      return centers.slice(0, n);
    }
    const centers = makeAims(nF);

    // ---- pair aims with positions: each aim (by demand) takes the unused position
    //      that catches the most light while aiming there ------------------
    const facets = [];
    const posW = pos.map((Q) => gOf(Q, T.C));
    const orderP = pos.map((_, i) => i).sort((a, b) => posW[b] - posW[a]);
    for (let i = 0; i < centers.length; i++) {
      const Q = pos[orderP[i % orderP.length]];
      const Z = Eng.targetUVtoWorld(T, U.clamp(centers[i].u, -T.half, T.half), U.clamp(centers[i].v, -T.half, T.half));
      const g = gOf(Q, Z);
      if (!(g > 1e-12)) continue;
      const av = V.dot(V.norm(V.sub(Z, Q)), planeV);
      if (av < (+settings.minAv || 0.12)) continue;   // reflected ray must clear the neighbours' discs on the carrier plane
      facets.push({ Q, Z, g, di: V.dist(Q, Z) });
    }
    if (!facets.length) return { surfaces: [], intent: [], notes: ['no facet position catches any light'] };
    // drop weak positions (they would force tiny apertures everywhere)
    const gmed = facets.map((f) => f.g).sort((a, b) => a - b)[facets.length >> 1] || 1;
    const facets2 = facets.filter((f) => f.g >= 0.12 * gmed);
    const use = facets2.length ? facets2 : facets;

    // ---- analytic spot of each facet on the target ----------------------
    const fsrc = Src.frame(src);
    const hw = src.shape === 'disc' ? (src.radius || 1) : (src.w || 1) / 2;
    const hh = src.shape === 'disc' ? (src.radius || 1) : (src.h || 1) / 2;
    for (const f of use) {
      const Q = f.Q, Z = f.Z, ah = V.norm(V.sub(Z, Q)), m = f.di / Math.max(1e-9, V.dist(Q, S));
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const d = V.add(V.mul(fsrc.u, su * hw), V.mul(fsrc.v, sv * hh));
        const dt = V.sub(d, V.mul(ah, V.dot(d, ah)));
        const img = V.add(Z, V.mul(dt, m));
        const dn = V.dot(ah, T.n) || 1e-9;
        const t = -V.dot(V.sub(img, T.C), T.n) / dn;
        const uv = Eng.worldToTargetUV(T, V.add(img, V.mul(ah, t)));
        if (uv[0] < u0) u0 = uv[0]; if (uv[0] > u1) u1 = uv[0];
        if (uv[1] < v0) v0 = uv[1]; if (uv[1] > v1) v1 = uv[1];
      }
      f.cu = (u0 + u1) / 2; f.cv = (v0 + v1) / 2;
      f.au = Math.max(0.25 * cellW, (u1 - u0) / 2) * spotS;
      f.av = Math.max(0.25 * cellW, (v1 - v0) / 2) * spotS;
    }

    // ---- flux fit: bounded non-negative least squares toward blurred paint
    const ker = Phot.achievableKernel({ source: src, envelope: env, target: input.target });
    let meanSpot = 0; for (const f of use) meanSpot += (f.au + f.av) / cellW; meanSpot = meanSpot / Math.max(1, use.length);
    const tBlur = Math.max(1e-6, ker.cells + (+settings.targetBlur || 0) * Math.max(0, meanSpot - ker.cells));
    const B = Phot.boxBlur(paint, R, tBlur);
    const nRows = R * R, n = use.length;
    const rowCols = new Array(nRows); for (let k = 0; k < nRows; k++) rowCols[k] = [];
    for (let i = 0; i < n; i++) {
      const f = use[i];
      const i0 = Math.max(0, Math.floor((f.cu - f.au + T.half) / cellW)), i1 = Math.min(R - 1, Math.ceil((f.cu + f.au + T.half) / cellW) - 1);
      const j0 = Math.max(0, Math.floor((f.cv - f.av + T.half) / cellW)), j1 = Math.min(R - 1, Math.ceil((f.cv + f.av + T.half) / cellW) - 1);
      f.col = [];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cc = Eng.cellCenter(T, i, j);
        const ou = Math.max(0, Math.min(f.cu + f.au, cc[0] + cellW / 2) - Math.max(f.cu - f.au, cc[0] - cellW / 2));
        const ov = Math.max(0, Math.min(f.cv + f.av, cc[1] + cellW / 2) - Math.max(f.cv - f.av, cc[1] - cellW / 2));
        if (ou <= 0 || ov <= 0) continue;
        const w = ou * ov / (4 * f.au * f.av);
        if (!(w > 0)) continue;
        const k = j * R + i;
        f.col.push({ k, w }); rowCols[k].push([i, w]);
      }
    }
    const wt = new Float64Array(nRows), tt = new Float64Array(nRows);
    for (let k = 0; k < nRows; k++) { if (paint[k] > 0) { wt[k] = 1; tt[k] = B[k]; } else { wt[k] = gapW; tt[k] = 0; } }
    const WtW = new Float64Array(n * n), Wtt = new Float64Array(n);
    for (let k = 0; k < nRows; k++) {
      const rc = rowCols[k]; if (!rc.length) continue;
      const w = wt[k], t = tt[k];
      for (const [i, wi] of rc) { if (w * t !== 0) Wtt[i] += w * wi * t; for (const [j, wj] of rc) WtW[i * n + j] += w * wi * wj; }
    }
    // aperture cap per facet: discs must not overlap (nearest neighbour on the plane)
    const capPhi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let d = Infinity;
      for (let j = 0; j < n; j++) if (j !== i) d = Math.min(d, V.dist(use[i].Q, use[j].Q));
      const capA = Math.PI * Math.pow(Math.max(0.05, Math.min((+settings.pack || 0.55) * d, envMargin(use[i].Q) - 0.15)), 2);
      capPhi[i] = capA * use[i].g;
    }
    const Phi = new Float64Array(n).fill(1);
    const diag = new Float64Array(n);
    for (let i = 0; i < n; i++) diag[i] = Math.max(1e-12, WtW[i * n + i]);
    const dmean = diag.reduce((a, b) => a + b, 0) / n;
    const ridge = (+settings.ridge || 0) * dmean;
    for (let it = 0; it < iters; it++) {
      const den = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s = ridge * Phi[i]; const o = i * n; for (let j = 0; j < n; j++) s += WtW[o + j] * Phi[j]; den[i] = s; }
      for (let i = 0; i < n; i++) {
        let p = Phi[i] * (Wtt[i] + 1e-15) / (den[i] + 1e-15);
        if (!(p > 0) || !isFinite(p)) p = 1e-12;
        Phi[i] = Math.min(p, capPhi[i]);
      }
    }
    // global aperture scale: use the space up to the caps, times `fill`
    const A = new Float64Array(n);
    for (let i = 0; i < n; i++) A[i] = Phi[i] / use[i].g;
    const ratio = new Float64Array(n);
    for (let i = 0; i < n; i++) ratio[i] = capPhi[i] / Math.max(1e-12, Phi[i]);   // = capA_i / A_i
    const rs = Array.from(ratio).sort((a, b) => a - b);
    let sigma = rs[Math.min(n - 1, Math.floor(0.15 * n))];
    if (!isFinite(sigma) || sigma <= 0) sigma = rs[n - 1] || 1;
    sigma *= fill;
    for (let i = 0; i < n; i++) {
      const Ai = Math.min(A[i] * sigma, capPhi[i] / use[i].g);   // clip at the individual cap
      use[i].rho = Math.sqrt(Math.max(1e-6, Ai) / Math.PI);
    }

    // ---- build surfaces, shrinking any patch that violates envelope / clearance
    function patchOK(P, fq, rho) {
      const A = fq.A, b = fq.b, n = fq.n;
      const ex = V.inPlane(n), ey = V.cross(n, ex);
      const q = (x, y) => { let s = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += x[i] * A[3 * i + j] * y[j]; return s; };
      const bd = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
      for (let s = 0; s <= 3; s++) for (let a = 0; a < 16; a++) {
        const rr = rho * s / 3, th = a * Math.PI / 8;
        const x = V.add(V.mul(ex, rr * Math.cos(th)), V.mul(ey, rr * Math.sin(th)));
        const a2 = q(n, n), a1 = 2 * q(x, n) + bd(b, n), a0 = q(x, x) + bd(b, x);
        const roots = U.quadRoots(a2, a1, a0);
        let z = 0;
        if (roots.length) { z = roots[0]; if (roots.length > 1 && Math.abs(roots[1]) < Math.abs(roots[0])) z = roots[1]; }
        const pt = V.add(V.add(P, x), V.mul(n, z));
        if (!insideMargin(pt, 0.05)) return false;
        for (const c of emitters) if (V.dist(pt, c.e.pos) < keep + 0.05) return false;
      }
      return true;
    }
    const surfaces = [], intent = [];
    let dropped = 0;
    for (let i = 0; i < n; i++) {
      const f = use[i];
      let rho = f.rho, ok = false;
      for (let pass = 0; pass < 30 && !ok; pass++) {
        ok = patchOK(f.Q, Geo.facetQuadric(f.Q, S, f.Z, f.di), rho);
        if (!ok) rho *= 0.88;
      }
      if (!ok) { dropped++; continue; }
      if (rho < 0.08) rho = 0.08;            // flux-starved facets still count as placed (tiny mirror)
      const id = 'F' + surfaces.length;
      surfaces.push({
        type: 'facet', id, P: f.Q.slice(), S0: S.slice(), Z: f.Z.slice(), flat: false, di: f.di,
        clip: { kind: 'disc', r: rho },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      });
      const ci = U.clamp(Math.round((f.cu + T.half) / cellW), 0, R - 1), cj = U.clamp(Math.round((f.cv + T.half) / cellW), 0, R - 1);
      const cellsOut = (f.col && f.col.length ? f.col : [{ k: cj * R + ci, w: 1 }]).map((c) => [c.k, c.w]);
      intent.push({ facet: id, cells: cellsOut });
    }
    // ---- optional shield: absorb the LED's direct light before it reaches the target ----
    // A small patch on the LED→target axis, sized to cover the target's angular extent at that
    // distance. Reflecting facets sit far off-axis (their rays bend at the mirror), so their
    // light passes around it; only direct target-bound rays are stopped. Free (not a facet).
    if (+settings.shield) {
      const D = V.dist(T.C, S), d = V.mul(V.sub(T.C, S), 1 / Math.max(1e-9, D));
      let placed = false;
      for (const s of [keep + 1.2, keep + 2.5, keep + 4.5, keep + 7, keep + 10, keep + 14]) {
      if (placed) break;
      const P0 = V.add(S, V.mul(d, s));
      const e1 = V.inPlane(d), e2 = V.cross(d, e1);
      const corners = [];
      for (const su of [-1, 1]) for (const sv of [-1, 1]) corners.push(Eng.targetUVtoWorld(T, su * T.half, sv * T.half));
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, okC = true;
      for (const Q of corners) {
        const w = V.sub(Q, S), t = V.dot(w, d);
        if (!(t > s + 1e-9)) { okC = false; break; }
        const X = V.add(S, V.mul(w, s / t)), r = V.sub(X, P0);
        const a = V.dot(r, e1), b = V.dot(r, e2);
        if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
      }
      if (okC) {
        const hx = (a1 - a0) / 2 + 0.35, hy = (b1 - b0) / 2 + 0.35, ac = (a0 + a1) / 2, bc = (b0 + b1) / 2;
        const Pp = V.add(P0, V.add(V.mul(e1, ac), V.mul(e2, bc)));
        const n = d.slice();
        const patchPt = (u, v) => V.add(Pp, V.add(V.mul(e1, u), V.mul(e2, v)));
        // inside the envelope, outside every emitter's clearance, and not shadowing any facet
        let ok = true;
        for (const su of [-1, 1]) for (const sv of [-1, 1]) if (!insideMargin(patchPt(su * hx, sv * hy), 0.05)) ok = false;
        for (const c of emitters) {
          for (const su of [-1, 1]) for (const sv of [-1, 1]) if (V.dist(patchPt(su * hx, sv * hy), c.e.pos) < keep + 0.4) ok = false;
          if (V.dist(Pp, c.e.pos) < keep + 0.4) ok = false;
        }
        if (ok) for (const f of use) for (const c of emitters) {
          const w = V.sub(f.Q, c.e.pos), t = V.dot(w, d);
          if (t > s) {
            const X = V.add(c.e.pos, V.mul(w, s / t)), r = V.sub(X, Pp);
            if (Math.abs(V.dot(r, e1)) <= hx && Math.abs(V.dot(r, e2)) <= hy) { ok = false; break; }
          }
        }
        if (ok && hx > 0.05 && hy > 0.05) {
          surfaces.push({ type: 'plane', id: 'shield', group: 'A', P: Pp, n, clip: { kind: 'rect', hx, hy },
            optics: { interaction: 'absorb' } });
          notes.push('shield: direct target light absorbed at ' + s.toFixed(1) + ' mm (patch ' + (2 * hx).toFixed(1) + '×' + (2 * hy).toFixed(1) + ' mm)');
          placed = true;
        }
      }
      }
      if (!placed) notes.push('shield skipped (envelope / clearance / facet conflict)');
    }
    if (typeof process !== 'undefined' && process.env && process.env.TILER_DBG) notes.push('DBG n=' + n + ' Phi[min/med/max]=' + [Math.min(...Phi), Phi[n>>1], Math.max(...Phi)].map(x=>x.toExponential(2)).join('/') +
      ' A[med]=' + (A[n>>1]).toFixed(1) + ' capPhi[med]=' + capPhi[n>>1].toFixed(2) + ' sigma=' + sigma.toFixed(3) + ' g[med]=' + use[n>>1].g.toFixed(4) + ' rho[med]=' + use[n>>1].rho.toFixed(2) + ' dmed=' + (function(){let d=1e9;for(let i=0;i<n;i++){for(let j=0;j<n;j++)if(i!==j)d=Math.min(d,V.dist(use[i].Q,use[j].Q));}return d.toFixed(1)})() + ' envM=' + envMargin(use[n>>1].Q).toFixed(1));
    notes.push(n + ' facets planned, ' + dropped + ' dropped, kernel ' + (ker.cells || 0).toFixed(2) +
      ' cells, aperture Σ ' + use.reduce((s, f) => s + Math.PI * f.rho * f.rho, 0).toFixed(0) + ' mm²');
    return { surfaces, intent, notes };
}

RF.Solvers.register({
  id: 'bench-mistrallarge4-r2--tiler', name: 'Paint tiler (static)', version: '0.2', modes: ['paint'],
  settings: TILER_SETTINGS,
  solve(input, settings) { return solveTiler(input, settings); },
});


/* ====================================================================================
 * "tiler-auto" — the optional tuner (id ends in -auto, so tools.trace is allowed inside
 * solve()).  It runs the static algorithm above on a small, fixed set of candidate setting
 * vectors, traces each candidate once with ONE fixed seed (same seed every call ⇒ the
 * candidates differ by geometry, not by dice), and returns the candidate that best meets
 * the requested goal:
 *   faithful  — maximise the scored paint fidelity (F1 of within × gaps-dark), with a
 *               floor on onPaint so a nearly-dark design can't win (the score multiplies
 *               fidelity by light = min(1, onPaint ÷ 0.1·reference)).
 *   throw     — maximise the traced throw distance (m).
 *   efficient — maximise 0.7·onPaint + 0.3·(peak ÷ envelope ceiling): the two normalised
 *               quantities the score's X term rewards (light on the paint, beam intensity).
 * Everything is deterministic: fixed candidate list, fixed seed, fixed ray count.
 * ================================================================================== */
(function () {
  const GOALS = ['faithful', 'throw', 'efficient'];
  // Candidate setting deltas on top of the static solver's defaults.  Curated from the
  // measured sweeps in NOTES.md (sharp / pack / fill / planeSharp / coneDeg / gapWeight /
  // shield / minAv / spotScale each moved fidelity by up to a few points on the public scenes).
  const CANDS = {
    faithful: [
      {}, { sharp: 1 }, { sharp: 1.5 }, { sharp: 2.5 }, { sharp: 3 },
      { pack: 0.45 }, { pack: 0.4 }, { fill: 1 }, { fill: 0.7 },
      { planeSharp: 0.5 }, { planeSharp: 1.5 }, { planeSharp: 2 },
      { coneDeg: 65 }, { coneDeg: 85 }, { gapWeight: 2 }, { gapWeight: 8 },
      { shield: 0 }, { minAv: 0.2 }, { spotScale: 1.3 }, { targetBlur: 0.5 },
      { sharp: 3, pack: 0.45 }, { sharp: 1, fill: 1 }, { coneDeg: 65, gapWeight: 8, fill: 1 },
    ],
    throw: [
      {}, { sharp: 3 }, { sharp: 4 }, { sharp: 5 },
      { sharp: 3, planeSharp: 2 }, { planeSharp: 3, sharp: 3 }, { planeSharp: 2 },
      { sharp: 4, pack: 0.4 }, { sharp: 3, fill: 1 }, { sharp: 4, coneDeg: 60 },
      { sharp: 3, coneDeg: 55 }, { sharp: 2.5, planeSharp: 2, pack: 0.45 },
      { sharp: 5, pack: 0.35 }, { coneDeg: 40, sharp: 3 }, { sharp: 4, spotScale: 0.8 },
    ],
    efficient: [
      {}, { fill: 1 }, { fill: 1, pack: 0.55 }, { shield: 1, fill: 1 },
      { coneDeg: 85, fill: 1 }, { coneDeg: 89 }, { sharp: 0 }, { sharp: 0, fill: 1 },
      { gapWeight: 8, fill: 1 }, { spotScale: 1.2, fill: 1 }, { coneDeg: 85 },
      { sharp: 1, fill: 1, shield: 1 }, { pack: 0.5, fill: 1, coneDeg: 85 }, { gapWeight: 2, fill: 1 },
    ],
  };
  const SEED = 20261118;                       // one fixed seed for every candidate trace

  function objective(goal, r) {
    if (!r) return -Infinity;
    const fd = r.fidelity || {};
    if (goal === 'throw') return (r.throwM || 0);
    if (goal === 'efficient') return 0.7 * (fd.onPaint || 0) + 0.3 * (r.ofEnvelope || 0);
    // faithful: scored F = fidelity × light, light = min(1, onPaint / (0.1·ref)); assume the
    // reference puts at least ~2% of the light on the paint (any real design does)
    const light = Math.min(1, (fd.onPaint || 0) / 0.02);
    return (fd.fidelity || 0) * light;
  }

  RF.Solvers.register({
    id: 'bench-mistrallarge4-r2--tiler-auto', name: 'Paint tiler (auto-tuned)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Tuning goal', type: 'select', options: [
        { value: 'faithful', label: 'Faithful — maximise paint fidelity' },
        { value: 'throw', label: 'Throw — maximise beam distance' },
        { value: 'efficient', label: 'Efficient — maximise on-paint light and peak' },
      ], default: 'faithful' },
      { key: 'raysPerTry', label: 'Rays per candidate trace (stage 1; the top 5 are re-traced at 4×)', type: 'range', min: 50000, max: 500000, step: 50000, default: 200000 },
    ],
    solve(input, settings, tools) {
      const goal = GOALS.includes(settings.goal) ? settings.goal : 'faithful';
      const base = {};
      for (const f of TILER_SETTINGS) base[f.key] = f.default;
      base.minDistance = +settings.minDistance || 0;
      const canTrace = !!(tools && typeof tools.trace === 'function');
      const list = CANDS[goal] || CANDS.faithful;
      const raysPerTry = Math.max(20000, Math.min(1000000, +settings.raysPerTry || 300000));
      const t0 = Date.now();
      const msBudget = (tools && tools.budget && tools.budget.ms) || 60000;
      const rayBudget = (tools && tools.budget && tools.budget.rays) || Infinity;
      if (!canTrace) {                                   // no tracing available: static defaults
        const out = solveTiler(input, base);
        return Object.assign(out, { notes: (out.notes || []).concat(['tiler-auto: no tools.trace — used static defaults (goal ' + goal + ')']) });
      }
      // stage 1: every candidate at raysPerTry; stage 2: the top few at a higher ray count,
      // so the final ranking is not decided by pilot noise.  Same seed everywhere.
      let used = 0, best = null;
      const tried = [];
      const room = () => Math.max(0, rayBudget - 20000 - used);
      const slow = () => Date.now() - t0 > 0.55 * msBudget;
      const evalCand = (cand, rays) => {
        const st = Object.assign({}, base, cand);
        let out, r;
        try { out = solveTiler(input, st); } catch (e) { return { cand, err: String(e) }; }
        try { r = tools.trace(out.surfaces, { rays, seed: SEED }); used += rays; }
        catch (e) { return { cand, err: String(e && e.message || e) }; }
        return { cand, obj: objective(goal, r), out, st, r,
          fid: r.fidelity && r.fidelity.fidelity, onPaint: r.fidelity && r.fidelity.onPaint,
          gapsDark: r.fidelity && r.fidelity.gapsDark, within: r.fidelity && r.fidelity.within,
          peak: r.peakCd, throwM: r.throwM, ofEnv: r.ofEnvelope, blocked: r.blocked };
      };
      for (let ci = 0; ci < list.length; ci++) {
        if (room() < raysPerTry || slow()) break;
        if (tools.progress) tools.progress(0.5 * ci / list.length);
        const t = evalCand(list[ci], raysPerTry);
        tried.push(t);
        if (!t.err && (!best || t.obj > best.obj)) best = t;
      }
      const finalRays = Math.min(1000000, 4 * raysPerTry);
      const top = tried.filter((t) => !t.err).sort((a, b) => b.obj - a.obj).slice(0, 5);
      for (let k = 0; k < top.length; k++) {
        if (room() < finalRays || slow()) break;
        if (tools.progress) tools.progress(0.5 + 0.5 * k / Math.max(1, top.length));
        const t = evalCand(top[k].cand, finalRays);
        tried.push(t);
        if (!t.err && (!best || t.obj > best.obj)) best = t;
      }
      if (tools.progress) tools.progress(1);
      if (!best) {                                       // every trace failed: fall back
        const out = solveTiler(input, base);
        return Object.assign(out, { notes: (out.notes || []).concat(['tiler-auto: all candidate traces failed — static defaults (goal ' + goal + ')']) });
      }
      const notes = (best.out.notes || []).concat([
        'tiler-auto goal=' + goal + ': ' + tried.filter((t) => !t.err).length + ' traces (stage1 @ ' + raysPerTry + ', stage2 @ ' + finalRays + ', seed ' + SEED + ', ' + used.toLocaleString() + ' rays total), chose ' + JSON.stringify(best.st),
        '  chosen obj=' + best.obj.toFixed(4) + (best.r.fidelity ? ' fid=' + best.r.fidelity.fidelity.toFixed(3) + ' within=' + best.r.fidelity.within.toFixed(3) + ' gaps=' + best.r.fidelity.gapsDark.toFixed(3) + ' onPaint=' + best.r.fidelity.onPaint.toFixed(4) : '') +
          (best.r.peakCd ? ' peak=' + Math.round(best.r.peakCd) + 'cd throw=' + Math.round(best.r.throwM) + 'm ofEnv=' + best.r.ofEnvelope.toFixed(3) : ''),
        '  top: ' + tried.filter((t) => !t.err).sort((a, b) => b.obj - a.obj).slice(0, 5).map((t) => JSON.stringify(t.cand) + '→' + t.obj.toFixed(4)).join(' '),
      ]);
      return { surfaces: best.out.surfaces, intent: best.out.intent, notes, needs: best.out.needs };
    },
  });
})();
