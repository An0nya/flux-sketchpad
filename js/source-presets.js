/* source-presets.js — RF.SourcePresets: real light sources as source settings.  Pure data + two helpers; no DOM.
 * Applying a preset keeps the source's position (and, for LEDs, its aim); it sets the emitter's geometry, emission and
 * power.  Where a datum is assumed rather than sourced, the preset says so.                                         */
(function (root) {
  'use strict';
  const RF = root.RF;

  // Luminus SFT-40-W 3000 K 95 CRI, flux vs current: read off koef3's test chart (BLF/TLF, 22.10.2023; Cu DTP board,
  // fan-cooled heatsink, 25 °C solder point).  A hot lamp delivers less: plan on roughly 10–15 % lower in a real housing.
  const SFT40_CURVE = [[0, 0], [1, 280], [2, 510], [3, 710], [4, 880], [5, 1030], [6, 1170], [7, 1285], [8, 1385], [9, 1475], [10, 1555], [11, 1615], [12, 1665], [13, 1700], [14, 1715], [14.8, 1715]];
  const SFT40_VF = [[0.2, 2.65], [1, 2.80], [2, 2.93], [3, 3.05], [4, 3.16], [5, 3.26], [6, 3.36], [7, 3.46], [8, 3.55], [9, 3.63], [10, 3.72], [11, 3.82], [12, 3.91], [13, 4.00], [14, 4.10], [14.8, 4.18]];
  const lerp = (tab, x) => {
    if (x <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return tab[tab.length - 1][1];
  };

  const PRESETS = {
    sketch: {
      label: 'Sketch LED · 1 × 1 mm, 1,000 lm',
      note: 'The app’s default emitter: a 1 mm² Lambertian die at 1,000 lm (≈ 318 cd/mm², brighter than most real LEDs).',
      set: { kind: 'planar', shape: 'rect', w: 1, h: 1, dist: 'lambertian', power: 1000 },
    },
    'sft40-3000k': {
      label: 'Luminus SFT-40-W · 3000 K 95 CRI · 2 × 2 mm',
      note: 'Flat-window LED, 4.0 mm² chip modelled as a 2 × 2 mm Lambertian die (Luminus: "flat window … much smaller light emitting surface than a dome"). Flux from koef3’s chart at a 25 °C solder point; a hot housing gives ~10–15 % less.',
      set: { kind: 'planar', shape: 'rect', w: 2, h: 2, dist: 'lambertian' },
      drive: { curve: SFT40_CURVE, vf: SFT40_VF, maxA: 14.8, defaultA: 6 },
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
    if (p.drive) { src.driveA = opts && opts.amps > 0 ? Math.min(p.drive.maxA, opts.amps) : (src.driveA > 0 ? Math.min(p.drive.maxA, src.driveA) : p.drive.defaultA); src.power = Math.round(lerp(p.drive.curve, src.driveA)); }
    else delete src.driveA;
    if (p.volts) { src.volts = opts && p.volts[opts.volts] ? opts.volts : (p.volts[src.volts] ? src.volts : 13.2); src.power = p.volts[src.volts]; }
    else delete src.volts;
    return p;
  }
  // the preset's electrical side at the source's current drive: { amps, vf, watts, lmPerW } (LEDs) or null
  function electrical(src) {
    const p = PRESETS[src.preset]; if (!p || !p.drive || !(src.driveA > 0)) return null;
    const vf = lerp(p.drive.vf, src.driveA), w = vf * src.driveA;
    return { amps: src.driveA, vf, watts: w, lmPerW: src.power / w };
  }
  // does the source still match its preset's geometry and emission (or has it been edited since)?
  function matches(src) {
    const p = PRESETS[src.preset]; if (!p) return false;
    for (const [k, v] of Object.entries(p.set)) if (k !== 'power' && src[k] !== v) return false;
    return true;
  }

  RF.SourcePresets = { PRESETS, apply, electrical, matches, lumensAt: (id, a) => (PRESETS[id] && PRESETS[id].drive ? lerp(PRESETS[id].drive.curve, a) : NaN) };
})(typeof globalThis !== 'undefined' ? globalThis : this);
