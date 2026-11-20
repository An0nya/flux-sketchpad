/* Flux static reflector solver (fully geometric: solve() never traces).
 *
 * The target is a distant plane at world +x, so every useful reflected ray travels +x.  All
 * facets are therefore placed on ONE plane x = xw (a "wall" perpendicular to the throw axis).  A
 * reflected ray leaves that plane with a strictly +x component and can never return to hit another
 * facet (no re-hits); a regular jittered grid keeps tiles disjoint in the LED's view (no shadowing).
 *
 * Aim points are sampled with density proportional to the paint (inverse CDF of paint weights via
 * a Halton sequence, jittered in-cell), so N ~equal-flux facets reproduce the painting.  Curvature
 * is chosen ADAPTIVELY from the scene: a curved ellipsoid images the LED sharply (blobs ~ s0*L/r);
 * a flat facet paints a broader (aperture+LED)*L/r image; whichever is closer to the ideal blob
 * size is used.  A small absorbing shield removes the LED's direct stray light (which would
 * otherwise light the dark gaps).  Flux, image size and clearance are all computed statically.
 *
 * Register order: flux-static (this algorithm) first, then the optional flux-auto tuner.
 */

function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}
// separable box blur of a square R x R grid (fractional width w, centred)
function boxBlur(src, R, w) {
  if (!(w > 1e-6)) return Float64Array.from(src);
  const h = w / 2;
  const pass = (g, alongX) => {
    const out = new Float64Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const c = alongX ? i : j, a0 = c + 0.5 - h, b0 = c + 0.5 + h; let s = 0;
      for (let q = Math.floor(a0); q < Math.ceil(b0); q++) { if (q < 0 || q >= R) continue; s += (Math.min(b0, q + 1) - Math.max(a0, q)) * (alongX ? g[j * R + q] : g[q * R + i]); }
      out[j * R + i] = s / w;
    }
    return out;
  };
  return pass(pass(src, true), false);
}

RF.Solvers.register({
  id: 'bench-hy4full--flux-static', name: 'Flux static reflector', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'inset', label: 'Wall / envelope inset (mm)', type: 'number', min: 2, step: 1, default: 5 },
    { key: 'zLift', label: 'Min wall height above the LED (mm)', type: 'number', min: 6, step: 1, default: 16 },
    { key: 'gap', label: 'Tile gap (fraction of spacing)', type: 'range', min: 0.05, max: 0.5, step: 0.05, default: 0.1 },
    { key: 'apertureMM', label: 'Max facet half-aperture (mm)', type: 'number', min: 0.5, step: 0.5, default: 3 },
    { key: 'fill', label: 'Facets used (fraction of cap)', type: 'range', min: 0.3, max: 1, step: 0.05, default: 1 },
    { key: 'shape', label: 'Facet curvature', type: 'select', options: ['auto', 'curved', 'flat'], default: 'auto' },
    { key: 'coverage', label: 'Target blob overlap (auto shape)', type: 'number', min: 1, step: 1, default: 7 },
    { key: 'blobCells', label: 'Target blob diameter in cells (0 = auto)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'baffle', label: 'Block direct LED haze with an absorbing shield', type: 'checkbox', default: true },
    { key: 'gapX', label: 'Shield distance in front of LED (mm)', type: 'number', min: 3, step: 1, default: 8 },
    { key: 'baffleScale', label: 'Shield size multiplier', type: 'number', min: 0.3, step: 0.1, default: 1 },
    { key: 'focus', label: 'Image distance / target distance (1 = sharp)', type: 'range', min: 0.3, max: 1, step: 0.02, default: 1 },
    { key: 'sharpen', label: 'Unsharp-mask strength on aim density', type: 'range', min: 0, max: 2, step: 0.25, default: 0 },
    { key: 'fluxPow', label: 'Flux-equalisation exponent', type: 'range', min: 0, max: 1, step: 0.1, default: 1 },
    { key: 'equalFlux', label: 'Equalise curved-facet flux via aperture', type: 'checkbox', default: false },
  ],
  solve(input, settings, tools) {
    const V = RF.V, Geo = RF.Geo, Src = RF.Source, Eng = RF.Engine;
    const env = input.envelope, src = input.source, S = src.pos.slice();
    const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);   // effective LED clearance
    // every emitter's clearance is a hard constraint; plan against all of them.
    const srcs = (input.sources && input.sources.length ? input.sources : [src]).map((s) => s.pos.slice());
    const clearOK = (q, extra) => srcs.every((sp) => V.dist(q, sp) >= keep + (extra || 0));
    const a = Src.frame(src).a;
    const T = Eng.targetFrame(input.target);
    const R = input.paint.res, paint = input.paint.cells;
    const cell = 2 * T.half / R;
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const refl = input.limits.reflectivity;
    const N = Math.max(1, Math.min(maxF, Math.round(maxF * (settings.fill == null ? 1 : settings.fill))));
    const half = T.half, C = T.C, tu = T.tu, tv = T.tv;
    const worldAt = (u, v) => [
      C[0] + tu[0] * u + tv[0] * v,
      C[1] + tu[1] * u + tv[1] * v,
      C[2] + tu[2] * u + tv[2] * v,
    ];
    const notes = [], surfaces = [], intent = [];
    const clamp = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;

    // ---- aim density: proportional to the paint, optionally unsharp-masked so that the blur of
    // a finite LED image does not wash out the painting's internal core/annulus contrast.
    const nC = R * R;
    let paintedCells = 0; for (let k = 0; k < nC; k++) if (paint[k] > 0) paintedCells++;
    let dens = paint;
    if (settings.sharpen > 0) {
      const bw = Math.max(1.5, Math.min(8, Math.sqrt(7 * paintedCells / N)));
      const bl = boxBlur(Float64Array.from(paint), R, bw);
      dens = new Float64Array(nC);
      for (let k = 0; k < nC; k++) dens[k] = Math.max(0, paint[k] + settings.sharpen * (paint[k] - bl[k]));
    }
    const cdf = new Float64Array(nC + 1);
    for (let k = 0; k < nC; k++) cdf[k + 1] = cdf[k] + Math.max(0, dens[k] || 0);
    const W = cdf[nC];
    if (!(W > 0)) { notes.push('no paint: nothing to place'); return { surfaces, intent, notes }; }
    const findCell = (s) => {
      let lo = 0, hi = nC;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cdf[m] <= s) lo = m; else hi = m; }
      let k = lo;
      if (!(dens[k] > 0)) for (let d = 1; d < nC; d++) {
        if (k - d >= 0 && dens[k - d] > 0) { k -= d; break; }
        if (k + d < nC && dens[k + d] > 0) { k += d; break; }
      }
      return k;
    };

    // ---- aim points: density proportional to paint, low discrepancy, jittered inside cells
    const aims = [];
    for (let m = 0; m < N; m++) {
      const k = findCell(halton(m + 1, 2) * W), i = k % R, j = (k / R) | 0;
      const u = -half + (i + halton(m + 1, 3)) * cell;
      const v = -half + (j + halton(m + 1, 5)) * cell;
      aims.push({ u, v, w: paint[k], cell: k });
    }

    // ---- the wall: x = xw, perpendicular to the throw (+x) direction.
    const inset = settings.inset == null ? 9 : settings.inset;
    const boxMinX = env.center[0] - env.half[0], boxMaxX = env.center[0] + env.half[0];
    // choose the -x side (smaller deflection) unless the LED clearly tilts toward +x
    const side = a[0] > 0.3 ? 1 : -1;
    let xw = side < 0 ? boxMinX + inset : boxMaxX - inset;
    // keep it strictly on the chosen side of the LED (and inside the box)
    if (side < 0) xw = Math.min(xw, S[0] - 2); else xw = Math.max(xw, S[0] + 2);
    xw = clamp(xw, boxMinX + 1, boxMaxX - 1);

    const yLo = env.center[1] - env.half[1] + inset, yHi = env.center[1] + env.half[1] - inset;
    const zLift = settings.zLift == null ? 15 : settings.zLift;
    // keep every facet away from the LED plane on the side the LED emits (so reflected beams pass
    // well clear of a low-z baffle).  Direction-aware for LEDs that are not mounted facing +z.
    let zLoBox = env.center[2] - env.half[2] + inset, zHiBox = env.center[2] + env.half[2] - inset;
    if (a[2] >= 0) zLoBox = Math.max(zLoBox, S[2] + zLift); else zHiBox = Math.min(zHiBox, S[2] - zLift);
    if (zHiBox - zLoBox < 4) { // too little room: relax the lift rather than placing nothing
      zLoBox = env.center[2] - env.half[2] + inset; zHiBox = env.center[2] + env.half[2] - inset;
    }

    // illuminated (y,z) bounding box on the wall, from the LED's real angular distribution
    const Imax = Src.intensity(src, 0) || 1;
    const litPts = [];
    let byLo = Infinity, byHi = -Infinity, bzLo = Infinity, bzHi = -Infinity;
    const NS = 24;
    for (let p = 0; p <= NS; p++) for (let q = 0; q <= NS; q++) {
      const y = yLo + (yHi - yLo) * p / NS, z = zLoBox + (zHiBox - zLoBox) * q / NS;
      const P = [xw, y, z], d = V.norm(V.sub(P, S));
      const th = Math.acos(clamp(V.dot(d, a), -1, 1));
      if (Src.intensity(src, th) > 0.12 * Imax && V.dist(P, S) > keep + 2 && Geo.envInside(env, P, -0.01)) {
        litPts.push([y, z]);
        if (y < byLo) byLo = y; if (y > byHi) byHi = y;
        if (z < bzLo) bzLo = z; if (z > bzHi) bzHi = z;
      }
    }
    if (litPts.length < 3) { // relax the illumination cut before giving up (unusual LED orientations)
      for (let p = 0; p <= NS; p++) for (let q = 0; q <= NS; q++) {
        const y = yLo + (yHi - yLo) * p / NS, z = zLoBox + (zHiBox - zLoBox) * q / NS;
        const P = [xw, y, z];
        if (V.dist(P, S) > keep + 2 && Geo.envInside(env, P, -0.01)) {
          litPts.push([y, z]);
          if (y < byLo) byLo = y; if (y > byHi) byHi = y; if (z < bzLo) bzLo = z; if (z > bzHi) bzHi = z;
        }
      }
    }
    if (litPts.length < 3) { notes.push('wall not illuminated: nothing to place'); return { surfaces, intent, notes }; }

    // regular, lightly jittered grid of tile centres over the illuminated region
    const Ly = Math.max(1, byHi - byLo), Lz = Math.max(1, bzHi - bzLo);
    let ny = Math.max(1, Math.round(Math.sqrt(N * Ly / Lz)));
    let nz = Math.max(1, Math.round(N / ny));
    while (ny * nz > maxF) { if (ny >= nz) ny--; else nz--; }
    const nTiles = Math.min(N, ny * nz);
    const sy = Ly / ny, sz = Lz / nz, spacing = Math.min(sy, sz);
    const gapK = settings.gap == null ? 0.2 : settings.gap;
    const hCap = 0.5 * spacing * (1 - gapK);          // max half-aperture so tiles never overlap

    const cand = [];
    let gLogSum = 0, gN = 0;
    for (let t = 0; t < nTiles; t++) {
      const gi = t % ny, gj = (t / ny) | 0;
      const jy = (halton(t + 1, 7) - 0.5) * sy * 0.3, jz = (halton(t + 1, 11) - 0.5) * sz * 0.3;
      const y = byLo + (gi + 0.5) * sy + jy, z = bzLo + (gj + 0.5) * sz + jz;
      const P = [xw, y, z], d = V.norm(V.sub(P, S));
      if (!Geo.envInside(env, P, -0.01)) continue;
      const r = V.dist(P, S);
      if (r < keep + 2 || !clearOK(P, 2)) continue;
      const th = Math.acos(clamp(V.dot(d, a), -1, 1));
      const I = Src.intensity(src, th);
      if (!(I > 0.02 * Imax)) continue;
      const aim = aims[t % aims.length];
      const Z = worldAt(aim.u, aim.v);
      const sh = V.norm(V.sub(S, P)), ah = V.norm(V.sub(Z, P));
      const n = V.norm(V.add(sh, ah));
      const cosInc = Math.abs(V.dot(d, n));
      const g = I * cosInc / (r * r);
      if (!(g > 0)) continue;
      gLogSum += Math.log(g); gN++;
      cand.push({ t, P, Z, n, r, aim, g });
    }
    const gRef = gN ? Math.exp(gLogSum / gN) : 1;
    let gMin = Infinity; for (const c of cand) if (c.g < gMin) gMin = c.g;
    if (!isFinite(gMin)) gMin = gRef;

    // ---- ADAPTIVE curvature.  A curved (focused) facet paints the sharpest image the optics allow,
    // of diameter ~ s0 * L / r (the LED image).  If that is already several cells wide the blobs
    // overlap enough to cover the paint; use curved facets (aperture then controls flux only).
    // If the sharp image is small, 100 such blobs leave the paint patchy: use FLAT facets, whose
    // image (aperture + LED) * L/r is broader, and set the aperture to hit a target blob diameter.
    let s0 = src.kind === 'planar' ? (src.shape === 'disc' ? 2 * src.radius : Math.min(src.w, src.h))
      : src.shape === 'cylinder' ? Math.min(2 * src.radius, src.length) : 2 * src.radius;
    s0 = Math.max(0.2, s0 || 2);
    const L = Math.abs(C[0]) || 1;
    const rMean = cand.length ? cand.reduce((s, c) => s + c.r, 0) / cand.length : 50;
    const h0 = settings.apertureMM || 3;                  // an upper cap on aperture; hCap usually binds
    const hRep = Math.min(hCap, h0);
    // curved facet: sharp LED image, diameter ~ s0*L/r.  flat facet: (aperture+LED)*L/r, much
    // bigger because the aperture is magnified too.  Pick whichever image is closer to the target.
    const sharpBlobCells = s0 * L / (rMean * cell);
    const flatBlobCells = (2 * hRep + s0) * L / (rMean * cell);
    let targetBlobCells = settings.blobCells > 0 ? settings.blobCells
      : Math.sqrt((settings.coverage || 7) * paintedCells / Math.max(1, cand.length));
    targetBlobCells = clamp(targetBlobCells, 2.5, 8);
    let shape = settings.shape || 'auto';
    if (shape === 'auto')
      shape = Math.abs(sharpBlobCells - targetBlobCells) <= Math.abs(flatBlobCells - targetBlobCells) ? 'curved' : 'flat';
    const curved = shape === 'curved';
    const focus = settings.focus == null ? 1 : settings.focus;
    const tol = -0.004;
    for (const c of cand) {
      let h;
      if (curved && settings.equalFlux) {
        // curved: the sharp LED image does not depend on aperture, so size the aperture purely to
        // equalise caught flux.  The dimmest-direction facet gets the full hCap; brighter ones less.
        h = hCap * Math.sqrt(gMin / c.g);
      } else {
        const fluxPow = settings.fluxPow == null ? 1 : settings.fluxPow;
        h = Math.min(hCap, h0 * Math.pow(gRef / c.g, 0.5 * fluxPow));
      }
      const frame = V.basis(c.n), ex = frame[0], ey = frame[1];
      let ok = false;
      for (let it = 0; it < 12; it++) {
        ok = true;
        for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
          const q = [c.P[0] + ex[0] * s1 * h + ey[0] * s2 * h,
                     c.P[1] + ex[1] * s1 * h + ey[1] * s2 * h,
                     c.P[2] + ex[2] * s1 * h + ey[2] * s2 * h];
          if (!Geo.envInside(env, q, tol) || !clearOK(q, 0.75)) { ok = false; break; }
        }
        if (ok) break;
        h *= 0.85;
      }
      if (!ok || h < 0.25) continue;
      const di = V.dist(c.P, c.Z) * focus;
      const id = 'F' + c.t;
      surfaces.push({
        type: 'facet', id, group: 'A', P: c.P, S0: S.slice(), Z: c.Z,
        flat: !curved, di: curved ? di : null,
        clip: { kind: 'rect', hx: h, hy: h },
        optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
      });
      intent.push({ facet: id, cells: [[c.aim.cell, Math.max(0, c.aim.w)]] });
    }
    // ---- absorbing baffle: kill the LED's unrefracted (direct) rays that would hit the target.
    // A direct ray from the LED to any point of the target passes through a small square at x = xb,
    // centred at the LED's (y,z).  Every reflected beam, by contrast, is still high (near the wall's
    // z) at that x, so it passes over the shield.  Absorbing parts are free (not counted as facets).
    // Only valid when the reflected beams pass ABOVE the LED (wall on the -x side, LED faces up):
    // otherwise the shield would sit in the reflected beam path instead of the direct-ray path.
    if (settings.baffle && side < 0 && a[2] > 0.1) {
      const gapX = settings.gapX == null ? 8 : settings.gapX;
      let xb = S[0] + gapX;
      xb = clamp(xb, boxMinX + 1, Math.min(boxMaxX - 2, C[0] - 1));
      const t = (xb - S[0]) / (C[0] - S[0]);
      let d = (t * half * 1.15 + 2.5) * (settings.baffleScale == null ? 1 : settings.baffleScale);   // half-width of the direct-ray cone at xb + LED extent + margin
      // clip the shield's half-width so its corners stay inside the envelope / clearance
      const cy = S[1] * (1 - t), cz = S[2] * (1 - t);
      const corners = () => [[xb, cy - d, cz - d], [xb, cy + d, cz - d], [xb, cy + d, cz + d], [xb, cy - d, cz + d]];
      let ok = false;
      for (let it = 0; it < 12 && d > 0.5; it++) {
        ok = corners().every((q) => Geo.envInside(env, q, -0.01) && clearOK(q, 0.75));
        if (ok) break;
        d *= 0.85;
      }
      if (ok) {
        surfaces.push({ type: 'plane', id: 'BAFFLE', group: 'A', P: [xb, cy, cz], n: [1, 0, 0],
          clip: { kind: 'poly', pts3: corners() },
          optics: { interaction: 'absorb', reflectivity: 0 } });
      }
    }
    notes.push(surfaces.filter(s => s.type === 'facet').length + '/' + nTiles + ' facets on wall x=' + xw.toFixed(1) + ', ' + shape + ' (sharp=' + sharpBlobCells.toFixed(1) + 'c, target=' + targetBlobCells.toFixed(1) + 'c), h0=' + h0.toFixed(1) + 'mm' + (settings.baffle ? ', baffle' : ''));
    return { surfaces, intent, notes };
  },
});

/* ----------------------------------------------------------------------------------------------
 * Optional TUNER.  Same static geometry, but it traces a few setting presets with ONE fixed seed
 * (so the only difference between candidates is geometry) and returns the best for the goal.
 * Registered SECOND so hosts that pick the first 'paint' solver use the static one above.
 * An id ending in -auto is allowed to call tools.trace inside solve().
 * -------------------------------------------------------------------------------------------- */
RF.Solvers.register({
  id: 'bench-hy4full--flux-auto', name: 'Flux auto-tuner', version: '1.0', modes: ['paint'],
  settings: [
    { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
    { key: 'goal', label: 'Tuning goal', type: 'select', options: ['faithful', 'throw', 'efficient'], default: 'faithful' },
    { key: 'probeRays', label: 'Rays per candidate probe', type: 'number', min: 20000, step: 10000, default: 180000 },
  ],
  solve(input, settings, tools) {
    const stat = RF.Solvers.get('bench-hy4full--flux-static');
    const defs = RF.Solvers.defaults(stat);
    const md = settings.minDistance || 0;
    const presets = [
      { apertureMM: 2, gap: 0.12, fluxPow: 1 },
      { apertureMM: 3, gap: 0.10, fluxPow: 1 },
      { apertureMM: 4, gap: 0.08, fluxPow: 0 },
      { apertureMM: 3, gap: 0.10, fluxPow: 1, zLift: 20 },
    ];
    const goal = settings.goal || 'faithful';
    const rays = Math.max(20000, Math.min(400000, settings.probeRays || 180000));
    const seed = 0x5eed1234;                    // identical for every candidate and every call
    const tools2 = { progress() {}, preview() {}, budget: tools.budget, scene: tools.scene, trace: tools.trace };
    let best = null;
    for (let i = 0; i < presets.length; i++) {
      const s = Object.assign({}, defs, presets[i], { minDistance: md });
      let out, tr;
      try {
        out = stat.solve(input, s, tools2);
        if (!out || !out.surfaces || !out.surfaces.length) continue;
        tr = tools.trace(out.surfaces, { rays, seed });
      } catch (e) { continue; }
      const f = tr && tr.fidelity;
      let score;
      if (goal === 'throw') score = (tr && tr.peakCd) || 0;
      else if (goal === 'efficient') score = (f ? f.onPaint : 0) + 1e-9 * ((tr && tr.peakCd) || 0);
      else score = f ? f.fidelity : 0;
      if (!best || score > best.score) best = { score, out, i };
      if (tools.progress) tools.progress((i + 1) / presets.length);
    }
    if (!best) {                               // tracing unavailable: fall back to the static default
      const s = Object.assign({}, defs, { minDistance: md });
      return stat.solve(input, s, tools2);
    }
    const out = best.out;
    const notes = (out.notes || []).slice();
    notes.push('tuner goal=' + goal + ' picked preset #' + best.i + ' (score ' + (best.score.toFixed ? best.score.toFixed(4) : best.score) + ')');
    return { surfaces: out.surfaces, intent: out.intent, notes };
  },
});
