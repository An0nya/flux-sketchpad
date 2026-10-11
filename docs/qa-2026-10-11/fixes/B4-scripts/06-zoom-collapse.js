const L = require('./lib');
const views = (page) => page.evaluate(() => { const f = (v) => ({ s: +v.s.toFixed(3), fitS: +(v.fitS || 0).toFixed(3), ox: +v.ox.toFixed(1), oy: +v.oy.toFixed(1), w: v.w, h: v.h, zoomed: v.zoomed, fitted: v.fitted }); return { L: f(RF.UI.vLeft), H: f(RF.UI.vHeat) }; });
(async () => {
  const { browser, page, errors } = await L.open({});
  for (const [pane, cid] of [['editor', 'left-canvas'], ['result', 'heat-canvas']]) {
    await page.click(`.pane[data-pane="${pane}"] h2`, { position: { x: 1, y: 1 } }).catch(() => {});
    // activate the pane by pointerdown on its head (not the title, which collapses)
    await page.evaluate((p) => RF.UI.setPane(p, 'activate'), pane);
    if (await page.evaluate((p) => RF.UI.layout.collapsed[p], pane)) await page.evaluate((p) => RF.UI.setPane(p, 'collapse'), pane);
    await page.waitForTimeout(500);
    const box = await page.locator('#' + cid).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -200); await page.waitForTimeout(60); }
    await page.waitForTimeout(500);
    console.log(pane, 'zoomed', JSON.stringify(await views(page)), JSON.stringify((await L.canvases(page))[cid]));
    await page.screenshot({ path: L.SH + `zc-${pane}-1zoomed.png` });
    await page.click(`button.collapse[data-collapse="${pane}"]`); await page.waitForTimeout(600);
    console.log(pane, 'collapsed', JSON.stringify(await views(page)));
    await page.click(`.pane[data-pane="${pane}"] h2`); await page.waitForTimeout(800);
    console.log(pane, 'reopened', JSON.stringify(await views(page)), JSON.stringify((await L.canvases(page))[cid]));
    await page.screenshot({ path: L.SH + `zc-${pane}-2reopened.png` });
    await page.click(`button[data-reset="${pane === 'editor' ? 'left' : 'heat'}"]`); await page.waitForTimeout(500);
    console.log(pane, 'after reset', JSON.stringify(await views(page)), JSON.stringify((await L.canvases(page))[cid]));
  }
  console.log(errors); await browser.close();
})();
