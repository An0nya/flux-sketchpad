const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await L.setMode(page, 'A');
  await page.evaluate(() => { RF.UI.setAuto('paint', false); RF.UI.clearPaint(); });
  const r = await L.rect(page, 'left-canvas');
  const cnt = () => page.evaluate(() => { const p = RF.UI.store.scene.modeA.paint; const h = {}; for (const x of p) if (x > 0) h[x] = (h[x] || 0) + 1; return h; });
  const y = r.y + r.h * 0.5;
  await L.drag(page, [[r.x + r.w * 0.3, y], [r.x + r.w * 0.7, y]], 40);
  console.log('level 1 stroke', JSON.stringify(await cnt()));
  // set level slider to 0.3 via keyboard-free input event on the left-tools slider
  await page.evaluate(() => { const s = document.querySelector('#left-tools input[data-control="A.strength"]'); s.value = '0.3'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  console.log('strength now', await page.evaluate(() => RF.UI.store.scene.modeA.brush.strength));
  await L.drag(page, [[r.x + r.w * 0.3, y], [r.x + r.w * 0.7, y]], 40);
  console.log('level 0.3 over level 1', JSON.stringify(await cnt()));
  // ctrl-held erase
  await page.keyboard.down('Control');
  await L.drag(page, [[r.x + r.w * 0.3, y], [r.x + r.w * 0.5, y]], 40);
  await page.keyboard.up('Control');
  console.log('ctrl erase half', JSON.stringify(await cnt()));
  // patterns: open the pattern select, pick Spot, paint over, pick Spot again
  await page.evaluate(() => { let e = document.getElementById('pattern-box'); while (e && e.id !== 'side') { if (e.tagName === 'DETAILS') e.open = true; e = e.parentElement; } });
  await page.selectOption('#pattern-box select', 'b:spot'); await page.waitForTimeout(300);
  const spot = await cnt(); console.log('spot', JSON.stringify(spot));
  await page.evaluate(() => RF.UI.clearPaint()); await page.waitForTimeout(200);
  console.log('cleared', JSON.stringify(await cnt()), 'select shows', await page.$eval('#pattern-box select', (s) => s.value));
  await page.selectOption('#pattern-box select', 'b:spot'); await page.waitForTimeout(300);
  console.log('spot picked again', JSON.stringify(await cnt()));
  console.log('errors', [...new Set(errors.map((e) => e.split('\n')[0]))]);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
