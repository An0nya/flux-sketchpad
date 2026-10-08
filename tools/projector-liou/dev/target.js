/* target.js — the IDEAL BEAM: a far-field intensity map T*(h, v) in cd that satisfies the spec with margin, has a cut-off edge of a
 * chosen sharpness, and puts the remaining light where a driver wants it (the road).  No optics here: the real judge (RF.Spec.evaluate)
 * is run on T* itself, on a noise-free grid, so "does the ideal beam pass?" is answered before any mirror exists.
 *
 *   RF.SqmTarget.grid(spec, step)                         → pixel grid (centres, solid angles)
 *   RF.SqmTarget.bands(spec, grid, margins)                → { lo, hi } per pixel (cd), margins applied
 *   RF.SqmTarget.design(P, grid, bands, params)            → { T, flux, ... }
 *   RF.SqmTarget.judge(grid, cdMap, md)                    → RF.Spec.evaluate on a noise-free field                              */
(function () {
  'use strict';
  const RF = globalThis.RF, V = RF.V, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function grid(win, step, conv) {
    const nh = Math.round((win[1] - win[0]) / step), nv = Math.round((win[3] - win[2]) / step), n = nh * nv;
    const g = { win, step, conv: conv || 'A', nh, nv, n, h0: win[0], v0: win[2], om: new Float64Array(n) };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) g.om[j * nh + i] = RF.FarField.binOmega(g.h0 + i * step, g.h0 + (i + 1) * step, g.v0 + j * step, g.v0 + (j + 1) * step, g.conv);
    g.hOf = (i) => g.h0 + (i + 0.5) * step; g.vOf = (j) => g.v0 + (j + 0.5) * step;
    g.iOf = (h) => Math.floor((h - g.h0) / step); g.jOf = (v) => Math.floor((v - g.v0) / step);
    return g;
  }
  const satOf = (a, nh, nv) => { const W = nh + 1, S = new Float64Array(W * (nv + 1)); for (let j = 0; j < nv; j++) { let row = 0; for (let i = 0; i < nh; i++) { row += a[j * nh + i]; S[(j + 1) * W + i + 1] = S[j * W + i + 1] + row; } } return S; };
  // a noise-free judge grid from lm per bin (the object RF.Spec.evaluate reads)
  function judgeGrid(g, E, o) {
    o = o || {}; const nh = g.nh, nv = g.nv, E2 = new Float64Array(nh * nv); let lm = 0; for (let q = 0; q < E.length; q++) lm += E[q];
    return { E, E2, Om: g.om, nh, nv, h0: g.h0, v0: g.v0, step: g.step, h1: g.h0 + nh * g.step, v1: g.v0 + nv * g.step, conv: g.conv, distance: o.distance > 0 ? o.distance : Infinity, centre: (o.centre || [0, 0, 0]).slice(),
      lmWindow: lm, lmExit: lm, rays: 1e9, coverage: 1, N: 1e9, streamed: true, eRay: 0, sat: { E: satOf(E, nh, nv), E2: satOf(E2, nh, nv), Om: satOf(g.om, nh, nv) } };
  }
  function mdOf(spec) {
    const a = spec.aim || {}, box = a.box ? Object.assign({}, a.box) : null;
    return { items: spec.items, traffic: 'RHT', conv: spec.conv, kernel: spec.kernel, step: spec.step || 0.1, aimMode: a.mode || 'design', aimLine: a.line, aimScan: a.scan, aimBox: box && spec.traffic === 'LHT' ? { left: box.right, right: box.left, up: box.up, down: box.down } : box, itemReaim: a.itemReaim || 0, aimTol: 0 };
  }
  function judge(g, cd, spec, o) {
    const E = new Float64Array(g.n); for (let q = 0; q < g.n; q++) E[q] = cd[q] * g.om[q];
    return RF.Spec.evaluate(judgeGrid(g, E, o), mdOf(spec));
  }

  // ---- the spec as per-pixel floors and ceilings (cd), with a margin on each (factor ≥ 1: floor × m, ceiling ÷ m)
  function bands(spec, g, mg) {
    mg = Object.assign({ lo: 1.25, hi: 1.25 }, mg || {});
    const lo = new Float64Array(g.n), hi = new Float64Array(g.n).fill(Infinity), wc = new Float64Array(g.n), k = spec.kernel > 0 ? spec.kernel : 0.15, items = spec.items;
    const rad = Math.max(k, g.step / 2) + 1e-9;
    const pxAt = (h, v) => { const out = [], i0 = g.iOf(h - rad), i1 = g.iOf(h + rad), j0 = g.jOf(v - rad), j1 = g.jOf(v + rad); for (let j = Math.max(0, j0); j <= Math.min(g.nv - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(g.nh - 1, i1); i++) out.push(j * g.nh + i); if (!out.length) { const i = g.iOf(h), j = g.jOf(v); if (i >= 0 && j >= 0 && i < g.nh && j < g.nv) out.push(j * g.nh + i); } return out; };
    const pxIn = (poly) => { let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const [h, v] of poly) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); v0 = Math.min(v0, v); v1 = Math.max(v1, v); } const out = []; for (let j = Math.max(0, g.jOf(v0)); j <= Math.min(g.nv - 1, g.jOf(v1)); j++) for (let i = Math.max(0, g.iOf(h0)); i <= Math.min(g.nh - 1, g.iOf(h1)); i++) if (RF.Spec.inPoly(poly, g.hOf(i), g.vOf(j))) out.push(j * g.nh + i); return out; };
    const refMin = (name) => { const it = items.find((x) => x.name === name && x.kind === 'point'); return it && it.min > 0 ? it.min : 0; };
    const wOf = (px) => Math.pow(Math.max(9, px.length) / 9, -0.75);              // a spec point (9 pixels) weighs 1; a zone of 4000 pixels 0.01 each: rows count about alike, not by area
    const setLo = (px, v) => { const w = wOf(px); for (const p of px) { if (v * mg.lo > lo[p]) lo[p] = v * mg.lo; if (w > wc[p]) wc[p] = w; } };
    const setHi = (px, v) => { const w = wOf(px); for (const p of px) { if (v / mg.hi < hi[p]) hi[p] = v / mg.hi; if (w > wc[p]) wc[p] = w; } };
    const rows = [];
    for (const it of items) {
      let px = null, mn = it.min || 0, mx = it.max || 0, per = 1;
      if (it.kind === 'point') px = pxAt(it.h, it.v);
      else if (it.kind === 'zone') px = pxIn(it.poly);
      else if (it.kind === 'sum') { for (const [h, v] of it.pts) { const p = pxAt(h, v); if (it.min > 0) setLo(p, it.min / it.pts.length); rows.push({ name: it.name, kind: 'sum-pt', px: p }); } continue; }
      else continue;
      if (it.maxRel) { const r = refMin(it.maxRel.ref); if (r > 0) mx = mx > 0 ? Math.min(mx, it.maxRel.factor * r) : it.maxRel.factor * r; }
      if (mn > 0) setLo(px, mn); if (mx > 0) setHi(px, mx);
      rows.push({ name: it.name, kind: it.kind, px, min: mn, max: mx });
    }
    return { lo, hi, wc, rows };
  }

  // ---- log-domain blur along v (and a little along h): a step in intensity becomes a smooth edge with ONE steepest point
  function logBlur(g, T, sv, sh) {
    const lg = new Float64Array(g.n); for (let q = 0; q < g.n; q++) lg[q] = Math.log(Math.max(T[q], 1e-3));
    const pass = (src, sigma, vert) => {
      if (!(sigma > 0)) return src; const r = Math.ceil(3 * sigma / g.step), w = []; let ws = 0; for (let d = -r; d <= r; d++) { const x = Math.exp(-0.5 * (d * g.step / sigma) ** 2); w.push(x); ws += x; }
      const out = new Float64Array(g.n);
      for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nh; i++) { let s = 0, ww = 0; for (let d = -r; d <= r; d++) { const ii = vert ? i : i + d, jj = vert ? j + d : j; if (ii < 0 || jj < 0 || ii >= g.nh || jj >= g.nv) continue; s += w[d + r] * src[jj * g.nh + ii]; ww += w[d + r]; } out[j * g.nh + i] = s / ww; }
      return out;
    };
    const o = pass(pass(lg, sv, true), sh, false); const T2 = new Float64Array(g.n); for (let q = 0; q < g.n; q++) T2[q] = Math.exp(o[q]); return T2;
  }

  RF.SqmTarget = { grid, judgeGrid, judge, mdOf, bands, logBlur, satOf };
})();

// ======================================================================= design of T*
(function () {
  'use strict';
  const RF = globalThis.RF, T = RF.SqmTarget, D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // road-driven plateau: the intensity (cd) that gives E(x, y) = E100 · (100 / x)^gamma on the road where each pixel's ray lands
  // (a vertical sensor 25 cm up facing the car, IIHS), within the road + a verge, out to the IIHS distances (100 m right edge, 60 m left edge).
  function roadPlateau(g, spec, R) {
    R = Object.assign({ mountH: 0.65, lane: 3.3, sensorZ: 0.25, E100: 1, gamma: 0.8, verge: 1.5, lamps: 2, nearM: 4, farR: 100, farL: 60 }, R || {});
    const out = new Float64Array(g.n), drop = R.mountH - R.sensorZ, sg = spec.traffic === 'LHT' ? -1 : 1, yR = -R.lane / 2, yL = 1.5 * R.lane;
    if (!(drop > 0)) return out;
    for (let j = 0; j < g.nv; j++) {
      const v = g.vOf(j); if (!(v < -0.05)) continue;
      const dist = drop / Math.tan(-v * D2R);
      for (let i = 0; i < g.nh; i++) {
        const h = sg * g.hOf(i), x = dist * Math.cos(h * D2R), y = -dist * Math.sin(h * D2R);
        if (x < R.nearM) continue;
        const o = y < yR ? yR - y : y > yL ? y - yL : 0, wy = Math.exp(-((o / R.verge) ** 2));
        const goal = R.farR + (R.farL - R.farR) * clamp((y - yR) / (yL - yR), 0, 1), wx = 1 / (1 + Math.exp((x - goal) / 8));
        const E = R.E100 * Math.pow(100 / x, R.gamma) * wy * wx, r = Math.hypot(x, y, drop);
        out[j * g.nh + i] = E * r * r / (x / r) / R.lamps;
      }
    }
    return out;
  }
  // a soft dilation of the floors that sit above the cut-off (the sign points): a dim glow, not isolated pixels
  function glowField(g, lo, hi, radius) {
    const out = new Float64Array(g.n), r = Math.ceil(radius / g.step);
    for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; if (!(lo[q] > 0) || g.vOf(j) < 0.2) continue;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= g.nh || jj >= g.nv) continue; const d = Math.hypot(di, dj) * g.step, w = d <= radius * 0.5 ? 1 : Math.max(0, 1 - (d - radius * 0.5) / (radius * 0.5)); const p = jj * g.nh + ii; if (lo[q] * w > out[p]) out[p] = lo[q] * w; } }
    return out;
  }
  // the cut-off line of the spec: where the beam's top edge sits at each H (needs a cut-off scan in the spec): the aim rule's line on the oncoming
  // side (R112 0.57° D, FMVSS VOL 0.4° D), rising on the own side (ECE 15° up to +1°, US ≈ 1.4°/° up to +1°).
  // The plateau on the road side may rise above the 15° / US line: the spec reads the cut-off only on the oncoming side, and Zone III (max 625 cd) starts on the 45° diagonal from the elbow,
  // so up to `lift` above the line (kept 0.6° under that diagonal) the right side is free to carry the road.  A hot spot inside the plateau, not on its edge, is also the one the die images can fill.
  function cutOf(spec, o) {
    if (!spec.items.some((x) => x.kind === 'gradient')) return null;
    o = Object.assign({ slope: 1.0, lift: 0.42, leftLift: 0, leftFrom: 3.9, leftSpan: 1.5 }, o || {}); const line = spec.aim && spec.aim.line < 0 ? spec.aim.line : -0.57, own = spec.traffic === 'LHT' ? -1 : 1, us = /^fmvss/.test(spec.preset || ''), t15 = Math.tan(15 * D2R);
    return { line, own, us, top: (h) => { const x = own * h; if (x <= 0) { if (!(o.leftLift > 0)) return line; const t = Math.max(0, Math.min(1, (-x - o.leftFrom) / o.leftSpan)); return line + o.leftLift * t * t * (3 - 2 * t); } const classic = us ? Math.min(line + 1.4 * x, 1.0) : Math.min(line + x * t15, 1.0); return o.lift > 0 ? Math.max(classic, Math.min(line + o.slope * x, line + o.lift)) : classic; } };
  }
  const fluxOf = (g, Tf) => { let s = 0; for (let q = 0; q < g.n; q++) s += Tf[q] * g.om[q]; return s; };

  // a wide foreground wash: the sink for light the road term cannot use (below the spec's own zones, wide, smooth)
  function washShape(g, spec, o) {
    o = Object.assign({ sigH: 18, top: -4.2, ramp: 1.6, bottom: -14 }, o || {}); const out = new Float64Array(g.n);
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); let t = clamp((o.top - v) / o.ramp, 0, 1); t = t * t * (3 - 2 * t); if (v < o.bottom) t *= Math.max(0, 1 - (o.bottom - v) / 6); if (!(t > 0)) continue; for (let i = 0; i < g.nh; i++) out[j * g.nh + i] = t * Math.exp(-((g.hOf(i) / o.sigH) ** 2)); }
    return out;
  }
  /* Aim guard.  The stock cut-off finder (Spec aimOf → scanCut) reads the steepest log-step of a vertical scan in one column (H = -2.5° on the oncoming side), counting only steps whose
   * bright side holds ≥ 2 % of the column's maximum.  Light above the cut-off at that level is, for a traced (shot-noisy) far field, a field of spurious steps steeper than the real edge:
   * the whole pattern then gets read up to a degree off.  Keep the glow in the scan columns at rho × the column maximum (a floor of the spec still wins over the cap).  */
  function guardCols(P, cut) {
    const spec = P.spec, a = spec.aim || {}, gi = spec.items.find((x) => x.kind === 'gradient'), rho = P.guard > 0 ? P.guard : 0, g = P.g;
    if (!(rho > 0) || !cut || !gi || a.mode !== 'cutoff' || !isFinite(gi.h)) return null;
    const kh = gi.kh || 0.25, li = spec.items.find((x) => x.kind === 'linearity'), hs = [gi.h].concat(li && li.hs ? li.hs.filter((h) => Math.abs(h - gi.h) > 0.3) : []);
    const S = a.scan > 0 ? a.scan : 3, line = isFinite(a.line) && a.line < 0 ? a.line : cut.line, vmax = g.v0 + g.nv * g.step;
    return { rho, gap: 0.2, lift: P.guardLift > 0 ? P.guardLift : 0, cols: hs.map((hc) => ({ hc, i0: Math.max(0, g.iOf(hc - kh - 0.15)), i1: Math.min(g.nh - 1, g.iOf(hc + kh + 0.15)), j0: Math.max(0, g.jOf(Math.max(g.v0 + 0.2, line - S))), j1: Math.min(g.nv - 1, g.jOf(Math.min(vmax - 0.2, line + S))) })) };
  }
  // cap the glow above the cut-off in the guarded columns (Tf in place); → the caps used, for the pipeline's band
  function guardApply(P, B, Tf, cut, dTop, G) {
    if (!G) return null; const g = P.g, out = [];
    for (const c of G.cols) {
      let M = 0; for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) if (Tf[j * g.nh + i] > M) M = Tf[j * g.nh + i];
      const cap = G.rho * M, px = []; if (!(M > 0)) continue;
      // the cap starts where the edge's own tail has come down to 1.3 × the cap (a cap that cut into the tail would be a second, steeper edge)
      let vStart = cut.top(c.hc) - dTop + G.gap; { const jc = g.jOf(cut.top(c.hc) - dTop - 0.6); let jm = jc; for (let j = Math.max(c.j0, jc); j <= c.j1; j++) { let s = 0; for (let i = c.i0; i <= c.i1; i++) s += Tf[j * g.nh + i]; if (s / (c.i1 - c.i0 + 1) <= 1.3 * cap) { jm = j; break; } jm = j; } vStart = Math.max(g.vOf(jm), cut.top(c.hc) - dTop) + (G.lift || 0); }
      for (let j = c.j0; j <= c.j1; j++) { if (g.vOf(j) < vStart) continue; for (let i = c.i0; i <= c.i1; i++) { const q = j * g.nh + i, c2 = Math.max(cap, B.lo[q]); if (Tf[q] > c2) Tf[q] = c2; px.push(q); } }
      out.push({ hc: c.hc, M, cap, vStart, px });
    }
    return out;
  }
  /* One T* for given parameters.  plateau = alpha · road (zero above the cut-off line shifted down by dTop), max'ed with the wash (level W0) and the glow, clamped by
   * the floors/ceilings, a log-domain blur of width sv makes the edges, a final clamp keeps every pixel inside its band.                                         */
  function build(P, S, alpha, W0, sv, dTop) {
    const { g, B } = P, n = g.n, Th = new Float64Array(n), cut = S.cut, cap = P.peakCap > 0 ? P.peakCap : Infinity;
    for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i; let s = alpha * S.road[q]; if (cut && v > cut.top(g.hOf(i)) - dTop) s = 0; s = Math.max(Math.min(s, cap), W0 * S.wash[q], S.glow[q]); Th[q] = clamp(s, B.lo[q], B.hi[q]); } }
    const Tb = T.logBlur(g, Th, sv, P.sh >= 0 ? P.sh : 0.1), Tf = new Float64Array(n);
    for (let q = 0; q < n; q++) { let x = Tb[q]; if (x < 1e-2) x = 0; Tf[q] = clamp(x, B.lo[q], B.hi[q]); }
    if (S.guard) guardApply(P, B, Tf, cut, dTop, S.guard);
    return Tf;
  }
  const hardFails = (ev) => ev.rows.filter((r) => r.verdict === 'fail').length;
  // the wash level that makes the post-blur flux equal the target (the road term is fixed by the peak cap)
  function washFor(P, S, alpha, sv, dTop, fluxTarget) {
    let lo = 0, hi = P.washCap > 0 ? P.washCap : 1e5; if (fluxOf(P.g, build(P, S, alpha, hi, sv, dTop)) < fluxTarget) return hi;     // even the cap cannot absorb it
    if (fluxOf(P.g, build(P, S, alpha, 0, sv, dTop)) >= fluxTarget) return 0;
    for (let it = 0; it < 14; it++) { const m = 0.5 * (lo + hi); (fluxOf(P.g, build(P, S, alpha, m, sv, dTop)) < fluxTarget ? (lo = m) : (hi = m)); }
    return 0.5 * (lo + hi);
  }
  /* design(P): P = { spec, g, B, fluxTarget (lm in the window), peakCap (cd), washCap (cd), gd (design G per 0.1°; the realised edge is softer, so aim a bit sharp), road, glowR }.
   * Searches the edge: for each shift dTop of the plateau below the line, the blur that gives gd; keeps the first that passes the real judge. */
  function design(P) {
    const { g, spec } = P, gd = P.gd || 0.34, road = roadPlateau(g, spec, P.road); let rmax = 0; for (const x of road) if (x > rmax) rmax = x;
    const S = { road, wash: washShape(g, spec, P.wash), glow: glowField(g, P.B.lo, P.B.hi, P.glowR || 3.0), cut: P.cut === undefined ? cutOf(spec) : P.cut }; S.guard = guardCols(P, S.cut);
    const alpha = P.peakCap > 0 ? P.peakCap / Math.max(1e-9, rmax) : (P.alpha || 1);
    const hasGrad = spec.items.some((x) => x.kind === 'gradient');
    const run = () => {
      const tries = []; let best = null;
      for (const dTop of (hasGrad ? (P.dTops || [0, 0.1, 0.2, 0.3, 0.45, 0.6]) : [0])) {
        let sv = P.sv > 0 ? P.sv : 0.3, Tf = null, W0 = 0, G = NaN;
        for (let it = 0; it < 4; it++) {
          W0 = P.fluxTarget > 0 ? washFor(P, S, alpha, sv, dTop, P.fluxTarget) : 0; Tf = build(P, S, alpha, W0, sv, dTop);
          if (!hasGrad) break;
          const ev = T.judge(g, Tf, spec), gr = ev.rows.find((r) => r.unit === 'log'); if (!gr || !(gr.value > 0)) break;
          G = gr.value; if (Math.abs(G - gd) < 0.02) break; sv = Math.min(1.5, sv * clamp(G / gd, 0.5, 2));          // bounded: a blur of several degrees is no edge at all
        }
        const ev = T.judge(g, Tf, spec), res = { dTop, sv, W0, G, T: Tf, fails: hardFails(ev), worst: Math.min(...ev.rows.map((r) => r.margin)), ev };
        tries.push(res); if (!best || res.fails < best.fails || (res.fails === best.fails && res.worst > best.worst + 0.02)) best = res;
        if (res.fails === 0 && res.worst > 0.04) { best = res; break; }
      }
      return { best, tries };
    };
    let { best, tries } = run(), guardDropped = false;
    // the guard's cap makes a cliff of its own; if the edge cannot be brought to the design sharpness with it in place (a spec whose floors sit above the cut-off), build the beam without it
    if (S.guard && hasGrad && isFinite(best.G) && best.G > 1.5 * gd) { S.guard = null; guardDropped = true; if (P.B.hi0) { P.B.hi.set(P.B.hi0); P.B.wc.set(P.B.wc0); } ({ best, tries } = run()); }       // the carried caps go too
    const flux = fluxOf(g, best.T), guard = S.guard ? guardApply(P, P.B, Float64Array.from(best.T), S.cut, best.dTop, S.guard) : null;
    return { guard, guardDropped, T: best.T, alpha, W0: best.W0, flux, leftover: Math.max(0, (P.fluxTarget || 0) - flux), edge: { sv: best.sv, dTop: best.dTop, G: best.G }, ev: best.ev, tries: tries.map((t) => ({ dTop: t.dTop, sv: +t.sv.toFixed(3), G: +t.G.toFixed(3), fails: t.fails, worst: +t.worst.toFixed(2) })), road, glow: S.glow, wash: S.wash };
  }
  T.washShape = washShape; T.guardCols = guardCols;
  T.roadPlateau = roadPlateau; T.glowField = glowField; T.cutOf = cutOf; T.design = design; T.fluxOf = fluxOf;
})();
