const H = require('./h.js');
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  const foot = () => page.evaluate(() => { const all = [...document.querySelectorAll('*')].filter((e) => e.children.length < 40 && /delivered/.test(e.innerText || '') && /rays/.test(e.innerText || '')); const e = all[all.length - 1]; return e ? e.innerText.replace(/\s+/g, ' ').slice(0, 140) : 'none'; });
  await start('sqm'); await page.waitForTimeout(2000);
  console.log('on ', await foot());
  await page.evaluate(() => RF.UI.setWatch(false));
  for (const t of [1000, 2000]) { await page.waitForTimeout(t); console.log('off +' + t, await foot(), '| watch.n', await page.evaluate(() => RF.UI.watch && RF.UI.watch.n)); }
  await page.screenshot({ path: 'watch-off-footer.png' });
  console.log('errors', errors); await browser.close();
})();
