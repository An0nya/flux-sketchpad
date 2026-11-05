// Native port of tests/regress/DW-drive-wheel.js (the adapter skips that script while this file exists).
// A mouse wheel over the in-page Drive display must not zoom or pan the heat view the drive image is drawn through.
// Positive control: with a non-drive display the same wheel still zooms.
const { test, expect } = require('../fixtures.js');
test.use({ viewport: { width: 1400, height: 950 } });

test('DW: wheel over the Drive display does not zoom the heat view', async ({ drive: page, pageErrors }) => {
  await page.waitForTimeout(1500);
  const view = () => page.evaluate(() => ({ s: RF.UI.vHeat.s, display: RF.UI.display }));
  const spin = async () => {
    const box = await page.locator('#heat-canvas').boundingBox();
    if (!box || !box.width) return false;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
    await page.waitForTimeout(300);
    return true;
  };
  const d0 = await view();
  expect.soft(d0.display, 'the drive display is showing').toBe('drive');
  expect.soft(await spin(), 'found the drive canvas to scroll over').toBe(true);
  expect.soft((await view()).s, 'wheel over the Drive display does not zoom the heat view').toBe(d0.s);

  await page.evaluate(() => RF.UI.setDisplay('hits')); await page.waitForTimeout(1200);
  const h0 = await view(); await spin();
  expect.soft((await view()).s, 'positive control: the same wheel zooms a non-drive display').not.toBe(h0.s);
  expect(pageErrors, 'nothing throws').toEqual([]);
});
