// HDR headlamp spike: does real HDR output plus a perceptual glare model read better than the drive's
// current veil + bloom? Raw WebGPU, no three.js. Units follow the drive view: luminance in cd/m², eye
// illuminance E in lux, EV with L_REF = 10 cd/m² at display white for EV 0. See README.md.

const DEG = Math.PI / 180;
const L_REF = 10;                                   // drive.js: EV 0 puts 10 cd/m² at display white
const GLARE_BANDS = [1, 2, 4, 8], GLARE_WEIGHT = 0.0075;   // drive.js / drive-anim.js, unchanged
const glareSigma = (w, fov) => Math.max(0.35, 1.5 * w / 640 * Math.tan(Math.PI / 6) / Math.tan(fov * DEG / 2));
const BINS = 4096;                                  // starburst angular table resolution
const STORE = 'hdr-headlamp-v1';

// ---------------------------------------------------------------- settings: every knob is one entry here
// type: r = range, s = select, c = checkbox. log: slider moves in log space.
const SPEC = [
  ['Scene', [
    { id: 'dist', label: 'Oncoming distance', type: 'r', min: 5, max: 300, def: 32, log: true, unit: 'm', dp: 0 },
    { id: 'cd', label: 'Lamp intensity to eye', type: 'r', min: 50, max: 50000, def: 1000, log: true, unit: 'cd', dp: 0 },
    { id: 'color', label: 'Lamp colour', type: 's', opts: ['LED 5700K', 'Halogen', 'HID 4300K'], def: 'LED 5700K' },
    { id: 'lat', label: 'Lateral offset', type: 'r', min: 0, max: 8, def: 3.5, step: 0.1, unit: 'm', dp: 1 },
    { id: 'spacing', label: 'Lamp spacing', type: 'r', min: 0.8, max: 1.8, def: 1.4, step: 0.05, unit: 'm', dp: 2 },
    { id: 'lens', label: 'Lens radius', type: 'r', min: 0.01, max: 0.12, def: 0.05, step: 0.005, unit: 'm', dp: 3 },
    { id: 'hfov', label: 'Horizontal FOV', type: 'r', min: 30, max: 100, def: 60, step: 1, unit: '°', dp: 0 },
    { id: 'own', label: 'Own beam gain', type: 'r', min: 0, max: 3, def: 1, step: 0.05, unit: '×', dp: 2 },
    { id: 'target', label: 'Grey target', type: 'c', def: true },
    { id: 'tdist', label: 'Target distance', type: 'r', min: 5, max: 150, def: 25, log: true, unit: 'm', dp: 0 },
    { id: 'sim', label: 'Render width', type: 's', opts: ['640', '960', '1280', '1600', 'native'], def: '960' },
  ], 'Oncoming pair in the left lane. "Lamp intensity to eye" is what each lamp sends toward you; E = I / r². The grey target (reflectance 0.15) is for checking that the veil still eats contrast.'],
  ['Exposure', [
    { id: 'expo', label: 'Mode', type: 's', opts: ['fixed', 'adapt'], def: 'fixed' },
    { id: 'ev', label: 'EV', type: 'r', min: -4, max: 6, def: 2, step: 0.25, unit: '', dp: 2 },
  ], 'fixed: EV 0 puts 10 cd/m² at white. adapt: the straight-ahead veil (1° floor, as in the drive) is added to the white point, like the drive\'s adapt mode.'],
  ['Display', [
    { id: 'canvasMode', label: 'Canvas tone mapping', type: 's', opts: ['extended', 'standard'], def: 'standard' },
    { id: 'curve', label: 'Tone curve', type: 's', opts: ['ACES (SDR)', 'ACES + HDR shoulder'], def: 'ACES (SDR)' },
    { id: 'peak', label: 'HDR peak', type: 'r', min: 1, max: 16, def: 4, step: 0.25, unit: '× white', dp: 2 },
    { id: 'knee', label: 'Shoulder knee', type: 'r', min: 0.25, max: 4, def: 1, step: 0.05, unit: 'lin', dp: 2 },
  ], 'Canvas "extended" lets values above 1.0 show above paper white. The HDR shoulder keeps ACES below the knee and rolls on toward the peak above it, slope-matched. Peak is a guess at the screen\'s headroom: no API reports it. In standard mode anything above 1.0 clips.'],
  ['Veil (Stiles–Holladay 10·E/θ²)', [
    { id: 'veilMode', label: 'Veil drawn as', type: 's', opts: ['off', 'physical', 'perceptual'], def: 'physical' },
    { id: 'veilStr', label: 'Strength', type: 'r', min: 0, max: 2, def: 1, step: 0.05, unit: '×', dp: 2 },
    { id: 'veilCap', label: 'Perceptual cap', type: 'r', min: 0.05, max: 1, def: 0.4, step: 0.01, unit: '', dp: 2 },
    { id: 'veilFloor', label: 'Angle floor', type: 'r', min: 0.05, max: 2, def: 1, step: 0.05, unit: '°', dp: 2 },
  ], 'physical = the drive today (added as luminance). perceptual = cap·v/(1+v), so it reads as haze and never reaches white. Adaptation always uses the full veil.'],
  ['Bloom (the drive\'s current recipe)', [
    { id: 'bloom', label: 'On', type: 'c', def: true },
    { id: 'bloomStr', label: 'Strength', type: 'r', min: 0, max: 0.6, def: 0.1, step: 0.005, unit: '', dp: 3 },
  ], 'Port of FS_BRIGHT + the 4-band Gaussian pyramid. Drive levels: dry-low 0.035, dry 0.1, rain 0.3.'],
  ['Core PSF', [
    { id: 'core', label: 'On', type: 'c', def: false },
    { id: 'coreSigma', label: 'Sigma', type: 'r', min: 0.01, max: 0.6, def: 0.06, step: 0.01, unit: '°', dp: 2 },
  ], 'A fixed-size Gaussian spread of the lamp itself (energy kept). Replaces what the 1° veil floor was covering.'],
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
];
const ALL = SPEC.flatMap(([, items]) => items);
const DEFAULTS = Object.fromEntries(ALL.map((c) => [c.id, c.def]));

const PRESETS = {
  'Current · SDR':    { veilMode: 'physical',   veilFloor: 1,   bloom: true,  core: false, spike: false, curve: 'ACES (SDR)',          canvasMode: 'standard' },
  'Current · HDR':    { veilMode: 'physical',   veilFloor: 1,   bloom: true,  core: false, spike: false, curve: 'ACES + HDR shoulder', canvasMode: 'extended' },
  'Perceptual · SDR': { veilMode: 'perceptual', veilFloor: 0.3, bloom: false, core: true,  spike: true,  curve: 'ACES (SDR)',          canvasMode: 'standard' },
  'Perceptual · HDR': { veilMode: 'perceptual', veilFloor: 0.3, bloom: false, core: true,  spike: true,  curve: 'ACES + HDR shoulder', canvasMode: 'extended' },
};

let S = { ...DEFAULTS };
try { const saved = JSON.parse(localStorage.getItem(STORE) || 'null'); if (saved) for (const k in saved) if (k in DEFAULTS) S[k] = saved[k]; } catch (e) { /* private mode: defaults */ }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* ignore */ } };

// ---------------------------------------------------------------- UI built from SPEC
const $ = (id) => document.getElementById(id);
const inputs = {};
function fmt(c, v) { return c.type === 'r' ? Number(v).toFixed(c.dp ?? 2) + (c.unit ? ' ' + c.unit : '') : ''; }
function toSlider(c, v) { return c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) * 1000 : v; }
function fromSlider(c, x) { return c.log ? c.min * Math.pow(c.max / c.min, x / 1000) : Number(x); }
function buildUI() {
  const root = $('controls');
  for (const [title, items, help] of SPEC) {
    const d = document.createElement('details'); d.open = ['Display', 'Veil (Stiles–Holladay 10·E/θ²)', 'Starburst'].includes(title) || title === 'Scene';
    d.innerHTML = `<summary>${title}</summary>`;
    for (const c of items) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = c.label; lab.htmlFor = 'in-' + c.id;
      let el, out = document.createElement('output');
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
  $('reset').addEventListener('click', () => { S = { ...DEFAULTS }; syncUI(); changed(); });
  $('copy').addEventListener('click', async () => { const t = JSON.stringify(S, null, 1); $('json').value = t; try { await navigator.clipboard.writeText(t); $('copy').textContent = 'Copied'; } catch (e) { $('copy').textContent = 'Copy failed: select the box'; } setTimeout(() => { $('copy').textContent = 'Copy settings'; }, 1500); });
  $('measure').addEventListener('click', () => measure().catch((e) => { $('measured').textContent = 'Measure failed: ' + e.message; }));
}
function syncUI() {
  for (const id in inputs) {
    const { el, out, c } = inputs[id], v = S[id];
    if (c.type === 'r') { el.value = toSlider(c, v); out.textContent = fmt(c, v); } else if (c.type === 's') el.value = v; else el.checked = !!v;
  }
  for (const b of document.querySelectorAll('[data-preset]')) { const p = PRESETS[b.dataset.preset]; b.classList.toggle('on', Object.keys(p).every((k) => S[k] === p[k])); }
  $('json').value = JSON.stringify(S, null, 1);
}

// ---------------------------------------------------------------- scene numbers (CPU side)
const COLORS = { 'LED 5700K': [1, 0.97, 1.0], 'Halogen': [1.0, 0.8, 0.55], 'HID 4300K': [1.0, 0.95, 0.85] };
function lampRGB(name) { const c = COLORS[name] || [1, 1, 1], y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((v) => v / y); }   // unit luminance
const EYE = [0, 0, 1.2];
function lamps() {
  const out = [];
  for (const s of [-0.5, 0.5]) {
    const p = [S.dist, S.lat + s * S.spacing, 0.65], d = p.map((v, i) => v - EYE[i]), r = Math.hypot(...d);
    out.push({ dir: d.map((v) => v / r), r, E: S.cd / (r * r), angR: S.lens / r });
  }
  return out;
}
function exposure(L) {
  if (S.expo !== 'adapt') return { k: Math.pow(2, S.ev) / L_REF };
  const vs = S.veilMode === 'off' ? 0 : S.veilStr;
  let veil = 0; for (const q of L) { const th = Math.max(1, Math.acos(Math.min(1, q.dir[0])) / DEG); veil += 10 * q.E / (th * th); }
  const white = L_REF / Math.pow(2, S.ev) + vs * veil; return { k: 1 / white, white };
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Starburst table: per polar-angle bin, (amplitude, length factor). Built once per pattern change.
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
  core: vec4f,    // core sigma rad (0 = off), pixel sigma rad, target on, target x
  spike: vec4f,   // on, lenDeg, gain, taper
  spike2: vec4f,  // rotation rad, bins, table total, -
  tone: vec4f,    // curve (0 SDR, 1 HDR shoulder), peak, knee, bloom on
  lampDir: array<vec4f, 4>,  // unit direction xyz, E lux
  lampCol: array<vec4f, 4>,  // rgb (unit luminance), angular radius rad
};
@group(0) @binding(0) var<uniform> P: Params;
fn rayDir(px: vec2f) -> vec3f { let uv = px / P.view.xy; return normalize(vec3f(1.0, -(2.0 * uv.x - 1.0) * P.view.z, (1.0 - 2.0 * uv.y) * P.view.w)); }
fn angBetween(a: vec3f, b: vec3f) -> f32 { return 2.0 * asin(min(1.0, length(a - b) * 0.5)); }   // accurate at tiny angles, unlike acos(dot)
`;
const VS = /* wgsl */`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}`;
// Scene radiance (cd/m²): sky, road lit by our own low beams, a grey target, the oncoming lamps as small Gaussians.
const SCENE = COMMON + VS + /* wgsl */`
fn ownE(pt: vec3f, n: vec3f) -> f32 {   // illuminance from our own two low beams (a rough shape, tuning only)
  var E = 0.0;
  for (var s = -1.0; s <= 1.0; s += 2.0) {
    let d = pt - vec3f(1.5, 0.7 * s, 0.65); let r2 = dot(d, d); let r = sqrt(r2);
    let h = atan2(d.y, d.x) / DEG; let v = atan2(d.z, length(d.xy)) / DEG;
    let cut = mix(-0.6, 1.5, smoothstep(-1.0, -4.0, h));           // right-side kick-up
    var I = 20000.0 * P.expo.w * exp(-pow(h / select(16.0, 12.0, h > 0.0), 2.0)) * (1.0 - smoothstep(cut - 0.3, cut + 0.3, v))
          * (0.1 + 0.9 * exp(-pow((v + 1.2) / 2.0, 2.0)));             // hot spot just under the cutoff, ~10% toward the foreground
    I += 150.0 * P.expo.w;
    E += I * max(0.0, dot(n, -d / r)) / r2;
  }
  return E;
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
  if (P.core.z > 0.5 && dir.x > 0.0) {                                  // grey target, facing us
    let t = P.core.w / dir.x; let p = eye + t * dir;
    if (t < tHit && p.y > 0.9 && p.y < 1.4 && p.z > 0.0 && p.z < 1.7) { L = vec3f(0.15 / 3.14159265 * ownE(p, vec3f(-1.0, 0.0, 0.0)) + 0.002); }
  }
  for (var i = 0; i < 4; i++) {
    if (f32(i) >= P.expo.z) { break; }
    let ld = P.lampDir[i]; let lc = P.lampCol[i];
    let th = angBetween(dir, ld.xyz);
    let s2 = pow(lc.w * 0.5, 2.0) + P.core.x * P.core.x + P.core.y * P.core.y;   // lens size ⊕ core PSF ⊕ pixel
    L += ld.w / (6.2831853 * s2) * exp(-th * th / (2.0 * s2)) * lc.rgb;           // integrates to E over solid angle
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
  let dir = rayDir(fc.xy); let k = P.expo.x;
  let hdr = textureLoad(hdrT, vec2i(fc.xy), 0).rgb;
  var veil = vec3f(0.0); var spikes = vec3f(0.0);
  for (var i = 0; i < 4; i++) {
    if (f32(i) >= P.expo.z) { break; }
    let ld = P.lampDir[i]; let E = ld.w; let rgb = P.lampCol[i].rgb;
    let thDeg = angBetween(dir, ld.xyz) / DEG;
    if (P.veil.x > 0.5) { let t = max(P.veil.w, thDeg); veil += 10.0 * E / (t * t) * rgb; }
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
  if (P.veil.x > 1.5) { let v = k * P.veil.y * veil; lin += P.veil.z * v / (1.0 + v); }   // perceptual: haze, never white
  else if (P.veil.x > 0.5) { lin += k * P.veil.y * veil; }                                 // physical: the drive today
  if (P.tone.w > 0.5) { lin += textureSampleLevel(accT, samp, fc.xy / P.view.xy, 0.0).rgb; }
  return vec4f(enc(curve(lin.r)), enc(curve(lin.g)), enc(curve(lin.b)), 1.0);
}`;

// ---------------------------------------------------------------- WebGPU
const canvas = $('c');
let spikeTotal = 0, device, ctx, pipes, sampler, paramBuf, spikeTex, spikeKey = '', T = {}, draws = null, confState = { requested: '', got: null };
let W = 0, H = 0, frameQueued = false;
const FMT = 'rgba16float';

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
  paramBuf = device.createBuffer({ size: 15 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  spikeTex = device.createTexture({ size: [BINS, 1], format: 'rg32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const mod = (code) => { const m = device.createShaderModule({ code }); m.getCompilationInfo?.().then((ci) => { const errs = ci.messages.filter((x) => x.type === 'error'); if (errs.length) showMsg('WGSL: ' + errs.map((x) => x.lineNum + ': ' + x.message).join(' | ')); }); return m; };
  const pipe = (code, format, blend) => { const m = mod(code); return device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' } }); };
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  pipes = { scene: pipe(SCENE, FMT), bright: pipe(BRIGHT, FMT), reduce: pipe(REDUCE, FMT), blurH: pipe(BLUR, FMT), blurV: pipe(BLUR, FMT, add), final: pipe(FINAL, FMT) };
  configure();
  new ResizeObserver(() => request()).observe(canvas);
  matchMedia('(dynamic-range: high)').addEventListener?.('change', () => request());
  request();
}

function configure() {
  const mode = S.canvasMode === 'extended' ? 'extended' : 'standard';
  ctx.configure({ device, format: FMT, alphaMode: 'opaque', toneMapping: { mode }, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  let got = null; try { got = ctx.getConfiguration ? ctx.getConfiguration() : undefined; } catch (e) { got = 'error: ' + e.message; }
  confState = { requested: mode, got };
}

function tex(name, w, h, usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING) {
  if (T[name]) T[name].destroy(); T[name] = device.createTexture({ size: [w, h], format: FMT, usage }); return T[name];
}
function resize() {
  const css = canvas.getBoundingClientRect().width || 960, dpr = window.devicePixelRatio || 1;
  const want = S.sim === 'native' ? Math.round(css * dpr) : Math.min(Number(S.sim), Math.round(Math.max(css * dpr, 320)));
  const w = Math.max(64, want), h = Math.max(36, Math.round(w * 9 / 16));
  if (w === W && h === H && draws) return;
  W = w; H = h; canvas.width = W; canvas.height = H;
  const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
  tex('hdr', W, H); tex('acc', hw, hh);
  tex('meas', W, H, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
  for (const f of GLARE_BANDS) { tex('s' + f, Math.max(1, Math.ceil(hw / f)), Math.max(1, Math.ceil(hh / f))); tex('p' + f, Math.max(1, Math.ceil(hw / f)), Math.max(1, Math.ceil(hh / f))); }
  const ubuf = () => device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg = (p, entries) => device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: entries.map((resource, binding) => resource && { binding, resource }).filter(Boolean) });
  const view = (n) => T[n].createView();
  draws = { scene: bg(pipes.scene, [{ buffer: paramBuf }]), final: bg(pipes.final, [{ buffer: paramBuf }, view('hdr'), view('acc'), sampler, spikeTex.createView()]) };
  draws.brightU = ubuf(); draws.bright = bg(pipes.bright, [{ buffer: draws.brightU }, view('hdr')]);
  draws.bands = GLARE_BANDS.map((f, i) => {
    const hU = ubuf(), vU = ubuf();
    return { f, hU, vU,
      reduce: f === 1 ? null : bg(pipes.reduce, [null, view('s' + GLARE_BANDS[i - 1])]),
      h: bg(pipes.blurH, [{ buffer: hU }, view('s' + f), sampler]),
      v: bg(pipes.blurV, [{ buffer: vU }, view('p' + f), sampler]) };
  });
}

function request() { if (frameQueued || !device) return; frameQueued = true; requestAnimationFrame(() => { frameQueued = false; frame(); }); }
let lastCanvasMode = null;
function changed() { save(); syncUI(); request(); }

function writeParams(L, k) {
  const tanH = Math.tan(S.hfov * DEG / 2), a = new Float32Array(15 * 4), col = lampRGB(S.color);
  a.set([W, H, tanH, tanH * H / W], 0);
  a.set([k, EYE[2], L.length, S.own], 4);
  a.set([{ off: 0, physical: 1, perceptual: 2 }[S.veilMode], S.veilStr, S.veilCap, S.veilFloor], 8);
  a.set([S.core ? S.coreSigma * DEG : 0, 0.5 * 2 * tanH / W, S.target ? 1 : 0, S.tdist], 12);
  a.set([S.spike ? 1 : 0, S.spikeLen, S.spikeGain, S.spikeTaper], 16);
  a.set([S.spikeRot * DEG, BINS, spikeTotal, 0], 20);
  a.set([S.curve.includes('HDR') ? 1 : 0, S.peak, S.knee, S.bloom && S.bloomStr > 0 ? 1 : 0], 24);
  L.forEach((q, i) => { a.set([...q.dir, q.E], 28 + 4 * i); a.set([...col, q.angR], 44 + 4 * i); });
  device.queue.writeBuffer(paramBuf, 0, a);
}

function encodeFrame(target) {
  if (S.canvasMode !== lastCanvasMode) { configure(); lastCanvasMode = S.canvasMode; }
  resize();
  const key = [S.spikeSeed, S.spikeCount, S.spikeWidth, S.spikeLenJit, S.spikeBase].join();
  if (key !== spikeKey) { const t = spikeTable(); spikeTotal = t[2 * (BINS - 1)]; device.queue.writeTexture({ texture: spikeTex }, t, { bytesPerRow: BINS * 8 }, [BINS, 1]); spikeKey = key; }
  const L = lamps(), ex = exposure(L); writeParams(L, ex.k);
  const enc = device.createCommandEncoder();
  const pass = (view, pipe, group, load = 'clear') => { const p = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: load, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] }); p.setPipeline(pipe); p.setBindGroup(0, group); p.draw(3); p.end(); };
  pass(T.hdr.createView(), pipes.scene, draws.scene);
  const bloomOn = S.bloom && S.bloomStr > 0;
  if (bloomOn) {   // the drive's pyramid: bright pass at half size, then per band reduce → H blur → V blur added into acc
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
  return { enc, L, ex };
}

let last = null;
function frame() {
  const t0 = performance.now();
  // configure and resize before fetching the canvas texture; encodeFrame then finds nothing to change
  if (S.canvasMode !== lastCanvasMode) { configure(); lastCanvasMode = S.canvasMode; }
  resize();
  const r = encodeFrame(ctx.getCurrentTexture().createView());
  device.queue.submit([r.enc.finish()]);
  last = { L: r.L, ex: r.ex, ms: performance.now() - t0 };
  $('readout').textContent = readoutText();
}

function readoutText() {
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return 'n/a'; } };
  const got = confState.got, tm = got && typeof got === 'object' ? (got.toneMapping ? got.toneMapping.mode : 'not reported (no toneMapping in config)') : (got === undefined ? 'getConfiguration() unavailable' : String(got));
  const lines = [
    'WebGPU            ' + (navigator.gpu ? 'yes' : 'NO'),
    'HDR screen (mq)   ' + mq('(dynamic-range: high)') + ' · video ' + mq('(video-dynamic-range: high)'),
    'toneMapping asked ' + (confState.requested || '-'),
    'toneMapping got   ' + (device ? tm : '-'),
    'format ' + (got && got.format ? got.format : FMT) + ' · dpr ' + (window.devicePixelRatio || 1) + ' · ' + W + '×' + H,
  ];
  if (confState.requested === 'extended' && tm !== 'extended') lines.push('⚠ extended was requested but not reported back: this browser is showing SDR.');
  if (confState.requested === 'extended' && tm === 'extended') lines.push('extended is reported. Necessary, not sufficient: macOS Safari has reported it without showing HDR. Trust your eyes.');
  if (last) {
    lines.push('', 'lamps: ' + last.L.map((q) => `E ${q.E.toFixed(3)} lx @ ${q.r.toFixed(1)} m, θ from ahead ${(Math.acos(q.dir[0]) / DEG).toFixed(2)}°`).join(' · '));
    lines.push('exposure k ' + last.ex.k.toExponential(3) + (last.ex.white ? ' · adapted white ' + last.ex.white.toFixed(2) + ' cd/m²' : ' · white ' + (1 / last.ex.k).toFixed(2) + ' cd/m²') + ' · CPU encode ' + last.ms.toFixed(1) + ' ms');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- measure: saturated core size around the left lamp
function half(h) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * Math.pow(2, -14) * m / 1024 : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024); }
const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
async function measure() {
  if (!device) return;
  const r = encodeFrame(T.meas ? T.meas.createView() : null);
  const bpr = Math.ceil(W * 8 / 256) * 256, buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  r.enc.copyTextureToBuffer({ texture: T.meas }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
  device.queue.submit([r.enc.finish()]); await buf.mapAsync(GPUMapMode.READ);
  const u16 = new Uint16Array(buf.getMappedRange()), stride = bpr / 2;
  const lum = (x, y) => { const o = y * stride + 4 * x; return Math.max(dec(half(u16[o])), dec(half(u16[o + 1])), dec(half(u16[o + 2]))); };   // display-linear, 1 = paper white
  const tanH = Math.tan(S.hfov * DEG / 2), tanV = tanH * H / W, q = r.L[0];
  const px = Math.round((1 - q.dir[1] / q.dir[0] / tanH) / 2 * W - 0.5), py = Math.round((1 - q.dir[2] / q.dir[0] / tanV) / 2 * H - 0.5);
  const other = r.L[1], ox = Math.round((1 - other.dir[1] / other.dir[0] / tanH) / 2 * W - 0.5), oy = Math.round((1 - other.dir[2] / other.dir[0] / tanV) / 2 * H - 0.5);
  const fill = (thr) => {   // 4-connected region at or above thr, grown from the lamp pixel
    if (px < 0 || py < 0 || px >= W || py >= H || !(lum(px, py) >= thr)) return null;
    const seen = new Uint8Array(W * H), st = [[px, py]]; let n = 0, merged = false, x0 = px, x1 = px, y0 = py, y1 = py; seen[py * W + px] = 1;
    while (st.length && n < 400000) {
      const [x, y] = st.pop(); n++; if (x === ox && y === oy) merged = true; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = y + dy; if (a < 0 || b < 0 || a >= W || b >= H || seen[b * W + a]) continue; seen[b * W + a] = 1; if (lum(a, b) >= thr) st.push([a, b]); }
    }
    const degPx = 2 * tanH / W / DEG;   // degrees per pixel near the image centre
    return { eqDiam: 2 * Math.sqrt(n / Math.PI) * degPx, w: (x1 - x0 + 1) * degPx, h: (y1 - y0 + 1) * degPx, merged };
  };
  const f = (m) => (m ? `equiv. diameter ${m.eqDiam.toFixed(2)}° · box ${m.w.toFixed(2)}° × ${m.h.toFixed(2)}°${m.merged ? ' · MERGED with the other lamp' : ''}` : 'none');
  const peak = lum(Math.min(W - 1, Math.max(0, px)), Math.min(H - 1, Math.max(0, py)));
  $('measured').textContent = [
    `left lamp E ${q.E.toFixed(3)} lx · peak shown ${peak.toFixed(2)}× paper white (linear)`,
    `≥ 0.95 white (looks saturated):  ${f(fill(0.95))}`,
    `> 1.0 white (above paper white): ${f(fill(1.0001))}`,
    'Region includes any spike that stays above the threshold. Spike length itself is fixed by the Length slider.',
  ].join('\n');
  buf.unmap(); buf.destroy();
}

window.addEventListener('resize', request);
init().catch((e) => { showMsg('Startup failed: ' + (e && e.message || e)); console.error(e); });
