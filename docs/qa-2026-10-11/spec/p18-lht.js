// left-hand traffic: overlay mirrored, road/drive mirrored, numbers coherent
const { boot, waitJudged } = require('./lib.js');
(async () => {
  const { browser, page, errors } = await boot();
  await page.evaluate(() => RF.UI.setMode('D')); await waitJudged(page);
  const setRow = (re, val) => page.evaluate(([re, val]) => { const r = [...document.querySelectorAll('#spec-box .row')].find((r) => new RegExp(re).test((r.querySelector('label') || {}).textContent || '')); const i = r.querySelector('input,select'); i.value = val; i.dispatchEvent(new Event('change')); }, [re, val]);
  const snap = (tag) => page.evaluate((tag) => { const ui = RF.UI, ev = ui.spec.ev, rd = RF.SpecUI.roadModel(ui), it = RF.Spec.itemsOf(ui.store.scene.modeD).find((x) => x.name === '75R'), row = ev.rows.find((r) => r.name === '75R');
    return { tag, traffic: ui.store.scene.modeD.traffic, it75R: [it.h, it.v], rowAt: row.at, val: Math.round(row.value), shift: ev.shift, note: ev.aim.note, mir: rd.mir, roadSh: rd.sh, iihs: [rd.iihs.right, rd.iihs.left], q: rd.quality && rd.quality.peak, n: ev.n }; }, tag);
  await page.click('[data-ff="road"]'); await page.waitForTimeout(500);
  console.log(JSON.stringify(await snap('RHT')));
  await page.screenshot({ path: __dirname + '/p18-ff-rht.png', clip: await page.locator('#heat-canvas').boundingBox() });
  await setRow('^Traffic', 'LHT');
  await page.waitForFunction(() => RF.UI.solving, null, { timeout: 5000 }).catch(() => console.log('(no solve started)'));
  await page.waitForFunction(() => !RF.UI.solving, null, { timeout: 240000 }); await waitJudged(page, 240000); await page.waitForTimeout(1500);
  console.log(JSON.stringify(await snap('LHT')));
  await page.screenshot({ path: __dirname + '/p18-ff-lht.png', clip: await page.locator('#heat-canvas').boundingBox() });
  await page.evaluate(() => RF.UI.setDisplay('road')); await page.waitForTimeout(800);
  await page.screenshot({ path: __dirname + '/p18-road-lht.png', clip: await page.locator('#heat-canvas').boundingBox() });
  await page.evaluate(() => RF.UI.setDisplay('drive')); await page.waitForTimeout(1500);
  await page.screenshot({ path: __dirname + '/p18-drive-lht.png', clip: await page.locator('#heat-canvas').boundingBox() });
  console.log('drive flip', await page.evaluate(() => RF.UI.driveShown.flip));
  console.log('errors', errors);
  await browser.close();
})();
