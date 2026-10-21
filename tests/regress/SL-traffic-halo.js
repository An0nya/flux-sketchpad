// SL3 page checks: the traffic halo button (off, 4, 8, 16) on the GPU drive renderer. Fog 60 m, oncoming traffic, a seed with an oncoming car in range.
// Checks: the button hides in clear air and shows in fog; it cycles off, 4, 8, 16; halo off draws no quad and is the frame of the same build with
// the option never set; halo 8 draws quads, changes the frame, and the change stays in a box around the lamps (localised); nothing throws; no gpuFailure.
// Run (worktree): python3 tests/serve.py <port>  then  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SL-traffic-halo.js <port> [mainPort]
// mainPort (optional): a server on a snapshot of main (git archive main); its halo-off frame must equal ours (byte-identical when the option is off).
// Not covered here: occlusion by a car in front (needs a placed car, not a seed), and CPU/GPU near-lamp parity (needs a CPU frame of the same pose).
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8985), mainPort = process.argv[3] ? +process.argv[3] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' — ' + detail : '')); };
const errors = [];
// the frame (PNG bytes) of the drive canvas, plus its pixels (RGBA) decoded in the page, for the diff
async function frame(page) {
  await sleep(2500);
  await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
  const png = await page.locator('canvas[data-sl-drive="1"]').screenshot();
  return png;
}
async function diffBox(page, a, b) {
  return page.evaluate(async ([A, B]) => {
    const dec = async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }; };
    const x = await dec(A), y = await dec(B); let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 0; i < x.d.length; i += 4) { if (x.d[i] !== y.d[i] || x.d[i + 1] !== y.d[i + 1] || x.d[i + 2] !== y.d[i + 2]) { n++; const p = i / 4, px = p % x.w, py = Math.floor(p / x.w); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); } }
    return { n, w: x.w, h: x.h, box: n ? [x0, y0, x1, y1] : null };
  }, [a.toString('base64'), b.toString('base64')]);
}
(async () => {
  const browser = await pw.chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0 }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 }).catch(() => {});
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const st = await page.evaluate(() => ({ renderer: RF.DriveAnim.stats().renderer, gpuFailure: RF.DriveAnim.stats().gpuFailure || '' }));
    ok('SL GPU renderer is on (no GPU failure)', st.renderer === 'three' && !st.gpuFailure, JSON.stringify(st));
    const btnState = () => page.evaluate(() => { const b = document.querySelector('[data-dv="trafficHalo"]'); return b ? { text: b.textContent.trim(), hidden: b.hidden } : null; });
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    const haloDrawn = () => page.evaluate(() => RF.DriveAnim._.V.three ? RF.DriveAnim._.V.three.haloState().drawn : -1);
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false);
    // 1. clear air: the button is hidden
    const clearBtn = await btnState();
    ok('SL clear air: the traffic halo button is hidden', clearBtn && clearBtn.hidden === true, JSON.stringify(clearBtn));
    // 2. fog 60: the button shows and cycles off, 4, 8, 16
    await setOpt('visibility', 60); await sleep(800);
    const b0 = await btnState();
    ok('SL fog 60: the traffic halo button shows, off', b0 && b0.hidden === false && b0.text === 'traffic halo: off', JSON.stringify(b0));
    const labels = [b0.text];
    for (let i = 0; i < 3; i++) { await page.evaluate(() => document.querySelector('[data-dv="trafficHalo"]').click()); labels.push((await btnState()).text); }
    ok('SL the traffic halo button cycles off, 4, 8, 16', labels.join(' | ') === 'traffic halo: off | traffic halo: 4 | traffic halo: 8 | traffic halo: 16', labels.join(' | '));
    await setOpt('trafficHalo', 0); await sleep(600);
    // 3. find a seed with an oncoming car in range: halo 8 draws quads
    let seed = 0, on = null, offPng = null, drawn = 0;
    for (const s of [1, 2, 3, 4, 5, 6]) {
      await setOpt('seed', s); await setOpt('trafficHalo', 0); await sleep(500); offPng = await frame(page);
      const dOff = await haloDrawn();
      await setOpt('trafficHalo', 8); await sleep(500); on = await frame(page); drawn = await haloDrawn();
      if (dOff !== 0) { ok('SL halo off draws no quad', false, 'drawn ' + dOff); break; }
      if (drawn > 0) { seed = s; break; }
    }
    ok('SL halo 8 draws quads for an oncoming car in range (a seed found in 1 to 6)', seed > 0, 'seed ' + seed + ' quads ' + drawn);
    if (seed) {
      const d = await diffBox(page, offPng, on);
      const frameArea = d.w * d.h, boxArea = d.box ? (d.box[2] - d.box[0] + 1) * (d.box[3] - d.box[1] + 1) : 0;
      ok('SL halo 8 changes the frame', d.n > 0, 'changed px ' + d.n);
      ok('SL the change stays in a box around the lamps (under 25 percent of the frame)', d.n > 0 && boxArea < 0.25 * frameArea, d.box ? 'box ' + JSON.stringify(d.box) + ' area ' + (boxArea / frameArea * 100).toFixed(1) + ' %' : 'no box');
      // 4. halo off again is the same frame as the first off capture (determinism of the off path)
      await setOpt('trafficHalo', 0); await sleep(500); const off2 = await frame(page);
      ok('SL halo off: the frame repeats (off path deterministic) and draws no quad', crypto.createHash('sha256').update(off2).digest('hex') === crypto.createHash('sha256').update(offPng).digest('hex') && (await haloDrawn()) === 0);
      // 5. main snapshot (optional): the halo-off frame is the main build's frame, byte for byte
      if (mainPort) {
        const mp = await context.newPage(); mp.on('pageerror', (e) => errors.push('main: ' + String(e)));
        await mp.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
        await mp.goto('http://127.0.0.1:' + mainPort + '/index.html'); await mp.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
        await mp.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await mp.evaluate(() => UX2Page.ready()); await sleep(1500);
        await mp.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0 }); RF.UI.redrawSpec(); });
        await mp.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 }).catch(() => {});
        await mp.evaluate(async (s) => { const V = RF.DriveAnim._.V, sl = (ms) => new Promise((r) => setTimeout(r, ms)); V.setOwn('trafficBeams', true); V.setOwn('oncoming', true); V.setOwn('preceding', false); V.setOwn('seed', s); V.setOwn('visibility', 60); await sl(1200); }, seed);
        await mp.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three', null, { timeout: 120000 }).catch(() => {});
        const mainOff = await frame(mp);
        const same = crypto.createHash('sha256').update(mainOff).digest('hex') === crypto.createHash('sha256').update(offPng).digest('hex');
        ok('SL halo off equals main byte for byte (same seed, fog 60)', same);
        await mp.close();
      }
    }
    ok('SL no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } finally { await browser.close(); }
  const fails = checks.filter((c) => !c.pass).length;
  console.log(fails ? fails + ' FAILED of ' + checks.length : 'all ' + checks.length + ' SL page checks passed');
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
