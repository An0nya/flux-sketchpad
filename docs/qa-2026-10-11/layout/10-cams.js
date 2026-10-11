const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open({});
  const cam = () => page.evaluate(() => { const f = (c) => ({ scale: c.scale, w: c.w, h: c.h, um: c.userMoved, fitted: c.fitted }); return { cam: f(RF.UI.cam), camS: f(RF.UI.camS) }; });
  for (const [pane, cid] of [['scene', 'scene-canvas'], ['optics', 'surface-canvas']]) {
    await page.evaluate((p) => RF.UI.setPane(p, 'activate'), pane); await page.waitForTimeout(300);
    const b = await page.locator('#' + cid).boundingBox();
    // orbit (drag from empty-ish corner) then wheel zoom
    await page.mouse.move(b.x + 30, b.y + b.height - 40); await page.mouse.down(); await page.mouse.move(b.x + 90, b.y + b.height - 60, { steps: 6 }); await page.mouse.up();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -150); await page.waitForTimeout(50); }
    await page.waitForTimeout(500);
    const before = (await L.canvases(page))[cid];
    console.log(pane, 'moved', JSON.stringify(await cam()), JSON.stringify(before));
    await page.click(`button.collapse[data-collapse="${pane}"]`); await page.waitForTimeout(600);
    console.log(pane, 'collapsed', JSON.stringify(await cam()));
    await page.click(`.pane[data-pane="${pane}"] h2`); await page.waitForTimeout(800);
    const after = (await L.canvases(page))[cid];
    console.log(pane, 'reopened', JSON.stringify(await cam()), JSON.stringify(after));
    await page.screenshot({ path: L.SH + `cam-${pane}-reopened.png` });
  }
  // expand each pane and back
  for (const p of ['scene', 'editor', 'result', 'optics']) {
    await page.click(`button.expand[data-expand="${p}"]`); await page.waitForTimeout(600);
    const c = await L.canvases(page);
    console.log('expanded', p, JSON.stringify(await page.evaluate(() => [getComputedStyle(workspace).gridTemplateColumns, getComputedStyle(right).gridTemplateRows, getComputedStyle(pair).gridTemplateColumns])), Object.entries(c).map(([k, v]) => k + ':' + v.css.join('x') + ' nb' + v.nonbg).join(' '));
    await page.screenshot({ path: L.SH + `exp-${p}.png` });
    await page.click(`button.expand[data-expand="${p}"]`); await page.waitForTimeout(600);
  }
  console.log('after all', JSON.stringify(await page.evaluate(() => RF.UI.layout)));
  console.log(errors); await browser.close();
})();
