/* SM (options trafficShadows, shadowRes, trafficShadowRoad): one depth map per oncoming car, so air (and road) its lamps cannot see gets none of their light.
   Pass frames only: the casters are the pass ribbon (SM1a) and, with trafficShadowObjects on, the object proxies (SM1b: guardrails, trees, proxy cars; the objects module draws them, see its casters).
   Storage: ONE float red target, the maps stacked vertically (map m = rows m*resH .. (m+1)*resH-1), a viewport per map. Colour = distance / 5000 (the project's one depth unit,
   as the ribbon and objects write), cleared to 1.0 = nothing in the way; the depth buffer keeps the nearest surface. R32F is not filterable here: texelFetch only.
   A map looks along its car's beam: eye = the midpoint of the car's lamps, axes = the beam's (fwd, lat, up) in OUR car frame (the halo's frame), uv = (-lat/fwd / tanH, up/fwd / tanV) * .5 + .5.
   Off (trafficShadows off): nothing here is built or drawn, and the shader texts that read it are never compiled. */
import * as T from '../vendor/three/three.module.min.js';
export const SM_MAX = 8, SM_DEPTH = 5000;
export const SM_RES = { '512x256': [512, 256], '512x512': [512, 512], '512x1024': [512, 1024], '1024x512': [1024, 512], '1024x1024': [1024, 1024], '2048x1024': [2048, 1024] };   // taller maps: the road is grazing, so vertical texels cover the most road
// Air test: true = the lamp of map m sees point P (car frame). Outside the map (behind its eye, off its edges) = lit, as without maps. Bias 0.3 m + 1.5% of the distance:
// air samples are not surfaces, but air just above a grazing road shares a texel with the road; the distance term keeps that layer lit.
export const SM_DECL = `uniform sampler2D smTex; uniform vec3 smE[${SM_MAX}], smF[${SM_MAX}], smL[${SM_MAX}], smU[${SM_MAX}]; uniform vec4 smP[${SM_MAX}]; uniform vec2 smRes;   // smP: (tanH, tanV, first row, -)
bool smLit(int m, vec3 P) {
  if (m < 0) return true;
  vec3 v = P - smE[m]; float x = dot(v, smF[m]); if (x <= 0.05) return true;
  vec2 uv = vec2(-dot(v, smL[m]) / (x * smP[m].x), dot(v, smU[m]) / (x * smP[m].y)) * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return true;
  float r = length(v), dm = texelFetch(smTex, ivec2(uv * smRes) + ivec2(0, int(smP[m].z)), 0).r;
  return r <= dm * ${SM_DEPTH.toFixed(1)} + 0.3 + 0.015 * r;
}
`;
// SM3 surface test (the ribbon's traffic loop): returns the shadowed fraction 0..1 of this traffic lamp at a road point. pw, nw: world point and normal (the pass shades in world); i: the traffic lamp.
// Per texel, the distance the map's TEXEL-CENTRE ray travels to this fragment's plane is compared with the stored distance, so a surface does not shadow itself where one texel spans
// metres of grazing road. Normal offset (Holbert 2011): the point is first lifted off its surface by SM_NO texel footprints at its distance, so a texel holding the next face over at a crease
// (road edge -> verge -> bank) no longer reads as a blocker (the sawtooth). smSoft (option trafficShadowSoft): 0 one texel, 1 a 2 x 2 bilinear PCF (percentage-closer filtering), 2 a 3 x 3 tent.
export const SM_NO = 1.5;
export const SM_ROAD = `uniform vec4 smOf[16]; uniform int smSoft;   // smOf: per traffic lamp, its map index + 1 (0 = no map)
float smTap(int m, vec3 v, vec3 N, ivec2 c) {
  vec2 nd = (vec2(c) + 0.5) / smRes * 2.0 - 1.0;
  float dm = texelFetch(smTex, c + ivec2(0, int(smP[m].z)), 0).r;
  vec3 sr = normalize(smF[m] - nd.x * smP[m].x * smL[m] + nd.y * smP[m].y * smU[m]);
  float den = dot(sr, N); if (abs(den) < 1e-6) return 0.0;
  float ex = dot(v, N) / den;
  return ex > 0.0 && ex > dm * ${SM_DEPTH.toFixed(1)} + 0.15 ? 1.0 : 0.0;
}
float smRoadF(int i, vec3 pw, vec3 nw) {
  int m = int(smOf[i >> 2][i & 3] + 0.5) - 1; if (m < 0) return 0.0;
  vec3 P = carFromWorld * pw, N = carFromWorld * nw, v = P - smE[m]; float x = dot(v, smF[m]); if (x <= 0.05) return 0.0;
  v += N * (${SM_NO.toFixed(2)} * x * 2.0 * max(smP[m].x / smRes.x, smP[m].y / smRes.y)); x = dot(v, smF[m]); if (x <= 0.05) return 0.0;
  vec2 uv = vec2(-dot(v, smL[m]) / (x * smP[m].x), dot(v, smU[m]) / (x * smP[m].y)) * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 0.0;
  ivec2 hi = ivec2(smRes) - 1;
  if (smSoft == 0) return smTap(m, v, N, clamp(ivec2(uv * smRes), ivec2(0), hi));
  vec2 f = uv * smRes - 0.5; ivec2 b = ivec2(floor(f)); vec2 w = f - floor(f); float s = 0.0;
  if (smSoft == 1) { for (int dy = 0; dy < 2; dy++) for (int dx = 0; dx < 2; dx++) s += smTap(m, v, N, clamp(b + ivec2(dx, dy), ivec2(0), hi)) * (dx == 0 ? 1.0 - w.x : w.x) * (dy == 0 ? 1.0 - w.y : w.y); return s; }
  ivec2 c0 = clamp(ivec2(uv * smRes), ivec2(0), hi);
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) s += smTap(m, v, N, clamp(c0 + ivec2(dx, dy), ivec2(0), hi)) * float((2 - abs(dx)) * (2 - abs(dy))) / 16.0;
  return s;
}
`;
// The uniforms every reader shares (one set of objects: the halo table, the cone pass and the ribbon all point at these).
export function smUniforms() {
  const v3 = () => Array.from({ length: SM_MAX }, () => new T.Vector3());
  return { smTex: { value: null }, smE: { value: v3() }, smF: { value: v3() }, smL: { value: v3() }, smU: { value: v3() }, smP: { value: Array.from({ length: SM_MAX }, () => new T.Vector4(1, 1, 0, 0)) }, smRes: { value: new T.Vector2(1, 1) }, smOf: { value: Array.from({ length: 16 }, () => new T.Vector4()) }, smSoft: { value: 1 } };
}
// The map renderer. list: [{ eye, f, l, u, tanH, tanV }] (car frame), nearest car first. geometry: the pass ribbon (world positions); cfw: carFromWorld (Matrix3); ver: the ribbon's version.
// objs (SM1b, null = ribbon only): { scene, ver, view(m, row, W, H, cfw) } from the objects module, drawn into the same map after the ribbon.
export function createTrafficMaps(renderer, U) {
  let rt = null, dim = '', keys = [];
  const mU = { carFromWorld: { value: null }, mEye: { value: new T.Vector3() }, mF: { value: new T.Vector3() }, mL: { value: new T.Vector3() }, mU: { value: new T.Vector3() }, mTan: { value: new T.Vector2() }, mOffMax: { value: 1e9 } };
  const mat = new T.ShaderMaterial({ uniforms: mU, side: T.DoubleSide, depthTest: true, depthWrite: true,
    vertexShader: 'attribute vec4 routeUV; uniform mat3 carFromWorld; uniform vec3 mEye, mF, mL, mU; uniform vec2 mTan; varying vec3 mv; varying float mOff; void main(){ vec3 v = carFromWorld * position - mEye; mv = v; mOff = routeUV.y; gl_Position = vec4(-dot(v, mL) / mTan.x, dot(v, mU) / mTan.y, 0.0, dot(v, mF)); }',
    fragmentShader: `uniform vec3 mF; uniform float mOffMax; varying vec3 mv; varying float mOff; void main(){ if (dot(mv, mF) < 0.3 || abs(mOff) > mOffMax) discard; float d = min(0.99999, length(mv) / ${SM_DEPTH.toFixed(1)}); gl_FragDepth = d; gl_FragColor = vec4(d, 0.0, 0.0, 1.0); }` });
  const scene = new T.Scene(), camera = new T.Camera(); let mesh = null;
  const stat = { runs: 0, skips: 0, maps: 0, ms: 0 };
  return {
    stat,
    render(geometry, cfw, ver, list, res, objs = null) {
      const [W, H] = res, K = Math.max(1, list.length), d = W + 'x' + H + 'x' + K;
      if (!rt || dim !== d) { if (rt) rt.dispose(); rt = new T.WebGLRenderTarget(W, H * K, { type: T.FloatType, format: T.RedFormat, depthBuffer: true, minFilter: T.NearestFilter, magFilter: T.NearestFilter }); dim = d; keys = []; }
      if (!mesh || mesh.geometry !== geometry) { if (mesh) scene.remove(mesh); mesh = new T.Mesh(geometry, mat); mesh.frustumCulled = false; scene.add(mesh); }
      const timing = !!globalThis.SL_SHADOW_TIMING; if (timing) renderer.getContext().finish(); const t0 = timing ? performance.now() : 0;
      const cc = renderer.getClearColor(new T.Color()), ca = renderer.getClearAlpha(), ac = renderer.autoClear; renderer.autoClear = false; renderer.setClearColor(new T.Color(1, 0, 0), 1);
      mU.carFromWorld.value = cfw; const ce = cfw.elements; mU.mOffMax.value = globalThis.SL_SM_OFFMAX || 1e9;   // SL_SM_OFFMAX: probe control (casters limited to |offset| <= this many m from their leg's centre line)
      list.forEach((m, i) => {
        const clr = !!globalThis.SL_SM_CLEAR || !!globalThis.SL_SM_BLOCK, blk = !!globalThis.SL_SM_BLOCK, key = [ver, objs ? objs.ver : '-', W, H, mU.mOffMax.value, clr, blk, ...m.eye, ...m.f, ...m.l, ...m.u, m.tanH, m.tanV, ...ce].join(',');
        U.smE.value[i].fromArray(m.eye); U.smF.value[i].fromArray(m.f); U.smL.value[i].fromArray(m.l); U.smU.value[i].fromArray(m.u); U.smP.value[i].set(m.tanH, m.tanV, i * H, 0);
        if (keys[i] === key) { stat.skips++; return; }
        mU.mEye.value.fromArray(m.eye); mU.mF.value.fromArray(m.f); mU.mL.value.fromArray(m.l); mU.mU.value.fromArray(m.u); mU.mTan.value.set(m.tanH, m.tanV);
        rt.viewport.set(0, i * H, W, H); rt.scissor.set(0, i * H, W, H); rt.scissorTest = true;
        if (blk) renderer.setClearColor(new T.Color(0, 0, 0), 1);
        renderer.setRenderTarget(rt); renderer.clear(true, true, false); if (!clr) { renderer.render(scene, camera); if (objs) { objs.view(m, i * H, W, H, cfw); renderer.render(objs.scene, camera); } }   // test controls: SL_SM_CLEAR maps cleared to 'nothing in the way', SL_SM_BLOCK to 'everything in the way' (0 m)
        if (blk) renderer.setClearColor(new T.Color(1, 0, 0), 1);
        keys[i] = key; stat.runs++;
      });
      rt.viewport.set(0, 0, W, H * K); rt.scissor.set(0, 0, W, H * K); rt.scissorTest = false;
      renderer.setRenderTarget(null); renderer.setClearColor(cc, ca); renderer.autoClear = ac;
      U.smTex.value = rt.texture; U.smRes.value.set(W, H); stat.maps = list.length;
      if (timing) { renderer.getContext().finish(); stat.ms += performance.now() - t0; }
      return rt.texture;
    },
    // Test hook: the distances (m) of one map, row 0 = bottom (its own rows only).
    read(m) { if (!rt) return null; const [W, H] = dim.split('x').map(Number), out = new Float32Array(W * H); renderer.readRenderTargetPixels(rt, 0, m * H, W, H, out); for (let i = 0; i < W * H; i++) out[i] *= SM_DEPTH; return { W, H, t: out }; },   // a red float target reads back one value per texel
    dispose() { if (rt) rt.dispose(); mat.dispose(); },
  };
}
