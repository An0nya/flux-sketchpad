// G34: ending an expand by dragging a divider must not make the other splits jump; "off" dividers are inert.
// node tests/regress/G34-dividers.js [port]   (needs a server: python3 tests/serve.py <port>)
const pw = require(process.env.PLAYWRIGHT || (require('child_process').execSync('npm root -g').toString().trim() + '/playwright'));
const port = +(process.argv[2] || 8833);
let fails = 0; const ok = (name, cond, detail) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (detail ? '  — ' + detail : '')); if (!cond) fails++; };
const open = async (browser, vp, setup) => { const page = await browser.newPage({ viewport: vp || { width: 1500, height: 950 } }); page.on('pageerror', (e) => ok('no page error', false, String(e)));
  if (setup) await page.addInitScript(setup);
  await page.goto('http://localhost:' + port + '/index.html');
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 }); await page.waitForTimeout(500);
  if (!(await page.evaluate(() => !!(RF.UI && RF.UI.layout)))) throw new Error('not the Flux page'); return page; };
const cols = (page) => page.evaluate(() => ({ w: getComputedStyle(workspace).gridTemplateColumns, r: getComputedStyle(right).gridTemplateRows, p: getComputedStyle(pair).gridTemplateColumns }));
(async () => {
  const browser = await pw.chromium.launch(); const page = await open(browser);
  await page.evaluate(() => RF.UI.setPane('optics', 'expand')); await page.waitForTimeout(700);
  const before = await cols(page);
  const b = await page.locator('.divider.h').boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 1, { steps: 2 }); await page.mouse.up(); await page.waitForTimeout(500);
  const after = await cols(page), num = (s) => s.split(' ').map(parseFloat);
  const d = (a, c) => Math.max(...num(a).map((v, i) => Math.abs(v - num(c)[i])));
  ok('drag of the row divider while Optics is expanded: Scene | right columns stay put', d(before.w, after.w) <= 2, before.w + ' -> ' + after.w);
  ok('... and the Editor | Result columns stay put', d(before.p, after.p) <= 2, before.p + ' -> ' + after.p);
  ok('... and the dragged row follows the pointer (within 12 px of where it was)', Math.abs(num(after.r)[0] - num(before.r)[0]) <= 12, before.r + ' -> ' + after.r);
  await page.evaluate(() => { RF.UI.layout.expanded = null; RF.UI.setPane('editor', 'collapse'); }); await page.waitForTimeout(600);
  const off = await page.evaluate(() => { const e = document.querySelector('.divider.pd'); return { off: e.classList.contains('off'), tab: e.tabIndex, dis: e.getAttribute('aria-disabled') }; });
  ok('an off divider is out of the tab order and aria-disabled', off.off && off.tab === -1 && off.dis === 'true', JSON.stringify(off));
  const ps = await page.evaluate(() => RF.UI.layout.pairSplit);
  await page.focus('.divider.pd'); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.dblclick('.divider.pd', { force: true });
  ok('arrow keys / double-click on an off divider change nothing', (await page.evaluate(() => RF.UI.layout.pairSplit)) === ps);
  await page.evaluate(() => RF.UI.setPane('editor', 'collapse')); await page.waitForTimeout(600);
  const on = await page.evaluate(() => { const e = document.querySelector('.divider.pd'); return { off: e.classList.contains('off'), tab: e.tabIndex, dis: e.getAttribute('aria-disabled') }; });
  ok('an active divider is focusable again', !on.off && on.tab === 0 && on.dis !== 'true', JSON.stringify(on));
  await browser.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
