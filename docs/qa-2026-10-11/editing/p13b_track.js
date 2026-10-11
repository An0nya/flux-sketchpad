// Does a dragged handle stay under the cursor? Compare handle screen pos to cursor after a drag, in the Scene (perspective lens) and with lens = ortho
const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));
  const sc = await L.rect(page, 'scene-canvas');
  await L.activate(page, 'scene-canvas');
  await page.click('#btn-setup'); await page.waitForTimeout(300);
  for (const lens of ['41', '100']) {
    await page.evaluate((v) => { const l = document.getElementById('lens'); l.value = v; l.dispatchEvent(new Event('input', { bubbles: true })); l.dispatchEvent(new Event('change', { bubbles: true })); }, lens);
    await page.waitForTimeout(400);
    for (const id of ['tgt', 'src']) {
      const h = await page.evaluate((id) => { const h = RF.UI.handles.find((x) => x.id === id); return [h.x, h.y]; }, id);
      const to = [h[0] - 60, h[1] + 40];
      await L.drag(page, [[sc.x + h[0], sc.y + h[1]], [sc.x + to[0], sc.y + to[1]]], 20); await page.waitForTimeout(400);
      const h2 = await page.evaluate((id) => { const h = RF.UI.handles.find((x) => x.id === id); return [h.x, h.y]; }, id);
      console.log('lens', lens, (await page.evaluate(() => document.getElementById('lens-out').textContent)), id, 'from', h.map(Math.round), 'cursor to', to.map(Math.round), 'handle now', h2.map(Math.round), 'miss px', Math.round(Math.hypot(h2[0] - to[0], h2[1] - to[1])));
    }
  }
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
