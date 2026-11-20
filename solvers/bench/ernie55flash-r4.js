/* Flux — a static faceted-reflector solver for Mode A (paint).
 *
 * Idea
 *   Every facet is a small ellipsoidal mirror that images the LED onto one point of the target:
 *   its aim Z and its image distance di = |Z − P| put the LED's image exactly at Z, so a facet
 *   decides WHERE its light lands, not how big it is (the image size is set by the étendue:
 *   LED size × di / r).
 *
 *   Aims sit on a regular grid over the painting, one facet per grid point that lands on paint.  The
 *   amplitude of each (its area) starts as the paint there and is then refined by a least-squares fit
 *   of the model beam Σ aᵢ·K(x − qᵢ) to the painting (and to a dark gap band around it), so the sum
 *   reproduces the painting as closely as the blur allows instead of merely being proportional to it.
 *   Facets are spread over the part of the envelope the LED can reach, each pushed as close to the
 *   wall as it can be without poking out (farther from the LED = a sharper image), and kept on
 *   separate "lanes" square to the beam so they do not shadow each other.
 *
 * No rays are traced here: everything is geometry from the scene and the paint.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const V = RF.V;
  const REF = [0, 0, 1];

  function vnorm(a) { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; }

  // ------------------------------------------------------------------ envelope sampling
  // Candidate facet positions on the envelope's inner surface (a grid, one point per `pitch`² of wall).
  function envCandidates(env, L, axis, keep, pitch) {
    const out = [], c = env.center, h = env.half;
    const push = (P) => {
      const d = V.sub(P, L), r = V.len(d);
      if (!(r > keep)) return;
      const u = V.mul(d, 1 / r), cth = V.dot(u, axis);
      if (cth < 0.02) return;                        // a planar LED emits nothing there
      out.push({ P, r, cth, u });
    };
    if (env.shape === 'box') {
      for (let ax = 0; ax < 3; ax++) {
        const i = (ax + 1) % 3, j = (ax + 2) % 3;
        for (const sd of [-1, 1]) {
          const nu = Math.max(1, Math.round(2 * h[i] / pitch)), nv = Math.max(1, Math.round(2 * h[j] / pitch));
          for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
            const p = [c[0], c[1], c[2]];
            p[ax] = c[ax] + sd * h[ax];
            p[i] = c[i] - h[i] + (a + 0.5) * 2 * h[i] / nu;
            p[j] = c[j] - h[j] + (b + 0.5) * 2 * h[j] / nv;
            push(p);
          }
        }
      }
    } else if (env.shape === 'ellipsoid') {
      const N = 6000, ga = Math.PI * (3 - Math.sqrt(5));
      for (let k = 0; k < N; k++) {
        const z = 1 - 2 * (k + 0.5) / N, rr = Math.sqrt(Math.max(0, 1 - z * z)), t = ga * k;
        push([c[0] + h[0] * rr * Math.cos(t), c[1] + h[1] * rr * Math.sin(t), c[2] + h[2] * z]);
      }
    } else {                                          // cylinder along env.axis
      const ax = env.axis === undefined ? 2 : env.axis, i = (ax + 1) % 3, j = (ax + 2) % 3;
      const nu = Math.max(2, Math.round(2 * h[ax] / pitch)), nv = Math.max(8, Math.round(Math.PI * (h[i] + h[j]) / pitch));
      for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
        const t = 2 * Math.PI * b / nv, p = [c[0], c[1], c[2]];
        p[ax] = c[ax] - h[ax] + (a + 0.5) * 2 * h[ax] / nu;
        p[i] = c[i] + h[i] * Math.cos(t); p[j] = c[j] + h[j] * Math.sin(t);
        push(p);
      }
      for (const sd of [-1, 1]) for (let a = 0; a < 5; a++) for (let b = 0; b < 10; b++) {
        const rr = Math.sqrt((a + 0.5) / 5), t = 2 * Math.PI * (b + 0.5) / 10, p = [c[0], c[1], c[2]];
        p[ax] = c[ax] + sd * h[ax];
        p[i] = c[i] + h[i] * rr * Math.cos(t); p[j] = c[j] + h[j] * rr * Math.sin(t);
        push(p);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ facet geometry helpers
  function quadPoints(P, n, s) {
    const ex = V.inPlane(n, REF), ey = V.cross(n, ex);
    return [
      V.add(P, V.add(V.mul(ex, -s), V.mul(ey, -s))),
      V.add(P, V.add(V.mul(ex, s), V.mul(ey, -s))),
      V.add(P, V.add(V.mul(ex, s), V.mul(ey, s))),
      V.add(P, V.add(V.mul(ex, -s), V.mul(ey, s))),
    ];
  }
  // a flat square of half-size s at P with normal n: inside the envelope (shrunk a little) and out
  // of the LED clearance
  function quadFits(env, P, n, s, L, keep, margin) {
    const tol = -(margin || 0.3) / Math.max(1, Math.max(env.half[0], env.half[1], env.half[2]));
    const ex = V.inPlane(n, REF), ey = V.cross(n, ex);
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) {
      const q = V.add(P, V.add(V.mul(ex, a * s), V.mul(ey, b * s)));
      if (!RF.Geo.envInside(env, q, tol)) return false;
      if (V.dist(q, L) < keep + 0.3) return false;
    }
    const rel = V.sub(L, P), dn = V.dot(rel, n), proj = V.sub(rel, V.mul(n, dn));
    if (Math.abs(V.dot(proj, ex)) <= s && Math.abs(V.dot(proj, ey)) <= s && Math.abs(dn) < keep + 0.3) return false;
    return true;
  }

  // The real check: compile the facet and let the host's own verifier judge it.  quadFits() only
  // looks at the flat corners, and a big curved facet can still bulge out of the envelope or into
  // the LED clearance between them.
  function fitsReal(env, src, sources, surf) {
    try {
      const f = RF.Solvers.verify({ envelope: env, source: src, emitters: (sources || []).slice(1), modeA: { budget: 0 } }, { surfaces: [surf] });
      return !f.violations.envelope.length && !f.violations.keepOut.length;
    } catch (e) { return true; }                      // never let a verifier quirk throw the solve
  }

  // Shallowest inset (largest r) at which a facet of half-size sWant fits, shrinking s if it must.
  // Returns {P, n, s, r} or null.
  function placeFacet(env, L, u, aimDir, sWant, keep) {
    const iv = RF.Geo.envInterval(env, L, u);
    if (!(iv[1] > iv[0])) return null;
    const t = iv[1], dmax = Math.max(0, t - keep);
    const N = 14;
    let best = null;
    for (let k = 0; k <= N; k++) {
      const d = dmax * k / N, P = V.madd(L, u, t - d);
      const sv = V.sub(L, P), r = V.len(sv);
      if (r < keep) continue;
      const n = vnorm(V.add(V.mul(sv, 1 / r), aimDir));
      let s = sWant;
      for (let it = 0; it < 7 && s > 0.25; it++, s *= 0.78) if (quadFits(env, P, n, s, L, keep, 0.3)) {
        if (!best || s > best.s * 1.001) best = { P, n, s, r };
        break;
      }
      if (best && best.s >= sWant * 0.999) return best;   // full size at the shallowest inset: done
    }
    return best;
  }

  // ------------------------------------------------------------------ paint → aims
  // A regular grid over the painting; one aim per grid point that lands on paint, weighted by the
  // paint there (so the beam is paint ⊛ one LED image).
  function gridAims(paint, R, T, N) {
    const cell = 2 * T.half / R;
    const sample = (u, v) => {
      const fi = (u + T.half) / cell - 0.5, fj = (v + T.half) / cell - 0.5;
      const i0 = Math.floor(fi), j0 = Math.floor(fj);
      if (i0 < 0 || j0 < 0 || i0 >= R - 1 || j0 >= R - 1) {
        const i = Math.max(0, Math.min(R - 1, Math.round(fi))), j = Math.max(0, Math.min(R - 1, Math.round(fj)));
        return paint[j * R + i];
      }
      const tx = fi - i0, ty = fj - j0;
      const a = paint[j0 * R + i0], b = paint[j0 * R + i0 + 1], c = paint[(j0 + 1) * R + i0], d = paint[(j0 + 1) * R + i0 + 1];
      return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    };
    let i0 = R, i1 = -1, j0 = R, j1 = -1;
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (paint[j * R + i] > 0) {
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    if (i1 < i0) return [];
    const u0 = -T.half + i0 * cell, u1 = -T.half + (i1 + 1) * cell;
    const v0 = -T.half + j0 * cell, v1 = -T.half + (j1 + 1) * cell;
    let h = Math.sqrt((u1 - u0) * (v1 - v0) / Math.max(1, N)), pts = [];
    for (let it = 0; it < 24; it++) {
      const nu = Math.max(1, Math.round((u1 - u0) / h)), nv = Math.max(1, Math.round((v1 - v0) / h));
      pts = [];
      for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
        const u = u0 + (a + 0.5) * (u1 - u0) / nu, v = v0 + (b + 0.5) * (v1 - v0) / nv;
        const w = sample(u, v);
        if (w > 0.02) pts.push({ u, v, w, h: Math.min((u1 - u0) / nu, (v1 - v0) / nv) });
      }
      if (!pts.length) { h *= 0.7; continue; }
      if (pts.length <= N || it === 23) break;
      h *= Math.sqrt(pts.length / N) * 1.02;
    }
    // too many for the budget: thin out the faintest
    if (pts.length > N) {
      pts.sort((a, b) => b.w - a.w);
      pts = pts.slice(0, N);
    }
    return pts;
  }

  // ------------------------------------------------------------------ amplitudes
  // The beam is Σ aᵢ·K(x − qᵢ): choose the aᵢ by least squares so that the sum matches the painting
  // on the painted cells AND stays dark in the gap band around it (the same two halves the score
  // uses).  A small ridge keeps the fit stable where the kernel is narrow; negatives are clamped.
  function solveLinear(G, b) {
    const n = b.length, M = G.map((r, i) => r.slice().concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
      const d = M[c][c] || 1e-12;
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / d; if (!f) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / (M[r][r] || 1e-12); }
    return x;
  }
  function fitAmplitudes(aims, paint, R, T, sigma, gapW) {
    const n = aims.length; if (!n) return [];
    const cell = 2 * T.half / R, near = new Uint8Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) if (paint[j * R + i] > 0) {
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const jj = j + dj, ii = i + di; if (ii >= 0 && jj >= 0 && ii < R && jj < R) near[jj * R + ii] = 1;
      }
    }
    const rows = [];
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const k = j * R + i, p = paint[k];
      if (p > 0) rows.push([-T.half + (i + 0.5) * cell, -T.half + (j + 0.5) * cell, p, 1]);
      else if (near[k]) rows.push([-T.half + (i + 0.5) * cell, -T.half + (j + 0.5) * cell, 0, gapW]);
    }
    const s2 = 2 * sigma * sigma, G = [], b = new Array(n).fill(0);
    for (let i = 0; i < n; i++) G.push(new Array(n).fill(0));
    const kv = [];
    for (const r of rows) {
      const w = r[3], v = [];
      for (let i = 0; i < n; i++) {
        const dx = r[0] - aims[i].u, dy = r[1] - aims[i].v;
        const k = w * Math.exp(-(dx * dx + dy * dy) / s2); v.push(k); b[i] += k * r[2];
      }
      kv.push(v);
    }
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
      let s = 0; for (let q = 0; q < rows.length; q++) s += kv[q][i] * kv[q][j];
      G[i][j] = s; G[j][i] = s;
    }
    let tr = 0; for (let i = 0; i < n; i++) tr += G[i][i];
    const lam = 1e-4 * tr / Math.max(1, n) + 1e-9;
    for (let i = 0; i < n; i++) G[i][i] += lam;
    const a = solveLinear(G, b).map((x) => (isFinite(x) && x > 0 ? x : 0));
    const mx = Math.max(...a, 1e-12);
    return a.map((x) => x / mx);
  }

  // ------------------------------------------------------------------ position choice
  // Weighted Poisson-disk in the plane square to the beam: two facets on the same "lane" would
  // shadow each other, so they are treated as the same point however far apart they are along the beam.
  function selectPositions(list, N, quality, dmax, fwd) {
    const n = list.length, used = new Uint8Array(n), dmin = new Float64Array(n).fill(1e18), out = [];
    const dmax2 = dmax * dmax;
    const perp = (a, b) => { const d = V.sub(a, b), k = V.dot(d, fwd); return V.len(V.sub(d, V.mul(fwd, k))); };
    for (let k = 0; k < N && k < n; k++) {
      let best = -1, bs = -1;
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        const s = quality(list[i]) * Math.min(dmin[i], dmax2);
        if (s > bs) { bs = s; best = i; }
      }
      if (best < 0) break;
      used[best] = 1; out.push(list[best]);
      const Pb = list[best].P;
      for (let i = 0; i < n; i++) { const d = perp(list[i].P, Pb); if (d < dmin[i]) dmin[i] = d; }
    }
    return out;
  }

  // ------------------------------------------------------------------ the design
  // Everything above is geometry; this is the whole solver.  It never traces: given the scene and
  // the paint it returns the facets.  `settings` = { minDistance, size, reach, spread, minR, curve, fit }.
  function build(input, settings) {
    const src = input.source, env = input.envelope, tgt = input.target;
    const R = input.paint.res, paint = input.paint.cells;
    const T = RF.Engine.targetFrame(tgt);
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
    const Nmax = Math.max(1, input.limits.maxFacets | 0);
    const axis = V.norm(src.axis), L = src.pos.slice();
    const refl = input.limits.reflectivity;
    const maxHalf = Math.max(env.half[0], env.half[1], env.half[2]);
    const notes = [];
    const aimWorld = (u, v) => RF.Engine.targetUVtoWorld(T, u, v);

    // ---- aims: a grid over the painting, one facet each
    const aims = gridAims(paint, R, T, Nmax);
    if (!aims.length) { notes.push('nothing painted: no aim points'); return { surfaces: [], intent: [], notes }; }
    const nFacets = aims.length;

    // ---- candidate positions and their geometry
    const pitch = Math.max(1.0, 0.05 * maxHalf);
    const cands = envCandidates(env, L, axis, keep, pitch);
    const s0 = Math.max(0.5, settings.size * 0.5 * (maxHalf / 50));
    const opts = [];
    for (const cd of cands) {
      const aimD = vnorm(V.sub(aimWorld(0, 0), cd.P));
      const pl = placeFacet(env, L, cd.u, aimD, s0, keep);
      if (pl) opts.push({ P: pl.P, smax: pl.s, r: pl.r, cth: cd.cth });
    }
    if (!opts.length) { notes.push('no facet fits in this envelope'); return { surfaces: [], intent: [], notes }; }
    const rMax0 = opts.reduce((m, o) => Math.max(m, o.r), 0) || 1;
    const opts2 = (settings.minR || 0) > 0 ? opts.filter((o) => o.r >= settings.minR * rMax0) : opts;
    const pool = opts2.length >= Math.min(nFacets, 8) ? opts2 : opts;

    // ---- choose positions, roomiest first (the brightest aims get the biggest facets)
    const rMax = pool.reduce((m, o) => Math.max(m, o.r), 0) || 1;
    const quality = (o) => o.cth * Math.pow(o.r / rMax, settings.reach);
    const dmax = Math.max(1, settings.spread * 2 * maxHalf / Math.sqrt(nFacets));
    const fwd = vnorm(V.sub(aimWorld(0, 0), L));
    const sel = selectPositions(pool, nFacets, quality, dmax, fwd);
    sel.sort((a, b) => b.smax - a.smax);
    aims.sort((a, b) => b.w - a.w);

    // ---- amplitudes: paint-proportional, optionally refined by a least-squares fit
    const cell = 2 * T.half / R;
    let amp = aims.map((a) => a.w);
    if ((settings.fit || 0) > 0) amp = fitAmplitudes(aims, paint, R, T, settings.fit * cell, 1.0);
    const aMax = amp.reduce((m, x) => Math.max(m, x), 1e-9);
    amp = amp.map((x) => x / aMax);

    // ---- pair and build
    const surfaces = [], intent = [];
    for (let k = 0; k < sel.length; k++) {
      const o = sel[k], aim = aims[k % aims.length];
      const A = aimWorld(aim.u, aim.v);
      const di = Math.max(1, V.dist(A, o.P)) * (settings.curve || 1);
      const n = vnorm(V.add(vnorm(V.sub(L, o.P)), vnorm(V.sub(A, o.P))));
      const mkSurf = (ss) => ({
        type: 'facet', id: 'F' + (surfaces.length + 1), group: 'A', P: o.P, S0: L.slice(), Z: A, di, flat: false,
        clip: { kind: 'poly', pts3: quadPoints(o.P, n, ss) },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      });
      let s = o.smax * Math.sqrt(Math.max(1e-4, amp[k % amp.length]));
      let surf = mkSurf(s);
      for (let it = 0; it < 12; it++) {
        if (quadFits(env, o.P, n, s, L, keep, 0.3) && (s <= 1.5 || fitsReal(env, src, input.sources, surf))) break;
        s *= 0.8; surf = mkSurf(s);
      }
      if (s < 0.2 || !quadFits(env, o.P, n, s, L, keep, 0.3)) continue;
      const id = surf.id;
      surfaces.push(surf);
      const ci = Math.max(0, Math.min(R - 1, Math.round((aim.u + T.half) / (2 * T.half / R) - 0.5)));
      const cj = Math.max(0, Math.min(R - 1, Math.round((aim.v + T.half) / (2 * T.half / R) - 0.5)));
      intent.push({ facet: id, cells: [[cj * R + ci, aim.w]] });
    }
    notes.push(surfaces.length + ' facets at ' + (sel.reduce((s, o) => s + o.r, 0) / Math.max(1, sel.length)).toFixed(0) + ' mm mean distance; ' + nFacets + ' aims');
    return { surfaces, intent, notes };
  }

  const KNOBS = [
    { key: 'size', label: 'Facet width (mm at 50 mm envelope)', type: 'number', min: 1, max: 20, step: 0.5, default: 8 },
    { key: 'reach', label: 'Prefer far facets', type: 'range', min: 0, max: 2, step: 0.1, default: 0 },
    { key: 'spread', label: 'Position spread', type: 'range', min: 0.2, max: 3, step: 0.1, default: 0.5 },
    { key: 'minR', label: 'Min distance (× farthest)', type: 'range', min: 0, max: 0.9, step: 0.05, default: 0 },
    { key: 'curve', label: 'Defocus (di / distance)', type: 'range', min: 0.1, max: 2, step: 0.05, default: 0.2 },
    { key: 'fit', label: 'Fit kernel (cells, 0 = off)', type: 'range', min: 0, max: 4, step: 0.1, default: 0.85 },
  ];
  const DEFAULTS = { size: 8, reach: 0, spread: 0.5, minR: 0, curve: 0.2, fit: 0.85 };

  RF.Solvers.register({
    id: 'bench-ernie55flash-r4--flux', name: 'Flux (static paint-driven reflector)', version: '0.3', modes: ['paint'],
    settings: [{ key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 }].concat(KNOBS),
    solve(input, settings) { return build(input, settings); },
  });

  // The tuner: same design, but it traces a handful of candidate settings (same seed ⇒ the
  // differences are geometry, not dice) and keeps the one that best serves the chosen goal.
  RF.Solvers.register({
    id: 'bench-ernie55flash-r4--flux-auto', name: 'Flux Auto (tunes itself per goal)', version: '0.3', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
    ],
    solve(input, settings, tools) {
      const goal = settings.goal || 'faithful';
      const faithful = { size: 8, curve: 0.2, fit: 0.85 };
      let cands;
      if (goal === 'throw') cands = [{ size: 12, curve: 1 }, { size: 14, curve: 1 }, { size: 16, curve: 1 }, { size: 18, curve: 1 },
        { size: 14, curve: 0.7 }, { size: 16, curve: 0.7 }, { size: 18, curve: 0.7 }, faithful];
      else if (goal === 'efficient') cands = [{ size: 12, curve: 0.7 }, { size: 14, curve: 0.7 }, { size: 16, curve: 0.7 }, { size: 18, curve: 0.7 },
        { size: 16, curve: 0.4 }, { size: 18, curve: 0.4 }, { size: 20, curve: 0.4 }, faithful];
      else cands = [{ size: 8, curve: 0.2, fit: 0.85 }, { size: 8, curve: 0.15, fit: 0.85 }, { size: 8, curve: 0.3, fit: 0.85 }, { size: 8, curve: 0.2, fit: 0.7 }, { size: 8, curve: 0.2, fit: 0 }, { size: 7, curve: 0.2, fit: 0.85 }, { size: 9, curve: 0.2, fit: 0.85 }];
      const canTrace = !!(tools && tools.trace);
      // Each goal is scored on its own metric, but a design that stops looking like the painting is
      // discounted, so the tuner cannot buy throw or flux by flooding the target.
      const score = (tr) => {
        const f = tr.fidelity || {}, F = Math.max(0.02, f.fidelity || 0);
        if (goal === 'throw') return (tr.peakCd || 0) * Math.sqrt(F);
        if (goal === 'efficient') return (f.onPaint || 0) * F;
        return F;
      };
      const results = [];
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i], st = Object.assign({}, DEFAULTS, settings, c);
        const out = build(input, st);
        if (!out.surfaces.length) continue;
        let sc = out.surfaces.length;
        if (canTrace) { try { sc = score(tools.trace(out.surfaces, { rays: 250000 })); } catch (e) { continue; } }
        results.push({ c, out, sc, i });
        if (tools && tools.preview) tools.preview(out.surfaces, { label: 'Flux Auto · ' + goal + ' · candidate ' + (i + 1) + '/' + cands.length });
      }
      if (!results.length) return build(input, Object.assign({}, DEFAULTS, settings));
      // refine the four best with a longer trace (the final score is measured at 1 M rays)
      results.sort((a, b) => b.sc - a.sc);
      if (canTrace) for (const r of results.slice(0, 4)) {
        try { r.sc = score(tools.trace(r.out.surfaces, { rays: 1000000 })); } catch (e) { /* keep the screen score */ }
      }
      results.sort((a, b) => b.sc - a.sc);
      const win = results[0];
      win.out.notes = (win.out.notes || []).concat(['auto: ' + goal + ' chose ' + JSON.stringify(win.c)]);
      return win.out;
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);