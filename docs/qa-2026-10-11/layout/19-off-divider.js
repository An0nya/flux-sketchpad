const L = require('./lib');
(async () => {
  const { browser, page } = await L.open({});
  await page.evaluate(() => RF.UI.setPane('editor', 'collapse')); await page.waitForTimeout(500);
  const d = await page.evaluate(() => { const e = document.querySelector('.divider.pd'); return { off: e.classList.contains('off'), tabindex: e.tabIndex, rect: JSON.stringify(e.getBoundingClientRect()) }; });
  await page.focus('.divider.pd'); for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => ({ pairSplit: RF.UI.layout.pairSplit, cols: getComputedStyle(pair).gridTemplateColumns, focused: document.activeElement.classList.contains('pd') }));
  await page.evaluate(() => RF.UI.setPane('editor', 'collapse')); await page.waitForTimeout(500);
  const re = await page.evaluate(() => ({ pairSplit: RF.UI.layout.pairSplit, cols: getComputedStyle(pair).gridTemplateColumns }));
  console.log(JSON.stringify({ d, after, reopened: re }));
  await browser.close();
})();
