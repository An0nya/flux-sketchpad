/* solvers/solver.js — "shell": a shell of image-forming facets that paints the target.
 *
 * Everything here is static geometry plus an analytic model of the light it will deliver; nothing is
 * ray traced inside solve().
 *
 *  1. The LED's emitting cone is scanned on a fine (elevation band x azimuth sector) grid.  Elevation
 *     bands carry equal flux (equal ∫ I(θ) sinθ dθ).  A sector is usable when the LED actually emits
 *     there (within `tilt` of its axis, where the die is foreshortened least), when a facet fits inside
 *     the envelope, and when it lies strictly behind the plane through the LED normal to the throw axis.
 *  2. "Behind that plane" is what keeps the design free of self-shadowing: every beam leaves toward the
 *     target, so no facet stands in another facet's beam and no facet shadows another from the LED.
 *  3. The facet budget is split over the usable sectors in proportion to their solid angle, evenly
 *     inside each contiguous azimuth run, and all facets sit on ONE sphere of radius r0.  Equal angular
 *     cells on one sphere have equal projected area, so (brightness theorem) every facet has the same
 *     peak intensity: the delivered field is the painting's measure convolved with one common kernel,
 *     not a mosaic of unevenly bright blobs.
 *  4. Each facet is an exact confocal ellipsoid (foci: the LED point and its aim point), i.e. a real
 *     image of the LED at its aim point.  Its size on the target is (image distance / r0) x the LED's
 *     foreshortened size, and its distance di is set (defocus) so that every facet paints a blob of one
 *     chosen width — the width is chosen by the model in §5.
 *  5. Where each facet aims is computed, not guessed: an analytic model of the delivered field (each
 *     facet = a tent-shaped blob at its aim point) is deconvolved from the painting by Richardson-Lucy,
 *     giving the aim density that makes the field match the paint.  Aim points are then handed out by
 *     quantiles of that density along a serpentine path through the cells.  The same model scores a few
 *     candidate blob widths with the app's own fidelity definition (RF.Photometry.fidelity, fed a
 *     synthetic grid) and keeps the best.
 *  6. Facets are made a share `width` of their angular cell so neighbours never clip a beam; the result
 *     is checked against the envelope and the LED clearance with the app's geometry code (RF.Geo), and
 *     any facet that pokes out is shrunk, then dropped.
 *
 * Brightness is free (fidelity takes the best overall scale), so nothing here chases lumens directly:
 * it chases an even, sharp field of the right shape.
 */
(function () {
  'use strict';

  const D2R = Math.PI / 180;
  const EPS = 1e-12;

  // ---------------------------------------------------------------- separable tent kernel
  function tent1D(w) {
    const h = Math.max(0.5, w / 2), R = Math.ceil(h), K = [];
    let s = 0;
    for (let q = -R; q <= R; q++) { const v = Math.max(0, 1 - Math.abs(q) / h); if (v > 0) { K.push([q, v]); s += v; } }
    for (const k of K) k[1] /= s || 1;
    return K;
  }
  function blurTent(g, res, w, K) {
    const out = new Float64Array(res * res), tmp = new Float64Array(res * res);
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      let a = 0;
      for (const [q, k] of K) { const ii = i + q; if (ii >= 0 && ii < res) a += k * g[j * res + ii]; }
      tmp[j * res + i] = a;
    }
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      let a = 0;
      for (const [q, k] of K) { const jj = j + q; if (jj >= 0 && jj < res) a += k * tmp[jj * res + i]; }
      out[j * res + i] = a;
    }
    return out;
  }
  function splatTent(field, res, x, y, K) {
    const cx = Math.round(x), cy = Math.round(y);
    for (const [qy, ky] of K) {
      const j = cy + qy; if (j < 0 || j >= res) continue;
      for (const [qx, kx] of K) {
        const i = cx + qx; if (i < 0 || i >= res) continue;
        field[j * res + i] += kx * ky;
      }
    }
  }

  // ---------------------------------------------------------------- Richardson-Lucy aim density
  // rho such that tent(rho) ~ paint; multiplicative, non-negative, support = wherever rho starts > 0.
  function deconv(paint, res, w, iters) {
    const K = tent1D(w), n = res * res;
    let rho = new Float64Array(n);
    let pmax = 0;
    for (let k = 0; k < n; k++) pmax = Math.max(pmax, paint[k]);
    if (!(pmax > 0)) return rho;
    for (let k = 0; k < n; k++) rho[k] = paint[k] / pmax + 1e-3;      // a little everywhere, so aims may sit just outside the paint
    for (let it = 0; it < iters; it++) {
      const est = blurTent(rho, res, w, K);
      const ratio = new Float64Array(n);
      for (let k = 0; k < n; k++) ratio[k] = (paint[k] / pmax) / (est[k] + 1e-9);
      const back = blurTent(ratio, res, w, K);
      let s = 0;
      for (let k = 0; k < n; k++) { rho[k] *= back[k]; s += rho[k]; }
      if (!(s > 0)) break;
      for (let k = 0; k < n; k++) rho[k] /= s;
    }
    return rho;
  }

  function solveShell(input, settings) {
    const V = RF.V, Geo = RF.Geo, E = RF.Engine, Src = RF.Source;
    const env = input.envelope, src = input.source, S = src.pos.slice();
    const srcs = (input.sources && input.sources.length ? input.sources : [src]).map((s) => s.pos.slice());
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const maxN = Math.max(1, input.limits.maxFacets | 0);
    const refl = Math.max(0, Math.min(1, +input.limits.reflectivity || 0.9));
    const T = E.targetFrame(input.target);
    const envScale = Math.max(1, Math.max(env.half[0], env.half[1], env.half[2]));
    const kappa = Math.max(0.25, Math.min(1, +settings.width));
    const spread = Math.max(0.4, Math.min(3, +settings.spread));
    const focusFix = Math.max(0, Math.min(2, +settings.focus));       // 0 = automatic
    const rlIters = Math.max(0, Math.min(20, Math.round(+settings.deconv)));
    const notes = [];

    // ------------------------------------------------------------------ LED emission frame + flux table
    const fr = Src.frame(src), ax = fr.a, uu = fr.u, vv = fr.v;
    const thMax = Math.max(1e-3, Src.thetaMax(src));
    const NT = 512;
    const cum = new Float64Array(NT + 1);
    for (let i = 1; i <= NT; i++) {
      const t0 = (i - 1) / NT * thMax, t1 = i / NT * thMax;
      cum[i] = cum[i - 1] + 0.5 * (Src.intensity(src, t0) * Math.sin(t0) + Src.intensity(src, t1) * Math.sin(t1)) * (thMax / NT);
    }
    const cumTot = cum[NT] > 1e-12 ? cum[NT] : 1e-12;
    const thetaAt = (q) => {
      q = Math.min(1, Math.max(0, q));
      let lo = 0, hi = NT;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < q * cumTot) lo = m; else hi = m; }
      const f = (q * cumTot - cum[lo]) / Math.max(1e-300, cum[hi] - cum[lo]);
      return (lo + f) / NT * thMax;
    };
    const dirOf = (th, ph) => {
      const sp = Math.sin(th), cp = Math.cos(ph), spp = Math.sin(ph);
      return [Math.cos(th) * ax[0] + sp * (cp * uu[0] + spp * vv[0]),
              Math.cos(th) * ax[1] + sp * (cp * uu[1] + spp * vv[1]),
              Math.cos(th) * ax[2] + sp * (cp * uu[2] + spp * vv[2])];
    };
    const planar = src.kind === 'planar';
    const s0 = planar ? (src.shape === 'disc' ? 2 * (src.radius || 0) : Math.min(src.w || 1, src.h || 1))
                      : (src.shape === 'cylinder' ? Math.min(2 * (src.radius || 0), src.length || 0) : 2 * (src.radius || 0));
    const s0eff = (d) => (planar ? s0 * Math.max(0.12, Math.abs(V.dot(d, ax))) : s0);

    // ------------------------------------------------------------------ painting
    const res = input.paint.res, paint = input.paint.cells;
    const cellMM = 2 * T.half / res;
    let nPaint = 0;
    for (let k = 0; k < res * res; k++) if (paint[k] > 0) nPaint++;
    if (!nPaint) return { surfaces: [], intent: [], notes: ['nothing is painted'] };
    const paintAreaMM = nPaint * cellMM * cellMM;


    // ------------------------------------------------------------------ the cone toward the target
    const g = V.norm(V.sub(T.C, S));
    const aimDist = Math.max(1e-3, V.dist(T.C, S));
    let alpha = 0;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const q = E.targetUVtoWorld(T, su * T.half, sv * T.half);
      alpha = Math.max(alpha, V.angle(V.norm(V.sub(q, S)), g));
    }

    // ------------------------------------------------------------------ fine scan of usable directions
    const N = Math.max(2, Math.min(maxN, Math.round(maxN * (+settings.budgetShare))));
    const NB = Math.max(6, Math.min(48, Math.round(Math.sqrt(N) * 2.5)));
    const NV = Math.max(16, Math.min(160, Math.round(Math.sqrt(N) * 6)));
    const share = Math.max(0.2, Math.min(1, +settings.share));
    const tiltCos = Math.cos(Math.max(10, Math.min(90, +settings.tilt)) * D2R);

    const backTry = [90, 70, 40, 0];
    let bands = null, rAllowed = 0;
    for (const extra of backTry) {
      const backCos = Math.cos(Math.min(Math.PI - 1e-3, alpha + (extra + (+settings.cone)) * D2R));
      const bl = [], all = [];
      for (let i = 0; i < NB; i++) {
        const t0 = thetaAt(i / NB), t1 = thetaAt((i + 1) / NB);
        if (!(t1 > t0)) continue;
        const th = 0.5 * (t0 + t1);
        const inten = Src.intensity(src, th);
        const om = 2 * Math.PI * (Math.cos(t0) - Math.cos(t1));
        if (!(om > 0) || !(inten > 0)) continue;
        const secs = [];
        for (let j = 0; j < NV; j++) {
          const ph = (j + 0.5) * 2 * Math.PI / NV, d = dirOf(th, ph);
          let r = -1;
          if (V.dot(d, ax) >= tiltCos && V.dot(d, g) < backCos) {
            const iv = Geo.envInterval(env, S, d);
            if (iv[1] > keep + 2) r = iv[1];
          }
          const sr = { d, ph, om: om / NV, r, ok: false };
          secs.push(sr);
          if (r > 0) all.push({ s: sr, w: inten * om / NV });
        }
        if (secs.some((x) => x.r > 0)) bl.push({ th, inten, om, secs });
      }
      if (bl.length < 2 || all.length < 6) continue;
      all.sort((p, q) => q.s.r - p.s.r);
      let tot = 0;
      for (const x of all) tot += x.w;
      let acc = 0, rr = all[all.length - 1].s.r;
      for (const x of all) { acc += x.w; rr = x.s.r; if (acc >= share * tot) break; }
      let nOk = 0;
      for (const b of bl) for (const s of b.secs) if (s.r >= rr) { s.ok = true; nOk++; }
      if (nOk >= 6) { bands = bl; rAllowed = rr; break; }
    }
    if (!bands) return { surfaces: [], intent: [], notes: ['no direction left for a facet'] };

    // ------------------------------------------------------------------ facet directions
    let omDom = 0, s0sum = 0, nSect = 0;
    for (const b of bands) for (const s of b.secs) if (s.ok) { omDom += b.om / NV; s0sum += s0eff(s.d); nSect++; }
    const omFacet = omDom / Math.max(1, N);
    const s0med = s0sum / Math.max(1, nSect);

    let total = 0;
    for (const b of bands) {
      let n = 0;
      for (const s of b.secs) if (s.ok) n++;
      b.omOk = b.om * n / NV;
      b.avail = n;
      b.nExact = N * b.omOk / Math.max(1e-300, omDom);
      b.n = Math.floor(b.nExact);
      total += b.n;
    }
    const ord = bands.map((b, i) => i).sort((p, q) => (bands[q].nExact - bands[q].n) - (bands[p].nExact - bands[p].n) || p - q);
    for (let k = 0; total < N && k < ord.length * 2; k++) {
      const b = bands[ord[k % ord.length]];
      if (b.n < b.avail) { b.n++; total++; }
    }
    const dirs = [];
    for (const b of bands) {
      if (b.n <= 0) continue;
      const runs = [];
      let st = -1;
      for (let j = 0; j <= NV; j++) {
        const ok = j < NV && b.secs[j].ok;
        if (ok && st < 0) st = j;
        if (!ok && st >= 0) { runs.push([st, j]); st = -1; }
      }
      if (runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === NV) {
        const a = runs.pop(), z = runs.shift();
        runs.push([a[0] - NV, z[1]]);
      }
      let left = b.n;
      runs.forEach(([a, z], ri) => {
        const width = z - a;
        const nRun = ri === runs.length - 1 ? left : Math.max(0, Math.round(b.n * width / Math.max(1e-9, b.avail)));
        left -= nRun;
        for (let k = 0; k < nRun; k++) {
          const ph = (a + width * (k + 0.5) / nRun) * 2 * Math.PI / NV;
          dirs.push({ th: b.th, ph, d: dirOf(b.th, ph) });
        }
      });
    }
    if (!dirs.length) return { surfaces: [], intent: [], notes: ['no facet could be placed'] };
    const Nfac = dirs.length;

    // ------------------------------------------------------------------ choose the blob width with the model
    // one facet should paint about paintArea/Nfac of the target; the model then decides how much wider
    // the blobs should be (wider = smoother but softer edges).
    const tileMM = Math.sqrt(4 * paintAreaMM / (Math.PI * Nfac));
    const sceneLike = { source: src, envelope: env, target: input.target, modeA: { paint: paint } };
    const fakeP = { res, power: Math.max(1e-9, src.power || 1), T };
    function scoreField(field) {
      const ctx = { P: fakeP, N: 1, next: 1, E: { emitted: 1 }, gridD: field, gridR: new Float64Array(res * res) };
      try {
        const fd = RF.Photometry.fidelity(sceneLike, fakeP, ctx);
        return fd && isFinite(fd.fidelity) ? fd.fidelity : -1;
      } catch (e) { return -1; }
    }
    // aim cells: systematic (quantile) sampling of the aim density along a Hilbert curve.  A Hilbert
    // order is locally isotropic, so equal-quantile points come out evenly spread (a lattice-like, not
    // a stripe or a Poisson, pattern) while their local density follows rho.
    const hidx = (() => {
      const pow = 1 << Math.ceil(Math.log2(Math.max(2, res))), out = new Float64Array(res * res);
      for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
        let x = i, y = j, d = 0;
        for (let s = pow >> 1; s > 0; s >>= 1) {
          const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
          d += s * s * ((3 * rx) ^ ry);
          if (ry === 0) {
            if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
            const t = x; x = y; y = t;
          }
        }
        out[j * res + i] = d;
      }
      return out;
    })();
    function sampleAims(rho, nWant) {
      const n = res * res, idx = [];
      let tot = 0;
      for (let k = 0; k < n; k++) if (rho[k] > 0) { idx.push(k); tot += rho[k]; }
      if (!(tot > 0) || !idx.length) return [];
      idx.sort((a, b) => hidx[a] - hidx[b]);
      const out = [];
      let acc = 0, next = 0.5 * tot / nWant;
      for (const k of idx) {
        acc += rho[k];
        while (acc >= next && out.length < nWant) {
          out.push([k % res, (k / res) | 0]);
          next += tot / nWant;
        }
      }
      return out;
    }

    // The shell radius is the largest one that still keeps `share` of the light: bigger radius = smaller,
    // better-corrected images.  Blobs are made wider than the image by defocus, which is a clean aperture
    // blur, instead of by moving the shell in (that would shrink the facets and add coma).
    const r0 = Math.max(keep + 2, rAllowed);
    const imgMed = aimDist * s0med / Math.max(1e-6, r0);             // median image width (mm)
    const dTarget = Math.max(imgMed, spread * tileMM);
    const wCells = Math.max(0.6, dTarget / cellMM);
    const wK = Math.max(0.6, wCells * Math.max(0.6, Math.min(2.5, +settings.modelWidth)));
    const rho = deconv(paint, res, wK, rlIters);
    const cellsAim = sampleAims(rho, Nfac);
    // decorrelate: the aims come out of the Hilbert walk in spatial order and the facets in (θ,φ)
    // order, so handing them out in order would aim every high-intensity facet at one end of the
    // painting.  A fixed permutation spreads them evenly instead.
    const perm = cellsAim.map((_, i) => i).sort((a, b) => RF.rng.fmix32(Math.imul(a + 1, 0x9E3779B1) ^ 0x2545f491) - RF.rng.fmix32(Math.imul(b + 1, 0x9E3779B1) ^ 0x2545f491));
    const aimOf = (i) => cellsAim[perm[i % perm.length]];
    const aims = [];
    for (let i = 0; i < cellsAim.length; i++) { const c = aimOf(i); aims.push(E.targetUVtoWorld(T, -T.half + (c[0] + 0.5) * cellMM, -T.half + (c[1] + 0.5) * cellMM)); }
    const modelField = (() => {
      const field = new Float64Array(res * res), K = tent1D(wK);
      for (const [i, j] of cellsAim) splatTent(field, res, i, j, K);
      return scoreField(field);
    })();

    // ------------------------------------------------------------------ shield the direct beam
    // Light that leaves the LED straight at the target lands all over it and cannot be painted: it is
    // what turns the unpainted gaps grey.  A small absorbing plate between the LED and the target
    // rectangle removes it.  Plates are not mirrors, so they cost no facet budget (SOLVER_API.md), and
    // it is only added when the LED really does emit toward the target.
    function directFlux() {
      let sum = 0, tot = 0;
      const NQ = 96;
      for (let a = 0; a < NQ; a++) {
        const q = (a + 0.5) / NQ;
        const th = thetaAt(q), dth = thetaAt((a + 1) / NQ) - thetaAt(a / NQ);
        const inten = Src.intensity(src, th), omr = 2 * Math.PI * (Math.cos(th) - Math.cos(th + Math.max(1e-6, dth)));
        tot += inten * omr;
        // fraction of that ring inside the target cone: sample the azimuth
        let inside = 0;
        const NP = 64;
        for (let b = 0; b < NP; b++) {
          const d = dirOf(th, (b + 0.5) * 2 * Math.PI / NP);
          if (V.dot(d, g) >= Math.cos(alpha)) inside++;
        }
        sum += inten * omr * inside / NP;
      }
      return tot > 0 ? sum / tot : 0;
    }
    const shield = [];
    if (+settings.shield > 0 && directFlux() > 0.004) {
      const dSh = Math.max(keep + 1.0, 0.004 * aimDist);
      const Psh = V.madd(S, g, dSh);
      const e1 = V.inPlane(g, null), e2 = V.cross(g, e1);
      let rSh = Math.max(0.4, dSh * Math.tan(Math.min(alpha, 1.3)) + 0.3);
      const rimOK = (rr) => {
        if (!Geo.envInside(env, Psh, -0.01)) return false;
        for (const sp of srcs) if (V.dist(Psh, sp) <= keep + 0.4) return false;
        for (let t = 0; t < 16; t++) {
          const a = t * Math.PI / 8;
          const q = V.add(Psh, V.add(V.mul(e1, rr * Math.cos(a)), V.mul(e2, rr * Math.sin(a))));
          if (!Geo.envInside(env, q, -0.01)) return false;
          for (const sp of srcs) if (V.dist(q, sp) <= keep + 0.4) return false;
        }
        return true;
      };
      for (let it = 0; it < 24 && rSh > 0.25; it++) { if (rimOK(rSh)) break; rSh *= 0.85; }
      if (rSh > 0.3 && rimOK(rSh)) shield.push({ type: 'plane', id: 'SHIELD', group: 'A', P: Psh, n: g,
        clip: { kind: 'disc', r: rSh }, optics: { interaction: 'absorb' } });
    }

    // ------------------------------------------------------------------ place the facets
    const placed = [];
    for (let i = 0; i < Nfac && i < aims.length; i++) {
      const c = dirs[i], Z = aims[i];
      const P = V.madd(S, c.d, r0);
      const shat = V.norm(V.sub(S, P)), ahat = V.norm(V.sub(Z, P));
      const n = V.norm(V.add(shat, ahat));
      if (!(V.len(n) > 0.5)) continue;
      const cosi = Math.max(0.06, V.dot(n, shat));
      const sz = Math.min(0.65 * r0, kappa * Math.sqrt(omFacet * r0 * r0 / cosi));
      if (!patchOK(env, srcs, keep, P, n, sz)) continue;
      const R = V.dist(P, Z);
      const img = R * s0eff(c.d) / Math.max(1e-6, r0);
      let di = R;
      if (focusFix > 0) di = focusFix * R;
      else if (img < dTarget) di = Math.max(0.10 * R, R / (1 + 1.5 * (dTarget - img) / Math.max(0.5, sz)));
      placed.push({ P, Z, n, cosi, sz, di, th: c.th, ph: c.ph });
    }
    if (!placed.length) return { surfaces: [], intent: [], notes: ['no facet could be placed'] };

    const facets = [];
    placed.sort((A, B) => (A.th - B.th) || (A.ph - B.ph));
    for (let k = 0; k < placed.length; k++) {
      const f = placed[k];
      const id = 'F' + k.toString(36);
      const ex = V.inPlane(f.n, null), ey = V.cross(f.n, ex), h = f.sz / 2;
      const cor = (a, b) => V.add(f.P, V.add(V.mul(ex, a * h), V.mul(ey, b * h)));
      facets.push({
        id, P: f.P, ex, ey, h,
        surf: {
          type: 'facet', id, group: 'A', P: f.P, S0: S, Z: f.Z, flat: false,
          di: Math.max(1e-3, f.di),
          clip: { kind: 'poly', pts3: [cor(-1, -1), cor(1, -1), cor(1, 1), cor(-1, 1)] },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
        },
        cell: cellKAt(f.Z, T, res, cellMM),
      });
    }

    const surfaces = facets.map((f) => f.surf);
    fixLimits(surfaces, facets, Geo, V, env, srcs, keep, envScale, notes);
    for (const sh of shield) surfaces.push(sh);

    const intent = [];
    for (const f of facets) if (f.surf) intent.push({ facet: f.id, cells: [[f.cell, 1]] });
    notes.push(surfaces.filter(Boolean).length + ' facets, r = ' + r0.toFixed(1) + ' mm, blob ' + dTarget.toFixed(1) + ' mm (' + (dTarget / cellMM).toFixed(2) + ' cells), model fidelity ' + (100 * modelField).toFixed(0) + '%');
    return { surfaces: surfaces.filter(Boolean), intent, notes };
  }

  // painted cell nearest a world point (for intent)
  function cellKAt(w, T, res, cellMM) {
    const d = RF.V.sub(w, T.C);
    const i = Math.floor((RF.V.dot(d, T.tu) + T.half) / cellMM), j = Math.floor((RF.V.dot(d, T.tv) + T.half) / cellMM);
    const ii = Math.max(0, Math.min(res - 1, i)), jj = Math.max(0, Math.min(res - 1, j));
    return jj * res + ii;
  }

  // a facet patch (square of side sz about P, normal n) inside the envelope and outside every clearance
  function patchOK(env, srcs, keep, P, n, sz) {
    const V = RF.V, Geo = RF.Geo;
    const ex = V.inPlane(n, null), ey = V.cross(n, ex);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const q = V.add(P, V.add(V.mul(ex, sx * sz / 2), V.mul(ey, sy * sz / 2)));
      if (!Geo.envInside(env, q, -0.004)) return false;
      for (const sp of srcs) if (V.dist(q, sp) < keep + 0.6) return false;
    }
    for (const sp of srcs) if (V.dist(P, sp) < keep + 0.6) return false;
    return true;
  }

  // Shrink a patch (about its centre) until the app's own checks pass, else drop it.
  function fixLimits(surfaces, facets, Geo, V, env, srcs, keep, envScale, notes) {
    const tol = 1e-6 * envScale;
    let dropped = 0;
    for (let pass = 0; pass < 5; pass++) {
      const live = surfaces.filter(Boolean);
      let G;
      try { G = Geo.compile(live); } catch (e) { return; }
      let bad = 0;
      for (let k = 0; k < G.n; k++) {
        if (k >= facets.length || !facets[k].surf) continue;
        const fac = facets[k];
        let okE = true, okK = true;
        const polys = Geo.outline(G, k);
        for (const poly of polys) {
          for (const p of poly) {
            if (!Geo.envInside(env, p, tol)) okE = false;
            for (const sp of srcs) if (V.dist(p, sp) < keep * (1 - 1e-6)) okK = false;
          }
          if (keep > 0 && okK) {                         // interior points, measured on the real surface
            const c = V.mul(poly.reduce((a, q) => V.add(a, q), [0, 0, 0]), 1 / poly.length);
            for (let i = 0; i < poly.length; i++) {
              const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
              for (let a = 0; a <= 3; a++) for (let b = 0; a + b <= 3; b++) {
                const q = V.add(c, V.add(V.mul(V.sub(p1, c), a / 3), V.mul(V.sub(p2, c), b / 3)));
                for (const sp of srcs) {
                  const dq = V.norm(V.sub(q, sp));
                  const t = Geo.intersect(G.D, G.poly, k, sp[0], sp[1], sp[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
                  if (t >= 0 && t < keep * (1 - 1e-6)) okK = false;
                }
              }
            }
          }
        }
        if (okE && okK) continue;
        bad++;
        if (pass < 4) {
          fac.h *= 0.8;
          const P = fac.P, ex = fac.ex, ey = fac.ey, h = fac.h;
          const cor = (a, b) => V.add(P, V.add(V.mul(ex, a * h), V.mul(ey, b * h)));
          fac.surf.clip = { kind: 'poly', pts3: [cor(-1, -1), cor(1, -1), cor(1, 1), cor(-1, 1)] };
        } else { fac.surf = null; fac.cell = undefined; dropped++; }
      }
      if (!bad) break;
    }
    const out = facets.filter((f) => f.surf);
    facets.length = 0;
    for (const f of out) facets.push(f);
    surfaces.length = 0;
    for (const f of facets) surfaces.push(f.surf);
    if (dropped) notes.push(dropped + ' facets dropped: they could not be fitted to the envelope');
  }

  RF.Solvers.register({
    id: 'bench-particle1--shell', name: 'Weighted shell', version: '0.6', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'budgetShare', label: 'Share of the facet budget used', type: 'range', min: 0.2, max: 1, step: 0.02, default: 1 },
      { key: 'width', label: 'Facet width / cell width', type: 'range', min: 0.25, max: 1, step: 0.05, default: 0.75 },
      { key: 'spread', label: 'Blob size / tiling size', type: 'range', min: 0.4, max: 3, step: 0.05, default: 1.8 },
      { key: 'tilt', label: 'LED cone used (deg from its axis)', type: 'range', min: 10, max: 90, step: 1, default: 85 },
      { key: 'share', label: 'Share of the collectable light kept', type: 'range', min: 0.2, max: 1, step: 0.02, default: 0.85 },
      { key: 'cone', label: 'Keep out of the target cone (deg)', type: 'range', min: 0, max: 40, step: 1, default: 2 },
      { key: 'deconv', label: 'Aim deconvolution passes', type: 'range', min: 0, max: 20, step: 1, default: 6 },
      { key: 'modelWidth', label: 'Model blob width / painted blob width', type: 'range', min: 0.6, max: 2.5, step: 0.05, default: 1.5 },
      { key: 'focus', label: 'Image distance / aim distance (0 = auto)', type: 'range', min: 0, max: 2, step: 0.05, default: 0 },
      { key: 'shield', label: 'Shield the direct beam', type: 'checkbox', default: true },
    ],
    solve: solveShell,
  });

  /* ------------------------------------------------------------------------------------------------
   * TUNER: "shell-auto" runs the static algorithm above with a handful of settings and picks one by
   * tracing the candidates.  The task allows tracing inside solve() only for an id ending in -auto;
   * every candidate is traced at the SAME seed (common random numbers), so the differences it sees are
   * geometry, not dice.  The goal decides which candidate wins:
   *   faithful  — the highest fidelity (the painting, as painted);
   *   throw     — the highest peak intensity among candidates that keep fidelity near the best;
   *   efficient — the most light on the painting (onPaint) among those that keep fidelity near the best.
   * Its output is the static solver's output unchanged, so the same hard limits apply.
   * ---------------------------------------------------------------------------------------------- */
  const AUTO_GRID = [
    // spread, tilt, width  — sharp to soft blobs, narrow to wide LED cone, small to large facets
    [1.3, 85, 0.75], [1.8, 85, 0.75], [2.4, 85, 0.75],
    [0.9, 85, 1.0], [1.8, 70, 0.95], [1.8, 85, 0.95],
    [2.4, 60, 0.95],
  ];

  function solveAuto(input, settings, tools) {
    const staticDef = RF.Solvers.get('bench-particle1--shell');
    const goal = ['faithful', 'throw', 'efficient'].includes(settings.goal) ? settings.goal : 'faithful';
    const base = RF.Solvers.sanitize(staticDef, Object.assign(RF.Solvers.defaults(staticDef), {
      minDistance: settings.minDistance, budgetShare: settings.budgetShare,
    }));
    // two passes: a cheap one over every candidate (fidelity at a few 10k rays is biased low, so this
    // only throws out the clearly worse ones) then a long one over the survivors at the same seed.
    const budget = (tools && tools.budget && tools.budget.rays) || Infinity;
    const want1 = Math.max(20000, Math.min(200000, Math.round(+settings.rays || 60000)));
    const n1 = Math.min(want1, Math.max(20000, Math.floor(budget / (4 * AUTO_GRID.length)) || want1));
    const n2 = Math.min(500000, Math.max(n1, 7 * n1), Math.max(20000, Math.floor(budget / 8) || 500000));
    const tracer = tools && typeof tools.trace === 'function' ? tools.trace : null;
    // one trace, or the mean over a few seeds (same rays each): the fidelity estimate carries a couple
    // of points of seed noise at these ray counts, so the final pass averages two seeds
    const measure = (out, rays, seeds) => {
      if (!tracer) return null;
      let fid = 0, peak = 0, onPaint = 0, n = 0;
      for (const seed of seeds) {
        try {
          const tr = tracer(out.surfaces, { rays, seed });
          const fd = tr && tr.fidelity;
          if (!fd || !isFinite(fd.fidelity)) continue;
          fid += fd.fidelity; peak += +tr.peakCd || 0; onPaint += +fd.onPaint || 0; n++;
        } catch (e) { /* no trace budget: leave this candidate untraced */ }
      }
      return n ? { fid: fid / n, peak: peak / n, onPaint: onPaint / n } : null;
    };

    const cands = [];
    for (const [spread, tilt, width] of AUTO_GRID) {
      let out;
      try { out = solveShell(input, Object.assign({}, base, { spread, tilt, width })); } catch (e) { continue; }
      if (!out || !out.surfaces || !out.surfaces.length) continue;
      cands.push({ spread, tilt, width, out, m: measure(out, n1, [90210]) });
    }
    if (!cands.length) return { surfaces: [], intent: [], notes: ['nothing could be solved'] };
    const traced = cands.filter((c) => c.m);
    if (!traced.length) {
      const pick = cands.find((c) => c.spread === base.spread && c.tilt === base.tilt) || cands[0];
      const notes = (pick.out.notes || []).slice();
      notes.push('auto (' + goal + '): spread ' + pick.spread + ', tilt ' + pick.tilt + ', width ' + pick.width + ' — not traced');
      return { surfaces: pick.out.surfaces, intent: pick.out.intent, notes };
    }

    // survivors: everything still close to the best fidelity, best goal value first, at most three
    let fMax = 0, gMax = 0;
    const goalVal = (c) => (goal === 'throw' ? c.m.peak : goal === 'efficient' ? c.m.onPaint : c.m.fid);
    for (const c of traced) { fMax = Math.max(fMax, c.m.fid); gMax = Math.max(gMax, goalVal(c)); }
    const survivors = traced
      .filter((c) => c.m.fid >= fMax - Math.max(0.10, 0.14 * fMax) || goalVal(c) >= 0.9 * gMax)
      .sort((a, b) => goalVal(b) - goalVal(a) || b.m.fid - a.m.fid)
      .slice(0, 4);
    if (survivors.length && n2 > n1) for (const c of survivors) { const m2 = measure(c.out, n2, [90210, 12345]); if (m2) c.m = m2; }

    // A candidate wins on the goal only by more than trace noise (2 points of fidelity, 3 % of peak /
    // onPaint); inside that band fidelity decides, and inside that band the design that puts more light
    // on the painting wins — onPaint is a real, noise-free gain where a two-point fidelity difference is
    // not.
    const better = (a, b) => {
      const va = goalVal(a), vb = goalVal(b);
      const tol = goal === 'faithful' ? 0.015 : 0.03 * Math.abs(vb) + 1e-9;
      if (va > vb + tol) return true;
      if (va < vb - tol) return false;
      if (a.m.fid > b.m.fid + 0.015) return true;
      if (b.m.fid > a.m.fid + 0.015) return false;
      return a.m.onPaint > b.m.onPaint;
    };
    // no goal may buy its metric by gutting the painting: chasing peak or onPaint is only worth it while
    // the beam still looks like the paint (the score only pays for efficiency after that)
    let fBest = 0;
    for (const c of survivors) fBest = Math.max(fBest, c.m.fid);
    const keep = survivors.filter((c) => c.m.fid >= fBest - Math.max(0.10, 0.15 * fBest));
    const pick = (keep.length ? keep : survivors).reduce((a, b) => (better(b, a) ? b : a), (keep.length ? keep : survivors)[0]);
    const m = pick.m;
    const notes = (pick.out.notes || []).slice();
    notes.push('auto (' + goal + '): spread ' + pick.spread + ', tilt ' + pick.tilt + ', width ' + pick.width + ' — traced ' +
      (100 * m.fid).toFixed(0) + '% fidelity, peak ' + Math.round(m.peak) + ' cd, on paint ' + (100 * m.onPaint).toFixed(1) +
      '% · ' + traced.length + ' candidates at ' + n1 + ' rays, best ' + survivors.length + ' re-traced at ' + n2);
    return { surfaces: pick.out.surfaces, intent: pick.out.intent, notes };
  }

  RF.Solvers.register({
    id: 'bench-particle1--shell-auto', name: 'Weighted shell (auto-tuned)', version: '0.6', modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
      { key: 'budgetShare', label: 'Share of the facet budget used', type: 'range', min: 0.2, max: 1, step: 0.02, default: 1 },
      { key: 'rays', label: 'Rays per candidate (first pass)', type: 'range', min: 20000, max: 200000, step: 10000, default: 60000 },
    ],
    solve: solveAuto,
  });
})();
