// Mode B with no solve running: does the picker throw, and does the trace ever finish?
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st } = await H.boot();
  await page.waitForFunction(() => RF.UI.run && RF.UI.run.ctx.done, null, { timeout: 60000 });
  await page.evaluate(() => document.querySelector('.modes button[data-mode=B]').click());
  for (const t of [1000, 4000, 10000]) { await page.waitForTimeout(t); const s = await st(); console.log('t+', t, s.mode, s.status, 'runDone', s.runDone, 'next/N', await page.evaluate(() => RF.UI.run.ctx.next + '/' + RF.UI.run.ctx.N)); }
  await page.screenshot({ path: 'modeB.png' });
  console.log('errors', errors.length, errors[0]);
  await browser.close();
})();
