// GS1 page checks: glareSources wired live (Brief T item 1). Urban tile at night, sodium street lamps, glare on, GPU drive renderer.
//  1. default (option unset) equals explicit 'oncoming' (bytes): the default call is exactly the old one. If a main port is given (argv[3]),
//     the default frame also equals the main build's frame byte for byte.
//  2. 'all' lists more glare sources than 'oncoming' (street lamps join), and changes the frame (the veil differs).
//  3. off after on: 'oncoming' again equals the first frame (bytes).
//  4. the select (data-dv=glareSources) is in the More panel and reads back the stored value.
// Run: python3 tests/serve.py <port> ; PLAYWRIGHT=... node tests/regress/GS1-glare-sources.js <port> [mainPort]   (env SHOTS=<dir> saves the frames)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const port = +(process.argv[2] || 8985), mainPort = process.argv[3] ? +process.argv[3] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push({ name, pass: !!pass }); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail ? ' - ' + detail : '')); };
const errors = [];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SHOTS = process.env.SHOTS || '';
async function open(p) {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1400 } })).newPage();
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + p + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
  await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
  await page.setViewportSize({ width: 1920, height: 1400 }); await sleep(1500);
  await page.evaluate(() => {
    const u = RF.UI, D = RF.DriveAnim;
    Object.assign(u.dvOpts, { scene: 'road', gpuRenderer: true, detailedModels: true, deerBehaviour: false, animals: false, people: false, trafficLogic: false, oncoming: false, preceding: false, lampHalos: 'off', wet: false, wetSheen: false, visibility: null, scatter: 0, trafficHalo: 0, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', glare: 'dry', onMode: 'generic', tiles: true, streetLamps: 'sodium' });
    delete u.dvOpts.glareSources;
    const tile = Array.from({ length: 160 }, (_, k) => D.roadTile(7, k)).find((t) => t.kind === 'urban');
    Object.assign(u.dvAnim, { view: 'anim', dist: tile.s0 + 55, t: 2, playing: false });
    u.redrawSpec();
  });
  await page.waitForFunction(() => RF.DriveAnim.stats().renderer === 'three' || RF.DriveAnim.stats().gpuFailure, null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
  return { browser, page };
}
const frame = async (page) => {
  await sleep(700);
  await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sl-drive', '1'));
  return page.locator('canvas[data-sl-drive="1"]').screenshot();
};
const setGS = (page, v) => page.evaluate((v) => { if (v === undefined) { delete RF.UI.dvOpts.glareSources; RF.UI.redrawSpec(); } else RF.DriveAnim._.V.setOwn('glareSources', v); }, v).then(() => sleep(1000));
const nSrc = (page) => page.evaluate(() => (RF.DriveAnim._.V.frameGlare || []).length);

(async () => {
  let A = null, M = null;
  try {
    A = await open(port);
    const { page } = A;
    const rs = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
    console.log('GPU: ' + rs);
    ok('GS1 GPU renderer is on', (await page.evaluate(() => RF.DriveAnim.stats().renderer)) === 'three');
    const f0 = await frame(page), n0 = await nSrc(page);
    await setGS(page, 'oncoming');
    const f1 = await frame(page);
    ok("GS1 unset equals explicit 'oncoming' (bytes)", sha(f0) === sha(f1), sha(f0).slice(0, 12) + ' vs ' + sha(f1).slice(0, 12));
    if (mainPort) {
      M = await open(mainPort); const fm = await frame(M.page);
      ok('GS1 default frame equals the main build (bytes)', sha(fm) === sha(f0), sha(fm).slice(0, 12) + ' vs ' + sha(f0).slice(0, 12));
    }
    await setGS(page, 'all');
    const f2 = await frame(page), n2 = await nSrc(page);
    ok("GS1 'all' lists more glare sources than 'oncoming'", n2 > n0, n0 + ' -> ' + n2);
    ok("GS1 'all' changes the frame", sha(f2) !== sha(f0));
    const ui = await page.evaluate(() => { const s = document.querySelector('[data-dv="glareSources"]'); return s ? { value: s.value, inMore: !!s.closest('.drive-more') } : null; });
    ok("GS1 select (data-dv=glareSources) is in the More panel and reads 'all'", !!(ui && ui.inMore && ui.value === 'all'), JSON.stringify(ui));
    await setGS(page, 'oncoming');
    const f3 = await frame(page);
    ok("GS1 'oncoming' after 'all' equals the first frame (bytes)", sha(f3) === sha(f0), sha(f3).slice(0, 12) + ' vs ' + sha(f0).slice(0, 12));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'glare-oncoming.png'), f0); fs.writeFileSync(path.join(SHOTS, 'glare-all.png'), f2); }
    ok('GS1 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('GS1 ran to completion', false, String(e && e.message || e));
  } finally { if (A) await A.browser.close(); if (M) await M.browser.close(); }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`GS1: ${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
