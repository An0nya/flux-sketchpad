// GM2 page checks: the HDR presenter (registry hdrOut; hdr-spike port step 5, 11-27). Needs WebGPU: launched with --enable-unsafe-webgpu
// --use-angle=metal (the Apple GPU for both WebGL and WebGPU). Oncoming car, perceptual model, glare dry, EV +2, HDR peak 16.
//  1. hdrOut on: the presenter is made, its canvas shows and the WebGL canvas is hidden.
//  2. copy and readback both hand over the frame: the shown frame (read back from the WebGPU canvas, extended sRGB) matches the WebGL
//     linear display frame within one 8-bit code value below white and 1% above white; values above white reach the screen.
//  3. hdrOut off: the HDR canvas hides, the WebGL canvas shows again and the page loses its hdr-on class.
// Run: python3 tests/serve.py <port> ; node tests/regress/GM2-hdr-presenter.js <port>
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8985);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' - ' + detail : '')); };
(async () => {
  let b = null; const errs = [];
  try {
    b = await pw.chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
    const page = await (await b.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
    page.on('pageerror', (e) => errs.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(2500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { scene: 'road', gpuRenderer: true, animals: false, people: false, trafficLogic: false, oncoming: true, preceding: false, wet: false, visibility: null, scatter: 0, trafficHalo: 0, expMode: 'fixed', ev: 2, dynamicResolution: false, samples: '1', glare: 'dry', onMode: 'generic', tiles: false, streetLamps: 'off' }, { glareModel: 'perceptual' }, RF.Options.GLARE_MODELS.perceptual, { hdrOut: true, hdrTransport: 'copy' }); Object.assign(RF.UI.dvAnim, { view: 'anim', dist: 300, t: 32.5, playing: false }); RF.UI.redrawSpec(); });
    await sleep(6000); await page.evaluate(() => RF.UI.redrawSpec()); await sleep(2000);
    const state = await page.evaluate(() => { const V = RF.DriveAnim._.V; return { hdr: V.hdr ? (V.hdr.fail || 'ready') : String(V.hdr), shown: V.hdr && V.hdr.canvas ? !V.hdr.canvas.hidden : null, glVis: V.canvas.style.visibility, note: document.querySelector('[data-anim="glareModel-note"]').textContent }; });
    ok('GM2 1 the presenter is ready, its canvas shows, the WebGL canvas is hidden', state.hdr === 'ready' && state.shown === true && state.glVis === 'hidden', JSON.stringify(state));
    for (const mode of ['readback', 'copy']) {
      const r = await page.evaluate(async (mode) => {
        const V = RF.DriveAnim._.V; RF.UI.dvOpts.hdrTransport = mode; RF.UI.redrawSpec(); await new Promise((r) => setTimeout(r, 1500));
        V.hdr.capture = true; V.hdr.captured = null; RF.UI.redrawSpec(); for (let i = 0; i < 100 && !V.hdr.captured; i++) await new Promise((r) => setTimeout(r, 50));
        if (!V.hdr.captured) return { err: 'no capture' };
        const cap = await V.hdr.captured, disp = V.gl.readDisp();
        const half = (x) => { const s = x & 0x8000 ? -1 : 1, e = (x >> 10) & 31, m = x & 1023; return e === 0 ? s * 2 ** -14 * m / 1024 : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + m / 1024); };
        const enc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
        const { w, h } = cap; if (disp.w !== w || disp.h !== h) return { err: 'size ' + [w, h, disp.w, disp.h] };
        let maxLo = 0, maxHi = 0, nHi = 0, maxRelHi = 0, peakShown = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let ch = 0; ch < 3; ch++) {
          const shown = half(cap.bits[(y * w + x) * 4 + ch]), d = disp.a[((h - 1 - y) * w + x) * 4 + ch], ref = enc(Math.max(0, d));
          peakShown = Math.max(peakShown, shown);
          if (d <= 1) maxLo = Math.max(maxLo, Math.abs(shown - ref)); else { nHi++; maxHi = Math.max(maxHi, Math.abs(shown - ref)); maxRelHi = Math.max(maxRelHi, Math.abs(shown - ref) / ref); }
        }
        return { mode, w, h, maxErrBelowWhite_encoded: +maxLo.toFixed(5), oneCodeValue: +(1 / 255).toFixed(5), channelsAboveWhite: nHi, maxRelErrAboveWhite: +maxRelHi.toFixed(4), peakShown_encoded: +peakShown.toFixed(3) };
      }, mode);
      ok('GM2 2 ' + mode + ': the shown frame matches the WebGL display frame (under 1 code value below white, 1% above)', !r.err && r.maxErrBelowWhite_encoded < 1 / 255 && r.maxRelErrAboveWhite < 0.01, JSON.stringify(r));
      ok('GM2 2 ' + mode + ': values above white reach the screen', !r.err && r.channelsAboveWhite > 0 && r.peakShown_encoded > 1.5, JSON.stringify(r));
    }
await page.evaluate(() => { RF.UI.dvOpts.hdrOut = false; RF.UI.redrawSpec(); }); await sleep(1500);
    const off = await page.evaluate(() => { const V = RF.DriveAnim._.V; return { hdrShown: !V.hdr.canvas.hidden, glVis: V.canvas.style.visibility, cls: document.documentElement.classList.contains('hdr-on') }; });
    ok('GM2 3 hdrOut off: HDR canvas hidden, WebGL canvas shown, no hdr-on class', !off.hdrShown && off.glVis === '' && !off.cls, JSON.stringify(off));
    ok('GM2 no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  } catch (e) { ok('GM2 ran without throwing', false, String(e && e.stack || e)); }
  finally { if (b) await b.close(); }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(checks.length + ' checks, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
