/* solver.js — "flux": a faceted reflector that images the small LED onto the painting.
 *
 * Static design, no ray tracing in solve():
 *   • For up to maxFacets facets, spread facet directions over a spherical cap straddling the
 *     LED's output cone tilted toward the target, so every facet's shell ray is emitted by the
 *     LED and re-emitted toward the target.
 *   • Size each footprint so the shell ray it lights is ~one aim blob wide (the étendue floor
 *     size = led*cos/r), with overlap so the painting fills in smoothly and no boundary gaps open.
 *   • Aim each facet at the centre of a coarse painted macro-cell (paint res / blur), distributed
 *     over the painting by flux, so the delivered illuminance follows the paint.
 *   • Pair dome azimuth with target azimuth (fewer crossings); build one exact-quadric facet per
 *     (source S0=LED, image point = aim) — imaging the LED onto that aim with di = |P-aim|.
 *   • Clip to the real outline (envelope + keepOut/minDistance + sag) and drop what cannot fit.
 *
 * Uses only geometry (facetQuadric/compileSurface/localSag/envInterval/envInside), the LED model,
 * and RF.Photometry.achievableKernel — computeAnalytic never touches the tracer.
 */
(function (root) {
  'use strict';
  const RF = root.RF;
  const V = RF.V, U = RF.U;
  const Geo = RF.Geo, Source = RF.Source, Engine = RF.Engine;
  const STRIDE = Geo.STRIDE;
  const clamp = U.clamp;
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 1]; };
  const TAU = Math.PI * 2, GOLD = Math.PI * (3 - Math.sqrt(5));

  RF.Solvers.register({
    id: 'bench-step5preview--flux',
    name: 'Flux imaging reflector',
    version: '1.0',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'clearance (mm)', type: 'range', min: 0, max: 40, step: 0.5, default: 0 },
      { key: 'push', label: 'reach toward the wall', type: 'range', min: 0.2, max: 1, step: 0.05, default: 0.92 },
      { key: 'tilt', label: 'dome lean to target', type: 'range', min: 0, max: 2, step: 0.1, default: 0 },
      { key: 'cap', label: 'dome half-angle (deg)', type: 'range', min: 30, max: 95, step: 5, default: 88 },
      { key: 'overlap', label: 'aim pitch vs image size', type: 'range', min: 0.6, max: 2.4, step: 0.1, default: 1.1 },
      { key: 'catch', label: 'facet size (x reach)', type: 'range', min: 0.05, max: 0.4, step: 0.01, default: 0.1 },
      { key: 'blobs', label: 'images overlapping per cell', type: 'range', min: 1, max: 6, step: 0.1, default: 3 },
      { key: 'jitter', label: 'aim spread', type: 'range', min: 0, max: 1, step: 0.05, default: 0.8 },
      { key: 'defocus', label: 'extra image defocus (%)', type: 'range', min: -0.3, max: 1.5, step: 0.05, default: 0 },
      { key: 'inset', label: 'edge pull-in (cells, blurry scenes)', type: 'range', min: -2, max: 6, step: 0.25, default: 1.5 },
    ],

    solve: function (input, settings, tools) {
      const prog = (tools && tools.progress) ? tools.progress : function () {};
      const src = input.source, S0 = src.pos.slice();
      const fr = Source.frame(src);
      const env = input.envelope;
      const N = (input.limits && input.limits.maxFacets) | 0;
      const Rflc = (input.limits && input.limits.reflectivity) || 0.9;
      const tgt = input.target;
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0) || 0;
      const notes = [];

      const T = Engine.targetFrame(tgt);
      const dFrame = Engine.designFrame(tgt);
      const cellFine = 2 * T.half / tgt.res;
      const distLT = V.dist(S0, dFrame.C);
      const dirLT = nrm(V.sub(dFrame.C, S0));
      const scale = Math.cbrt(Geo.envVolume(env) || 1);
      const halfMax = Math.max(env.half[0], env.half[1], env.half[2]);

      // painting present?
      const paint = input.paint && input.paint.cells ? input.paint.cells : null;
      const Rpaint = input.paint ? input.paint.res : tgt.res;
      let empty = { surfaces: [], intent: [], notes: ['no painting: nothing to aim at'] };
      if (!paint || !paint.length) return empty;

      // minimum image size (étendue floor) -> pitch of the aim blobs + edge inset
      let ker = RF.Photometry.achievableKernel({ source: src, envelope: env, target: tgt });
      if (!ker.cells) ker = { cells: 5, mm: 5 * cellFine, r: distLT };
      const blobCells = clamp(ker.cells, 0.5, 60);
      const pitchCells = clamp(blobCells / (settings.overlap || 1), 0.4, 80);
      // painted area (mm^2), and the image diameter each facet should put on the plane so that
      // `blobs` images overlap per painted cell (étendue caps how small, geometry caps how big).
      let nPaint = 0, sumPaint = 0;
      for (let k = 0; k < paint.length; k++) if (paint[k] > 0) { nPaint++; sumPaint += paint[k]; }
      const paintAreaMm = Math.max(1, nPaint) * cellFine * cellFine;
      const nEff = Math.max(1, N - 15);                       // ~facets that survive grazing drops
      const wantDiaMm = 2 * Math.sqrt((settings.blobs || 2.4) * paintAreaMm / (Math.PI * nEff));
      const sharpDiaMm = Math.max(1e-3, ker.mm || 1);
      // focus short of the target by this fraction -> the conic spreads to `wantDiaMm` at the plane
      let defocusAuto = clamp(1 - sharpDiaMm / (sharpDiaMm + wantDiaMm), 0, 0.97);
      const hash = (i) => { let h = (Math.imul(i + 1, 374761393) + 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177) | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
      // the edge pull-in only matters when the image is wider than a cell (blurry): scales with the kernel size
      const insetEff = (settings.inset || 0) * clamp((blobCells - 1.2) / 2.5, 0, 1.2);

      // ---- resolve the painting to a coarse grid of macro-cells and flux-weight them ----
      const Rc = clamp(Math.round(tgt.res / pitchCells), 2, tgt.res);
      const bw = tgt.res / Rc;                                  // fine cells per macro cell
      const cw = new Float64Array(Rc * Rc);                    // mean paint per macro cell
      for (let I = 0; I < Rc; I++) for (let J = 0; J < Rc; J++) {
        let s = 0, n = 0;
        for (let i = Math.floor(I * bw); i < Math.min(Math.ceil((I + 1) * bw), tgt.res); i++)
          for (let j = Math.floor(J * bw); j < Math.min(Math.ceil((J + 1) * bw), tgt.res); j++) {
            const w = paint[j * tgt.res + i]; if (w > 0) { s += w; n++; }
          }
        cw[J * Rc + I] = n ? s / (tgt.res * tgt.res) : 0;       // weight scales with area too
      }
      // flux centroid (for the edge pull-in)
      let cs = 0, cu = 0, cv = 0;
      for (let I = 0; I < Rc; I++) for (let J = 0; J < Rc; J++) {
        const w = cw[J * Rc + I]; if (w <= 0) continue;
        const u = -T.half + (I + 0.5) / Rc * 2 * T.half, v = -T.half + (J + 0.5) / Rc * 2 * T.half;
        cs += w; cu += w * u; cv += w * v;
      }
      const cenUV = cs > 0 ? [cu / cs, cv / cs] : [0, 0];

      // ---- distribute N aim points over the painting by flux (serpentine error diffusion) ----
      let tot = 0; for (let k = 0; k < cw.length; k++) tot += cw[k];
      const aims = [];                                            // {u,v,w}
      let carry = 0;
      for (let J = 0; J < Rc; J++) {
        for (let Ii = 0; Ii < Rc; Ii++) {
          const I = (J % 2 === 0) ? Ii : (Rc - 1 - Ii);           // boustrophedon spread
          const w = cw[J * Rc + I];
          if (w <= 0) { carry *= 0.9; continue; }
          carry += N * w / tot;
          while (carry >= 1) {
            carry -= 1;
            let u = -T.half + (I + 0.5) / Rc * 2 * T.half, v = -T.half + (J + 0.5) / Rc * 2 * T.half;
            if (settings.jitter) {                              // de-clump: spread within the macro cell
              const halfStep = T.half / Rc;
              u += (hash(aims.length) - 0.5) * settings.jitter * 2 * halfStep;
              v += (hash(0x9e37 + aims.length) - 0.5) * settings.jitter * 2 * halfStep;
            }
            if (insetEff) {                                      // pull aim toward the centroid
              const du = cenUV[0] - u, dv = cenUV[1] - v, dl = Math.hypot(du, dv) || 1;
              const sh = insetEff * cellFine;
              u += du / dl * sh; v += dv / dl * sh;
            }
            aims.push({ u, v, w });
          }
        }
      }
      if (!aims.length) return empty;

      // ---- facet directions: a Fibonacci cap around the (tilted) dome axis ----
      const perp = V.sub(dirLT, V.mul(fr.a, V.dot(dirLT, fr.a)));
      const g = nrm(V.add(V.mul(fr.a, 1), V.mul(nrm(perp), settings.tilt || 0)));
      const [bx, by] = V.basis(g);
      const cosCap = Math.cos((settings.cap || 78) * Math.PI / 180), capGap = 1 - cosCap;
      const dirs = [];
      for (let k = 0; k < N; k++) {
        const az = k * GOLD;
        const ucp = 1 - ((k + 0.5) / N) * capGap;                 // cos(theta) uniform in [cosCap,1]
        const th = Math.acos(clamp(ucp, -1, 1)), st = Math.sin(th), ct = Math.cos(th);
        const d = nrm(V.add(V.madd(V.mul(bx, Math.cos(az)), V.mul(by, Math.sin(az)), st), V.mul(g, ct)));
        dirs.push(d);
      }

      // ---- placement + footprint, pairing dome azimuth with aim azimuth ----
      const [exT, eyT] = (() => { const ex = V.inPlane(dirLT, [1, 0, 0]); return [ex, V.cross(dirLT, ex)]; })();
      const azOf = (p) => { const d = V.sub(p, S0); return Math.atan2(V.dot(d, eyT), V.dot(d, exT)); };
      const aimWorld = aims.map((a) => Engine.targetUVtoWorld(T, a.u, a.v));
      const aimIdx = aims.map((a, k) => k).sort((i, j) => azOf(aimWorld[i]) - azOf(aimWorld[j]));
      const dirIdx = dirs.map((d, k) => k).sort((i, j) => azOf(dirs[i]) - azOf(dirs[j]));

      const D = new Float64Array(STRIDE);
      const polyOut = [];
      const o = 0;
      const surfaces = [], intent = [];
      let placed = 0, droppedEnv = 0, droppedKeep = 0;

      for (let m = 0; m < Math.min(aimIdx.length, dirIdx.length); m++) {
        prog(m / Math.max(1, Math.min(aimIdx.length, dirIdx.length)));
        const ai = aimIdx[m], dk = dirIdx[m];
        const aim = aims[ai], u = dirs[dk];
        const C = Engine.targetUVtoWorld(T, aim.u, aim.v);

        // LED intensity toward this dome direction (relative)
        const theta = Math.acos(clamp(V.dot(u, fr.a), -1, 1));
        const Iu = Math.max(1e-3, Source.intensity(src, theta));
        if (Iu < 0.02) { droppedKeep++; continue; }               // grazing: catches almost nothing

        // how far we can push the centre toward the wall along u
        const iv = Geo.envInterval(env, S0, u);
        const tout = iv[1];
        if (!isFinite(tout) || tout <= keep + 1) { droppedEnv++; continue; }
        const r0 = clamp(settings.push * tout, keep + 4, tout);
        const P = V.madd(S0, u, r0);

        // bisector normal (matches facetQuadric's n for S0=LED, Z=C)
        const n = nrm(V.add(nrm(V.sub(S0, P)), nrm(V.sub(C, P))));
        const ex = V.inPlane(n), ey = V.cross(n, ex);
        // tilt cosine of the facet vs both rays — resize for grazing to keep a decent catch
        const costilt = clamp(Math.abs(V.dot(n, V.sub(S0, P))), 0.15, 1);
        // footprint half-side: proportional to reach (so on-target brightness ~ r-independent, and
        // adjacent facets tile the dome); tilted toward the LED, so ÷ √costilt keeps their catch in step.
        let a = (settings.catch || 0.14) * r0 / Math.sqrt(costilt);
        a = clamp(a, 0.5, 0.4 * r0);

        const diNat = V.dist(P, C);
        const di = Math.max(1, diNat * (1 - clamp(defocusAuto + (settings.defocus || 0), 0, 1.4)));
        let keepShape = true;

        // shrink the footprint until the whole curved outline fits (envelope + clearance)
        for (let it = 0; it < 12; it++) {
          a *= (it === 0 ? 1 : 0.86);
          const pts3 = [V.madd(V.madd(P, ex, a), ey, a), V.madd(V.madd(P, ex, -a), ey, a),
                        V.madd(V.madd(P, ex, -a), ey, -a), V.madd(V.madd(P, ex, a), ey, -a)];
          const surf = { type: 'facet', id: 'W' + m, group: 'A', P, S0, Z: C, di, flat: false,
                         clip: { kind: 'poly', pts3 }, optics: { interaction: 'reflect', reflectivity: Rflc, twoSided: false } };
          polyOut.length = 0;
          Geo.compileSurface(surf, D, o, polyOut);
          // sample the real quadric over the square footprint (perimeter + corners + interior) and test envelope / clearance
          const margin = keep * (1 + 1e-6) + Math.max(0.05, 0.01 * r0);
          let okE = true, okK = true;
          const test = (x, y) => {
            const zz = Geo.localSag(D, o, x, y);
            if (!isFinite(zz)) { okE = false; okK = false; return; }
            const sp = V.madd(V.madd(V.madd(P, ex, x), ey, y), n, zz);
            if (!Geo.envInside(env, sp, -1e-3)) okE = false;
            if (V.dist(sp, S0) < margin) okK = false;
          };
          const per = [[-a, -a], [a, -a], [a, a], [-a, a]];
          for (let e = 0; e < 4 && (okE || okK); e++) for (let i = 0; i <= 6; i++) {   // square perimeter, 7 pts/edge (corners included)
            const p = per[e], q = per[(e + 1) % 4], t = i / 6;
            test(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
          }
          for (let i = 0; i < 8 && (okE || okK); i++) { const t = i / 8 * TAU; test(0.3 * a * Math.cos(t), 0.3 * a * Math.sin(t)); }   // interior disc (concave clearance)
          test(0, 0);
          if (okE && okK) {
            // also make sure the two sheets don't get huge (di finite) and area non-trivial
            if (a * a < 0.01) { keepShape = false; }
            surfaces.push(surf); placed++;
            intent.push({ facet: surf.id, cells: [[flatOf(C, T, tgt.res), 1]] });
            break;
          }
          if (a < 0.45) { keepShape = false; break; }
          if (!okE && !okK) droppedEnv++;
          else if (!okK) droppedKeep++;
        }
        if (!keepShape) { droppedEnv++; }
      }

      notes.push('facet cap: ' + surfaces.length + ' placed / ' + N + ' (env-fail ' + droppedEnv + ', keep-fail ' + droppedKeep + ')');
      notes.push('kernel ' + ker.cells.toFixed(1) + ' cells; aim pitch ' + pitchCells.toFixed(2) + ' cells over ' + Rc + ' macro grid');
      return { surfaces, intent, notes };

      function flatOf(Cw, Tf, res) {
        const uv = Engine.worldToTargetUV(Tf, Cw);
        const s = 2 * Tf.half / res;
        const i = clamp(Math.floor((uv[0] + Tf.half) / s), 0, res - 1);
        const j = clamp(Math.floor((uv[1] + Tf.half) / s), 0, res - 1);
        return j * res + i;
      }
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);