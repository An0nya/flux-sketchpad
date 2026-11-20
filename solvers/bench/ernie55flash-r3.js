/* flux-mosaic — a static faceted-reflector solver for painted targets (Mode A).
 *
 * Physics used (all static; solve() never traces)
 *   Φ_i  = L·A_LED·ΔΩ_i·cosθ_i·cosγ_i      flux a facet catches (ΔΩ = its direction cell, θ = LED polar
 *                                          angle from its axis, γ = incidence at the facet)
 *   P_i  = w·D/r_i + t_i                   LED image size at the target (étendue): a facet r from the LED
 *                                          images the LED w·D/r wide; a defocus t adds a blur t
 *   E_i  = L·A_f·cosγ·cosθ/D²              peak illuminance (brightness ceiling), reached when t ≤ image
 *
 *   So DISTANCE sets the patch size, AREA sets the brightness, DIRECTION sets the flux.
 *
 * Algorithm
 *   1. decompose the painting into ~N elliptical "beamlets" (greedy matching pursuit over a 2-D size
 *      ladder; each beamlet is a flat-topped profile with independent u/v edge widths),
 *   2. give each beamlet a facet: distance from its patch size, aim at its centre, a rectangular
 *      facet whose area gives the required illuminance, and two-curvature vergences (vg) that produce
 *      the beamlet's independent u/v blur,
 *   3. spread the facet directions over the LED's hemisphere subject to the envelope, the LED
 *      clearance and a packing constraint (direction cells must not overlap, or facets shadow).
 */
(function () {
  'use strict';
  const RF = globalThis.RF;
  if (!RF || !RF.Solvers || !RF.V) return;
  const V = RF.V;
  const clamp = (x, a, b) => (x < a ? a : (x > b ? b : x));

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const l = vlen(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };

  // ------------------------------------------------------------------ envelope helpers
  function envRayMax(env, L, d) {
    const iv = RF.Geo.envInterval(env, L, d);
    return iv && iv[1] > 0 ? iv[1] : 0;
  }

  // ------------------------------------------------------------------ paint helpers
  function downsample(paint, res, W) {
    if (W >= res) return { g: Float64Array.from(paint), W: res };
    const g = new Float64Array(W * W), f = res / W;
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const j0 = Math.floor(j * f), j1 = Math.max(j0 + 1, Math.floor((j + 1) * f));
      const i0 = Math.floor(i * f), i1 = Math.max(i0 + 1, Math.floor((i + 1) * f));
      let s = 0, c = 0;
      for (let jj = j0; jj < j1 && jj < res; jj++) for (let ii = i0; ii < i1 && ii < res; ii++) { s += paint[jj * res + ii]; c++; }
      g[j * W + i] = c ? s / c : 0;
    }
    return { g, W };
  }
  // 1-D trapezoid of full width S, edge t (t ≤ S/2 → flat top), sampled at cell c
  function kernel1d(S, t, c) {
    const n = Math.max(1, Math.ceil(S / (2 * c)));
    const k = new Float64Array(2 * n + 1);
    const tt = Math.min(Math.max(t, 0), S * 0.5);
    for (let m = -n; m <= n; m++) {
      const x = m * c;
      k[m + n] = tt > 1e-9 ? clamp((S / 2 - Math.abs(x)) / tt, 0, 1) : (Math.abs(x) <= S / 2 ? 1 : 0);
    }
    let q = 0; for (const v of k) q += v * v;
    return { k, n, norm2: q };
  }
  function correlate(g, W, kx, ky) {
    const nx = kx.n, ny = ky.n, tmp = new Float64Array(W * W), out = new Float64Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      let s = 0;
      for (let m = -nx; m <= nx; m++) { const ii = i + m; if (ii < 0 || ii >= W) continue; s += kx.k[m + nx] * g[j * W + ii]; }
      tmp[j * W + i] = s;
    }
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      let s = 0;
      for (let m = -ny; m <= ny; m++) { const jj = j + m; if (jj < 0 || jj >= W) continue; s += ky.k[m + ny] * tmp[jj * W + i]; }
      out[j * W + i] = s;
    }
    return out;
  }

  // Greedy matching pursuit over a 2-D size ladder.  Each beamlet: flat top a×a (the LED image) with
  // independent edge widths tu/tv, so its footprint is (a+tu)×(a+tv) and its integral is Eth·a².
  function decompose(g, W, cellW, sizes, nMax, softFrac) {
    const res = Float64Array.from(g);
    const kernels = [];
    for (const sx of sizes) for (const sy of sizes) {
      if (sx < cellW * 1.2 || sy < cellW * 1.2) continue;
      if (Math.max(sx, sy) > 1.9 * Math.min(sx, sy)) continue;
      const aimg = (1 - softFrac) * Math.min(sx, sy);
      const tu = Math.max(1e-6, sx - aimg), tv = Math.max(1e-6, sy - aimg);
      const kx = kernel1d(sx, tu, cellW), ky = kernel1d(sy, tv, cellW);
      const norm2 = kx.norm2 * ky.norm2;
      if (!(norm2 > 0)) continue;
      kernels.push({ sx, sy, tu, tv, kx, ky, norm2 });
    }
    const out = [];
    if (!kernels.length) return out;
    for (let it = 0; it < nMax; it++) {
      let best = null;
      for (const kd of kernels) {
        const C = correlate(res, W, kd.kx, kd.ky);
        for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
          const c = C[j * W + i];
          if (!(c > 0)) continue;
          const red = c * c / kd.norm2;
          if (!best || red > best.red) best = { red, i, j, kd, c };
        }
      }
      if (!best) break;
      const amp = best.c / best.kd.norm2;
      if (!(amp > 1e-3)) break;
      const { kx, ky } = best.kd;
      for (let dj = -ky.n; dj <= ky.n; dj++) for (let di = -kx.n; di <= kx.n; di++) {
        const ii = best.i + di, jj = best.j + dj;
        if (ii < 0 || ii >= W || jj < 0 || jj >= W) continue;
        res[jj * W + ii] -= amp * kx.k[di + kx.n] * ky.k[dj + ky.n];
      }
      out.push({ i: best.i, j: best.j, sx: best.kd.sx, sy: best.kd.sy, tu: best.kd.tu, tv: best.kd.tv, a: amp });
    }
    return out;
  }


  // Refine beamlet amplitudes by coordinate descent on the model (all cells, paint and gaps).
  function refine(beamlets, W, cellW, PAINT, nIter) {
    const n = W * W;
    const model = new Float64Array(n);
    for (const b of beamlets) {
      b.kx = kernel1d(b.sx, b.tu, cellW);
      b.ky = kernel1d(b.sy, b.tv, cellW);
      b.norm2 = b.kx.norm2 * b.ky.norm2;
      let gp = 0;
      for (let dj = -b.ky.n; dj <= b.ky.n; dj++) for (let di = -b.kx.n; di <= b.kx.n; di++) {
        const ii = b.i + di, jj = b.j + dj;
        if (ii < 0 || ii >= W || jj < 0 || jj >= W) continue;
        gp += b.kx.k[di + b.kx.n] * b.ky.k[dj + b.ky.n] * PAINT[jj * W + ii];
      }
      b.gp = gp;
    }
    // accumulate model
    const rebuild = () => {
      model.fill(0);
      for (const b of beamlets) {
        if (!(b.a > 0)) continue;
        const { kx, ky } = b;
        for (let dj = -ky.n; dj <= ky.n; dj++) for (let di = -kx.n; di <= kx.n; di++) {
          const ii = b.i + di, jj = b.j + dj;
          if (ii < 0 || ii >= W || jj < 0 || jj >= W) continue;
          model[jj * W + ii] += b.a * kx.k[di + kx.n] * ky.k[dj + ky.n];
        }
      }
    };
    rebuild();
    for (let it = 0; it < nIter; it++) {
      for (const b of beamlets) {
        if (!(b.a > 0)) continue;
        const { kx, ky } = b;
        let g = 0;
        for (let dj = -ky.n; dj <= ky.n; dj++) for (let di = -kx.n; di <= kx.n; di++) {
          const ii = b.i + di, jj = b.j + dj;
          if (ii < 0 || ii >= W || jj < 0 || jj >= W) continue;
          g += kx.k[di + kx.n] * ky.k[dj + ky.n] * model[jj * W + ii];
        }
        const step = (g - b.gp) / b.norm2;
        const na = Math.max(0, b.a - step);
        const d = na - b.a;
        if (d === 0) continue;
        b.a = na;
        for (let dj = -ky.n; dj <= ky.n; dj++) for (let di = -kx.n; di <= kx.n; di++) {
          const ii = b.i + di, jj = b.j + dj;
          if (ii < 0 || ii >= W || jj < 0 || jj >= W) continue;
          model[jj * W + ii] += d * kx.k[di + kx.n] * ky.k[dj + ky.n];
        }
      }
    }
    return beamlets;
  }

  // ------------------------------------------------------------------ main
  RF.Solvers.register({
    id: 'bench-ernie55flash-r3--flux-mosaic',
    name: 'Flux mosaic',
    version: '1.0',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'soft', label: 'LED image ÷ patch (edge flatness)', type: 'range', min: 0.5, max: 1, step: 0.05, default: 0.7 },
      { key: 'fill', label: 'Flux fill (max light)', type: 'range', min: 0.1, max: 1, step: 0.05, default: 0.85 },
      { key: 'rUse', label: 'Envelope use', type: 'range', min: 0.3, max: 0.98, step: 0.03, default: 0.94 },
      { key: 'scales', label: 'Size ladder', type: 'range', min: 2, max: 6, step: 1, default: 4 },
      { key: 'maxSize', label: 'Max beamlet (× smallest)', type: 'range', min: 1.5, max: 8, step: 0.5, default: 3.5 },
    ],

    solve(input, settings) {
      return solveStatic(input, settings);
    },
  });

  // ---------------------------------------------------------------- the static core (no tracing; shared by both solvers)
  function solveStatic(input, settings) {
      const notes = [];
      const env = input.envelope, src = input.source;
      const L = src.pos.slice();
      const aLed = unit(src.axis);
      const maxFacets = Math.max(1, input.limits.maxFacets | 0);
      const refl = input.limits.reflectivity;
      const keep = Math.max(env.keepOut || 0, settings.minDistance || 0);
      const softFrac = clamp(settings.soft, 0.05, 0.95);
      const fillFrac = clamp(settings.fill, 0.05, 1);
      const rUse = clamp(settings.rUse, 0.1, 1);
      const nSizes = Math.round(clamp(settings.scales, 2, 6));

      const Tf = RF.Engine.targetFrame(input.target);
      const tu = Tf.tu, tv = Tf.tv, TC = Tf.C;
      const pres = input.paint.res | 0, half = Tf.half, cell = 2 * half / pres;
      const paint = input.paint.cells;
      let mass = 0; for (let k = 0; k < paint.length; k++) mass += paint[k];
      if (!(mass > 0)) return { surfaces: [], intent: [], notes: ['paint is empty: nothing to solve'] };

      const D = Math.max(1, dot(sub(TC, L), scl(Tf.n, -1)));        // LED→target distance
      const ledW = src.kind === 'volume' ? 2 * (src.radius || 1) : (src.shape === 'disc' ? 2 * src.radius : (src.w || 1));
      const ledH = src.kind === 'volume' ? 2 * (src.radius || 1) : (src.shape === 'disc' ? 2 * src.radius : (src.h || 1));
      const ledMin = Math.sqrt(ledW * ledH);

      // farthest envelope point → smallest possible LED image
      let rEnvMax = 0;
      {
        const c = env.center, h = env.half;
        if (env.shape === 'box') {
          for (let i = 0; i < 8; i++) {
            const p = [c[0] + (i & 1 ? h[0] : -h[0]), c[1] + (i & 2 ? h[1] : -h[1]), c[2] + (i & 4 ? h[2] : -h[2])];
            rEnvMax = Math.max(rEnvMax, vlen(sub(p, L)));
          }
        } else {
          for (let k = 0; k < 400; k++) {
            const u = (k + 0.5) / 400, z = 1 - 2 * u, rr = Math.sqrt(Math.max(0, 1 - z * z)), ph = k * 2.399963;
            const p = [c[0] + h[0] * rr * Math.cos(ph), c[1] + h[1] * rr * Math.sin(ph), c[2] + h[2] * z];
            rEnvMax = Math.max(rEnvMax, vlen(sub(p, L)));
          }
        }
      }
      const patchMin = Math.max(cell * 0.75, ledMin * D / Math.max(1e-6, rEnvMax * rUse));
      // paint second moments → extent
      const mom = (() => {
        let sw = 0, su = 0, sv = 0;
        for (let j = 0; j < pres; j++) for (let i = 0; i < pres; i++) {
          const w = paint[j * pres + i]; if (!(w > 0)) continue;
          const u = -half + (i + 0.5) * cell, v = -half + (j + 0.5) * cell;
          sw += w; su += w * u; sv += w * v;
        }
        const cu = su / sw, cv = sv / sw;
        let suu = 0, svv = 0, suv = 0;
        for (let j = 0; j < pres; j++) for (let i = 0; i < pres; i++) {
          const w = paint[j * pres + i]; if (!(w > 0)) continue;
          const u = -half + (i + 0.5) * cell - cu, v = -half + (j + 0.5) * cell - cv;
          suu += w * u * u; svv += w * v * v; suv += w * u * v;
        }
        return { cu, cv, suu: suu / sw, svv: svv / sw, suv: suv / sw, sw };
      })();
      const rms = Math.sqrt(Math.max(1e-6, mom.suu + mom.svv));

      // ---- beamlet variants: build a few, keep the one whose MODEL best reproduces the painting
      const W = Math.max(16, Math.min(pres, 50));
      const dw = downsample(paint, pres, W), g = dw.g, Wc = dw.W, cellW = 2 * half / Wc;
      const nWant = Math.max(1, Math.min(maxFacets, 500));
      const keepPad0 = keep + 0.55 * ledMin + 0.8;
      const sMaxReal = ledMin * D / (keepPad0 * 0.95);

      function buildBeamlets(maxSize) {
        const S0 = Math.max(patchMin, cell * 1.2);
        const S1 = Math.min(Math.max(S0 * 1.2, Math.min(4 * rms * 0.95, patchMin * maxSize)), sMaxReal);
        const sizes = [];
        for (let k = 0; k < nSizes; k++) sizes.push(S0 * Math.pow(Math.max(S1, S0 * 1.15) / S0, k / Math.max(1, nSizes - 1)));
        const bl = decompose(g, Wc, cellW, sizes, nWant, softFrac);
        for (const b of bl) {
          b.u = -half + (b.i + 0.5) * cellW;
          b.v = -half + (b.j + 0.5) * cellW;
          b.aimg = Math.min(b.sx, b.sy) * clamp(softFrac, 0.5, 1.0);
          b.tu = Math.max(1e-4, b.sx - b.aimg);
          b.tv = Math.max(1e-4, b.sy - b.aimg);
          b.fx = b.tu >= b.aimg ? b.aimg / b.tu : 1;
          b.fy = b.tv >= b.aimg ? b.aimg / b.tv : 1;
          b.rDes = ledMin * D / b.aimg;
          b.w = b.aimg * b.aimg / (b.fx * b.fy);
        }
        refine(bl, Wc, cellW, g, 24);
        return bl.filter((b) => b.a > 1e-3);
      }

      // model fidelity proxy (same shape as the app's: painted cells within, gaps dark)
      function modelScore(live) {
        if (!live.length) return -1;
        const m = new Float64Array(pres * pres);
        for (const b of live) {
          const kx = kernel1d(b.sx, b.tu, cell), ky = kernel1d(b.sy, b.tv, cell);
          const ru = (b.u + half) / cell - 0.5, rv = (b.v + half) / cell - 0.5;
          for (let dj = -ky.n; dj <= ky.n; dj++) for (let di = -kx.n; di <= kx.n; di++) {
            const ii = Math.round(ru) + di, jj = Math.round(rv) + dj;
            if (ii < 0 || ii >= pres || jj < 0 || jj >= pres) continue;
            m[jj * pres + ii] += b.a * kx.k[di + kx.n] * ky.k[dj + ky.n];
          }
        }
        const ratios = [];
        let sp = 0, np = 0;
        for (let k = 0; k < pres * pres; k++) if (paint[k] > 0) { ratios.push(m[k] / paint[k]); sp += paint[k]; np++; }
        if (!np) return -1;
        ratios.sort((a, b) => a - b);
        const typ = sp / np;
        let best = 0;
        for (const q of [0.2, 0.35, 0.5, 0.65, 0.8]) {
          const sc = ratios[Math.floor(q * ratios.length) | 0] || 1;
          if (!(sc > 0)) continue;
          let within = 0;
          for (const r of ratios) if (r >= 0.8 * sc && r <= 1.25 * sc) within++;
          // gaps: unpainted cells within 3 cells of the paint
          let gapN = 0, gapOk = 0;
          for (let j = 0; j < pres; j++) for (let i = 0; i < pres; i++) {
            const k = j * pres + i; if (paint[k] > 0) continue;
            let near = false;
            for (let dj = -3; dj <= 3 && !near; dj++) for (let di = -3; di <= 3; di++) {
              const ii = i + di, jj = j + dj; if (ii < 0 || ii >= pres || jj < 0 || jj >= pres) continue;
              if (paint[jj * pres + ii] > 0) { near = true; break; }
            }
            if (!near) continue;
            gapN++; if (m[k] <= 0.25 * sc * typ) gapOk++;
          }
          const w = within / ratios.length, gd = gapN ? gapOk / gapN : 1;
          const f = w + gd > 0 ? 2 * w * gd / (w + gd) : 0;
          if (f > best) best = f;
        }
        return best;
      }

      const Llum = (src.power || 1) / (Math.PI * Math.max(1e-9, ledW * ledH));   // cd/mm² (Lambertian)
      const PhiCap = Llum * ledW * ledH * Math.PI * 0.55 * refl;    // capturable flux (etendue estimate)
      const M = 256;
      const cands = [];
      {
        const [eu, ev] = V.basis(aLed);
        const ga = Math.PI * (3 - Math.sqrt(5));
        for (let k = 0; k < M; k++) {
          const z = 1 - (k + 0.5) / M;
          const rr = Math.sqrt(Math.max(0, 1 - z * z)), ph = ga * k;
          const d = unit(add(scl(aLed, z), add(scl(eu, rr * Math.cos(ph)), scl(ev, rr * Math.sin(ph)))));
          cands.push({ d, rm: Math.max(0, envRayMax(env, L, d)), cosT: Math.max(0, dot(d, aLed)), used: 0 });
        }
      }
      const keepPad = keep + 0.55 * ledMin + 0.8;
      const marginFrac = 0.012;
      const boxes = [];

      // place facets for one beamlet list; returns {placed, Escale} and fills b.P/b.r/b.dir
      function place(list) {
        for (const c of cands) c.used = 0;
        boxes.length = 0;
        for (const b of list) { b.dir = null; b.P = null; }
        const wsum = list.reduce((s, b) => s + b.a * b.w, 0) || 1;
        const order = list.map((b, i) => i).sort((i, j) => (list[j].a * list[j].w) - (list[i].a * list[i].w));
        let bestRes = null, bestFill = fillFrac;
        for (const ff of [0.95, 0.8, 0.65, 0.5, 0.38, 0.28, 0.2, 0.13, 0.07]) {
          for (const c of cands) c.used = 0;
          boxes.length = 0;
          for (const b of list) { b.dir = null; b.P = null; }
          const Escale = ff * PhiCap / wsum;
          let placed = 0;
          for (const bi of order) {
            const b = list[bi];
            const Eth = Escale * b.a;
            let best = null;
            for (let ci = 0; ci < M; ci++) {
              const c = cands[ci];
              if (c.used) continue;
              if (c.rm < keepPad * 1.15) continue;
              const r = Math.min(b.rDes, c.rm * rUse);
              if (r < keepPad) continue;
              const P = add(L, scl(c.d, r));
              const aim = unit(sub(b.aim, P));
              const cosA = clamp(dot(c.d, aim), -1, 1);
              const cosG = Math.sqrt(Math.max(0, (1 - cosA) / 2));
              if (cosG < 0.08) continue;
              const cosTi = Math.max(0.05, c.cosT);
              const Af = Eth * D * D / Math.max(1e-9, Llum * cosG * cosTi * b.fx * b.fy);
              const aHalf = 0.5 * Math.sqrt(Math.max(Af, 1e-4));
              const nrm = unit(add(unit(sub(L, P)), aim));
              const e1 = V.inPlane(nrm, Math.abs(nrm[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
              const e2 = cross(nrm, e1);
              const hy = aHalf * (Math.abs(e1[1]) + Math.abs(e2[1]));
              const hz = aHalf * (Math.abs(e1[2]) + Math.abs(e2[2]));
              let ok = true;
              for (const q of boxes) {
                if (Math.abs(P[1] - q[0]) < (hy + q[2]) * 0.92 && Math.abs(P[2] - q[1]) < (hz + q[3]) * 0.92) { ok = false; break; }
              }
              if (!ok) continue;
              for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                const q = add(P, add(scl(e1, sa * aHalf), scl(e2, sb * aHalf)));
                if (!RF.Geo.envInside(env, q, -marginFrac)) { ok = false; break; }
                if (vlen(sub(q, L)) < keepPad) { ok = false; break; }
              }
              if (!ok) continue;
              const score = 0.5 * (c.rm / Math.max(1, rEnvMax)) + 0.5 * cosG * cosTi - 0.002 * Math.abs(r - b.rDes);
              if (!best || score > best.score) best = { score, ci, r, cosG, cosTi, Af, p: 2 * aHalf, hy, hz, nrm, e1, e2 };
            }
            if (!best) continue;
            const c = cands[best.ci];
            c.used = 1;
            b.dir = c.d; b.r = best.r; b.cosG = best.cosG; b.cosTi = best.cosTi;
            b.P = add(L, scl(c.d, best.r));
            b.p = best.p; b.nrm = best.nrm; b.e1 = best.e1; b.e2 = best.e2;
            b.dOm = best.Af * best.cosG / (best.r * best.r);
            boxes.push([b.P[1], b.P[2], best.hy, best.hz]);
            placed++;
          }
          if (!bestRes || placed > bestRes.placed) {
            bestRes = { placed, Escale, snap: list.map((b) => (b.dir ? { dir: b.dir, r: b.r, P: b.P, p: b.p, nrm: b.nrm, e1: b.e1, e2: b.e2, cosG: b.cosG, cosTi: b.cosTi, dOm: b.dOm } : null)) };
            bestFill = ff;
          }
          if (placed >= 0.94 * list.length) break;
        }
        // restore the best placement's geometry (kept from the winning fill pass)
        if (bestRes && bestRes.snap) for (let i = 0; i < list.length; i++) {
          const sn = bestRes.snap[i], b = list[i];
          if (sn) Object.assign(b, sn); else { b.dir = null; b.P = null; }
        }
        return bestRes;
      }

      let bestMax = clamp(settings.maxSize, 1.5, 8), bestPlace = null, live = null, bestScore = -1;
      for (const mv of [bestMax * 0.75, bestMax, bestMax * 1.35]) {
        const bl = buildBeamlets(mv);
        if (!bl.length) continue;
        for (const b of bl) b.aim = add(TC, add(scl(tu, b.u), scl(tv, b.v)));
        const pl = place(bl);
        if (!pl || !pl.placed) continue;
        for (const b of bl) if (b.dir) {
          const aimg = Math.min(ledMin * D / b.r, 0.98 * Math.min(b.sx, b.sy));
          b.aimg = aimg; b.tu = Math.max(1e-3, b.sx - aimg); b.tv = Math.max(1e-3, b.sy - aimg);
          b.fx = b.tu >= aimg ? aimg / b.tu : 1; b.fy = b.tv >= aimg ? aimg / b.tv : 1;
        }
        refine(bl.filter((b) => !b.dead && b.dir), Wc, cellW, g, 10);
        const keepBl = bl.filter((b) => !b.dead && b.a > 1e-3 && b.dir);
        const sc = modelScore(keepBl);
        if (sc > bestScore) { bestScore = sc; live = keepBl; bestMax = mv; bestPlace = pl; }
      }
      if (!live || !live.length) return { surfaces: [], intent: [], notes: ['no facet could be placed'] };
      let skipped = Math.max(0, bestPlace.placed - live.length);

      // ---- realise facets
      const surfaces = [], intent = [];
      for (let bi = 0; bi < live.length; bi++) {
        const b = live[bi];
        if (!b.dir) { skipped++; continue; }
        const P = b.P, Z = b.aim;
        const n = unit(add(unit(sub(L, P)), unit(sub(Z, P))));       // bisector, faces the LED
        const p = b.p;
        // vergences that give the beamlet's u/v blur:  t = p·(D·v − 1)
        const v1 = (1 + b.tu / p) / D, v2 = (1 + b.tv / p) / D;
        const Di = 1 / Math.max(1e-9, (v1 + v2) / 2);
        const e1 = V.inPlane(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
        const e2 = cross(n, e1);
        const aHalf = 0.5 * p;
        const pts3 = [];
        for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          pts3.push(add(P, add(scl(e1, sa * aHalf), scl(e2, sb * aHalf))));
        }
        let ok = true;
        for (const q of pts3) {
          if (!RF.Geo.envInside(env, q, -marginFrac)) { ok = false; break; }
          if (vlen(sub(q, L)) < keep * 1.01) { ok = false; break; }
        }
        if (!ok) { skipped++; continue; }
        const id = 'F' + bi;
        surfaces.push({
          type: 'facet', id, group: 'A', P, S0: L.slice(), Z, flat: false, di: Di,
          vg: [v1, v2], ax: tu.slice(),
          clip: { kind: 'poly', pts3 },
          optics: { interaction: 'reflect', reflectivity: refl, twoSided: false },
        });
        b.real = { p, v1, v2 };
        const cells = [];
        const ru = b.sx * 0.5, rv = b.sy * 0.5;
        for (let j = 0; j < pres; j++) for (let i = 0; i < pres; i++) {
          if (!(paint[j * pres + i] > 0)) continue;
          const du = -half + (i + 0.5) * cell - b.u, dv = -half + (j + 0.5) * cell - b.v;
          if (Math.abs(du) <= ru && Math.abs(dv) <= rv) cells.push([j * pres + i, paint[j * pres + i]]);
        }
        intent.push({ facet: id, cells });
      }

      notes.push('beamlets ' + live.length + ', facets ' + surfaces.length + (skipped ? ', skipped ' + skipped : '') +
        ', patch ' + patchMin.toFixed(1) + '–' + (patchMin * bestMax).toFixed(0) + ' mm, r ' +
        (surfaces.length ? Math.min(...surfaces.map((s) => vlen(sub(s.P, L)))).toFixed(1) + '–' + Math.max(...surfaces.map((s) => vlen(sub(s.P, L)))).toFixed(1) : '—') + ' mm');
      {
        const rr = [];
        for (let k = 0; k < pres * pres; k++) if (paint[k] > 0) {
          let m = 0;
          for (const b of live) { if (!(b.a > 0)) continue;
            const du = Math.abs(-half + (k % pres + 0.5) * cell - b.u), dv = Math.abs(-half + ((k / pres | 0) + 0.5) * cell - b.v);
            const kx = du < b.sx / 2 ? (b.tu > 0 ? Math.min(1, (b.sx / 2 - du) / b.tu) : 1) : 0;
            const ky = dv < b.sy / 2 ? (b.tv > 0 ? Math.min(1, (b.sy / 2 - dv) / b.tv) : 1) : 0;
            m += b.a * kx * ky; }
          rr.push(m / paint[k]); }
        rr.sort((a, b) => a - b);
        if (rr.length) notes.push('MODEL p5/50/95 ' + [0.05, 0.5, 0.95].map((q) => rr[Math.floor(q * rr.length) | 0].toFixed(2)).join('/'));
      }
      return { surfaces, intent, notes };
  }

  // ================================================================ tuner (may trace; its id ends in -auto)
  // Candidate settings per goal.  Every candidate is a full static solve; the candidates differ only by
  // geometry (same input, same seed for the trace), so the comparison is not dice.
  const CANDIDATES = {
    faithful:  [{}, { soft: 0.85 }, { soft: 0.95 }, { maxSize: 2.5 }, { maxSize: 4.5 }],
    throw:     [{}, { maxSize: 2.0 }, { maxSize: 2.8 }, { fill: 0.95 }, { rUse: 0.98 }, { maxSize: 2.0, fill: 0.95 }],
    efficient: [{}, { fill: 0.4 }, { fill: 0.6 }, { fill: 0.95 }, { maxSize: 2.5 }, { soft: 0.85 }],
  };
  function autoScore(goal, tr) {
    if (!tr) return 0;
    if (goal === 'throw') return tr.peakCd || 0;
    const fd = tr.fidelity;
    if (!fd) return 0;
    return goal === 'efficient' ? (fd.onPaint || 0) : (fd.fidelity || 0);
  }
  function candName(cs) {
    const ks = Object.keys(cs);
    return ks.length ? ks.map((k) => k + '=' + cs[k]).join(',') : 'defaults';
  }

  RF.Solvers.register({
    id: 'bench-ernie55flash-r3--flux-mosaic-auto',
    name: 'Flux mosaic (auto-tuned)',
    version: '1.0',
    modes: ['paint'],
    settings: [
      { key: 'minDistance', label: 'Min facet distance (mm)', type: 'number', min: 0, step: 0.5, default: 0 },
      { key: 'goal', label: 'Goal', type: 'select', options: [
        { value: 'faithful', label: 'Faithful to the painting' },
        { value: 'throw', label: 'Throw / peak brightness' },
        { value: 'efficient', label: 'Most light on the paint' },
      ], default: 'faithful' },
      { key: 'quality', label: 'Trace quality', type: 'select', options: [
        { value: 'fast', label: 'Fast (120k rays / candidate)' },
        { value: 'normal', label: 'Normal (250k rays)' },
        { value: 'deep', label: 'Deep (600k rays)' },
      ], default: 'normal' },
    ],

    solve(input, settings, tools) {
      // the static solver's own defaults, plus the user's shared controls
      const staticDef = RF.Solvers.get('bench-ernie55flash-r3--flux-mosaic');
      const base = Object.assign(staticDef ? RF.Solvers.defaults(staticDef) : {}, { minDistance: settings.minDistance || 0 });
      const goal = CANDIDATES[settings.goal] ? settings.goal : 'faithful';
      const cands = CANDIDATES[goal];
      if (!tools || typeof tools.trace !== 'function') return solveStatic(input, base);
      const budget = tools.budget || { rays: 2e7, ms: 60000 };
      const budgetMs = budget.ms || 60000, budgetRays = budget.rays || 2e7;
      let raysPer = settings.quality === 'fast' ? 120000 : settings.quality === 'deep' ? 600000 : 250000;
      raysPer = Math.max(40000, Math.min(raysPer, Math.floor(budgetRays * 0.6 / cands.length)));
      const t0 = Date.now();
      let best = null, tried = 0;
      const log = [];
      for (const cs of cands) {
        if (tried && Date.now() - t0 > 0.45 * budgetMs) break;
        let out = null;
        try { out = solveStatic(input, Object.assign({}, base, cs)); } catch (e) { continue; }
        if (!out || !out.surfaces || !out.surfaces.length) { log.push(candName(cs) + ': no design'); continue; }
        let tr = null;
        try { tr = tools.trace(out.surfaces, { rays: raysPer, seed: input.seed }); } catch (e) { break; }
        tried++;
        const score = autoScore(goal, tr);
        log.push(candName(cs) + ': ' + score.toPrecision(3));
        if (!best || score > best.score) best = { score, out, cs };
        if (Date.now() - t0 > 0.5 * budgetMs) break;
      }
      if (!best) return solveStatic(input, base);
      return {
        surfaces: best.out.surfaces,
        intent: best.out.intent,
        notes: (best.out.notes || []).concat([
          'auto: goal ' + goal + ' → ' + candName(best.cs) + ' (score ' + best.score.toPrecision(3) +
          ' over ' + tried + ' candidates at ' + raysPer.toLocaleString() + ' rays each: ' + log.join('; ') + ')',
        ]),
      };
    },
  });
})();
