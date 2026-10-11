// switch to Profile mode mid-solve (avoids the Mode B picker crash): what does the UI show?
const H = require('./h.js');
(async () => {
  const { browser, page, errors, st, start } = await H.boot();
  await start('fill-fix'); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('.modes button[data-mode=C]').click());
  await page.waitForTimeout(700);
  const s = await st(); console.log(JSON.stringify(s), 'groupA enabled', await page.evaluate(() => RF.UI.store.scene.groups.A.enabled));
  await page.screenshot({ path: 'modeC-mid-solve.png' });
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  console.log('end', JSON.stringify(await st()));
  console.log('errors', errors); await browser.close();
})();
