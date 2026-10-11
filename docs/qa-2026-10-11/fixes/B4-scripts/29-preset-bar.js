const L = require('./lib');
(async () => {
  const browser = await L.pw.chromium.launch();
  for (const vp of [{ width: 1500, height: 950 }, { width: 375, height: 812 }]) {
    const mob = vp.width < 500;
    const { ctx, page, errors } = await L.open({ browser, viewport: vp, mobile: mob, touch: mob });
    if (mob) { await page.click('#btn-side'); await page.waitForTimeout(400); }
    await page.selectOption('#preset-select', 'spec-sealed7'); await page.waitForTimeout(300);
    const r = await page.evaluate(() => { const b = document.getElementById('preset-confirm'); if (!b) return null; const s = document.getElementById('sidebar').getBoundingClientRect(); return [...b.children].map(c => { const r = c.getBoundingClientRect(); return c.textContent.slice(0, 30) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + '] side ' + Math.round(s.left) + '..' + Math.round(s.right) + ' h' + Math.round(r.height); }); });
    console.log(vp.width, JSON.stringify(r));
    await page.screenshot({ path: L.SH + `preset-${vp.width}.png` });
    // change selection again without confirming: is a 2nd bar added?
    await page.selectOption('#preset-select', 'tir'); await page.waitForTimeout(300);
    console.log(' bars', await page.evaluate(() => document.querySelectorAll('#preset-confirm').length), await page.evaluate(() => document.querySelector('#preset-confirm .primary').textContent));
    // Cancel
    await page.click('#preset-confirm button:not(.primary)'); await page.waitForTimeout(200);
    console.log(' after cancel', await page.evaluate(() => [!!document.getElementById('preset-confirm'), document.getElementById('preset-select').value]));
    console.log(' errors', errors);
    await ctx.close();
  }
  await browser.close();
})();
