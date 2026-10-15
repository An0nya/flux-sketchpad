/* render-gl.js — optional WebGL2 renderer for the Scene and Optics views (Simulation → Advanced → "WebGL scene view", per browser, off by default).
 *
 * A WebGL2 canvas sits UNDER the existing 2D canvas (same box). It draws what is expensive: the facet meshes (fills + edges), the target plane with the heat
 * map as a texture, the ray paths, and the raw ray hits as point sprites. The 2D canvas on top stays the overlay for everything small: source, handles,
 * gizmo, labels, selection outlines, dashed paths, the envelope. Camera maths is RF.Render.Camera.project() reproduced in the vertex shader (same clamp at
 * the eye), so picking, handles and fitting (all CPU, all on that camera) still agree with the pixels. No libraries; Canvas 2D stays the fallback
 * whenever WebGL2 is missing, the context is lost, or a draw throws (RF.RenderGL.failure() says why).
 * Painter's order as in the 2D path: facets (and the target plane) sorted by view depth every frame, alpha-blended; edges, rays and hits on top.   */
(function (root) {
  'use strict';
  const RF = root.RF, KEY = 'flux/glScene';
  const pref = () => { try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const setPref = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } };
  let failed = null;                                  // first reason the GL path gave up (then everything falls back to Canvas 2D until reload)
  const R = new Map();                                // 2D canvas element → renderer
  const stats = { frames: 0, lastMs: 0 };

  // ---------------------------------------------------------------- shaders
  // proj(): the exact Camera.project — css px from the canvas centre, plus the perspective scale wn = 1/k (1 for orthographic)
  const PROJ = `
uniform vec3 uRx, uRy, uRz, uC; uniform vec2 uPan, uSize; uniform float uScale, uD;
vec3 proj(vec3 p, out float z) {
  vec3 d = p - uC; float x = dot(uRx, d), y = dot(uRy, d); z = dot(uRz, d);
  float wn = uD > 0.0 ? max((uD - z) / uD, 0.05) : 1.0;
  return vec3(uPan.x + uScale * x / wn, uPan.y - uScale * y / wn, wn);
}
vec2 ndc(vec2 s) { return vec2(s.x / (uSize.x * 0.5), -s.y / (uSize.y * 0.5)); }`;
  const VS_FACET = `#version 300 es
${PROJ}
uniform vec3 uLight;
in vec3 aPos; in vec3 aN; in vec4 aFill; in vec2 aLam;
out vec4 vCol;
void main() {
  float z; vec3 s = proj(aPos, z);
  gl_Position = vec4(ndc(s.xy) * s.z, 0.0, s.z);
  float lam = 0.35 + 0.65 * abs(dot(aN, uLight));
  vCol = vec4(aFill.rgb * (aLam.x + aLam.y * lam), aFill.a);
}`;
  const FS_COL = `#version 300 es
precision highp float; in vec4 vCol; out vec4 o;
void main() { o = vec4(vCol.rgb * vCol.a, vCol.a); }`;
  // instanced line segments as screen-space quads: width in css px (kept >= 1 device px, thin ones fade like the 2D hairlines)
  const VS_LINE = `#version 300 es
${PROJ}
uniform float uDpr;
in vec3 aA; in vec3 aB; in float aW; in vec4 aCol;
out vec4 vCol;
void main() {
  float za, zb; vec3 a = proj(aA, za), b = proj(aB, zb);
  vec2 dir = b.xy - a.xy; float len = length(dir); dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  float end = float(gl_VertexID >> 1), side = float(gl_VertexID & 1) * 2.0 - 1.0;
  float wpx = max(aW, 1.0 / uDpr);
  vec2 p = mix(a.xy, b.xy, end) + vec2(-dir.y, dir.x) * side * wpx * 0.5 + dir * (end * 2.0 - 1.0) * 0.5 * min(wpx, 1.0);
  gl_Position = vec4(ndc(p), 0.0, 1.0);
  vCol = vec4(aCol.rgb, aCol.a * min(1.0, aW * uDpr));
}`;
  const VS_PLANE = `#version 300 es
${PROJ}
uniform vec3 uTC, uTu, uTv; uniform float uHalf;
in vec2 aUV;                                          // texture coordinate: u right, v down (image rows); world u = (2t-1)·half, v = (1-2t')·half
out vec2 vUV; out float vZ;
void main() {
  vec3 p = uTC + uTu * ((2.0 * aUV.x - 1.0) * uHalf) + uTv * ((1.0 - 2.0 * aUV.y) * uHalf);
  float z; vec3 s = proj(p, z);
  vUV = aUV; vZ = z;
  gl_Position = vec4(ndc(s.xy) * s.z, 0.0, s.z);
}`;
  const FS_PLANE = `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec4 uFlat; uniform float uUseTex, uD;
in vec2 vUV; in float vZ; out vec4 o;
void main() {
  if (uD > 0.0 && vZ > 0.95 * uD) discard;             // beyond the near plane (the 2D path clips the plane there)
  vec4 c = uUseTex > 0.5 ? vec4(texture(uTex, vUV).rgb, 1.0) : uFlat;
  o = vec4(c.rgb * c.a, c.a);
}`;
  const VS_HIT = `#version 300 es
${PROJ}
uniform vec3 uTC, uTu, uTv; uniform float uPt;
in vec2 aUV; in float aB;
out float vB;
void main() {
  float z; vec3 s = proj(uTC + uTu * aUV.x + uTv * aUV.y, z);
  gl_Position = vec4(ndc(s.xy), 0.0, 1.0); gl_PointSize = uPt; vB = aB;
}`;
  const FS_HIT = `#version 300 es
precision highp float; uniform vec3 uPal[4]; uniform float uAlpha; in float vB; out vec4 o;
void main() {
  vec2 q = gl_PointCoord - 0.5; if (dot(q, q) > 0.25) discard;
  o = vec4(uPal[int(min(vB, 3.0))] * uAlpha, uAlpha);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram(); gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(p, i), name = a.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, a.name); }
    return { p, u, a: (name) => gl.getAttribLocation(p, name) };
  }

  // ---------------------------------------------------------------- one renderer per 2D canvas
  function make(cv2d) {
    const canvas = document.createElement('canvas');
    canvas.className = 'gl-under'; canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:0';
    cv2d.parentNode.insertBefore(canvas, cv2d);
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) { canvas.remove(); throw new Error('no WebGL2'); }
    const r = { cv2d, canvas, gl, lost: false, prog: {}, buf: {}, key: {}, tex: null, texSrc: null, texVer: -1, lut: null, lutName: null };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); r.lost = true; fail('WebGL context lost'); });
    r.prog.facet = program(gl, VS_FACET, FS_COL); r.prog.line = program(gl, VS_LINE, FS_COL); r.prog.plane = program(gl, VS_PLANE, FS_PLANE); r.prog.hit = program(gl, VS_HIT, FS_HIT);
    const mk = (n) => (r.buf[n] = gl.createBuffer());
    ['facetV', 'facetI', 'edge', 'ray', 'planeUV', 'planeI', 'hitUV', 'hitB', 'quad'].forEach(mk);
    // plane: 24×24 cells (the vertex positions are clamped at the eye like the 2D squash, so a grazing plane stays tidy)
    const N = 24, uv = new Float32Array((N + 1) * (N + 1) * 2), ix = new Uint16Array(N * N * 6);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const o = 2 * (j * (N + 1) + i); uv[o] = i / N; uv[o + 1] = j / N; }
    let q = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; ix.set([a, b, d, a, d, c], q); q += 6; }
    gl.bindBuffer(gl.ARRAY_BUFFER, r.buf.planeUV); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.buf.planeI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);
    r.planeN = ix.length;
    r.tex = gl.createTexture();
    return r;
  }
  function fail(why) { if (!failed) { failed = why; try { console.warn('WebGL scene view off, back to Canvas 2D:', why); } catch (e) { /* ignore */ } } }
  function get(cv) {
    if (failed) return null;
    let r = R.get(cv);
    if (!r) { try { r = make(cv); R.set(cv, r); } catch (e) { fail(String(e && e.message || e)); return null; } }
    return r;
  }
  const supported = () => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } };
  const on = () => pref() && !failed;
  function release(cv) { const r = R.get(cv); if (r) r.canvas.style.display = 'none'; }    // GL view switched off: hide the (stale) underlay

  // ---------------------------------------------------------------- scene data
  const E3 = (a) => [a[0], a[1], a[2]];
  function uploadF(gl, target, buf, data, usage) { gl.bindBuffer(target, buf); gl.bufferData(target, data, usage || gl.DYNAMIC_DRAW); }

  // facet meshes: positions + normals are static per model; fill / edge style per selection state
  function facets(r, model, opts, kind) {
    const gl = r.gl, polys = model.polys, K = r.key;
    if (K.model !== model) {
      let nv = 0, ni = 0, ne = 0;
      for (const p of polys) { nv += p.pts.length; ni += 3 * Math.max(0, p.pts.length - 2); ne += p.pts.length; }
      const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx = new Uint32Array(ni), first = new Uint32Array(polys.length), edges = new Float32Array(ne * 6);
      let v = 0, e = 0;
      polys.forEach((p, k) => {
        first[k] = v; const n = p.pts.length;
        for (let i = 0; i < n; i++) { pos.set(p.pts[i], 3 * (v + i)); nrm.set(p.n, 3 * (v + i)); const q = p.pts[(i + 1) % n]; edges.set(p.pts[i], 6 * (e + i)); edges.set(q, 6 * (e + i) + 3); }
        v += n; e += n;
      });
      K.model = model; K.pos = pos; K.nrm = nrm; K.first = first; K.idxBuf = idx; K.nv = nv; K.edgePos = edges; K.ne = ne; K.styleKey = null;
      uploadF(gl, gl.ARRAY_BUFFER, r.buf.facetV, new Float32Array(0), gl.STATIC_DRAW);
    }
    // style: rebuilt when the selection / highlight / view style changes (the Map is a fresh object per redraw, so compare contents cheaply)
    const sk = kind + '|' + (opts.style || '') + '|' + (opts.highlight || '') + '|' + (opts.sel ? [...opts.sel].join(',') : '-') + '|' + (opts.selSecondary ? opts.selSecondary.join(',') : '-');
    if (K.styleKey !== sk) {
      K.styleKey = sk;
      const st = new Float32Array(K.nv * 6), edgeData = new ArrayBuffer(K.ne * 32), ef = new Float32Array(edgeData), eb = new Uint8Array(edgeData);
      let v = 0, e = 0;
      polys.forEach((p) => {
        const s = RF.Render.glStyle(opts, p, kind), n = p.pts.length;
        for (let i = 0; i < n; i++) { const o = 6 * (v + i); st[o] = s.fill[0] / 255; st[o + 1] = s.fill[1] / 255; st[o + 2] = s.fill[2] / 255; st[o + 3] = s.fill[3]; st[o + 4] = s.lam[0]; st[o + 5] = s.lam[1]; }
        for (let i = 0; i < n; i++) {
          const o = 8 * (e + i), src = 6 * (e + i);
          for (let c = 0; c < 6; c++) ef[o + c] = K.edgePos[src + c];
          ef[o + 6] = s.w; eb[4 * (o + 7)] = s.edge[0]; eb[4 * (o + 7) + 1] = s.edge[1]; eb[4 * (o + 7) + 2] = s.edge[2]; eb[4 * (o + 7) + 3] = Math.round(255 * s.edge[3]);
        }
        v += n; e += n;
      });
      // interleave pos(3) + normal(3) + style(6) = 12 floats per vertex
      const ib = new Float32Array(K.nv * 12);
      for (let i = 0; i < K.nv; i++) { ib.set(K.pos.subarray(3 * i, 3 * i + 3), 12 * i); ib.set(K.nrm.subarray(3 * i, 3 * i + 3), 12 * i + 3); ib.set(st.subarray(6 * i, 6 * i + 6), 12 * i + 6); }
      uploadF(gl, gl.ARRAY_BUFFER, r.buf.facetV, ib, gl.DYNAMIC_DRAW);
      uploadF(gl, gl.ARRAY_BUFFER, r.buf.edge, edgeData, gl.DYNAMIC_DRAW);
    }
  }

  function setCam(gl, P, cam, box) {
    const R3 = cam.R, u = P.u;
    gl.uniform3fv(u.uRx, R3[0]); gl.uniform3fv(u.uRy, R3[1]); gl.uniform3fv(u.uRz, R3[2]); gl.uniform3fv(u.uC, cam.center);
    gl.uniform2f(u.uPan, cam.pan[0], cam.pan[1]); gl.uniform2f(u.uSize, cam.w, cam.h);   // css px from the canvas centre, as project() less its w/2, h/2
    gl.uniform1f(u.uScale, cam.scale); gl.uniform1f(u.uD, isFinite(cam.focal) ? cam.eyeDist() : 0);
  }

  // ---------------------------------------------------------------- draw
  // kind: 'scene' | 'optics'.  Returns true when it drew (the caller then skips its own facet / plane / ray drawing).
  function draw(cv, cam, opts, box, kind) {
    const r = get(cv); if (!r) return false;
    const t0 = performance.now(), gl = r.gl, canvas = r.canvas;
    try {
      if (r.lost || gl.isContextLost()) { fail('WebGL context lost'); return false; }
      const dpr = box.dpr;
      canvas.style.left = cv.offsetLeft + 'px'; canvas.style.top = cv.offsetTop + 'px'; canvas.style.width = cv.offsetWidth + 'px'; canvas.style.height = cv.offsetHeight + 'px'; canvas.style.display = 'block';
      if (canvas.width !== cv.width || canvas.height !== cv.height) { canvas.width = cv.width; canvas.height = cv.height; }
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const model = opts.model, polys = model.polys, R3 = cam.R;
      const light = kind === 'scene' ? RF.V.norm(RF.V.add(RF.V.add(R3[2], RF.V.mul(R3[1], 0.6)), RF.V.mul(R3[0], -0.3))) : RF.V.norm(RF.V.add(R3[2], RF.V.mul(R3[1], 0.6)));
      facets(r, model, opts, kind);
      const K = r.key;
      // ---- depth order (far first): polys by their vertex-mean view depth; the target plane joins the list in the scene
      const D = isFinite(cam.focal) ? cam.eyeDist() : 0;
      const zs = new Float64Array(polys.length + 1), ord = new Array(polys.length + 1);
      const c0 = cam.center, rz = R3[2];
      for (let i = 0; i < polys.length; i++) { const c = polys[i].c; zs[i] = rz[0] * (c[0] - c0[0]) + rz[1] * (c[1] - c0[1]) + rz[2] * (c[2] - c0[2]); ord[i] = i; }
      let T = null, planeIdx = -1, heat = opts.heatCanvas;
      if (kind === 'scene') {
        T = RF.Engine.targetFrame(opts.scene.target); planeIdx = polys.length;
        const tc = T.C; zs[planeIdx] = rz[0] * (tc[0] - c0[0]) + rz[1] * (tc[1] - c0[1]) + rz[2] * (tc[2] - c0[2]); ord[planeIdx] = planeIdx;
      }
      const nOrd = kind === 'scene' ? polys.length + 1 : polys.length;
      ord.length = nOrd; ord.sort((a, b) => zs[a] - zs[b]);
      // index buffer in that order (fills that have alpha 0 — Optics "pairs" — are skipped)
      const needIdx = K.idxScratch && K.idxScratch.length >= 3 * K.nv ? K.idxScratch : (K.idxScratch = new Uint32Array(3 * K.nv));
      const runs = [];                                   // [start, count] triangle ranges, with the plane (-1) between them
      let q = 0, runStart = 0;
      const styleAlpha = opts.style === 'pairs' && kind === 'optics';
      if (!styleAlpha) for (const k of ord) {
        if (k === planeIdx) { if (q > runStart) runs.push([runStart, q - runStart]); runs.push(-1); runStart = q; continue; }
        const n = polys[k].pts.length, f = K.first[k];
        for (let i = 1; i + 1 < n; i++) { needIdx[q++] = f; needIdx[q++] = f + i; needIdx[q++] = f + i + 1; }
      }
      if (q > runStart) runs.push([runStart, q - runStart]);
      const fp = r.prog.facet; gl.useProgram(fp.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, r.buf.facetV);
      const stride = 48; for (const [nm, size, off] of [['aPos', 3, 0], ['aN', 3, 12], ['aFill', 4, 24], ['aLam', 2, 40]]) { const l = fp.a(nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off); gl.vertexAttribDivisor(l, 0); }
      uploadF(gl, gl.ELEMENT_ARRAY_BUFFER, r.buf.facetI, needIdx.subarray(0, q), gl.DYNAMIC_DRAW);
      setCam(gl, fp, cam, box); gl.uniform3fv(fp.u.uLight, light);
      const drawPlane = () => {
        const pp = r.prog.plane; gl.useProgram(pp.p); setCam(gl, pp, cam, box);
        gl.uniform3fv(pp.u.uTC, T.C); gl.uniform3fv(pp.u.uTu, T.tu); gl.uniform3fv(pp.u.uTv, T.tv); gl.uniform1f(pp.u.uHalf, T.half);
        const facing = RF.V.dot(T.n, R3[2]) > 0, useTex = facing && heat && heat.width && !opts.hits;
        if (useTex) {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, r.tex);
          const ver = heat._glv === undefined ? NaN : heat._glv;
          if (r.texSrc !== heat || r.texVer !== ver || ver !== ver || r.texW !== heat.width) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, heat);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            r.texSrc = heat; r.texVer = ver; r.texW = heat.width; r.uploads = (r.uploads || 0) + 1;
          }
          gl.uniform1i(pp.u.uTex, 0);
        }
        gl.uniform1f(pp.u.uUseTex, useTex ? 1 : 0); gl.uniform4f(pp.u.uFlat, 60 / 255, 66 / 255, 78 / 255, 0.55);
        const l = pp.a('aUV'); gl.bindBuffer(gl.ARRAY_BUFFER, r.buf.planeUV); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(l, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.buf.planeI); gl.drawElements(gl.TRIANGLES, r.planeN, gl.UNSIGNED_SHORT, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.buf.facetI); gl.useProgram(fp.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, r.buf.facetV);
        for (const [nm, size, off] of [['aPos', 3, 0], ['aN', 3, 12], ['aFill', 4, 24], ['aLam', 2, 40]]) { const l2 = fp.a(nm); gl.enableVertexAttribArray(l2); gl.vertexAttribPointer(l2, size, gl.FLOAT, false, stride, off); }
      };
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.buf.facetI);
      for (const run of runs) { if (run === -1) drawPlane(); else gl.drawElements(gl.TRIANGLES, run[1], gl.UNSIGNED_INT, 4 * run[0]); }
      if (kind === 'scene' && !runs.includes(-1)) drawPlane();
      // ---- instanced lines: facet edges, then ray paths
      const lp = r.prog.line; gl.useProgram(lp.p); setCam(gl, lp, cam, box); gl.uniform1f(lp.u.uDpr, dpr);
      const lines = (buf, n) => {
        if (!n) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        for (const [nm, size, type, norm, off] of [['aA', 3, gl.FLOAT, false, 0], ['aB', 3, gl.FLOAT, false, 12], ['aW', 1, gl.FLOAT, false, 24], ['aCol', 4, gl.UNSIGNED_BYTE, true, 28]]) { const l = lp.a(nm); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, type, norm, 32, off); gl.vertexAttribDivisor(l, 1); }
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      };
      lines(r.buf.edge, K.ne);
      let nRay = 0;
      if (kind === 'scene' && opts.showRays && opts.paths) nRay = rays(r, opts.paths);
      lines(r.buf.ray, nRay);
      r.nRay = nRay;
      for (const nm of ['aA', 'aB', 'aW', 'aCol']) gl.vertexAttribDivisor(lp.a(nm), 0);
      // ---- hits as point sprites on the target plane
      r.nHit = 0;
      if (kind === 'scene' && opts.hits) r.nHit = hits(r, opts.hits, T, cam, box, dpr);
      stats.frames++; stats.lastMs = performance.now() - t0;
      return true;
    } catch (e) { fail(String(e && e.message || e)); canvas.style.display = 'none'; return false; }
  }

  // ray paths → line instances (cached on the path list + its length + total points: a growing trace updates it, an orbit doesn't)
  const RAY_COL = { target: [244, 193, 124, 0.38], direct: [143, 184, 255, 0.35], escape: [170, 170, 180, 0.16], other: [255, 154, 61, 0.35] };
  function rays(r, paths) {
    const gl = r.gl, K = r.key;
    let pts = 0, n = paths.length; for (let i = 0; i < n; i++) pts += paths[i].length;
    if (K.rayPaths !== paths || K.rayN !== n || K.rayPts !== pts) {
      K.rayPaths = paths; K.rayN = n; K.rayPts = pts;
      let segs = 0; for (const p of paths) if (!p.ghost && !p.sel) segs += Math.max(0, p.length / 3 - 1);
      const buf = new ArrayBuffer(segs * 32), f = new Float32Array(buf), b = new Uint8Array(buf);
      let s = 0;
      for (const p of paths) {
        if (p.ghost || p.sel) continue;                  // dashed ones stay on the 2D overlay
        const c = RAY_COL[p.end] || RAY_COL.other;
        for (let i = 0; i + 5 < p.length; i += 3) {
          const o = 8 * s++;
          f[o] = p[i]; f[o + 1] = p[i + 1]; f[o + 2] = p[i + 2]; f[o + 3] = p[i + 3]; f[o + 4] = p[i + 4]; f[o + 5] = p[i + 5]; f[o + 6] = 1;
          b[4 * (o + 7)] = c[0]; b[4 * (o + 7) + 1] = c[1]; b[4 * (o + 7) + 2] = c[2]; b[4 * (o + 7) + 3] = Math.round(255 * c[3]);
        }
      }
      K.raySegs = s; uploadF(gl, gl.ARRAY_BUFFER, r.buf.ray, buf, gl.DYNAMIC_DRAW);
    }
    return K.raySegs;
  }

  // hits: { n, uv: Float32Array (u,v,E ×3 per hit — the engine's ctx.hits layout), b: Uint8Array bounces, key } → points on the target plane
  const PAL = [143 / 255, 184 / 255, 255 / 255, 244 / 255, 193 / 255, 124 / 255, 136 / 255, 215 / 255, 212 / 255, 183 / 255, 166 / 255, 239 / 255];
  function hits(r, H, T, cam, box, dpr) {
    const gl = r.gl, K = r.key;
    if (K.hitKey !== H.key || K.hitN !== H.n) {
      K.hitKey = H.key; K.hitN = H.n;
      const n = H.n, uv = new Float32Array(2 * n);
      for (let i = 0; i < n; i++) { uv[2 * i] = H.uv[3 * i]; uv[2 * i + 1] = H.uv[3 * i + 1]; }
      uploadF(gl, gl.ARRAY_BUFFER, r.buf.hitUV, uv, gl.STATIC_DRAW);
      uploadF(gl, gl.ARRAY_BUFFER, r.buf.hitB, H.b.subarray(0, n), gl.STATIC_DRAW);
      r.hitUploads = (r.hitUploads || 0) + 1;
    }
    const hp = r.prog.hit; gl.useProgram(hp.p); setCam(gl, hp, cam, box);
    gl.uniform3fv(hp.u.uTC, T.C); gl.uniform3fv(hp.u.uTu, T.tu); gl.uniform3fv(hp.u.uTv, T.tv);
    gl.uniform1f(hp.u.uPt, Math.max(2, 1.6 * dpr)); gl.uniform1f(hp.u.uAlpha, H.alpha || 0.6); gl.uniform3fv(hp.u.uPal, PAL);
    const a = hp.a('aUV'), bB = hp.a('aB');
    gl.bindBuffer(gl.ARRAY_BUFFER, r.buf.hitUV); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(a, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.buf.hitB); gl.enableVertexAttribArray(bB); gl.vertexAttribPointer(bB, 1, gl.UNSIGNED_BYTE, false, 0, 0); gl.vertexAttribDivisor(bB, 0);
    gl.drawArrays(gl.POINTS, 0, H.n);
    return H.n;
  }

  // force the GPU to finish this canvas's frame (benchmarks): a 1-px readback
  function sync(cv) { const r = R.get(cv); if (!r || r.canvas.style.display === 'none') return false; const px = new Uint8Array(4); r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px); return true; }
  const info = (cv) => { const r = R.get(cv); return r ? { nRay: r.nRay, nHit: r.nHit, uploads: r.uploads || 0, hitUploads: r.hitUploads || 0, canvas: r.canvas } : null; };

  RF.RenderGL = { on, pref, setPref, supported, failure: () => failed, scene: (cv, cam, opts, box) => draw(cv, cam, opts, box, 'scene'), optics: (cv, cam, opts, box) => draw(cv, cam, opts, box, 'optics'), release, sync, info, stats, _resetFailure() { failed = null; } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
