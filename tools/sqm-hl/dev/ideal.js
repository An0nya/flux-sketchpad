/* ideal.js — sqm-hl-ideal only (node build.js --ideal): the ideal beam T* shaped from the ideal-beam goals (spec.ideal = RF.IdealBeam.of(md)).
 *
 * Plain SQM builds T* from a road plateau (the reach), a foreground wash that soaks up the light the road cannot use, and the glow; then a
 * cut-off search and the aim guard.  This variant keeps all of that and adds (shapes() below):
 *   hot    a dome peaking at hotH, its top edge parallel to the (horizon-capped) cut-off, hotOffset° below the line at hotH (default 0 = AT
 *          the line; Anya 10-10 after the offset sweep; negative = above it, experimental: the legal bands still clamp, the cut-off rows suffer)
 *   band / left   floors for the goals' wash and 3L fill, relative to the hotspot level; the right strip is absolute like the edge (streakCd)
 *   edge   an ABSOLUTE floor (edgeCd) in the left edge strip under the left cut-off: where the IIHS left road edge sits.  Absolute because ECE
 *          caps 75L / 50L near 10.6 / 13.2 kcd: a share of a 100+ kcd hotspot would ask for illegal light there
 *   Zone I (any relative ceiling): from T*'s own 50R, not from 50R's minimum
 * and changes where the light the road cannot use goes (setting `leftover`):
 *   'hotspot'      the dome widens × 1.6 (s 0 → 1), then brightens up to hotGain × (s 1 → 2; default 4 ≈ no cap); then the foreground,
 *                  capped at 0.9 × fgCap of the lumens, then nothing (uncollected)
 *   'uncollected'  plain SQM's foreground sink (washCap), capped at 0.9 × fgCap; the rest is not collected
 * Too much light (the boxes alone over the budget): the whole beam, road plateau and boxes, comes down (s < 0, to 0.1 ×).
 * Removed 10-10: the overshoot / measured-loss modes (the built hotspot top stayed at 1.13–1.25° D whatever the target asked; see NOTES). */
(function () {
  'use strict';
  const RF = globalThis.RF, T = RF.SqmTarget, Pipe = RF.SqmPipe;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x)), sm = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const box = (x, a, b, e) => sm((x - a) / e + 0.5) * sm((b - x) / e + 0.5);       // 1 inside [a, b], soft edges e wide
  let CUR = null;                                                                     // the running solve's settings (T.design gets no S)

  // copy of target.js guardApply (private there)
  function guardApply(P, B, Tf, cut, dTop, G) {
    if (!G) return null; const g = P.g, out = [];
    for (const c of G.cols) {
      let M = 0; for (let j = c.j0; j <= c.j1; j++) for (let i = c.i0; i <= c.i1; i++) if (Tf[j * g.nh + i] > M) M = Tf[j * g.nh + i];
      const cap = G.rho * M, px = []; if (!(M > 0)) continue;
      let vStart = cut.top(c.hc) - dTop + G.gap; { const jc = g.jOf(cut.top(c.hc) - dTop - 0.6); let jm = jc; for (let j = Math.max(c.j0, jc); j <= c.j1; j++) { let s = 0; for (let i = c.i0; i <= c.i1; i++) s += Tf[j * g.nh + i]; if (s / (c.i1 - c.i0 + 1) <= 1.3 * cap) { jm = j; break; } jm = j; } vStart = Math.max(g.vOf(jm), cut.top(c.hc) - dTop) + (G.lift || 0); }
      for (let j = c.j0; j <= c.j1; j++) { if (g.vOf(j) < vStart) continue; for (let i = c.i0; i <= c.i1; i++) { const q = j * g.nh + i, c2 = Math.max(cap, B.lo[q]); if (Tf[q] > c2) Tf[q] = c2; px.push(q); } }
      out.push({ hc: c.hc, M, cap, vStart, px });
    }
    return out;
  }

  /* The goal shapes on the grid, unit level (10-09, after Anya's reference isoplots: a small hotspot just right of V, nested contours,
   * the outer ones following the cut-off incl. its rise).
   *   hot    a DOME peaking at hotH (falls to ½ at the box edges hotLeft L / hotRight R; s 0 → 1 widens it × 1.6 for left-over light),
   *          its top edge PARALLEL to the cut-off (capped at the horizon) through the design top at hotH → the Z is kept, and no side of
   *          the box is taller than another (a flat box clipped by the sloped cut was tallest at the elbow: the 4.5° R blob)
   *   band   the goals' wash floor (± washW, washTop … washTop + washHt), relative to the hotspot level
   *   streak the goals' right streak floor (streakFrom … washW on the own side, horizon/cut-off down streakHt)
   *   left   the 3L fill floor.  edge: the left edge strip's ABSOLUTE floor (edgeCd). */
  function shapes(P, G, off, cut) {
    const g = P.g, own = P.spec.traffic === 'LHT' ? -1 : 1, n = g.n, e = 0.3;
    const ceil = (hg) => cut ? Math.min(cut.top(hg), 0) : 0, cH = ceil(own * G.hotH), tT = cH - off;   // off° below the line at hotH (negative = above)
    const topAt = (hg) => tT + ceil(hg) - cH;                                       // parallel to the (horizon-capped) cut-off line
    const dL = Math.max(0.5, G.hotH + G.hotLeft), dR = Math.max(0.5, G.hotRight - G.hotH), LN2 = Math.LN2;
    const hotAt = (s) => { const w = 1 + 0.6 * clamp(s, 0, 1), out = new Float64Array(n);
      for (let i = 0; i < g.nh; i++) { const hg = g.hOf(i), h = own * hg, d = (h - G.hotH) / ((h < G.hotH ? dL : dR) * w), fh = Math.exp(-LN2 * d * d); if (fh < 0.02) continue;
        const t = topAt(hg); for (let j = 0; j < g.nv; j++) { const fv = box(g.vOf(j), t - G.hotHt, t, e); if (fv > 0) out[j * g.nh + i] = fh * fv; } }
      return out; };
    const line = cut ? cut.top(-own * 1) : -0.57;                                   // the left (oncoming-side) cut-off line
    const band = new Float64Array(n), left = new Float64Array(n), streak = new Float64Array(n), edge = new Float64Array(n), s1 = Math.max(G.streakFrom + 0.5, G.washW);
    for (let i = 0; i < g.nh; i++) { const hg = g.hOf(i), h = own * hg, sc = ceil(hg), fbh = box(h, -G.washW, G.washW, 0.5), flh = box(h, -3, 0, 0.3), fsh = G.streakCd > 0 ? box(h, G.streakFrom, s1, 0.5) : 0, feh = G.edgeCd > 0 ? box(h, -G.edgeTo, -G.edgeFrom, 0.5) : 0;
      for (let j = 0; j < g.nv; j++) { const v = g.vOf(j), q = j * g.nh + i;
        band[q] = G.washRatio * 1.15 * fbh * box(v, -(G.washTop + G.washHt), -G.washTop, 0.25);
        left[q] = G.fill3L * 1.15 * flh * box(v, line - 1.0, line - 0.05, 0.15);   // hung from the left line: a fixed 0.5–1.5° D box made its own step 0.1° under FMVSS's 0.4° D line in the 1.5 / 2.5° L scan columns only → inclination 0.8° (10-10)
        if (fsh > 0) edge[q] = Math.max(edge[q], G.streakCd * 1.15 * fsh * box(v, sc - G.streakHt, sc - 0.1, 0.2));   // absolute, like the left edge strip
        if (feh > 0) edge[q] = G.edgeCd * 1.15 * feh * box(v, line - G.edgeHt, line - 0.05, 0.15); } }      // absolute cd, not × the hotspot level
    return { hotAt, band, left, streak, edge, top: tT };
  }
  /* Soft ceilings (10-10): a point MAXIMUM below the cut-off (FMVSS 0.86D 3.5L ≤ 12 kcd, ECE 50L …) clamps a bright dome into a
   * flat-bottomed notch with hard edges; under FMVSS the notch's lower edge (8.6 → 49 kcd in one 0.2° step) out-steeped the real cut-off,
   * the judge read the "cut-off" 0.8° low in the 3.5° L column and failed inclination.  Each such ceiling becomes a cone in log space:
   * the cap at the row, rising slope decades per degree away from it (chamfer distance transform, 8 neighbours, two passes).  Rows on or
   * above the line (75L, Zone III, …) are left alone: they ARE the cut-off.  → log-cap per pixel (Infinity = none). */
  function softCeil(P, line, slope) {
    const g = P.g, B = P.B, nh = g.nh, nv = g.nv, L = new Float64Array(g.n).fill(Infinity); let any = false;
    for (const r of B.rows) { if (r.kind !== 'point' || !(r.max > 0) || !r.px || !r.px.length) continue;   // points only: a zone's cap coned up into the hotspot and flattened it
      let vTop = -Infinity; for (const q of r.px) vTop = Math.max(vTop, g.vOf((q / nh) | 0)); if (vTop > line - 0.2) continue;
      for (const q of r.px) { const x = B.hi[q]; if (x > 0 && isFinite(x) && Math.log(x) < L[q]) { L[q] = Math.log(x); any = true; } } }
    if (!any) return null;
    const c = Math.LN10 * slope * g.step, cd = c * Math.SQRT2;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nh; i++) { const q = j * nh + i; let v = L[q];
      if (i > 0) v = Math.min(v, L[q - 1] + c); if (j > 0) { v = Math.min(v, L[q - nh] + c); if (i > 0) v = Math.min(v, L[q - nh - 1] + cd); if (i < nh - 1) v = Math.min(v, L[q - nh + 1] + cd); } L[q] = v; }
    for (let j = nv - 1; j >= 0; j--) for (let i = nh - 1; i >= 0; i--) { const q = j * nh + i; let v = L[q];
      if (i < nh - 1) v = Math.min(v, L[q + 1] + c); if (j < nv - 1) { v = Math.min(v, L[q + nh] + c); if (i < nh - 1) v = Math.min(v, L[q + nh + 1] + cd); if (i > 0) v = Math.min(v, L[q + nh - 1] + cd); } L[q] = v; }
    return L;
  }
  const levelOf = (s, gain) => s < 0 ? 1 + 0.9 * s : s <= 1 ? 1 : 1 + (s - 1) * (gain - 1);      // s < 0 dims the road plateau too (a high peakCap otherwise outspends the budget)

  // T* for the ideal variant (replaces T.design in this build; plain SQM's design is untouched in sqm-hl.js)
  function design(P) {
    const C = CUR || {}, G = C.goals || RF.IdealBeam.defaults(), off = isFinite(C.hotOffset) ? C.hotOffset : 0, mode = C.leftover === 'uncollected' ? 'uncollected' : 'hotspot', gain = C.hotGain > 1 ? C.hotGain : 4;
    const { g, spec } = P, gd = P.gd || 0.34, road = T.roadPlateau(g, spec, P.road); let rmax = 0; for (const x of road) if (x > rmax) rmax = x;
    const S = { road, wash: T.washShape(g, spec, P.wash), glow: T.glowField(g, P.B.lo, P.B.hi, P.glowR || 3.0), cut: P.cut === undefined ? T.cutOf(spec) : P.cut }; S.guard = T.guardCols(P, S.cut);
    const alpha = P.peakCap > 0 ? P.peakCap / Math.max(1e-9, rmax) : (P.alpha || 1), cap = P.peakCap > 0 ? P.peakCap : Infinity;
    let sh = shapes(P, G, off, null);
    const relCaps = [];
    // Lh: the road plateau's level at the hot box's top centre (the hotspot the plain design would have there)
    // (sampled 0.3° under the cut-off at hotH: the first sh has no cut, so its top sits at the horizon where the road plateau is ~dark; 10-10 bug: Lh 1.3 kcd)
    const own = spec.traffic === 'LHT' ? -1 : 1, vH = Math.min(S.cut ? S.cut.top(own * G.hotH) : -0.57, 0) - Math.max(0, off) - 0.3;
    const qH = g.jOf(vH) * g.nh + g.iOf(own * G.hotH), Lh = Math.min(cap, alpha * (road[qH] || rmax));
    const softL = softCeil(P, S.cut ? S.cut.top(-own * 1) : -0.57, 0.3);                 // 0.3 decades / degree ≈ 2× per degree
    const fgV = -4, fluxBelow = (Tf) => { let s = 0, t = 0; for (let j = 0; j < g.nv; j++) { const below = g.vOf(j) < fgV; for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i, f = Tf[q] * g.om[q]; t += f; if (below) s += f; } } return t > 0 ? s / t : 0; };
    const build = (s, W0, sv, dTop) => {
      const hot = sh.hotAt(s), k = levelOf(s, gain), L = Lh * k, kr = Math.min(1, k), Th = new Float64Array(g.n), cut = S.cut;
      for (let j = 0; j < g.nv; j++) { const v = g.vOf(j); for (let i = 0; i < g.nh; i++) { const q = j * g.nh + i;
        let x = Math.max(Math.min(alpha * kr * road[q], cap), L * Math.max(sh.band[q], sh.left[q], sh.streak[q])); if (cut && v > cut.top(g.hOf(i)) - dTop) x = 0;
        // the dome sits against the line itself (its soft top may spill over it; the bands clamp)
        x = Math.max(x, L * hot[q], sh.edge[q], W0 * S.wash[q], S.glow[q]); if (softL && x > 0 && Math.log(x) > softL[q]) x = Math.exp(softL[q]); Th[q] = clamp(x, P.B.lo[q], P.B.hi[q]); } }
      const Tb = T.logBlur(g, Th, sv, P.sh >= 0 ? P.sh : 0.1), Tf = new Float64Array(g.n);
      for (let q = 0; q < g.n; q++) { let x = Tb[q]; if (x < 1e-2) x = 0; Tf[q] = clamp(x, P.B.lo[q], P.B.hi[q]); }
      if (S.guard) guardApply(P, P.B, Tf, cut, dTop, S.guard);
      return Tf;
    };
    const bis = (f, lo, hi, target, it) => { for (let k = 0; k < (it || 14); k++) { const m = 0.5 * (lo + hi); (f(m) < target ? (lo = m) : (hi = m)); } return 0.5 * (lo + hi); };
    // where the light goes: → { s, W0 }
    const budget = (sv, dTop) => {
      const tgt = P.fluxTarget, fl = (s, W) => T.fluxOf(g, build(s, W, sv, dTop)), hiW = P.washCap > 0 ? P.washCap : 1e5, fgMax = 0.9 * G.fgCap;
      if (!(tgt > 0)) return { s: 0, W0: 0 };
      const f0 = fl(0, 0);
      if (f0 >= tgt) return { s: fl(-1, 0) >= tgt ? -1 : bis((s) => fl(s, 0), -1, 0, tgt), W0: 0 };
      let s = 0; if (mode === 'hotspot') { s = fl(2, 0) <= tgt ? 2 : bis((x) => fl(x, 0), 0, 2, tgt); if (s < 2) return { s, W0: 0 }; }
      // the foreground: up to what the budget still wants, and never past the share cap
      const shareOK = (W) => fluxBelow(build(s, W, sv, dTop)) <= fgMax;
      let Wc = hiW; if (!shareOK(hiW)) { let lo = 0, hi = hiW; for (let k = 0; k < 14; k++) { const m = 0.5 * (lo + hi); shareOK(m) ? (lo = m) : (hi = m); } Wc = lo; }
      const W0 = fl(s, Wc) <= tgt ? Wc : bis((W) => fl(s, W), 0, Wc, tgt);
      return { s, W0 };
    };
    const hasGrad = spec.items.some((x) => x.kind === 'gradient');
    const hardFails = (ev) => ev.rows.filter((r) => r.verdict === 'fail').length;
    const run = () => {
      const tries = []; let best = null;
      for (const dTop of (hasGrad ? (P.dTops || [0, 0.1, 0.2, 0.3, 0.45, 0.6]) : [0])) {
        let sv = P.sv > 0 ? P.sv : 0.3, Tf = null, bu = { s: 0, W0: 0 }, Gv = NaN;
        sh = shapes(P, G, off, S.cut);
        for (let it = 0; it < 4; it++) {
          bu = budget(sv, dTop); Tf = build(bu.s, bu.W0, sv, dTop);
          if (!hasGrad) break;
          const ev = T.judge(g, Tf, spec), gr = ev.rows.find((r) => r.unit === 'log'); if (!gr || !(gr.value > 0)) break;
          Gv = gr.value; if (Math.abs(Gv - gd) < 0.02) break; sv = Math.min(1.5, sv * clamp(Gv / gd, 0.5, 2));
        }
        const Tc = Tf, tp = RF.IdealBeam.topOf((h, v) => { const i = g.iOf(own * h), j = g.jOf(v); return i < 0 || j < 0 || i >= g.nh || j >= g.nv ? 0 : Tc[j * g.nh + i]; }, G.hotH), topD = tp === null ? NaN : -tp;
        const ev = T.judge(g, Tf, spec), res = { dTop, sv, W0: bu.W0, s: bu.s, topD, G: Gv, T: Tf, fails: hardFails(ev), worst: Math.min(...ev.rows.map((r) => r.margin)), ev };
        tries.push(res); if (!best || res.fails < best.fails || (res.fails === best.fails && res.worst > best.worst + 0.02)) best = res;
        if (res.fails === 0 && res.worst > 0.04) { best = res; break; }
      }
      return { best, tries };
    };
    let { best, tries } = run(), guardDropped = false;
    // relative ceilings (ECE Zone I ≤ 2 × 50R): bands() sets them from the reference point's MINIMUM (50R ≥ 10,100 cd → ~16 kcd after the
    // margin), not the beam's own 50R, which made "wash ≥ ¼ peak" impossible under a bright hotspot.  Reset them from T*'s 50R and build
    // again; the model judge reads the real rule (the beam's own 50R) on the finished design.
    { let moved = 0; const mg = 1.25;
      for (const it of spec.items) { if (!it.maxRel || it.kind !== 'zone') continue; const ref = spec.items.find((x) => x.name === it.maxRel.ref && x.kind === 'point'), row = P.B.rows.find((r) => r.name === it.name);
        if (!ref || !row) continue; const qr = g.jOf(ref.v) * g.nh + g.iOf(ref.h), Tr = best.T[qr]; if (!(Tr > 0)) continue;
        const cap2 = it.maxRel.factor * Tr / mg; for (const q of row.px) { if (cap2 > P.B.hi[q]) { P.B.hi[q] = cap2; if (P.B.hi0) P.B.hi0[q] = Math.max(P.B.hi0[q], cap2); moved++; } }
        relCaps.push({ name: it.name, ref: it.maxRel.ref, at: Math.round(Tr), cap: Math.round(cap2) }); }
      if (moved) ({ best, tries } = run()); }
    if (S.guard && hasGrad && isFinite(best.G) && best.G > 1.5 * gd) { S.guard = null; guardDropped = true; if (P.B.hi0) { P.B.hi.set(P.B.hi0); P.B.wc.set(P.B.wc0); } ({ best, tries } = run()); }
    const flux = T.fluxOf(g, best.T), guard = S.guard ? guardApply(P, P.B, Float64Array.from(best.T), S.cut, best.dTop, S.guard) : null;
    const ideal = { relCaps, Lh, s: best.s, level: levelOf(best.s, gain), off, topD: best.topD, mode, fgShare: fluxBelow(best.T) };
    return { guard, guardDropped, T: best.T, alpha, W0: best.W0, flux, leftover: Math.max(0, (P.fluxTarget || 0) - flux), edge: { sv: best.sv, dTop: best.dTop, G: best.G }, ev: best.ev, tries: tries.map((t) => ({ dTop: t.dTop, sv: +t.sv.toFixed(3), G: +t.G.toFixed(3), fails: t.fails, worst: +t.worst.toFixed(2) })), road, glow: S.glow, ideal };
  }
  T.design = design;

  // the goals on a cd map over P.g (aimed by `sh` = the judge's shift, [0, 0] for T*)
  function goalsOn(P, cd, sh, G) {
    const g = P.g, own = P.spec.traffic === 'LHT' ? -1 : 1, s = sh || [0, 0];
    const I = (h, v) => { const i = g.iOf(own * h + s[0]), j = g.jOf(v + s[1]); return i < 0 || j < 0 || i >= g.nh || j >= g.nv ? 0 : cd[j * g.nh + i]; };
    return RF.IdealBeam.check(I, { ideal: G }, null);
  }
  const line = (r) => r.score + '/' + r.n + ' (' + r.goals.map((x) => (x.met ? '✓' : x.credit > 0 ? '◐' : '✗') + x.key + ' ' + x.value).join(', ') + ')';
  const modelCd = (P, m) => { const g = P.g, out = new Float64Array(g.n); for (let q = 0; q < g.n; q++) out[q] = m.Et[q] / g.om[q]; return out; };

  const solve0 = Pipe.solve;
  function solveOnce(input, S, tools, off) {
    CUR = { goals: (input.spec && input.spec.ideal) || RF.IdealBeam.defaults(), hotOffset: off, leftover: S.leftover, hotGain: S.hotGain };
    try { return solve0(input, S, tools); } finally { CUR = null; }
  }
  function report(o, G, off) {
    const P = o.P; if (P.isPaint || !P.des || !P.des.ideal) return null;
    const m = o.final || o.best.m, rT = goalsOn(P, P.des.T, [0, 0], G), rM = goalsOn(P, modelCd(P, m), m.ev.shift, G), d = P.des.ideal;
    const tM = rM.goals.find((x) => x.key === 'hotTop');
    return { rT, rM, off, top: tM ? tM.value : NaN, d };
  }
  Pipe.solve = function (input, S, tools) {
    if (!input.spec) return solve0(input, S, tools);
    const G = input.spec.ideal || RF.IdealBeam.defaults(), off = isFinite(S.hotOffset) ? S.hotOffset : 0;
    const o = solveOnce(input, S, tools, off); o.ideal = report(o, G, off); return o;
  };
  RF.SqmIdeal = { design, goalsOn, line, shapes };
})();
