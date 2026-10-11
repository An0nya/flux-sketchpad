const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  const summ = async (tag) => { const c = await L.canvases(page); const o = await L.overflow(page); console.log(tag, Object.entries(c).map(([k, v]) => k.split('-')[0] + ':' + v.css.join('x') + ' nb' + v.nonbg).join(' '), 'scrollW', o.scrollW, 'vw', o.vw, JSON.stringify(await page.evaluate(() => ({ L: RF.UI.layout, side: !document.body.classList.contains('side-hidden') })))); };
  await page.evaluate(() => { RF.UI.setPane('optics', 'collapse'); RF.UI.setPane('result', 'expand'); }); await page.waitForTimeout(600);
  await summ('1500 optics collapsed + result expanded');
  for (const [w, h] of [[1280, 720], [900, 700], [700, 800], [375, 812], [1024, 768], [1500, 950]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(900);
    await summ(w + 'x' + h);
    await page.screenshot({ path: L.SH + `resize-${w}.png` });
  }
  console.log(errors); await browser.close();
})();
