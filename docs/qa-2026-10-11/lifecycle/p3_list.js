const H = require('./h.js');
(async () => {
  const { browser, page, st } = await H.boot();
  console.log(await page.evaluate(() => JSON.stringify(RF.Controller.CONTROLS.filter((c) => (c.groups || []).includes('A')).map((c) => [c.id, c.type || 'num', c.get(RF.UI.store), c.modes.join('')]))));
  console.log(await page.evaluate(() => JSON.stringify({ autoA: RF.UI.store.autoA, autoSet: RF.UI.store.autoSet, ver: RF.UI.store.version, ffs: RF.Solvers.settingsOf(RF.UI.store.scene, 'fill-fix'), sch: RF.Solvers.get('fill-fix').settings })));
  await browser.close();
})();
