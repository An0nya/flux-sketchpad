// UX3: (1) ?reset (and ?safe) clear the saved Drive options before the Drive view reads them; without the rescue URL they are kept.
// (2) the FPS badge does not count a pause as a frame: after pausing for 2 s it reads "paused", never a ms mean above 100. Run:
//   python3 tests/serve.py <port> &  PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/UX3-safe-reset-fps.js <port>
// Headless Chrome with software GL: timings are headless, not the owner's GPU.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const port = +(process.argv[2] || 8743), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (n, c, d) => { console.log((c ? '[PASS] ' : '[FAIL] ') + n + (d ? ' — ' + d : '')); if (!c) fails++; };
const HEAVY = { scatterRes: 'full', trafficHalo: 16, fpsCounter: true, playing: true, view: 'anim' };
const base = 'http://127.0.0.1:' + port + '/index.html';
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] }), errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const load = async (url) => { await page.goto(url); await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 }); await sleep(800); };
    const stored = () => page.evaluate(() => localStorage.getItem('flux/driveView'));
    const setHeavy = () => page.evaluate((h) => localStorage.setItem('flux/driveView', JSON.stringify(h)), HEAVY);

    // (1) ?reset clears the saved options and turns on safe mode
    await load(base); await setHeavy();
    await load(base + '?reset');
    const afterReset = await stored();
    ok('UX3 ?reset removes the saved flux/driveView key', afterReset === null, 'stored=' + String(afterReset).slice(0, 80));
    ok('UX3 ?reset also sets safeMode (one rescue URL)', (await page.evaluate(() => RF.UI.safeMode)) === true);

    // (1b) ?safe clears the saved options too
    await load(base); await setHeavy();
    await load(base + '?v=2#safe');   // a different URL, so this is a real load and not a same-document hash change
    ok('UX3 #safe removes the saved flux/driveView key', (await stored()) === null);

    // (1c) no rescue URL keeps the saved options
    await load(base); await setHeavy();
    await load(base);
    const kept = JSON.parse((await stored()) || 'null');
    ok('UX3 plain load keeps saved drive options', !!kept && kept.scatterRes === 'full' && kept.trafficHalo === 16, JSON.stringify(kept));

    // (2) FPS badge during pause. Entry is the UX2 helper (fixture scene, Drive display, GPU renderer), then Play, 2 s, Pause, 2 s.
    await setHeavy(); await load(base);
    await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' }); await page.evaluate(() => UX2Page.ready()); await sleep(1500);
    const press = () => page.evaluate(() => { const b = RF.UI.driveBar && RF.UI.driveBar.querySelector('[data-anim=play]'); if (!b) return false; b.click(); return true; });
    ok('UX3 found the Drive play button', await press());
    await sleep(2000);
    const playing = await page.evaluate(() => RF.DriveAnim._.V.fpsLab.textContent);
    ok('UX3 playing: badge shows fps and ms', /ms mean/.test(playing), 'badge=' + JSON.stringify(playing));
    await press();
    await sleep(2000);
    const badge = await page.evaluate(() => RF.DriveAnim._.V.fpsLab.textContent);
    const mean = parseFloat((badge.match(/([\d.]+) ms mean/) || [])[1]);
    ok('UX3 FPS badge reads "paused" while paused', /paused/.test(badge), 'badge=' + JSON.stringify(badge));
    const win = await page.evaluate(() => (RF.DriveAnim._.V.frameMs || []).slice());
    ok('UX3 the frame-time window is empty while paused (pause gap not recorded)', win.length === 0, 'n=' + win.length + ' max=' + (win.length ? Math.max(...win).toFixed(1) : '-'));
    ok('UX3 FPS badge has no ms mean above 100 after a 2 s pause', !/ms mean/.test(badge) || mean <= 100, 'badge=' + JSON.stringify(badge) + ' (headless, software GL)');
    ok('UX3 nothing throws', errors.length === 0, errors.slice(0, 2).join(' | '));
  } finally { await browser.close(); }
  console.log(fails ? fails + ' UX3 checks FAILED' : 'all UX3 checks passed'); process.exit(fails ? 1 : 0);
})();
