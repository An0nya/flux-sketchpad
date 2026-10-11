// Undo/redo through the real UI (typing, arrow keys, slider, preset, mode tabs, toolbar buttons).
const { boot } = require('./h.js');
(async () => {
  const { browser, page, errors } = await boot();
  const S = () => page.evaluate(() => ({ budget: RF.UI.store.scene.modeA.budget, budgetField: document.querySelector('#side input.scrub[data-control="A.budget"]').value, budgetSlider: document.querySelector('#side input[type=range][data-control="A.budget"]').value,
    bounces: RF.UI.store.scene.sim.bounces, mode: RF.UI.store.scene.mode, past: RF.UI.hist.past.map((e) => e.label), future: RF.UI.hist.future.map((e) => e.label), undoDis: document.getElementById('btn-undo').disabled, redoDis: document.getElementById('btn-redo').disabled }));
  const log = async (tag) => console.log(tag.padEnd(34), JSON.stringify(await S()));
  await log('start');
  const fld = '#side input.scrub[data-control="A.budget"]';
  // 1. typed value + Enter
  await page.click(fld); await page.fill(fld, '200'); await page.press(fld, 'Enter'); await page.waitForTimeout(300); await log('typed 200');
  // 2. invalid text + Enter: is the field restored?
  await page.click(fld); await page.fill(fld, 'abc'); await page.press(fld, 'Enter'); await page.waitForTimeout(300); await log('typed abc');
  await page.click(fld); await page.fill(fld, ''); await page.press(fld, 'Tab'); await page.waitForTimeout(300); await log('emptied + Tab');
  // 3. arrow keys x5 quickly (should coalesce)
  await page.click(fld); for (let i = 0; i < 5; i++) await page.press(fld, 'ArrowUp'); await page.press(fld, 'Escape'); await page.waitForTimeout(300); await log('5x ArrowUp');
  // 4. undo via toolbar button (focus outside a field)
  await page.click('#btn-undo'); await page.waitForTimeout(400); await log('undo #1');
  await page.click('#btn-undo'); await page.waitForTimeout(400); await log('undo #2');
  await page.click('#btn-redo'); await page.waitForTimeout(400); await log('redo #1');
  // 5. mode tab switches: no entries expected
  await page.click('.modes button[data-mode="C"]'); await page.waitForTimeout(300); await page.click('.modes button[data-mode="A"]'); await page.waitForTimeout(300); await log('mode C→A');
  // 6. preset then undo: back to previous scene + mode?
  await page.selectOption('#preset-select', 'cpc'); await page.click('#preset-confirm button.primary'); await page.waitForTimeout(500); await log('preset cpc');
  await page.click('#btn-undo'); await page.waitForTimeout(600); await log('undo preset');
  await page.click('#btn-redo'); await page.waitForTimeout(600); await log('redo preset');
  await page.click('#btn-undo'); await page.waitForTimeout(600); await log('undo preset again');
  // 7. keyboard Ctrl+Z with body focus
  await page.click(fld); await page.fill(fld, '321'); await page.press(fld, 'Enter'); await page.waitForTimeout(300); await log('typed 321');
  await page.locator('body').press('Control+z'); await page.waitForTimeout(500); await log('Ctrl+Z on body');
  await page.locator('body').press('Control+Shift+z'); await page.waitForTimeout(500); await log('Ctrl+Shift+Z on body');
  console.log('errors', [...new Set(errors)]);
  await browser.close();
})();
