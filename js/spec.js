/* spec.js — RF.Spec: Spec mode (mode D).  A beam specification in the style of the automotive headlamp regulations:
 * test points and zones in (H, V) degrees with minimum and/or maximum intensities (cd), a cut-off sharpness scan, and a
 * global intensity cap — plus, optionally, a painted target as a secondary goal.  Pure functions on plain data.
 *
 * Two halves:
 *   1. JUDGING a trace: evaluate(G, md) reads a far-field grid (js/farfield.js) and reports, per constraint, the value,
 *      its shot noise, a margin in decades, a soft score, and a hard verdict that respects the noise:
 *        pass   — met even at value ∓ 2σ          fail — missed even at value ± 2σ        unsure — decided by noise
 *      The lamp is aimed first as the regulation does it (by the cut-off, or the peak on HV), then re-aimed within the
 *      allowed box (searching small ΔH, ΔV moves) and the best result kept.
 *   2. ASKING a solver: workingPaint(scene) turns the spec + the painting into the relative target the existing paint
 *      solvers understand (phase 1: no solver changes).  Minimums become a floor, maximums a ceiling, the painting the
 *      shape in between; the result is converted from intensity to illuminance on the design plane.
 *
 * Item coordinates are written for right-hand traffic (H > 0 = right).  Left-hand traffic mirrors H.
 * Intensities need the source power in lumens (Problem → Light source → Power).                                   */
(function (root) {
  'use strict';
  const RF = root.RF;
  const { V } = RF;
  const LOG2 = Math.log10(2);

  // ---------------------------------------------------------------- presets
  // UN R112 rows transcribed from E/ECE/324/Rev.2/Add.111/Rev.4 (Revision 4, 18 September 2023; text up to Supplement 1
  // to the 02 series), checked against the PDF.  Each row's `ref` names its paragraph / table / page.  Coordinates are
  // right-hand traffic (left-hand traffic mirrors them, §6.2.4).  Angles are the Annex 3 Figure A system: polar axis
  // vertical, h = longitudinal planes around it (azimuth), v = latitude — this app's convention 'A'.
  const R112 = 'UN R112 Rev.4 (E/ECE/324/Rev.2/Add.111/Rev.4, 18 Sep 2023)';
  const R112_MEAS = { kernel: 0.0745, distance: 25000, step: 0.05, conv: 'A' };   // §6.1.2: 25 m, photocell within a 65 mm square (= ±0.0745°); Annex 9 scans in 0.05° steps
  const R112_AIM = { aimMode: 'cutoff', aimLine: -0.57, aimBox: { left: 0.5, right: 0.75, up: 0.25, down: 0.25 } };   // Annex 9 §3.1 (inflection at 2.5° on line B, 0.57° D) · §6.2.2.3 re-aim limits
  const zone3 = [[-8, 1], [-8, 4], [8, 4], [8, 2], [6, 1.5], [1.5, 1.5], [0, 0], [-4, 0]];     // §6.2.4 table: 8L1U 8L4U 8R4U 8R2U 6R1.5U 1.5R1.5U V-V/H-H 4L/H-H
  const zone4 = [[-5.15, -0.86], [5.15, -0.86], [5.15, -1.72], [-5.15, -1.72]];
  const zone1 = [[-9, -1.72], [9, -1.72], [9, -4], [-9, -4]];
  function passing(cls) {
    const B = cls === 'B', T = '§6.2.4 table (p. 18), class ' + cls;
    const rows = [
      { kind: 'point', name: 'B50L', h: -3.43, v: 0.57, max: 350, ref: T, note: 'glare toward an oncoming driver' },
      { kind: 'point', name: 'BR', h: 2.5, v: 1.0, max: 1750, ref: T },
      { kind: 'point', name: '75R', h: 1.15, v: -0.57, min: B ? 10100 : 5100, ref: T },
      { kind: 'point', name: '75L', h: -3.43, v: -0.57, max: 10600, ref: T },
      { kind: 'point', name: '50L', h: -3.43, v: -0.86, max: 13200, ref: T + ' (***)', note: '18,500 cd for LED modules with an electronic light source control gear (footnote ***)' },
      { kind: 'point', name: '50R', h: 1.72, v: -0.86, min: B ? 10100 : 5100, ref: T },
    ];
    if (B) rows.push({ kind: 'point', name: '50V', h: 0, v: -0.86, min: 5100, ref: T });
    rows.push(
      { kind: 'point', name: '25L', h: -9, v: -1.72, min: B ? 1700 : 1250, ref: T },
      { kind: 'point', name: '25R', h: 9, v: -1.72, min: B ? 1700 : 1250, ref: T },
      { kind: 'zone', name: 'Zone III', poly: zone3, max: 625, ref: T, note: 'any point in zone III' },
      { kind: 'zone', name: 'Zone IV', poly: zone4, min: B ? 2500 : 1700, ref: T, note: 'any point, 0.86D–1.72D, 5.15L–5.15R' },
      B ? { kind: 'zone', name: 'Zone I', poly: zone1, maxRel: { ref: '50R', factor: 2 }, ref: T, note: '< 2 × the value actually measured at 50R; 1.72D–4D, 9L–9R' }
        : { kind: 'zone', name: 'Zone I', poly: zone1, max: 17600, ref: T, note: '1.72D–4D, 9L–9R' },
      { kind: 'sum', name: 'Points 1+2+3', pts: [[-8, 4], [0, 4], [8, 4]], min: 190, ref: '§6.2.4 second table (p. 19)' },
      { kind: 'sum', name: 'Points 4+5+6', pts: [[-4, 2], [0, 2], [4, 2]], min: 375, ref: '§6.2.4 second table (p. 19)' },
      { kind: 'point', name: 'Point 7', h: -8, v: 0, min: 65, ref: '§6.2.4 second table (p. 19)' },
      { kind: 'point', name: 'Point 8', h: -4, v: 0, min: 125, ref: '§6.2.4 second table (p. 19)' },
      { kind: 'gradient', name: 'Cut-off sharpness', h: -2.5, v0: -1.5, v1: 0.5, scan: 0.05, dv: 0.1, min: 0.13, max: 0.40, ref: 'Annex 9 §2.2', note: 'G = log E(β) − log E(β + 0.1°), vertical scan through the horizontal part at 2.5° from V-V, 0.05° steps; 0.13 ≤ G ≤ 0.40 (the max at 25 m only)' },
      { kind: 'linearity', name: 'Cut-off linearity', hs: [-1.5, -2.5, -3.5], v0: -1.5, v1: 0.5, scan: 0.05, dv: 0.1, max: 0.2, ref: 'Annex 9 §2.3', note: 'inflection points at 1.5°, 2.5°, 3.5° within 0.2° vertically' });
    return rows;
  }
  function driving(cls) {
    const B = cls === 'B', T = '§6.3.3 table (p. 20), class ' + cls;
    return [
      { kind: 'imax', name: 'Imax', min: B ? 40500 : 27000, max: 215000, ref: T + ' · §6.3.3.2 (≤ 215,000 cd)' },
      { kind: 'point', name: 'HV', h: 0, v: 0, minRel: { ref: 'Imax', factor: 0.8 }, ref: '§6.3.3.1', note: 'HV inside the 80 % isolux of Imax' },
      { kind: 'point', name: 'H-5L', h: -5, v: 0, min: B ? 5100 : 3400, ref: T },
      { kind: 'point', name: 'H-2.5L', h: -2.5, v: 0, min: B ? 20300 : 13500, ref: T },
      { kind: 'point', name: 'H-2.5R', h: 2.5, v: 0, min: B ? 20300 : 13500, ref: T },
      { kind: 'point', name: 'H-5R', h: 5, v: 0, min: B ? 5100 : 3400, ref: T },
    ];
  }
  const PRESETS = {
    'ece-r112-b': Object.assign({ label: 'ECE R112 class B passing beam', source: R112 + ': §6.2.4 tables, Annex 3, Annex 9. Measured at 25 m with a 65 mm photocell (§6.1.2); aimed by the cut-off (Annex 9 §3.1) and re-aimed within 0.5° L / 0.75° R / ±0.25° (§6.2.2.3).', verified: true, items: passing('B') }, R112_MEAS, R112_AIM),
    'ece-r112-a': Object.assign({ label: 'ECE R112 class A passing beam', source: R112 + ': §6.2.4 tables (class A columns), Annex 3, Annex 9.', verified: true, items: passing('A') }, R112_MEAS, R112_AIM),
    'ece-r112-b-drive': Object.assign({ label: 'ECE R112 class B driving beam', source: R112 + ': §6.3.3. A driving-beam-only lamp is aimed with its maximum on HV (§6.3.1).', verified: true, items: driving('B') }, R112_MEAS, { aimMode: 'peak', aimBox: null }),
    'ece-r112-a-drive': Object.assign({ label: 'ECE R112 class A driving beam', source: R112 + ': §6.3.3 (class A). Aimed with its maximum on HV (§6.3.1).', verified: true, items: driving('A') }, R112_MEAS, { aimMode: 'peak', aimBox: null }),
    'hotspot': {
      label: 'Spot beam (not a regulation)', source: 'A made-up flashlight-style spec to experiment with.', verified: true,
      kernel: 0.25, distance: 0, step: 0.1, aimMode: 'design', aimBox: null,
      items: [
        { kind: 'point', name: 'HV', h: 0, v: 0, min: 20000 },
        { kind: 'zone', name: 'Spill ring', min: 500, poly: ring(8, 24) },
        { kind: 'imax', name: 'Peak cap', max: 120000 },
      ],
    },
    blank: { label: 'Blank (add your own)', source: '', verified: true, kernel: 0.2, distance: 0, step: 0.1, aimMode: 'design', aimBox: null, items: [] },
  };
  function ring(r, n) { const out = []; for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; out.push([r * Math.cos(a), r * Math.sin(a)]); } return out; }

  let idSeq = 1;
  const newId = (items) => { const ids = new Set((items || []).map((x) => x.id)); let id; do id = 'c' + idSeq++; while (ids.has(id)); return id; };
  function defaults() {
    return Object.assign({ traffic: 'RHT', conv: 'A', paintCd: 0, paintWeight: 1, usePaint: true, selected: null }, presetState('ece-r112-b'));
  }
  const PRESET_KEYS = ['kernel', 'distance', 'step', 'conv', 'aimMode', 'aimLine', 'aimBox'];
  function presetState(id) {
    const p = PRESETS[id] || PRESETS.blank, items = [];
    for (const it of p.items) items.push(Object.assign({ id: newId(items), on: true, w: 1 }, JSON.parse(JSON.stringify(it))));
    const o = { preset: id, label: p.label, source: p.source, verified: p.verified, items, aimTol: 0 };
    for (const k of PRESET_KEYS) if (p[k] !== undefined) o[k] = p[k] && typeof p[k] === 'object' ? Object.assign({}, p[k]) : p[k];
    if (o.aimLine === undefined) o.aimLine = -0.57;
    return o;
  }
  function applyPreset(md, id) { Object.assign(md, presetState(id)); md.selected = null; return md; }

  // ---------------------------------------------------------------- geometry helpers
  const mirrorH = (md) => md.traffic === 'LHT' ? -1 : 1;
  // the items as they apply (traffic side resolved), enabled ones only unless all
  function itemsOf(md, all) {
    const s = mirrorH(md);
    return (md.items || []).filter((it) => all || it.on !== false).map((it) => {
      const o = Object.assign({}, it);
      if (o.h !== undefined) o.h = s * o.h;
      if (o.poly) o.poly = o.poly.map(([h, v]) => [s * h, v]);
      if (o.pts) o.pts = o.pts.map(([h, v]) => [s * h, v]);
      if (o.hs) o.hs = o.hs.map((h) => s * h);
      return o;
    });
  }
  function inPoly(poly, h, v) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > v) !== (yj > v) && h < (xj - xi) * (v - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  // the H/V window the far-field grid needs: every item plus a margin, never smaller than ±10° × [−5°, +5°]
  function windowOf(md) {
    let h0 = -10, h1 = 10, v0 = -5, v1 = 5;
    for (const it of itemsOf(md, true)) {
      const pts = it.poly || it.pts || (it.kind === 'gradient' ? [[it.h, it.v0], [it.h, it.v1]] : it.kind === 'linearity' ? it.hs.map((h) => [h, it.v0]).concat(it.hs.map((h) => [h, it.v1])) : it.h !== undefined ? [[it.h, it.v]] : []);
      for (const [h, v] of pts) { h0 = Math.min(h0, h - 3); h1 = Math.max(h1, h + 3); v0 = Math.min(v0, v - 2); v1 = Math.max(v1, v + 2); }
    }
    const r = (x, f) => f(x / 5) * 5;
    return [Math.max(-89, r(h0, Math.floor)), Math.min(89, r(h1, Math.ceil)), Math.max(-80, r(v0, Math.floor)), Math.min(80, r(v1, Math.ceil))];
  }
  // far-field grid options for a scene: distance 0 = far field (∞); otherwise a screen at that many mm
  function gridOpts(scene, distanceOverride) {
    const md = scene.modeD, d = distanceOverride !== undefined ? distanceOverride : md.distance;
    return { win: windowOf(md), step: md.step || 0.1, conv: md.conv || 'A', distance: d > 0 ? d : Infinity, centre: scene.source.pos.slice() };
  }
  // (H, V) → design-plane (u, v) mm, as seen from the photometric centre (the source).  null if the plane is behind.
  function planeUV(scene, h, v) {
    const T = RF.Engine.designFrame(scene.target), c = scene.source.pos, d = RF.FarField.dirOf(h, v, scene.modeD.conv);
    const den = V.dot(d, T.n); if (!(Math.abs(den) > 1e-12)) return null;
    const t = V.dot(V.sub(T.C, c), T.n) / den; if (!(t > 0)) return null;
    return RF.Engine.worldToTargetUV(T, V.add(c, V.mul(d, t)));
  }
  // design-plane (u, v) → (H, V)
  function hvAtUV(scene, u, v) { const T = RF.Engine.designFrame(scene.target); return RF.FarField.hvOf(V.sub(RF.Engine.targetUVtoWorld(T, u, v), scene.source.pos), scene.modeD.conv); }

  // ---------------------------------------------------------------- judging
  const sure = (val, sd, bound, isMin) => {
    if (!isFinite(val)) return 'unsure';
    if (isMin) return val - 2 * sd >= bound ? 'pass' : val + 2 * sd < bound ? 'fail' : 'unsure';
    return val + 2 * sd <= bound ? 'pass' : val - 2 * sd > bound ? 'fail' : 'unsure';
  };
  const marginOf = (val, bound, isMin) => {
    if (!(bound > 0)) return 0;
    if (isMin) return val > 0 ? Math.log10(val / bound) : -3;
    return val > 0 ? Math.log10(bound / val) : 3;
  };
  // the extreme (max or min) of n independent noisy readings strays ≈ σ √(2 ln n) from the truth by chance alone, so a
  // zone's FAIL must clear that too (a pass needs no correction: if the extreme passes, every reading does)
  const sureX = (val, sd, bound, isMin, ze) => {
    if (!isFinite(val)) return 'unsure';
    if (isMin) return val - 2 * sd >= bound ? 'pass' : val + (2 + ze) * sd < bound ? 'fail' : 'unsure';
    return val + 2 * sd <= bound ? 'pass' : val - (2 + ze) * sd > bound ? 'fail' : 'unsure';
  };
  const softOf = (m) => Math.max(0, Math.min(1, 1 + m / LOG2));     // 1 when met, 0 at a factor of 2 off
  // bin centres inside a zone polygon (unshifted), at the grid's resolution — at most ~4000 (coarsened if bigger)
  function zoneSamples(G, poly) {
    let hs = Infinity, he = -Infinity, vs = Infinity, ve = -Infinity;
    for (const [h, v] of poly) { hs = Math.min(hs, h); he = Math.max(he, h); vs = Math.min(vs, v); ve = Math.max(ve, v); }
    let st = G.step; while (((he - hs) / st) * ((ve - vs) / st) > 4000) st *= 2;
    const out = [];
    for (let v = vs + st / 2; v < ve; v += st) for (let h = hs + st / 2; h < he; h += st) if (inPoly(poly, h, v)) out.push([h, v]);
    if (!out.length) out.push([(hs + he) / 2, (vs + ve) / 2]);
    out.st = st;
    return out;
  }
  // steepest descent of log I on a vertical scan at h (sampling offset dh, dv): the inflection of the cut-off
  // (Annex 9: G = log E(β) − log E(β + dv), the inflection where d²(log E)/dβ² = 0 — taken as where G peaks).
  // A wide horizontal kernel (kh, default ±0.25°) against noise: the horizontal part is flat by definition (§2.3).
  function scanCut(G, h, v0, v1, scan, dvd, kh, dh, dv) {
    const kv = Math.max(G.step / 2, 0.035) * 0.99;            // Annex 9: ~30 mm detector at 25 m ≈ 0.07° across
    let best = null;
    for (let v = v0; v + dvd <= v1 + 1e-9; v += scan) {
      const a = RF.FarField.intensityAt(G, h + dh, v + dv, kh, kv), b = RF.FarField.intensityAt(G, h + dh, v + dvd + dv, kh, kv);
      if (!(a.cd > 0 && b.cd > 0)) continue;
      const g = Math.log10(a.cd / b.cd), sg = Math.hypot(a.sd / a.cd, b.sd / b.cd) / Math.LN10;
      if (!best || g > best.g) best = { g, sg, v: v + dvd / 2 };
    }
    return best;
  }
  /* evaluate one constraint at sampling offset (dh, dv) — reading the beam at (h + dh, v + dv) is the lamp re-aimed by
   * (−dh, −dv).  Returns rows { value, sd, at: [h, v], bound, isMin, margin, verdict, soft } (zones/min: the dimmest
   * sample; zones/max and imax: the brightest; sum: Σ of its points; gradient: the steepest step; linearity: the spread of
   * the inflection points).  A relative bound (minRel / maxRel: factor × another item's value, e.g. Zone I < 2 × 50R)
   * folds the reference's noise into the verdict.                                                                  */
  function evalItem(G, it, k, dh, dv, cache, refOf) {
    const I = (h, v, kh, kv) => RF.FarField.intensityAt(G, h + dh, v + dv, kh === undefined ? k : kh, kv);
    const res = [];
    const judge = (value, sd, at, bound, isMin, extra) => Object.assign({ value, sd, at, bound, isMin, margin: marginOf(value, bound, isMin), verdict: sure(value, sd, bound, isMin), soft: softOf(marginOf(value, bound, isMin)) }, extra || {});
    // a relative bound: bound = f × ref; the verdict uses σ of (value − bound)
    const judgeRel = (value, sd, at, rel, isMin) => {
      const r = refOf(rel.ref); if (!r || !isFinite(r.cd)) return judge(NaN, NaN, at, NaN, isMin, { rel });
      const bound = rel.factor * r.cd, s2 = Math.hypot(sd, rel.factor * r.sd), diff = isMin ? value - bound : bound - value;
      const verdict = !isFinite(value) ? 'unsure' : diff - 2 * s2 >= 0 ? 'pass' : diff + 2 * s2 < 0 ? 'fail' : 'unsure';
      return { value, sd: s2, at, bound, isMin, rel, margin: marginOf(value, bound, isMin), verdict, soft: softOf(marginOf(value, bound, isMin)) };
    };
    const both = (value, sd, at) => {                         // absolute and relative bounds of a value-type item
      if (it.min > 0) res.push(judge(value, sd, at, it.min, true));
      if (it.max > 0) res.push(judge(value, sd, at, it.max, false));
      if (it.minRel) res.push(judgeRel(value, sd, at, it.minRel, true));
      if (it.maxRel) res.push(judgeRel(value, sd, at, it.maxRel, false));
    };
    if (it.kind === 'point') {
      const r = I(it.h, it.v); both(r.cd, r.sd, [it.h, it.v]);
    } else if (it.kind === 'sum') {
      let e = 0, s2 = 0; for (const [h, v] of it.pts) { const r = I(h, v); e += r.cd; s2 += r.sd * r.sd; }
      both(e, Math.sqrt(s2), it.pts[0]);
    } else if (it.kind === 'zone') {
      const S = cache.get(it.id + ':z') || (cache.set(it.id + ':z', zoneSamples(G, it.poly)), cache.get(it.id + ':z'));
      let lo = null, hi = null;
      for (const [h, v] of S) {
        const r = I(h, v); if (!isFinite(r.cd)) continue;
        if (!lo || r.cd < lo.cd) lo = { cd: r.cd, sd: r.sd, at: [h, v] };
        if (!hi || r.cd > hi.cd) hi = { cd: r.cd, sd: r.sd, at: [h, v] };
      }
      const L = lo || { cd: NaN, sd: NaN, at: null }, H = hi || { cd: NaN, sd: NaN, at: null };
      // independent readings in the zone ≈ its samples × (sample spacing / kernel width)²
      const nInd = Math.max(1, S.length * Math.min(1, (S.st / (2 * k)) ** 2)), ze = Math.sqrt(2 * Math.log(nInd));
      const fix = (row) => { if (isFinite(row.value) && isFinite(row.bound)) { row.verdict = sureX(row.value, row.sd, row.bound, row.isMin, ze); row.extreme = ze; } return row; };
      if (it.min > 0) res.push(fix(judge(L.cd, L.sd, L.at, it.min, true)));
      if (it.minRel) res.push(fix(judgeRel(L.cd, L.sd, L.at, it.minRel, true)));
      if (it.max > 0) res.push(fix(judge(H.cd, H.sd, H.at, it.max, false)));
      if (it.maxRel) res.push(fix(judgeRel(H.cd, H.sd, H.at, it.maxRel, false)));
    } else if (it.kind === 'gradient') {
      const b = scanCut(G, it.h, it.v0, it.v1, it.scan || 0.05, it.dv || 0.1, it.kh || 0.25, dh, dv);
      const value = b ? b.g : NaN, sd = b ? b.sg : NaN, at = b ? [it.h, b.v] : null;
      const lg = { unit: 'log' };
      if (it.min > 0) res.push(Object.assign(judge(value, sd, at, it.min, true), lg));
      if (it.max > 0) res.push(Object.assign(judge(value, sd, at, it.max, false), lg));
    } else if (it.kind === 'linearity') {
      const vs = it.hs.map((h) => scanCut(G, h, it.v0, it.v1, it.scan || 0.05, it.dv || 0.1, it.kh || 0.25, dh, dv));
      const ok = vs.every(Boolean), vv = ok ? vs.map((b) => b.v) : [];
      const spread = ok ? Math.max(...vv) - Math.min(...vv) : NaN, sd = (it.scan || 0.05) / 2;   // the scan step limits it, not shot noise
      // margin for a spread allowed to be 0: linear, in units of the limit (1 decade ≈ the whole limit)
      const r = judge(spread, sd, ok ? [it.hs[1] !== undefined ? it.hs[1] : it.hs[0], vv[1] !== undefined ? vv[1] : vv[0]] : null, it.max, false, { unit: 'deg' });
      r.margin = ok ? (it.max - spread) / Math.max(1e-9, it.max) : -1; r.soft = softOf(r.margin);
      res.push(r);
    } else if (it.kind === 'imax') {
      const M = cache.get('map:' + k) || (cache.set('map:' + k, RF.FarField.map(G, k)), cache.get('map:' + k));
      let m = -1; for (let q = 0; q < M.cd.length; q++) if (M.cd[q] > (m < 0 ? -1 : M.cd[m])) m = q;
      const at = m >= 0 ? RF.FarField.binCentre(G, m % G.nh, Math.floor(m / G.nh)) : null;
      both(m >= 0 ? M.cd[m] : NaN, m >= 0 ? M.sd[m] : NaN, at);
    }
    return res;
  }
  function evalAt(G, items, k, dh, dv, cache) {
    // references for relative bounds: a point item by name (read at this aim), or 'Imax' (the map's maximum)
    const refOf = (name) => {
      if (name === 'Imax') {
        const M = cache.get('map:' + k) || (cache.set('map:' + k, RF.FarField.map(G, k)), cache.get('map:' + k));
        let m = -1; for (let q = 0; q < M.cd.length; q++) if (M.cd[q] > (m < 0 ? -1 : M.cd[m])) m = q;
        return m >= 0 ? { cd: M.cd[m], sd: M.sd[m] } : null;
      }
      const it = items.find((x) => x.name === name && x.kind === 'point'); if (!it) return null;
      return RF.FarField.intensityAt(G, it.h + dh, it.v + dv, k);
    };
    const rows = [];
    for (const it of items) for (const r of evalItem(G, it, k, dh, dv, cache, refOf)) rows.push(Object.assign(r, { id: it.id, name: it.name, kind: it.kind, w: it.w > 0 ? it.w : 1 }));
    let sw = 0, ss = 0, worst = Infinity; const n = { pass: 0, fail: 0, unsure: 0 };
    for (const r of rows) { sw += r.w; ss += r.w * r.soft; n[r.verdict]++; if (r.margin < worst) worst = r.margin; }
    return { rows, score: sw > 0 ? ss / sw : 1, worst: rows.length ? worst : 0, n, shift: [dh, dv] };
  }
  /* How the lamp is aimed before it is judged (as a sampling offset [dh, dv]):
   *   'design' — as built.   'peak' — maximum on HV (§6.3.1, a driving-beam-only lamp).
   *   'cutoff' — instrumental vertical aim (Annex 9 §3.1): the inflection of a vertical scan through the horizontal
   *              part of the cut-off at 2.5° from V-V goes on line B (aimLine, 0.57° D).  Horizontal: as designed.  */
  function aimOf(G, md, items, k, cache) {
    const mode = md.aimMode || 'design';
    if (mode === 'peak') {
      const M = cache.get('map:' + k) || (cache.set('map:' + k, RF.FarField.map(G, k)), cache.get('map:' + k));
      let m = -1; for (let q = 0; q < M.cd.length; q++) if (M.cd[q] > (m < 0 ? -1 : M.cd[m])) m = q;
      if (m < 0) return { base: [0, 0], note: 'no light to aim by' };
      const c = RF.FarField.binCentre(G, m % G.nh, Math.floor(m / G.nh));
      return { base: [c[0], c[1]], note: 'maximum (' + c[0].toFixed(2) + '°, ' + c[1].toFixed(2) + '°) put on HV' };
    }
    if (mode === 'cutoff') {
      const g = items.find((x) => x.kind === 'gradient'), h = g ? g.h : -2.5 * mirrorH(md), line = md.aimLine === undefined ? -0.57 : md.aimLine;
      // search the beam as built, widely: the lamp may be far off the line before aiming
      const b = scanCut(G, h, Math.max(G.v0 + 0.2, -6), Math.min(G.v1 - 0.2, 4), 0.05, 0.1, (g && g.kh) || 0.25, 0, 0);
      if (!b) return { base: [0, 0], note: 'no cut-off found at ' + Math.abs(h) + '° to aim by: judged as designed' };
      return { base: [0, +(b.v - line).toFixed(4)], note: 'cut-off inflection at ' + b.v.toFixed(2) + '° put on ' + Math.abs(line) + '° D', cutV: b.v };
    }
    return { base: [0, 0], note: 'as designed' };
  }
  /* Judge a far-field grid against the spec.  → { rows, score (0–1), worst margin (decades), n: {pass, fail, unsure},
   * verdict: 'pass'|'fail'|'unsure'|'empty', aim (how it was aimed), shift: total sampling offset, reaim: the part from
   * the re-aim box, atAim (before re-aiming), moreRays (what would settle the unsure rows) }.
   * Re-aim box (aimBox, beam displacement for right-hand traffic: left / right / up / down degrees; §6.2.2.3 gives
   * 0.5 / 0.75 / 0.25 / 0.25) or, for older scenes, a symmetric aimTol.  Best = worst margin, then score, then the
   * smallest move.                                                                                                     */
  function evaluate(G, md) {
    const items = itemsOf(md), k = md.kernel > 0 ? md.kernel : 0.15, cache = new Map();
    const aim = aimOf(G, md, items, k, cache), [bh, bv] = aim.base;
    const atAim = evalAt(G, items, k, bh, bv, cache);
    let best = atAim, reaim = [0, 0];
    let box = md.aimBox ? Object.assign({}, md.aimBox) : md.aimTol > 0 ? { left: md.aimTol, right: md.aimTol, up: md.aimTol, down: md.aimTol } : null;
    if (box && md.traffic === 'LHT') box = { left: box.right, right: box.left, up: box.up, down: box.down };
    if (box && items.length && (box.left || box.right || box.up || box.down)) {
      const st = Math.max(G.step, md.aimStep || 0.05);
      // beam moved right by x ⇔ sampling offset −x: dh ∈ [−right, +left], dv ∈ [−up, +down]
      for (let dv = -(box.up || 0); dv <= (box.down || 0) + 1e-9; dv += st) for (let dh = -(box.right || 0); dh <= (box.left || 0) + 1e-9; dh += st) {
        const ddh = +dh.toFixed(6) || 0, ddv = +dv.toFixed(6) || 0; if (!ddh && !ddv) continue;
        const r = evalAt(G, items, k, bh + ddh, bv + ddv, cache);
        const tieW = Math.abs(r.worst - best.worst) <= 1e-12, tieS = Math.abs(r.score - best.score) <= 1e-12;
        if (r.worst > best.worst + 1e-12 || (tieW && r.score > best.score + 1e-12) || (tieW && tieS && Math.hypot(ddh, ddv) < Math.hypot(reaim[0], reaim[1]) - 1e-9)) { best = r; reaim = [ddh, ddv]; }
      }
    }
    const out = Object.assign({}, best, { aim, reaim, atAim, atZero: atAim, kernel: k, distance: G.distance, conv: G.conv, rays: G.rays });
    out.verdict = !best.rows.length ? 'empty' : best.n.fail ? 'fail' : best.n.unsure ? 'unsure' : 'pass';
    // how many times more rays would turn each unsure row into a decided one (σ ∝ 1/√N): (2σ / |value − bound|)²
    let need = 1;
    for (const r of best.rows) if (r.verdict === 'unsure' && isFinite(r.value) && r.sd > 0 && r.unit !== 'deg') { const gap = Math.abs(r.value - r.bound); need = Math.max(need, gap > 0 ? (2 * r.sd / gap) ** 2 : 100); }
    out.moreRays = best.n.unsure ? Math.min(1000, need) : 1;
    return out;
  }

  // ---------------------------------------------------------------- feasibility (no trace needed)
  // Brightness theorem per direction: a passive mirror can't make the LED brighter, only bigger, so toward u the
  // envelope can add at most R · L · A⊥(u) cd (its silhouette), plus the LED's own direct intensity.  Upper bounds:
  // a min above it can't be met by ANY design in this envelope.  Flux: Σ over min-zones of min × Ω ≤ what the
  // LED emits (× R for reflected light).
  function feasibility(scene) {
    const md = scene.modeD, src = scene.source, out = [];
    if (!(src.power > 0)) return out;
    const fr = RF.Source.frame(src), L = RF.Photometry.luminance(src, fr.a), R = scene.modeA.reflectivity || 0.9;
    const items = itemsOf(md);
    for (const it of items) {
      if (it.kind !== 'point' || !(it.min > 0)) continue;
      const u = RF.FarField.dirOf(it.h, it.v, md.conv);
      const env = isFinite(L) ? R * L * RF.Photometry.boxProj(scene.envelope.half, u) : Infinity;
      const c = Math.max(-1, Math.min(1, V.dot(u, fr.a)));
      const direct = src.power * RF.Source.intensity(src, Math.acos(c)) / RF.Source.totalIntegral(src);
      const ceil = env + (isFinite(direct) ? direct : 0);
      out.push({ id: it.id, name: it.name, need: it.min, ceiling: ceil, ok: it.min <= ceil });
    }
    let lm = 0; const parts = [];
    for (const it of items) {
      if (it.kind !== 'zone' || !(it.min > 0)) continue;
      let om = 0; const st = 0.1;
      let hs = Infinity, he = -Infinity, vs = Infinity, ve = -Infinity;
      for (const [h, v] of it.poly) { hs = Math.min(hs, h); he = Math.max(he, h); vs = Math.min(vs, v); ve = Math.max(ve, v); }
      for (let v = vs; v < ve; v += st) for (let h = hs; h < he; h += st) if (inPoly(it.poly, h + st / 2, v + st / 2)) om += RF.FarField.binOmega(h, h + st, v, v + st, md.conv);
      lm += it.min * om; parts.push(it.name);
    }
    if (parts.length) out.push({ kind: 'flux', names: parts, need: lm, ceiling: src.power, ok: lm <= src.power });
    return out;
  }

  // ---------------------------------------------------------------- asking a solver
  // The relative illuminance target on the design plane (paint grid) for this spec + painting.
  //   floor(H, V)   = the largest min of any point (within `rad` of it) or min-zone covering the cell
  //   ceiling(H, V) = the smallest max of any point (within `rad`) or max-zone covering it
  //   shape(H, V)   = painting × paintCd (paintCd 0 = auto: the largest min in the spec, or 10,000 cd)
  //   I* = min(ceiling, max(floor, paintWeight × shape))   then E ∝ I* cos³θ (flat plane), normalised to 1.
  function workingPaint(scene) {
    const md = scene.modeD, res = scene.target.res, T = RF.Engine.designFrame(scene.target), c = scene.source.pos;
    const items = itemsOf(md), paint = scene.modeA.paint, out = new Array(res * res).fill(0);
    let auto = 0; for (const it of items) if (it.min > 0 && it.kind !== 'gradient' && it.kind !== 'linearity' && it.kind !== 'imax' && it.kind !== 'sum') auto = Math.max(auto, it.min);
    const pcd = md.paintCd > 0 ? md.paintCd : auto || 10000, w = md.usePaint === false ? 0 : (md.paintWeight === undefined ? 1 : md.paintWeight);
    const cellDeg = Math.atan(2 * T.half / res / Math.max(1e-9, V.dist(T.C, c))) * 180 / Math.PI, rad = Math.max(0.5, 1.5 * cellDeg);
    let mx = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const [u, v] = RF.Engine.cellCenter(T, i, j), wpt = RF.Engine.targetUVtoWorld(T, u, v), d = V.sub(wpt, c), [h, vv] = RF.FarField.hvOf(d, md.conv);
      let lo = 0, hi = Infinity;
      for (const it of items) {
        let covers = false;
        let mn = it.min, mx = it.max;
        if (it.kind === 'point') covers = Math.hypot(h - it.h, vv - it.v) <= rad;
        else if (it.kind === 'zone') covers = inPoly(it.poly, h, vv);
        else if (it.kind === 'sum') { covers = it.pts.some(([ph, pv]) => Math.hypot(h - ph, vv - pv) <= rad); mn = it.min > 0 ? it.min / it.pts.length : 0; }
        if (!covers) continue;
        if (it.maxRel) { const r = items.find((x) => x.name === it.maxRel.ref); if (r && r.min > 0) mx = Math.min(mx > 0 ? mx : Infinity, it.maxRel.factor * r.min); }   // e.g. Zone I < 2 × 50R: cap at 2 × 50R's minimum
        if (mn > 0) lo = Math.max(lo, mn);
        if (mx > 0) hi = Math.min(hi, mx);
      }
      const k = j * res + i, I = Math.min(hi, Math.max(lo, w * (paint[k] || 0) * pcd));
      const cosT = Math.abs(V.dot(V.norm(d), T.n)), L = V.len(d);
      const E = I * cosT / (L * L);                       // E = I cos θ / r²
      out[k] = E; if (E > mx) mx = E;
    }
    if (mx > 0) for (let k = 0; k < out.length; k++) out[k] = +(out[k] / mx).toFixed(5);
    return out;
  }
  // A plausible low-beam painting in (H, V), drawn onto the paint grid: a flat cut-off at 0.57° down on the oncoming
  // side, a 15° rise on the own side, a hot zone under the elbow, a wide foreground spread.  A starting shape to edit.
  function seedPaint(scene) {
    const md = scene.modeD, res = scene.target.res, T = RF.Engine.designFrame(scene.target), s = mirrorH(md), out = new Array(res * res).fill(0);
    const t15 = Math.tan(15 * Math.PI / 180);
    let mx = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const [u, v] = RF.Engine.cellCenter(T, i, j), [h0, vv] = hvAtUV(scene, u, v), h = s * h0;
      const cut = h <= 0 ? -0.57 : Math.min(-0.57 + h * t15, 1.0);
      if (!(vv <= cut) || vv < -10 || Math.abs(h) > 40) continue;
      const hot = Math.exp(-(((h - 1.5) / 4) ** 2) - (((vv + 1.2) / 0.9) ** 2));
      const wide = Math.exp(-((h / 20) ** 2)) * Math.exp(-(((vv + 1.5) / 2.5) ** 2));
      const I = 0.8 * hot + 0.35 * wide;
      out[j * res + i] = I; if (I > mx) mx = I;
    }
    if (mx > 0) for (let k = 0; k < out.length; k++) out[k] = +(Math.min(1, out[k] / mx)).toFixed(4);
    return out;
  }
  // target size that shows the whole spec window at the current distance (square plane, centred on the axis)
  function fitTargetSize(scene) {
    const win = windowOf(scene.modeD), D = scene.target.distance;
    const ext = Math.max(Math.abs(win[0]), Math.abs(win[1]), Math.abs(win[2]), Math.abs(win[3]));
    return 2 * D * Math.tan(Math.min(80, ext) * Math.PI / 180);
  }

  RF.Spec = { PRESETS, defaults, applyPreset, presetState, newId, itemsOf, inPoly, windowOf, gridOpts, planeUV, hvAtUV, evaluate, feasibility, workingPaint, seedPaint, fitTargetSize };
})(typeof globalThis !== 'undefined' ? globalThis : this);
