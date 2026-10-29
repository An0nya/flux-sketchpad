/* CP (option haloConePass off | 1 | 2): the nearest oncoming lamps seen SIDE-ON are taken out of the traffic-halo table and marched per pixel instead, GPU drive view only.
   Why: the table samples each depth slice at fixed points, the same for every cell, so a beam crossed side-on (a narrow one above all) lights only where it crosses a sample
   sphere (beads), and interleaving / jitter turn that into grain. Here each pixel marches only the stretch of its own eye ray that lies inside the lamp's beam: the ray is
   clipped to the beam's non-zero cone (the same planes the culling uses, drive-three-halo-cull.js coneClip), so all CP_STEPS samples land in the lit air. No slices at all.
   Integrand: exactly the table pass's (drive-three-halo.js TMAIN): sigma * p(theta) * W * I(local) / max(r^2, rMin^2) * exp(-sigma r) * exp(-sigma s) * ds * tint, times haloGain
   (the lookup's gain), s in [0.5, min(scatter range, the surface at this pixel)]. Samples are equiangular about the lamp (Kulla & Fajardo 2012), as drive-three-lampcone.js.
   Hand-over (drive-three-halo.js build): lamp weight w = smoothstep over the angle between its beam axis and the line to our eye (head-on lamps stay in the table, where slicing
   along the view ray is harmless); the table draws the lamp with W * (1 - w) and this pass with W * w, so nothing counts twice. w = 1: the lamp is not in the table at all.
   Ground layer: the blit-copied scene depth on pass frames (the ribbon writes t / 5000, t = metres along the unit eye ray), the z = 0 road plane on flat frames.
   Object layer: like the lamp cone's object pass, base colour + the march up to each object's depth (alpha < 0.5 pixels pass through).
   Off (no lamp handed over): draw() and drawObjects() return before any GL call, so frames are byte-identical. */
import * as T from '../vendor/three/three.module.min.js';
import { ATLAS_HEAD, OTHER_LEGACY, OTHER_ATLAS } from './drive-three-shaders.js';
import { SM_DECL } from './drive-three-shadowmaps.js';
import { OCC_DECL } from './drive-three-halo.js';
export const CP_MAX = 2, CP_PLANES = 8, CP_STEPS = 16, CP_DEPTH = 5000;
const VERT = 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }';
const HEAD = `uniform vec2 size; uniform float tanH, sigma, rMin, gF, gB, wF, cRange, cGain; uniform vec3 cEye; uniform int nCone, cFlat;
uniform vec4 cLamp[${CP_MAX}], cTint[${CP_MAX}];   // xyz + W * w; rgb tint + atlas index
uniform vec3 cF[${CP_MAX}], cL[${CP_MAX}], cU[${CP_MAX}];   // the beam's local axes (car frame), as the table shader's fwd / lat / up
uniform vec4 cPl[${CP_MAX * CP_PLANES}]; uniform int cNPl[${CP_MAX}];   // the cone's planes, inside = n.P + D >= 0 (car frame)
uniform float cSm[${CP_MAX}];   // SM: the lamp's map index + 1 (0 = none)
uniform sampler2D otherBeam; uniform vec4 otherLutInfo; uniform vec2 otherLutSize; uniform int otherConvention;
`;
const MARCH = `float hgP(float g, float c) { return (1.0 - g * g) / (4.0 * 3.14159265 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
vec3 coneMarch(vec3 ray, float tEnd) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${CP_MAX}; i++) {
    if (i >= nCone) break;
    vec3 L = cLamp[i].xyz; float sa = 0.5, sb = min(cRange, tEnd); bool outside = false;
    for (int j = 0; j < ${CP_PLANES}; j++) { if (j >= cNPl[i]) break; vec4 pl = cPl[i * ${CP_PLANES} + j]; float a = dot(pl.xyz, cEye) + pl.w, b = dot(pl.xyz, ray);
      if (abs(b) < 1e-9) { if (a < 0.0) outside = true; } else if (b > 0.0) sa = max(sa, -a / b); else sb = min(sb, -a / b); }
    if (outside || sb <= sa) continue;
    tbeam = int(cTint[i].w + 0.5);
    vec3 Dv = L - cEye; float t0 = dot(Dv, ray), h = max(sqrt(max(dot(Dv, Dv) - t0 * t0, 0.0)), 1e-3);
    float ta = atan((sa - t0) / h), tb = atan((sb - t0) / h), dth = (tb - ta) / ${CP_STEPS.toFixed(1)};
    for (int k = 0; k < ${CP_STEPS}; k++) {
      float th = ta + (float(k) + 0.5) * dth, ct = cos(th), s = t0 + h * tan(th), ds = h / (ct * ct) * dth;
      vec3 P = cEye + s * ray, d = P - L; float r2 = dot(d, d); if (r2 <= 0.0) continue;
      vec3 local = vec3(dot(d, cF[i]), dot(d, cL[i]), dot(d, cU[i])); if (local.x <= 0.0) continue;
      //HOOK
      float I = cLamp[i].w * otherIntensity(local); if (I <= 0.0) continue;
      float r = sqrt(r2), cs = -dot(d, ray) / r, p = wF * hgP(gF, cs) + (1.0 - wF) * hgP(gB, cs);
      acc += sigma * p * I / max(r2, rMin * rMin) * exp(-sigma * r) * exp(-sigma * s) * ds * cTint[i].rgb;
    }
  }
  return acc * cGain;
}
vec3 viewRay(vec2 fc) { vec2 pix = fc / size * 2.0 - 1.0; return normalize(vec3(1.0, -pix.x * tanH, pix.y * tanH * size.y / size.x)); }
`;
const GROUND = `uniform sampler2D uDepth;
void main() {
  vec3 ray = viewRay(gl_FragCoord.xy); float tEnd = 1e9;
  if (cFlat == 1) { if (ray.z < 0.0) tEnd = -cEye.z / ray.z; } else tEnd = texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r * ${CP_DEPTH.toFixed(1)};
  gl_FragColor = vec4(coneMarch(ray, tEnd), 1.0);
}`;
const OBJ = `uniform sampler2D uObj, uDepth;
void main() {
  vec4 base = texelFetch(uObj, ivec2(gl_FragCoord.xy), 0);
  if (base.a < 0.5) { gl_FragColor = base; return; }
  float tObj = texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0).r * ${CP_DEPTH.toFixed(1)};
  gl_FragColor = vec4(base.rgb + coneMarch(viewRay(gl_FragCoord.xy), tObj), base.a);
}`;
// atlas: per-lamp beams from the atlas; sm: the shadow-map test; occDecl: the E2 crest test's text (drive-three-halo.js OCC_DECL), when the frame has the height map.
// SMF: with both, the crest test is the fallback for a lamp whose car has no map (cSm 0), as the table.
export function coneSource(atlas, main, sm = false, occDecl = '') {
  const hook = sm && occDecl ? '      if (cSm[i] > 0.5 ? !smLit(int(cSm[i] + 0.5) - 1, P) : crestOcc(L, P)) continue;\n'
    : (sm ? '      if (!smLit(int(cSm[i] + 0.5) - 1, P)) continue;\n' : '') + (occDecl ? '      if (crestOcc(L, P)) continue;\n' : '');
  const m = MARCH.replace('      //HOOK\n', hook); if (m === MARCH) throw Error('CP: hook not found');
  return HEAD + (sm ? SM_DECL : '') + occDecl + (atlas ? ATLAS_HEAD + OTHER_ATLAS : 'int tbeam = 0;\n' + OTHER_LEGACY) + m + main;
}
export function createBeamCone(renderer, u, smU) {
  const scene = new T.Scene(), camera = new T.Camera(), mesh = new T.Mesh(new T.PlaneGeometry(2, 2)); mesh.frustumCulled = false; scene.add(mesh);
  const cU = {
    size: { value: new T.Vector2(1, 1) }, tanH: { value: 1 }, sigma: { value: 0 }, rMin: { value: 0.3 }, gF: { value: 0 }, gB: { value: 0 }, wF: { value: 1 }, cRange: { value: 120 }, cGain: { value: 1 },
    cEye: { value: new T.Vector3() }, nCone: { value: 0 }, cFlat: { value: 1 },
    cLamp: { value: Array.from({ length: CP_MAX }, () => new T.Vector4()) }, cTint: { value: Array.from({ length: CP_MAX }, () => new T.Vector4()) },
    cF: { value: Array.from({ length: CP_MAX }, () => new T.Vector3()) }, cL: { value: Array.from({ length: CP_MAX }, () => new T.Vector3()) }, cU: { value: Array.from({ length: CP_MAX }, () => new T.Vector3()) },
    cPl: { value: Array.from({ length: CP_MAX * CP_PLANES }, () => new T.Vector4()) }, cNPl: { value: new Int32Array(CP_MAX) }, cSm: { value: new Float32Array(CP_MAX) },
    crestH: { value: null }, crestWFC: { value: new T.Matrix3() }, crestBox: { value: new T.Vector4() }, crestZ: { value: new T.Vector2() },   // E2 (only read by the +crest variants)
    uDepth: { value: null }, uObj: { value: null },
  };
  const shared = () => Object.assign({}, cU, { otherBeam: u.otherBeam, otherLutInfo: u.otherLutInfo, otherLutSize: u.otherLutSize, otherConvention: u.otherConvention, beamMeta: u.beamMeta, beamGrid: u.beamGrid, beamTint: u.beamTint, trafficBeamIdx: u.trafficBeamIdx }, smU);
  const mats = new Map();
  const matOf = (kind, atlas, sm, occ) => {
    const k = [kind, atlas, sm, !!occ].join(); if (mats.has(k)) return mats.get(k);
    const uni = shared();
    const m = new T.ShaderMaterial({ uniforms: uni, vertexShader: VERT, fragmentShader: coneSource(atlas, kind === 'obj' ? OBJ : GROUND, sm, occ ? OCC_DECL : ''), depthTest: false, depthWrite: false,
      ...(kind === 'obj' ? { blending: T.NoBlending } : { transparent: true, blending: T.AdditiveBlending }) });
    mats.set(k, m); return m;
  };
  let depthRT = null, objRT = null, last = { on: 0, lamps: [] }, frame = null;
  function copyDepth(target) {   // as drive-three-lampcone.js copyDepth: the cone draws into target while reading this copy of its depth
    const gl = renderer.getContext(), W = target.width, H = target.height;
    if (!depthRT || depthRT.width !== W || depthRT.height !== H) { if (depthRT) { depthRT.depthTexture.dispose(); depthRT.dispose(); } depthRT = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, depthTexture: new T.DepthTexture(W, H, T.FloatType), depthBuffer: true, minFilter: T.NearestFilter, magFilter: T.NearestFilter }); }
    renderer.setRenderTarget(target); const src = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    renderer.setRenderTarget(depthRT); const dst = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    renderer.resetState(); renderer.setRenderTarget(target);
    return depthRT.depthTexture;
  }
  // c = halo.cone: { lamps: [{ pos, w (W * share), tint, idx, basis {f, l, u}, planes, sm }], atlas, eye, tanH, sigma, range, gain, flat, sm, occ }
  const setU = (c, W, H) => {
    cU.size.value.set(W, H); cU.tanH.value = c.tanH; cU.sigma.value = c.sigma; cU.rMin.value = c.rMin; cU.gF.value = c.gF; cU.gB.value = c.gB; cU.wF.value = c.wF; cU.cRange.value = c.range; cU.cGain.value = c.gain;
    cU.cEye.value.fromArray(c.eye); cU.cFlat.value = c.flat ? 1 : 0; cU.nCone.value = c.lamps.length;
    c.lamps.forEach((q, i) => {
      cU.cLamp.value[i].set(q.pos[0], q.pos[1], q.pos[2], q.w); cU.cTint.value[i].set(q.tint[0], q.tint[1], q.tint[2], q.idx);
      cU.cF.value[i].fromArray(q.basis.f); cU.cL.value[i].fromArray(q.basis.l); cU.cU.value[i].fromArray(q.basis.u);
      const pl = q.planes.slice(0, CP_PLANES); cU.cNPl.value[i] = pl.length; pl.forEach((p, j) => cU.cPl.value[i * CP_PLANES + j].set(p[0], p[1], p[2], p[3])); cU.cSm.value[i] = q.sm + 1;
    });
    if (c.occ) { cU.crestH.value = c.occ.texture; cU.crestWFC.value.copy(c.occ.wfc); cU.crestBox.value.copy(c.occ.box); cU.crestZ.value.copy(c.occ.z); }
  };
  return {
    // After the ground pass, into the scene target (additive). c null or empty = no GL call.
    draw(c, target) {
      frame = c && c.lamps && c.lamps.length ? c : null; last = { on: frame ? 1 : 0, lamps: frame ? frame.lamps.map((q) => ({ pos: q.pos, w: q.w, share: q.share, angle: q.angle })) : [] };
      if (!frame) return;
      setU(frame, target.width, target.height);
      const m = matOf('ground', frame.atlas, frame.sm, frame.occ);
      if (!frame.flat) cU.uDepth.value = copyDepth(target);
      const ac = renderer.autoClear; renderer.autoClear = false; mesh.material = m; renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.autoClear = ac;
      renderer.resetState(); renderer.setRenderTarget(target);
    },
    // After the objects (and the lamp cone's object pass): src = the colour so far, depth = the object target's depth texture. Returns its own target, left bound (the blit reads it).
    drawObjects(src, depth) {
      if (!frame) return null;
      const W = src.width, H = src.height;
      if (!objRT || objRT.width !== W || objRT.height !== H) { if (objRT) objRT.dispose(); objRT = new T.WebGLRenderTarget(W, H, { type: T.FloatType, depthBuffer: false, minFilter: T.NearestFilter, magFilter: T.NearestFilter }); }
      setU(frame, W, H); cU.uObj.value = src.texture; cU.uDepth.value = depth;
      const ac = renderer.autoClear; renderer.autoClear = false; mesh.material = matOf('obj', frame.atlas, frame.sm, frame.occ); renderer.setRenderTarget(objRT); renderer.render(scene, camera); renderer.autoClear = ac;
      last.objects = true; return objRT;
    },
    state() { return last; },
    programs() { return mats.size; },
  };
}
