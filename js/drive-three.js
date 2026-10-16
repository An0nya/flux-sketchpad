/* Opt-in Drive ground renderer. CPU objects and the established display passes share its WebGL context. */
import * as T from '../vendor/three/three.module.min.js';
import { vertex, ground, withLighting } from './drive-three-shaders.js';
import { objects } from './drive-three-objects.js';
const D = globalThis.RF.Drive;
const texture = (data, w, h, format = T.RGBAFormat) => { const t = new T.DataTexture(data, w, h, format, T.FloatType); t.needsUpdate = true; return t; };
const array = (n, type) => Array.from({ length: n }, () => new type());
// One three renderer per GL context: renderer.dispose() leaves its 1x1 placeholder textures and blit framebuffers
// behind (4 + 3 per renderer), so toggling would leak them. Reusing it keeps the count flat; a lost context drops it.
const renderers = new WeakMap();
function shared(canvas, gl) {
  let renderer = renderers.get(gl);
  if (renderer && gl.isContextLost()) { renderers.delete(gl); renderer.dispose(); renderer = null; }
  if (renderer) return renderer;
  renderer = new T.WebGLRenderer({ canvas, context: gl, antialias: false }); renderers.set(gl, renderer);
  canvas.addEventListener('webglcontextlost', () => { if (renderers.get(gl) === renderer) renderers.delete(gl); renderer.dispose(); });   // the old GL objects died with the context; the restored one gets a fresh renderer
  return renderer;
}
export function create(canvas, gl, onModelsReady) {
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw Error('WebGL2 float targets unavailable');
  const renderer = shared(canvas, gl);
  renderer.setClearColor(0x000000, 1); renderer.setRenderTarget(null); renderer.resetState();
  renderer.outputColorSpace = T.LinearSRGBColorSpace; renderer.toneMapping = T.NoToneMapping;
  let failure = '', target, objectTarget, beamRef, beamTexture, otherRef, otherTexture;
  renderer.debug.onShaderError = (g, program, vs, fs) => { failure = [g.getProgramInfoLog(program), g.getShaderInfoLog(vs), g.getShaderInfoLog(fs)].filter(Boolean).join(' '); console.error('GPU drive shader: ' + failure); };
  const u = {}, set = (k, v) => { if (u[k]) u[k].value = v; else u[k] = { value: v }; };
  for (const [k, v] of Object.entries({ otherBeam: null, otherLutInfo: new T.Vector4(), otherLutSize: new T.Vector2(), trafficDir: array(16, T.Vector2), trafficLamp: array(16, T.Vector3), nTraffic: 0, otherConvention: 0, pitch: 0, beam: null, materials: null, marks: null, lutInfo: new T.Vector4(), lutSize: new T.Vector2(), size: new T.Vector2(), eye: new T.Vector3(-2, 0.37, 1.2), lamp: array(2, T.Vector3), lampRGB: new T.Vector3(1, 1, 1), nLamp: 0, convention: 0, nMark: 0, nPart: 0, nLight: 0, nReflection: 0, nSkip: 0, nCross: 0, part: array(16, T.Vector4), partShape: array(16, T.Vector4), light: array(64, T.Vector4), reflection: array(64, T.Vector4), lightRGB: array(64, T.Vector3), reflectionRGB: array(64, T.Vector3), skip: array(16, T.Vector2), crossing: array(16, T.Vector4), tanH: 1, lane: 3.5, vergeWidth: 1.5, ambient: 0, sheen: 0, grain: 0, distance: 0, verge: new T.Vector2(), arc: new T.Vector2() })) set(k, v);
  const materialData = new Float32Array(D.MAT_KEYS.length * 4 * 4), markData = new Float32Array(128 * 4 * 2);
  const materialTexture = texture(materialData, D.MAT_KEYS.length, 4), markTexture = texture(markData, 128, 2);
  set('materials', materialTexture); set('marks', markTexture);
  const mat = new T.ShaderMaterial({ uniforms: u, vertexShader: vertex, fragmentShader: ground, depthTest: false, depthWrite: false });
  const scene = new T.Scene(), mesh = new T.Mesh(new T.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false; scene.add(mesh);
  const camera = new T.Camera(), objectView = objects(renderer, u, onModelsReady);
  function shading(material, enabled) {
    if (!material.userData.baseFragment) material.userData.baseFragment = material.fragmentShader;
    if (material.userData.p2 === enabled) return;
    material.fragmentShader = enabled ? withLighting(material.userData.baseFragment) : material.userData.baseFragment;
    material.userData.p2 = enabled; material.needsUpdate = true;
  }
  function update(p, world, dist) {
    const lut = p.lut, look = p.look, A = world.A || p.A;
    if (beamRef !== lut) { if (beamTexture) beamTexture.dispose(); beamRef = lut; beamTexture = texture(lut.data, lut.nh, lut.nv, T.RedFormat); set('beam', beamTexture); }
    u.lutInfo.value.set(lut.h0, lut.v0, lut.step, 0); u.lutSize.value.set(lut.nh, lut.nv); u.size.value.set(p.w, p.h);
    set('nLamp', p.lamps.length); if (p.lamps.length > 2) throw Error('more than two own lamps');
    p.lamps.forEach((l, i) => u.lamp.value[i].fromArray(l));
    set('convention', p.conv === 'B' ? 1 : p.conv === 'S' ? 2 : 0); set('tanH', Math.tan(p.hfov * Math.PI / 360));
    set('lane', p.lane); set('ambient', look.ambient || 0); set('sheen', look.wet && look.wetSheen ? 1 : 0);
    set('distance', dist); set('grain', look.grain && (p.src.tiles || (look.wet && look.wetSheen)) ? 0.4 * (look.wet ? 0.5 : 1) : 0);
    const vg = p.src.verge; set('vergeWidth', vg[1] || 1.5); u.verge.value.set(D.MAT_KEYS.indexOf(vg[0]), D.MAT_KEYS.indexOf(vg[2] || vg[0]));
    const materials = D.materials(look), width = D.MAT_KEYS.length;
    D.MAT_KEYS.forEach((k, i) => { const m = materials[k]; materialData.set(m.rho, i * 4); materialData.set(m.emit || [0, 0, 0], (3 * width + i) * 4); materialData.set(m.retro || [0, 0, 0], (width + i) * 4); materialData.set(m.gloss ? [m.gloss.a, m.gloss.F0, 0, 0] : [0, 0, 0, 0], (2 * width + i) * 4); }); materialTexture.needsUpdate = true;
    const marks = world.markings || p.src.markings.map(m => m.pat ? { ...m, pat: { ...m.pat, s0: m.pat.s0 - dist % m.pat.period, s1: m.pat.s1 - dist % m.pat.period } } : m);
    if (marks.length > 128) throw Error('too many ground markings'); set('nMark', marks.length);
    const skips = marks.find(m => m.skip)?.skip || []; if (skips.length > 16) throw Error('too many marking openings'); set('nSkip', skips.length); skips.forEach((q, i) => u.skip.value[i].fromArray(q));
    marks.forEach((m, i) => { markData.set([m.o0, m.o1, D.MAT_KEYS.indexOf(m.mat), m.skip ? 1 : 0], 4 * i); const pat = m.pat; markData.set(pat ? [pat.s0, pat.s1, pat.period, pat.on] : [0, 0, 0, 0], 4 * (128 + i)); }); markTexture.needsUpdate = true;
    const crossings = world.crossings || []; if (crossings.length > 16) throw Error('too many crossings'); set('nCross', crossings.length); crossings.forEach((c, i) => u.crossing.value[i].set(c.s0, c.s1, c.o0, c.o1));
    set('nPart', 0); u.arc.value.set(A && A.R || 0, A && A.sg || 0);
    if (A && A.tiles) {
      const parts = [];
      for (const tile of A.tiles) for (const [offset, len, c] of tile.curvature ? [[0, 50, 0], [50, 100, tile.curvature], [150, 50, 0]] : [[0, 200, 0]]) {
        const s = tile.s0 + offset - dist, q = A.at(s); parts.push({ s, len, c, q });
      }
      if (parts.length > 16) throw Error('too many route parts'); set('nPart', parts.length);
      parts.forEach(({ s, len, c, q }, i) => { u.part.value[i].set(q.p[0], q.p[1], Math.atan2(q.t[1], q.t[0]), c); u.partShape.value[i].set(s, len, 0, 0); });
    }
    set('pitch', p.pitch || 0);
    const traffic = p.trafficBeams ? D.trafficSources(world.objects) : []; set('nTraffic', traffic.length);
    if (traffic.length) {
      const b = D.trafficBeam(p), L = b.lut;
      if (otherRef !== L) { if (otherTexture) otherTexture.dispose(); otherRef = L; otherTexture = texture(L.data, L.nh, L.nv, T.RedFormat); set('otherBeam', otherTexture); }
      u.otherLutInfo.value.set(L.h0, L.v0, L.step, 0); u.otherLutSize.value.set(L.nh, L.nv); set('otherConvention', b.conv === 'B' ? 1 : b.conv === 'S' ? 2 : 0);
      traffic.forEach((q, i) => { u.trafficLamp.value[i].set(q.x, q.y, q.z); u.trafficDir.value[i].set(q.nx, q.ny); });
    }
    const lights = world.lights || [], reflections = D.reflectionSources(world.objects, { ...p, pointLights: lights }).concat(lights);
    for (const [name, values] of [['light', lights], ['reflection', reflections]]) { if (values.length > 64) throw Error('too many ' + name + ' sources'); set(name === 'light' ? 'nLight' : 'nReflection', values.length); values.forEach((q, i) => { u[name].value[i].set(q.x, q.y, q.z, q.cd); u[name + 'RGB'].value[i].fromArray(q.rgb); }); }
  }
  return {
    version: T.REVISION,
    render(p, world, dist, destination, objectDestination, ss = 1) {
      update(p, world, dist);
      const extras = !!(p.trafficBeams || p.lampPitch || p.pitch); shading(mat, extras);
      renderer.resetState();
      if (!target || target.width !== p.w || target.height !== p.h) { if (target) target.dispose(); target = new T.WebGLRenderTarget(p.w, p.h, { type: T.HalfFloatType, depthBuffer: false, minFilter: T.NearestFilter, magFilter: T.NearestFilter }); }
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      if (failure) throw Error(failure);
      // CPU textures use row zero = top; three's target uses row zero = bottom.
      const source = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
      gl.blitFramebuffer(0, 0, p.w, p.h, 0, p.h, p.w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      if (objectDestination) {
        if (!objectTarget || objectTarget.width !== p.w * ss || objectTarget.height !== p.h * ss) { if (objectTarget) objectTarget.dispose(); objectTarget = new T.WebGLRenderTarget(p.w * ss, p.h * ss, { type: T.FloatType, depthTexture: new T.DepthTexture(p.w * ss, p.h * ss, T.FloatType), depthBuffer: true, minFilter: T.NearestFilter, magFilter: T.NearestFilter }); }
        objectView.update(p, world.objects, ss); objectView.scene.traverse(ob => { if (ob.material) shading(ob.material, extras); }); objectView.mask(false); renderer.setRenderTarget(objectTarget); renderer.setClearColor(0, 0); renderer.render(objectView.scene, objectView.camera);
        if (failure) throw Error(failure);
        const src = gl.getParameter(gl.FRAMEBUFFER_BINDING); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, objectDestination);
        gl.blitFramebuffer(0, 0, p.w * ss, p.h * ss, 0, p.h, p.w, 0, gl.COLOR_BUFFER_BIT, ss > 1 ? gl.LINEAR : gl.NEAREST);
      }
      renderer.setRenderTarget(null); renderer.resetState();
    },
    masks(p, ss, debug = false) {
      renderer.resetState(); objectView.mask(debug ? 2 : true); renderer.setRenderTarget(objectTarget); renderer.render(objectView.scene, objectView.camera);
      const width = p.w * ss, height = p.h * ss, pixels = new Float32Array(width * height * 4), mask = new Uint8Array(p.w * p.h), eyes = new Uint8Array(p.w * p.h);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, pixels); pixels.depthBits = gl.getParameter(gl.DEPTH_BITS);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const q = Math.floor((height - 1 - y) / ss) * p.w + Math.floor(x / ss), k = 4 * (y * width + x); mask[q] |= Math.round(pixels[k]); eyes[q] |= Math.round(pixels[k + 1]); }
      objectView.mask(false); renderer.setRenderTarget(null); renderer.resetState();
      if (debug) return pixels;
      return { mask, body: mask.map((b, i) => b & ~eyes[i]) };
    },
    modelState() { return { ...objectView.prototype, ...objectView.models.state, memory:{...renderer.info.memory} }; },
    objectWork(p, ss=1) {
      renderer.resetState();objectView.mask(3);renderer.setRenderTarget(objectTarget);renderer.render(objectView.scene,objectView.camera);
      const pixels=new Float32Array(p.w*p.h*ss*ss*4);gl.readPixels(0,0,p.w*ss,p.h*ss,gl.RGBA,gl.FLOAT,pixels);
      let steps=0,proxyPixels=0,hits=0,maxSteps=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]===1){steps+=pixels[i];proxyPixels++;hits+=pixels[i+1];maxSteps=Math.max(maxSteps,pixels[i]);}
      objectView.mask(false);renderer.setRenderTarget(null);renderer.resetState();return {steps,proxyPixels,hits,maxSteps,stepsPerProxyPixel:proxyPixels?steps/proxyPixels:0,totalStepsPerHitIncludingMisses: hits?steps/hits:0};
    },
    async timeObjects(repeats=8) {
      const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return {gpuMs:null,reason:'timer extension unavailable'};
      if(gl.getQuery(ext.TIME_ELAPSED_EXT,gl.CURRENT_QUERY))return {gpuMs:null,reason:'another timer is active'};
      const query=gl.createQuery();renderer.resetState();objectView.mask(false);renderer.setRenderTarget(objectTarget);
      gl.beginQuery(ext.TIME_ELAPSED_EXT,query);for(let i=0;i<repeats;i++)renderer.render(objectView.scene,objectView.camera);gl.endQuery(ext.TIME_ELAPSED_EXT);
      renderer.setRenderTarget(null);renderer.resetState();gl.flush();
      for(let i=0;i<200;i++){await new Promise(r=>setTimeout(r,10));if(gl.getParameter(ext.GPU_DISJOINT_EXT)){gl.deleteQuery(query);return {gpuMs:null,reason:'disjoint GPU timer'};}
        if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){const gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6/repeats;gl.deleteQuery(query);return {gpuMs,repeats};}}
      gl.deleteQuery(query);return {gpuMs:null,reason:'timer timeout'};
    },
    dispose() { renderer.setRenderTarget(null); renderer.debug.onShaderError = null; objectView.dispose(); if (objectTarget) objectTarget.dispose(); if (target) target.dispose(); if (beamTexture) beamTexture.dispose(); if (otherTexture) otherTexture.dispose(); materialTexture.dispose(); markTexture.dispose(); mat.dispose(); mesh.geometry.dispose(); renderer.resetState(); },       // the renderer itself stays with the GL context (see shared)
  };
}
