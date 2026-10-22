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
const D = globalThis.RF.Drive;
export const HALO_MAXL = 16, HALO_PER_DRAW = 1, HALO_BIN_STEPS = 6, HALO_MIN_W = 96, HALO_MIN_H = 54, HALO_DIV = 8, HALO_DIV_FEW = 4, HALO_FEW = 4, HALO_SUB = 4, HALO_REFINE = 4, HALO_NEAR = 45;
// HDX6 polar table (SL_HALO_POLAR): 512 angles x 64 log-radii for the nearest lamp in front; 24 bins side by side = 12288 texels wide (under MAX_TEXTURE_SIZE 16384).
export const HALO_POL_TH = 512, HALO_POL_R = 64, HALO_POL_MIN_PX = 0.25, HALO_POL_MIN_X = 1, HALO_POL_MAX = 4;   // min radius px; min x m ahead; max |NDC| of the centre
// One lamp per draw, 6 steps: a shader loop of 6 (it was 3 lamps x 6 = 18; Safari is suspected to stall compiling long loops). More draws, same pixels.
// HDX3: 24 log-uniform bins from 0.5 to 120 m (edge k = 0.5 * 240^((k+1)/24)); the first entry is the origin, the last is D.SCAT.S_MAX.
// The fixed edges replace the adaptive edges (HDX2: adaptive bin 0 = [0.5, 0.45 D] was the near-field overshoot). The shader's lookup assumes this log-uniform spacing.
// HDX7: the bin count is a runtime setting (HALO_N, 4..32). The shaders size their arrays to HALO_MAX and read the count from a uniform (haloNu), so a change
// needs no recompile. ?halobins=N sets the start value; an out-of-range value clamps and HALO_REQ keeps what was asked, so the UI can show the clamp.
export const HALO_MIN = 4;
export let HALO_N = 24, HALO_REQ = 24, HALO_EDGES = [], HALO_BINS = 0;
export function haloEdgesOf(n) { const e = [0, ...Array.from({ length: n }, (_, k) => 0.5 * Math.pow(240, (k + 1) / n))]; e[n] = 120; return e; }
export function haloStepOf(n) { return n === 24 ? 0.22836 : Math.log(240) / n; }   // the knot step in ln d: 0.22836 at 24, as the shader always had it
export function setHaloBins(req) { const r = +req || 24, n = Math.min(HALO_MAX, Math.max(HALO_MIN, Math.round(r))); HALO_REQ = r; HALO_N = n; HALO_EDGES = haloEdgesOf(n); HALO_BINS = n; return n; }
setHaloBins(new URLSearchParams(globalThis.location ? location.search : '').get('halobins') ?? 24);
const HALO_URL_N = HALO_N;   // HDX7: the bin count from the page URL (the default when the look sets none)
// The upper edge of each bin for a nearest lamp at distance D. The cumulative glow along a ray rises steeply up to the lamp's own distance and is flat after it;
// the lookup interpolates between edges (log-linear), so a lamp sliding through a bin changes the interpolated shape and the glow around a close car shimmers
// (measured: 5-15% frame-to-frame jumps in the halo's total at 10-25 m, clustered near the fixed edges). Edges that are fractions of D put the lamp's distance
// ON an edge, and every edge moves continuously with D. Blended to the fixed ladder as the car gets far (55-75 m), where it was already steady.
const ADAPT = [0.45, 0.7, 0.85, 1.0, 1.6];
export function haloEdgesFor(D, out = new Array(HALO_BINS)) {   // HDX3: the edges are fixed (D no longer moves them)
  for (let i = 0; i < HALO_BINS; i++) out[i] = HALO_EDGES[i + 1];
  return out;
}

const TVERT = `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const THEAD = `uniform vec4 hLamp[${HALO_PER_DRAW}], hDir[${HALO_PER_DRAW}], hTint[${HALO_PER_DRAW}];
uniform vec3 haloEye; uniform vec2 size, haloTab; uniform int nHalo, otherConvention;
uniform int haloP, haloSub;   // sub-pass haloSub of haloP (see the loop)
uniform float haloEdges[${HALO_MAX}];   // the upper edge of each bin (HDX7: HALO_MAX slots, the first HALO_BINS in use)
uniform float tanH, sigma, haloRMin, haloGFwd, haloGBack, haloWFwd;
uniform vec2 haloPolarC, haloPolarRange, haloPolarN;   // HDX6 polar pass: centre (px), (log r0, log-radius step), (angles, radii)
uniform sampler2D otherBeam; uniform vec4 otherLutInfo; uniform vec2 otherLutSize;
`;
const TMAIN = `float hgP(float g, float c) { return (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy); int W = int(haloTab.x), tile = px.x / W, cx = px.x - tile * W;
  vec2 uv = (vec2(float(cx), float(px.y)) + 0.5) / haloTab, screen = uv * 2.0 - 1.0;
  vec3 ray = normalize(vec3(1.0, -screen.x * tanH, screen.y * tanH * size.y / size.x));
  float lo = tile == 0 ? 0.5 : haloEdges[tile - 1], hi = haloEdges[tile];   // bin 0 starts at 0.5 m: nearer air has no lamp in it
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${HALO_PER_DRAW}; i++) {
    if (i >= nHalo) break;
    vec3 lamp = hLamp[i].xyz, tint = hTint[i].rgb; vec2 dir = hDir[i].xy; float Wt = hLamp[i].w;
    tbeam = int(hTint[i].w + 0.5);
    // Each bin is cut into 6 x haloP log-spaced cells and this draw takes every haloP-th one, starting at haloSub: haloP draws (additive) make up the full
    // sum, each with a loop of 6. A lamp near the eye needs it: along a ray that passes close to it, 1/r^2, the phase function and the beam's cone entry all
    // vary over a metre or less, far less than a 6-step cell (1-4 m), so 6 steps alias, and the table shimmers as a close car's lamps move (measured: 24 steps
    // cut the frame-to-frame error of a table cell near the lamp roughly 5-20x). Lamps far away keep haloP 1 (6 steps; there the spike is not narrow).
    float qq = pow(hi / lo, 1.0 / float(${HALO_BIN_STEPS} * haloP));
    for (int m = 0; m < ${HALO_BIN_STEPS}; m++) {
      float sa = lo * pow(qq, float(m * haloP + haloSub)), sb = sa * qq, s = sqrt(sa * sb), ds = sb - sa;
      vec3 d = haloEye + s * ray - lamp; float r2 = dot(d, d); if (r2 <= 0.0) continue;
      float r = sqrt(r2);
      vec3 local = vec3(dot(d.xy, dir), dot(d.xy, vec2(-dir.y, dir.x)), d.z);
      if (local.x <= 0.0) continue;
      float I = Wt * otherIntensity(local);
      if (I <= 0.0) continue;
      float cs = -dot(d, ray) / r, p = haloWFwd * hgP(haloGFwd, cs) + (1.0 - haloWFwd) * hgP(haloGBack, cs);
      acc += sigma * p * I / max(r2, haloRMin * haloRMin) * exp(-sigma * r) * exp(-sigma * s) * ds * tint;
    }
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;
// HDX6: the polar pass is the same bin integrand, but each texel is a polar sample about the nearest lamp's projection (pixels), not a screen cell.
const TMAIN_POLAR = TMAIN.replace(
  "  ivec2 px = ivec2(gl_FragCoord.xy); int W = int(haloTab.x), tile = px.x / W, cx = px.x - tile * W;\n  vec2 uv = (vec2(float(cx), float(px.y)) + 0.5) / haloTab, screen = uv * 2.0 - 1.0;\n",
  "  ivec2 px = ivec2(gl_FragCoord.xy); int W = int(haloPolarN.x), tile = px.x / W, cx = px.x - tile * W;\n" +
  "  float ang = (float(cx) + 0.5) / haloPolarN.x * 6.28318530718, rho = exp(haloPolarRange.x + (float(px.y) + 0.5) * haloPolarRange.y);\n" +
  "  vec2 screen = (haloPolarC + rho * vec2(cos(ang), sin(ang))) / size * 2.0 - 1.0;\n");
if (TMAIN_POLAR === TMAIN) throw new Error('HDX6: polar pass text not replaced');
const HAL_CONV = (c) => (c === 'B' ? 1 : c === 'S' ? 2 : 0);
const half = (T.DataUtils && T.DataUtils.fromHalfFloat) || ((h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1; return e === 0 ? sg * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : sg * Infinity) : sg * Math.pow(2, e - 15) * (1 + m / 1024); });

// SL_HALO_DIV is a test override of the divisor (HDX4 resolution candidate); unset = unchanged.
// 1/4 of the view with 4 lamps or fewer (the stairs a coarser table leaves on a sharp glow edge show most on a lone distant car), 1/8 with more.
export function haloTableSize(w, h, lamps = 99, divOv = 0) { const div = globalThis.SL_HALO_DIV || divOv || (lamps <= HALO_FEW ? HALO_DIV_FEW : HALO_DIV); return [Math.max(HALO_MIN_W, Math.ceil(w / div)), Math.max(HALO_MIN_H, Math.ceil(h / div))]; }
// The CPU twin of the lookup in the shader (haloScatter): bins is the six bins, each [r, g, b]; d metres. Used by the page test to read the GPU table.
// HDX3 lookup (mirrors haloScatter in drive-three-shaders.js): C at each bin's upper edge is the running sum; bin 0 is log d from 0.5 m with C(0.5)=0;
// beyond the first edge, a monotone cubic Hermite (Fritsch-Carlson) in (log d, C) through the knots (the edges). Works for any ascending edges.
export function haloLookup(bins, d, edges = HALO_EDGES.slice(1)) {
  if (!(d > 0.5)) return [0, 0, 0];
  const n = HALO_BINS, dd = Math.min(d, edges[n - 1]), Cc = [];
  let C = [0, 0, 0];
  for (let k = 0; k < n; k++) { C = [C[0] + bins[k][0], C[1] + bins[k][1], C[2] + bins[k][2]]; Cc.push(C); }
  if (dd <= edges[0]) { const f = Math.log(dd / 0.5) / Math.log(edges[0] / 0.5); return Cc[0].map((v) => v * f); }
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
export function haloPolarPick(p, eye, q, tanH) {
  const W = p.w, H = p.h, r = [q.L.x - eye[0], q.L.y - eye[1], q.L.z - eye[2]];
  if (!(r[0] > HALO_POL_MIN_X)) return null;
  const sx = -r[1] / (r[0] * tanH), sy = r[2] * W / (r[0] * tanH * H);
  if (Math.abs(sx) > HALO_POL_MAX || Math.abs(sy) > HALO_POL_MAX) return null;
  const C = [(sx + 1) * W / 2, (sy + 1) * H / 2];
  const rho = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - C[0], y - C[1])));   // the farthest corner: every screen pixel is inside
  return { C, rho, dL: (Math.log(rho) - Math.log(HALO_POL_MIN_PX)) / HALO_POL_R, sx, sy };
}
// TOUGE-ELEV B1: a touge frame projects the ribbon in the car frame (vertex carFromWorld*(position-eye), eye = p.eye), so a source in world
// coordinates maps through carFromWorld (Matrix3, column-major). The direction keeps its horizontal part and is renormalised. Distances are unchanged.
export function toCarFrame(traffic, m) {
  const e = m.elements, mul = (v) => [e[0] * v[0] + e[3] * v[1] + e[6] * v[2], e[1] * v[0] + e[4] * v[1] + e[7] * v[2], e[2] * v[0] + e[5] * v[1] + e[8] * v[2]];
  return traffic.map((q) => { const P = mul([q.x, q.y, q.z]), d = mul([q.nx, q.ny, 0]), n = Math.hypot(d[0], d[1]) || 1; return { ...q, x: P[0], y: P[1], z: P[2], nx: d[0] / n, ny: d[1] / n }; });
}
export function haloPass(renderer, u) {
  const scene = new T.Scene(), camera = new T.Camera(), geo = new T.PlaneGeometry(2, 2);
  const mk = (atlas, polar = false) => new T.ShaderMaterial({
    uniforms: {}, vertexShader: TVERT, fragmentShader: THEAD + (atlas ? ATLAS_HEAD + OTHER_ATLAS : 'int tbeam = 0;\n' + OTHER_LEGACY) + (polar ? TMAIN_POLAR : TMAIN),
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
    depthTest: false, depthWrite: false,
  });
  const mats = [mk(false), mk(true)], matsP = [mk(false, true), mk(true, true)];   // matsP: HDX6 polar pass materials
  const mesh = new T.Mesh(geo, mats[0]); mesh.frustumCulled = false; scene.add(mesh);
  let rt = null, tab = [0, 0], tabClamp = null; const rts = new Map();   // targets by size, so the lamp count crossing 4 never reallocates
  const arr = () => Array.from({ length: HALO_PER_DRAW }, () => new T.Vector4());
  const hLamp = arr(), hDir = arr(), hTint = arr(), tabV = new T.Vector2(), edgesV = new Array(HALO_MAX).fill(120); u.haloE.value = edgesV;   // one array: the table shader's hi/lo and the lookup read the same edges (HDX7: padded to HALO_MAX)
  const ensure = (p, n, divOv) => {
    let [tw, th] = haloTableSize(p.w, p.h, n, divOv);
    // HDX7: the table is HALO_N tiles side by side, so one tile may be at most maxTextureSize / HALO_N cells wide (at 1920 px and divisor 1.4 it is not, at 24 bins).
    const cap = Math.floor(renderer.capabilities.maxTextureSize / HALO_N); tabClamp = tw > cap ? { asked: tw, used: cap } : null; if (tw > cap) tw = cap;
    const key = tw + 'x' + th + 'x' + HALO_N;
    if (!rts.has(key)) { if (rts.size > 3) { for (const r of rts.values()) r.dispose(); rts.clear(); } rts.set(key, new T.WebGLRenderTarget(tw * HALO_N, th, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false })); }
    rt = rts.get(key); tab = [tw, th]; tabV.set(tw, th);
  };
  const prts = [], prtNs = [];   // HDX6: the polar tables (HALO_POL_R rows, HALO_N bins side by side); HDX7: one target per table, rebuilt when the bin count changes
  const ensurePolar = (si = 0) => {
    if (!prts[si] || prtNs[si] !== HALO_N) { if (prts[si]) prts[si].dispose(); prts[si] = new T.WebGLRenderTarget(HALO_POL_TH * HALO_N, HALO_POL_R, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: false }); prtNs[si] = HALO_N; }
    return prts[si];
  };
  const halo = {
    edges: HALO_EDGES.slice(1),   // this frame's bin upper edges (page-test hook)
    polars: [],   // HDX7: one entry per polar table this frame ({ lamps, C, rho, dL })
    get tabClamp() { return tabClamp; },   // HDX7: { asked, used } when the table was narrowed to fit maxTextureSize, else null
    drawn: 0,      // lamps in the table this frame (page-test hook)
    lamps: [],     // those lamps (world position, direction, atlas index), nearest first
    passes: 0,     // draws this frame
    msPolar: 0,    // HDX6: polar pass wall time (SL_HALO_TIMING only), 0 when off
    polar: null,   // HDX6: the polar lamp (centre px, radius px, log step) or null
    polarNote: null,   // HDX6: why the polar table is off this frame, when SL_HALO_POLAR is set
    ms: 0,         // table pass wall time (1-pixel readback sync), only when globalThis.SL_HALO_TIMING is set (test hook)
    get table() { return rt; }, get tab() { return tab; },
    // Build the table for this frame and point the lookup at it. Call before the ground pass. Off: haloOn 0, nothing drawn.
    build(p, world) {
      halo.drawn = 0; halo.lamps = []; halo.passes = 0; u.haloOn.value = 0; halo.sources = null;
      u.haloPolarOn.value = 0; u.haloPolarOn2.value = 0; halo.msPolar = 0; halo.polar = null; halo.polars = [];   // HDX6, HDX7
      const N = D.haloN(p); if (!N) return 0;
      // HDX7: the look's halo settings. Bins: a count (clamped to 4..32; HALO_REQ keeps the ask). Divisor: 0 = the lamp-count rule. Gain: 1 = as computed.
      const look = p.look || {}, wantN = look.haloBins != null ? +look.haloBins : HALO_URL_N;
      if (wantN !== HALO_REQ) setHaloBins(wantN);
      u.haloNu.value = HALO_N; u.haloH.value = haloStepOf(HALO_N); u.haloGain.value = look.haloGain != null ? +look.haloGain : 1;
      const eye = p.eye || [-2, 0.37, 1.2], traffic = p.touge ? toCarFrame(D.trafficSources(world.objects, eye, p, world.A), u.carFromWorld.value) : D.trafficSources(world.objects, eye, p, world.A);   // TOUGE-ELEV B1: touge lamps into the car frame the ribbon projects in
      if (!traffic.length) return 0;
      halo.sources = traffic;   // test hook: the sources the table was built from (beam, tint, axis)
      const pool = p.trafficPool, atlas = !!(pool && pool.entries.length && traffic.some((q) => q.beam));
      const tanH = Math.tan(p.hfov * Math.PI / 360), sig = D.sigmaOf(p.look || {}), legacy = atlas ? null : D.trafficBeam(p);
      const ranked = traffic.map((L, i) => ({ L, i, d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, Math.min(N, HALO_MAXL));
      const used = [];
      for (const { L } of ranked) {
        const idx = atlas ? D.trafficPickIndexOf(p, L.car) : 0;
        if (atlas && idx < 0) continue;   // a car with no pool pick has no atlas beam: the CPU twin would use the built-in table (not in the atlas)
        const tn = atlas ? u.beamTint.value[idx] : null;
        used.push({ L, idx, tint: [tn ? tn.x : 1, tn ? tn.y : 1, tn ? tn.z : 1] });
      }
      if (!used.length) return 0;
      // HDX7 polar plan. SL_HALO_POLAR (test hook) = one polar table for the nearest lamp, as HDX6. look.haloPolar: off, perlamp (a table per lamp of
      // the nearest car, one or two), merged (one table centred between the car's two lamps, both lamps drawn into it).
      const pmode = globalThis.SL_HALO_POLAR && (!look.haloPolar || look.haloPolar === 'off') ? 'perlamp' : (look.haloPolar || 'off');
      const plamps = look.haloPolarLamps === 1 ? 1 : 2;
      const plan = [];   // [{ lamps: [q, ...], pk }], one polar table each
      if (pmode !== 'off') {
        if (renderer.capabilities.maxTextureSize < HALO_POL_TH * HALO_N) halo.polarNote = 'polar width ' + HALO_POL_TH * HALO_N + ' over maxTextureSize ' + renderer.capabilities.maxTextureSize;
        else {
          const first = used[0], second = plamps === 2 ? used.slice(1).find((q) => q.L.car !== undefined && q.L.car === first.L.car) : null;   // the nearest car's other lamp
          if (pmode === 'merged' && second) {
            const mid = { x: (first.L.x + second.L.x) / 2, y: (first.L.y + second.L.y) / 2, z: (first.L.z + second.L.z) / 2 };
            const pk = haloPolarPick(p, eye, { L: mid }, tanH);
            if (pk) plan.push({ lamps: [first, second], pk }); else halo.polarNote = 'merged centre not clearly in front: screen table';
          } else {
            for (const q of (second ? [first, second] : [first])) { const pk = haloPolarPick(p, eye, q, tanH); if (pk) plan.push({ lamps: [q], pk }); else halo.polarNote = 'nearest lamp not clearly in front or off-screen: screen table'; }
          }
        }
      }
      const polarSet = new Set(plan.flatMap((s) => s.lamps));
      halo.polars = plan.map((s) => ({ lamps: s.lamps.map((q) => [q.L.x, q.L.y, q.L.z]), C: s.pk.C, rho: s.pk.rho, dL: s.pk.dL }));
      halo.polar = plan.length ? { lamp: [plan[0].lamps[0].L.x, plan[0].lamps[0].L.y, plan[0].lamps[0].L.z], C: plan[0].pk.C, rho: plan[0].pk.rho, dL: plan[0].pk.dL } : null;
      haloEdgesFor(Math.hypot(used[0].L.x - eye[0], used[0].L.y - eye[1], used[0].L.z - eye[2]), edgesV); halo.edges = edgesV.slice(0, HALO_BINS);
      ensure(p, used.length, look.haloDiv);
      const timing = !!globalThis.SL_HALO_TIMING; if (timing) { renderer.getContext().finish(); } const t0 = timing ? performance.now() : 0;   // test hook: wall time of the table pass, synchronised by a 1-pixel readback
      const ac = renderer.autoClear, cc = new T.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc);
      const setPolarU = (mp, q, P, j, pk) => {
        hLamp[0].set(q.L.x, q.L.y, q.L.z, q.L.w === undefined ? 1 : q.L.w); hDir[0].set(q.L.nx, q.L.ny, 0, 0); hTint[0].set(q.tint[0], q.tint[1], q.tint[2], q.idx);
        Object.assign(mp.uniforms, {
          hLamp: { value: hLamp }, hDir: { value: hDir }, hTint: { value: hTint }, nHalo: { value: 1 }, haloP: { value: P }, haloSub: { value: j }, haloTab: { value: tabV }, haloEdges: { value: edgesV },
          haloEye: { value: new T.Vector3(eye[0], eye[1], eye[2]) }, haloRMin: { value: D.SCAT.rMin },
          haloGFwd: { value: D.SCAT.gFwd }, haloGBack: { value: D.SCAT.gBack }, haloWFwd: { value: D.SCAT.wFwd },
          sigma: { value: sig }, tanH: { value: tanH }, size: { value: new T.Vector2(p.w, p.h) },
          otherBeam: { value: u.otherBeam.value }, otherLutInfo: { value: u.otherLutInfo.value }, otherLutSize: { value: u.otherLutSize.value },
          otherConvention: { value: legacy ? HAL_CONV(legacy.conv) : 0 },
          beamMeta: { value: u.beamMeta.value }, beamGrid: { value: u.beamGrid.value }, beamTint: { value: u.beamTint.value },
          haloPolarC: { value: new T.Vector2(pk.C[0], pk.C[1]) }, haloPolarRange: { value: new T.Vector2(Math.log(HALO_POL_MIN_PX), pk.dL) }, haloPolarN: { value: new T.Vector2(HALO_POL_TH, HALO_POL_R) },
        });
      };
      try {
        renderer.autoClear = false; const m = atlas ? mats[1] : mats[0];
        renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); mesh.material = m;
        // The nearest HALO_REFINE lamps within HALO_NEAR metres are drawn in HALO_SUB sub-passes (24 steps per bin); the rest in one (6).
        used.forEach((q, i) => {
          if (polarSet.has(q)) return;   // HDX6/HDX7: a polar lamp is in its own table, not this one
          const P = i < HALO_REFINE && q.L.x - eye[0] < HALO_NEAR ? (globalThis.SL_HALO_SUB || HALO_SUB) : 1;   // SL_HALO_SUB: test override (cost comparison)
          for (let j = 0; j < P; j++) {
            hLamp[0].set(q.L.x, q.L.y, q.L.z, q.L.w === undefined ? 1 : q.L.w); hDir[0].set(q.L.nx, q.L.ny, 0, 0); hTint[0].set(q.tint[0], q.tint[1], q.tint[2], q.idx);
            Object.assign(m.uniforms, {
              hLamp: { value: hLamp }, hDir: { value: hDir }, hTint: { value: hTint }, nHalo: { value: 1 }, haloP: { value: P }, haloSub: { value: j }, haloTab: { value: tabV }, haloEdges: { value: edgesV },
              haloEye: { value: new T.Vector3(eye[0], eye[1], eye[2]) }, haloRMin: { value: D.SCAT.rMin },
              haloGFwd: { value: D.SCAT.gFwd }, haloGBack: { value: D.SCAT.gBack }, haloWFwd: { value: D.SCAT.wFwd },
              sigma: { value: sig }, tanH: { value: tanH }, size: { value: new T.Vector2(p.w, p.h) },
              otherBeam: { value: u.otherBeam.value }, otherLutInfo: { value: u.otherLutInfo.value }, otherLutSize: { value: u.otherLutSize.value },
              otherConvention: { value: legacy ? HAL_CONV(legacy.conv) : 0 },
              beamMeta: { value: u.beamMeta.value }, beamGrid: { value: u.beamGrid.value }, beamTint: { value: u.beamTint.value },
            });
            renderer.render(scene, camera); halo.passes++;
          }
        });
        // HDX6/HDX7: each polar table is cleared, then every lamp in it is drawn (additive), sub-pass by sub-pass.
        plan.forEach((s, si) => {
          if (timing) { renderer.getContext().finish(); }
          const tp = timing ? performance.now() : 0, rp = ensurePolar(si), mp = matsP[atlas ? 1 : 0];
          const P = s.lamps[0].L.x - eye[0] < HALO_NEAR ? (globalThis.SL_HALO_SUB || HALO_SUB) : 1;
          renderer.setRenderTarget(rp); renderer.setClearColor(0x000000, 0); renderer.clear(); mesh.material = mp;
          for (let j = 0; j < P; j++) for (const q of s.lamps) { setPolarU(mp, q, P, j, s.pk); renderer.render(scene, camera); halo.passes++; }
          if (timing) { renderer.readRenderTargetPixels(rp, 0, 0, 1, 1, new Uint16Array(4)); halo.msPolar += performance.now() - tp; }
        });
      } finally { renderer.autoClear = ac; renderer.setClearColor(cc, ca); renderer.setRenderTarget(null); }
      if (timing) { renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, new Uint16Array(4)); halo.ms = performance.now() - t0; }
      u.haloTex.value = rt.texture; u.haloTab.value.set(tab[0], tab[1]); u.haloOn.value = globalThis.HALO_TABLE_ONLY ? 0 : 1;
      if (plan[0]) { const pk = plan[0].pk; u.haloPolarOn.value = 1; u.haloPolarTex.value = ensurePolar(0).texture; u.haloPolarF.value.set(pk.C[0] / p.w, pk.C[1] / p.h); u.haloPolarSz.value.set(p.w, p.h); u.haloPolarRange.value.set(Math.log(HALO_POL_MIN_PX), pk.dL); u.haloPolarN.value.set(HALO_POL_TH, HALO_POL_R); }
      if (plan[1]) { const pk = plan[1].pk; u.haloPolarOn2.value = 1; u.haloPolarTex2.value = ensurePolar(1).texture; u.haloPolarF2.value.set(pk.C[0] / p.w, pk.C[1] / p.h); u.haloPolarRange2.value.set(Math.log(HALO_POL_MIN_PX), pk.dL); }
      halo.drawn = used.length; halo.lamps = used.map((q) => ({ lamp: [q.L.x, q.L.y, q.L.z], w: q.L.w, nx: q.L.nx, ny: q.L.ny, idx: q.idx, hasBeam: !!q.L.beam }));
      return halo.drawn;
    },
    // Test hook: the six bins of the cell nearest to NDC (sx, sy) in [-1, 1], read back from the GPU table (RGB per bin).
    probe(sx, sy) {
      if (!rt) return null;
      const [tw, th] = tab, cx = Math.min(tw - 1, Math.max(0, Math.floor((sx * 0.5 + 0.5) * tw))), cy = Math.min(th - 1, Math.max(0, Math.floor((sy * 0.5 + 0.5) * th)));
      const bins = [];
      for (let k = 0; k < HALO_BINS; k++) {
        const px = new Uint16Array(4); renderer.readRenderTargetPixels(rt, k * tw + cx, cy, 1, 1, px);
        bins.push([half(px[0]), half(px[1]), half(px[2])]);
      }
      return bins;
    },
  };
  return halo;
}
