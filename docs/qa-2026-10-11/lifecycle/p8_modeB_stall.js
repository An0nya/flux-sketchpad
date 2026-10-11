// switch to Mode B mid-solve: does the trace stall after the solve result arrives?
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.modes button[data-mode=B]').click());
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 });
  for (const t of [2000, 8000, 10000]) { await page.waitForTimeout(t); const s = await st(); console.log('after solve +', t, s.mode, '|', s.status, '| runDone', s.runDone, await page.evaluate(() => RF.UI.run.ctx.next + '/' + RF.UI.run.ctx.N), 'errors so far', errors.length); }
  await page.screenshot({ path: 'modeB-stall.png' });
  await page.mouse.move(700, 400); await page.mouse.wheel(0, 10); await page.waitForTimeout(2000);
  const s = await st(); console.log('after a wheel event:', s.status, s.runDone, 'errors', errors.length);
  await browser.close();
})();
