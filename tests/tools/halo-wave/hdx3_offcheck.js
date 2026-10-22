// HDX3 throwaway: halo-off stability. Renders off (first), on, off (after toggling) at the SL fixture (fog 60, one car at ~35 m); prints sha of each off.
const crypto = require('crypto');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1); await setOpt('visibility', 60);
    await setOpt('trafficHalo', 0); await sleep(2200);
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
    const sha = async () => crypto.createHash('sha256').update(await page.locator('canvas[data-sl-drive="1"]').screenshot()).digest('hex').slice(0, 10);
    const a = await sha();
    await setOpt('trafficHalo', 16); await sleep(2200); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1')); const on = await sha();
    await setOpt('trafficHalo', 0); await sleep(2200); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1')); const b = await sha();
    console.log(JSON.stringify({ port, off_first: a, on: on, off_after_toggle: b }));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
