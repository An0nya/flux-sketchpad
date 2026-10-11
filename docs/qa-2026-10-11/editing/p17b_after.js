const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  const o = await L.rect(page, 'surface-canvas');
  await L.activate(page, 'surface-canvas');
  const tgt = await page.evaluate(() => { const fs = RF.UI.store.scene.groups.A.surfaces; const f = fs[fs.length - 1]; return { id: f.id, q: RF.UI.camS.project(f.P) }; });
  await page.mouse.click(o.x + tgt.q[0], o.y + tgt.q[1]); await page.waitForTimeout(500);
  console.log('selected', await page.evaluate(() => JSON.stringify(RF.UI.sel)));
  await page.evaluate(() => { RF.UI.setControl('A.budget', 10); RF.UI.generateA(); });
  await page.waitForTimeout(500); await L.idle(page);
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1500); console.log(i, await page.evaluate(() => JSON.stringify({ solving: !!RF.UI.solving, status: document.getElementById('run-state').textContent, stop: !document.getElementById('btn-stop').hidden, nA: RF.UI.store.scene.groups.A.surfaces.length, errs: 0 })), 'errors so far', errors.length); }
  await page.screenshot({ path: L.DIR + '/shots/p17b_after.png' });
  // clear the selection with Esc and see whether things recover
  await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  console.log('after Esc', await page.evaluate(() => JSON.stringify({ sel: RF.UI.sel, status: document.getElementById('run-state').textContent })), 'errors', errors.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
