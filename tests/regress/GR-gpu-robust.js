// GR page checks. python3 tests/serve.py 8783; GR_REAL_GPU=1 node tests/regress/GR-gpu-robust.js 8783
// (set GR_REAL_GPU=1 for the Apple GPU via channel chromium; otherwise headless_shell/SwiftShader).
const fs = require('fs'), path = require('path'), pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright')), port = +(process.argv[2] || 8783);
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
(async () => {
  const browser = await pw.chromium.launch(process.env.GR_REAL_GPU ? { channel: 'chromium', args: ['--enable-unsafe-webgpu'] } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {                           // live GL object counts (created minus deleted), per kind
      localStorage.clear(); const P = WebGL2RenderingContext.prototype, live = window.__glLive = {};
      for (const k of ['Texture', 'Framebuffer', 'Renderbuffer', 'Buffer', 'Program', 'VertexArray', 'Shader']) {
        const mk = P['create' + k], del = P['delete' + k], set = live[k] = new Set();
        P['create' + k] = function (...a) { const o = mk.apply(this, a); if (o) set.add(o); return o; };
        P['delete' + k] = function (o, ...a) { set.delete(o); return del.call(this, o, ...a); };
      }
    });
    await page.goto('http://localhost:' + port + '/index.html'); await page.waitForFunction(() => window.RF && RF.UI && RF.UI.loadScene);
    ok('on my page (port ' + port + ')', await page.evaluate(() => !!RF.UI) && (await page.evaluate(() => location.port)) === String(port));
    await page.evaluate(t => RF.UI.loadScene(RF.State.deserialize(t), 'GR fixture'), fs.readFileSync(path.join(__dirname, '../fixtures/MG2-default-lamp.json'), 'utf8'));
    await page.addScriptTag({ url: '/tests/drive-three-page.js' });
    const info = await page.evaluate(async () => {
      await P1Page.ready(); const s = await P1Page.select(true); const gl = RF.DriveAnim._.V.gl.gl, e = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: s.renderer, gpuFailure: s.gpuFailure, gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown' };
    });
    console.log('GPU: ' + info.gpu); ok('GPU renderer active at start', info.renderer === 'three', JSON.stringify(info));

    // 1. lose + restore twice (paused), then during Play
    const cycle = (playing) => page.evaluate(async playing => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)), D = RF.DriveAnim, a = D._, st = a.S(RF.UI);
      st.playing = playing; RF.UI.redrawSpec(); await sleep(400); const f0 = a.V.frames;
      const shot = () => { st.playing = false; a.frame(); const c = a.V.canvas, t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; let h = 0, lit = 0; for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) | 0; if (d[i] + d[i + 1] + d[i + 2] > 12) lit++; } return { h, lit }; };
      if (!playing) { await P1Page.select(false); await P1Page.select(true); await sleep(300); shot(); }   // reference = a settled GPU picture (the very first GPU frame differs from later ones, with or without any context loss)
      const before = playing ? null : shot();
      const ext = a.V.gl.gl.getExtension('WEBGL_lose_context'); ext.loseContext(); await sleep(300); const lost = D.stats().contextLost;
      ext.restoreContext(); for (let i = 0; i < 60 && (D.stats().contextLost || D.stats().renderer !== 'three') && !D.stats().gpuFailure; i++) await sleep(100);
      await sleep(500); const s = D.stats(), btn = RF.UI.driveBar && 0;
      const pressed = document.querySelector('[data-anim="gpu-renderer"]').getAttribute('aria-pressed'), f1 = a.V.frames;
      if (playing) await sleep(800);
      const moved = a.V.frames > f1; st.playing = false; RF.UI.redrawSpec(); a.frame();
      const after = shot();
      return { lost, renderer: s.renderer, failure: s.gpuFailure, ctxLost: s.contextLost, notice: a.V.why, pressed, playingAfter: playing ? moved : null, lit: after.lit, same: before ? before.h === after.h : null, threeLive: !!a.V.three };
    }, playing);
    for (const [name, playing] of [['restore #1 (paused)', false], ['restore #2 (paused)', false], ['restore #3 during Play', true]]) {
      const r = await cycle(playing);
      ok('GR ' + name + ': GPU renderer comes back, setting shows ON, no notice', r.lost && r.renderer === 'three' && !r.failure && !r.ctxLost && r.pressed === 'true' && !r.notice && r.threeLive && (r.playingAfter === null || r.playingAfter) && r.lit > 1000 && r.same !== false, JSON.stringify(r));
    }

    // 2. forced create failure: bounded retries, then visible CPU fallback; click retries
    const fb = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)), D = RF.DriveAnim, a = D._, gl = a.V.gl.gl, real = gl.getExtension.bind(gl); let calls = 0;
      RF.UI.dvOpts.gpuRenderer = false; RF.UI.redrawSpec(); await sleep(200);
      gl.getExtension = n => { if (n === 'EXT_color_buffer_float') { calls++; return null; } return real(n); };
      RF.UI.dvOpts.gpuRenderer = true; RF.UI.redrawSpec(); for (let i = 0; i < 40 && !D.stats().gpuFailure; i++) await sleep(100); await sleep(300);
      const b = document.querySelector('[data-anim="gpu-renderer"]');
      const failed = { tries: calls, renderer: D.stats().renderer, failure: !!D.stats().gpuFailure, pressed: b.getAttribute('aria-pressed'), flag: b.hasAttribute('data-failed'), notice: a.V.why, saved: RF.UI.dvOpts.gpuRenderer };
      gl.getExtension = real; b.click(); for (let i = 0; i < 40 && D.stats().renderer !== 'three'; i++) await sleep(100); await sleep(200);
      return { failed, after: { renderer: D.stats().renderer, pressed: b.getAttribute('aria-pressed'), flag: b.hasAttribute('data-failed'), notice: a.V.why } };
    });
    ok('GR forced failure: 3 bounded tries, CPU fallback with the notice, button shows OFF + data-failed, saved setting untouched', fb.failed.tries === 3 && fb.failed.renderer === 'cpu' && fb.failed.failure && fb.failed.pressed === 'false' && fb.failed.flag && /using CPU renderer/.test(fb.failed.notice) && fb.failed.saved === true, JSON.stringify(fb.failed));
    ok('GR clicking the failed button retries the GPU and recovers', fb.after.renderer === 'three' && fb.after.pressed === 'true' && !fb.after.flag && !fb.after.notice, JSON.stringify(fb.after));

    // 3. toggle leak: 20 GPU on/off cycles, GL object counts flat
    const leak = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)), live = () => Object.fromEntries(Object.entries(window.__glLive).map(([k, v]) => [k, v.size]));
      const toggle = async () => { await P1Page.select(false); await P1Page.select(true); };
      for (let i = 0; i < 3; i++) await toggle();                // warm-up: lazily created objects settle
      const before = live(); for (let i = 0; i < 20; i++) await toggle(); const after = live();
      return { before, after, renderer: RF.DriveAnim.stats().renderer };
    });
    const grew = Object.keys(leak.before).filter(k => leak.after[k] !== leak.before[k]);
    ok('GR 20 GPU on/off toggles: GL texture/framebuffer/renderbuffer/buffer/program/VAO/shader counts flat', !grew.length && leak.renderer === 'three', JSON.stringify(leak));
    ok('no page errors', !errors.length, errors.join(' | '));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' FAILED' : 'all GR page checks passed'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
