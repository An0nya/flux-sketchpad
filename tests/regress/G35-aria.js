// G35: layout chrome exposes its state (aria-expanded / aria-pressed / aria-checked / aria-valuenow).
// node tests/regress/G35-aria.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8833);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const open = async (browser, vp, setup) => { const page = await browser.newPage({ viewport: vp || { width: 1500, height: 950 } }); page.on('pageerror', (e) => ok('no page error', false, String(e)));
  if (setup) await page.addInitScript(setup);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 }); await page.waitForTimeout(500);
  if (!(await page.evaluate(() => !!(RF.UI && RF.UI.layout)))) throw new Error('not the Flux page'); return page; };
(async () => {
  const browser = await pw.chromium.launch(); const page = await open(browser);
  const q = (sel, attr) => page.evaluate(([sel, attr]) => [...document.querySelectorAll(sel)].map((b) => b.getAttribute(attr)), [sel, attr]);
  ok('collapse buttons: aria-expanded true when open', (await q('button.collapse', 'aria-expanded')).every((v) => v === 'true'), (await q('button.collapse', 'aria-expanded')).join());
  await page.evaluate(() => RF.UI.setPane('editor', 'collapse')); await page.waitForTimeout(500);
  ok('... false for the collapsed Editor only', JSON.stringify(await q('button.collapse', 'aria-expanded')) === '["true","false","true","true"]', (await q('button.collapse', 'aria-expanded')).join());
  ok('expand buttons: aria-pressed false, then true for the expanded pane', (await q('[data-expand]', 'aria-pressed')).every((v) => v === 'false'));
  await page.evaluate(() => RF.UI.setPane('optics', 'expand')); await page.waitForTimeout(500);
  ok('... Optics expand pressed', JSON.stringify(await q('[data-expand]', 'aria-pressed')) === '["false","false","false","true"]', (await q('[data-expand]', 'aria-pressed')).join());
  ok('Result view buttons are radios with aria-checked (Grid checked)', JSON.stringify(await q('#heat-display button', 'role')) === JSON.stringify(Array(7).fill('radio')) && (await page.evaluate(() => [...document.querySelectorAll('#heat-display button')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.disp))).join() === 'grid');
  await page.evaluate(() => RF.UI.setDisplay('smooth')); 
  ok('... and follows the view', (await page.evaluate(() => [...document.querySelectorAll('#heat-display button')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.disp))).join() === 'smooth');
  const v = await q('.divider', 'aria-valuenow');
  ok('separators carry aria-valuenow (percent)', v.every((x) => x !== null && +x >= 10 && +x <= 90), v.join());
  await page.setViewportSize({ width: 600, height: 900 }); await page.waitForTimeout(700);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[data-tab]')].map((b) => [b.getAttribute('aria-pressed'), b.classList.contains('on')]));
  ok('phone tabs: aria-pressed matches the active tab', tabs.length === 4 && tabs.every(([a, on]) => a === String(on)) && tabs.filter((t) => t[1]).length === 1, JSON.stringify(tabs));
  await page.evaluate(() => document.querySelector('[data-tab="scene"]').click()); await page.waitForTimeout(300);
  ok('... and follows a tab change', (await q('[data-tab]', 'aria-pressed')).join() === 'true,false,false,false');
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
