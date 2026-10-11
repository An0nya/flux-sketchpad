// G36: narrowing the window to <= 1024 px closes the sidebar (it would otherwise overlay the panes).
// node tests/regress/G36-sidebar-narrow.js [port]   (needs a server: python3 tests/serve.py <port>)
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
  const browser = await pw.chromium.launch(); const page = await open(browser, { width: 1400, height: 900 });
  const hidden = () => page.evaluate(() => document.body.classList.contains('side-hidden'));
  ok('wide: sidebar open', !(await hidden()));
  await page.setViewportSize({ width: 900, height: 900 }); await page.waitForTimeout(600);
  ok('narrowed to 900: sidebar closed', await hidden());
  await page.click('#btn-side'); await page.waitForTimeout(300);
  ok('... and can be opened by hand as an overlay', !(await hidden()));
  await page.setViewportSize({ width: 880, height: 900 }); await page.waitForTimeout(600);
  ok('further narrowing (still <= 1024) leaves a hand-opened sidebar alone', !(await hidden()));
  await page.setViewportSize({ width: 1400, height: 900 }); await page.waitForTimeout(600);
  await page.setViewportSize({ width: 1000, height: 900 }); await page.waitForTimeout(600);
  ok('crossing 1024 again closes it again', await hidden());
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
