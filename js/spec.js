/* spec.js — RF.Spec: Spec mode (mode D).  A beam specification in the style of the automotive headlamp regulations:
 * test points and zones in (H, V) degrees with minimum and/or maximum intensities (cd), a cut-off sharpness scan, and a
 * global intensity cap — plus, optionally, a painted target as a secondary goal.  Pure functions on plain data.
 *
 * Two halves:
 *   1. JUDGING a trace: evaluate(G, md) reads a far-field grid (js/farfield.js) and reports, per constraint, the value,
 *      its shot noise, a margin in decades, a soft score, and a hard verdict that respects the noise:
 *        pass   — met even at value ∓ 2σ          fail — missed even at value ± 2σ        unsure — decided by noise
 *      An aim tolerance (as the regulations allow re-aiming) searches small (ΔH, ΔV) shifts and keeps the best.
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
  // ⚠ Values below are TRANSCRIBED FROM MEMORY, not from the regulation text (the session that wrote this could not
  // reach UNECE / EUR-Lex).  Every row is marked verified: false until checked; SPEC-MODE.md has the checklist.
  const ECE_NOTE = 'UN R112 class B passing beam (right-hand traffic), transcribed from memory — NOT verified against the regulation text. Check every value before trusting a pass.';
  const PRESETS = {
    'ece-r112-b': {
      label: 'ECE R112 class B low beam (unverified)', source: ECE_NOTE, verified: false,
      kernel: 0.15, aimTol: 0,
      items: [
        { kind: 'point', name: 'B50L', h: -3.43, v: 0.57, max: 350, note: 'glare point for an oncoming driver at 50 m' },
        { kind: 'point', name: '75R', h: 1.15, v: -0.57, min: 10100, note: 'own-side reach at 75 m' },
        { kind: 'point', name: '75L', h: -3.43, v: -0.57, max: 10600 },
        { kind: 'point', name: '50L', h: -3.43, v: -0.86, max: 13200 },
        { kind: 'point', name: '50R', h: 1.72, v: -0.86, min: 10100 },
        { kind: 'point', name: '50V', h: 0, v: -0.86, min: 5100 },
        { kind: 'point', name: '25L', h: -9, v: -1.72, min: 1700 },
        { kind: 'point', name: '25R', h: 9, v: -1.72, min: 1700 },
        { kind: 'zone', name: 'Zone III', max: 625, poly: [[-8, 1], [-8, 4], [8, 4], [8, 2], [6, 1.5], [1.5, 1], [0, 0.57], [-3.43, 0.57]], note: 'glare zone above the cut-off; polygon approximate' },
        { kind: 'zone', name: 'Zone IV', min: 2500, poly: [[-5.15, -0.86], [5.15, -0.86], [5.15, -1.72], [-5.15, -1.72]], note: 'foreground band' },
        { kind: 'gradient', name: 'Cut-off sharpness', h: -2.5, v0: -1.5, v1: 0.5, dv: 0.1, min: 0.13, note: 'max of log₁₀ I(V) − log₁₀ I(V + 0.1°) on a vertical scan' },
      ],
    },
    'hotspot': {
      label: 'Spot beam (not a regulation)', source: 'A made-up flashlight-style spec to experiment with.', verified: true,
      kernel: 0.25, aimTol: 0,
      items: [
        { kind: 'point', name: 'HV', h: 0, v: 0, min: 20000 },
        { kind: 'zone', name: 'Spill ring', min: 500, poly: ring(8, 24) },
        { kind: 'imax', name: 'Peak cap', max: 120000 },
      ],
    },
    blank: { label: 'Blank (add your own)', source: '', verified: true, kernel: 0.2, aimTol: 0, items: [] },
  };
  function ring(r, n) { const out = []; for (let k = 0; k < n; k++) { const a = 2 * Math.PI * k / n; out.push([r * Math.cos(a), r * Math.sin(a)]); } return out; }

  let idSeq = 1;
  const newId = (items) => { const ids = new Set((items || []).map((x) => x.id)); let id; do id = 'c' + idSeq++; while (ids.has(id)); return id; };
  function defaults() {
    return Object.assign({ preset: 'ece-r112-b', traffic: 'RHT', conv: 'A', step: 0.1, distance: 0, paintCd: 0, paintWeight: 1, usePaint: true, selected: null }, presetState('ece-r112-b'));
  }
  function presetState(id) {
    const p = PRESETS[id] || PRESETS.blank, items = [];
    for (const it of p.items) items.push(Object.assign({ id: newId(items), on: true, w: 1 }, JSON.parse(JSON.stringify(it))));
    return { preset: id, label: p.label, source: p.source, verified: p.verified, kernel: p.kernel, aimTol: p.aimTol, items };
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
      const pts = it.poly || (it.kind === 'gradient' ? [[it.h, it.v0], [it.h, it.v1]] : it.h !== undefined ? [[it.h, it.v]] : []);
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
  const softOf = (m) => Math.max(0, Math.min(1, 1 + m / LOG2));     // 1 when met, 0 at a factor of 2 off
  // bin centres inside a zone polygon (unshifted), at the grid's resolution — at most ~4000 (coarsened if bigger)
  function zoneSamples(G, poly) {
    let hs = Infinity, he = -Infinity, vs = Infinity, ve = -Infinity;
    for (const [h, v] of poly) { hs = Math.min(hs, h); he = Math.max(he, h); vs = Math.min(vs, v); ve = Math.max(ve, v); }
    let st = G.step; while (((he - hs) / st) * ((ve - vs) / st) > 4000) st *= 2;
    const out = [];
    for (let v = vs + st / 2; v < ve; v += st) for (let h = hs + st / 2; h < he; h += st) if (inPoly(poly, h, v)) out.push([h, v]);
    if (!out.length) out.push([(hs + he) / 2, (vs + ve) / 2]);
    return out;
  }
  /* evaluate one constraint at aim shift (dh, dv).  Returns { value, sd, at: [h, v], bound, isMin, margin, verdict, soft }
   * (zones/min: their dimmest sample; zones/max and imax: their brightest; gradient: the steepest step of the scan).  */
  function evalItem(G, it, k, dh, dv, cache) {
    const I = (h, v, kh, kv) => RF.FarField.intensityAt(G, h + dh, v + dv, kh === undefined ? k : kh, kv);
    const res = [];
    const judge = (value, sd, at, bound, isMin) => ({ value, sd, at, bound, isMin, margin: marginOf(value, bound, isMin), verdict: sure(value, sd, bound, isMin), soft: softOf(marginOf(value, bound, isMin)) });
    if (it.kind === 'point') {
      const r = I(it.h, it.v);
      if (it.min > 0) res.push(judge(r.cd, r.sd, [it.h, it.v], it.min, true));
      if (it.max > 0) res.push(judge(r.cd, r.sd, [it.h, it.v], it.max, false));
    } else if (it.kind === 'zone') {
      const S = cache.get(it) || (cache.set(it, zoneSamples(G, it.poly)), cache.get(it));
      let lo = null, hi = null;
      for (const [h, v] of S) {
        const r = I(h, v); if (!isFinite(r.cd)) continue;
        if (!lo || r.cd < lo.cd) lo = { cd: r.cd, sd: r.sd, at: [h, v] };
        if (!hi || r.cd > hi.cd) hi = { cd: r.cd, sd: r.sd, at: [h, v] };
      }
      if (it.min > 0) res.push(lo ? judge(lo.cd, lo.sd, lo.at, it.min, true) : judge(NaN, NaN, null, it.min, true));
      if (it.max > 0) res.push(hi ? judge(hi.cd, hi.sd, hi.at, it.max, false) : judge(NaN, NaN, null, it.max, false));
    } else if (it.kind === 'gradient') {
      // a wide (±0.5° H), thin (one-bin V) kernel: the scan wants vertical resolution, not horizontal
      const dvs = it.dv || 0.1, kv = Math.max(G.step / 2, dvs / 2) * 0.99;
      let best = null;
      for (let v = it.v0; v + dvs <= it.v1 + 1e-9; v += dvs) {
        const a = I(it.h, v, 0.5, kv), b = I(it.h, v + dvs, 0.5, kv);
        if (!(a.cd > 0 && b.cd > 0)) continue;
        const g = Math.log10(a.cd / b.cd), sg = Math.hypot(a.sd / a.cd, b.sd / b.cd) / Math.LN10;
        if (!best || g > best.g) best = { g, sg, at: [it.h, v + dvs / 2] };
      }
      const value = best ? best.g : NaN, sd = best ? best.sg : NaN;
      res.push({ value, sd, at: best ? best.at : null, bound: it.min, isMin: true, margin: best && best.g > 0 ? Math.log10(best.g / it.min) : -1, verdict: sure(value, sd, it.min, true), soft: softOf(best && best.g > 0 ? Math.log10(best.g / it.min) : -1), unit: 'log' });
    } else if (it.kind === 'imax') {
      const M = cache.get('map:' + k) || (cache.set('map:' + k, RF.FarField.map(G, k)), cache.get('map:' + k));
      let m = -1; for (let q = 0; q < M.cd.length; q++) if (M.cd[q] > (m < 0 ? -1 : M.cd[m])) m = q;
      const at = m >= 0 ? RF.FarField.binCentre(G, m % G.nh, Math.floor(m / G.nh)) : null;
      if (it.max > 0) res.push(m >= 0 ? judge(M.cd[m], M.sd[m], at, it.max, false) : judge(NaN, NaN, null, it.max, false));
      if (it.min > 0) res.push(m >= 0 ? judge(M.cd[m], M.sd[m], at, it.min, true) : judge(NaN, NaN, null, it.min, true));
    }
    return res;
  }
  function evalAt(G, items, k, dh, dv, cache) {
    const rows = [];
    for (const it of items) for (const r of evalItem(G, it, k, dh, dv, cache)) rows.push(Object.assign(r, { id: it.id, name: it.name, kind: it.kind, w: it.w > 0 ? it.w : 1 }));
    let sw = 0, ss = 0, worst = Infinity; const n = { pass: 0, fail: 0, unsure: 0 };
    for (const r of rows) { sw += r.w; ss += r.w * r.soft; n[r.verdict]++; if (r.margin < worst) worst = r.margin; }
    return { rows, score: sw > 0 ? ss / sw : 1, worst: rows.length ? worst : 0, n, shift: [dh, dv] };
  }
  /* Judge a far-field grid against the spec.  → { rows, score (0–1), worst margin (decades), n: {pass, fail, unsure},
   * verdict: 'pass'|'fail'|'unsure'|'empty', shift: [ΔH, ΔV] chosen within the aim tolerance, atZero (unshifted),
   * hint (what would decide the unsure rows) }.                                                               */
  function evaluate(G, md) {
    const items = itemsOf(md), k = md.kernel > 0 ? md.kernel : 0.15, cache = new Map();
    const zero = evalAt(G, items, k, 0, 0, cache);
    let best = zero;
    const tol = Math.max(0, md.aimTol || 0);
    if (tol > 0 && items.length) {
      const st = Math.max(G.step, md.aimStep || 0.1);
      for (let dv = -tol; dv <= tol + 1e-9; dv += st) for (let dh = -tol; dh <= tol + 1e-9; dh += st) {
        if (Math.abs(dh) < 1e-9 && Math.abs(dv) < 1e-9) continue;
        const r = evalAt(G, items, k, +dh.toFixed(6) || 0, +dv.toFixed(6) || 0, cache);
        // best worst margin; then best score; then the smallest re-aim (a tie never moves the lamp further than it must)
        const tieW = Math.abs(r.worst - best.worst) <= 1e-12, tieS = Math.abs(r.score - best.score) <= 1e-12;
        if (r.worst > best.worst + 1e-12 || (tieW && r.score > best.score + 1e-12) || (tieW && tieS && Math.hypot(dh, dv) < Math.hypot(best.shift[0], best.shift[1]) - 1e-9)) best = r;
      }
    }
    const out = Object.assign({}, best, { atZero: zero, kernel: k, distance: G.distance, conv: G.conv, rays: G.rays });
    out.verdict = !best.rows.length ? 'empty' : best.n.fail ? 'fail' : best.n.unsure ? 'unsure' : 'pass';
    // how many times more rays would turn each unsure row into a decided one (σ ∝ 1/√N): (2σ / |value − bound|)²
    let need = 1;
    for (const r of best.rows) if (r.verdict === 'unsure' && isFinite(r.value) && r.sd > 0) { const gap = Math.abs(r.value - r.bound); need = Math.max(need, gap > 0 ? (2 * r.sd / gap) ** 2 : 100); }
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
    let auto = 0; for (const it of items) if (it.min > 0 && it.kind !== 'gradient') auto = Math.max(auto, it.min);
    const pcd = md.paintCd > 0 ? md.paintCd : auto || 10000, w = md.usePaint === false ? 0 : (md.paintWeight === undefined ? 1 : md.paintWeight);
    const cellDeg = Math.atan(2 * T.half / res / Math.max(1e-9, V.dist(T.C, c))) * 180 / Math.PI, rad = Math.max(0.5, 1.5 * cellDeg);
    let mx = 0;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const [u, v] = RF.Engine.cellCenter(T, i, j), wpt = RF.Engine.targetUVtoWorld(T, u, v), d = V.sub(wpt, c), [h, vv] = RF.FarField.hvOf(d, md.conv);
      let lo = 0, hi = Infinity;
      for (const it of items) {
        let covers = false;
        if (it.kind === 'point') covers = Math.hypot(h - it.h, vv - it.v) <= rad;
        else if (it.kind === 'zone') covers = inPoly(it.poly, h, vv);
        if (!covers) continue;
        if (it.min > 0) lo = Math.max(lo, it.min);
        if (it.max > 0) hi = Math.min(hi, it.max);
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
