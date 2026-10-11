const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 1280, height: 720 }]) {
    const { ctx, page, errors } = await L.open({ browser, viewport: vp });
    const id = await page.evaluate(() => RF.UI.store.scene.groups.A.surfaces[5].id);
    await page.evaluate((id) => RF.UI.select({ kind: 'facet', id }), id); await page.waitForTimeout(500);
    const chip = () => page.evaluate(() => [...document.querySelectorAll('.sel-chip')].map(c => { const r = c.getBoundingClientRect(); return (c.closest('.pane').dataset.pane) + (c.hidden ? ':hidden' : ':' + c.textContent.trim().slice(0, 40) + ' w' + Math.round(r.width)); }));
    console.log(vp.width, 'chips', JSON.stringify(await chip()));
    await page.click('button.expand[data-expand="optics"]'); await page.waitForTimeout(800);
    const st = await page.evaluate(() => { const p = document.getElementById('insp-panel'), c = document.getElementById('surface-canvas'), pr = p.getBoundingClientRect(), cr = c.getBoundingClientRect(); return { inspHidden: p.hidden, insp: [Math.round(pr.left), Math.round(pr.top), Math.round(pr.width), Math.round(pr.height)], canvas: [Math.round(cr.left), Math.round(cr.width), Math.round(cr.height)], store: [c.width, c.height], scroll: p.scrollHeight > p.clientHeight }; });
    console.log(vp.width, 'expanded optics', JSON.stringify(st));
    await page.screenshot({ path: L.SH + `insp-${vp.width}.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    const st2 = await page.evaluate(() => { const c = document.getElementById('surface-canvas'), cr = c.getBoundingClientRect(); return { sel: !!RF.UI.sel, inspHidden: document.getElementById('insp-panel').hidden, canvas: [Math.round(cr.width), Math.round(cr.height)], store: [c.width, c.height] }; });
    console.log(vp.width, 'after Esc', JSON.stringify(st2), JSON.stringify(await chip()));
    console.log(' canv', JSON.stringify((await L.canvases(page))['surface-canvas']));
    console.log(' errors', errors);
    await ctx.close();
  }
  await browser.close();
})();
