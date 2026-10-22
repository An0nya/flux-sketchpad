/* LAMP-HALO-SPRITES: a glare veil around lit street lamps and traffic-signal heads, GPU drive view only (option lampHalos 'on').
   Off (lampHalos not 'on'): draw() returns before it touches anything, so frames stay byte-identical.
   On: after the ground pass is rendered into the frame target and before that target is blitted out, one full-screen additive pass adds, per pixel,
     sum over the nearest N lamps (N <= 16) of  tint * E_lamp * K / theta^2     for theta <= 30 deg,
   where theta is the exact angle between the pixel's view ray and the lamp (the same ray the objects shader uses: (1, -sx tanH, sy tanH H/W)),
   theta is clamped at 1 deg (the core), K = 10 (1 + (age/70)^4) is Holladay's age-adjusted glare coefficient (cd/m^2 per lux per deg^2), and
   E_lamp = I / d^2 is the illuminance at the eye (lux) from the lamp's intensity I toward the driver (cd) at distance d (m).
   Only adds: every term is >= 0, so on can only brighten a pixel.

   Labels (from reports/LAMP-HALO-REGS.md):
   - sodium lamp flux 9000 lm: verified (Philips SON-T 100 W datasheet).
   - intensity toward the driver = 100 cd per 1000 lm (cutoff class at 80 deg, snippet, old IES definition) x 9 klm = 900 cd. A MAXIMUM at 80 deg; used at every
     angle, so it overstates for lamps seen at steep angles. Inference.
   - LED lamp: 55 W at 75 lm/W = 4125 lm (LA County equivalency row, verified) x the same 100 cd/klm ceiling = 413 cd. ASSUMPTION: no LED 80-90 deg value was sourced.
   - signal head: I = max(emit channel) x pi r^2 from the scene's own emit (drive-scenes.js signal(): red 1.2e4 cd/m^2 on a 0.1 m disc = 377 cd). Inference: close to
     the 339 cd Caltrans-module minimum (snippet, unverified). Amber and green have no sourced intensity.
   - tints: sodium 2000 K, LED 4000 K via RF.CCT.cctToRGB (chromaticity only, normalised to luminance 1); signal colours from the scene's emit.
   - far cut: linear to zero between 280 and 300 m (ASSUMPTION; a cost bound, not physics).
   - the target is taken to be in cd/m^2 (headlamp emit I/(pi r^2) in drive-scenes.js:101 is cd/m^2, and the signal emit is on the same scale). Inference, not checked
     against a photometric measurement. */
import * as T from '../vendor/three/three.module.min.js';
const K_AGE = 20;                                   // Holladay age (years), the default
const K_VEIL = 10 * (1 + Math.pow(K_AGE / 70, 4));  // ~10.07
export const LAMP_HALO_MAX = 16, LAMP_HALO_THETA_MIN = 1, LAMP_HALO_THETA_MAX = 30;
export const LAMP_HALO_CD_PER_KLM = 100, SODIUM_LM = 9000, LED_LM = 55 * 75;
export const LAMP_HALO_RANGE = [280, 300];          // m: full strength to 280, zero at 300 (ASSUMPTION: a cost bound only; the veil itself has no range, the sprite radius already shrinks with distance)
export const LAMP_HALO_FLOOR = 0.05;               // cd/m^2: the sprite ends where the veil falls to this (ASSUMPTION; ~a tenth of an estimated road luminance of ~0.6 cd/m^2, inference). Without it the 1/theta^2 tail fills the whole frame.
const SIGNAL_R = 0.1;                               // m, the signal disc radius in drive-scenes.js signal()

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function tintOf(K, fallback) {
  let c = null;
  try { c = globalThis.RF && RF.CCT && RF.CCT.cctToRGB ? RF.CCT.cctToRGB(K, 0) : null; } catch (e) { c = null; }
  if (!c || !(lum(c) > 0)) c = fallback;
  const Y = lum(c); return c.map((v) => Math.max(0, v) / Y);
}
const SODIUM_TINT = () => tintOf(2000, [1, 0.5, 0.14]), LED_TINT = () => tintOf(4000, [1, 0.94, 0.86]);

const VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const FRAG = `
uniform vec2 size; uniform float tanH; uniform int nLamp; uniform float kVeil;
uniform vec3 lampDir[${LAMP_HALO_MAX}]; uniform vec3 lampCE[${LAMP_HALO_MAX}]; uniform float lampTh[${LAMP_HALO_MAX}];
void main() {
  vec2 pix = gl_FragCoord.xy / size * 2.0 - 1.0;
  vec3 ray = normalize(vec3(1.0, -pix.x * tanH, pix.y * tanH * size.y / size.x));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${LAMP_HALO_MAX}; i++) {
    if (i >= nLamp) break;
    float th = degrees(acos(clamp(dot(ray, lampDir[i]), -1.0, 1.0)));
    if (th > lampTh[i]) continue;
    float w = 1.0 - smoothstep(0.5 * lampTh[i], lampTh[i], th);   // soft roll-off to the sprite edge: no hard disc
    th = max(th, ${LAMP_HALO_THETA_MIN.toFixed(1)});
    acc += lampCE[i] * (kVeil / (th * th)) * w;
  }
  gl_FragColor = vec4(acc, 1.0);
}`;

// The lamp list: street-lamp heads (drive-anim.js ~562 'ell', mat lamp-head) and signal discs that are lit (drive-scenes.js signal(), emit non-null).
function lampsOf(objects) {
  const out = [];
  for (const ob of objects || []) {
    if (!ob || !ob.emit) continue;
    if (ob.cls === 'street-lamp' && ob.mat === 'lamp-head') out.push({ x: ob.x, y: ob.y, z: ob.z, kind: 'street', emit: ob.emit });
    else if (ob.cls === 'signal' && ob.k === 'disc') out.push({ x: ob.x, y: ob.y, z: ob.z, kind: 'signal', emit: ob.emit });
  }
  return out;
}

export function createLampHalo(renderer, u) {
  let mat = null, mesh = null, scene = null, camera = null, lastState = { count: 0, lamps: [], kind: '', on: 0 }, fail = '', lastArgs = null, scratch = null;
  function setup() {
    mat = new T.ShaderMaterial({
      uniforms: { size: { value: new T.Vector2(1, 1) }, tanH: { value: 0 }, nLamp: { value: 0 }, kVeil: { value: K_VEIL }, lampDir: { value: Array.from({ length: LAMP_HALO_MAX }, () => new T.Vector3()) }, lampCE: { value: Array.from({ length: LAMP_HALO_MAX }, () => new T.Vector3()) }, lampTh: { value: new Float32Array(LAMP_HALO_MAX) } },
      vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, transparent: true, blending: T.AdditiveBlending,
    });
    mesh = new T.Mesh(new T.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false;
    scene = new T.Scene(); scene.add(mesh); camera = new T.Camera();
  }
  // Build the lamp list for this frame from the eye the shader reads (u.eye) and the objects the frame draws. Returns the list (for tests).
  function build(p, world) {
    if (!mat) setup();
    const eye = u.eye.value, tanH = Math.tan(p.hfov * Math.PI / 360);
    const kind = p.lampKind === 'led' ? 'led' : 'sodium';
    const street = kind === 'led' ? { I: LAMP_HALO_CD_PER_KLM * LED_LM / 1000, tint: LED_TINT() } : { I: LAMP_HALO_CD_PER_KLM * SODIUM_LM / 1000, tint: SODIUM_TINT() };
    const cand = [];
    for (const L of lampsOf(world.objects)) {
      const d = [L.x - eye.x, L.y - eye.y, L.z - eye.z], r = Math.hypot(d[0], d[1], d[2]);
      if (d[0] < 1 || r < 0.5) continue;                      // behind, or at the eye
      const sx = -d[1] / (d[0] * tanH), sy = d[2] * p.w / (d[0] * tanH * p.h);
      if (Math.abs(sx) > 3 || Math.abs(sy) > 3) continue;     // far outside the view: no pixel inside 30 deg of it
      let I, tint;
      if (L.kind === 'street') { I = street.I; tint = street.tint; }
      else {
        const e = L.emit, m = Math.max(...e.map((v) => +v || 0));
        I = m * Math.PI * SIGNAL_R * SIGNAL_R; tint = e.map((v) => Math.max(0, +v || 0) / Math.max(1e-9, lum(e)));
        if (!(I > 0)) continue;
      }
      const fade = Math.max(0, Math.min(1, (LAMP_HALO_RANGE[1] - r) / (LAMP_HALO_RANGE[1] - LAMP_HALO_RANGE[0])));
      const E = I / (r * r) * fade;                           // lux at the eye
      const thMax = Math.min(LAMP_HALO_THETA_MAX, Math.sqrt(K_VEIL * E / LAMP_HALO_FLOOR));   // the sprite radius, deg
      cand.push({ r, E, I, thMax, tint, dir: [d[0] / r, d[1] / r, d[2] / r], ce: tint.map((c) => c * E), kind: L.kind, sx, sy });
    }
    cand.sort((a, b) => a.r - b.r);
    const near = cand.slice(0, LAMP_HALO_MAX);
    near.forEach((c, i) => { mat.uniforms.lampDir.value[i].set(...c.dir); mat.uniforms.lampCE.value[i].set(...c.ce); mat.uniforms.lampTh.value[i] = c.thMax; });
    mat.uniforms.nLamp.value = near.length; mat.uniforms.tanH.value = tanH;
    lastState = { count: near.length, kind, on: 1, tanH, w: p.w, h: p.h, lamps: near.map((c) => ({ kind: c.kind, r: +c.r.toFixed(2), sx: +c.sx.toFixed(3), sy: +c.sy.toFixed(3), E: +c.E.toPrecision(4), I: +c.I.toPrecision(4), thMax: +c.thMax.toFixed(2), tint: c.tint.map((v) => +v.toFixed(3)) })) };
    return near;
  }
  return {
    // Called once per frame by drive-three.js, after the ground pass and before the blit. Off: returns with no state change.
    draw(p, world, target) {
      if (p.lampHalos !== 'on') { lastState = { count: 0, lamps: [], kind: '', on: 0 }; return; }
      lastArgs = { p, world };
      try {
        const near = build(p, world);
        if (!near.length) { lastState.on = 1; return; }
        mat.uniforms.size.value.set(p.w, p.h);
        const ac = renderer.autoClear; renderer.autoClear = false;
        renderer.setRenderTarget(target); renderer.render(scene, camera);
        renderer.autoClear = ac;
        renderer.resetState(); renderer.setRenderTarget(target);
      } catch (e) { fail = String(e && e.message || e); throw e; }
    },
    state() { return lastState; },
    // GPU time of the halo pass alone, ms per draw (timer query), into a scratch target of the same size: the frame target is left alone.
    // Call after at least one frame with lampHalos on (it times the last frame's lamp list).
    async time(gl, repeats = 8) {
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'); if (!ext) return { gpuMs: null, reason: 'timer extension unavailable' };
      if (!lastArgs) return { gpuMs: null, reason: 'no frame with lampHalos on yet' };
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return { gpuMs: null, reason: 'another timer is active' };
      const { p, world } = lastArgs; build(p, world);
      if (!scratch || scratch.width !== p.w || scratch.height !== p.h) { if (scratch) scratch.dispose(); scratch = new T.WebGLRenderTarget(p.w, p.h, { type: T.HalfFloatType, depthBuffer: false }); }
      const query = gl.createQuery();
      renderer.resetState(); renderer.setRenderTarget(scratch); const ac = renderer.autoClear; renderer.autoClear = false;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query); for (let i = 0; i < repeats; i++) renderer.render(scene, camera); gl.endQuery(ext.TIME_ELAPSED_EXT);
      renderer.autoClear = ac; renderer.setRenderTarget(null); renderer.resetState(); gl.flush();
      for (let i = 0; i < 200; i++) { await new Promise((r) => setTimeout(r, 10)); if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { gl.deleteQuery(query); return { gpuMs: null, reason: 'disjoint GPU timer' }; } if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) { const gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6 / repeats; gl.deleteQuery(query); return { gpuMs, repeats }; } }
      gl.deleteQuery(query); return { gpuMs: null, reason: 'timer timeout' };
    },
    lastError() { return fail; },
  };
}
