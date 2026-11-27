// HDR headlamp spike: does real HDR output plus a perceptual glare model read better than the drive's
// current veil + bloom? Raw WebGPU, no three.js. Units follow the drive view: luminance in cd/m², eye
// illuminance E in lux, EV with L_REF = 10 cd/m² at display white for EV 0. See README.md.

const DEG = Math.PI / 180;
const L_REF = 10;                                   // drive.js: EV 0 puts 10 cd/m² at display white
const GLARE_BANDS = [1, 2, 4, 8], GLARE_WEIGHT = 0.0075;   // drive.js / drive-anim.js, unchanged
const glareSigma = (w, fov) => Math.max(0.35, 1.5 * w / 640 * Math.tan(Math.PI / 6) / Math.tan(fov * DEG / 2));
const BINS = 4096;                                  // starburst angular table resolution
const STORE = 'hdr-headlamp-v1';
const STRIP = [1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 8, 16];   // headroom strip patches, × paper white (display-linear)
const BUNDLE = '../../samples/beams/sqm-samples.json';   // the drive's built-in beam library
// Drive geometry (drive.js Headlamp.cd default eye [-2, 0.37, 1.2] relative to the car front). Our frame: eye at the origin,
// x forward, y left, z up. Own lamps 2 m ahead of the eye, centred on the car (0.37 m right of the eye), 0.65 m high (TUNING).
const EYE_Z = 1.2, OWN = { x: 2, y: -0.37, half: 0.7, z: 0.65 };
const LIB_BEAMS = ['offset-box axial h7 SQM ideal', '7-inch-round-rearfiring sft40NW8A', '7-inch-round-rearfiring sft40WW-95CRI14A', '7-inch-round-rearfiring 519a-NW8A', '7-inch-round-rearfiring d2s-transverse'];
const BEAMS = ['Drive generic low', 'Drive generic high', 'Spike simple (old)', ...LIB_BEAMS];

// ---------------------------------------------------------------- settings: every knob is one entry here
// type: r = range, s = select, c = checkbox. log: slider moves in log space.
const SPEC = [
  ['Oncoming car', [
    { id: 'animate', label: 'Drive at me', type: 'c', def: false },
    { id: 'speed', label: 'Closing speed', type: 'r', min: 10, max: 250, def: 100, step: 5, unit: 'km/h', dp: 0 },
    { id: 'spawn', label: 'Spawn distance', type: 'r', min: 50, max: 400, def: 250, step: 10, unit: 'm', dp: 0 },
    { id: 'gap', label: 'Gap before next', type: 'r', min: 0, max: 5, def: 1.5, step: 0.1, unit: 's', dp: 1 },
    { id: 'dist', label: 'Distance (still)', type: 'r', min: 5, max: 300, def: 32, log: true, unit: 'm', dp: 0 },
    { id: 'oncSrc', label: 'Intensity to eye', type: 's', opts: ['fixed cd', 'from beam table'], def: 'fixed cd' },
    { id: 'cd', label: 'Fixed intensity', type: 'r', min: 50, max: 50000, def: 1000, log: true, unit: 'cd', dp: 0 },
    { id: 'oncBeam', label: 'Their beam', type: 's', opts: BEAMS, def: 'Drive generic low' },
    { id: 'oncScale', label: 'Their beam scale', type: 'r', min: 0.05, max: 4, def: 1, log: true, unit: '×', dp: 2 },
    { id: 'color', label: 'Lamp colour', type: 's', opts: ['LED 5700K', 'Halogen', 'HID 4300K'], def: 'LED 5700K' },
    { id: 'lat', label: 'Lateral offset', type: 'r', min: 0, max: 8, def: 3.5, step: 0.1, unit: 'm', dp: 1 },
    { id: 'spacing', label: 'Lamp spacing', type: 'r', min: 0.8, max: 1.8, def: 1.4, step: 0.05, unit: 'm', dp: 2 },
    { id: 'lens', label: 'Lens radius', type: 'r', min: 0.01, max: 0.12, def: 0.05, step: 0.005, unit: 'm', dp: 3 },
  ], 'Drive at me: the car approaches at the closing speed, passes, and the next one appears at the spawn distance after the gap. "From beam table" samples their beam at the angle you sit in, so the glare falls off as they get close and you leave their beam, like the drive does.'],
  ['Scene', [
    { id: 'ownBeam', label: 'Our beam', type: 's', opts: BEAMS, def: 'Drive generic low' },
    { id: 'own', label: 'Our beam gain', type: 'r', min: 0, max: 3, def: 1, step: 0.05, unit: '×', dp: 2 },
    { id: 'target', label: 'Target', type: 's', opts: ['off', 'grey board', 'deer'], def: 'deer' },
    { id: 'tdist', label: 'Target distance', type: 'r', min: 5, max: 200, def: 60, log: true, unit: 'm', dp: 0 },
    { id: 'tlat', label: 'Target lateral', type: 'r', min: -3, max: 6, def: 0.8, step: 0.05, unit: 'm', dp: 2 },
    { id: 'trho', label: 'Target reflectance', type: 'r', min: 0.02, max: 0.5, def: 0.12, step: 0.01, unit: '', dp: 2 },
    { id: 'hfov', label: 'Horizontal FOV', type: 'r', min: 30, max: 100, def: 60, step: 1, unit: '°', dp: 0 },
    { id: 'sim', label: 'Render width', type: 's', opts: ['640', '960', '1280', '1600', 'native'], def: '960' },
  ], 'Our beam: the drive\'s generic low beam, the spike\'s old shape (your 11-27 tuning used it), or the five built-in tables from the drive\'s beam library (loaded on first use, about 11 MB). Deer reflectance 0.12 is a guess (TUNING); positive lateral is left.'],
  ['Exposure', [
    { id: 'expo', label: 'Mode', type: 's', opts: ['fixed', 'adapt'], def: 'fixed' },
    { id: 'ev', label: 'EV', type: 'r', min: -4, max: 6, def: 2, step: 0.25, unit: '', dp: 2 },
  ], 'fixed: EV 0 puts 10 cd/m² at white. adapt: the straight-ahead veil (1° floor, as in the drive) is added to the white point, like the drive\'s adapt mode.'],
  ['Display', [
    { id: 'canvasMode', label: 'Canvas tone mapping', type: 's', opts: ['extended', 'standard'], def: 'standard' },
    { id: 'curve', label: 'Tone curve', type: 's', opts: ['ACES (SDR)', 'ACES + HDR shoulder'], def: 'ACES (SDR)' },
    { id: 'peak', label: 'HDR peak', type: 'r', min: 1, max: 16, def: 4, step: 0.25, unit: '× white', dp: 2 },
    { id: 'knee', label: 'Shoulder knee', type: 'r', min: 0.25, max: 4, def: 1, step: 0.05, unit: 'lin', dp: 2 },
    { id: 'strip', label: 'Headroom strip', type: 'c', def: false },
  ], 'Canvas "extended" lets values above 1.0 show above paper white. The HDR shoulder keeps ACES below the knee and rolls on toward the peak above it, slope-matched. The headroom strip draws patches at fixed multiples of paper white: the last one that still looks brighter than its neighbour is your headroom right now. If HDR seems stuck low, press "Re-request HDR".'],
  ['Veil (Stiles–Holladay 10·E/θ²)', [
    { id: 'veilMode', label: 'Veil drawn as', type: 's', opts: ['off', 'physical', 'perceptual'], def: 'physical' },
    { id: 'veilLaw', label: 'Veil formula', type: 's', opts: ['Stiles–Holladay 10/θ²', 'CIE 146 general'], def: 'Stiles–Holladay 10/θ²' },
    { id: 'age', label: 'Observer age', type: 'r', min: 15, max: 85, def: 35, step: 1, unit: 'yr', dp: 0 },
    { id: 'pig', label: 'Eye pigment p', type: 'r', min: 0, max: 1, def: 0.5, step: 0.5, unit: '', dp: 1 },
    { id: 'sdrBoost', label: 'SDR veil boost', type: 'r', min: 1, max: 4, def: 1, step: 0.05, unit: '×', dp: 2 },
    { id: 'veilStr', label: 'Strength', type: 'r', min: 0, max: 2, def: 1, step: 0.05, unit: '×', dp: 2 },
    { id: 'veilCap', label: 'Perceptual cap', type: 'r', min: 0.05, max: 1, def: 0.4, step: 0.01, unit: '', dp: 2 },
    { id: 'veilFloor', label: 'Angle floor', type: 'r', min: 0.05, max: 2, def: 1, step: 0.05, unit: '°', dp: 2 },
  ], 'physical = the drive today (added as luminance). perceptual = cap·v/(1+v), so it reads as haze and never reaches white. CIE 146 general (θ in degrees, valid 0.1° to 100°): 10/θ³ + (5/θ² + 0.1p/θ)·[1 + (age/62.5)⁴] + 0.0025p; p = 0 dark, 0.5 brown, 1 blue-green eyes. Age and pigment only affect the CIE formula. SDR veil boost multiplies the veil only when the HDR shoulder or extended canvas is off. Adaptation uses the chosen formula with a 1° floor.'],
  ['Bloom (the drive\'s current recipe)', [
    { id: 'bloom', label: 'On', type: 'c', def: true },
    { id: 'bloomStr', label: 'Strength', type: 'r', min: 0, max: 0.6, def: 0.1, step: 0.005, unit: '', dp: 3 },
  ], 'Port of FS_BRIGHT + the 4-band Gaussian pyramid. Drive levels: dry-low 0.035, dry 0.1, rain 0.3.'],
  ['Core PSF', [
    { id: 'core', label: 'On', type: 'c', def: false },
    { id: 'coreShape', label: 'Shape', type: 's', opts: ['gaussian', 'moffat'], def: 'gaussian' },
    { id: 'coreSigma', label: 'Gaussian sigma', type: 'r', min: 0.01, max: 0.6, def: 0.06, step: 0.01, unit: '°', dp: 2 },
    { id: 'coreAlpha', label: 'Moffat α (width)', type: 'r', min: 0.005, max: 0.5, def: 0.05, log: true, unit: '°', dp: 3 },
    { id: 'coreBeta', label: 'Moffat β (tail)', type: 'r', min: 1.1, max: 6, def: 2, step: 0.05, unit: '', dp: 2 },
  ], 'The spread of the lamp itself; energy is kept. Gaussian has a hard edge and barely grows with brightness. Moffat, (1 + (θ/α)²)^-β, is what astronomers use for star images: a core with a power-law skirt. Lower β = longer skirt, so the blob grows with brightness and fades into the veil.'],
  ['Starburst', [
    { id: 'spike', label: 'On', type: 'c', def: false },
    { id: 'spikeCount', label: 'Spokes', type: 'r', min: 4, max: 240, def: 60, step: 1, unit: '', dp: 0 },
    { id: 'spikeLen', label: 'Length', type: 'r', min: 0.3, max: 8, def: 2, step: 0.05, unit: '°', dp: 2 },
    { id: 'spikeLenJit', label: 'Length jitter', type: 'r', min: 0, max: 1, def: 0.5, step: 0.01, unit: '', dp: 2 },
    { id: 'spikeWidth', label: 'Spoke width', type: 'r', min: 0.1, max: 10, def: 0.8, log: true, unit: '° (φ)', dp: 2 },
    { id: 'spikeGain', label: 'Gain', type: 'r', min: 0.05, max: 500, def: 40, log: true, unit: 'cd/m²/lx', dp: 2 },
    { id: 'spikeTaper', label: 'Taper', type: 'r', min: 0.5, max: 8, def: 2.5, step: 0.1, unit: '', dp: 1 },
    { id: 'spikeBase', label: 'Even corona', type: 'r', min: 0, max: 1, def: 0.05, step: 0.01, unit: '', dp: 2 },
    { id: 'spikeSeed', label: 'Pattern seed', type: 'r', min: 1, max: 500, def: 7, step: 1, unit: '', dp: 0 },
    { id: 'spikeRot', label: 'Rotation', type: 'r', min: 0, max: 360, def: 0, step: 1, unit: '°', dp: 0 },
  ], 'One fixed pattern for every lamp (it comes from your eye, not the lamp). Brightness ∝ E; the length is a hard limit, so spikes never get longer with intensity. No flicker.'],
  ['Performance', [
    { id: 'continuous', label: 'Render every frame', type: 'c', def: false },
  ], 'On (or while the car drives) the page renders every frame and reports fps and GPU time. GPU time is submit-to-done, so it includes any queue wait: an upper bound.'],
];
const ALL = SPEC.flatMap(([, items]) => items);
const DEFAULTS = Object.fromEntries(ALL.map((c) => [c.id, c.def]));

const ANYA_1127 = { dist: 24.48, cd: 601.1, color: 'LED 5700K', lat: 3.5, spacing: 1.4, lens: 0.06, hfov: 60, own: 0.3, ownBeam: 'Spike simple (old)', oncSrc: 'fixed cd',
  target: 'grey board', tdist: 50, tlat: 1.15, trho: 0.15, sim: '960', expo: 'fixed', ev: 2, canvasMode: 'extended', curve: 'ACES + HDR shoulder', peak: 16, knee: 0.55,
  veilMode: 'perceptual', veilStr: 0.25, veilCap: 1, veilFloor: 1.05, bloom: false, bloomStr: 0.07, core: true, coreShape: 'gaussian', coreSigma: 0.16,
  spike: true, spikeCount: 49, spikeLen: 2.8, spikeLenJit: 0.6, spikeWidth: 3.12, spikeGain: 282.5, spikeTaper: 3.4, spikeBase: 0.18, spikeSeed: 7, spikeRot: 0 };
const PRESETS = {
  'Current · SDR':    { veilMode: 'physical',   veilFloor: 1,   bloom: true,  core: false, spike: false, curve: 'ACES (SDR)',          canvasMode: 'standard' },
  'Current · HDR':    { veilMode: 'physical',   veilFloor: 1,   bloom: true,  core: false, spike: false, curve: 'ACES + HDR shoulder', canvasMode: 'extended' },
  'Perceptual · SDR': { veilMode: 'perceptual', veilFloor: 0.3, bloom: false, core: true,  spike: true,  curve: 'ACES (SDR)',          canvasMode: 'standard' },
  'Perceptual · HDR': { veilMode: 'perceptual', veilFloor: 0.3, bloom: false, core: true,  spike: true,  curve: 'ACES + HDR shoulder', canvasMode: 'extended' },
  'Anya 11-27':       ANYA_1127,
  // Her Moffat tune from phone session 3 (α 0.1°, β 1.5 under the old width rule), re-expressed for the decoupled rule:
  // α 0.15° gives the same tail at 960 px and 24.5 m. TUNING.
  'Anya Moffat':      { ...ANYA_1127, oncSrc: 'from beam table', oncBeam: '7-inch-round-rearfiring d2s-transverse', ownBeam: '7-inch-round-rearfiring d2s-transverse', own: 1,
                       color: 'HID 4300K', target: 'deer', veilMode: 'off', coreShape: 'moffat', coreAlpha: 0.15, coreBeta: 1.5,
                       spikeCount: 74, spikeLen: 4.25, spikeLenJit: 0.74, spikeWidth: 4.47, spikeGain: 106.4 },
  'CIE 146 veil':     { veilMode: 'physical', veilLaw: 'CIE 146 general', veilStr: 1, veilFloor: 0.1, core: true, coreShape: 'moffat', coreAlpha: 0.05, coreBeta: 3, bloom: false, spike: true },
};

let S = { ...DEFAULTS };
try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved) for (const k in saved) if (k in DEFAULTS) S[k] = saved[k]; } catch (e) { /* private mode: defaults */ }
if (S.target === true) S.target = 'grey board'; else if (S.target === false) S.target = 'off';   // v1 stored a checkbox
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- UI built from SPEC
const $ = (id) => document.getElementById(id);
const inputs = {};
function fmt(c, v) { return c.type === 'r' ? Number(v).toFixed(c.dp ?? 2) + (c.unit ? ' ' + c.unit : '') : ''; }
function toSlider(c, v) { return c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) * 1000 : v; }
function fromSlider(c, x) { return c.log ? c.min * Math.pow(c.max / c.min, x / 1000) : Number(x); }
function buildUI() {
  const root = $('controls'), open = ['Oncoming car', 'Display', 'Core PSF'];
  for (const [title, items, help] of SPEC) {
    const d = document.createElement('details'); d.open = open.includes(title);
    d.innerHTML = `<summary>${title}</summary>`;
    for (const c of items) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = c.label; lab.htmlFor = 'in-' + c.id;
      let el; const out = document.createElement('output');
      if (c.type === 'r') {
        el = document.createElement('input'); el.type = 'range';
        if (c.log) { el.min = 0; el.max = 1000; el.step = 1; } else { el.min = c.min; el.max = c.max; el.step = c.step ?? 'any'; }
        el.addEventListener('input', () => { S[c.id] = fromSlider(c, el.value); out.textContent = fmt(c, S[c.id]); changed(); });
      } else if (c.type === 's') {
        el = document.createElement('select'); for (const o of c.opts) el.add(new Option(o, o));
        el.addEventListener('change', () => { S[c.id] = el.value; changed(); });
      } else {
        el = document.createElement('input'); el.type = 'checkbox';
        el.addEventListener('change', () => { S[c.id] = el.checked; changed(); });
      }
      el.id = 'in-' + c.id; inputs[c.id] = { el, out, c };
      row.append(lab, el, out); d.append(row);
    }
    const h = document.createElement('div'); h.className = 'help'; h.textContent = help; d.append(h);
    root.append(d);
  }
  const bar = $('presets');
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement('button'); b.textContent = name; b.dataset.preset = name;
    b.addEventListener('click', () => { Object.assign(S, PRESETS[name]); syncUI(); changed(); }); bar.append(b);
  }
  const strip = $('strip'); for (const v of STRIP) { const s = document.createElement('span'); s.textContent = v + '×'; strip.append(s); }
  $('reset').addEventListener('click', () => { S = { ...DEFAULTS }; syncUI(); changed(); });
  $('rehdr').addEventListener('click', () => rerequestHDR('button'));
  $('copy').addEventListener('click', async () => { const t = JSON.stringify(S, null, 1); $('json').value = t; try { await navigator.clipboard.writeText(t); $('copy').textContent = 'Copied'; } catch (e) { $('copy').textContent = 'Copy failed: select the box'; } setTimeout(() => { $('copy').textContent = 'Copy settings'; }, 1500); });
  $('measure').addEventListener('click', () => measure().catch((e) => { $('measured').textContent = 'Measure failed: ' + e.message; }));
  $('measure').textContent = 'Measure';
}
function syncUI() {
  for (const id in inputs) {
    const { el, out, c } = inputs[id], v = S[id];
    if (c.type === 'r') { el.value = toSlider(c, v); out.textContent = fmt(c, v); } else if (c.type === 's') el.value = v; else el.checked = !!v;
  }
  for (const b of document.querySelectorAll('[data-preset]')) { const p = PRESETS[b.dataset.preset]; b.classList.toggle('on', Object.keys(p).every((k) => S[k] === p[k])); }
  $('strip').style.display = S.strip ? 'flex' : 'none';
  $('json').value = JSON.stringify(S, null, 1);
}

// ---------------------------------------------------------------- beams: I(H, V) tables, convention A (H positive right, V up)
// The table grid matches the drive's built-in samples: H -45..45, V -30..15, 0.1° cells; data[j*nh+i] is the cd at the cell centre.
const GRID = { h0: -45, v0: -30, step: 0.1, nh: 900, nv: 450 };
// Procedural beams are baked the way the drive bakes its generic low (lutFrom, win ±90°, step 0.25°), so no table edge shows on the road.
const WIDE = { h0: -90, v0: -90, step: 0.25, nh: 720, nv: 720 };
function bake(fn, G = WIDE) { const a = new Float32Array(G.nh * G.nv); for (let j = 0; j < G.nv; j++) for (let i = 0; i < G.nh; i++) a[j * G.nh + i] = fn(G.h0 + (i + 0.5) * G.step, G.v0 + (j + 0.5) * G.step); return { ...G, data: a }; }
const genericLow = (h, v) => {   // drive.js Headlamp.generic(h, v, false), verbatim
  const cut = -0.35 + Math.min(1.4, Math.max(0, h) * 0.15), below = 1 / (1 + Math.exp(Math.max(-60, Math.min(60, (v - cut) / 0.12))));
  return 120 + 750 * Math.exp(-Math.max(0, v) / 0.3) + below * (1800 + 10000 * Math.exp(-0.5 * (((h - 3) / 7) ** 2 + ((v + 1) / 2.5) ** 2)));
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spikeSimple = (H, v) => {   // the first spike build's beam, in convention A (its h was positive left)
  const h = -H, cut = -0.6 + 2.1 * smooth(-1, -4, h);
  return 20000 * Math.exp(-((h / (h > 0 ? 12 : 16)) ** 2)) * (1 - smooth(cut - 0.3, cut + 0.3, v)) * (0.1 + 0.9 * Math.exp(-(((v + 1.2) / 2) ** 2))) + 150;
};
const beamCache = new Map(); let bundle = null;
async function loadBundle() {
  if (!bundle) bundle = (async () => {
    const r = await fetch(BUNDLE); if (!r.ok) throw new Error('beam library ' + r.status);
    const j = await r.json(), out = {};
    for (const b of j.beams) {
      const bin = atob(b.data), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const dv = new DataView(u8.buffer), n = b.grid.nh * b.grid.nv, data = new Float32Array(n); for (let i = 0; i < n; i++) data[i] = dv.getFloat32(4 * i, true);
      out[b.name] = { ...b.grid, data, conv: b.conv };
    }
    return out;
  })();
  return bundle;
}
async function getBeam(name) {
  if (beamCache.has(name)) return beamCache.get(name);
  let t;
  if (name === 'Drive generic low') t = bake(genericLow);
  else if (name === 'Drive generic high') t = bake((h, v) => 30000 * Math.exp(-0.5 * ((h / 9) ** 2 + (v / 4) ** 2)) + 300);   // drive.js Headlamp.generic(h, v, true)
  else if (name === 'Spike simple (old)') t = bake(spikeSimple);
  else { const lib = await loadBundle(); t = lib[name]; if (!t) throw new Error('beam not in library: ' + name); if (t.conv && t.conv !== 'A') throw new Error('beam convention ' + t.conv + ' not handled'); }
  beamCache.set(name, t); return t;
}
function lutAt(L, h, v) {   // drive.js lutAt, verbatim
  const fx = (h - L.h0) / L.step - 0.5, fy = (v - L.v0) / L.step - 0.5, i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i + 1 >= L.nh || j + 1 >= L.nv) return 0;
  const tx = fx - i, ty = fy - j, d = L.data, k = j * L.nh + i;
  return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - ty) + (d[k + L.nh] * (1 - tx) + d[k + L.nh + 1] * tx) * ty;
}

// ---------------------------------------------------------------- scene numbers (CPU side)
const COLORS = { 'LED 5700K': [1, 0.97, 1.0], 'Halogen': [1.0, 0.8, 0.55], 'HID 4300K': [1.0, 0.95, 0.85] };
function lampRGB(name) { const c = COLORS[name] || [1, 1, 1], y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((v) => v / y); }   // unit luminance
const EYE = [0, 0, EYE_Z];
let oncTable = null;   // the beam table for "from beam table", once loaded
const anim = { x: null, wait: 0, lastT: null };
function carDistance(now) {
  if (!S.animate) { anim.x = null; anim.lastT = null; return S.dist; }
  // clamp so a stall or a hidden tab does not teleport the car; never negative
  const dt = anim.lastT == null ? 0 : Math.max(0, Math.min(0.25, (now - anim.lastT) / 1000)); anim.lastT = now;
  if (anim.x == null) anim.x = S.spawn;
  if (anim.wait > 0) { anim.wait -= dt; if (anim.wait <= 0) anim.x = S.spawn; return null; }
  anim.x -= S.speed / 3.6 * dt;
  if (anim.x < -3) { anim.wait = Math.max(1e-3, S.gap); return null; }
  return anim.x;
}
function lamps(x) {
  if (x == null) return [];
  const out = [];
  for (const s of [-0.5, 0.5]) {
    const p = [x, S.lat + s * S.spacing, OWN.z], d = p.map((v, i) => v - EYE[i]), r = Math.hypot(...d);
    if (d[0] < 0.3) continue;                                           // behind or beside us: out of view
    let I = S.cd;
    if (S.oncSrc === 'from beam table' && oncTable) {                  // their frame faces -x, their right is +y: lamp → eye
      const e = d.map((v) => -v / r);                                   // lamp → eye, unit
      const H = Math.atan2(e[1], -e[0]) / DEG, V = Math.asin(e[2]) / DEG; // their forward = -x (a = -e.x), their right = +y (b = e.y)
      I = lutAt(oncTable, H, V) * S.oncScale;
    }
    out.push({ dir: d.map((v) => v / r), r, I, E: I / (r * r), angR: S.lens / r });
  }
  return out;
}
const ageF = () => 1 + Math.pow(S.age / 62.5, 4);
function psi(th) {   // equivalent veiling luminance per lux at the eye, θ in degrees
  if (S.veilLaw !== 'CIE 146 general') return 10 / (th * th);
  return 10 / (th * th * th) + (5 / (th * th) + 0.1 * S.pig / th) * ageF() + 2.5e-3 * S.pig;   // CIE 146:2002 general equation
}
const hdrOn = () => S.canvasMode === 'extended' && S.curve.includes('HDR');
function exposure(L) {
  if (S.expo !== 'adapt') return { k: Math.pow(2, S.ev) / L_REF };
  const vs = S.veilMode === 'off' ? 0 : S.veilStr;
  let veil = 0; for (const q of L) { const th = Math.max(1, Math.acos(Math.min(1, q.dir[0])) / DEG); veil += q.E * psi(th); }
  const white = L_REF / Math.pow(2, S.ev) + vs * veil; return { k: 1 / white, white };
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Starburst table: per polar-angle bin, (running sum of amplitude, length factor). Built once per pattern change.
function spikeTable() {
  const rnd = mulberry32(Math.round(S.spikeSeed) * 2654435761), n = Math.round(S.spikeCount), w = S.spikeWidth * DEG;
  const spokes = Array.from({ length: n }, () => ({ phi: rnd() * 2 * Math.PI, a: 0.3 + 0.7 * rnd() * rnd(), l: 1 - S.spikeLenJit * rnd() }));
  const t = new Float32Array(2 * BINS), baseLen = 0.35;
  for (let b = 0; b < BINS; b++) {
    const phi = (b + 0.5) / BINS * 2 * Math.PI; let amp = S.spikeBase, lw = S.spikeBase * baseLen;
    for (const s of spokes) { let d = phi - s.phi; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); const g = s.a * Math.exp(-(d / w) * (d / w)); amp += g; lw += g * s.l; }
    t[2 * b] = amp; t[2 * b + 1] = amp > 0 ? lw / amp : 1;
  }
  for (let b = 1; b < BINS; b++) t[2 * b] += t[2 * (b - 1)];   // r becomes the running sum, so the shader can average over any arc (anti-aliasing)
  return t;
}

// ---------------------------------------------------------------- WGSL
const COMMON = /* wgsl */`
const DEG = 0.017453292519943295;
struct Params {
  view: vec4f,    // W, H, tanH, tanV
  expo: vec4f,    // k, eyeZ, nLamps, ownGain
  veil: vec4f,    // mode (0 off, 1 physical, 2 perceptual), strength, cap, floorDeg
  core: vec4f,    // core width rad (0 = off), pixel sigma rad, target (0 off, 1 board, 2 deer), target x
  core2: vec4f,   // shape (0 gaussian, 1 moffat), beta, target lateral, target reflectance
  spike: vec4f,   // on, lenDeg, gain, taper
  spike2: vec4f,  // rotation rad, bins, table total, strip on
  tone: vec4f,    // curve (0 SDR, 1 HDR shoulder), peak, knee, bloom on
  beam: vec4f,    // h0, v0, step, -
  beamN: vec4f,   // nh, nv, -, -
  own: vec4f,     // own lamp x, centre y, half spacing, z
  veil2: vec4f,   // law (0 Stiles–Holladay, 1 CIE 146 general), age factor, pigment p, display multiplier (SDR boost)
  strip: array<vec4f, 3>,    // headroom patches, × paper white
  lampDir: array<vec4f, 4>,  // unit direction xyz, E lux
  lampCol: array<vec4f, 4>,  // rgb (unit luminance), angular radius rad
};
@group(0) @binding(0) var<uniform> P: Params;
fn rayDir(px: vec2f) -> vec3f { let uv = px / P.view.xy; return normalize(vec3f(1.0, -(2.0 * uv.x - 1.0) * P.view.z, (1.0 - 2.0 * uv.y) * P.view.w)); }
fn angBetween(a: vec3f, b: vec3f) -> f32 { return 2.0 * asin(min(1.0, length(a - b) * 0.5)); }   // accurate at tiny angles, unlike acos(dot)
`;
const PARAM_VEC4S = 12 + 3 + 4 + 4;
const VS = /* wgsl */`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}`;
// Scene radiance (cd/m²): sky, road lit by our own beam table, a target, the oncoming lamps as small PSF-spread sources.
const SCENE = COMMON + VS + /* wgsl */`
@group(0) @binding(1) var beamT: texture_2d<f32>;
fn bt(i: i32, j: i32) -> f32 { return textureLoad(beamT, vec2i(i, j), 0).r; }
fn lut(h: f32, v: f32) -> f32 {   // drive.js lutAt: bilinear between cell centres, 0 outside the table
  let fx = (h - P.beam.x) / P.beam.z - 0.5; let fy = (v - P.beam.y) / P.beam.z - 0.5;
  let i = i32(floor(fx)); let j = i32(floor(fy));
  if (i < 0 || j < 0 || i + 1 >= i32(P.beamN.x) || j + 1 >= i32(P.beamN.y)) { return 0.0; }
  let tx = fx - f32(i); let ty = fy - f32(j);
  return mix(mix(bt(i, j), bt(i + 1, j), tx), mix(bt(i, j + 1), bt(i + 1, j + 1), tx), ty);
}
fn ownE(pt: vec3f, n: vec3f) -> f32 {   // illuminance from our own two lamps (convention A: H = atan2(right, forward), V = asin(up))
  var E = 0.0;
  for (var s = -1.0; s <= 1.0; s += 2.0) {
    let d = pt - vec3f(P.own.x, P.own.y + s * P.own.z, P.own.w);
    let r2 = dot(d, d); let r = sqrt(r2); let u = d / r;
    let I = lut(atan2(-u.y, u.x) / DEG, asin(clamp(u.z, -1.0, 1.0)) / DEG) * P.expo.w;
    E += I * max(0.0, dot(n, -u)) / r2;
  }
  return E;
}
fn inRect(p: vec3f, y0: f32, y1: f32, z0: f32, z1: f32) -> bool { return p.y > y0 && p.y < y1 && p.z > z0 && p.z < z1; }
fn deer(p: vec3f, c: f32) -> bool {   // side-on silhouette, head to the left: legs, body, neck, head (metres)
  let y = p.y - c;
  if (inRect(p, c - 0.7, c + 0.7, 0.75, 1.25)) { return true; }                       // body
  if (p.z > 0.0 && p.z < 0.8 && (abs(y - 0.55) < 0.035 || abs(y - 0.42) < 0.035 || abs(y + 0.5) < 0.04 || abs(y + 0.62) < 0.04)) { return true; }   // legs
  if (inRect(p, c + 0.5, c + 0.78, 1.15, 1.6)) { return true; }                      // neck
  if (inRect(p, c + 0.6, c + 1.05, 1.5, 1.72)) { return true; }                      // head
  return false;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dir = rayDir(fc.xy); let eye = vec3f(0.0, 0.0, P.expo.y);
  var L = vec3f(0.003 + 0.02 * exp(-max(dir.z, 0.0) / 0.03));       // night sky with a faint horizon glow
  var tHit = 1e9;
  if (dir.z < 0.0) {
    tHit = -eye.z / dir.z; let p = eye + tHit * dir; let y = p.y;
    var rho = 0.04;                                                     // verge
    if (y > -1.85 && y < 5.35) { rho = 0.07; }                          // asphalt
    if (abs(y + 1.8) < 0.06 || abs(y - 5.3) < 0.06) { rho = 0.3; }      // edge lines
    if (abs(y - 1.75) < 0.06 && fract(p.x / 9.0) < 0.33) { rho = 0.3; } // centre dashes
    L = vec3f(rho / 3.14159265 * ownE(p, vec3f(0.0, 0.0, 1.0)) + 0.002);
  }
  if (P.core.z > 0.5 && dir.x > 0.0) {                                  // target, a flat cut-out facing us
    let t = P.core.w / dir.x; let p = eye + t * dir; let c = P.core2.z;
    var hit = false;
    if (P.core.z < 1.5) { hit = inRect(p, c - 0.25, c + 0.25, 0.0, 1.7); } else { hit = deer(p, c); }
    if (t < tHit && hit) { L = vec3f(P.core2.w / 3.14159265 * ownE(p, vec3f(-1.0, 0.0, 0.0)) + 0.002); }
  }
  for (var i = 0; i < 4; i++) {
    if (f32(i) >= P.expo.z) { break; }
    let ld = P.lampDir[i]; let lc = P.lampCol[i];
    let th = angBetween(dir, ld.xyz);
    let base = pow(lc.w * 0.5, 2.0) + P.core.y * P.core.y;            // lens size ⊕ pixel
    if (P.core2.x > 0.5 && P.core.x > 0.0) {
      // Moffat with its tail set by α alone: (β-1)/π · α^(2β-2) · (a² + θ²)^-β, a² = α² + lens/pixel floor.
      // That carries (α²/a²)^(β-1) of the energy; the rest goes into a Gaussian of the floor's width, so the total stays E
      // and the tail no longer depends on render width or lamp size (the old rule widened α by the floor).
      // The SDR veil boost (veil2.w) scales the tail too: with the CIE veil off, the tail is the veil.
      let al2 = P.core.x * P.core.x; let a2 = al2 + 2.0 * base; let b = P.core2.y;
      let kept = pow(al2 / a2, b - 1.0);
      L += ld.w * (P.veil2.w * (b - 1.0) / 3.14159265 * pow(al2, b - 1.0) * pow(a2 + th * th, -b) + (1.0 - kept) / (6.2831853 * base) * exp(-th * th / (2.0 * base))) * lc.rgb;
    } else {
      let s2 = base + P.core.x * P.core.x;
      L += ld.w / (6.2831853 * s2) * exp(-th * th / (2.0 * s2)) * lc.rgb;   // integrates to E over solid angle
    }
  }
  return vec4f(min(L, vec3f(65504.0)), 1.0);
}`;
const BRIGHT = VS + /* wgsl */`
struct U { a: vec4f, b: vec4f, c: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {   // FS_BRIGHT: brightCap(L·k - 1), 2×2 average
  let base = vec2i(fc.xy) * 2; let hi = vec2i(textureDimensions(src)) - 1; var s = vec3f(0.0);
  for (var j = 0; j < 2; j++) { for (var i = 0; i < 2; i++) { let x = max(textureLoad(src, min(base + vec2i(i, j), hi), 0).rgb * u.a.x - 1.0, vec3f(0.0)); s += 64.0 * x / (64.0 + x); } }
  return vec4f(s * 0.25, 1.0);
}`;
const REDUCE = VS + /* wgsl */`
@group(0) @binding(1) var src: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let base = vec2i(fc.xy) * 2; let hi = vec2i(textureDimensions(src)) - 1; var s = vec3f(0.0);
  for (var j = 0; j < 2; j++) { for (var i = 0; i < 2; i++) { s += textureLoad(src, min(base + vec2i(i, j), hi), 0).rgb; } }
  return vec4f(s * 0.25, 1.0);
}`;
const BLUR = VS + /* wgsl */`
struct U { a: vec4f, b: vec4f, c: vec4f };   // a: size.xy, srcSize.xy · b: dir.xy, sigma, scale · c: radius
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {   // FS_BLUR
  let uv = fc.xy / u.a.xy; let rad = i32(u.c.x); var s = vec3f(0.0); var norm = 0.0;
  for (var i = -rad; i <= rad; i++) { let w = exp(-0.5 * pow(f32(i) / u.b.z, 2.0)); s += textureSampleLevel(src, samp, uv + f32(i) * u.b.xy / u.a.zw, 0.0).rgb * w; norm += w; }
  return vec4f(s / norm * u.b.w, 1.0);
}`;
const FINAL = COMMON + VS + /* wgsl */`
@group(0) @binding(1) var hdrT: texture_2d<f32>;
@group(0) @binding(2) var accT: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var spikeT: texture_2d<f32>;
fn aces1(x: f32) -> f32 { let y = max(x, 0.0); return (y * (2.51 * y + 0.03)) / (y * (2.43 * y + 0.59) + 0.14); }
fn curve(x: f32) -> f32 {
  let sdr = min(aces1(x), 1.0);
  if (P.tone.x < 0.5) { return sdr; }
  let x0 = P.tone.z; let peak = P.tone.y;
  if (x <= x0) { return sdr; }
  let y0 = min(aces1(x0), 1.0); let room = peak - y0;
  if (room <= 0.0) { return sdr; }
  let s0 = max((aces1(x0 + 1e-3) - aces1(x0 - 1e-3)) / 2e-3, 1e-3);    // slope at the knee, so the join is smooth
  return y0 + room * (1.0 - exp(-(x - x0) * s0 / room));
}
fn enc(c: f32) -> f32 { return select(1.055 * pow(c, 1.0 / 2.4) - 0.055, 12.92 * c, c <= 0.0031308); }   // sRGB, extended above 1
fn spikeBin(i: i32) -> vec2f { return textureLoad(spikeT, vec2i(i, 0), 0).rg; }
fn spikeCum(x: f32) -> f32 {   // running sum of amplitude up to bin position x (bins, any real x, wraps)
  let nb = P.spike2.y; let w = floor(x / nb); let xr = x - w * nb; let i = min(i32(floor(xr)), i32(nb) - 1); let fr = xr - f32(i);
  var c0 = 0.0; if (i > 0) { c0 = spikeBin(i - 1).r; }
  return w * P.spike2.z + c0 + (spikeBin(i).r - c0) * fr;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  if (P.spike2.w > 0.5 && fc.y > P.view.y * 0.87) {                     // headroom strip: fixed display values, no tone curve
    let cell = fc.x / P.view.x * 10.0; let idx = min(i32(cell), 9);
    if (fract(cell) < 0.04 || fc.y < P.view.y * 0.875) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    let v = P.strip[idx / 4][idx % 4]; let e = enc(v);
    return vec4f(e, e, e, 1.0);
  }
  let dir = rayDir(fc.xy); let k = P.expo.x;
  let hdr = textureLoad(hdrT, vec2i(fc.xy), 0).rgb;
  var veil = vec3f(0.0); var spikes = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    if (f32(i) >= P.expo.z) { break; }
    let ld = P.lampDir[i]; let E = ld.w; let rgb = P.lampCol[i].rgb;
    let thDeg = angBetween(dir, ld.xyz) / DEG;
    if (P.veil.x > 0.5) {
      let t = max(P.veil.w, thDeg); var psi = 10.0 / (t * t);
      if (P.veil2.x > 0.5) { psi = 10.0 / (t * t * t) + (5.0 / (t * t) + 0.1 * P.veil2.z / t) * P.veil2.y + 2.5e-3 * P.veil2.z; }   // CIE 146:2002 general
      veil += psi * E * rgb;
    }
    if (P.spike.x > 0.5 && thDeg < P.spike.y && thDeg > 1e-5) {
      let e1 = normalize(cross(ld.xyz, vec3f(0.0, 0.0, 1.0))); let e2 = cross(e1, ld.xyz);
      let phi = atan2(dot(dir, e2), dot(dir, e1)) + P.spike2.x;
      let nb = P.spike2.y; let f = fract(phi / 6.2831853) * nb;
      let arcH = 0.5 * max(1.0, P.core.y * 2.0 / (thDeg * DEG) / 6.2831853 * nb);   // at least one pixel of arc
      let amp = (spikeCum(f + arcH) - spikeCum(f - arcH)) / (2.0 * arcH);
      let lenF = spikeBin(i32(f) % i32(nb)).g;
      let t = clamp(thDeg / max(P.spike.y * lenF, 1e-4), 0.0, 1.0);
      spikes += P.spike.z * E * amp * pow(1.0 - t, P.spike.w) * rgb;
    }
  }
  var lin = (hdr + spikes) * k;
  if (P.veil.x > 1.5) { let v = k * P.veil.y * P.veil2.w * veil; lin += P.veil.z * v / (1.0 + v); }   // perceptual: haze, never white
  else if (P.veil.x > 0.5) { lin += k * P.veil.y * P.veil2.w * veil; }                                 // physical: the drive today
  if (P.tone.w > 0.5) { lin += textureSampleLevel(accT, samp, fc.xy / P.view.xy, 0.0).rgb; }
  return vec4f(enc(curve(lin.r)), enc(curve(lin.g)), enc(curve(lin.b)), 1.0);
}`;

// ---------------------------------------------------------------- WebGPU
const canvas = $('c');
let spikeTotal = 0, device, ctx, pipes, sampler, paramBuf, spikeTex, spikeKey = '', T = {}, draws = null, confState = { requested: '', got: null };
let beamTex = null, beamName = '', beamGrid = GRID, beamLoading = '', W = 0, H = 0, frameQueued = false, lastCanvasMode = null, rehdrCount = 0;
const FMT = 'rgba16float';
const perf = { fps: 0, lastFrame: 0, gpuMs: 0, cpuMs: 0, pending: false };

function showMsg(t) { const m = $('msg'); m.textContent = t; m.classList.add('show'); }

async function init() {
  buildUI(); syncUI();
  if (!navigator.gpu) { showMsg('WebGPU is not available in this browser, so there is no HDR path. Needs Safari 26+ (iOS 26) or a recent Chrome.'); $('readout').textContent = readoutText(); return; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { showMsg('WebGPU: no adapter.'); return; }
  device = await adapter.requestDevice();
  device.lost.then((i) => showMsg('GPU device lost: ' + i.message + '. Reload the page.'));
  device.addEventListener?.('uncapturederror', (e) => showMsg('GPU error: ' + e.error.message));
  ctx = canvas.getContext('webgpu');
  sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  paramBuf = device.createBuffer({ size: PARAM_VEC4S * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  spikeTex = device.createTexture({ size: [BINS, 1], format: 'rg32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const mod = (code) => { const m = device.createShaderModule({ code }); m.getCompilationInfo?.().then((ci) => { const errs = ci.messages.filter((x) => x.type === 'error'); if (errs.length) showMsg('WGSL: ' + errs.map((x) => x.lineNum + ': ' + x.message).join(' | ')); }); return m; };
  const pipe = (code, format, blend) => { const m = mod(code); return device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' } }); };
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  pipes = { scene: pipe(SCENE, FMT), bright: pipe(BRIGHT, FMT), reduce: pipe(REDUCE, FMT), blurH: pipe(BLUR, FMT), blurV: pipe(BLUR, FMT, add), final: pipe(FINAL, FMT) };
  await ensureBeams();
  configure(); lastCanvasMode = S.canvasMode;
  new ResizeObserver(() => request()).observe(canvas);
  matchMedia('(dynamic-range: high)').addEventListener?.('change', () => request());
  // Coming back to the page: iOS seemed to drop the HDR headroom (Anya, 11-27), and toggling extended off and on brought it back.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rerequestHDR('page visible'); });
  window.addEventListener('pageshow', () => rerequestHDR('pageshow'));
  request();
}

// Our beam goes to the GPU as a texture; their beam stays on the CPU (two lamps, one lookup each per frame).
async function ensureBeams() {
  const wantOwn = S.ownBeam, wantOnc = S.oncSrc === 'from beam table' ? S.oncBeam : null;
  try {
    if (wantOwn !== beamName) {
      beamLoading = wantOwn; renderReadout();
      const t = await getBeam(wantOwn);
      if (S.ownBeam !== wantOwn) return;   // changed again while loading
      if (beamTex) beamTex.destroy();
      beamTex = device.createTexture({ size: [t.nh, t.nv], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      device.queue.writeTexture({ texture: beamTex }, t.data, { bytesPerRow: t.nh * 4 }, [t.nh, t.nv]);
      beamGrid = t; beamName = wantOwn; draws = null;   // bind groups hold the texture: rebuild them
    }
    oncTable = wantOnc ? await getBeam(wantOnc) : null;
    beamLoading = '';
  } catch (e) { beamLoading = ''; showMsg('Beam load failed: ' + e.message); }
  request();
}

function configure(mode) {
  mode = mode || (S.canvasMode === 'extended' ? 'extended' : 'standard');
  ctx.configure({ device, format: FMT, alphaMode: 'opaque', toneMapping: { mode }, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  let got = null; try { got = ctx.getConfiguration ? ctx.getConfiguration() : undefined; } catch (e) { got = 'error: ' + e.message; }
  confState = { requested: mode, got };
}
// The workaround Anya found by hand: drop to standard for a frame, then ask for extended again.
function rerequestHDR(why) {
  if (!device || S.canvasMode !== 'extended') return;
  configure('standard'); frame();
  requestAnimationFrame(() => requestAnimationFrame(() => { configure(); rehdrCount++; confState.why = why; frame(); }));
}

function tex(name, w, h, usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING) {
  if (T[name]) T[name].destroy(); T[name] = device.createTexture({ size: [w, h], format: FMT, usage }); return T[name];
}
function resize() {
  const css = canvas.getBoundingClientRect().width || 960, dpr = window.devicePixelRatio || 1;
  const want = S.sim === 'native' ? Math.round(css * dpr) : Math.min(Number(S.sim), Math.round(Math.max(css * dpr, 320)));
  const w = Math.max(64, want), h = Math.max(36, Math.round(w * 9 / 16));
  if (w === W && h === H && draws) return;
  if (w !== W || h !== H) {
    W = w; H = h; canvas.width = W; canvas.height = H;
    const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
    tex('hdr', W, H); tex('acc', hw, hh);
    tex('meas', W, H, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
    for (const f of GLARE_BANDS) { tex('s' + f, Math.max(1, Math.ceil(hw / f)), Math.max(1, Math.ceil(hh / f))); tex('p' + f, Math.max(1, Math.ceil(hw / f)), Math.max(1, Math.ceil(hh / f))); }
  }
  const ubuf = () => device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg = (p, entries) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map((resource, binding) => resource && { binding, resource }).filter(Boolean) });
  const view = (n) => T[n].createView();
  draws = { scene: bg(pipes.scene, [{ buffer: paramBuf }, beamTex.createView()]), final: bg(pipes.final, [{ buffer: paramBuf }, view('hdr'), view('acc'), sampler, spikeTex.createView()]) };
  draws.brightU = ubuf(); draws.bright = bg(pipes.bright, [{ buffer: draws.brightU }, view('hdr')]);
  draws.bands = GLARE_BANDS.map((f, i) => {
    const hU = ubuf(), vU = ubuf();
    return { f, hU, vU,
      reduce: f === 1 ? null : bg(pipes.reduce, [null, view('s' + GLARE_BANDS[i - 1])]),
      h: bg(pipes.blurH, [{ buffer: hU }, view('s' + f), sampler]),
      v: bg(pipes.blurV, [{ buffer: vU }, view('p' + f), sampler]) };
  });
}

const looping = () => S.animate || S.continuous;
function request() { if (frameQueued || !device) return; frameQueued = true; requestAnimationFrame((t) => { frameQueued = false; frame(t); if (looping()) request(); }); }
function changed() {
  save(); syncUI();
  if (S.ownBeam !== beamName || (S.oncSrc === 'from beam table' && (!oncTable || beamCache.get(S.oncBeam) !== oncTable)) || (S.oncSrc !== 'from beam table' && oncTable)) ensureBeams();
  request();
}

function writeParams(L, k) {
  const tanH = Math.tan(S.hfov * DEG / 2), a = new Float32Array(PARAM_VEC4S * 4), col = lampRGB(S.color);
  const coreW = !S.core ? 0 : (S.coreShape === 'moffat' ? S.coreAlpha : S.coreSigma) * DEG;
  a.set([W, H, tanH, tanH * H / W], 0);
  a.set([k, EYE_Z, L.length, S.own], 4);
  a.set([{ off: 0, physical: 1, perceptual: 2 }[S.veilMode], S.veilStr, S.veilCap, S.veilFloor], 8);
  a.set([coreW, 0.5 * 2 * tanH / W, { off: 0, 'grey board': 1, deer: 2 }[S.target] || 0, S.tdist], 12);
  a.set([S.core && S.coreShape === 'moffat' ? 1 : 0, S.coreBeta, S.tlat, S.trho], 16);
  a.set([S.spike ? 1 : 0, S.spikeLen, S.spikeGain, S.spikeTaper], 20);
  a.set([S.spikeRot * DEG, BINS, spikeTotal, S.strip ? 1 : 0], 24);
  a.set([S.curve.includes('HDR') ? 1 : 0, S.peak, S.knee, S.bloom && S.bloomStr > 0 ? 1 : 0], 28);
  a.set([beamGrid.h0, beamGrid.v0, beamGrid.step, 0], 32);
  a.set([beamGrid.nh, beamGrid.nv, 0, 0], 36);
  a.set([OWN.x, OWN.y, OWN.half, OWN.z], 40);
  a.set([S.veilLaw === 'CIE 146 general' ? 1 : 0, ageF(), S.pig, hdrOn() ? 1 : S.sdrBoost], 44);
  a.set(STRIP, 48);
  L.forEach((q, i) => { a.set([...q.dir, q.E], 60 + 4 * i); a.set([...col, q.angR], 76 + 4 * i); });
  device.queue.writeBuffer(paramBuf, 0, a);
}

function encodeFrame(target, now, opt = {}) {
  if (S.canvasMode !== lastCanvasMode) { configure(); lastCanvasMode = S.canvasMode; }
  if (!beamTex) return null;
  resize();
  const key = [S.spikeSeed, S.spikeCount, S.spikeWidth, S.spikeLenJit, S.spikeBase].join();
  if (key !== spikeKey) { const t = spikeTable(); spikeTotal = t[2 * (BINS - 1)]; device.queue.writeTexture({ texture: spikeTex }, t, { bytesPerRow: BINS * 8 }, [BINS, 1]); spikeKey = key; }
  const keep = S; if (opt.over) S = { ...S, ...opt.over };   // measure's glare-off pass: same frame, glare terms off
  try {
  const x = 'x' in opt ? opt.x : carDistance(now ?? performance.now()), L = lamps(x), ex = 'k' in opt ? { k: opt.k } : exposure(L); writeParams(L, ex.k);
  const enc = device.createCommandEncoder();
  const pass = (view, pipe, group, load = 'clear') => { const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: load, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] }); p.setPipeline(pipe); p.setBindGroup(0, group); p.draw(3); p.end(); };
  pass(T.hdr.createView(), pipes.scene, draws.scene);
  if (S.bloom && S.bloomStr > 0) {   // the drive's pyramid: bright pass at half size, then per band reduce → H blur → V blur added into acc
    const sigma = glareSigma(W, S.hfov), rad = Math.ceil(3 * sigma), hw = T.acc.width, hh = T.acc.height;
    device.queue.writeBuffer(draws.brightU, 0, new Float32Array([ex.k, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    pass(T.s1.createView(), pipes.bright, draws.bright);
    draws.bands.forEach((b, i) => {
      const s = T['s' + b.f];
      if (b.reduce) pass(s.createView(), pipes.reduce, b.reduce);
      device.queue.writeBuffer(b.hU, 0, new Float32Array([s.width, s.height, s.width, s.height, 1, 0, sigma, 1, rad, 0, 0, 0]));
      pass(T['p' + b.f].createView(), pipes.blurH, b.h);
      device.queue.writeBuffer(b.vU, 0, new Float32Array([hw, hh, s.width, s.height, 0, 1, sigma, S.bloomStr * GLARE_WEIGHT, rad, 0, 0, 0]));
      pass(T.acc.createView(), pipes.blurV, b.v, i === 0 ? 'clear' : 'load');
    });
  }
  pass(target, pipes.final, draws.final);
  return { enc, L, ex, x };
  } finally { S = keep; }
}

let last = null;
function frame(now) {
  if (!device) return;
  const t0 = performance.now();
  if (S.canvasMode !== lastCanvasMode) { configure(); lastCanvasMode = S.canvasMode; }
  if (!beamTex) { renderReadout(); return; }
  resize();   // before fetching the canvas texture, so it already has the new size
  const r = encodeFrame(ctx.getCurrentTexture().createView(), now);
  const tSubmit = performance.now(); device.queue.submit([r.enc.finish()]);
  perf.cpuMs = tSubmit - t0;
  if (!perf.pending) { perf.pending = true; device.queue.onSubmittedWorkDone().then(() => { const g = performance.now() - tSubmit; perf.gpuMs = perf.gpuMs ? perf.gpuMs * 0.8 + g * 0.2 : g; perf.pending = false; }); }
  if (perf.lastFrame && now) { const f = 1000 / Math.max(1, now - perf.lastFrame); perf.fps = perf.fps ? perf.fps * 0.9 + f * 0.1 : f; }
  perf.lastFrame = looping() ? now : 0;
  last = { L: r.L, ex: r.ex, x: r.x };
  renderReadout();
}

let readoutAt = 0;
function renderReadout() { const t = performance.now(); if (looping() && t - readoutAt < 250) return; readoutAt = t; $('readout').textContent = readoutText(); }
function readoutText() {
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return 'n/a'; } };
  const got = confState.got, tm = got && typeof got === 'object' ? (got.toneMapping ? got.toneMapping.mode : 'not reported (no toneMapping in config)') : (got === undefined ? 'getConfiguration() unavailable' : String(got));
  const lines = [
    'WebGPU            ' + (navigator.gpu ? 'yes' : 'NO'),
    'HDR screen (mq)   ' + mq('(dynamic-range: high)') + ' · video ' + mq('(video-dynamic-range: high)'),
    'toneMapping asked ' + (confState.requested || '-') + (rehdrCount ? ' · re-requested ×' + rehdrCount + (confState.why ? ' (' + confState.why + ')' : '') : ''),
    'toneMapping got   ' + (device ? tm : '-'),
    'format ' + (got && got.format ? got.format : FMT) + ' · dpr ' + (window.devicePixelRatio || 1) + ' · ' + W + '×' + H,
  ];
  if (confState.requested === 'extended' && tm !== 'extended') lines.push('⚠ extended was requested but not reported back: this browser is showing SDR.');
  if (beamLoading) lines.push('loading beam: ' + beamLoading + '…');
  if (last) {
    lines.push('', 'beam: ours ' + beamName + (S.oncSrc === 'from beam table' ? ' · theirs ' + S.oncBeam : ''));
    lines.push(last.x == null ? 'oncoming: none (gap)' : 'oncoming at ' + last.x.toFixed(1) + ' m: ' + last.L.map((q) => `${q.I.toFixed(0)} cd → E ${q.E.toFixed(3)} lx`).join(' · '));
    lines.push('exposure k ' + last.ex.k.toExponential(3) + (last.ex.white ? ' · adapted white ' + last.ex.white.toFixed(2) + ' cd/m²' : ' · white ' + (1 / last.ex.k).toFixed(2) + ' cd/m²'));
    lines.push(looping() ? `fps ${perf.fps.toFixed(1)} · GPU ≤ ${perf.gpuMs.toFixed(1)} ms · CPU ${perf.cpuMs.toFixed(1)} ms` : `CPU encode ${perf.cpuMs.toFixed(1)} ms (render on change; tick "Render every frame" for fps)`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- measure: saturated core size around the left lamp
function half(h) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * Math.pow(2, -14) * m / 1024 : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024); }
const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
async function readMeas(r) {   // the frame in T.meas as display-linear luminance (max of rgb), 1 = paper white
  const bpr = Math.ceil(W * 8 / 256) * 256, buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  r.enc.copyTextureToBuffer({ texture: T.meas }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
  device.queue.submit([r.enc.finish()]); await buf.mapAsync(GPUMapMode.READ);
  const u16 = new Uint16Array(buf.getMappedRange().slice(0)), stride = bpr / 2; buf.unmap(); buf.destroy();
  return (x, y) => { const o = y * stride + 4 * x; return Math.max(dec(half(u16[o])), dec(half(u16[o + 1])), dec(half(u16[o + 2]))); };
}
async function measure() {
  if (!device || !beamTex) return;
  const x = last ? last.x : S.dist;   // freeze the car where it is now
  const r = encodeFrame(T.meas.createView(), null, { x });
  const lum = await readMeas(r), k = r.ex.k;
  const tanH = Math.tan(S.hfov * DEG / 2), tanV = tanH * H / W;
  const pix = (d) => [Math.round((1 - d[1] / d[0] / tanH) / 2 * W - 0.5), Math.round((1 - d[2] / d[0] / tanV) / 2 * H - 0.5)];
  const out = [];
  if (r.L.length) {
    const q = r.L[0], [px, py] = pix(q.dir), [ox, oy] = r.L[1] ? pix(r.L[1].dir) : [-1, -1];
    const fill = (thr) => {   // 4-connected region at or above thr, grown from the lamp pixel
      if (px < 0 || py < 0 || px >= W || py >= H || !(lum(px, py) >= thr)) return null;
      const seen = new Uint8Array(W * H), st = [[px, py]]; let n = 0, merged = false, x0 = px, x1 = px, y0 = py, y1 = py; seen[py * W + px] = 1;
      while (st.length && n < 400000) {
        const [a0, b0] = st.pop(); n++; if (a0 === ox && b0 === oy) merged = true; x0 = Math.min(x0, a0); x1 = Math.max(x1, a0); y0 = Math.min(y0, b0); y1 = Math.max(y1, b0);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = a0 + dx, b = b0 + dy; if (a < 0 || b < 0 || a >= W || b >= H || seen[b * W + a]) continue; seen[b * W + a] = 1; if (lum(a, b) >= thr) st.push([a, b]); }
      }
      const degPx = 2 * tanH / W / DEG;   // degrees per pixel near the image centre
      return { eqDiam: 2 * Math.sqrt(n / Math.PI) * degPx, w: (x1 - x0 + 1) * degPx, h: (y1 - y0 + 1) * degPx, merged };
    };
    const f = (m) => (m ? `equiv. diameter ${m.eqDiam.toFixed(2)}° · box ${m.w.toFixed(2)}° × ${m.h.toFixed(2)}°${m.merged ? ' · MERGED with the other lamp' : ''}` : 'none');
    out.push(`left lamp E ${q.E.toFixed(3)} lx at ${q.r.toFixed(1)} m · peak shown ${lum(Math.min(W - 1, Math.max(0, px)), Math.min(H - 1, Math.max(0, py))).toFixed(2)}× paper white`,
      `≥ 0.95 white (looks saturated):  ${f(fill(0.95))}`, `> 1.0 white (above paper white): ${f(fill(1.0001))}`);
  } else out.push('No oncoming lamp in view (gap): lamp size skipped.');
  if (S.target !== 'off') {
    // Target contrast, with glare and with every glare term off, same frame and same exposure. Weber C = (Lt - Lb) / Lb on
    // display-linear values. Body and background boxes in metres at the target's distance, mid-body height.
    const c = S.tlat, deer = S.target === 'deer';
    const body = deer ? [c - 0.5, c + 0.5, 0.85, 1.15] : [c - 0.2, c + 0.2, 0.3, 1.4];
    const bgs = deer ? [[c - 1.3, c - 0.9, 0.85, 1.15], [c + 1.2, c + 1.5, 0.85, 1.15]] : [[c - 0.7, c - 0.45, 0.3, 1.4], [c + 0.45, c + 0.7, 0.3, 1.4]];
    const boxPix = ([y0, y1, z0, z1]) => { const A = pix([S.tdist, y0, z0 - EYE_Z]), B = pix([S.tdist, y1, z1 - EYE_Z]); return [Math.min(A[0], B[0]), Math.max(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[1], B[1])]; };
    const mean = (L, bx) => { const [x0, x1, y0, y1] = boxPix(bx); let s = 0, n = 0; for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let xx = Math.max(0, x0); xx <= Math.min(W - 1, x1); xx++) { s += L(xx, y); n++; } return n ? s / n : NaN; };
    const contrast = (L) => { const t = mean(L, body), b = (mean(L, bgs[0]) + mean(L, bgs[1])) / 2; return { t, b, C: (t - b) / b }; };
    const lumOff = await readMeas(encodeFrame(T.meas.createView(), null, { x, k, over: { veilMode: 'off', spike: false, core: false, bloom: false } }));
    // Veiling glare adds the same light over the target and its immediate background, so: glare at the target G = mean of
    // (on - off) over the body, and C_glare = (T - B) / (B + G) from the glare-off values. Comparing raw on-frame boxes would
    // misread the glare's own gradient as contrast.
    const off = contrast(lumOff), [bx0, bx1] = boxPix(body), G = mean((xx, y) => lum(xx, y) - lumOff(xx, y), body);
    const Con = (off.t - off.b) / (off.b + G);
    const pc = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + '%' : 'n/a');
    out.push('', `${S.target} at ${S.tdist.toFixed(0)} m, ${bx1 - bx0 + 1} px wide · Weber contrast, display-linear (1 = paper white):`,
      `  without glare: ${pc(off.C)}  (target ${off.t.toFixed(4)}, background ${off.b.toFixed(4)})`,
      `  with glare:    ${pc(Con)}  (glare light at the target ${G.toFixed(4)})`,
      bx1 - bx0 < 3 ? '  ⚠ target is under 3 px wide: numbers are mostly pixel noise' : '',
      '  Display values after the tone curve, so this is contrast as shown on screen, not at the eye.');
  }
  $('measured').textContent = out.filter((l) => l !== '').join('\n');
}

window.addEventListener('resize', request);
init().catch((e) => { showMsg('Startup failed: ' + (e && e.message || e)); console.error(e); });
