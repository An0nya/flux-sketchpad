// shared harness: node <script> ; exports boot(opts)
const pw = require('/Users/anya/Projects/agent-qa/node_modules/playwright');
const URL = 'http://localhost:8802/index.html';
async function boot(opts = {}) {
  const browser = opts.browser || await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e)));
  if (opts.ls) await page.addInitScript((ls) => { if (!sessionStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, opts.ls);
  await page.goto(URL + (opts.hash || ''));
  if (opts.noWait) { await page.waitForTimeout(opts.noWait); return { browser, ctx, page, errors }; }
  await page.waitForFunction(() => window.RF && RF.UI && RF.UI.store && RF.SolverHost && !RF.SolverHost.loading(), null, { timeout: 60000 });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 120000 });
  return { browser, ctx, page, errors };
}
module.exports = { pw, boot, URL };
