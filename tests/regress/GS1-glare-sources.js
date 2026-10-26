// GS1 page checks: the one glare path (Brief U; the glareSources option is gone). Urban tile at night, sodium street lamps, glare on, GPU drive renderer.
//  1. every source feeds the veil: the frame lists street lamps as sources (the former 'all'), each with an rgb; no select (data-dv=glareSources) exists.
//  2. a saved profile that still holds glareSources is migrated: the key is dropped on load (RF.Options.migrateProfile), and a stale key left in dvOpts changes nothing (bytes).
//  3. colour: the glare-on frame minus the glare-off frame is warm (sodium): more red than blue summed over the pixels glare added (a white veil would give equal red and blue).
//  4. glare off: no veil, no sources needed: the frame has no added light (diff to itself is nil) and glare on adds light only (no pixel gets darker).
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
    Object.assign(u.dvOpts, { scene: 'road', gpuRenderer: true, detailedModels: true, deerBehaviour: false, animals: false, people: false, trafficLogic: false, oncoming: false, preceding: false, wet: false, wetSheen: false, visibility: null, scatter: 0, trafficHalo: 0, expMode: 'fixed', ev: 1, dynamicResolution: false, samples: '1', glare: 'dry', onMode: 'generic', tiles: true, streetLamps: 'sodium' });
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
    const srcs = await page.evaluate(() => (RF.DriveAnim._.V.frameGlare || []).map((q) => q.map((v) => +v.toFixed(3))));
    ok('GS1 street lamps are glare sources by default (no option)', n0 > 0 && srcs.every((q) => q.length === 7), n0 + ' sources');
    ok('GS1 the sodium street lamps carry their tint [1, 0.43, 0.1]', srcs.some((q) => Math.abs(q[4] - 1) < 1e-3 && Math.abs(q[5] - 0.43) < 1e-3 && Math.abs(q[6] - 0.1) < 1e-3), JSON.stringify(srcs.slice(0, 2)));
    const ui = await page.evaluate(() => !!document.querySelector('[data-dv="glareSources"]'));
    ok('GS1 there is no glareSources select', !ui);
    const mig = await page.evaluate(() => RF.Options.migrateProfile({ glareSources: 'all', ev: 1 }).profile);
    ok('GS1 a saved glareSources is dropped on load, other keys kept', !('glareSources' in mig) && mig.ev === 1, JSON.stringify(mig));
    await page.evaluate(() => { RF.UI.dvOpts.glareSources = 'oncoming'; RF.UI.redrawSpec(); }); await sleep(1000);
    const f1 = await frame(page);
    ok('GS1 a stale glareSources key in the options change nothing (bytes)', sha(f0) === sha(f1), sha(f0).slice(0, 12) + ' vs ' + sha(f1).slice(0, 12));
    await page.evaluate(() => { delete RF.UI.dvOpts.glareSources; });
    // colour of the added light: canvas pixels, glare on vs off, same pose
    const px = async (glare) => { await page.evaluate((g) => { RF.UI.dvOpts.glare = g; RF.UI.redrawSpec(); }, glare); await sleep(1200); return page.evaluate(() => { RF.DriveAnim._.frame(); return Array.from(RF.DriveAnim._.readCanvas()); }); };
    const on = await px('dry'), off = await px('off');
    let dr = 0, dg = 0, db = 0, darker = 0, added = 0; for (let i = 0; i < on.length; i += 4) { const a = on[i] - off[i], g = on[i + 1] - off[i + 1], b = on[i + 2] - off[i + 2]; if (a < -1 || g < -1 || b < -1) darker++; if (a > 0 || g > 0 || b > 0) { added++; dr += Math.max(0, a); dg += Math.max(0, g); db += Math.max(0, b); } }
    ok('GS1 glare on adds light and never darkens a pixel', added > 0 && darker === 0, 'added px ' + added + ', darker ' + darker);
    ok('GS1 the added glare is warm (sodium): red sum > green sum > blue sum', dr > dg && dg > db, 'R ' + dr + ' G ' + dg + ' B ' + db);
    await page.evaluate(() => { RF.UI.dvOpts.glare = 'dry'; RF.UI.redrawSpec(); }); await sleep(1200);
    const f2 = await frame(page);
    ok('GS1 glare back on equals the first frame (bytes)', sha(f2) === sha(f0), sha(f2).slice(0, 12) + ' vs ' + sha(f0).slice(0, 12));
    if (mainPort) { M = await open(mainPort); const fm = await frame(M.page); ok('GS1 (info) the main build differs: its default glare was headlamps only', sha(fm) !== sha(f0), sha(fm).slice(0, 12) + ' vs ' + sha(f0).slice(0, 12)); }
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'glare.png'), f0); }
    ok('GS1 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('GS1 ran to completion', false, String(e && e.message || e));
  } finally { if (A) await A.browser.close(); if (M) await M.browser.close(); }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`GS1: ${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
