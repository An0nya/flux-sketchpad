// typing an out-of-range Manual aim with the keyboard: does the field show the clamped value the judge uses?
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.click('details[data-section="D-meas"] > summary');
  await page.locator('input[aria-label="Manual aim, beam right"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => { const s = [...document.querySelectorAll('#spec-box select')].find((s) => [...s.options].some((o) => o.value === 'manual')); s.value = 'manual'; s.dispatchEvent(new Event('change')); });
  const inp = page.locator('input[aria-label="Manual aim, beam right"]');
  console.log('visible', await inp.isVisible());
  for (const key of ['Enter', 'Tab']) {
    await inp.click({ clickCount: 3 }); await page.keyboard.type('9'); await page.keyboard.press(key); await page.waitForTimeout(1500);
    console.log(key, JSON.stringify(await page.evaluate(() => ({ field: document.querySelector('input[aria-label="Manual aim, beam right"]').value, model: RF.UI.store.scene.modeD.aimManual, judgeNote: RF.UI.spec.ev.aim.note, focused: document.activeElement && document.activeElement.getAttribute('aria-label') }))));
  }
  console.log('errors', errors);
  await browser.close();
})();
