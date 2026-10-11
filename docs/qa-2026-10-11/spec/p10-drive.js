// Drive view: every scene × shape × toggles renders without error; caption matches; readout works
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  await page.evaluate(() => RF.UI.setDisplay('drive')); await page.waitForTimeout(1500);
  const scenes = await page.evaluate(() => [...document.querySelectorAll('.drive-tools select option')].map((o) => o.value));
  console.log('scenes', scenes, 'all', await page.evaluate(() => Object.keys(RF.Drive.scenes)));
  for (const sc of scenes) {
    await page.selectOption('.drive-tools select[data-dv="scene"]', sc); await page.waitForTimeout(1200);
    for (let i = 0; i < 5; i++) {
      const r = await page.evaluate(() => { const ui = RF.UI, d = ui.driveShown; return { cap: document.getElementById('right-caption').textContent, shape: ui.rvOpts.shape, ms: Math.round(RF.SpecUI.roadModel(ui).drive.ms), lit: (() => { const px = d.tm.px; let n = 0; for (let q = 0; q < px.length; q += 4) if (px[q] + px[q + 1] + px[q + 2] > 30) n++; return n; })() }; });
      console.log(sc, JSON.stringify(r));
      if (i === 0) await page.screenshot({ path: __dirname + '/p10-drive-' + sc + '.png', clip: await page.locator('#heat-canvas').boundingBox() });
      await page.click('.drive-tools [data-dv="shape"]'); await page.waitForTimeout(1000);
    }
  }
  for (const k of ['wet', 'oncoming', 'preceding', 'people', 'animals', 'signs', 'glare', 'expMode']) { await page.click('.drive-tools [data-dv="' + k + '"]'); await page.waitForTimeout(700); }
  console.log('after toggles', await page.evaluate(() => [...document.querySelectorAll('.drive-tools [data-dv]')].map((b) => b.dataset.dv + '=' + (b.textContent || b.value) + (b.getAttribute('aria-pressed') ? '(' + b.getAttribute('aria-pressed') + ')' : '')).join(' ')));
  await page.screenshot({ path: __dirname + '/p10-drive-toggles.png', clip: await page.locator('#heat-canvas').boundingBox() });
  console.log('errors', errors);
  await browser.close();
})();
