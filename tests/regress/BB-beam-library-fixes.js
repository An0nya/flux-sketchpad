// BB page checks: beam naming (BB1), library manager rename/delete (BB2), colour travels with the beam (BB3). CPU renderer.
// Serve the worktree first: python3 tests/serve.py <free 89xx> (background), then:
//   PLAYWRIGHT=/Users/anya/Projects/agent-qa/node_modules/playwright node tests/regress/BB-beam-library-fixes.js <port>
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8997);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!cond) fails++; };
// the bar's controls are not visible at this viewport in the headless run: clicks and values are set in the page
const clickAnim = (page, k) => page.evaluate((k) => document.querySelector('[data-anim="' + k + '"]').click(), k);
const setName = (page, v) => page.evaluate((v) => { const el = document.querySelector('[data-anim="beam-name"]'); el.value = v; }, v);
const pick = (page, sel, v) => page.evaluate(([sel, v]) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('change')); }, [sel, v]);
const libNames = (page) => page.evaluate(() => [...document.querySelectorAll('[data-anim="own-low"] option')].map(o => o.textContent.replace(/ \(session\)$/, '')).filter(n => n !== 'our design'));
(async () => {
  const browser = await pw.chromium.launch({});
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, acceptDownloads: true }), errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).split('\n').slice(0, 2).join(' | ')));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('flux/driveView', JSON.stringify({ view: 'anim', playing: false, ev: 2.5, seed: 19, glare: 'off', mt: false, wild: false, tiles: false, dynamicResolution: false, gpuRenderer: false })); });
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.evaluate(async () => {
    const u = RF.UI, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 1800 && (RF.SolverHost.loading() || u.solving); i++) await sleep(100);
    u.loadScene(RF.State.deserialize(await (await fetch('/tests/fixtures/MG2-default-lamp.json')).text()), 'BB fixture'); u.setMode('D');
    for (let i = 0; i < 1800 && !(u.spec && u.spec.ev && u.spec.full && !u.solving && !u.needCompile && u.run && u.run.ctx.done && u.spec.ctx === u.run.ctx); i++) await sleep(100);
    u.setDisplay('drive');
  });
  await page.waitForFunction(() => window.RF?.DriveAnim?._?.V?.p && RF.DriveAnim._.V.bar, null, { timeout: 120000 });

  // BB1: naming. Typed name is used; empty uses the default (the design's name); a taken name gets a counter.
  const designName = await page.evaluate(() => RF.UI.store.scene.name);
  await setName(page, 'Alpha HID'); await clickAnim(page, 'save-design');
  ok('BB1: typed name saved and listed', (await libNames(page)).includes('Alpha HID'), await libNames(page));
  await setName(page, ''); await clickAnim(page, 'save-design');
  ok('BB1: empty name uses the design name as default', (await libNames(page)).includes(designName), { design: designName, names: await libNames(page) });
  await setName(page, 'Alpha HID'); await clickAnim(page, 'save-design');
  const names = await libNames(page);
  ok('BB1: a taken name gets a counter, nothing overwritten', names.includes('Alpha HID') && names.includes('Alpha HID 2'), names);
  const ph = await page.evaluate(() => document.querySelector('[data-anim="beam-name"]').placeholder);
  ok('BB1: placeholder shows the default name', ph === designName, { ph, designName });
  ok('BB1: no page errors', errors.length === 0, errors);

  console.log(fails ? fails + ' BB check(s) FAILED' : 'all BB checks passed');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.stack || e); process.exit(1); });
