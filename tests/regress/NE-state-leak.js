// NE-state-leak: OPEN, not in the curated gate (listed under the known-failing names in tests/gate.js). Run it by hand:
//   python3 tests/serve.py <port> (background), then PLAYWRIGHT=... node tests/regress/NE-state-leak.js <port>
//
// What it shows: a table-off frame taken at the end of a particular order of table settings does not equal the frame taken at
// the start (and main's c033bd7c). The order is: off, cache on (cycle 8) with six manual frames, the slice text (valid, invalid,
// empty), all five quality presets, quarter resolution, then quality steps. In NE-near-eye.js this gave 60195c37 instead of c033bd7c
// (NE3, NE4). Each step on its own, from a fresh page, returns to c033bd7c, so the cause is an order-dependent state, not a single setting.
// We have NOT explained it. Do not weaken the check: it is expected to FAIL until the cause is found and fixed.
// Exits 1 when the final frame differs from the first off frame.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8994);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  let fails = 0;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    await page.goto('http://127.0.0.1:' + port + '/index.html'); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const settle = () => page.evaluate(() => { let n = 0; while (RF.UI.dvOpts.scatterMode === 'table' && globalThis.SD_SCATTER.cache && globalThis.SD_SCATTER.pending > 0 && n < 4000) { RF.DriveAnim._.frame(); n++; } return n; });
    const base = { wet: false, wetness: 0, wetSheen: false, fpsCounter: false, visibility: 200, scatter: 48, scatterMode: 'table', scatterRes: 'half', scatterBlur: 'off', scatterTableSteps: 48, scatterNearFadeRange: 'medium', scatterNearBias: 0, scatterBinCounts: '', scatterQuality: 'steps', scatterCache: 'off', scatterCycle: 0 };
    const opts = (o) => page.evaluate((x) => { Object.assign(RF.UI.dvOpts, x); RF.UI.redrawSpec(); }, Object.assign({}, base, o));
    const shot = async () => { await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-sc-drive', '1')); const png = await page.locator('canvas[data-sc-drive="1"]').screenshot(); return crypto.createHash('sha256').update(png).digest('hex').slice(0, 12); };
    const frame = async (label, o) => { await opts(o); await sleep(2500); await settle(); const h = await shot(); console.log(label.padEnd(36), h); return h; };
    const setBin = (str) => page.evaluate((v) => { const s = document.querySelector('[data-dv="scatterBinCounts"]'); s.value = v; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); }, str);
    const A = await frame('1 table 48 off (first)', {});
    await opts({ scatterCache: 'on', scatterCycle: 8, scatterNearBias: 1 }); await sleep(2500); await settle();
    for (let i = 0; i < 6; i++) { await page.evaluate(() => RF.DriveAnim._.frame()); await sleep(300); await shot(); }
    await setBin('2,2,2,2,4,4,4,4,4,2,2,2'); await sleep(2500); await settle();
    await setBin('1,2,3'); await sleep(2500); await settle();
    await setBin(''); await sleep(2500); await settle();
    await opts({ scatterCache: 'off', scatterCycle: 0, scatterNearBias: 0 }); await sleep(2500); await settle();
    for (const q of ['baseline', 'low', 'medium', 'high', 'max']) await frame('preset ' + q, { scatterQuality: q });
    await frame('quarter res', { scatterQuality: 'steps', scatterRes: 'quarter' });
    const last = await frame('steps (expected = first)', { scatterQuality: 'steps', scatterRes: 'half', scatterCache: 'off', scatterCycle: 0, scatterNearBias: 0 });
    const same = last === A;
    console.log((same ? '[PASS] ' : '[FAIL] ') + 'OPEN leak check: the final frame equals the first off frame (' + A + ' vs ' + last + ')');
    if (!same) fails++;
  } catch (e) {
    console.log('[FAIL] run error: ' + String(e).slice(0, 300)); fails++;
  } finally {
    await browser.close();
  }
  process.exitCode = fails ? 1 : 0;
})();
