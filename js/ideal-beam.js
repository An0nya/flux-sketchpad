/* ideal-beam.js — RF.IdealBeam: "what a good low beam looks like", as goals beside the regulation, never part of its verdict.
 * The legal rows say what a beam may and must do at a few points; between them a solver can do anything cheap (peaks,
 * gaps, a foreground flood). These goals describe the shape in between, from a few knobs (md.ideal), all RELATIVE to the
 * beam's own centre peak (so a 700 lm lamp and a 1,500 lm lamp can both meet them) except the road distances.
 *
 * Read like beam-quality.js: I(h, v) through RF.Road.beamOf (judged aim, own side = +h, v = 0 = horizon after aiming).
 *
 *   hotTop     the hotspot's top (90 % point above the max, averaged over hotH ± 1°) is no deeper than hotTop° below the horizon
 *   hotPos     the brightest point of the centre box sits within hotH ± hotPosTol (10-09: SQM's peaks drifted to ~4.5° R, up the 15° rise)
 *   hotContrast the hotspot box (hotLeft° L … hotRight° R, from its top down hotHt) averages ≥ hotContrast × the wash box (info: fill ÷ peak)
 *   wash       the wash box (± washW, from washTop° D down washHt, minus the hotspot box) averages ≥ washRatio of the peak.  Default 0.75–2.25° D = the road at
 *              ~17–50 m for a lamp 0.65 m up (Anya 10-09: candela belongs 0–2° D; 1–3.5° D was 11–37 m, i.e. asking for near-road light)
 *   streak     the right-side streak (streakFrom° … washW° on the own side, from the horizon down streakHt, under the cut-off) averages
 *              ≥ streakRatio of the peak: light along the horizon right of the elbow, what a 15° kink or a 45° step delivers (curves, signs)
 *   washHoles  share of the wash box under half of washRatio·peak: GRADED, full credit ≤ washHoles, none from washHolesZero
 *   fill3L     3L → 0 band (0.5–1.5° D) ≥ fill3L × the 0 → 3R band: light toward the oncoming side, under the line.
 *              The box deliberately overlaps the left cut-off fade (0.57° D): a sharper cut-off scores higher (Anya 10-09: reach)
 *   foreground ≤ fgCap of the lumens (±30° × 15D…5U) land below 4° D
 *   strayLow   no separate lobe below 4° D brighter than strayLow × the peak (info: side lobes in the 0–4° D band)
 *   nearLeft   the IIHS left edge reaches 5 lx by nearLeft m (0 = off). reachR / reachL: farthest 5 lx ≥ that (0 = off)
 * Defaults were set from Anya's three SQM scenes (10-09): scene 7's hotspot height and 3L fill, a foreground share
 * between scene 5 (19 %) and scene 7 (35 %). Every one is a knob. */
(function (root) {
  'use strict';
  const RF = root.RF;
  function defaults() {
    return { on: true, hotH: 1.5, hotLeft: 4, hotRight: 5.5, hotPosTol: 1.5, hotTop: 1.0, hotHt: 1.5, hotContrast: 1.5, washW: 15, washTop: 0.75, washHt: 1.5,
      washRatio: 0.25, washHoles: 0.3, washHolesZero: 0.6, streakFrom: 2.5, streakHt: 1.5, streakRatio: 0.25, fill3L: 0.5, fgCap: 0.3, strayLow: 0.5,
      nearLeft: 15, reachR: 0, reachL: 0 };
  }
  // a scene saved before 10-09 may carry hotW (a symmetric box, hotH ± hotW): it sets both extents unless they were set themselves
  const of = (md) => { const u = (md && md.ideal) || {}, g = Object.assign(defaults(), u);
    if (u.hotW > 0) { if (u.hotLeft === undefined) g.hotLeft = Math.max(0, u.hotW - g.hotH); if (u.hotRight === undefined) g.hotRight = g.hotH + u.hotW; }
    return g; };
  const mean = (I, h0, h1, v0, v1, dh = 0.25, dv = 0.125) => { let s = 0, n = 0; for (let h = h0; h <= h1 + 1e-9; h += dh) for (let v = v0; v <= v1 + 1e-9; v += dv) { s += I(h, v); n++; } return n ? s / n : 0; };

  // the hotspot's top: average the columns hotH ± 1°, find the max between 5° D and 1° U, walk up to where it falls under 90 %
  function topOf(I, hc) {
    const col = (v) => mean(I, hc - 1, hc + 1, v, v);
    let vm = -5, xm = 0; for (let v = -5; v <= 1 + 1e-9; v += 0.125) { const x = col(v); if (x > xm) { xm = x; vm = v; } }
    if (!(xm > 0)) return null;
    for (let v = vm; v <= 3 + 1e-9; v += 0.125) if (col(v) < 0.9 * xm) return +v.toFixed(3);
    return 3;
  }

  // → { goals: [{ key, name, value, target, met, credit, text }], info: [{ key, name, value, text }], met, n, score, q }
  //   credit 0…1 per goal (pass/fail goals give 0 or 1; wash holes is graded); score = Σ credit. q = the beam-quality report used
  function check(I, md, model, q) {
    const g = of(md); q = q || RF.BeamQuality.measure(I); if (q.empty) return { goals: [], info: [], met: 0, n: 0, score: 0, q, note: q.note };
    const pk = q.peak.cd, out = [], info = [];
    const add = (key, name, value, target, met, text, credit) => out.push({ key, name, value, target, met: !!met, credit: credit === undefined ? (met ? 1 : 0) : credit, text });
    const note = (key, name, value, text) => info.push({ key, name, value, text });
    const r2 = (x) => +x.toFixed(2);
    const top = topOf(I, g.hotH);
    const pkH = q.peak.h;
    add('hotPos', 'Hotspot position', +pkH.toFixed(2), g.hotH, Math.abs(pkH - g.hotH) <= g.hotPosTol + 1e-9, 'peak at ' + Math.abs(pkH) + '° ' + (pkH < 0 ? 'L' : 'R') + ' (want ' + g.hotH + ' ± ' + g.hotPosTol + '°)');
    if (top !== null) add('hotTop', 'Hotspot top', r2(-top), g.hotTop, -top <= g.hotTop + 1e-9, 'top ' + (top <= 0 ? r2(-top) + '° D' : r2(top) + '° U (above the horizon)') + ' (want ≤ ' + g.hotTop + '° D)');
    const t0 = top !== null ? Math.min(top, -0.25) : -g.hotTop;
    const hm = mean(I, -g.hotLeft, g.hotRight, t0 - g.hotHt, t0), hf = hm / pk;
    let ws = 0, wn = 0, dark = 0; const lo = 0.5 * g.washRatio * pk;
    // the wash is the next step down AROUND the hotspot: cells inside the hotspot box are left out (at 0.75–2.25° D the two overlap, and the
    // hotspot would otherwise prop up the wash level, hide its holes and be compared with itself in the contrast)
    const inHot = (h, v) => h >= -g.hotLeft && h <= g.hotRight && v >= t0 - g.hotHt && v <= t0;
    for (let h = -g.washW; h <= g.washW + 1e-9; h += 0.25) for (let v = -g.washTop - g.washHt; v <= -g.washTop + 1e-9; v += 0.125) { if (inHot(h, v)) continue; const x = I(h, v); ws += x; wn++; if (x < lo) dark++; }
    if (!wn) wn = 1;
    const wr = ws / wn / pk, wh = dark / wn;
    add('wash', 'Wash level', r2(wr), g.washRatio, wr >= g.washRatio, r2(wr) + ' of peak over ±' + g.washW + '° × ' + g.washTop + '–' + (g.washTop + g.washHt) + '° D (want ≥ ' + g.washRatio + ')');
    // hotspot contrast: the hotspot box's mean ÷ the wash box's mean. A flat band reads ~1; a tight hotspot standing out of a
    // filled wash reads ~1.8 (Anya 10-09: relative fill let a flat 15 kcd band beat a 40 kcd hotspot). Quirk: a hotspot sitting
    // deep under a dim wash box also reads high; the hotspot-top goal fails that beam.
    const hc = ws > 0 ? hm / (ws / wn) : 0;
    add('hotContrast', 'Hotspot contrast', r2(hc), g.hotContrast, hc >= g.hotContrast, 'hotspot box ' + (hm / 1000).toFixed(1) + ' kcd' + ' is ' + r2(hc) + ' × the wash box (want ≥ ' + g.hotContrast + ')');
    note('hotFill', 'Hotspot evenness', r2(hf), 'hotspot box averages ' + r2(hf) + ' of the peak (' + g.hotLeft + '° L … ' + g.hotRight + '° R × ' + g.hotHt + '° from its top); 1 = flat');
    // wash holes: graded. Full credit up to washHoles, none from washHolesZero (Anya: < 20 % fine, up to 40 % okay for a shallow strip)
    const whc = Math.max(0, Math.min(1, (g.washHolesZero - wh) / Math.max(1e-9, g.washHolesZero - g.washHoles)));
    add('washHoles', 'Wash holes', r2(wh), g.washHoles, wh <= g.washHoles, Math.round(100 * wh) + ' % of the wash box under half the wash level (full credit ≤ ' + Math.round(100 * g.washHoles) + ' %, none from ' + Math.round(100 * g.washHolesZero) + ' %): credit ' + r2(whc), whc);
    // the right-side streak: under the horizon AND under the cut-off line (cutTop: the preset's own line on the own side; default the ECE 15° rise)
    { const ct = cutTop(md), h0 = g.streakFrom, h1 = Math.max(h0 + 0.5, g.washW); let s = 0, n = 0;
      for (let h = h0; h <= h1 + 1e-9; h += 0.25) { const top = Math.min(0, ct(h)); for (let v = top - g.streakHt; v <= top + 1e-9; v += 0.125) { s += I(h, v); n++; } }
      const sr = n ? s / n / pk : 0;
      add('streak', 'Right streak', r2(sr), g.streakRatio, sr >= g.streakRatio, r2(sr) + ' of peak along the horizon ' + h0 + '–' + h1 + '° R, ' + g.streakHt + '° deep under the cut-off (want ≥ ' + g.streakRatio + ')'); }
    const fl = mean(I, -3, 0, -1.5, -0.5), fr = mean(I, 0, 3, -1.5, -0.5), f3 = fr > 0 ? fl / fr : 0;
    add('fill3L', '3L fill', r2(f3), g.fill3L, f3 >= g.fill3L, '3L→0 is ' + r2(f3) + ' × 0→3R, 0.5–1.5° D (want ≥ ' + g.fill3L + ')');
    const fg = q.foreground.lmShare;
    add('foreground', 'Foreground', r2(fg), g.fgCap, fg <= g.fgCap, Math.round(100 * fg) + ' % of lumens below 4° D (want ≤ ' + Math.round(100 * g.fgCap) + ' %)');
    // stray lobes: below 4° D they are a goal (light dumped near the car); in the 0–4° D band beside the centre box they are only
    // information ("could be in the hotspot", Anya: unoptimized, not bad)
    const fgV = q.foreground.below, lowL = q.lobes.filter((l) => l.v < fgV), bandL = q.lobes.filter((l) => l.v >= fgV && !(Math.abs(l.h) <= 5 && l.v <= 0 && l.v >= -4));
    const lo1 = lowL.sort((a, b) => b.ratio - a.ratio)[0], ba1 = bandL.sort((a, b) => b.ratio - a.ratio)[0], hv = (l) => Math.abs(l.h) + '° ' + (l.h < 0 ? 'L' : 'R') + ' ' + Math.abs(l.v) + '° ' + (l.v > 0 ? 'U' : 'D');
    add('strayLow', 'Low stray lobe', lo1 ? lo1.ratio : 0, g.strayLow, !lo1 || lo1.ratio <= g.strayLow, lo1 ? 'a separate lobe at ' + hv(lo1) + ' is ' + lo1.ratio + ' × peak (want ≤ ' + g.strayLow + ' below ' + (-fgV) + '° D)' : 'no separate lobe below ' + (-fgV) + '° D');
    note('strayBand', 'Side lobe in the band', ba1 ? ba1.ratio : 0, ba1 ? 'a lobe at ' + hv(ba1) + ' is ' + ba1.ratio + ' × peak: light that could be in the hotspot' : 'no side lobe outside the centre box above ' + (-fgV) + '° D');
    if (model && g.nearLeft > 0) {
      const L = RF.Road.IIHS.lane, z = RF.Road.IIHS.sensorZ; let x0 = 0;
      for (let x = RF.Road.IIHS.nearLeft; x <= 120; x += 0.5) if (model.lux([x, 1.5 * L, z]) >= RF.Road.IIHS.lux) { x0 = x; break; }
      add('nearLeft', 'Near-left edge', x0, g.nearLeft, x0 > 0 && x0 <= g.nearLeft, x0 ? 'left edge reaches 5 lx at ' + x0 + ' m (want by ' + g.nearLeft + ' m)' : 'left edge never reaches 5 lx');
    }
    if (model && (g.reachR > 0 || g.reachL > 0)) {
      const ii = model.iihs();
      if (g.reachR > 0) add('reachR', 'Right reach', ii.farRight, g.reachR, ii.farRight >= g.reachR, 'right edge 5 lx out to ' + ii.farRight + ' m (want ≥ ' + g.reachR + ')');
      if (g.reachL > 0) add('reachL', 'Left reach', ii.farLeft, g.reachL, ii.farLeft >= g.reachL, 'left edge 5 lx out to ' + ii.farLeft + ' m (want ≥ ' + g.reachL + ')');
    }
    return { goals: out, info, met: out.filter((x) => x.met).length, n: out.length, score: +out.reduce((a, x) => a + x.credit, 0).toFixed(2), q };
  }

  // the cut-off line on the own side (degrees, + = up) for the streak box: FMVSS ~1.4°/° from its line, else ECE 15° from 0.57° D, both to +1°
  function cutTop(md) {
    const us = /^fmvss/.test((md && md.preset) || ''), line = md && md.aimLine < 0 ? md.aimLine : us ? -0.4 : -0.57, t15 = Math.tan(15 * Math.PI / 180);
    return (h) => h <= 0 ? line : Math.min(line + (us ? 1.4 : t15) * h, 1.0);
  }
  RF.IdealBeam = { defaults, of, check, topOf, cutTop };
})(typeof globalThis !== 'undefined' ? globalThis : this);
