/* LAMP-CONE-MIST: the lit cone of air under each street lamp, GPU drive view only (option lampCone 'on').
   Off (lampCone not 'on') or clear air (sigma 0): draw() returns before it touches anything, so frames stay byte-identical.

   Physics (single scattering, homogeneous medium, labelled assumptions):
     in-scatter radiance along the eye ray = integral over s of
        sigma * p(cos) * I(gamma, phi) / max(r^2, rMin^2) * exp(-sigma r) * exp(-sigma s) * ds * tint
     r = distance lamp -> point, s = distance eye -> point, I = the shared distribution table (js/lamp-dist.js, cd per 1000 lamp lm) x lamp lm / 1000.
     - sigma = D.sigmaOf(look) = 3.912 / visibility (m), the same extinction the fog and the air beam use (drive-three-shaders.js:35). Clear air: 0, pass off.
     - albedo 1 (scattering = extinction). ASSUMPTION.
     - p = Henyey-Greenstein, g = 0.6. ASSUMPTION (the owner's value). The air beam uses a forward+back mix (gFwd 0.7, gBack -0.4, D.SCAT); not the same.
     - rMin = D.SCAT.rMin (the lamp's own size, as the air beam uses).
   Geometry (the cone is the table's own shape, not a separate surface):
     - the ray is clipped to the slab 0 <= z <= lamp height: the road plane below, the lamp's horizontal above (no light above the lamp's horizontal).
     - inside the slab the ray is sampled at LAMP_CONE_STEPS geometric midpoints. The table is zero beyond the cutoff (edge 85 deg sodium, 80 deg LED),
       so points outside the cone add nothing. The cone's outer edge is therefore soft by construction (the table's own fall-off).
   Not done (see report): analytic ray-cone chord; scene-depth occlusion (the pass would sample the depth texture of the target it draws into: a feedback loop).
   Units: the target is cd/m^2-scale, the same convention as the lamp halo (lamp-halo header). Tuning values are the owner's to judge by eye. */
import * as T from '../vendor/three/three.module.min.js';
import { LAMP_DIST, kindOfLamp } from './lamp-dist.js';
import { lampsOf, SODIUM_TINT, LED_TINT, SODIUM_LM, LED_LM } from './drive-three-lamphalo.js';
const D = globalThis.RF.Drive;
export const LAMP_CONE_MAX = 8, LAMP_CONE_STEPS = 8, LAMP_CONE_G = 0.6, LAMP_CONE_SMAX = 300;   // lamps, steps per lamp, HG g, far limit (m)
const TAB_LEN = 480;   // 475 values (19 gamma x 25 phi) packed 4 per vec4: 120 uniform vectors, the same packing as the road table (drive-three-shaders.js:20)

const VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = `
uniform vec2 size; uniform float tanH; uniform int nLamp; uniform vec3 eyeP;
uniform float sigma, rMin, gHG;
uniform vec3 cLamp[${LAMP_CONE_MAX}]; uniform vec2 cSt[${LAMP_CONE_MAX}]; uniform vec3 cTint[${LAMP_CONE_MAX}]; uniform float cScale[${LAMP_CONE_MAX}];
uniform vec4 coneTab4[120];
float tabAt(int k) { int q = k / 4; vec4 v = coneTab4[q]; int c = k - 4 * q; return c == 0 ? v.x : (c == 1 ? v.y : (c == 2 ? v.z : v.w)); }
// Table lookup at v = lamp -> point, street vector st: the bilinear read of lampRoadF (drive-three-shaders.js:22) without its normalisation.
float coneI(vec3 v, vec2 st) {
  float rr = length(v); float g = degrees(acos(clamp(-v.z / rr, -1.0, 1.0)));
  float ph = degrees(atan(st.x * v.y - st.y * v.x, st.x * v.x + st.y * v.y)); if (ph < 0.0) ph += 360.0;
  float fg = clamp(g / 5.0, 0.0, 17.999), fp = clamp(ph / 15.0, 0.0, 23.999);
  float ig = floor(fg), tg = fg - ig, ip = floor(fp), tp = fp - ip; int k = int(ig) * 25 + int(ip);
  return (tabAt(k) * (1.0 - tp) + tabAt(k + 1) * tp) * (1.0 - tg) + (tabAt(k + 25) * (1.0 - tp) + tabAt(k + 26) * tp) * tg;
}
void main() {
  vec2 pix = gl_FragCoord.xy / size * 2.0 - 1.0;
  vec3 ray = normalize(vec3(1.0, -pix.x * tanH, pix.y * tanH * size.y / size.x));   // the halo pass's view ray
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${LAMP_CONE_MAX}; i++) {
    if (i >= nLamp) break;
    vec3 L = cLamp[i];
    float sa = 0.5, sb = ${LAMP_CONE_SMAX.toFixed(1)};
    if (abs(ray.z) < 1e-6) { if (eyeP.z < 0.0 || eyeP.z > L.z) continue; }
    else { float s0 = (0.0 - eyeP.z) / ray.z, s1 = (L.z - eyeP.z) / ray.z; sa = max(sa, min(s0, s1)); sb = min(sb, max(s0, s1)); }
    if (sb <= sa) continue;
    float q = pow(sb / sa, 1.0 / ${LAMP_CONE_STEPS.toFixed(1)});
    for (int k = 0; k < ${LAMP_CONE_STEPS}; k++) {
      float a = sa * pow(q, float(k)), b = a * q, s = sqrt(a * b), ds = b - a;
      vec3 v = eyeP + s * ray - L; float r2 = dot(v, v), r = sqrt(r2);
      if (r <= 0.0 || v.z >= 0.0) continue;
      float I = coneI(v, cSt[i]) * cScale[i];
      if (I <= 0.0) continue;
      float cs = dot(v / r, -ray);   // scattering angle: 1 = light travelling straight at the eye
      float p = (1.0 - gHG * gHG) / (4.0 * 3.14159265 * pow(1.0 + gHG * gHG - 2.0 * gHG * cs, 1.5));
      acc += sigma * p * I / max(r2, rMin * rMin) * exp(-sigma * (r + s)) * ds * cTint[i];
    }
  }
  gl_FragColor = vec4(acc, 1.0);
}`;

export function createLampCone(renderer) {
  let mat = null, mesh = null, scene = null, camera = null, last = { on: 0, count: 0, sigma: 0, lamps: [] };
  const tabCache = new Map();
  function setup() {
    const ones = (n, mk) => Array.from({ length: n }, mk);
    mat = new T.ShaderMaterial({
      uniforms: {
        size: { value: new T.Vector2(1, 1) }, tanH: { value: 0 }, nLamp: { value: 0 }, eyeP: { value: new T.Vector3() },
        sigma: { value: 0 }, rMin: { value: 0.3 }, gHG: { value: LAMP_CONE_G },
        cLamp: { value: ones(LAMP_CONE_MAX, () => new T.Vector3()) }, cSt: { value: ones(LAMP_CONE_MAX, () => new T.Vector2()) },
        cTint: { value: ones(LAMP_CONE_MAX, () => new T.Vector3()) }, cScale: { value: new Float32Array(LAMP_CONE_MAX) },
        coneTab4: { value: new Float32Array(TAB_LEN) },
      },
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, transparent: true, blending: T.AdditiveBlending,
    });
    mesh = new T.Mesh(new T.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false;
    scene = new T.Scene(); scene.add(mesh); camera = new T.Camera();
  }
  function tableFor(cls, kind) {
    const key = cls + '/' + kind;
    if (!tabCache.has(key)) { const f = new Float32Array(TAB_LEN); f.set(LAMP_DIST.classes[cls][kind]); tabCache.set(key, f); }
    return tabCache.get(key);
  }
  // The lamps this frame: street heads in front of the eye, nearest LAMP_CONE_MAX. Fills the uniforms; returns the list (for tests).
  function build(p, world, sigma) {
    const eye = p.eye || [-2, 0.37, 1.2];
    const cls = p.lampClass || 'III', kind = kindOfLamp(p.lampKind), lampLm = kind === 'led' ? LED_LM : SODIUM_LM;
    const tint = kind === 'led' ? LED_TINT() : SODIUM_TINT();
    const cand = [];
    for (const L of lampsOf(world.objects)) {
      if (L.kind !== 'street' || !L.street) continue;
      const d = [L.x - eye[0], L.y - eye[1], L.z - eye[2]], r = Math.hypot(d[0], d[1], d[2]);
      if (d[0] < 1 || r < 0.5) continue;   // behind the eye, or at it
      cand.push({ L, r });
    }
    cand.sort((a, b) => a.r - b.r);
    const near = cand.slice(0, LAMP_CONE_MAX);
    const U = mat.uniforms;
    U.size.value.set(p.w, p.h); U.tanH.value = Math.tan(p.hfov * Math.PI / 360);
    U.eyeP.value.set(eye[0], eye[1], eye[2]); U.sigma.value = sigma;
    U.rMin.value = D.SCAT.rMin; U.gHG.value = LAMP_CONE_G;
    U.coneTab4.value = tableFor(cls, kind);
    near.forEach(({ L }, i) => {
      U.cLamp.value[i].set(L.x, L.y, L.z); U.cSt.value[i].set(L.street[0], L.street[1]);
      U.cTint.value[i].set(tint[0], tint[1], tint[2]); U.cScale.value[i] = lampLm / 1000;
    });
    U.nLamp.value = near.length;
    return near.map(({ L, r }) => ({ x: L.x, y: L.y, z: L.z, r: +r.toFixed(2) }));
  }
  return {
    // Called once per frame by drive-three.js after lampHalo.draw, before the blit. Off or clear air: returns with no GL state change.
    draw(p, world, target) {
      if (p.lampCone !== 'on') { last = { on: 0, count: 0, sigma: 0, lamps: [] }; return; }
      const sigma = D.sigmaOf(p.look || {});
      last = { on: 1, count: 0, sigma, lamps: [] };
      if (!(sigma > 0)) return;   // clear air: no mist, so no cone
      if (!mat) setup();
      last.lamps = build(p, world, sigma); last.count = last.lamps.length;
      if (!last.count) return;
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      renderer.autoClear = ac;
      renderer.resetState(); renderer.setRenderTarget(target);
    },
    state() { return last; },
    // Cost hook (test only): GPU ms per draw of this pass with n lamps (timer query on a scratch target). Call after a frame with lampCone on.
    // If the scene has fewer than n lit street lamps, the last lamp's uniforms are repeated: the loop cost does not depend on which lamp it is.
    async time(gl, n, repeats = 8) {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { gpuMs: null, reason: 'timer extension unavailable' };
      if (!mat || !last.lamps || !last.lamps.length) return { gpuMs: null, reason: 'no frame with lampCone on yet' };
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return { gpuMs: null, reason: 'another timer is active' };
      const U = mat.uniforms, have = U.nLamp.value;
      const dup = Math.min(n, LAMP_CONE_MAX);
      for (let i = have; i < dup; i++) { U.cLamp.value[i].copy(U.cLamp.value[have - 1]); U.cSt.value[i].copy(U.cSt.value[have - 1]); U.cTint.value[i].copy(U.cTint.value[have - 1]); U.cScale.value[i] = U.cScale.value[have - 1]; }
      U.nLamp.value = dup;
      const size = U.size.value;
      const scratch = new T.WebGLRenderTarget(size.x, size.y, { type: T.HalfFloatType, depthBuffer: false });
      const query = gl.createQuery();
      renderer.resetState(); renderer.setRenderTarget(scratch); const ac = renderer.autoClear; renderer.autoClear = false;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query); for (let i = 0; i < repeats; i++) renderer.render(scene, camera); gl.endQuery(ext.TIME_ELAPSED_EXT);
      renderer.autoClear = ac; renderer.setRenderTarget(null); renderer.resetState(); gl.flush();
      U.nLamp.value = have; scratch.dispose();
      for (let i = 0; i < 300; i++) { await new Promise((r) => setTimeout(r, 10)); if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { gl.deleteQuery(query); return { gpuMs: null, reason: 'disjoint GPU timer', n: dup }; } if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { const gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 / repeats; gl.deleteQuery(query); return { gpuMs, repeats, n: dup, dupFrom: have }; } }
      gl.deleteQuery(query); return { gpuMs: null, reason: 'timer timeout', n: dup };
    },
  };
}
