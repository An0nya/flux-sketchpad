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
import { ATLAS_HEAD, OTHER_LEGACY, OTHER_ATLAS, HALO_N } from './drive-three-shaders.js';
const D = globalThis.RF.Drive;
export const HALO_MAXL = 16, HALO_PER_DRAW = 1, HALO_BIN_STEPS = 6, HALO_MIN_W = 96, HALO_MIN_H = 54, HALO_DIV = 8, HALO_DIV_FEW = 4, HALO_FEW = 4, HALO_SUB = 4, HALO_REFINE = 4, HALO_NEAR = 45;
// One lamp per draw, 6 steps: a shader loop of 6 (it was 3 lamps x 6 = 18; Safari is suspected to stall compiling long loops). More draws, same pixels.
// HDX3: 24 log-uniform bins from 0.5 to 120 m (edge k = 0.5 * 240^((k+1)/24)); the first entry is the origin, the last is D.SCAT.S_MAX.
// The fixed edges replace the adaptive edges (HDX2: adaptive bin 0 = [0.5, 0.45 D] was the near-field overshoot). The shader's lookup assumes this log-uniform spacing.
export const HALO_EDGES = [0, ...Array.from({ length: HALO_N }, (_, k) => 0.5 * Math.pow(240, (k + 1) / HALO_N))]; HALO_EDGES[HALO_N] = 120;   // HALO_N: test hook (?halobins=N), default 24
export const HALO_BINS = HALO_EDGES.length - 1;
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
uniform float haloEdges[${HALO_BINS}];   // the upper edge of each bin
uniform float tanH, sigma, haloRMin, haloGFwd, haloGBack, haloWFwd;
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
const HAL_CONV = (c) => (c === 'B' ? 1 : c === 'S' ? 2 : 0);
const half = (T.DataUtils && T.DataUtils.fromHalfFloat) || ((h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1; return e === 0 ? sg * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : sg * Infinity) : sg * Math.pow(2, e - 15) * (1 + m / 1024); });

// 1/4 of the view with 4 lamps or fewer (the stairs a coarser table leaves on a sharp glow edge show most on a lone distant car), 1/8 with more.
export function haloTableSize(w, h, lamps = 99) { const div = lamps <= HALO_FEW ? HALO_DIV_FEW : HALO_DIV; return [Math.max(HALO_MIN_W, Math.ceil(w / div)), Math.max(HALO_MIN_H, Math.ceil(h / div))]; }
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
export function haloPass(renderer, u) {
  const scene = new T.Scene(), camera = new T.Camera(), geo = new T.PlaneGeometry(2, 2);
  const mk = (atlas) => new T.ShaderMaterial({
    uniforms: {}, vertexShader: TVERT, fragmentShader: THEAD + (atlas ? ATLAS_HEAD + OTHER_ATLAS : 'int tbeam = 0;\n' + OTHER_LEGACY) + TMAIN,
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
    depthTest: false, depthWrite: false,
  });
  const mats = [mk(false), mk(true)], mesh = new T.Mesh(geo, mats[0]); mesh.frustumCulled = false; scene.add(mesh);
  let rt = null, tab = [0, 0]; const rts = new Map();   // targets by size, so the lamp count crossing 4 never reallocates
  const arr = () => Array.from({ length: HALO_PER_DRAW }, () => new T.Vector4());
  const hLamp = arr(), hDir = arr(), hTint = arr(), tabV = new T.Vector2(), edgesV = HALO_EDGES.slice(1); u.haloE.value = edgesV;   // one array: the table shader's hi/lo and the lookup read the same edges
  const ensure = (p, n) => {
    const [tw, th] = haloTableSize(p.w, p.h, n), key = tw + 'x' + th;
    if (!rts.has(key)) { if (rts.size > 3) { for (const r of rts.values()) r.dispose(); rts.clear(); } rts.set(key, new T.WebGLRenderTarget(tw * HALO_BINS, th, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false })); }
    rt = rts.get(key); tab = [tw, th]; tabV.set(tw, th);
  };
  const halo = {
    edges: HALO_EDGES.slice(1),   // this frame's bin upper edges (page-test hook)
    drawn: 0,      // lamps in the table this frame (page-test hook)
    lamps: [],     // those lamps (world position, direction, atlas index), nearest first
    passes: 0,     // draws this frame
    ms: 0,         // table pass wall time (1-pixel readback sync), only when globalThis.SL_HALO_TIMING is set (test hook)
    get table() { return rt; }, get tab() { return tab; },
    // Build the table for this frame and point the lookup at it. Call before the ground pass. Off: haloOn 0, nothing drawn.
    build(p, world) {
      halo.drawn = 0; halo.lamps = []; halo.passes = 0; u.haloOn.value = 0; halo.sources = null;
      const N = D.haloN(p); if (!N) return 0;
      const eye = p.eye || [-2, 0.37, 1.2], traffic = D.trafficSources(world.objects, eye, p);
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
      haloEdgesFor(Math.hypot(used[0].L.x - eye[0], used[0].L.y - eye[1], used[0].L.z - eye[2]), edgesV); halo.edges = edgesV.slice();
      ensure(p, used.length);
      const timing = !!globalThis.SL_HALO_TIMING; if (timing) { renderer.getContext().finish(); } const t0 = timing ? performance.now() : 0;   // test hook: wall time of the table pass, synchronised by a 1-pixel readback
      const ac = renderer.autoClear, cc = new T.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc);
      try {
        renderer.autoClear = false; const m = atlas ? mats[1] : mats[0];
        renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); mesh.material = m;
        // The nearest HALO_REFINE lamps within HALO_NEAR metres are drawn in HALO_SUB sub-passes (24 steps per bin); the rest in one (6).
        used.forEach((q, i) => {
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
      } finally { renderer.autoClear = ac; renderer.setClearColor(cc, ca); renderer.setRenderTarget(null); }
      if (timing) { renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, new Uint16Array(4)); halo.ms = performance.now() - t0; }
      u.haloTex.value = rt.texture; u.haloTab.value.set(tab[0], tab[1]); u.haloOn.value = globalThis.HALO_TABLE_ONLY ? 0 : 1;
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
