// HALO-WAVE-diag throwaway probe: open the page with the SL-traffic-halo recipe and print camera + lamp state.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8991);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const info = await page.evaluate(() => RF.DriveAnim.stats());
    console.log('stats', JSON.stringify(info).slice(0, 400));
    const out = await page.evaluate(async () => {
      const V = RF.DriveAnim._.V, p = V.p;
      const keys = Object.keys(p);
      return { keys, eye: p.eye, hfov: p.hfov, pitch: p.pitch, yaw: p.yaw, w: p.w, h: p.h, dist: RF.DriveAnim._.S(RF.UI).dist, lookKeys: Object.keys(p.look || {}).slice(0, 60), hs: V.three.haloState() , dvKeys: Object.keys(RF.UI.dvOpts).slice(0,80)};
    });
    console.log(JSON.stringify(out, null, 0).slice(0, 4000));
    console.log('errors', errs.slice(0, 5));
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
