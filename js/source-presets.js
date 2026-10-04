/* source-presets.js — RF.SourcePresets: real light sources as source settings.  Pure data + two helpers; no DOM.
 * Applying a preset keeps the source's position (and, for LEDs, its aim); it sets the emitter's geometry, emission and
 * power.  Where a datum is assumed rather than sourced, the preset says so.                                         */
(function (root) {
  'use strict';
  const RF = root.RF;

  // Luminus SFT-40-WxH (PDS-003302 Rev 01): 3000 K > 95 CRI, emitting area 1.97 × 1.97 mm (p. 10), Lambertian (120° FWHM,
  // p. 6; I(60°) = 0.5 on p. 8), absolute max DC current 4 A (p. 6).  Two flux models:
  //   datasheet — bin D9 minimum flux at Tj = 85 °C (p. 3: 198 / 395 / 502 / 695 / 861 lm at 0.7 / 1.5 / 2 / 3 / 4 A; the off-1.5 A
  //               values are Luminus' calculated ones), Vf = 2.8 V typ at 1.5 A plus the ΔVf curve (p. 7)
  //   koef3     — one sample measured by koef3 (BLF/TLF, 22.10.2023): Cu DTP board, fan-cooled, 25 °C solder point, driven to
  //               14.8 A (3.7× the rating).  Brighter (cooler junction) and beyond the datasheet past 4 A.
  const SFT40_CURVE = [[0, 0], [1, 280], [2, 510], [3, 710], [4, 880], [5, 1030], [6, 1170], [7, 1285], [8, 1385], [9, 1475], [10, 1555], [11, 1615], [12, 1665], [13, 1700], [14, 1715], [14.8, 1715]];
  const SFT40_VF = [[0.2, 2.65], [1, 2.80], [2, 2.93], [3, 3.05], [4, 3.16], [5, 3.26], [6, 3.36], [7, 3.46], [8, 3.55], [9, 3.63], [10, 3.72], [11, 3.82], [12, 3.91], [13, 4.00], [14, 4.10], [14.8, 4.18]];
  // Past 4 A the datasheet says nothing: continue with koef3's curve SHAPE, scaled to meet the datasheet at 4 A (flux × 861/880,
  // Vf − 0.05 V) — an estimate for a hot junction, not a measurement.
  const SFT40_DS = [[0, 0], [0.7, 198], [1.5, 395], [2, 502], [3, 695], [4, 861]].concat(SFT40_CURVE.filter(([a]) => a > 4).map(([a, lm]) => [a, Math.round(lm * 861 / 880)]));
  const SFT40_DS_VF = [[0.1, 2.56], [0.5, 2.66], [1, 2.73], [1.5, 2.80], [2, 2.87], [2.5, 2.94], [3, 3.00], [3.5, 3.06], [4, 3.11]].concat(SFT40_VF.filter(([a]) => a > 4).map(([a, v]) => [a, +(v - 0.05).toFixed(2)]));
  const lerp = (tab, x) => {
    if (x <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return tab[tab.length - 1][1];
  };

  // Luminus SFT-40-WxS / WxE (PDS-003134 Rev 05): cool white 5000 / 5700 / 6500 K, CRI ~70, same 1.97 mm flat-window die
  // (p. 11), 120° FWHM, DC max 8 A, Pd max 29 W (p. 6).  Flux = each bin's correlated minimum at Tj 85 °C (p. 3; off-1.5 A
  // values calculated by Luminus); Vf = 2.8 V typ at 1.5 A plus the ΔVf-vs-current curve (p. 7, read off the plot).
  const CW_VF = [[0.1, 2.57], [1, 2.72], [1.5, 2.80], [2, 2.88], [3, 3.02], [4, 3.16], [5, 3.28], [6, 3.40], [7, 3.50], [8, 3.60]];
  const cwBin = (a07, a15, a2, a3, a5, a6, a8) => [[0, 0], [0.7, a07], [1.5, a15], [2, a2], [3, a3], [5, a5], [6, a6], [8, a8]];
  const PRESETS = {
    sketch: {
      label: 'Sketch LED · 1 × 1 mm, 1,000 lm',
      note: 'The app’s default emitter: a 1 mm² Lambertian die at 1,000 lm (≈ 318 cd/mm², brighter than most real LEDs).',
      set: { kind: 'planar', shape: 'rect', w: 1, h: 1, dist: 'lambertian', power: 1000 },
    },
    'sft40-3000k': {
      label: 'Luminus SFT-40-W · 3000 K 95 CRI · 1.97 mm',
      note: 'Luminus SFT-40-WxH datasheet (PDS-003302 Rev 01): flat window, 1.97 × 1.97 mm emitting area, Lambertian (120° FWHM), 4 A absolute maximum. "Datasheet" flux = bin D9 minimum at Tj 85 °C; "koef3" = one sample on a fan-cooled copper board at a 25 °C solder point.',
      set: { kind: 'planar', shape: 'rect', w: 1.97, h: 1.97, dist: 'lambertian' },
      drive: { models: { datasheet: { label: 'Datasheet (bin D9 min, Tj 85 °C; > 4 A estimated)', curve: SFT40_DS, vf: SFT40_DS_VF, maxA: 14.8 }, koef3: { label: 'koef3 test (25 °C solder point, overdriven)', curve: SFT40_CURVE, vf: SFT40_VF, maxA: 14.8 } }, model: 'datasheet', ratedA: 4, maxW: 13, defaultA: 3 },
    },
    'sft40-cw': {
      label: 'Luminus SFT-40-W (cool white, CRI ~70) · 1.97 mm',
      note: 'Luminus SFT-40-WxS/WxE datasheet (PDS-003134 Rev 05): 5000/5700/6500 K, CRI ~70, flat window, 1.97 × 1.97 mm, Lambertian (120° FWHM), 8 A and 29 W maximum. Flux = the chosen bin\u2019s minimum at Tj 85 °C (Luminus\u2019 calculated values away from 1.5 A).',
      set: { kind: 'planar', shape: 'rect', w: 1.97, h: 1.97, dist: 'lambertian' },
      drive: { models: {
        n4: { label: '5000 / 5700 K · bin N4 min', curve: cwBin(303, 594, 760, 1057, 1550, 1758, 2128), vf: CW_VF, maxA: 8 },
        n5: { label: '6500 K · bin N5 min', curve: cwBin(323, 634, 812, 1129, 1655, 1877, 2272), vf: CW_VF, maxA: 8 },
        p3: { label: 'Top bin P3 min (any CCT, if you get one)', curve: cwBin(364, 713, 913, 1269, 1861, 2110, 2555), vf: CW_VF, maxA: 8 },
      }, model: 'n5', ratedA: 8, maxW: 29, defaultA: 6 },
    },
    hb3: {
      label: 'HB3 / 9005 halogen · axial filament 5.1 mm',
      note: 'UN R37 sheets HB3/1–4 (E/ECE/324/Rev.1/Add.36/Rev.7): filament length f = 5.1 mm on the reference axis, centre e = 31.5 mm from the reference plane; 1,860 lm ± 12 % at 13.2 V (1,300 lm at 12 V). Filament DIAMETER is not on those sheets: 1.4 mm assumed (edit Radius). Opaque coil (Lambertian skin). Not modelled: the glass bulb, the cap and holder shadowing light behind it.',
      set: { kind: 'volume', shape: 'cylinder', radius: 0.7, length: 5.1, emission: 'surface', dist: 'isotropic', power: 1860 },
      axis: [1, 0, 0],                                   // axial filament: along the throw axis, as in a reflector headlamp
      volts: { 12: 1300, 13.2: 1860 },
    },
  };

  // set src to preset id (position kept).  opts.amps / opts.volts for the drive.  Returns the applied preset.
  function apply(src, id, opts) {
    const p = PRESETS[id]; if (!p) return null;
    Object.assign(src, JSON.parse(JSON.stringify(p.set)));
    if (p.axis) { src.axis = p.axis.slice(); src.roll = 0; }
    src.preset = id;
    if (p.drive) {
      src.fluxModel = opts && p.drive.models[opts.model] ? opts.model : (p.drive.models[src.fluxModel] ? src.fluxModel : p.drive.model);
      const m = p.drive.models[src.fluxModel];
      src.driveA = opts && opts.amps > 0 ? Math.min(m.maxA, opts.amps) : (src.driveA > 0 ? Math.min(m.maxA, src.driveA) : p.drive.defaultA);
      src.power = Math.round(lerp(m.curve, src.driveA));
    } else { delete src.driveA; delete src.fluxModel; }
    if (p.volts) { src.volts = opts && p.volts[opts.volts] ? opts.volts : (p.volts[src.volts] ? src.volts : 13.2); src.power = p.volts[src.volts]; }
    else delete src.volts;
    return p;
  }
  // the preset's electrical side at the source's current drive: { amps, vf, watts, lmPerW } (LEDs) or null
  function electrical(src) {
    const p = PRESETS[src.preset]; if (!p || !p.drive || !(src.driveA > 0)) return null;
    const m = p.drive.models[src.fluxModel] || p.drive.models[p.drive.model];
    const vf = lerp(m.vf, src.driveA), w = vf * src.driveA;
    return { amps: src.driveA, vf, watts: w, lmPerW: src.power / w, overRated: src.driveA > p.drive.ratedA + 1e-9, ratedA: p.drive.ratedA, maxA: m.maxA, overPower: p.drive.maxW > 0 && w > p.drive.maxW, maxW: p.drive.maxW, extrapolated: src.fluxModel === 'datasheet' && src.driveA > p.drive.ratedA };
  }
  // does the source still match its preset's geometry and emission (or has it been edited since)?
  function matches(src) {
    const p = PRESETS[src.preset]; if (!p) return false;
    for (const [k, v] of Object.entries(p.set)) if (k !== 'power' && src[k] !== v) return false;
    return true;
  }

  RF.SourcePresets = { PRESETS, apply, electrical, matches, lumensAt: (id, a, model) => { const d = PRESETS[id] && PRESETS[id].drive; return d ? lerp((d.models[model] || d.models[d.model]).curve, a) : NaN; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
