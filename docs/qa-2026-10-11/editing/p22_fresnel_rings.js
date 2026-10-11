const L = require('./lib');
(async () => {
  const { browser, page, errors } = await L.open();
  await page.evaluate(() => RF.UI.setAuto('paint', false));
  await page.evaluate(() => { let e = document.getElementById('lens-list'); while (e && e.id !== 'side') { if (e.tagName === 'DETAILS') e.open = true; e = e.parentElement; } });
  await page.selectOption('#lens-kind', 'fresnel'); await page.click('text=Add lens'); await page.waitForTimeout(500);
  for (const v of ['5000', '1000000']) {
    const before = errors.length, t0 = Date.now();
    await page.fill('#lens-list input[data-lens="l1.rings"]', v); await page.press('#lens-list input[data-lens="l1.rings"]', 'Tab'); await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({ rings: RF.UI.store.scene.lenses[0].params.rings, nL: RF.UI.store.scene.groups.L.surfaces.length, dirty: [...RF.UI.store.dirty], status: document.getElementById('run-state').textContent, field: document.querySelector('#lens-list input[data-lens="l1.rings"]').value }));
    console.log(v, Date.now() - t0, 'ms', JSON.stringify(st), errors.slice(before).map((e) => e.split('\n').slice(0, 4).join(' | ')));
  }
  // set ior 0 and look at the scene/footer
  await page.fill('#lens-list input[data-lens="l1.rings"]', '12'); await page.press('#lens-list input[data-lens="l1.rings"]', 'Tab'); await page.waitForTimeout(800);
  await page.fill('#lens-list input[data-lens="l1.ior"]', '0'); await page.press('#lens-list input[data-lens="l1.ior"]', 'Tab'); await page.waitForTimeout(2500);
  console.log('ior 0', await page.evaluate(() => JSON.stringify({ ior: RF.UI.store.scene.lenses[0].params.ior, foot: document.getElementById('min-row').innerText.replace(/\n/g, ' ').slice(0, 140), info: JSON.stringify(RF.UI.store.reports.L).slice(0, 200) })));
  console.log('errors', errors.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
