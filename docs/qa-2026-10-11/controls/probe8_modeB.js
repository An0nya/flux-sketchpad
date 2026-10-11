// Switch to Stamp mode (tab click) and check console + the direction picker canvas.
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.click('.modes button[data-mode="B"]');
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ mode: RF.UI.store.scene.mode, display: RF.UI.display, pickCanvases: [...document.querySelectorAll('canvas')].map((c) => c.id + ':' + c.width + 'x' + c.height + (c.offsetParent ? '' : '(hidden)')) }));
  console.log(JSON.stringify(r)); console.log('errors', [...new Set(errors)]);
  await page.screenshot({ path: 'modeB-picker.png' });
  await browser.close();
})();
