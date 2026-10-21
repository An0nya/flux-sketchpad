/* The traffic halo on the GPU, as per-lamp TABLES drawn as soft sprites (replaces the SL2 per-pixel march, which was noisy, showed its quad edge and cost
   590 ms a frame at 16 lamps).
   1. Table pass: one tiny render target, HALO_G x HALO_G cells per lamp (nearest N lamps, N <= 16), laid side by side. Each cell marches HALO_STEPS steps along
      the eye ray through that cell's screen position and sums the same single-lamp integral as drive.js trafficHalo (the CPU reference): sigma * p(theta) * I / r^2
      * exp(-sigma r) * exp(-sigma s). The march is a fixed midpoint spacing with NO jitter, so the table is smooth: there is no noise to hide. Cost: N * G^2
      cells (4096 at 16 lamps), not a pixel count.
   2. Sprite pass: one additive quad per lamp around its projected position; each pixel reads its lamp's table with bilinear filtering, times a window that
      fades to exactly zero at the quad border (no visible box). One texture read per pixel.
   The lamp's beam shapes the glow, so a low beam is lopsided (more below the cut-off) for free: the table samples the real beam intensity.
   Occlusion: drawn into the ground layer after the ground pass, before the objects compose (they cover it as they cover the ground). Off or no lamp in view:
   draw() returns at once, no draw call, frames are byte-identical. */
import * as T from '../vendor/three/three.module.min.js';
import { ATLAS_HEAD, OTHER_LEGACY, OTHER_ATLAS } from './drive-three-shaders.js';
const D = globalThis.RF.Drive;
export const HALO_G = 16, HALO_MAXL = 16, HALO_STEPS = 24, HALO_FADE0 = 0.55;   // table cells per side, lamp cap, march steps per cell, where the sprite window starts to fall (fraction of the half-size)
const HALO_ANG_MIN = 3 * Math.PI / 180, HALO_ANG_MAX = 20 * Math.PI / 180;      // sprite half-size, radians; set by 1 / (sigma * distance), clamped
export const haloAngle = (sigma, dist) => Math.min(HALO_ANG_MAX, Math.max(HALO_ANG_MIN, Math.atan(1 / Math.max(1e-6, sigma * dist))));

const TVERT = `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const THEAD = `#define GN ${HALO_G}
uniform vec4 hLamp[${HALO_MAXL}], hDir[${HALO_MAXL}], hRect[${HALO_MAXL}], hTint[${HALO_MAXL}];
uniform vec3 haloEye; uniform vec2 size; uniform int nHalo, haloSteps, otherConvention;
uniform float tanH, sigma, haloSMax, haloRMin, haloGFwd, haloGBack, haloWFwd;
uniform sampler2D otherBeam; uniform vec4 otherLutInfo; uniform vec2 otherLutSize;
`;
const TMAIN = `float hgP(float g, float c) { return (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
void main() {
  int px = int(gl_FragCoord.x), li = px / GN;
  if (li >= nHalo) { gl_FragColor = vec4(0.0); return; }
  vec2 cell = vec2(float(px - li * GN), floor(gl_FragCoord.y)) / float(GN - 1) * 2.0 - 1.0;
  vec4 R = hRect[li]; vec2 screen = R.xy + cell * R.zw;
  vec3 lamp = hLamp[li].xyz, tint = hTint[li].rgb; vec2 dir = hDir[li].xy; float W = hLamp[li].w;
  tbeam = int(hTint[li].w + 0.5);
  vec3 ray = normalize(vec3(1.0, -screen.x * tanH, screen.y * tanH * size.y / size.x));
  float s1 = haloSMax, s0 = min(1.0, s1 * 0.25), q = pow(s1 / s0, 1.0 / float(haloSteps));
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 48; k++) {
    if (k >= haloSteps) break;
    float a = s0 * pow(q, float(k)), b = a * q, s = sqrt(a * b), ds = b - a, Tv = exp(-sigma * s);   // geometric midpoint of the log cell
    vec3 d = haloEye + s * ray - lamp; float r2 = dot(d, d); if (r2 <= 0.0) continue;
    float r = sqrt(r2);
    vec3 local = vec3(dot(d.xy, dir), dot(d.xy, vec2(-dir.y, dir.x)), d.z);
    if (local.x <= 0.0) continue;
    float I = W * otherIntensity(local);
    if (I <= 0.0) continue;
    float cs = -dot(d, ray) / r, p = haloWFwd * hgP(haloGFwd, cs) + (1.0 - haloWFwd) * hgP(haloGBack, cs);
    float E = I / max(r2, haloRMin * haloRMin);
    acc += sigma * p * E * exp(-sigma * r) * Tv * ds * tint;
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;
const SVERT = `varying vec2 q; uniform vec4 haloRect;
void main() { q = position.xy; gl_Position = vec4(haloRect.xy + position.xy * haloRect.zw, 0.0, 1.0); }`;
const SFRAG = `varying vec2 q; uniform sampler2D haloTex; uniform float haloIndex;
void main() {
  float G = float(${HALO_G});
  vec2 t = vec2((haloIndex * G + (q.x * 0.5 + 0.5) * (G - 1.0) + 0.5) / (G * float(${HALO_MAXL})), ((q.y * 0.5 + 0.5) * (G - 1.0) + 0.5) / G);
  float w = 1.0 - smoothstep(${HALO_FADE0.toFixed(3)}, 1.0, length(q));
  gl_FragColor = vec4(texture2D(haloTex, t).rgb * w, 1.0);
}`;
const HAL_CONV = (c) => (c === 'B' ? 1 : c === 'S' ? 2 : 0);

// The sprite rect (NDC centre and half-size) for one lamp. Null when the lamp is behind the eye or the sprite is wholly off screen.
export function haloRect(L, eye, sig, W, H, tanH) {
  const d0 = [L.x - eye[0], L.y - eye[1], L.z - eye[2]], R = Math.hypot(d0[0], d0[1], d0[2]);
  if (!(R > 0) || d0[0] <= 0) return null;
  const cx = -(d0[1] / d0[0]) / tanH, cy = (d0[2] / d0[0]) * W / (H * tanH), t = Math.tan(haloAngle(sig, R));
  const hx = t / tanH, hy = t * W / (H * tanH);
  if (cx - hx > 1 || cx + hx < -1 || cy - hy > 1 || cy + hy < -1) return null;
  return [cx, cy, hx, hy];
}
export function haloPass(renderer, u) {
  const scene = new T.Scene(), camera = new T.Camera(), geo = new T.PlaneGeometry(2, 2);
  const mkTable = (atlas) => new T.ShaderMaterial({
    uniforms: {}, vertexShader: TVERT, fragmentShader: THEAD + (atlas ? ATLAS_HEAD + OTHER_ATLAS : 'int tbeam = 0;\n' + OTHER_LEGACY) + TMAIN,
    blending: T.NoBlending, depthTest: false, depthWrite: false,
  });
  const tables = [mkTable(false), mkTable(true)];
  const sprite = new T.ShaderMaterial({ uniforms: {}, vertexShader: SVERT, fragmentShader: SFRAG, transparent: true, blending: T.AdditiveBlending, depthTest: false, depthWrite: false });
  const mesh = new T.Mesh(geo, tables[0]); mesh.frustumCulled = false; scene.add(mesh);
  const rt = new T.WebGLRenderTarget(HALO_G * HALO_MAXL, HALO_G, { type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false });
  const arr = () => Array.from({ length: HALO_MAXL }, () => new T.Vector4());
  const hLamp = arr(), hDir = arr(), hRectU = arr(), hTint = arr();
  const halo = {
    drawn: 0,   // sprites drawn in the last frame (page-test hook)
    rects: [],  // their NDC rects, last frame (page-test hook)
    draw(p, world, target) {
      halo.drawn = 0; halo.rects = [];
      const N = D.haloN(p); if (!N) return 0;
      const eye = p.eye || [-2, 0.37, 1.2], traffic = D.trafficSources(world.objects, eye, p);
      if (!traffic.length) return 0;
      const pool = p.trafficPool, atlas = !!(pool && pool.entries.length && traffic.some((q) => q.beam));
      const tanH = Math.tan(p.hfov * Math.PI / 360), W = p.w, H = p.h, sig = D.sigmaOf(p.look || {}), legacy = atlas ? null : D.trafficBeam(p);
      const ranked = traffic.map((L, i) => ({ L, i, d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, N);
      const used = [];
      for (const { L } of ranked) {
        if (used.length >= HALO_MAXL) break;
        const rect = haloRect(L, eye, sig, W, H, tanH); if (!rect) continue;
        const idx = atlas ? D.trafficPickIndexOf(p, L.car) : 0;
        if (atlas && idx < 0) continue;   // a car with no pool pick has no atlas beam: the CPU twin would use the built-in table (not in the atlas)
        const tn = atlas ? u.beamTint.value[idx] : null, k = used.length;
        hLamp[k].set(L.x, L.y, L.z, L.w === undefined ? 1 : L.w); hDir[k].set(L.nx, L.ny, 0, 0); hRectU[k].set(...rect);
        hTint[k].set(tn ? tn.x : 1, tn ? tn.y : 1, tn ? tn.z : 1, idx);
        used.push({ rect, idx, lamp: [L.x, L.y, L.z], w: L.w, nx: L.nx, ny: L.ny, hasBeam: !!L.beam });
      }
      if (!used.length) return 0;
      const ac = renderer.autoClear, cc = new T.Color(), ca = renderer.getClearAlpha(); renderer.getClearColor(cc); renderer.autoClear = false;
      try {
        const m = atlas ? tables[1] : tables[0];
        Object.assign(m.uniforms, {
          hLamp: { value: hLamp }, hDir: { value: hDir }, hRect: { value: hRectU }, hTint: { value: hTint }, nHalo: { value: used.length },
          haloEye: { value: new T.Vector3(eye[0], eye[1], eye[2]) }, haloSteps: { value: HALO_STEPS }, haloSMax: { value: D.SCAT.S_MAX }, haloRMin: { value: D.SCAT.rMin },
          haloGFwd: { value: D.SCAT.gFwd }, haloGBack: { value: D.SCAT.gBack }, haloWFwd: { value: D.SCAT.wFwd },
          sigma: { value: sig }, tanH: { value: tanH }, size: { value: new T.Vector2(W, H) },
          otherBeam: { value: u.otherBeam.value }, otherLutInfo: { value: u.otherLutInfo.value }, otherLutSize: { value: u.otherLutSize.value },
          otherConvention: { value: legacy ? HAL_CONV(legacy.conv) : 0 },
          beamMeta: { value: u.beamMeta.value }, beamGrid: { value: u.beamGrid.value }, beamTint: { value: u.beamTint.value },
        });
        mesh.material = m; renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
        mesh.material = sprite; sprite.uniforms.haloTex = { value: rt.texture };
        renderer.setRenderTarget(target);
        used.forEach((q, k) => { sprite.uniforms.haloRect = { value: new T.Vector4(...q.rect) }; sprite.uniforms.haloIndex = { value: k }; renderer.render(scene, camera); halo.rects.push(q); halo.drawn++; });
      } finally { renderer.autoClear = ac; renderer.setClearColor(cc, ca); }
      return halo.drawn;
    },
  };
  return halo;
}
