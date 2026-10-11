// Open a bad file (mode Z) through "Open from disk", interact once, reload: is the app bricked?
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.setInputFiles('#file-input', 'files/modeZ.json'); await page.waitForTimeout(1000);
  console.log('notice:', await page.evaluate(() => RF.UI.store.notices[0].msg));
  await page.evaluate(() => RF.UI.setControl('A.budget', 77)); await page.waitForTimeout(1500);
  await page.reload(); await page.waitForTimeout(6000);
  console.log('after reload:', await page.evaluate(() => { const b = document.getElementById('boot-error'); return b && !b.hidden ? b.textContent.slice(0, 120) : 'booted ok'; }));
  await page.screenshot({ path: 'upload-modeZ-reload.png' });
  await browser.close();
})();
