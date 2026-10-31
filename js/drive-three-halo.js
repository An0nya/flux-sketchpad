/* The traffic scatter table (look.trafficHalo 4 / 8 / 16: the nearest N traffic lamps). Replaces the SL2 per-pixel march and the sprite redo, which both drew into
   the ground layer: objects composed over it, so the glow ended at a car's roof and bushes behind the car stayed dark against it.
   Here the glow is a TABLE every shader reads at its own depth, as the own-lamp air-beam table is read (drive-three-shaders.js haloScatter):
   - screen-space, 1/8 of the view (at least 96 x 54 cells), refreshed every frame (cars move). Six tiles side by side in one RGBA16F texture, one per
     distance bin [0,8] [8,14] [14,22] [22,34] [34,60] [60,120] m; a cell holds the lamps' single-scatter integral over that bin (the same integrand as drive.js trafficHalo,
     the CPU reference: sigma * p(theta) * I/r^2 * exp(-sigma r) * exp(-sigma s)). The lookup sums the bins up to the fragment's end distance, so air in front
     of a surface adds to it and air behind it does not.
   - Deterministic midpoint steps (4 per bin, geometric), no jitter: no noise. Bilinear filtering inside a tile smooths the rest.
   - Lamps are drawn 4 at a time with additive blending, so the shader loop is 4 lamps x 4 steps = 16 iterations (the size of the old halo shader that Safari
     compiled; a 48 bound is suspected of stalling its compile). 16 lamps = 4 draws.
   - Off (look.trafficHalo 0, clear air, no lamp): build() sets haloOn 0 and returns; no pass. The lookup code is always in the shaders behind a uniform
     branch, so toggling never changes shader text. */
import * as T from '../vendor/three/three.module.min.js';
import { ATLAS_HEAD, OTHER_LEGACY, OTHER_ATLAS, HALO_MAX } from './drive-three-shaders.js';
import { beamExtent, coneClip, ballClip, fastRadius, litBound, polarBand } from './drive-three-halo-cull.js';
import { SM_DECL, SM_MAX, SM_RES } from './drive-three-shadowmaps.js';
const D = globalThis.RF.Drive;
export const HALO_MAXL = 16, HALO_PER_DRAW = 1, HALO_BIN_STEPS = 6, HALO_MIN_W = 96, HALO_MIN_H = 54, HALO_DIV = 8, HALO_DIV_FEW = 4, HALO_FEW = 4, HALO_SUB = 4, HALO_REFINE = 4, HALO_NEAR = 45;
// HDX6 polar table (SL_HALO_POLAR): 512 angles x 64 log-radii for the nearest lamp in front; 24 bins side by side = 12288 texels wide (under MAX_TEXTURE_SIZE 16384).
export const AUTO_NEAR_M = 8, AUTO_FAR_M = 12;   // SP: haloPolar auto: no lamp-centred table inside 8 m, the full share beyond 12 m, smoothstep between
export const HALO_POL_TH = 512, HALO_POL_R = 64, HALO_POL_MIN_PX = 0.25, HALO_POL_MIN_X = 1, HALO_POL_MAX = 4;   // min radius px; min x m ahead; max |NDC| of the centre
// One lamp per draw, 6 steps: a shader loop of 6 (it was 3 lamps x 6 = 18; Safari is suspected to stall compiling long loops). More draws, same pixels.
// HDX3: 24 log-uniform bins from 0.5 to 120 m (edge k = 0.5 * 240^((k+1)/24)); the first entry is the origin, the last is the range.
// SR: the range is look.scatterRange (D.scatRangeOf, default 120 = D.SCAT.S_MAX): edge k = 0.5 * (2R)^((k+1)/n), last edge R, knot step ln(2R)/n.
// The fixed edges replace the adaptive edges (HDX2: adaptive bin 0 = [0.5, 0.45 D] was the near-field overshoot). The shader's lookup assumes this log-uniform spacing.
// HDX7: the bin count is a runtime setting (HALO_N, 4..32). The shaders size their arrays to HALO_MAX and read the count from a uniform (haloNu), so a change
// needs no recompile. ?halobins=N sets the start value; an out-of-range value clamps and HALO_REQ keeps what was asked, so the UI can show the clamp.
export const HALO_MIN = 4;
export const CP_ANGLE = 30, CP_FADE = 15;   // CP: haloConeAngle default (deg between the beam axis and the line to our eye) and the fade width above it
export let HALO_N = 24, HALO_REQ = 24, HALO_EDGES = [], HALO_BINS = 0, HALO_RANGE = 120;   // HALO_RANGE: SR, the far edge in m (120 = as before)
export function haloEdgesOf(n, R = HALO_RANGE) { const e = [0, ...Array.from({ length: n }, (_, k) => 0.5 * Math.pow(2 * R, (k + 1) / n))]; e[n] = R; return e; }
export function haloStepOf(n, R = HALO_RANGE) { return n === 24 && R === 120 ? 0.22836 : Math.log(2 * R) / n; }   // the knot step in ln d: 0.22836 at 24 and 120 m, as the shader always had it
export function setHaloBins(req) { const r = +req || 24, n = Math.min(HALO_MAX, Math.max(HALO_MIN, Math.round(r))); HALO_REQ = r; HALO_N = n; HALO_EDGES = haloEdgesOf(n); HALO_BINS = n; return n; }
// SR: the far edge the table and its culling use this frame. Test control (SL_SR_GPU_CONTROL) replaces the look's value on the GPU side only, see scatRangeGpu.
export function setHaloRange(R) { HALO_RANGE = R; HALO_EDGES = haloEdgesOf(HALO_N, R); }
export function scatRangeGpu(look) { return globalThis.SL_SR_GPU_CONTROL || D.scatRangeOf(look); }
// OHR: the oncoming table's own range (look.haloRange, 0 = follow scatterRange). The test control still drives both sides.
export function haloRangeGpu(look) { return globalThis.SL_SR_GPU_CONTROL || D.haloRangeOf(look); }
setHaloBins(new URLSearchParams(globalThis.location ? location.search : '').get('halobins') ?? 24);
const HALO_URL_N = HALO_N;   // HDX7: the bin count from the page URL (the default when the look sets none)
// The upper edge of each bin for a nearest lamp at distance D. The cumulative glow along a ray rises steeply up to the lamp's own distance and is flat after it;
// the lookup interpolates between edges (log-linear), so a lamp sliding through a bin changes the interpolated shape and the glow around a close car shimmers
// (measured: 5-15% frame-to-frame jumps in the halo's total at 10-25 m, clustered near the fixed edges). Edges that are fractions of D put the lamp's distance
// ON an edge, and every edge moves continuously with D. Blended to the fixed ladder as the car gets far (55-75 m), where it was already steady.
const ADAPT = [0.45, 0.7, 0.85, 1.0, 1.6];
export function haloEdgesFor(D, out = new Array(HALO_BINS)) {   // HDX3: the edges are fixed (D no longer moves them)
  const n = Math.min(HALO_BINS, out.length);   // step5-preview (qwen3.8max RN §5): the tail past the in-use bins is filled too, so a reader past HALO_BINS sees the true continuation instead of the stale range edgesV was built with. Only the in-use slots change
  for (let i = 0; i < n; i++) out[i] = HALO_EDGES[i + 1];
  for (let i = n; i < out.length; i++) out[i] = HALO_EDGES[HALO_BINS];
  return out;
}

// LW (option haloLampWin, K of window steps; default off): the bin that catches this lamp's CROSSING also samples a lamp-centred window. The whole
// glow of a far lamp sits in one thin bin (step5-preview: measured 3-8 m wide, with the 50% point 3-6 m in front of the lamp), while the six log steps of
// that bin are ~7-8 m apart there, so the ladder either misses it or lands one sample on its 1/r^2 core and multiplies the bin by 3-4x. That phase is fixed
// per cell and slides through the ladder as the car closes, which reads as the slab banding and the pulsing out of step with the closing speed. The window is
// anchored at s0 = dot(lamp - haloEye, ray), this lamp's closest-approach depth on THIS cell's ray: K log points over [max(lo, s0 - LW_WIN), s0 + LW_TAIL]
// plus LW_STUBS log stubs a side to keep the rest of the bin's tail. Same integrand, same ds weights; only the lamp's own bin is touched, so a cell whose bin
// misses s0 is byte-identical to the old schedule. haloP > 1 (the near-lamp sub-passes) keeps its 6-step lattice: the two do not compose.
export const LW_WIN = 24, LW_TAIL = 0.75, LW_STUBS = 3, LW_MAX = 38;   // m; m; stubs a side; the shader loop bound (32 window steps + stubs)
// The JS twin of the shader's schedule, for tests and the probe: the sample strides [sa, sb] of window step m (m < 0 = the head stubs, K..K+5 = the tail
// stubs), or null when this bin is not the lamp's. K > 0; outside [0, K + 2*LW_STUBS) there is no step.
export function lwSched(m, lo, hi, s0, K) {
  if (!(K > 0) || !(s0 > lo) || !(s0 <= hi)) return null;
  const wA = Math.max(lo, s0 - LW_WIN), wB = Math.min(hi, s0 + LW_TAIL), n = m | 0, K0 = K | 0;
  if (n < K0) { const q = Math.pow(wB / wA, 1 / K), sa = wA * Math.pow(q, n); return [sa, sa * q]; }
  if (n >= K0 + LW_STUBS + LW_STUBS) return null;
  if (n < K0 + LW_STUBS) { const j = n - K0, q = Math.pow(wA / lo, 1 / LW_STUBS); const sa = lo * Math.pow(q, j); return [sa, sa * q]; }
  const j = n - K0 - LW_STUBS, q = Math.pow(hi / wB, 1 / LW_STUBS); const sa = wB * Math.pow(q, j); return [sa, sa * q];
}
const LW_BLOCK = (lines) => `  if (haloLampW > 0.0 && haloP == 1) {
    float s0 = dot(lamp - haloEye, ray);
    if (s0 > lo && s0 <= hi) {
      float wA = max(lo, s0 - ${LW_WIN.toFixed(1)}), wB = min(hi, s0 + ${LW_TAIL.toFixed(2)}), qw = pow(wB / wA, 1.0 / haloLampW);
      for (int m = 0; m < ${LW_MAX}; m++) {
        if (m >= int(haloLampW) + ${2 * LW_STUBS}) break;
        float sa, sb;
        if (m < int(haloLampW)) { sa = wA * pow(qw, float(m)); sb = sa * qw; }
        else if (m < int(haloLampW) + ${LW_STUBS}) { float qh = pow(wA / lo, ${(1 / LW_STUBS).toFixed(6)}); float fq = wA > lo ? qh : 1.0; sa = lo * pow(fq, float(m - int(haloLampW))); sb = sa * fq; }
        else { float qt = pow(hi / wB, ${(1 / LW_STUBS).toFixed(6)}); float tq = hi > wB ? qt : 1.0; sa = wB * pow(tq, float(m - int(haloLampW) - ${LW_STUBS})); sb = sa * tq; }
        float s = sqrt(sa * sb), ds = sb - sa;
${MARCH.split('\n').map((l) => (l.trim().startsWith('float cs') ? lines.map((x) => x + '\n').join('') : '') + l).join('\n')}
      }
    }
  }
`;
// lwText: insert the window block INSIDE the lamp loop, just after the six-step march, so it sees the same lamp, ray and bin as the ladder. In the split
// variant it sits inside the lamp loop too, so the share scales the window's samples as well as the ladder's. off never compiles it. The E2 / SM occlusion
// lines the hooks put in the ladder go into the window's copy of the march as well, so LW never loses them.
const LW_TAIL1 = '    }\n  }\n  gl_FragColor', LW_TAIL2 = '    }\n  }\n  acc *= swt;\n  gl_FragColor';
const lwText = (body, occ, sm) => {   // LW: the uniform rides with the variant, like haloJitAmt
  if (body.includes('uniform float haloLampW;')) return body;
  const lines = []; if (occ || sm) { if (body.includes(SM_LINES[0])) lines.push(SM_LINES[0]); else if (body.includes(OCC_LINE)) lines.push(OCC_LINE); else if (body.includes(SM_LINES[1])) lines.push(SM_LINES[1]); }
  const blk = LW_BLOCK(lines), t2 = body.includes(LW_TAIL2);
  if (t2) return 'uniform float haloLampW;\n' + body.replace(LW_TAIL2, '    }\n' + blk + '  }\n  acc *= swt;\n  gl_FragColor');
  if (body.includes(LW_TAIL1)) return 'uniform float haloLampW;\n' + body.replace(LW_TAIL1, '    }\n' + blk + '  }\n  gl_FragColor');
  throw new Error('LW: table pass tail not found once'); };

const TVERT = `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// PREFIX (Task 1): the cumulative table. Texel (tile k, cell c) = the sum of the bin texels at cell c over tiles 0..k. The shader reads four knots of it, not all bins.
const TCUM = `uniform sampler2D src; uniform float cumW; uniform int cumN;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy); int W = int(cumW), tile = px.x / W, cx = px.x - tile * W; vec3 acc = vec3(0.0); float accM = 0.0;   // P3/glm5.2: alpha carries the first moment (glow-weighted depth sum) for mean-placement
  for (int k = 0; k < ${HALO_MAX}; k++) { if (k > tile || k >= cumN) break; vec4 t = texelFetch(src, ivec2(k * W + cx, px.y), 0); acc += t.rgb; accM += t.a; }
  gl_FragColor = vec4(acc, accM);
}
`;
// IL (options haloJitter, haloJitterAmount, haloBlur): BLUR pass on the bin texels, before the running totals (so its cost does not grow with the bin count). Separable: run
// once along rows (inside each tile) and once along columns. A tent of half width r (weights r+1-|o|) is two boxes of width r+1 convolved: with an N x N sampling pattern
// (N = r + 1: 2 x 2 for light, 4 x 4 for heavy) every phase gets the same total weight, 1/N per axis, so the merge is unbiased. Off: never built.
// bV 2 (option haloDepthBlur): the same tent ALONG the ray, over neighbouring depth slices of one cell (tiles), so light handed from slice to slice as a car moves ramps instead of
// pulsing. It never mixes rays (no sideways leak at silhouettes); its cost is a leak in depth (a ray ending just short of a slice picks up a little of it). Taps past the first or
// last slice are dropped and the rest renormalised. bR 0 = a plain copy (used to land the result in the source target).
const TBLUR = `uniform sampler2D src; uniform float bW; uniform int bR, bV;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy), sz = textureSize(src, 0); int W = int(bW), tile = px.x / W, cx = px.x - tile * W; vec3 acc = vec3(0.0); float ws = 0.0, accM = 0.0;   // P3/glm5.2: blur the moment with the same tent
  for (int o = -3; o <= 3; o++) { if (o < -bR || o > bR) continue; float w = float(bR + 1 - abs(o));
    if (bV == 2 && (tile + o < 0 || tile + o >= sz.x / W)) continue;
    ivec2 q = bV == 2 ? ivec2((tile + o) * W + cx, px.y) : bV == 1 ? ivec2(px.x, clamp(px.y + o, 0, sz.y - 1)) : ivec2(tile * W + clamp(cx + o, 0, W - 1), px.y); vec4 t = texelFetch(src, q, 0); acc += w * t.rgb; accM += w * t.a; ws += w; }
  gl_FragColor = vec4(acc / ws, accM / ws);
}
`;
const THEAD = `uniform vec4 hLamp[${HALO_PER_DRAW}], hDir[${HALO_PER_DRAW}], hTint[${HALO_PER_DRAW}], hLat[${HALO_PER_DRAW}], hUp[${HALO_PER_DRAW}];
uniform vec3 haloEye; uniform vec2 size, haloTab; uniform int nHalo, otherConvention;
uniform int haloP, haloSub;   // sub-pass haloSub of haloP (see the loop)
uniform float haloEdges[${HALO_MAX}];   // the upper edge of each bin (HDX7: HALO_MAX slots, the first HALO_BINS in use)
uniform float tanH, sigma, haloRMin, haloGFwd, haloGBack, haloWFwd;
uniform vec2 haloPolarC, haloPolarRange, haloPolarN;   // HDX6 polar pass: centre (px), (log r0, log-radius step), (angles, radii)
uniform sampler2D otherBeam; uniform vec4 otherLutInfo; uniform vec2 otherLutSize;
`;
// LW (option haloLampWin): the integrand of ONE table sample, once. The log ladder in TMAIN and the lamp-centred window below run the same body, so the two
// schedules cannot drift apart (E2/SM hooks are re-inserted into both copies by lwText, below).
const MARCH = `      vec3 d = haloEye + s * ray - lamp; float r2 = dot(d, d); if (r2 <= 0.0) continue;
      float r = sqrt(r2);
      // ROLL: a touge source carries its own surface basis (lat = n x fwd, up = n, car frame; flag w = 1). Flag 0 keeps the level-road formulas exactly.
      vec3 lat3 = vec3(-dir.y, dir.x, 0.0), up3 = vec3(-se * dir, ce);
      if (hLat[i].w > 0.5) { lat3 = hLat[i].xyz; up3 = hUp[i].xyz; }
      vec3 local = vec3(dot(d, vec3(dir * ce, se)), dot(d, lat3), dot(d, up3));
      if (local.x <= 0.0) continue;
      float I = Wt * otherIntensity(local);
      if (I <= 0.0) continue;
      float cs = -dot(d, ray) / r, p = haloWFwd * hgP(haloGFwd, cs) + (1.0 - haloWFwd) * hgP(haloGBack, cs);
      acc += sigma * p * I / max(r2, haloRMin * haloRMin) * exp(-sigma * r) * exp(-sigma * s) * ds * tint;`;
const TMAIN = `float hgP(float g, float c) { return (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy); int W = int(haloTab.x), tile = px.x / W, cx = px.x - tile * W;
  vec2 uv = (vec2(float(cx), float(px.y)) + 0.5) / haloTab, screen = uv * 2.0 - 1.0;
  vec3 ray = normalize(vec3(1.0, -screen.x * tanH, screen.y * tanH * size.y / size.x));
  float lo = tile == 0 ? 0.5 : haloEdges[tile - 1], hi = haloEdges[tile];   // bin 0 starts at 0.5 m: nearer air has no lamp in it
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${HALO_PER_DRAW}; i++) {
    if (i >= nHalo) break;
    // TILT: hDir.xy is the unit horizontal heading, hDir.z the beam's elevation (sin) in the car frame (0 = level, as before). The beam frame is
    // fwd = (dir*ce, se), lat = (-dir.y, dir.x, 0), up = (-se*dir, ce) with ce = sqrt(1-se*se); at se 0 the three dots below are the old ones exactly.
    vec3 lamp = hLamp[i].xyz, tint = hTint[i].rgb; vec2 dir = hDir[i].xy; float se = hDir[i].z, ce = sqrt(max(1.0 - se * se, 0.0)); float Wt = hLamp[i].w;
    tbeam = int(hTint[i].w + 0.5);
    // BRIEF J: the bin [lo, hi] lies entirely behind this lamp's forward plane when both ends do: local.x = dot(d, fwd) is linear along the ray, so every
    // sample of the march below would hit the test local.x <= 0.0 and add nothing (the beam LUT is read only after that test). Skip the march. The -1e-3 margin keeps
    // float rounding from flipping a sample near the plane, so the table is identical to the march it skips.
    vec3 fw = vec3(dir * ce, se);
    if (max(dot(haloEye + lo * ray - lamp, fw), dot(haloEye + hi * ray - lamp, fw)) < -1e-3) continue;
    // Each bin is cut into 6 x haloP log-spaced cells and this draw takes every haloP-th one, starting at haloSub: haloP draws (additive) make up the full
    // sum, each with a loop of 6. A lamp near the eye needs it: along a ray that passes close to it, 1/r^2, the phase function and the beam's cone entry all
    // vary over a metre or less, far less than a 6-step cell (1-4 m), so 6 steps alias, and the table shimmers as a close car's lamps move (measured: 24 steps
    // cut the frame-to-frame error of a table cell near the lamp roughly 5-20x). Lamps far away keep haloP 1 (6 steps; there the spike is not narrow).
    float qq = pow(hi / lo, 1.0 / float(${HALO_BIN_STEPS} * haloP));
    for (int m = 0; m < ${HALO_BIN_STEPS}; m++) {
      float sa = lo * pow(qq, float(m * haloP + haloSub)), sb = sa * qq, s = sqrt(sa * sb), ds = sb - sa;
${MARCH}
    }
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;
// P1c (option haloCrossingRefine): a grazing oncoming ray crosses the lamp's forward plane inside one depth bin. The lit sliver there can be metres wide in a
// 6-step bin, so the shipped quadrature either misses it or lands on it: the table pulses as the lamp moves. This builds a separate shader variant that
// replaces that bin's six steps with 512 or 2048 log-spaced steps. The ordinary bins keep the shipped schedule, so the option changes only the crossing bin.
const CROSS_HEAD = '    float qq = pow(hi / lo, 1.0 / float(' + HALO_BIN_STEPS + ' * haloP));\n', CROSS_TAIL = '\n    }\n  }\n  gl_FragColor = vec4(acc, 1.0);';
const crossText = (main, n, nb = false) => {
  const a = main.indexOf(CROSS_HEAD), b = main.indexOf(CROSS_TAIL, a);
  if (a < 0 || b < 0) throw new Error('P1c: crossing-bin loop not found');
  const loop = main.slice(a, b + '\n    }'.length), bodyAt = loop.indexOf('      vec3 d = '), bodyEnd = loop.lastIndexOf('\n    }');
  if (bodyAt < 0 || bodyEnd < bodyAt) throw new Error('P1c: crossing-bin sample body not found');
  const body = loop.slice(bodyAt, bodyEnd).replace(/\bds\b/g, 'rds').replace(/\bs\b/g, 'rs');
  const refined = '    float fwdDot = dot(ray, fw);\n    float sCross = abs(fwdDot) > 1e-7 ? dot(lamp - haloEye, fw) / fwdDot : -1.0;\n'
    // RN (option haloRefineNeighbour): widen the trigger to [lo, the next bin's far edge], so the bin that holds the
    // light is refined too. sCross is pinned at the lamp's forward-plane crossing (~the lamp depth) while the glow
    // centroid slides toward the eye as the ray's closest approach grows: qwen3.8max stage12 measured the dominant bin
    // one nearer than the crossing bin in 24/30 rows, always exactly one, and refining only the crossing bin left that
    // bin byte-identical to the shipped six steps (stage11). le-chonk's interval-trigger numbers agree (crossing bin
    // alone |log| p90 0.94 at D=200; + the eye-side neighbour 0.007/0.09/0.94 med/p90/max). Off = the old trigger.
    // max(..., hi) is load-bearing, not belt-and-braces: on the LAST tile rnHi reads haloEdges[HALO_BINS], a slot past
    // the in-use edges. edgesV is filled once when haloPass is built (HALO_RANGE = 120 then) and setHaloRange only
    // rebuilds HALO_EDGES, so with haloRange 250 that slot still holds 120 - below the last bin's own hi - and without
    // the max the crossing bin would STOP refining exactly when it is the farthest bin, the common case for a distant
    // oncoming car. Measured: bin 23 fell from 0.999 back to 0.034 (qwen3.8max/data/stage15.json, first run).
    + (nb ? '    float rnHi = max(tile + 1 < ' + HALO_MAX + ' ? haloEdges[tile + 1] : hi, hi);\n'
      + '    bool crossingBin = sCross >= lo && sCross <= rnHi;\n    if (!crossingBin) {\n'
      : '    bool crossingBin = sCross >= lo && sCross <= hi;\n    if (!crossingBin) {\n') + loop + '    } else {\n'
    // the refined ladder has n cells over the whole bin; a sub-pass takes every haloP-th cell, exactly like the ordinary ladder, so n cells are added in total
    + '      float tq = pow(hi / lo, 1.0 / float(' + n + '));\n      int rn = ' + n + ' / haloP; if (rn < 1) rn = 1; if (rn > ' + n + ') rn = ' + n + ';\n'
    + '      for (int m = 0; m < ' + n + '; m++) {\n        if (m >= rn) break;\n        float ra = lo * pow(tq, float(m * haloP + haloSub)), rb = ra * tq, rs = sqrt(ra * rb), rds = rb - ra;\n'
    + body + '\n      }\n    }';
  return main.slice(0, a) + refined + main.slice(b + '\n    }'.length);
};
// HDX6: the polar pass is the same bin integrand, but each texel is a polar sample about the nearest lamp's projection (pixels), not a screen cell.
const polarOf = (main) => main.replace(
  "  ivec2 px = ivec2(gl_FragCoord.xy); int W = int(haloTab.x), tile = px.x / W, cx = px.x - tile * W;\n  vec2 uv = (vec2(float(cx), float(px.y)) + 0.5) / haloTab, screen = uv * 2.0 - 1.0;\n",
  "  ivec2 px = ivec2(gl_FragCoord.xy); int W = int(haloPolarN.x), tile = px.x / W, cx = px.x - tile * W;\n" +
  "  float ang = (float(cx) + 0.5) / haloPolarN.x * 6.28318530718, rho = exp(haloPolarRange.x + (float(px.y) + 0.5) * haloPolarRange.y);\n" +
  "  vec2 screen = (haloPolarC + rho * vec2(cos(ang), sin(ang))) / size * 2.0 - 1.0;\n");
const TMAIN_POLAR = polarOf(TMAIN);
if (TMAIN_POLAR === TMAIN) throw new Error('HDX6: polar pass text not replaced');
// E2 (crest occlusion, option crestOcclusion, mountain pass only): a top-down height map of the pass ribbon (drive-touge-three.js heightMap) is sampled at 3 points along lamp -> sample;
// a sample whose line to the lamp passes under the ribbon's surface adds nothing. +1 sampler (crestH), only in these variants: with the option off the old text above is what compiles
// (variants are built on first use), so the off pass is byte-identical. Lamp and sample are car-frame; the map is world xy (the car is the world origin on the pass, so world = worldFromCar * car).
// The map keeps ONE height per texel, the nearest leg's (by |off| to its own centre line, as A.frame): between two hairpin legs it holds a step at the halfway line, as the CPU blocked() does.
export const CREST_EPS = 0.3, CREST_TAPS = 3;   // m of ribbon height above the line before it counts as blocking; points along the line (t = k / (taps + 1))
export const OCC_DECL = `uniform sampler2D crestH; uniform mat3 crestWFC; uniform vec4 crestBox; uniform vec2 crestZ;   // height map (red = z - zmin + 1, 0 = none), world-from-car, (x0, y0, 1/w, 1/h), (zmin, zrange)
bool crestOcc(vec3 a, vec3 b) {
  vec3 A = crestWFC * a, B = crestWFC * b;
  for (int k = 1; k <= ${CREST_TAPS}; k++) {
    vec3 q = mix(A, B, float(k) / ${(CREST_TAPS + 1).toFixed(1)}); vec2 uv = (q.xy - crestBox.xy) * crestBox.zw;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;   // outside the ribbon's box: nothing there
    float r = texture2D(crestH, uv).r; if (r < 0.5) continue;   // cleared texel: no ribbon
    if (crestZ.x + r - 1.0 > q.z + ${CREST_EPS.toFixed(2)}) return true;
  }
  return false;
}
`;
const OCC_HIT = '      float cs = -dot(d, ray) / r, p =';
// LW: the occlusion lines as the hooks insert them, so lwText can put the same line in the window's copy of the march (E2 / SM + LW together).
const OCC_LINE = '      if (crestOcc(lamp, haloEye + s * ray)) continue;', SM_LINES = ['      if (smM >= 0 ? !smLit(smM, haloEye + s * ray) : crestOcc(lamp, haloEye + s * ray)) continue;', '      if (!smLit(smM, haloEye + s * ray)) continue;'];
if (TMAIN.split(OCC_HIT).length !== 2) throw new Error('E2: crest occlusion hook not found once in the table pass');
const TMAIN_OCC = TMAIN.replace(OCC_HIT, '      if (crestOcc(lamp, haloEye + s * ray)) continue;\n' + OCC_HIT), TMAIN_POLAR_OCC = polarOf(TMAIN_OCC);
if (TMAIN_OCC === TMAIN || TMAIN_POLAR_OCC === TMAIN_POLAR || TMAIN_POLAR_OCC === TMAIN_OCC) throw new Error('E2: crest occlusion pass text not built');
// SP (haloPolar auto): the lamp-centred table covers only an angle band about its centre (haloBandA = centre angle, half width, edge fade, share), and the screen table is built with the
// complementary share for the lamps the polar table carries, so the two sum to the lamp's whole contribution (the lookup weights the polar table with the same numbers, drive-three-shaders.js haloPolarT).
// 'band' (polar pass): the angle of a texel runs over the band, not the circle. 'split' (screen pass): this lamp's cell is scaled by 1 - share * edge weight at the cell centre's angle about the table centre.
// Built on first use, so off / merged / perlamp compile the texts above unchanged.
const BAND_DECL = 'uniform vec4 haloBandA;\n';
const BAND_ANG = 'float ang = (float(cx) + 0.5) / haloPolarN.x * 6.28318530718,', SPLIT_TAIL = '  gl_FragColor = vec4(acc, 1.0);';
const SPLIT_HEAD = '  vec3 acc = vec3(0.0);\n', SPLIT_HEAD_CODE = `  vec3 acc = vec3(0.0);
  float swt;   // the screen table's share of this lamp at this cell: 1 - share * (the band's edge weight at the cell centre's angle about the table centre)
  { vec2 sq = (vec2(float(cx) + 0.5, float(px.y) + 0.5) / haloTab) * size - haloPolarC; float sth = dot(sq, sq) > 0.0 ? atan(sq.y, sq.x) : 0.0, srel = sth - haloBandA.x;
    srel -= 6.28318530718 * floor((srel + 3.14159265359) / 6.28318530718); float sar = abs(srel);
    float swb = sar > haloBandA.y ? 0.0 : (haloBandA.z > 0.0 ? 1.0 - smoothstep(haloBandA.y - haloBandA.z, haloBandA.y, sar) : 1.0);
    swt = 1.0 - haloBandA.w * swb; }
  if (swt < 1e-4) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // the band table carries this cell entirely: skip the march
`;
const SPLIT_CODE = '  acc *= swt;\n';
if (TMAIN_POLAR.split(BAND_ANG).length !== 2 || TMAIN.split(SPLIT_TAIL).length !== 2 || TMAIN.split(SPLIT_HEAD).length !== 2) throw new Error('SP: band hooks not found once in the table pass');
const bandText = (t) => t.replace(BAND_ANG, 'float ang = haloBandA.x - haloBandA.y + (float(cx) + 0.5) / haloPolarN.x * 2.0 * haloBandA.y,'), splitText = (t) => t.replace(SPLIT_HEAD, SPLIT_HEAD_CODE).replace(SPLIT_TAIL, SPLIT_CODE + SPLIT_TAIL);
// The table pass fragment text for a variant (also read by the sampler-budget script). variant: '' (the tables above), 'band' (polar) or 'split' (screen).
// IL: the sample inside each step moves from the log midpoint (fraction 0.5) to (phase + 0.5 + amount * (noise - 0.5)) / N^2, phase = the cell's place in an N x N block
// (N 2, or 4 with heavy blur); ds is unchanged, so each sample still stands for its whole step (stratified, unbiased). Applied last, so it composes with the polar, occlusion,
// band and split texts; off compiles the texts above unchanged.
const JIT_MID = 'sb = sa * qq, s = sqrt(sa * sb), ds = sb - sa;';
if (TMAIN.split(JIT_MID).length !== 2) throw new Error('IL: step midpoint not found once in the table pass');
// 'jittered': the noise is a fixed random fraction (jittered stratified sampling), hashed from cell, slice and step, so the offsets no longer repeat on a regular grid: a narrow
// beam's beads break up into grain the blur merges. Fixed per cell (no frame index), so a still frame does not flicker. haloJitAmt (uniform) scales it; 'interleaved' = amount 0.
// jit = 'interleaved' | 'jittered', optionally ':3' or ':4' for the 3 x 3 (medium blur) or 4 x 4 (heavy) pattern. 3 is not a power of two, so it takes a modulo, not a mask.
const JIT_NOISE = 'float(((uint(cx) * 1973u + uint(px.y) * 9277u + uint(tile) * 26699u + uint(m) * 31337u) * 1274126177u >> 16) & 65535u) / 65536.0';
const jitText = (main, jit) => {
  const N = /:4$/.test(jit) ? 4 : /:3$/.test(jit) ? 3 : 2, ph = N === 3 ? 'float((cx % 3) + 3 * (px.y % 3))' : `float((cx & ${N - 1}) + ${N} * (px.y & ${N - 1}))`, nz = /^jittered/.test(jit) ? `haloJitAmt * (${JIT_NOISE} - 0.5)` : '0.0';
  const t = main.replace(JIT_MID, `sb = sa * qq, s = sa * pow(qq, (${ph} + 0.5 + ${nz}) / ${(N * N).toFixed(1)}), ds = sb - sa;`); if (t === main) throw new Error('IL: jitter text not built');
  return 'uniform float haloJitAmt;\n' + t;
};
// SM (option trafficShadows): a sample the lamp's car map says the lamp cannot see adds nothing (drive-three-shadowmaps.js smLit; smM = this draw's map, -1 none). Same hook as crestOcc; off compiles the texts above.
// SMF: with both on, the crest test is the fallback for a lamp whose car has no map (smM -1), so a mapped car is tested once, by its map.
const smText = (t, occ) => { const hook = occ ? '      if (smM >= 0 ? !smLit(smM, haloEye + s * ray) : crestOcc(lamp, haloEye + s * ray)) continue;\n' : '      if (!smLit(smM, haloEye + s * ray)) continue;\n', r = t.split(OCC_HIT).join(hook + OCC_HIT); if (r === t) throw new Error('SM: hook not found'); return r; };
// P3 (option haloMoment): the table pass writes the first moment (the glow-weighted depth sum) into the free alpha channel, so the lookup can place
// each bin's mass at its mean depth instead of its upper edge. off compiles the shipped text unchanged (no surgery); on rewrites the march to split the
// scalar weight, declares accM, writes vec4(acc, accM), and scales accM with the share. The LW window runs the same march body, so the global rewrites hit
// both copies. P3 is ignoredWhile crossingRefine is on, so the crossing variant is never built here (the surgery guards on !refine too).
const momentText = (body) => body
  .replace(/acc \+= sigma \* p \* I \/ max\(r2, haloRMin \* haloRMin\) \* exp\(-sigma \* r\) \* exp\(-sigma \* s\) \* ds \* tint;/g, 'float w = sigma * p * I / max(r2, haloRMin * haloRMin) * exp(-sigma * r) * exp(-sigma * s) * ds; acc += w * tint; accM += s * w;')   // every copy of the march (the ladder and the LW window)
  .replace(/acc \+= sigma \* p \* I \/ max\(r2, haloRMin \* haloRMin\) \* exp\(-sigma \* r\) \* exp\(-sigma \* rs\) \* rds \* tint;/g, 'float w = sigma * p * I / max(r2, haloRMin * haloRMin) * exp(-sigma * r) * exp(-sigma * rs) * rds; acc += w * tint; accM += rs * w;')   // P3+RN: the crossing-refined ladder (crossText renames s→rs, ds→rds)
  .replace(/vec3 acc = vec3\(0\.0\);/g, 'vec3 acc = vec3(0.0); float accM = 0.0;')
  .replace(/vec4\(acc, 1\.0\)/g, 'vec4(acc, accM)')
  .replace('vec4(0.0, 0.0, 0.0, 1.0)', 'vec4(0.0, 0.0, 0.0, 0.0)')   // the split early-out: no march here, so no moment
  .replace(/acc \*= swt;/g, 'acc *= swt; accM *= swt;');   // the share scales the moment too
export function haloTableSource(atlas, polar = false, occ = false, variant = '', jit = false, sm = false, lw = 0, refine = 0, nb = false, moment = 0) {
  const main = occ && !sm ? (polar ? TMAIN_POLAR_OCC : TMAIN_OCC) : (polar ? TMAIN_POLAR : TMAIN), raw = refine ? crossText(main, refine, nb) : main;
  const body0 = variant === 'band' ? bandText(raw) : variant === 'split' ? splitText(raw) : raw, body = sm ? smText(body0, occ) : body0;
  const withLw = lw > 0 && !refine ? lwText(body, occ, sm) : body;
  const withMoment = moment ? momentText(withLw) : withLw;   // P3: the surgery runs on the moment variant (composes with refine now); off is the shipped text byte-for-byte
  return THEAD + (variant ? BAND_DECL : '') + (occ ? OCC_DECL : '') + (sm ? SM_DECL + 'uniform int smM;\n' : '') + (atlas ? ATLAS_HEAD + OTHER_ATLAS : 'int tbeam = 0;\n' + OTHER_LEGACY) + (jit ? jitText(withMoment, jit) : withMoment);
}
const HAL_CONV = (c) => (c === 'B' ? 1 : c === 'S' ? 2 : 0);
const half = (T.DataUtils && T.DataUtils.fromHalfFloat) || ((h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1; return e === 0 ? sg * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : sg * Infinity) : sg * Math.pow(2, e - 15) * (1 + m / 1024); });

// SL_HALO_DIV is a test override of the divisor (HDX4 resolution candidate); unset = unchanged.
// 1/4 of the view with 4 lamps or fewer (the stairs a coarser table leaves on a sharp glow edge show most on a lone distant car), 1/8 with more.
export function haloTableSize(w, h, lamps = 99, divOv = 0) { const div = globalThis.SL_HALO_DIV || divOv || (lamps <= HALO_FEW ? HALO_DIV_FEW : HALO_DIV); return [Math.max(HALO_MIN_W, Math.ceil(w / div)), Math.max(HALO_MIN_H, Math.ceil(h / div))]; }
// The CPU twin of the lookup in the shader (haloScatter): bins is the six bins, each [r, g, b]; d metres. Used by the page test to read the GPU table.
// HDX3 lookup (mirrors haloScatter in drive-three-shaders.js): C at each bin's upper edge is the running sum; bin 0 is log d from 0.5 m with C(0.5)=0;
// beyond the first edge, a monotone cubic Hermite (Fritsch-Carlson) in (log d, C) through the knots (the edges). Works for any ascending edges.
export function haloLookup(bins, d, edges = HALO_EDGES.slice(1), moment) {
  if (!(d > 0.5)) return [0, 0, 0];
  const n = HALO_BINS, dd = Math.min(d, edges[n - 1]), Cc = [];
  let C = [0, 0, 0];
  for (let k = 0; k < n; k++) { C = [C[0] + bins[k][0], C[1] + bins[k][1], C[2] + bins[k][2]]; Cc.push(C); }
  if (dd <= edges[0]) { const f = Math.log(dd / 0.5) / Math.log(edges[0] / 0.5); return Cc[0].map((v) => v * f); }
  if (moment) {   // P3/glm5.2: monotone Hermite (Fritsch-Carlson PCHIP) through the means, the CPU twin of the GPU haloCurveP3H
    const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // step5-preview (with qwen3.8max's clamp fix for the GPU P3H): a bin's mean clamped into its own bin, and the fallback
    // already inside it, so nearly-empty bins cannot throw a knot across the curve (the black rows / 7500x spike).
    const mean = (k) => { const m = bins[k], w = lum(m[0], m[1], m[2]), lo = k > 0 ? edges[k - 1] : 0.5, hi = edges[k];
      const raw = w > 1e-9 ? (m[3] || 0) / w : (lo + hi) / 2;
      return Math.min(hi, Math.max(lo, raw)); };
    const x = []; for (let k = 0; k < n; k++) x.push(Math.log(Math.max(mean(k), 0.5)));   // knot x = log(mean_k)
    for (let k = 1; k < n; k++) if (!(x[k] > x[k - 1])) x[k] = x[k - 1] + 1e-9;   // two means on one edge: keep the knot strictly increasing
    const y = Cc, h = [], sl = [];
    for (let k = 0; k < n - 1; k++) { h.push(x[k + 1] - x[k]); sl.push([0, 1, 2].map((c) => (y[k + 1][c] - y[k][c]) / h[k])); }
    const m = (k) => {   // knot slope; Fritsch-Carlson: zero where neighbouring segments disagree in sign, else the weighted harmonic mean
      if (k === 0) return sl[0]; if (k === n - 1) return sl[n - 2];
      return [0, 1, 2].map((c) => { const a = sl[k - 1][c], b = sl[k][c]; if (a * b <= 0) return 0; const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]; return (w1 + w2) / (w1 / a + w2 / b); });
    };
    let s = 0; for (let k = 0; k < n - 1; k++) if (dd > Math.exp(x[k])) s = k;   // segment s: means s..s+1 bracket dd
    const lx = Math.log(dd), t = (lx - x[s]) / h[s], t2 = t * t, t3 = t2 * t, mA = m(s), mB = m(s + 1), hh = h[s];
    return [0, 1, 2].map((c) => (2 * t3 - 3 * t2 + 1) * y[s][c] + (t3 - 2 * t2 + t) * hh * mA[c] + (-2 * t3 + 3 * t2) * y[s + 1][c] + (t3 - t2) * hh * mB[c]);
  }
  const x = edges.map(Math.log), y = Cc, h = [], sl = [];
  for (let k = 0; k < n - 1; k++) { h.push(x[k + 1] - x[k]); sl.push([0, 1, 2].map((c) => (y[k + 1][c] - y[k][c]) / h[k])); }
  const m = (k) => {   // knot slope; Fritsch-Carlson: zero where neighbouring segments disagree in sign, else the weighted harmonic mean
    if (k === 0) return sl[0]; if (k === n - 1) return sl[n - 2];
    return [0, 1, 2].map((c) => { const a = sl[k - 1][c], b = sl[k][c]; if (a * b <= 0) return 0; const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]; return (w1 + w2) / (w1 / a + w2 / b); });
  };
  let s = 0; for (let k = 0; k < n - 1; k++) if (dd > edges[k]) s = k;
  const lx = Math.log(dd), t = (lx - x[s]) / h[s], t2 = t * t, t3 = t2 * t, mA = m(s), mB = m(s + 1), hh = h[s];
  return [0, 1, 2].map((c) => (2 * t3 - 3 * t2 + 1) * y[s][c] + (t3 - 2 * t2 + t) * hh * mA[c] + (-2 * t3 + 3 * t2) * y[s + 1][c] + (t3 - t2) * hh * mB[c]);
}
// HDX6: the nearest lamp's projection on the screen, the inverse of the eye ray in TMAIN (pixels, y up, as gl_FragCoord). Null when the lamp is not
// clearly in front (behind, or nearly level with the eye) or its centre is far off-screen (|NDC| > HALO_POL_MAX): the screen table keeps it then.
export function haloPolarPick(p, eye, q, tanH, nR = HALO_POL_R) {
  const W = p.w, H = p.h, r = [q.L.x - eye[0], q.L.y - eye[1], q.L.z - eye[2]];
  if (!(r[0] > HALO_POL_MIN_X)) return null;
  const sx = -r[1] / (r[0] * tanH), sy = r[2] * W / (r[0] * tanH * H);
  if (Math.abs(sx) > HALO_POL_MAX || Math.abs(sy) > HALO_POL_MAX) return null;
  const C = [(sx + 1) * W / 2, (sy + 1) * H / 2];
  const rho = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - C[0], y - C[1])));   // the farthest corner: every screen pixel is inside
  return { C, rho, dL: (Math.log(rho) - Math.log(HALO_POL_MIN_PX)) / nR, sx, sy };
}
// TOUGE-ELEV B1: a touge frame projects the ribbon in the car frame (vertex carFromWorld*(position-eye), eye = p.eye), so a source in world
// coordinates maps through carFromWorld (Matrix3, column-major). The direction keeps its horizontal part and is renormalised. Distances are unchanged.
// TILT: each source's beam is its own car's world direction, horizontal heading (nx, ny) scaled by cos(p) plus elevation sin(p), where p is the
// trafficPitch of drive-three.js (atan(grade * heading . road tangent) at the source). The full vector goes through carFromWorld, so the car-frame
// elevation is p + our pitch (on a uniform slope, opposite headings, that is 0: level, as before). Both the world-frame elevation and our roll are kept.
// HALO_TILT_OFF (timing A/B only) reproduces the old frames exactly: p = 0 and the car-frame elevation is dropped.
export function toCarFrame(traffic, m, A) {
  const e = m.elements, mul = (v) => [e[0] * v[0] + e[3] * v[1] + e[6] * v[2], e[1] * v[0] + e[4] * v[1] + e[7] * v[2], e[2] * v[0] + e[5] * v[1] + e[8] * v[2]];
  const off = !!globalThis.HALO_TILT_OFF;
  return traffic.map((q) => {
    let b = [q.nx, q.ny, 0], F = null, L = null, U = null;
    if (!off) {
      const f = A.frame(q.x, q.y), sf = A.surface(f.s, f.off), dir = q.nx * f.t[0] + q.ny * f.t[1], p = Math.atan(sf.grade * dir);
      b = [q.nx * Math.cos(p), q.ny * Math.cos(p), Math.sin(p)];
      // ROLL: the beam's surface basis. H = heading with its grade, projected onto the road plane: F = unit(H - n (H.n)), up = n, left = n x F.
      // On zero bank the projection is the identity and F equals b's direction; on a bank, F is the road-tilted forward and carries the roll.
      if (sf.normal) {
        const n = sf.normal, H = [q.nx, q.ny, sf.grade * dir], hn = H[0] * n[0] + H[1] * n[1] + H[2] * n[2];
        const Fv = [H[0] - n[0] * hn, H[1] - n[1] * hn, H[2] - n[2] * hn], fl = Math.hypot(Fv[0], Fv[1], Fv[2]) || 1;
        F = Fv.map((v) => v / fl); U = n; L = [n[1] * F[2] - n[2] * F[1], n[2] * F[0] - n[0] * F[2], n[0] * F[1] - n[1] * F[0]];
      }
    }
    const P = mul([q.x, q.y, q.z]), d = mul(F || b), n = Math.hypot(d[0], d[1]) || 1;
    const o = { ...q, x: P[0], y: P[1], z: P[2], nx: d[0] / n, ny: d[1] / n, nz: off ? 0 : d[2] };
    if (F) { o.lat = mul(L); o.up = mul(U); }
    return o;
  });
}
export function haloPass(renderer, u) {
  const scene = new T.Scene(), camera = new T.Camera(), geo = new T.PlaneGeometry(2, 2);
  const mk = (atlas, polar = false, occ = false, variant = '', jit = false, sm = false, lw = 0, refine = 0, nb = false, moment = 0) => new T.ShaderMaterial({
    uniforms: sm ? { smTex: u.smTex, smE: u.smE, smF: u.smF, smL: u.smL, smU: u.smU, smP: u.smP, smRes: u.smRes, smM: { value: -1 } } : {}, vertexShader: TVERT, fragmentShader: haloTableSource(atlas, polar, occ, variant, jit, sm, lw, refine, nb, moment),
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: moment ? T.OneFactor : T.ZeroFactor, blendDstAlpha: T.OneFactor,   // P3/glm5.2: alpha accumulates additively (the first moment) only on the moment variant; off keeps the shipped discard
    depthTest: false, depthWrite: false,
  });
  const mats = [mk(false), mk(true)], matsP = [mk(false, true), mk(true, true)];   // matsP: HDX6 polar pass materials
  const varMats = new Map(); const varMat = (atlas, polar, occ, variant, refine = 0) => { const k = (atlas ? 1 : 0) + (polar ? 2 : 0) + (occ ? 4 : 0) + variant + ':' + refine; if (!varMats.has(k)) varMats.set(k, mk(atlas, polar, occ, variant, false, false, 0, refine)); return varMats.get(k); };   // SP: band / split variants, compiled on first use
  const occMats = new Map(); const occMat = (atlas, polar, refine = 0) => { const k = (atlas ? 1 : 0) + (polar ? 2 : 0) + ':' + refine; if (!occMats.has(k)) occMats.set(k, mk(atlas, polar, true, '', false, false, 0, refine)); return occMats.get(k); };   // E2: crest-occlusion variants, compiled on first use (option off never builds them)
  const jitMats = new Map(); const pick = (atlas, polar, occ, variant, jit, sm = false, lw = 0, refine = 0, nb = false, moment = 0) => {   // IL: jit off = exactly the materials the code picked before; on = its own variants, compiled on first use (SM: likewise); LW likewise; P3 (moment) likewise
    if (!jit && !sm && !lw && !refine && !moment) return variant ? varMat(atlas, polar, occ, variant) : occ ? occMat(atlas, polar) : (polar ? matsP : mats)[atlas ? 1 : 0];
    const k = [atlas, polar, occ, variant, jit, sm, lw, refine, nb, moment].join(); if (!jitMats.has(k)) jitMats.set(k, mk(atlas, polar, occ, variant, jit, sm, lw, refine, nb, moment)); return jitMats.get(k);
  };
  let blurMat = null; const blurTmp = new Map();   // IL: the bin blur pass and its scratch targets (one per source target), built on first use
  const blurBins = (srcRt, W, r, rd = 0) => {   // rows, columns (r), then depth (rd); ping-pong with a scratch target, srcRt holds the result
    if (!blurMat) blurMat = new T.ShaderMaterial({ uniforms: { src: { value: null }, bW: { value: 1 }, bR: { value: 1 }, bV: { value: 0 } }, vertexShader: TVERT, fragmentShader: TBLUR, blending: T.NoBlending, depthTest: false, depthWrite: false });
    let tmp = blurTmp.get(srcRt); if (!tmp || tmp.width !== srcRt.width || tmp.height !== srcRt.height) { if (tmp) tmp.dispose(); tmp = new T.WebGLRenderTarget(srcRt.width, srcRt.height, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false }); blurTmp.set(srcRt, tmp); }
    const U = blurMat.uniforms, passes = (r ? [[0, r], [1, r]] : []).concat(rd ? [[2, rd]] : []); if (passes.length % 2) passes.push([0, 0]);   // odd count: a copy lands it back in srcRt
    U.bW.value = W; mesh.material = blurMat; let a = srcRt, b = tmp;
    for (const [v, rr] of passes) { U.src.value = a.texture; U.bV.value = v; U.bR.value = rr; renderer.setRenderTarget(b); renderer.render(scene, camera); [a, b] = [b, a]; }
  };
  const cumMat = new T.ShaderMaterial({ uniforms: { src: { value: null }, cumW: { value: 1 }, cumN: { value: 1 } }, vertexShader: TVERT, fragmentShader: TCUM, blending: T.NoBlending, depthTest: false, depthWrite: false });   // PREFIX pass
  const mesh = new T.Mesh(geo, mats[0]); mesh.frustumCulled = false; scene.add(mesh);
  // SC (option scatterCull): the culled draws use their own mesh, one quad per depth slice covering only the cells the lamp can light (positions rewritten per draw), so the full quad above
  // stays exactly what off, the prefix pass and the E2 variants draw. Quads, not a scissor per tile: one draw call for all the slices of a lamp.
  const cscene = new T.Scene(), cgeo = new T.BufferGeometry(), cpos = new Float32Array(HALO_MAX * 12), cidx = new Uint16Array(HALO_MAX * 6);
  for (let k = 0; k < HALO_MAX; k++) cidx.set([4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3], 6 * k);
  cgeo.setAttribute('position', new T.BufferAttribute(cpos, 3)); cgeo.setIndex(new T.BufferAttribute(cidx, 1));
  const cmesh = new T.Mesh(cgeo, mats[0]); cmesh.frustumCulled = false; cscene.add(cmesh);
  // Draw material m over slices k0..k1 of a target of nW x nH texels per tile; rect = [cx0, cx1, cy0, cy1] cells of each tile, or null for the whole tile.
  const drawBound = (m, k0, k1, rect, nW, nH) => {
    const W = nW * HALO_N, r = rect || [0, nW - 1, 0, nH - 1], sh = rect && globalThis.SL_CULL_SHRINK || 0;   // SL_CULL_SHRINK: test control (the rectangle shrunk by this many cells a side)
    const x0 = r[0] + sh, x1 = r[1] + 1 - sh, y0 = r[2] + sh, y1 = r[3] + 1 - sh; let n = 0;
    if (x0 >= x1 || y0 >= y1) return;
    for (let k = k0; k <= k1; k++, n++) {
      const a = (k * nW + x0) / W * 2 - 1, b = (k * nW + x1) / W * 2 - 1, c = y0 / nH * 2 - 1, d = y1 / nH * 2 - 1;
      cpos.set([a, c, 0, b, c, 0, b, d, 0, a, d, 0], 12 * n);
    }
    cgeo.attributes.position.needsUpdate = true; cgeo.setDrawRange(0, 6 * n); cmesh.material = m; renderer.render(cscene, camera);
  };
  // rt: the bin table (what probe() reads). cumRt: its prefix sums across tiles (what the lookup reads). Both are sized alike.
  let autoFew = false;   // AT: the auto rule's state (hysteresis)
  let rt = null, cumRt = null, tab = [0, 0], tabClamp = null; const rts = new Map();   // targets by size, so the lamp count crossing 4 never reallocates
  const arr = () => Array.from({ length: HALO_PER_DRAW }, () => new T.Vector4());
  const hLamp = arr(), hDir = arr(), hTint = arr(), hLat = arr(), hUp = arr(), tabV = new T.Vector2(), edgesV = new Array(HALO_MAX).fill(HALO_RANGE); u.haloE.value = edgesV;   // one array: the table shader's hi/lo and the lookup read the same edges (HDX7: padded to HALO_MAX)
  // ROLL: the source's surface basis for the beam (w = 1 when present; 0 = the level-road formulas in the shader).
  const setBasis = (L) => { if (L.lat) { hLat[0].set(L.lat[0], L.lat[1], L.lat[2], 1); hUp[0].set(L.up[0], L.up[1], L.up[2], 0); } else { hLat[0].set(0, 0, 0, 0); hUp[0].set(0, 0, 0, 0); } };
  const ensure = (p, n, divOv) => {
    let [tw, th] = haloTableSize(p.w, p.h, n, divOv);
    // HDX7: the table is HALO_N tiles side by side, so one tile may be at most maxTextureSize / HALO_N cells wide (at 1920 px and divisor 1.4 it is not, at 24 bins).
    const cap = Math.floor(renderer.capabilities.maxTextureSize / HALO_N); tabClamp = tw > cap ? { asked: tw, used: cap } : null; if (tw > cap) tw = cap;
    const key = tw + 'x' + th + 'x' + HALO_N;
    const opt = { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false };
    if (!rts.has(key)) { if (rts.size > 3) { for (const r of rts.values()) { r.bin.dispose(); r.cum.dispose(); } rts.clear(); } rts.set(key, { bin: new T.WebGLRenderTarget(tw * HALO_N, th, opt), cum: new T.WebGLRenderTarget(tw * HALO_N, th, opt) }); }
    const e = rts.get(key); rt = e.bin; cumRt = e.cum; tab = [tw, th]; tabV.set(tw, th);
  };
  // SC: the non-zero extent of a lamp's beam (drive-three-halo-cull.js beamExtent), read from the texture the shader reads, so it is the shader's own data. Cached per texel array
  // (a new atlas pack is a new array), so a beam is scanned once when its atlas is built, not per frame. null = the beam is all zero (nothing to light); unknown = unbounded.
  const basisOf = (q) => { const L = q.L, se = L.nz || 0, ce = Math.sqrt(Math.max(1 - se * se, 0)); return L.lat ? { f: [L.nx * ce, L.ny * ce, se], l: L.lat, u: L.up } : { f: [L.nx * ce, L.ny * ce, se], l: [-L.ny, L.nx, 0], u: [-se * L.nx, -se * L.ny, ce] }; };   // the shader's local axes (TMAIN)
  const extCache = new WeakMap();
  const beamExtentOf = (idx, legacy) => {
    const tex = u.otherBeam.value, img = tex && tex.image; if (!img || !img.data) return { e: { h: [-1e3, 1e3], v: [-1e3, 1e3], max: Infinity }, conv: 0, scale: 1 };
    let g, size, row0, conv, scale;
    if (legacy) { const i = u.otherLutInfo.value, z = u.otherLutSize.value; g = [i.x, i.y, 1 / i.z, 1 / i.z]; size = [z.x, z.y]; row0 = 0; conv = HAL_CONV(legacy.conv); scale = 1; }
    else { const gv = u.beamGrid.value[idx], mv = u.beamMeta.value[idx]; g = [gv.x, gv.y, gv.z, gv.w]; size = [mv.y, mv.z]; row0 = Math.round(mv.x); conv = Math.round(u.beamTint.value[idx].w); scale = mv.w; }
    const key = [legacy ? 'L' : idx, ...g, ...size, row0].join(','); let per = extCache.get(img.data); if (!per) extCache.set(img.data, per = new Map());
    if (!per.has(key)) { const e = beamExtent(img.data, row0, img.width, g, size); per.set(key, e ? { e, conv, scale } : null); }
    return per.get(key);
  };
  const prts = [], prtNs = []; let polarArrDim = '';   // HDX6: the polar tables (HALO_POL_R rows, HALO_N bins side by side); HDX7: one target per table, rebuilt when the bin count changes
  // B10: the prefix (cum) targets of both polar tables are the two layers of ONE array target, read through one sampler2DArray (haloPolarTex; layer = table index).
  //   pseudocode: cumArr = array target (W x R x 2, half float, Nearest), rebuilt when HALO_N changes; table si: bin (2D, drawn into) -> prefix -> cumArr layer si
  let polarArr = null, polarArrN = 0;
  // Each polar table has a bin target (drawn into) and a layer of the shared prefix array (read by the lookup). Returns { bin, cum (the array target), layer }.
  const ensurePolar = (si = 0, nT = HALO_POL_TH, nR = HALO_POL_R) => {   // SP: nT x nR is 512 x 64 for off / merged / perlamp; haloPolar auto passes its band size (a size change rebuilds the targets)
    const dim = nT + 'x' + nR;
    if (!polarArr || polarArrN !== HALO_N || polarArrDim !== dim) {
      if (polarArr) polarArr.dispose();
      polarArr = new T.WebGLArrayRenderTarget(nT * HALO_N, nR, 2, { type: T.HalfFloatType, format: T.RGBAFormat, depthBuffer: false }); polarArrN = HALO_N; polarArrDim = dim;
      polarArr.texture.minFilter = polarArr.texture.magFilter = T.NearestFilter; polarArr.texture.generateMipmaps = false;
    }
    if (!prts[si] || prtNs[si] !== HALO_N + dim) {
      if (prts[si]) prts[si].bin.dispose();
      const opt = { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false };
      prts[si] = { bin: new T.WebGLRenderTarget(nT * HALO_N, nR, opt), layer: si }; prtNs[si] = HALO_N + dim;
    }
    return { bin: prts[si].bin, cum: polarArr, layer: si };
  };
  // PREFIX pass: src (bin texels, tiles of width W) -> dst (running totals). Full-target quad, no blending.
  const prefix = (src, dst, W, layer = 0) => { cumMat.uniforms.src.value = src; cumMat.uniforms.cumW.value = W; cumMat.uniforms.cumN.value = HALO_N; renderer.setRenderTarget(dst, layer); mesh.material = cumMat; renderer.render(scene, camera); };
  const halo = {
    edges: HALO_EDGES.slice(1),   // this frame's bin upper edges (page-test hook)
    polars: [],   // HDX7: one entry per polar table this frame ({ lamps, C, rho, dL })
    get tabClamp() { return tabClamp; },   // HDX7: { asked, used } when the table was narrowed to fit maxTextureSize, else null
    drawn: 0,      // lamps in the table this frame (page-test hook)
    lamps: [],     // those lamps (world position, direction, atlas index), nearest first
    passes: 0,     // draws this frame
    cull: null,    // SC: this frame's culling ({ mode, eps, lamps: [{ k0, k1, rect, cells, full, radius }] }) or null when scatterCull is off
    msPolar: 0,    // HDX6: polar pass wall time (SL_HALO_TIMING only), 0 when off
    polar: null,   // HDX6: the polar lamp (centre px, radius px, log step) or null
    polarNote: null,   // HDX6: why the polar table is off this frame, when SL_HALO_POLAR is set
    tqPending: [],   // test hook: GPU timer queries not yet read (SL_HALO_TQ)
    tqPoll() { const g = renderer.getContext(), x = g.getExtension('EXT_disjoint_timer_query_webgl2'), out = []; if (!x) return out; const keep = []; const dis = g.getParameter(x.GPU_DISJOINT_EXT); for (const q of halo.tqPending) { if (g.getQueryParameter(q, g.QUERY_RESULT_AVAILABLE)) { if (!dis) out.push(g.getQueryParameter(q, g.QUERY_RESULT) / 1e6); g.deleteQuery(q); } else keep.push(q); } halo.tqPending = keep; return out; },   // test hook: finished GPU ms of the table draws, in frame order (disjoint = dropped)
    ms: 0,         // table pass wall time (1-pixel readback sync), only when globalThis.SL_HALO_TIMING is set (test hook)
    get table() { return rt; }, get cumTable() { return cumRt; }, get tab() { return tab; },   // BRIEF J: cumTable = the table the lookup reads (test hook haloTableBytes)
    // Build the table for this frame and point the lookup at it. Call before the ground pass. Off: haloOn 0, nothing drawn.
    build(p, world, occ = null, sm = null) {
      halo.cone = null; halo.sm = null; halo.smCars = null;   // CP, SM
      halo.drawn = 0; halo.lamps = []; halo.passes = 0; u.haloOn.value = 0; halo.sources = null; halo.cull = null; halo.cross = 0;
      u.haloPolarOn.value = 0; u.haloPolarOn2.value = 0; u.haloBandOn.value = 0; halo.msPolar = 0; halo.polar = null; halo.polars = []; halo.occ = false; halo.jit = false; halo.blur = 0; halo.dblur = 0;   // HDX6, HDX7; E2: crest occlusion used this frame
      const N = D.haloN(p); if (!N) return 0;
      // HDX7: the look's halo settings. Bins: a count (clamped to 4..32; HALO_REQ keeps the ask). Divisor: 0 = the lamp-count rule. Gain: 1 = as computed.
      const look = p.look || {}, wantN = look.haloBins != null ? +look.haloBins : HALO_URL_N;
      if (wantN !== HALO_REQ) setHaloBins(wantN);
      const rangeG = haloRangeGpu(look); if (rangeG !== HALO_RANGE) setHaloRange(rangeG);   // SR/OHR: the table's far edge (look.haloRange, else scatterRange)
      u.haloNu.value = HALO_N; u.haloH.value = haloStepOf(HALO_N); u.haloGain.value = look.haloGain != null ? +look.haloGain : 1; u.haloSMax.value = HALO_RANGE; u.haloMoment.value = look.haloMoment === 'on' ? 1 : 0;   // P3/glm5.2: mean-placement (0 = shipped edges)
      const eye = p.eye || [-2, 0.37, 1.2], traffic = p.touge ? toCarFrame(D.trafficSources(world.objects, eye, p, world.A), u.carFromWorld.value, world.A) :D.trafficSources(world.objects, eye, p, world.A);   // TOUGE-ELEV B1: touge lamps into the car frame the ribbon projects in
      if (!traffic.length) return 0;
      halo.sources = traffic;   // test hook: the sources the table was built from (beam, tint, axis)
      const atlas = !!D.trafficAtlasPool(p, traffic);   // HB: the same test as drive-three.js
      const tanH = Math.tan(p.hfov * Math.PI / 360), sig = D.sigmaOf(p.look || {}), legacy = atlas ? null : D.trafficBeam(p);
      const ranked = traffic.map((L, i) => ({ L, i, d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, Math.min(N, HALO_MAXL));
      const used = [];
      for (const { L } of ranked) {
        const idx = atlas ? (L.idx !== undefined ? L.idx : D.trafficPickIndexOf(p, L.car)) : 0;   // HB: a high-dip source carries its atlas slot
        if (atlas && idx < 0) continue;   // a car with no pool pick has no atlas beam: the CPU twin would use the built-in table (not in the atlas)
        const tn = atlas ? u.beamTint.value[idx] : null;
        used.push({ L, idx, tint: [tn ? tn.x : 1, tn ? tn.y : 1, tn ? tn.z : 1] });
      }
      // SM (option trafficShadows, pass frames): one depth map per car, nearest cars first (drive-three-shadowmaps.js). Eye = the midpoint of the car's lamps here, axes = its beam's,
      // field = the beam's non-zero extent + 2 deg (at most 60 H, 35 V). sm (drive-three.js) renders them; smCars: car id -> map index. Off: nothing runs, the texts are the old ones.
      const smK = p.touge && sm && look.trafficShadows && look.trafficShadows !== 'off' ? (look.trafficShadows === 'all' ? SM_MAX : Math.min(SM_MAX, Math.max(0, Math.round(+look.trafficShadows) || 0))) : 0;
      const smRes = SM_RES[look.shadowRes] || SM_RES['1024x512'], smCap = Math.max(1, Math.floor((renderer.capabilities.maxTextureSize || 4096) / smRes[1]));   // the maps stack vertically in one texture: never taller than the GPU allows (fewer maps, nearest kept)
      let smCars = null;
      if (smK) {
        const cars = [];
        for (const q of used) { const id = q.L.car; if (id === undefined || cars.some((c) => c.id === id)) continue; if (cars.length >= Math.min(smK, smCap)) break; cars.push({ id, lamps: used.filter((o) => o.L.car === id) }); }
        const DG = Math.PI / 180, list = cars.map((c) => {
          const n = c.lamps.length, at = [0, 1, 2].map((k) => c.lamps.reduce((a, o) => a + [o.L.x, o.L.y, o.L.z][k], 0) / n), b = basisOf(c.lamps[0]);
          let hd = 0, vd = 0; for (const o of c.lamps) { const ext = beamExtentOf(o.idx, legacy); if (ext) { hd = Math.max(hd, Math.abs(ext.e.h[0]), Math.abs(ext.e.h[1])); vd = Math.max(vd, Math.abs(ext.e.v[0]), Math.abs(ext.e.v[1])); } }
          hd = Math.min(60, hd + 2); vd = Math.min(35, vd + 2);
          return { eye: at, f: b.f, l: b.l, u: b.u, tanH: Math.tan(hd * DG), tanV: Math.min(1.2, Math.tan(vd * DG) / Math.cos(hd * DG)) };   // tanV / cos H: an elevation at the edge azimuth sits higher on a flat map
        });
        if (list.length) { sm.render(list, smRes); smCars = new Map(cars.map((c, i) => [c.id, i])); }
      }
      halo.sm = smCars ? { cars: [...smCars.keys()], maps: smCars.size } : null; halo.smCars = smCars;
      const useSm = !!smCars, smOf = (q) => (smCars && q.L.car !== undefined && smCars.has(q.L.car) ? smCars.get(q.L.car) : -1);
      const nRule = used.length;   // AT: the table-size rule counts every lamp, the cone pass's too, so a hand-over cannot flip the resolution mid-bend
      // CP (option haloConePass 1 | 2): the nearest lamps whose beam we see side-on go to the cone pass (drive-three-beamcone.js) with share w = smoothstep over the angle between the beam
      // axis and the line to our eye (from haloConeAngle to haloConeAngle + CP_FADE deg; haloConeAngle 0 = share 1 for any angle); this table keeps W * (1 - w), and a lamp with w = 1 leaves it.
      // Done before the polar plan, so a lamp-centred table never carries a lamp the cone pass has. Off: `used` is untouched.
      const coneK = String(look.haloConePass) === '2' ? 2 : String(look.haloConePass) === '1' ? 1 : 0, cone = [];
      if (coneK) {
        const a0 = look.haloConeAngle === undefined ? CP_ANGLE : +look.haloConeAngle;
        for (const q of used) {
          if (cone.length >= coneK) break;
          const b = basisOf(q), dx = eye[0] - q.L.x, dy = eye[1] - q.L.y, dz = eye[2] - q.L.z, dl = Math.hypot(dx, dy, dz) || 1;
          const ang = Math.acos(Math.max(-1, Math.min(1, (b.f[0] * dx + b.f[1] * dy + b.f[2] * dz) / dl))) * 180 / Math.PI;
          const t = a0 <= 0 ? 1 : Math.max(0, Math.min(1, (ang - a0) / CP_FADE)), w = t * t * (3 - 2 * t);
          if (!(w > 0)) continue;
          const ext = beamExtentOf(q.idx, legacy); if (!ext) continue;   // an all-zero beam lights nothing
          const cc = coneClip([q.L.x, q.L.y, q.L.z], b, ext.e, ext.conv); if (!cc) continue;
          cone.push({ q, w, ang, basis: b, planes: cc.planes });
        }
        for (const c of cone) { const i = used.indexOf(c.q), Wt = c.q.L.w === undefined ? 1 : c.q.L.w; c.W = Wt * c.w; if (c.w >= 1 - 1e-4) used.splice(i, 1); else used[i] = { ...c.q, L: { ...c.q.L, w: Wt * (1 - c.w) } }; }
      }
      halo.cone = cone.length ? { lamps: cone.map((c) => ({ pos: [c.q.L.x, c.q.L.y, c.q.L.z], w: c.W, share: c.w, angle: c.ang, tint: c.q.tint, idx: c.q.idx, basis: c.basis, planes: c.planes, sm: smOf(c.q) })),
        atlas, eye: eye.slice(), tanH, sigma: sig, rMin: D.SCAT.rMin, gF: D.SCAT.gFwd, gB: D.SCAT.gBack, wF: D.SCAT.wFwd, range: HALO_RANGE, gain: look.haloGain != null ? +look.haloGain : 1, flat: !p.touge, sm: useSm, occ: occ && p.touge ? occ : null } : null;
      if (!used.length) return 0;
      // HDX7 polar plan. SL_HALO_POLAR (test hook) = one polar table for the nearest lamp, as HDX6. look.haloPolar: off, perlamp (a table per lamp of
      // the nearest car, one or two), merged (one table centred between the car's two lamps, both lamps drawn into it).
      const pmode = globalThis.SL_HALO_POLAR && (!look.haloPolar || look.haloPolar === 'off') ? 'perlamp' : (look.haloPolar || 'off');
      const plamps = look.haloPolarLamps === 1 ? 1 : 2;
      // SP: haloPolar 'auto' = the merged table (below) while the nearest lamp is more than AUTO_FAR_M from the eye, faded out between AUTO_FAR_M and AUTO_NEAR_M (share = smoothstep(8, 12, d)), none
      // inside AUTO_NEAR_M, and the table covers only a band of angles about the beam's top edge (polarBand), at a reduced size (look.haloPolarBand, nT x nR). The screen table carries the rest.
      const autoM = pmode === 'auto', dNear = Math.hypot(used[0].L.x - eye[0], used[0].L.y - eye[1], used[0].L.z - eye[2]), share = autoM ? Math.min(1, Math.max(0, (dNear - AUTO_NEAR_M) / (AUTO_FAR_M - AUTO_NEAR_M))) : 1, wd = share * share * (3 - 2 * share);
      const bres = /^(\d+)x(\d+)$/.exec(String(globalThis.SL_HALO_BAND || look.haloPolarBand || '128x32')) || ['', '128', '32'], pol = autoM ? { nT: +bres[1], nR: +bres[2] } : { nT: HALO_POL_TH, nR: HALO_POL_R };
      const plan = [];   // [{ lamps: [q, ...], pk, band }], one polar table each
      if (pmode !== 'off' && !(autoM && !(wd > 0))) {
        if (renderer.capabilities.maxTextureSize < pol.nT * HALO_N) halo.polarNote = 'polar width ' + pol.nT * HALO_N + ' over maxTextureSize ' + renderer.capabilities.maxTextureSize;
        else {
          const first = used[0], second = plamps === 2 ? used.slice(1).find((q) => q.L.car !== undefined && q.L.car === first.L.car) : null;   // the nearest car's other lamp
          if ((pmode === 'merged' || autoM) && second) {
            const mid = { x: (first.L.x + second.L.x) / 2, y: (first.L.y + second.L.y) / 2, z: (first.L.z + second.L.z) / 2 };
            const pk = haloPolarPick(p, eye, { L: mid }, tanH, pol.nR);
            if (pk) plan.push({ lamps: [first, second], pk }); else halo.polarNote = 'merged centre not clearly in front: screen table';
          } else if (autoM) {
            const pk = haloPolarPick(p, eye, first, tanH, pol.nR);
            if (pk) plan.push({ lamps: [first], pk }); else halo.polarNote = 'nearest lamp not clearly in front or off-screen: screen table';
          } else {
            for (const q of (second ? [first, second] : [first])) { const pk = haloPolarPick(p, eye, q, tanH); if (pk) plan.push({ lamps: [q], pk }); else halo.polarNote = 'nearest lamp not clearly in front or off-screen: screen table'; }
          }
        }
      }
      if (autoM && !(wd > 0)) halo.polarNote = 'auto: nearest lamp within ' + AUTO_NEAR_M + ' m, screen table only';
      if (autoM) for (const s of plan) {   // the band: where this table's lamps' beam top edges fall on the screen, about the table centre
        const items = s.lamps.map((q) => { const ext = beamExtentOf(q.idx, legacy); return ext && { pos: [q.L.x, q.L.y, q.L.z], basis: basisOf(q), conv: ext.conv, top: ext.e.top }; }).filter(Boolean);
        s.band = { ...polarBand(items, { eye, tanH, w: p.w, h: p.h }, s.pk.C), wd, dNear, nT: pol.nT, nR: pol.nR };
      }
      const polarSet = new Set(plan.flatMap((s) => s.lamps));
      halo.polars = plan.map((s) => ({ lamps: s.lamps.map((q) => [q.L.x, q.L.y, q.L.z]), C: s.pk.C, rho: s.pk.rho, dL: s.pk.dL, band: s.band || null }));
      halo.polar = plan.length ? { lamp: [plan[0].lamps[0].L.x, plan[0].lamps[0].L.y, plan[0].lamps[0].L.z], C: plan[0].pk.C, rho: plan[0].pk.rho, dL: plan[0].pk.dL } : null;
      haloEdgesFor(Math.hypot(used[0].L.x - eye[0], used[0].L.y - eye[1], used[0].L.z - eye[2]), edgesV); halo.edges = edgesV.slice(0, HALO_BINS);
      // AT (halo table auto): the lamp-count rule (few lamps -> the finer divisor) with hysteresis (back to the coarser one only at HALO_FEW + 2 lamps, so 4 <-> 5 does not flicker),
      // between the divisors of look.haloAutoRange ('4-8' = the old rule). A fixed haloDiv bypasses all of it.
      const ar = /^([\d.]+)-([\d.]+)$/.exec(String(look.haloAutoRange || '4-8')) || ['', '4', '8'];
      if (nRule <= HALO_FEW) autoFew = true; else if (nRule >= HALO_FEW + 2) autoFew = false;
      const divAuto = +look.haloDiv > 0 ? +look.haloDiv : (autoFew ? +ar[1] : +ar[2]); halo.div = divAuto;
      ensure(p, used.length, divAuto);
      const timing = !!globalThis.SL_HALO_TIMING; if (timing) { renderer.getContext().finish(); } const t0 = timing ? performance.now() : 0;   // test hook: wall time of the table pass, synchronised by a 1-pixel readback
      const nearSub = [1, 2, 4].includes(+look.haloNearSub) ? +look.haloNearSub : HALO_SUB;   // AT: sub-passes for lamps within HALO_NEAR (4 = as before)
      const useOcc = !!(occ && p.touge); halo.occ = useOcc; const jm = look.haloJitter === 'interleaved' || look.haloJitter === 'jittered' ? look.haloJitter : '', hb = look.haloBlur || 'auto';   // IL: sampling mode; blur auto = light when sampling is on, else off
      const blurR = hb === 'heavy' ? 3 : hb === 'medium' ? 2 : hb === 'light' || (hb === 'auto' && jm) ? 1 : 0, jit = jm ? jm + (blurR === 3 ? ':4' : blurR === 2 ? ':3' : '') : '', jitAmt = Math.max(0, Math.min(1, look.haloJitterAmount === undefined ? 1 : +look.haloJitterAmount));
      const blurD = look.haloDepthBlur === 'heavy' ? 2 : look.haloDepthBlur === 'light' ? 1 : 0;   // IL: depth blur, independent of the rest
      const refineN = [32, 64, 128, 256, 512, 2048].includes(+look.haloCrossingRefine) ? +look.haloCrossingRefine : 0;   // P1c: the crossing bin's extra steps (0 = the shipped six; 32..2048 = the refined ladder's cell count)
      const lwRaw = look.haloLampWin, lwK = refineN ? 0 : lwRaw === 'off' || lwRaw === undefined || lwRaw === null || lwRaw === 0 ? 0 : Math.max(4, Math.min(96, Math.round(+lwRaw || 0)));   // LW: window steps per bin (0 = the old 6-step ladder); P1c wins if both are on
      const nbN = refineN > 0 && look.haloRefineNeighbour === 'on';   // RN: widen P1c's trigger to the crossing bin's eye-side neighbour (inert unless P1c is on)
      halo.lw = lwK; halo.cross = refineN; halo.nb = nbN ? 1 : 0; halo.moment = look.haloMoment === 'on' ? 1 : 0;   // LW: the lamp-window schedule used this frame (0 = off); RN: 1 = the neighbour bin is refined too; P3/glm5.2: mean-placement on
      halo.jit = jit; halo.blur = blurR; halo.dblur = blurD;   // IL: interleaved sampling   // E2: crest occlusion (pass frames only; occ = the ribbon height map + the world-from-car matrix, drive-three.js)
      const occU = (mm) => { if (useOcc) Object.assign(mm.uniforms, { crestH: { value: occ.texture }, crestWFC: { value: occ.wfc }, crestBox: { value: occ.box }, crestZ: { value: occ.z } }); if (jit) mm.uniforms.haloJitAmt = { value: jitAmt }; };   // IL: the jitter amount rides along
      const ac = renderer.autoClear, cc = new T.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc);
      const setPolarU = (mp, q, P, j, pk) => {
        hLamp[0].set(q.L.x, q.L.y, q.L.z, q.L.w === undefined ? 1 : q.L.w); hDir[0].set(q.L.nx, q.L.ny, q.L.nz || 0, 0); setBasis(q.L); hTint[0].set(q.tint[0], q.tint[1], q.tint[2], q.idx);
        Object.assign(mp.uniforms, {
          hLamp: { value: hLamp }, hDir: { value: hDir }, hLat: { value: hLat }, hUp: { value: hUp },hTint: { value: hTint }, nHalo: { value: 1 }, haloP: { value: P }, haloSub: { value: j }, haloTab: { value: tabV }, haloEdges: { value: edgesV },
          haloEye: { value: new T.Vector3(eye[0], eye[1], eye[2]) }, haloRMin: { value: D.SCAT.rMin },
          haloGFwd: { value: D.SCAT.gFwd }, haloGBack: { value: D.SCAT.gBack }, haloWFwd: { value: D.SCAT.wFwd },
          sigma: { value: sig }, tanH: { value: tanH }, size: { value: new T.Vector2(p.w, p.h) }, haloLampW: { value: lwK },
          otherBeam: { value: u.otherBeam.value }, otherLutInfo: { value: u.otherLutInfo.value }, otherLutSize: { value: u.otherLutSize.value },
          otherConvention: { value: legacy ? HAL_CONV(legacy.conv) : 0 },
          beamMeta: { value: u.beamMeta.value }, beamGrid: { value: u.beamGrid.value }, beamTint: { value: u.beamTint.value },
          haloPolarC: { value: new T.Vector2(pk.C[0], pk.C[1]) }, haloPolarRange: { value: new T.Vector2(Math.log(HALO_POL_MIN_PX), pk.dL) }, haloPolarN: { value: new T.Vector2(pol.nT, pol.nR) },
        });
        if (pk.band) mp.uniforms.haloBandA = { value: new T.Vector4(pk.band.ac, pk.band.hw, pk.band.fade, pk.band.wd) };   // SP
        occU(mp); if (useSm) mp.uniforms.smM.value = smOf(q);
      };
      // Test hook (inert unless globalThis.SL_HALO_TQ is set): a GPU timer query around every draw of the table (screen + polar + prefix), results collected by tqPoll().
      const tqx = globalThis.SL_HALO_TQ ? renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2') : null; let tq = null;
      if (tqx) { const g = renderer.getContext(); if (!g.getQuery(tqx.TIME_ELAPSED_EXT, g.CURRENT_QUERY)) { tq = g.createQuery(); g.beginQuery(tqx.TIME_ELAPSED_EXT, tq); } }
      // SC (look.scatterCull exact | fast; absent or off = today's full-screen draws): per lamp, bound the air its beam can light and draw only those slices and cells.
      // exact keeps every sample the shader can find lit, so the table is byte for byte what off makes. fast also drops the air beyond a radius where the lamp's best case is under eps.
      const cullMode = look.scatterCull === 'exact' || look.scatterCull === 'fast' ? look.scatterCull : 'off', cullEps = look.scatterCullEps > 0 ? +look.scatterCullEps : 0.05;
      const bounds = new Map(), cstat = new Map(); let cullPlan = null;
      if (cullMode !== 'off') {
        const minRayX = 1 / Math.sqrt(1 + tanH * tanH * (1 + (p.h / p.w) * (p.h / p.w))), edges = HALO_EDGES;
        const vScreen = { eye, tanH, aspect: p.h / p.w, edges, tab, frustum: true, xmin: 0.45 * minRayX }, vPolar = { eye, tanH, aspect: p.h / p.w, edges, tab: null, frustum: false, xmin: 0 };
        cullPlan = { lamps: [] };
        const boundOf = (q, screen) => {   // litBound for this lamp: the cone clip (the forward plane and the beam's non-zero angles), plus the fast ball
          const key = (screen ? 's' : 'p'); let b = bounds.get(q); if (b && b[key]) return b[key]; if (!b) bounds.set(q, b = {});
          const L = q.L, ext = beamExtentOf(q.idx, legacy), basis = basisOf(q);
          const lp = [L.x, L.y, L.z], clips = [ext ? coneClip(lp, basis, ext.e, ext.conv) : null]; let radius = Infinity;
          if (cullMode === 'fast' && ext) {
            let mp = 0; for (let i = 0; i <= 64; i++) { const c = -1 + i / 32, ph = (g, c) => (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * c, 1.5)); mp = Math.max(mp, D.SCAT.wFwd * ph(D.SCAT.gFwd, c) + (1 - D.SCAT.wFwd) * ph(D.SCAT.gBack, c)); }
            radius = fastRadius(sig, mp, ext.e.max * ext.scale * (L.w === undefined ? 1 : L.w) * Math.max(q.tint[0], q.tint[1], q.tint[2]), D.SCAT.rMin, cullEps); clips.push(ballClip(lp, radius));
          }
          const r = litBound(screen ? vScreen : vPolar, clips); r.radius = radius; return (b[key] = r);
        };
        cullPlan.boundOf = boundOf;
      }
      const cellsOf = (b, nW, nH, rect) => b.empty ? 0 : (b.k1 - b.k0 + 1) * (rect ? (rect[1] - rect[0] + 1) * (rect[3] - rect[2] + 1) : nW * nH);
      try {
        renderer.autoClear = false; const m = pick(atlas, false, useOcc, '', jit, useSm, lwK, refineN, nbN, halo.moment);
        const bandPlan = plan[0] && plan[0].band ? plan[0] : null, splitM = bandPlan ? pick(atlas, false, useOcc, 'split', jit, useSm, lwK, refineN, nbN, halo.moment) : null;   // SP: in auto, the table's lamps are also drawn in the screen table with the complementary share
        renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); mesh.material = m;
        // The nearest HALO_REFINE lamps within HALO_NEAR metres are drawn in HALO_SUB sub-passes (24 steps per bin); the rest in one (6).
        used.forEach((q, i) => {
          const split = bandPlan && polarSet.has(q);   // SP: a band table's lamp is in both tables
          if (polarSet.has(q) && !split) return;   // HDX6/HDX7: a polar lamp is in its own table, not this one
          const bd = cullPlan ? cullPlan.boundOf(q, true) : null;   // SC: this lamp's slices and cells (null = the whole table, as before)
          if (bd) { cstat.set(q, { k0: bd.k0, k1: bd.k1, rect: bd.rect, cells: cellsOf(bd, tab[0], tab[1], bd.rect), full: tab[0] * tab[1] * HALO_N, radius: bd.radius, table: 'screen' }); if (bd.empty) return; }
          const P = i < HALO_REFINE && q.L.x - eye[0] < HALO_NEAR ? (globalThis.SL_HALO_SUB || nearSub) : 1;   // SL_HALO_SUB: test override (cost comparison); AT: look.haloNearSub
          const mm = split ? splitM : m; mesh.material = mm;
          for (let j = 0; j < P; j++) {
            hLamp[0].set(q.L.x, q.L.y, q.L.z, q.L.w === undefined ? 1 : q.L.w); hDir[0].set(q.L.nx, q.L.ny, q.L.nz || 0, 0); setBasis(q.L); hTint[0].set(q.tint[0], q.tint[1], q.tint[2], q.idx);
            if (split) Object.assign(mm.uniforms, { haloBandA: { value: new T.Vector4(bandPlan.band.ac, bandPlan.band.hw, bandPlan.band.fade, bandPlan.band.wd) }, haloPolarC: { value: new T.Vector2(bandPlan.pk.C[0], bandPlan.pk.C[1]) } });
            Object.assign(mm.uniforms, {
              hLamp: { value: hLamp }, hDir: { value: hDir }, hLat: { value: hLat }, hUp: { value: hUp },hTint: { value: hTint }, nHalo: { value: 1 }, haloP: { value: P }, haloSub: { value: j }, haloTab: { value: tabV }, haloEdges: { value: edgesV },
              haloEye: { value: new T.Vector3(eye[0], eye[1], eye[2]) }, haloRMin: { value: D.SCAT.rMin },
              haloGFwd: { value: D.SCAT.gFwd }, haloGBack: { value: D.SCAT.gBack }, haloWFwd: { value: D.SCAT.wFwd },
              sigma: { value: sig }, tanH: { value: tanH }, size: { value: new T.Vector2(p.w, p.h) }, haloLampW: { value: lwK },
              otherBeam: { value: u.otherBeam.value }, otherLutInfo: { value: u.otherLutInfo.value }, otherLutSize: { value: u.otherLutSize.value },
              otherConvention: { value: legacy ? HAL_CONV(legacy.conv) : 0 },
              beamMeta: { value: u.beamMeta.value }, beamGrid: { value: u.beamGrid.value }, beamTint: { value: u.beamTint.value },
            });
            occU(mm); if (useSm) mm.uniforms.smM.value = smOf(q);   // SM: this lamp's car map
            if (bd) drawBound(mm, bd.k0, bd.k1, bd.rect, tab[0], tab[1]); else renderer.render(scene, camera);
            halo.passes++;
          }
        });
        if (blurR || blurD) blurBins(rt, tab[0], blurR, blurD);   // IL
        prefix(rt.texture, cumRt, tab[0]);   // PREFIX: the screen table's running totals
        // HDX6/HDX7: each polar table is cleared, then every lamp in it is drawn (additive), sub-pass by sub-pass, then prefixed.
        plan.forEach((s, si) => {
          if (timing) { renderer.getContext().finish(); }
          const tp = timing ? performance.now() : 0, rp = ensurePolar(si, pol.nT, pol.nR), mp = pick(atlas, true, useOcc, s.band ? 'band' : '', jit, useSm, lwK, refineN, nbN, halo.moment);
          const P = s.lamps[0].L.x - eye[0] < HALO_NEAR ? (globalThis.SL_HALO_SUB || nearSub) : 1;
          renderer.setRenderTarget(rp.bin); renderer.setClearColor(0x000000, 0); renderer.clear(); mesh.material = mp;
          for (let j = 0; j < P; j++) for (const q of s.lamps) {
            const bd = cullPlan ? cullPlan.boundOf(q, false) : null;   // SC: the slices this lamp can light (the full angular extent of the tile, for now)
            if (bd) { cstat.set(q, { k0: bd.k0, k1: bd.k1, rect: null, cells: cellsOf(bd, pol.nT, pol.nR, null), full: pol.nT * pol.nR * HALO_N, radius: bd.radius, table: 'polar' }); if (bd.empty) continue; }
            setPolarU(mp, q, P, j, s.band ? { ...s.pk, band: s.band } : s.pk);
            if (bd) drawBound(mp, bd.k0, bd.k1, null, pol.nT, pol.nR); else renderer.render(scene, camera);
            halo.passes++;
          }
          if (blurR || blurD) blurBins(rp.bin, pol.nT, blurR, blurD);   // IL
          prefix(rp.bin.texture, rp.cum, pol.nT, rp.layer);
          if (timing) { renderer.setRenderTarget(rp.cum, rp.layer); renderer.readRenderTargetPixels(rp.cum, 0, 0, 1, 1, new Uint16Array(4)); halo.msPolar += performance.now() - tp; }
        });
      } finally { renderer.autoClear = ac; renderer.setClearColor(cc, ca); renderer.setRenderTarget(null); if (tq) { const g = renderer.getContext(); g.endQuery(tqx.TIME_ELAPSED_EXT); halo.tqPending.push(tq); } }
      if (timing) { renderer.readRenderTargetPixels(cumRt, 0, 0, 1, 1, new Uint16Array(4)); halo.ms = performance.now() - t0; }
      u.haloTex.value = cumRt.texture; u.haloTab.value.set(tab[0], tab[1]); u.haloOn.value = globalThis.HALO_TABLE_ONLY ? 0 : 1;
      if (plan[0]) { const pk = plan[0].pk; u.haloPolarOn.value = 1; u.haloPolarTex.value = ensurePolar(0, pol.nT, pol.nR).cum.texture; u.haloPolarF.value.set(pk.C[0] / p.w, pk.C[1] / p.h); u.haloPolarSz.value.set(p.w, p.h); u.haloPolarRange.value.set(Math.log(HALO_POL_MIN_PX), pk.dL); u.haloPolarN.value.set(pol.nT, pol.nR); if (plan[0].band) { const b = plan[0].band; u.haloBandOn.value = 1; u.haloBand.value.set(b.ac, b.hw, b.fade, b.wd); } }
      if (plan[1]) { const pk = plan[1].pk; u.haloPolarOn2.value = 1; u.haloPolarTex.value = ensurePolar(1, pol.nT, pol.nR).cum.texture; u.haloPolarF2.value.set(pk.C[0] / p.w, pk.C[1] / p.h); u.haloPolarRange2.value.set(Math.log(HALO_POL_MIN_PX), pk.dL); }
      if (cullPlan) halo.cull = { mode: cullMode, eps: cullEps, lamps: used.map((q) => cstat.get(q) || null) };
      halo.drawn = used.length; halo.lamps = used.map((q) => ({ lamp: [q.L.x, q.L.y, q.L.z], w: q.L.w, nx: q.L.nx, ny: q.L.ny, nz: q.L.nz || 0, idx: q.idx, hasBeam: !!q.L.beam, cull: cstat.get(q) || null, band: polarSet.has(q) ? (plan.find((s) => s.lamps.includes(q)) || {}).band || null : null }));
      return halo.drawn;
    },
    // Test hook: the six bins of the cell nearest to NDC (sx, sy) in [-1, 1], read back from the GPU table (RGB per bin).
    probe(sx, sy) {
      if (!rt) return null;
      const [tw, th] = tab, cx = Math.min(tw - 1, Math.max(0, Math.floor((sx * 0.5 + 0.5) * tw))), cy = Math.min(th - 1, Math.max(0, Math.floor((sy * 0.5 + 0.5) * th)));
      const bins = [];
      for (let k = 0; k < HALO_BINS; k++) {
        const px = new Uint16Array(4); renderer.readRenderTargetPixels(rt, k * tw + cx, cy, 1, 1, px);
        bins.push([half(px[0]), half(px[1]), half(px[2]), half(px[3])]);   // P3/glm5.2: alpha = the first moment
      }
      return bins;
    },
  };
  return halo;
}
