// Watch off then on mid-solve: badges, map, footer stats
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  const badges = () => page.evaluate(() => [...document.querySelectorAll('.watch-badge')].map((b) => b.dataset.badge + (b.hidden ? ':hidden' : ':' + b.textContent.slice(0, 70))).join(' | '));
  const foot = () => page.evaluate(() => (document.querySelector('.stats, #stats, footer') || document.body).innerText.match(/PREVIEW[^\n]*/)?.[0] || 'no PREVIEW in footer');
  await start('sqm'); await page.waitForTimeout(2000);
  console.log('on ', await badges(), '|', await foot());
  await page.evaluate(() => RF.UI.setWatch(false)); await page.waitForTimeout(1500);
  console.log('off', await badges(), '|', await foot(), '| traced pending?', await page.evaluate(() => !!(RF.UI.watch && RF.UI.watch.traced)));
  await page.evaluate(() => RF.UI.setWatch(true)); await page.waitForTimeout(300);
  console.log('on2', await badges(), '|', await foot());
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 }); await page.waitForTimeout(800);
  console.log('end', await badges(), '|', await foot());
  console.log('errors', errors); await browser.close();
})();
