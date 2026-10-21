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
import { ATLAS_HEAD, OTHER_LEGACY, OTHER_ATLAS } from './drive-three-shaders.js';
const D = globalThis.RF.Drive;
export const HALO_MAXL = 16, HALO_PER_DRAW = 3, HALO_BIN_STEPS = 6, HALO_MIN_W = 96, HALO_MIN_H = 54, HALO_DIV = 8;
export const HALO_EDGES = [0, 8, 14, 22, 34, 60, 120];   // bin edges, metres; the last is D.SCAT.S_MAX
export const HALO_BINS = HALO_EDGES.length - 1;

const TVERT = `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const THEAD = `uniform vec4 hLamp[${HALO_PER_DRAW}], hDir[${HALO_PER_DRAW}], hTint[${HALO_PER_DRAW}];
uniform vec3 haloEye; uniform vec2 size, haloTab; uniform int nHalo, otherConvention;
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
  float q = pow(hi / lo, 1.0 / float(${HALO_BIN_STEPS}));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${HALO_PER_DRAW}; i++) {
    if (i >= nHalo) break;
    vec3 lamp = hLamp[i].xyz, tint = hTint[i].rgb; vec2 dir = hDir[i].xy; float Wt = hLamp[i].w;
    tbeam = int(hTint[i].w + 0.5);
    for (int m = 0; m < ${HALO_BIN_STEPS}; m++) {
      float a = lo * pow(q, float(m)), b = a * q, s = sqrt(a * b), ds = b - a;   // geometric midpoint of the log cell
      vec3 d = haloEye + s * ray - lamp; float r2 = dot(d, d); if (r2 <= 0.0) continue;
      float r = sqrt(r2);
      vec3 local = vec3(dot(d.xy, dir), dot(d.xy, vec2(-dir.y, dir.x)), d.z);
      if (local.x <= 0.0) continue;
      float I = Wt * otherIntensity(local);
      if (I <= 0.0) continue;
      float cs = -dot(d, ray) / r, p = haloWFwd * hgP(haloGFwd, cs) + (1.0 - haloWFwd) * hgP(haloGBack, cs);
      float E = I / max(r2, haloRMin * haloRMin);
      acc += sigma * p * E * exp(-sigma * r) * exp(-sigma * s) * ds * tint;
    }
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;
const HAL_CONV = (c) => (c === 'B' ? 1 : c === 'S' ? 2 : 0);
const half = (T.DataUtils && T.DataUtils.fromHalfFloat) || ((h) => { const e = (h >> 10) & 31, m = h & 1023, sg = h & 0x8000 ? -1 : 1; return e === 0 ? sg * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : sg * Infinity) : sg * Math.pow(2, e - 15) * (1 + m / 1024); });

export function haloTableSize(w, h) { return [Math.max(HALO_MIN_W, Math.ceil(w / HALO_DIV)), Math.max(HALO_MIN_H, Math.ceil(h / HALO_DIV))]; }
// The CPU twin of the lookup in the shader (haloScatter): bins is the six bins, each [r, g, b]; d metres. Used by the page test to read the GPU table.
export function haloLookup(bins, d) {
  if (!(d > 0)) return [0, 0, 0];
  const dd = Math.min(d, HALO_EDGES[HALO_BINS]); let C = [0, 0, 0], prevC = [0, 0, 0], prevE = 0;
  for (let k = 0; k < HALO_BINS; k++) {
    const e = HALO_EDGES[k + 1]; C = [C[0] + bins[k][0], C[1] + bins[k][1], C[2] + bins[k][2]];
    if (dd <= e) { const f = k === 0 ? dd / e : Math.log(dd / prevE) / Math.log(e / prevE); return k === 0 ? C.map((v) => v * f) : C.map((v, i) => prevC[i] + (v - prevC[i]) * f); }
    prevC = C; prevE = e;
  }
  return C;
}
export function haloPass(renderer, u) {
  const scene = new T.Scene(), camera = new T.Camera(), geo = new T.PlaneGeometry(2, 2);
  const mk = (atlas) => new T.ShaderMaterial({
    uniforms: {}, vertexShader: TVERT, fragmentShader: THEAD + (atlas ? ATLAS_HEAD + OTHER_ATLAS : 'int tbeam = 0;\n' + OTHER_LEGACY) + TMAIN,
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor,
    depthTest: false, depthWrite: false,
  });
  const mats = [mk(false), mk(true)], mesh = new T.Mesh(geo, mats[0]); mesh.frustumCulled = false; scene.add(mesh);
  let rt = null, tab = [0, 0];
  const arr = () => Array.from({ length: HALO_PER_DRAW }, () => new T.Vector4());
  const hLamp = arr(), hDir = arr(), hTint = arr(), tabV = new T.Vector2(), edgesV = HALO_EDGES.slice(1);
  const ensure = (p) => {
    const [tw, th] = haloTableSize(p.w, p.h);
    if (!rt || tab[0] !== tw || tab[1] !== th) {
      if (rt) rt.dispose();
      rt = new T.WebGLRenderTarget(tw * HALO_BINS, th, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false });
      tab = [tw, th];
    }
    tabV.set(tw, th);
  };
  const halo = {
    drawn: 0,      // lamps in the table this frame (page-test hook)
    lamps: [],     // those lamps (world position, direction, atlas index), nearest first
    passes: 0,     // draws this frame
    get table() { return rt; }, get tab() { return tab; },
    // Build the table for this frame and point the lookup at it. Call before the ground pass. Off: haloOn 0, nothing drawn.
    build(p, world) {
      halo.drawn = 0; halo.lamps = []; halo.passes = 0; u.haloOn.value = 0;
      const N = D.haloN(p); if (!N) return 0;
      const eye = p.eye || [-2, 0.37, 1.2], traffic = D.trafficSources(world.objects, eye, p);
      if (!traffic.length) return 0;
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
      ensure(p);
      const ac = renderer.autoClear, cc = new T.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc);
      try {
        renderer.autoClear = false; const m = atlas ? mats[1] : mats[0];
        renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); mesh.material = m;
        for (let g = 0; g < used.length; g += HALO_PER_DRAW) {
          const grp = used.slice(g, g + HALO_PER_DRAW);
          grp.forEach((q, k) => { hLamp[k].set(q.L.x, q.L.y, q.L.z, q.L.w === undefined ? 1 : q.L.w); hDir[k].set(q.L.nx, q.L.ny, 0, 0); hTint[k].set(q.tint[0], q.tint[1], q.tint[2], q.idx); });
          Object.assign(m.uniforms, {
            hLamp: { value: hLamp }, hDir: { value: hDir }, hTint: { value: hTint }, nHalo: { value: grp.length }, haloTab: { value: tabV }, haloEdges: { value: edgesV },
            haloEye: { value: new T.Vector3(eye[0], eye[1], eye[2]) }, haloRMin: { value: D.SCAT.rMin },
            haloGFwd: { value: D.SCAT.gFwd }, haloGBack: { value: D.SCAT.gBack }, haloWFwd: { value: D.SCAT.wFwd },
            sigma: { value: sig }, tanH: { value: tanH }, size: { value: new T.Vector2(p.w, p.h) },
            otherBeam: { value: u.otherBeam.value }, otherLutInfo: { value: u.otherLutInfo.value }, otherLutSize: { value: u.otherLutSize.value },
            otherConvention: { value: legacy ? HAL_CONV(legacy.conv) : 0 },
            beamMeta: { value: u.beamMeta.value }, beamGrid: { value: u.beamGrid.value }, beamTint: { value: u.beamTint.value },
          });
          renderer.render(scene, camera); halo.passes++;
        }
      } finally { renderer.autoClear = ac; renderer.setClearColor(cc, ca); renderer.setRenderTarget(null); }
      u.haloTex.value = rt.texture; u.haloTab.value.set(tab[0], tab[1]); u.haloOn.value = 1;
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
