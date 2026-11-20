/* solvers/solver.js — "Plate": a static faceted-reflector solver.
 *
 * The algorithm (no ray tracing anywhere in solve()):
 *
 *   1. READ the painting, the target frame, the LED and the envelope.  The judge accepts a painted
 *      cell if the delivered light sits inside a per-cell band [0.8·min(paint, B), 1.25·max(paint, B)]
 *      where B is the paint blurred by the smallest LED image this envelope can make (RF.Photometry
 *      .achievableKernel / boxBlur), and it wants every unpainted cell near the paint to stay under
 *      max(1.25·B, 0.1·typ).  Those bands ARE the specification; everything below serves them.
 *
 *   2. AIM PLACEMENT: a covering greedy.  The most interior uncovered painted cell becomes the next
 *      aim (interior = farthest from the edge of the painting), and everything within a cover radius
 *      of it is considered covered — its image reaches that far.  For every aim we measure the
 *      distance to the edge of the painting and to the nearest change of paint level, which says
 *      how wide an image that aim can afford.
 *
 *   3. POSITIONS: a Fibonacci lattice of directions inside the LED's emission cap (`phiMax` off the
 *      axis); each direction is walked out to the envelope wall (the sharpest place: a facet's blob
 *      is the image of the LED, so its size falls as 1/r).  Every facet sits on the wall — that also
 *      keeps the facets from shadowing each other's LED view, because each owns its own direction.
 *
 *   4. THE BLOB MODEL (validated against traces to ~10-30%): a facet aimed at Z images the LED onto
 *      Z.  Each LED extent vector e maps to  e⊥ = e − (e·d̂)d̂ , reflects about the facet normal
 *      n = unit(unit(LED−P) + unit(Z−P)), and lands at  (di/r)·reflect(e⊥)  projected on the target
 *      axes.  The image is the Minkowski sum of those segments — a hard-edged polygon, which is why
 *      the spill it makes has an edge and not a tail.
 *
 *   5. ASSIGNMENT: aims are given positions greedily, tightest aim first, by a cost in millimetres
 *      of damage: how far the image sticks out past the edge of the painting (spill = flux wasted
 *      and gap credit lost), how far it reaches past a change of paint level (levels mixed), how
 *      far short of its own cells it falls (holes), plus a mild preference for positions that
 *      catch light.  Directions already taken are excluded (angular separation), so no facet
 *      shadows another's view of the LED.
 *
 *   6. FIT: with J[k][f] = the share of facet f's flux that lands in cell k (polygon∩ cell), solve
 *      for the fluxes Φ ≥ 0 that put every painted cell inside its band, keep every gap cell under
 *      its allowance and every far block under 10% of a typical painted cell — a bounded least
 *      squares (FISTA) with a small pull to the middle of each band and a small preference for
 *      facets with light to spare.
 *
 *   7. SCALE + EMIT: the shape fit is scale free (the judge fits its own exposure), so the final
 *      scale is pushed up until the largest facet still fits inside the angular tile its neighbours
 *      leave it; the facet area follows from the flux it must catch.  The result is verified here
 *      (envelope + LED clearance on the real outline) and shrunk if it ever fails.
 *
 *   8. SHIELDS: where the target sits inside the LED's own emission, part of the power flies
 *      straight onto unpainted cells — it can neither be redirected (the geometry is grazing) nor
 *      counted, and it floods the gaps.  Small absorbing patches, free of the facet budget, stop it
 *      only where no facet's tile covers that direction (those rays are already caught) and only
 *      for directions that land off the painting.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- polygons
  function area2(p) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const P = p[i], Q = p[(i + 1) % p.length]; a += P[0] * Q[1] - Q[0] * P[1]; }
    return Math.abs(a) * 0.5;
  }
  function clipHalf(poly, ax, ay, c) {              // keep ax·x + ay·y ≥ c
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length];
      const dp = ax * P[0] + ay * P[1] - c, dq = ax * Q[0] + ay * Q[1] - c;
      if (dp >= 0) out.push(P);
      if (dp >= 0 !== dq >= 0) { const t = dp / (dp - dq); out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]); }
    }
    return out;
  }
  function hull2(pts) {                             // gift wrap (≤ 16 points)
    if (pts.length <= 3) return pts;
    let s = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[s][0] || (pts[i][0] === pts[s][0] && pts[i][1] < pts[s][1])) s = i;
    const out = [];
    let h = s;
    do {
      out.push(pts[h]);
      let nx = 0;
      for (let i = 1; i < pts.length; i++) {
        if (nx === i) continue;
        const ax = pts[nx][0] - pts[h][0], ay = pts[nx][1] - pts[h][1];
        const bx = pts[i][0] - pts[h][0], by = pts[i][1] - pts[h][1];
        const cr = ax * by - ay * bx;
        if (nx === h || cr > 0 || (cr === 0 && (bx * bx + by * by) > (ax * ax + ay * ay))) nx = i;
      }
      h = nx;
    } while (h !== s && out.length < 16);
    return out;
  }

  // ---------------------------------------------------------------- the blob model
  /* Image of the LED through a facet at P aimed at Z.  Returns the (u,v) segments the LED's extent
   * vectors map to, the two extents of the image polygon, the incidence cosines and the flux the
   * facet catches per mm² (as a share of the source power).                                */
  function blob(src, target, P, Z) {
    const V = RF.V, led = src.pos;
    const dx = P[0] - led[0], dy = P[1] - led[1], dz = P[2] - led[2];
    const r = Math.hypot(dx, dy, dz);
    const bz = Z[0] - P[0], by = Z[1] - P[1], bzz = Z[2] - P[2];
    const bl = Math.hypot(bz, by, bzz);
    if (!(r > 1e-6) || !(bl > 1e-6)) return null;
    const d = [dx / r, dy / r, dz / r], b = [bz / bl, by / bl, bzz / bl];
    const n = [-d[0] + b[0], -d[1] + b[1], -d[2] + b[2]];
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (!(nl > 1e-9)) return null;
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const cosAlpha = -(d[0] * n[0] + d[1] * n[1] + d[2] * n[2]);      // incidence at the mirror
    const fr = RF.Source.frame(src);
    const cosPhi = d[0] * fr.a[0] + d[1] * fr.a[1] + d[2] * fr.a[2];  // off-axis angle (Lambertian)
    const T = RF.Engine.targetFrame(target);
    const img = (ex, ey, ez) => {                                     // one LED extent vector → (u,v) mm
      const ed = ex * d[0] + ey * d[1] + ez * d[2];
      const px = ex - ed * d[0], py = ey - ed * d[1], pz = ez - ed * d[2];
      const pd = px * n[0] + py * n[1] + pz * n[2];
      const k = bl / r;
      const tx = (px - 2 * pd * n[0]) * k, ty = (py - 2 * pd * n[1]) * k, tz = (pz - 2 * pd * n[2]) * k;
      return [tx * T.tu[0] + ty * T.tu[1] + tz * T.tu[2], tx * T.tv[0] + ty * T.tv[1] + tz * T.tv[2]];
    };
    const isRect = src.kind === 'planar' && src.shape !== 'disc';
    const W = isRect ? src.w : 2 * (src.radius || 0);
    const H = isRect ? src.h : 2 * (src.radius || 0);
    const Ax = (src.kind === 'volume' && src.shape === 'cylinder') ? (src.length || 0) : 0;
    // the LED spans ±W/2, so its image polygon is the Minkowski sum of the segments
    // ±img(e)/2 — img() is linear, and img(e) with the FULL width is the full image width.
    const s1 = img(fr.u[0] * W, fr.u[1] * W, fr.u[2] * W);
    const s2 = img(fr.v[0] * H, fr.v[1] * H, fr.v[2] * H);
    const s3 = Ax ? img(fr.a[0] * Ax, fr.a[1] * Ax, fr.a[2] * Ax) : [0, 0];
    s1[0] *= 0.5; s1[1] *= 0.5; s2[0] *= 0.5; s2[1] *= 0.5; s3[0] *= 0.5; s3[1] *= 0.5;
    // Minkowski sum of the three segments (the LED image polygon)
    const pts = [];
    for (let m = 0; m < 8; m++) {
      pts.push([(m & 1 ? s1[0] : -s1[0]) + (m & 2 ? s2[0] : -s2[0]) + (m & 4 ? s3[0] : -s3[0]),
                (m & 1 ? s1[1] : -s1[1]) + (m & 2 ? s2[1] : -s2[1]) + (m & 4 ? s3[1] : -s3[1])]);
    }
    const poly = hull2(pts);
    let uExt = 0, vExt = 0;
    for (const q of pts) { uExt = Math.max(uExt, Math.abs(q[0])); vExt = Math.max(vExt, Math.abs(q[1])); }
    return {
      r, cosAlpha, cosPhi, poly, uExt: 2 * uExt, vExt: 2 * vExt,
      fluxPerArea: cosPhi > 0 ? cosPhi * cosAlpha * cosAlpha / (Math.PI * r * r) : 0,
    };
  }

  // distance from an interior point to the envelope wall (min over a fixed direction set)
  const BD = [];
  for (const a of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
                   [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0], [1, 0, 1], [1, 0, -1],
                   [-1, 0, 1], [-1, 0, -1], [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
                   [1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1], [1, -1, -1], [-1, 1, -1],
                   [-1, -1, 1], [-1, -1, -1]]) {
    const l = Math.hypot(a[0], a[1], a[2]);
    BD.push([a[0] / l, a[1] / l, a[2] / l]);
  }
  // Distance from an interior point to the envelope wall along one direction, by bisection on
  // envInside.  (RF.Geo.envInterval is exact for boxes but returns an empty interval for a ray
  // parallel to a cylinder's axis, which silently disabled the wall pull — found on a held-out
  // cylinder envelope, where facets poked through the end cap.)
  function exitDist(env, P, d) {
    let lo = 0, hi = 1;
    while (hi < 1e4 && RF.Geo.envInside(env, [P[0] + d[0] * hi, P[1] + d[1] * hi, P[2] + d[2] * hi], 0)) {
      lo = hi; hi *= 1.7;
    }
    if (hi >= 1e4) return Infinity;
    for (let i = 0; i < 22; i++) {
      const mid = 0.5 * (lo + hi);
      if (RF.Geo.envInside(env, [P[0] + d[0] * mid, P[1] + d[1] * mid, P[2] + d[2] * mid], 0)) lo = mid; else hi = mid;
    }
    return lo;
  }
  function wallDist(env, P) {
    let m = Infinity;
    for (const d of BD) { const t = exitDist(env, P, d); if (t < m) m = t; }
    return m;
  }

  // ---------------------------------------------------------------- the static solver
  const MIN_DISTANCE = { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 };
  // the knobs, shared by both registrations: plate uses the defaults below as they are, plate-auto starts
  // from the same values and searches around them with traces.
  const KNOBS = [
    { key: 'phiMax', label: 'Max off-axis angle (°)', type: 'range', min: 55, max: 87, step: 1, default: 87 },
    { key: 'blobScale', label: 'Blob model safety', type: 'range', min: 1, max: 1.6, step: 0.05, default: 1.2 },
    { key: 'fitBlob', label: 'Image width in fit', type: 'range', min: 1, max: 2, step: 0.05, default: 1.2 },
    { key: 'gapWeight', label: 'Gap penalty weight', type: 'range', min: 0, max: 2, step: 0.1, default: 0.3 },
    { key: 'epsCap', label: 'Capacity preference', type: 'range', min: 0, max: 0.05, step: 0.002, default: 0.004 },
    { key: 'bandAim', label: 'Target inside band (0=lo, 1=hi)', type: 'range', min: 0, max: 1, step: 0.05, default: 0.55 },
    { key: 'aimDensity', label: 'Aims per facet', type: 'range', min: 0.3, max: 1, step: 0.05, default: 1 },
    { key: 'aimCover', label: 'Aim cover radius × image', type: 'range', min: 0.15, max: 0.7, step: 0.05, default: 0.3 },
    { key: 'fitIters', label: 'Fit iterations', type: 'range', min: 100, max: 2000, step: 100, default: 800 },
    { key: 'tileFill', label: 'Tile fill', type: 'range', min: 0.3, max: 1, step: 0.05, default: 0.75 },
    { key: 'shields', label: 'Shield direct spill', type: 'checkbox', default: true },
  ];

  function solveStatic(input, settings, tools) {
      const V = RF.V, Geo = RF.Geo;
      const src = input.source, env = input.envelope, tgt = input.target;
      const paint = input.paint, res = Math.max(1, paint.res | 0), pc = paint.cells;
      const maxF = Math.max(1, input.limits.maxFacets | 0), refl = input.limits.reflectivity;
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
      const T = RF.Engine.targetFrame(tgt);
      const cell = 2 * T.half / res;
      const led = src.pos;
      const notes = [];
      const sources = (input.sources && input.sources.length) ? input.sources : [src];
      const Ptot = sources.reduce((a, s) => a + (s.power || 0), 0) || src.power || 1;
      const uOf = (i) => -T.half + (i + 0.5) * cell;
      const vOf = (j) => -T.half + (j + 0.5) * cell;
      const world = (u, v) => RF.Engine.targetUVtoWorld(T, u, v);

      // ---- painted cells
      const painted = [];
      let psum = 0;
      for (let k = 0; k < res * res; k++) if (pc[k] > 0) { painted.push(k); psum += pc[k]; }
      if (!painted.length) return { surfaces: [], intent: [], notes: ['paint is empty'] };
      const typ = psum / painted.length;

      // ---- the judge's reference blur, cell classes and per-cell bands
      const ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: tgt });
      const kerMM = ker.mm > 0 ? ker.mm : cell;
      const B = RF.Photometry.boxBlur(pc, res, ker.cells);
      const rb = Math.ceil(ker.cells) + 2;
      const near = new Uint8Array(res * res);
      for (const k of painted) {
        const i = k % res, j = (k / res) | 0;
        for (let dj = -rb; dj <= rb; dj++) {
          const jj = j + dj; if (jj < 0 || jj >= res) continue;
          for (let di = -rb; di <= rb; di++) { const ii = i + di; if (ii >= 0 && ii < res) near[jj * res + ii] = 1; }
        }
      }
      const isPaint = (k) => pc[k] > 0;
      const isGap = (k) => !isPaint(k) && near[k] === 1;

      // ---- candidate positions: a Fibonacci lattice of directions inside the emission cap,
      //      each walked out to the envelope wall (the sharpest place for a facet)
      const fr = RF.Source.frame(src), axis = fr.a;
      const capZ = Math.cos(settings.phiMax * Math.PI / 180);
      const nC = Math.max(16, 3 * maxF);
      const cand = [];
      const GOLD = Math.PI * (3 - Math.sqrt(5));
      const a0 = 6.5;                                    // provisional facet circumradius (mm)
      for (let k = 0; k < nC; k++) {
        const z = 1 - (k + 0.5) * (1 - capZ) / nC;
        const s = Math.sqrt(Math.max(0, 1 - z * z)), th = GOLD * k;
        const la = Math.cos(th) * s, lb = Math.sin(th) * s;
        const dir = [axis[0] * z + fr.u[0] * la + fr.v[0] * lb,
                     axis[1] * z + fr.u[1] * la + fr.v[1] * lb,
                     axis[2] * z + fr.u[2] * la + fr.v[2] * lb];
        let r = exitDist(env, led, dir);
        if (!(r > 2) || !isFinite(r)) continue;
        r -= 0.5;
        let P = [led[0] + dir[0] * r, led[1] + dir[1] * r, led[2] + dir[2] * r];
        for (let it = 0; it < 6; it++) {                   // pull in until a facet fits inside the wall
          const bd = wallDist(env, P);
          if (bd >= a0 + 0.5) break;
          r -= (a0 + 0.5 - bd);
          if (!(r > 1)) break;
          P = [led[0] + dir[0] * r, led[1] + dir[1] * r, led[2] + dir[2] * r];
        }
        const rr = Math.hypot(P[0] - led[0], P[1] - led[1], P[2] - led[2]);
        if (rr < keep + a0 + 0.5) continue;                // LED clearance with room for the facet
        if (!Geo.envInside(env, P, 0)) continue;
        // rough image size aiming at the pattern centre: enough to throw away the positions
        // whose image would be a flood rather than a brush stroke
        const m0 = blob(src, tgt, P, world(0, 0));
        if (!m0) continue;
        cand.push({ dir, P, r: rr, cosPhi: z, uE: m0.uExt, vE: m0.vExt, sep: Infinity });
      }
      {
        const mins = cand.map((c) => Math.min(c.uE, c.vE)).sort((a, b) => a - b);
        const wm = mins[mins.length >> 1] || 1;
        const keepC = cand.filter((c) => Math.max(c.uE, c.vE) <= 1.7 * wm);
        if (keepC.length >= 8) { cand.length = 0; for (const c of keepC) cand.push(c); }
      }

      if (!cand.length) return { surfaces: [], intent: [], notes: ['no usable position in the envelope'] };

      // rough blob size at the pattern centre: how finely the paint may be tiled (the aims must be
      // close enough together that their images overlap and cover the painting)
      const Zmid = world(0, 0);
      const wTyp = (() => {
        const t = [];
        for (const c of cand) { const m = blob(src, tgt, c.P, Zmid); if (m) t.push(Math.min(m.uExt, m.vExt)); }
        t.sort((a, b) => a - b);
        return t.length ? t[t.length >> 1] : cell;
      })();

      // ---- per-cell distance to the edge of the painting (out) and to any change of paint level
      //      (lvl), along each axis.  Spilling past the first one wastes flux and loses gap credit;
      //      crossing the second mixes levels on painted cells.
      const dUo = new Float64Array(res * res), dUl = new Float64Array(res * res);
      const dVo = new Float64Array(res * res), dVl = new Float64Array(res * res);
      const scanDir = (i0, j0, di, dj, lvlOnly) => {
        const lev = pc[j0 * res + i0];
        for (let t = 1; t < res; t++) {
          const ii = i0 + di * t, jj = j0 + dj * t;
          if (ii < 0 || jj < 0 || ii >= res || jj >= res) return t * cell;
          const w = pc[jj * res + ii];
          if (w <= 0) return t * cell;
          if (lvlOnly && Math.abs(w - lev) > 0.25 * lev) return t * cell;
        }
        return res * cell;
      };
      for (const k of painted) {
        const i = k % res, j = (k / res) | 0;
        dUo[k] = Math.min(scanDir(i, j, 1, 0, false), scanDir(i, j, -1, 0, false));
        dUl[k] = Math.min(scanDir(i, j, 1, 0, true), scanDir(i, j, -1, 0, true));
        dVo[k] = Math.min(scanDir(i, j, 0, 1, false), scanDir(i, j, 0, -1, false));
        dVl[k] = Math.min(scanDir(i, j, 0, 1, true), scanDir(i, j, 0, -1, true));
      }

      // ---- aim placement: a covering greedy.  The most interior uncovered painted cell becomes
      //      the next aim (interior = farthest from the edge of the painting, so its image can
      //      reach the edge without sticking out into the gaps), and everything within Rcover of
      //      it is considered covered — its image reaches that far anyway.  Thin parts of the
      //      painting (a band narrower than the image) are covered last, by aims that have to sit
      //      close to an edge; the assignment step then looks for a position whose image is sharp
      //      across the band.
      const nAmax = Math.max(1, Math.min(maxF, Math.round(maxF * settings.aimDensity)));
      const dout = new Float64Array(res * res);
      for (const k of painted) dout[k] = Math.min(dUo[k], dVo[k]);
      // cover radius: small enough that nAmax aims can tile the painting, and no larger than the
      // image half-width, or the aims' own images would leave holes between them
      // cover radius: the greedy marks a square (an image is closer to a rectangle than a disc and
      // squares tile the painting), so nAmax aims can cover it as long as R ≥ √(area / 4n) — and
      // no more than the image half-width, or the aims' own images leave holes between them
      const paintArea = painted.length * cell * cell;
      const Rmin = 1.5 * Math.sqrt(Math.max(1, paintArea) * 0.7 / (Math.PI * Math.max(1, nAmax)));
      const Rcover = Math.max(cell * 0.5, Math.min(Math.max(Rmin, settings.aimCover * wTyp * settings.blobScale),
                                                   0.6 * wTyp * settings.blobScale));
      const covered = new Uint8Array(res * res);
      const order = painted.slice().sort((a, b) => (dout[b] - dout[a]) || (pc[b] - pc[a]) || (a - b));
      let aims = [];
      for (const k of order) {
        if (aims.length >= nAmax) break;
        if (covered[k]) continue;
        const i0 = k % res, j0 = (k / res) | 0, u0 = uOf(i0), v0 = vOf(j0);
        let m = 0, su = 0, sv = 0;                        // aim at the local paint centroid
        for (const k2 of painted) {
          const i2 = k2 % res, j2 = (k2 / res) | 0;
          const du = uOf(i2) - u0, dv = vOf(j2) - v0;
          if (du * du + dv * dv > 0.25 * Rcover * Rcover) continue;
          const w = pc[k2]; m += w; su += w * uOf(i2); sv += w * vOf(j2);
        }
        let au = m > 0 ? su / m : u0, av = m > 0 ? sv / m : v0;
        { // an image centred in a gap lights nothing: snap the aim onto painted ground
          const ai = Math.round((au + T.half) / cell - 0.5), aj = Math.round((av + T.half) / cell - 0.5);
          if (!(ai >= 0 && aj >= 0 && ai < res && aj < res && pc[aj * res + ai] > 0)) {
            const kk = nearestPainted(ai, aj);
            if (kk >= 0) { au = uOf(kk % res); av = vOf((kk / res) | 0); }
          }
        }
        const cells = [];
        let mass = 0;
        for (const k2 of painted) {
          const i2 = k2 % res, j2 = (k2 / res) | 0;
          const du = uOf(i2) - au, dv = vOf(j2) - av;
          if (du * du + dv * dv > Rcover * Rcover) continue;
          cells.push(k2); mass += pc[k2]; covered[k2] = 1;
        }
        aims.push({ u: au, v: av, mass, cells });
      }
      aims.sort((a, b) => (a.v - b.v) || (a.u - b.u));
      aims.forEach((a, i) => { a.id = i; a.Z = world(a.u, a.v); });

      // the aim's own feature scales, read off the cell it sits on
      // the aim's own feature scales, read off the cell it sits on
      const nearestPainted = (i, j) => {
        if (i >= 0 && j >= 0 && i < res && j < res && pc[j * res + i] > 0) return j * res + i;
        for (let t = 1; t <= 8; t++) for (let dj = -t; dj <= t; dj++) for (let di = -t; di <= t; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== t) continue;
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < res && jj < res && pc[jj * res + ii] > 0) return jj * res + ii;
        }
        return -1;
      };
      for (const a of aims) {
        const ci = Math.max(0, Math.min(res - 1, Math.round((a.u + T.half) / cell - 0.5)));
        const cj = Math.max(0, Math.min(res - 1, Math.round((a.v + T.half) / cell - 0.5)));
        const k0 = nearestPainted(ci, cj);
        a.ou = dUo[k0]; a.ol = dUl[k0]; a.ov = dVo[k0]; a.vl = dVl[k0];
        a.du = a.ol; a.dv = a.vl;
      }

      // angular separation bookkeeping (no facet may sit in another's LED view)
      const nC2 = cand.length;
      const capSolid = 2 * Math.PI * (1 - capZ);
      const hAng = Math.sqrt(capSolid / nC2);
      let minSep = 1.4 * hAng;
      const sepMin = 0.5 * hAng;
      const angSep = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
      const sepTo = new Float64Array(nC2).fill(Infinity);
      const used = new Uint8Array(nC2);

      // ---- assignment: tightest aim first, one facet each, then extra facets by paint mass
      const bs = settings.blobScale;
      // per axis: how far the blob sticks out past the nearest change of paint level (spill into a
      // gap, which the judge credits hardly at all), and how deep it would under-light cells the
      // judge already counts as interior (0.3·W > half the judge's own kernel).
      const harm = (W, dOut, dLvl) => {
        const s = 0.5 * W - dOut;                        // sticks out of the painting
        const spill = s > 0 ? s : 0;
        const mix = 0.5 * W - dLvl;                      // crosses a change of paint level
        return spill + (mix > 0 ? 0.6 * mix : 0);
      };
      const COST_MAX = Math.max(90, 1.5 * wTyp);   // mm: costs are spill depth in mm; allow up to 1.5× the typical image size
      const fMed = (() => {
        const t = cand.map((c) => c.cosPhi / (c.r * c.r)).sort((a, b) => a - b);
        return t[t.length >> 1] || 1;
      })();
      const costOf = (a, c) => {
        const m = blob(src, tgt, c.P, a.Z);
        if (!m || m.cosAlpha < 0.4 || m.cosPhi < 0.05) return null;
        const Wu = m.uExt * bs, Wv = m.vExt * bs;
        // predicted depth of cells this aim's own blob would light wrongly (mm), plus a mild
        // penalty only for directions that catch less than 4× the median share of the LED
        const flux = m.cosPhi * m.cosAlpha * m.cosAlpha / (m.r * m.r);
        const ratio = fMed / Math.max(flux, 1e-14);
        // an image too small to reach the cells this aim is responsible for leaves holes in the
        // painting no other facet may fill
        const reach = 2 * Math.max(0, Rcover - 0.5 * Math.min(m.uExt, m.vExt) * bs);
        return { m, cost: harm(Wu, a.ou, a.ol) + harm(Wv, a.ov, a.vl) + reach
               + 15 * Math.max(0, Math.log2(Math.max(ratio, 1e-9)) - 2) };
      };
      const needOrder = aims.slice().sort((a, b) => (Math.min(a.du, a.dv) - Math.min(b.du, b.dv)) || (a.id - b.id));
      const massOrder = aims.slice().sort((a, b) => (b.mass - a.mass) || (a.id - b.id));
      const picks = [];                                   // {aim, cand, model}
      // round 1: every aim gets its best free direction (tightest aim first); later rounds: heaviest
      // aims first — each extra facet doubles the light that aim can catch without overlapping.
      const rounds = [needOrder];
      let given = aims.length;
      while (given < maxF && rounds.length < 40) { rounds.push(massOrder); given += aims.length; }
      for (const round of rounds) {
        if (picks.length >= maxF) break;
        for (const a of round) {
          if (picks.length >= maxF) break;
          let sepNeeded = minSep;
          let best = null, bestCost = Infinity, bestM = null;
          for (;;) {
            for (let c = 0; c < nC2; c++) {
              if (used[c]) continue;
              if (sepTo[c] < sepNeeded) continue;
              const r = costOf(a, cand[c]);
              if (!r) continue;
              const cost = r.cost + 0.001 * c;
              if (cost < bestCost) { bestCost = cost; best = c; bestM = r.m; }
            }
            if (best !== null || sepNeeded <= sepMin) break;
            sepNeeded = Math.max(sepMin, sepNeeded * 0.85);
          }
          if (best === null || bestCost > COST_MAX) continue;
          used[best] = 1;
          const dc = cand[best].dir;
          for (let c = 0; c < nC2; c++) {
            const s = angSep(dc, cand[c].dir);
            if (s < sepTo[c]) sepTo[c] = s;
          }
          sepTo[best] = Infinity;
          picks.push({ aim: a, cand: best, model: bestM, sep: minSep, cost: bestCost });
        }
      }
      // final per-pick separation (distance to the nearest other chosen direction)
      for (const p of picks) {
        let s = Infinity;
        for (const q of picks) {
          if (q === p) continue;
          const t = angSep(cand[p.cand].dir, cand[q.cand].dir);
          if (t < s) s = t;
        }
        p.sep = isFinite(s) ? s : minSep;
      }
      if (!picks.length) return { surfaces: [], intent: [], notes: ['no facet could be placed'] };

      // ---- J: share of each facet's flux landing in each cell (image polygon ∩ cell)
      const nF = picks.length;
      const Jc = [], Jf = [];
      const cw = cell;
      for (const p of picks) {
        const m = p.model, cen = [p.aim.u, p.aim.v];
        // the image polygon is centred on the aim; blobScale inflates it (the model under-predicts
        // the measured image by up to ~30%, and predicting a wider, dimmer blob is the safe side)
        const poly0 = m.poly.map((q) => [cen[0] + settings.fitBlob * q[0], cen[1] + settings.fitBlob * q[1]]);
        const cells = [], fr2 = [];
        let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
        for (const q of poly0) {
          i0 = Math.min(i0, q[0]); i1 = Math.max(i1, q[0]);
          j0 = Math.min(j0, q[1]); j1 = Math.max(j1, q[1]);
        }
        const ii0 = Math.max(0, Math.floor((i0 + T.half) / cw)), ii1 = Math.min(res - 1, Math.ceil((i1 + T.half) / cw));
        const jj0 = Math.max(0, Math.floor((j0 + T.half) / cw)), jj1 = Math.min(res - 1, Math.ceil((j1 + T.half) / cw));
        const tot = area2(poly0) || 1;
        for (let jj = jj0; jj <= jj1; jj++) for (let ii = ii0; ii <= ii1; ii++) {
          const x0 = -T.half + ii * cw, x1 = x0 + cw, y0 = -T.half + jj * cw, y1 = y0 + cw;
          let poly = poly0;
          poly = clipHalf(poly, 1, 0, x0); if (!poly.length) continue;
          poly = clipHalf(poly, -1, 0, -x1); if (!poly.length) continue;
          poly = clipHalf(poly, 0, 1, y0); if (!poly.length) continue;
          poly = clipHalf(poly, 0, -1, -y1); if (!poly.length) continue;
          const a = area2(poly);
          if (a > 1e-9) { cells.push(jj * res + ii); fr2.push(a / tot); }
        }
        Jc.push(Int32Array.from(cells));
        Jf.push(Float64Array.from(fr2));
      }

      // ---- fit the fluxes
      const n = res * res;
      const lo = new Float64Array(n), hi = new Float64Array(n), Tg = new Float64Array(n), allow = new Float64Array(n);
      const w = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        if (isPaint(k)) {
          lo[k] = 0.8 * Math.min(pc[k], B[k]);
          hi[k] = 1.25 * Math.max(pc[k], B[k]);
          if (!(lo[k] > 0)) lo[k] = Math.min(hi[k], 0.8 * pc[k]);
          Tg[k] = (hi[k] > lo[k]) ? lo[k] * Math.pow(hi[k] / lo[k], settings.bandAim) : hi[k];
          w[k] = 1;
        } else if (isGap(k)) {
          allow[k] = Math.max(1.25 * B[k], 0.1 * typ);
          w[k] = 1;
        }
      }
      // far blocks: every 5×5 block whose cells are all outside the gap band
      const FB = 5, blocks = [];
      for (let bj = 0; bj + FB <= res; bj += FB) for (let bi = 0; bi + FB <= res; bi += FB) {
        const idx = [];
        for (let j = bj; j < bj + FB; j++) for (let i = bi; i < bi + FB; i++) {
          const k = j * res + i;
          if (!isPaint(k) && !near[k]) idx.push(k);
        }
        if (idx.length * 2 >= FB * FB) blocks.push(Int32Array.from(idx));
      }
      const farLim = 0.1 * typ;

      // geometric flux cap per facet: it must fit the angular tile its neighbours leave it
      const capA = new Float64Array(nF), capF = new Float64Array(nF);
      for (let f = 0; f < nF; f++) {
        const p = picks[f], m = p.model;
        capA[f] = settings.tileFill * 0.5 * p.sep * p.sep * m.r * m.r;
        capF[f] = capA[f] * m.fluxPerArea * Ptot;
      }

      const Phi = new Float64Array(nF);
      for (let f = 0; f < nF; f++) {
        let num = 0, den = 1e-12;
        const cs = Jc[f], fs = Jf[f];
        for (let t = 0; t < cs.length; t++) { const k = cs[t]; if (isPaint(k)) { num += fs[t] * Tg[k]; den += fs[t]; } }
        const v = num / den;
        Phi[f] = Math.max(1e-6, Math.min(v, 4 * typ));      // the mean level this blob can hope for
      }
      const G = new Float64Array(n), rg = new Float64Array(n), grad = new Float64Array(nF);
      let capMed = 1; {
        const t = Array.from(capF).filter((v) => v > 0).sort((a, b) => a - b);
        if (t.length) capMed = t[t.length >> 1];
      }
      const epsCap = settings.epsCap, wPull = 0.25, wGap = settings.gapWeight, wFar = 0.6;
      const evalLoss = (x, wantGrad) => {
        G.fill(0);
        for (let f = 0; f < nF; f++) {
          const v = x[f]; if (v === 0) continue;
          const cs = Jc[f], fs = Jf[f];
          for (let t = 0; t < cs.length; t++) G[cs[t]] += v * fs[t];
        }
        rg.fill(0);
        let loss = 0;
        for (let k = 0; k < n; k++) {
          const g = G[k];
          if (isPaint(k)) {
            let r = 0;
            if (g < lo[k]) { const e = lo[k] - g; loss += e * e; r = -2 * e; }
            else if (g > hi[k]) { const e = g - hi[k]; loss += e * e; r = 2 * e; }
            const e2 = g - Tg[k]; loss += wPull * e2 * e2; r += 2 * wPull * e2;
            rg[k] = w[k] * r;
          } else if (isGap(k)) {
            if (g > allow[k]) { const e = g - allow[k]; loss += wGap * e * e; rg[k] = 2 * wGap * e; }
          }
        }
        for (const bl of blocks) {
          let s = 0;
          for (let t = 0; t < bl.length; t++) s += G[bl[t]];
          const avg = s / bl.length;
          if (avg > farLim) {
            const e = avg - farLim; loss += wFar * e * e;
            const r = 2 * wFar * e / bl.length;
            for (let t = 0; t < bl.length; t++) rg[bl[t]] += r;
          }
        }
        if (wantGrad) {
          grad.fill(0);
          for (let f = 0; f < nF; f++) {
            const cs = Jc[f], fs = Jf[f];
            let s = 0;
            for (let t = 0; t < cs.length; t++) s += fs[t] * rg[cs[t]];
            grad[f] = s + 2 * epsCap * x[f] / Math.max(1e-9, capF[f] * capMed);
          }
        }
        return loss;
      };

      // Lipschitz estimate of the smooth part by power iteration on JᵀWJ
      let L = 1;
      {
        let v = new Float64Array(nF).fill(1 / Math.sqrt(nF)), u = new Float64Array(n), lam = 0;
        for (let it = 0; it < 14; it++) {
          u.fill(0);
          for (let f = 0; f < nF; f++) {
            const cs = Jc[f], fs = Jf[f], vf = v[f];
            if (!vf) continue;
            for (let t = 0; t < cs.length; t++) u[cs[t]] += vf * fs[t];
          }
          for (let k = 0; k < n; k++) u[k] *= w[k];
          let z = 0;
          for (let f = 0; f < nF; f++) {
            const cs = Jc[f], fs = Jf[f];
            let s = 0;
            for (let t = 0; t < cs.length; t++) s += fs[t] * u[cs[t]];
            grad[f] = s; z += s * s;
          }
          const nrm = Math.sqrt(z);
          if (!(nrm > 1e-12)) break;
          lam = nrm;
          for (let f = 0; f < nF; f++) v[f] = grad[f] / nrm;
        }
        let capMin = Infinity;
        for (let f = 0; f < nF; f++) if (capF[f] > 0 && capF[f] < capMin) capMin = capF[f];
        // the objective's gradient also carries the pull term (wPull on painted rows) and the
        // far-block terms; underestimating L makes the momentum oscillate instead of converge
        L = 1.6 * lam;
        if (!(L > 0) || !isFinite(L)) L = 1;
      }

      // FISTA on the non-negative orthant (optionally bounded above)
      const iters = Math.max(50, settings.fitIters | 0);
      const runFit = (bound, init) => {
        const x = Float64Array.from(init), y = Float64Array.from(init), xPrev = Float64Array.from(init);
        let tk = 1;
        for (let it = 0; it < iters; it++) {
          evalLoss(y, true);
          const step = 1 / L;
          for (let f = 0; f < nF; f++) {
            let nv = y[f] - step * grad[f];
            if (!(nv > 0)) nv = 0;
            if (nv > bound[f]) nv = bound[f];
            x[f] = nv;
          }
          const tk1 = 0.5 * (1 + Math.sqrt(1 + 4 * tk * tk));
          const beta = (tk - 1) / tk1;
          for (let f = 0; f < nF; f++) y[f] = x[f] + beta * (x[f] - xPrev[f]);
          xPrev.set(x);
          tk = tk1;
        }
        evalLoss(x, false);
        return x;
      };
      const unbounded = new Float64Array(nF).fill(Infinity);
      const inBandOf = () => { let c = 0; for (let k = 0; k < n; k++) if (isPaint(k) && G[k] >= lo[k] && G[k] <= hi[k]) c++; return c; };
      const splitOf = () => { let u = 0, b = 0, dark = 0, lit = 0;
        for (let k = 0; k < n; k++) if (isPaint(k)) { lit++; if (G[k] < lo[k]) { u++; if (G[k] < 0.5 * lo[k]) dark++; } else if (G[k] > hi[k]) b++; }
        return 'under ' + u + '(' + dark + ' dark) over ' + b + ' of ' + lit; };
      evalLoss(Phi, false); const loss0 = evalLoss(Phi, false), ib0 = inBandOf();
      const lossParts = (xx) => {
        evalLoss(xx, false);
        let bp = 0, pu = 0, gp = 0, fb = 0;
        for (let k = 0; k < n; k++) {
          if (isPaint(k)) { const g = G[k]; if (g < lo[k]) bp += (lo[k] - g) ** 2; else if (g > hi[k]) bp += (g - hi[k]) ** 2; pu += wPull * (g - Tg[k]) ** 2; }
          else if (isGap(k) && G[k] > allow[k]) gp += (G[k] - allow[k]) ** 2;
        }
        for (const bl of blocks) { let s2 = 0; for (let t = 0; t < bl.length; t++) s2 += G[bl[t]]; const av = s2 / bl.length; if (av > farLim) fb += wFar * (av - farLim) ** 2; }
        return 'band ' + bp.toFixed(1) + ' pull ' + pu.toFixed(1) + ' gap ' + gp.toFixed(1) + ' far ' + fb.toFixed(2);
      };
      let x = runFit(unbounded, Phi); const ib1 = inBandOf(), loss1 = evalLoss(x, false);
      { // one loose bounded pass: no facet may demand more than a fair share of the exposure
        let s0e = Infinity;
        for (let f = 0; f < nF; f++) if (x[f] > 1e-9) s0e = Math.min(s0e, capF[f] / x[f]);
        if (isFinite(s0e) && s0e > 0) {
          const bound = new Float64Array(nF);
          for (let f = 0; f < nF; f++) bound[f] = capF[f] / (s0e * 0.5);
          x = runFit(bound, x);
        }
      }
      // predicted quality (diagnostics)
      let inBand = 0, gapOK = 0, gapN = 0, paintN = 0;
      for (let k = 0; k < n; k++) {
        if (isPaint(k)) { paintN++; if (G[k] >= lo[k] && G[k] <= hi[k]) inBand++; }
        else if (isGap(k)) { gapN++; if (G[k] <= allow[k]) gapOK++; }
      }
      let farWorst = 0;
      for (const bl of blocks) { let s = 0; for (let t = 0; t < bl.length; t++) s += G[bl[t]]; farWorst = Math.max(farWorst, s / bl.length / (farLim || 1)); }

      // ---- absolute scale: push the exposure up until the biggest facet still fits its tile
      let s0 = Infinity, bindF = -1;
      for (let f = 0; f < nF; f++) if (x[f] > 1e-9) { const r = capF[f] / x[f]; if (r < s0) { s0 = r; bindF = f; } }
      if (!isFinite(s0)) s0 = 1;

      // ---- shields for the light that flies straight from the LED onto UNPAINTED target cells.
      //      In some scenes the target sits inside the LED's own emission, so a share of the power
      //      reaches it without touching any facet — it can neither be redirected nor counted, and
      //      it floods the gaps and the far blocks.  A shield only where no facet's tile covers the
      //      direction (those rays are already caught), and only for directions that land off the
      //      painting (rays landing on paint are free light and stay).  Absorbing parts are free
      //      — they do not count against the facet budget.
      const Rsh = Math.max(keep + 1.5, 6);
      const shields = [];
      if (settings.shields) {
        const step = 3 * Math.PI / 180, fr2 = RF.Source.frame(src);
        for (let ia = 1; ia < 30; ia++) {
          const phi = (ia + 0.5) * step;
          for (let ja = 0; ja < 120; ja++) {
            const th = (ja + 0.5) * step * (Math.PI / 180) * (180 / 3);   // 3° azimuth bins
            const sp = Math.sin(phi), cp = Math.cos(phi);
            const d = [fr2.a[0] * cp + (fr2.u[0] * Math.cos(th) + fr2.v[0] * Math.sin(th)) * sp,
                       fr2.a[1] * cp + (fr2.u[1] * Math.cos(th) + fr2.v[1] * Math.sin(th)) * sp,
                       fr2.a[2] * cp + (fr2.u[2] * Math.cos(th) + fr2.v[2] * Math.sin(th)) * sp];
            const den = d[0] * T.n[0] + d[1] * T.n[1] + d[2] * T.n[2];
            if (!(den < -1e-9)) continue;                    // must fly toward the lit side
            const num = (T.C[0] - led[0]) * T.n[0] + (T.C[1] - led[1]) * T.n[1] + (T.C[2] - led[2]) * T.n[2];
            const t = num / den;
            if (!(t > 0)) continue;
            const hx = led[0] + t * d[0], hy = led[1] + t * d[1], hz = led[2] + t * d[2];
            const dx = hx - T.C[0], dy = hy - T.C[1], dz = hz - T.C[2];
            const u = dx * T.tu[0] + dy * T.tu[1] + dz * T.tu[2];
            const v = dx * T.tv[0] + dy * T.tv[1] + dz * T.tv[2];
            const ci = Math.floor((u + T.half) / cell), cj = Math.floor((v + T.half) / cell);
            if (ci < 0 || cj < 0 || ci >= res || cj >= res) continue;   // misses the target: harmless
            if (pc[cj * res + ci] > 0) continue;                         // lands on paint: free light
            let hit = false;
            for (const pk of picks) {                                     // already caught by a facet?
              const q = cand[pk.cand].dir;
              const dot = d[0] * q[0] + d[1] * q[1] + d[2] * q[2];
              if (Math.acos(Math.max(-1, Math.min(1, dot))) <= 0.5 * pk.sep + 1.5 * step) { hit = true; break; }
            }
            if (hit) continue;
            const pd = Math.hypot(hx - led[0], hy - led[1], hz - led[2]);
            const Psh = [led[0] + d[0] * Math.min(Rsh, pd * 0.5), led[1] + d[1] * Math.min(Rsh, pd * 0.5), led[2] + d[2] * Math.min(Rsh, pd * 0.5)];
            if (!Geo.envInside(env, Psh, -1e-3)) continue;
            if (wallDist(env, Psh) < 1.2) continue;
            const b = V.basis(d), hw = Rsh * Math.tan(2.2 * step) * 1.15;
            const c1 = V.mul(b[0], hw), c2 = V.mul(b[1], hw);
            const pts3 = [V.add(V.add(Psh, c1), c2), V.add(V.sub(Psh, c1), c2),
                          V.sub(V.sub(Psh, c1), c2), V.sub(V.add(Psh, c1), c2)];
            shields.push({ type: 'plane', id: 'SH' + shields.length, group: 'A', P: Psh, n: V.neg(d),
              clip: { kind: 'poly', pts3 }, optics: { interaction: 'absorb' } });
          }
        }
      }
      if (shields.length) notes.push(shields.length + ' shields stop the light that would fly straight onto unpainted cells');

      // ---- emit
      const surfaces = [], intent = [];
      let dropped = 0;
      const placed = [];
      for (let f = 0; f < nF; f++) {
        const flux = s0 * x[f];                                  // lm this facet must deliver
        const m = picks[f].model;
        if (!(flux > 1e-9) || !(m.fluxPerArea > 0)) { dropped++; continue; }
        let A = flux / (m.fluxPerArea * Ptot);                   // mm²
        A = Math.min(A, capA[f]);
        if (A < 0.05) { dropped++; continue; }
        const half = Math.sqrt(A) / 2;
        const p = picks[f], P0 = cand[p.cand].P;
        const id = 'F' + placed.length;
        surfaces.push({
          type: 'facet', id, group: 'A',
          P: P0.slice(), S0: led.slice(), Z: p.aim.Z.slice(), di: V.dist(P0, p.aim.Z),
          clip: { kind: 'rect', hx: half, hy: half },
          optics: { interaction: 'reflect', reflectivity: refl },
        });
        intent.push({ facet: id, cells: p.aim.cells.map((k) => [k, pc[k]]) });
        placed.push({ f, id, A, half, p });
      }
      if (!placed.length) return { surfaces: [], intent: [], notes: ['nothing survived the fit'] };

      // ---- self-verification: envelope + LED clearance on the real outline, shrink if needed
      const shrink = (k, s) => { const q = surfaces[k]; q.clip.hx *= s; q.clip.hy *= s; };
      for (let round = 0; round < 4; round++) {
        let bad = false;
        let G2;
        try { G2 = Geo.compile(surfaces); } catch (e) { return { surfaces: [], intent: [], notes: ['compile failed: ' + e.message] }; }
        for (let k = 0; k < G2.n; k++) {
          const polys = Geo.outline(G2, k);
          for (const poly of polys) {
            for (const p of poly) {
              if (!Geo.envInside(env, p, 1e-6 * Math.max(...env.half))) bad = true;
              for (const s of sources) if (V.dist(p, s.pos) < keep * (1 - 1e-6) + 1e-9) bad = true;
            }
            const c = [0, 0, 0];
            for (const p of poly) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
            c[0] /= poly.length; c[1] /= poly.length; c[2] /= poly.length;
            for (const s of sources) if (V.dist(c, s.pos) < keep * (1 - 1e-6)) bad = true;
          }
        }
        if (!bad) break;
        for (let k = 0; k < surfaces.length; k++) shrink(k, 0.7);
        if (round === 3) notes.push('envelope/clearance check still failing after shrinking');
      }

      const onPaintLM = s0 * (function () { let s = 0; for (let k = 0; k < n; k++) if (isPaint(k)) s += G[k]; return s; })();
      notes.push(placed.length + ' facets · ' + aims.length + ' aims · cover radius ' + Rcover.toFixed(1) +
        ' mm · kernel ' + kerMM.toFixed(1) + ' mm (' + ker.cells.toFixed(1) + ' cells)');
      notes.push('fit: painted in band ' + (100 * inBand / paintN).toFixed(0) + '%, gaps under allowance ' +
        (gapN ? (100 * gapOK / gapN).toFixed(0) : '—') + '%, worst far block ' + farWorst.toFixed(2) + '× limit');
      notes.push('on paint ' + onPaintLM.toFixed(0) + ' lm (' + (100 * onPaintLM / Ptot).toFixed(1) + '% of ' +
        Ptot.toFixed(0) + ' lm) · s0 ' + s0.toFixed(2) + ' lm/unit, binding cap ' +
        (bindF >= 0 ? capF[bindF].toFixed(2) + ' vs demand ' + x[bindF].toFixed(1) : '—') +
        ' · blob median ' + medianExt(picks).toFixed(0) + ' mm · dropped ' + dropped);
      // diagnostics (the runner prints the first three notes; --json shows all)
      { const uu = picks.map((q0) => q0.model.uExt).sort((a, b) => a - b),
        vv = picks.map((q0) => q0.model.vExt).sort((a, b) => a - b),
        cc = picks.map((q0) => q0.cost).sort((a, b) => a - b);
        const q = (arr, t) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(t * arr.length))] : 0).toFixed(0);
        notes.push('DBG image u p50 ' + q(uu, 0.5) + ' p90 ' + q(uu, 0.9) + ' v p50 ' + q(vv, 0.5) + ' p90 ' + q(vv, 0.9) +
          ' | cost p50 ' + q(cc, 0.5) + ' p90 ' + q(cc, 0.9) + ' | fit loss ' + loss0.toFixed(1) + '->' + loss1.toFixed(1) +
          ' [' + lossParts(Phi) + ']->[' + lossParts(x) + '] ' + splitOf()); }
      { const hm = picks.map((q0) => 0.5 * Math.min(q0.model.uExt, q0.model.vExt) * bs).sort((a, b) => a - b);
        const q3 = (arr, t) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(t * arr.length))] : 0).toFixed(1);
        notes.push('DBG wTyp ' + wTyp.toFixed(1) + ' Rcover ' + Rcover.toFixed(1) + ' half-min p10 ' + q3(hm, 0.1) +
          ' p50 ' + q3(hm, 0.5) + ' | aims ' + aims.length + ' du p50 ' +
          aims.map((a) => a.du).sort((a, b) => a - b)[Math.floor(aims.length * 0.5)].toFixed(0) + ' dv p50 ' +
          aims.map((a) => a.dv).sort((a, b) => a - b)[Math.floor(aims.length * 0.5)].toFixed(0)); }
      for (const sh of shields) surfaces.push(sh);
      return { surfaces, intent, notes, needs: { bounces: 1 } };
  }

  RF.Solvers.register({
    id: 'bench-mimo26flash--plate',
    name: 'Plate (static image solver)',
    version: '1.0',
    modes: ['paint'],
    settings: [MIN_DISTANCE].concat(KNOBS),
    solve: solveStatic,
  });

  // ---------------------------------------------------------------- tuner (task step 3)
  // plate-auto picks the static solver's settings for a goal by running it a few times and tracing every
  // candidate with the SAME seed, so what differs between candidates is geometry, not noise.  It is a
  // greedy coordinate search: start from the defaults, try one knob at a time (high-impact knobs first),
  // keep a change only if it improves the goal's own measure by more than half a fidelity point.
  //
  //   faithful   best fidelity (the score's dominant term, × the light gate the score uses)
  //   throw      most light thrown onto the painting (on-paint share, preferring designs that also look
  //              like the painting)
  //   efficient  the fewest facets that keep the fidelity (5% of the best found)
  //
  // Everything it may touch is a setting of the static solver plus `goal`; the algorithm itself is the
  // same code, so a failed search still returns a good design.  Cost is bounded: candidates are limited
  // by the harness's ray budget (not by the clock, which would make the result non-deterministic), and a
  // trace that throws leaves the baseline in place.
  const SEED = 91731;                       // fixed: every candidate of every run sees the same rays
  const TRIALS = [                          // [knob, values to try] in order of measured impact
    ['gapWeight', [0.15, 0.6]],
    ['aimCover', [0.22, 0.42]],
    ['fitBlob', [1.0, 1.4]],
    ['blobScale', [1.0, 1.45]],
    ['bandAim', [0.4, 0.7]],
    ['epsCap', [0, 0.012]],
    ['shields', [false]],
  ];
  const FRACTIONS = [1, 0.7, 0.5, 0.35];    // the 'efficient' goal: facet budgets to try
  const ACCEPT = 0.005;                     // a change must beat the current best by this much

  function solveAuto(input, settings, tools) {
    const goal = settings.goal === 'throw' || settings.goal === 'efficient' ? settings.goal : 'faithful';
    const maxF = Math.max(1, input.limits.maxFacets | 0);
    const B = tools.budget || {};
    const rayB = typeof B.rays === 'number' && isFinite(B.rays) && B.rays > 0 ? B.rays : 2e7;
    const nTry = goal === 'efficient' ? FRACTIONS.length : TRIALS.length + 1;
    // rays per candidate: enough to rank designs that differ by ~1%, with headroom left for the harness's
    // own final trace of whatever we return
    const rays = Math.max(120000, Math.min(450000, Math.floor(rayB / (nTry + 3))));
    let traced = 0;

    // one candidate: solve with the overrides, then trace it at the fixed seed
    const evalCand = (over) => {
      const frac = over.__budget, srest = Object.assign({}, over);
      delete srest.__budget;
      const inp = frac === undefined || frac >= 1 ? input
        : Object.assign({}, input, { limits: Object.assign({}, input.limits, { maxFacets: Math.max(1, Math.round(maxF * frac)) }) });
      let out = null;
      try { out = solveStatic(inp, Object.assign({}, settings, srest), tools); } catch (e) { return null; }
      if (!out || !Array.isArray(out.surfaces) || !out.surfaces.length) return null;
      let n = 0; for (const s of out.surfaces) if (s.kind === 'facet') n++;
      if (n > maxF) return null;
      if (traced + rays > rayB) return null;              // deterministic: a function of the budget only
      let res = null;
      try { res = tools.trace(out.surfaces, { rays: rays, seed: SEED }); } catch (e) { res = null; }
      traced += rays;
      const f = res && res.fidelity;
      if (!f) return null;
      return { out: out, f: f, over: over, n: n };
    };

    // the goal's own measure, on one traced candidate
    const lightOf = (f) => Math.min(1, (f.onPaint || 0) / 0.02);     // the score's gate: 2% on paint = full light
    const fidOf = (c) => (c.f.fidelity || 0) * lightOf(c.f);
    const scoreOf = (c) => {
      if (goal === 'throw') return (c.f.onPaint || 0) * (0.7 + 0.3 * (c.f.fidelity || 0));
      if (goal === 'efficient') return fidOf(c);
      return fidOf(c) + lightOf(c.f) * 0.02 * (1 - c.n / maxF);      // + the score's small efficiency bonus
    };
    // how much a change must gain: 'throw' scores in on-paint fractions (a few hundredths), so its margin
    // is scaled down to match — otherwise every real gain on that goal reads as noise and is rejected
    const accept = goal === 'throw' ? 0.0004 : ACCEPT;
    const finish = (c) => {
      const parts = Object.keys(c.over).map((k) => k === '__budget' ? 'facet budget ×' + c.over[k] : k + '=' + c.over[k]);
      const changed = parts.length ? parts.join(' ') : 'the defaults';
      const note = 'auto[' + goal + ']: ' + (traced / 1000000).toFixed(1) + 'M rays traced at seed ' + SEED +
        ' · chose ' + changed + ' · fidelity ' + (100 * (c.f.fidelity || 0)).toFixed(1) + '%, on paint ' +
        (100 * (c.f.onPaint || 0)).toFixed(1) + '%';
      c.out.notes = [note].concat(c.out.notes || []);
      return c.out;
    };
    const staticOnly = () => { try { return solveStatic(input, settings, tools); } catch (e) { return { surfaces: [], intent: [], notes: ['tuner: ' + (e && e.message)] }; } };

    if (goal === 'efficient') {
      // smallest design that keeps the fidelity within 5% of the best budget tried
      let best = null; const list = [];
      for (const fr of FRACTIONS) { const c = evalCand({ __budget: fr }); if (c) { list.push(c); if (!best || fidOf(c) > fidOf(best)) best = c; } }
      if (!best) return staticOnly();
      const floor = 0.95 * fidOf(best);
      let pick = best;
      for (const c of list) if (c.n <= pick.n && fidOf(c) >= floor) pick = c;
      return finish(pick);
    }

    let best = evalCand({});                                  // the baseline first: always something to return
    if (!best) return staticOnly();
    const base0 = best;
    for (const t of TRIALS) {
      for (const v of t[1]) {
        const over = Object.assign({}, best.over);
        over[t[0]] = v;
        const c = evalCand(over);
        if (c && scoreOf(c) > scoreOf(best) + accept) best = c;   // greedy: the next trial builds on it
      }
    }
    // Confirm the winner against the baseline at double the rays (same seed): a win that does not survive
    // a cleaner look was noise, and the baseline is never a bad answer.  Measured: without this the test
    // scene traded 1.0 fidelity point away on a 1-point "gain" seen only at 450k rays.
    if (goal !== 'efficient' && Object.keys(best.over).length) {
      const conf = Math.max(rays, Math.min(900000, Math.floor((rayB - traced) / 2)));
      const b2 = evalCand({}, conf), w2 = evalCand(best.over, conf);
      if (b2 && w2 && scoreOf(w2) <= scoreOf(b2) + accept) best = base0;
    }
    return finish(best);
  }

  RF.Solvers.register({
    id: 'bench-mimo26flash--plate-auto',
    name: 'Plate (auto-tuned)',
    version: '1.0',
    modes: ['paint'],
    settings: [MIN_DISTANCE,
      { key: 'goal', label: 'Goal', type: 'select', default: 'faithful',
        options: [{ value: 'faithful', label: 'Faithful — best fidelity' },
          { value: 'throw', label: 'Throw — most light on the paint' },
          { value: 'efficient', label: 'Efficient — fewest facets' }],
        help: 'plate-auto traces a few setting combinations with one fixed seed and returns the best for this goal.' }
    ].concat(KNOBS),
    solve: solveAuto,
  });

  function medianExt(picks) {
    const a = picks.map((p) => Math.max(p.model.uExt, p.model.vExt)).sort((x, y) => x - y);
    return a.length ? a[a.length >> 1] : 0;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
