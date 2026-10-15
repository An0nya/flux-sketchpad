/* drive-anim.js — the animated Drive view: the car drives down the road, the scenery comes at it. Opt-in; the still view (drive.js) stays the default.
 *
 * No new photometric model. Everything the picture is made of still comes from RF.Drive.render (the beam lookup, the BRDFs, the materials):
 *   ground   The car-frame geometry of the road never changes while the car drives (a straight road, or the constant-radius bends of RF.Road.arc), so the lit
 *            ground is rendered ONCE (drive.js, no objects). Only the phase of patterned markings (the EU centre dashes) moves: that stripe is a second
 *            render (the dash drawn solid minus the dash left out) that the compose shader fades by the stripe's coverage at s + dist, exactly as covLon does.
 *   objects  Posts, signs, people, deer, trees, bushes, crates are placed relative to the car every frame (the scenery repeats every PERIOD metres) and
 *            traced by RF.Drive.render in its `layer: 'objects'` mode: only the pixels they can touch, written as (luminance·coverage, coverage).
 *   GPU      compose (objects over ground + dash) → glare (separable box blurs, the radii and weights of Drive.tonemap) → ACES + sRGB → the canvas.
 * Frame = objects·(coverage) + (1 − coverage)·(ground + stripe·dash), then the same tone map. composeCPU() is that sum in plain JS (tests, parity).
 * The ground and the objects are rendered at the "sim" size (the canvas, 640..1600 px wide); the canvas itself is css px × devicePixelRatio (≤ 2).
 *
 * Road frame as drive.js: x ahead of the lamps, y left, z up. The scenery is built on a straight road in (s, off) = (x, y); on a bend each piece is moved to
 * A.at(s − dist, off) and turned with the tangent (ellipsoids keep their axes, as in the still view).                                                       */
(function (root) {
  'use strict';
  const RF = root.RF || (root.RF = {}), D = RF.Drive;
  const PERIOD = 300, EYE = [-2.0, 0.37, 1.2], MIN_SIM = 640, MAX_SIM = 1600, ANIM_SCENES = { road: 1 };
  const CLASSES = [['posts', 'posts', 'Delineator posts with reflectors'], ['signs', 'signs', 'Road signs (retroreflective sheeting)'], ['people', 'people', 'Pedestrians'], ['animals', 'deer', 'Deer, with retroreflecting eyes'], ['veg', 'trees', 'Trees and bushes at the roadside'], ['obstacle', 'crates', 'A dark crate on the road every 150 m (the hard target: 3 % reflectance, nothing retroreflective)']];

  // ---------------------------------------------------------------- CPU: scenery, ground, composition (pure; tests use these)
  // the scenery on a straight road, in (s, off) coordinates
  function source(name, lane, us, flags) {
    const sc = D.buildScene(name, { Lw: lane, A: null, us, seed: 7 }, flags);
    return { objects: sc.objects, markings: sc.markings, verge: sc.verge };
  }
  // the objects as the car at distance `dist` sees them (car frame). Every object appears once, at s ∈ [dist − 6, dist − 6 + PERIOD); A: RF.Road.arc or null
  function place(src, dist, A) {
    const out = [];
    for (const ob of src.objects) {
      const rel = ob.x - dist - Math.floor((ob.x - dist + 6) / PERIOD) * PERIOD, n = Object.assign({}, ob);
      n.bs = undefined;
      if (A) {
        const q = A.at(rel, ob.y), psi = Math.atan2(q.t[1], q.t[0]), c = Math.cos(psi), sn = Math.sin(psi);
        n.x = q.p[0]; n.y = q.p[1];
        if (ob.k === 'box') n.yaw = (ob.yaw || 0) + psi;
        else if (ob.k === 'disc') { n.nx = ob.nx * c - ob.ny * sn; n.ny = ob.nx * sn + ob.ny * c; }
      } else n.x = rel;
      out.push(n);
    }
    return out;
  }
  const camOf = (p) => ({ w: p.w, h: p.h, hfov: p.hfov, eye: EYE, lamps: p.lamps, lut: p.lut, conv: p.conv, arc: p.A, lane: p.lane, look: p.look });
  // the lit ground: A = everything that does not move; B = what the patterned stripe adds where it is on (null: nothing patterned)
  function ground(p) {
    const pat = p.src.markings.find((m) => m.pat), stat = p.src.markings.filter((m) => m !== pat), cam = camOf(p), t0 = Date.now();
    const A = D.render(Object.assign({ ss: 1, scene: { objects: [], markings: stat, verge: p.src.verge } }, cam)).rgb;
    let B = null;
    if (pat) { const S = D.render(Object.assign({ ss: 1, scene: { objects: [], markings: stat.concat([Object.assign({}, pat, { pat: null })]), verge: p.src.verge } }, cam)).rgb; B = new Float32Array(S.length); for (let i = 0; i < S.length; i++) B[i] = S[i] - A[i]; }
    return { A, B, pat: pat ? pat.pat : null, ms: Date.now() - t0 };
  }
  // the objects at `dist`, rendered into rgba (4·w·h, cleared by the caller where it was written last); → rows [y0, y1) touched
  function objects(p, dist, rgba, ss) {
    const r = D.render(Object.assign({ ss: ss || 2, layer: 'objects', tight: true, rgba, scene: { objects: place(p.src, dist, p.A), markings: [], verge: p.src.verge } }, camOf(p)));
    return r.rows;
  }
  // coverage of a pixel's footprint [s − h, s + h] by the stripe pattern at s + dist (drive.js covLon with the pattern shifted)
  const stripe = (pat, s, h) => D.covLon(s, h, pat);
  // the sum the shader computes, in plain JS: rgb (cd/m²) of the whole picture at `dist`. g = ground(p), rgba = objects(...)'s buffer
  function composeCPU(p, g, rgba, dist) {
    const w = p.w, h = p.h, tanH = Math.tan(p.hfov * Math.PI / 360), tanV = tanH * h / w, d0 = 2 * tanH / w, A = p.A, out = new Float32Array(3 * w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const q = y * w + x, u = (x + 0.5) / w * 2 - 1, v = 1 - (y + 0.5) / h * 2; let k = 0;
      if (g.B && g.pat) {
        let dx = 1, dy = -u * tanH, dz = v * tanV; const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
        if (dz < -1e-6) {
          const tg = -EYE[2] / dz, px = EYE[0] + tg * dx, py = EYE[1] + tg * dy, s = A ? A.frame(px, py).s : px, hl = Math.max(0.5 * tg * d0, 1e-4) / Math.max(-dz, 0.003);
          k = stripe(g.pat, s + dist, hl);
        }
      }
      const cov = rgba ? rgba[4 * q + 3] : 0;
      for (let c = 0; c < 3; c++) out[3 * q + c] = (rgba ? rgba[4 * q + c] : 0) + (1 - cov) * (g.A[3 * q + c] + (g.B ? k * g.B[3 * q + c] : 0));
    }
    return out;
  }

  // ---------------------------------------------------------------- GPU
  const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const FS_COMPOSE = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uA, uB, uO; uniform vec2 uSize; uniform vec3 uEye; uniform float uTanH, uTanV, uDelta0, uDist, uR, uSg, uHasPat; uniform vec4 uPat;
out vec4 o;
float F(float x) { float u = x - uPat.x; float n = floor(u / uPat.z); return n * uPat.w + min(u - n * uPat.z, uPat.w); }
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy); vec3 g = texelFetch(uA, ip, 0).rgb; vec4 ob = texelFetch(uO, ip, 0);
  if (uHasPat > 0.5) {
    float u = gl_FragCoord.x / uSize.x * 2.0 - 1.0, v = 1.0 - gl_FragCoord.y / uSize.y * 2.0;
    vec3 d = normalize(vec3(1.0, -u * uTanH, v * uTanV));
    if (d.z < -1e-6) {
      float tg = -uEye.z / d.z; vec3 P = uEye + tg * d; float s = P.x;
      if (uR > 0.0) s = atan(P.x, -uSg * (P.y - uSg * uR)) * uR;
      float h = max(0.5 * tg * uDelta0, 1e-4) / max(-d.z, 0.003), sw = s + uDist, a = max(sw - h, uPat.x), b = min(sw + h, uPat.y);
      if (b > a) g += (F(b) - F(a)) / (2.0 * h) * texelFetch(uB, ip, 0).rgb;
    }
  }
  o = vec4(ob.rgb + (1.0 - ob.a) * g, 1.0);
}`;
  const FS_BRIGHT = `#version 300 es
precision highp float; uniform sampler2D uT; uniform float uK; uniform vec2 uSize; out vec4 o;
void main() { vec3 c = texture(uT, gl_FragCoord.xy / uSize).rgb * uK - 1.0; o = vec4(max(c, 0.0), 1.0); }`;
  const FS_BLUR = `#version 300 es
precision highp float; uniform sampler2D uT; uniform vec2 uSize, uDir; uniform int uRad; uniform float uScale; out vec4 o;
void main() { vec2 uv = gl_FragCoord.xy / uSize; vec3 s = vec3(0.0); for (int i = -uRad; i <= uRad; i++) s += texture(uT, uv + float(i) * uDir / uSize).rgb; o = vec4(s / float(2 * uRad + 1) * uScale, 1.0); }`;
  const FS_FINAL = `#version 300 es
precision highp float; uniform sampler2D uHdr, uGlare; uniform vec2 uSize; uniform float uK, uFlip, uGl; out vec4 o;
vec3 aces(vec3 x) { x = max(x, 0.0); return min((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 1.0); }
vec3 srgb(vec3 c) { return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize; uv.y = 1.0 - uv.y; if (uFlip > 0.5) uv.x = 1.0 - uv.x;
  vec3 lin = texture(uHdr, uv).rgb * uK + (uGl > 0.0 ? texture(uGlare, uv).rgb : vec3(0.0));
  o = vec4(srgb(aces(lin)), 1.0);
}`;

  function makeGL(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    const prog = (fs) => {
      const p = gl.createProgram();
      for (const [t, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('drive-anim shader: ' + gl.getShaderInfoLog(s)); gl.attachShader(p, s); }
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('drive-anim link: ' + gl.getProgramInfoLog(p));
      const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
      return { p, u };
    };
    const P = { compose: prog(FS_COMPOSE), bright: prog(FS_BRIGHT), blur: prog(FS_BLUR), fin: prog(FS_FINAL) };
    gl.bindVertexArray(gl.createVertexArray());
    const T = {};                                         // name → { t, f, w, h }
    const mk = (name, w, h, ifmt, filter) => {
      if (T[name]) { gl.deleteTexture(T[name].t); gl.deleteFramebuffer(T[name].f); }
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      T[name] = { t, f, w, h }; return T[name];
    };
    const use = (prog_, uni) => { gl.useProgram(prog_.p); for (const k in uni) { const v = uni[k], l = prog_.u[k]; if (l === undefined || l === null) continue; if (Array.isArray(v)) { if (v.length === 2) gl.uniform2fv(l, v); else if (v.length === 3) gl.uniform3fv(l, v); else gl.uniform4fv(l, v); } else if (Number.isInteger(v) && k === 'uRad') gl.uniform1i(l, v); else gl.uniform1f(l, v); } };
    const bindTex = (unit, name, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, T[name].t); gl.uniform1i(loc, unit); };
    const R = {
      gl, W: 0, H: 0, cw: 0, ch: 0,
      // allocate for a sim size and a canvas size
      resize(W, H, cw, ch) {
        R.cw = cw; R.ch = ch; if (W === R.W && H === R.H) return false;
        R.W = W; R.H = H; const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
        mk('A', W, H, gl.RGBA16F, gl.NEAREST); mk('B', W, H, gl.RGBA16F, gl.NEAREST); mk('O', W, H, gl.RGBA32F, gl.NEAREST); mk('hdr', W, H, gl.RGBA16F, gl.LINEAR);
        for (const n of ['src', 'p', 'q', 'acc']) mk(n, hw, hh, gl.RGBA16F, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, T.O.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, new Float32Array(4 * W * H));
        return true;
      },
      setGround(g) {
        const up = (name, rgb) => {
          const W = R.W, H = R.H, a = new Float32Array(4 * W * H); if (rgb) for (let i = 0, n = W * H; i < n; i++) { a[4 * i] = rgb[3 * i]; a[4 * i + 1] = rgb[3 * i + 1]; a[4 * i + 2] = rgb[3 * i + 2]; }
          gl.bindTexture(gl.TEXTURE_2D, T[name].t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, a);
        };
        up('A', g.A); up('B', g.B);
      },
      // upload rows [y0, y1) of the object layer (rgba: Float32Array 4·W·H)
      setObjects(rgba, y0, y1) {
        if (y1 <= y0) return; gl.bindTexture(gl.TEXTURE_2D, T.O.t);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, R.W, y1 - y0, gl.RGBA, gl.FLOAT, rgba.subarray(y0 * R.W * 4, y1 * R.W * 4));
      },
      /* f: { cam: { tanH, hfov }, dist, A (arc|null), pat, k (exposure), glare (strength), flip } */
      draw(f) {
        const W = R.W, H = R.H, hw = T.src.w, hh = T.src.h, tanH = Math.tan(f.hfov * Math.PI / 360), tanV = tanH * H / W;
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.hdr.f); gl.viewport(0, 0, W, H);
        use(P.compose, { uSize: [W, H], uEye: EYE, uTanH: tanH, uTanV: tanV, uDelta0: 2 * tanH / W, uDist: f.dist, uR: f.A ? f.A.R : 0, uSg: f.A ? f.A.sg : 0, uHasPat: f.pat ? 1 : 0, uPat: f.pat ? [f.pat.s0, f.pat.s1, f.pat.period, f.pat.on] : [0, 1, 1, 1] });
        bindTex(0, 'A', P.compose.u.uA); bindTex(1, 'B', P.compose.u.uB); bindTex(2, 'O', P.compose.u.uO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        if (f.glare > 0) {
          gl.viewport(0, 0, hw, hh);
          gl.bindFramebuffer(gl.FRAMEBUFFER, T.src.f); use(P.bright, { uK: f.k, uSize: [hw, hh] }); bindTex(0, 'hdr', P.bright.u.uT); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindFramebuffer(gl.FRAMEBUFFER, T.acc.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
          const levels = [[Math.max(1, Math.round(W / 220)), 0.012], [Math.max(2, Math.round(W / 70)), 0.010], [Math.max(3, Math.round(W / 22)), 0.008]];
          const pass = (src, dst, dx, dy, rad, scale, add) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, T[dst].f); if (add) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); } else gl.disable(gl.BLEND);
            use(P.blur, { uSize: [hw, hh], uDir: [dx, dy], uRad: rad, uScale: scale }); bindTex(0, src, P.blur.u.uT); gl.drawArrays(gl.TRIANGLES, 0, 3);
          };
          for (const [r, wt] of levels) { const rh = Math.max(1, Math.round(r / 2)); pass('src', 'p', 1, 0, rh, 1, false); pass('p', 'q', 0, 1, rh, 1, false); pass('q', 'p', 1, 0, rh, 1, false); pass('p', 'acc', 0, 1, rh, f.glare * wt, true); }
          gl.disable(gl.BLEND);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, R.cw, R.ch);
        use(P.fin, { uSize: [R.cw, R.ch], uK: f.k, uFlip: f.flip ? 1 : 0, uGl: f.glare > 0 ? 1 : 0 });
        bindTex(0, 'hdr', P.fin.u.uHdr); bindTex(1, 'acc', P.fin.u.uGlare); gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      // the HDR sim image back on the CPU (tests): Float32Array 4·W·H, row 0 = top
      readHdr() { const a = new Float32Array(4 * R.W * R.H); gl.bindFramebuffer(gl.FRAMEBUFFER, T.hdr.f); gl.readPixels(0, 0, R.W, R.H, gl.RGBA, gl.FLOAT, a); return a; },
      readCanvas() { const a = new Uint8Array(4 * R.cw * R.ch); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, R.cw, R.ch, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; },
      sync() { gl.bindFramebuffer(gl.FRAMEBUFFER, null); const a = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); },     // waits for the GPU (benchmarks)
    };
    return R;
  }

  // ---------------------------------------------------------------- the view: state, canvas, loop
  const V = { ui: null, cv: null, info: null, gl: null, canvas: null, pop: null, g: null, gkey: '', src: null, skey: '', lut: null, rgba: null, band: [0, 0], frames: 0, raf: 0, last: 0, times: [], cpu: { obj: 0, up: 0, gl: 0, n: 0 }, kAuto: null, why: '' };
  const S = (ui) => ui.dvAnim || (ui.dvAnim = { view: 'still', playing: true, popout: false, dist: 0, total: 0 });
  const supported = (o) => !!ANIM_SCENES[o.scene];
  const visible = () => {
    const ui = V.ui; if (!ui || !V.canvas || !V.info || typeof document === 'undefined') return false;
    if (document.visibilityState === 'hidden') return false;
    if (!V.canvas.isConnected || !V.canvas.getClientRects().length) return false;          // collapsed pane, display: none (the canvas itself, not its parent)
    return S(ui).popout || (ui.display === 'drive' && ui.store.scene.mode === 'D');
  };

  function size() {                                           // → { cssW, cssH, dpr, W, H } for the container the canvas lives in
    const par = V.canvas.parentElement, bw = par.clientWidth, bh = par.clientHeight, dpr = Math.min(2, root.devicePixelRatio || 1);
    const cssW = Math.max(16, Math.min(bw, bh * 16 / 9)), cssH = cssW * 9 / 16, W = Math.max(MIN_SIM, Math.min(MAX_SIM, Math.round(cssW * dpr))) & ~1, H = Math.round(W * 9 / 16) & ~1;
    return { cssW, cssH, dpr, W, H, left: (bw - cssW) / 2, top: (bh - cssH) / 2 };
  }
  function ensureCanvas() {
    if (V.canvas) return true;
    const c = document.createElement('canvas'); c.className = 'drive-gl'; c.setAttribute('aria-label', 'Animated drive view'); c.setAttribute('role', 'img');
    V.gl = makeGL(c); if (!V.gl) { V.why = 'WebGL2 with float render targets is not available here'; return false; }
    V.canvas = c; return true;
  }
  const info = () => V.info;
  // everything the picture depends on except the scenery classes and the car's position
  function prepare(sz) {
    const I = info(), o = I.o, W = sz.W, H = sz.H, key = JSON.stringify([I.groundKey, W, H]);
    const skey = JSON.stringify([o.scene, I.rd.laneDrive, I.us, o.people, o.animals, o.signs, o.posts, o.veg, o.obstacle]);
    if (V.skey !== skey || !V.src) { V.src = source(o.scene, I.rd.laneDrive, I.us, { people: o.people, animals: o.animals, signs: o.signs, posts: o.posts, veg: o.veg, obstacle: o.obstacle }); V.skey = skey; }
    V.p = { w: W, h: H, hfov: o.fov, lamps: I.rd.mdl.lamps, lut: I.lut(), conv: I.conv, A: I.A, lane: I.rd.laneDrive, look: { wet: o.wet, RL: o.RL / 1000, ambient: o.ambient }, src: V.src };
    if (V.gkey !== key || V.rdRef !== I.rd) {
      V.g = ground(V.p); V.gkey = key; V.rdRef = I.rd; V.gl.resize(W, H, Math.round(sz.cssW * sz.dpr), Math.round(sz.cssH * sz.dpr)); V.gl.setGround(V.g);
      V.rgba = new Float32Array(4 * W * H); V.band = [0, H];                    // the object texture may hold an older picture: the next frame rewrites all of it
    }
    V.gl.resize(W, H, Math.round(sz.cssW * sz.dpr), Math.round(sz.cssH * sz.dpr));
  }
  function exposure() {
    const I = info(), o = I.o;
    if (o.expMode === 'auto' && V.kAuto) return V.kAuto;
    return Math.pow(2, o.ev) / D.L_REF;
  }
  // one frame at S.dist
  function frame() {
    const ui = V.ui, st = S(ui), I = info(), o = I.o, t0 = performance.now(), W = V.p.w, pb = V.band, had = pb[1] > pb[0];
    if (had) V.rgba.fill(0, pb[0] * W * 4, pb[1] * W * 4);                       // last frame's rows go back to zero, then this frame's are traced
    const rows = objects(V.p, st.dist, V.rgba, V.pinSS || (W > 1100 ? 1 : (V.ss || 2)));
    const t1 = performance.now();
    // samples per pixel for the objects: 2×2 where it is cheap; one while a big object is close (the cost is its area) and until things are calm again
    V.avg = V.avg === undefined ? t1 - t0 : V.avg * 0.9 + (t1 - t0) * 0.1;       // a smoothed cost: one slow frame (a big object passing) must not drop the edges to hard 1-sample for a long while
    if (W <= 1100) { if ((V.ss || 2) === 2 && V.avg > 18) { V.ss = 1; V.calm = 0; } else if (V.ss === 1 && V.avg < 8) { if (++V.calm > 20) V.ss = 2; } else V.calm = 0; }
    V.gl.setObjects(V.rgba, had ? Math.min(pb[0], rows[0]) : rows[0], had ? Math.max(pb[1], rows[1]) : rows[1]); V.band = rows;      // upload the rows either frame touched
    const t2 = performance.now();
    V.gl.draw({ hfov: o.fov, dist: st.dist, A: I.A, pat: V.g.pat, k: exposure(), glare: +o.glare || 0, flip: I.mirrored });
    const t3 = performance.now(), c = V.cpu; c.obj += t1 - t0; c.up += t2 - t1; c.gl += t3 - t2; c.n++; V.frames++; (V.ring || (V.ring = [])).push(t1 - t0); if (V.ring.length > 600) V.ring.shift();
    ui.dvAnimFrames = V.frames;
  }
  function layout() {
    const sz = size(), cs = V.canvas.style, cw = Math.round(sz.cssW * sz.dpr), ch = Math.round(sz.cssH * sz.dpr);
    if (V.canvas.width !== cw || V.canvas.height !== ch) { V.canvas.width = cw; V.canvas.height = ch; }
    cs.left = sz.left + 'px'; cs.top = sz.top + 'px'; cs.width = sz.cssW + 'px'; cs.height = sz.cssH + 'px'; return sz;
  }
  // the large view belongs to the Spec Result → Drive view: leave the mode or the display and it goes
  const popValid = (ui) => ui.store && ui.store.scene.mode === 'D' && ui.display === 'drive';
  function tick(t) {
    V.raf = 0; const ui = V.ui, st = S(ui);
    if (st.popout && !popValid(ui)) { closePop(ui); return; }
    if (!visible() || !st.playing || !(st.view === 'anim' || st.popout)) { V.suspended = true; return; }
    const dt = V.last ? Math.min(0.1, (t - V.last) / 1000) : 0; V.last = t;
    const v = (+info().o.speed || 50) / 3.6; st.total += v * dt; st.dist = (st.dist + v * dt) % PERIOD;
    V.times.push(t); if (V.times.length > 300) V.times.shift();
    frame(); V.raf = requestAnimationFrame(tick);
  }
  function stop() { if (V.raf) { cancelAnimationFrame(V.raf); V.raf = 0; } V.last = 0; }
  function go() { if (!V.raf && V.gl && visible() && S(V.ui).playing) { V.last = 0; V.raf = requestAnimationFrame(tick); } }

  // ---------------------------------------------------------------- the controls
  const E = (tag, attrs, ...kids) => { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); e.append(...kids); return e; };
  function bars(ui, setDV) {
    if (V.bar) return V.bar;
    const st = S(ui), bar = E('div', { class: 'drive-anim-tools', 'data-anim': 'bar' }), btn = (k, title, fn, txt) => { const b = E('button', { type: 'button', class: 'toggle', 'data-anim': k, title }, txt || ''); b.addEventListener('click', fn); bar.append(b); return b; };
    btn('play', 'Play / pause the drive', () => { st.playing = !st.playing; if (st.playing) { if (st.view !== 'anim') st.view = 'anim'; } ui.redrawSpec(); });
    const sp = E('input', { type: 'range', min: 5, max: 130, step: 5, 'data-anim': 'speed', 'aria-label': 'Speed (km/h)', title: 'Speed of the drive' }); sp.addEventListener('input', () => { setDV(ui, 'speed', +sp.value, true); lab.textContent = sp.value + ' km/h'; });
    const lab = E('span', { class: 'anim-speed', 'data-anim': 'speedlab' }); bar.append(sp, lab);
    for (const [k, txt, title] of CLASSES) btn('c-' + k, title, () => setDV(ui, k, !info().o[k]), txt);
    V.bar = bar; return bar;
  }
  function topButtons(ui, tb, setDV) {                         // 'animate' and 'popout' go into the existing toolbar
    if (tb.querySelector('[data-anim="animate"]')) return;
    const a = E('button', { type: 'button', class: 'toggle', 'data-anim': 'animate', title: 'Animate: drive down the road (open road and forest road). Off = the still picture.' }, 'animate'), p = E('button', { type: 'button', class: 'toggle', 'data-anim': 'popout', title: 'Show the drive view large, over the whole page except the sidebar (Esc closes)' }, '⤢ large');
    a.addEventListener('click', () => { const st = S(ui); st.view = st.view === 'anim' ? 'still' : 'anim'; st.playing = true; ui.redrawSpec(); });
    p.addEventListener('click', () => { S(ui).popout ? closePop(ui) : openPop(ui); });
    tb.append(a, p);
  }
  function labels(ui) {
    const st = S(ui), I = info(), o = I.o, sup = supported(o), q = (s) => document.querySelectorAll(s);
    for (const b of q('[data-anim="animate"]')) { b.setAttribute('aria-pressed', String(st.view === 'anim')); b.disabled = !sup; b.title = sup ? 'Animate: drive down the road. Off = the still picture.' : 'Animation covers the open road; the other scenes stay still (their objects trace at 40–270 ms a frame, and the ground path animates one patterned marking)'; }
    for (const b of q('[data-anim="popout"]')) { b.setAttribute('aria-pressed', String(st.popout)); b.disabled = !sup; b.textContent = st.popout ? '✕ close' : '⤢ large'; }
    if (!V.bar) return;
    V.bar.hidden = !(sup && (st.view === 'anim' || st.popout));
    const run = st.playing && (st.view === 'anim' || st.popout), pb = V.bar.querySelector('[data-anim="play"]'); pb.textContent = run ? '⏸ pause' : '▶ play'; pb.setAttribute('aria-pressed', String(run));
    V.bar.querySelector('[data-anim="speed"]').value = o.speed; V.bar.querySelector('[data-anim="speedlab"]').textContent = o.speed + ' km/h';
    for (const [k] of CLASSES) { const b = V.bar.querySelector('[data-anim="c-' + k + '"]'); b.setAttribute('aria-pressed', String(!!o[k])); }
  }

  // ---------------------------------------------------------------- popout
  function openPop(ui) {
    const st = S(ui), host = document.querySelector('.work-col'); if (!host || st.popout) return;
    const pop = E('div', { class: 'drive-popout', role: 'dialog', 'aria-label': 'Drive view, large' }), head = E('div', { class: 'dp-head' }, E('strong', {}, 'Drive view')), stage = E('div', { class: 'dp-stage' });
    const close = E('button', { type: 'button', class: 'dp-close', title: 'Close (Esc)' }, '✕ Close'); close.addEventListener('click', () => closePop(ui)); head.append(E('span', { class: 'dp-hint' }, 'Esc closes'), close);
    pop.append(head, stage); host.append(pop); V.pop = pop; V.popStage = stage; V.home = V.canvas ? V.canvas.parentElement : null;
    st.popout = true; if (st.view !== 'anim') st.playing = false;          // opened from the still view: the same picture, large, paused
    V.onKey = (e) => { if (e.key === 'Escape' && S(ui).popout) { e.preventDefault(); e.stopPropagation(); closePop(ui); } };
    document.addEventListener('keydown', V.onKey, true);
    if (root.ResizeObserver) { V.ro = new ResizeObserver(() => { if (S(ui).popout) { ui.redrawSpec(); } }); V.ro.observe(stage); }
    mount(ui); close.focus(); ui.redrawSpec();
  }
  function closePop(ui) {
    const st = S(ui); if (!st.popout) return; st.popout = false;
    document.removeEventListener('keydown', V.onKey, true); if (V.ro) { V.ro.disconnect(); V.ro = null; }
    if (V.pop) { V.pop.remove(); V.pop = null; V.popStage = null; }
    if (st.view !== 'anim') st.playing = true;
    mount(ui); const b = document.querySelector('[data-anim="popout"]'); if (b) b.focus(); ui.redrawSpec();
  }
  // the canvas and the tool bars live in the popout while it is open, in the pane otherwise
  function mount(ui) {
    const st = S(ui), host = st.popout && V.popStage ? V.popStage : (V.cv ? V.cv.parentElement : null); if (!host) return;
    for (const e of [V.canvas, ui.driveBar, V.bar]) if (e && e.parentElement !== host) host.append(e);
  }

  // ---------------------------------------------------------------- hook from drawDrive
  /* I: { rd, o (dvOpts), A (arc|null), mirrored, us, conv, lut () → the beam lookup, tm (the still picture's tone map), groundKey, setDV, toolbar } */
  function sync(ui, cv, I) {
    V.ui = ui; V.cv = cv; V.info = I; const st = S(ui);
    if (st.popout && !popValid(ui)) closePop(ui);
    topButtons(ui, I.toolbar, I.setDV); bars(ui, I.setDV);
    if (!V.bar.parentElement) cv.parentElement.append(V.bar);
    if (!st.popout) mount(ui);
    if (!supported(I.o)) { if (st.popout) closePop(ui); st.view = 'still'; }
    labels(ui);
    const want = supported(I.o) && (st.view === 'anim' || st.popout);
    if (!want) { stop(); if (V.canvas) V.canvas.hidden = true; return; }
    if (!ensureCanvas()) { st.view = 'still'; st.popout = false; labels(ui); return; }
    V.canvas.hidden = false; mount(ui);
    if (!visible()) { stop(); return; }
    const sz = layout();
    if (I.o.expMode === 'auto' && I.tm) { const ak = I.groundKey + '|' + I.o.ev; if (!V.kAuto || V.autoKey !== ak) { V.kAuto = I.tm.k; V.autoKey = ak; } } else V.kAuto = null;      // auto exposure would flicker as the scene moves: frozen at the still picture's
    prepare(sz); frame();
    if (st.playing) go(); else stop();
  }
  // a hidden tab stops the loop; showing it again redraws (which restarts it)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (V.ui) { if (document.visibilityState === 'hidden') stop(); else if (V.info) { if (S(V.ui).popout && !popValid(V.ui)) closePop(V.ui); else V.ui.redrawSpec(); } } });

  // ---------------------------------------------------------------- numbers for tests and the report
  const pct = (a, q) => { if (!a || !a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
  function stats() {
    const t = V.times, iv = []; for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]); iv.sort((a, b) => a - b);
    const med = iv.length ? iv[iv.length >> 1] : 0, c = V.cpu;
    return { frames: V.frames, running: !!V.raf, rafMedianMs: med, fps: med ? 1000 / med : 0, p95Ms: iv.length ? iv[Math.floor(iv.length * 0.95)] : 0, cpuObjMs: c.n ? c.obj / c.n : 0, cpuUploadMs: c.n ? c.up / c.n : 0, cpuGlMs: c.n ? c.gl / c.n : 0, sim: V.p && [V.p.w, V.p.h], canvasPx: V.gl && [V.gl.cw, V.gl.ch], groundMs: V.g && V.g.ms, objP95Ms: pct(V.ring, 0.95), objMaxMs: pct(V.ring, 1), ss: V.pinSS || (V.p && V.p.w > 1100 ? 1 : (V.ss || 2)) };
  }
  function resetStats() { V.times = []; V.ring = []; V.cpu = { obj: 0, up: 0, gl: 0, n: 0 }; }
  // render n frames back to back (no vsync), waiting for the GPU at the end: ms per frame
  function bench(n) {
    const ui = V.ui, st = S(ui), d0 = st.dist; resetStats(); const t0 = performance.now();
    for (let i = 0; i < n; i++) { st.dist = (st.dist + 0.5) % PERIOD; frame(); }
    V.gl.sync(); const ms = (performance.now() - t0) / n; st.dist = d0; return Object.assign({ n, msPerFrame: ms }, stats());
  }
  RF.DriveAnim = { PERIOD, EYE, ANIM_SCENES, CLASSES, source, place, ground, objects, composeCPU, makeGL, sync, stats, resetStats, bench, closePop, openPop,
    // test hooks
    _: { V, S, frame, size, prepare, exposure, readHdr: () => V.gl.gl && V.gl.readHdr(), readCanvas: () => V.gl.readCanvas(), setDist: (d) => { S(V.ui).dist = d; frame(); } } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
