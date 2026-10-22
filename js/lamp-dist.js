/* LAMP-DIST: one street-luminaire light-distribution table, I(gamma, phi), shared by the glare sprite (drive-three-lamphalo.js),
   the CPU road lighting (drive.js pointLights) and the GPU road lighting (drive-three-shaders.js light loop).
   Dependency-free on purpose: the CPU renderer must not import the GPU module.

   Geometry
   - gamma = angle in degrees from straight down at the lamp, to the direction of interest (lamp -> point or lamp -> eye). 0 = nadir, 90 = horizontal.
     gamma > 90 (above horizontal): I = 0. No direct light above horizontal.
   - phi = azimuth in degrees around the pole, measured from the STREET side (the direction the arm reaches toward the road). 0 = street side, 180 = house side.

   Layout (DATA, replaceable by a real IES file with the same shape)
   - GAMMA: 0..90 step 5 (19 values). PHI: 0..360 step 15 (25 values, 360 = 0 again).
   - LAMP_DIST.classes[CLASS][KIND] is a Float64Array of 19 x 25 = 475 values, row-major: index = gi * 25 + pj.
     Unit: cd per 1000 lamp lumens.
   - CLASS in II | III | IV | V (lateral spread: II narrow, III wide, IV wider, V symmetric round). KIND in sodium | led.
   - Normalisation: sum over the grid of I sin(gamma) dgamma dphi = 1000 lm per 1000 lamp lm, so the downward flux is the lamp's lumens.
     This is the definition of the unit (not a sourced number).

   Provenance of the numbers (every one is labelled)
   - Normalisation to lamp lumens: inference (the lamp's lumens, not the luminaire's output, are the right normalisation; as in LAMP-HALO-CONE).
   - Sodium cutoff edge 85 deg, LED 80 deg: cone-edge ASSUMPTIONS from LAMP-HALO-CONE (sodium 100 cd/klm at 80 deg is the cutoff-class ceiling, regs snippet).
   - Vertical profile (dim straight down, peak 65 deg, falls to the edge): INFERENCE from the cobra-head batwing shape the owner described. Shape constants are TUNING.
   - Lateral spread kappa per class (exp(kappa cos phi)): TUNING. Not from any IES file. II 1.6, III 1.0, IV 0.6, V 0 (round = flat in phi).
   - SPRITE_DIST_FLOOR_FRAC 4 percent: TUNING (owner asked for "about 3 to 5 percent of plateau").
*/

export const GAMMA = Array.from({ length: 19 }, (_, i) => i * 5);
export const PHI = Array.from({ length: 25 }, (_, j) => j * 15);
export const NG = GAMMA.length, NP = PHI.length;
export const CLASSES = ['II', 'III', 'IV', 'V'];
export const KINDS = ['sodium', 'led'];
export const LAMP_DIST_UNIT = 'cd per 1000 lamp lm';
export const LAMP_DIST_LAYOUT = 'Float64Array row-major, index = gi * 25 + pj; gi indexes GAMMA (0..90 step 5), pj indexes PHI (0..360 step 15, 0 = street side)';

// Vertical profile knots [gamma deg, relative]. Tuning/inference (see header). Edge = last nonzero knot.
const PROFILE = {
  sodium: [[0, 0.30], [30, 0.75], [65, 1.00], [75, 0.80], [85, 0.00], [90, 0.00]],
  led: [[0, 0.30], [30, 0.75], [65, 1.00], [72, 0.70], [80, 0.00], [90, 0.00]],
};
// Lateral spread: exp(kappa cos phi). Larger kappa = narrower lobe toward the street. TUNING.
const KAPPA = { II: 1.6, III: 1.0, IV: 0.6, V: 0 };
export const SPRITE_DIST_FLOOR_FRAC = 0.04;   // sprite-only floor, fraction of the class/kind peak, for gamma in (edge, 90]. TUNING.

// Reference for the road factor: the mean intensity over the lower hemisphere for 1000 lm (1000 / (2 pi)) = 159.15 cd per klm.
export const I_REF_KLM = 1000 / (2 * Math.PI);

function knotValue(pts, g) {
  for (let i = 1; i < pts.length; i++) if (g <= pts[i][0]) {
    const [g0, v0] = pts[i - 1], [g1, v1] = pts[i];
    return v0 + (v1 - v0) * (g - g0) / (g1 - g0);
  }
  return 0;
}

// Build the raw grid, then scale it so the flux integral is exactly 1000 (trapezoid in gamma, rectangle over the 24 unique phi steps).
function build(kind, cls) {
  const raw = new Float64Array(NG * NP), k = KAPPA[cls];
  for (let gi = 0; gi < NG; gi++) for (let pj = 0; pj < NP; pj++) {
    raw[gi * NP + pj] = knotValue(PROFILE[kind], GAMMA[gi]) * Math.exp(k * Math.cos(PHI[pj] * Math.PI / 180));
  }
  const dg = 5 * Math.PI / 180, dp = 15 * Math.PI / 180;
  let flux = 0;
  for (let gi = 0; gi < NG; gi++) {
    const wg = gi === 0 || gi === NG - 1 ? 0.5 : 1;
    for (let pj = 0; pj < NP - 1; pj++) flux += wg * raw[gi * NP + pj] * Math.sin(GAMMA[gi] * Math.PI / 180) * dg * dp;
  }
  const s = 1000 / flux;
  return raw.map((v) => v * s);
}

export const LAMP_DIST = { unit: LAMP_DIST_UNIT, layout: LAMP_DIST_LAYOUT, gamma: GAMMA, phi: PHI, classes: {}, peak: {}, edge: {}, fluxCheck: {} };
for (const kind of KINDS) for (const cls of CLASSES) {
  const arr = build(kind, cls);
  LAMP_DIST.classes[cls] = LAMP_DIST.classes[cls] || {};
  LAMP_DIST.classes[cls][kind] = arr;
  LAMP_DIST.peak[cls + '/' + kind] = Math.max(...arr);
  LAMP_DIST.edge[kind] = kind === 'led' ? 80 : 85;
}

// Bilinear lookup in the grid. gamma clamped to [0, 90]; gamma > 90 returns 0. phi wrapped to [0, 360).
export function distAt(cls, kind, gDeg, phiDeg) {
  if (!(gDeg <= 90)) return 0;
  const arr = LAMP_DIST.classes[cls][kind];
  const g = Math.min(90, Math.max(0, gDeg)) / 5, fg = Math.min(NG - 2, Math.floor(g)), tg = g - fg;
  let p = ((phiDeg % 360) + 360) % 360 / 15; const fp = Math.min(NP - 2, Math.floor(p)), tp = p - fp;
  const a = arr[fg * NP + fp], b = arr[fg * NP + fp + 1], c = arr[(fg + 1) * NP + fp], d = arr[(fg + 1) * NP + fp + 1];
  return (a * (1 - tp) + b * tp) * (1 - tg) + (c * (1 - tp) + d * tp) * tg;
}

// Sprite value: the table, with the 4 percent floor between the edge and horizontal (zero above horizontal).
export function spriteDistAt(cls, kind, gDeg, phiDeg) {
  if (!(gDeg <= 90)) return 0;
  return Math.max(distAt(cls, kind, gDeg, phiDeg), SPRITE_DIST_FLOOR_FRAC * LAMP_DIST.peak[cls + '/' + kind]);
}

// Road factor: ratio of the table to the lower-hemisphere mean, so a lamp keeps its flux on average. 1 = isotropic.
export function roadFactorAt(cls, kind, gDeg, phiDeg) { return distAt(cls, kind, gDeg, phiDeg) / I_REF_KLM; }

// Lamp kind from the streetLamps setting, as the sprite and the road lighting both read it.
export function kindOfLamp(lampKind) { return lampKind === 'led' ? 'led' : 'sodium'; }

// Angle (deg, 0..360) from the street vector st = [x, y] to the horizontal part of v = [x, y]. 0 = street side.
export function phiOf(st, v) {
  const a = Math.atan2(st[0] * v[1] - st[1] * v[0], st[0] * v[0] + st[1] * v[1]) * 180 / Math.PI;
  return a < 0 ? a + 360 : a;
}

// Expose the table to the classic-script renderers (drive.js, the CPU road lighting), which cannot import this module.
// Set when this module is loaded (drive-three.js imports it, so it is loaded with the GPU drive view).
globalThis.RF = globalThis.RF || {};
globalThis.RF.LampDist = { LAMP_DIST, distAt, spriteDistAt, roadFactorAt, kindOfLamp, phiOf, I_REF_KLM };
