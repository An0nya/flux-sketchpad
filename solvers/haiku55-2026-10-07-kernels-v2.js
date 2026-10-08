/* haiku55 · solver-v2.js — kernel allocation, v0.1 (a copy of v0.2 with the tiler replaced).  No ray is traced.
 *
 * 1. Paint → kernels.  The paint, blurred by a box of `blur` × (smallest spot) cells, is fitted by square spots of
 *    several sizes (from the smallest the envelope can make up to the largest allowed).  Matching pursuit adds one spot at
 *    a time, up to the facet budget; after each pick every weight is refit (non-negative least squares).  Each spot is one
 *    facet, and its weight is the illuminance it delivers.
 * 2. Spot size.  An ideal ellipsoid with foci S0 (LED) and Z (aim) images the LED magnified by L ÷ d, where
 *    d = |P−S0| and L = |Z−P|.  A spot of side s needs d = lEff·L/s, lEff = lmax ÷ spotScale.
 * 3. Brightness.  A tile of area A at distance d and incidence φ catches I(θ)·A·cosφ/d² of the LED flux
 *    (Lambertian I = cosθ), reflects R of it, and spreads it over (lw·lh·L²/d²)/cosψ on the target.  The distance
 *    cancels: E = R·cosθ·cosφ·cosψ·A / (lw·lh·L²).  So A = c·mu·lw·lh·L² / (R·cosθ·cosφ·cosψ), mu = block mean.
 * 4. Placement.  Facets sit on the LED's emission cap.  Two separations keep every facet clear of the others:
 *    (a) angular, seen from the LED (no facet shadows another); (b) across the beam, in y–z (every beam runs roughly
 *    along +x, so a facet whose footprint overlaps another's would sit in its beam).  A first pass finds the largest
 *    common scale c at which every block fits.  A second, greedy pass then gives each facet as much of c·mu·K as its
 *    already-placed neighbours leave room for: a crowded facet dims, instead of dimming every facet.
 */
(function () {
  'use strict';
  const RF = globalThis.RF;
  const EPS = 1e-6, SQRT1_2 = Math.SQRT1_2, GOLDEN = 2.399963229728653, DIRS = 8000, SITES = 1200, MARGIN = 0.98;
  const CORNERS = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // two unit vectors perpendicular to n
  const perp = (n) => { const h = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], t1 = unit(cross(n, h)); return [t1, cross(n, t1)]; };

  RF.Solvers.register({
    id: 'haiku55-v2', name: 'Kernel allocation (haiku55 v2)', version: '0.1', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'blur', label: 'Paint blur before fitting (× smallest spot)', type: 'number', min: 0, max: 2, step: 0.05, default: 0 },
      { key: 'levels', label: 'Spot size levels', type: 'number', min: 1, max: 12, step: 1, default: 6 },
      { key: 'smax', label: 'Largest spot (× smallest spot)', type: 'number', min: 1, max: 16, step: 0.5, default: 2 },
      { key: 'grid', label: 'Kernel grid (positions per spot width)', type: 'number', min: 1, max: 16, step: 1, default: 8 },
      { key: 'pack', label: 'Packing radius (× tile side)', type: 'number', min: 0.2, max: 0.8, step: 0.01, default: 0.4 },
      { key: 'fill', label: 'Stack facets on each spot up to the budget (0/1)', type: 'number', min: 0, max: 1, step: 1, default: 0 },
      { key: 'spotScale', label: 'Spot size calibration', type: 'number', min: 0.5, max: 2, step: 0.01, default: 1 },
      { key: 'cmin', label: 'Min emission cos θ', type: 'number', min: 0.05, max: 0.9, step: 0.05, default: 0.25 },
      { key: 'win', label: 'Room for the smallest spot (sr)', type: 'number', min: 0.01, max: 4, step: 0.01, default: 2 },
      { key: 'grow', label: 'Tile growth over the common scale', type: 'number', min: 1, max: 32, step: 0.5, default: 1 },
      { key: 'minCphi', label: 'Min incidence cos φ (spot shape)', type: 'number', min: 0.05, max: 1, step: 0.01, default: 0.7 },
    ],
    solve(input, settings) {
      const env = input.envelope, src = input.source, T = RF.Engine.targetFrame(input.target);
      const S0 = src.pos.slice(), a = unit(src.axis), notes = [], surfaces = [], intent = [];
      const lw = src.shape === 'disc' ? 2 * src.radius : src.w, lh = src.shape === 'disc' ? 2 * src.radius : src.h;
      const lmax = Math.max(lw, lh), lEff = lmax / settings.spotScale;
      const PK = settings.pack;   // packing radius of a tile, in tile sides (√2/2 = circumscribed circle; smaller packs tighter)
      const R = input.limits.reflectivity, budget = input.limits.maxFacets;
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0, 1e-3);
      const res = input.paint.res, cells = input.paint.cells, cellmm = 2 * T.half / res;
      let pmax = 0;
      for (const x of cells) if (x > pmax) pmax = x;
      if (!(pmax > 0) || budget < 1) return { surfaces, intent, notes: ['nothing painted'] };
      const v = new Float64Array(res * res);
      for (let q = 0; q < res * res; q++) v[q] = Math.max(0, cells[q]) / pmax;

      // summed-area tables of v and v²: any block's mean and spread in O(1)
      const W = res + 1, S1 = new Float64Array(W * W), S2 = new Float64Array(W * W);
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const x = v[j * res + i];
        S1[(j + 1) * W + i + 1] = x + S1[j * W + i + 1] + S1[(j + 1) * W + i] - S1[j * W + i];
        S2[(j + 1) * W + i + 1] = x * x + S2[j * W + i + 1] + S2[(j + 1) * W + i] - S2[j * W + i];
      }
      const rect = (S, i0, j0, n) => S[(j0 + n) * W + i0 + n] - S[j0 * W + i0 + n] - S[(j0 + n) * W + i0] + S[j0 * W + i0];

      // candidate emission directions: equal-area golden spiral over the LED's emitting cap (cosθ ≥ cmin)
      const [e1, e2] = perp(a), dirs = [];
      for (let g = 0; g < DIRS; g++) {
        const c = 1 - (2 * g + 1) / DIRS;
        if (c < settings.cmin) continue;
        const ph = g * GOLDEN, r = Math.sqrt(1 - c * c);
        const u = unit([0, 1, 2].map((q) => c * a[q] + r * (Math.cos(ph) * e1[q] + Math.sin(ph) * e2[q])));
        dirs.push({ u, c, tout: RF.Geo.envInterval(env, S0, u)[1] });   // farthest point inside the envelope
      }
      const tmax = dirs.reduce((m, d) => Math.max(m, d.tout), 0);
      if (!(tmax > keep)) return { surfaces, intent, notes: ['no room for facets inside the envelope'] };
      const Lc = dist(S0, T.C);
      // solid angle of emission directions whose facet can sit at distance d (the envelope's room at that distance)
      const room = (d) => dirs.reduce((s, q) => s + (q.tout >= d ? 1 : 0), 0) * (4 * Math.PI / DIRS);
      // smallest spot the envelope can make with at least `win` sr of room; larger spots need far less room
      let nMin = 1;
      while (nMin < res && room(lEff * Lc / (nMin * cellmm)) < settings.win) nMin++;
      const nMax = Math.min(res, Math.max(nMin, Math.floor(lEff * Lc / keep / cellmm + 1e-9)));

      // target: the paint blurred by a box of `rad` cells (the scorer forgives edges to the smallest image's blur)
      const rad = Math.round(settings.blur * nMin), t = new Float64Array(res * res);
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        const i0 = Math.max(0, i - rad), i1 = Math.min(res, i + rad + 1), j0 = Math.max(0, j - rad), j1 = Math.min(res, j + rad + 1);
        t[j * res + i] = (S1[j1 * W + i1] - S1[j0 * W + i1] - S1[j1 * W + i0] + S1[j0 * W + i0]) / ((i1 - i0) * (j1 - j0));
      }
      const sat = (arr) => {
        const S = new Float64Array(W * W);
        for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) S[(j + 1) * W + i + 1] = arr[j * res + i] + S[j * W + i + 1] + S[(j + 1) * W + i] - S[j * W + i];
        return S;
      };
      const St = sat(t);
      // square kernels: several sizes from the smallest reachable spot up to the largest allowed, on a grid of step n/4
      const nTop = Math.min(nMax, Math.max(nMin, Math.round(settings.smax * nMin)));   // largest spot tried (bigger spots spill more)
      const sizes = [...new Set(Array.from({ length: settings.levels }, (_, q) => Math.round(nMin * Math.pow(nTop / nMin, settings.levels > 1 ? q / (settings.levels - 1) : 0))))];
      const kern = [];
      for (const n of sizes) {
        const st = Math.max(1, Math.round(n / settings.grid));
        for (let j0 = 0; j0 + n <= res; j0 += st) for (let i0 = 0; i0 + n <= res; i0 += st) {
          const b = rect(St, i0, j0, n);
          if (b > EPS) kern.push({ i0, j0, n, used: false });
        }
      }
      // matching pursuit: each step adds the kernel that best explains what is still unexplained, then every chosen
      // weight is refit jointly (non-negative least squares by coordinate descent on the Gram matrix)
      const sel = [], G = [], w = [];
      const overlap = (p, q) => Math.max(0, Math.min(p.i0 + p.n, q.i0 + q.n) - Math.max(p.i0, q.i0)) * Math.max(0, Math.min(p.j0 + p.n, q.j0 + q.n) - Math.max(p.j0, q.j0));
      let pred = new Float64Array(res * res), tt = 0;
      for (const x of t) tt += x * x;
      while (sel.length < budget) {
        const resid = new Float64Array(res * res);
        for (let q = 0; q < res * res; q++) resid[q] = t[q] - pred[q];
        const Sr = sat(resid);
        let best = -1, bestGain = 0;
        kern.forEach((c, k) => {
          if (c.used) return;
          const s = rect(Sr, c.i0, c.j0, c.n), gain = s > 0 ? s * s / (c.n * c.n) : 0;
          if (gain > bestGain) { bestGain = gain; best = k; }
        });
        if (best < 0 || bestGain < 1e-9 * tt) break;
        const c = kern[best];
        c.used = true; sel.push(c); w.push(0);
        const row = sel.map((p) => overlap(p, c));
        G.forEach((r, k) => r.push(row[k]));
        G.push(row);
        const m = sel.length, bv = sel.map((p) => rect(St, p.i0, p.j0, p.n));
        for (let sweep = 0; sweep < 60; sweep++) {
          let change = 0;
          for (let k = 0; k < m; k++) {
            let g = bv[k];
            for (let l = 0; l < m; l++) if (l !== k) g -= G[k][l] * w[l];
            const nw = Math.max(0, g / G[k][k]);
            change = Math.max(change, Math.abs(nw - w[k])); w[k] = nw;
          }
          if (change < 1e-7) break;
        }
        // prediction = sum of the weighted squares (difference array, then 2-D cumulative sums)
        const dd = new Float64Array(res * res);
        sel.forEach((p, k) => {
          const i1 = p.i0 + p.n, j1 = p.j0 + p.n;
          dd[p.j0 * res + p.i0] += w[k];
          if (i1 < res) dd[p.j0 * res + i1] -= w[k];
          if (j1 < res) dd[j1 * res + p.i0] -= w[k];
          if (i1 < res && j1 < res) dd[j1 * res + i1] += w[k];
        });
        for (let j = 0; j < res; j++) for (let i = 1; i < res; i++) dd[j * res + i] += dd[j * res + i - 1];
        for (let j = 1; j < res; j++) for (let i = 0; i < res; i++) dd[j * res + i] += dd[(j - 1) * res + i];
        pred = dd;
      }
      // weights become facets' illuminance (mu); negligible weights are dropped
      const wmax = Math.max(0, ...w);
      // with `fill`, each spot is stacked: several facets aim at the same spot (same size, so the same aim and distance)
      // and share its weight, which spends the budget on more facets without changing any spot
      const live = sel.map((p, k) => ({ i0: p.i0, j0: p.j0, n: p.n, w: w[k] })).filter((b) => b.w > 0.02 * wmax);
      const wsum = live.reduce((s, b) => s + b.w, 0);
      let blocks = [];
      for (const b of live) {
        const copies = settings.fill ? Math.max(1, Math.round(budget * b.w / wsum)) : 1;
        for (let q = 0; q < copies; q++) blocks.push({ i0: b.i0, j0: b.j0, n: b.n, mu: b.w / copies });
      }
      if (blocks.length > budget) { blocks.sort((p, q) => q.mu - p.mu); blocks = blocks.slice(0, budget); }

      // each block: aim point Z (its centre on the target), nominal distance, and every feasible facet position
      const centreOf = (b) => {
        const uc = -T.half + (b.i0 + b.n / 2) * cellmm, vc = -T.half + (b.j0 + b.n / 2) * cellmm;
        return [0, 1, 2].map((q) => T.C[q] + T.tu[q] * uc + T.tv[q] * vc);
      };
      for (const b of blocks) {
        b.Z = centreOf(b);
        const s = b.n * cellmm;
        b.dNom = lEff * Lc / s;
        b.cands = [];
        for (const d of dirs) {
          if (d.tout <= keep) continue;
          let dd = b.dNom;
          for (let it = 0; it < 4; it++) dd = lEff * dist(b.Z, [0, 1, 2].map((q) => S0[q] + dd * d.u[q])) / s;   // magnification fixed point
          if (!(dd >= keep) || dd > d.tout) continue;
          const P = [0, 1, 2].map((q) => S0[q] + dd * d.u[q]);
          if (!RF.Geo.envInside(env, P, 0)) continue;
          const L = dist(b.Z, P), ah = unit(sub(b.Z, P)), sh = unit(sub(S0, P)), nn = unit(add(sh, ah));
          const cPhi = dot(sh, nn), cPsi = -dot(ah, T.n);                  // incidence at the facet; obliquity at the target
          if (cPhi < settings.minCphi || cPsi < 0.05) continue;            // oblique facets stretch their spot by 1/cosφ
          b.cands.push({ u: d.u, P, dd, L, t: perp(nn), cTh: d.c, cPhi, cPsi, K: lw * lh * L * L / (R * d.c * cPhi * cPsi) });
        }
        if (b.cands.length > SITES) {                                     // thin evenly along the spiral (keeps spread)
          const every = Math.ceil(b.cands.length / SITES);
          b.cands = b.cands.filter((_, q) => q % every === 0);
        }
      }
      const noSite = blocks.filter((b) => b.cands.length === 0).length;
      blocks = blocks.filter((b) => b.cands.length > 0);
      if (noSite) notes.push(noSite + ' blocks had no feasible facet site and were dropped');
      // place the largest angular footprints first (footprint ∝ √mu · spot side): big tiles cannot find room late
      const order = blocks.map((_, q) => q).sort((p, q) => Math.sqrt(blocks[q].mu) * blocks[q].n - Math.sqrt(blocks[p].mu) * blocks[p].n);

      const cornersOf = (cd, side) => { const h = side / 2; return CORNERS.map(([sx, sy]) => [0, 1, 2].map((m) => cd.P[m] + h * (sx * cd.t[0][m] + sy * cd.t[1][m]))); };
      const fits = (cd, side) => cornersOf(cd, side).every((q) => RF.Geo.envInside(env, q, 0) && dist(q, S0) >= keep);
      // largest side ≤ want that fits the envelope (bisection; fits is monotone in side)
      const fitSide = (cd, want) => {
        if (fits(cd, want)) return want;
        let lo = 0, hi = want;
        for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (fits(cd, mid)) lo = mid; else hi = mid; }
        return lo;
      };

      // pass 1 — uniform scale: greedy placement at trial scale c, every block must fit
      const place = (c) => {
        const out = [];
        for (const bi of order) {
          const b = blocks[bi];
          let best = null, bestClear = -Infinity;
          for (const cd of b.cands) {
            const side = Math.sqrt(c * b.mu * cd.K);
            if (!fits(cd, side)) continue;
            const alpha = side * PK / cd.dd, rad = side * PK;
            let clear = Infinity;
            for (const p of out) {
              const ch = Math.min(dist(cd.u, p.cd.u) - (alpha + p.alpha),
                Math.hypot(cd.P[1] - p.cd.P[1], cd.P[2] - p.cd.P[2]) - (rad + p.rad));
              if (ch < clear) { clear = ch; if (clear <= bestClear) break; }
            }
            if (clear > bestClear) { bestClear = clear; best = { b, cd, alpha, rad, side }; }
          }
          if (!best || bestClear < 0) return null;
          out.push(best);
        }
        return out;
      };
      let cLo = null, cHi = null;
      for (let c = 1e-7; c < 1e15; c *= 2) { if (place(c)) cLo = c; else { cHi = c; break; } }
      if (cLo === null) return { surfaces, intent, notes: notes.concat(['no facet fits at any size']) };
      if (cHi !== null) for (let it = 0; it < 9; it++) { const mid = Math.sqrt(cLo * cHi); if (place(mid)) cLo = mid; else cHi = mid; }

      // pass 2 — greedy, per facet: each block takes the site that leaves it the largest share of its wanted tile
      const placeCapped = (c) => {
        const out = [];
        for (const bi of order) {
          const b = blocks[bi];
          let best = null, bestShare = 0;
          for (const cd of b.cands) {
            const want = Math.sqrt(c * b.mu * cd.K);
            let lim = want;
            for (const p of out) {
              const chord = dist(cd.u, p.cd.u);
              lim = Math.min(lim, (chord - p.alpha) * cd.dd / PK * MARGIN);                                   // angular room
              lim = Math.min(lim, (Math.hypot(cd.P[1] - p.cd.P[1], cd.P[2] - p.cd.P[2]) - p.rad) / PK * MARGIN);   // beam (y–z) room
              if (!(lim > 0)) break;
            }
            if (!(lim > 0)) continue;
            const side = fitSide(cd, lim);
            const share = side / want;
            if (side > 0 && share > bestShare) { bestShare = share; best = { b, cd, side, alpha: side * PK / cd.dd, rad: side * PK, want }; }
          }
          if (best) out.push(best);
        }
        return out;
      };
      const fin = placeCapped(cLo * settings.grow);

      let capped = 0, fill = 0;
      fin.forEach((p, q) => {
        const cd = p.cd, id = 'F' + q, side = p.side;
        if (side < 0.999 * p.want) capped++;
        surfaces.push({ type: 'facet', id, P: cd.P, S0: S0.slice(), Z: p.b.Z, flat: false, di: cd.L,
          clip: { kind: 'poly', pts3: cornersOf(cd, side) }, optics: { interaction: 'reflect', reflectivity: R, twoSided: false } });
        const cl = [];
        for (let j = p.b.j0; j < p.b.j0 + p.b.n; j++) for (let i = p.b.i0; i < p.b.i0 + p.b.n; i++) if (v[j * res + i] > EPS) cl.push([j * res + i, v[j * res + i]]);
        intent.push({ facet: id, cells: cl });
        fill += R * cd.cTh * cd.cPhi * side * side / (cd.dd * cd.dd);
      });
      fill /= Math.PI;                                                     // share of the LED's flux the tiles catch
      const dropped = blocks.length - fin.length;
      notes.unshift(`${surfaces.length} facets from ${blocks.length} blocks (${dropped} unplaced), blur ${rad} cells, spots ${(nMin * cellmm).toFixed(0)}–${(nMax * cellmm).toFixed(0)} mm, ` +
        `${capped} dimmed to fit, ~${(100 * fill).toFixed(0)}% of LED flux captured`);
      return { surfaces, intent, notes };
    },
  });
})();
