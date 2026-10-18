// AM checks: tiles on by default in a fresh browser; the ambient-light control lives in the drive More controls
// (and is no longer in the sidebar); a stored {"tiles":false} still wins; ambient changes the rendered frame.
// Run: node tests/regress/AM-ambient-tiles.js 8945   (server: python3 tests/serve.py 8945)
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8945);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openPage(browser, stored) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await context.newPage(), errors = [];
  // The test server has no favicon; satisfy only that request so every other console error stays strict.
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(stored => { localStorage.clear(); if (stored) localStorage.setItem('flux/driveView', JSON.stringify(stored)); }, stored || null);
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => window.RF?.UI?.loadScene);
  // Drive controls are built only when the drive pane is drawn: switch to Drive mode, then the Drive tab (data-disp=drive).
  await page.evaluate(() => RF.UI.setMode('D')); await sleep(1500); await page.click('button[data-disp=drive]');
  await page.waitForFunction(() => document.querySelector('[data-anim="tiles"]') && document.querySelector('select[data-anim="ambient"]'), null, { timeout: 90000 });
  await sleep(600);
  return { context, page, errors };
}

// Read the state the page actually uses: the tiles button (aria-pressed, from the merged options) and the ambient select. dvOpts is built lazily by the drive, so it may be absent.
const readState = page => page.evaluate(() => {
  const tilesBtn = document.querySelector('[data-anim="tiles"]'), amb = document.querySelector('select[data-anim="ambient"]');
  return {
    tiles: RF.UI.dvOpts ? RF.UI.dvOpts.tiles : 'dvOpts not built',
    tilesPressed: tilesBtn ? tilesBtn.getAttribute('aria-pressed') : 'no button',
    ambientInDriveExtras: !!amb && RF.UI.driveExtras.contains(amb),
    ambientOptions: amb ? [...amb.options].map(o => o.value) : [],
    ambientValue: amb ? amb.value : null,
    sidebarHasAmbientRow: document.body.textContent.includes('Drive view: ambient light'),
  };
});

// Set the ambient select (as a user would: change its value, fire change), let the drive redraw, then read mean frame luminance.
async function setAmbient(page, value) {
  await page.evaluate(value => { const s = document.querySelector('select[data-anim="ambient"]'); s.value = value; s.dispatchEvent(new Event('change')); }, value);
  await sleep(400);
}
const meanFrame = page => page.evaluate(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms)), a = RF.DriveAnim._, st = a.S(RF.UI);
  st.playing = false; RF.UI.redrawSpec(); await sleep(400); a.frame();
  const c = a.V.canvas, t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const x = t.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, t.width, t.height).data; let s = 0;
  for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return { mean: s / (d.length / 4), w: t.width, h: t.height };
});

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chromium' });
  const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); };
  let context;
  try {
    // 1. fresh browser: tiles on, ambient control in the drive More controls, no sidebar copy
    let p = await openPage(browser, null); context = p.context;
    let s = await readState(p.page);
    ok('AM fresh browser: tiles on by default', s.tiles === true && s.tilesPressed === 'true', s);
    ok('AM ambient control is in the drive More controls', s.ambientInDriveExtras && JSON.stringify(s.ambientOptions) === '["0","0.2","5"]', s);
    ok('AM ambient control default is None (0)', s.ambientValue === '0', s);
    ok('AM sidebar no longer has the ambient row', !s.sidebarHasAmbientRow, s);
    ok('AM fresh browser: no console/page errors', p.errors.length === 0, p.errors);
    // 2. ambient changes the frame; unchanged option gives the same frame (positive control)
    await p.page.evaluate(() => { RF.UI.dvAnim.view = 'anim'; RF.UI.redrawSpec(); });
    await sleep(300);
    await setAmbient(p.page, '0'); const f0 = await meanFrame(p.page);
    await setAmbient(p.page, '5'); const f5 = await meanFrame(p.page);
    await setAmbient(p.page, '5'); const f5b = await meanFrame(p.page);
    ok('AM ambient 5 lx renders brighter than none', f5.mean > f0.mean * 1.05, { none: f0.mean, dusk: f5.mean, size: [f0.w, f0.h] });
    ok('AM positive control: unchanged ambient gives unchanged frame', Math.abs(f5b.mean - f5.mean) < 1e-6, { first: f5.mean, again: f5b.mean });
    ok('AM ambient control reflects stored option', (await readState(p.page)).ambientValue === '5');
    ok('AM ambient rendering: no console/page errors', p.errors.length === 0, p.errors);
    await context.close();

    // 3. stored {"tiles":false} from an older browser still loads with tiles off
    p = await openPage(browser, { view: 'anim', playing: false, tiles: false }); context = p.context;
    s = await readState(p.page);
    ok('AM stored tiles:false still loads with tiles off', s.tiles === false && s.tilesPressed === 'false', s);
    ok('AM stored tiles:false: no console/page errors', p.errors.length === 0, p.errors);
    await context.close();
  } finally { await browser.close(); }
  const failed = checks.some(c => !c);
  console.log(failed ? 'AM FAILED' : 'all AM page checks passed'); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
