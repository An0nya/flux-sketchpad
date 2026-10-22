// SS-samples: the drive view's supersampling option (samples '1' default, '2', 'auto') round-trips through the select,
// persists, is cleared by ?reset, drives the stats() ss value, and changes the drive frame on a narrow canvas.
// Frame check: element screenshots of the drive canvas (paused view), compared by sha256, one renderer, one run.
// Run: python3 tests/serve.py 8994, then
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/SS-samples.js 8994
// Exits 1 on any failure.
const pw = require(process.env.PLAYWRIGHT || '/Users/anya/Projects/agent-qa/node_modules/playwright');
const crypto = require('crypto');
const port = +(process.argv[2] || 8994);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [], ok = (name, pass, detail) => { checks.push(!!pass); console.log((pass ? '[PASS] ' : '[FAIL] ') + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); };
(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
    const page = await context.newPage();
    await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204, body: '' }));
    page.on('pageerror', (e) => errors.push(String(e)));
    const boot = async (url) => {
      await page.goto(url);
      await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
      await page.addScriptTag({ url: '/tests/regress/UX2-drive-ux.js' });
      await page.evaluate(() => UX2Page.ready());
      await sleep(1500);
    };
    // Same steps as UX2Page.ready() but with no option overrides, so the stored default is what we read.
    const rawDriveBoot = async () => {
      await page.evaluate(async () => {
        const u = RF.UI;
        u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'SS fixture');
        u.setMode('D');
      });
      await page.waitForFunction(() => { const u = RF.UI; return u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx; }, null, { timeout: 120000 });
      await page.evaluate(() => { const u = RF.UI; u.setDisplay('drive'); u.setPane('result', 'activate'); document.querySelector('.result-pane').classList.add('expanded'); });
      await page.waitForFunction(() => !!RF.UI.dvOpts && !!RF.UI.driveBar?.querySelector('[data-dv="samples"]'), null, { timeout: 60000 });
      await sleep(1500);
    };
    const setSamples = (v) => page.evaluate(async (v) => {
      const sel = RF.UI.driveBar.querySelector('[data-dv="samples"]');
      sel.value = v; sel.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 300));
    }, v);
    const state = () => page.evaluate(() => ({
      opt: RF.UI.dvOpts.samples,
      sel: RF.UI.driveBar.querySelector('[data-dv="samples"]')?.value,
      stored: (() => { try { return JSON.parse(localStorage.getItem('flux/driveView') || '{}').samples; } catch (e) { return 'err'; } })(),
      ss: RF.DriveAnim.stats().ss,
    }));
    // drive canvas frame: paused view, element screenshot (composited, so no preserveDrawingBuffer problem), sha256
    const frameHash = async (samples, pin) => {
      await page.evaluate(([s, p]) => { RF.UI.dvOpts.samples = s; RF.DriveAnim._.V.pinSS = p; if (s === 'auto' && !p) { RF.DriveAnim._.V.ss = 2; RF.DriveAnim._.V.avg = 0; RF.DriveAnim._.V.calm = 0; } RF.UI.dvAnim.playing = false; RF.UI.redrawSpec(); }, [samples, pin]);
      await sleep(1200);
      const buf = await page.locator('[data-ss-test]').screenshot();
      return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    };

    console.log('[INFO] renderer ' + await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const d = g && g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));

    // 1. fresh profile: default is '1'
    await context.clearCookies();
    await page.addInitScript(() => { if (!sessionStorage.getItem('ss-test-seeded')) { localStorage.clear(); sessionStorage.setItem('ss-test-seeded', '1'); } });
    await page.goto('http://127.0.0.1:' + port + '/index.html');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await rawDriveBoot();
    let s = await state();
    ok('default samples is 1 on a fresh profile', s.opt === '1' && s.sel === '1', s);
    ok('default 1 gives stats().ss 1', s.ss === 1, { ss: s.ss });

    // 2. select round trip with persistence and stats follow
    await setSamples('2'); s = await state();
    ok('samples 2 is stored and selected', s.opt === '2' && s.sel === '2' && s.stored === '2', s);
    ok('samples 2 gives stats().ss 2', s.ss === 2, { ss: s.ss });
    await setSamples('auto'); s = await state();
    ok('samples auto is stored and selected', s.opt === 'auto' && s.sel === 'auto' && s.stored === 'auto', s);
    await setSamples('1'); s = await state();
    ok('samples back to 1 gives stats().ss 1', s.opt === '1' && s.ss === 1, s);

    // 3. frame check on a narrow canvas (sim width <= 1100), same renderer, same run
    await page.evaluate(() => RF.DriveAnim._.V.canvas.setAttribute('data-ss-test', '1'));
    const simW = await page.evaluate(() => RF.DriveAnim.stats().sim?.[0]);
    ok('narrow canvas: sim width <= 1100', simW !== undefined && simW <= 1100, { simW });
    const h1 = await frameHash('1', 0), h1b = await frameHash('1', 0);
    ok('same state twice gives the same frame (determinism)', h1 === h1b, { h1, h1b });
    const h2 = await frameHash('2', 0);
    ok('samples 1 frame differs from samples 2 frame', h1 !== h2, { h1, h2 });
    const hAuto = await frameHash('auto', 0);
    const hPin2 = await frameHash('auto', 2);
    ok("samples auto frame equals the old default (V.pinSS = 2) frame", hAuto === hPin2, { auto: hAuto, pinSS2: hPin2 });
    await frameHash('1', 0);

    // 4. ?reset returns to the default (1) and clears the saved option
    await setSamples('2');
    await page.goto('http://127.0.0.1:' + port + '/index.html?reset');
    await page.waitForFunction(() => window.RF?.UI?.loadScene, null, { timeout: 60000 });
    await sleep(1500);
    // ?reset is safe mode and clears the saved Drive options before the Drive view reads them (UX3): the saved option must be gone.
    const saved = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('flux/driveView') || '{}').samples; } catch (e) { return 'err'; } });
    ok('?reset clears the saved samples option (back to the default 1)', saved === undefined || saved === '1', { saved });
  } finally { await browser.close(); }
  const fails = checks.filter((c) => !c).length;
  if (errors.length) console.log('[FAIL] SS-samples page errors ' + JSON.stringify(errors));
  console.log((fails || errors.length ? '[FAIL]' : '[PASS]') + ' SS-samples ' + (checks.length - fails) + '/' + checks.length);
  process.exitCode = fails || errors.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
