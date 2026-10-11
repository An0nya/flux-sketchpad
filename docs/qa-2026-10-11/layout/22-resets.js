const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  // Optics: orbit + zoom, then try every reset path
  await page.evaluate(() => RF.UI.setPane('optics', 'activate')); await page.waitForTimeout(300);
  const b = await page.locator('#surface-canvas').boundingBox();
  const camS = () => page.evaluate(() => ({ scale: +RF.UI.camS.scale.toFixed(3), um: RF.UI.camS.userMoved }));
  console.log('optics initial', JSON.stringify(await camS()));
  await page.mouse.move(b.x + 20, b.y + b.height - 20); await page.mouse.down(); await page.mouse.move(b.x + 120, b.y + b.height - 60, { steps: 8 }); await page.mouse.up();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
  await page.waitForTimeout(400); console.log('optics moved', JSON.stringify(await camS()));
  await page.mouse.dblclick(b.x + 15, b.y + 15); await page.waitForTimeout(400); console.log('after dblclick optics', JSON.stringify(await camS()));
  await page.click('#btn-reset-view'); await page.waitForTimeout(400); console.log('after Scene Reset view', JSON.stringify(await camS()));
  console.log('optics has reset control?', await page.evaluate(() => !!document.querySelector('.optics-pane [data-reset], .optics-pane .reset-view, .optics-pane [title*="eset"]')));
  // Editor dblclick in Paint mode: does it paint?
  await page.evaluate(() => RF.UI.setPane('editor', 'activate')); await page.waitForTimeout(300);
  const sum = () => page.evaluate(() => { const t = RF.UI.store.scene.target; const a = t.cells || t.paint || t.data || t.grid; if (!a) return 'keys:' + Object.keys(t).join(','); let s = 0; for (const v of a) s += v; return +s.toFixed(3); });
  const s0 = await sum(), h0 = await page.evaluate(() => RF.UI.hist && RF.UI.hist.undoLen ? RF.UI.hist.undoLen() : JSON.stringify(Object.keys(RF.UI.hist || {})));
  const lb = await page.locator('#left-canvas').boundingBox();
  await page.mouse.dblclick(lb.x + lb.width * 0.2, lb.y + lb.height * 0.3); await page.waitForTimeout(600);
  console.log('editor paint sum before/after dblclick', s0, await sum(), 'undo enabled', await page.evaluate(() => !document.getElementById('btn-undo').disabled), 'hist', h0);
  console.log(errors); await browser.close();
})();
