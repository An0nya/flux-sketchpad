// WG page checks: the wet-streak model toggle (legacy | GGX) reaches the GPU drive renderer, both models draw with no
// shader or console errors, and the GGX frame differs from the legacy frame on screen. Legacy twice must be identical.
// Run: PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/WG-wet-ggx.js 8981   (server: python3 tests/serve.py 8981)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8981);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One page, three captures: legacy, GGX, legacy. A redraw right after startup can be dropped, so the page warms up with one
// redraw first and the capture waits for the frame to settle.
async function session(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage(), errors = [];
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  // Same startup as the UX2 page test: lamp trace, drive display, GPU renderer on.
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
  await page.evaluate(() => UX2Page.ready());
  const capture = async (model) => {
    await page.evaluate(m => { RF.UI.dvOpts.wetModel = m; RF.UI.redrawSpec(); }, model); await sleep(2000);
    const state = await page.evaluate(() => { const st = RF.DriveAnim.stats(), V = RF.DriveAnim._.V; return { renderer: st.renderer, gpuFailure: st.gpuFailure || '', look: V.p && V.p.look && V.p.look.wetModel }; });
    // The drive view's own WebGL canvas (the largest canvas on the page is the optics view, not this one).
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-wg-drive', '1'));
    return { png: await page.locator('canvas[data-wg-drive="1"]').screenshot(), state };
  };
  await capture('legacy');                                   // warm-up
  const legacy = await capture('legacy'), ggx = await capture('ggx'), legacy2 = await capture('legacy');
  const parityResult = await page.evaluate(parityInPage);
  await context.close();
  return { legacy, ggx, legacy2, errors, parityResult };
}

// CPU/GPU parity: pull wetGGX out of the shipped shader module (not a copy), run it on 20 geometries in a float target, compare to the CPU function.
async function parityInPage() {
  const src = (await import('/js/drive-three-shaders.js')).ground;
  const start = src.indexOf('float wetGGX(vec3 d,vec3 v,vec3 n) {'); if (start < 0) return { error: 'wetGGX not found in shader module' };
  const end = src.indexOf('\n}\n', start) + 3, fn = src.slice(start, end);
  const geoms = []; for (let i = 0; i < 20; i++) {                       // lamp distances 10-200 m, lateral 0.5-4 m, eye heights 1.0-1.5 m
    const dist = 10 + i * 10, lat = 0.5 + (i % 4) * 1.2, eyeH = 1.0 + (i % 3) * 0.25, lampH = 0.6 + (i % 5) * 0.2;
    const lamp = [dist, lat * 0.5, lampH], eye = [0, 0, eyeH], k = eyeH / (eyeH + lampH);   // even i: the mirror point (peak); odd i: off-peak tail
    const p = i % 2 === 0 ? [dist * k, lamp[1] * k, 0] : [dist * 0.3, lat * (i % 4 === 1 ? -1 : 1), 0];
    const d = [lamp[0] - p[0], lamp[1] - p[1], lamp[2]], vr = [eye[0] - p[0], eye[1] - p[1], eye[2]], vn = Math.hypot(...vr);
    geoms.push({ d, v: vr.map(x => x / vn) });
  }
  const cpu = geoms.map(g => RF.Drive.wetGGX(g.d[0], g.d[1], g.d[2], g.v[0], g.v[1], g.v[2]));
  const c = document.createElement('canvas'), gl = c.getContext('webgl2');
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return { error: 'no float targets' };
  const sh = (type, code) => { const o = gl.createShader(type); gl.shaderSource(o, code); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main(){ gl_Position=vec4(p,0.0,1.0); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\nuniform vec4 D[20]; uniform vec4 V[20]; out vec4 o;\nconst float PI = 3.141592653589793;\n' + fn +
    'void main(){ int i=int(gl_FragCoord.x); o=vec4(wetGGX(D[i].xyz, V[i].xyz, vec3(0.0,0.0,1.0)),0.0,0.0,1.0); }'));
  gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: gl.getProgramInfoLog(prog) };
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 20, 1, 0, gl.RGBA, gl.FLOAT, null);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, 20, 1); gl.useProgram(prog);
  gl.uniform4fv(gl.getUniformLocation(prog, 'D'), new Float32Array(geoms.flatMap(g => [...g.d, 0]))); gl.uniform4fv(gl.getUniformLocation(prog, 'V'), new Float32Array(geoms.flatMap(g => [...g.v, 0])));
  gl.drawArrays(gl.TRIANGLES, 0, 3); const px = new Float32Array(80); gl.readPixels(0, 0, 20, 1, gl.RGBA, gl.FLOAT, px);
  const peak = Math.max(...cpu); let worst = 0, at = -1;
  for (let i = 0; i < 20; i++) { const g = px[4 * i], k = cpu[i]; if (Math.abs(k) < 1e-3 * peak) continue; const rel = Math.abs(g - k) / Math.abs(k); if (rel > worst) { worst = rel; at = i; } }
  return { n: 20, worstRel: worst, at, peakCPU: peak, gpuSample: px[0], cpuSample: cpu[0] };
}

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' }); let failed = false;
  const report = (name, pass, detail) => { console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); failed ||= !pass; };
  try {
    const { legacy, ggx, legacy2, errors, parityResult } = await session(browser);
    report('WG GPU wetGGX matches the CPU function on 20 geometries (relative error <= 2%)', !parityResult.error && parityResult.worstRel <= 0.02, parityResult);
    report('WG GPU renderer active for both models with no shader failure', [legacy, ggx].every(r => r.state.renderer === 'three' && !r.state.gpuFailure), [legacy.state, ggx.state]);
    report('WG toggle reaches the drive look (wetModel)', ggx.state.look === 'ggx' && legacy.state.look === 'legacy', { legacy: legacy.state.look, ggx: ggx.state.look });
    report('WG no page or console errors', errors.length === 0, errors.slice(0, 3));
    report('WG legacy frame returns identical bytes after a GGX round trip', Buffer.compare(legacy.png, legacy2.png) === 0);
    report('WG GGX frame differs from legacy frame on screen (the option is wired to the GPU shader)', Buffer.compare(legacy.png, ggx.png) !== 0);
  } finally { await browser.close(); }
  console.log(failed ? 'WG FAILED' : 'all WG page checks passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
