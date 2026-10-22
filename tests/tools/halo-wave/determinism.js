// HALO-WAVE-diag throwaway: repeat-frame determinism at D=50 (halo 4), and halo 4 vs 16 with the one car (two lamps in range). Headless.
// node determinism.js <port> <outDir>
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8991), OUT = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204, body: '' }));
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    await page.evaluate(() => { Object.assign(RF.UI.dvOpts, { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: null, scatter: 0, trafficHalo: 0, scene: 'road' }); RF.UI.redrawSpec(); });
    await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
    const setOpt = (k, v) => page.evaluate(([k, v]) => RF.DriveAnim._.V.setOwn(k, v), [k, v]);
    await setOpt('trafficBeams', true); await setOpt('oncoming', true); await setOpt('preceding', false); await setOpt('seed', 1);
    for (const [k, v] of [['glare', false], ['tex', false], ['tiles', false], ['wetSheen', false], ['wet', false], ['scatter', 0], ['speed', 0], ['visibility', 60]]) await setOpt(k, v);
    await page.evaluate(() => { const c = RF.DriveAnim._.V.canvas; c.style.width = c.width + 'px'; c.style.height = c.height + 'px'; });
    await setOpt('trafficHalo', 4); await sleep(800);
    const lampDist = async () => { const s = await page.evaluate(() => RF.DriveAnim._.V.three.haloState()); const e = await page.evaluate(() => RF.DriveAnim._.V.p.eye); return s.lamps.length ? s.lamps[0].lamp[0] - e[0] : null; };
    for (let i = 0; i < 8; i++) { const d = await lampDist(); if (d === null) break; if (Math.abs(d - 50) < 1.5) break; await page.evaluate((delta) => { const st = RF.DriveAnim._.S(RF.UI); st.dist += delta; RF.DriveAnim._.frame(); }, d - 50); await sleep(700); }
    const shot = async (name) => { await sleep(2200); await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1')); const b = await page.locator('canvas[data-sl-drive="1"]').screenshot(); fs.writeFileSync(OUT + '/' + name + '.png', b); console.log(name, 'lamps', (await page.evaluate(() => RF.DriveAnim._.V.three.haloState())).lamps.length, 'dist', (await lampDist()).toFixed(2)); return name; };
    await shot('det_h4_a'); await shot('det_h4_b');
    await setOpt('trafficHalo', 16); await sleep(800); await shot('det_h16');
    await setOpt('trafficHalo', 4); await sleep(800); await shot('det_h4_c');
    console.log('done');
  } finally { await browser.close(); }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
