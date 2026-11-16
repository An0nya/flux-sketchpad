/* solver.js — "Mosaic": a static paint solver for Flux.
 *
 * Idea in one paragraph.  Every facet is a piece of a mirror that images the LED onto the target.  The facets sit on
 * ONE paraboloid whose focus is the LED and whose axis points at the painting: on that surface no facet shadows
 * another from the LED and no facet stands in another's reflected beam.  Each facet then paints a "blob": the LED's
 * image (a parallelogram whose size is LED size × throw ÷ distance-to-LED), optionally widened by defocus.  The blob
 * shapes follow from first-order optics in closed form (no ray tracing), so the job becomes a mosaic: put ~100 blobs
 * of known shape and flux onto the painting so their sum matches it.  That is done by a deterministic greedy placement
 * followed by coordinate descent on a smooth stand-in for the app's fidelity score.  The paraboloid's depth (shallow =
 * more light but bigger LED images, deep = sharper but less light) is chosen by running a quick, coarse version of
 * the same fit for a few depths and keeping the one the model scores best.
 *
 * See NOTES.md for what was measured.
 */
(function () {
  'use strict';
  const V = RF.V;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);

  // ------------------------------------------------------------------ the LED as the model sees it
  function ledModel(src) {
    const fr = RF.Source.frame(src), tot = RF.Source.totalIntegral(src) || 1;
    const inten = (d) => RF.Source.intensity(src, Math.acos(clamp(V.dot(d, fr.a), -1, 1))) / tot;   // share of the flux per steradian
    let edges;
    if (src.kind === 'planar') {
      const disc = src.shape === 'disc', w = disc ? 2 * src.radius : src.w, h = disc ? 2 * src.radius : src.h;
      const E1 = V.mul(fr.u, w), E2 = V.mul(fr.v, h);
      edges = () => ({ e1: E1, e2: E2, round: disc });
    } else if (src.kind === 'volume' && src.shape === 'cylinder') {
      edges = (d) => { let s = V.cross(fr.a, d); if (V.len(s) < 1e-6) s = fr.u; return { e1: V.mul(fr.a, src.length), e2: V.mul(V.norm(s), 2 * src.radius), round: false }; };
    } else if (src.kind === 'volume') {
      edges = (d) => { const [b1, b2] = V.basis(d); return { e1: V.mul(b1, 2 * src.radius), e2: V.mul(b2, 2 * src.radius), round: true }; };
    } else edges = () => ({ e1: V.mul(fr.u, 1e-3), e2: V.mul(fr.v, 1e-3), round: false });
    return { pos: src.pos.slice(), a: fr.a, inten, edges };
  }

  // ------------------------------------------------------------------ blob rasteriser (fine-grid cells, centre at 0,0)
  // Adds `weight`, spread evenly over the parallelogram (or inscribed ellipse) centred (cx, cy) with full edge vectors p1, p2.
  const NY = 3;
  function fillShape(buf, W, H, x0, y0, cx, cy, p1x, p1y, p2x, p2y, weight, round) {
    let area = Math.abs(p1x * p2y - p1y * p2x);
    if (area < 0.3) { const s = 0.55; p1x = s; p1y = 0; p2x = 0; p2y = s; area = s * s; round = false; }   // edge-on or sub-cell image: a small square
    const dens = weight / (round ? area * Math.PI / 4 : area) / NY;
    const hy = (Math.abs(p1y) + Math.abs(p2y)) / 2;
    const j0 = Math.max(0, Math.floor(cy - hy - y0)), j1 = Math.min(H - 1, Math.floor(cy + hy - y0));
    const det = p1x * p2y - p1y * p2x, vx = [0, 0, 0, 0], vy = [0, 0, 0, 0];
    if (!round) { const s1 = [-0.5, 0.5, 0.5, -0.5], s2 = [-0.5, -0.5, 0.5, 0.5]; for (let k = 0; k < 4; k++) { vx[k] = cx + s1[k] * p1x + s2[k] * p2x; vy[k] = cy + s1[k] * p1y + s2[k] * p2y; } }
    for (let j = j0; j <= j1; j++) for (let s = 0; s < NY; s++) {
      const y = y0 + j + (s + 0.5) / NY; let xa = Infinity, xb = -Infinity;
      if (round) {                                                       // points c + a p1 + b p2 with a² + b² ≤ ¼
        const dy = y - cy, A = p2y * p2y + p1y * p1y, B = -2 * dy * (p2y * p2x + p1y * p1x), C = dy * dy * (p2x * p2x + p1x * p1x) - det * det / 4;
        const disc = B * B - 4 * A * C; if (!(disc > 0) || !(A > 0)) continue;
        const r = Math.sqrt(disc); xa = cx + (-B - r) / (2 * A); xb = cx + (-B + r) / (2 * A);
      } else {
        for (let k = 0; k < 4; k++) {
          const ya = vy[k], yb = vy[(k + 1) & 3];
          if ((ya - y) * (yb - y) > 0 || ya === yb) continue;
          const x = vx[k] + (y - ya) / (yb - ya) * (vx[(k + 1) & 3] - vx[k]);
          if (x < xa) xa = x; if (x > xb) xb = x;
        }
        if (!(xb > xa)) continue;
      }
      const i0 = Math.max(0, Math.floor(xa - x0)), i1 = Math.min(W - 1, Math.floor(xb - x0)), row = j * W;
      for (let i = i0; i <= i1; i++) { const l = Math.min(xb, x0 + i + 1) - Math.max(xa, x0 + i); if (l > 0) buf[row + i] += l * dens; }
    }
  }
  // Blob widened by a box of wx × wy fine cells (what defocus does to it): two 1-D passes with exact fractional widths.
  function boxConv(K, wx, wy) {
    let { x0, y0, W, H, buf } = K;
    if (wx > 0.05) {
      const pad = Math.ceil(wx / 2) + 1, W2 = W + 2 * pad, out = new Float32Array(W2 * H), C = new Float64Array(W + 1);
      const at = (x) => { if (x <= 0) return 0; if (x >= W) return C[W]; const i = Math.floor(x); return C[i] + (x - i) * (C[i + 1] - C[i]); };
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) C[i + 1] = C[i] + buf[j * W + i];
        if (!(C[W] > 0)) continue;
        for (let i = 0; i < W2; i++) { const xs = i - pad + 0.5; out[j * W2 + i] = (at(xs + wx / 2) - at(xs - wx / 2)) / wx; }
      }
      buf = out; W = W2; x0 -= pad;
    }
    if (wy > 0.05) {
      const pad = Math.ceil(wy / 2) + 1, H2 = H + 2 * pad, out = new Float32Array(W * H2), C = new Float64Array(H + 1);
      const at = (y) => { if (y <= 0) return 0; if (y >= H) return C[H]; const j = Math.floor(y); return C[j] + (y - j) * (C[j + 1] - C[j]); };
      for (let i = 0; i < W; i++) {
        for (let j = 0; j < H; j++) C[j + 1] = C[j] + buf[j * W + i];
        if (!(C[H] > 0)) continue;
        for (let j = 0; j < H2; j++) { const ys = j - pad + 0.5; out[j * W + i] = (at(ys + wy / 2) - at(ys - wy / 2)) / wy; }
      }
      buf = out; H = H2; y0 -= pad;
    }
    return { x0, y0, W, H, buf, ph: [] };
  }

  // ------------------------------------------------------------------ the solver
  function solve(input, settings) {
    const notes = [], t00 = Date.now();
    const src = input.source, env = input.envelope, tgt = input.target, lim = input.limits;
    const R0 = input.paint.res | 0, paint0 = input.paint.cells;
    const led = ledModel(src), L = led.pos;
    const T = RF.Engine.targetFrame(tgt);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const maxFacets = Math.max(1, lim.maxFacets | 0);
    const uvToWorld = (u, v) => [T.C[0] + T.tu[0] * u + T.tv[0] * v, T.C[1] + T.tu[1] * u + T.tv[1] * v, T.C[2] + T.tu[2] * u + T.tv[2] * v];
    const MB = num(settings.margin, 0.1), MU = num(settings.light, 0.5), LAM = num(settings.depthLight, 0.5), PULL = num(settings.pull, 0.3), MT = num(settings.overlap, 2.5);

    // ---- the painting
    let sp0 = 0, cu = 0, cv = 0, nPainted0 = 0;
    { const cell = 2 * T.half / R0; for (let k = 0; k < R0 * R0; k++) if (paint0[k] > 0) { const i = k % R0, j = (k / R0) | 0; sp0 += paint0[k]; nPainted0++; cu += paint0[k] * (-T.half + (i + 0.5) * cell); cv += paint0[k] * (-T.half + (j + 0.5) * cell); } }
    if (!(sp0 > 0)) return { surfaces: [], intent: [], notes: ['nothing is painted: no facets placed'] };
    cu /= sp0; cv /= sp0;
    const aimC = uvToWorld(cu, cv);
    let pu0 = Infinity, pu1 = -Infinity, pv0 = Infinity, pv1 = -Infinity;
    { const cell = 2 * T.half / R0; for (let k = 0; k < R0 * R0; k++) if (paint0[k] > 0) { const i = k % R0, j = (k / R0) | 0; pu0 = Math.min(pu0, -T.half + i * cell); pu1 = Math.max(pu1, -T.half + (i + 1) * cell); pv0 = Math.min(pv0, -T.half + j * cell); pv1 = Math.max(pv1, -T.half + (j + 1) * cell); } }
    let ker0 = 0;
    try { ker0 = RF.Photometry.achievableKernel({ source: src, envelope: env, target: tgt }).cells || 0; } catch (e) { ker0 = 0; }

    // ---- a working grid: the paint (possibly coarsened for the quick fits) and what the score wants per cell
    function makeGrid(R) {
      const nP = R * R, cell = 2 * T.half / R, sc = (R / R0) * (R / R0);
      const paint = R === R0 ? Float64Array.from(paint0) : RF.Engine.toPaintGrid(paint0, R0, R).map((x) => x * sc);
      const kc = ker0 * R / R0, B = RF.Photometry.boxBlur(paint, R, kc), rb = Math.ceil(kc) + 2;
      const near = new Uint8Array(nP), tmp = new Uint8Array(nP);
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (paint[j * R + i] > 0) for (let q = Math.max(0, i - rb); q <= Math.min(R - 1, i + rb); q++) tmp[j * R + q] = 1;
      for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (tmp[j * R + i]) for (let q = Math.max(0, j - rb); q <= Math.min(R - 1, j + rb); q++) near[q * R + i] = 1;
      let sp = 0, nPainted = 0, nGap = 0;
      for (let k = 0; k < nP; k++) { if (paint[k] > 0) { sp += paint[k]; nPainted++; } else if (near[k]) nGap++; }
      const typ = sp / nPainted, wP = 1 / nPainted, wG = 1 / Math.max(1, nGap);
      const tl = new Float64Array(nP), th = new Float64Array(nP), mid = new Float64Array(nP), allow = new Float64Array(nP), wCell = new Float64Array(nP), S0 = new Float64Array(nP);
      for (let k = 0; k < nP; k++) {
        if (paint[k] > 0) {
          const rl = 0.8 * Math.min(1, B[k] / paint[k]), rh = 1.25 * Math.max(1, B[k] / paint[k]);
          let a = rl * (1 + MB), b = rh / (1 + MB); if (a > b) a = b = Math.sqrt(rl * rh);
          tl[k] = a; th[k] = b; mid[k] = Math.sqrt(a * b);
        } else { allow[k] = Math.max(1.25 * B[k], 0.1 * typ) * (1 - 1.5 * MB); wCell[k] = wG; }
        // the LED's direct light on this cell (nothing the reflector can do about it; the fit should know)
        const i = k % R, j = (k / R) | 0, X = uvToWorld(-T.half + (i + 0.5) * cell, -T.half + (j + 0.5) * cell), d = V.sub(X, L), r = V.len(d);
        S0[k] = led.inten(V.mul(d, 1 / r)) * cell * cell * Math.abs(V.dot(d, T.n)) / (r * r * r);
      }
      let bx0 = R, bx1 = 0, by0 = R, by1 = 0;
      for (let k = 0; k < nP; k++) if (paint[k] > 0) { const i = k % R, j = (k / R) | 0; bx0 = Math.min(bx0, i); bx1 = Math.max(bx1, i + 1); by0 = Math.min(by0, j); by1 = Math.max(by1, j + 1); }
      return { R, nP, cell, paint, B, near, sp, nPainted, nGap, typ, wP, wG, tl, th, mid, allow, wCell, S0, box: [bx0, bx1, by0, by1] };
    }

    // ---- base surface: paraboloid, focus = LED, axis = LED → painting; aperture axes follow the target's u and v
    const A = V.norm(V.sub(aimC, L));
    let e1 = V.sub(T.tu, V.mul(A, V.dot(T.tu, A))); e1 = V.norm(e1); const e2 = V.cross(A, e1);
    const em = Math.max(0.3, 0.012 * Math.max(env.half[0], env.half[1], env.half[2]));       // envelope margin (mm)
    const envIn = Object.assign({}, env, { half: env.half.map((h) => Math.max(1e-3, h - em)) });
    const keepM = keep + 0.25;
    let Rmax = 0; for (let k = 0; k < 8; k++) { const p = [0, 1, 2].map((i) => env.center[i] + (k >> i & 1 ? 1 : -1) * env.half[i]); Rmax = Math.max(Rmax, V.dist(p, L)); }
    const baseAt = (f, q1, q2) => { const t = (q1 * q1 + q2 * q2) / (4 * f) - f; return [L[0] + q1 * e1[0] + q2 * e2[0] + t * A[0], L[1] + q1 * e1[1] + q2 * e2[1] + t * A[1], L[2] + q1 * e1[2] + q2 * e2[2] + t * A[2]]; };
    const okPt = (p) => RF.Geo.envInside(envIn, p) && V.dist(p, L) >= keepM;

    function cellsFor(f, g, countOnly) {                                // cells of pitch g on the aperture plane whose centre is usable
      const n = Math.ceil(Rmax / g) + 1, out = []; let cnt = 0;
      for (let b = -n; b < n; b++) for (let a = -n; a < n; a++) {
        const qc1 = (a + 0.5) * g, qc2 = (b + 0.5) * g;
        if (qc1 * qc1 + qc2 * qc2 > Rmax * Rmax) continue;
        const pc = baseAt(f, qc1, qc2);
        if (!okPt(pc) || !(led.inten(V.norm(V.sub(pc, L))) > 1e-4)) continue;
        cnt++; if (countOnly) continue;
        const cs = [];
        for (const [da, db] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          let q1 = (a + da) * g, q2 = (b + db) * g;
          if (!okPt(baseAt(f, q1, q2))) {                               // pull a corner that sticks out back toward the centre
            let lo = 0, hi = 1;
            for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (okPt(baseAt(f, qc1 + (q1 - qc1) * m, qc2 + (q2 - qc2) * m))) lo = m; else hi = m; }
            lo *= 0.97; q1 = qc1 + (q1 - qc1) * lo; q2 = qc2 + (q2 - qc2) * lo;
          }
          cs.push([q1, q2]);
        }
        out.push({ q: cs, key: a + ',' + b });
      }
      return countOnly ? cnt : out;
    }
    const land = (s, Q, n) => {                                         // LED point s → mirror point Q (normal n) → target plane (u, v)
      let d = V.norm(V.sub(Q, s)); d = V.reflect(d, n);
      const den = V.dot(d, T.n); if (Math.abs(den) < 1e-9) return null;
      const t = V.dot(V.sub(T.C, Q), T.n) / den, p = V.madd(Q, d, t), rel = V.sub(p, T.C);
      return [V.dot(rel, T.tu), V.dot(rel, T.tv)];
    };
    function stampsOf(fc, Zw) {                                         // first-order LED image through each sub-aperture
      const out = [];
      for (const sb of fc.subs) {
        const Q = sb.Q, n = V.norm(V.add(V.norm(V.sub(L, Q)), V.norm(V.sub(Zw, Q)))), ed = led.edges(sb.dir);
        const a1 = land(V.madd(L, ed.e1, 0.5), Q, n), a0 = land(V.madd(L, ed.e1, -0.5), Q, n), b1 = land(V.madd(L, ed.e2, 0.5), Q, n), b0 = land(V.madd(L, ed.e2, -0.5), Q, n);
        if (!a1 || !a0 || !b1 || !b0) continue;
        out.push({ p1: [a1[0] - a0[0], a1[1] - a0[1]], p2: [b1[0] - b0[0], b1[1] - b0[1]], w: sb.w, round: ed.round });
      }
      return out;
    }
    // Where can a facet aim without its beam hitting another facet?  The beam leaves a point X of the paraboloid along d;
    // the line meets the paraboloid once more, and if a facet sits there the light is blocked.  A coarse yes/no map over
    // the painted area per facet (closed form: the second root of a quadratic), so the fit never aims a facet through a neighbour.
    // ... and how much of the beam survives its NEIGHBOURS.  A facet aimed off the paraboloid's axis is tilted about its
    // centre, so its edges stand proud of / below the paraboloid; where the next facet's edge stands higher, the strip
    // of this facet behind that step sends its light into the neighbour's back.  First order: step = (δn_i + δn_j)·s
    // (δn = how far the normal leans, s = centre → shared edge), lost share = step × (beam along s ÷ beam along normal)
    // ÷ facet width.  tiltOf() gives the pieces; stepLoss() the loss toward one neighbour.
    function tiltOf(fc, Z) {
      const d = V.norm(V.sub(Z, fc.P)), n = V.norm(V.add(fc.sh, d));
      return { d, dn: V.sub(n, fc.n0), up: Math.max(0.05, V.dot(d, fc.n0)) };
    }
    const stepLoss = (ti, dnj, sHat) => { const st = V.dot(V.add(ti.dn, dnj), sHat), al = V.dot(ti.d, sHat); return st > 0 && al > 0 ? 0.5 * st * al / ti.up : 0; };
    const MG = 10;
    function reachOf(lay, fc) {
      const m = new Float32Array(MG * MG), f = lay.f, starts = [fc.P].concat(fc.pts3.map((p) => V.lerp(fc.P, p, 0.85)));
      for (let jj = 0; jj < MG; jj++) for (let ii = 0; ii < MG; ii++) {
        const Z = uvToWorld(pu0 + (ii + 0.5) / MG * (pu1 - pu0), pv0 + (jj + 0.5) / MG * (pv1 - pv0)); let ok = 1;
        for (const X of starts) {
          const d = V.norm(V.sub(Z, X)), x = V.sub(X, L), xa = V.dot(x, A), da = V.dot(d, A), xp = V.madd(x, A, -xa), dp = V.madd(d, A, -da), dd = V.dot(dp, dp);
          if (!(dd > 1e-12)) continue;
          const s2 = -(2 * V.dot(xp, dp) - 4 * f * da) / dd; if (!(s2 > 1e-3)) continue;
          const X2 = V.madd(x, d, s2), key = Math.floor(V.dot(X2, e1) / lay.g) + ',' + Math.floor(V.dot(X2, e2) / lay.g);
          if (key !== fc.key && lay.cellSet.has(key)) { ok = 0; break; }
        }
        if (ok) { const ti = tiltOf(fc, Z); let B = 0; for (const sh of fc.sdir) B += stepLoss(ti, ti.dn, sh); ok = clamp(1 - B, 0.1, 1); }
        m[jj * MG + ii] = ok;
      }
      return m;
    }
    const SUB = 3;
    function buildFacets(f) {
      let g = Math.max(0.2, Math.sqrt(Math.PI * Rmax * Rmax / maxFacets) * 0.12), guard = 0;
      while (cellsFor(f, g, true) > maxFacets && guard++ < 400) g *= 1.025;
      const facets = cellsFor(f, g, false).map((c, idx) => {
        const q = c.q, bil = (s, t) => [(1 - s) * (1 - t) * q[0][0] + s * (1 - t) * q[1][0] + s * t * q[2][0] + (1 - s) * t * q[3][0], (1 - s) * (1 - t) * q[0][1] + s * (1 - t) * q[1][1] + s * t * q[2][1] + (1 - s) * t * q[3][1]];
        const area = 0.5 * Math.abs((q[2][0] - q[0][0]) * (q[3][1] - q[1][1]) - (q[3][0] - q[1][0]) * (q[2][1] - q[0][1]));
        const subs = []; let flux = 0; const pc = bil(0.5, 0.5), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
        for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) {
          const qq = bil((a + 0.5) / SUB, (b + 0.5) / SUB), Q = baseAt(f, qq[0], qq[1]), d = V.sub(Q, L), r = V.len(d), dir = V.mul(d, 1 / r);
          const w = lim.reflectivity * led.inten(dir) * (area / (SUB * SUB)) / (r * r);     // aperture area = r² dΩ on a confocal paraboloid
          if (w > 0) { subs.push({ Q, w, dir }); flux += w; }
        }
        const P0 = baseAt(f, pc[0], pc[1]), sh0 = V.norm(V.sub(L, P0)), t1 = V.norm(V.madd(e1, A, pc[0] / (2 * f))), t2 = V.norm(V.madd(e2, A, pc[1] / (2 * f)));
        const fc = { id: 'F' + idx, key: c.key, ab: c.key.split(',').map(Number), sh: sh0, n0: V.norm(V.add(sh0, A)), sdir: [t1, V.neg(t1), t2, V.neg(t2)], P: baseAt(f, pc[0], pc[1]), pts3: q.map((c2) => baseAt(f, c2[0], c2[1])), subs, flux, g1: Math.max(...xs) - Math.min(...xs), g2: Math.max(...ys) - Math.min(...ys) };
        if (!(flux > 0)) return fc;
        let a = 0, w = 0; for (const s of stampsOf(fc, aimC)) { a += s.w * Math.abs(s.p1[0] * s.p2[1] - s.p1[1] * s.p2[0]); w += s.w; }
        fc.dim = Math.sqrt(a / Math.max(1e-30, w));                     // blob size (mm on the target)
        return fc;
      }).filter((fc) => fc.flux > 0 && fc.dim > 0);
      let flux = 0; const dims = []; for (const fc of facets) { flux += fc.flux; dims.push(fc.dim); }
      dims.sort((a, b) => a - b);
      const lay = { f, g, facets, flux, medDim: dims.length ? dims[dims.length >> 1] : 0, cellSet: new Set(facets.map((fc) => fc.key)), byKey: new Map(facets.map((fc) => [fc.key, fc])) };
      for (const fc of facets) fc.reach = reachOf(lay, fc);
      return lay;
    }

    // ------------------------------------------------------------------ the mosaic fit
    // mode: 'quick' (rank a depth: greedy + 3 sweeps) · 'main' (greedy + full descent) · 'polish' (start from the aims a
    // coarser fit left on the facets, a few fine sweeps)
    function fit(lay, G, mode) {
      const quick = mode === 'quick', polish = mode === 'polish';
      const facets = lay.facets, { R, nP, paint, tl, th, mid, allow, wCell, typ, wP } = G, wQ = PULL * wP;
      const ss = clamp(Math.ceil((quick ? 3.2 : 4.5) / Math.max(0.05, lay.medDim / G.cell)), 1, Math.max(1, Math.min(4, Math.floor(360 / R))));
      const nF = R * ss, hf = G.cell / ss, fineToWorld = (zx, zy) => uvToWorld(-T.half + zx * hf, -T.half + zy * hf);
      const S = Float64Array.from(G.S0);
      let c = 1, inv = new Float64Array(nP), al = new Float64Array(nP), invR = 1;
      const setC = (cc) => { c = cc; invR = 1 / (0.3 * c * typ); for (let k = 0; k < nP; k++) { if (paint[k] > 0) inv[k] = 1 / (c * paint[k]); else al[k] = c * allow[k]; } };
      const cellLoss = (k, s) => {
        if (inv[k] > 0) { const x = s * inv[k]; let l = wQ * (x - mid[k]) * (x - mid[k]) - MU * s; let z = (tl[k] - x) * 5; if (z > 0) l += wP * (z < 1 ? z * z : 2 * z - 1); else { z = (x - th[k]) * 4; if (z > 0) l += wP * (z < 1 ? z * z : 2 * z - 1); } return l; }
        const z = (s - al[k]) * invR; return z > 0 ? wCell[k] * (z < 1 ? z * z : 2 * z - 1) : 0;
      };
      const totalLoss = () => { let t = 0; for (let k = 0; k < nP; k++) t += cellLoss(k, S[k]); return t; };
      const fitC = () => { let best = Infinity, bc = c; const c0 = c; for (let e = -8; e <= 8; e++) { setC(c0 * Math.pow(1.03, e)); const t = totalLoss(); if (t < best) { best = t; bc = c; } } setC(bc); relax(); return best; };

      // A blob lives on the fine grid; what the loss needs is its footprint on PAINT cells, which depends only on the
      // blob's sub-cell phase.  One small paint-resolution raster per phase, made on first use.
      let ops = 0; const OPS = quick ? 2.5e6 : polish ? 8e6 : 1.4e7;      // work budget (cells evaluated): keeps odd scenes fast, and deterministic
      const L0 = new Float64Array(nP);                                  // cellLoss(k, S[k]), kept current
      const relax = () => { for (let k = 0; k < nP; k++) L0[k] = cellLoss(k, S[k]); };
      function phaseOf(K, px, py) {
        const key = py * ss + px, hit = K.ph[key]; if (hit) return hit;
        const x0 = Math.floor((px + K.x0) / ss), y0 = Math.floor((py + K.y0) / ss), W = Math.floor((px + K.x0 + K.W - 1) / ss) - x0 + 1, H = Math.floor((py + K.y0 + K.H - 1) / ss) - y0 + 1, buf = new Float64Array(W * H);
        for (let j = 0; j < K.H; j++) { const row = (Math.floor((py + K.y0 + j) / ss) - y0) * W; for (let i = 0; i < K.W; i++) { const v = K.buf[j * K.W + i]; if (v > 0) buf[row + Math.floor((px + K.x0 + i) / ss) - x0] += v; } }
        return (K.ph[key] = { x0, y0, W, H, buf });
      }
      function deltaAt(K, zx, zy, e) {
        const cx = Math.floor(zx / ss), cy = Math.floor(zy / ss), F = phaseOf(K, zx - cx * ss, zy - cy * ss), buf = F.buf; let d = 0; ops += F.W * F.H;
        const i0 = Math.max(0, -(cx + F.x0)), i1 = Math.min(F.W, R - cx - F.x0);
        for (let j = 0; j < F.H; j++) {
          const Y = cy + F.y0 + j; if (Y < 0 || Y >= R) continue; const row = j * F.W, base = Y * R + cx + F.x0;
          for (let i = i0; i < i1; i++) { const v = buf[row + i]; if (v > 0) { const k = base + i; d += cellLoss(k, S[k] + e * v) - L0[k]; } }
        }
        return d;
      }
      function apply(K, zx, zy, sign) {
        const cx = Math.floor(zx / ss), cy = Math.floor(zy / ss), F = phaseOf(K, zx - cx * ss, zy - cy * ss), buf = F.buf;
        const i0 = Math.max(0, -(cx + F.x0)), i1 = Math.min(F.W, R - cx - F.x0);
        for (let j = 0; j < F.H; j++) {
          const Y = cy + F.y0 + j; if (Y < 0 || Y >= R) continue; const row = j * F.W, base = Y * R + cx + F.x0;
          for (let i = i0; i < i1; i++) { const v = buf[row + i]; if (v > 0) { const k = base + i; S[k] = Math.max(0, S[k] + sign * v); L0[k] = cellLoss(k, S[k]); } }
        }
      }
      const footprint = (K, zx, zy, e) => {                                // [[paintCell, flux]…] of a placed blob
        const cx = Math.floor(zx / ss), cy = Math.floor(zy / ss), F = phaseOf(K, zx - cx * ss, zy - cy * ss), out = [];
        for (let j = 0; j < F.H; j++) { const Y = cy + F.y0 + j; if (Y < 0 || Y >= R) continue; for (let i = 0; i < F.W; i++) { const X = cx + F.x0 + i, v = F.buf[j * F.W + i]; if (v > 0 && X >= 0 && X < R) out.push([Y * R + X, e * v]); } }
        return out;
      };

      function rasterise(fc, Zw) {                                      // the focused blob, then the spread one
        const st = stampsOf(fc, Zw); let hx = 1, hy = 1;
        for (const s of st) { hx = Math.max(hx, (Math.abs(s.p1[0]) + Math.abs(s.p2[0])) / 2 / hf); hy = Math.max(hy, (Math.abs(s.p1[1]) + Math.abs(s.p2[1])) / 2 / hf); }
        const x0 = -Math.ceil(hx) - 1, y0 = -Math.ceil(hy) - 1, W = -2 * x0, H = -2 * y0, buf = new Float32Array(W * H);
        for (const s of st) fillShape(buf, W, H, x0, y0, 0, 0, s.p1[0] / hf, s.p1[1] / hf, s.p2[0] / hf, s.p2[1] / hf, s.w, s.round);
        fc.K0 = { x0, y0, W, H, buf, ph: [] }; fc.cache = {};
      }
      const blobOf = (fc, j1, j2) => { if (!j1 && !j2) return fc.K0; const key = j1 * 64 + j2; return fc.cache[key] || (fc.cache[key] = boxConv(fc.K0, j1 * fc.dw / hf, j2 * fc.dw / hf)); };
      const JMAX = 12;

      const mgU = MG / (pu1 - pu0), mgV = MG / (pv1 - pv0);
      // share of the facet's light that gets out when aimed at (zx, zy): 0 = blocked.  fc.fix (set once the neighbours' aims
      // are known) replaces the equal-neighbours estimate.
      const gain = (fc, zx, zy) => { const g = fc.reach[clamp(Math.floor((zy * hf - T.half - pv0) * mgV), 0, MG - 1) * MG + clamp(Math.floor((zx * hf - T.half - pu0) * mgU), 0, MG - 1)]; return g > 0 && fc.fix > 0 ? fc.fix : g; };
      const [bx0, bx1, by0, by1] = G.box, NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
      const stMin = Math.sqrt((bx1 - bx0) * (by1 - by0) * ss * ss / 160);   // at most ~160 coarse candidates per search
      function bestGlobal(fc, K) {
        const st = Math.max(1, Math.round(Math.max(Math.min(fc.dim / hf / 2.5, 10 * ss), stMin)));
        let best = Infinity, bxy = null;
        for (let y = by0 * ss + (st >> 1); y <= by1 * ss; y += st) for (let x = bx0 * ss + (st >> 1); x <= bx1 * ss; x += st) {
          if (!(paint[Math.min(R - 1, (y / ss) | 0) * R + Math.min(R - 1, (x / ss) | 0)] > 0)) continue;
          const e = gain(fc, x, y); if (!(e > 0)) continue;
          const d = deltaAt(K, x, y, e); if (d < best) { best = d; bxy = [x, y, e]; }
        }
        for (let h = st >> 1; bxy && h >= 1; h >>= 1) {                   // refine around the best coarse spot
          const [x0, y0] = bxy;
          for (const [dx, dy] of NB) { const x = clamp(x0 + dx * h, 0, nF), y = clamp(y0 + dy * h, 0, nF), e = gain(fc, x, y); if (!(e > 0)) continue; const d = deltaAt(K, x, y, e); if (d < best) { best = d; bxy = [x, y, e]; } }
          if (h <= Math.max(1, st >> 3)) break;
        }
        return { d: best, xy: bxy };
      }

      // 1. greedy: biggest blobs first, each where it helps most.  If the natural LED images would not overlap enough
      //    to blend (few, small blobs on a big painting), start them defocused.
      const order = facets.slice().sort((a, b) => b.dim - a.dim || (a.id < b.id ? -1 : 1));
      setC(0.8 * lay.flux / G.sp); relax();
      if (polish) {
        for (const fc of facets) { fc.dw = 0.5 * fc.dim; if (!fc.on) continue; fc.zx = clamp(Math.round((fc.u + T.half) / hf), 0, nF); fc.zy = clamp(Math.round((fc.v + T.half) / hf), 0, nF); rasterise(fc, fineToWorld(fc.zx, fc.zy)); fc.e = gain(fc, fc.zx, fc.zy) || 0.1; apply(blobOf(fc, fc.j1, fc.j2), fc.zx, fc.zy, fc.e); }
        for (const fc of facets) if (!fc.on) rasterise(fc, aimC);
        fitC(); fitC();
      } else {
        let areaSum = 0; for (const fc of facets) { fc.on = false; fc.j1 = fc.j2 = 0; fc.dw = 0.5 * fc.dim; rasterise(fc, aimC); areaSum += fc.dim * fc.dim; }
        const m0 = areaSum / (G.nPainted * G.cell * G.cell), j0 = m0 < MT ? clamp(Math.round(2 * (Math.sqrt(MT / m0) - 1)), 0, JMAX) : 0;
        for (const fc of order) { fc.j1 = fc.j2 = j0; const g = bestGlobal(fc, blobOf(fc, j0, j0)); if (g.xy && g.d < 0) { fc.on = true; fc.zx = g.xy[0]; fc.zy = g.xy[1]; fc.e = g.xy[2]; apply(blobOf(fc, j0, j0), fc.zx, fc.zy, fc.e); } }
        fitC();
      }

      // 2. coordinate descent: move, re-spread, drop or re-place one blob at a time
      const SP = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
      function sweep(step, relocate, spread) {
        let moved = 0;
        for (const fc of order) {
          if (ops > OPS) break;
          let K = blobOf(fc, fc.j1, fc.j2);
          if (fc.on) apply(K, fc.zx, fc.zy, -fc.e);
          let best = 0, bx = null, by = null, be = 0, b1 = fc.j1, b2 = fc.j2;    // 0 = leave it off
          if (fc.on) {
            const d0 = deltaAt(K, fc.zx, fc.zy, fc.e); if (d0 < best) { best = d0; bx = fc.zx; by = fc.zy; be = fc.e; }
            for (const [dx, dy] of NB) { const x = clamp(fc.zx + dx * step, 0, nF), y = clamp(fc.zy + dy * step, 0, nF), e = gain(fc, x, y); if (!(e > 0)) continue; const d = deltaAt(K, x, y, e); if (d < best - 1e-12) { best = d; bx = x; by = y; be = e; } }
            if (spread) for (const [d1, d2] of SP) {
              const j1 = fc.j1 + d1, j2 = fc.j2 + d2; if (j1 < 0 || j2 < 0 || j1 > JMAX || j2 > JMAX) continue;
              const d = deltaAt(blobOf(fc, j1, j2), fc.zx, fc.zy, fc.e); if (d < best - 1e-12) { best = d; bx = fc.zx; by = fc.zy; be = fc.e; b1 = j1; b2 = j2; }
            }
          }
          if (!fc.on || relocate) { const g = bestGlobal(fc, K); if (g.xy && g.d < best - 1e-9) { best = g.d; bx = g.xy[0]; by = g.xy[1]; be = g.xy[2]; b1 = fc.j1; b2 = fc.j2; } }
          if (bx === null) { if (fc.on) moved++; fc.on = false; continue; }
          if (!fc.on || bx !== fc.zx || by !== fc.zy || b1 !== fc.j1 || b2 !== fc.j2) moved++;
          fc.on = true; fc.zx = bx; fc.zy = by; fc.e = be; fc.j1 = b1; fc.j2 = b2; apply(blobOf(fc, b1, b2), bx, by, be);
        }
        return moved;
      }
      const reshape = () => { S.set(G.S0); relax(); for (const fc of facets) if (fc.on) { rasterise(fc, fineToWorld(fc.zx, fc.zy)); apply(blobOf(fc, fc.j1, fc.j2), fc.zx, fc.zy, fc.e); } };
      const sweeps = quick ? 3 : polish ? 6 : (settings.sweeps >= 0 ? settings.sweeps | 0 : 20);
      let step = polish ? 1 : Math.max(1, Math.round(lay.medDim / hf / 4));
      if (mode === 'main') { reshape(); fitC(); }
      for (let it = 0; it < sweeps; it++) {
        const moved = sweep(step, mode === 'main' && it % 6 === 5, it % 2 === 1);
        fitC(); if (ops > OPS) break;
        if (mode === 'main' && it % 8 === 7) { reshape(); fitC(); }
        if (moved === 0 || it % 3 === 2) { if (step > 1) step = Math.max(1, step >> 1); else if (moved === 0 && it % 2 === 1) break; }
      }
      if (mode === 'main') { reshape(); fitC(); }

      let onPaint = 0, placed = 0; for (let k = 0; k < nP; k++) if (paint[k] > 0) onPaint += S[k];
      for (const fc of facets) if (fc.on) { placed++; fc.u = -T.half + fc.zx * hf; fc.v = -T.half + fc.zy * hf; fc.W1 = fc.j1 * fc.dw; fc.W2 = fc.j2 * fc.dw; }
      // what the app's own fidelity makes of the model's picture
      let fid = null;
      try { const fd = RF.Photometry.fidelity({ source: src, envelope: env, target: Object.assign({}, tgt, { res: R }), modeA: { paint: Array.from(paint) } }, { res: R, power: 1 }, { gridD: S, gridR: new Float64Array(nP), N: 1e7, E: { emitted: 1 } }); fid = fd ? fd.fidelity : null; } catch (e) { fid = null; }
      if (fid === null) fid = clamp(1 - 0.5 * (totalLoss() + MU * onPaint), 0, 1);
      return { S, c, ss, hf, onPaint, placed, fid, fpOf: (fc) => footprint(blobOf(fc, fc.j1, fc.j2), fc.zx, fc.zy, fc.e), intentOf: (fc) => { const fp = footprint(blobOf(fc, fc.j1, fc.j2), fc.zx, fc.zy, fc.e); let mx = 0; for (const e of fp) mx = Math.max(mx, e[1]); return fp.filter((e) => e[1] > 0.25 * mx).map((e) => [e[0], +(e[1] / mx).toFixed(3)]); } };
    }

    // ------------------------------------------------------------------ pick the paraboloid's depth
    const fLo = keepM + 0.2, fHi = Math.max(fLo * 1.01, Rmax / 2);
    let lay = null, tried = [], Gq = null;
    const coarseFor = (dim) => makeGrid(clamp(Math.round(R0 * 4 / Math.max(1e-6, dim / (2 * T.half / R0))), Math.min(R0, 24), R0));   // LED image ≈ 4 cells wide
    if (settings.focal > 0) { lay = buildFacets(clamp(settings.focal, fLo, fHi)); if (lay.facets.length) Gq = coarseFor(lay.medDim); }
    else {
      const NC = 9, fs = []; for (let i = 0; i < NC; i++) fs.push(fLo * Math.pow(fHi / fLo, i / (NC - 1)));
      const lays = fs.map((f) => null), get = (i) => lays[i] || (lays[i] = buildFacets(fs[i]));
      let minDim = Infinity; for (let i = 0; i < NC; i += 2) { const l = get(i); if (l.facets.length) minDim = Math.min(minDim, l.medDim); }
      if (!isFinite(minDim)) return { surfaces: [], intent: [], notes: ['no usable reflector position inside the envelope'] };
      Gq = coarseFor(minDim);
      const score = new Array(NC).fill(null);
      const evalF = (i) => { if (score[i] !== null) return score[i]; const l = get(i); if (!l.facets.length) return (score[i] = -1); const r = fit(l, Gq, 'quick'); const F = r.fid; score[i] = F + clamp((F - 0.5) / 0.25, 0, 1) * LAM * r.onPaint; tried.push(fs[i].toFixed(1) + ':' + score[i].toFixed(3)); return score[i]; };
      let bi = 0; for (let i = 0; i < NC; i += 2) if (evalF(i) > evalF(bi)) bi = i;
      for (const i of [bi - 1, bi + 1]) if (i >= 0 && i < NC && evalF(i) > evalF(bi)) bi = i;
      lay = get(bi);
    }
    if (!lay.facets.length) return { surfaces: [], intent: [], notes: ['no usable reflector position inside the envelope'] };
    const tQ = Date.now(), G = Gq.R === R0 ? Gq : makeGrid(R0);
    let res = fit(lay, Gq, 'main');
    // now that every facet has an aim, the steps between neighbours are known: fix each facet's surviving share, re-fit finely
    const NBR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const fixLosses = () => {
      for (const fc of lay.facets) fc.ti = fc.on ? tiltOf(fc, uvToWorld(fc.u, fc.v)) : null;
      for (const fc of lay.facets) {
        if (!fc.on) { fc.fix = 0; continue; }
        let B = 0;
        for (const [da, db] of NBR) { const nb = lay.byKey.get((fc.ab[0] + da) + ',' + (fc.ab[1] + db)); if (nb && nb.on) B += stepLoss(fc.ti, nb.ti.dn, V.norm(V.sub(nb.P, fc.P))); }
        fc.fix = clamp(1 - B, 0.1, 1);
      }
    };
    if (num(settings.steps, 1) > 0) { fixLosses(); res = fit(lay, G, 'polish'); fixLosses(); res = fit(lay, G, 'polish'); }
    else if (G !== Gq) res = fit(lay, G, 'polish');

    // ------------------------------------------------------------------ output
    // A facet is tilted off the paraboloid toward its own aim, so the paraboloid's cell corners are not on it.  Put each
    // corner where the LED ray through that cell corner meets the REAL mirror: the facet then covers exactly the cone
    // of LED directions the model gave it, and neighbours neither shadow each other nor leave a gap (seen from the LED).
    const mk = (fc, shrink) => {
      const Z = uvToWorld(fc.u, fc.v), D = V.dist(Z, fc.P), base = shrink < 1 ? fc.pts3.map((p) => V.lerp(fc.P, p, shrink)) : fc.pts3;
      const s = { type: 'facet', id: fc.id, group: 'A', P: fc.P, S0: L.slice(), Z, flat: false, di: D, clip: { kind: 'poly', pts3: base.map((p) => V.lerp(fc.P, p, 1.6)) }, optics: { interaction: 'reflect', reflectivity: lim.reflectivity, twoSided: false } };
      if (fc.W1 > 0 || fc.W2 > 0) { s.vg = [(1 - fc.W1 / Math.max(1e-6, fc.g1)) / D, (1 - fc.W2 / Math.max(1e-6, fc.g2)) / D]; s.ax = e1.slice(); }
      let pts3 = base;
      try {
        const C = RF.Geo.compile([s]);
        pts3 = base.map((p) => { const u = V.norm(V.sub(p, L)), t = RF.Geo.intersect(C.D, C.poly, 0, L[0], L[1], L[2], u[0], u[1], u[2], 1e-9, Infinity); return t > 0 && isFinite(t) && Math.abs(t - V.dist(p, L)) < 0.5 * V.dist(p, L) ? V.madd(L, u, t) : p; });
      } catch (e) { pts3 = base; }
      s.clip = { kind: 'poly', pts3 };
      return s;
    };
    let used = lay.facets.filter((fc) => fc.on).map((fc) => ({ fc, shrink: 1 }));
    // the host's own check of the hard limits (envelope, LED clearance) on the real curved surfaces: shrink, then drop, offenders
    try {
      const pseudo = { source: src, emitters: (input.sources || []).slice(1), envelope: env, target: tgt, modeA: { budget: maxFacets } };
      for (let round = 0; round < 8; round++) {
        const f = RF.Solvers.verify(pseudo, { surfaces: used.map((x) => mk(x.fc, x.shrink)) });
        const bad = new Set(f.violations.envelope.concat(f.violations.keepOut)); if (!bad.size) break;
        for (const x of used) if (bad.has(x.fc.id)) x.shrink *= 0.8;
        used = used.filter((x) => x.shrink > 0.3);
      }
    } catch (e) { notes.push('self-check skipped: ' + e.message); }
    const surfaces = used.slice(0, maxFacets).map((x) => mk(x.fc, x.shrink)), intent = used.slice(0, maxFacets).map((x) => ({ facet: x.fc.id, cells: res.intentOf(x.fc) }));
    const nSpread = used.filter((x) => x.fc.W1 > 0 || x.fc.W2 > 0).length;
    notes.push(surfaces.length + ' of ' + lay.facets.length + ' facets used on a paraboloid f = ' + lay.f.toFixed(1) + ' mm (pitch ' + lay.g.toFixed(1) + ' mm); LED image ≈ ' + (lay.medDim / G.cell).toFixed(1) + ' cells, ' + nSpread + ' defocused; model: fidelity ' + (100 * res.fid).toFixed(0) + '%, ' + (100 * res.onPaint).toFixed(0) + '% of the LED light on the paint');
    if (tried.length) notes.push('depths tried (f mm : model score): ' + tried.join('  '));
    const out = { surfaces, intent, notes };
    if (settings.debug) out.timing = { pick: tQ - t00, fit: Date.now() - tQ };
    if (settings.debug) out.debug = { S: Array.from(res.S), c: res.c, ss: res.ss, f: lay.f, blobs: used.map((x) => ({ id: x.fc.id, flux: x.fc.flux * x.fc.e, W: [x.fc.W1, x.fc.W2], g: [x.fc.g1, x.fc.g2], dim: x.fc.dim, fp: res.fpOf(x.fc) })) };
    return out;
  }

  RF.Solvers.register({
    id: 'mosaic', name: 'Mosaic (LED-image placement)', version: '0.2', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'focal', label: 'Reflector focal length (mm, 0 = choose)', type: 'number', min: 0, max: 500, step: 0.5, default: 0 },
      { key: 'margin', label: 'Tolerance margin', type: 'number', min: 0, max: 0.2, step: 0.01, default: 0.1 },
      { key: 'light', label: 'Weight of light on the paint', type: 'number', min: 0, max: 5, step: 0.05, default: 0.5 },
      { key: 'depthLight', label: 'Weight of light when choosing depth', type: 'number', min: 0, max: 5, step: 0.05, default: 0.5 },
      { key: 'overlap', label: 'Blend overlap to start from', type: 'number', min: 0, max: 10, step: 0.25, default: 2.5 },
      { key: 'sweeps', label: 'Refinement sweeps', type: 'range', min: 0, max: 60, step: 1, default: 24 },
    ],
    solve(input, settings) { return solve(input, settings || {}); },
  });
})();
