/* SL2: the traffic halo on the GPU. One small screen-space quad per oncoming lamp (the nearest N, as trafficHalo ranks them), drawn additively into the
   ground layer right after the ground pass and before the objects are composed. Each fragment marches 8 log steps along its own eye ray and sums the
   same single-lamp integral as drive.js trafficHalo (the CPU reference). The quad's half-size is where that CPU integral falls below 2 % of its peak.
   Occlusion: the ground layer carries no depth (the ground shader writes none), so there is no depth test here. A car or tree hides the halo the way
   it hides the ground: its coverage replaces the layer behind it. That is the same route the glow markers take (they add to the ground pixel).
   Off (look.trafficHalo 0, clear air, or no traffic): draw() returns at once; no draw call. */
import * as T from '../vendor/three/three.module.min.js';
import { ATLAS_HEAD, OTHER_LEGACY, OTHER_ATLAS } from './drive-three-shaders.js';
const D = globalThis.RF.Drive;
const VERT = `varying vec2 screen; uniform vec4 haloRect;
void main() { screen = haloRect.xy + position.xy * haloRect.zw; gl_Position = vec4(screen, 0.0, 1.0); }`;
const HEAD = `varying vec2 screen;
uniform vec3 haloEye, haloLamp, haloTint; uniform vec2 haloDir, size;
uniform float tanH, haloW, sigma, haloSMax, haloRMin, haloGFwd, haloGBack, haloWFwd;
uniform int haloSteps, haloBeam, otherConvention;
uniform sampler2D otherBeam; uniform vec4 otherLutInfo; uniform vec2 otherLutSize;
`;
const MAIN = `float hgP(float g, float c) { return (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
// the same per-pixel hash as scatterJitter / the table jitter (drive.js): a function of the pixel index only
float haloJitter() { uint x = uint(gl_FragCoord.x), y = uint(size.y) - 1u - uint(gl_FragCoord.y); uint h = (x * 0x27d4eb2du) ^ (y * 0x165667b1u); h = (h ^ (h >> 15u)) * 0x85ebca6bu; h = (h ^ (h >> 13u)) * 0xc2b2ae35u; h ^= h >> 16u; return float(h) / 4294967296.0; }
void main() {
  tbeam = haloBeam;
  vec3 ray = normalize(vec3(1.0, -screen.x * tanH, screen.y * tanH * size.y / size.x));
  float J = haloJitter(), s1 = haloSMax, s0 = min(1.0, s1 * 0.25), q = pow(s1 / s0, 1.0 / float(haloSteps));
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    if (k >= haloSteps) break;
    float a = s0 * pow(q, float(k)), b = a * q, s = a * pow(q, J), ds = b - a, Tv = exp(-sigma * s);
    vec3 d = haloEye + s * ray - haloLamp; float r2 = dot(d, d); if (r2 <= 0.0) continue;
    float r = sqrt(r2);
    vec3 local = vec3(dot(d.xy, haloDir), dot(d.xy, vec2(-haloDir.y, haloDir.x)), d.z);
    if (local.x <= 0.0) continue;
    float I = haloW * otherIntensity(local);
    if (I <= 0.0) continue;
    float cs = -dot(d, ray) / r, p = haloWFwd * hgP(haloGFwd, cs) + (1.0 - haloWFwd) * hgP(haloGBack, cs);
    float E = I / max(r2, haloRMin * haloRMin);
    acc += sigma * p * E * exp(-sigma * r) * Tv * ds * haloTint;
  }
  gl_FragColor = vec4(acc, 1.0);
}
`;
const HAL_CONV = (c) => (c === 'B' ? 1 : c === 'S' ? 2 : 0);
// The quad: centre and half-size in NDC for one lamp, from the eye. Null when the lamp is not in front of the eye.
function haloRect(L, eye, p, W, H, tanH) {
  const d0 = [L.x - eye[0], L.y - eye[1], L.z - eye[2]], R = Math.hypot(d0[0], d0[1], d0[2]);
  if (!(R > 0) || d0[0] <= 0) return null;
  const u0 = d0.map((v) => v / R), cx = -(u0[1] / u0[0]) / tanH, cy = (u0[2] / u0[0]) * W / (H * tanH);
  const peak = D.trafficHalo(u0, Infinity, [L], 1, p, 0.5).reduce((a, b) => a + b, 0);
  if (!(peak > 0)) return null;
  // horizontal and vertical unit vectors perpendicular to the ray; the radius is the first angle (geometric search) where the halo < 2 % of peak
  const eh0 = [-u0[1], u0[0], 0], nh = Math.hypot(eh0[0], eh0[1]), eh = eh0.map((v) => v / nh);
  const ev0 = [u0[1] * eh[2] - u0[2] * eh[1], u0[2] * eh[0] - u0[0] * eh[2], u0[0] * eh[1] - u0[1] * eh[0]], nv = Math.hypot(ev0[0], ev0[1], ev0[2]), ev = ev0.map((v) => v / nv);
  const radius = (e) => {
    for (let t = 1e-4; t < 0.5; t *= 1.2) {
      const v = u0.map((x, i) => x + t * e[i]), n = Math.hypot(v[0], v[1], v[2]), val = D.trafficHalo(v.map((x) => x / n), Infinity, [L], 1, p, 0.5).reduce((a, b) => a + b, 0);
      if (val < 0.02 * peak) return t;
    }
    return 0.5;
  };
  // at least 2 px each way: a sliver under a pixel centre would rasterise to nothing (the lamp's halo here is thin vertically: the beam's cut-off)
  const hx = Math.min(1, Math.max(4 / W, Math.tan(radius(eh)) / tanH)), hy = Math.min(1, Math.max(4 / H, Math.tan(radius(ev)) * W / (H * tanH)));
  if (cx - hx > 1 || cx + hx < -1 || cy - hy > 1 || cy + hy < -1) return null;   // entirely off screen
  return [cx, cy, hx, hy];
}
export function haloPass(renderer, u) {
  const scene = new T.Scene(), camera = new T.Camera(), mk = (atlas) => new T.ShaderMaterial({
    uniforms: {}, vertexShader: VERT, fragmentShader: HEAD + (atlas ? ATLAS_HEAD + OTHER_ATLAS : 'int tbeam = 0;\n' + OTHER_LEGACY) + MAIN,
    transparent: true, blending: T.AdditiveBlending, depthTest: false, depthWrite: false,
  });
  const mats = [mk(false), mk(true)], mesh = new T.Mesh(new T.PlaneGeometry(2, 2), mats[0]);
  mesh.frustumCulled = false; scene.add(mesh);
  const halo = {
    drawn: 0,   // quads drawn in the last frame (page-test hook)
    rects: [],  // their NDC rects and peak values, last frame (page-test hook)
    draw(p, world, target) {
      halo.drawn = 0; halo.rects = [];
      const N = D.haloN(p); if (!N) return 0;
      const eye = p.eye || [-2, 0.37, 1.2], traffic = D.trafficSources(world.objects, eye, p);
      if (!traffic.length) return 0;
      const pool = p.trafficPool, atlas = !!(pool && pool.entries.length && traffic.some((q) => q.beam));
      const tanH = Math.tan(p.hfov * Math.PI / 360), W = p.w, H = p.h, sig = D.sigmaOf(p.look || {}), legacy = atlas ? null : D.trafficBeam(p);
      const ranked = traffic.map((L, i) => ({ L, i, d: Math.hypot(L.x - eye[0], L.y - eye[1], L.z - eye[2]) })).sort((a, b) => a.d - b.d || a.i - b.i).slice(0, N);
      const ac = renderer.autoClear; renderer.autoClear = false;
      try {
        for (const { L, i } of ranked) {
          const rect = haloRect(L, eye, p, W, H, tanH); if (!rect) continue;
          const idx = atlas ? D.trafficPickIndexOf(p, L.car) : 0;
          if (atlas && idx < 0) continue;   // a car with no pool pick has no atlas beam: the CPU twin would use the built-in table (not in the atlas)
          const tint = atlas ? [u.beamTint.value[idx].x, u.beamTint.value[idx].y, u.beamTint.value[idx].z] : [1, 1, 1];
          const m = atlas ? mats[1] : mats[0];
          Object.assign(m.uniforms, {
            haloRect: { value: new T.Vector4(...rect) }, haloEye: { value: new T.Vector3(eye[0], eye[1], eye[2]) }, haloLamp: { value: new T.Vector3(L.x, L.y, L.z) },
            haloDir: { value: new T.Vector2(L.nx, L.ny) }, haloW: { value: L.w === undefined ? 1 : L.w }, haloTint: { value: new T.Vector3(...tint) },
            haloBeam: { value: idx }, haloSteps: { value: D.HALO.steps }, haloSMax: { value: D.SCAT.S_MAX }, haloRMin: { value: D.SCAT.rMin },
            haloGFwd: { value: D.SCAT.gFwd }, haloGBack: { value: D.SCAT.gBack }, haloWFwd: { value: D.SCAT.wFwd },
            sigma: { value: sig }, tanH: { value: tanH }, size: { value: new T.Vector2(W, H) },
            otherBeam: { value: u.otherBeam.value }, otherLutInfo: { value: u.otherLutInfo.value }, otherLutSize: { value: u.otherLutSize.value },
            otherConvention: { value: legacy ? HAL_CONV(legacy.conv) : 0 },
            beamMeta: { value: u.beamMeta.value }, beamGrid: { value: u.beamGrid.value }, beamTint: { value: u.beamTint.value },
          });
          halo.rects.push({ rect, idx, lamp: [L.x, L.y, L.z], w: L.w, nx: L.nx, ny: L.ny, hasBeam: !!L.beam });
          mesh.material = m;
          renderer.setRenderTarget(target); renderer.render(scene, camera);
          halo.drawn++;
        }
      } finally { renderer.autoClear = ac; }
      return halo.drawn;
    },
  };
  return halo;
}
