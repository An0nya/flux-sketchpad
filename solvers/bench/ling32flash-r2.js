/* Mosaic reflector solver — static, no tracing inside solve().
 *
 * Physics (all measured against the app's own tracer, see solvers/NOTES.md):
 *  - A facet at distance r from the LED paints a flat-top blob on the target of FWHM
 *    ≈ ledSize · throw / r, whatever its curvature (étendue).  Focusing the ellipsoid at the
 *    target plane (di = |Z−P|) makes the top flat and the edge soft over ~2 cells.
 *  - Flux caught = I(θ)/ΣI · A · sin(γ/2) / r²  (γ = angle LED-dir ↔ aim dir; the bisector
 *    normal projects the facet area by sin(γ/2) toward the LED).  Measured: 1.6% RMS.
 *  - The scorer blurs the paint by the smallest image the envelope allows
 *    (Photometry.achievableKernel) and accepts that blur near edges, so the physically best
 *    deliverable pattern is paint ⊛ kernel.  Facet fluxes come from a bounded least-squares fit
 *    to that pattern; fluxes then become facet areas through the catch model.
 *
 * Architecture: facets live on the wall the throw axis points AWAY from (the "dish": beams
 * diverge forward and never return to it) plus the front band of every other wall (beams exit
 * within one row spacing).  Beams that skim their own wall's rows are the one blocking mechanism
 * that matters (measured: >90% of all conflicts); this layout avoids them by construction, and an
 * exact segment-vs-disc test removes the rest.
 *
 * Pipeline: stations → greedy aim assignment against a need field (top-K conflict-free aims) →
 * bounded least-squares fluxes → areas → facets → exact analytic verification of every facet
 * (envelope + LED clearance on the real compiled surface, the same tests the host runs).
 */
/* The static core: everything below is pure geometry (no tracing).  `mosaic-auto` re-solves it
 * with a few setting vectors and picks by traced score; the static id never traces. */
const MOSAIC_SETTINGS = [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'inset', label: 'Wall inset (mm)', type: 'number', min: 0.5, max: 12, step: 0.5, default: 3 },
    { key: 'rhoGrid', label: 'Facet radius (mm)', type: 'number', min: 1.5, max: 12, step: 0.5, default: 4.5 },
    { key: 'rhoCap', label: 'Max facet radius (mm)', type: 'number', min: 2, max: 20, step: 0.5, default: 9 },
    { key: 'rMin', label: 'Min station radius (mm)', type: 'number', min: 0, step: 1, default: 20 },
        { key: 'blobScale', label: 'Blob size ×', type: 'number', min: 0.6, max: 1.8, step: 0.05, default: 0.9 },
    { key: 'soft', label: 'Blob edge (cells)', type: 'number', min: 0.5, max: 4, step: 0.25, default: 3 },
    { key: 'gapW', label: 'Gap penalty', type: 'number', min: 0, max: 30, step: 0.5, default: 8 },
    { key: 'gapHalF', label: 'Gap halo ×', type: 'number', min: 0, max: 1.3, step: 0.05, default: 0.7 },
    { key: 'farW', label: 'Far haze penalty', type: 'number', min: 0, max: 2, step: 0.1, default: 0.25 },
    { key: 'candAims', label: 'Aim candidates', type: 'range', min: 40, max: 400, step: 10, default: 220 },
    { key: 'lpIters', label: 'Fit iterations', type: 'range', min: 50, max: 3000, step: 25, default: 1500 },
    { key: 'maxStations', label: 'Station candidates', type: 'range', min: 60, max: 1200, step: 20, default: 420 },
    { key: 'gamMin', label: 'Min incidence angle (°)', type: 'number', min: 0, max: 80, step: 5, default: 35 },
    { key: 'aimTries', label: 'Aim tries per facet', type: 'range', min: 1, max: 24, step: 1, default: 12 },
    { key: 'gridGap', label: 'Wall grid pitch (×ρ)', type: 'number', min: 1.2, max: 3, step: 0.1, default: 1.7 },
    
    { key: 'layerGap', label: 'Layer step (×ρ)', type: 'number', min: 1, max: 4, step: 0.1, default: 2 },
    { key: 'levelScale', label: 'Target level ×', type: 'number', min: 0.1, max: 1.5, step: 0.05, default: 0.55 },
    { key: 'overlap', label: 'Blob overlap', type: 'number', min: 1, max: 8, step: 0.5, default: 5 },
  ];

function mosaicSolve(input, settings) {
    const V = RF.V, Geo = RF.Geo, Src = RF.Source, Eng = RF.Engine, Pho = RF.Photometry;
    const env = input.envelope, L = input.source.pos;
    const keep = Math.max(env.keepOut || 0, +settings.minDistance || 0);
    const refl = input.limits.reflectivity, maxFacets = Math.max(1, input.limits.maxFacets | 0);
    const src = input.source;
    const notes = [];
    const empty = (m) => ({ surfaces: [], intent: [], notes: notes.concat(m || 'nothing placeable') });

    // ---- source model
    const fr = Src.frame(src);
    const s0 = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h))
      : src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius;
    const totI = Src.totalIntegral(src);
    const thetaMax = Src.thetaMax(src);
    // the LED's bounding rect in its own frame: the blob is this rect's angular image
    let ledRect;
    if (src.kind === 'planar' && src.shape === 'disc') ledRect = [[fr.u, src.radius * 0.8], [fr.v, src.radius * 0.8]];
    else if (src.kind === 'volume' && src.shape === 'cylinder') ledRect = [[fr.a, src.length / 2], [fr.u, src.radius]];
    else if (src.kind === 'volume') ledRect = [[fr.u, src.radius], [fr.v, src.radius]];
    else ledRect = [[fr.u, src.w / 2], [fr.v, src.h / 2]];
    let Imax = 0;
    for (let q = 0; q <= 32; q++) Imax = Math.max(Imax, Src.intensity(src, thetaMax * q / 32));

    // ---- target / paint frames
    const T = Eng.targetFrame(input.target);
    const Rp = input.paint.res | 0, paint = input.paint.cells;
    const cw = 2 * T.half / Rp;                                    // paint cell pitch (mm)
    const worldOf = (i, j) => Eng.targetUVtoWorld(T, -T.half + (i + 0.5) * cw, -T.half + (j + 0.5) * cw);

    // ---- the physical blur the scorer allows → the pattern we try to deliver
    const ker = Pho.achievableKernel({ source: src, envelope: env, target: input.target });
    const kc = Math.max(1, ker.cells);
    const B = Pho.boxBlur(paint, Rp, kc);
    let paintSum = 0; for (let k = 0; k < paint.length; k++) paintSum += paint[k];
    if (!(paintSum > 0)) return empty('paint is empty');

    // ---- working grid: fine enough that a blob spans several cells
    const Dtyp = input.target.distance + 30;
    const wTyp = s0 * Dtyp / (55 * cw);   // (working-grid resolution from the round-blob scale)
    const Rw = Math.max(4, Math.min(Rp, Math.round(Rp * 3.5 / Math.max(0.5, wTyp))));
    const cwW = 2 * T.half / Rw;
    const Pw = new Float64Array(Rw * Rw), Bw = new Float64Array(Rw * Rw);
    for (let j = 0; j < Rp; j++) for (let i = 0; i < Rp; i++) {
      const wi = Math.min(Rw - 1, Math.floor(i * Rw / Rp)), wj = Math.min(Rw - 1, Math.floor(j * Rw / Rp));
      Pw[wj * Rw + wi] += paint[j * Rp + i]; Bw[wj * Rw + wi] += B[j * Rp + i];
    }
    const painted = new Uint8Array(Rw * Rw);
    for (let k = 0; k < Rw * Rw; k++) painted[k] = Pw[k] > 0 ? 1 : 0;
    const bandR = Math.ceil(kc) + 2;
    const gap = new Uint8Array(Rw * Rw);
    for (let j = 0; j < Rw; j++) for (let i = 0; i < Rw; i++) {
      if (painted[j * Rw + i]) continue;
      outer: for (let dj = -bandR; dj <= bandR; dj++) for (let di = -bandR; di <= bandR; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= Rw || jj >= Rw) continue;
        if (painted[jj * Rw + ii]) { gap[j * Rw + i] = 1; break outer; }
      }
    }
    const far = new Uint8Array(Rw * Rw);
    {
      const FB = 5;
      for (let j0 = 0; j0 < Rw; j0 += FB) for (let i0 = 0; i0 < Rw; i0 += FB) {
        let hit = 0, n = 0;
        for (let j = j0; j < Math.min(Rw, j0 + FB); j++) for (let i = i0; i < Math.min(Rw, i0 + FB); i++) { n++; if (painted[j * Rw + i] || gap[j * Rw + i]) hit++; }
        if (hit < n / 2) for (let j = j0; j < Math.min(Rw, j0 + FB); j++) for (let i = i0; i < Math.min(Rw, i0 + FB); i++) far[j * Rw + i] = 1;
      }
    }
    const worldOfW = (i, j) => Eng.targetUVtoWorld(T, -T.half + (i + 0.5) * cwW, -T.half + (j + 0.5) * cwW);

    // ---- throw gate: which wall the beam must leave through, and which wall is the dish
    const throwAx = V.norm(V.sub(T.C, L));
    let throwWall = -1, dishAx = -1, dishSd = 1;
    if (env.shape === 'box') {
      let bd = -2;
      for (let ax = 0; ax < 3; ax++) for (const sd of [-1, 1]) {
        const n = [0, 0, 0]; n[ax] = sd;
        const d = V.dot(n, throwAx);
        if (d > bd) { bd = d; throwWall = ax * 2 + (sd > 0 ? 1 : 0); }
      }
      dishAx = (throwWall / 2) | 0; dishSd = throwWall % 2 ? 1 : -1;
    }
    const exitsThrow = (P, Z) => {
      const a = V.norm(V.sub(Z, P));
      if (throwWall < 0) return V.dot(a, throwAx) > 0.75;
      const iv = Geo.envInterval(env, P, a);
      if (!iv || !isFinite(iv[1]) || iv[1] <= 0) return false;
      const E = V.add(P, V.mul(a, iv[1]));
      const i = ((throwWall / 2) | 0), sd = throwWall % 2 ? 1 : -1;
      return (E[i] - env.center[i]) * sd > env.half[i] * 0.98;
    };

    // ---- stations
    let stations = [];
    {
      const rhoNom = Math.max(1.2, Math.min(+settings.rhoGrid || 4.5, +settings.rhoCap || 9));
      if (env.shape === 'box') {
        // Grid every wall except the throw wall (a facet between the LED and the target catches
        // nothing per area and stands in every other facet's beam).  Beams that would skim their
        // own wall's rows are removed later by the exact conflict test + top-K aim retry.
        const g = (+settings.gridGap || 1.9) * rhoNom;
        const c = env.center, h = env.half;
        // Depth-staggered layers: a wall row's beams run nearly parallel to the wall and would
        // sweep the row ahead (the one blocking mechanism that matters, measured >90% of all
        // conflicts), so each row sits one layer deeper: the beams pass over the row in front.
        const tProj = throwAx.slice(); tProj[dishAx] = 0;
        const layerGap = (+settings.layerGap || 2.0) * rhoNom, nLayers = 4;
        for (let ax = 0; ax < 3; ax++) for (const sd of [-1, 1]) {
          if (ax === dishAx && sd === dishSd) continue;
          const i = (ax + 1) % 3, j = (ax + 2) % 3;
          const rowAlong = Math.abs(tProj[i]) > Math.abs(tProj[j]) ? 0 : 1;   // which wall axis the throw runs along
          for (let u = -h[i] + g / 2; u <= h[i] - g / 2 + 1e-9; u += g) for (let v = -h[j] + g / 2; v <= h[j] - g / 2 + 1e-9; v += g) {
            const rowIdx = rowAlong === 0 ? Math.round((u + h[i]) / g) : Math.round((v + h[j]) / g);
            const lay = rhoNom + (+settings.inset || 3) + layerGap * (rowIdx % nLayers);
            const Q = c.slice(); Q[ax] += sd * h[ax]; Q[i] += u; Q[j] += v;
            const P = Q.slice(); P[ax] -= sd * lay;
            const d = V.norm(V.sub(P, L));
            if (V.dist(P, L) < keep + 0.6 || V.dist(P, L) < (+settings.rMin || 20)) continue;
            const Ir = Src.intensity(src, Math.acos(Math.max(-1, Math.min(1, V.dot(d, fr.a))))) / totI;
            if (Ir < 0.02 * Imax / totI) continue;              // sees (almost) no emission
            stations.push({ d, r: V.len(V.sub(P, L)), P, rho: rhoNom, ct: V.dot(d, fr.a), Ir });
          }
        }
      } else {
        const NC = Math.max(60, Math.min(1500, +settings.maxStations || 420));
        const GA = Math.PI * (3 - Math.sqrt(5));
        const cmax = Math.cos(thetaMax);
        for (let n = 0; n < NC; n++) {
          const ct = 1 - (n + 0.5) / NC * (1 - cmax);
          const st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = n * GA;
          const d = [st * Math.cos(ph), st * Math.sin(ph), ct];
          const wd = [fr.a[0] * d[2] + fr.u[0] * d[0] + fr.v[0] * d[1],
                      fr.a[1] * d[2] + fr.u[1] * d[0] + fr.v[1] * d[1],
                      fr.a[2] * d[2] + fr.u[2] * d[0] + fr.v[2] * d[1]];
          const iv = Geo.envInterval(env, L, wd);
          if (!iv || !isFinite(iv[1]) || iv[1] <= iv[0]) continue;
          const rWall = iv[0] > 1e-6 ? iv[0] : iv[1];
          const rho = Math.min(rhoNom, Math.max(1.2, 0.3 * Math.max(1, rWall - keep - 2)));
          const r = rWall - rho - 1.0;
          if (r < keep + 0.6 || r < (+settings.rMin || 20)) continue;
          stations.push({ d: wd, r, P: V.add(L, V.mul(wd, r)), rho, ct });
        }
      }
      // thin across walls: a station only if its disc clears every kept disc
      const PAD = 1.02;
      const kept = [];
      for (const c of stations) {
        let ok = true;
        for (const q of kept) if (V.dist(c.P, q.P) < PAD * (c.rho + q.rho)) { ok = false; break; }
        if (ok) kept.push(c);
        if (kept.length >= 4 * maxFacets + 60) break;
      }
      stations = kept;
    }
    notes.push('stations ' + stations.length + ' ρ~' + (+settings.rhoGrid || 4.5).toFixed(1) + ' keep ' + keep.toFixed(1));
    if (!stations.length) return empty();

    // ---- blob kernel: the LED's own image through the facet.  A flat LED seen from a facet at
    // grazing angle is foreshortened, so the blob is the LED rect's angular image: a parallelo-
    // gram whose edge vectors are the LED's axes, foreshortened by the view, mirrored by the
    // facet and magnified by D/r onto the target.  (Measured: FWHM = ledSize·D/r; the mirror
    // un-foreshortens nothing — the ellipse stays.)
    const softW = Math.max(0.4, +settings.soft || 2) * Rw / Rp;
    const bs = (+settings.blobScale || 1);
    function blobEdges(P, Z, r) {
      const sHat = V.norm(V.sub(L, P));                       // facet → LED
      const nHat = V.norm(V.add(sHat, V.norm(V.sub(Z, P))));  // bisector normal
      const Dv = V.len(V.sub(Z, P));
      const out = [];
      for (const [ax, hh] of ledRect) {
        const f = V.sub(ax, V.mul(sHat, V.dot(ax, sHat)));     // axis ⊥ view
        const l = V.len(f);
        if (l < 1e-6) { out.push([0, 0]); continue; }
        const g = V.mul(f, 1 / l);
        const mr = V.sub(g, V.mul(nHat, 2 * V.dot(g, nHat)));  // mirrored axis
        const e = hh * bs * l / r;                             // angular half-extent (rad)
        out.push([Dv * e * V.dot(mr, T.tu) / cwW, Dv * e * V.dot(mr, T.tv) / cwW]);
      }
      return out;
    }
    function blobKernel(V1, V2) {
      const l1 = Math.hypot(V1[0], V1[1]), l2 = Math.hypot(V2[0], V2[1]);
      const R = Math.max(2, Math.ceil(Math.max(l1, l2) + softW));
      const k = new Float64Array((2 * R + 1) * (2 * R + 1));
      const det = V1[0] * V2[1] - V1[1] * V2[0];
      const t = Math.min(0.5, softW / Math.max(l1, l2, 0.5));
      let s = 0;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        let v = 0;
        if (Math.abs(det) > 1e-12) {
          const a = (di * V2[1] - dj * V2[0]) / det, b = (V1[0] * dj - V1[1] * di) / det;
          const m = Math.max(Math.abs(a), Math.abs(b));
          v = m <= 1 - t ? 1 : m < 1 + t ? (1 + t - m) / (2 * t) : 0;
        }
        k[(dj + R) * (2 * R + 1) + di + R] = v; s += v;
      }
      return { k, R, s: s || 1, w: (l1 + l2) };
    }

    // ---- aims: greedy coverage of the blurred paint, sharpest stations first
    let bMax = 0; for (let k = 0; k < Rw * Rw; k++) bMax = Math.max(bMax, Bw[k]);
    const aimCands = [];
    for (let j = 0; j < Rw; j++) for (let i = 0; i < Rw; i++) if (Bw[j * Rw + i] > 0.03 * bMax) aimCands.push(j * Rw + i);
    {
      const nA = Math.min(aimCands.length, +settings.candAims || 220);
      const step = aimCands.length / nA, pick = [];
      for (let q = 0; q < nA; q++) pick.push(aimCands[Math.min(aimCands.length - 1, Math.floor(q * step))]);
      aimCands.length = 0; aimCands.push(...pick);
    }
    const corners = [[0, 0], [Rp - 1, 0], [0, Rp - 1], [Rp - 1, Rp - 1]].map(([i, j]) => worldOf(i, j));
    const gamTo = (P, Z) => Math.acos(Math.max(-1, Math.min(1, V.dot(V.norm(V.sub(P, L)), V.norm(V.sub(Z, P))))));
    const GAM_MIN = (+settings.gamMin || 35) * Math.PI / 180;
    for (const st of stations) {
      let gMin = Infinity;
      for (const Z of corners) gMin = Math.min(gMin, gamTo(st.P, Z));
      st.gMin = gMin;
      st.gam = gamTo(st.P, worldOf(0, 0));
      st.pot = st.Ir * Math.sin(st.gam / 2) / (st.r * st.r);
    }
    stations = stations.filter((st) => st.gMin > GAM_MIN);
    notes.push('after γ floor ' + (+settings.gamMin || 35) + '°: ' + stations.length + ' stations');
    // Coverage decides the blob width: with K facets the paint must be covered ~`overlap` times
    // or the delivery speckles (measured: a 2-cell blob on a 400-cell pattern leaves half the
    // cells dim).  The required width maps to a station radius, so stations are served nearest-
    // first (sharpest first when the envelope allows, wash first when it does not).
    {
      let paintArea = 0;
      for (let k = 0; k < Rp * Rp; k++) if (paint[k] > 0) paintArea += cw * cw;
      const perFacet = (+settings.overlap || 3) * paintArea / Math.max(1, maxFacets);
      const wReq = 2 * Math.sqrt(perFacet / Math.PI);
      const rReq = s0 * Dtyp / Math.max(1e-6, wReq);
      notes.push('coverage: paint ' + paintArea.toFixed(0) + 'mm², w* ' + wReq.toFixed(1) + 'mm → r* ' + rReq.toFixed(0) + 'mm');
      stations.sort((a, b) => (Math.abs(a.r - rReq) - Math.abs(b.r - rReq)) || (b.pot - a.pot));
    }

    // ---- mutual blocking: exact segment-vs-plane-disc test, symmetric in new vs placed
    const segDisc = (A, Bp, Pm, nm, rho) => {
      const ab = V.sub(Bp, A), den = V.dot(ab, nm);
      if (Math.abs(den) < 1e-12) return false;
      const t = V.dot(V.sub(Pm, A), nm) / den;
      if (t <= 1e-6 || t >= 1 - 1e-6) return false;
      return V.dist(V.add(A, V.mul(ab, t)), Pm) <= rho;
    };
    const beamEnd = (Pk, Zk) => {
      const a = V.norm(V.sub(Zk, Pk));
      const iv = Geo.envInterval(env, Pk, a);
      const t = iv && isFinite(iv[1]) && iv[1] > 0 ? Math.min(iv[1], V.len(V.sub(Zk, Pk))) : V.len(V.sub(Zk, Pk));
      return V.add(Pk, V.mul(a, t));
    };
    const placedGeo = [];
    const conflicts = (Pk, Zk, nk, rhoK) => {
      const e = beamEnd(Pk, Zk);
      for (const q of placedGeo) {
        if (segDisc(L, Pk, q.P, q.n, q.rho) || segDisc(Pk, e, q.P, q.n, q.rho)) return true;
        if (segDisc(L, q.P, Pk, nk, rhoK) || segDisc(q.P, beamEnd(q.P, q.Z), Pk, nk, rhoK)) return true;
      }
      return false;
    };

    const del = new Float64Array(Rw * Rw);
    const aimCount = new Int32Array(Rw * Rw);
    const facets = [];
    let nNoAim = 0, nConflict = 0, phase2 = false;
    for (const st of stations) {
      if (facets.length >= maxFacets) break;
      if (!phase2) {                       // shape satisfied? then switch to light collection
        let mn = 0; for (let k = 0; k < Rw * Rw; k++) if (painted[k]) mn = Math.max(mn, Bw[k] - del[k]);
        if (mn < 0.05 * bMax) phase2 = true;
      }
      const ranked = [];
      for (const c of aimCands) {
        const i = c % Rw, j = (c / Rw) | 0;
        const Z = worldOfW(i, j);
        if (!exitsThrow(st.P, Z)) continue;
        const gam = gamTo(st.P, Z);
        const eff = st.Ir * Math.sin(gam / 2) / (st.r * st.r);
        if (eff < 0.10 * st.pot) continue;
        const ed = blobEdges(st.P, Z, st.r);
        const bk = blobKernel(ed[0], ed[1]);
        const bC = bk.k[bk.R * (2 * bk.R + 1) + bk.R] / bk.s;
        const phi0guess = Math.max(Bw[c] - del[c], 0.02 * bMax) / Math.max(1e-6, bC);
        let gain = 0;
        if (phase2) {
          // light collection: catch efficiency × level at the aim, spread over cells that are
          // not already stacked (the LP splits flux among overlapping blobs, but its shape
          // freedom dies if every extra facet aims at the same brightest cell)
          gain = eff * Bw[c] * st.ct / (1 + 3 * aimCount[c]);
        } else {
          for (let dj = -bk.R; dj <= bk.R; dj++) {
            const jj = j + dj; if (jj < 0 || jj >= Rw) continue;
            for (let di = -bk.R; di <= bk.R; di++) {
              const ii = i + di; if (ii < 0 || ii >= Rw) continue;
              const x = jj * Rw + ii;
              const v = bk.k[(dj + bk.R) * (2 * bk.R + 1) + di + bk.R] / bk.s;
              if (painted[x]) { const need = Math.max(Bw[x] - del[x], 1e-3 * Bw[x]); if (need > 0) gain += v * need; }
              else if (gap[x]) gain -= (+settings.gapW || 1.5) * v * phi0guess * v;
            }
          }
          gain *= eff;
        }
        if (gain > 0) ranked.push([gain, { c, i, j, Z, bk, w: bk.w }]);
      }
      if (!ranked.length) { nNoAim++; continue; }
      ranked.sort((a, b) => b[0] - a[0]);
      let ok = null;
      for (let q = 0; q < Math.min(ranked.length, +settings.aimTries || 6); q++) {
        const cand = ranked[q][1];
        const nk = V.norm(V.add(V.norm(V.sub(L, st.P)), V.norm(V.sub(cand.Z, st.P))));
        if (!conflicts(st.P, cand.Z, nk, st.rho)) { ok = cand; break; }
      }
      if (!ok) { nConflict++; continue; }
      st.aim = ok;
      aimCount[ok.c]++;
      const bC = ok.bk.k[ok.bk.R * (2 * ok.bk.R + 1) + ok.bk.R] / ok.bk.s;
      const phi0 = Math.max(Bw[ok.c] - del[ok.c], 0.05 * bMax) / Math.max(1e-6, bC);
      for (let dj = -ok.bk.R; dj <= ok.bk.R; dj++) for (let di = -ok.bk.R; di <= ok.bk.R; di++) {
        const ii = ok.i + di, jj = ok.j + dj; if (ii < 0 || jj < 0 || ii >= Rw || jj >= Rw) continue;
        del[jj * Rw + ii] += phi0 * ok.bk.k[(dj + ok.bk.R) * (2 * ok.bk.R + 1) + di + ok.bk.R] / ok.bk.s;
      }
      facets.push(st);
      placedGeo.push({ P: st.P, Z: ok.Z, n: V.norm(V.add(V.norm(V.sub(L, st.P)), V.norm(V.sub(ok.Z, st.P)))), rho: st.rho });
    }
    notes.push('aims ' + facets.length + '/' + stations.length + ' (noaim ' + nNoAim + ', conflict ' + nConflict + ')');
    if (!facets.length) return empty();

    // ---- does the facet really fit? (envelope + LED clearance on the real surface, as the host checks)
    function fits(st, rho) {
      const s = { type: 'facet', id: 'v', P: st.P, S0: L, Z: st.aim.Z, di: V.len(V.sub(st.aim.Z, st.P)), flat: false,
                  clip: { kind: 'disc', r: rho }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } };
      let G; try { G = Geo.compile([s]); } catch (e) { return false; }
      for (const poly of Geo.outline(G, 0)) {
        for (const p of poly) {
          if (!Geo.envInside(env, p, 1e-6 * Math.max(env.half[0], env.half[1], env.half[2]))) return false;
          if (V.dist(p, L) < keep * (1 - 1e-6)) return false;
        }
        if (keep > 0) {
          const cen = [0, 0, 0];
          for (const p of poly) for (let a = 0; a < 3; a++) cen[a] += p[a] / poly.length;
          const M = 4;
          for (let i = 0; i < poly.length; i++) {
            const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
            for (let a = 0; a <= M; a++) for (let b = 0; a + b <= M; b++) {
              const q = V.add(cen, V.add(V.mul(V.sub(p1, cen), a / M), V.mul(V.sub(p2, cen), b / M)));
              const dq = V.norm(V.sub(q, L));
              const t = Geo.intersect(G.D, G.poly, 0, L[0], L[1], L[2], dq[0], dq[1], dq[2], 1e-9, Infinity);
              if (t >= 0 && t < keep * (1 - 1e-6)) return false;
            }
          }
        }
      }
      return true;
    }
    for (const st of facets) {
      let rho = st.rho;
      while (rho > 0.7 && !fits(st, rho)) rho *= 0.8;
      st.rhoOk = rho;
    }

    // ---- bounded least squares: Φ ≥ 0, Φ ≤ Φmax, minimise Σ W·(Σ Φ_k b_k − tgt)²
    let bSum = 0; for (let k = 0; k < Rw * Rw; k++) if (painted[k]) bSum += Bw[k];
    if (!(bSum > 0)) return empty('no blurred paint');
    const K = facets.length, N = Rw * Rw;
    const cellList = new Array(N); for (let k = 0; k < N; k++) cellList[k] = null;
    const M = new Float64Array(K * K), rhs = new Float64Array(K);
    for (let k = 0; k < K; k++) {
      const st = facets[k], bk = st.aim.bk, R2 = 2 * bk.R + 1;
      st.gam = gamTo(st.P, st.aim.Z);
      st.th = Math.acos(Math.max(-1, Math.min(1, V.dot(st.d, fr.a))));
      st.phiMax = refl * (Src.intensity(src, st.th) / totI) * Math.PI * Math.sin(st.gam / 2) * st.rhoOk * st.rhoOk / (st.r * st.r);
      for (let dj = -bk.R; dj <= bk.R; dj++) {
        const jj = st.aim.j + dj; if (jj < 0 || jj >= Rw) continue;
        for (let di = -bk.R; di <= bk.R; di++) {
          const ii = st.aim.i + di; if (ii < 0 || ii >= Rw) continue;
          const x = jj * Rw + ii, v = bk.k[(dj + bk.R) * R2 + di + bk.R] / bk.s;
          if (v <= 0) continue;
          (cellList[x] || (cellList[x] = [])).push(k, v);
        }
      }
    }
    let capSum = 0; for (let k = 0; k < K; k++) capSum += facets[k].phiMax;
    // the target's absolute scale is free (the scorer fits its own exposure), so aim BELOW the
    // caps: a target that exactly exhausts them binds every cap at once and the fit distorts.
    const alpha = Math.min(1, capSum) * (+settings.levelScale || 0.55);
    // scorer-mirror targets: painted cells get the blurred paint; gap-band cells may legally
    // carry the blurred halo (≤ 1.25 × blur, or 10% of a typical painted cell); far cells ~0.
    let typW = 0, npW = 0;
    for (let k = 0; k < N; k++) if (painted[k]) { typW += Bw[k]; npW++; }
    typW = npW ? typW / npW : 0;
    const tgt = new Float64Array(N);
    const W = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      if (painted[k]) { tgt[k] = alpha * Bw[k] / bSum; W[k] = 1 / Math.max(Bw[k], 0.2) / Math.max(Bw[k], 0.2); }
      else if (gap[k]) { tgt[k] = alpha * (+settings.gapHalF || 0.7) * Math.max(Bw[k], 0.08 * typW) / bSum; W[k] = (+settings.gapW || 1.5) / Math.max(Bw[k] + 0.05, 0.05); }
      else if (far[k]) { tgt[k] = 0; W[k] = +settings.farW || 0.2; }
    }
    for (let x = 0; x < N; x++) {
      const cl = cellList[x]; if (!cl) continue;
      const wx = W[x], tx = tgt[x];
      for (let a = 0; a < cl.length; a += 2) {
        const k = cl[a], vk = cl[a + 1] * wx;
        rhs[k] += vk * tx;
        for (let b = 0; b < cl.length; b += 2) M[k * K + cl[b]] += vk * cl[b + 1];
      }
    }
    const Phi = new Float64Array(K);
    const Dg = new Float64Array(N);
    const solveRound = () => {
      Dg.fill(0);
      for (let k = 0; k < K; k++) {
        if (Phi[k] <= 0) continue;
        const bk = facets[k].aim.bk, R2 = 2 * bk.R + 1;
        for (let dj = -bk.R; dj <= bk.R; dj++) {
          const jj = facets[k].aim.j + dj; if (jj < 0 || jj >= Rw) continue;
          for (let di = -bk.R; di <= bk.R; di++) {
            const ii = facets[k].aim.i + di; if (ii < 0 || ii >= Rw) continue;
            Dg[jj * Rw + ii] += Phi[k] * bk.k[(dj + bk.R) * R2 + di + bk.R] / bk.s;
          }
        }
      }
      for (let it = 0; it < (+settings.lpIters || 1500); it++) {
        for (let k = 0; k < K; k++) {
          const row = k * K, mk = M[row + k];
          if (mk <= 0) continue;
          let s2 = 0;
          for (let l = 0; l < K; l++) if (l !== k) s2 += M[row + l] * Phi[l];
          let nw = (rhs[k] - s2) / mk;
          if (nw < 0) nw = 0; if (nw > facets[k].phiMax) nw = facets[k].phiMax;
          Phi[k] = nw;
        }
      }
    };
    // IRLS: round 1 fits absolutely; later rounds chase the cells that are still off, in the
    // metric the scorer actually uses (a multiplicative ratio), so the fit spends flux where it
    // is dim rather than polishing cells that already pass.
    for (let round = 0; round < 3; round++) {
      if (round > 0) {
        for (let x = 0; x < N; x++) {
          if (!painted[x]) continue;
          const lv = Math.max(Dg[x], 0.3 * tgt[x]);
          W[x] = 1 / lv / lv;
        }
        for (let k = 0; k < K; k++) {
          rhs[k] = 0;
          for (let l = 0; l < K; l++) M[k * K + l] = 0;
        }
        for (let x = 0; x < N; x++) {
          const cl = cellList[x]; if (!cl) continue;
          const wx = W[x], tx = tgt[x];
          for (let a = 0; a < cl.length; a += 2) {
            const k = cl[a], vk = cl[a + 1] * wx;
            rhs[k] += vk * tx;
            for (let b = 0; b < cl.length; b += 2) M[k * K + cl[b]] += vk * cl[b + 1];
          }
        }
      }
      solveRound();
    }

    // ---- final surfaces
    const surfaces = [], intent = [];
    let placed = 0, dropped = 0, areaUsed = 0, phiSum = 0;
    for (let k = 0; k < K; k++) {
      const st = facets[k];
      if (Phi[k] <= 1e-7 || st.phiMax <= 0) continue;
      const catchPerArea = refl * (Src.intensity(src, st.th) / totI) * Math.sin(st.gam / 2) / (st.r * st.r);
      let A = Phi[k] / catchPerArea;
      const Amax = Math.PI * st.rhoOk * st.rhoOk;
      if (A > Amax) A = Amax;
      const rho = Math.sqrt(A / Math.PI);
      if (rho < 0.5) { dropped++; continue; }
      const Z = st.aim.Z, di = V.len(V.sub(Z, st.P));
      const id = 'F' + placed;
      surfaces.push({ type: 'facet', id, P: st.P, S0: L, Z, di, flat: false,
        clip: { kind: 'disc', r: rho }, optics: { interaction: 'reflect', reflectivity: refl, twoSided: false } });
      const cells = [];
      const radP = Math.ceil((st.aim.w * Rp / Rw) / 2 + 2);
      for (let dj = -radP; dj <= radP; dj++) for (let di = -radP; di <= radP; di++) {
        const ii = Math.round(st.aim.i * Rp / Rw + Rp / Rw / 2) + di, jj = Math.round(st.aim.j * Rp / Rw + Rp / Rw / 2) + dj;
        if (ii < 0 || jj < 0 || ii >= Rp || jj >= Rp) continue;
        const c = jj * Rp + ii;
        if (paint[c] > 0) cells.push([c, +paint[c].toFixed(4)]);
      }
      intent.push({ facet: id, cells });
      areaUsed += A; placed++; phiSum += Phi[k];
    }
    // LP self-check: the predicted pattern vs its target, on painted cells
    {
      const Dg = new Float64Array(N);
      for (let k = 0; k < K; k++) {
        if (Phi[k] <= 0) continue;
        const bk = facets[k].aim.bk, R2 = 2 * bk.R + 1;
        for (let dj = -bk.R; dj <= bk.R; dj++) {
          const jj = facets[k].aim.j + dj; if (jj < 0 || jj >= Rw) continue;
          for (let di = -bk.R; di <= bk.R; di++) {
            const ii = facets[k].aim.i + di; if (ii < 0 || ii >= Rw) continue;
            Dg[jj * Rw + ii] += Phi[k] * bk.k[(dj + bk.R) * R2 + di + bk.R] / bk.s;
          }
        }
      }
      const rr = [];
      for (let k = 0; k < N; k++) if (painted[k] && tgt[k] > 1e-6) rr.push(Dg[k] / tgt[k]);
      rr.sort((a, b) => a - b);
      const pc = (q) => rr.length ? rr[Math.min(rr.length - 1, Math.floor(q * (rr.length - 1)))].toFixed(2) : '-';
      let capUsed = 0; for (let k = 0; k < K; k++) capUsed += Phi[k] / Math.max(1e-12, facets[k].phiMax);
      notes.push('LP fit (model): ratio p5/p50/p95 ' + pc(0.05) + '/' + pc(0.5) + '/' + pc(0.95) + ' · caps used ' + (capUsed / K).toFixed(2) + ' · ΣΦ ' + Phi.reduce((a, b) => a + b, 0).toFixed(3) + '/' + capSum.toFixed(3));
      if (notes.length < 60) {
        const j0 = Math.round(Rw / 2);
        let line1 = '', line2 = '', line3 = '';
        for (let i = 0; i < Rw; i++) {
          const t = tgt[j0 * Rw + i], d = Dg[j0 * Rw + i], b = Bw[j0 * Rw + i];
          line1 += (b > 0.05 ? b.toFixed(1).padStart(4) : '    ');
          line2 += (t > 1e-4 ? (t / alpha * bSum).toFixed(2).padStart(5) : '     ');
          line3 += (d > 1e-4 ? (d / alpha * bSum).toFixed(2).padStart(5) : '     ');
        }
        notes.push('row v=' + j0 + ' Bw:' + line1 + '\ntgt:' + line2 + '\nDg :' + line3);
      }
    }
    notes.push('placed ' + placed + ' facets, dropped ' + dropped + ', area ' + areaUsed.toFixed(0) + 'mm², kernel ' + kc.toFixed(1) + ' cells, ΣΦ ' + phiSum.toFixed(3));
    notes.push('LP: capSum ' + capSum.toFixed(3) + ' alpha ' + alpha.toFixed(3));
    return { surfaces, intent, notes };
}

RF.Solvers.register({
  id: 'bench-ling32flash-r2--mosaic', name: 'Mosaic reflector (static)', version: '0.4.0', modes: ['paint'],
  settings: MOSAIC_SETTINGS,
  solve(input, settings) { return mosaicSolve(input, settings); },
});

// ---- tuner: same static core, a few setting vectors, traced once each, best wins.
// (id ends in -auto: tracing inside solve() is allowed for tuners.)
RF.Solvers.register({
  id: 'bench-ling32flash-r2--mosaic-auto', name: 'Mosaic reflector (auto-tuned)', version: '0.4.0', modes: ['paint'],
  settings: MOSAIC_SETTINGS.concat([
    { key: 'goal', label: 'Goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
    { key: 'tuneRays', label: 'Tuner rays', type: 'number', min: 50000, max: 600000, step: 50000, default: 200000 },
  ]),
  solve(input, settings, tools) {
    const goal = settings.goal || 'faithful';
    const cands = [
      { tag: 'default', d: {} },
      { tag: 'level+', d: { levelScale: 0.9, overlap: 4 } },
      { tag: 'sharp', d: { blobScale: 0.75, soft: 2 } },
      { tag: 'gaps', d: { gapW: 14, gapHalF: 0.5 } },
      { tag: 'wide', d: { overlap: 7, levelScale: 0.8 } },
    ];
    const scoreOf = (tr) => {
      const f = tr.fidelity || { fidelity: 0, onPaint: 0 };
      const fid = +f.fidelity || 0, on = +f.onPaint || 0, pk = +tr.peakCd || 0;
      if (goal === 'throw') return fid > 0.05 ? pk * fid : 0;
      if (goal === 'efficient') return fid > 0.05 ? on * fid : 0;
      return fid;
    };
    let best = null, bestScore = -1, bestTag = 'none';
    for (const c of cands) {
      const s2 = Object.assign({}, settings);
      for (const k in c.d) s2[k] = c.d[k];
      let out;
      try { out = mosaicSolve(input, s2); } catch (e) { continue; }
      if (!out || !out.surfaces || !out.surfaces.length) continue;
      let tr = null;
      try { tr = tools.trace(out.surfaces, { rays: +(settings.tuneRays || 200000), seed: 1 }); } catch (e) { continue; }
      if (!tr || !tr.fidelity) continue;
      const sc = scoreOf(tr);
      out.notes = out.notes.concat('tuner ' + c.tag + ' score ' + sc.toFixed(4));
      if (sc > bestScore) { bestScore = sc; best = out; bestTag = c.tag; }
    }
    if (!best) best = mosaicSolve(input, settings);
    best.notes = (best.notes || []).concat('auto picked ' + bestTag + ' (' + goal + ')');
    return best;
  },
});
